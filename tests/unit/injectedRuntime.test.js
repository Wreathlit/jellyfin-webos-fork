const assert = require('assert');
const { loadInjectedRuntime } = require('../helpers/injectedRuntime');

// End-to-end tests for frontend/js/webOS.js. The bundle exports nothing but
// window.NativeShell, so every case here drives it the way Jellyfin Web does —
// NativeShell calls, the patched fetch, DOM events — and asserts on what the TV
// would actually show or send.
//
// Each case was confirmed to fail against the bundle as it stood before the fix
// it covers; see the notes on individual cases.

const HDR_MEDIA_SOURCE = {
    Id: 'src-hdr',
    SupportsDirectPlay: true,
    VideoRangeType: 'HDR10',
    MediaStreams: [{ Type: 'Video', Codec: 'hevc', VideoRangeType: 'HDR10' }]
};

const PLAIN_MEDIA_SOURCE = {
    Id: 'src-plain',
    SupportsDirectPlay: true,
    MediaStreams: [{ Type: 'Video', Codec: 'h264' }]
};

function playbackInfoUrl(itemId, mediaSourceId) {
    return 'https://server.example/Items/' + itemId + '/PlaybackInfo?UserId=u1&MediaSourceId=' + mediaSourceId;
}

function addOsdText(runtime, text) {
    const osd = runtime.createElement('div', { className: 'osdMediaInfo', text: text });
    runtime.document.body.appendChild(osd);
    return osd;
}

function buildQualityActionSheet(runtime, labels) {
    const dialog = runtime.createElement('div', { className: 'actionSheet' });
    const scroller = runtime.createElement('div', { className: 'actionSheetScroller' });
    dialog.appendChild(scroller);

    for (const label of labels) {
        const item = runtime.createElement('button', { className: 'actionSheetMenuItem' });
        item.appendChild(runtime.createElement('div', { className: 'actionSheetItemText', text: label }));
        scroller.appendChild(item);
    }

    runtime.document.body.appendChild(dialog);
    return { dialog: dialog, scroller: scroller };
}

// The bundle patches the quality menu from a MutationObserver. The harness
// never invents mutations, so deliver the one the DOM change would have caused.
function announceAddedNode(runtime, node) {
    const mutation = {
        type: 'childList',
        target: runtime.document.body,
        addedNodes: [node],
        removedNodes: []
    };

    for (const observer of runtime.state.observers) {
        if (!observer.disconnected) {
            observer.trigger([mutation]);
        }
    }
}

function lastFetchUrl(runtime) {
    const calls = runtime.state.fetchCalls;
    return calls.length ? calls[calls.length - 1].url : '';
}

const cases = [];
function test(name, fn) {
    cases.push({ name: name, fn: fn });
}

test('the bundle initializes every startup step cleanly', async () => {
    const runtime = loadInjectedRuntime();

    assert.strictEqual(typeof runtime.window.NativeShell, 'object', 'NativeShell must be published');
    assert.deepStrictEqual(runtime.state.warnings, [], 'no init step may fail during startup');
    assert.strictEqual(runtime.nativeShell.AppHost.getDefaultLayout(), 'tv');
});

// Regression: the delayed fallback recorded its OSD-text HDR guess under
// 'playback-start-fallback-playback-ui', which never matched the 'playback-ui'
// literal the escape hatch compared against, so an authoritative SDR could
// never correct a wrong UI-text HDR. Pre-fix this leaves the session dimmed.
test('an authoritative SDR corrects an HDR guessed from playback UI text', async () => {
    const runtime = loadInjectedRuntime();
    addOsdText(runtime, '4K HDR10 HEVC');
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));

    await runtime.settle(600);
    assert.strictEqual(runtime.isHdrDimmed(), true, 'the OSD text should have driven HDR dimming');

    // Past the 3s playback-start fallback, which re-reads the same OSD text.
    await runtime.settle(3000);
    assert.strictEqual(runtime.isHdrDimmed(), true, 'the fallback should keep the UI-derived verdict');

    runtime.nativeShell.updateMediaSession({ itemId: 'item-1', VideoRangeType: 'SDR' });
    await runtime.settle(50);

    assert.strictEqual(
        runtime.isHdrDimmed(),
        false,
        'an authoritative SDR must undim a session that was only guessed HDR from UI text'
    );
});

// The other half of the same mechanism: an HDR established by an authoritative
// source must still latch, so a contradicting SDR is ignored inside the window.
test('an authoritative HDR still latches against a later SDR', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [HDR_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-2', 'src-hdr'));
    await runtime.settle(50);

    assert.strictEqual(runtime.isHdrDimmed(), true, 'PlaybackInfo HDR should dim');

    runtime.nativeShell.updateMediaSession({ itemId: 'item-2', VideoRangeType: 'SDR' });
    await runtime.settle(50);

    assert.strictEqual(
        runtime.isHdrDimmed(),
        true,
        'an HDR verdict from PlaybackInfo must not be weakened by a later SDR inside the correction window'
    );
});

