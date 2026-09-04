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

// HDR fields identify the source, not the encoded output. Without positive
// direct/video-copy evidence, enabling the dim class could dim an SDR tone-map.
test('source HDR without video-delivery evidence does not dim', async () => {
    const runtime = loadInjectedRuntime({
        localStorage: { webos_hdr_ui_dim_brightness: '0.18' }
    });

    assert.strictEqual(
        runtime.document.documentElement.style.getPropertyValue('--webos-hdr-ui-brightness'),
        '0.18',
        'the persisted brightness must reach the CSS variable'
    );

    runtime.nativeShell.updateMediaSession({ itemId: 'item-hdr-unknown-delivery', VideoRangeType: 'HDR10' });
    await runtime.settle(50);

    assert.strictEqual(
        runtime.isHdrDimmed(),
        false,
        'source HDR alone must not override unknown video delivery'
    );
});

// PlaybackInfo cannot say whether request-time TryStreamCopy actually
// succeeded. The running session can: IsVideoDirect=true means only the
// container/audio path changed, even though PlayMethod remains Transcode.
test('a running HDR audio-only transcode resolves to directstream and applies the saved UI brightness', async () => {
    const runtime = loadInjectedRuntime({
        localStorage: {
            webos_hdr_ui_dim_brightness: '0.18'
        }
    });
    runtime.respondToFetch((request) => request.url.indexOf('/Sessions') !== -1 ? [{
        DeviceId: 'test-device',
        NowPlayingItem: { Id: 'item-hdr-audio-transcode' },
        PlayState: {
            MediaSourceId: 'src-hdr-audio-transcode',
            PlayMethod: 'Transcode'
        },
        TranscodingInfo: { IsVideoDirect: true }
    }] : ({
        MediaSourceId: 'src-hdr-audio-transcode',
        MediaSources: [{
            Id: 'src-hdr-audio-transcode',
            PlayMethod: 'Transcode',
            TranscodingUrl: '/videos/item-hdr-audio-transcode/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac&VideoBitrate=120000000&MaxFramerate=60&MaxWidth=3840&MaxHeight=2160&hevc-level=153&hevc-videobitdepth=10&hevc-profile=main,main10&hevc-rangetype=HDR10&TranscodeReasons=DirectPlayError',
            VideoRangeType: 'HDR10',
            MediaStreams: [{
                Type: 'Video',
                Codec: 'hevc',
                Profile: 'Main 10',
                Level: 153,
                BitDepth: 10,
                BitRate: 24000000,
                Width: 3840,
                Height: 2160,
                ReferenceFrameRate: 23.976,
                VideoRangeType: 'HDR10'
            }]
        }]
    }));

    await runtime.window.fetch(
        playbackInfoUrl('item-hdr-audio-transcode', 'src-hdr-audio-transcode'),
        { headers: { Authorization: 'MediaBrowser test-token' } }
    );
    await runtime.settle(10);
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(1200);
    await runtime.settle(300);

    assert.strictEqual(runtime.isHdrDimmed(), true, 'direct-streamed HDR video must enable UI dimming');
    assert.strictEqual(
        runtime.document.documentElement.style.getPropertyValue('--webos-hdr-ui-brightness'),
        '0.18',
        'the persisted brightness must remain the active CSS value'
    );
    assert.ok(
        runtime.state.fetchCalls.some((call) => call.url === 'https://server.example/Sessions?DeviceId=test-device'),
        'the playback probe must query only this device session'
    );
    const sessionCall = runtime.state.fetchCalls.find((call) => call.url.indexOf('/Sessions?') !== -1);
    assert.strictEqual(
        sessionCall.init.headers.Authorization,
        'MediaBrowser test-token',
        'the session probe must reuse the authenticated PlaybackInfo request headers'
    );
});

