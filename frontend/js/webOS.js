/* 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

(function(AppInfo, deviceInfo, featureOverrides) {
    'use strict';

    var DEBUG_LOG = false;
    function debugLog() {
        if (!DEBUG_LOG || !window.console || !console.log) {
            return;
        }
        console.log.apply(console, arguments);
    }

    function warnLog() {
        if (!window.console || !console.warn) {
            return;
        }
        console.warn.apply(console, arguments);
    }

    var webOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || null;
    var webOSFeatureRegistry = webOSPatchRuntime && webOSPatchRuntime.get
        ? webOSPatchRuntime.get('core.features')
        : null;
    var webOSProfilePatches = webOSPatchRuntime && webOSPatchRuntime.get
        ? webOSPatchRuntime.get('playback.profilePatches')
        : null;
    var webOSHdrDecisions = webOSPatchRuntime && webOSPatchRuntime.get
        ? webOSPatchRuntime.get('playback.hdrDecisions')
        : null;
    var hdrDecisionModuleWarned = false;

    function getRegisteredFeatureStorageKey(key, fallback) {
        return webOSFeatureRegistry && webOSFeatureRegistry.getStorageKey
            ? webOSFeatureRegistry.getStorageKey(key, fallback)
            : fallback;
    }

    function getRegisteredFeatureDefault(key, fallback) {
        return webOSFeatureRegistry && webOSFeatureRegistry.getDefaultValue
            ? webOSFeatureRegistry.getDefaultValue(key, fallback)
            : !!fallback;
    }

    function getRegisteredInitialFeatureValue(key, fallback) {
        return webOSFeatureRegistry && webOSFeatureRegistry.getInitialBooleanValue
            ? webOSFeatureRegistry.getInitialBooleanValue(key, featureOverrides, fallback)
            : featureOverrides && typeof featureOverrides[key] === 'boolean' ? featureOverrides[key] : !!fallback;
    }

    function getRegisteredBooleanFeatureDefinition(key) {
        return webOSFeatureRegistry && webOSFeatureRegistry.getBooleanDefinition
            ? webOSFeatureRegistry.getBooleanDefinition(key)
            : null;
    }

    function getRegisteredFeatureTitle(key, fallback) {
        var definition = getRegisteredBooleanFeatureDefinition(key);
        return definition && definition.title ? definition.title : fallback;
    }

    function getRegisteredFeatureDescription(key, fallback) {
        var definition = getRegisteredBooleanFeatureDefinition(key);
        return definition && definition.description ? definition.description : fallback;
    }

    debugLog('WebOS adapter');
    var PlaybackState = {
        IDLE: 'idle',
        PLAYING: 'playing',
        EXITING: 'exiting'
    };
    var playbackState = PlaybackState.IDLE;
    var exitToIdleTimer = null;
    var EXIT_TO_IDLE_TIMEOUT = 2000;
    var HEADER_PIN_INTERVAL = 12000; // fallback heartbeat only; scroll/resize/hashchange drive normal updates
    var MIN_HEADER_HEIGHT = 72;
    var headerPinTimer = null;
    var headerPinObserver = null;
    var headerPinObserverActive = false;
    var headerPinningInitialized = false;
    var headerPinScheduled = false;
    var cachedHeaderElement = null;
    var lastHeaderMeasureTs = 0;
    var HEADER_MEASURE_INTERVAL = 1500;
    var qualityMenuObserver = null;
    var qualityMenuObserverActive = false;
    var qualityMenuPatchTimer = null;
    var QUALITY_MENU_EXTRA_BITRATES = [120000000, 100000000, 95000000, 80000000];
    var QUALITY_MENU_LEGACY_CAP_BITRATE = 60000000;
    var PLAYBACK_INFO_MAX_BITRATE_PARAM = 'MaxStreamingBitrate';
    var PLAYBACK_START_MAX_BITRATE_FORCE_WINDOW_MS = 15000;
    var PLAYBACK_START_MAX_BITRATE_FORCE_REQUEST_LIMIT = 16;
    var forcePlaybackStartMaxBitrateUntil = 0;
    var forcePlaybackStartMaxBitrateRequestsLeft = 0;
    var lastPlaybackInfoMaxBitrateItemId = null;
    var settingsInjectionObserver = null;
    var settingsInjectionObserverActive = false;
    var settingsEnsureTimer = null;
    var settingsEnsureScheduled = false;
    var settingsEnsureAttemptsLeft = 0;
    var settingsEnsureLastRunTs = 0;
    var hdrSettingsPersistTimer = null;
    var SETTINGS_INJECTION_RETRY_DELAY = 250;
    var SETTINGS_INJECTION_MAX_RETRIES = 20;
    var SETTINGS_INJECTION_MUTATION_DELAY = 200;
    var HDR_SETTINGS_PERSIST_DELAY = 500;
    var PLAYBACK_DIAGNOSTICS_KEY = getRegisteredFeatureStorageKey('playbackDiagnosticsEnabled', 'webos_playback_diagnostics_overlay');
    var DISABLE_ASS_RENDER_AHEAD_KEY = getRegisteredFeatureStorageKey('disableAssRenderAhead', 'webos_disable_ass_render_ahead');
    var ASS_TIME_SYNC_FIX_KEY = getRegisteredFeatureStorageKey('assTimeSyncFixEnabled', 'webos_ass_time_sync_fix');
    var ASS_RENDER_AHEAD_LIMIT_MIB = 0;
    var ASS_TIME_SYNC_BACKWARD_TOLERANCE_SECONDS = 0.03;
    var ASS_TIME_SYNC_SEEK_BACK_SECONDS = 0.75;
    var PLAYBACK_DIAGNOSTICS_UPDATE_INTERVAL = 500;
    var SCRIPT_PATCH_FETCH_TIMEOUT_MS = 8000;
    var SCRIPT_PATCH_SPECULATIVE_FETCH_TIMEOUT_MS = 750;
    var SCRIPT_PATCH_EARLY_INSPECT_WINDOW_MS = 30000;
    var SCRIPT_PATCH_EARLY_INSPECT_LIMIT = 4;
    var PGS_FORCE_MAIN_THREAD_KEY = getRegisteredFeatureStorageKey('pgsForceMainThread', 'webos_pgs_force_main_thread');
    var PGS_PATCH_OBJECT_REUSE_KEY = getRegisteredFeatureStorageKey('pgsPatchObjectReuse', 'webos_pgs_patch_object_reuse');
    var LPCM_AUDIO_COPY_KEY = getRegisteredFeatureStorageKey('lpcmAudioCopyEnabled', 'webos_lpcm_audio_copy');
    var DEFAULT_PGS_FORCE_MAIN_THREAD = getRegisteredFeatureDefault('pgsForceMainThread', true);
    var DEFAULT_PGS_PATCH_OBJECT_REUSE = getRegisteredFeatureDefault('pgsPatchObjectReuse', true);
    var HDR_UI_DIM_BRIGHTNESS_KEY = 'webos_hdr_ui_dim_brightness';
    var HDR_UI_DIM_DEFAULT_BRIGHTNESS = 0.3;
    var HDR_UI_DIM_MIN_BRIGHTNESS = 0.05;
    var HDR_UI_DIM_MAX_BRIGHTNESS = 1;
    var HDR_UI_DIM_MIN_PERCENT = Math.round(HDR_UI_DIM_MIN_BRIGHTNESS * 100);
    var HDR_UI_DIM_MAX_PERCENT = Math.round(HDR_UI_DIM_MAX_BRIGHTNESS * 100);
    var HDR_UI_DIM_DEFAULT_PERCENT = Math.round(HDR_UI_DIM_DEFAULT_BRIGHTNESS * 100);
    var HDR_SUBTITLE_OPACITY_KEY = 'webos_hdr_subtitle_opacity';
    var HDR_SUBTITLE_DEFAULT_OPACITY = 0.62;
    var HDR_SUBTITLE_MIN_OPACITY = 0.25;
    var HDR_SUBTITLE_MAX_OPACITY = 1;
    var HDR_SUBTITLE_MIN_OPACITY_PERCENT = Math.round(HDR_SUBTITLE_MIN_OPACITY * 100);
    var HDR_SUBTITLE_MAX_OPACITY_PERCENT = Math.round(HDR_SUBTITLE_MAX_OPACITY * 100);
    var HDR_SUBTITLE_DEFAULT_OPACITY_PERCENT = Math.round(HDR_SUBTITLE_DEFAULT_OPACITY * 100);
    var HDR_UI_INFO_CORRECTION_WINDOW_MS = 8000;
    var HDR_UI_INFO_FALLBACK_SCAN_INTERVAL = 500;
    var PLAYBACK_START_FALLBACK_DELAY_MS = 3000;
    var POINTER_FIRST_CLICK_FOCUS_RESTORE_DELAYS = [0, 40, 120];
    var POINTER_FIRST_CLICK_SUPPRESS_NATIVE_CLICK_MS = 700;
    var POINTER_FIRST_CLICK_MAX_MOVE_PX = 14;
    var POINTER_FIRST_CLICK_LONG_PRESS_CANCEL_MS = 2500;
    var POINTER_FIRST_CLICK_FOCUS_TARGET_SELECTOR = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[data-action]',
        '[tabindex]:not([tabindex="-1"])',
        '.card',
        '.cardBox',
        '.listItem',
        '.itemAction',
        '.emby-button'
    ].join(',');
    var playbackDiagnosticsEnabled = getRegisteredInitialFeatureValue('playbackDiagnosticsEnabled', false);
    var disableAssRenderAhead = getRegisteredInitialFeatureValue('disableAssRenderAhead', true);
    var assTimeSyncFixEnabled = getRegisteredInitialFeatureValue('assTimeSyncFixEnabled', true);
    var pgsForceMainThread = getRegisteredInitialFeatureValue('pgsForceMainThread', DEFAULT_PGS_FORCE_MAIN_THREAD);
    var pgsPatchObjectReuse = getRegisteredInitialFeatureValue('pgsPatchObjectReuse', DEFAULT_PGS_PATCH_OBJECT_REUSE);
    var lpcmAudioCopyEnabled = getRegisteredInitialFeatureValue('lpcmAudioCopyEnabled', false);
    var hdrUiDimBrightness = HDR_UI_DIM_DEFAULT_BRIGHTNESS;
    var hdrSubtitleOpacity = HDR_SUBTITLE_DEFAULT_OPACITY;
    var HDR_UI_DIM_CLASS = 'webos-hdr-ui-dim';
    var playbackDynamicRange = 'unknown';
    var playbackDynamicRangeReason = null;
    var playbackVideoDelivery = 'unknown';
    var playbackVideoDeliveryReason = null;
    var hdrDetectionMediaSessionLastHint = 'unknown';
    var hdrDetectionPlaybackInfoLastHint = 'unknown';
    var hdrDetectionItemMetadataLastHint = 'unknown';
    var hdrDetectionPlaybackUiLastHint = 'unknown';
    var hdrDetectionPlaybackInfoCount = 0;
    var hdrUiInfoScanTimer = null;
    var hdrUiInfoFallbackScanTimer = null;
    var hdrUiInfoCorrectionUntil = 0;
    var hdrUiInfoCorrectionTimer = null;
    var hdrUiInfoCorrectedHdrUntil = 0;
    var hdrUiInfoCorrectedHdrReason = null;
    var hdrUiInfoInitialScanTimer = null;
    var hdrUiInfoObserver = createManagedObserver({
        handler: function () {
            scheduleHdrUiInfoScan(120);
        },
        onEnabled: function () {
            scheduleHdrUiInfoScan(0);
            if (hdrUiInfoInitialScanTimer) {
                clearTimeout(hdrUiInfoInitialScanTimer);
            }
            hdrUiInfoInitialScanTimer = setTimeout(function () {
                hdrUiInfoInitialScanTimer = null;
                scheduleHdrUiInfoScan(0);
            }, 400);
            scheduleHdrUiInfoFallbackScan();
        },
        onDisabled: function () {
            if (hdrUiInfoInitialScanTimer) {
                clearTimeout(hdrUiInfoInitialScanTimer);
                hdrUiInfoInitialScanTimer = null;
            }
            clearHdrUiInfoScanTimer();
            clearHdrUiInfoFallbackScanTimer();
        }
    });
    var currentMediaSessionItemId = null;
    var currentPlaybackMediaSourceId = null;
    var mediaItemDynamicRangeCache = {};
    var MEDIA_DYNAMIC_RANGE_CACHE_LIMIT = 64;
    var mediaItemDynamicRangeInFlight = {};
    var playbackInfoDynamicRangeHints = {};
    var playbackInfoVideoDeliveryHints = {};
    var playbackInfoInterceptionInitialized = false;
    var playbackInfoPlaybackEpoch = 0;
    var playbackInfoRequestSequence = 0;
    var latestPlaybackInfoRequestSequence = 0;
    var latestPlaybackInfoRequestItemId = null;
    var pendingPlaybackInfoDynamicRange = null;
    var playbackStartFallbackTimers = [];
    var playbackStartFallbackGeneration = 0;
    var pgsSubtitleDeliveryDiagnostic = 'none';
    var pgsSubtitleFetchDiagnostic = 'none';
    var playbackDiagnosticsOverlay = null;
    var playbackDiagnosticsOverlayRetryTimer = null;
    var playbackDiagnosticsRafId = null;
    var playbackDiagnosticsLastRafTs = 0;
    var playbackDiagnosticsRafFps = 0;
    var playbackDiagnosticsLastUpdateTs = 0;
    var playbackDiagnosticsVideo = null;
    var playbackDiagnosticsVideoFrameCallbackId = null;
    var playbackDiagnosticsVideoFrameFps = 0;
    var playbackDiagnosticsVideoFrameDelta = 0;
    var playbackDiagnosticsLongTaskObserver = null;
    var playbackDiagnosticsLongTaskSupported = false;
    var playbackDiagnosticsLongTaskUnavailable = false;
    var playbackDiagnosticsLongTaskWindowDuration = 0;
    var playbackDiagnosticsLongTaskWindowMax = 0;
    var playbackDiagnosticsLongTaskDisplayCount = 0;
    var playbackDiagnosticsLongTaskDisplayDuration = 0;
    var playbackDiagnosticsLongTaskDisplayMax = 0;
    var assRendererInterceptionInitialized = false;
    var assScriptInterceptionInitialized = false;
    var assScriptPatchCount = 0;
    var assScriptLastPatchInfo = 'none';
    var externalScriptPatchQueue = [];
    var externalScriptPatchQueueActive = false;
    var externalScriptPatchStartTs = Date.now();
    var externalScriptPatchEarlyInspectCount = 0;
    var assWorkerTimeSyncClampCount = 0;
    var assWorkerVideoStateEntries = [];
    var assWorkerVideoMessagePatchCount = 0;
    var assWorkerVideoMessageDisplayCount = 0;
    var monotonicMediaTimeEntries = [];
    var pgsScriptPatchCount = 0;
    var pgsScriptTimePatchCount = 0;
    var pgsScriptAsyncPatchCount = 0;
    var pgsScriptRenderPatchCount = 0;
    var pgsScriptMainThreadPatchCount = 0;
    var pgsScriptObjectPatchCount = 0;
    var pgsScriptModePatchCount = 0;
    var pgsScriptLastPatchInfo = 'none';
    var pgsTimeSampleDisplayCount = 0;
    var pgsTimeClampCount = 0;
    var pgsTimeLastClampInfo = 'none';
    var pgsTimeBackwardCount = 0;
    var pgsTimeMaxBackwardMs = 0;
    var pgsTimeLastBackwardInfo = 'none';
    var pgsAsyncRequestCount = 0;
    var pgsAsyncDrawCount = 0;
    var pgsAsyncStaleDropCount = 0;
    var pgsAsyncLastInfo = 'none';
    var pgsRenderRequestCount = 0;
    var pgsRenderPostCount = 0;
    var pgsRenderBackwardCount = 0;
    var pgsRenderDropCount = 0;
    var pgsRenderLastInfo = 'none';
    var pgsMainThreadRequestCount = 0;
    var pgsMainThreadDrawCount = 0;
    var pgsMainThreadDropCount = 0;
    var pgsMainThreadLastInfo = 'none';
    var pointerFirstClickFocusInitialized = false;
    var pointerFirstClickSuppressTarget = null;
    var pointerFirstClickSuppressUntil = 0;
    var pointerFirstClickLastDirectTarget = null;
    var pointerFirstClickLastDirectTs = 0;
    var pointerFirstClickPending = null;
    var pointerFirstClickLastPointerDownTs = 0;
    var pointerFirstClickSuppressX = null;
    var pointerFirstClickSuppressY = null;

    function createRateTracker() {
        var windowStartTs = 0;
        var count = 0;
        return {
            record: function (now) {
                if (!windowStartTs) {
                    windowStartTs = now;
                }
                count++;
                var elapsed = now - windowStartTs;
                if (elapsed >= 1000) {
                    var rate = Math.round((count * 1000 / elapsed) * 10) / 10;
                    count = 0;
                    windowStartTs = now;
                    return rate;
                }
                return null;
            },
            increment: function () {
                count++;
            },
            check: function (now) {
                if (!windowStartTs) {
                    windowStartTs = now;
                }
                var elapsed = now - windowStartTs;
                if (elapsed >= 1000) {
                    var rate = Math.round((count * 1000 / elapsed) * 10) / 10;
                    count = 0;
                    windowStartTs = now;
                    return rate;
                }
                return null;
            },
            reset: function () {
                windowStartTs = 0;
                count = 0;
            }
        };
    }
    function createManagedObserver(config) {
        var observer = null;
        var active = false;

        function ensureCreated() {
            if (observer) return true;
            if (!window.MutationObserver) return false;
            if (!config.handler) return false;
            observer = new MutationObserver(config.handler);
            return !!observer;
        }

        function getTargets() {
            var result = config.getTargets ? config.getTargets() : null;
            if (!result) {
                var body = document.body || document.documentElement;
                if (body) return [{ target: body, config: { childList: true, subtree: true } }];
                return [];
            }
            return Array.isArray(result) ? result : [result];
        }

        return {
            setEnabled: function (enabled) {
                if (!window.MutationObserver) return;
                if (!enabled) {
                    if (observer && active) { observer.disconnect(); active = false; }
                    if (config.onDisabled) config.onDisabled();
                    return;
                }
                if (!observer && !ensureCreated()) return;
                if (config.alwaysReconnect || !active) {
                    if (active) { observer.disconnect(); active = false; }
                    var targets = getTargets();
                    for (var i = 0; i < targets.length; i++) {
                        if (targets[i] && targets[i].target) {
                            observer.observe(targets[i].target, targets[i].config);
                        }
                    }
                    active = targets.length > 0;
                }
                if (config.onEnabled) config.onEnabled();
            },
            create: function () { ensureCreated(); },
            getObserver: function () { return observer; },
            isActive: function () { return active; }
        };
    }

    var rafTracker = createRateTracker();
    var videoFrameTracker = createRateTracker();
    var longTaskCountTracker = createRateTracker();
    var pgsTimeSampleRateTracker = createRateTracker();
    var assWorkerVideoMessageRateTracker = createRateTracker();

    function postMessage(type, data) {
        window.top.postMessage({
            type: type,
            data: data
        }, '*');
    }

    function clearExitToIdleTimer() {
        if (exitToIdleTimer) {
            clearTimeout(exitToIdleTimer);
            exitToIdleTimer = null;
        }
    }

    function startPlaybackStartMaxBitrateForce(reason) {
        forcePlaybackStartMaxBitrateUntil = Date.now() + PLAYBACK_START_MAX_BITRATE_FORCE_WINDOW_MS;
        forcePlaybackStartMaxBitrateRequestsLeft = PLAYBACK_START_MAX_BITRATE_FORCE_REQUEST_LIMIT;
        debugLog('Armed playback start max bitrate forcing (' + reason + '): window='
            + PLAYBACK_START_MAX_BITRATE_FORCE_WINDOW_MS + 'ms, requests='
            + PLAYBACK_START_MAX_BITRATE_FORCE_REQUEST_LIMIT);
    }

    function clearPlaybackStartMaxBitrateForce(reason) {
        if (!forcePlaybackStartMaxBitrateUntil && !forcePlaybackStartMaxBitrateRequestsLeft) {
            return;
        }

        forcePlaybackStartMaxBitrateUntil = 0;
        forcePlaybackStartMaxBitrateRequestsLeft = 0;
        debugLog('Cleared playback start max bitrate forcing (' + reason + ')');
    }

    function shouldForcePlaybackStartMaxBitrate() {
        if (!forcePlaybackStartMaxBitrateUntil || forcePlaybackStartMaxBitrateRequestsLeft <= 0) {
            return false;
        }

        if (Date.now() > forcePlaybackStartMaxBitrateUntil) {
            clearPlaybackStartMaxBitrateForce('expired');
            return false;
        }

        return true;
    }

    function markPlaybackStartMaxBitrateForced(source, bitrate) {
        if (forcePlaybackStartMaxBitrateRequestsLeft > 0) {
            forcePlaybackStartMaxBitrateRequestsLeft--;
        }

        debugLog('Forced playback start max bitrate (' + source + '): ' + bitrate
            + ', remaining=' + forcePlaybackStartMaxBitrateRequestsLeft);

        if (forcePlaybackStartMaxBitrateRequestsLeft <= 0) {
            clearPlaybackStartMaxBitrateForce('request-limit');
        }
    }

    function headerNeedsPinnedRefresh(header) {
        if (!header || !header.classList || !header.style) {
            return true;
        }

        return header.classList.contains('hide')
            || header.classList.contains('hidden')
            || header.classList.contains('skinHeader-hidden')
            || header.style.position !== 'fixed'
            || header.style.transform !== 'translateY(0)'
            || header.style.opacity === '0'
            || header.style.visibility === 'hidden';
    }

    function initHeaderPinObserver() {
        if (headerPinObserver || !window.MutationObserver) {
            return;
        }

        headerPinObserver = new MutationObserver(function (mutations) {
            var shouldRescanHeader = false;
            var shouldSchedule = false;

            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (mutation.type === 'childList') {
                    shouldRescanHeader = true;
                    shouldSchedule = true;
                    break;
                }

                if (mutation.type === 'attributes') {
                    if (headerNeedsPinnedRefresh(mutation.target)) {
                        shouldSchedule = true;
                    }
                }
            }

            if (shouldRescanHeader) {
                cachedHeaderElement = null;
                setHeaderPinObserverEnabled(true);
            }

            if (shouldSchedule) {
                lastHeaderMeasureTs = 0;
                scheduleForceHeaderPinned();
            }
        });
    }

    function setHeaderPinObserverEnabled(enabled) {
        if (!window.MutationObserver) {
            return;
        }

        if (!enabled) {
            if (headerPinObserver && headerPinObserverActive) {
                headerPinObserver.disconnect();
                headerPinObserverActive = false;
            }
            return;
        }

        if (!headerPinObserver) {
            initHeaderPinObserver();
        }

        if (!headerPinObserver) {
            return;
        }

        headerPinObserver.disconnect();
        headerPinObserverActive = false;

        var header = getHeaderElement();
        if (header) {
            headerPinObserver.observe(header, {
                attributes: true,
                attributeFilter: ['class', 'style']
            });
            headerPinObserverActive = true;

            if (header.parentNode) {
                headerPinObserver.observe(header.parentNode, {
                    childList: true
                });
            }
            return;
        }

        var body = document.body || document.documentElement;
        if (body) {
            headerPinObserver.observe(body, {
                childList: true,
                subtree: true
            });
            headerPinObserverActive = true;
        }
    }

    function setHeaderPinningEnabled(enabled) {
        if (!document.body) {
            return;
        }

        var header = getHeaderElement();

        if (enabled) {
            document.body.classList.add('webos-force-header-pin');
            if (header) {
                header.classList.remove('hide');
                header.classList.remove('hidden');
                header.classList.remove('skinHeader-hidden');
            }
            scheduleForceHeaderPinned();
            updateHeaderPinHeartbeat();
            setHeaderPinObserverEnabled(true);
            return;
        }

        document.body.classList.remove('webos-force-header-pin');
        document.body.style.paddingTop = '';
        document.documentElement.style.removeProperty('--webos-header-offset');
        updateHeaderPinHeartbeat();
        setHeaderPinObserverEnabled(false);

        if (header) {
            header.style.position = '';
            header.style.top = '';
            header.style.left = '';
            header.style.right = '';
            header.style.zIndex = '';
            header.style.transform = '';
            header.style.opacity = '';
            header.style.visibility = '';
        }
    }

    function setPlaybackState(nextState, reason) {
        if (playbackState === nextState) {
            return;
        }

        var previousState = playbackState;
        playbackState = nextState;
        debugLog('Playback state: ' + previousState + ' -> ' + nextState + ' (' + reason + ')');

        clearExitToIdleTimer();
        if (nextState === PlaybackState.EXITING) {
            exitToIdleTimer = setTimeout(function () {
                if (playbackState === PlaybackState.EXITING) {
                    setPlaybackState(PlaybackState.IDLE, 'exit-timeout');
                }
            }, EXIT_TO_IDLE_TIMEOUT);
        }

        setHeaderPinningEnabled(nextState !== PlaybackState.PLAYING);
        setQualityMenuObserverEnabled(true);
        hdrUiInfoObserver.setEnabled(nextState === PlaybackState.PLAYING && playbackDynamicRange === 'unknown');
        if (nextState === PlaybackState.PLAYING && previousState !== PlaybackState.PLAYING) {
            startPlaybackStartMaxBitrateForce('playback-start');
            armHdrUiInfoCorrectionWindow('playback-start');
            if (!applyPendingPlaybackInfoDynamicRange('playback-start-pending')) {
                applyPendingPlaybackInfoHint();
            }
            schedulePlaybackStartFallbackChecks('playback-start-fallback');
        }
        if (nextState !== PlaybackState.PLAYING) {
            clearPlaybackStartFallbackTimers();
            clearPlaybackStartMaxBitrateForce('playback-state-change');
            clearHdrUiInfoCorrectionWindow();
        }
        if (nextState === PlaybackState.IDLE) {
            lastPlaybackInfoMaxBitrateItemId = null;
            playbackInfoPlaybackEpoch++;
            latestPlaybackInfoRequestSequence = playbackInfoRequestSequence;
            latestPlaybackInfoRequestItemId = null;
            pendingPlaybackInfoDynamicRange = null;
            pgsSubtitleDeliveryDiagnostic = 'none';
            pgsSubtitleFetchDiagnostic = 'none';
            resetSubtitleTimingState('playback-idle');
        }

        if (nextState === PlaybackState.IDLE) {
            setCurrentPlaybackItemId(null, null);
            setPlaybackVideoDelivery('unknown', 'playback-idle');
            setPlaybackDynamicRange('unknown', 'playback-idle');
        } else {
            refreshHdrUiDimming('playback-state');
        }
    }

    function findPlaybackDiagnosticsVideo() {
        var videos = document.querySelectorAll('video');
        var best = null;

        for (var i = 0; i < videos.length; i++) {
            var video = videos[i];
            if (!video) {
                continue;
            }

            if (!best) {
                best = video;
            }

            if (!video.paused && !video.ended) {
                return video;
            }
        }

        return best;
    }

    function resetPlaybackDiagnosticsVideoFrameStats(video) {
        if (playbackDiagnosticsVideo
            && playbackDiagnosticsVideoFrameCallbackId
            && playbackDiagnosticsVideo.cancelVideoFrameCallback) {
            try {
                playbackDiagnosticsVideo.cancelVideoFrameCallback(playbackDiagnosticsVideoFrameCallbackId);
            } catch (error) {
                // Ignore stale callback IDs.
            }
        }

        playbackDiagnosticsVideo = video || null;
        playbackDiagnosticsVideoFrameCallbackId = null;
        videoFrameTracker.reset();
        playbackDiagnosticsVideoFrameFps = 0;
        playbackDiagnosticsVideoFrameDelta = 0;
    }

    function schedulePlaybackDiagnosticsVideoFrameCallback() {
        var video = playbackDiagnosticsVideo;
        if (!playbackDiagnosticsEnabled || !video || !video.requestVideoFrameCallback) {
            playbackDiagnosticsVideoFrameCallbackId = null;
            return;
        }

        playbackDiagnosticsVideoFrameCallbackId = video.requestVideoFrameCallback(function (now, metadata) {
            if (!playbackDiagnosticsEnabled || playbackDiagnosticsVideo !== video) {
                playbackDiagnosticsVideoFrameCallbackId = null;
                return;
            }

            var frameFps = videoFrameTracker.record(now);
            if (frameFps !== null) {
                playbackDiagnosticsVideoFrameFps = frameFps;
            }

            if (metadata && typeof metadata.expectedDisplayTime === 'number') {
                playbackDiagnosticsVideoFrameDelta = Math.round((metadata.expectedDisplayTime - now) * 10) / 10;
            }

            schedulePlaybackDiagnosticsVideoFrameCallback();
        });
    }

    function ensurePlaybackDiagnosticsVideoFrameCallback(video) {
        if (playbackDiagnosticsVideo !== video) {
            resetPlaybackDiagnosticsVideoFrameStats(video);
            if (video && video.requestVideoFrameCallback) {
                schedulePlaybackDiagnosticsVideoFrameCallback();
            }
        } else if (video && video.requestVideoFrameCallback && !playbackDiagnosticsVideoFrameCallbackId) {
            schedulePlaybackDiagnosticsVideoFrameCallback();
        }
    }

    function resetPlaybackDiagnosticsLongTaskStats() {
        longTaskCountTracker.reset();
        playbackDiagnosticsLongTaskWindowDuration = 0;
        playbackDiagnosticsLongTaskWindowMax = 0;
        playbackDiagnosticsLongTaskDisplayCount = 0;
        playbackDiagnosticsLongTaskDisplayDuration = 0;
        playbackDiagnosticsLongTaskDisplayMax = 0;
    }

    function disconnectPlaybackDiagnosticsLongTaskObserver(markUnavailable) {
        if (playbackDiagnosticsLongTaskObserver) {
            try {
                playbackDiagnosticsLongTaskObserver.disconnect();
            } catch (error) {
                // Ignore observer teardown failures on older WebViews.
            }
        }
        playbackDiagnosticsLongTaskObserver = null;
        playbackDiagnosticsLongTaskSupported = false;
        playbackDiagnosticsLongTaskUnavailable = !!markUnavailable;
        resetPlaybackDiagnosticsLongTaskStats();
    }

    function ensurePlaybackDiagnosticsLongTaskObserver() {
        if (playbackDiagnosticsLongTaskObserver || playbackDiagnosticsLongTaskUnavailable || !window.PerformanceObserver) {
            return;
        }

        try {
            playbackDiagnosticsLongTaskObserver = new PerformanceObserver(function (list) {
                var entries = list.getEntries ? list.getEntries() : [];
                for (var i = 0; i < entries.length; i++) {
                    var duration = typeof entries[i].duration === 'number' ? entries[i].duration : 0;
                    longTaskCountTracker.increment();
                    playbackDiagnosticsLongTaskWindowDuration += duration;
                    playbackDiagnosticsLongTaskWindowMax = Math.max(playbackDiagnosticsLongTaskWindowMax, duration);
                }
            });
            playbackDiagnosticsLongTaskObserver.observe({ entryTypes: ['longtask'] });
            playbackDiagnosticsLongTaskSupported = true;
        } catch (error) {
            disconnectPlaybackDiagnosticsLongTaskObserver(true);
        }
    }

    function formatPlaybackDiagnosticsLongTaskInfo(now) {
        if (!playbackDiagnosticsLongTaskSupported) {
            return window.PerformanceObserver ? 'unavailable' : 'unsupported';
        }

        var longTaskRate = longTaskCountTracker.check(now);
        if (longTaskRate !== null) {
            playbackDiagnosticsLongTaskDisplayCount = longTaskRate;
            playbackDiagnosticsLongTaskDisplayDuration = Math.round(playbackDiagnosticsLongTaskWindowDuration);
            playbackDiagnosticsLongTaskDisplayMax = Math.round(playbackDiagnosticsLongTaskWindowMax);
            playbackDiagnosticsLongTaskWindowDuration = 0;
            playbackDiagnosticsLongTaskWindowMax = 0;
        }

        return playbackDiagnosticsLongTaskDisplayCount
            + '/s total=' + playbackDiagnosticsLongTaskDisplayDuration
            + 'ms max=' + playbackDiagnosticsLongTaskDisplayMax + 'ms';
    }

    function createPlaybackDiagnosticsOverlay() {
        if (playbackDiagnosticsOverlay || !document.body) {
            return playbackDiagnosticsOverlay;
        }

        if (playbackDiagnosticsOverlayRetryTimer) {
            clearTimeout(playbackDiagnosticsOverlayRetryTimer);
            playbackDiagnosticsOverlayRetryTimer = null;
        }

        playbackDiagnosticsOverlay = document.createElement('div');
        playbackDiagnosticsOverlay.className = 'webos-playback-diagnostics-overlay';
        playbackDiagnosticsOverlay.style.position = 'fixed';
        playbackDiagnosticsOverlay.style.left = '1rem';
        playbackDiagnosticsOverlay.style.top = '1rem';
        playbackDiagnosticsOverlay.style.zIndex = '2147483647';
        playbackDiagnosticsOverlay.style.pointerEvents = 'none';
        playbackDiagnosticsOverlay.style.background = 'rgba(0, 0, 0, 0.76)';
        playbackDiagnosticsOverlay.style.color = '#d6f6ff';
        playbackDiagnosticsOverlay.style.font = '12px/1.35 monospace';
        playbackDiagnosticsOverlay.style.whiteSpace = 'pre';
        playbackDiagnosticsOverlay.style.padding = '0.55rem 0.7rem';
        playbackDiagnosticsOverlay.style.border = '1px solid rgba(0, 164, 220, 0.65)';
        playbackDiagnosticsOverlay.style.borderRadius = '4px';
        playbackDiagnosticsOverlay.style.maxWidth = '38rem';
        playbackDiagnosticsOverlay.textContent = 'webOS diagnostics';
        document.body.appendChild(playbackDiagnosticsOverlay);

        return playbackDiagnosticsOverlay;
    }

    function schedulePlaybackDiagnosticsOverlayRetry() {
        if (playbackDiagnosticsOverlayRetryTimer || !playbackDiagnosticsEnabled) {
            return;
        }

        playbackDiagnosticsOverlayRetryTimer = setTimeout(function () {
            playbackDiagnosticsOverlayRetryTimer = null;
            updatePlaybackDiagnosticsOverlay();
        }, 250);
    }

    function formatPlaybackDiagnosticsNumber(value, fallback) {
        if (typeof value !== 'number' || isNaN(value)) {
            return fallback || 'n/a';
        }
        return value.toString();
    }

    function getPlaybackDiagnosticsAssCanvasInfo() {
        var canvases = document.querySelectorAll('.videoPlayerContainer .libassjs-canvas-parent canvas, .videoPlayerContainer [class*="libass"] canvas');
        if (!canvases || !canvases.length) {
            return 'none';
        }

        var canvas = canvases[0];
        var size = (canvas.width || 0).toString() + 'x' + (canvas.height || 0).toString();
        var cssSize = 'n/a';
        try {
            var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
            if (rect) {
                cssSize = Math.round(rect.width).toString() + 'x' + Math.round(rect.height).toString();
            }
        } catch (error) {
            cssSize = 'n/a';
        }
        return canvases.length.toString() + ' ' + size + '/' + cssSize;
    }

    function formatHdrDetectionHint(hint) {
        if (hint === 'hdr') {
            return 'h';
        }
        if (hint === 'sdr') {
            return 's';
        }
        return '?';
    }

    function getPlaybackDiagnosticsAssWorkerInfo() {
        return 'patch=' + assScriptPatchCount.toString()
            + '/' + assWorkerVideoMessagePatchCount.toString()
            + ' msg=' + assWorkerVideoMessageDisplayCount.toString() + '/s'
            + ' clamp=' + assWorkerTimeSyncClampCount.toString()
            + ' timeFix=' + (assTimeSyncFixEnabled ? 'on' : 'off');
    }

    function getPlaybackDiagnosticsPgsInfo() {
        return 'patch=' + pgsScriptPatchCount.toString()
            + '(t' + pgsScriptTimePatchCount.toString()
            + '/a' + pgsScriptAsyncPatchCount.toString()
            + '/r' + pgsScriptRenderPatchCount.toString()
            + '/m' + pgsScriptMainThreadPatchCount.toString()
            + '/o' + pgsScriptObjectPatchCount.toString()
            + '/mode' + pgsScriptModePatchCount.toString() + ')'
            + ' target=' + (pgsForceMainThread ? 'main' : 'auto')
            + ' obj=' + (pgsPatchObjectReuse ? 'on' : 'off')
            + ' time=' + pgsTimeSampleDisplayCount.toString() + '/s'
            + ' back=' + pgsTimeBackwardCount.toString()
            + ' max=' + pgsTimeMaxBackwardMs.toString() + 'ms'
            + ' clamp=' + pgsTimeClampCount.toString()
            + '\nPGS ctr'
            + ' async=' + pgsAsyncRequestCount.toString()
            + '/' + pgsAsyncDrawCount.toString()
            + '/' + pgsAsyncStaleDropCount.toString()
            + ' render=' + pgsRenderRequestCount.toString()
            + '/' + pgsRenderPostCount.toString()
            + '/' + pgsRenderBackwardCount.toString()
            + '/' + pgsRenderDropCount.toString()
            + ' main=' + pgsMainThreadRequestCount.toString()
            + '/' + pgsMainThreadDrawCount.toString()
            + '/' + pgsMainThreadDropCount.toString();
    }

    function updatePlaybackDiagnosticsText(now) {
        var overlay = createPlaybackDiagnosticsOverlay();
        if (!overlay) {
            return;
        }

        var video = findPlaybackDiagnosticsVideo();
        ensurePlaybackDiagnosticsVideoFrameCallback(video);
        ensurePlaybackDiagnosticsLongTaskObserver();

        var quality = null;
        if (video && video.getVideoPlaybackQuality) {
            try {
                quality = video.getVideoPlaybackQuality();
            } catch (error) {
                quality = null;
            }
        }

        var dropped = quality && typeof quality.droppedVideoFrames === 'number' ? quality.droppedVideoFrames : null;
        var total = quality && typeof quality.totalVideoFrames === 'number' ? quality.totalVideoFrames : null;
        var currentTime = video && typeof video.currentTime === 'number' ? video.currentTime.toFixed(3) : 'n/a';
        var dimensions = video ? ((video.videoWidth || 0).toString() + 'x' + (video.videoHeight || 0).toString()) : 'n/a';
        var rVfcSupported = !!(video && video.requestVideoFrameCallback);

        overlay.textContent = [
            'webOS diagnostics',
            'state=' + playbackState + ' range=' + playbackDynamicRange + ' video=' + playbackVideoDelivery + '(' + (playbackVideoDeliveryReason || '-') + ')' + ' rAF=' + playbackDiagnosticsRafFps + ' rVFC=' + (rVfcSupported ? playbackDiagnosticsVideoFrameFps : 'n/a') + ' delta=' + (rVfcSupported ? playbackDiagnosticsVideoFrameDelta + 'ms' : 'n/a'),
            'HDR via=' + (playbackDynamicRangeReason || '-') + ' ms=' + formatHdrDetectionHint(hdrDetectionMediaSessionLastHint) + ' pi=' + formatHdrDetectionHint(hdrDetectionPlaybackInfoLastHint) + '/' + hdrDetectionPlaybackInfoCount + ' pend=' + (pendingPlaybackInfoDynamicRange ? formatHdrDetectionHint(pendingPlaybackInfoDynamicRange.hint) : '-') + ' im=' + formatHdrDetectionHint(hdrDetectionItemMetadataLastHint) + ' ui=' + formatHdrDetectionHint(hdrDetectionPlaybackUiLastHint),
            'long=' + formatPlaybackDiagnosticsLongTaskInfo(now) + ' video=' + dimensions + ' t=' + currentTime + ' drop=' + formatPlaybackDiagnosticsNumber(dropped) + '/' + formatPlaybackDiagnosticsNumber(total),
            'ASS canvas=' + getPlaybackDiagnosticsAssCanvasInfo() + ' worker=' + getPlaybackDiagnosticsAssWorkerInfo(),
            'PGS ' + getPlaybackDiagnosticsPgsInfo(),
            'subs pgs=' + pgsSubtitleDeliveryDiagnostic + ' sup=' + pgsSubtitleFetchDiagnostic
        ].join('\n');

        playbackDiagnosticsLastUpdateTs = now;
    }

    function runPlaybackDiagnosticsOverlay(now) {
        if (!playbackDiagnosticsEnabled) {
            playbackDiagnosticsRafId = null;
            return;
        }

        if (playbackDiagnosticsLastRafTs) {
            var rafFps = rafTracker.record(now);
            if (rafFps !== null) {
                playbackDiagnosticsRafFps = rafFps;
            }
        }
        playbackDiagnosticsLastRafTs = now;

        if (!playbackDiagnosticsLastUpdateTs || (now - playbackDiagnosticsLastUpdateTs) >= PLAYBACK_DIAGNOSTICS_UPDATE_INTERVAL) {
            updatePlaybackDiagnosticsText(now);
        }

        playbackDiagnosticsRafId = window.requestAnimationFrame(runPlaybackDiagnosticsOverlay);
    }

    function updatePlaybackDiagnosticsOverlay() {
        if (!playbackDiagnosticsEnabled) {
            if (playbackDiagnosticsRafId) {
                if (window.cancelAnimationFrame) {
                    window.cancelAnimationFrame(playbackDiagnosticsRafId);
                }
                playbackDiagnosticsRafId = null;
            }
            resetPlaybackDiagnosticsVideoFrameStats(null);
            disconnectPlaybackDiagnosticsLongTaskObserver(false);
            playbackDiagnosticsLastRafTs = 0;
            rafTracker.reset();
            playbackDiagnosticsRafFps = 0;
            playbackDiagnosticsLastUpdateTs = 0;
            if (playbackDiagnosticsOverlay && playbackDiagnosticsOverlay.parentNode) {
                playbackDiagnosticsOverlay.parentNode.removeChild(playbackDiagnosticsOverlay);
            }
            playbackDiagnosticsOverlay = null;
            if (playbackDiagnosticsOverlayRetryTimer) {
                clearTimeout(playbackDiagnosticsOverlayRetryTimer);
                playbackDiagnosticsOverlayRetryTimer = null;
            }
            return;
        }

        if (!createPlaybackDiagnosticsOverlay()) {
            schedulePlaybackDiagnosticsOverlayRetry();
            return;
        }
        if (!playbackDiagnosticsRafId && window.requestAnimationFrame) {
            playbackDiagnosticsRafId = window.requestAnimationFrame(runPlaybackDiagnosticsOverlay);
        }
    }

    function scheduleForceHeaderPinned() {
        if (headerPinScheduled) {
            return;
        }

        headerPinScheduled = true;
        var callback = function () {
            headerPinScheduled = false;
            forceHeaderPinned();
        };

        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(callback);
        } else {
            setTimeout(callback, 16);
        }
    }

    function updateHeaderPinHeartbeat() {
        var shouldRun = playbackState !== PlaybackState.PLAYING && !!document.body;

        if (!shouldRun) {
            if (headerPinTimer) {
                clearInterval(headerPinTimer);
                headerPinTimer = null;
            }
            return;
        }

        if (!headerPinTimer) {
            headerPinTimer = setInterval(scheduleForceHeaderPinned, HEADER_PIN_INTERVAL);
        }
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

    function loadRegisteredBooleanFeature(key, storageKey, fallback) {
        if (webOSFeatureRegistry && webOSFeatureRegistry.loadBooleanValue) {
            return webOSFeatureRegistry.loadBooleanValue(key, localStorage, fallback);
        }
        return parseStoredBoolean(localStorage.getItem(storageKey), fallback);
    }

    function saveRegisteredBooleanFeature(key, storageKey, value) {
        if (webOSFeatureRegistry && webOSFeatureRegistry.saveBooleanValue) {
            webOSFeatureRegistry.saveBooleanValue(key, localStorage, value);
            return;
        }
        localStorage.setItem(storageKey, value ? 'true' : 'false');
    }

    function parseStoredNumber(value, fallback, min, max) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        var parsed = parseFloat(value);
        if (isNaN(parsed)) {
            return fallback;
        }

        if (typeof min === 'number' && parsed < min) {
            parsed = min;
        }
        if (typeof max === 'number' && parsed > max) {
            parsed = max;
        }
        return parsed;
    }

    function getPointerFirstClickViewportWidth() {
        return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || (document.body && document.body.clientWidth) || 0;
    }

    function getPointerFirstClickViewportHeight() {
        return window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || (document.body && document.body.clientHeight) || 0;
    }

    function isNodeConnected(node) {
        if (!node) {
            return false;
        }

        if (typeof node.isConnected === 'boolean') {
            return node.isConnected;
        }

        var root = document.documentElement || document.body;
        return !!(root && root.contains && root.contains(node));
    }

    function isPointerFirstClickEditableElement(element) {
        var current = element && element.nodeType === 1 ? element : element && element.parentNode;
        while (current && current.nodeType === 1) {
            var tagName = current.tagName ? current.tagName.toLowerCase() : '';
            var role = current.getAttribute ? (current.getAttribute('role') || '').toLowerCase() : '';
            var type = current.getAttribute ? (current.getAttribute('type') || '').toLowerCase() : '';

            if (tagName === 'textarea' || current.isContentEditable) {
                return true;
            }

            if (tagName === 'input' && type !== 'button' && type !== 'submit' && type !== 'reset' && type !== 'checkbox' && type !== 'radio') {
                return true;
            }

            if (role === 'textbox' || role === 'spinbutton' || role === 'slider') {
                return true;
            }

            current = current.parentNode;
        }

        return false;
    }

    function isPointerFirstClickVisible(element) {
        if (!element || !element.getBoundingClientRect || !element.getClientRects || !element.getClientRects().length) {
            return false;
        }

        var rect = element.getBoundingClientRect();
        return rect.right > 0
            && rect.bottom > 0
            && rect.left < getPointerFirstClickViewportWidth()
            && rect.top < getPointerFirstClickViewportHeight();
    }

    function closestPointerFirstClickTarget(node) {
        var current = node && node.nodeType === 1 ? node : node && node.parentNode;
        while (current && current.nodeType === 1 && current !== document.body && current !== document.documentElement) {
            if (elementMatchesSelector(current, POINTER_FIRST_CLICK_FOCUS_TARGET_SELECTOR)) {
                return current;
            }
            current = current.parentNode;
        }

        return null;
    }

    function isPointerFirstClickDisabled(element) {
        if (!element) {
            return true;
        }

        if (element.disabled) {
            return true;
        }

        if (element.getAttribute && element.getAttribute('aria-disabled') === 'true') {
            return true;
        }

        return !!(element.classList && (element.classList.contains('disabled') || element.classList.contains('is-disabled')));
    }

    function canPointerFirstClickDirectlyActivate(element) {
        if (!element || !element.click || isPointerFirstClickDisabled(element) || isPointerFirstClickEditableElement(element)) {
            return false;
        }

        var tagName = element.tagName ? element.tagName.toLowerCase() : '';
        var role = element.getAttribute ? (element.getAttribute('role') || '').toLowerCase() : '';

        return tagName === 'a'
            || tagName === 'button'
            || tagName === 'input'
            || role === 'button'
            || role === 'link'
            || role === 'menuitem'
            || role === 'option'
            || !!(element.getAttribute && element.getAttribute('data-action'))
            || !!(element.classList && (
                element.classList.contains('card')
                || element.classList.contains('cardBox')
                || element.classList.contains('listItem')
                || element.classList.contains('itemAction')
                || element.classList.contains('emby-button')
            ));
    }

    function collectPointerFirstClickScrollState(element) {
        var states = [];
        var seen = [];

        function addNode(node) {
            if (!node || seen.indexOf(node) !== -1) {
                return;
            }
            seen.push(node);
            states.push({
                node: node,
                left: node.scrollLeft || 0,
                top: node.scrollTop || 0
            });
        }

        addNode(document.scrollingElement || document.documentElement || document.body);

        var current = element && element.parentNode;
        while (current && current.nodeType === 1) {
            if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
                addNode(current);
            }
            current = current.parentNode;
        }

        return states;
    }

    function restorePointerFirstClickScrollState(states) {
        if (!states) {
            return;
        }

        for (var i = 0; i < states.length; i++) {
            if (!states[i].node) {
                continue;
            }
            states[i].node.scrollLeft = states[i].left;
            states[i].node.scrollTop = states[i].top;
        }
    }

    function schedulePointerFirstClickScrollRestore(target, states) {
        for (var i = 0; i < POINTER_FIRST_CLICK_FOCUS_RESTORE_DELAYS.length; i++) {
            setTimeout(function () {
                if (isNodeConnected(target)) {
                    restorePointerFirstClickScrollState(states);
                }
            }, POINTER_FIRST_CLICK_FOCUS_RESTORE_DELAYS[i]);
        }
    }

    function focusPointerFirstClickTargetWithoutScroll(target) {
        if (!target || !target.focus) {
            return;
        }

        var states = collectPointerFirstClickScrollState(target);
        try {
            target.focus({ preventScroll: true });
        } catch (error) {
            try {
                target.focus();
            } catch (focusError) {
                return;
            }
        }

        restorePointerFirstClickScrollState(states);
        schedulePointerFirstClickScrollRestore(target, states);
    }

    function getPointerFirstClickEventPoint(event) {
        return {
            x: event && typeof event.clientX === 'number' ? event.clientX : null,
            y: event && typeof event.clientY === 'number' ? event.clientY : null
        };
    }

    function hasPointerFirstClickMovedTooFar(pending, event) {
        if (!pending || !event || typeof event.clientX !== 'number' || typeof event.clientY !== 'number'
            || typeof pending.x !== 'number' || typeof pending.y !== 'number') {
            return false;
        }

        var dx = event.clientX - pending.x;
        var dy = event.clientY - pending.y;
        return ((dx * dx) + (dy * dy)) > (POINTER_FIRST_CLICK_MAX_MOVE_PX * POINTER_FIRST_CLICK_MAX_MOVE_PX);
    }

    function suppressPointerFirstClickNativeClick(target, event) {
        var point = getPointerFirstClickEventPoint(event);
        pointerFirstClickSuppressTarget = target;
        pointerFirstClickSuppressUntil = Date.now() + POINTER_FIRST_CLICK_SUPPRESS_NATIVE_CLICK_MS;
        pointerFirstClickSuppressX = point.x;
        pointerFirstClickSuppressY = point.y;
    }

    function isPointerFirstClickDuplicateDirectActivation(target) {
        return pointerFirstClickLastDirectTarget === target && (Date.now() - pointerFirstClickLastDirectTs) < 350;
    }

    function markPointerFirstClickDirectActivation(target) {
        pointerFirstClickLastDirectTarget = target;
        pointerFirstClickLastDirectTs = Date.now();
    }

    function stopPointerFirstClickOriginalEvent(event) {
        if (event.preventDefault) {
            event.preventDefault();
        }
        if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
        } else if (event.stopPropagation) {
            event.stopPropagation();
        }
    }

    function isPointerFirstClickSuppressedNativeClick(event) {
        if (!pointerFirstClickSuppressTarget || Date.now() > pointerFirstClickSuppressUntil) {
            return false;
        }

        var target = closestPointerFirstClickTarget(event.target);
        var targetMatches = target === pointerFirstClickSuppressTarget
            || (pointerFirstClickSuppressTarget.contains && pointerFirstClickSuppressTarget.contains(event.target));
        if (targetMatches) {
            return true;
        }

        if (typeof pointerFirstClickSuppressX === 'number'
            && typeof pointerFirstClickSuppressY === 'number'
            && typeof event.clientX === 'number'
            && typeof event.clientY === 'number') {
            var dx = event.clientX - pointerFirstClickSuppressX;
            var dy = event.clientY - pointerFirstClickSuppressY;
            return ((dx * dx) + (dy * dy)) <= (POINTER_FIRST_CLICK_MAX_MOVE_PX * POINTER_FIRST_CLICK_MAX_MOVE_PX);
        }

        return false;
    }

    function clearPointerFirstClickSuppression() {
        pointerFirstClickSuppressTarget = null;
        pointerFirstClickSuppressUntil = 0;
        pointerFirstClickSuppressX = null;
        pointerFirstClickSuppressY = null;
    }

    function directlyActivatePointerFirstClickTarget(target, event, scrollStates) {
        if (isPointerFirstClickDuplicateDirectActivation(target)) {
            stopPointerFirstClickOriginalEvent(event);
            return;
        }

        var states = scrollStates || collectPointerFirstClickScrollState(target);
        markPointerFirstClickDirectActivation(target);
        stopPointerFirstClickOriginalEvent(event);
        restorePointerFirstClickScrollState(states);
        target.click();
        suppressPointerFirstClickNativeClick(target, event);
        restorePointerFirstClickScrollState(states);
        schedulePointerFirstClickScrollRestore(target, states);
    }

    function clearPointerFirstClickPending() {
        pointerFirstClickPending = null;
    }

    function isPointerFirstClickPendingLongPress(event) {
        return !!(pointerFirstClickPending
            && pointerFirstClickPending.startedAt
            && (Date.now() - pointerFirstClickPending.startedAt) > POINTER_FIRST_CLICK_LONG_PRESS_CANCEL_MS);
    }

    function eventMatchesPointerFirstClickPending(event) {
        if (!pointerFirstClickPending || !event) {
            return false;
        }

        if (isPointerFirstClickPendingLongPress(event)) {
            return false;
        }

        if (pointerFirstClickPending.eventType === 'pointer'
            && typeof event.pointerId !== 'undefined'
            && event.pointerId !== pointerFirstClickPending.pointerId) {
            return false;
        }

        return !hasPointerFirstClickMovedTooFar(pointerFirstClickPending, event);
    }

    function shouldHandlePointerFirstClickEvent(event) {
        if (!event || event.defaultPrevented) {
            return false;
        }

        if (isModifiedPointerFirstClickEvent(event)) {
            return false;
        }

        if (event.type === 'mousedown' && typeof event.button === 'number' && event.button !== 0) {
            return false;
        }

        if (event.type === 'pointerdown') {
            if (event.isPrimary === false) {
                return false;
            }
            if (typeof event.button === 'number' && event.button !== 0) {
                return false;
            }
            if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
                return false;
            }
            pointerFirstClickLastPointerDownTs = Date.now();
        }

        if (isInsideWebOSSettingsRoot(event.target)) {
            return false;
        }

        return true;
    }

    function isModifiedPointerFirstClickEvent(event) {
        return !!(event && (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey));
    }

    function shouldSuppressPointerFirstClickCompatMouseDown(event) {
        return !!(event
            && event.type === 'mousedown'
            && pointerFirstClickPending
            && pointerFirstClickPending.eventType === 'pointer');
    }

    function handlePointerFirstClickDown(event) {
        if (shouldSuppressPointerFirstClickCompatMouseDown(event)) {
            stopPointerFirstClickOriginalEvent(event);
            return;
        }

        if (!shouldHandlePointerFirstClickEvent(event)) {
            return;
        }

        var target = closestPointerFirstClickTarget(event.target);
        if (!target || !isPointerFirstClickVisible(target) || isPointerFirstClickDisabled(target)) {
            return;
        }

        if (!canPointerFirstClickDirectlyActivate(target)) {
            focusPointerFirstClickTargetWithoutScroll(target);
            return;
        }

        var point = getPointerFirstClickEventPoint(event);
        pointerFirstClickPending = {
            target: target,
            x: point.x,
            y: point.y,
            pointerId: typeof event.pointerId !== 'undefined' ? event.pointerId : null,
            eventType: event.type === 'pointerdown' ? 'pointer' : 'mouse',
            startedAt: Date.now(),
            scrollStates: collectPointerFirstClickScrollState(target)
        };
        stopPointerFirstClickOriginalEvent(event);
    }

    function handlePointerFirstClickUp(event) {
        if (!eventMatchesPointerFirstClickPending(event)) {
            if (pointerFirstClickPending && isPointerFirstClickPendingLongPress(event)) {
                suppressPointerFirstClickNativeClick(pointerFirstClickPending.target, event);
                stopPointerFirstClickOriginalEvent(event);
            }
            clearPointerFirstClickPending();
            return;
        }

        var pending = pointerFirstClickPending;
        clearPointerFirstClickPending();
        if (!pending.target || !isNodeConnected(pending.target) || isPointerFirstClickDisabled(pending.target)) {
            return;
        }

        directlyActivatePointerFirstClickTarget(pending.target, event, pending.scrollStates);
    }

    function handlePointerFirstClickCancel() {
        clearPointerFirstClickPending();
    }

    function handlePointerFirstClickNativeClick(event) {
        if (!pointerFirstClickSuppressTarget || Date.now() > pointerFirstClickSuppressUntil) {
            clearPointerFirstClickSuppression();
            return;
        }

        if (isPointerFirstClickSuppressedNativeClick(event)) {
            stopPointerFirstClickOriginalEvent(event);
            clearPointerFirstClickSuppression();
        }
    }

    function initPointerFirstClickFocusFix() {
        if (pointerFirstClickFocusInitialized) {
            return;
        }
        pointerFirstClickFocusInitialized = true;

        window.addEventListener('pointerdown', handlePointerFirstClickDown, true);
        window.addEventListener('pointerup', handlePointerFirstClickUp, true);
        window.addEventListener('pointercancel', handlePointerFirstClickCancel, true);
        window.addEventListener('mousedown', handlePointerFirstClickDown, true);
        window.addEventListener('mouseup', handlePointerFirstClickUp, true);
        window.addEventListener('click', handlePointerFirstClickNativeClick, true);
    }

    function clampHdrUiDimBrightness(value) {
        return parseStoredNumber(value, HDR_UI_DIM_DEFAULT_BRIGHTNESS, HDR_UI_DIM_MIN_BRIGHTNESS, HDR_UI_DIM_MAX_BRIGHTNESS);
    }

    function clampHdrSubtitleOpacity(value) {
        return parseStoredNumber(value, HDR_SUBTITLE_DEFAULT_OPACITY, HDR_SUBTITLE_MIN_OPACITY, HDR_SUBTITLE_MAX_OPACITY);
    }

    function brightnessToPercent(value) {
        return Math.round(clampHdrUiDimBrightness(value) * 100);
    }

    function opacityToPercent(value) {
        return Math.round(clampHdrSubtitleOpacity(value) * 100);
    }

    function percentToBrightness(value) {
        var parsedPercent = parseStoredNumber(value, HDR_UI_DIM_DEFAULT_PERCENT, HDR_UI_DIM_MIN_PERCENT, HDR_UI_DIM_MAX_PERCENT);
        return clampHdrUiDimBrightness(parsedPercent / 100);
    }

    function percentToOpacity(value) {
        var parsedPercent = parseStoredNumber(value, HDR_SUBTITLE_DEFAULT_OPACITY_PERCENT, HDR_SUBTITLE_MIN_OPACITY_PERCENT, HDR_SUBTITLE_MAX_OPACITY_PERCENT);
        return clampHdrSubtitleOpacity(parsedPercent / 100);
    }

    function getHdrDerivedBrightness(offset) {
        var brightness = hdrUiDimBrightness + offset;
        if (brightness > 1) {
            brightness = 1;
        }
        if (brightness < 0.08) {
            brightness = 0.08;
        }
        return brightness;
    }

    function getHdrSubtitleBrightness() {
        return getHdrDerivedBrightness(0.22);
    }

    function getHdrPgsOverlayBrightness() {
        return getHdrDerivedBrightness(0.2);
    }

    function getHdrSubtitleOpacity() {
        return hdrSubtitleOpacity;
    }

    function formatHdrUiDimBrightness(value) {
        return clampHdrUiDimBrightness(value).toFixed(2);
    }

    function formatHdrSubtitleOpacity(value) {
        return clampHdrSubtitleOpacity(value).toFixed(2);
    }

    function formatHdrUiDimPercentage(value) {
        return brightnessToPercent(value).toString() + '%';
    }

    function formatHdrSubtitleOpacityPercentage(value) {
        return opacityToPercent(value).toString() + '%';
    }

    function applyHdrUiDimSettings() {
        if (!document || !document.documentElement || !document.documentElement.style) {
            return;
        }

        document.documentElement.style.setProperty('--webos-hdr-ui-brightness', formatHdrUiDimBrightness(hdrUiDimBrightness));
        document.documentElement.style.setProperty('--webos-hdr-subtitle-brightness', formatHdrUiDimBrightness(getHdrSubtitleBrightness()));
        document.documentElement.style.setProperty('--webos-hdr-pgs-brightness', formatHdrUiDimBrightness(getHdrPgsOverlayBrightness()));
        document.documentElement.style.setProperty('--webos-hdr-subtitle-opacity', formatHdrSubtitleOpacity(getHdrSubtitleOpacity()));
    }

    function loadPersistedHdrUiDimBrightness() {
        try {
            if (!window.localStorage) {
                hdrUiDimBrightness = clampHdrUiDimBrightness(hdrUiDimBrightness);
                hdrSubtitleOpacity = clampHdrSubtitleOpacity(hdrSubtitleOpacity);
                return;
            }
            hdrUiDimBrightness = clampHdrUiDimBrightness(localStorage.getItem(HDR_UI_DIM_BRIGHTNESS_KEY));
            hdrSubtitleOpacity = clampHdrSubtitleOpacity(localStorage.getItem(HDR_SUBTITLE_OPACITY_KEY));
        } catch (error) {
            hdrUiDimBrightness = clampHdrUiDimBrightness(hdrUiDimBrightness);
            hdrSubtitleOpacity = clampHdrSubtitleOpacity(hdrSubtitleOpacity);
            warnLog('Failed to load persisted HDR UI dim brightness:', error);
        }
    }

    function savePersistedHdrUiDimBrightness() {
        try {
            if (!window.localStorage) {
                return;
            }
            localStorage.setItem(HDR_UI_DIM_BRIGHTNESS_KEY, formatHdrUiDimBrightness(hdrUiDimBrightness));
            localStorage.setItem(HDR_SUBTITLE_OPACITY_KEY, formatHdrSubtitleOpacity(hdrSubtitleOpacity));
        } catch (error) {
            warnLog('Failed to save persisted HDR UI dim brightness:', error);
        }
    }

    function schedulePersistedHdrSettingsSave() {
        if (hdrSettingsPersistTimer) {
            clearTimeout(hdrSettingsPersistTimer);
        }

        hdrSettingsPersistTimer = setTimeout(function () {
            hdrSettingsPersistTimer = null;
            savePersistedHdrUiDimBrightness();
        }, HDR_SETTINGS_PERSIST_DELAY);
    }

    function flushPersistedHdrSettingsSave() {
        if (hdrSettingsPersistTimer) {
            clearTimeout(hdrSettingsPersistTimer);
            hdrSettingsPersistTimer = null;
        }
        savePersistedHdrUiDimBrightness();
    }

    function setHdrUiDimBrightness(value, reason, persist) {
        var nextValue = clampHdrUiDimBrightness(value);
        var shouldPersist = persist !== false;
        if (Math.abs(nextValue - hdrUiDimBrightness) < 0.0001) {
            if (shouldPersist) {
                flushPersistedHdrSettingsSave();
            }
            return;
        }

        hdrUiDimBrightness = nextValue;
        if (shouldPersist) {
            flushPersistedHdrSettingsSave();
        }
        applyHdrUiDimSettings();
        refreshHdrUiDimming('brightness-change');
        debugLog('HDR UI dim brightness changed (' + reason + '): ' + formatHdrUiDimBrightness(hdrUiDimBrightness));
    }

    function setHdrSubtitleOpacity(value, reason, persist) {
        var nextValue = clampHdrSubtitleOpacity(value);
        var shouldPersist = persist !== false;
        if (Math.abs(nextValue - hdrSubtitleOpacity) < 0.0001) {
            if (shouldPersist) {
                flushPersistedHdrSettingsSave();
            }
            return;
        }

        hdrSubtitleOpacity = nextValue;
        if (shouldPersist) {
            flushPersistedHdrSettingsSave();
        }
        applyHdrUiDimSettings();
        refreshHdrUiDimming('subtitle-opacity-change');
        debugLog('HDR subtitle opacity changed (' + reason + '): ' + formatHdrSubtitleOpacity(hdrSubtitleOpacity));
    }

    function loadPersistedPlaybackDiagnosticsSettings() {
        try {
            if (!window.localStorage) {
                return;
            }
            playbackDiagnosticsEnabled = loadRegisteredBooleanFeature('playbackDiagnosticsEnabled', PLAYBACK_DIAGNOSTICS_KEY, playbackDiagnosticsEnabled);
            disableAssRenderAhead = loadRegisteredBooleanFeature('disableAssRenderAhead', DISABLE_ASS_RENDER_AHEAD_KEY, disableAssRenderAhead);
            assTimeSyncFixEnabled = loadRegisteredBooleanFeature('assTimeSyncFixEnabled', ASS_TIME_SYNC_FIX_KEY, assTimeSyncFixEnabled);
            pgsForceMainThread = loadRegisteredBooleanFeature('pgsForceMainThread', PGS_FORCE_MAIN_THREAD_KEY, pgsForceMainThread);
            pgsPatchObjectReuse = loadRegisteredBooleanFeature('pgsPatchObjectReuse', PGS_PATCH_OBJECT_REUSE_KEY, pgsPatchObjectReuse);
            lpcmAudioCopyEnabled = loadRegisteredBooleanFeature('lpcmAudioCopyEnabled', LPCM_AUDIO_COPY_KEY, lpcmAudioCopyEnabled);
        } catch (error) {
            warnLog('Failed to load persisted webOS diagnostics settings:', error);
        }
    }

    function savePersistedPlaybackDiagnosticsSettings() {
        try {
            if (!window.localStorage) {
                return;
            }
            saveRegisteredBooleanFeature('playbackDiagnosticsEnabled', PLAYBACK_DIAGNOSTICS_KEY, playbackDiagnosticsEnabled);
            saveRegisteredBooleanFeature('disableAssRenderAhead', DISABLE_ASS_RENDER_AHEAD_KEY, disableAssRenderAhead);
            saveRegisteredBooleanFeature('assTimeSyncFixEnabled', ASS_TIME_SYNC_FIX_KEY, assTimeSyncFixEnabled);
            saveRegisteredBooleanFeature('pgsForceMainThread', PGS_FORCE_MAIN_THREAD_KEY, pgsForceMainThread);
            saveRegisteredBooleanFeature('pgsPatchObjectReuse', PGS_PATCH_OBJECT_REUSE_KEY, pgsPatchObjectReuse);
            saveRegisteredBooleanFeature('lpcmAudioCopyEnabled', LPCM_AUDIO_COPY_KEY, lpcmAudioCopyEnabled);
        } catch (error) {
            warnLog('Failed to save webOS diagnostics settings:', error);
        }
    }

    function setFeatureFlag(enabled, reason, config) {
        var nextValue = !!enabled;
        if (config.getValue() === nextValue) {
            if (config.onNoChange) {
                config.onNoChange();
            }
            return;
        }
        config.setValue(nextValue);
        savePersistedPlaybackDiagnosticsSettings();
        if (config.syncFn) {
            config.syncFn();
        }
        emitFeatureOverridesChanged();
        debugLog(config.debugLabel + ' changed (' + reason + '): ' + nextValue);
    }

    function setDisableAssRenderAhead(enabled, reason) {
        setFeatureFlag(enabled, reason, {
            getValue: function () { return disableAssRenderAhead; },
            setValue: function (v) { disableAssRenderAhead = v; },
            syncFn: syncAssRendererOptions,
            debugLabel: 'ASS/libass render-ahead limit'
        });
    }

    function setAssTimeSyncFixEnabled(enabled, reason) {
        setFeatureFlag(enabled, reason, {
            getValue: function () { return assTimeSyncFixEnabled; },
            setValue: function (v) { assTimeSyncFixEnabled = v; },
            debugLabel: 'ASS/libass time rollback fix'
        });
    }

    function setPlaybackDiagnosticsEnabled(enabled, reason) {
        setFeatureFlag(enabled, reason, {
            getValue: function () { return playbackDiagnosticsEnabled; },
            setValue: function (v) { playbackDiagnosticsEnabled = v; },
            syncFn: updatePlaybackDiagnosticsOverlay,
            onNoChange: updatePlaybackDiagnosticsOverlay,
            debugLabel: 'Playback diagnostics overlay'
        });
    }

    function setPgsForceMainThread(enabled, reason) {
        setFeatureFlag(enabled, reason, {
            getValue: function () { return pgsForceMainThread; },
            setValue: function (v) { pgsForceMainThread = v; },
            syncFn: syncPgsRendererOptionsHelper,
            onNoChange: syncPgsRendererOptionsHelper,
            debugLabel: 'PGS force main-thread renderer'
        });
    }

    function setPgsPatchObjectReuse(enabled, reason) {
        setFeatureFlag(enabled, reason, {
            getValue: function () { return pgsPatchObjectReuse; },
            setValue: function (v) { pgsPatchObjectReuse = v; },
            syncFn: syncPgsRendererOptionsHelper,
            onNoChange: syncPgsRendererOptionsHelper,
            debugLabel: 'PGS object reuse patch'
        });
    }

    function setLpcmAudioCopyEnabled(enabled, reason) {
        setFeatureFlag(enabled, reason, {
            getValue: function () { return lpcmAudioCopyEnabled; },
            setValue: function (v) { lpcmAudioCopyEnabled = v; },
            debugLabel: 'LPCM/PCM audio copy'
        });
    }

    function emitFeatureOverridesChanged() {
        var values = {
            playbackDiagnosticsEnabled: !!playbackDiagnosticsEnabled,
            disableAssRenderAhead: !!disableAssRenderAhead,
            assTimeSyncFixEnabled: !!assTimeSyncFixEnabled,
            pgsForceMainThread: !!pgsForceMainThread,
            pgsPatchObjectReuse: !!pgsPatchObjectReuse,
            lpcmAudioCopyEnabled: !!lpcmAudioCopyEnabled
        };
        postMessage('WebOS.featureOverrides', webOSFeatureRegistry && webOSFeatureRegistry.createOverridePayload
            ? webOSFeatureRegistry.createOverridePayload(values)
            : values);
    }

    function syncAssRendererOptions() {
        window.WebOSAssRendererOptions = {
            limitRenderAhead: !!disableAssRenderAhead,
            renderAheadMiB: ASS_RENDER_AHEAD_LIMIT_MIB
        };
    }

    function findMonotonicMediaTimeEntry(video, namespace) {
        for (var i = 0; i < monotonicMediaTimeEntries.length; i++) {
            var entry = monotonicMediaTimeEntries[i];
            if (entry.video === video && entry.namespace === namespace) {
                return entry;
            }
        }
        return null;
    }

    function getMonotonicMediaTimeEntry(video, namespace) {
        var entry = findMonotonicMediaTimeEntry(video, namespace);
        if (entry) {
            return entry;
        }

        entry = {
            video: video,
            namespace: namespace,
            lastTime: null,
            lastUpdatedAt: 0
        };
        monotonicMediaTimeEntries.push(entry);
        return entry;
    }

    function shouldBypassMonotonicMediaTimeClamp(video) {
        return !!(video && (video.seeking || video.paused || video.ended));
    }

    function updatePgsTimeSampleStats(now) {
        var pgsRate = pgsTimeSampleRateTracker.record(now);
        if (pgsRate !== null) {
            pgsTimeSampleDisplayCount = pgsRate;
        }
    }

    function getMonotonicMediaTime(video, namespace, rawTime) {
        if (typeof rawTime !== 'number' || isNaN(rawTime) || !video) {
            return rawTime;
        }

        namespace = namespace || 'default';
        var now = Date.now();
        if (namespace === 'pgs') {
            updatePgsTimeSampleStats(now);
        }

        var entry = getMonotonicMediaTimeEntry(video, namespace);
        var nextTime = rawTime;
        if (typeof entry.lastTime === 'number' && rawTime < entry.lastTime) {
            var backwardsBy = entry.lastTime - rawTime;
            if (namespace === 'pgs') {
                var backwardsMs = Math.round(backwardsBy * 1000);
                pgsTimeBackwardCount++;
                pgsTimeMaxBackwardMs = Math.max(pgsTimeMaxBackwardMs, backwardsMs);
                pgsTimeLastBackwardInfo = backwardsMs.toString() + 'ms';
            }
            if (rawTime + ASS_TIME_SYNC_BACKWARD_TOLERANCE_SECONDS < entry.lastTime
                && !shouldBypassMonotonicMediaTimeClamp(video)
                && backwardsBy < ASS_TIME_SYNC_SEEK_BACK_SECONDS) {
                nextTime = entry.lastTime;
                if (namespace === 'pgs') {
                    pgsTimeClampCount++;
                    pgsTimeLastClampInfo = pgsTimeLastBackwardInfo;
                }
            }
        }

        entry.lastTime = nextTime;
        entry.lastUpdatedAt = now;
        return nextTime;
    }

    function syncMonotonicMediaTimeHelper() {
        window.WebOSMonotonicMediaTime = {
            get: getMonotonicMediaTime
        };
    }

    function syncPgsAsyncStatsHelper() {
        window.WebOSPgsAsyncStats = {
            request: function (index) {
                pgsAsyncRequestCount++;
                pgsAsyncLastInfo = 'req=' + index;
            },
            draw: function (index) {
                pgsAsyncDrawCount++;
                pgsAsyncLastInfo = 'draw=' + index;
            },
            drop: function (index, latestIndex) {
                pgsAsyncStaleDropCount++;
                pgsAsyncLastInfo = 'drop=' + index + ' latest=' + latestIndex;
            }
        };
    }

    function syncPgsMainThreadStatsHelper() {
        window.WebOSPgsMainThreadStats = {
            request: function (index) {
                pgsMainThreadRequestCount++;
                pgsMainThreadLastInfo = 'req=' + index;
            },
            draw: function (index) {
                pgsMainThreadDrawCount++;
                pgsMainThreadLastInfo = 'draw=' + index;
            },
            drop: function (index, latestIndex) {
                pgsMainThreadDropCount++;
                pgsMainThreadLastInfo = 'drop=' + index + ' latest=' + latestIndex;
            }
        };
    }

    function syncPgsRendererOptionsHelper() {
        var options = window.WebOSPgsRendererOptions || {};
        options.forceMainThread = !!pgsForceMainThread;
        options.patchObjectReuse = !!pgsPatchObjectReuse;
        window.WebOSPgsRendererOptions = options;
    }

    function createPgsRenderGuard() {
        var entries = [];

        function findEntry(renderer) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].renderer === renderer) {
                    return entries[i];
                }
            }
            return null;
        }

        function getEntry(renderer) {
            var entry = findEntry(renderer);
            if (entry) {
                return entry;
            }

            entry = {
                renderer: renderer,
                lastIndex: null,
                lastVideoTime: null,
                lastUpdatedAt: 0
            };
            entries.push(entry);
            return entry;
        }

        function getVideo() {
            return findPlaybackDiagnosticsVideo();
        }

        return {
            request: function (renderer, index) {
                pgsRenderRequestCount++;
                if (typeof index !== 'number' || isNaN(index)) {
                    pgsRenderPostCount++;
                    pgsRenderLastInfo = 'post=' + index;
                    return true;
                }

                var entry = getEntry(renderer);
                var video = getVideo();
                var videoTime = video && typeof video.currentTime === 'number' ? video.currentTime : null;
                var allowBackward = !!(video && (video.seeking || video.paused || video.ended));
                if (!allowBackward
                    && typeof videoTime === 'number'
                    && typeof entry.lastVideoTime === 'number'
                    && videoTime + ASS_TIME_SYNC_SEEK_BACK_SECONDS < entry.lastVideoTime) {
                    allowBackward = true;
                }

                if (typeof entry.lastIndex === 'number' && index < entry.lastIndex) {
                    pgsRenderBackwardCount++;
                    pgsRenderLastInfo = 'back=' + index + '<' + entry.lastIndex;
                    if (!allowBackward) {
                        pgsRenderDropCount++;
                        return false;
                    }
                }

                entry.lastIndex = index;
                entry.lastVideoTime = videoTime;
                entry.lastUpdatedAt = Date.now();
                pgsRenderPostCount++;
                pgsRenderLastInfo = 'post=' + index;
                return true;
            }
        };
    }

    function syncPgsRenderGuard() {
        window.WebOSPgsRenderGuard = createPgsRenderGuard();
    }

    function resetSubtitleTimingState(reason) {
        monotonicMediaTimeEntries = [];
        assWorkerVideoStateEntries = [];
        syncPgsRenderGuard();
        debugLog('Reset subtitle timing state (' + reason + ')');
    }

    function buildAssRenderAheadReplacement(originalValue) {
        return 'renderAhead:(window.WebOSAssRendererOptions&&window.WebOSAssRendererOptions.limitRenderAhead?window.WebOSAssRendererOptions.renderAheadMiB:' + originalValue + ')';
    }

    function buildPgsRenderAtVideoTimestampReplacement(methodPrefix) {
        return methodPrefix + '{if(this.video){var t=this.video.currentTime+this.$timeOffset;this.renderAtTimestamp(window.WebOSMonotonicMediaTime?window.WebOSMonotonicMediaTime.get(this.video,"pgs",t):t)}}';
    }

    function buildPgsAsyncSubtitleDataGuardReplacement() {
        return 'e.prototype.render=function(t){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,t))return;this.__webosLatestPgsIndex=t;window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.request(t);this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){if(e.data&&typeof e.data.index==="number"&&typeof this.__webosLatestPgsIndex==="number"&&e.data.index!==this.__webosLatestPgsIndex){window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.drop(e.data.index,this.__webosLatestPgsIndex);return}window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.draw(e.data&&e.data.index);var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
    }

    function buildPgsOffscreenRenderGuardReplacement() {
        return 'e.prototype.render=function(t){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,t))return;this.worker.postMessage({op:"render",index:t})}';
    }

    function buildPgsMainThreadRenderGuardReplacement(prototypeName, indexName, selfName, subtitleDataName) {
        return prototypeName + '.prototype.render=function(' + indexName + '){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,' + indexName + '))return;this.__webosLatestPgsIndex=' + indexName + ';window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.request(' + indexName + ');var ' + selfName + '=this,__webosRaf=window.requestAnimationFrame||function(e){return setTimeout(e,16)},__webosDefer=window.setTimeout||function(e){return __webosRaf(e)};__webosDefer((function(){if(' + selfName + '.__webosLatestPgsIndex!==' + indexName + '){window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.drop(' + indexName + ',' + selfName + '.__webosLatestPgsIndex);return}var ' + subtitleDataName + '=' + selfName + '.pgs.getSubtitleAtIndex(' + indexName + ');' + selfName + '.pgs.cacheSubtitleAtIndex(' + indexName + '+1);__webosRaf((function(){if(' + selfName + '.__webosLatestPgsIndex!==' + indexName + '){window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.drop(' + indexName + ',' + selfName + '.__webosLatestPgsIndex);return}window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.draw(' + indexName + ');' + selfName + '.renderer.draw(' + subtitleDataName + ')}))}),0)}';
    }

    function buildPgsLatestObjectDataReplacement(match, compositionName, paletteName, contextName, widthName, heightName, chunksName, indexName, arrayName, objectName) {
        return 'getPixelDataFromComposition=function(' + compositionName + ',' + paletteName + ',' + contextName + '){var ' + widthName + '=0,' + heightName + '=0,' + chunksName + '=[];if(window.WebOSPgsRendererOptions&&window.WebOSPgsRendererOptions.patchObjectReuse){for(var ' + indexName + '=' + contextName + '.length-1;' + indexName + '>=0;' + indexName + '--){var ' + objectName + '=' + contextName + '[' + indexName + '];if(' + objectName + '.id==' + compositionName + '.id){' + objectName + '.data&&' + chunksName + '.push(' + objectName + '.data);if(' + objectName + '.isFirstInSequence){' + widthName + '=' + objectName + '.width,' + heightName + '=' + objectName + '.height;break}}}' + chunksName + '.reverse()}else{for(var ' + indexName + '=0,' + arrayName + '=' + contextName + ';' + indexName + '<' + arrayName + '.length;' + indexName + '++){var ' + objectName + '=' + arrayName + '[' + indexName + '];' + objectName + '.id==' + compositionName + '.id&&(' + objectName + '.isFirstInSequence&&(' + widthName + '=' + objectName + '.width,' + heightName + '=' + objectName + '.height),' + objectName + '.data&&' + chunksName + '.push(' + objectName + '.data))}}if(0!=' + chunksName + '.length){';
    }

    function buildPgsForceMainThreadModeReplacement(match, optionsName, modeName, modeHelperName) {
        return 'createPgsRenderer=function(' + optionsName + '){var ' + modeName + ';switch(window.WebOSPgsRendererOptions&&window.WebOSPgsRendererOptions.forceMainThread?"mainThread":null!==(' + modeName + '=' + optionsName + '.mode)&&void 0!==' + modeName + '?' + modeName + ':' + modeHelperName + '.getRendererModeByPlatform()){';
    }

    function patchAssRendererScriptText(text, url) {
        if (!text || typeof text !== 'string') {
            return text;
        }

        if (text.indexOf('renderAhead') === -1) {
            return text;
        }

        var patched = text;
        patched = patched.replace(/renderAhead\s*:\s*90\.0\b/g, buildAssRenderAheadReplacement('90'));
        patched = patched.replace(/renderAhead\s*:\s*90(?!\.)\b/g, buildAssRenderAheadReplacement('90'));

        if (patched !== text) {
            assScriptPatchCount++;
            assScriptLastPatchInfo = 'patched ' + (url || 'script');
            debugLog('Patched ASS renderer script:', url || 'inline');
        }

        return patched;
    }

    function patchPgsRendererScriptText(text, url) {
        if (!text || typeof text !== 'string') {
            return text;
        }

        var mayPatchTime = text.indexOf('renderAtVideoTimestamp') !== -1 && text.indexOf('video.currentTime') !== -1;
        var mayPatchAsync = text.indexOf('requestSubtitleData') !== -1 && text.indexOf('subtitleData') !== -1;
        var mayPatchRender = text.indexOf('op:"render"') !== -1 && text.indexOf('transferControlToOffscreen') !== -1;
        var mayPatchMainThread = text.indexOf('getSubtitleAtIndex') !== -1 && text.indexOf('cacheSubtitleAtIndex') !== -1;
        var mayPatchObjectData = text.indexOf('getPixelDataFromComposition') !== -1 && text.indexOf('isFirstInSequence') !== -1;
        var mayPatchMode = text.indexOf('createPgsRenderer') !== -1 && text.indexOf('getRendererModeByPlatform') !== -1;
        if (!mayPatchTime && !mayPatchAsync && !mayPatchRender && !mayPatchMainThread && !mayPatchObjectData && !mayPatchMode) {
            return text;
        }

        var patched = text;
        var patchedTime = false;
        var patchedAsync = false;
        var patchedRender = false;
        var patchedMainThread = false;
        var patchedObjectData = false;
        var patchedMode = false;
        if (mayPatchTime) {
            var beforeTimePatch = patched;
            var prototypeNeedle = 'renderAtVideoTimestamp=function(){this.video&&this.renderAtTimestamp(this.video.currentTime+this.$timeOffset)}';
            var prototypeReplacement = buildPgsRenderAtVideoTimestampReplacement('renderAtVideoTimestamp=function()');
            patched = patched.split(prototypeNeedle).join(prototypeReplacement);
            patched = patched.replace(
                /renderAtVideoTimestamp\s*=\s*function\s*\(\)\s*\{\s*this\.video\s*&&\s*this\.renderAtTimestamp\s*\(\s*this\.video\.currentTime\s*\+\s*this\.\$timeOffset\s*\)\s*\}/g,
                prototypeReplacement
            );
            patched = patched.replace(
                /renderAtVideoTimestamp\s*\(\)\s*\{\s*this\.video\s*&&\s*this\.renderAtTimestamp\s*\(\s*this\.video\.currentTime\s*\+\s*this\.\$timeOffset\s*\)\s*\}/g,
                buildPgsRenderAtVideoTimestampReplacement('renderAtVideoTimestamp()')
            );
            patchedTime = patched !== beforeTimePatch;
        }

        if (mayPatchObjectData) {
            var beforeObjectDataPatch = patched;
            patched = patched.replace(
                /getPixelDataFromComposition=function\((\w+),(\w+),(\w+)\)\{for\(var (\w+)=0,(\w+)=0,(\w+)=\[\],(\w+)=0,(\w+)=\3;\7<\8\.length;\7\+\+\)\{var (\w+)=\8\[\7\];\9\.id==\1\.id&&\(\9\.isFirstInSequence&&\(\4=\9\.width,\5=\9\.height\),\9\.data&&\6\.push\(\9\.data\)\)\}if\(0!=\6\.length\)\{/g,
                buildPgsLatestObjectDataReplacement
            );
            patchedObjectData = patched !== beforeObjectDataPatch;
        }

        if (mayPatchMainThread) {
            var beforeMainThreadPatch = patched;
            patched = patched.replace(
                /(\w+)\.prototype\.render=function\((\w+)\)\{var (\w+)=this,(\w+)=this\.pgs\.getSubtitleAtIndex\(\2\);requestAnimationFrame\(\(function\(\)\{\3\.renderer\.draw\(\4\)\}\)\),this\.pgs\.cacheSubtitleAtIndex\(\2\+1\)\}/g,
                function (match, prototypeName, indexName, selfName, subtitleDataName) {
                    return buildPgsMainThreadRenderGuardReplacement(prototypeName, indexName, selfName, subtitleDataName);
                }
            );
            patchedMainThread = patched !== beforeMainThreadPatch;
        }

        if (mayPatchAsync) {
            var beforeAsyncPatch = patched;
            var asyncSubtitleDataNeedle = 'e.prototype.render=function(t){this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
            patched = patched.split(asyncSubtitleDataNeedle).join(buildPgsAsyncSubtitleDataGuardReplacement());
            patchedAsync = patched !== beforeAsyncPatch;
        }

        if (mayPatchRender) {
            var beforeRenderPatch = patched;
            var offscreenRenderNeedle = 'e.prototype.render=function(t){this.worker.postMessage({op:"render",index:t})}';
            patched = patched.split(offscreenRenderNeedle).join(buildPgsOffscreenRenderGuardReplacement());
            patchedRender = patched !== beforeRenderPatch;
        }

        if (mayPatchMode) {
            var beforeModePatch = patched;
            patched = patched.replace(
                /createPgsRenderer=function\((\w+)\)\{var (\w+);switch\(null!==\(\2=\1\.mode\)&&void 0!==\2\?\2:(\w+)\.getRendererModeByPlatform\(\)\)\{/g,
                buildPgsForceMainThreadModeReplacement
            );
            patchedMode = patched !== beforeModePatch;
        }

        if (patched !== text) {
            pgsScriptPatchCount++;
            if (patchedTime) {
                pgsScriptTimePatchCount++;
            }
            if (patchedAsync) {
                pgsScriptAsyncPatchCount++;
            }
            if (patchedRender) {
                pgsScriptRenderPatchCount++;
            }
            if (patchedMainThread) {
                pgsScriptMainThreadPatchCount++;
            }
            if (patchedObjectData) {
                pgsScriptObjectPatchCount++;
            }
            if (patchedMode) {
                pgsScriptModePatchCount++;
            }
            pgsScriptLastPatchInfo = 'patched ' + (url || 'script');
            debugLog('Patched PGS renderer script:', url || 'inline');
        }

        if ((pgsForceMainThread && mayPatchMode && !patchedMode)
            || (pgsPatchObjectReuse && mayPatchObjectData && !patchedObjectData)) {
            pgsScriptLastPatchInfo = 'missing critical PGS patch ' + (url || 'script')
                + ' mode=' + (patchedMode ? '1' : '0')
                + ' obj=' + (patchedObjectData ? '1' : '0');
            warnLog('PGS renderer critical patch did not match:', pgsScriptLastPatchInfo);
        }

        return patched;
    }

    function patchSubtitleRendererScriptText(text, url) {
        var patched = patchAssRendererScriptText(text, url);
        return patchPgsRendererScriptText(patched, url);
    }

    function dispatchScriptLoadEvent(script, type) {
        var dispatched = false;
        try {
            var event;
            if (typeof Event === 'function') {
                event = new Event(type);
            } else {
                event = document.createEvent('Event');
                event.initEvent(type, false, false);
            }
            script.dispatchEvent(event);
            dispatched = true;
        } catch (error) {
            // Ignore synthetic event failures on older WebViews.
        }

        var handler = type === 'load' ? script.onload : script.onerror;
        if (!dispatched && typeof handler === 'function') {
            try {
                handler.call(script);
            } catch (handlerError) {
                setTimeout(function () {
                    throw handlerError;
                }, 0);
            }
        }
    }

    function copyScriptAttributes(source, target) {
        if (!source || !target || !source.attributes) {
            return;
        }

        for (var i = 0; i < source.attributes.length; i++) {
            var attribute = source.attributes[i];
            if (!attribute || !attribute.name || attribute.name.toLowerCase() === 'src') {
                continue;
            }
            if (attribute.name.toLowerCase() === 'integrity') {
                continue;
            }
            try {
                target.setAttribute(attribute.name, attribute.value);
            } catch (error) {
                // Ignore attributes unsupported by the current WebView.
            }
        }
    }

    function isLikelySubtitleRendererScriptUrl(src) {
        if (!src || typeof src !== 'string') {
            return false;
        }

        var normalizedSrc = src.toLowerCase();
        return normalizedSrc.indexOf('libass') !== -1
            || /(^|[\/._-])ass([\/._-]|$)/.test(normalizedSrc)
            || normalizedSrc.indexOf('htmlvideoplayer') !== -1
            || normalizedSrc.indexOf('html-video-player') !== -1
            || normalizedSrc.indexOf('pgs') !== -1
            || normalizedSrc.indexOf('subtitle') !== -1
            || normalizedSrc.indexOf('octopus') !== -1
            || normalizedSrc.indexOf('subtitles') !== -1;
    }

    function isSameOriginOrRelativeScriptUrl(src) {
        if (!src || typeof src !== 'string') {
            return false;
        }

        if (/^(?:blob|data|javascript):/i.test(src)) {
            return false;
        }

        var anchor = document.createElement('a');
        anchor.href = src;
        if (!anchor.hostname) {
            return true;
        }

        return anchor.protocol === window.location.protocol
            && anchor.hostname === window.location.hostname
            && (anchor.port || '') === (window.location.port || '');
    }

    function shouldSpeculativelyInspectEarlyScript(src) {
        if ((Date.now() - externalScriptPatchStartTs) > SCRIPT_PATCH_EARLY_INSPECT_WINDOW_MS) {
            return false;
        }

        if (externalScriptPatchEarlyInspectCount >= SCRIPT_PATCH_EARLY_INSPECT_LIMIT) {
            return false;
        }

        if (!isSameOriginOrRelativeScriptUrl(src)) {
            return false;
        }

        externalScriptPatchEarlyInspectCount++;
        return true;
    }

    function shouldInspectExternalScriptForSubtitlePatches(src) {
        return isLikelySubtitleRendererScriptUrl(src)
            || playbackState === PlaybackState.PLAYING
            || shouldForcePlaybackStartMaxBitrate()
            || !!currentMediaSessionItemId
            || shouldSpeculativelyInspectEarlyScript(src);
    }

    function canPatchExternalScript(script) {
        if (!script || !script.tagName || script.tagName.toLowerCase() !== 'script') {
            return false;
        }
        if (script.__webOsAssScriptIntercepted) {
            return false;
        }

        var src = script.src || script.getAttribute('src');
        if (!src || !/\.js(?:[?#]|$)/i.test(src)) {
            return false;
        }

        return src.indexOf('blob:') !== 0
            && src.indexOf('data:') !== 0
            && shouldInspectExternalScriptForSubtitlePatches(src);
    }

    function finishExternalScriptPatchTask(task) {
        if (!task || task.finished) {
            return;
        }

        task.finished = true;
        externalScriptPatchQueueActive = false;
        processExternalScriptPatchQueue();
    }

    function insertScriptNode(task, node) {
        if (!task || !node) {
            return false;
        }

        try {
            task.originalInsert.call(task.parent, node, task.refNode || null);
            return true;
        } catch (error) {
            if (!task.refNode) {
                debugLog('Failed to insert intercepted script:', error);
                return false;
            }

            try {
                task.originalInsert.call(task.parent, node, null);
                return true;
            } catch (fallbackError) {
                debugLog('Failed to append intercepted script:', fallbackError);
                return false;
            }
        }
    }

    function insertOriginalScriptTask(task) {
        var completed = false;
        function done() {
            if (completed) {
                return;
            }
            completed = true;
            finishExternalScriptPatchTask(task);
        }

        var timeoutId = setTimeout(done, SCRIPT_PATCH_FETCH_TIMEOUT_MS);
        function finishFromEvent() {
            clearTimeout(timeoutId);
            done();
        }

        if (task.script.addEventListener) {
            task.script.addEventListener('load', finishFromEvent);
            task.script.addEventListener('error', finishFromEvent);
        }

        if (!insertScriptNode(task, task.script)) {
            clearTimeout(timeoutId);
            done();
        }
    }

    function insertPatchedScriptTask(task, patchedText) {
        var inlineScript = document.createElement('script');
        copyScriptAttributes(task.script, inlineScript);
        inlineScript.text = patchedText + '\n//# sourceURL=' + task.src;
        inlineScript.__webOsAssScriptIntercepted = true;

        if (!insertScriptNode(task, inlineScript)) {
            insertOriginalScriptTask(task);
            return;
        }

        setTimeout(function () {
            dispatchScriptLoadEvent(task.script, 'load');
            finishExternalScriptPatchTask(task);
        }, 0);
    }

    function processExternalScriptPatchQueue() {
        if (externalScriptPatchQueueActive || !externalScriptPatchQueue.length) {
            return;
        }

        externalScriptPatchQueueActive = true;
        var task = externalScriptPatchQueue.shift();
        var xhr = new XMLHttpRequest();
        var fetchCompleted = false;

        function finishFetchWithOriginal() {
            if (fetchCompleted) {
                return;
            }
            fetchCompleted = true;
            insertOriginalScriptTask(task);
        }

        var timeoutId = setTimeout(function () {
            debugLog('Timed out fetching intercepted script:', task.src);
            finishFetchWithOriginal();
        }, task.fetchTimeout || SCRIPT_PATCH_FETCH_TIMEOUT_MS);

        xhr.open('GET', task.src, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || fetchCompleted) {
                return;
            }

            clearTimeout(timeoutId);
            fetchCompleted = true;

            if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
                var patchedText = patchSubtitleRendererScriptText(xhr.responseText, task.src);
                if (patchedText !== xhr.responseText) {
                    insertPatchedScriptTask(task, patchedText);
                    return;
                }
            }

            insertOriginalScriptTask(task);
        };
        xhr.onerror = function () {
            clearTimeout(timeoutId);
            finishFetchWithOriginal();
        };

        try {
            xhr.send();
        } catch (error) {
            clearTimeout(timeoutId);
            finishFetchWithOriginal();
        }
    }

    function fetchAndInjectPatchedScript(parent, script, refNode, originalInsert) {
        var src = script.src || script.getAttribute('src');
        var speculative = !isLikelySubtitleRendererScriptUrl(src)
            && playbackState !== PlaybackState.PLAYING
            && !shouldForcePlaybackStartMaxBitrate()
            && !currentMediaSessionItemId;
        script.__webOsAssScriptIntercepted = true;
        externalScriptPatchQueue.push({
            parent: parent,
            script: script,
            refNode: refNode || null,
            originalInsert: originalInsert,
            src: src,
            fetchTimeout: speculative ? SCRIPT_PATCH_SPECULATIVE_FETCH_TIMEOUT_MS : SCRIPT_PATCH_FETCH_TIMEOUT_MS
        });
        processExternalScriptPatchQueue();
    }

    function initAssScriptInterception() {
        if (assScriptInterceptionInitialized || !window.Node || !window.Node.prototype) {
            return;
        }
        assScriptInterceptionInitialized = true;

        var originalAppendChild = window.Node.prototype.appendChild;
        var originalInsertBefore = window.Node.prototype.insertBefore;
        if (!originalAppendChild || !originalInsertBefore || originalAppendChild.__webOsAssScriptHooked) {
            return;
        }

        window.Node.prototype.appendChild = function (node) {
            if (canPatchExternalScript(node)) {
                fetchAndInjectPatchedScript(this, node, null, originalInsertBefore);
                return node;
            }
            return originalAppendChild.apply(this, arguments);
        };

        window.Node.prototype.insertBefore = function (node, referenceNode) {
            if (canPatchExternalScript(node)) {
                fetchAndInjectPatchedScript(this, node, referenceNode || null, originalInsertBefore);
                return node;
            }
            return originalInsertBefore.apply(this, arguments);
        };

        window.Node.prototype.appendChild.__webOsAssScriptHooked = true;
    }

    function isAssWorkerInitMessage(message) {
        if (!message || typeof message !== 'object' || message.target !== 'worker-init') {
            return false;
        }

        return message.renderMode === 'wasm-blend'
            || message.renderMode === 'js-blend'
            || message.renderMode === 'lossy'
            || typeof message.subUrl === 'string'
            || typeof message.subContent === 'string'
            || typeof message.targetFps !== 'undefined'
            || typeof message.libassMemoryLimit !== 'undefined'
            || typeof message.libassGlyphLimit !== 'undefined';
    }

    function markAssWorker(worker) {
        try {
            worker.__webOsAssWorker = true;
        } catch (error) {
            // Ignore non-extensible worker objects.
        }
    }

    function unmarkAssWorker(worker) {
        try {
            worker.__webOsAssWorker = false;
        } catch (error) {
            // Ignore non-extensible worker objects.
        }
    }

    function isKnownAssWorker(worker) {
        return !!(worker && worker.__webOsAssWorker);
    }

    function patchAssWorkerInitMessage(worker, message) {
        if (!isAssWorkerInitMessage(message)) {
            return message;
        }

        markAssWorker(worker);

        return message;
    }

    function findAssWorkerVideoStateEntry(worker) {
        for (var i = 0; i < assWorkerVideoStateEntries.length; i++) {
            if (assWorkerVideoStateEntries[i].worker === worker) {
                return assWorkerVideoStateEntries[i];
            }
        }
        return null;
    }

    function getAssWorkerVideoStateEntry(worker) {
        var entry = findAssWorkerVideoStateEntry(worker);
        if (entry) {
            return entry;
        }

        entry = {
            worker: worker,
            lastPostedCurrentTime: null,
            lastPostedAt: 0,
            lastPostedPaused: true,
            lastPostedRate: 1
        };
        assWorkerVideoStateEntries.push(entry);
        return entry;
    }

    function removeAssWorkerVideoStateEntry(worker) {
        for (var i = 0; i < assWorkerVideoStateEntries.length; i++) {
            if (assWorkerVideoStateEntries[i].worker === worker) {
                assWorkerVideoStateEntries.splice(i, 1);
                return;
            }
        }
    }

    function updateAssWorkerVideoMessageStats(now) {
        var assMsgRate = assWorkerVideoMessageRateTracker.record(now);
        if (assMsgRate !== null) {
            assWorkerVideoMessageDisplayCount = assMsgRate;
        }
    }

    function getPredictedAssWorkerTime(entry, now) {
        if (!entry || typeof entry.lastPostedCurrentTime !== 'number') {
            return null;
        }

        if (entry.lastPostedPaused) {
            return entry.lastPostedCurrentTime;
        }

        var elapsedSeconds = Math.max(0, (now - entry.lastPostedAt) / 1000);
        return entry.lastPostedCurrentTime + elapsedSeconds * entry.lastPostedRate;
    }

    function patchAssWorkerVideoMessage(worker, message) {
        if (!isKnownAssWorker(worker) || !message || typeof message !== 'object' || message.target !== 'video') {
            return message;
        }

        var entry = getAssWorkerVideoStateEntry(worker);
        var now = Date.now();
        var patched = message;
        var hasCurrentTime = typeof message.currentTime === 'number' && !isNaN(message.currentTime);
        var nextPaused = typeof message.isPaused === 'boolean' ? message.isPaused : entry.lastPostedPaused;
        var nextRate = typeof message.rate === 'number' && message.rate > 0 ? message.rate : entry.lastPostedRate;

        updateAssWorkerVideoMessageStats(now);

        if (hasCurrentTime) {
            var nextCurrentTime = message.currentTime;
            // Clamp samples that fall behind the worker's smooth extrapolation, not just
            // raw backwards samples — under load most regressions look like "behind by 20-80ms"
            // rather than a literal numeric decrease. Clamp to predictedTime so the worker's
            // clock advances monotonically; pinning to lastPostedCurrentTime would re-anchor
            // it on a stale value.
            var predictedTime = getPredictedAssWorkerTime(entry, now);
            if (assTimeSyncFixEnabled
                && typeof predictedTime === 'number'
                && nextCurrentTime + ASS_TIME_SYNC_BACKWARD_TOLERANCE_SECONDS < predictedTime) {
                var backwardsBy = predictedTime - nextCurrentTime;
                if (backwardsBy < ASS_TIME_SYNC_SEEK_BACK_SECONDS) {
                    patched = cloneShallowObject(message);
                    patched.currentTime = predictedTime;
                    nextCurrentTime = predictedTime;
                    assWorkerTimeSyncClampCount++;
                    assWorkerVideoMessagePatchCount++;
                }
            }

            entry.lastPostedCurrentTime = nextCurrentTime;
            entry.lastPostedAt = now;
        }

        entry.lastPostedPaused = nextPaused;
        entry.lastPostedRate = nextRate;

        return patched;
    }

    function initAssRendererInterception() {
        if (assRendererInterceptionInitialized || !window.Worker || !window.Worker.prototype || !window.Worker.prototype.postMessage) {
            return;
        }
        assRendererInterceptionInitialized = true;

        var originalPostMessage = window.Worker.prototype.postMessage;
        var originalTerminate = window.Worker.prototype.terminate;
        if (originalPostMessage.__webOsAssWorkerHooked) {
            return;
        }

        var patchedPostMessage = function () {
            var message = arguments.length ? arguments[0] : null;
            var patchedMessage = patchAssWorkerInitMessage(this, message);
            patchedMessage = patchAssWorkerVideoMessage(this, patchedMessage);
            if (patchedMessage === message) {
                var originalResult = originalPostMessage.apply(this, arguments);
                if (message && typeof message === 'object' && message.target === 'destroy') {
                    unmarkAssWorker(this);
                    removeAssWorkerVideoStateEntry(this);
                }
                return originalResult;
            }

            var args = [];
            for (var i = 0; i < arguments.length; i++) {
                args[i] = arguments[i];
            }
            args[0] = patchedMessage;
            var patchedResult = originalPostMessage.apply(this, args);
            if (patchedMessage && typeof patchedMessage === 'object' && patchedMessage.target === 'destroy') {
                unmarkAssWorker(this);
                removeAssWorkerVideoStateEntry(this);
            }
            return patchedResult;
        };
        patchedPostMessage.__webOsAssWorkerHooked = true;
        patchedPostMessage.__webOsOriginalPostMessage = originalPostMessage;
        window.Worker.prototype.postMessage = patchedPostMessage;

        if (originalTerminate && !originalTerminate.__webOsAssWorkerHooked) {
            var patchedTerminate = function () {
                unmarkAssWorker(this);
                removeAssWorkerVideoStateEntry(this);
                return originalTerminate.apply(this, arguments);
            };
            patchedTerminate.__webOsAssWorkerHooked = true;
            patchedTerminate.__webOsOriginalTerminate = originalTerminate;
            window.Worker.prototype.terminate = patchedTerminate;
        }
    }

    function createWebOSCheckboxControlContainer(checkboxClassName, title, description) {
        var container = document.createElement('div');
        container.className = 'checkboxContainer checkboxContainer-withDescription webos-settings-control';
        container.innerHTML = '<label>' +
            '<input type="checkbox" is="emby-checkbox" class="' + checkboxClassName + '" />' +
            '<span>' + title + '</span>' +
            '</label>' +
            '<div class="fieldDescription checkboxFieldDescription">' + description + '</div>';
        return container;
    }

    function createHdrUiDimControlContainer() {
        var container = document.createElement('div');
        container.className = 'checkboxContainer checkboxContainer-withDescription webos-hdr-ui-dim-control';
        container.innerHTML = '<label class="webos-hdr-ui-dim-header">' +
            '<span>webOS: HDR/DV UI brightness</span>' +
            '<span class="webos-hdr-ui-dim-value"></span>' +
            '</label>' +
            '<div class="webos-hdr-ui-dim-slider-wrap">' +
            '<input type="range" class="webosHdrUiDimSlider" min="' + HDR_UI_DIM_MIN_PERCENT.toString() + '" max="' + HDR_UI_DIM_MAX_PERCENT.toString() + '" step="1" />' +
            '</div>' +
            '<div class="fieldDescription checkboxFieldDescription">Adjust overlay UI and ASS/PGS subtitle brightness during HDR/Dolby Vision playback. Lower percentage = darker.</div>';
        return container;
    }

    function createHdrSubtitleOpacityControlContainer() {
        var container = document.createElement('div');
        container.className = 'checkboxContainer checkboxContainer-withDescription webos-hdr-ui-dim-control webos-hdr-subtitle-opacity-control';
        container.innerHTML = '<label class="webos-hdr-ui-dim-header">' +
            '<span>webOS: HDR/DV subtitle opacity</span>' +
            '<span class="webos-hdr-subtitle-opacity-value"></span>' +
            '</label>' +
            '<div class="webos-hdr-ui-dim-slider-wrap">' +
            '<input type="range" class="webosHdrSubtitleOpacitySlider" min="' + HDR_SUBTITLE_MIN_OPACITY_PERCENT.toString() + '" max="' + HDR_SUBTITLE_MAX_OPACITY_PERCENT.toString() + '" step="1" />' +
            '</div>' +
            '<div class="fieldDescription checkboxFieldDescription">Adjust ASS/PGS subtitle opacity during HDR/Dolby Vision playback.</div>';
        return container;
    }

    function findParentByClass(element, className) {
        var current = element;
        while (current) {
            if (current.classList && current.classList.contains(className)) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    function getControlContainerBySelector(selector) {
        var element = document.querySelector(selector);
        if (!element) {
            return null;
        }
        return findParentByClass(element, 'checkboxContainer');
    }

    function getNearestControlContainer(element) {
        if (!element) {
            return null;
        }

        return findParentByClass(element, 'checkboxContainer')
            || findParentByClass(element, 'selectContainer')
            || element;
    }

    function getPlaybackSettingsAnchor() {
        return getNearestControlContainer(document.querySelector('.fldEnableDts'))
            || getNearestControlContainer(document.querySelector('.chkEnableDts'))
            || getNearestControlContainer(document.querySelector('.fldEnableTrueHd'))
            || getNearestControlContainer(document.querySelector('.chkEnableTrueHd'))
            || getNearestControlContainer(document.querySelector('#selectPreferredTranscodeVideoCodec'))
            || getNearestControlContainer(document.querySelector('#selectAllowedAudioChannels'))
            || getNearestControlContainer(document.querySelector('.selectVideoInNetworkQuality'))
            || getNearestControlContainer(document.querySelector('.selectVideoInternetQuality'));
    }

    function isValidPlaybackSettingsRoot(candidate, selector) {
        if (!candidate || candidate === document.body || !candidate.querySelector) {
            return false;
        }

        return !!(candidate.querySelector(selector)
            && candidate.querySelectorAll('.checkboxContainer,.selectContainer,.inputContainer').length >= 3);
    }

    function getPlaybackSettingsRoot(settingsAnchor) {
        var anchorContainer = getNearestControlContainer(settingsAnchor);
        var selector = '.fldEnableDts,.chkEnableDts,.fldEnableTrueHd,.chkEnableTrueHd,#selectPreferredTranscodeVideoCodec,#selectAllowedAudioChannels,.selectVideoInNetworkQuality,.selectVideoInternetQuality';
        var current = anchorContainer ? anchorContainer.parentNode : settingsAnchor && settingsAnchor.parentNode;
        var fallbackRoot = null;
        while (current && current !== document.body) {
            if (current.querySelector && current.querySelector(selector)) {
                if (!fallbackRoot) {
                    fallbackRoot = current;
                }
                if (isValidPlaybackSettingsRoot(current, selector)) {
                    return current;
                }
            }
            current = current.parentNode;
        }

        return fallbackRoot;
    }

    function createWebOSSettingsRoot() {
        var root = document.createElement('div');
        root.className = 'webos-settings-section-root';
        return root;
    }

    function ensureWebOSSettingsRootHeading(root) {
        var heading = root.querySelector('.webos-settings-main-title');
        if (!heading) {
            heading = document.createElement('h2');
            heading.className = 'webos-settings-main-title';
            heading.textContent = 'webOS playback fixes';
        }
        if (root.firstChild !== heading) {
            root.insertBefore(heading, root.firstChild);
        }
    }

    function ensureWebOSSettingsRoot(settingsAnchor) {
        var playbackSettingsRoot = getPlaybackSettingsRoot(settingsAnchor);
        if (!playbackSettingsRoot) {
            removeWebOSSettingsRoot();
            return null;
        }

        var root = document.querySelector('.webos-settings-section-root') || createWebOSSettingsRoot();
        if (root.parentNode !== playbackSettingsRoot || root.nextSibling) {
            playbackSettingsRoot.appendChild(root);
        }
        ensureWebOSSettingsRootHeading(root);
        return root;
    }

    function removeWebOSSettingsRoot() {
        var root = document.querySelector('.webos-settings-section-root');
        if (root && root.parentNode) {
            root.parentNode.removeChild(root);
        }
    }

    function ensureWebOSSettingsGroup(root, groupClassName, title) {
        var group = root.querySelector('.' + groupClassName);
        if (!group) {
            group = document.createElement('div');
            group.className = 'webos-settings-group ' + groupClassName;
            var heading = document.createElement('h3');
            heading.className = 'webos-settings-group-title';
            heading.textContent = title;
            group.appendChild(heading);
        }
        if (group.parentNode !== root) {
            root.appendChild(group);
        }
        return group;
    }

    function appendControlToGroup(group, control) {
        if (group && control && control.parentNode !== group) {
            group.appendChild(control);
        }
    }

    function updateHdrUiDimControlDisplay(container) {
        if (!container) {
            return;
        }

        var slider = container.querySelector('.webosHdrUiDimSlider');
        var valueLabel = container.querySelector('.webos-hdr-ui-dim-value');
        var sliderValue = brightnessToPercent(hdrUiDimBrightness).toString();
        var displayValue = formatHdrUiDimPercentage(hdrUiDimBrightness);

        if (slider) {
            slider.value = sliderValue;
        }
        if (valueLabel) {
            valueLabel.textContent = displayValue;
        }
    }

    function updateHdrSubtitleOpacityControlDisplay(container) {
        if (!container) {
            return;
        }

        var slider = container.querySelector('.webosHdrSubtitleOpacitySlider');
        var valueLabel = container.querySelector('.webos-hdr-subtitle-opacity-value');
        var sliderValue = opacityToPercent(hdrSubtitleOpacity).toString();
        var displayValue = formatHdrSubtitleOpacityPercentage(hdrSubtitleOpacity);

        if (slider) {
            slider.value = sliderValue;
        }
        if (valueLabel) {
            valueLabel.textContent = displayValue;
        }
    }

    function initializeHdrSlider(container, config) {
        if (!container) {
            return;
        }

        var slider = container.querySelector(config.sliderClass);
        if (!slider) {
            return;
        }

        if (slider.getAttribute('data-webos-init') !== 'true') {
            slider.addEventListener('input', function () {
                config.setValue(slider.value, false);
                schedulePersistedHdrSettingsSave();
                config.updateDisplay(container);
            });
            slider.addEventListener('change', function () {
                config.setValue(slider.value, true);
                config.updateDisplay(container);
            });
            slider.addEventListener('blur', function () {
                flushPersistedHdrSettingsSave();
            });
            slider.addEventListener('pointerup', function () {
                flushPersistedHdrSettingsSave();
            });
            slider.addEventListener('keyup', function () {
                flushPersistedHdrSettingsSave();
            });
            slider.setAttribute('data-webos-init', 'true');
        }

        config.updateDisplay(container);
    }

    function initializeHdrUiDimControl(container) {
        initializeHdrSlider(container, {
            sliderClass: '.webosHdrUiDimSlider',
            setValue: function (value, isFinal) {
                setHdrUiDimBrightness(
                    percentToBrightness(value),
                    isFinal ? 'settings-slider-change' : 'settings-slider-input',
                    isFinal
                );
            },
            updateDisplay: updateHdrUiDimControlDisplay
        });
    }

    function initializeHdrSubtitleOpacityControl(container) {
        initializeHdrSlider(container, {
            sliderClass: '.webosHdrSubtitleOpacitySlider',
            setValue: function (value, isFinal) {
                setHdrSubtitleOpacity(
                    percentToOpacity(value),
                    isFinal ? 'settings-opacity-slider-change' : 'settings-opacity-slider-input',
                    isFinal
                );
            },
            updateDisplay: updateHdrSubtitleOpacityControlDisplay
        });
    }

    function getNativeVideoQualitySelects() {
        var result = [];
        var seen = [];
        var nodes = document.querySelectorAll('.selectVideoInNetworkQuality,.selectVideoInternetQuality');

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var select = node && node.tagName && node.tagName.toLowerCase() === 'select'
                ? node
                : node && node.querySelector ? node.querySelector('select') : null;
            if (!select || seen.indexOf(select) !== -1) {
                continue;
            }
            seen.push(select);
            result.push(select);
        }

        return result;
    }

    function hasClassInAncestry(element, className) {
        var current = element;
        while (current && current.nodeType === 1) {
            if (current.classList && current.classList.contains(className)) {
                return true;
            }
            current = current.parentNode;
        }
        return false;
    }

    function getStoredNativeVideoQualityValue(select) {
        if (!select || !window.localStorage) {
            return null;
        }

        var key = null;
        if (hasClassInAncestry(select, 'selectVideoInNetworkQuality')) {
            key = 'maxbitrate-Video-true';
        } else if (hasClassInAncestry(select, 'selectVideoInternetQuality')) {
            key = 'maxbitrate-Video-false';
        }

        if (!key) {
            return null;
        }

        try {
            var value = localStorage.getItem(key);
            return parsePositiveInteger(value) > 0 ? value : null;
        } catch (error) {
            return null;
        }
    }

    function addNativeBitrateSelectOption(select, bitrate) {
        if (!select || !bitrate) {
            return false;
        }

        var value = bitrate.toString();
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === value) {
                return false;
            }
        }

        var option = document.createElement('option');
        option.value = value;
        option.textContent = formatMbpsLabel(bitrate);
        option.setAttribute('data-webos-added', 'true');

        var insertBefore = null;
        for (var j = 0; j < select.options.length; j++) {
            var optionBitrate = parsePositiveInteger(select.options[j].value);
            if (optionBitrate > 0 && optionBitrate < bitrate) {
                insertBefore = select.options[j];
                break;
            }
        }

        select.insertBefore(option, insertBefore);
        return true;
    }

    function selectHasOptionValue(select, value) {
        if (!select || value === null || value === undefined) {
            return false;
        }

        var normalizedValue = value.toString();
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === normalizedValue) {
                return true;
            }
        }

        return false;
    }

    function patchNativeVideoQualitySelects() {
        var selects = getNativeVideoQualitySelects();
        var changed = false;

        for (var i = 0; i < selects.length; i++) {
            var select = selects[i];
            var patchedBefore = select.getAttribute('data-webos-quality-patched') === 'true';
            var storedValue = getStoredNativeVideoQualityValue(select);
            var currentValue = select.value;
            var addedForSelect = false;

            for (var j = 0; j < QUALITY_MENU_EXTRA_BITRATES.length; j++) {
                if (addNativeBitrateSelectOption(select, QUALITY_MENU_EXTRA_BITRATES[j])) {
                    changed = true;
                    addedForSelect = true;
                }
            }

            if (storedValue
                && selectHasOptionValue(select, storedValue)
                && (!patchedBefore || addedForSelect || !currentValue || currentValue === storedValue)) {
                select.value = storedValue;
            } else if (currentValue && selectHasOptionValue(select, currentValue)) {
                select.value = currentValue;
            }
            select.setAttribute('data-webos-quality-patched', 'true');
        }

        return changed;
    }

    function ensureWebOSSettingsControls() {
        patchNativeVideoQualitySelects();

        var settingsAnchor = getPlaybackSettingsAnchor();
        if (!settingsAnchor) {
            removeWebOSSettingsRoot();
            return false;
        }

        var settingsRoot = ensureWebOSSettingsRoot(settingsAnchor);
        if (!settingsRoot) {
            return false;
        }

        var hdrGroup = ensureWebOSSettingsGroup(settingsRoot, 'webos-settings-group-hdr', 'webOS HDR UI');
        var audioGroup = ensureWebOSSettingsGroup(settingsRoot, 'webos-settings-group-audio', 'webOS audio');
        var assGroup = ensureWebOSSettingsGroup(settingsRoot, 'webos-settings-group-ass', 'webOS ASS subtitles');
        var pgsGroup = ensureWebOSSettingsGroup(settingsRoot, 'webos-settings-group-pgs', 'webOS PGS subtitles');
        var diagnosticsGroup = ensureWebOSSettingsGroup(settingsRoot, 'webos-settings-group-diagnostics', 'webOS diagnostics');
        var hdrDimContainer = getControlContainerBySelector('.webosHdrUiDimSlider');
        var hdrSubtitleOpacityContainer = getControlContainerBySelector('.webosHdrSubtitleOpacitySlider');
        var lpcmAudioCopyContainer = getControlContainerBySelector('.chkWebOSLpcmAudioCopy');
        var assTimeSyncContainer = getControlContainerBySelector('.chkWebOSAssTimeSyncFix');
        var assRenderAheadContainer = getControlContainerBySelector('.chkWebOSDisableAssRenderAhead');
        var diagnosticsContainer = getControlContainerBySelector('.chkWebOSPlaybackDiagnostics');
        var pgsForceMainThreadContainer = getControlContainerBySelector('.chkWebOSPgsForceMainThread');
        var pgsPatchObjectReuseContainer = getControlContainerBySelector('.chkWebOSPgsPatchObjectReuse');

        if (!hdrDimContainer) {
            hdrDimContainer = createHdrUiDimControlContainer();
        }
        appendControlToGroup(hdrGroup, hdrDimContainer);

        if (!hdrSubtitleOpacityContainer) {
            hdrSubtitleOpacityContainer = createHdrSubtitleOpacityControlContainer();
        }
        appendControlToGroup(hdrGroup, hdrSubtitleOpacityContainer);

        if (!lpcmAudioCopyContainer) {
            lpcmAudioCopyContainer = createWebOSCheckboxControlContainer(
                'chkWebOSLpcmAudioCopy',
                getRegisteredFeatureTitle('lpcmAudioCopyEnabled', 'webOS: Allow LPCM/PCM audio copy'),
                getRegisteredFeatureDescription('lpcmAudioCopyEnabled', 'Experimental. Adds Blu-ray/DVD LPCM and common PCM codecs to video direct-play audio codec lists. Enable only when ARC/eARC and the receiver can handle multichannel PCM. Restart playback after changing.')
            );
        }
        appendControlToGroup(audioGroup, lpcmAudioCopyContainer);

        if (!assRenderAheadContainer) {
            assRenderAheadContainer = createWebOSCheckboxControlContainer(
                'chkWebOSDisableAssRenderAhead',
                getRegisteredFeatureTitle('disableAssRenderAhead', 'webOS: Disable ASS render-ahead'),
                getRegisteredFeatureDescription('disableAssRenderAhead', 'Disables Jellyfin/libass-wasm one-shot prerender cache on webOS. This avoids cached ASS animation frames being replayed out of sync. Restart playback after changing.')
            );
        }
        if (!assTimeSyncContainer) {
            assTimeSyncContainer = createWebOSCheckboxControlContainer(
                'chkWebOSAssTimeSyncFix',
                getRegisteredFeatureTitle('assTimeSyncFixEnabled', 'webOS: Fix ASS time rollback'),
                getRegisteredFeatureDescription('assTimeSyncFixEnabled', 'Clamps small backward video-time samples sent to libass on webOS. Takes effect immediately for new worker messages; restart playback if unsure.')
            );
        }
        appendControlToGroup(assGroup, assTimeSyncContainer);
        appendControlToGroup(assGroup, assRenderAheadContainer);

        if (!diagnosticsContainer) {
            diagnosticsContainer = createWebOSCheckboxControlContainer(
                'chkWebOSPlaybackDiagnostics',
                getRegisteredFeatureTitle('playbackDiagnosticsEnabled', 'webOS: Playback diagnostics overlay'),
                getRegisteredFeatureDescription('playbackDiagnosticsEnabled', 'Shows rAF, video-frame callback, video quality, and timing data on top of playback.')
            );
        }

        if (!pgsForceMainThreadContainer) {
            pgsForceMainThreadContainer = createWebOSCheckboxControlContainer(
                'chkWebOSPgsForceMainThread',
                getRegisteredFeatureTitle('pgsForceMainThread', 'webOS: Force PGS main-thread renderer'),
                getRegisteredFeatureDescription('pgsForceMainThread', 'Diagnostic switch for PGS stale-text tests. Restart playback after changing; restart the app for a clean script-load test.')
            );
        }
        appendControlToGroup(pgsGroup, pgsForceMainThreadContainer);

        if (!pgsPatchObjectReuseContainer) {
            pgsPatchObjectReuseContainer = createWebOSCheckboxControlContainer(
                'chkWebOSPgsPatchObjectReuse',
                getRegisteredFeatureTitle('pgsPatchObjectReuse', 'webOS: Patch PGS object reuse'),
                getRegisteredFeatureDescription('pgsPatchObjectReuse', 'Diagnostic switch for reused PGS object ids. Uses the newest ODS sequence when enabled. Restart playback after changing.')
            );
        }
        appendControlToGroup(pgsGroup, pgsPatchObjectReuseContainer);
        appendControlToGroup(diagnosticsGroup, diagnosticsContainer);

        var lpcmAudioCopyCheckbox = document.querySelector('.chkWebOSLpcmAudioCopy');
        var assTimeSyncCheckbox = document.querySelector('.chkWebOSAssTimeSyncFix');
        var assRenderAheadCheckbox = document.querySelector('.chkWebOSDisableAssRenderAhead');
        var diagnosticsCheckbox = document.querySelector('.chkWebOSPlaybackDiagnostics');
        var pgsForceMainThreadCheckbox = document.querySelector('.chkWebOSPgsForceMainThread');
        var pgsPatchObjectReuseCheckbox = document.querySelector('.chkWebOSPgsPatchObjectReuse');

        if (lpcmAudioCopyCheckbox) {
            lpcmAudioCopyCheckbox.checked = !!lpcmAudioCopyEnabled;
            if (lpcmAudioCopyCheckbox.getAttribute('data-webos-init') !== 'true') {
                lpcmAudioCopyCheckbox.addEventListener('change', function () {
                    setLpcmAudioCopyEnabled(lpcmAudioCopyCheckbox.checked, 'settings-page');
                });
                lpcmAudioCopyCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (assTimeSyncCheckbox) {
            assTimeSyncCheckbox.checked = !!assTimeSyncFixEnabled;
            if (assTimeSyncCheckbox.getAttribute('data-webos-init') !== 'true') {
                assTimeSyncCheckbox.addEventListener('change', function () {
                    setAssTimeSyncFixEnabled(assTimeSyncCheckbox.checked, 'settings-page');
                });
                assTimeSyncCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (assRenderAheadCheckbox) {
            assRenderAheadCheckbox.checked = !!disableAssRenderAhead;
            if (assRenderAheadCheckbox.getAttribute('data-webos-init') !== 'true') {
                assRenderAheadCheckbox.addEventListener('change', function () {
                    setDisableAssRenderAhead(assRenderAheadCheckbox.checked, 'settings-page');
                });
                assRenderAheadCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (diagnosticsCheckbox) {
            diagnosticsCheckbox.checked = !!playbackDiagnosticsEnabled;
            if (diagnosticsCheckbox.getAttribute('data-webos-init') !== 'true') {
                diagnosticsCheckbox.addEventListener('change', function () {
                    setPlaybackDiagnosticsEnabled(diagnosticsCheckbox.checked, 'settings-page');
                });
                diagnosticsCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (pgsForceMainThreadCheckbox) {
            pgsForceMainThreadCheckbox.checked = !!pgsForceMainThread;
            if (pgsForceMainThreadCheckbox.getAttribute('data-webos-init') !== 'true') {
                pgsForceMainThreadCheckbox.addEventListener('change', function () {
                    setPgsForceMainThread(pgsForceMainThreadCheckbox.checked, 'settings-page');
                });
                pgsForceMainThreadCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (pgsPatchObjectReuseCheckbox) {
            pgsPatchObjectReuseCheckbox.checked = !!pgsPatchObjectReuse;
            if (pgsPatchObjectReuseCheckbox.getAttribute('data-webos-init') !== 'true') {
                pgsPatchObjectReuseCheckbox.addEventListener('change', function () {
                    setPgsPatchObjectReuse(pgsPatchObjectReuseCheckbox.checked, 'settings-page');
                });
                pgsPatchObjectReuseCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        initializeHdrUiDimControl(hdrDimContainer);
        initializeHdrSubtitleOpacityControl(hdrSubtitleOpacityContainer);
        return true;
    }

    function runScheduledSettingsEnsure() {
        settingsEnsureTimer = null;
        settingsEnsureScheduled = false;
        settingsEnsureLastRunTs = Date.now();
        var hasPlaybackSettingsAnchor = ensureWebOSSettingsControls();

        if (document.querySelector('.webosHdrUiDimSlider')
            && document.querySelector('.webosHdrSubtitleOpacitySlider')
            && document.querySelector('.chkWebOSLpcmAudioCopy')
            && document.querySelector('.chkWebOSAssTimeSyncFix')
            && document.querySelector('.chkWebOSDisableAssRenderAhead')
            && document.querySelector('.chkWebOSPlaybackDiagnostics')
            && document.querySelector('.chkWebOSPgsForceMainThread')
            && document.querySelector('.chkWebOSPgsPatchObjectReuse')) {
            settingsEnsureAttemptsLeft = 0;
            return;
        }

        if (hasPlaybackSettingsAnchor && settingsEnsureAttemptsLeft > 0) {
            settingsEnsureAttemptsLeft--;
            scheduleSettingsEnsureControls(false, SETTINGS_INJECTION_RETRY_DELAY);
        }
    }

    function clearScheduledSettingsEnsure() {
        if (settingsEnsureTimer) {
            clearTimeout(settingsEnsureTimer);
            settingsEnsureTimer = null;
        }
        settingsEnsureScheduled = false;
        settingsEnsureAttemptsLeft = 0;
    }

    function scheduleSettingsEnsureControls(resetAttempts, delay) {
        if (resetAttempts) {
            settingsEnsureAttemptsLeft = SETTINGS_INJECTION_MAX_RETRIES;
        }

        if (settingsEnsureScheduled) {
            return;
        }

        var requestedDelay = typeof delay === 'number' ? delay : SETTINGS_INJECTION_MUTATION_DELAY;
        if (!resetAttempts && requestedDelay < SETTINGS_INJECTION_MUTATION_DELAY) {
            requestedDelay = SETTINGS_INJECTION_MUTATION_DELAY;
        }
        var elapsedSinceLastRun = Date.now() - settingsEnsureLastRunTs;
        if (!resetAttempts && elapsedSinceLastRun >= 0 && elapsedSinceLastRun < SETTINGS_INJECTION_MUTATION_DELAY) {
            requestedDelay = Math.max(requestedDelay, SETTINGS_INJECTION_MUTATION_DELAY - elapsedSinceLastRun);
        }

        settingsEnsureScheduled = true;
        settingsEnsureTimer = setTimeout(runScheduledSettingsEnsure, requestedDelay);
    }

    function isLikelyPlaybackSettingsRoute() {
        var locationText = '';
        if (window.location) {
            locationText = [
                window.location.hash || '',
                window.location.pathname || '',
                window.location.search || ''
            ].join(' ').toLowerCase();
        }
        return locationText.indexOf('settings') !== -1 || locationText.indexOf('playback') !== -1;
    }

    function hasPlaybackSettingsDom() {
        return !!getPlaybackSettingsAnchor();
    }

    function elementMatchesSelector(element, selector) {
        if (!element || element.nodeType !== 1) {
            return false;
        }

        var matches = element.matches || element.webkitMatchesSelector || element.msMatchesSelector;
        return !!(matches && matches.call(element, selector));
    }

    function isPlaybackSettingsMutationNode(node) {
        var selector = '.fldEnableDts,.chkEnableDts,.fldEnableTrueHd,.chkEnableTrueHd,#selectPreferredTranscodeVideoCodec,#selectAllowedAudioChannels,.selectVideoInNetworkQuality,.selectVideoInternetQuality';
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (elementMatchesSelector(node, selector)) {
            return true;
        }

        return !!(node.querySelector && node.querySelector(selector));
    }

    function mutationListHasPlaybackSettingsNode(mutations) {
        if (!mutations) {
            return false;
        }

        for (var i = 0; i < mutations.length; i++) {
            var addedNodes = mutations[i].addedNodes;
            for (var j = 0; j < addedNodes.length; j++) {
                if (isPlaybackSettingsMutationNode(addedNodes[j])) {
                    return true;
                }
            }
        }

        return false;
    }

    function isWebOSSettingsRootNode(node) {
        return !!(node
            && node.nodeType === 1
            && node.classList
            && node.classList.contains('webos-settings-section-root'));
    }

    function nodeContainsWebOSSettingsRoot(node) {
        return !!(node
            && node.nodeType === 1
            && node.querySelector
            && node.querySelector('.webos-settings-section-root'));
    }

    function mutationListTouchesWebOSSettingsRoot(mutations) {
        if (!mutations) {
            return false;
        }

        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (isWebOSSettingsRootNode(mutation.target) || nodeContainsWebOSSettingsRoot(mutation.target)) {
                return true;
            }
            for (var j = 0; j < mutation.addedNodes.length; j++) {
                if (isWebOSSettingsRootNode(mutation.addedNodes[j]) || nodeContainsWebOSSettingsRoot(mutation.addedNodes[j])) {
                    return true;
                }
            }
            for (var k = 0; k < mutation.removedNodes.length; k++) {
                if (isWebOSSettingsRootNode(mutation.removedNodes[k]) || nodeContainsWebOSSettingsRoot(mutation.removedNodes[k])) {
                    return true;
                }
            }
        }

        return false;
    }

    function isInsideWebOSSettingsRoot(node) {
        var current = node && node.nodeType === 1 ? node : node && node.parentNode;
        while (current) {
            if (current.classList && current.classList.contains('webos-settings-section-root')) {
                return true;
            }
            current = current.parentNode;
        }
        return false;
    }

    function mutationListOnlyTouchesWebOSSettingsRoot(mutations) {
        if (!mutations || !mutations.length) {
            return false;
        }

        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (!isInsideWebOSSettingsRoot(mutation.target)) {
                return false;
            }
            if (mutation.target && mutation.target.nodeType === 1
                && isInsideWebOSSettingsRoot(mutation.target)
                && mutation.target.parentNode) {
                continue;
            }
            for (var j = 0; j < mutation.addedNodes.length; j++) {
                if (!isInsideWebOSSettingsRoot(mutation.addedNodes[j])) {
                    return false;
                }
            }
            for (var k = 0; k < mutation.removedNodes.length; k++) {
                if (!isInsideWebOSSettingsRoot(mutation.removedNodes[k])) {
                    return false;
                }
            }
        }

        return true;
    }

    function shouldScheduleSettingsInjectionFromMutations(mutations) {
        if (mutationListOnlyTouchesWebOSSettingsRoot(mutations)) {
            return false;
        }

        if (mutationListHasPlaybackSettingsNode(mutations) || mutationListTouchesWebOSSettingsRoot(mutations)) {
            return true;
        }

        return false;
    }

    function setSettingsInjectionObserverEnabled(enabled) {
        if (!settingsInjectionObserver) {
            return;
        }

        if (enabled) {
            if (!settingsInjectionObserverActive) {
                var targetNode = document.body || document.documentElement;
                if (targetNode) {
                    settingsInjectionObserver.observe(targetNode, {
                        childList: true,
                        subtree: true
                    });
                    settingsInjectionObserverActive = true;
                }
            }
            scheduleSettingsEnsureControls(true);
            return;
        }

        if (settingsInjectionObserverActive) {
            settingsInjectionObserver.disconnect();
            settingsInjectionObserverActive = false;
        }
        clearScheduledSettingsEnsure();
    }

    function refreshSettingsInjectionObserverState() {
        setSettingsInjectionObserverEnabled(true);
    }

    function initWebOSSettingsInjection() {
        if (settingsInjectionObserver || !window.MutationObserver) {
            return;
        }

        settingsInjectionObserver = new MutationObserver(function (mutations) {
            if (shouldScheduleSettingsInjectionFromMutations(mutations)) {
                scheduleSettingsEnsureControls(false);
            }
        });

        window.addEventListener('hashchange', function () {
            refreshSettingsInjectionObserverState();
        });
        window.addEventListener('popstate', function () {
            refreshSettingsInjectionObserverState();
        });
        if (window.history) {
            ['pushState', 'replaceState'].forEach(function (methodName) {
                var originalMethod = window.history[methodName];
                if (!originalMethod || originalMethod.__webOsSettingsRouteHooked) {
                    return;
                }

                window.history[methodName] = function () {
                    var result = originalMethod.apply(this, arguments);
                    setTimeout(refreshSettingsInjectionObserverState, 0);
                    return result;
                };
                window.history[methodName].__webOsSettingsRouteHooked = true;
            });
        }

        refreshSettingsInjectionObserverState();
    }

    function getHeaderElement() {
        if (cachedHeaderElement && cachedHeaderElement.isConnected) {
            return cachedHeaderElement;
        }

        cachedHeaderElement = document.querySelector('.skinHeader')
            || document.querySelector('.appHeader')
            || document.querySelector('.headerTabs');
        return cachedHeaderElement;
    }

    function forceHeaderPinned() {
        if (playbackState === PlaybackState.PLAYING || !document.body) {
            return;
        }

        var header = getHeaderElement();
        if (!header) {
            cachedHeaderElement = null;
            return;
        }

        header.classList.remove('hide');
        header.classList.remove('hidden');
        header.classList.remove('skinHeader-hidden');
        if (header.style.position !== 'fixed') {
            header.style.position = 'fixed';
        }
        if (header.style.top !== '0px') {
            header.style.top = '0';
        }
        if (header.style.left !== '0px') {
            header.style.left = '0';
        }
        if (header.style.right !== '0px') {
            header.style.right = '0';
        }
        if (header.style.zIndex !== '9999') {
            header.style.zIndex = '9999';
        }
        if (header.style.transform !== 'translateY(0)') {
            header.style.transform = 'translateY(0)';
        }
        if (header.style.opacity !== '1') {
            header.style.opacity = '1';
        }
        if (header.style.visibility !== 'visible') {
            header.style.visibility = 'visible';
        }

        var now = Date.now();
        var currentOffset = document.documentElement.style.getPropertyValue('--webos-header-offset');
        var shouldMeasure = !currentOffset || (now - lastHeaderMeasureTs) >= HEADER_MEASURE_INTERVAL;
        var headerOffset = currentOffset;

        if (shouldMeasure) {
            var headerHeight = header.offsetHeight || MIN_HEADER_HEIGHT;
            if (headerHeight < MIN_HEADER_HEIGHT) {
                headerHeight = MIN_HEADER_HEIGHT;
            }
            headerOffset = headerHeight + 'px';
            lastHeaderMeasureTs = now;
        }

        if (!headerOffset) {
            headerOffset = MIN_HEADER_HEIGHT + 'px';
        }

        if (document.documentElement.style.getPropertyValue('--webos-header-offset') !== headerOffset) {
            document.documentElement.style.setProperty('--webos-header-offset', headerOffset);
        }
        if (document.body.style.paddingTop !== 'var(--webos-header-offset)') {
            document.body.style.paddingTop = 'var(--webos-header-offset)';
        }
    }

    function initHeaderPinning() {
        if (headerPinningInitialized) {
            return;
        }
        headerPinningInitialized = true;

        window.addEventListener('scroll', scheduleForceHeaderPinned, true);
        window.addEventListener('resize', function () {
            lastHeaderMeasureTs = 0;
            scheduleForceHeaderPinned();
        });
        window.addEventListener('hashchange', function () {
            cachedHeaderElement = null;
            lastHeaderMeasureTs = 0;
            scheduleForceHeaderPinned();
        });
        setHeaderPinningEnabled(true);
    }

    function formatMbpsLabel(bitrate) {
        var mbps = (bitrate / 1000000);
        if (mbps % 1 === 0) {
            return mbps.toString() + ' Mbps';
        }
        return mbps.toFixed(1) + ' Mbps';
    }

    function createBitrateOptionButton(templateButton, bitrate) {
        var button = templateButton.cloneNode(true);
        button.removeAttribute('id');
        button.removeAttribute('aria-checked');
        button.removeAttribute('aria-selected');
        button.setAttribute('data-id', bitrate.toString());
        button.setAttribute('data-value', bitrate.toString());
        button.setAttribute('data-webos-added', 'true');
        if (button.classList) {
            button.classList.remove('selected');
            button.classList.remove('listItem-button-selected');
            button.classList.remove('actionSheetMenuItem-selected');
        }

        var textElem = button.querySelector('.actionSheetItemText');
        if (!textElem) {
            textElem = button.querySelector('[class*="ItemText"]') || button.querySelector('[class*="itemText"]');
        }
        if (textElem) {
            textElem.textContent = formatMbpsLabel(bitrate);
        } else {
            button.textContent = formatMbpsLabel(bitrate);
        }

        var asideElem = button.querySelector('.actionSheetItemAsideText');
        if (asideElem) {
            asideElem.textContent = '';
        }

        var iconElem = button.querySelector('.actionsheetMenuItemIcon');
        if (iconElem) {
            iconElem.style.visibility = 'hidden';
            iconElem.classList.remove('check');
        }

        return button;
    }

    function closestActionSheet(node) {
        while (node && node.nodeType === 1) {
            if (node.classList && node.classList.contains('actionSheet')) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    function getActionSheetMenuItems(dialog) {
        var scroller = dialog.querySelector('.actionSheetScroller');
        if (!scroller) {
            return [];
        }

        return scroller.querySelectorAll('.actionSheetMenuItem');
    }

    function getBitrateFromText(text) {
        var match = /(\d+(?:\.\d+)?)\s*(m(?:bps|bit\/s|b\/s)|k(?:bps|bit\/s|b\/s))/i.exec(text);
        if (!match) {
            return 0;
        }

        var value = parseFloat(match[1]);
        if (isNaN(value) || value <= 0) {
            return 0;
        }

        return match[2].charAt(0).toLowerCase() === 'm' ? Math.round(value * 1000000) : Math.round(value * 1000);
    }

    function getMenuItemVisibleText(item) {
        return [
            item.textContent || '',
            item.getAttribute('aria-label') || '',
            item.getAttribute('title') || ''
        ].join(' ');
    }

    function getMenuItemBitrate(item) {
        var textBitrate = getBitrateFromText(getMenuItemVisibleText(item));
        if (textBitrate > 0) {
            return textBitrate;
        }

        if (item.getAttribute('data-webos-added') !== 'true') {
            return 0;
        }

        var candidates = [
            item.getAttribute('data-id'),
            item.getAttribute('data-value'),
            item.getAttribute('value')
        ];

        for (var i = 0; i < candidates.length; i++) {
            var bitrate = parsePositiveInteger(candidates[i]);
            if (bitrate > 0) {
                return bitrate;
            }
        }

        return 0;
    }

    function isBitrateActionSheet(menuItems) {
        var bitrateItemCount = 0;
        var hasHighBitrateCap = false;
        var hasBitrateText = false;

        for (var i = 0; i < menuItems.length; i++) {
            var bitrate = getMenuItemBitrate(menuItems[i]);
            if (bitrate <= 0) {
                continue;
            }

            bitrateItemCount++;
            if (bitrate >= QUALITY_MENU_LEGACY_CAP_BITRATE) {
                hasHighBitrateCap = true;
            }

            if (getBitrateFromText(getMenuItemVisibleText(menuItems[i])) > 0) {
                hasBitrateText = true;
            }
        }

        return bitrateItemCount >= 2 && hasHighBitrateCap && hasBitrateText;
    }

    function findBitrateInsertBefore(parent, bitrate) {
        if (!parent) {
            return null;
        }

        for (var i = 0; i < parent.children.length; i++) {
            var child = parent.children[i];
            if (!child.classList || !child.classList.contains('actionSheetMenuItem')) {
                continue;
            }

            var childBitrate = getMenuItemBitrate(child);
            if (childBitrate > 0 && childBitrate < bitrate) {
                return child;
            }
        }

        return null;
    }

    function patchQualityActionSheet(dialog) {
        if (!dialog) {
            return false;
        }
        if (dialog.getAttribute('data-webos-bitrate-patched') === 'true') {
            return false;
        }

        var menuItems = getActionSheetMenuItems(dialog);
        if (!menuItems || !menuItems.length) {
            return false;
        }
        if (!isBitrateActionSheet(menuItems)) {
            return false;
        }

        var bitrateIds = {};
        var templateButton = null;
        var listParent = null;

        for (var i = 0; i < menuItems.length; i++) {
            var item = menuItems[i];
            var bitrate = getMenuItemBitrate(item);
            if (bitrate > 0) {
                bitrateIds[bitrate] = true;
                if (!templateButton) {
                    templateButton = item;
                    listParent = item.parentNode;
                }
            }
        }

        if (!templateButton || !listParent) {
            return false;
        }

        var added = 0;

        for (var j = 0; j < QUALITY_MENU_EXTRA_BITRATES.length; j++) {
            var extraBitrate = QUALITY_MENU_EXTRA_BITRATES[j];
            if (bitrateIds[extraBitrate]) {
                continue;
            }

            var extraButton = createBitrateOptionButton(templateButton, extraBitrate);
            listParent.insertBefore(extraButton, findBitrateInsertBefore(listParent, extraBitrate));
            bitrateIds[extraBitrate] = true;
            added++;
        }

        dialog.setAttribute('data-webos-bitrate-patched', 'true');

        if (added > 0) {
            debugLog('Added extra bitrate options for local network playback:', added);
            return true;
        }

        return false;
    }

    function patchExistingQualityActionSheets() {
        var existingDialogs = document.querySelectorAll('.actionSheet');
        for (var i = 0; i < existingDialogs.length; i++) {
            patchQualityActionSheet(existingDialogs[i]);
        }
    }

    function scheduleQualityActionSheetPatch(delay) {
        if (qualityMenuPatchTimer) {
            return;
        }

        qualityMenuPatchTimer = setTimeout(function () {
            qualityMenuPatchTimer = null;
            patchExistingQualityActionSheets();
        }, typeof delay === 'number' ? delay : 0);
    }

    function initQualityMenuPatching() {
        if (qualityMenuObserver || !window.MutationObserver) {
            return;
        }

        qualityMenuObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (!mutation.addedNodes || !mutation.addedNodes.length) {
                    continue;
                }

                for (var j = 0; j < mutation.addedNodes.length; j++) {
                    var node = mutation.addedNodes[j];
                    if (!node || node.nodeType !== 1) {
                        continue;
                    }

                    var dialog = closestActionSheet(node);
                    if (dialog) {
                        patchQualityActionSheet(dialog);
                        scheduleQualityActionSheetPatch(80);
                    }

                    if (node.querySelectorAll) {
                        var dialogs = node.querySelectorAll('.actionSheet');
                        for (var k = 0; k < dialogs.length; k++) {
                            patchQualityActionSheet(dialogs[k]);
                        }
                        if (dialogs.length) {
                            scheduleQualityActionSheetPatch(80);
                        }
                    }
                }
            }

        });
    }

    function setQualityMenuObserverEnabled(enabled) {
        if (!window.MutationObserver) {
            return;
        }

        if (!enabled) {
            if (qualityMenuObserver && qualityMenuObserverActive) {
                qualityMenuObserver.disconnect();
                qualityMenuObserverActive = false;
            }
            return;
        }

        if (!qualityMenuObserver) {
            initQualityMenuPatching();
        }

        if (!qualityMenuObserver) {
            return;
        }

        if (!qualityMenuObserverActive) {
            var targetNode = document.body || document.documentElement;
            if (targetNode) {
                qualityMenuObserver.observe(targetNode, {
                    childList: true,
                    subtree: true
                });
                qualityMenuObserverActive = true;
            }
        }

        patchExistingQualityActionSheets();
    }

    function clearHdrUiInfoScanTimer() {
        if (hdrUiInfoScanTimer) {
            clearTimeout(hdrUiInfoScanTimer);
            hdrUiInfoScanTimer = null;
        }
    }

    function clearHdrUiInfoFallbackScanTimer() {
        if (hdrUiInfoFallbackScanTimer) {
            clearTimeout(hdrUiInfoFallbackScanTimer);
            hdrUiInfoFallbackScanTimer = null;
        }
    }

    function clearHdrUiInfoCorrectionTimer() {
        if (hdrUiInfoCorrectionTimer) {
            clearTimeout(hdrUiInfoCorrectionTimer);
            hdrUiInfoCorrectionTimer = null;
        }
    }

    function clearPlaybackStartFallbackTimers() {
        playbackStartFallbackGeneration++;
        for (var i = 0; i < playbackStartFallbackTimers.length; i++) {
            clearTimeout(playbackStartFallbackTimers[i]);
        }
        playbackStartFallbackTimers = [];
    }

    function runPlaybackStartFallbackCheck(reason, generation) {
        if (generation !== playbackStartFallbackGeneration || playbackState !== PlaybackState.PLAYING) {
            return;
        }

        var itemId = currentMediaSessionItemId || latestPlaybackInfoRequestItemId;
        var mediaSourceId = currentPlaybackMediaSourceId;
        if (itemId && playbackVideoDelivery === 'unknown') {
            var cachedVideoDelivery = getCachedPlaybackInfoVideoDeliveryHint(itemId, mediaSourceId);
            if (cachedVideoDelivery !== 'unknown') {
                setPlaybackVideoDelivery(cachedVideoDelivery, reason + '-playbackinfo-cache');
            }
        }

        if (itemId && playbackDynamicRange === 'unknown') {
            var cachedHint = getCachedPlaybackInfoDynamicRangeHint(itemId, mediaSourceId);
            if (cachedHint !== 'unknown') {
                setPlaybackDynamicRange(cachedHint, reason + '-playbackinfo-cache');
            }
        }

        if (itemId) {
            var requestedItemId = itemId.toString();
            fetchDynamicRangeHintForItemId(requestedItemId, mediaSourceId).then(function (itemHint) {
                if (generation !== playbackStartFallbackGeneration || playbackState !== PlaybackState.PLAYING) {
                    return;
                }

                var activeItemId = currentMediaSessionItemId || latestPlaybackInfoRequestItemId;
                if (!activeItemId || activeItemId.toString() !== requestedItemId) {
                    return;
                }

                hdrDetectionItemMetadataLastHint = itemHint;
                if (itemHint !== 'unknown' && (playbackDynamicRange === 'unknown' || itemHint === 'hdr')) {
                    setPlaybackDynamicRange(itemHint, reason + '-item-metadata');
                }
            });
        }

        var uiHint = getDynamicRangeHintFromPlaybackUi();
        hdrDetectionPlaybackUiLastHint = uiHint;
        if (uiHint === 'hdr' || playbackDynamicRange === 'unknown' && uiHint === 'sdr') {
            setPlaybackDynamicRange(uiHint, reason + '-playback-ui');
        } else {
            refreshHdrUiDimming(reason);
        }
    }

    function schedulePlaybackStartFallbackChecks(reason) {
        clearPlaybackStartFallbackTimers();
        var generation = playbackStartFallbackGeneration;
        playbackStartFallbackTimers.push(setTimeout(function () {
            runPlaybackStartFallbackCheck(reason || 'playback-start-fallback', generation);
        }, PLAYBACK_START_FALLBACK_DELAY_MS));
    }

    function clearHdrUiInfoCorrectionWindow() {
        hdrUiInfoCorrectionUntil = 0;
        hdrUiInfoCorrectedHdrUntil = 0;
        hdrUiInfoCorrectedHdrReason = null;
        clearHdrUiInfoFallbackScanTimer();
        clearHdrUiInfoCorrectionTimer();
    }

    function armHdrUiInfoCorrectionWindow(reason) {
        hdrUiInfoCorrectionUntil = Date.now() + HDR_UI_INFO_CORRECTION_WINDOW_MS;
        hdrUiInfoCorrectedHdrUntil = 0;
        clearHdrUiInfoCorrectionTimer();
        hdrUiInfoCorrectionTimer = setTimeout(function () {
            hdrUiInfoCorrectionTimer = null;
            hdrUiInfoCorrectionUntil = 0;
            hdrUiInfoCorrectedHdrUntil = 0;
            hdrUiInfoCorrectedHdrReason = null;
            hdrUiInfoObserver.setEnabled(shouldUseHdrUiInfoObserver());
        }, HDR_UI_INFO_CORRECTION_WINDOW_MS);

        debugLog('HDR UI info correction window armed (' + reason + ')');
        hdrUiInfoObserver.setEnabled(shouldUseHdrUiInfoObserver());
    }

    function shouldUseHdrUiInfoObserver() {
        return playbackState === PlaybackState.PLAYING
            && (playbackDynamicRange === 'unknown'
                || (playbackDynamicRange === 'sdr' && Date.now() < hdrUiInfoCorrectionUntil));
    }

    function scheduleHdrUiInfoScan(delay) {
        if (hdrUiInfoScanTimer || !shouldUseHdrUiInfoObserver()) {
            return;
        }

        hdrUiInfoScanTimer = setTimeout(function () {
            hdrUiInfoScanTimer = null;
            if (!shouldUseHdrUiInfoObserver()) {
                return;
            }

            var hint = getDynamicRangeHintFromPlaybackUi();
            hdrDetectionPlaybackUiLastHint = hint;
            if (hint === 'hdr' || playbackDynamicRange === 'unknown' && hint === 'sdr') {
                setPlaybackDynamicRange(hint, 'playback-ui');
            } else {
                refreshHdrUiDimming('playback-ui-scan');
            }
        }, typeof delay === 'number' ? delay : 0);
    }

    function scheduleHdrUiInfoFallbackScan() {
        if (hdrUiInfoFallbackScanTimer || !shouldUseHdrUiInfoObserver() || Date.now() >= hdrUiInfoCorrectionUntil) {
            return;
        }

        hdrUiInfoFallbackScanTimer = setTimeout(function () {
            hdrUiInfoFallbackScanTimer = null;
            if (!shouldUseHdrUiInfoObserver() || Date.now() >= hdrUiInfoCorrectionUntil) {
                return;
            }

            scheduleHdrUiInfoScan(0);
            scheduleHdrUiInfoFallbackScan();
        }, HDR_UI_INFO_FALLBACK_SCAN_INTERVAL);
    }

    function getHdrDecisions() {
        if (webOSHdrDecisions) {
            return webOSHdrDecisions;
        }

        if (!hdrDecisionModuleWarned) {
            hdrDecisionModuleWarned = true;
            warnLog('webOS HDR decision module is unavailable');
        }
        return null;
    }

    function isHdrDynamicRangeText(value) {
        var decisions = getHdrDecisions();
        return !!(decisions && decisions.isHdrDynamicRangeText && decisions.isHdrDynamicRangeText(value));
    }

    function isSdrDynamicRangeText(value) {
        var decisions = getHdrDecisions();
        return !!(decisions && decisions.isSdrDynamicRangeText && decisions.isSdrDynamicRangeText(value));
    }

    function getDynamicRangeHintFromMediaInfo(mediaInfo) {
        var decisions = getHdrDecisions();
        return decisions && decisions.getDynamicRangeHintFromMediaInfo
            ? decisions.getDynamicRangeHintFromMediaInfo(mediaInfo)
            : 'unknown';
    }

    function shouldInspectDynamicRangeUiElement(element) {
        if (!element) {
            return false;
        }

        if (element.classList && element.classList.contains('hide')) {
            return false;
        }

        if (typeof element.getClientRects === 'function' && !element.getClientRects().length) {
            return false;
        }

        return true;
    }

    function getDynamicRangeHintFromPlaybackUi() {
        if (!document || !document.querySelectorAll) {
            return 'unknown';
        }

        var selectors = [
            '.osdSecondaryMediaInfo',
            '.osdMediaInfo',
            '.osdMediaStatus',
            '.videoOsdTop',
            '.videoOsdBottom',
            '.playerStats'
        ];
        var sawSdr = false;

        for (var i = 0; i < selectors.length; i++) {
            var elements = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < elements.length; j++) {
                if (!shouldInspectDynamicRangeUiElement(elements[j])) {
                    continue;
                }

                var text = elements[j] && elements[j].textContent ? elements[j].textContent : '';
                if (!text) {
                    continue;
                }

                if (isHdrDynamicRangeText(text)) {
                    return 'hdr';
                }
                if (isSdrDynamicRangeText(text)) {
                    sawSdr = true;
                }
            }
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function toArray(value) {
        var decisions = getHdrDecisions();
        return decisions && decisions.toArray ? decisions.toArray(value) : [];
    }

    function getSelectedMediaSourceId(value) {
        var decisions = getHdrDecisions();
        return decisions && decisions.getSelectedMediaSourceId
            ? decisions.getSelectedMediaSourceId(value)
            : null;
    }

    function normalizePlaybackVideoDelivery(value) {
        var decisions = getHdrDecisions();
        return decisions && decisions.normalizePlaybackVideoDelivery
            ? decisions.normalizePlaybackVideoDelivery(value)
            : 'unknown';
    }

    function isPlaybackVideoCopiedOrDirect(delivery) {
        var decisions = getHdrDecisions();
        return !!(decisions && decisions.isPlaybackVideoCopiedOrDirect && decisions.isPlaybackVideoCopiedOrDirect(delivery));
    }

    function getSelectedPlaybackInfoMediaSource(payload, mediaSourceId) {
        var decisions = getHdrDecisions();
        return decisions && decisions.getSelectedPlaybackInfoMediaSource
            ? decisions.getSelectedPlaybackInfoMediaSource(payload, mediaSourceId)
            : null;
    }

    function getPlaybackVideoDeliveryFromPlaybackInfoPayload(payload, mediaSourceId) {
        var decisions = getHdrDecisions();
        return decisions && decisions.getPlaybackVideoDeliveryFromPlaybackInfoPayload
            ? decisions.getPlaybackVideoDeliveryFromPlaybackInfoPayload(payload, mediaSourceId)
            : 'unknown';
    }

    function getDynamicRangeHintFromItem(item, mediaSourceId) {
        var decisions = getHdrDecisions();
        return decisions && decisions.getDynamicRangeHintFromItem
            ? decisions.getDynamicRangeHintFromItem(item, mediaSourceId)
            : 'unknown';
    }

    function getCurrentApiClient() {
        var apiClient = window.ApiClient;
        if (apiClient && typeof apiClient.getItem === 'function') {
            return apiClient;
        }
        return null;
    }

    function createResolvedThenable(value) {
        return {
            then: function (onFulfilled) {
                if (typeof onFulfilled !== 'function') {
                    return createResolvedThenable(value);
                }

                try {
                    return createResolvedThenable(onFulfilled(value));
                } catch (error) {
                    return createResolvedThenable('unknown');
                }
            }
        };
    }

    function resolvedDynamicRangeHint(value) {
        if (window.Promise && typeof window.Promise.resolve === 'function') {
            return window.Promise.resolve(value);
        }

        return createResolvedThenable(value);
    }

    function getDynamicRangeCacheKey(itemId, mediaSourceId) {
        return itemId.toString() + '|' + (mediaSourceId ? mediaSourceId.toString() : '');
    }

    function cachePlaybackInfoDynamicRangeHint(itemId, mediaSourceId, hint) {
        if (!itemId || (hint !== 'hdr' && hint !== 'sdr')) {
            return;
        }

        playbackInfoDynamicRangeHints[getDynamicRangeCacheKey(itemId, mediaSourceId)] = hint;
    }

    function cachePlaybackInfoVideoDeliveryHint(itemId, mediaSourceId, videoDelivery) {
        var normalizedVideoDelivery = normalizePlaybackVideoDelivery(videoDelivery);
        if (!itemId || normalizedVideoDelivery === 'unknown') {
            return;
        }

        playbackInfoVideoDeliveryHints[getDynamicRangeCacheKey(itemId, mediaSourceId)] = normalizedVideoDelivery;
    }

    function getCachedPlaybackInfoDynamicRangeHint(itemId, mediaSourceId) {
        if (!itemId) {
            return 'unknown';
        }

        var cacheKey = getDynamicRangeCacheKey(itemId, mediaSourceId);
        if (mediaSourceId) {
            return playbackInfoDynamicRangeHints[cacheKey] || 'unknown';
        }

        return playbackInfoDynamicRangeHints[cacheKey] || 'unknown';
    }

    function getCachedPlaybackInfoVideoDeliveryHint(itemId, mediaSourceId) {
        if (!itemId) {
            return 'unknown';
        }

        var cacheKey = getDynamicRangeCacheKey(itemId, mediaSourceId);
        var exactHint = playbackInfoVideoDeliveryHints[cacheKey];
        if (exactHint) {
            return exactHint;
        }

        return 'unknown';
    }

    function fetchDynamicRangeHintForItemId(itemId, mediaSourceId) {
        if (!itemId) {
            return resolvedDynamicRangeHint('unknown');
        }

        itemId = itemId.toString();
        var normalizedMediaSourceId = mediaSourceId ? mediaSourceId.toString() : null;
        var cacheKey = getDynamicRangeCacheKey(itemId, normalizedMediaSourceId);
        if (Object.prototype.hasOwnProperty.call(mediaItemDynamicRangeCache, cacheKey)) {
            return resolvedDynamicRangeHint(mediaItemDynamicRangeCache[cacheKey]);
        }

        if (mediaItemDynamicRangeInFlight[cacheKey]) {
            return mediaItemDynamicRangeInFlight[cacheKey];
        }

        var apiClient = getCurrentApiClient();
        if (!apiClient) {
            return resolvedDynamicRangeHint('unknown');
        }

        var userId = null;
        try {
            if (typeof apiClient.getCurrentUserId === 'function') {
                userId = apiClient.getCurrentUserId();
            }
        } catch (error) {
            debugLog('ApiClient.getCurrentUserId failed:', error);
        }

        if (!userId) {
            return resolvedDynamicRangeHint('unknown');
        }

        var request = null;
        try {
            request = apiClient.getItem(userId, itemId);
        } catch (error) {
            try {
                request = apiClient.getItem(itemId);
            } catch (fallbackError) {
                debugLog('ApiClient.getItem failed:', fallbackError);
                request = null;
            }
        }

        if (!request || typeof request.then !== 'function') {
            return resolvedDynamicRangeHint('unknown');
        }

        mediaItemDynamicRangeInFlight[cacheKey] = request.then(function (item) {
            var hint = getDynamicRangeHintFromItem(item, normalizedMediaSourceId);
            // Bound the cache so a long-running session that browses many items
            // cannot grow it without limit.
            if (Object.keys(mediaItemDynamicRangeCache).length >= MEDIA_DYNAMIC_RANGE_CACHE_LIMIT) {
                mediaItemDynamicRangeCache = {};
            }
            mediaItemDynamicRangeCache[cacheKey] = hint;
            return hint;
        }, function (error) {
            debugLog('Unable to fetch item metadata for dynamic range detection:', error);
            return 'unknown';
        }).then(function (hint) {
            delete mediaItemDynamicRangeInFlight[cacheKey];
            return hint;
        });

        return mediaItemDynamicRangeInFlight[cacheKey];
    }

    function setCurrentPlaybackItemId(itemId, mediaSourceId, reason) {
        var normalizedItemId = itemId ? itemId.toString() : null;
        var normalizedMediaSourceId = mediaSourceId ? mediaSourceId.toString() : null;

        if (currentMediaSessionItemId === normalizedItemId && currentPlaybackMediaSourceId === normalizedMediaSourceId) {
            return;
        }

        var itemChanged = currentMediaSessionItemId !== normalizedItemId;
        currentMediaSessionItemId = normalizedItemId;
        currentPlaybackMediaSourceId = normalizedMediaSourceId;
        if (normalizedItemId && itemChanged) {
            // Only reset the detected range and re-arm the correction window
            // when the item itself changed. A bare mediaSourceId change (same
            // item, different stream metadata) should not wipe an
            // already-detected HDR signal — that would invite the PlaybackInfo
            // cache key to mismatch on the followup lookup and strand the
            // range at 'unknown', and re-arming the window would also reset
            // hdrUiInfoCorrectedHdrUntil and let later SDR overwrite HDR.
            setPlaybackDynamicRange('unknown', reason || 'item-changed');
            setPlaybackVideoDelivery('unknown', reason || 'item-changed');
            armHdrUiInfoCorrectionWindow(reason || 'item-changed');
        }
    }

    function isPlaybackInfoUrl(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }

        var normalizedUrl = url.toLowerCase();
        return normalizedUrl.indexOf('/items/') !== -1 && normalizedUrl.indexOf('/playbackinfo') !== -1;
    }

    function parsePositiveInteger(value) {
        var parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return 0;
        }
        return parsed;
    }

    function getHighestKnownBitrateOption() {
        var maxBitrate = QUALITY_MENU_LEGACY_CAP_BITRATE;
        for (var i = 0; i < QUALITY_MENU_EXTRA_BITRATES.length; i++) {
            var candidate = parsePositiveInteger(QUALITY_MENU_EXTRA_BITRATES[i]);
            if (candidate > maxBitrate) {
                maxBitrate = candidate;
            }
        }
        return maxBitrate;
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

    function setQueryParameterValue(url, name, value) {
        if (!url || typeof url !== 'string' || !name) {
            return url;
        }

        var hash = '';
        var hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
            hash = url.substring(hashIndex);
            url = url.substring(0, hashIndex);
        }

        var encodedValue = encodeURIComponent(value.toString());
        var encodedName = encodeURIComponent(name);
        var pattern = new RegExp('([?&])' + escapeRegExp(encodedName) + '=.*?(?=&|$)');

        if (pattern.test(url)) {
            url = url.replace(pattern, '$1' + name + '=' + encodedValue);
        } else {
            url += (url.indexOf('?') === -1 ? '?' : '&') + name + '=' + encodedValue;
        }

        return url + hash;
    }

    function cloneShallowObject(value) {
        if (!value || typeof value !== 'object') {
            return {};
        }

        var clone = {};
        for (var key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                clone[key] = value[key];
            }
        }
        return clone;
    }

    function enforcePlaybackInfoMaxBitrateUrl(url, source) {
        if (!isPlaybackInfoUrl(url)) {
            return {
                url: url,
                targetBitrate: 0
            };
        }

        var playbackInfoItemId = extractItemIdFromPlaybackInfoUrl(url);
        if (!shouldForcePlaybackStartMaxBitrate()
            && playbackInfoItemId
            && playbackInfoItemId !== currentMediaSessionItemId
            && playbackInfoItemId !== lastPlaybackInfoMaxBitrateItemId) {
            lastPlaybackInfoMaxBitrateItemId = playbackInfoItemId;
            startPlaybackStartMaxBitrateForce('playbackinfo-item-change-' + source);
        }

        var existingBitrate = parsePositiveInteger(getQueryParameterValue(url, PLAYBACK_INFO_MAX_BITRATE_PARAM));
        var existingCamelCaseBitrate = parsePositiveInteger(getQueryParameterValue(url, 'maxStreamingBitrate'));
        var targetBitrate = getHighestKnownBitrateOption();
        if (existingBitrate > targetBitrate) {
            targetBitrate = existingBitrate;
        }
        if (existingCamelCaseBitrate > targetBitrate) {
            targetBitrate = existingCamelCaseBitrate;
        }

        var updatedUrl = setQueryParameterValue(url, PLAYBACK_INFO_MAX_BITRATE_PARAM, targetBitrate);
        if (shouldForcePlaybackStartMaxBitrate()) {
            markPlaybackStartMaxBitrateForced(source, targetBitrate);
        }

        return {
            url: updatedUrl,
            targetBitrate: targetBitrate
        };
    }

    function patchPlaybackInfoBitrateObject(value, normalizedTarget, source) {
        if (!value || typeof value !== 'object') {
            return false;
        }

        var changed = false;
        var keys = ['MaxStreamingBitrate', 'maxStreamingBitrate', 'MaxStaticBitrate', 'maxStaticBitrate'];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var currentBitrate = parsePositiveInteger(value[key]);
            if (currentBitrate < normalizedTarget) {
                value[key] = normalizedTarget;
                changed = true;
                debugLog('Patched PlaybackInfo body bitrate (' + source + ', ' + key + '): ' + currentBitrate + ' -> ' + normalizedTarget);
            }
        }

        var nestedKeys = ['PlaybackInfo', 'playbackInfo', 'PlaybackInfoDto', 'playbackInfoDto', 'DeviceProfile', 'deviceProfile', 'Profile', 'profile'];
        for (var j = 0; j < nestedKeys.length; j++) {
            if (patchPlaybackInfoBitrateObject(value[nestedKeys[j]], normalizedTarget, source)) {
                changed = true;
            }
        }

        return changed;
    }

    function looksLikeDeviceProfile(value) {
        return !!(value && typeof value === 'object'
            && (Object.prototype.hasOwnProperty.call(value, 'DirectPlayProfiles')
                || Object.prototype.hasOwnProperty.call(value, 'CodecProfiles')
                || Object.prototype.hasOwnProperty.call(value, 'TranscodingProfiles')
                || Object.prototype.hasOwnProperty.call(value, 'SubtitleProfiles')));
    }

    function patchPlaybackInfoProfileObjects(value, source) {
        if (!value || typeof value !== 'object') {
            return false;
        }

        var changed = false;
        if (looksLikeDeviceProfile(value)) {
            var beforeProfile = JSON.stringify({
                MaxStreamingBitrate: value.MaxStreamingBitrate,
                MaxStaticBitrate: value.MaxStaticBitrate,
                DirectPlayProfiles: value.DirectPlayProfiles,
                CodecProfiles: value.CodecProfiles,
                SubtitleProfiles: value.SubtitleProfiles,
                TranscodingProfiles: value.TranscodingProfiles
            });
            applyPlaybackCompatibilityProfilePatches(value);
            changed = JSON.stringify({
                MaxStreamingBitrate: value.MaxStreamingBitrate,
                MaxStaticBitrate: value.MaxStaticBitrate,
                DirectPlayProfiles: value.DirectPlayProfiles,
                CodecProfiles: value.CodecProfiles,
                SubtitleProfiles: value.SubtitleProfiles,
                TranscodingProfiles: value.TranscodingProfiles
            }) !== beforeProfile;
        }

        for (var key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }
            if (patchPlaybackInfoProfileObjects(value[key], source)) {
                changed = true;
            }
        }

        if (changed && source) {
            debugLog('Patched PlaybackInfo device profile for playback compatibility (' + source + ')');
        }
        return changed;
    }

    function enforcePlaybackInfoMaxBitrateBody(body, targetBitrate, source) {
        var normalizedTarget = parsePositiveInteger(targetBitrate);
        if (!normalizedTarget || body === null || body === undefined) {
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

                var changed = patchPlaybackInfoBitrateObject(parsed, normalizedTarget, source);
                changed = patchPlaybackInfoProfileObjects(parsed, source) || changed;
                if (!changed) {
                    return body;
                }
                return JSON.stringify(parsed);
            } catch (error) {
                return body;
            }
        }

        if (typeof body === 'object') {
            patchPlaybackInfoBitrateObject(body, normalizedTarget, source);
            patchPlaybackInfoProfileObjects(body, source);
        }

        return body;
    }

    function extractItemIdFromPlaybackInfoUrl(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }

        var match = /\/Items\/([^\/\?]+)\/PlaybackInfo/i.exec(url);
        if (!match || !match[1]) {
            return null;
        }

        var itemId = match[1];
        try {
            itemId = decodeURIComponent(itemId);
        } catch (error) {
            // Ignore malformed URI fragments and use raw value.
        }
        return itemId;
    }

    function createPlaybackInfoRequestContext(url) {
        playbackInfoRequestSequence++;
        latestPlaybackInfoRequestSequence = playbackInfoRequestSequence;
        latestPlaybackInfoRequestItemId = extractItemIdFromPlaybackInfoUrl(url);
        return {
            epoch: playbackInfoPlaybackEpoch,
            sequence: playbackInfoRequestSequence,
            itemId: latestPlaybackInfoRequestItemId,
            url: url
        };
    }

    function shouldApplyPlaybackInfoResponse(itemId, mediaSourceId, context) {
        var normalizedItemId = itemId ? itemId.toString() : null;
        var normalizedMediaSourceId = mediaSourceId ? mediaSourceId.toString() : null;
        var contextEpoch = context && typeof context.epoch === 'number' ? context.epoch : playbackInfoPlaybackEpoch;
        var contextSequence = context && typeof context.sequence === 'number' ? context.sequence : 0;

        if (contextEpoch !== playbackInfoPlaybackEpoch) {
            return false;
        }

        if (playbackState !== PlaybackState.PLAYING) {
            return false;
        }

        if (!normalizedItemId) {
            return true;
        }

        if (currentMediaSessionItemId === normalizedItemId) {
            if (currentPlaybackMediaSourceId
                && normalizedMediaSourceId
                && currentPlaybackMediaSourceId !== normalizedMediaSourceId) {
                return false;
            }

            return true;
        }

        if (currentMediaSessionItemId && currentMediaSessionItemId !== normalizedItemId) {
            return false;
        }

        if (!currentMediaSessionItemId) {
            // Accept the response without waiting for updateMediaSession when this
            // is the most recent PlaybackInfo request. Some Jellyfin Web flows
            // never call updateMediaSession, which would otherwise leave the
            // PlaybackInfo-detected range stranded in the cache forever.
            return !!(contextSequence && contextSequence === latestPlaybackInfoRequestSequence);
        }

        if (contextSequence
            && contextSequence < latestPlaybackInfoRequestSequence
            && latestPlaybackInfoRequestItemId
            && latestPlaybackInfoRequestItemId !== normalizedItemId
            && (!currentMediaSessionItemId || currentMediaSessionItemId !== normalizedItemId)) {
            return false;
        }

        return true;
    }

    function rememberPendingPlaybackInfoDynamicRange(itemId, mediaSourceId, hint, videoDelivery, context, reason) {
        var normalizedVideoDelivery = normalizePlaybackVideoDelivery(videoDelivery);
        if (hint !== 'hdr' && hint !== 'sdr' && normalizedVideoDelivery === 'unknown') {
            return;
        }

        var contextEpoch = context && typeof context.epoch === 'number' ? context.epoch : playbackInfoPlaybackEpoch;
        var contextSequence = context && typeof context.sequence === 'number' ? context.sequence : 0;
        if (contextEpoch !== playbackInfoPlaybackEpoch) {
            return;
        }

        pendingPlaybackInfoDynamicRange = {
            epoch: contextEpoch,
            sequence: contextSequence,
            itemId: itemId ? itemId.toString() : null,
            mediaSourceId: mediaSourceId ? mediaSourceId.toString() : null,
            hint: hint === 'hdr' || hint === 'sdr' ? hint : 'unknown',
            videoDelivery: normalizedVideoDelivery,
            reason: reason || 'playbackinfo-pending'
        };
        debugLog('Pending PlaybackInfo dynamic range stored:', pendingPlaybackInfoDynamicRange);
    }

    function applyPendingPlaybackInfoDynamicRange(reason) {
        var pending = pendingPlaybackInfoDynamicRange;
        if (!pending) {
            return false;
        }

        if (pending.epoch !== playbackInfoPlaybackEpoch) {
            pendingPlaybackInfoDynamicRange = null;
            return false;
        }

        if (pending.sequence
            && latestPlaybackInfoRequestSequence
            && pending.sequence < latestPlaybackInfoRequestSequence
            && latestPlaybackInfoRequestItemId
            && latestPlaybackInfoRequestItemId !== pending.itemId) {
            pendingPlaybackInfoDynamicRange = null;
            return false;
        }

        if (currentMediaSessionItemId && pending.itemId && currentMediaSessionItemId !== pending.itemId) {
            pendingPlaybackInfoDynamicRange = null;
            return false;
        }

        pendingPlaybackInfoDynamicRange = null;
        if (pending.itemId) {
            setCurrentPlaybackItemId(pending.itemId, pending.mediaSourceId, 'item-changed-playbackinfo-pending');
        }
        setPlaybackVideoDelivery(pending.videoDelivery, reason || pending.reason);
        if (pending.hint !== 'unknown') {
            setPlaybackDynamicRange(pending.hint, reason || pending.reason);
            return true;
        }
        return false;
    }

    function getDynamicRangeHintFromPlaybackInfoPayload(payload, mediaSourceId) {
        var decisions = getHdrDecisions();
        return decisions && decisions.getDynamicRangeHintFromPlaybackInfoPayload
            ? decisions.getDynamicRangeHintFromPlaybackInfoPayload(payload, mediaSourceId)
            : 'unknown';
    }

    function isSubtitleMediaStream(stream) {
        if (!stream || typeof stream !== 'object') {
            return false;
        }

        var type = Object.prototype.hasOwnProperty.call(stream, 'Type') ? stream.Type : stream.type;
        if (typeof type === 'number') {
            return type === 2;
        }
        if (type !== null && type !== undefined && type !== '') {
            return type.toString().toLowerCase() === 'subtitle' || type.toString() === '2';
        }

        return !!getClientRenderableSubtitleFormat(stream);
    }

    function getClientRenderableSubtitleFormat(stream) {
        if (!stream || typeof stream !== 'object') {
            return null;
        }

        var codec = stream.Codec || stream.codec || stream.Format || stream.format || '';
        codec = codec.toString().toLowerCase();
        if (codec === 'ass' || codec === 'ssa') {
            return codec;
        }

        if (codec === 'pgssub' || codec === 'pgs' || codec === 'hdmv_pgs_subtitle') {
            return 'pgssub';
        }

        return null;
    }

    function applyPendingPlaybackInfoHint() {
        // The PlaybackInfo response often arrives before playbackState reaches
        // PLAYING (Jellyfin Web typically fetches PlaybackInfo, then calls
        // enableFullscreen). The XHR/fetch hook caches the hint but
        // shouldApplyPlaybackInfoResponse blocks the immediate apply on
        // playbackState !== PLAYING, and updateMediaSession — the only other
        // consumer of the cache — is not guaranteed to fire. So when we
        // finally enter PLAYING, pull the cached hint for the latest known
        // PlaybackInfo item ourselves.
        if (playbackState !== PlaybackState.PLAYING) {
            return;
        }
        if (playbackDynamicRange !== 'unknown') {
            return;
        }
        if (!latestPlaybackInfoRequestItemId) {
            return;
        }

        var prefix = latestPlaybackInfoRequestItemId.toString() + '|';
        var pendingHint = 'unknown';
        var pendingVideoDelivery = 'unknown';
        for (var key in playbackInfoDynamicRangeHints) {
            if (!Object.prototype.hasOwnProperty.call(playbackInfoDynamicRangeHints, key)) {
                continue;
            }
            if (key.indexOf(prefix) !== 0) {
                continue;
            }
            var entryHint = playbackInfoDynamicRangeHints[key];
            var entryVideoDelivery = playbackInfoVideoDeliveryHints[key] || 'unknown';
            if (entryHint === 'hdr') {
                pendingHint = 'hdr';
                pendingVideoDelivery = entryVideoDelivery;
                break;
            }
            if (entryHint === 'sdr') {
                pendingHint = 'sdr';
                if (pendingVideoDelivery === 'unknown') {
                    pendingVideoDelivery = entryVideoDelivery;
                }
            }
        }

        if (pendingHint === 'unknown') {
            return;
        }

        if (!currentMediaSessionItemId) {
            setCurrentPlaybackItemId(latestPlaybackInfoRequestItemId, currentPlaybackMediaSourceId, 'pending-playbackinfo');
        }
        if (pendingVideoDelivery !== 'unknown') {
            setPlaybackVideoDelivery(pendingVideoDelivery, 'playbackinfo-pending');
        }
        setPlaybackDynamicRange(pendingHint, 'playbackinfo-pending');
    }

    function getPgsSubtitleDeliveryDiagnostic(payload, mediaSourceId) {
        if (!payload || typeof payload !== 'object') {
            return 'none';
        }

        var selectedSource = getSelectedPlaybackInfoMediaSource(payload, mediaSourceId);
        if (!selectedSource) {
            return 'none';
        }

        var streams = toArray(selectedSource.MediaStreams || selectedSource.mediaStreams);
        var pgsCount = 0;
        var summary = 'no-pgs';
        for (var j = 0; j < streams.length; j++) {
            var stream = streams[j];
            if (!stream) {
                continue;
            }
            if (!isSubtitleMediaStream(stream)) {
                continue;
            }
            if (getClientRenderableSubtitleFormat(stream) !== 'pgssub') {
                continue;
            }

            pgsCount++;
            if (pgsCount > 1) {
                continue;
            }

            var method = (stream.DeliveryMethod || stream.deliveryMethod || '?').toString();
            var flags = [];
            if (stream.DeliveryUrl || stream.deliveryUrl) {
                flags.push('u');
            }
            if (stream.SupportsExternalStream || stream.supportsExternalStream) {
                flags.push('x');
            }
            if (stream.IsExternal || stream.isExternal) {
                flags.push('e');
            }
            summary = method + (flags.length ? '/' + flags.join('') : '');
        }

        if (pgsCount > 1) {
            summary += ' x' + pgsCount.toString();
        }

        return summary;
    }

    function applyDynamicRangeFromPlaybackInfo(payload, sourceUrl, reason, context) {
        if (!isPlaybackInfoUrl(sourceUrl)) {
            return;
        }

        var itemId = extractItemIdFromPlaybackInfoUrl(sourceUrl);
        var mediaSourceId = getSelectedMediaSourceId(payload) || currentPlaybackMediaSourceId;
        var hint = getDynamicRangeHintFromPlaybackInfoPayload(payload, mediaSourceId);
        var videoDelivery = getPlaybackVideoDeliveryFromPlaybackInfoPayload(payload, mediaSourceId);
        var pgsDeliveryDiagnostic = getPgsSubtitleDeliveryDiagnostic(payload, mediaSourceId);
        hdrDetectionPlaybackInfoLastHint = hint;
        hdrDetectionPlaybackInfoCount++;
        cachePlaybackInfoDynamicRangeHint(itemId, mediaSourceId, hint);
        cachePlaybackInfoVideoDeliveryHint(itemId, mediaSourceId, videoDelivery);
        if (playbackState !== PlaybackState.PLAYING) {
            if (playbackState !== PlaybackState.IDLE) {
                return;
            }
            pgsSubtitleDeliveryDiagnostic = pgsDeliveryDiagnostic;
            rememberPendingPlaybackInfoDynamicRange(itemId, mediaSourceId, hint, videoDelivery, context, reason);
            return;
        }
        if (!shouldApplyPlaybackInfoResponse(itemId, mediaSourceId, context)) {
            return;
        }
        pgsSubtitleDeliveryDiagnostic = pgsDeliveryDiagnostic;

        if (itemId) {
            setCurrentPlaybackItemId(itemId, mediaSourceId, 'item-changed-playbackinfo');
        }
        setPlaybackVideoDelivery(videoDelivery, reason || 'playbackinfo');

        if (hint !== 'unknown') {
            setPlaybackDynamicRange(hint, reason || 'playbackinfo');
        }
    }

    function isSubtitleDeliveryUrl(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }
        return url.toLowerCase().indexOf('/subtitles/') !== -1;
    }

    function recordSubtitleFetchDiagnostic(url, status, bytes, body) {
        // Full path from /Videos/ onward (query/api_key stripped) so the exact
        // itemId/mediaSourceId/index/format is visible for comparing a working
        // vs failing subtitle fetch. On error, append a short response-body
        // snippet — the server usually states why (e.g. source/stream not found).
        var path = (url || '').toString();
        var videosPos = path.toLowerCase().indexOf('/videos/');
        if (videosPos !== -1) {
            path = path.substring(videosPos);
        }
        var queryPos = path.indexOf('?');
        if (queryPos !== -1) {
            path = path.substring(0, queryPos);
        }

        var parts = [];
        parts.push(status ? status.toString() : 'err');
        if (typeof bytes === 'number' && bytes >= 0) {
            parts.push(bytes.toString() + 'b');
        }
        parts.push(path);
        if (body) {
            var snippet = body.toString().replace(/\s+/g, ' ').substring(0, 80);
            if (snippet) {
                parts.push('| ' + snippet);
            }
        }
        pgsSubtitleFetchDiagnostic = parts.join(' ');
    }

    function inspectSubtitleFetchResult(fetchResult, url) {
        if (!fetchResult || typeof fetchResult.then !== 'function') {
            return fetchResult;
        }

        return fetchResult.then(function (response) {
            try {
                var status = response && typeof response.status === 'number' ? response.status : 0;
                var bytes = -1;
                if (response && response.headers && typeof response.headers.get === 'function') {
                    var lengthHeader = response.headers.get('Content-Length');
                    if (lengthHeader) {
                        var parsedLength = parseInt(lengthHeader, 10);
                        if (!isNaN(parsedLength)) {
                            bytes = parsedLength;
                        }
                    }
                }
                recordSubtitleFetchDiagnostic(url, status, bytes, null);
                if (status >= 400 && response && typeof response.clone === 'function') {
                    try {
                        response.clone().text().then(function (text) {
                            recordSubtitleFetchDiagnostic(url, status, bytes, text);
                        }, function () {
                            // Ignore body read errors.
                        });
                    } catch (cloneError) {
                        // Ignore clone failures.
                    }
                }
            } catch (error) {
                debugLog('Failed to inspect subtitle fetch response:', error);
            }
            return response;
        }, function (error) {
            recordSubtitleFetchDiagnostic(url, 0, -1, null);
            throw error;
        });
    }

    function inspectSubtitleXhrResponse(xhr) {
        try {
            if (!xhr || !isSubtitleDeliveryUrl(xhr.__webOsSubtitleUrl)) {
                return;
            }
            var status = xhr.status || 0;
            var bytes = -1;
            var body = null;
            try {
                if (xhr.response && typeof xhr.response.byteLength === 'number') {
                    bytes = xhr.response.byteLength;
                } else if (xhr.response && typeof xhr.response.size === 'number') {
                    bytes = xhr.response.size;
                } else if (typeof xhr.responseText === 'string') {
                    bytes = xhr.responseText.length;
                }
                if (status >= 400 && typeof xhr.responseText === 'string') {
                    body = xhr.responseText;
                }
            } catch (responseError) {
                bytes = -1;
            }
            recordSubtitleFetchDiagnostic(xhr.__webOsSubtitleUrl, status, bytes, body);
        } catch (error) {
            // Ignore subtitle diagnostic read errors.
        }
    }

    function inspectPlaybackInfoFetchResult(fetchResult, url, context) {
        if (!isPlaybackInfoUrl(url) || !fetchResult || typeof fetchResult.then !== 'function') {
            return fetchResult;
        }

        return fetchResult.then(function (response) {
            try {
                if (response && typeof response.clone === 'function') {
                    return response.clone().json().then(function (payload) {
                        applyDynamicRangeFromPlaybackInfo(payload, url, 'playbackinfo-fetch', context);
                        return response;
                    }, function () {
                        // Ignore payload parse errors.
                        return response;
                    });
                }
            } catch (error) {
                debugLog('Failed to inspect fetch PlaybackInfo response:', error);
            }
            return response;
        });
    }

    function inspectPlaybackInfoXhrResponse(xhr) {
        try {
            if (!xhr || !isPlaybackInfoUrl(xhr.__webOsPlaybackInfoUrl)) {
                return;
            }
            if (xhr.status && (xhr.status < 200 || xhr.status >= 300)) {
                return;
            }
            var payload = null;
            if (xhr.response && typeof xhr.response === 'object') {
                payload = xhr.response;
            } else {
                var responseText = '';
                try {
                    responseText = xhr.responseText || '';
                } catch (responseTextError) {
                    responseText = '';
                }
                if (!responseText) {
                    return;
                }
                payload = JSON.parse(responseText);
            }

            applyDynamicRangeFromPlaybackInfo(payload, xhr.__webOsPlaybackInfoUrl, 'playbackinfo-xhr', xhr.__webOsPlaybackInfoContext);
        } catch (error) {
            // Ignore JSON parse errors.
        }
    }

    function isFetchRequest(input) {
        return typeof window.Request !== 'undefined' && input instanceof window.Request;
    }

    function initHasBody(init) {
        return !!(init && typeof init === 'object' && Object.prototype.hasOwnProperty.call(init, 'body'));
    }

    function getFetchMethod(input, init) {
        if (init && init.method) {
            return init.method.toString().toUpperCase();
        }
        if (isFetchRequest(input) && input.method) {
            return input.method.toString().toUpperCase();
        }
        return 'GET';
    }

    function copyRequestInitValue(target, source, key) {
        if (typeof target[key] === 'undefined' && typeof source[key] !== 'undefined') {
            target[key] = source[key];
        }
    }

    function buildFetchInitFromRequest(request, init) {
        var nextInit = init && typeof init === 'object' ? cloneShallowObject(init) : {};
        if (!isFetchRequest(request)) {
            return nextInit;
        }

        copyRequestInitValue(nextInit, request, 'method');
        copyRequestInitValue(nextInit, request, 'headers');
        copyRequestInitValue(nextInit, request, 'mode');
        copyRequestInitValue(nextInit, request, 'credentials');
        copyRequestInitValue(nextInit, request, 'cache');
        copyRequestInitValue(nextInit, request, 'redirect');
        copyRequestInitValue(nextInit, request, 'referrer');
        copyRequestInitValue(nextInit, request, 'referrerPolicy');
        copyRequestInitValue(nextInit, request, 'integrity');
        copyRequestInitValue(nextInit, request, 'keepalive');
        copyRequestInitValue(nextInit, request, 'signal');
        return nextInit;
    }

    function createFetchRequestFromPatchedBody(input, init, url, targetBitrate) {
        if (!isFetchRequest(input) || initHasBody(init) || !targetBitrate) {
            return null;
        }

        var method = getFetchMethod(input, init);
        if (method === 'GET' || method === 'HEAD') {
            return null;
        }

        if (input.bodyUsed || typeof input.clone !== 'function') {
            return null;
        }

        var clonedRequest;
        try {
            clonedRequest = input.clone();
        } catch (error) {
            return null;
        }

        if (!clonedRequest || typeof clonedRequest.text !== 'function') {
            return null;
        }

        return clonedRequest.text().then(function (bodyText) {
            var nextInit = buildFetchInitFromRequest(input, init);
            nextInit.body = enforcePlaybackInfoMaxBitrateBody(bodyText, targetBitrate, 'fetch-request');
            return new window.Request(url, nextInit);
        }, function () {
            return null;
        });
    }

    function initPlaybackInfoInterception() {
        if (playbackInfoInterceptionInitialized) {
            return;
        }
        playbackInfoInterceptionInitialized = true;

        if (window.fetch) {
            var originalFetch = window.fetch;
            window.fetch = function () {
                var fetchThis = this;
                var input = arguments.length ? arguments[0] : null;
                var init = arguments.length > 1 ? arguments[1] : null;
                var hasInitArgument = arguments.length > 1;
                var url = '';
                try {
                    url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                } catch (error) {
                    url = '';
                }

                if (isSubtitleDeliveryUrl(url)) {
                    return inspectSubtitleFetchResult(originalFetch.apply(fetchThis, arguments), url);
                }

                var requestArgs = arguments;
                if (isPlaybackInfoUrl(url)) {
                    var enforcedFetchBitrate = enforcePlaybackInfoMaxBitrateUrl(url, 'fetch');
                    var nextInput = input;
                    var nextInit = init;
                    var responseUrl = enforcedFetchBitrate.url;
                    var urlWasRewritten = enforcedFetchBitrate.url !== url;
                    var playbackInfoContext = createPlaybackInfoRequestContext(responseUrl);

                    if (urlWasRewritten) {
                        if (typeof input === 'string') {
                            nextInput = enforcedFetchBitrate.url;
                        } else if (typeof window.Request !== 'undefined' && input instanceof window.Request) {
                            nextInput = input;
                        } else {
                            nextInput = enforcedFetchBitrate.url;
                        }
                        url = enforcedFetchBitrate.url;
                    }

                    if (enforcedFetchBitrate.targetBitrate && nextInit && typeof nextInit === 'object' && initHasBody(nextInit)) {
                        nextInit = cloneShallowObject(nextInit);
                        nextInit.body = enforcePlaybackInfoMaxBitrateBody(nextInit.body, enforcedFetchBitrate.targetBitrate, 'fetch');
                    }

                    var patchedRequestPromise = createFetchRequestFromPatchedBody(
                        input,
                        nextInit,
                        responseUrl,
                        enforcedFetchBitrate.targetBitrate
                    );
                    if (patchedRequestPromise) {
                        return patchedRequestPromise.then(function (patchedRequest) {
                            var asyncRequestArgs;
                            if (patchedRequest) {
                                asyncRequestArgs = [patchedRequest];
                            } else {
                                if (urlWasRewritten && typeof window.Request !== 'undefined' && input instanceof window.Request && nextInput === input) {
                                    try {
                                        nextInput = new window.Request(enforcedFetchBitrate.url, input);
                                    } catch (requestError) {
                                        nextInput = enforcedFetchBitrate.url;
                                    }
                                }
                                asyncRequestArgs = [nextInput];
                                if (hasInitArgument || nextInit) {
                                    asyncRequestArgs.push(nextInit);
                                }
                            }
                            return inspectPlaybackInfoFetchResult(originalFetch.apply(fetchThis, asyncRequestArgs), responseUrl, playbackInfoContext);
                        });
                    }

                    if (urlWasRewritten && typeof window.Request !== 'undefined' && input instanceof window.Request && nextInput === input) {
                        try {
                            nextInput = new window.Request(enforcedFetchBitrate.url, input);
                        } catch (requestError) {
                            nextInput = enforcedFetchBitrate.url;
                        }
                    }

                    requestArgs = [nextInput];
                    if (hasInitArgument || nextInit) {
                        requestArgs.push(nextInit);
                    }
                }

                return inspectPlaybackInfoFetchResult(originalFetch.apply(this, requestArgs), url, playbackInfoContext);
            };
        }

        if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
            var xhrProto = window.XMLHttpRequest.prototype;
            if (!xhrProto.__webOsPlaybackInfoHooked) {
                xhrProto.__webOsPlaybackInfoHooked = true;
                var originalXhrOpen = xhrProto.open;
                var originalXhrSend = xhrProto.send;

                xhrProto.open = function () {
                    var requestUrl = '';
                    try {
                        requestUrl = arguments.length > 1 ? (arguments[1] || '').toString() : '';
                    } catch (error) {
                        requestUrl = '';
                    }

                    var openArgs = arguments;
                    if (isPlaybackInfoUrl(requestUrl)) {
                        var enforcedXhrBitrate = enforcePlaybackInfoMaxBitrateUrl(requestUrl, 'xhr');
                        requestUrl = enforcedXhrBitrate.url;
                        this.__webOsPlaybackInfoMaxBitrate = enforcedXhrBitrate.targetBitrate;
                        this.__webOsPlaybackInfoContext = createPlaybackInfoRequestContext(requestUrl);

                        var argsCopy = [];
                        for (var i = 0; i < arguments.length; i++) {
                            argsCopy[i] = arguments[i];
                        }
                        if (argsCopy.length > 1) {
                            argsCopy[1] = requestUrl;
                        }
                        openArgs = argsCopy;
                    } else {
                        this.__webOsPlaybackInfoMaxBitrate = 0;
                        this.__webOsPlaybackInfoContext = null;
                    }

                    this.__webOsPlaybackInfoUrl = requestUrl;
                    this.__webOsSubtitleUrl = isSubtitleDeliveryUrl(requestUrl) ? requestUrl : null;
                    return originalXhrOpen.apply(this, openArgs);
                };

                xhrProto.send = function () {
                    var sendArgs = arguments;
                    if (isPlaybackInfoUrl(this.__webOsPlaybackInfoUrl) && this.__webOsPlaybackInfoMaxBitrate && arguments.length) {
                        var sendArgsCopy = [];
                        for (var i = 0; i < arguments.length; i++) {
                            sendArgsCopy[i] = arguments[i];
                        }
                        sendArgsCopy[0] = enforcePlaybackInfoMaxBitrateBody(sendArgsCopy[0], this.__webOsPlaybackInfoMaxBitrate, 'xhr');
                        sendArgs = sendArgsCopy;
                    }

                    if (isPlaybackInfoUrl(this.__webOsPlaybackInfoUrl)
                        && !this.__webOsPlaybackInfoLoadendHooked
                        && this.addEventListener) {
                        this.__webOsPlaybackInfoLoadendHooked = true;
                        this.addEventListener('loadend', function () {
                            inspectPlaybackInfoXhrResponse(this);
                        });
                    }

                    if (this.__webOsSubtitleUrl
                        && !this.__webOsSubtitleLoadendHooked
                        && this.addEventListener) {
                        this.__webOsSubtitleLoadendHooked = true;
                        this.addEventListener('loadend', function () {
                            inspectSubtitleXhrResponse(this);
                        });
                    }

                    return originalXhrSend.apply(this, sendArgs);
                };
            }
        }
    }

    function isHdrUiDimmingAllowedForCurrentPlayback() {
        return playbackState === PlaybackState.PLAYING
            && playbackDynamicRange === 'hdr'
            && isPlaybackVideoCopiedOrDirect(playbackVideoDelivery);
    }

    function setPlaybackVideoDelivery(nextDelivery, reason) {
        nextDelivery = normalizePlaybackVideoDelivery(nextDelivery);
        if (playbackVideoDelivery === nextDelivery) {
            if (reason) {
                playbackVideoDeliveryReason = reason;
            }
            return;
        }

        var previousDelivery = playbackVideoDelivery;
        playbackVideoDelivery = nextDelivery;
        playbackVideoDeliveryReason = reason || null;
        debugLog('Playback video delivery: ' + previousDelivery + ' -> ' + nextDelivery + ' (' + reason + ')');
        refreshHdrUiDimming('video-delivery');
    }

    function refreshHdrUiDimming(reason) {
        if (!document.body) {
            return;
        }

        var shouldDim = isHdrUiDimmingAllowedForCurrentPlayback();
        var hasClass = document.body.classList.contains(HDR_UI_DIM_CLASS);
        if (shouldDim === hasClass) {
            return;
        }

        if (shouldDim) {
            document.body.classList.add(HDR_UI_DIM_CLASS);
        } else {
            document.body.classList.remove(HDR_UI_DIM_CLASS);
        }

        debugLog('HDR UI dimming ' + (shouldDim ? 'enabled' : 'disabled') + ' (' + reason + ')');
    }

    function setPlaybackDynamicRange(nextRange, reason) {
        if (nextRange !== 'hdr' && nextRange !== 'sdr') {
            nextRange = 'unknown';
        }

        var authoritativeSdr = nextRange === 'sdr' && reason && reason !== 'playback-ui';
        if (nextRange === 'sdr'
            && playbackDynamicRange === 'hdr'
            && hdrUiInfoCorrectedHdrUntil
            && Date.now() < hdrUiInfoCorrectedHdrUntil) {
            if (hdrUiInfoCorrectedHdrReason === 'playback-ui' && authoritativeSdr) {
                debugLog('Accepted authoritative SDR after playback UI HDR correction (' + reason + ')');
                clearHdrUiInfoCorrectionWindow();
            } else {
                debugLog('Ignored SDR dynamic range during HDR correction window (' + reason + ')');
                hdrUiInfoObserver.setEnabled(shouldUseHdrUiInfoObserver());
                return;
            }
        }

        if (nextRange === 'hdr' && Date.now() < hdrUiInfoCorrectionUntil) {
            hdrUiInfoCorrectedHdrUntil = Math.max(hdrUiInfoCorrectedHdrUntil, hdrUiInfoCorrectionUntil);
            hdrUiInfoCorrectedHdrReason = reason || null;
        } else if (nextRange === 'hdr') {
            if (!hdrUiInfoCorrectedHdrUntil || Date.now() >= hdrUiInfoCorrectedHdrUntil) {
                clearHdrUiInfoCorrectionWindow();
            }
        }

        if (playbackDynamicRange === nextRange) {
            hdrUiInfoObserver.setEnabled(shouldUseHdrUiInfoObserver());
            return;
        }

        var previousRange = playbackDynamicRange;
        playbackDynamicRange = nextRange;
        playbackDynamicRangeReason = reason || null;
        debugLog('Playback dynamic range: ' + previousRange + ' -> ' + nextRange + ' (' + reason + ')');
        refreshHdrUiDimming('dynamic-range');
        hdrUiInfoObserver.setEnabled(shouldUseHdrUiInfoObserver());
    }

    function applyPlaybackCompatibilityProfilePatches(profile) {
        if (!profile || typeof profile !== 'object') {
            return profile;
        }

        if (!webOSProfilePatches || !webOSProfilePatches.applyPlaybackCompatibilityProfilePatches) {
            warnLog('webOS playback profile patch module is unavailable');
            return profile;
        }

        return webOSProfilePatches.applyPlaybackCompatibilityProfilePatches(profile, {
            maxBitrate: getHighestKnownBitrateOption(),
            lpcmAudioCopyEnabled: lpcmAudioCopyEnabled,
            debugLog: debugLog
        });
    }

    // List of supported features
    var SupportedFeatures = [
        'exit',
        'externallinkdisplay',
        'htmlaudioautoplay',
        'htmlvideoautoplay',
        'imageanalysis',
        'physicalvolumecontrol',
        'displaylanguage',
        'otherapppromotions',
        'targetblank',
        'screensaver',
        'subtitleappearancesettings',
        'subtitleburnsettings',
        'chromecast',
        'multiserver'
    ];

    window.NativeShell = {
        AppHost: {
            init: function () {
                postMessage('AppHost.init', AppInfo);
                return window.Promise && typeof window.Promise.resolve === 'function'
                    ? window.Promise.resolve(AppInfo)
                    : createResolvedThenable(AppInfo);
            },

            appName: function () {
                postMessage('AppHost.appName', AppInfo.appName);
                return AppInfo.appName;
            },

            appVersion: function () {
                postMessage('AppHost.appVersion', AppInfo.appVersion);
                return AppInfo.appVersion;
            },

            deviceId: function () {
                postMessage('AppHost.deviceId', AppInfo.deviceId);
                return AppInfo.deviceId;
            },

            deviceName: function () {
                postMessage('AppHost.deviceName', AppInfo.deviceName);
                return AppInfo.deviceName;
            },

            exit: function () {
                postMessage('AppHost.exit');
            },

            getDefaultLayout: function () {
                postMessage('AppHost.getDefaultLayout', 'tv');
                return 'tv';
            },

            getDeviceProfile: function (profileBuilder) {
                postMessage('AppHost.getDeviceProfile');
                var profile = profileBuilder({
                    enableMkvProgressive: false,
                    enableSsaRender: true,
                    supportsDts: null,
                    supportsDolbyAtmos: deviceInfo ? deviceInfo.dolbyAtmos : null,
                    supportsDolbyVision: deviceInfo ? deviceInfo.dolbyVision : null,
                    supportsHdr10: deviceInfo ? deviceInfo.hdr10 : null
                });

                return applyPlaybackCompatibilityProfilePatches(profile);
            },

            getSyncProfile: function (profileBuilder) {
                postMessage('AppHost.getSyncProfile');
                return profileBuilder({ enableMkvProgressive: false });
            },

            supports: function (command) {
                var normalizedCommand = command && command.toLowerCase();
                var isSupported = normalizedCommand && SupportedFeatures.indexOf(normalizedCommand) != -1;

                if (normalizedCommand === 'htmlvideoautoplay') {
                    isSupported = true;
                }

                postMessage('AppHost.supports', {
                    command: command,
                    isSupported: isSupported
                });
                return isSupported;
            },

            screen: function () {
                return deviceInfo ? {
                    width: deviceInfo.screenWidth,
                    height: deviceInfo.screenHeight
                } : null;
            }
        },

        selectServer: function () {
            setPlaybackState(PlaybackState.IDLE, 'select-server');
            postMessage('selectServer');
        },

        downloadFile: function (url) {
            postMessage('downloadFile', { url: url });
        },

        enableFullscreen: function () {
            setPlaybackState(PlaybackState.PLAYING, 'enable-fullscreen');
            postMessage('enableFullscreen');
        },

        disableFullscreen: function () {
            setPlaybackState(PlaybackState.EXITING, 'disable-fullscreen');
            postMessage('disableFullscreen');
        },

        getPlugins: function () {
            postMessage('getPlugins');
            return [];
        },

        openUrl: function (url, target) {
            postMessage('openUrl', {
                url: url,
                target: target
            });
        },

        updateMediaSession: function (mediaInfo) {
            var itemId = mediaInfo && mediaInfo.itemId ? mediaInfo.itemId.toString() : null;
            var mediaSourceId = getSelectedMediaSourceId(mediaInfo);
            var normalizedMediaSourceId = mediaSourceId ? mediaSourceId.toString() : null;
            var previousItemId = currentMediaSessionItemId;
            if (itemId && playbackState !== PlaybackState.EXITING) {
                if (playbackState === PlaybackState.PLAYING) {
                    if (previousItemId !== itemId) {
                        startPlaybackStartMaxBitrateForce('media-session-item-change');
                    }
                } else {
                    setPlaybackState(PlaybackState.PLAYING, 'media-session');
                }
            }
            setCurrentPlaybackItemId(itemId, mediaSourceId, 'item-changed');

            var dynamicRangeHint = getDynamicRangeHintFromMediaInfo(mediaInfo);
            hdrDetectionMediaSessionLastHint = dynamicRangeHint;
            if (dynamicRangeHint !== 'unknown') {
                setPlaybackDynamicRange(dynamicRangeHint, 'media-session');
            }

            if (itemId) {
                if (playbackVideoDelivery === 'unknown') {
                    var playbackInfoVideoDelivery = getCachedPlaybackInfoVideoDeliveryHint(itemId, mediaSourceId);
                    if (playbackInfoVideoDelivery !== 'unknown') {
                        setPlaybackVideoDelivery(playbackInfoVideoDelivery, 'playbackinfo-cache');
                    }
                }

                if (dynamicRangeHint === 'unknown') {
                    var playbackInfoHint = getCachedPlaybackInfoDynamicRangeHint(itemId, mediaSourceId);
                    if (playbackInfoHint !== 'unknown') {
                        setPlaybackDynamicRange(playbackInfoHint, 'playbackinfo-cache');
                    }
                }

                fetchDynamicRangeHintForItemId(itemId, mediaSourceId).then(function (itemHint) {
                    if (currentMediaSessionItemId !== itemId || currentPlaybackMediaSourceId !== normalizedMediaSourceId) {
                        return;
                    }

                    hdrDetectionItemMetadataLastHint = itemHint;
                    if (itemHint !== 'unknown') {
                        setPlaybackDynamicRange(itemHint, 'item-metadata');
                    }
                });
            } else if (dynamicRangeHint === 'unknown') {
                setPlaybackDynamicRange('unknown', 'media-session-no-item');
            }

            scheduleHdrUiInfoScan(60);
            postMessage('updateMediaSession', { mediaInfo: mediaInfo });
        },

        hideMediaSession: function () {
            setPlaybackState(PlaybackState.IDLE, 'hide-media-session');
            postMessage('hideMediaSession');
        }
    };

    initHeaderPinning();
    loadPersistedPlaybackDiagnosticsSettings();
    loadPersistedHdrUiDimBrightness();
    syncAssRendererOptions();
    syncMonotonicMediaTimeHelper();
    syncPgsAsyncStatsHelper();
    syncPgsMainThreadStatsHelper();
    syncPgsRenderGuard();
    syncPgsRendererOptionsHelper();
    initPointerFirstClickFocusFix();
    initAssScriptInterception();
    initAssRendererInterception();
    applyHdrUiDimSettings();
    emitFeatureOverridesChanged();
    initWebOSSettingsInjection();
    initQualityMenuPatching();
    setQualityMenuObserverEnabled(true);
    initPlaybackInfoInterception();
    initHdrUiInfoObserver();
    hdrUiInfoObserver.setEnabled(false);
    updatePlaybackDiagnosticsOverlay();
    refreshHdrUiDimming('init');
})(window.AppInfo, window.DeviceInfo, window.WebOSFeatureOverrides);
