/* 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

(function(AppInfo, deviceInfo) {
    'use strict';

    console.log('WebOS adapter');
    var PlaybackState = {
        IDLE: 'idle',
        PLAYING: 'playing',
        EXITING: 'exiting'
    };
    var playbackState = PlaybackState.IDLE;
    var exitToIdleTimer = null;
    var EXIT_TO_IDLE_TIMEOUT = 2000;
    var HEADER_PIN_INTERVAL = 750;
    var MIN_HEADER_HEIGHT = 72;
    var headerPinTimer = null;
    var headerPinningInitialized = false;
    var qualityMenuObserver = null;

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

    function setPlaybackState(nextState, reason) {
        if (playbackState === nextState) {
            return;
        }

        var previousState = playbackState;
        playbackState = nextState;
        console.log('Playback state: ' + previousState + ' -> ' + nextState + ' (' + reason + ')');

        clearExitToIdleTimer();
        if (nextState === PlaybackState.EXITING) {
            exitToIdleTimer = setTimeout(function () {
                if (playbackState === PlaybackState.EXITING) {
                    setPlaybackState(PlaybackState.IDLE, 'exit-timeout');
                }
            }, EXIT_TO_IDLE_TIMEOUT);
        }

        if (nextState === PlaybackState.PLAYING && document.body) {
            document.body.style.paddingTop = '';
        } else {
            forceHeaderPinned();
        }
    }

    function getHeaderElement() {
        return document.querySelector('.skinHeader')
            || document.querySelector('.appHeader')
            || document.querySelector('.headerTabs');
    }

    function forceHeaderPinned() {
        if (playbackState === PlaybackState.PLAYING || !document.body) {
            return;
        }

        var header = getHeaderElement();
        if (!header) {
            return;
        }

        header.classList.remove('hide');
        header.classList.remove('hidden');
        header.classList.remove('skinHeader-hidden');
        header.style.position = 'fixed';
        header.style.top = '0';
        header.style.left = '0';
        header.style.right = '0';
        header.style.zIndex = '9999';
        header.style.transform = 'translateY(0)';
        header.style.opacity = '1';
        header.style.visibility = 'visible';

        var headerHeight = header.offsetHeight || MIN_HEADER_HEIGHT;
        if (headerHeight < MIN_HEADER_HEIGHT) {
            headerHeight = MIN_HEADER_HEIGHT;
        }

        document.documentElement.style.setProperty('--webos-header-offset', headerHeight + 'px');
        document.body.style.paddingTop = 'var(--webos-header-offset)';
    }

    function initHeaderPinning() {
        if (headerPinningInitialized) {
            return;
        }
        headerPinningInitialized = true;

        if (document.body) {
            document.body.classList.add('webos-force-header-pin');
        }

        window.addEventListener('scroll', forceHeaderPinned, true);
        window.addEventListener('resize', forceHeaderPinned);
        window.addEventListener('hashchange', function () {
            setTimeout(forceHeaderPinned, 0);
        });
        headerPinTimer = setInterval(forceHeaderPinned, HEADER_PIN_INTERVAL);
        forceHeaderPinned();
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
            return;
        }

        var menuItems = dialog.querySelectorAll('.actionSheetMenuItem[data-id]');
        if (!menuItems || !menuItems.length) {
            return;
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
                if (bitrate === 60000000) {
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
            return;
        }

        var scroller = dialog.querySelector('.actionSheetScroller');
        if (!scroller) {
            return;
        }

        var extraBitrates = [120000000, 100000000, 80000000];
        var insertRef = autoButton ? autoButton.nextSibling : templateButton;
        var added = 0;

        for (var j = 0; j < extraBitrates.length; j++) {
            var extraBitrate = extraBitrates[j];
            if (bitrateIds[extraBitrate]) {
                continue;
            }

            var extraButton = createBitrateOptionButton(templateButton, extraBitrate);
            scroller.insertBefore(extraButton, insertRef);
            added++;
        }

        if (added > 0) {
            console.log('Added extra bitrate options for local network playback:', added);
        }

        dialog.setAttribute('data-webos-bitrate-patched', 'true');
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

        qualityMenuObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true
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
                return profileBuilder({
                    enableMkvProgressive: false,
                    enableSsaRender: true,
                    supportsDolbyAtmos: deviceInfo ? deviceInfo.dolbyAtmos : null,
                    supportsDolbyVision: deviceInfo ? deviceInfo.dolbyVision : null,
                    supportsHdr10: deviceInfo ? deviceInfo.hdr10 : null
                });
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
            postMessage('updateMediaSession', { mediaInfo: mediaInfo });
        },

        hideMediaSession: function () {
            setPlaybackState(PlaybackState.IDLE, 'hide-media-session');
            postMessage('hideMediaSession');
        }
    };

    initHeaderPinning();
    initQualityMenuPatching();
})(window.AppInfo, window.DeviceInfo);
