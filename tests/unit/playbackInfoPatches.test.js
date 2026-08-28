const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
// Stream classification lives in core.mediaStreams so the whole bundle agrees
// on it; these modules delegate, so the dependency has to be loaded here too.
const mediaStreamsPath = path.join(root, 'frontend', 'js', 'injected', 'core', 'mediaStreams.js');
const hdrDecisionsPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'hdrDecisions.js');
const playbackInfoPatchesPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'playbackInfoPatches.js');

function loadPlaybackInfoPatches() {
    const window = {};
    const context = {
        window: window
    };

    vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
        filename: runtimePath
    });
    vm.runInNewContext(fs.readFileSync(mediaStreamsPath, 'utf8'), context, {
        filename: mediaStreamsPath
    });
    // Injected in this order at runtime; patchBurnedInSubtitleDelivery reuses
    // the hdrDecisions video-delivery classifier.
    vm.runInNewContext(fs.readFileSync(hdrDecisionsPath, 'utf8'), context, {
        filename: hdrDecisionsPath
    });
    vm.runInNewContext(fs.readFileSync(playbackInfoPatchesPath, 'utf8'), context, {
        filename: playbackInfoPatchesPath
    });

    return window.__JellyfinWebOSPatchRuntime.get('playback.playbackInfoPatches');
}

const patches = loadPlaybackInfoPatches();
assert(patches, 'playback.playbackInfoPatches should register');

{
    function storageWith(values) {
        return {
            getItem(key) {
                return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
            }
        };
    }

    assert.strictEqual(patches.hasStoredConcreteVideoQualitySelection(null), false);
    assert.strictEqual(patches.hasStoredConcreteVideoQualitySelection(storageWith({})), false);
    assert.strictEqual(
        patches.hasStoredConcreteVideoQualitySelection(storageWith({
            'enableautobitratebitrate-Video-true': 'true',
            'enableautobitratebitrate-Video-false': 'true'
        })),
        false,
        'Auto in either network context must not count as a concrete bitrate'
    );
    assert.strictEqual(
        patches.hasStoredConcreteVideoQualitySelection(storageWith({
            'enableautobitratebitrate-Video-false': 'false'
        })),
        true,
        'the false key suffix is the external-network context, not the selected mode'
    );
    assert.strictEqual(
        patches.hasStoredConcreteVideoQualitySelection(storageWith({
            'enableautobitratebitrate-Video-true': 'false'
        })),
        true,
        'an in-network concrete bitrate must also be honored'
    );
}

assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInfo'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('/Users/abc/Items'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/Images/Primary?next=/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInformation'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInfoExtra'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInfo/UnrelatedAction'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Users/u/Items?next=/Items/victim/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Users/u#next=/Items/hashVictim/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInfo/'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('Items/abc/PlaybackInfo'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('./Items/abc/PlaybackInfo'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('/base/Items/abc/PlaybackInfo'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('//server.example/base/Items/abc/PlaybackInfo'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('https://server.example/jellyfin/Items/abc/PlaybackInfo?x=1'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('https://Items/id/PlaybackInfo'), false, 'authority text must not be matched as a path');
assert.strictEqual(patches.isPlaybackInfoUrl('http:///Items/id/PlaybackInfo'), false, 'an empty absolute authority must be rejected');
assert.strictEqual(patches.isPlaybackInfoUrl('http:////Items/id/PlaybackInfo'), false, 'extra authority slashes must be rejected');
assert.strictEqual(patches.isPlaybackInfoUrl('http:/Items/id/PlaybackInfo'), false, 'a malformed scheme URL must be rejected');
assert.strictEqual(patches.isPlaybackInfoUrl('http:Items/id/PlaybackInfo'), false, 'an opaque scheme URL must not be treated as a path');
assert.strictEqual(patches.isPlaybackInfoUrl('////Items/id/PlaybackInfo'), false, 'an empty protocol-relative authority must be rejected');
assert.strictEqual(patches.isPlaybackInfoUrl(' https://Items/id/PlaybackInfo'), false, 'leading spaces must not hide an authority');
assert.strictEqual(patches.isPlaybackInfoUrl('\thttps://Items/id/PlaybackInfo'), false, 'leading tabs must not hide an authority');
assert.strictEqual(patches.isPlaybackInfoUrl('h\tttps://Items/id/PlaybackInfo'), false, 'tabs inside a scheme must be preprocessed');
assert.strictEqual(patches.isPlaybackInfoUrl(' https://server.example/base/Items/id/PlaybackInfo \r\n'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/foo\\bar/PlaybackInfo'), false, 'a raw backslash changes the normalized HTTP path');
assert.strictEqual(patches.isPlaybackInfoUrl('https://server.example/Items/foo\\bar/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('https://server.example\\base/Items/foo/PlaybackInfo'), false, 'authority-adjacent backslashes must fail closed');
assert.strictEqual(patches.isPlaybackInfoUrl('//server.example\\base/Items/foo/PlaybackInfo'), false, 'protocol-relative backslashes must fail closed');
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/foo/PlaybackInfo?next=\\other'), true, 'query backslashes must not change endpoint classification');
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/foo/PlaybackInfo#next=\\other'), true, 'fragment backslashes must not change endpoint classification');
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/./PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/../PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/%2e/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/%2e%2e/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/.%2e/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/%2e./PlaybackInfo'), false);
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/.../PlaybackInfo'), '...');
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/foo%5Cbar/PlaybackInfo'), 'foo\\bar');
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/id value/PlaybackInfo'), 'id value');
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/abc%201/PlaybackInfo?x=1'), 'abc 1');
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/abc/Images/Primary'), null);

{
    const result = patches.enforceMaxBitrateUrl(
        ' https://server.example/base/Items/id/PlaybackInfo \r\n',
        120000000
    );
    assert.strictEqual(
        result.url,
        'https://server.example/base/Items/id/PlaybackInfo?MaxStreamingBitrate=120000000&maxStreamingBitrate=120000000'
    );
    assert.strictEqual(result.itemId, 'id');
}

assert.strictEqual(
    patches.getHighestQueryParameterInteger('/Items/id/PlaybackInfo#?MaxStreamingBitrate=999999999', 'MaxStreamingBitrate'),
    0,
    'fragment text must not be read as a query parameter'
);
assert.strictEqual(
    patches.getHighestQueryParameterInteger('/base&MaxStreamingBitrate=999999999/Items/id/PlaybackInfo', 'MaxStreamingBitrate'),
    0,
    'path text must not be read as a query parameter'
);
assert.strictEqual(
    patches.getQueryParameterValue('/Items/id/PlaybackInfo?next=/x?alwaysBurnInSubtitleWhenTranscoding=true', 'alwaysBurnInSubtitleWhenTranscoding'),
    null,
    'a nested question mark inside a query value is not a parameter separator'
);
assert.strictEqual(
    patches.getQueryParameterValue('/Items/id/PlaybackInfo#route?alwaysBurnInSubtitleWhenTranscoding=true', 'alwaysBurnInSubtitleWhenTranscoding'),
    null
);
assert.strictEqual(
    patches.getQueryParameterValue('/Items/id/PlaybackInfo?foo=1&alwaysBurnInSubtitleWhenTranscoding=true#frag', 'alwaysBurnInSubtitleWhenTranscoding'),
    'true'
);

{
    const result = patches.enforceMaxBitrateUrl(
        '/base&MaxStreamingBitrate=999999999/Items/id/PlaybackInfo?foo=1',
        120000000
    );
    assert.strictEqual(result.targetBitrate, 120000000);
    assert.strictEqual(
        result.url,
        '/base&MaxStreamingBitrate=999999999/Items/id/PlaybackInfo?foo=1&MaxStreamingBitrate=120000000&maxStreamingBitrate=120000000',
        'query rewriting must not modify a lookalike parameter in the path'
    );
}

{
    const result = patches.enforceMaxBitrateUrl(
        '/Items/id/PlaybackInfo?next=/x?MaxStreamingBitrate=999999999#frag',
        120000000
    );
    assert.strictEqual(result.targetBitrate, 120000000);
    assert.strictEqual(
        result.url,
        '/Items/id/PlaybackInfo?next=/x?MaxStreamingBitrate=999999999&MaxStreamingBitrate=120000000&maxStreamingBitrate=120000000#frag',
        'a nested query value must remain untouched while real parameters are appended'
    );
}

{
    const result = patches.enforceMaxBitrateUrl(
        '/Items/id/PlaybackInfo#?MaxStreamingBitrate=999999999',
        120000000
    );
    assert.strictEqual(result.targetBitrate, 120000000);
    assert.strictEqual(
        result.url,
        '/Items/id/PlaybackInfo?MaxStreamingBitrate=120000000&maxStreamingBitrate=120000000#?MaxStreamingBitrate=999999999'
    );
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc%201/PlaybackInfo?foo=bar#frag', 120000000);

    assert.strictEqual(result.url, '/Items/abc%201/PlaybackInfo?foo=bar&MaxStreamingBitrate=120000000&maxStreamingBitrate=120000000#frag');
    assert.strictEqual(result.targetBitrate, 120000000);
    assert.strictEqual(result.itemId, 'abc 1');
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?MaxStreamingBitrate=200000000', 120000000);

    assert.strictEqual(result.targetBitrate, 200000000, 'higher server bitrate should not be lowered');
    assert.strictEqual(result.url, '/Items/abc/PlaybackInfo?MaxStreamingBitrate=200000000&maxStreamingBitrate=200000000');
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?maxStreamingBitrate=60000000&foo=1', 120000000);

    assert.strictEqual(result.targetBitrate, 120000000, 'lower camelCase bitrate should be raised');
    assert(result.url.indexOf('maxStreamingBitrate=120000000') !== -1, 'camelCase bitrate should be forced');
    assert(result.url.indexOf('MaxStreamingBitrate=120000000') !== -1, 'PascalCase bitrate should be forced');
    assert.strictEqual(result.url.indexOf('maxStreamingBitrate=60000000'), -1, 'lower camelCase bitrate should not remain');
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?MaxStreamingBitrate=120000000&maxStreamingBitrate=60000000', 95000000);

    assert.strictEqual(result.targetBitrate, 120000000, 'highest existing bitrate should be preserved');
    assert(result.url.indexOf('MaxStreamingBitrate=120000000') !== -1);
    assert(result.url.indexOf('maxStreamingBitrate=120000000') !== -1);
    assert.strictEqual(result.url.indexOf('maxStreamingBitrate=60000000'), -1, 'conflicting lower camelCase bitrate should not remain');
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?MaxStreamingBitrate=60000000&foo=1&MaxStreamingBitrate=80000000', 120000000);

    assert.strictEqual(result.targetBitrate, 120000000);
    assert.strictEqual(result.url.indexOf('MaxStreamingBitrate=60000000'), -1, 'first duplicate lower PascalCase bitrate should not remain');
    assert.strictEqual(result.url.indexOf('MaxStreamingBitrate=80000000'), -1, 'second duplicate lower PascalCase bitrate should not remain');
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?MaxStreamingBitrate=60000000&foo=1&MaxStreamingBitrate=200000000', 120000000);

    assert.strictEqual(result.targetBitrate, 200000000, 'higher later PascalCase duplicate should not be lowered');
    assert.strictEqual(result.url.indexOf('MaxStreamingBitrate=60000000'), -1);
    assert.strictEqual(result.url.indexOf('MaxStreamingBitrate=120000000'), -1);
    assert(result.url.indexOf('MaxStreamingBitrate=200000000') !== -1);
    assert(result.url.indexOf('maxStreamingBitrate=200000000') !== -1);
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?maxStreamingBitrate=60000000&foo=1&maxStreamingBitrate=180000000', 120000000);

    assert.strictEqual(result.targetBitrate, 180000000, 'higher later camelCase duplicate should not be lowered');
    assert.strictEqual(result.url.indexOf('maxStreamingBitrate=60000000'), -1);
    assert.strictEqual(result.url.indexOf('maxStreamingBitrate=120000000'), -1);
    assert(result.url.indexOf('MaxStreamingBitrate=180000000') !== -1);
    assert(result.url.indexOf('maxStreamingBitrate=180000000') !== -1);
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?maxStreamingBitrate=180000000&foo=1', 120000000);

    assert.strictEqual(result.targetBitrate, 180000000, 'higher camelCase bitrate should be preserved');
    assert(result.url.indexOf('maxStreamingBitrate=180000000') !== -1);
    assert(result.url.indexOf('MaxStreamingBitrate=180000000') !== -1);
}

{
    const result = patches.enforceMaxBitrateUrl('/Users/abc/Items', 120000000);

    assert.strictEqual(result.url, '/Users/abc/Items');
    assert.strictEqual(result.targetBitrate, 0);
    assert.strictEqual(result.itemId, null);
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?maxStreamingBitrate=20000000&foo=1', 0);

    assert.strictEqual(result.targetBitrate, 20000000, 'a user-selected bitrate should be preserved when no startup minimum is active');
    assert(result.url.indexOf('MaxStreamingBitrate=20000000') !== -1);
    assert(result.url.indexOf('maxStreamingBitrate=20000000') !== -1);
}

{
    const url = '/Items/abc/PlaybackInfo?foo=1';
    const result = patches.enforceMaxBitrateUrl(url, 0);

    assert.strictEqual(result.url, url, 'a missing bitrate should not be rewritten as zero');
    assert.strictEqual(result.targetBitrate, 0);
    assert.strictEqual(result.itemId, 'abc');
}

assert.strictEqual(patches.enforceMaxBitrateBody('not json', 120000000, {}), 'not json');
assert.strictEqual(patches.enforceMaxBitrateBody('[{"MaxStreamingBitrate":1}]', 120000000, {}), '[{"MaxStreamingBitrate":1}]');

{
    const body = '{"MaxStreamingBitrate":20000000,"DeviceProfile":{"DirectPlayProfiles":[]}}';
    const patched = patches.enforceMaxBitrateBody(body, 0, {
        patchProfile: function (profile) {
            profile.TranscodingProfiles = [{ Type: 'Video' }];
        }
    });
    const parsed = JSON.parse(patched);

    assert.strictEqual(parsed.MaxStreamingBitrate, 20000000, 'profile-only patching should not raise a selected bitrate');
    assert.deepStrictEqual(parsed.DeviceProfile.TranscodingProfiles, [{ Type: 'Video' }]);
}

{
    const body = '{"MaxStreamingBitrate":60000000,"PlaybackInfo":{"maxStaticBitrate":1},"DeviceProfile":{"DirectPlayProfiles":[]}}';
    const patched = patches.enforceMaxBitrateBody(body, 120000000, {
        source: 'test',
        debugLog: function () {},
        patchProfile: function (profile) {
            profile.TranscodingProfiles = [
                {
                    Type: 'Video'
                }
            ];
        }
    });
    const parsed = JSON.parse(patched);

    assert.notStrictEqual(patched, body);
    assert.strictEqual(parsed.MaxStreamingBitrate, 120000000);
    assert.strictEqual(parsed.PlaybackInfo.maxStaticBitrate, 120000000);
    assert.deepStrictEqual(parsed.DeviceProfile.TranscodingProfiles, [
        {
            Type: 'Video'
        }
    ]);
}

{
    const body = {
        MaxStreamingBitrate: 200000000,
        maxStreamingBitrate: 60000000,
        Profile: {
            MaxStaticBitrate: 1
        },
        DeviceProfile: {
            SubtitleProfiles: []
        }
    };
    const returned = patches.enforceMaxBitrateBody(body, 120000000, {
        source: 'object',
        debugLog: function () {},
        patchProfile: function (profile) {
            profile.SubtitleProfiles.push({
                Format: 'pgssub',
                Method: 'External'
            });
        }
    });

    assert.strictEqual(returned, body, 'object bodies should be patched in place');
    assert.strictEqual(body.MaxStreamingBitrate, 200000000, 'higher object bitrate should not be lowered');
    assert.strictEqual(body.maxStreamingBitrate, 200000000, 'lower sibling body bitrate should be raised to the highest effective value');
    assert.strictEqual(body.Profile.MaxStaticBitrate, 120000000);
    assert.deepStrictEqual(body.DeviceProfile.SubtitleProfiles, [
        {
            Format: 'pgssub',
            Method: 'External'
        }
    ]);
}

{
    const body = {
        MaxStreamingBitrate: 1,
        PlaybackInfo: null,
        DeviceProfile: {
            SubtitleProfiles: []
        }
    };
    body.PlaybackInfo = body;
    body.DeviceProfile.parent = body;

    const returned = patches.enforceMaxBitrateBody(body, 120000000, {
        source: 'cycle',
        debugLog: function () {},
        patchProfile: function (profile) {
            profile.SubtitleProfiles.push({
                Format: 'ass',
                Method: 'External'
            });
        }
    });

    assert.strictEqual(returned, body);
    assert.strictEqual(body.MaxStreamingBitrate, 120000000);
    assert.deepStrictEqual(body.DeviceProfile.SubtitleProfiles, [
        {
            Format: 'ass',
            Method: 'External'
        }
    ]);
}

{
    const subtitleProfiles = [];
    subtitleProfiles.push(subtitleProfiles);
    const body = {
        DeviceProfile: {
            SubtitleProfiles: subtitleProfiles
        }
    };
    let patchedProfile = false;

    const returned = patches.enforceMaxBitrateBody(body, 120000000, {
        source: 'profile-cycle-field',
        debugLog: function () {},
        patchProfile: function () {
            patchedProfile = true;
        }
    });

    assert.strictEqual(returned, body);
    assert.strictEqual(patchedProfile, true);
}

function burnInPayload(mediaSource) {
    return {
        MediaSources: [mediaSource]
    };
}

function videoTranscodeSource(subtitleStreams) {
    return {
        Id: 'source-1',
        TranscodingUrl: '/videos/abc/master.m3u8?VideoCodec=h264&AudioCodec=aac&AllowVideoStreamCopy=false&SubtitleStreamIndex=3&alwaysBurnInSubtitleWhenTranscoding=true',
        MediaStreams: subtitleStreams
    };
}

{
    const payload = burnInPayload(videoTranscodeSource([
        { Index: 1, Type: 'Video', Codec: 'h264' },
        { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External', DeliveryUrl: '/Videos/abc/3/Subtitles/x.ass' },
        { Index: 4, Type: 'Subtitle', Codec: 'srt', DeliveryMethod: 'Hls' },
        { Index: 5, Type: 'Subtitle', Codec: 'pgssub', DeliveryMethod: 'Embed' }
    ]));

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {
        source: 'fetch',
        debugLog: function () {}
    }), true, 'a real video transcode should force Encode delivery');

    const streams = payload.MediaSources[0].MediaStreams;
    assert.strictEqual(streams[0].DeliveryMethod, undefined, 'non-subtitle streams must be left alone');
    assert.strictEqual(streams[1].DeliveryMethod, 'Encode');
    assert.strictEqual(streams[1].DeliveryUrl, '/Videos/abc/3/Subtitles/x.ass', 'delivery url is kept for diagnostics');
    assert.strictEqual(streams[2].DeliveryMethod, 'Encode', 'Hls subtitle delivery is client-rendered too');
    assert.strictEqual(streams[3].DeliveryMethod, 'Embed', 'Embed delivery is not client-rendered');
}

{
    // A server that does not announce the flag cannot burn the subtitle in
    // either: 10.9 and older have no AlwaysBurnInSubtitleWhenTranscoding at
    // all. Forcing Encode from the client setting alone would leave no
    // subtitle at all, so the response has to gate the patch.
    const payload = burnInPayload({
        Id: 'source-1',
        TranscodingUrl: '/videos/abc/master.m3u8?VideoCodec=h264&SubtitleStreamIndex=3',
        MediaStreams: [
            { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
        ]
    });

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {
        alwaysBurnInSubtitleWhenTranscoding: true
    }), false, 'the client setting must not stand in for a server that never burns in');
    assert.strictEqual(payload.MediaSources[0].MediaStreams[0].DeliveryMethod, 'External');
}

{
    const payload = burnInPayload(videoTranscodeSource([
        { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
    ]));

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {
        alwaysBurnInSubtitleWhenTranscoding: false
    }), true, 'the response URL should remain authoritative after a later setting change');
    assert.strictEqual(payload.MediaSources[0].MediaStreams[0].DeliveryMethod, 'Encode');
}

{
    // Audio-only transcode keeps the video stream intact, so the server cannot
    // burn subtitles in and Jellyfin Web must keep rendering them.
    const payload = burnInPayload({
        Id: 'source-1',
        TranscodingUrl: '/videos/abc/master.m3u8?VideoCodec=copy&AudioCodec=aac&SubtitleStreamIndex=3&alwaysBurnInSubtitleWhenTranscoding=true',
        MediaStreams: [
            { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
        ]
    });

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {}), false, 'video copy must not suppress client-side rendering');
    assert.strictEqual(payload.MediaSources[0].MediaStreams[0].DeliveryMethod, 'External');
}

