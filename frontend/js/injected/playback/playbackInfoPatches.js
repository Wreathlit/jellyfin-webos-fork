/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};
    var DEFAULT_MAX_BITRATE_PARAM = 'MaxStreamingBitrate';
    // URL reading lives in core.urls so every module answers the same way about
    // the same URL; see that module for what the copies used to disagree on.
    function getUrlHelpers() {
        return Runtime.get('core.urls');
    }

    function escapeRegExp(value) {
        var helpers = getUrlHelpers();
        return helpers ? helpers.escapeRegExp(value) : value;
    }

    function splitUrlComponents(url) {
        var helpers = getUrlHelpers();
        return helpers ? helpers.splitUrlComponents(url) : { base: url, query: '', hash: '' };
    }

    function getQueryParameterValue(url, name) {
        var helpers = getUrlHelpers();
        return helpers ? helpers.getQueryParameterValue(url, name) : null;
    }

    function getUrlPathname(url) {
        var helpers = getUrlHelpers();
        return helpers ? helpers.getUrlPathname(url) : '';
    }


    function parsePositiveInteger(value) {
        var parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return 0;
        }
        return parsed;
    }

    function isPlaybackInfoUrl(url) {
        return extractItemIdFromPlaybackInfoUrl(url) !== null;
    }

    function getHighestQueryParameterInteger(url, name) {
        if (!url || typeof url !== 'string' || !name) {
            return 0;
        }

        var query = splitUrlComponents(url).query;
        var pattern = new RegExp('(?:^|&)' + escapeRegExp(name) + '=([^&]*)', 'g');
        var highest = 0;
        var match;
        while ((match = pattern.exec(query)) !== null) {
            var value = match.length > 1 ? match[1] : '';
            try {
                value = decodeURIComponent(value.replace(/\+/g, '%20'));
            } catch (error) {
                // Keep the raw value if decoding fails.
            }

            var parsed = parsePositiveInteger(value);
            if (parsed > highest) {
                highest = parsed;
            }
        }
        return highest;
    }

    function setQueryParameterValue(url, name, value) {
        if (!url || typeof url !== 'string' || !name) {
            return url;
        }

        var components = splitUrlComponents(url);
        var query = components.query;
        var encodedValue = encodeURIComponent(value.toString());
        var encodedName = encodeURIComponent(name);
        var pattern = new RegExp('(^|&)' + escapeRegExp(encodedName) + '=.*?(?=&|$)', 'g');

        if (pattern.test(query)) {
            query = query.replace(pattern, '$1' + encodedName + '=' + encodedValue);
        } else {
            query += (query ? '&' : '') + encodedName + '=' + encodedValue;
        }

        return components.base + '?' + query + components.hash;
    }

    function extractItemIdFromPlaybackInfoUrl(url) {
        var pathname = getUrlPathname(url);
        var match = /(?:^|\/)Items\/([^\/\?#]+)\/PlaybackInfo\/?$/i.exec(pathname);
        if (!match || !match[1]) {
            return null;
        }

        var itemId = match[1];
        try {
            itemId = decodeURIComponent(itemId);
        } catch (error) {
            // Ignore malformed URI fragments and use raw value.
        }
        if (itemId === '.' || itemId === '..') {
            return null;
        }
        return itemId;
    }

    function enforceMaxBitrateUrl(url, maxBitrate, bitrateParamName) {
        if (!isPlaybackInfoUrl(url)) {
            return {
                url: url,
                targetBitrate: 0,
                itemId: null
            };
        }

        var targetBitrate = parsePositiveInteger(maxBitrate);
        var existingBitrate = getHighestQueryParameterInteger(url, bitrateParamName || DEFAULT_MAX_BITRATE_PARAM);
        var existingDefaultBitrate = getHighestQueryParameterInteger(url, DEFAULT_MAX_BITRATE_PARAM);
        var existingCamelCaseBitrate = getHighestQueryParameterInteger(url, 'maxStreamingBitrate');
        if (existingBitrate > targetBitrate) {
            targetBitrate = existingBitrate;
        }
        if (existingDefaultBitrate > targetBitrate) {
            targetBitrate = existingDefaultBitrate;
        }
        if (existingCamelCaseBitrate > targetBitrate) {
            targetBitrate = existingCamelCaseBitrate;
        }

        if (!targetBitrate) {
            return {
                url: url,
                targetBitrate: 0,
                itemId: extractItemIdFromPlaybackInfoUrl(url)
            };
        }

        var patchedUrl = setQueryParameterValue(url, bitrateParamName || DEFAULT_MAX_BITRATE_PARAM, targetBitrate);
        patchedUrl = setQueryParameterValue(patchedUrl, DEFAULT_MAX_BITRATE_PARAM, targetBitrate);
        patchedUrl = setQueryParameterValue(patchedUrl, 'maxStreamingBitrate', targetBitrate);

        return {
            url: patchedUrl,
            targetBitrate: targetBitrate,
            itemId: extractItemIdFromPlaybackInfoUrl(url)
        };
    }

    function hasStoredConcreteVideoQualitySelection(storage) {
        // Jellyfin Web stores one automatic-detection flag per network
        // context. The key suffix is IsInNetwork; the value is "true" for
        // Auto and "false" for a concrete bitrate.
        if (!storage || typeof storage.getItem !== 'function') {
            return false;
        }

        var keys = [
            'enableautobitratebitrate-Video-true',
            'enableautobitratebitrate-Video-false'
        ];
        for (var i = 0; i < keys.length; i++) {
            if (storage.getItem(keys[i]) === 'false') {
                return true;
            }
        }

        return false;
    }

    function debugLog(options) {
        if (!options || typeof options.debugLog !== 'function') {
            return;
        }

        var args = [];
        for (var i = 1; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        options.debugLog.apply(null, args);
    }

    function hasVisitedObject(visited, value) {
        for (var i = 0; i < visited.length; i++) {
            if (visited[i] === value) {
                return true;
            }
        }
        return false;
    }

    function patchPlaybackInfoBitrateObject(value, normalizedTarget, options, visited) {
        if (!value || typeof value !== 'object') {
            return false;
        }

        visited = visited || [];
        if (hasVisitedObject(visited, value)) {
            return false;
        }
        visited.push(value);

        var source = options && options.source ? options.source : '';
        var keys = ['MaxStreamingBitrate', 'maxStreamingBitrate', 'MaxStaticBitrate', 'maxStaticBitrate'];
        var effectiveTarget = normalizedTarget;
        for (var i = 0; i < keys.length; i++) {
            var existingBitrate = parsePositiveInteger(value[keys[i]]);
            if (existingBitrate > effectiveTarget) {
                effectiveTarget = existingBitrate;
            }
        }

        var changed = false;
        for (var j = 0; j < keys.length; j++) {
            var key = keys[j];
            var currentBitrate = parsePositiveInteger(value[key]);
            if (currentBitrate < effectiveTarget) {
                value[key] = effectiveTarget;
                changed = true;
                debugLog(options, 'Patched PlaybackInfo body bitrate (' + source + ', ' + key + '): ' + currentBitrate + ' -> ' + effectiveTarget);
            }
        }

        var nestedKeys = ['PlaybackInfo', 'playbackInfo', 'PlaybackInfoDto', 'playbackInfoDto', 'DeviceProfile', 'deviceProfile', 'Profile', 'profile'];
        for (var nestedIndex = 0; nestedIndex < nestedKeys.length; nestedIndex++) {
            if (patchPlaybackInfoBitrateObject(value[nestedKeys[nestedIndex]], normalizedTarget, options, visited)) {
                changed = true;
            }
        }

        return changed;
    }

    function toArray(value) {
        return value && Object.prototype.toString.call(value) === '[object Array]' ? value : [];
    }

    function getMediaSources(payload) {
        if (!payload || typeof payload !== 'object') {
            return [];
        }
        return toArray(payload.MediaSources || payload.mediaSources);
    }

    // Delegates to core.mediaStreams; see the note there on why the whole bundle
    // has to agree on this rather than keeping a copy per module.
    function isSubtitleMediaStream(stream) {
        var streams = Runtime.get('core.mediaStreams');
        return streams ? streams.isSubtitleMediaStream(stream) : false;
    }

    function isClientRenderedDeliveryMethod(value) {
        var normalizedValue = value ? value.toString().toLowerCase() : '';
        return normalizedValue === 'external' || normalizedValue === 'hls';
    }

    function getMediaSourceVideoDelivery(mediaSource) {
        var Runtime = window.__JellyfinWebOSPatchRuntime;
        var decisions = Runtime && Runtime.get ? Runtime.get('playback.hdrDecisions') : null;
        return decisions && decisions.getPlaybackVideoDeliveryFromMediaSource
            ? decisions.getPlaybackVideoDeliveryFromMediaSource(mediaSource)
            : 'unknown';
    }

    function mediaSourceAlwaysBurnsSubtitleWhenTranscoding(mediaSource) {
        if (!mediaSource || typeof mediaSource !== 'object') {
            return false;
        }

        var transcodingUrl = mediaSource.TranscodingUrl || mediaSource.transcodingUrl;
        var value = getQueryParameterValue(transcodingUrl, 'alwaysBurnInSubtitleWhenTranscoding');
        value = value === null || value === undefined ? '' : value.toString().toLowerCase();
        return value === 'true' || value === '1';
    }

    function hasAlwaysBurnInSubtitleTranscodingUrl(payload) {
        var mediaSources = getMediaSources(payload);
        for (var i = 0; i < mediaSources.length; i++) {
            if (mediaSourceAlwaysBurnsSubtitleWhenTranscoding(mediaSources[i])) {
                return true;
            }
        }
        return false;
    }

    function patchBurnedInSubtitleDelivery(payload, options) {
        // Jellyfin's StreamInfo.ToUrl() appends SubtitleStreamIndex whenever
        // AlwaysBurnInSubtitleWhenTranscoding is set, even for a subtitle the
        // device profile claimed as External. For a real video encode,
        // EncodingHelper then burns the subtitle because the always-burn flag
        // is set, while the PlaybackInfo MediaStream is still advertised as
        // External, so Jellyfin Web renders a second copy on top. Upstream
        // compensates in htmlVideoPlayer.setCurrentTrackElement by re-reading
        // the session and forcing Encode when TranscodingInfo says the video is
        // not direct, but that lookup races playback start on webOS.
        //
        // The response says so itself: since 10.10, MediaInfoHelper appends
        // `&alwaysBurnInSubtitleWhenTranscoding=true` to every TranscodingUrl
        // it builds under `if (streamInfo.AlwaysBurnInSubtitleWhenTranscoding)`.
        // Reading that avoids racing a later settings change and keeps the
        // decision local to the media source it actually describes.
        //
        // Do not add a localStorage fallback for servers that do not echo it.
        // 10.9 and older have no AlwaysBurnInSubtitleWhenTranscoding at all
        // (the property is absent from MediaOptions), so they never burn the
        // subtitle in and there is nothing to de-duplicate; forcing Encode
        // there would drop the client-side render and leave no subtitle at all.
        // The only servers that can produce the duplicate are the ones that
        // announce it here.

        var mediaSources = getMediaSources(payload);
        var patchedStreams = 0;
        for (var i = 0; i < mediaSources.length; i++) {
            var mediaSource = mediaSources[i];
            if (!mediaSource || typeof mediaSource !== 'object') {
                continue;
            }
            if (!mediaSourceAlwaysBurnsSubtitleWhenTranscoding(mediaSource)) {
                continue;
            }
            if (getMediaSourceVideoDelivery(mediaSource) !== 'transcode') {
                continue;
            }

            var streams = toArray(mediaSource.MediaStreams || mediaSource.mediaStreams);
            for (var j = 0; j < streams.length; j++) {
                var stream = streams[j];
                if (!isSubtitleMediaStream(stream)) {
                    continue;
                }

                var deliveryMethodKey = Object.prototype.hasOwnProperty.call(stream, 'DeliveryMethod')
                    ? 'DeliveryMethod'
                    : 'deliveryMethod';
                if (!isClientRenderedDeliveryMethod(stream[deliveryMethodKey])) {
                    continue;
                }

                stream[deliveryMethodKey] = 'Encode';
                patchedStreams++;
            }
        }

        if (patchedStreams) {
            debugLog(options, 'Forced Encode subtitle delivery for burned-in video transcode ('
                + (options.source || '') + '): ' + patchedStreams);
        }
        return patchedStreams > 0;
    }

    function looksLikeDeviceProfile(value) {
        return !!(value && typeof value === 'object'
            && (Object.prototype.hasOwnProperty.call(value, 'DirectPlayProfiles')
                || Object.prototype.hasOwnProperty.call(value, 'CodecProfiles')
                || Object.prototype.hasOwnProperty.call(value, 'TranscodingProfiles')
                || Object.prototype.hasOwnProperty.call(value, 'SubtitleProfiles')));
    }

    function getProfilePatchSnapshot(value) {
        // Change detection for the string-body path diffs this snapshot before/after the
        // profile transform, so it must cover every DeviceProfile field the transform
        // mutates. If a future profile patch starts touching another field, add it here
        // (or have the transform report mutation explicitly) so the change is not missed.
        try {
            return JSON.stringify({
                MaxStreamingBitrate: value.MaxStreamingBitrate,
                MaxStaticBitrate: value.MaxStaticBitrate,
                DirectPlayProfiles: value.DirectPlayProfiles,
                CodecProfiles: value.CodecProfiles,
                SubtitleProfiles: value.SubtitleProfiles,
                TranscodingProfiles: value.TranscodingProfiles
            });
        } catch (error) {
            return null;
        }
    }

    function patchPlaybackInfoProfileObjects(value, options, visited) {
        if (!value || typeof value !== 'object') {
            return false;
        }

        visited = visited || [];
        if (hasVisitedObject(visited, value)) {
            return false;
        }
        visited.push(value);

        var changed = false;
        var source = options && options.source ? options.source : '';
        var patchProfile = options && typeof options.patchProfile === 'function' ? options.patchProfile : null;
        if (patchProfile && looksLikeDeviceProfile(value)) {
            var beforeProfile = getProfilePatchSnapshot(value);
            patchProfile(value);
            changed = getProfilePatchSnapshot(value) !== beforeProfile;
        }

        for (var key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }
            if (patchPlaybackInfoProfileObjects(value[key], options, visited)) {
                changed = true;
            }
        }

        if (changed && source) {
            debugLog(options, 'Patched PlaybackInfo device profile for playback compatibility (' + source + ')');
        }
        return changed;
    }

    function isPatchablePlaybackInfoBody(value) {
        if (!value || typeof value !== 'object') {
            return false;
        }
        var tag = Object.prototype.toString.call(value);
        return tag === '[object Object]' || tag === '[object Array]';
    }

    function enforceMaxBitrateBody(body, targetBitrate, options) {
        var normalizedTarget = parsePositiveInteger(targetBitrate);
        if (body === null || body === undefined) {
            return body;
        }

        if (typeof body === 'string') {
            var trimmed = body.replace(/^\s+|\s+$/g, '');
            if (!trimmed || trimmed.charAt(0) !== '{') {
                return body;
            }

            try {
                var parsed = JSON.parse(trimmed);
                if (!parsed || typeof parsed !== 'object') {
                    return body;
                }

                var changed = normalizedTarget
                    ? patchPlaybackInfoBitrateObject(parsed, normalizedTarget, options)
                    : false;
                changed = patchPlaybackInfoProfileObjects(parsed, options) || changed;
                if (!changed) {
                    return body;
                }
                return JSON.stringify(parsed);
            } catch (error) {
                return body;
            }
        }

        // Only a plain object or array is a body this can rewrite in place. A
        // Blob, FormData, URLSearchParams, ArrayBuffer, typed array or stream is
        // serialized by the caller, so writing bitrate properties onto it changed
        // nothing that was sent while reporting success -- and walking a typed
        // array's enumerable keys is an O(n) loop on the main thread inside
        // fetch()/send().
        if (isPatchablePlaybackInfoBody(body)) {
            if (normalizedTarget) {
                patchPlaybackInfoBitrateObject(body, normalizedTarget, options);
            }
            patchPlaybackInfoProfileObjects(body, options);
        }

        return body;
    }

    Runtime.define('playback.playbackInfoPatches', {
        parsePositiveInteger: parsePositiveInteger,
        isPlaybackInfoUrl: isPlaybackInfoUrl,
        getUrlPathname: getUrlPathname,
        getQueryParameterValue: getQueryParameterValue,
        getHighestQueryParameterInteger: getHighestQueryParameterInteger,
        setQueryParameterValue: setQueryParameterValue,
        extractItemIdFromPlaybackInfoUrl: extractItemIdFromPlaybackInfoUrl,
        enforceMaxBitrateUrl: enforceMaxBitrateUrl,
        hasStoredConcreteVideoQualitySelection: hasStoredConcreteVideoQualitySelection,
        patchPlaybackInfoBitrateObject: patchPlaybackInfoBitrateObject,
        mediaSourceAlwaysBurnsSubtitleWhenTranscoding: mediaSourceAlwaysBurnsSubtitleWhenTranscoding,
        hasAlwaysBurnInSubtitleTranscodingUrl: hasAlwaysBurnInSubtitleTranscodingUrl,
        patchBurnedInSubtitleDelivery: patchBurnedInSubtitleDelivery,
        looksLikeDeviceProfile: looksLikeDeviceProfile,
        patchPlaybackInfoProfileObjects: patchPlaybackInfoProfileObjects,
        enforceMaxBitrateBody: enforceMaxBitrateBody
    });
})(window);
