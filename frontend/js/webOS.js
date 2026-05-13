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

    debugLog('WebOS adapter');
    var PlaybackState = {
        IDLE: 'idle',
        PLAYING: 'playing',
        EXITING: 'exiting'
    };
    var playbackState = PlaybackState.IDLE;
    var exitToIdleTimer = null;
    var EXIT_TO_IDLE_TIMEOUT = 2000;
    var HEADER_PIN_INTERVAL = 2500;
    var MIN_HEADER_HEIGHT = 72;
    var headerPinTimer = null;
    var headerPinningInitialized = false;
    var headerPinScheduled = false;
    var cachedHeaderElement = null;
    var lastHeaderMeasureTs = 0;
    var HEADER_MEASURE_INTERVAL = 1500;
    var qualityMenuObserver = null;
    var qualityMenuObserverActive = false;
    var qualityMenuPatchTimer = null;
    var QUALITY_MENU_EXTRA_BITRATES = [120000000, 100000000, 80000000];
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
    var SETTINGS_INJECTION_RETRY_DELAY = 250;
    var SETTINGS_INJECTION_MAX_RETRIES = 20;
    var PLAYBACK_DIAGNOSTICS_KEY = 'webos_playback_diagnostics_overlay';
    var DISABLE_ASS_RENDER_AHEAD_KEY = 'webos_disable_ass_render_ahead';
    var DROP_ASS_ANIMATIONS_KEY = 'webos_drop_ass_animations';
    var ASS_RENDER_AHEAD_LIMIT_MIB = 0;
    var ASS_TIME_SYNC_INTERVAL_MS = 33;
    var ASS_TIME_SYNC_BACKWARD_TOLERANCE_SECONDS = 0.03;
    var ASS_TIME_SYNC_SEEK_BACK_SECONDS = 0.75;
    var PLAYBACK_DIAGNOSTICS_UPDATE_INTERVAL = 500;
    var SCRIPT_PATCH_FETCH_TIMEOUT_MS = 8000;
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
    var playbackDiagnosticsEnabled = !!(featureOverrides && featureOverrides.playbackDiagnosticsEnabled);
    var disableAssRenderAhead = featureOverrides && typeof featureOverrides.disableAssRenderAhead === 'boolean' ? featureOverrides.disableAssRenderAhead : true;
    var dropAssAnimations = !!(featureOverrides && featureOverrides.dropAssAnimations);
    var hdrUiDimBrightness = HDR_UI_DIM_DEFAULT_BRIGHTNESS;
    var hdrSubtitleOpacity = HDR_SUBTITLE_DEFAULT_OPACITY;
    var HDR_UI_DIM_CLASS = 'webos-hdr-ui-dim';
    var playbackDynamicRange = 'unknown';
    var hdrUiInfoObserver = null;
    var hdrUiInfoObserverActive = false;
    var hdrUiInfoScanTimer = null;
    var currentMediaSessionItemId = null;
    var mediaItemDynamicRangeCache = {};
    var mediaItemDynamicRangeInFlight = {};
    var playbackInfoInterceptionInitialized = false;
    var playbackDiagnosticsOverlay = null;
    var playbackDiagnosticsRafId = null;
    var playbackDiagnosticsLastRafTs = 0;
    var playbackDiagnosticsWindowStartTs = 0;
    var playbackDiagnosticsRafFrames = 0;
    var playbackDiagnosticsRafFps = 0;
    var playbackDiagnosticsLastUpdateTs = 0;
    var playbackDiagnosticsVideo = null;
    var playbackDiagnosticsVideoFrameCallbackId = null;
    var playbackDiagnosticsVideoFrameCount = 0;
    var playbackDiagnosticsVideoFrameWindowStartTs = 0;
    var playbackDiagnosticsVideoFrameFps = 0;
    var playbackDiagnosticsVideoFrameDelta = 0;
    var playbackDiagnosticsLongTaskObserver = null;
    var playbackDiagnosticsLongTaskSupported = false;
    var playbackDiagnosticsLongTaskUnavailable = false;
    var playbackDiagnosticsLongTaskWindowStartTs = 0;
    var playbackDiagnosticsLongTaskWindowCount = 0;
    var playbackDiagnosticsLongTaskWindowDuration = 0;
    var playbackDiagnosticsLongTaskWindowMax = 0;
    var playbackDiagnosticsLongTaskDisplayCount = 0;
    var playbackDiagnosticsLongTaskDisplayDuration = 0;
    var playbackDiagnosticsLongTaskDisplayMax = 0;
    var assRendererInterceptionInitialized = false;
    var assWorkerInitPatchCount = 0;
    var assWorkerOneshotBlockedCount = 0;
    var assWorkerLastPatchInfo = 'none';
    var assScriptInterceptionInitialized = false;
    var assScriptPatchCount = 0;
    var assScriptLastPatchInfo = 'none';
    var externalScriptPatchQueue = [];
    var externalScriptPatchQueueActive = false;
    var assWorkerTimeSyncEntries = [];
    var assWorkerTimeSyncStartedCount = 0;
    var assWorkerTimeSyncPostWindowStartTs = 0;
    var assWorkerTimeSyncPostWindowCount = 0;
    var assWorkerTimeSyncPostDisplayCount = 0;
    var assWorkerTimeSyncClampCount = 0;
    var assWorkerVideoStateEntries = [];
    var assWorkerVideoMessagePatchCount = 0;
    var assWorkerVideoMessageWindowStartTs = 0;
    var assWorkerVideoMessageWindowCount = 0;
    var assWorkerVideoMessageDisplayCount = 0;
    var monotonicMediaTimeEntries = [];
    var pgsScriptPatchCount = 0;
    var pgsScriptTimePatchCount = 0;
    var pgsScriptAsyncPatchCount = 0;
    var pgsScriptRenderPatchCount = 0;
    var pgsScriptLastPatchInfo = 'none';
    var pgsTimeSampleWindowStartTs = 0;
    var pgsTimeSampleWindowCount = 0;
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
            return;
        }

        document.body.classList.remove('webos-force-header-pin');
        document.body.style.paddingTop = '';
        document.documentElement.style.removeProperty('--webos-header-offset');
        updateHeaderPinHeartbeat();

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
        setHdrUiInfoObserverEnabled(nextState === PlaybackState.PLAYING);
        if (nextState === PlaybackState.PLAYING && previousState !== PlaybackState.PLAYING) {
            startPlaybackStartMaxBitrateForce('playback-start');
        }
        if (nextState !== PlaybackState.PLAYING) {
            clearPlaybackStartMaxBitrateForce('playback-state-change');
        }
        if (nextState === PlaybackState.IDLE) {
            lastPlaybackInfoMaxBitrateItemId = null;
            resetSubtitleTimingState('playback-idle');
        }

        if (nextState === PlaybackState.IDLE) {
            setCurrentPlaybackItemId(null);
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
        playbackDiagnosticsVideoFrameCount = 0;
        playbackDiagnosticsVideoFrameWindowStartTs = 0;
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

            if (!playbackDiagnosticsVideoFrameWindowStartTs) {
                playbackDiagnosticsVideoFrameWindowStartTs = now;
            }

            playbackDiagnosticsVideoFrameCount++;
            var elapsed = now - playbackDiagnosticsVideoFrameWindowStartTs;
            if (elapsed >= 1000) {
                playbackDiagnosticsVideoFrameFps = Math.round((playbackDiagnosticsVideoFrameCount * 1000 / elapsed) * 10) / 10;
                playbackDiagnosticsVideoFrameCount = 0;
                playbackDiagnosticsVideoFrameWindowStartTs = now;
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
        playbackDiagnosticsLongTaskWindowStartTs = 0;
        playbackDiagnosticsLongTaskWindowCount = 0;
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
                    playbackDiagnosticsLongTaskWindowCount++;
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

        if (!playbackDiagnosticsLongTaskWindowStartTs) {
            playbackDiagnosticsLongTaskWindowStartTs = now;
        }

        if ((now - playbackDiagnosticsLongTaskWindowStartTs) >= 1000) {
            playbackDiagnosticsLongTaskDisplayCount = playbackDiagnosticsLongTaskWindowCount;
            playbackDiagnosticsLongTaskDisplayDuration = Math.round(playbackDiagnosticsLongTaskWindowDuration);
            playbackDiagnosticsLongTaskDisplayMax = Math.round(playbackDiagnosticsLongTaskWindowMax);
            playbackDiagnosticsLongTaskWindowStartTs = now;
            playbackDiagnosticsLongTaskWindowCount = 0;
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

        playbackDiagnosticsOverlay = document.createElement('div');
        playbackDiagnosticsOverlay.className = 'webos-playback-diagnostics-overlay';
        playbackDiagnosticsOverlay.style.position = 'fixed';
        playbackDiagnosticsOverlay.style.left = '1rem';
        playbackDiagnosticsOverlay.style.top = '1rem';
        playbackDiagnosticsOverlay.style.zIndex = '2147483647';
        playbackDiagnosticsOverlay.style.pointerEvents = 'none';
        playbackDiagnosticsOverlay.style.background = 'rgba(0, 0, 0, 0.76)';
        playbackDiagnosticsOverlay.style.color = '#d6f6ff';
        playbackDiagnosticsOverlay.style.font = '13px/1.35 monospace';
        playbackDiagnosticsOverlay.style.whiteSpace = 'pre';
        playbackDiagnosticsOverlay.style.padding = '0.55rem 0.7rem';
        playbackDiagnosticsOverlay.style.border = '1px solid rgba(0, 164, 220, 0.65)';
        playbackDiagnosticsOverlay.style.borderRadius = '4px';
        playbackDiagnosticsOverlay.style.maxWidth = '44rem';
        playbackDiagnosticsOverlay.textContent = 'webOS playback diagnostics';
        document.body.appendChild(playbackDiagnosticsOverlay);

        return playbackDiagnosticsOverlay;
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
        var parent = findParentByClass(canvas, 'libassjs-canvas-parent') || canvas.parentNode || canvas;
        var computedStyle = null;
        try {
            computedStyle = window.getComputedStyle ? window.getComputedStyle(parent) : null;
        } catch (error) {
            computedStyle = null;
        }

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
        var filter = computedStyle ? computedStyle.filter || computedStyle.webkitFilter || 'none' : 'n/a';
        var opacity = computedStyle ? computedStyle.opacity || 'n/a' : 'n/a';
        return canvases.length.toString() + ' size=' + size + ' css=' + cssSize + ' filter=' + filter + ' opacity=' + opacity;
    }

    function getPlaybackDiagnosticsAssWorkerInfo() {
        return 'initPatch=' + assWorkerInitPatchCount.toString()
            + ' oneshotBlocked=' + assWorkerOneshotBlockedCount.toString()
            + ' renderAhead=' + (disableAssRenderAhead ? ASS_RENDER_AHEAD_LIMIT_MIB.toString() : 'upstream')
            + ' scriptPatch=' + assScriptPatchCount.toString()
            + ' videoMsg=' + assWorkerVideoMessageDisplayCount.toString() + 'ps'
            + ' activeSync=off'
            + ' msgPatch=' + assWorkerVideoMessagePatchCount.toString()
            + ' clamp=' + assWorkerTimeSyncClampCount.toString()
            + ' dropAnim=' + dropAssAnimations
            + ' last=' + assWorkerLastPatchInfo
            + ' script=' + assScriptLastPatchInfo;
    }

    function getPlaybackDiagnosticsPgsInfo() {
        return 'scriptPatch=' + pgsScriptPatchCount.toString()
            + '(time' + pgsScriptTimePatchCount.toString()
            + '/async' + pgsScriptAsyncPatchCount.toString()
            + '/render' + pgsScriptRenderPatchCount.toString() + ')'
            + ' time=' + pgsTimeSampleDisplayCount.toString() + 'ps'
            + ' back=' + pgsTimeBackwardCount.toString()
            + ' maxBack=' + pgsTimeMaxBackwardMs.toString() + 'ms'
            + ' clamp=' + pgsTimeClampCount.toString()
            + ' lastClamp=' + pgsTimeLastClampInfo
            + ' async=req' + pgsAsyncRequestCount.toString()
            + '/draw' + pgsAsyncDrawCount.toString()
            + '/drop' + pgsAsyncStaleDropCount.toString()
            + ' lastAsync=' + pgsAsyncLastInfo
            + ' render=req' + pgsRenderRequestCount.toString()
            + '/post' + pgsRenderPostCount.toString()
            + '/back' + pgsRenderBackwardCount.toString()
            + '/drop' + pgsRenderDropCount.toString()
            + ' lastRender=' + pgsRenderLastInfo
            + ' script=' + pgsScriptLastPatchInfo;
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
            'webOS playback diagnostics',
            'state=' + playbackState + ' range=' + playbackDynamicRange,
            'rAF=' + playbackDiagnosticsRafFps + ' fps rVFC=' + (rVfcSupported ? playbackDiagnosticsVideoFrameFps + ' fps' : 'unsupported') + ' vSyncDelta=' + (rVfcSupported ? playbackDiagnosticsVideoFrameDelta + 'ms' : 'n/a'),
            'longTask=' + formatPlaybackDiagnosticsLongTaskInfo(now),
            'video=' + dimensions + ' t=' + currentTime + ' paused=' + (video ? video.paused : 'n/a') + ' ready=' + (video ? video.readyState : 'n/a') + ' rate=' + (video ? video.playbackRate : 'n/a'),
            'assCanvas=' + getPlaybackDiagnosticsAssCanvasInfo(),
            'assWorker=' + getPlaybackDiagnosticsAssWorkerInfo(),
            'pgs=' + getPlaybackDiagnosticsPgsInfo(),
            'frames dropped=' + formatPlaybackDiagnosticsNumber(dropped) + ' total=' + formatPlaybackDiagnosticsNumber(total),
            'ua=' + navigator.userAgent
        ].join('\n');

        playbackDiagnosticsLastUpdateTs = now;
    }

    function runPlaybackDiagnosticsOverlay(now) {
        if (!playbackDiagnosticsEnabled) {
            playbackDiagnosticsRafId = null;
            return;
        }

        if (!playbackDiagnosticsWindowStartTs) {
            playbackDiagnosticsWindowStartTs = now;
        }

        if (playbackDiagnosticsLastRafTs) {
            playbackDiagnosticsRafFrames++;
        }
        playbackDiagnosticsLastRafTs = now;

        var elapsed = now - playbackDiagnosticsWindowStartTs;
        if (elapsed >= 1000) {
            playbackDiagnosticsRafFps = Math.round((playbackDiagnosticsRafFrames * 1000 / elapsed) * 10) / 10;
            playbackDiagnosticsRafFrames = 0;
            playbackDiagnosticsWindowStartTs = now;
        }

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
            playbackDiagnosticsWindowStartTs = 0;
            playbackDiagnosticsRafFrames = 0;
            playbackDiagnosticsRafFps = 0;
            playbackDiagnosticsLastUpdateTs = 0;
            if (playbackDiagnosticsOverlay && playbackDiagnosticsOverlay.parentNode) {
                playbackDiagnosticsOverlay.parentNode.removeChild(playbackDiagnosticsOverlay);
            }
            playbackDiagnosticsOverlay = null;
            return;
        }

        createPlaybackDiagnosticsOverlay();
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

    function getHdrSubtitleBrightness() {
        var brightness = hdrUiDimBrightness + 0.22;
        if (brightness > 1) {
            brightness = 1;
        }
        if (brightness < 0.08) {
            brightness = 0.08;
        }
        return brightness;
    }

    function getHdrPgsOverlayBrightness() {
        var brightness = hdrUiDimBrightness + 0.2;
        if (brightness > 1) {
            brightness = 1;
        }
        if (brightness < 0.08) {
            brightness = 0.08;
        }
        return brightness;
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
            console.warn('Failed to load persisted HDR UI dim brightness:', error);
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
            console.warn('Failed to save persisted HDR UI dim brightness:', error);
        }
    }

    function setHdrUiDimBrightness(value, reason) {
        var nextValue = clampHdrUiDimBrightness(value);
        if (Math.abs(nextValue - hdrUiDimBrightness) < 0.0001) {
            return;
        }

        hdrUiDimBrightness = nextValue;
        savePersistedHdrUiDimBrightness();
        applyHdrUiDimSettings();
        refreshHdrUiDimming('brightness-change');
        debugLog('HDR UI dim brightness changed (' + reason + '): ' + formatHdrUiDimBrightness(hdrUiDimBrightness));
    }

    function setHdrSubtitleOpacity(value, reason) {
        var nextValue = clampHdrSubtitleOpacity(value);
        if (Math.abs(nextValue - hdrSubtitleOpacity) < 0.0001) {
            return;
        }

        hdrSubtitleOpacity = nextValue;
        savePersistedHdrUiDimBrightness();
        applyHdrUiDimSettings();
        refreshHdrUiDimming('subtitle-opacity-change');
        debugLog('HDR subtitle opacity changed (' + reason + '): ' + formatHdrSubtitleOpacity(hdrSubtitleOpacity));
    }

    function loadPersistedPlaybackDiagnosticsSettings() {
        try {
            if (!window.localStorage) {
                return;
            }
            playbackDiagnosticsEnabled = parseStoredBoolean(localStorage.getItem(PLAYBACK_DIAGNOSTICS_KEY), playbackDiagnosticsEnabled);
            disableAssRenderAhead = parseStoredBoolean(localStorage.getItem(DISABLE_ASS_RENDER_AHEAD_KEY), disableAssRenderAhead);
            dropAssAnimations = parseStoredBoolean(localStorage.getItem(DROP_ASS_ANIMATIONS_KEY), dropAssAnimations);
        } catch (error) {
            console.warn('Failed to load persisted webOS diagnostics settings:', error);
        }
    }

    function savePersistedPlaybackDiagnosticsSettings() {
        try {
            if (!window.localStorage) {
                return;
            }
            localStorage.setItem(PLAYBACK_DIAGNOSTICS_KEY, playbackDiagnosticsEnabled ? 'true' : 'false');
            localStorage.setItem(DISABLE_ASS_RENDER_AHEAD_KEY, disableAssRenderAhead ? 'true' : 'false');
            localStorage.setItem(DROP_ASS_ANIMATIONS_KEY, dropAssAnimations ? 'true' : 'false');
        } catch (error) {
            console.warn('Failed to save webOS diagnostics settings:', error);
        }
    }

    function setDisableAssRenderAhead(enabled, reason) {
        var nextValue = !!enabled;
        if (disableAssRenderAhead === nextValue) {
            return;
        }

        disableAssRenderAhead = nextValue;
        savePersistedPlaybackDiagnosticsSettings();
        emitFeatureOverridesChanged();
        syncAssRendererOptions();
        debugLog('ASS/libass render-ahead limit changed (' + reason + '): ' + disableAssRenderAhead);
    }

    function setDropAssAnimations(enabled, reason) {
        var nextValue = !!enabled;
        if (dropAssAnimations === nextValue) {
            return;
        }

        dropAssAnimations = nextValue;
        savePersistedPlaybackDiagnosticsSettings();
        syncAssRendererOptions();
        emitFeatureOverridesChanged();
        debugLog('ASS/libass animation dropping changed (' + reason + '): ' + dropAssAnimations);
    }

    function setPlaybackDiagnosticsEnabled(enabled, reason) {
        var nextValue = !!enabled;
        if (playbackDiagnosticsEnabled === nextValue) {
            updatePlaybackDiagnosticsOverlay();
            return;
        }

        playbackDiagnosticsEnabled = nextValue;
        savePersistedPlaybackDiagnosticsSettings();
        updatePlaybackDiagnosticsOverlay();
        emitFeatureOverridesChanged();
        debugLog('Playback diagnostics overlay changed (' + reason + '): ' + playbackDiagnosticsEnabled);
    }

    function emitFeatureOverridesChanged() {
        postMessage('WebOS.featureOverrides', {
            playbackDiagnosticsEnabled: !!playbackDiagnosticsEnabled,
            disableAssRenderAhead: !!disableAssRenderAhead,
            dropAssAnimations: !!dropAssAnimations
        });
    }

    function syncAssRendererOptions() {
        window.WebOSAssRendererOptions = {
            limitRenderAhead: !!disableAssRenderAhead,
            renderAheadMiB: ASS_RENDER_AHEAD_LIMIT_MIB,
            dropAssAnimations: !!dropAssAnimations
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

    function updatePgsTimeSampleStats(now) {
        if (!pgsTimeSampleWindowStartTs) {
            pgsTimeSampleWindowStartTs = now;
        }

        pgsTimeSampleWindowCount++;
        if ((now - pgsTimeSampleWindowStartTs) >= 1000) {
            pgsTimeSampleDisplayCount = pgsTimeSampleWindowCount;
            pgsTimeSampleWindowCount = 0;
            pgsTimeSampleWindowStartTs = now;
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
                && !video.seeking
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

    function buildAssDropAnimationsReplacement() {
        return 'dropAllAnimations:!!(window.WebOSAssRendererOptions&&window.WebOSAssRendererOptions.dropAssAnimations)';
    }

    function buildPgsRenderAtVideoTimestampReplacement(methodPrefix) {
        return methodPrefix + '{if(this.video){var t=this.video.currentTime+this.$timeOffset;this.renderAtTimestamp(window.WebOSMonotonicMediaTime?window.WebOSMonotonicMediaTime.get(this.video,"pgs",t):t)}}';
    }

    function buildPgsAsyncSubtitleDataGuardReplacement() {
        return 'e.prototype.render=function(t){this.__webosLatestPgsIndex=t;window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.request(t);this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){if(e.data&&typeof e.data.index==="number"&&typeof this.__webosLatestPgsIndex==="number"&&e.data.index!==this.__webosLatestPgsIndex){window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.drop(e.data.index,this.__webosLatestPgsIndex);return}window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.draw(e.data&&e.data.index);var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
    }

    function buildPgsOffscreenRenderGuardReplacement() {
        return 'e.prototype.render=function(t){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,t))return;this.worker.postMessage({op:"render",index:t})}';
    }

    function patchAssRendererScriptText(text, url) {
        if (!text || typeof text !== 'string') {
            return text;
        }

        if (text.indexOf('renderAhead') === -1 && text.indexOf('dropAllAnimations') === -1) {
            return text;
        }

        var patched = text;
        patched = patched.replace(/renderAhead\s*:\s*90\.0\b/g, buildAssRenderAheadReplacement('90'));
        patched = patched.replace(/renderAhead\s*:\s*90(?!\.)\b/g, buildAssRenderAheadReplacement('90'));
        patched = patched.replace(/dropAllAnimations\s*:\s*(?:false|!1)\b/g, buildAssDropAnimationsReplacement());

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
        if (!mayPatchTime && !mayPatchAsync && !mayPatchRender) {
            return text;
        }

        var patched = text;
        var patchedTime = false;
        var patchedAsync = false;
        var patchedRender = false;
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
            pgsScriptLastPatchInfo = 'patched ' + (url || 'script');
            debugLog('Patched PGS renderer script:', url || 'inline');
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

        return src.indexOf('blob:') !== 0 && src.indexOf('data:') !== 0;
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
        }, SCRIPT_PATCH_FETCH_TIMEOUT_MS);

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
        script.__webOsAssScriptIntercepted = true;
        externalScriptPatchQueue.push({
            parent: parent,
            script: script,
            refNode: refNode || null,
            originalInsert: originalInsert,
            src: src
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

        var patched = cloneShallowObject(message);
        var changed = false;

        if (dropAssAnimations && patched.dropAllAnimations !== true) {
            patched.dropAllAnimations = true;
            changed = true;
        }

        var targetFps = typeof patched.targetFps === 'number' ? Math.round(patched.targetFps * 10) / 10 : patched.targetFps;
        assWorkerLastPatchInfo = 'fps=' + targetFps
            + ',renderOnDemand=' + patched.renderOnDemand
            + ',mode=' + patched.renderMode
            + ',drop=' + patched.dropAllAnimations;

        if (changed) {
            assWorkerInitPatchCount++;
            debugLog('Patched ASS worker init:', assWorkerLastPatchInfo);
        }

        return patched;
    }

    function shouldBlockAssWorkerMessage(message) {
        return false;
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
        if (!assWorkerVideoMessageWindowStartTs) {
            assWorkerVideoMessageWindowStartTs = now;
        }

        assWorkerVideoMessageWindowCount++;
        if ((now - assWorkerVideoMessageWindowStartTs) >= 1000) {
            assWorkerVideoMessageDisplayCount = assWorkerVideoMessageWindowCount;
            assWorkerVideoMessageWindowCount = 0;
            assWorkerVideoMessageWindowStartTs = now;
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
            var predictedTime = getPredictedAssWorkerTime(entry, now);
            if (typeof predictedTime === 'number'
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

    function updateAssWorkerTimeSyncPostStats(now) {
        if (!assWorkerTimeSyncPostWindowStartTs) {
            assWorkerTimeSyncPostWindowStartTs = now;
        }

        assWorkerTimeSyncPostWindowCount++;
        if ((now - assWorkerTimeSyncPostWindowStartTs) >= 1000) {
            assWorkerTimeSyncPostDisplayCount = assWorkerTimeSyncPostWindowCount;
            assWorkerTimeSyncPostWindowCount = 0;
            assWorkerTimeSyncPostWindowStartTs = now;
        }
    }

    function findAssWorkerTimeSyncEntry(worker) {
        for (var i = 0; i < assWorkerTimeSyncEntries.length; i++) {
            if (assWorkerTimeSyncEntries[i].worker === worker) {
                return assWorkerTimeSyncEntries[i];
            }
        }
        return null;
    }

    function stopAssWorkerTimeSync(worker) {
        for (var i = 0; i < assWorkerTimeSyncEntries.length; i++) {
            var entry = assWorkerTimeSyncEntries[i];
            if (entry.worker !== worker) {
                continue;
            }

            entry.stopped = true;
            if (entry.rafId && window.cancelAnimationFrame) {
                window.cancelAnimationFrame(entry.rafId);
            }
            if (entry.timerId) {
                clearTimeout(entry.timerId);
            }
            assWorkerTimeSyncEntries.splice(i, 1);
            return;
        }
    }

    function scheduleAssWorkerTimeSync(entry) {
        if (entry.stopped) {
            return;
        }

        if (window.requestAnimationFrame) {
            entry.rafId = window.requestAnimationFrame(function () {
                runAssWorkerTimeSync(entry, Date.now());
            });
            return;
        }

        entry.timerId = setTimeout(function () {
            runAssWorkerTimeSync(entry, Date.now());
        }, ASS_TIME_SYNC_INTERVAL_MS);
    }

    function getAssTimeSyncVideo() {
        return findPlaybackDiagnosticsVideo();
    }

    function getClampedAssCurrentTime(entry, video) {
        var currentTime = typeof video.currentTime === 'number' ? video.currentTime : 0;
        if (typeof entry.lastPostedCurrentTime === 'number'
            && currentTime + ASS_TIME_SYNC_BACKWARD_TOLERANCE_SECONDS < entry.lastPostedCurrentTime) {
            var backwardsBy = entry.lastPostedCurrentTime - currentTime;
            if (!video.seeking && backwardsBy < ASS_TIME_SYNC_SEEK_BACK_SECONDS) {
                assWorkerTimeSyncClampCount++;
                return entry.lastPostedCurrentTime;
            }
        }
        return currentTime;
    }

    function postAssWorkerVideoState(entry, video, now, force) {
        if (!video || entry.stopped) {
            return;
        }

        var paused = !!video.paused || !!video.ended;
        if (!force
            && (now - entry.lastPostTs) < ASS_TIME_SYNC_INTERVAL_MS
            && paused === entry.lastPostedPaused) {
            return;
        }

        var currentTime = getClampedAssCurrentTime(entry, video);
        var playbackRate = typeof video.playbackRate === 'number' && video.playbackRate > 0 ? video.playbackRate : 1;
        try {
            entry.postMessage.call(entry.worker, {
                target: 'video',
                currentTime: currentTime,
                isPaused: paused,
                rate: playbackRate
            });
            entry.lastPostTs = now;
            entry.lastPostedCurrentTime = currentTime;
            entry.lastPostedPaused = paused;
            updateAssWorkerTimeSyncPostStats(now);
        } catch (error) {
            stopAssWorkerTimeSync(entry.worker);
        }
    }

    function runAssWorkerTimeSync(entry, now) {
        if (entry.stopped) {
            return;
        }

        var video = getAssTimeSyncVideo();
        if (video) {
            postAssWorkerVideoState(entry, video, now, false);
        }

        scheduleAssWorkerTimeSync(entry);
    }

    function startAssWorkerTimeSync(worker, originalPostMessage) {
        // Active high-frequency time sync turns webOS currentTime jitter into visible ASS stutter.
        // Keep the worker on its own smooth clock and only clamp backwards video messages.
        return;

        if (!worker || findAssWorkerTimeSyncEntry(worker)) {
            return;
        }

        if (disableAssRenderAhead) {
            return;
        }

        var entry = {
            worker: worker,
            postMessage: originalPostMessage,
            rafId: 0,
            timerId: 0,
            stopped: false,
            lastPostTs: 0,
            lastPostedCurrentTime: null,
            lastPostedPaused: null
        };
        assWorkerTimeSyncEntries.push(entry);
        assWorkerTimeSyncStartedCount++;

        var video = getAssTimeSyncVideo();
        if (video) {
            postAssWorkerVideoState(entry, video, Date.now(), true);
        }
        scheduleAssWorkerTimeSync(entry);
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
            if (shouldBlockAssWorkerMessage(message)) {
                assWorkerOneshotBlockedCount++;
                return undefined;
            }

            var patchedMessage = patchAssWorkerInitMessage(this, message);
            patchedMessage = patchAssWorkerVideoMessage(this, patchedMessage);
            if (patchedMessage === message) {
                var originalResult = originalPostMessage.apply(this, arguments);
                if (isAssWorkerInitMessage(message)) {
                    startAssWorkerTimeSync(this, originalPostMessage);
                } else if (message && typeof message === 'object' && message.target === 'destroy') {
                    unmarkAssWorker(this);
                    stopAssWorkerTimeSync(this);
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
            if (isAssWorkerInitMessage(patchedMessage)) {
                startAssWorkerTimeSync(this, originalPostMessage);
            } else if (patchedMessage && typeof patchedMessage === 'object' && patchedMessage.target === 'destroy') {
                unmarkAssWorker(this);
                stopAssWorkerTimeSync(this);
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
                stopAssWorkerTimeSync(this);
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

    function insertControlAfter(referenceNode, controlNode) {
        if (referenceNode === document.body && controlNode) {
            document.body.appendChild(controlNode);
            return;
        }

        if (!referenceNode || !referenceNode.parentNode || !controlNode) {
            return;
        }
        referenceNode.parentNode.insertBefore(controlNode, referenceNode.nextSibling);
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
        return document.querySelector('.fldEnableDts')
            || getNearestControlContainer(document.querySelector('.chkEnableDts'))
            || document.querySelector('.fldEnableTrueHd')
            || getNearestControlContainer(document.querySelector('.chkEnableTrueHd'))
            || getNearestControlContainer(document.querySelector('#selectPreferredTranscodeVideoCodec'))
            || getNearestControlContainer(document.querySelector('#selectAllowedAudioChannels'));
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

    function initializeHdrUiDimControl(container) {
        if (!container) {
            return;
        }

        var slider = container.querySelector('.webosHdrUiDimSlider');
        if (!slider) {
            return;
        }

        if (slider.getAttribute('data-webos-init') !== 'true') {
            slider.addEventListener('input', function () {
                setHdrUiDimBrightness(percentToBrightness(slider.value), 'settings-slider-input');
                updateHdrUiDimControlDisplay(container);
            });
            slider.addEventListener('change', function () {
                setHdrUiDimBrightness(percentToBrightness(slider.value), 'settings-slider-change');
                updateHdrUiDimControlDisplay(container);
            });
            slider.setAttribute('data-webos-init', 'true');
        }

        updateHdrUiDimControlDisplay(container);
    }

    function initializeHdrSubtitleOpacityControl(container) {
        if (!container) {
            return;
        }

        var slider = container.querySelector('.webosHdrSubtitleOpacitySlider');
        if (!slider) {
            return;
        }

        if (slider.getAttribute('data-webos-init') !== 'true') {
            slider.addEventListener('input', function () {
                setHdrSubtitleOpacity(percentToOpacity(slider.value), 'settings-opacity-slider-input');
                updateHdrSubtitleOpacityControlDisplay(container);
            });
            slider.addEventListener('change', function () {
                setHdrSubtitleOpacity(percentToOpacity(slider.value), 'settings-opacity-slider-change');
                updateHdrSubtitleOpacityControlDisplay(container);
            });
            slider.setAttribute('data-webos-init', 'true');
        }

        updateHdrSubtitleOpacityControlDisplay(container);
    }

    function ensureWebOSSettingsControls() {
        var settingsAnchor = getPlaybackSettingsAnchor();
        if (!settingsAnchor) {
            return false;
        }

        var hdrDimContainer = getControlContainerBySelector('.webosHdrUiDimSlider');
        var hdrSubtitleOpacityContainer = getControlContainerBySelector('.webosHdrSubtitleOpacitySlider');
        var assRenderAheadContainer = getControlContainerBySelector('.chkWebOSDisableAssRenderAhead');
        var dropAssAnimationsContainer = getControlContainerBySelector('.chkWebOSDropAssAnimations');
        var diagnosticsContainer = getControlContainerBySelector('.chkWebOSPlaybackDiagnostics');

        if (!hdrDimContainer) {
            hdrDimContainer = createHdrUiDimControlContainer();
            insertControlAfter(settingsAnchor, hdrDimContainer);
        }

        if (!hdrSubtitleOpacityContainer) {
            hdrSubtitleOpacityContainer = createHdrSubtitleOpacityControlContainer();
            insertControlAfter(hdrDimContainer || settingsAnchor, hdrSubtitleOpacityContainer);
        }

        if (!assRenderAheadContainer) {
            assRenderAheadContainer = createWebOSCheckboxControlContainer(
                'chkWebOSDisableAssRenderAhead',
                'webOS: Disable ASS render-ahead',
                'Disables Jellyfin/libass-wasm one-shot prerender cache on webOS. This avoids cached ASS animation frames being replayed out of sync. Restart playback after changing.'
            );
            insertControlAfter(hdrSubtitleOpacityContainer || hdrDimContainer || settingsAnchor, assRenderAheadContainer);
        }

        if (!dropAssAnimationsContainer) {
            dropAssAnimationsContainer = createWebOSCheckboxControlContainer(
                'chkWebOSDropAssAnimations',
                'webOS: Drop ASS animations',
                'Last-resort compatibility mode for very heavy ASS tracks. Removes animated ASS effects after playback restart.'
            );
            insertControlAfter(assRenderAheadContainer || hdrSubtitleOpacityContainer || hdrDimContainer || settingsAnchor, dropAssAnimationsContainer);
        }

        if (!diagnosticsContainer) {
            diagnosticsContainer = createWebOSCheckboxControlContainer(
                'chkWebOSPlaybackDiagnostics',
                'webOS: Playback diagnostics overlay',
                'Shows rAF, video-frame callback, video quality, and timing data on top of playback.'
            );
            insertControlAfter(dropAssAnimationsContainer || assRenderAheadContainer || hdrSubtitleOpacityContainer || hdrDimContainer || settingsAnchor, diagnosticsContainer);
        }

        var assRenderAheadCheckbox = document.querySelector('.chkWebOSDisableAssRenderAhead');
        var dropAssAnimationsCheckbox = document.querySelector('.chkWebOSDropAssAnimations');
        var diagnosticsCheckbox = document.querySelector('.chkWebOSPlaybackDiagnostics');

        if (assRenderAheadCheckbox) {
            assRenderAheadCheckbox.checked = !!disableAssRenderAhead;
            if (assRenderAheadCheckbox.getAttribute('data-webos-init') !== 'true') {
                assRenderAheadCheckbox.addEventListener('change', function () {
                    setDisableAssRenderAhead(assRenderAheadCheckbox.checked, 'settings-page');
                });
                assRenderAheadCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (dropAssAnimationsCheckbox) {
            dropAssAnimationsCheckbox.checked = !!dropAssAnimations;
            if (dropAssAnimationsCheckbox.getAttribute('data-webos-init') !== 'true') {
                dropAssAnimationsCheckbox.addEventListener('change', function () {
                    setDropAssAnimations(dropAssAnimationsCheckbox.checked, 'settings-page');
                });
                dropAssAnimationsCheckbox.setAttribute('data-webos-init', 'true');
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

        initializeHdrUiDimControl(hdrDimContainer);
        initializeHdrSubtitleOpacityControl(hdrSubtitleOpacityContainer);
        return true;
    }

    function runScheduledSettingsEnsure() {
        settingsEnsureTimer = null;
        settingsEnsureScheduled = false;
        var hasPlaybackSettingsAnchor = ensureWebOSSettingsControls();

        if (document.querySelector('.webosHdrUiDimSlider')
            && document.querySelector('.webosHdrSubtitleOpacitySlider')
            && document.querySelector('.chkWebOSDisableAssRenderAhead')
            && document.querySelector('.chkWebOSDropAssAnimations')
            && document.querySelector('.chkWebOSPlaybackDiagnostics')) {
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

        settingsEnsureScheduled = true;
        settingsEnsureTimer = setTimeout(runScheduledSettingsEnsure, typeof delay === 'number' ? delay : 0);
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

    function hasInjectedWebOSSettingsControls() {
        return !!(document.querySelector('.webosHdrUiDimSlider')
            || document.querySelector('.webosHdrSubtitleOpacitySlider')
            || document.querySelector('.chkWebOSDisableAssRenderAhead')
            || document.querySelector('.chkWebOSDropAssAnimations')
            || document.querySelector('.chkWebOSPlaybackDiagnostics'));
    }

    function elementMatchesSelector(element, selector) {
        if (!element || element.nodeType !== 1) {
            return false;
        }

        var matches = element.matches || element.webkitMatchesSelector || element.msMatchesSelector;
        return !!(matches && matches.call(element, selector));
    }

    function isPlaybackSettingsMutationNode(node) {
        var selector = '.fldEnableDts,.chkEnableDts,.fldEnableTrueHd,.chkEnableTrueHd,#selectPreferredTranscodeVideoCodec,#selectAllowedAudioChannels';
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

    function shouldScheduleSettingsInjectionFromMutations(mutations) {
        if (hasPlaybackSettingsDom() || hasInjectedWebOSSettingsControls()) {
            return true;
        }

        if (mutationListHasPlaybackSettingsNode(mutations)) {
            return true;
        }

        if (isLikelyPlaybackSettingsRoute()) {
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
        scheduleSettingsEnsureControls(true);
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

    function getMenuItemBitrate(item) {
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

        var text = item.textContent || '';
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

            if (/\d+(?:\.\d+)?\s*(m(?:bps|bit\/s|b\/s)|k(?:bps|bit\/s|b\/s))/i.test(menuItems[i].textContent || '')) {
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

    function scheduleHdrUiInfoScan(delay) {
        if (hdrUiInfoScanTimer || playbackState !== PlaybackState.PLAYING) {
            return;
        }

        hdrUiInfoScanTimer = setTimeout(function () {
            hdrUiInfoScanTimer = null;
            if (playbackState !== PlaybackState.PLAYING) {
                return;
            }

            var hint = getDynamicRangeHintFromPlaybackUi();
            if (hint !== 'unknown') {
                setPlaybackDynamicRange(hint, 'playback-ui');
            } else {
                refreshHdrUiDimming('playback-ui-scan');
            }
        }, typeof delay === 'number' ? delay : 0);
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

        return normalized.indexOf('hdr10+') !== -1
            || normalized.indexOf('hdr10') !== -1
            || normalized.indexOf('dolby vision') !== -1
            || normalized.indexOf('dolbyvision') !== -1
            || normalized.indexOf('dovi') !== -1
            || normalized.indexOf('hlg') !== -1
            || normalized === 'hdr';
    }

    function isSdrDynamicRangeText(value) {
        var normalized = normalizeDynamicRangeText(value);
        if (!normalized) {
            return false;
        }

        return normalized.indexOf('standard dynamic range') !== -1
            || /(^|[^a-z0-9])sdr([^a-z0-9]|$)/i.test(normalized);
    }

    function getDynamicRangeHintFromMediaInfo(mediaInfo) {
        if (!mediaInfo || typeof mediaInfo !== 'object') {
            return 'unknown';
        }

        var keysToInspect = [
            'videoRangeType',
            'VideoRangeType',
            'dynamicRange',
            'DynamicRange',
            'videoDoViTitle',
            'VideoDoViTitle',
            'videoDoViProfile',
            'VideoDoViProfile',
            'colorTransfer',
            'ColorTransfer'
        ];
        var sawSdr = false;

        for (var i = 0; i < keysToInspect.length; i++) {
            var key = keysToInspect[i];
            if (!Object.prototype.hasOwnProperty.call(mediaInfo, key)) {
                continue;
            }

            var value = mediaInfo[key];
            if (isHdrDynamicRangeText(value)) {
                return 'hdr';
            }
            if (isSdrDynamicRangeText(value)) {
                sawSdr = true;
            }
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function getDynamicRangeHintFromPlaybackUi() {
        if (!document || !document.querySelectorAll) {
            return 'unknown';
        }

        var selectors = [
            '.osdSecondaryMediaInfo',
            '.osdMediaInfo',
            '.osdMediaStatus',
            '.upNextDialog-mediainfo',
            '.upNextDialog-title',
            '.videoOsdBottom .osdTextContainer'
        ];
        var sawSdr = false;

        for (var i = 0; i < selectors.length; i++) {
            var elements = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < elements.length; j++) {
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
        return Object.prototype.toString.call(value) === '[object Array]' ? value : [];
    }

    function getDynamicRangeHintFromVideoStream(videoStream) {
        if (!videoStream || typeof videoStream !== 'object') {
            return 'unknown';
        }

        var fields = [
            videoStream.VideoRangeType,
            videoStream.VideoDoViTitle,
            videoStream.VideoDoViProfile,
            videoStream.VideoDoViLevel,
            videoStream.ColorTransfer,
            videoStream.ColorPrimaries,
            videoStream.Title
        ];

        var sawSdr = false;
        for (var i = 0; i < fields.length; i++) {
            var fieldValue = fields[i];
            if (isHdrDynamicRangeText(fieldValue)) {
                return 'hdr';
            }
            if (isSdrDynamicRangeText(fieldValue)) {
                sawSdr = true;
            }
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function getDynamicRangeHintFromItem(item) {
        if (!item || typeof item !== 'object') {
            return 'unknown';
        }

        var fields = [
            item.VideoRangeType,
            item.VideoDoViTitle,
            item.VideoDoViProfile,
            item.VideoDoViLevel,
            item.VideoType
        ];

        var sawSdr = false;
        for (var i = 0; i < fields.length; i++) {
            var value = fields[i];
            if (isHdrDynamicRangeText(value)) {
                return 'hdr';
            }
            if (isSdrDynamicRangeText(value)) {
                sawSdr = true;
            }
        }

        var mediaStreams = toArray(item.MediaStreams);
        for (var j = 0; j < mediaStreams.length; j++) {
            var stream = mediaStreams[j];
            if (!stream || (stream.Type && stream.Type.toString().toLowerCase() !== 'video')) {
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

        var mediaSources = toArray(item.MediaSources);
        for (var k = 0; k < mediaSources.length; k++) {
            var mediaSource = mediaSources[k];
            if (!mediaSource || typeof mediaSource !== 'object') {
                continue;
            }

            if (isHdrDynamicRangeText(mediaSource.VideoType)) {
                return 'hdr';
            }
            if (isSdrDynamicRangeText(mediaSource.VideoType)) {
                sawSdr = true;
            }

            var sourceStreams = toArray(mediaSource.MediaStreams);
            for (var m = 0; m < sourceStreams.length; m++) {
                var sourceStream = sourceStreams[m];
                if (!sourceStream || (sourceStream.Type && sourceStream.Type.toString().toLowerCase() !== 'video')) {
                    continue;
                }

                var sourceHint = getDynamicRangeHintFromVideoStream(sourceStream);
                if (sourceHint === 'hdr') {
                    return 'hdr';
                }
                if (sourceHint === 'sdr') {
                    sawSdr = true;
                }
            }
        }

        return sawSdr ? 'sdr' : 'unknown';
    }

    function getCurrentApiClient() {
        var apiClient = window.ApiClient;
        if (apiClient && typeof apiClient.getItem === 'function') {
            return apiClient;
        }
        return null;
    }

    function fetchDynamicRangeHintForItemId(itemId) {
        if (!itemId) {
            return Promise.resolve('unknown');
        }

        itemId = itemId.toString();
        if (Object.prototype.hasOwnProperty.call(mediaItemDynamicRangeCache, itemId)) {
            return Promise.resolve(mediaItemDynamicRangeCache[itemId]);
        }

        if (mediaItemDynamicRangeInFlight[itemId]) {
            return mediaItemDynamicRangeInFlight[itemId];
        }

        var apiClient = getCurrentApiClient();
        if (!apiClient) {
            return Promise.resolve('unknown');
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
            return Promise.resolve('unknown');
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
            return Promise.resolve('unknown');
        }

        mediaItemDynamicRangeInFlight[itemId] = request.then(function (item) {
            var hint = getDynamicRangeHintFromItem(item);
            mediaItemDynamicRangeCache[itemId] = hint;
            return hint;
        }, function (error) {
            debugLog('Unable to fetch item metadata for dynamic range detection:', error);
            return 'unknown';
        }).then(function (hint) {
            delete mediaItemDynamicRangeInFlight[itemId];
            return hint;
        });

        return mediaItemDynamicRangeInFlight[itemId];
    }

    function setCurrentPlaybackItemId(itemId, reason) {
        var normalizedItemId = itemId ? itemId.toString() : null;

        if (currentMediaSessionItemId === normalizedItemId) {
            return;
        }

        currentMediaSessionItemId = normalizedItemId;
        if (normalizedItemId) {
            setPlaybackDynamicRange('unknown', reason || 'item-changed');
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

        var pattern = new RegExp('[?&]' + escapeRegExp(name) + '=([^&#]*)', 'i');
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
        var pattern = new RegExp('([?&])' + escapeRegExp(encodedName) + '=.*?(?=&|$)', 'i');

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

        if (!shouldForcePlaybackStartMaxBitrate()) {
            return {
                url: url,
                targetBitrate: 0
            };
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
        updatedUrl = setQueryParameterValue(updatedUrl, 'maxStreamingBitrate', targetBitrate);
        markPlaybackStartMaxBitrateForced(source, targetBitrate);

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
        var keys = ['MaxStreamingBitrate', 'maxStreamingBitrate'];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var currentBitrate = parsePositiveInteger(value[key]);
            if (currentBitrate < normalizedTarget) {
                value[key] = normalizedTarget;
                changed = true;
                debugLog('Patched PlaybackInfo body bitrate (' + source + ', ' + key + '): ' + currentBitrate + ' -> ' + normalizedTarget);
            }
        }

        var nestedKeys = ['PlaybackInfo', 'playbackInfo', 'PlaybackInfoDto', 'playbackInfoDto'];
        for (var j = 0; j < nestedKeys.length; j++) {
            if (patchPlaybackInfoBitrateObject(value[nestedKeys[j]], normalizedTarget, source)) {
                changed = true;
            }
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

                if (!patchPlaybackInfoBitrateObject(parsed, normalizedTarget, source)) {
                    return body;
                }
                return JSON.stringify(parsed);
            } catch (error) {
                return body;
            }
        }

        if (typeof body === 'object') {
            patchPlaybackInfoBitrateObject(body, normalizedTarget, source);
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

    function getDynamicRangeHintFromPlaybackInfoPayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return 'unknown';
        }

        var hint = getDynamicRangeHintFromItem(payload.NowPlayingItem);
        if (hint !== 'unknown') {
            return hint;
        }

        hint = getDynamicRangeHintFromItem(payload.Item);
        if (hint !== 'unknown') {
            return hint;
        }

        hint = getDynamicRangeHintFromItem({
            MediaSources: payload.MediaSources,
            MediaStreams: payload.MediaStreams,
            VideoRangeType: payload.VideoRangeType,
            VideoDoViTitle: payload.VideoDoViTitle,
            VideoDoViProfile: payload.VideoDoViProfile,
            VideoType: payload.VideoType
        });
        if (hint !== 'unknown') {
            return hint;
        }

        return getDynamicRangeHintFromItem(payload);
    }

    function applyDynamicRangeFromPlaybackInfo(payload, sourceUrl, reason) {
        if (!isPlaybackInfoUrl(sourceUrl)) {
            return;
        }

        var itemId = extractItemIdFromPlaybackInfoUrl(sourceUrl);
        if (itemId) {
            setCurrentPlaybackItemId(itemId, 'item-changed-playbackinfo');
        }

        var hint = getDynamicRangeHintFromPlaybackInfoPayload(payload);
        if (hint !== 'unknown') {
            setPlaybackDynamicRange(hint, reason || 'playbackinfo');
        }
    }

    function inspectPlaybackInfoFetchResult(fetchResult, url) {
        if (!isPlaybackInfoUrl(url) || !fetchResult || typeof fetchResult.then !== 'function') {
            return fetchResult;
        }

        return fetchResult.then(function (response) {
            try {
                if (response && typeof response.clone === 'function') {
                    response.clone().json().then(function (payload) {
                        applyDynamicRangeFromPlaybackInfo(payload, url, 'playbackinfo-fetch');
                    }, function () {
                        // Ignore payload parse errors.
                    });
                }
            } catch (error) {
                debugLog('Failed to inspect fetch PlaybackInfo response:', error);
            }
            return response;
        });
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

                var requestArgs = arguments;
                if (isPlaybackInfoUrl(url)) {
                    var enforcedFetchBitrate = enforcePlaybackInfoMaxBitrateUrl(url, 'fetch');
                    var nextInput = input;
                    var nextInit = init;
                    var responseUrl = enforcedFetchBitrate.url;
                    var urlWasRewritten = enforcedFetchBitrate.url !== url;

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
                            return inspectPlaybackInfoFetchResult(originalFetch.apply(fetchThis, asyncRequestArgs), responseUrl);
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

                return inspectPlaybackInfoFetchResult(originalFetch.apply(this, requestArgs), url);
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
                    }

                    this.__webOsPlaybackInfoUrl = requestUrl;
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

                    if (isPlaybackInfoUrl(this.__webOsPlaybackInfoUrl) && this.addEventListener) {
                        this.addEventListener('loadend', function () {
                            try {
                                if (this.status && (this.status < 200 || this.status >= 300)) {
                                    return;
                                }
                                if (!this.responseText) {
                                    return;
                                }

                                var payload = JSON.parse(this.responseText);
                                applyDynamicRangeFromPlaybackInfo(payload, this.__webOsPlaybackInfoUrl, 'playbackinfo-xhr');
                            } catch (error) {
                                // Ignore JSON parse errors.
                            }
                        });
                    }

                    return originalXhrSend.apply(this, sendArgs);
                };
            }
        }
    }

    function refreshHdrUiDimming(reason) {
        if (!document.body) {
            return;
        }

        var shouldDim = playbackState === PlaybackState.PLAYING && playbackDynamicRange === 'hdr';
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

        if (playbackDynamicRange === nextRange) {
            return;
        }

        var previousRange = playbackDynamicRange;
        playbackDynamicRange = nextRange;
        debugLog('Playback dynamic range: ' + previousRange + ' -> ' + nextRange + ' (' + reason + ')');
        refreshHdrUiDimming('dynamic-range');
    }

    function initHdrUiInfoObserver() {
        if (hdrUiInfoObserver || !window.MutationObserver) {
            return;
        }

        hdrUiInfoObserver = new MutationObserver(function () {
            scheduleHdrUiInfoScan(120);
        });
    }

    function setHdrUiInfoObserverEnabled(enabled) {
        if (!window.MutationObserver) {
            return;
        }

        if (!hdrUiInfoObserver) {
            initHdrUiInfoObserver();
        }

        if (!hdrUiInfoObserver) {
            return;
        }

        if (enabled) {
            if (!hdrUiInfoObserverActive) {
                var targetNode = document.body || document.documentElement;
                if (targetNode) {
                    hdrUiInfoObserver.observe(targetNode, {
                        childList: true,
                        subtree: true,
                        characterData: true
                    });
                    hdrUiInfoObserverActive = true;
                }
            }

            scheduleHdrUiInfoScan(0);
            setTimeout(function () {
                scheduleHdrUiInfoScan(0);
            }, 400);
            return;
        }

        if (hdrUiInfoObserverActive) {
            hdrUiInfoObserver.disconnect();
            hdrUiInfoObserverActive = false;
        }

        clearHdrUiInfoScanTimer();
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

    function patchDirectPlayProfilesForProblematicFormats(profile) {
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
            debugLog('Patched direct play profile(s) for DVD/MPEG compatibility. patched=' + patchedProfiles + ', removed=' + removedProfiles);
        }
    }

    function patchH264InterlaceSupport(profile) {
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
            debugLog('Added non-interlaced H264 condition to codec profile(s):', patchedCodecProfiles);
        }
    }

    function applyPlaybackCompatibilityProfilePatches(profile) {
        if (!profile || typeof profile !== 'object') {
            return profile;
        }

        patchDirectPlayProfilesForProblematicFormats(profile);
        patchH264InterlaceSupport(profile);
        return profile;
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
                return Promise.resolve(AppInfo);
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
            setCurrentPlaybackItemId(itemId, 'item-changed');

            var dynamicRangeHint = getDynamicRangeHintFromMediaInfo(mediaInfo);
            if (dynamicRangeHint !== 'unknown') {
                setPlaybackDynamicRange(dynamicRangeHint, 'media-session');
            }

            if (itemId) {
                fetchDynamicRangeHintForItemId(itemId).then(function (itemHint) {
                    if (currentMediaSessionItemId !== itemId) {
                        return;
                    }

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
    syncPgsRenderGuard();
    initAssScriptInterception();
    initAssRendererInterception();
    applyHdrUiDimSettings();
    emitFeatureOverridesChanged();
    initWebOSSettingsInjection();
    initQualityMenuPatching();
    setQualityMenuObserverEnabled(true);
    initPlaybackInfoInterception();
    initHdrUiInfoObserver();
    setHdrUiInfoObserverEnabled(false);
    updatePlaybackDiagnosticsOverlay();
    refreshHdrUiDimming('init');
})(window.AppInfo, window.DeviceInfo, window.WebOSFeatureOverrides);