{
    // Jellyfin 10.11 normally writes the target video codec into the URL even
    // when EncodingHelper will select stream copy at request time.
    const payload = burnInPayload({
        Id: 'source-1',
        PlayMethod: 'Transcode',
        TranscodingUrl: '/videos/abc/master.m3u8?VideoCodec=hevc&AudioCodec=aac&SubtitleStreamIndex=3&TranscodeReasons=AudioCodecNotSupported&alwaysBurnInSubtitleWhenTranscoding=true',
        MediaStreams: [
            { Index: 0, Type: 'Video', Codec: 'hevc' },
            { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
        ]
    });

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {}), false, 'implicit video copy must not suppress client-side rendering');
    assert.strictEqual(payload.MediaSources[0].MediaStreams[1].DeliveryMethod, 'External');
}

{
    // TryStreamCopy ignores TranscodeReasons. A direct-play failure can still
    // become video copy when the source satisfies the HLS request constraints.
    const payload = burnInPayload({
        Id: 'source-1',
        PlayMethod: 'Transcode',
        TranscodingUrl: '/videos/abc/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac&VideoBitRate=120000000&MaxFramerate=60&MaxWidth=3840&MaxHeight=2160&hevc-level=153&hevc-videobitdepth=10&hevc-profile=main,main10&hevc-rangetype=HDR10&SubtitleStreamIndex=3&TranscodeReasons=DirectPlayError&alwaysBurnInSubtitleWhenTranscoding=true',
        MediaStreams: [
            {
                Index: 0,
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
            },
            { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
        ]
    });

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {}), false, 'request-time video copy must keep client subtitles');
    assert.strictEqual(payload.MediaSources[0].MediaStreams[1].DeliveryMethod, 'External');
}

