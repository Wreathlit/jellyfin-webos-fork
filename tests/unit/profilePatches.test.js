const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
const profilePatchesPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'profilePatches.js');

function loadProfilePatches() {
    const window = {};
    const context = {
        window: window
    };

    vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
        filename: runtimePath
    });
    vm.runInNewContext(fs.readFileSync(profilePatchesPath, 'utf8'), context, {
        filename: profilePatchesPath
    });

    return window.__JellyfinWebOSPatchRuntime.get('playback.profilePatches');
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function csv(value) {
    return value ? value.split(',').filter(Boolean) : [];
}

function hasSubtitleProfile(profile, format, method) {
    for (let i = 0; i < profile.SubtitleProfiles.length; i++) {
        const subtitleProfile = profile.SubtitleProfiles[i];
        if (subtitleProfile.Format.toLowerCase() === format
            && subtitleProfile.Method.toLowerCase() === method) {
            return true;
        }
    }
    return false;
}

const profilePatches = loadProfilePatches();
assert(profilePatches, 'playback.profilePatches should register');

{
    const profile = {
        MaxStreamingBitrate: 60000000,
        MaxStaticBitrate: 60000000,
        DirectPlayProfiles: [
            {
                Type: 'Video',
                Container: 'mkv,dvd,mp4',
                VideoCodec: 'hevc,h265,mpeg2video,h264',
                AudioCodec: 'aac,ac3'
            },
            {
                Type: 'Video',
                Container: 'dvd',
                VideoCodec: 'mpeg2video',
                AudioCodec: 'ac3'
            },
            {
                Type: 'Audio',
                Container: 'mp3',
                AudioCodec: 'mp3'
            }
        ],
        CodecProfiles: [
            {
                Type: 'Video',
                Codec: 'h264',
                Conditions: []
            },
            {
                Type: 'Video',
                Codec: 'hevc'
            }
        ],
        TranscodingProfiles: [
            {
                Type: 'Video',
                Protocol: 'hls',
                VideoCodec: 'h264',
                AudioCodec: 'aac'
            },
            {
                Type: 'Video',
                Protocol: 'dash',
                VideoCodec: 'h264',
                AudioCodec: 'aac'
            }
        ],
        SubtitleProfiles: [
            {
                Format: 'pgssub',
                Method: 'Embed'
            }
        ]
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        maxBitrate: 120000000,
        lpcmAudioCopyEnabled: false
    });

    assert.strictEqual(profile.MaxStreamingBitrate, 120000000);
    assert.strictEqual(profile.MaxStaticBitrate, 120000000);
    assert.strictEqual(profile.DirectPlayProfiles.length, 2, 'DVD-only direct play profile should be removed');
    assert.strictEqual(profile.DirectPlayProfiles[0].Container, 'mkv,mp4');
    assert.strictEqual(profile.DirectPlayProfiles[0].VideoCodec, 'hevc,h265,h264');
    assert(!csv(profile.DirectPlayProfiles[0].AudioCodec).includes('pcm_s16le'), 'LPCM should stay disabled by default');
    assert(profile.CodecProfiles[0].Conditions.some((condition) => condition.Condition === 'NotEquals'
        && condition.Property === 'IsInterlaced'
        && condition.Value === 'true'
        && condition.IsRequired === false));
    assert.strictEqual(profile.TranscodingProfiles[0].EnableSubtitlesInManifest, true);
    assert(csv(profile.TranscodingProfiles[0].VideoCodec).includes('hevc'), 'HEVC video copy should be allowed when direct play supports HEVC');
    assert(csv(profile.TranscodingProfiles[0].VideoCodec).includes('h265'), 'H265 video copy should be allowed when direct play supports H265');
    assert(csv(profile.TranscodingProfiles[1].VideoCodec).includes('hevc'), 'video copy applies to all video transcode profiles');
    assert(csv(profile.TranscodingProfiles[1].VideoCodec).includes('h265'), 'H265 video copy applies to all video transcode profiles');
    assert.strictEqual(profile.SubtitleProfiles[0].Method, 'External');
    assert(hasSubtitleProfile(profile, 'ass', 'external'));
    assert(hasSubtitleProfile(profile, 'ssa', 'external'));
    assert(hasSubtitleProfile(profile, 'pgssub', 'external'));
    assert(hasSubtitleProfile(profile, 'pgs', 'external'));
}

