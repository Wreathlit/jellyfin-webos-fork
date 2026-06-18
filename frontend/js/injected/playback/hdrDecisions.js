/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};

    function parsePositiveInteger(value) {
        var parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return 0;
        }
        return parsed;
    }

    function normalizeDynamicRangeText(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        return value.toLowerCase();
    }

    function isHdrDynamicRangeText(value) {
        var normalized = normalizeDynamicRangeText(value);
        if (!normalized) {
            return false;
        }

        return normalized.indexOf('hdr10') !== -1
            || /(^|[^a-z0-9])hdr([^a-z0-9]|$)/i.test(normalized)
            || normalized.indexOf('dolby vision') !== -1
            || normalized.indexOf('dolbyvision') !== -1
            || normalized.indexOf('dovi') !== -1
            || normalized.indexOf('hlg') !== -1
            || normalized.indexOf('smpte2084') !== -1
            || /smpte\s*(?:st\s*)?2084/i.test(normalized)
            || normalized.indexOf('arib-std-b67') !== -1
            || /(^|[^a-z0-9])pq([^a-z0-9]|$)/i.test(normalized);
    }

    function isPositiveNumberValue(value) {
        if (typeof value === 'number') {
            return value > 0;
        }

        if (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
            return parseFloat(value) > 0;
        }

        return false;
    }

    function isHdrDoviProfileOrLevel(value) {
        return isHdrDynamicRangeText(value) || isPositiveNumberValue(value);
    }

    function isSdrDynamicRangeText(value) {
        var normalized = normalizeDynamicRangeText(value);
        if (!normalized) {
            return false;
        }

        return normalized.indexOf('standard dynamic range') !== -1
            || /(^|[^a-z0-9])sdr([^a-z0-9]|$)/i.test(normalized);
    }

    function getDynamicRangeHintFromColorTransfer(value) {
        if (isHdrDynamicRangeText(value)) {
            return 'hdr';
        }

        var normalized = normalizeDynamicRangeText(value);
        if (normalized.indexOf('bt709') !== -1
            || normalized.indexOf('bt.709') !== -1
            || normalized.indexOf('smpte170m') !== -1
            || normalized.indexOf('iec61966-2-1') !== -1
            || isSdrDynamicRangeText(value)) {
            return 'sdr';
        }

        var transfer = parsePositiveInteger(value);
        if (transfer === 16 || transfer === 18) {
            return 'hdr';
        }
        if (transfer === 1 || transfer === 6 || transfer === 13) {
            return 'sdr';
        }

        return 'unknown';
    }

    function isTruthyNormalizedString(value) {
        return value === 'true' || value === '1' || value === 'yes';
    }

    function isTruthyMetadataFlag(value) {
        if (value === true) {
            return true;
        }

        if (typeof value === 'string') {
            return isTruthyNormalizedString(value.toLowerCase());
        }

        return isPositiveNumberValue(value);
    }

    function isDolbyVisionNumericMetadataField(key) {
        return key === 'dvprofile'
            || key === 'dvlevel'
            || key === 'dvversionmajor'
            || key === 'dvversionminor'
            || key === 'videodoviprofile'
            || key === 'videodovilevel'
            || key === 'rpupresentflag';
    }

    function getDynamicRangeHintFromMetadataField(key, value) {
        var normalizedKey = key ? key.toString().toLowerCase() : '';
        if (normalizedKey === 'colortransfer') {
            return getDynamicRangeHintFromColorTransfer(value);
        }

        if (normalizedKey === 'hdr10pluspresentflag' && isTruthyMetadataFlag(value)) {
            return 'hdr';
        }

        if (isDolbyVisionNumericMetadataField(normalizedKey) && isPositiveNumberValue(value)) {
            return 'hdr';
        }

        if (isHdrDynamicRangeText(value)) {
            return 'hdr';
        }

        if (isSdrDynamicRangeText(value)) {
            return 'sdr';
        }

        return 'unknown';
    }

    function getDynamicRangeHintFromObjectFields(value, keysToInspect) {
        if (!value || typeof value !== 'object') {
            return 'unknown';
        }

        var sawSdr = false;
        for (var i = 0; i < keysToInspect.length; i++) {
            var key = keysToInspect[i];
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }

            var hint = getDynamicRangeHintFromMetadataField(key, value[key]);
            if (hint === 'hdr') {
                return 'hdr';
            }
            if (hint === 'sdr') {
                sawSdr = true;
            }
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function toArray(value) {
        return Object.prototype.toString.call(value) === '[object Array]' ? value : [];
    }

    function isVideoMediaStream(stream) {
        if (!stream || typeof stream !== 'object') {
            return false;
        }

        var type = Object.prototype.hasOwnProperty.call(stream, 'Type') ? stream.Type : stream.type;
        if (type === null || type === undefined || type === '') {
            return true;
        }

        if (typeof type === 'number') {
            return type === 1;
        }

        var normalizedType = type.toString().toLowerCase();
        return normalizedType === 'video' || normalizedType === '1';
    }

    function getDynamicRangeHintFromVideoStream(videoStream) {
        if (!videoStream || typeof videoStream !== 'object') {
            return 'unknown';
        }

        var fieldKeys = [
            'VideoRangeType',
            'videoRangeType',
            'VideoRange',
            'videoRange',
            'VideoDoViTitle',
            'videoDoViTitle',
            'VideoDoViProfile',
            'videoDoViProfile',
            'VideoDoViLevel',
            'videoDoViLevel',
            'DvProfile',
            'dvProfile',
            'DvLevel',
            'dvLevel',
            'DvVersionMajor',
            'dvVersionMajor',
            'DvVersionMinor',
            'dvVersionMinor',
            'RpuPresentFlag',
            'rpuPresentFlag',
            'Hdr10PlusPresentFlag',
            'hdr10PlusPresentFlag',
            'ColorTransfer',
            'colorTransfer',
            'ColorPrimaries',
            'colorPrimaries',
            'ColorSpace',
            'colorSpace',
            'DisplayTitle',
            'displayTitle',
            'Title',
            'title'
        ];

        var fieldHint = getDynamicRangeHintFromObjectFields(videoStream, fieldKeys);
        if (fieldHint !== 'unknown') {
            return fieldHint;
        }

        if (isHdrDynamicRangeText(videoStream.VideoDoViProfile)
            || isHdrDynamicRangeText(videoStream.videoDoViProfile)
            || isHdrDynamicRangeText(videoStream.DvProfile)
            || isHdrDynamicRangeText(videoStream.dvProfile)
            || isHdrDynamicRangeText(videoStream.VideoDoViLevel)
            || isHdrDynamicRangeText(videoStream.videoDoViLevel)
            || isHdrDynamicRangeText(videoStream.DvLevel)
            || isHdrDynamicRangeText(videoStream.dvLevel)) {
            return 'hdr';
        }

        return 'unknown';
    }

    function getObjectMediaSourceId(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }

        var id = value.MediaSourceId || value.mediaSourceId || value.Id || value.id;
        return id === null || id === undefined ? null : id.toString();
    }

    function getSelectedMediaSourceId(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }

        var id = value.MediaSourceId
            || value.mediaSourceId
            || value.SelectedMediaSourceId
            || value.selectedMediaSourceId
            || value.PlaybackMediaSourceId
            || value.playbackMediaSourceId
            || value.SourceId
            || value.sourceId;
        if (id !== null && id !== undefined && id !== '') {
            return id.toString();
        }

        var nestedSource = value.MediaSource || value.mediaSource;
        id = getObjectMediaSourceId(nestedSource);
        if (id) {
            return id;
        }

        var mediaSources = toArray(value.MediaSources || value.mediaSources);
        if (mediaSources.length === 1) {
            return getObjectMediaSourceId(mediaSources[0]);
        }

        return null;
    }

    function combineDynamicRangeHints(currentHint, nextHint) {
        if (nextHint === 'unknown') {
            return currentHint || 'unknown';
        }

        if (!currentHint || currentHint === 'unknown') {
            return nextHint;
        }

        return currentHint === nextHint ? currentHint : 'mixed';
    }

    function getCombinedDynamicRangeHintFromMediaSources(mediaSources) {
        var mediaSourceHint = 'unknown';
        for (var i = 0; i < mediaSources.length; i++) {
            var mediaSource = mediaSources[i];
            if (!mediaSource || typeof mediaSource !== 'object') {
                continue;
            }

            mediaSourceHint = combineDynamicRangeHints(mediaSourceHint, getDynamicRangeHintFromMediaSource(mediaSource));
            if (mediaSourceHint === 'mixed') {
                return 'unknown';
            }
        }

        return mediaSourceHint === 'hdr' || mediaSourceHint === 'sdr' ? mediaSourceHint : 'unknown';
    }

    function getDynamicRangeHintFromMediaSource(mediaSource) {
        if (!mediaSource || typeof mediaSource !== 'object') {
            return 'unknown';
        }

        var hint = getDynamicRangeHintFromObjectFields(mediaSource, [
            'VideoType',
            'videoType',
            'VideoRangeType',
            'videoRangeType',
            'VideoRange',
            'videoRange',
            'DynamicRange',
            'dynamicRange',
            'VideoDoViTitle',
            'videoDoViTitle',
            'ColorTransfer',
            'colorTransfer',
            'DisplayTitle',
            'displayTitle'
        ]);

        var sourceStreams = toArray(mediaSource.MediaStreams || mediaSource.mediaStreams);
        for (var i = 0; i < sourceStreams.length; i++) {
            var sourceStream = sourceStreams[i];
            if (!isVideoMediaStream(sourceStream)) {
                continue;
            }

            hint = combineDynamicRangeHints(hint, getDynamicRangeHintFromVideoStream(sourceStream));
            if (hint === 'mixed') {
                return 'unknown';
            }
        }

        return hint || 'unknown';
    }

    function getDynamicRangeHintFromItem(item, mediaSourceId) {
        if (!item || typeof item !== 'object') {
            return 'unknown';
        }

        var normalizedMediaSourceId = mediaSourceId ? mediaSourceId.toString() : getSelectedMediaSourceId(item);
        var mediaSources = toArray(item.MediaSources || item.mediaSources);
        var selectedMediaSourceMatched = false;
        if (normalizedMediaSourceId && mediaSources.length) {
            for (var sourceIndex = 0; sourceIndex < mediaSources.length; sourceIndex++) {
                var sourceId = getObjectMediaSourceId(mediaSources[sourceIndex]);
                if (sourceId && sourceId === normalizedMediaSourceId) {
                    selectedMediaSourceMatched = true;
                    var selectedSourceHint = getDynamicRangeHintFromMediaSource(mediaSources[sourceIndex]);
                    if (selectedSourceHint !== 'unknown') {
                        return selectedSourceHint;
                    }
                    break;
                }
            }
        }

        if (!normalizedMediaSourceId && mediaSources.length > 1) {
            return getCombinedDynamicRangeHintFromMediaSources(mediaSources);
        }

        if (selectedMediaSourceMatched && mediaSources.length > 1) {
            var selectedMediaStreams = toArray(item.MediaStreams || item.mediaStreams);
            var selectedSawSdr = false;
            for (var selectedStreamIndex = 0; selectedStreamIndex < selectedMediaStreams.length; selectedStreamIndex++) {
                var selectedStream = selectedMediaStreams[selectedStreamIndex];
                if (!isVideoMediaStream(selectedStream)) {
                    continue;
                }

                var selectedStreamHint = getDynamicRangeHintFromVideoStream(selectedStream);
                if (selectedStreamHint === 'hdr') {
                    return 'hdr';
                }
                if (selectedStreamHint === 'sdr') {
                    selectedSawSdr = true;
                }
            }
            return selectedSawSdr ? 'sdr' : 'unknown';
        }

        var fieldKeys = [
            'VideoRangeType',
            'VideoRange',
            'VideoDoViTitle',
            'VideoDoViProfile',
            'VideoDoViLevel',
            'DvProfile',
            'DvLevel',
            'RpuPresentFlag',
            'Hdr10PlusPresentFlag',
            'VideoType',
            'DynamicRange',
            'ColorTransfer',
            'ColorPrimaries',
            'ColorSpace',
            'DisplayTitle',
            'Title',
            'videoRangeType',
            'videoRange',
            'videoDoViTitle',
            'videoDoViProfile',
            'videoDoViLevel',
            'dvProfile',
            'dvLevel',
            'rpuPresentFlag',
            'hdr10PlusPresentFlag',
            'videoType',
            'dynamicRange',
            'colorTransfer',
            'colorPrimaries',
            'colorSpace',
            'displayTitle',
            'title'
        ];

        var sawSdr = false;
        var itemFieldHint = getDynamicRangeHintFromObjectFields(item, fieldKeys);
        if (itemFieldHint === 'hdr') {
            return 'hdr';
        }
        if (itemFieldHint === 'sdr') {
            sawSdr = true;
        }

        if (isHdrDynamicRangeText(item.VideoDoViProfile)
            || isHdrDynamicRangeText(item.videoDoViProfile)
            || isHdrDynamicRangeText(item.DvProfile)
            || isHdrDynamicRangeText(item.dvProfile)
            || isHdrDynamicRangeText(item.VideoDoViLevel)
            || isHdrDynamicRangeText(item.videoDoViLevel)
            || isHdrDynamicRangeText(item.DvLevel)
            || isHdrDynamicRangeText(item.dvLevel)) {
            return 'hdr';
        }

        var mediaStreams = toArray(item.MediaStreams || item.mediaStreams);
        for (var j = 0; j < mediaStreams.length; j++) {
            var stream = mediaStreams[j];
            if (!isVideoMediaStream(stream)) {
                continue;
            }

            var streamHint = getDynamicRangeHintFromVideoStream(stream);
            if (streamHint === 'hdr') {
                return 'hdr';
            }
            if (streamHint === 'sdr') {
                sawSdr = true;
            }
        }

        if (selectedMediaSourceMatched) {
            return sawSdr ? 'sdr' : 'unknown';
        }

        var mediaSourceHint = getCombinedDynamicRangeHintFromMediaSources(mediaSources);
        if (mediaSourceHint !== 'unknown') {
            return mediaSourceHint;
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function getDynamicRangeHintFromMediaInfo(mediaInfo) {
        if (!mediaInfo || typeof mediaInfo !== 'object') {
            return 'unknown';
        }

        var mediaSourceHint = getDynamicRangeHintFromMediaSource(mediaInfo.MediaSource || mediaInfo.mediaSource);
        if (mediaSourceHint !== 'unknown') {
            return mediaSourceHint;
        }

        mediaSourceHint = getDynamicRangeHintFromItem({
            MediaSources: mediaInfo.MediaSources || mediaInfo.mediaSources,
            MediaStreams: mediaInfo.MediaStreams || mediaInfo.mediaStreams
        }, getSelectedMediaSourceId(mediaInfo));
        if (mediaSourceHint !== 'unknown') {
            return mediaSourceHint;
        }

        var keysToInspect = [
            'videoRangeType',
            'VideoRangeType',
            'videoRange',
            'VideoRange',
            'dynamicRange',
            'DynamicRange',
            'videoDoViTitle',
            'VideoDoViTitle',
            'dvProfile',
            'DvProfile',
            'dvLevel',
            'DvLevel',
            'rpuPresentFlag',
            'RpuPresentFlag',
            'hdr10PlusPresentFlag',
            'Hdr10PlusPresentFlag',
            'colorTransfer',
            'ColorTransfer',
            'displayTitle',
            'DisplayTitle'
        ];
        var sawSdr = false;

        for (var i = 0; i < keysToInspect.length; i++) {
            var key = keysToInspect[i];
            if (!Object.prototype.hasOwnProperty.call(mediaInfo, key)) {
                continue;
            }

            var value = mediaInfo[key];
            var hint = getDynamicRangeHintFromMetadataField(key, value);
            if (hint === 'hdr') {
                return 'hdr';
            }
            if (hint === 'sdr') {
                sawSdr = true;
            }
        }

        if (isHdrDoviProfileOrLevel(mediaInfo.videoDoViProfile)
            || isHdrDoviProfileOrLevel(mediaInfo.VideoDoViProfile)
            || isHdrDoviProfileOrLevel(mediaInfo.videoDoViLevel)
            || isHdrDoviProfileOrLevel(mediaInfo.VideoDoViLevel)) {
            return 'hdr';
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function normalizePlaybackVideoDelivery(value) {
        var normalizedValue = value ? value.toString().toLowerCase() : '';
        if (normalizedValue === 'directplay'
            || normalizedValue === 'directstream'
            || normalizedValue === 'copy'
            || normalizedValue === 'transcode') {
            return normalizedValue;
        }
        return 'unknown';
    }

    function isPlaybackVideoCopiedOrDirect(delivery) {
        delivery = normalizePlaybackVideoDelivery(delivery);
        return delivery === 'directplay'
            || delivery === 'directstream'
            || delivery === 'copy';
    }

    function getPlaybackInfoMediaSources(payload) {
        var sources = [];
        var groups = [
            payload,
            payload && payload.Item,
            payload && payload.item,
            payload && payload.NowPlayingItem,
            payload && payload.nowPlayingItem
        ];

        for (var i = 0; i < groups.length; i++) {
            var group = groups[i];
            if (!group || typeof group !== 'object') {
                continue;
            }

            var mediaSources = toArray(group.MediaSources || group.mediaSources);
            for (var j = 0; j < mediaSources.length; j++) {
                if (sources.indexOf(mediaSources[j]) === -1) {
                    sources.push(mediaSources[j]);
                }
            }
        }

        return sources;
    }

    function getSelectedPlaybackInfoMediaSource(payload, mediaSourceId) {
        var mediaSources = getPlaybackInfoMediaSources(payload);
        if (!mediaSources.length) {
            return null;
        }

        var normalizedMediaSourceId = mediaSourceId ? mediaSourceId.toString() : getSelectedMediaSourceId(payload);
        if (normalizedMediaSourceId) {
            for (var i = 0; i < mediaSources.length; i++) {
                var candidateId = getObjectMediaSourceId(mediaSources[i]);
                if (candidateId && candidateId === normalizedMediaSourceId) {
                    return mediaSources[i];
                }
            }
        }

        return mediaSources[0];
    }

    function isTruthyPlaybackQueryValue(value) {
        if (value === true) {
            return true;
        }
        if (value === false || value === null || value === undefined || value === '') {
            return false;
        }

        var normalizedValue = value.toString().toLowerCase();
        return normalizedValue === '1'
            || normalizedValue === 'true'
            || normalizedValue === 'yes'
            || normalizedValue === 'on';
    }

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getQueryParameterValue(url, name) {
        if (!url || typeof url !== 'string' || !name) {
            return null;
        }

        var pattern = new RegExp('[?&]' + escapeRegExp(name) + '=([^&#]*)');
        var match = pattern.exec(url);
        if (!match || match.length < 2) {
            return null;
        }

        try {
            return decodeURIComponent(match[1].replace(/\+/g, '%20'));
        } catch (error) {
            return match[1];
        }
    }

    function getPlaybackVideoDeliveryFromTranscodingUrl(url) {
        if (!url || typeof url !== 'string') {
            return 'unknown';
        }

        if (isTruthyPlaybackQueryValue(getQueryParameterValue(url, 'Static'))
            || isTruthyPlaybackQueryValue(getQueryParameterValue(url, 'static'))) {
            return 'directstream';
        }

        var videoCodec = getQueryParameterValue(url, 'VideoCodec')
            || getQueryParameterValue(url, 'videoCodec')
            || getQueryParameterValue(url, 'videocodec');
        if (!videoCodec) {
            return 'unknown';
        }

        return videoCodec.toString().toLowerCase() === 'copy' ? 'copy' : 'transcode';
    }

    function getLowerName(value) {
        return value ? value.toString().toLowerCase() : '';
    }

    function getPlaybackVideoDeliveryFromMediaSource(mediaSource) {
        if (!mediaSource || typeof mediaSource !== 'object') {
            return 'unknown';
        }

        var transcodingUrl = mediaSource.TranscodingUrl || mediaSource.transcodingUrl;
        var transcodingUrlDelivery = getPlaybackVideoDeliveryFromTranscodingUrl(transcodingUrl);
        if (transcodingUrlDelivery !== 'unknown') {
            return transcodingUrlDelivery;
        }

        var playMethod = getLowerName(mediaSource.PlayMethod || mediaSource.playMethod);
        if (playMethod === 'directplay') {
            return 'directplay';
        }
        if (playMethod === 'directstream') {
            return 'directstream';
        }
        if (playMethod === 'transcode') {
            return 'transcode';
        }

        var directStreamUrl = mediaSource.DirectStreamUrl || mediaSource.directStreamUrl;
        if (directStreamUrl) {
            return 'directstream';
        }

        if (isTruthyPlaybackQueryValue(mediaSource.SupportsDirectPlay)
            || isTruthyPlaybackQueryValue(mediaSource.supportsDirectPlay)) {
            return 'directplay';
        }

        if (isTruthyPlaybackQueryValue(mediaSource.SupportsDirectStream)
            || isTruthyPlaybackQueryValue(mediaSource.supportsDirectStream)) {
            return 'directstream';
        }

        return 'unknown';
    }

    function getPlaybackVideoDeliveryFromPlaybackInfoPayload(payload, mediaSourceId) {
        return getPlaybackVideoDeliveryFromMediaSource(getSelectedPlaybackInfoMediaSource(payload, mediaSourceId));
    }

    function getDynamicRangeHintFromPlaybackInfoPayload(payload, mediaSourceId) {
        if (!payload || typeof payload !== 'object') {
            return 'unknown';
        }

        var selectedMediaSourceId = mediaSourceId || getSelectedMediaSourceId(payload);
        var hint = getDynamicRangeHintFromItem(payload.NowPlayingItem, selectedMediaSourceId);
        if (hint !== 'unknown') {
            return hint;
        }

        hint = getDynamicRangeHintFromItem(payload.Item, selectedMediaSourceId);
        if (hint !== 'unknown') {
            return hint;
        }

        hint = getDynamicRangeHintFromItem({
            MediaSources: payload.MediaSources || payload.mediaSources,
            MediaStreams: payload.MediaStreams || payload.mediaStreams,
            VideoRangeType: payload.VideoRangeType,
            VideoRange: payload.VideoRange,
            VideoDoViTitle: payload.VideoDoViTitle,
            VideoDoViProfile: payload.VideoDoViProfile,
            VideoDoViLevel: payload.VideoDoViLevel,
            DvProfile: payload.DvProfile,
            DvLevel: payload.DvLevel,
            RpuPresentFlag: payload.RpuPresentFlag,
            Hdr10PlusPresentFlag: payload.Hdr10PlusPresentFlag,
            VideoType: payload.VideoType,
            DynamicRange: payload.DynamicRange,
            ColorTransfer: payload.ColorTransfer,
            ColorPrimaries: payload.ColorPrimaries,
            ColorSpace: payload.ColorSpace,
            DisplayTitle: payload.DisplayTitle,
            videoRangeType: payload.videoRangeType,
            videoRange: payload.videoRange,
            videoDoViTitle: payload.videoDoViTitle,
            videoDoViProfile: payload.videoDoViProfile,
            videoDoViLevel: payload.videoDoViLevel,
            dvProfile: payload.dvProfile,
            dvLevel: payload.dvLevel,
            rpuPresentFlag: payload.rpuPresentFlag,
            hdr10PlusPresentFlag: payload.hdr10PlusPresentFlag,
            videoType: payload.videoType,
            dynamicRange: payload.dynamicRange,
            colorTransfer: payload.colorTransfer,
            colorPrimaries: payload.colorPrimaries,
            colorSpace: payload.colorSpace,
            displayTitle: payload.displayTitle
        }, selectedMediaSourceId);
        if (hint !== 'unknown') {
            return hint;
        }

        return getDynamicRangeHintFromItem(payload, selectedMediaSourceId);
    }

    Runtime.define('playback.hdrDecisions', {
        normalizeDynamicRangeText: normalizeDynamicRangeText,
        isHdrDynamicRangeText: isHdrDynamicRangeText,
        isSdrDynamicRangeText: isSdrDynamicRangeText,
        getDynamicRangeHintFromMetadataField: getDynamicRangeHintFromMetadataField,
        getDynamicRangeHintFromObjectFields: getDynamicRangeHintFromObjectFields,
        getDynamicRangeHintFromMediaInfo: getDynamicRangeHintFromMediaInfo,
        getDynamicRangeHintFromVideoStream: getDynamicRangeHintFromVideoStream,
        getDynamicRangeHintFromMediaSource: getDynamicRangeHintFromMediaSource,
        getDynamicRangeHintFromItem: getDynamicRangeHintFromItem,
        getDynamicRangeHintFromPlaybackInfoPayload: getDynamicRangeHintFromPlaybackInfoPayload,
        getSelectedMediaSourceId: getSelectedMediaSourceId,
        getSelectedPlaybackInfoMediaSource: getSelectedPlaybackInfoMediaSource,
        toArray: toArray,
        normalizePlaybackVideoDelivery: normalizePlaybackVideoDelivery,
        isPlaybackVideoCopiedOrDirect: isPlaybackVideoCopiedOrDirect,
        getPlaybackVideoDeliveryFromTranscodingUrl: getPlaybackVideoDeliveryFromTranscodingUrl,
        getPlaybackVideoDeliveryFromMediaSource: getPlaybackVideoDeliveryFromMediaSource,
        getPlaybackVideoDeliveryFromPlaybackInfoPayload: getPlaybackVideoDeliveryFromPlaybackInfoPayload,
        combineDynamicRangeHints: combineDynamicRangeHints
    });
})(window);