{
    const payload = burnInPayload({
        Id: 'source-1',
        SupportsDirectPlay: true,
        MediaStreams: [
            { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
        ]
    });

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {
        alwaysBurnInSubtitleWhenTranscoding: true
    }), false, 'direct play must not suppress client-side rendering');
    assert.strictEqual(payload.MediaSources[0].MediaStreams[0].DeliveryMethod, 'External');
}

{
    const payload = burnInPayload({
        Id: 'source-1',
        transcodingUrl: '/videos/abc/master.m3u8?VideoCodec=h264&alwaysBurnInSubtitleWhenTranscoding=1',
        mediaStreams: [
            { Index: 3, type: 2, codec: 'ssa', deliveryMethod: 'external' }
        ]
    });

    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {}), true, 'camelCase payloads should be handled');
    assert.strictEqual(payload.mediaSources, undefined);
    assert.strictEqual(payload.MediaSources[0].mediaStreams[0].deliveryMethod, 'Encode');
}

{
    const enabledSource = videoTranscodeSource([
        { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
    ]);
    const disabledSource = {
        Id: 'source-2',
        TranscodingUrl: '/videos/def/master.m3u8?VideoCodec=h264&alwaysBurnInSubtitleWhenTranscoding=false',
        MediaStreams: [
            { Index: 3, Type: 'Subtitle', Codec: 'ass', DeliveryMethod: 'External' }
        ]
    };
    const payload = { MediaSources: [enabledSource, disabledSource] };

    assert.strictEqual(patches.hasAlwaysBurnInSubtitleTranscodingUrl(payload), true);
    assert.strictEqual(patches.patchBurnedInSubtitleDelivery(payload, {
        alwaysBurnInSubtitleWhenTranscoding: true
    }), true);
    assert.strictEqual(enabledSource.MediaStreams[0].DeliveryMethod, 'Encode', 'the enabled media source should be corrected');
    assert.strictEqual(disabledSource.MediaStreams[0].DeliveryMethod, 'External', 'the decision stays per media source, never payload-wide');
}

assert.strictEqual(patches.patchBurnedInSubtitleDelivery(null, {}), false);
assert.strictEqual(patches.patchBurnedInSubtitleDelivery({}, null), false);
