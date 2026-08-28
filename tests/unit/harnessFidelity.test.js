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
