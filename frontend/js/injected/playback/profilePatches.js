/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};
    var LPCM_AUDIO_COPY_CODECS = [
        'pcm_s16le',
        'pcm_s24le',
        'pcm_bluray',
        'pcm_dvd'
    ];

    function parsePositiveInteger(value) {
        var parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return 0;
        }
        return parsed;
    }

    function normalizeOptions(options) {
        options = options || {};
        return {
            maxBitrate: parsePositiveInteger(options.maxBitrate),
            lpcmAudioCopyEnabled: !!options.lpcmAudioCopyEnabled,
            debugLog: typeof options.debugLog === 'function' ? options.debugLog : null
        };
    }

    function debugLog(context) {
        if (!context || !context.debugLog) {
            return;
        }

        var args = [];
        for (var i = 1; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        context.debugLog.apply(null, args);
    }

    function parseCommaSeparatedList(value) {
        if (!value || typeof value !== 'string') {
            return [];
        }

        var parts = value.split(',');
        var result = [];
        for (var i = 0; i < parts.length; i++) {
            var token = parts[i];
            if (!token) {
                continue;
            }

            token = token.replace(/^\s+|\s+$/g, '');
            if (token) {
                result.push(token);
            }
        }

        return result;
    }

    function removeValuesFromList(listValue, disallowedValuesMap) {
        var parsed = parseCommaSeparatedList(listValue);
        if (!parsed.length) {
            return {
                value: listValue,
                changed: false
            };
        }

        var filtered = [];
        var changed = false;
        for (var i = 0; i < parsed.length; i++) {
            var token = parsed[i];
            if (disallowedValuesMap[token.toLowerCase()]) {
                changed = true;
                continue;
            }
            filtered.push(token);
        }

        return {
            value: filtered.join(','),
            changed: changed
        };
    }

    function addValuesToList(listValue, valuesToAdd) {
        var parsed = parseCommaSeparatedList(listValue);
        var seen = {};
        var changed = false;

        for (var i = 0; i < parsed.length; i++) {
            seen[parsed[i].toLowerCase()] = true;
        }

        for (var j = 0; j < valuesToAdd.length; j++) {
            var value = valuesToAdd[j];
            if (!value || seen[value.toLowerCase()]) {
                continue;
            }

            parsed.push(value);
            seen[value.toLowerCase()] = true;
            changed = true;
        }

        return {
            value: parsed.join(','),
            changed: changed
        };
    }

    function getProfileTypeName(value) {
        return value ? value.toString().toLowerCase() : '';
    }

    function hasSubtitleProfile(profile, format, method) {
        if (!profile || !profile.SubtitleProfiles) {
            return false;
        }

        var normalizedFormat = format.toString().toLowerCase();
        var normalizedMethod = method.toString().toLowerCase();
        for (var i = 0; i < profile.SubtitleProfiles.length; i++) {
            var subtitleProfile = profile.SubtitleProfiles[i];
            if (!subtitleProfile) {
                continue;
            }

            if (getProfileTypeName(subtitleProfile.Format) === normalizedFormat
                && getProfileTypeName(subtitleProfile.Method) === normalizedMethod) {
                return true;
            }
        }

        return false;
    }

    function addSubtitleProfile(profile, format, method) {
        if (!profile || !format || !method) {
            return false;
        }

        if (!profile.SubtitleProfiles) {
            profile.SubtitleProfiles = [];
        }

        if (hasSubtitleProfile(profile, format, method)) {
            return false;
        }

        profile.SubtitleProfiles.push({
            Format: format,
            Method: method
        });
        return true;
    }

    function isBitmapPgsSubtitleProfileFormat(format) {
        var normalizedFormat = getProfileTypeName(format);
        return normalizedFormat === 'pgssub'
            || normalizedFormat === 'pgs'
            || normalizedFormat === 'hdmv_pgs_subtitle';
    }

    function preferExternalSubtitleProfilesForBitmapPgs(profile, context) {
        if (!profile || !profile.SubtitleProfiles
            || Object.prototype.toString.call(profile.SubtitleProfiles) !== '[object Array]') {
            return;
        }

        // This is device capability reporting, not a local burn-in override.
        // Jellyfin still applies AlwaysBurnInSubtitleWhenTranscoding later when
        // it builds the transcode URL. Without this, an Embed/Encode PGS profile
        // can win before the client-rendered External path, which loses PGS
        // delivery and can pull HDR video-copy playback into video encoding.
        var patchedProfiles = 0;
        for (var i = 0; i < profile.SubtitleProfiles.length; i++) {
            var subtitleProfile = profile.SubtitleProfiles[i];
            if (!subtitleProfile || !isBitmapPgsSubtitleProfileFormat(subtitleProfile.Format)) {
                continue;
            }
            if (getProfileTypeName(subtitleProfile.Method) === 'external') {
                continue;
            }

            subtitleProfile.Method = 'External';
            patchedProfiles++;
        }

        if (patchedProfiles) {
            debugLog(context, 'Preferred External SubtitleProfile method for PGS profile(s):', patchedProfiles);
        }
    }

    function hasH264Codec(codecValue) {
        var codecs = parseCommaSeparatedList(codecValue);
        for (var i = 0; i < codecs.length; i++) {
            var codec = codecs[i].toLowerCase();
            if (codec === 'h264' || codec === 'avc') {
                return true;
            }
        }
        return false;
    }

    function getDirectPlayVideoCodecMap(profile) {
        var result = {};
        if (!profile || !profile.DirectPlayProfiles) {
            return result;
        }

        for (var i = 0; i < profile.DirectPlayProfiles.length; i++) {
            var directPlayProfile = profile.DirectPlayProfiles[i];
            if (!directPlayProfile || getProfileTypeName(directPlayProfile.Type) !== 'video') {
                continue;
            }

            var codecs = parseCommaSeparatedList(directPlayProfile.VideoCodec);
            for (var j = 0; j < codecs.length; j++) {
                result[codecs[j].toLowerCase()] = true;
            }
        }

        return result;
    }

    function getCopyableVideoCodecsForAudioTranscode(profile) {
        // Only promote video-copy codecs that survived the current device
        // profile's video capability checks. If the TV cannot direct play a
        // codec, audio-only transcode must not force that video codec to copy.
        var directPlayVideoCodecs = getDirectPlayVideoCodecMap(profile);
        var result = [];
        var candidates = ['hevc', 'h265'];
        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            if (directPlayVideoCodecs[candidate]) {
                result.push(candidate);
            }
        }
        return result;
    }

    function hasIsInterlacedCondition(conditions) {
        if (!conditions || !conditions.length) {
            return false;
        }

        for (var i = 0; i < conditions.length; i++) {
            var condition = conditions[i];
            if (!condition || !condition.Property) {
                continue;
            }

            if (condition.Property.toString().toLowerCase() === 'isinterlaced') {
                return true;
            }
        }

        return false;
    }

    function patchDirectPlayProfilesForProblematicFormats(profile, context) {
        if (!profile || !profile.DirectPlayProfiles || !profile.DirectPlayProfiles.length) {
            return;
        }

        var disallowedContainers = {
            dvd: true,
            vob: true,
            vro: true,
            mpg: true,
            mpeg: true
        };
        var disallowedVideoCodecs = {
            mpeg1video: true,
            mpeg2video: true
        };

        var removedProfiles = 0;
        var patchedProfiles = 0;
        for (var i = profile.DirectPlayProfiles.length - 1; i >= 0; i--) {
            var directPlayProfile = profile.DirectPlayProfiles[i];
            if (!directPlayProfile || !directPlayProfile.Type || directPlayProfile.Type.toString().toLowerCase() !== 'video') {
                continue;
            }

            var hadContainerList = typeof directPlayProfile.Container === 'string' && parseCommaSeparatedList(directPlayProfile.Container).length > 0;
            var hadVideoCodecList = typeof directPlayProfile.VideoCodec === 'string' && parseCommaSeparatedList(directPlayProfile.VideoCodec).length > 0;
            var changed = false;

            var containerResult = removeValuesFromList(directPlayProfile.Container, disallowedContainers);
            if (containerResult.changed) {
                directPlayProfile.Container = containerResult.value;
                changed = true;
            }

            var codecResult = removeValuesFromList(directPlayProfile.VideoCodec, disallowedVideoCodecs);
            if (codecResult.changed) {
                directPlayProfile.VideoCodec = codecResult.value;
                changed = true;
            }

            var hasContainerList = typeof directPlayProfile.Container === 'string' && parseCommaSeparatedList(directPlayProfile.Container).length > 0;
            var hasVideoCodecList = typeof directPlayProfile.VideoCodec === 'string' && parseCommaSeparatedList(directPlayProfile.VideoCodec).length > 0;
            if ((hadContainerList && !hasContainerList) || (hadVideoCodecList && !hasVideoCodecList)) {
                profile.DirectPlayProfiles.splice(i, 1);
                removedProfiles++;
                continue;
            }

            if (changed) {
                patchedProfiles++;
            }
        }

        if (patchedProfiles || removedProfiles) {
            debugLog(context, 'Patched direct play profile(s) for DVD/MPEG compatibility. patched=' + patchedProfiles + ', removed=' + removedProfiles);
        }
    }

    function patchH264InterlaceSupport(profile, context) {
        if (!profile || !profile.CodecProfiles) {
            return;
        }

        var patchedCodecProfiles = 0;
        for (var i = 0; i < profile.CodecProfiles.length; i++) {
            var codecProfile = profile.CodecProfiles[i];
            if (!codecProfile || (codecProfile.Type && codecProfile.Type.toString().toLowerCase() !== 'video')) {
                continue;
            }

            if (!hasH264Codec(codecProfile.Codec)) {
                continue;
            }

            if (!codecProfile.Conditions) {
                codecProfile.Conditions = [];
            }

            if (hasIsInterlacedCondition(codecProfile.Conditions)) {
                continue;
            }

            codecProfile.Conditions.push({
                Condition: 'NotEquals',
                Property: 'IsInterlaced',
                Value: 'true',
                IsRequired: false
            });
            patchedCodecProfiles++;
        }

        if (patchedCodecProfiles) {
            debugLog(context, 'Added non-interlaced H264 condition to codec profile(s):', patchedCodecProfiles);
        }
    }

    function patchExternalSubtitleProfiles(profile, context) {
        var added = 0;
        var formats = ['ass', 'ssa', 'pgssub', 'pgs'];
        for (var i = 0; i < formats.length; i++) {
            if (addSubtitleProfile(profile, formats[i], 'External')) {
                added++;
            }
        }

        if (added) {
            debugLog(context, 'Added external subtitle profile(s) for client-side rendering:', added);
        }
    }

    function patchHlsSubtitleManifestSupport(profile, context) {
        if (!profile || !profile.TranscodingProfiles || !profile.TranscodingProfiles.length) {
            return;
        }

        var patchedProfiles = 0;
        for (var i = 0; i < profile.TranscodingProfiles.length; i++) {
            var transcodingProfile = profile.TranscodingProfiles[i];
            if (!transcodingProfile
                || getProfileTypeName(transcodingProfile.Type) !== 'video'
                || getProfileTypeName(transcodingProfile.Protocol) !== 'hls') {
                continue;
            }

            if (transcodingProfile.EnableSubtitlesInManifest !== true) {
                transcodingProfile.EnableSubtitlesInManifest = true;
                patchedProfiles++;
            }
        }

        if (patchedProfiles) {
            debugLog(context, 'Enabled HLS subtitle manifest support for video transcoding profile(s):', patchedProfiles);
        }
    }

    function patchVideoTranscodingProfilesForAudioOnlyTranscode(profile, context) {
        if (!profile || !profile.TranscodingProfiles || !profile.TranscodingProfiles.length) {
            return;
        }

        var copyVideoCodecs = getCopyableVideoCodecsForAudioTranscode(profile);
        if (!copyVideoCodecs.length) {
            return;
        }

        var patchedProfiles = 0;
        for (var j = 0; j < profile.TranscodingProfiles.length; j++) {
            var transcodingProfile = profile.TranscodingProfiles[j];
            if (!transcodingProfile || getProfileTypeName(transcodingProfile.Type) !== 'video') {
                continue;
            }

            var result = addValuesToList(transcodingProfile.VideoCodec, copyVideoCodecs);
            if (result.changed) {
                transcodingProfile.VideoCodec = result.value;
                patchedProfiles++;
            }
        }

        if (patchedProfiles) {
            debugLog(context, 'Allowed direct-stream video copy for audio-only transcode profile(s):', patchedProfiles);
        }
    }

    function addLpcmAudioCopyCodecsToProfileEntry(profileEntry) {
        if (!profileEntry || !parseCommaSeparatedList(profileEntry.AudioCodec).length) {
            return false;
        }

        var result = addValuesToList(profileEntry.AudioCodec, LPCM_AUDIO_COPY_CODECS);
        if (!result.changed) {
            return false;
        }

        profileEntry.AudioCodec = result.value;
        return true;
    }

    function patchAudioProfilesForLpcmAudioCopy(profile, context) {
        if (!context.lpcmAudioCopyEnabled || !profile) {
            return;
        }

        var patchedDirectPlayProfiles = 0;
        if (profile.DirectPlayProfiles && profile.DirectPlayProfiles.length) {
            for (var i = 0; i < profile.DirectPlayProfiles.length; i++) {
                var directPlayProfile = profile.DirectPlayProfiles[i];
                if (!directPlayProfile || getProfileTypeName(directPlayProfile.Type) !== 'video') {
                    continue;
                }

                if (addLpcmAudioCopyCodecsToProfileEntry(directPlayProfile)) {
                    patchedDirectPlayProfiles++;
                }
            }
        }

        if (patchedDirectPlayProfiles) {
            debugLog(context, 'Allowed LPCM/PCM direct-play audio copy profile(s):', patchedDirectPlayProfiles);
        }
    }

    function patchPlaybackProfileBitrateLimits(profile, context) {
        if (!profile || typeof profile !== 'object' || !context.maxBitrate) {
            return;
        }

        var changed = false;
        var streamingBitrate = parsePositiveInteger(profile.MaxStreamingBitrate);
        var staticBitrate = parsePositiveInteger(profile.MaxStaticBitrate);

        if (streamingBitrate < context.maxBitrate) {
            profile.MaxStreamingBitrate = context.maxBitrate;
            changed = true;
        }

        if (staticBitrate < context.maxBitrate) {
            profile.MaxStaticBitrate = context.maxBitrate;
            changed = true;
        }

        if (changed) {
            debugLog(context, 'Patched device profile bitrate limits: streaming=' + profile.MaxStreamingBitrate + ', static=' + profile.MaxStaticBitrate);
        }
    }

    function applyVideoCapabilityProfilePatches(profile, context) {
        // Video transcoding should be driven by the video/container capability
        // report only. These patches remove known-bad direct-play claims.
        patchDirectPlayProfilesForProblematicFormats(profile, context);
        patchH264InterlaceSupport(profile, context);
    }

    function applyAudioTranscodeVideoCopyProfilePatches(profile, context) {
        // Keep video copy scoped to codecs that survived device capability
        // checks. Optional LPCM/PCM audio copy only expands existing audio
        // codec lists on direct-play profiles for receiver testing; it does
        // not override video support.
        patchVideoTranscodingProfilesForAudioOnlyTranscode(profile, context);
        patchAudioProfilesForLpcmAudioCopy(profile, context);
    }

    function applySubtitleDeliveryProfilePatches(profile, context) {
        // Subtitle burn-in is not forced here. The profile only advertises
        // client-renderable subtitle delivery; Jellyfin's own
        // AlwaysBurnInSubtitleWhenTranscoding flag decides burn-in later.
        preferExternalSubtitleProfilesForBitmapPgs(profile, context);
        patchExternalSubtitleProfiles(profile, context);
        patchHlsSubtitleManifestSupport(profile, context);
    }

    function applyPlaybackCompatibilityProfilePatches(profile, options) {
        if (!profile || typeof profile !== 'object') {
            return profile;
        }

        var context = normalizeOptions(options);
        applyVideoCapabilityProfilePatches(profile, context);
        applyAudioTranscodeVideoCopyProfilePatches(profile, context);
        applySubtitleDeliveryProfilePatches(profile, context);
        patchPlaybackProfileBitrateLimits(profile, context);
        return profile;
    }

    Runtime.define('playback.profilePatches', {
        applyPlaybackCompatibilityProfilePatches: applyPlaybackCompatibilityProfilePatches,
        parseCommaSeparatedList: parseCommaSeparatedList
    });
})(window);
