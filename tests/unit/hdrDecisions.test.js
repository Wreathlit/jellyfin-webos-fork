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

function loadHdrDecisions() {
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

// Top-level metadata-field loop (no MediaSource/MediaSources/MediaStreams present).
assert.strictEqual(hdr.getDynamicRangeHintFromMediaInfo({
    VideoRangeType: 'HDR10'
}), 'hdr', 'top-level VideoRangeType should be inspected when no media source is present');
assert.strictEqual(hdr.getDynamicRangeHintFromMediaInfo({
    ColorTransfer: 'bt709'
}), 'sdr', 'top-level SDR-only signal should resolve to sdr');
// videoDoViProfile/Level fallback (these keys are not in the inspected list above).
assert.strictEqual(hdr.getDynamicRangeHintFromMediaInfo({
    VideoDoViProfile: 8
}), 'hdr', 'HDR Dolby Vision profile fallback should force HDR');
assert.strictEqual(hdr.getDynamicRangeHintFromMediaInfo({
    title: 'no recognizable signal'
}), 'unknown', 'no recognizable dynamic-range signal should resolve to unknown');

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
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc' }
    ]
}), 'copy', 'audio-only transcode should identify the server\'s implicit video stream copy');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac&VideoBitrate=120000000&MaxFramerate=60&MaxWidth=3840&MaxHeight=2160&hevc-level=153&hevc-videobitdepth=10&hevc-profile=main,main10&hevc-rangetype=HDR10&TranscodeReasons=DirectPlayError',
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
}), 'copy', 'TryStreamCopy ignores the direct-play reason when the video satisfies the HLS request');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc' }
    ]
}), 'copy', 'missing TranscodeReasons must not prevent request-time video copy');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264&AudioCodec=aac&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc' }
    ]
}), 'transcode', 'implicit stream copy requires the source codec in the target codec list');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&AllowVideoStreamCopy=false&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc' }
    ]
}), 'transcode', 'an explicit stream-copy disable must force video transcode classification');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&hevc-videobitdepth=8&TranscodeReasons=AudioCodecNotSupported,VideoBitDepthNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', BitDepth: 10 }
    ]
}), 'transcode', 'the actual target bit-depth constraint must force video transcode classification');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&hevc-profile=main',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', Profile: 'Main 10' }
    ]
}), 'transcode', 'a source profile above the requested profile must be encoded');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&hevc-rangetype=SDR',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', VideoRangeType: 'HDR10' }
    ]
}), 'transcode', 'an HDR source cannot be copied into an SDR-only request');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264&AudioCodec=aac&RequireAvc=true&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'h264', IsAVC: false }
    ]
}), 'transcode', 'RequireAvc must reject a non-AVC H264 source even when the reason list is audio-only');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&hevc-deinterlace=true&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', IsInterlaced: true }
    ]
}), 'transcode', 'a requested deinterlace prevents stream copy');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&RequireNonAnamorphic=True&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', IsAnamorphic: true }
    ]
}), 'transcode', 'a non-anamorphic requirement prevents copying an anamorphic source');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&SubtitleStreamIndex=3&SubtitleMethod=Encode&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc' }
    ]
}), 'transcode', 'a subtitle encode request requires a real video encode');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc&AudioCodec=aac&SubtitleStreamIndex=3abc&SubtitleMethod=Encode&TranscodeReasons=AudioCodecNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc' }
    ]
}), 'copy', 'a malformed SubtitleStreamIndex must not block implicit video stream copy');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    PlayMethod: 'Transcode',
    Container: 'avi',
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264&AudioCodec=aac&TranscodeReasons=ContainerNotSupported',
    MediaStreams: [
        { Type: 'Video', Codec: 'h264' }
    ]
}), 'transcode', 'non-AVC H264 in AVI follows the server stream-copy rejection');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromMediaSource({
    SupportsDirectPlay: true,
    TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264'
}), 'transcode', 'TranscodingUrl should win over capability flags');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromPlaybackInfoPayload({
    MediaSourceId: 'same-codec',
    MediaSources: [{
        Id: 'same-codec',
        PlayMethod: 'Transcode',
        TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac',
        MediaStreams: [{ Type: 'Video', Codec: 'hevc' }]
    }]
}), 'transcode', 'PlaybackInfo must not expose a request-time stream-copy prediction as an observed copy');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromSession({
    PlayState: { PlayMethod: 'Transcode' },
    TranscodingInfo: { IsVideoDirect: true }
}), 'directstream', 'the running session identifies audio-only transcode as direct-streamed video');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromSession({
    PlayState: { PlayMethod: 'Transcode' },
    TranscodingInfo: { IsVideoDirect: false }
}), 'transcode', 'the running session identifies real video encoding');
assert.strictEqual(hdr.getPlaybackVideoDeliveryFromSession({
    PlayState: { PlayMethod: 'DirectPlay' }
}), 'directplay');
assert.strictEqual(hdr.normalizePlaybackVideoDelivery('DirectPlay'), 'directplay');
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('directplay'), true);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('directstream'), true);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('copy'), true);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('transcode'), false);
assert.strictEqual(hdr.isPlaybackVideoCopiedOrDirect('unknown'), false);