{
    const profile = {
        DirectPlayProfiles: [
            {
                Type: 'Video',
                Container: 'mp4',
                VideoCodec: 'h264',
                AudioCodec: 'aac'
            }
        ],
        TranscodingProfiles: [
            {
                Type: 'Video',
                Protocol: 'hls',
                VideoCodec: 'h264',
                AudioCodec: 'aac'
            }
        ],
        SubtitleProfiles: []
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        maxBitrate: 0,
        lpcmAudioCopyEnabled: false
    });

    assert(!csv(profile.TranscodingProfiles[0].VideoCodec).includes('hevc'));
    assert(!csv(profile.TranscodingProfiles[0].VideoCodec).includes('h265'));
}

{
    const profile = {
        DirectPlayProfiles: [],
        TranscodingProfiles: [
            {
                Type: 'Video',
                Protocol: 'hls',
                VideoCodec: 'h264',
                AudioCodec: 'aac'
            }
        ],
        SubtitleProfiles: [
            {
                Format: 'pgssub',
                Method: 'Embed'
            }
        ]
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        subtitleBurnInMode: 'allcomplexformats'
    });

    assert.strictEqual(profile.SubtitleProfiles[0].Method, 'Embed', 'All Complex Formats must not convert PGS to External');
    assert(!hasSubtitleProfile(profile, 'ass', 'external'), 'All Complex Formats must not add ASS External');
    assert(!hasSubtitleProfile(profile, 'ssa', 'external'), 'All Complex Formats must not add SSA External');
    assert(!hasSubtitleProfile(profile, 'pgssub', 'external'), 'All Complex Formats must not add PGSSUB External');
    assert(!hasSubtitleProfile(profile, 'pgs', 'external'), 'All Complex Formats must not add PGS External');
    assert.strictEqual(profile.TranscodingProfiles[0].EnableSubtitlesInManifest, true, 'manifest support patch should remain independent');
}

{
    const pgsAliases = ['pgs', 'hdmv_pgs_subtitle'];
    for (let i = 0; i < pgsAliases.length; i++) {
        const profile = {
            DirectPlayProfiles: [],
            TranscodingProfiles: [],
            SubtitleProfiles: [
                {
                    Format: pgsAliases[i],
                    Method: 'Embed'
                }
            ]
        };

        profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
            subtitleBurnInMode: 'All Complex Formats'
        });

        assert.strictEqual(profile.SubtitleProfiles[0].Method, 'Embed', pgsAliases[i] + ' must not convert to External when complex subtitles burn in');
        assert(!hasSubtitleProfile(profile, pgsAliases[i], 'external'), pgsAliases[i] + ' External must not be added when complex subtitles burn in');
    }
}

{
    const profile = {
        DirectPlayProfiles: [],
        TranscodingProfiles: [],
        SubtitleProfiles: [
            {
                Format: 'pgssub',
                Method: 'Embed'
            }
        ]
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        subtitleBurnInMode: 'onlyimageformats'
    });

    assert.strictEqual(profile.SubtitleProfiles[0].Method, 'Embed', 'Only Image Formats must not convert PGS to External');
    assert(hasSubtitleProfile(profile, 'ass', 'external'), 'Only Image Formats should still allow ASS External');
    assert(hasSubtitleProfile(profile, 'ssa', 'external'), 'Only Image Formats should still allow SSA External');
    assert(!hasSubtitleProfile(profile, 'pgssub', 'external'), 'Only Image Formats must not add PGSSUB External');
    assert(!hasSubtitleProfile(profile, 'pgs', 'external'), 'Only Image Formats must not add PGS External');
}