// Jellyfin Web re-issues PlaybackInfo for every changeStream -- a seek on a
// transcoded stream, an audio or subtitle track pick. The response is still a
// request-time prediction, and it used to be applied unconditionally, so it
// overwrote the verdict the running session had already reported and the HDR
// dimming dropped until the next probe answered.
test('a later PlaybackInfo prediction does not overwrite the running session verdict', async () => {
    const runtime = loadInjectedRuntime();
    const mediaSource = {
        Id: 'src-hdr-audio-transcode',
        PlayMethod: 'Transcode',
        TranscodingUrl: '/videos/item-hdr-audio-transcode/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac&VideoBitrate=120000000&MaxFramerate=60&MaxWidth=3840&MaxHeight=2160&hevc-level=153&hevc-videobitdepth=10&hevc-profile=main,main10&hevc-rangetype=HDR10&TranscodeReasons=DirectPlayError',
        VideoRangeType: 'HDR10',
        MediaStreams: [{
            Type: 'Video',
            Codec: 'hevc',
            Profile: 'Main 10',
            Level: 153,
            BitDepth: 10,
            BitRate: 24000000,
            Width: 3840,
            Height: 2160,
            ReferenceFrameRate: 23.976,
            VideoRangeType: 'HDR10'
        }]
    };
    runtime.respondToFetch((request) => request.url.indexOf('/Sessions') !== -1 ? [{
        DeviceId: 'test-device',
        NowPlayingItem: { Id: 'item-hdr-audio-transcode' },
        PlayState: { MediaSourceId: 'src-hdr-audio-transcode', PlayMethod: 'Transcode' },
        TranscodingInfo: { IsVideoDirect: true }
    }] : ({
        MediaSourceId: 'src-hdr-audio-transcode',
        MediaSources: [mediaSource]
    }));

    await runtime.window.fetch(playbackInfoUrl('item-hdr-audio-transcode', 'src-hdr-audio-transcode'));
    await runtime.settle(10);
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(1200);
    assert.strictEqual(runtime.isHdrDimmed(), true, 'the session verdict must enable dimming');

    // The seek: same item, same media source, one more PlaybackInfo.
    await runtime.window.fetch(playbackInfoUrl('item-hdr-audio-transcode', 'src-hdr-audio-transcode'));
    await runtime.settle(10);
    assert.strictEqual(
        runtime.isHdrDimmed(),
        true,
        'a request-time prediction must not undo what the running session reported'
    );

    // And it must not come back only after the next probe round either.
    await runtime.settle(300);
    assert.strictEqual(runtime.isHdrDimmed(), true, 'the verdict must never have flickered');
});

test('a same-codec HDR candidate resolves to transcode when IsVideoDirect is false', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch((request) => request.url.indexOf('/Sessions') !== -1 ? [{
        DeviceId: 'test-device',
        NowPlayingItem: { Id: 'item-hdr-real-transcode' },
        PlayState: {
            MediaSourceId: 'src-hdr-real-transcode',
            PlayMethod: 'Transcode'
        },
        TranscodingInfo: { IsVideoDirect: false }
    }] : ({
        MediaSourceId: 'src-hdr-real-transcode',
        MediaSources: [{
            Id: 'src-hdr-real-transcode',
            PlayMethod: 'Transcode',
            // This is deliberately indistinguishable from a potential copy in
            // PlaybackInfo: source and target codec both say HEVC.
            TranscodingUrl: '/videos/item-hdr-real-transcode/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac&VideoBitrate=120000000&MaxWidth=3840&MaxHeight=2160',
            VideoRangeType: 'HDR10',
            MediaStreams: [{
                Type: 'Video',
                Codec: 'hevc',
                Width: 3840,
                Height: 2160,
                VideoRangeType: 'HDR10'
            }]
        }]
    }));

    await runtime.window.fetch(playbackInfoUrl('item-hdr-real-transcode', 'src-hdr-real-transcode'));
    await runtime.settle(10);
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(1200);
    await runtime.settle(300);

    assert.strictEqual(runtime.isHdrDimmed(), false, 'video encoding must keep HDR UI dimming off');
    assert.ok(
        runtime.state.fetchCalls.some((call) => call.url === 'https://server.example/Sessions?DeviceId=test-device'),
        'the authoritative session lookup must run even when PlaybackInfo already looks like a transcode'
    );
});

