const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
const playbackInfoPatchesPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'playbackInfoPatches.js');

function loadPlaybackInfoPatches() {
    const window = {};
    const context = {
        window: window
    };

    vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
        filename: runtimePath
    });
    vm.runInNewContext(fs.readFileSync(playbackInfoPatchesPath, 'utf8'), context, {
        filename: playbackInfoPatchesPath
    });

    return window.__JellyfinWebOSPatchRuntime.get('playback.playbackInfoPatches');
}

const patches = loadPlaybackInfoPatches();
assert(patches, 'playback.playbackInfoPatches should register');

assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInfo'), true);
assert.strictEqual(patches.isPlaybackInfoUrl('/Users/abc/Items'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/Images/Primary?next=/PlaybackInfo'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInformation'), false);
assert.strictEqual(patches.isPlaybackInfoUrl('/Items/abc/PlaybackInfoExtra'), false);
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/abc%201/PlaybackInfo?x=1'), 'abc 1');
assert.strictEqual(patches.extractItemIdFromPlaybackInfoUrl('/Items/abc/Images/Primary'), null);

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc%201/PlaybackInfo?foo=bar#frag', 120000000);

    assert.strictEqual(result.url, '/Items/abc%201/PlaybackInfo?foo=bar&MaxStreamingBitrate=120000000#frag');
    assert.strictEqual(result.targetBitrate, 120000000);
    assert.strictEqual(result.itemId, 'abc 1');
}

{
    const result = patches.enforceMaxBitrateUrl('/Items/abc/PlaybackInfo?MaxStreamingBitrate=200000000', 120000000);

    assert.strictEqual(result.targetBitrate, 200000000, 'higher server bitrate should not be lowered');
    assert.strictEqual(result.url, '/Items/abc/PlaybackInfo?MaxStreamingBitrate=200000000');
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

assert.strictEqual(patches.enforceMaxBitrateBody('not json', 120000000, {}), 'not json');
assert.strictEqual(patches.enforceMaxBitrateBody('[{"MaxStreamingBitrate":1}]', 120000000, {}), '[{"MaxStreamingBitrate":1}]');

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
    assert.strictEqual(body.maxStreamingBitrate, 120000000);
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
