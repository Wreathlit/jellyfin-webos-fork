const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BUNDLE_FILES, loadInjectedRuntime } = require('../helpers/injectedRuntime');

const root = path.resolve(__dirname, '..', '..');

// The harness is only worth trusting to the extent it resembles the TV. These
// assertions guard the places where a drift would not fail anything -- it would
// just quietly make every other test exercise a different runtime.

// BUNDLE_FILES is a hand-copy of the injection manifest in frontend/js/index.js.
// If a module is added there and not here, the harness loads an incomplete
// bundle; webOS.js degrades gracefully when a module is missing, so nothing
// warns and every "end-to-end" test silently covers the wrong thing.
{
    const indexSource = fs.readFileSync(path.join(root, 'frontend', 'js', 'index.js'), 'utf8');
    const match = /var\s+injectedScriptUrls\s*=\s*\[([\s\S]*?)\];/.exec(indexSource);
    assert.ok(match, 'injectedScriptUrls must be findable in frontend/js/index.js');

    // Drop comments so a commented-out entry is not read as registered.
    const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const manifest = [];
    const itemPattern = /['"]([^'"]+)['"]/g;
    let item;
    while ((item = itemPattern.exec(body)) !== null) {
        manifest.push('frontend/' + item[1]);
    }

    assert.deepStrictEqual(
        BUNDLE_FILES,
        manifest,
        'the harness bundle list must match injectedScriptUrls exactly, in order'
    );
}

// webOS.js skips the whole ASS interception when window.Worker is absent, and
// the harness used to have no Worker at all -- so that path never ran.
{
    const runtime = loadInjectedRuntime();
    assert.strictEqual(
        typeof runtime.window.Worker,
        'function',
        'the harness must provide a Worker so the ASS interception installs'
    );

    const worker = new runtime.window.Worker('https://server.example/libass.js');
    assert.strictEqual(
        runtime.state.workers.length,
        1,
        'constructed workers must be observable from tests'
    );

    // Messages must reach the real worker, patched or not: an interception that
    // swallowed them would break subtitles rather than fix their timing.
    worker.postMessage({ target: 'worker-init', renderMode: 'wasm-blend', targetFps: 24 });
    assert.strictEqual(worker.posted.length, 1, 'the interception must forward messages through');
    assert.strictEqual(worker.posted[0].target, 'worker-init');
}

// The fetch stub used to resolve 200 + JSON unconditionally, which made every
// error path in the runtime unreachable from a test.
{
    const runtime = loadInjectedRuntime();

    runtime.respondToFetch(() => ({ status: 503, body: { error: 'down' } }));
    const failing = runtime.window.fetch('https://server.example/System/Info/Public');

    runtime.respondToFetch(() => ({ reject: 'Failed to fetch' }));
    const rejecting = runtime.window.fetch('https://server.example/System/Info/Public');

    module.exports = (async function () {
        const response = await failing;
        assert.strictEqual(response.status, 503, 'the stub must be able to report a non-2xx status');
        assert.strictEqual(response.ok, false);

        let rejected = null;
        try {
            await rejecting;
        } catch (error) {
            rejected = error;
        }
        assert.ok(rejected, 'the stub must be able to reject like a network failure');

        const runtime2 = loadInjectedRuntime();
        runtime2.respondToFetch(() => ({ bodyText: 'not json at all', contentType: 'text/html' }));
        const html = await runtime2.window.fetch('https://server.example/System/Info/Public');
        let parseError = null;
        try {
            await html.json();
        } catch (error) {
            parseError = error;
        }
        assert.ok(parseError, 'json() must reject on a body that is not JSON, as the browser does');
    })();
}

// Feature handling is registry-driven now: load, save and the override
// broadcast all walk core.features rather than repeating the list. The one
// remaining hand-written piece is the accessor table in webOS.js that maps a
// key to the variable holding it, so assert every registered boolean has one --
// a definition without an accessor would persist nowhere and broadcast as
// undefined.
{
    const runtime = loadInjectedRuntime();
    const registry = runtime.window.__JellyfinWebOSPatchRuntime.get('core.features');
    assert.ok(registry, 'core.features must register');

    const definitions = registry.getBooleanDefinitions();
    assert.ok(definitions.length > 0, 'there must be boolean features to check');

    // The accessor table is internal, so observe it through the broadcast: an
    // unmapped key would be missing from the payload, and webOS.js warns.
    runtime.state.messages.length = 0;
    runtime.nativeShell.AppHost.init();

    const overrides = runtime.state.messages.filter(function (message) {
        return message && message.type === 'WebOS.featureOverrides';
    });

    if (overrides.length) {
        const payload = overrides[overrides.length - 1].data;
        for (const definition of definitions) {
            assert.strictEqual(
                typeof payload[definition.key],
                'boolean',
                definition.key + ' must reach the override payload as a boolean'
            );
        }
    }

    assert.deepStrictEqual(
        runtime.state.warnings.filter(function (warning) {
            return String(warning).indexOf('no webOS.js accessor') !== -1;
        }),
        [],
        'every registered feature must have an accessor in webOS.js'
    );
}