test('an explicit direct-play response does not start Sessions polling', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [HDR_MEDIA_SOURCE] }));

    await runtime.window.fetch(playbackInfoUrl('item-hdr-direct', 'src-hdr'));
    await runtime.settle(10);
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(7000);

    assert.strictEqual(runtime.isHdrDimmed(), true, 'explicit HDR direct play must still dim immediately');
    assert.strictEqual(
        runtime.state.fetchCalls.some((call) => call.url.indexOf('/Sessions') !== -1),
        false,
        'only ambiguous HLS playback needs a runtime session verdict'
    );
});

test('an explicit HDR video transcode does not dim the UI', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({
        MediaSourceId: 'src-hdr-transcode',
        MediaSources: [{
            Id: 'src-hdr-transcode',
            PlayMethod: 'Transcode',
            TranscodingUrl: '/videos/item-hdr-transcode/master.m3u8?VideoCodec=h264',
            VideoRangeType: 'HDR10',
            MediaStreams: [{ Type: 'Video', Codec: 'hevc', VideoRangeType: 'HDR10' }]
        }]
    }));

    await runtime.window.fetch(playbackInfoUrl('item-hdr-transcode', 'src-hdr-transcode'));
    await runtime.settle(10);
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(50);

    assert.strictEqual(runtime.isHdrDimmed(), false, 'a video-transcode verdict must keep HDR UI dimming off');
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

// The escape hatch is one-shot: accepting the authoritative SDR clears the
// correction window, and the window was the only thing keeping the OSD-text
// guess accountable. The delayed fallback then re-read the same unchanged title
// at 3s and re-applied HDR with nothing left to contradict it -- permanently,
// because a held HDR verdict switches the OSD observer off and Jellyfin Web
// 10.11 never calls updateMediaSession again for local video playback.
// Pre-fix this leaves the session dimmed from 3s onward.
test('a corrected UI-text HDR does not come back with the delayed fallback', async () => {
    const runtime = loadInjectedRuntime();
    // The item title, flattened into the same OSD string as the media info.
    addOsdText(runtime, 'Ultra HDR Showreel');
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));

    await runtime.settle(600);
    assert.strictEqual(runtime.isHdrDimmed(), true, 'the OSD text should have driven HDR dimming');

    // The authoritative answer arrives before the fallback, which is the order
    // a real playback produces.
    runtime.nativeShell.updateMediaSession({ itemId: 'item-1', VideoRangeType: 'SDR' });
    await runtime.settle(50);
    assert.strictEqual(runtime.isHdrDimmed(), false, 'the authoritative SDR must undim');

    // Past the 3s playback-start fallback, which re-reads the same OSD text.
    await runtime.settle(3000);
    assert.strictEqual(
        runtime.isHdrDimmed(),
        false,
        'the fallback must not re-apply an OSD-text HDR that was already overruled'
    );

    // And the scheduled scanner must not bring it back either.
    await runtime.settle(6000);
    assert.strictEqual(runtime.isHdrDimmed(), false, 'the overruled UI text must stay overruled');
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

// The suite only ever asserted that the force *stops* after a quality pick.
// If arming it regressed to a no-op, every one of those assertions still
// passed while the fork's headline feature -- high-bitrate startup on a local
// network -- silently did nothing.
test('the playback-start window forces the max bitrate onto PlaybackInfo', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));

    assert.ok(
        lastFetchUrl(runtime).indexOf('MaxStreamingBitrate=120000000') !== -1,
        'the startup window must raise MaxStreamingBitrate, got ' + lastFetchUrl(runtime)
    );
});