// Regression: the pending-hint lookup scanned the cache by item id and always
// preferred 'hdr', so a hint cached for another version of the same item dimmed
// an SDR playback. Pre-fix this dims; the correct answer is "we do not know",
// which leaves the UI scan and metadata fallbacks armed.
test('a hint cached for another media source does not dim the version being played', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch((request) => (request.url.indexOf('src-hdr') !== -1
        ? { MediaSources: [HDR_MEDIA_SOURCE] }
        : { MediaSources: [PLAIN_MEDIA_SOURCE] }));

    // Jellyfin Web probes the default version first, then the chosen one. Both
    // land while the adapter is still idle, so both are cached under the same
    // item id but different media source ids.
    await runtime.window.fetch(playbackInfoUrl('item-3', 'src-hdr'));
    await runtime.settle(10);
    await runtime.window.fetch(playbackInfoUrl('item-3', 'src-plain'));
    await runtime.settle(10);

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(50);

    assert.strictEqual(
        runtime.isHdrDimmed(),
        false,
        'the HDR hint belongs to a different version and must not be applied to this playback'
    );
});

// Regression: the click hook was installed only on menus containing a
// >=60 Mbps entry, which a 720p source never has, so the pick never reached
// markQualitySelected and the startup force re-raised it. Pre-fix the follow-up
// request is rewritten to 120 Mbps.
test('a quality pick on a sub-60 Mbps menu ends the playback-start bitrate force', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    const sheet = buildQualityActionSheet(runtime, ['Auto', '3 Mbps', '2 Mbps', '1 Mbps']);

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    announceAddedNode(runtime, sheet.dialog);
    await runtime.settle(400);

    assert.strictEqual(
        sheet.dialog.getAttribute('data-webos-quality-click-hooked'),
        'true',
        'a bitrate menu must be hooked even when it has no high-bitrate entry to extend'
    );
    assert.strictEqual(
        sheet.scroller.children.length,
        4,
        'a menu without the legacy cap must not be padded with 120 Mbps entries'
    );

    // Click the label inside the menu item, the way a remote/pointer does.
    const chosen = sheet.scroller.children[2];
    const label = chosen.querySelector('.actionSheetItemText');
    label.dispatchEvent({ type: 'click', target: label });
    await runtime.settle(10);

    await runtime.window.fetch(playbackInfoUrl('item-4', 'src-plain'));
    await runtime.settle(10);

    assert.strictEqual(
        lastFetchUrl(runtime).indexOf('120000000'),
        -1,
        'after an explicit quality pick the fork must stop raising MaxStreamingBitrate'
    );
});

// The extension itself must keep working where it applies.
test('a menu carrying the legacy 60 Mbps cap still gains the high-bitrate options', async () => {
    const runtime = loadInjectedRuntime();
    const sheet = buildQualityActionSheet(runtime, ['Auto', '60 Mbps', '20 Mbps', '10 Mbps']);

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    announceAddedNode(runtime, sheet.dialog);
    await runtime.settle(400);

    assert.ok(
        sheet.scroller.children.length > 4,
        'the legacy-cap menu should still receive the extra high bitrate entries'
    );

    const labels = sheet.scroller.children.map((item) => item.textContent);
    assert.ok(labels.some((label) => label.indexOf('120 Mbps') !== -1), 'expected a 120 Mbps entry');
});

// Regression: the inspection request was left running when it timed out, so the
// original script node re-downloaded the same bytes in parallel.
test('a timed-out script inspection fetch is aborted before the original loads', async () => {
    const runtime = loadInjectedRuntime();

    const script = runtime.createElement('script');
    script.src = 'https://server.example/web/libpgs.js';
    runtime.document.head.appendChild(script);

    assert.strictEqual(runtime.state.xhrRequests.length, 1, 'the renderer script should be inspected first');
    const inspection = runtime.state.xhrRequests[0];
    assert.strictEqual(inspection.url, 'https://server.example/web/libpgs.js');
    assert.strictEqual(inspection.aborted, false, 'the inspection is still in flight before the timeout');

    runtime.clock.tick(9000);

    assert.strictEqual(inspection.aborted, true, 'the timed-out inspection must be aborted, not left running');
    assert.strictEqual(
        runtime.document.head.children.filter((node) => node.tagName === 'script').length,
        1,
        'the original script must still be inserted so the page keeps working'
    );
});

// A readable response must still be patched and injected in place of the
// original, which is the whole point of the interception.
test('an inspected renderer script is patched and swapped for an inline copy', async () => {
    const runtime = loadInjectedRuntime();

    const script = runtime.createElement('script');
    script.src = 'https://server.example/web/libpgs.js';
    runtime.document.head.appendChild(script);

    const inspection = runtime.state.xhrRequests[0];
    inspection.respond(200, 'var createPgsRenderer=function(o){var m;switch(null!==(m=o.mode)&&void 0!==m?m:h.getRendererModeByPlatform()){}};');
    runtime.clock.tick(10);

    const scripts = runtime.document.head.children.filter((node) => node.tagName === 'script');
    const inline = scripts.filter((node) => !node.src);
    assert.strictEqual(inline.length, 1, 'the patched script should be injected inline');
    assert.ok(
        inline[0].text.indexOf('WebOSPgsRendererOptions') !== -1,
        'the inline copy should carry the fork\'s renderer patch'
    );
});

module.exports = async function runInjectedRuntimeTests() {
    for (const testCase of cases) {
        try {
            await testCase.fn();
        } catch (error) {
            // Node reports the stack, so the failing case name has to be
            // spliced into that too or it never reaches the output.
            const label = 'injectedRuntime: ' + testCase.name;
            error.message = label + '\n' + error.message;
            if (typeof error.stack === 'string') {
                error.stack = label + '\n' + error.stack;
            }
            throw error;
        }
    }
};
