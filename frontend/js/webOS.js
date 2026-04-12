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
    var QUALITY_MENU_EXTRA_BITRATES = [120000000, 100000000, 80000000];
    var QUALITY_MENU_LEGACY_CAP_BITRATE = 60000000;
    var PLAYBACK_INFO_MAX_BITRATE_PARAM = 'MaxStreamingBitrate';
    var PLAYBACK_START_MAX_BITRATE_FORCE_WINDOW_MS = 15000;
    var PLAYBACK_START_MAX_BITRATE_FORCE_REQUEST_LIMIT = 8;
    var forcePlaybackStartMaxBitrateUntil = 0;
    var forcePlaybackStartMaxBitrateRequestsLeft = 0;
    var dtsSettingsObserver = null;
    var dtsSettingsObserverActive = false;
    var dtsEnsureTimer = null;
    var dtsEnsureScheduled = false;
    var dtsEnsureAttemptsLeft = 0;
    var DTS_SETTINGS_RETRY_DELAY = 250;
    var DTS_SETTINGS_MAX_RETRIES = 20;
    var DTS_OVERRIDE_DECODE_KEY = 'webos_force_dts_decode';
    var DTS_OVERRIDE_PASSTHROUGH_KEY = 'webos_force_dts_passthrough';
    var HDR_UI_DIM_BRIGHTNESS_KEY = 'webos_hdr_ui_dim_brightness';
    var HDR_UI_DIM_DEFAULT_BRIGHTNESS = 0.3;
    var HDR_UI_DIM_MIN_BRIGHTNESS = 0.05;
    var HDR_UI_DIM_MAX_BRIGHTNESS = 1;
    var HDR_UI_DIM_MIN_PERCENT = Math.round(HDR_UI_DIM_MIN_BRIGHTNESS * 100);
    var HDR_UI_DIM_MAX_PERCENT = Math.round(HDR_UI_DIM_MAX_BRIGHTNESS * 100);
    var HDR_UI_DIM_DEFAULT_PERCENT = Math.round(HDR_UI_DIM_DEFAULT_BRIGHTNESS * 100);
    var forceDtsDecode = !!(featureOverrides && featureOverrides.forceDtsDecode);
    var forceDtsPassthrough = !!(featureOverrides && featureOverrides.forceDtsPassthrough);
    var hdrUiDimBrightness = HDR_UI_DIM_DEFAULT_BRIGHTNESS;
    var HDR_UI_DIM_CLASS = 'webos-hdr-ui-dim';
    var playbackDynamicRange = 'unknown';
    var hdrUiInfoObserver = null;
    var hdrUiInfoObserverActive = false;
    var hdrUiInfoScanTimer = null;
    var currentMediaSessionItemId = null;
    var mediaItemDynamicRangeCache = {};
    var mediaItemDynamicRangeInFlight = {};
    var playbackInfoInterceptionInitialized = false;

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
        if (playbackState !== PlaybackState.PLAYING) {
            return false;
        }

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
        setQualityMenuObserverEnabled(nextState === PlaybackState.PLAYING);
        setHdrUiInfoObserverEnabled(nextState === PlaybackState.PLAYING);
        if (nextState === PlaybackState.PLAYING && previousState !== PlaybackState.PLAYING) {
            startPlaybackStartMaxBitrateForce('playback-start');
        }
        if (nextState !== PlaybackState.PLAYING) {
            clearPlaybackStartMaxBitrateForce('playback-state-change');
        }

        if (nextState === PlaybackState.IDLE) {
            setCurrentPlaybackItemId(null);
            setPlaybackDynamicRange('unknown', 'playback-idle');
        } else {
            refreshHdrUiDimming('playback-state');
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

    function applyForcedDtsPassthroughSetting() {
        try {
            if (window.localStorage) {
                localStorage.setItem('enableDts', forceDtsPassthrough ? 'true' : 'false');
            }
        } catch (error) {
            console.warn('Failed to persist DTS passthrough override:', error);
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

    function brightnessToPercent(value) {
        return Math.round(clampHdrUiDimBrightness(value) * 100);
    }

    function percentToBrightness(value) {
        var parsedPercent = parseStoredNumber(value, HDR_UI_DIM_DEFAULT_PERCENT, HDR_UI_DIM_MIN_PERCENT, HDR_UI_DIM_MAX_PERCENT);
        return clampHdrUiDimBrightness(parsedPercent / 100);
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

    function formatHdrUiDimBrightness(value) {
        return clampHdrUiDimBrightness(value).toFixed(2);
    }

    function formatHdrUiDimPercentage(value) {
        return brightnessToPercent(value).toString() + '%';
    }

    function applyHdrUiDimSettings() {
        if (!document || !document.documentElement || !document.documentElement.style) {
            return;
        }

        document.documentElement.style.setProperty('--webos-hdr-ui-brightness', formatHdrUiDimBrightness(hdrUiDimBrightness));
        document.documentElement.style.setProperty('--webos-hdr-subtitle-brightness', formatHdrUiDimBrightness(getHdrSubtitleBrightness()));
        document.documentElement.style.setProperty('--webos-hdr-pgs-brightness', formatHdrUiDimBrightness(getHdrPgsOverlayBrightness()));
    }

    function loadPersistedHdrUiDimBrightness() {
        try {
            if (!window.localStorage) {
                hdrUiDimBrightness = clampHdrUiDimBrightness(hdrUiDimBrightness);
                return;
            }
            hdrUiDimBrightness = clampHdrUiDimBrightness(localStorage.getItem(HDR_UI_DIM_BRIGHTNESS_KEY));
        } catch (error) {
            hdrUiDimBrightness = clampHdrUiDimBrightness(hdrUiDimBrightness);
            console.warn('Failed to load persisted HDR UI dim brightness:', error);
        }
    }

    function savePersistedHdrUiDimBrightness() {
        try {
            if (!window.localStorage) {
                return;
            }
            localStorage.setItem(HDR_UI_DIM_BRIGHTNESS_KEY, formatHdrUiDimBrightness(hdrUiDimBrightness));
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

    function loadPersistedDtsOverrides() {
        try {
            if (!window.localStorage) {
                return;
            }
            forceDtsDecode = parseStoredBoolean(localStorage.getItem(DTS_OVERRIDE_DECODE_KEY), forceDtsDecode);
            forceDtsPassthrough = parseStoredBoolean(localStorage.getItem(DTS_OVERRIDE_PASSTHROUGH_KEY), forceDtsPassthrough);
        } catch (error) {
            console.warn('Failed to load persisted DTS overrides:', error);
        }
    }

    function savePersistedDtsOverrides() {
        try {
            if (!window.localStorage) {
                return;
            }
            localStorage.setItem(DTS_OVERRIDE_DECODE_KEY, forceDtsDecode ? 'true' : 'false');
            localStorage.setItem(DTS_OVERRIDE_PASSTHROUGH_KEY, forceDtsPassthrough ? 'true' : 'false');
        } catch (error) {
            console.warn('Failed to save persisted DTS overrides:', error);
        }
    }

    function emitFeatureOverridesChanged() {
        postMessage('WebOS.featureOverrides', {
            forceDtsDecode: !!forceDtsDecode,
            forceDtsPassthrough: !!forceDtsPassthrough
        });
    }

    function setDtsOverrides(decode, passthrough, reason) {
        var nextDecode = !!decode;
        var nextPassthrough = !!passthrough;

        if (forceDtsDecode === nextDecode && forceDtsPassthrough === nextPassthrough) {
            return;
        }

        forceDtsDecode = nextDecode;
        forceDtsPassthrough = nextPassthrough;
        savePersistedDtsOverrides();
        applyForcedDtsPassthroughSetting();
        debugLog('DTS override changed (' + reason + '): decode=' + forceDtsDecode + ', passthrough=' + forceDtsPassthrough);
        emitFeatureOverridesChanged();
    }

    function createDtsOverrideContainer(checkboxClassName, title, description) {
        var container = document.createElement('div');
        container.className = 'checkboxContainer checkboxContainer-withDescription webos-dts-override';
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
            '<div class="fieldDescription checkboxFieldDescription">Adjust overlay UI/subtitle brightness during HDR/Dolby Vision playback. Lower percentage = darker.</div>';
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
        if (!referenceNode || !referenceNode.parentNode || !controlNode) {
            return;
        }
        referenceNode.parentNode.insertBefore(controlNode, referenceNode.nextSibling);
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

    function ensureDtsOverrideControls() {
        var dtsContainer = document.querySelector('.fldEnableDts');
        if (!dtsContainer || !dtsContainer.parentNode) {
            return;
        }

        var decodeContainer = getControlContainerBySelector('.chkWebOSForceDtsDecode');
        var passthroughContainer = getControlContainerBySelector('.chkWebOSForceDtsPassthrough');
        var hdrDimContainer = getControlContainerBySelector('.webosHdrUiDimSlider');

        if (!decodeContainer) {
            decodeContainer = createDtsOverrideContainer(
                'chkWebOSForceDtsDecode',
                'webOS: Force DTS decode support (experimental)',
                'Forces client profile to report DTS decode capability. Can cause no-audio on unsupported TVs.'
            );
            insertControlAfter(dtsContainer, decodeContainer);
        }

        if (!passthroughContainer) {
            passthroughContainer = createDtsOverrideContainer(
                'chkWebOSForceDtsPassthrough',
                'webOS: Force DTS passthrough support (experimental)',
                'Forces DTS passthrough flag and persists DTS preference. Requires downstream device support.'
            );
            insertControlAfter(decodeContainer || dtsContainer, passthroughContainer);
        }

        if (!hdrDimContainer) {
            hdrDimContainer = createHdrUiDimControlContainer();
            insertControlAfter(passthroughContainer || decodeContainer || dtsContainer, hdrDimContainer);
        }

        var decodeCheckbox = document.querySelector('.chkWebOSForceDtsDecode');
        var passthroughCheckbox = document.querySelector('.chkWebOSForceDtsPassthrough');

        if (decodeCheckbox) {
            decodeCheckbox.checked = !!forceDtsDecode;
            if (decodeCheckbox.getAttribute('data-webos-init') !== 'true') {
                decodeCheckbox.addEventListener('change', function () {
                    setDtsOverrides(decodeCheckbox.checked, passthroughCheckbox ? passthroughCheckbox.checked : forceDtsPassthrough, 'settings-page');
                });
                decodeCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        if (passthroughCheckbox) {
            passthroughCheckbox.checked = !!forceDtsPassthrough;
            if (passthroughCheckbox.getAttribute('data-webos-init') !== 'true') {
                passthroughCheckbox.addEventListener('change', function () {
                    setDtsOverrides(decodeCheckbox ? decodeCheckbox.checked : forceDtsDecode, passthroughCheckbox.checked, 'settings-page');
                });
                passthroughCheckbox.setAttribute('data-webos-init', 'true');
            }
        }

        initializeHdrUiDimControl(hdrDimContainer);
    }

    function runScheduledDtsEnsure() {
        dtsEnsureTimer = null;
        dtsEnsureScheduled = false;
        ensureDtsOverrideControls();

        if (document.querySelector('.chkWebOSForceDtsDecode')
            && document.querySelector('.chkWebOSForceDtsPassthrough')
            && document.querySelector('.webosHdrUiDimSlider')) {
            dtsEnsureAttemptsLeft = 0;
            return;
        }

        if (dtsEnsureAttemptsLeft > 0) {
            dtsEnsureAttemptsLeft--;
            scheduleDtsEnsureControls(false, DTS_SETTINGS_RETRY_DELAY);
        }
    }

    function clearScheduledDtsEnsure() {
        if (dtsEnsureTimer) {
            clearTimeout(dtsEnsureTimer);
            dtsEnsureTimer = null;
        }
        dtsEnsureScheduled = false;
        dtsEnsureAttemptsLeft = 0;
    }

    function scheduleDtsEnsureControls(resetAttempts, delay) {
        if (resetAttempts) {
            dtsEnsureAttemptsLeft = DTS_SETTINGS_MAX_RETRIES;
        }

        if (dtsEnsureScheduled) {
            return;
        }

        dtsEnsureScheduled = true;
        dtsEnsureTimer = setTimeout(runScheduledDtsEnsure, typeof delay === 'number' ? delay : 0);
    }

    function isLikelyPlaybackSettingsRoute() {
        var hash = (window.location && window.location.hash ? window.location.hash.toLowerCase() : '');
        return hash.indexOf('settings') !== -1 || hash.indexOf('playback') !== -1;
    }

    function setDtsSettingsObserverEnabled(enabled) {
        if (!dtsSettingsObserver) {
            return;
        }

        if (enabled) {
            if (!dtsSettingsObserverActive) {
                var targetNode = document.body || document.documentElement;
                if (targetNode) {
                    dtsSettingsObserver.observe(targetNode, {
                        childList: true,
                        subtree: true
                    });
                    dtsSettingsObserverActive = true;
                }
            }
            scheduleDtsEnsureControls(true);
            return;
        }

        if (dtsSettingsObserverActive) {
            dtsSettingsObserver.disconnect();
            dtsSettingsObserverActive = false;
        }
        clearScheduledDtsEnsure();
    }

    function refreshDtsSettingsObserverState() {
        var shouldEnable = isLikelyPlaybackSettingsRoute()
            || !!document.querySelector('.fldEnableDts')
            || !!document.querySelector('.chkWebOSForceDtsDecode')
            || !!document.querySelector('.chkWebOSForceDtsPassthrough')
            || !!document.querySelector('.webosHdrUiDimSlider');

        setDtsSettingsObserverEnabled(shouldEnable);
    }

    function initDtsOverrideSettingsInjection() {
        if (dtsSettingsObserver || !window.MutationObserver) {
            return;
        }

        dtsSettingsObserver = new MutationObserver(function () {
            scheduleDtsEnsureControls(false);
        });

        window.addEventListener('hashchange', function () {
            refreshDtsSettingsObserverState();
        });

        refreshDtsSettingsObserverState();
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
        button.setAttribute('data-id', bitrate.toString());
        button.setAttribute('data-webos-added', 'true');

        var textElem = button.querySelector('.actionSheetItemText');
        if (textElem) {
            textElem.textContent = formatMbpsLabel(bitrate);
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

    function patchQualityActionSheet(dialog) {
        if (!dialog || dialog.getAttribute('data-webos-bitrate-patched') === 'true') {
            return false;
        }

        var menuItems = dialog.querySelectorAll('.actionSheetMenuItem[data-id]');
        if (!menuItems || !menuItems.length) {
            return false;
        }

        var hasBitrateStyleText = false;
        var hasLegacyCap = false;
        var bitrateIds = {};
        var templateButton = null;
        var autoButton = null;

        for (var i = 0; i < menuItems.length; i++) {
            var item = menuItems[i];
            var idText = item.getAttribute('data-id');
            var bitrate = parseInt(idText, 10);
            if (!isNaN(bitrate) && bitrate > 0) {
                bitrateIds[bitrate] = true;
                if (!templateButton) {
                    templateButton = item;
                }
                if (bitrate === QUALITY_MENU_LEGACY_CAP_BITRATE) {
                    hasLegacyCap = true;
                }
            } else if (idText === '0') {
                autoButton = item;
            }

            var itemTextElem = item.querySelector('.actionSheetItemText');
            var itemText = itemTextElem ? itemTextElem.textContent : '';
            if (itemText && (itemText.indexOf('Mbps') !== -1 || itemText.indexOf('kbps') !== -1)) {
                hasBitrateStyleText = true;
            }
        }

        if (!templateButton || !hasBitrateStyleText || !hasLegacyCap) {
            return false;
        }

        var scroller = dialog.querySelector('.actionSheetScroller');
        if (!scroller) {
            return false;
        }

        var insertRef = autoButton ? autoButton.nextSibling : templateButton;
        var added = 0;

        for (var j = 0; j < QUALITY_MENU_EXTRA_BITRATES.length; j++) {
            var extraBitrate = QUALITY_MENU_EXTRA_BITRATES[j];
            if (bitrateIds[extraBitrate]) {
                continue;
            }

            var extraButton = createBitrateOptionButton(templateButton, extraBitrate);
            scroller.insertBefore(extraButton, insertRef);
            added++;
        }

        if (added > 0) {
            debugLog('Added extra bitrate options for local network playback:', added);
        }

        dialog.setAttribute('data-webos-bitrate-patched', 'true');
        return true;
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

                    if (node.classList && node.classList.contains('actionSheet')) {
                        patchQualityActionSheet(node);
                    } else if (node.querySelectorAll) {
                        var dialogs = node.querySelectorAll('.actionSheet');
                        for (var k = 0; k < dialogs.length; k++) {
                            patchQualityActionSheet(dialogs[k]);
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

        if (!qualityMenuObserver) {
            initQualityMenuPatching();
        }

        if (!qualityMenuObserver) {
            return;
        }

        if (enabled) {
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

            var existingDialogs = document.querySelectorAll('.actionSheet');
            for (var i = 0; i < existingDialogs.length; i++) {
                patchQualityActionSheet(existingDialogs[i]);
            }
            return;
        }

        if (qualityMenuObserverActive) {
            qualityMenuObserver.disconnect();
            qualityMenuObserverActive = false;
        }
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
        if (!isPlaybackInfoUrl(url) || !shouldForcePlaybackStartMaxBitrate()) {
            return {
                url: url,
                targetBitrate: 0
            };
        }

        var existingBitrate = parsePositiveInteger(getQueryParameterValue(url, PLAYBACK_INFO_MAX_BITRATE_PARAM));
        var targetBitrate = getHighestKnownBitrateOption();
        if (existingBitrate > targetBitrate) {
            targetBitrate = existingBitrate;
        }

        var updatedUrl = setQueryParameterValue(url, PLAYBACK_INFO_MAX_BITRATE_PARAM, targetBitrate);
        markPlaybackStartMaxBitrateForced(source, targetBitrate);

        return {
            url: updatedUrl,
            targetBitrate: targetBitrate
        };
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

                var currentBitrate = parsePositiveInteger(parsed.MaxStreamingBitrate);
                if (currentBitrate >= normalizedTarget) {
                    return body;
                }

                parsed.MaxStreamingBitrate = normalizedTarget;
                debugLog('Patched PlaybackInfo body bitrate (' + source + '): ' + currentBitrate + ' -> ' + normalizedTarget);
                return JSON.stringify(parsed);
            } catch (error) {
                return body;
            }
        }

        if (typeof body === 'object') {
            var objectBitrate = parsePositiveInteger(body.MaxStreamingBitrate);
            if (objectBitrate < normalizedTarget) {
                body.MaxStreamingBitrate = normalizedTarget;
                debugLog('Patched PlaybackInfo body bitrate (' + source + '): ' + objectBitrate + ' -> ' + normalizedTarget);
            }
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

    function initPlaybackInfoInterception() {
        if (playbackInfoInterceptionInitialized) {
            return;
        }
        playbackInfoInterceptionInitialized = true;

        if (window.fetch) {
            var originalFetch = window.fetch;
            window.fetch = function () {
                var input = arguments.length ? arguments[0] : null;
                var init = arguments.length > 1 ? arguments[1] : null;
                var url = '';
                try {
                    url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                } catch (error) {
                    url = '';
                }

                var requestArgs = arguments;
                if (isPlaybackInfoUrl(url) && shouldForcePlaybackStartMaxBitrate()) {
                    var enforcedFetchBitrate = enforcePlaybackInfoMaxBitrateUrl(url, 'fetch');
                    var nextInput = input;
                    var nextInit = init;

                    if (enforcedFetchBitrate.url !== url) {
                        if (typeof input === 'string') {
                            nextInput = enforcedFetchBitrate.url;
                        } else if (typeof window.Request !== 'undefined' && input instanceof window.Request) {
                            try {
                                nextInput = new window.Request(enforcedFetchBitrate.url, input);
                            } catch (requestError) {
                                nextInput = enforcedFetchBitrate.url;
                            }
                        } else {
                            nextInput = enforcedFetchBitrate.url;
                        }
                        url = enforcedFetchBitrate.url;
                    }

                    if (enforcedFetchBitrate.targetBitrate && nextInit && typeof nextInit === 'object') {
                        nextInit = cloneShallowObject(nextInit);
                        nextInit.body = enforcePlaybackInfoMaxBitrateBody(nextInit.body, enforcedFetchBitrate.targetBitrate, 'fetch');
                    }

                    requestArgs = [nextInput];
                    if (arguments.length > 1 || nextInit) {
                        requestArgs.push(nextInit);
                    }
                }

                var fetchResult = originalFetch.apply(this, requestArgs);
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
                    if (isPlaybackInfoUrl(requestUrl) && shouldForcePlaybackStartMaxBitrate()) {
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
                    supportsDts: (forceDtsDecode || forceDtsPassthrough) ? true : null,
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
                    isSupported = playbackState === PlaybackState.PLAYING;
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
    loadPersistedDtsOverrides();
    loadPersistedHdrUiDimBrightness();
    applyForcedDtsPassthroughSetting();
    applyHdrUiDimSettings();
    emitFeatureOverridesChanged();
    initDtsOverrideSettingsInjection();
    initQualityMenuPatching();
    setQualityMenuObserverEnabled(false);
    initPlaybackInfoInterception();
    initHdrUiInfoObserver();
    setHdrUiInfoObserverEnabled(false);
    refreshHdrUiDimming('init');
})(window.AppInfo, window.DeviceInfo, window.WebOSFeatureOverrides);