test('the forced bitrate is applied to a POST body as well as the URL', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    // jellyfin-web POSTs PlaybackInfo with the device profile in the body.
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            MaxStreamingBitrate: 3000000,
            DeviceProfile: { DirectPlayProfiles: [], SubtitleProfiles: [] }
        })
    });

    const call = runtime.state.fetchCalls[runtime.state.fetchCalls.length - 1];
    const sent = JSON.parse(call.body);
    assert.strictEqual(
        sent.MaxStreamingBitrate,
        120000000,
        'the body bitrate must be raised alongside the query parameter'
    );
    assert.ok(
        sent.DeviceProfile && sent.DeviceProfile.SubtitleProfiles.length > 0,
        'the device profile in the body must still receive the compatibility patches'
    );
});

// Every case in this suite drove playback *into* a state; none drove it out.
// The exit path is where the most visible regression lives: if the dim class is
// not removed, the whole UI stays darkened after playback ends and the only fix
// is restarting the app.
test('leaving playback removes the HDR dim', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [HDR_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-hdr'));
    await runtime.settle(600);
    assert.strictEqual(runtime.isHdrDimmed(), true, 'HDR direct play should dim');

    runtime.nativeShell.disableFullscreen();
    // EXITING settles to IDLE on its own after the exit timeout.
    await runtime.settle(3000);

    assert.strictEqual(runtime.isHdrDimmed(), false, 'the dim must be removed when playback ends');
});

test('hideMediaSession also clears the dim', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [HDR_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-hdr'));
    await runtime.settle(600);
    assert.strictEqual(runtime.isHdrDimmed(), true);

    runtime.nativeShell.hideMediaSession();
    await runtime.settle(50);

    assert.strictEqual(runtime.isHdrDimmed(), false, 'stopping the session must undim immediately');
});

// Going idle bumps the playback epoch so results still in flight from the
// previous session cannot land on the next one.
test('a session probe answering after playback ended does not re-dim', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));
    await runtime.settle(100);

    runtime.nativeShell.hideMediaSession();
    await runtime.settle(50);
    assert.strictEqual(runtime.isHdrDimmed(), false);

    // A late HDR verdict for the finished item must be ignored.
    runtime.respondToFetch(() => ({ MediaSources: [HDR_MEDIA_SOURCE] }));
    await runtime.settle(5000);

    assert.strictEqual(
        runtime.isHdrDimmed(),
        false,
        'a stale probe result must not dim a session that already ended'
    );
});

// The fetch wrapper's final call used to read a variable declared inside the
// PlaybackInfo branch, so every unrelated request was handed an undefined
// context. It only worked because the callee re-checked the URL. Pin the
// passthrough so a future edit there cannot start depending on that context.
test('an unrelated fetch passes through the wrapper unchanged', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ ServerName: 'Test' }));

    const response = await runtime.window.fetch('https://server.example/System/Info/Public');
    const body = await response.json();

    assert.strictEqual(body.ServerName, 'Test', 'the response must reach the caller intact');

    const call = runtime.state.fetchCalls[runtime.state.fetchCalls.length - 1];
    assert.strictEqual(
        call.url,
        'https://server.example/System/Info/Public',
        'a non-PlaybackInfo URL must not be rewritten'
    );
});

test('a POST to an unrelated endpoint keeps its body and init', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ ok: true }));

    await runtime.window.fetch('https://server.example/Sessions/Playing/Progress', {
        method: 'POST',
        headers: { 'X-Emby-Token': 'secret' },
        body: JSON.stringify({ PositionTicks: 42 })
    });

    const call = runtime.state.fetchCalls[runtime.state.fetchCalls.length - 1];
    assert.strictEqual(call.method, 'POST');
    assert.strictEqual(
        JSON.parse(call.body).PositionTicks,
        42,
        'an unrelated request body must not be rewritten'
    );
    assert.strictEqual(
        call.init.headers['X-Emby-Token'],
        'secret',
        'init must be forwarded as given'
    );
});