{
    const profile = {
        DirectPlayProfiles: [],
        TranscodingProfiles: [],
        SubtitleProfiles: [
            {
                Format: 'pgssub',
                Method: 'Embed'
            }
        ]
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        subtitleBurnin: 'only-image-formats'
    });

    assert.strictEqual(profile.SubtitleProfiles[0].Method, 'Embed', 'hyphenated Only Image Formats must not convert PGS to External');
    assert(hasSubtitleProfile(profile, 'ass', 'external'), 'hyphenated Only Image Formats should still allow ASS External');
    assert(hasSubtitleProfile(profile, 'ssa', 'external'), 'hyphenated Only Image Formats should still allow SSA External');
    assert(!hasSubtitleProfile(profile, 'pgssub', 'external'), 'hyphenated Only Image Formats must not add PGSSUB External');
    assert(!hasSubtitleProfile(profile, 'pgs', 'external'), 'hyphenated Only Image Formats must not add PGS External');
}

{
    const profile = {
        DirectPlayProfiles: [],
        TranscodingProfiles: [],
        SubtitleProfiles: [
            {
                Format: 'pgssub',
                Method: 'Embed'
            }
        ]
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        subtitleBurnIn: 'all'
    });

    assert.strictEqual(profile.SubtitleProfiles[0].Method, 'Embed', 'All subtitles must not convert PGS to External');
    assert(!hasSubtitleProfile(profile, 'ass', 'external'), 'All subtitles must not add ASS External');
    assert(!hasSubtitleProfile(profile, 'ssa', 'external'), 'All subtitles must not add SSA External');
    assert(!hasSubtitleProfile(profile, 'pgssub', 'external'), 'All subtitles must not add PGSSUB External');
    assert(!hasSubtitleProfile(profile, 'pgs', 'external'), 'All subtitles must not add PGS External');
}

{
    const profile = {
        DirectPlayProfiles: [],
        TranscodingProfiles: [],
        SubtitleProfiles: []
    };

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        subtitleBurnInMode: 'ALL_COMPLEX_FORMATS'
    });

    assert(!hasSubtitleProfile(profile, 'ass', 'external'), 'underscore All Complex Formats must not add ASS External');
    assert(!hasSubtitleProfile(profile, 'ssa', 'external'), 'underscore All Complex Formats must not add SSA External');
    assert(!hasSubtitleProfile(profile, 'pgssub', 'external'), 'underscore All Complex Formats must not add PGSSUB External');
    assert(!hasSubtitleProfile(profile, 'pgs', 'external'), 'underscore All Complex Formats must not add PGS External');
}

{
    const profile = {
        MaxStreamingBitrate: 200000000,
        MaxStaticBitrate: 200000000,
        DirectPlayProfiles: [
            {
                Type: 'Video',
                Container: 'mkv',
                VideoCodec: 'hevc',
                AudioCodec: 'aac'
            },
            {
                Type: 'Video',
                Container: 'mkv',
                VideoCodec: 'h265'
            }
        ],
        TranscodingProfiles: [
            {
                Type: 'Video',
                Protocol: 'hls',
                VideoCodec: 'h264',
                AudioCodec: 'aac'
            }
        ],
        SubtitleProfiles: []
    };
    const originalTranscodingProfile = clone(profile.TranscodingProfiles[0]);

    profilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
        maxBitrate: 120000000,
        lpcmAudioCopyEnabled: true
    });

    assert.strictEqual(profile.MaxStreamingBitrate, 200000000, 'higher server bitrate should not be lowered');
    assert.strictEqual(profile.MaxStaticBitrate, 200000000, 'higher static bitrate should not be lowered');
    assert(csv(profile.DirectPlayProfiles[0].AudioCodec).includes('pcm_s16le'));
    assert(csv(profile.DirectPlayProfiles[0].AudioCodec).includes('pcm_bluray'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(profile.DirectPlayProfiles[1], 'AudioCodec'), false, 'LPCM option must not create AudioCodec lists');
    assert.strictEqual(profile.TranscodingProfiles[0].AudioCodec, originalTranscodingProfile.AudioCodec, 'LPCM option must not alter transcode audio codec list');
}