// --- query parameter casing -------------------------------------------------
//
// Server and client spell the same parameter differently, and the server binds
// them without regard to case. StreamInfo.ToUrl() writes `&VideoBitrate=`
// (MediaBrowser.Model/Dlna/StreamInfo.cs), while the controller argument is
// `videoBitRate` and Jellyfin Web sends `VideoBitrate` in its own URLs. The
// lookup used to be case-sensitive and only tried the fork's guesses, so the
// bitrate blocker below never ran against a real server URL: the predictor
// answered "copy", the burned-in subtitle patch was skipped, and the client
// rendered a second copy of a subtitle the server had already burned in.
{
    // Only the bitrate cap can block the copy here: same codec, no subtitle
    // burn-in, no resolution/frame-rate constraint.
    const cappedBelowSource = function (bitrateSpelling) {
        return {
            PlayMethod: 'Transcode',
            TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264&AudioCodec=aac&'
                + bitrateSpelling + '=3000000',
            MediaStreams: [{ Type: 'Video', Codec: 'h264', BitRate: 18000000 }]
        };
    };

    for (const spelling of ['VideoBitrate', 'VideoBitRate', 'videoBitRate', 'videobitrate']) {
        assert.strictEqual(
            hdr.getPlaybackVideoDeliveryFromMediaSource(cappedBelowSource(spelling), true),
            'transcode',
            'a bitrate cap below the source must block the copy however the parameter is spelled ('
                + spelling + ')'
        );
    }

    assert.strictEqual(
        hdr.getPlaybackVideoDeliveryFromMediaSource({
            PlayMethod: 'Transcode',
            TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264&AudioCodec=aac',
            MediaStreams: [{ Type: 'Video', Codec: 'h264', BitRate: 18000000 }]
        }, true),
        'copy',
        'without a bitrate cap the same source is still predicted as a stream copy'
    );

    // Every other constraint reads from the URL the same way.
    assert.strictEqual(
        hdr.getPlaybackVideoDeliveryFromMediaSource({
            PlayMethod: 'Transcode',
            TranscodingUrl: '/videos/1/master.m3u8?videocodec=h264&maxwidth=1280',
            MediaStreams: [{ Type: 'Video', Codec: 'h264', Width: 1920 }]
        }, true),
        'transcode',
        'a lower-cased MaxWidth must still block the copy'
    );
    assert.strictEqual(
        hdr.getPlaybackVideoDeliveryFromTranscodingUrl('/videos/1/master.m3u8?static=true'),
        'directstream',
        'a lower-cased Static must still be read'
    );
}

// --- OSD text is not a metadata field ---------------------------------------
//
// getDynamicRangeHintFromPlaybackUi flattens whole OSD containers, and the item
// title lives in one of them (.osdTitle sits inside .videoOsdBottom). A bare
// substring test for the short markers turned ordinary names into an HDR
// verdict and dimmed the UI to 30% for the whole playback.
{
    const falsePositives = [
        'Ludovico Einaudi - Live at the Royal Albert Hall',
        'Ludovic Chancel',
        'Radovic',
        'Wahlgren & Wahlgren',
        'Kohlgruber',
        'Hdrive'
    ];
    for (const title of falsePositives) {
        assert.strictEqual(
            hdr.isHdrDynamicRangeUiText(title),
            false,
            'an ordinary title must not read as HDR: ' + title
        );
    }

    const realBadges = [
        'HDR',
        'HDR10',
        'HDR10+',
        'HLG',
        'DoVi',
        'DOVIWithHDR10',
        'DOVIWithHLG',
        'Dolby Vision',
        'SMPTE ST 2084 PQ',
        '1080p HEVC HDR10 · EAC3',
        'S02E04 - Endgame - HDR - 1:23:45'
    ];
    for (const badge of realBadges) {
        assert.strictEqual(
            hdr.isHdrDynamicRangeUiText(badge),
            true,
            'a real dynamic range designation must still be read: ' + badge
        );
    }

    // Metadata fields keep the permissive test: a structured value is not free
    // text, and some of them only carry the marker as a substring.
    assert.strictEqual(hdr.isHdrDynamicRangeText('DOVIWithHDR10'), true);
    assert.strictEqual(hdr.getDynamicRangeHintFromVideoStream({ VideoRangeType: 'DOVIWithHDR10' }), 'hdr');

    // Ordinary text still reports SDR when the OSD says so.
    assert.strictEqual(hdr.isSdrDynamicRangeText('Ludovico Einaudi - SDR'), true);
}