// The bitrate window used to double as the "playback is starting" signal the
// subtitle script interceptor reads. The two now come apart, and this is where
// that is observable: PlaybackInfo arrives before the state machine reaches
// PLAYING, so an unrecognised script inserted in that gap is a startup script,
// and it must get the full inspection budget rather than the 750ms speculative
// one -- whether or not the bitrate force is still running.
test('a startup script keeps the full inspection budget after a quality pick', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [PLAIN_MEDIA_SOURCE] }));

    // A quality pick is what ends the bitrate force, so drive the real menu.
    const sheet = buildQualityActionSheet(runtime, ['Auto', '3 Mbps', '2 Mbps']);
    announceAddedNode(runtime, sheet.dialog);
    await runtime.settle(400);

    // PlaybackInfo for a new item arms playback-start while still IDLE.
    await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));
    await runtime.settle(0);

    // Ending the bitrate force must not shorten the script budget with it.
    sheet.scroller.children[1].dispatchEvent({ type: 'click' });
    await runtime.settle(0);

    const script = runtime.createElement('script');
    // No renderer keyword: this reaches the interceptor only via the
    // playback-start signal, which is exactly the coupling under test.
    script.src = 'https://server.example/web/chunk.4f2a.js';
    runtime.document.head.appendChild(script);

    const inspection = runtime.state.xhrRequests[runtime.state.xhrRequests.length - 1];
    assert.ok(inspection, 'the startup script must still be inspected');
    assert.strictEqual(inspection.url, 'https://server.example/web/chunk.4f2a.js');

    // The speculative budget is 750ms; the startup budget is 8s. If the two
    // signals were still one variable, the quality pick would have demoted this
    // to speculative and the inspection would already be dead here.
    runtime.clock.tick(1000);
    assert.strictEqual(
        inspection.aborted,
        false,
        'a startup script must keep the full budget after the bitrate force ends'
    );

    runtime.clock.tick(8000);
    assert.strictEqual(inspection.aborted, true, 'the full budget still expires');
});

// The ASS interception patches Worker.prototype.postMessage, and webOS.js
// returns immediately when window.Worker is absent. The harness had no Worker,
// so this whole path -- worker identification, the backward-time clamp, the
// destroy/terminate cleanup -- never executed in any test; assTimeSync.test.js
// covered the pure function while hand-copying the wiring around it.
function createAssWorker(runtime) {
    const worker = new runtime.window.Worker('https://server.example/libass.js');
    // libass-wasm announces itself with a worker-init carrying its render mode
    // and subtitle source; that shape is what marks the worker for clamping.
    worker.postMessage({
        target: 'worker-init',
        renderMode: 'wasm-blend',
        subUrl: 'https://server.example/Videos/item-1/Subtitles/2/Stream.ass',
        targetFps: 24
    });
    return worker;
}

test('a backwards ASS time sample is clamped before it reaches the worker', async () => {
    const runtime = loadInjectedRuntime();
    const worker = createAssWorker(runtime);

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    worker.postMessage({ target: 'video', currentTime: 10, isPaused: false });
    await runtime.settle(100);
    worker.postMessage({ target: 'video', currentTime: 10, isPaused: false });

    const videoMessages = worker.posted.filter(function (message) {
        return message && message.target === 'video';
    });
    assert.strictEqual(videoMessages.length, 2, 'both time samples must reach the worker');
    assert.ok(
        videoMessages[1].currentTime > 10,
        'a stalled clock must be advanced rather than replayed, got ' + videoMessages[1].currentTime
    );
});

test('a real backward seek passes through to the worker untouched', async () => {
    const runtime = loadInjectedRuntime();
    const worker = createAssWorker(runtime);

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    worker.postMessage({ target: 'video', currentTime: 30, isPaused: false });
    await runtime.settle(100);
    // Well past the seek threshold: this is a seek, not reporting jitter.
    worker.postMessage({ target: 'video', currentTime: 20, isPaused: false });

    const videoMessages = worker.posted.filter(function (message) {
        return message && message.target === 'video';
    });
    assert.strictEqual(
        videoMessages[1].currentTime,
        20,
        'a large backward seek must not be clamped'
    );
});

