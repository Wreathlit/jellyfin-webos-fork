const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BUNDLE_FILES, loadInjectedRuntime } = require('../helpers/injectedRuntime');
const { extractArray } = require('../../tools/extract-array');

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
    const manifest = extractArray(indexSource, 'injectedScriptUrls')
        .map((url) => 'frontend/' + url);

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

    // The accessor table is internal, so observe it through the broadcast the
    // bundle emits at load. This used to clear state.messages first and then
    // call AppHost.init(), which posts only 'AppHost.init' -- so `overrides` was
    // always empty and the whole loop below never ran.
    const overrides = runtime.state.messages.filter(function (message) {
        return message && message.type === 'WebOS.featureOverrides';
    });
    assert.strictEqual(
        overrides.length,
        1,
        'the bundle must broadcast the feature overrides exactly once at load'
    );

    const payload = overrides[0].data;
    for (const definition of definitions) {
        assert.strictEqual(
            typeof payload[definition.key],
            'boolean',
            definition.key + ' must reach the override payload as a boolean'
        );
    }

    assert.deepStrictEqual(
        runtime.state.warnings.filter(function (warning) {
            return String(warning).indexOf('no webOS.js accessor') !== -1;
        }),
        [],
        'every registered feature must have an accessor in webOS.js'
    );
}

// Every registered boolean feature must have a checkbox class and a setter in
// the accessor table, and the settings UI must be driven from that table rather
// than six hand-written blocks. Forgetting a block was silent: the checkbox
// rendered and toggled on screen while nothing reached setFeatureFlag, so the
// setting neither persisted nor broadcast.
{
    const runtime = loadInjectedRuntime();
    const registry = runtime.window.__JellyfinWebOSPatchRuntime.get('core.features');
    const definitions = registry.getBooleanDefinitions();
    // The working tree may hold either line ending; normalise before searching.
    const source = fs.readFileSync(path.join(root, 'frontend', 'js', 'webOS.js'), 'utf8')
        .split(String.fromCharCode(13)).join('');
    const NEWLINE = String.fromCharCode(10);

    function readMember(entry, marker, terminator) {
        const at = entry.indexOf(marker);
        if (at === -1) {
            return null;
        }
        const from = at + marker.length;
        const to = entry.indexOf(terminator, from);
        return to === -1 ? null : entry.slice(from, to).trim();
    }

    for (const definition of definitions) {
        const start = source.indexOf(definition.key + ': {');
        assert.ok(start !== -1, definition.key + ' must have an entry in BOOLEAN_FEATURE_ACCESSORS');
        const entryEnd = source.indexOf(NEWLINE + '        },', start);
        // Include the terminating newline so the last member has one too.
        const entry = source.slice(start, entryEnd === -1 ? source.length : entryEnd + 1);

        const checkboxClass = readMember(entry, 'checkboxClass: ' + String.fromCharCode(39), String.fromCharCode(39));
        const applyName = readMember(entry, 'apply: ', NEWLINE);
        assert.ok(checkboxClass, definition.key + ' must carry a checkboxClass');
        assert.ok(applyName, definition.key + ' must carry an apply');

        // Not just "appears in the file" -- the entry it was read from would
        // satisfy that on its own. The class has to be used somewhere else too:
        // the container lookup and the control builder both name it, so a
        // mistyped checkboxClass (a dead checkbox and an endless settings-ensure
        // retry) leaves it appearing exactly once.
        const quoted = String.fromCharCode(39) + checkboxClass + String.fromCharCode(39);
        const dotted = String.fromCharCode(39) + '.' + checkboxClass + String.fromCharCode(39);
        assert.ok(
            source.split(quoted).length - 1 >= 2,
            checkboxClass + ' must be used by the control builder, not only declared in the table'
        );
        assert.ok(
            source.indexOf(dotted) !== -1,
            checkboxClass + ' must be the selector the container lookup uses'
        );
        assert.ok(
            source.indexOf('function ' + applyName + '(') !== -1,
            applyName + ' must be a real setter'
        );
    }

    // One loop, not six near-identical blocks.
    assert.strictEqual(
        source.split('checkbox.getAttribute(' + String.fromCharCode(39) + 'data-webos-init').length - 1,
        1,
        'checkbox wiring must happen in exactly one place (the sliders keep their own)'
    );
}
