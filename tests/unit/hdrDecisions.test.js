const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
const hdrDecisionsPath = path.join(root, 'frontend', 'js', 'injected', 'playback', 'hdrDecisions.js');

function loadHdrDecisions() {
    const window = {};
    const context = {
        window: window
    };

    vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
        filename: runtimePath
    });
    vm.runInNewContext(fs.readFileSync(hdrDecisionsPath, 'utf8'), context, {
        filename: hdrDecisionsPath
    });

    return window.__JellyfinWebOSPatchRuntime.get('playback.hdrDecisions');
}

const hdr = loadHdrDecisions();
assert(hdr, 'playback.hdrDecisions should register');

assert.strictEqual(hdr.normalizeDynamicRangeText('HDR10'), 'hdr10');
assert.strictEqual(hdr.isHdrDynamicRangeText('HDR10+ / Dolby Vision'), true);
assert.strictEqual(hdr.isHdrDynamicRangeText('SMPTE ST 2084 PQ'), true);
assert.strictEqual(hdr.isHdrDynamicRangeText('HLG'), true);
assert.strictEqual(hdr.isSdrDynamicRangeText('Standard Dynamic Range'), true);
assert.strictEqual(hdr.isSdrDynamicRangeText('SDR'), true);

assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('ColorTransfer', 16), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('ColorTransfer', 'smpte2084'), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('ColorTransfer', 1), 'sdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('ColorTransfer', 'bt709'), 'sdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('Hdr10PlusPresentFlag', true), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('DvProfile', 8), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('VideoRangeType', 'HDR10'), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromMetadataField('DisplayTitle', '2160p HEVC HDR10'), 'hdr');

assert.strictEqual(hdr.getDynamicRangeHintFromVideoStream({
    Type: 1,
    ColorTransfer: 16
}), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromVideoStream({
    type: 'Video',
    colorTransfer: 'bt709'
}), 'sdr');

const mixedSourceItem = {
    MediaSources: [
        {
            Id: 'sdr-source',
            MediaStreams: [
                {
                    Type: 'Video',
                    ColorTransfer: 'bt709'
                }
            ]
        },
        {
            Id: 'hdr-source',
            MediaStreams: [
                {
                    Type: 'Video',
                    VideoRange: 'HDR10'
                },
                {
                    Type: 'Audio',
                    VideoRange: 'HDR10'
                }
            ]
        }
    ]
};

assert.strictEqual(hdr.getDynamicRangeHintFromItem(mixedSourceItem, 'sdr-source'), 'sdr');
assert.strictEqual(hdr.getDynamicRangeHintFromItem(mixedSourceItem, 'hdr-source'), 'hdr');
assert.strictEqual(hdr.getDynamicRangeHintFromItem(mixedSourceItem), 'unknown', 'mixed sources without a selected id should not force HDR');

assert.strictEqual(hdr.getSelectedMediaSourceId({
    MediaSources: [
        {
            Id: 'only-source'
        }
    ]
}), 'only-source');
assert.strictEqual(hdr.getSelectedMediaSourceId({
    PlaybackMediaSourceId: 'selected-source'
}), 'selected-source');

const playbackInfoPayload = {
    MediaSourceId: 'ms1',
    MediaSources: [
        {
            Id: 'ms1',
            PlayMethod: 'DirectStream',
            MediaStreams: [
                {
                    Type: 'Video',
                    VideoDoViTitle: 'Dolby Vision Profile 8'
                }
            ]
        }
    ]
};

assert.strictEqual(hdr.getDynamicRangeHintFromPlaybackInfoPayload(playbackInfoPayload), 'hdr');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromPlaybackInfoPayload(playbackInfoPayload), 'directstream');

const directPlayPlaybackInfoPayload = {
    MediaSourceId: 'ms-direct',
    MediaSources: [
        {
            Id: 'ms-direct',
            SupportsDirectPlay: true,
            SupportsDirectStream: true,
            MediaStreams: [
                {
                    Type: 'Video',
                    VideoRange: 'HDR10'
                }
            ]
        }
    ]
};

assert.strictEqual(hdr.getDynamicRangeHintFromPlaybackInfoPayload(directPlayPlaybackInfoPayload), 'hdr');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromPlaybackInfoPayload(directPlayPlaybackInfoPayload), 'directplay');

assert.strictEqual(hdr.getDynamicRangeHintFromMediaInfo({
    MediaSource: {
        MediaStreams: [
            {
                type: '1',
                colorTransfer: 'smpte2084'
            }
        ]
    }
}), 'hdr');

assert.strictEqual(hdr.getPlaybackVideoDeliveryFromTranscodingUrl('/videos/1/master.m3u8?VideoCodec=copy'), 'copy');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromTranscodingUrl('/videos/1/master.m3u8?VideoCodec=h264'), 'transcode');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromTranscodingUrl('/videos/1/master.m3u8?Static=true&VideoCodec=h264'), 'directstream');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    SupportsDirectPlay: true
}), 'directplay');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    directStreamUrl: '/videos/1/stream.mkv'
}), 'directstream');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    DirectStreamUrl: '/videos/1/stream.mkv'
}), 'transcode', 'explicit PlayMethod should win over candidate DirectStreamUrl');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    SupportsDirectPlay: true
}), 'transcode', 'explicit PlayMethod should win over capability flags');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=copy'
}), 'copy', 'TranscodingUrl should still identify video-copy transcodes');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    SupportsDirectPlay: true,
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264'
}), 'transcode', 'TranscodingUrl should win over capability flags');
assert.strictEqual(hdr.normalizePlaybackVideoDelivery('DirectPlay'), 'directplay');
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('directplay'), true);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('directstream'), true);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('copy'), true);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('transcode'), false);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('unknown'), false);
