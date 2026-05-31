/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};

    function toMap(definitions) {
        var result = {};
        for (var i = 0; i < definitions.length; i++) {
            result[definitions[i].key] = definitions[i];
        }
        return result;
    }

    function parseStoredBoolean(value, fallback) {
        if (value === null || value === undefined) {
            return fallback;
        }
        if (value === true || value === 'true' || value === '1') {
            return true;
        }
        if (value === false || value === 'false' || value === '0') {
            return false;
        }
        return fallback;
    }

    var booleanDefinitions = [
        {
            key: 'playbackDiagnosticsEnabled',
            storageKey: 'webos_playback_diagnostics_overlay',
            defaultValue: false,
            title: 'webOS: Playback diagnostics overlay',
            description: 'Shows rAF, video-frame callback, video quality, and timing data on top of playback.',
            group: 'diagnostics'
        },
        {
            key: 'disableAssRenderAhead',
            storageKey: 'webos_disable_ass_render_ahead',
            defaultValue: true,
            title: 'webOS: Disable ASS render-ahead',
            description: 'Disables Jellyfin/libass-wasm one-shot prerender cache on webOS. This avoids cached ASS animation frames being replayed out of sync. Restart playback after changing.',
            group: 'ass'
        },
        {
            key: 'assTimeSyncFixEnabled',
            storageKey: 'webos_ass_time_sync_fix',
            defaultValue: true,
            title: 'webOS: Fix ASS time rollback',
            description: 'Clamps small backward video-time samples sent to libass on webOS. Takes effect immediately for new worker messages; restart playback if unsure.',
            group: 'ass'
        },
        {
            key: 'pgsForceMainThread',
            storageKey: 'webos_pgs_force_main_thread',
            defaultValue: true,
            title: 'webOS: Force PGS main-thread renderer',
            description: 'Diagnostic switch for PGS stale-text tests. Restart playback after changing; restart the app for a clean script-load test.',
            group: 'pgs'
        },
        {
            key: 'pgsPatchObjectReuse',
            storageKey: 'webos_pgs_patch_object_reuse',
            defaultValue: true,
            title: 'webOS: Patch PGS object reuse',
            description: 'Diagnostic switch for reused PGS object ids. Uses the newest ODS sequence when enabled. Restart playback after changing.',
            group: 'pgs'
        },
        {
            key: 'lpcmAudioCopyEnabled',
            storageKey: 'webos_lpcm_audio_copy',
            defaultValue: false,
            title: 'webOS: Allow LPCM/PCM audio copy',
            description: 'Experimental. Adds Blu-ray/DVD LPCM and common PCM codecs to video direct-play audio codec lists. Enable only when ARC/eARC and the receiver can handle multichannel PCM. Restart playback after changing.',
            group: 'audio'
        }
    ];

    var booleanDefinitionMap = toMap(booleanDefinitions);

    var api = {
        getBooleanDefinitions: function () {
            return booleanDefinitions.slice(0);
        },

        getBooleanDefinition: function (key) {
            return booleanDefinitionMap[key] || null;
        },

        getStorageKey: function (key, fallback) {
            var definition = booleanDefinitionMap[key];
            return definition ? definition.storageKey : fallback;
        },

        getDefaultValue: function (key, fallback) {
            var definition = booleanDefinitionMap[key];
            return definition ? !!definition.defaultValue : !!fallback;
        },

        getInitialBooleanValue: function (key, overrides, fallback) {
            if (overrides && typeof overrides[key] === 'boolean') {
                return overrides[key];
            }
            return api.getDefaultValue(key, fallback);
        },

        loadBooleanValue: function (key, storage, fallback) {
            var definition = booleanDefinitionMap[key];
            if (!definition || !storage || !storage.getItem) {
                return !!fallback;
            }
            return parseStoredBoolean(storage.getItem(definition.storageKey), fallback);
        },

        saveBooleanValue: function (key, storage, value) {
            var definition = booleanDefinitionMap[key];
            if (!definition || !storage || !storage.setItem) {
                return;
            }
            storage.setItem(definition.storageKey, value ? 'true' : 'false');
        },

        createOverridePayload: function (values) {
            var payload = {};
            for (var i = 0; i < booleanDefinitions.length; i++) {
                var key = booleanDefinitions[i].key;
                payload[key] = !!values[key];
            }
            return payload;
        }
    };

    Runtime.define('core.features', api);
})(window);
