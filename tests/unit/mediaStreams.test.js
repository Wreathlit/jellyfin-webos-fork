const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
const mediaStreamsPath = path.join(root, 'frontend', 'js', 'injected', 'core', 'mediaStreams.js');

function loadMediaStreams() {
    const window = {};
    const context = { window: window };

    vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, { filename: runtimePath });
    vm.runInNewContext(fs.readFileSync(mediaStreamsPath, 'utf8'), context, { filename: mediaStreamsPath });

    return window.__JellyfinWebOSPatchRuntime.get('core.mediaStreams');
}

const streams = loadMediaStreams();
assert(streams, 'core.mediaStreams should register');

// Jellyfin serialises Type as a PascalCase string, but the API has also emitted
// camelCase and the raw enum, so all three spellings have to classify alike.
{
    assert.strictEqual(streams.isVideoMediaStream({ Type: 'Video' }), true);
    assert.strictEqual(streams.isVideoMediaStream({ type: 'video' }), true);
    assert.strictEqual(streams.isVideoMediaStream({ Type: 1 }), true);
    assert.strictEqual(streams.isVideoMediaStream({ Type: '1' }), true);

    assert.strictEqual(streams.isSubtitleMediaStream({ Type: 'Subtitle' }), true);
    assert.strictEqual(streams.isSubtitleMediaStream({ Type: 2 }), true);

    assert.strictEqual(streams.isAudioMediaStream({ Type: 'Audio' }), true);
    assert.strictEqual(streams.isAudioMediaStream({ Type: 0 }), true);
}

// Kinds must not bleed into one another.
{
    assert.strictEqual(streams.isVideoMediaStream({ Type: 'Audio' }), false);
    assert.strictEqual(streams.isSubtitleMediaStream({ Type: 'Video' }), false);
    assert.strictEqual(streams.isAudioMediaStream({ Type: 'Subtitle' }), false);
    assert.strictEqual(streams.isVideoMediaStream({ Type: 'EmbeddedImage' }), false);
}

// The resolved semantics, and the reason this module exists: a stream that does
// not state its kind is unknown, never assumed to be the kind being asked
// about. hdrDecisions used to answer "video" here while webOS.js answered "not
// video" for the same payload -- so the HDR verdict and the diagnostics beside
// it could classify one stream two ways. Reading a typeless stream as video
// also let an audio track's title feed the HDR text scan.
{
    const untyped = [
        {},
        { Type: null },
        { Type: undefined },
        { Type: '' },
        { Codec: 'ac3', Title: 'HDR commentary' }
    ];

    for (const stream of untyped) {
        const label = JSON.stringify(stream);
        assert.strictEqual(streams.isVideoMediaStream(stream), false, label + ' must not be read as video');
        assert.strictEqual(streams.isSubtitleMediaStream(stream), false, label + ' must not be read as subtitle');
        assert.strictEqual(streams.isAudioMediaStream(stream), false, label + ' must not be read as audio');
        assert.strictEqual(streams.hasDeclaredStreamType(stream), false, label + ' declares no type');
    }

    // "Did not say" is distinguishable from "said no", which is what lets a
    // caller layer a codec fallback on top without changing the shared answer.
    assert.strictEqual(streams.hasDeclaredStreamType({ Type: 'Audio' }), true);
}

// Non-objects and junk must be rejected rather than throwing.
{
    const junk = [null, undefined, 'Video', 42, [], true];
    for (const value of junk) {
        assert.strictEqual(streams.isVideoMediaStream(value), false, String(value) + ' is not a stream');
        assert.strictEqual(streams.hasDeclaredStreamType(value), false, String(value) + ' declares no type');
    }
}

// The bundle must not carry two answers to this question again: assert the
// modules that used to own a copy now agree with the shared one.
{
    const hdrDecisionsPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'hdrDecisions.js');
    const playbackInfoPatchesPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'playbackInfoPatches.js');

    const window = {};
    const context = { window: window };
    for (const modulePath of [runtimePath, mediaStreamsPath, hdrDecisionsPath, playbackInfoPatchesPath]) {
        vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
    }

    const hdr = window.__JellyfinWebOSPatchRuntime.get('playback.hdrDecisions');

    // Drive it through the public API rather than an internal predicate: a
    // typeless stream carrying HDR-looking text must no longer be picked as
    // the video stream, which is what the old "missing Type means video"
    // reading allowed.
    assert.strictEqual(
        hdr.getDynamicRangeHintFromMediaSource({
            Id: 'src',
            MediaStreams: [{ Codec: 'ac3', Title: 'HDR commentary track' }]
        }),
        'unknown',
        'an untyped stream must not be treated as the video stream'
    );

    assert.strictEqual(
        hdr.getDynamicRangeHintFromMediaSource({
            Id: 'src',
            MediaStreams: [
                { Type: 'Audio', Codec: 'ac3', Title: 'HDR commentary track' },
                { Type: 'Video', VideoRangeType: 'SDR' }
            ]
        }),
        'sdr',
        'the audio track must not decide the range when a video stream is present'
    );
}