test('terminating an ASS worker drops its tracked time state', async () => {
    const runtime = loadInjectedRuntime();
    const worker = createAssWorker(runtime);

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);
    worker.postMessage({ target: 'video', currentTime: 10, isPaused: false });

    worker.terminate();
    assert.strictEqual(worker.terminated, true, 'terminate must still reach the real worker');

    // A worker reused after terminate must not inherit the old anchor: the
    // next sample is authoritative, so it passes through unchanged.
    await runtime.settle(100);
    worker.postMessage({ target: 'video', currentTime: 10, isPaused: false });

    const videoMessages = worker.posted.filter(function (message) {
        return message && message.target === 'video';
    });
    assert.strictEqual(
        videoMessages[videoMessages.length - 1].currentTime,
        10,
        'state must be cleared on terminate, so the next sample is taken as-is'
    );
});

// The fetch stub used to resolve 200 + JSON unconditionally, so none of the
// runtime's failure handling was reachable from a test.
test('a PlaybackInfo response that is not JSON is passed through untouched', async () => {
    const runtime = loadInjectedRuntime();

    runtime.respondToFetch(() => ({ status: 200, bodyText: '<html>not json</html>', contentType: 'text/html' }));
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    const response = await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));
    await runtime.settle(50);

    assert.strictEqual(response.status, 200, 'the original response must still reach the caller');
    assert.strictEqual(
        await response.text(),
        '<html>not json</html>',
        'an unparseable body must not be swallowed or rewritten'
    );
});

test('a failed PlaybackInfo request rejects to the caller rather than hanging', async () => {
    const runtime = loadInjectedRuntime();

    runtime.respondToFetch(() => ({ reject: 'Failed to fetch' }));
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    let rejected = null;
    try {
        await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));
    } catch (error) {
        rejected = error;
    }
    await runtime.settle(50);

    assert.ok(rejected, 'a network failure must propagate to the caller');
});

test('a non-2xx PlaybackInfo response is left alone', async () => {
    const runtime = loadInjectedRuntime();

    runtime.respondToFetch(() => ({ status: 500, body: { error: 'boom' } }));
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    const response = await runtime.window.fetch(playbackInfoUrl('item-1', 'src-plain'));
    await runtime.settle(50);

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.ok, false, 'the error status must survive the interception');
});

// "Left alone" has to mean the state machine, not just the Response object. An
// error body parses as JSON perfectly well, and the fetch path used to hand it
// to applyDynamicRangeFromPlaybackInfo as if it described the playback. The XHR
// twin has always stopped at the status.
test('a failed PlaybackInfo request does not drive HDR detection', async () => {
    const runtime = loadInjectedRuntime();

    runtime.respondToFetch(() => ({
        status: 500,
        body: { MediaSources: [HDR_MEDIA_SOURCE] }
    }));
    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    const response = await runtime.window.fetch(playbackInfoUrl('item-1', 'src-hdr'));
    await runtime.settle(50);

    assert.strictEqual(response.status, 500);
    assert.strictEqual(
        runtime.isHdrDimmed(),
        false,
        'a 5xx body must not be read as the playback description'
    );
});

// The XHR wrapper stringifies whatever open() is given; the fetch wrapper only
// recognised a string or a Request. A URL object is a valid fetch input and
// carries .href, not .url, so it resolved to '' and slipped past every
// interceptor -- no bitrate forcing, no burned-in subtitle patch, no HDR
// detection.
test('a URL object reaches the PlaybackInfo interceptors', async () => {
    const runtime = loadInjectedRuntime();
    runtime.respondToFetch(() => ({ MediaSources: [HDR_MEDIA_SOURCE] }));

    runtime.nativeShell.enableFullscreen();
    await runtime.settle(0);

    await runtime.window.fetch(new runtime.window.URL(playbackInfoUrl('item-1', 'src-hdr')));
    await runtime.settle(50);

    assert.strictEqual(
        runtime.isHdrDimmed(),
        true,
        'the response to a URL-object request must still drive HDR detection'
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
