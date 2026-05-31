/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var curr_req = false;
var server_info = false;
var manifest = false;

var appInfo = {
    deviceId: null,
    deviceName: 'LG Smart TV',
    appName: 'Jellyfin for WebOS',
    appVersion: '0.0.0'
};
var featureOverrideStorageKey = 'feature_overrides';
var DEBUG_LOG = false;

function debugLog() {
    if (!DEBUG_LOG || !window.console || !console.log) {
        return;
    }
    console.log.apply(console, arguments);
}

function debugJsonLog(prefix, data) {
    if (!DEBUG_LOG) {
        return;
    }

    var serialized = '';
    try {
        serialized = JSON.stringify(data);
    } catch (error) {
        serialized = '[unserializable]';
    }

    debugLog(prefix, serialized);
}

var deviceInfo;
var deviceInfoReady = false;
var deviceInfoCallbacks = [];

function flushDeviceInfoCallbacks() {
    var callbacks = deviceInfoCallbacks;
    deviceInfoCallbacks = [];

    for (var i = 0; i < callbacks.length; i++) {
        callbacks[i](deviceInfo);
    }
}

function waitForDeviceInfo(callback) {
    if (deviceInfoReady) {
        callback(deviceInfo);
        return;
    }

    deviceInfoCallbacks.push(callback);
}

webOS.deviceInfo(function (info) {
    deviceInfo = info;
    deviceInfoReady = true;
    flushDeviceInfoCallbacks();
});

//Adds .includes to string to do substring matching
if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    'use strict';

    if (search instanceof RegExp) {
      throw TypeError('first argument must not be a RegExp');
    }
    if (start === undefined) { start = 0; }
    return this.indexOf(search, start) !== -1;
  };
}


function isVisible(element) {
    return element.offsetWidth > 0 && element.offsetHeight > 0;
}

function findIndex(array, currentNode) {
    //This just implements the following function which is not available on some LG TVs
    //Array.from(allElements).findIndex(function (el) { return currentNode.isEqualNode(el); })
    for (var i = 0, item; item = array[i]; i++) {
        if (currentNode.isEqualNode(item))
            return i;
    }
    return -1;
}

function navigate(amount) {
    debugLog("Navigating " + amount.toString() + "...")
    var element = document.activeElement;
    if (element === null) {
        navigationInit();
    } else if (!isVisible(element) || element.tagName == 'BODY') {
        navigationInit();
    } else {
        //Isolate the node that we're after
        const currentNode = element;

        //find all tab-able elements
        const allElements = document.querySelectorAll('input, button, a, area, object, select, textarea, [contenteditable]');

        //Find the current tab index.
        const currentIndex = findIndex(allElements, currentNode);
        if (currentIndex < 0) {
            navigationInit();
            return;
        }

        //focus the following element, clamped to the list bounds so the
        //first/last element does not dead-end focus
        var nextIndex = currentIndex + amount;
        if (nextIndex < 0) {
            nextIndex = 0;
        } else if (nextIndex > allElements.length - 1) {
            nextIndex = allElements.length - 1;
        }
        if (allElements[nextIndex])
            allElements[nextIndex].focus();
    }
}


function upArrowPressed() {
    navigate(-1);
}

function downArrowPressed() {
    navigate(1);
}
function leftArrowPressed() {
    // Your stuff here
}

function rightArrowPressed() {
    // Your stuff here
}

function backPressed() {
    webOS.platformBack();
}

document.onkeydown = function (evt) {
    evt = evt || window.event;
    switch (evt.keyCode) {
        case 37:
            leftArrowPressed();
            break;
        case 39:
            rightArrowPressed();
            break;
        case 38:
            upArrowPressed();
            break;
        case 40:
            downArrowPressed();
            break;
        case 461: // Back
            backPressed();
            break;
    }
};

function handleCheckbox(elem, evt) {
    debugLog(elem);
    if (evt === true) {
        return true; // webos should be capable of toggling the checkbox by itself
    } else {
        evt = evt || window.event; //keydown event
        if (evt.keyCode == 13 || evt.keyCode == 32) { //OK button or Space
            elem.checked = !elem.checked;
        }
    }
    return false;
}

// Similar to jellyfin-web
function generateDeviceId() {
    return btoa([navigator.userAgent, new Date().getTime()].join('|')).replace(/=/g, '1');
}

function getDeviceId() {
    // Use variable '_deviceId2' to mimic jellyfin-web

    var deviceId = storage.get('_deviceId2');

    if (!deviceId) {
        deviceId = generateDeviceId();
        storage.set('_deviceId2', deviceId);
    }

    return deviceId;
}

function navigationInit() {
    if (isVisible(document.querySelector('#connect'))) {
        document.querySelector('#connect').focus()
    } else if (isVisible(document.querySelector('#abort'))) {
        document.querySelector('#abort').focus()
    }
}

function getEffectiveFeatureOverrides() {
    return storage.get(featureOverrideStorageKey) || {};
}

// Only persist the known feature-override flags posted by the content frame,
// coerced to booleans, so a compromised page cannot inject arbitrary state.
function sanitizeFeatureOverrides(data) {
    var allowed = [
        'playbackDiagnosticsEnabled',
        'disableAssRenderAhead',
        'assTimeSyncFixEnabled',
        'pgsForceMainThread',
        'pgsPatchObjectReuse',
        'lpcmAudioCopyEnabled'
    ];
    var result = {};
    if (data && typeof data === 'object') {
        for (var i = 0; i < allowed.length; i++) {
            var key = allowed[i];
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                result[key] = !!data[key];
            }
        }
    }
    return result;
}

function Init() {
    appInfo.deviceId = getDeviceId();

    webOS.fetchAppInfo(function (info) {
        if (info) {
            appInfo.appVersion = info.version;
        } else {
            console.error('Error occurs while getting appinfo.json.');
        }
    });

    navigationInit();

    if (storage.exists('connected_servers')) {
        connected_servers = getConnectedServers();
        var serverKeys = Object.keys(connected_servers);
        if (serverKeys.length > 0) {
            var first_server = connected_servers[serverKeys[0]];
            document.querySelector('#baseurl').value = first_server.baseurl;
            document.querySelector('#auto_connect').checked = first_server.auto_connect;
            if (window.performance && window.performance.navigation.type == window.performance.navigation.TYPE_BACK_FORWARD) {
                debugLog('Got here using the browser "Back" or "Forward" button, inhibiting auto connect.');
            } else {
                if (first_server.auto_connect) {
                    debugLog("Auto connecting...");
                    handleServerSelect();
                }
            }
        }
        renderServerList(connected_servers);
    }
}
// Just ensure that the string has no spaces, and begins with either http:// or https:// (case insensitively), and isn't empty after the ://
function validURL(str) {
    var pattern = /^https?:\/\/\S+$/i;
    return !!pattern.test(str);
}

function normalizeUrl(url) {
    url = url.trimLeft ? url.trimLeft() : url.trimStart();
    if (url.indexOf("http://") != 0 && url.indexOf("https://") != 0) {
        // assume http
        url = "http://" + url;
    }
    // normalize multiple slashes as this trips WebOS in some cases
    var parts = url.split("://");
    for (var i = 1; i < parts.length; i++) {
        var part = parts[i];
        while (true) {
            var newpart = part.replace("//", "/");
            if (newpart.length == part.length) break;
            part = newpart;
        }
        parts[i] = part;
    }
    return parts.join("://");
}

function handleServerSelect() {
    var baseurl = normalizeUrl(document.querySelector('#baseurl').value);
    var auto_connect = document.querySelector('#auto_connect').checked;

    if (validURL(baseurl)) {

        displayConnecting();
        debugLog(baseurl, auto_connect);

        if (curr_req) {
            debugLog("There is an active request.");
            abort();
        }
        hideError();
        getServerInfo(baseurl, auto_connect);
    } else {
        debugLog(baseurl);
        displayError("Please enter a valid URL, it needs a scheme (http:// or https://), a hostname or IP (ex. jellyfin.local or 192.168.0.2) and a port (ex. :8096 or :8920).");
    }
}

function displayError(error) {
    var errorElem = document.querySelector('#error')
    errorElem.style.display = '';
    errorElem.textContent = error;
}
function hideError() {
    var errorElem = document.querySelector('#error')
    errorElem.style.display = 'none';
    errorElem.textContent = '\u00A0';
}

function displayConnecting() {
    document.querySelector('#serverInfoForm').style.display = 'none';
    document.querySelector('#busy').style.display = '';
    navigationInit();
}
function hideConnecting() {
    document.querySelector('#serverInfoForm').style.display = '';
    document.querySelector('#busy').style.display = 'none';
    navigationInit();
}
function getServerInfo(baseurl, auto_connect) {
    curr_req = ajax.request(normalizeUrl(baseurl + "/System/Info/Public"), {
        method: "GET",
        success: function (data) {
            handleSuccessServerInfo(data, baseurl, auto_connect);
        },
        error: handleFailure,
        abort: handleAbort,
        timeout: 5000
    });
}

function getManifest(baseurl) {
    curr_req = ajax.request(normalizeUrl(baseurl + "/web/manifest.json"), {
        method: "GET",
        success: function (data) {
            handleSuccessManifest(data, baseurl);
        },
        error: handleFailure,
        abort: handleAbort,
        timeout: 5000
    });
}

function getConnectedServers() {
    connected_servers = storage.get('connected_servers');
    if (!connected_servers) {
        connected_servers = {};
        return connected_servers;
    }

    var sanitized_servers = {};
    for (var server_id in connected_servers) {
        if (!Object.prototype.hasOwnProperty.call(connected_servers, server_id)) {
            continue;
        }
        var server = connected_servers[server_id];
        if (server && typeof server === 'object' && typeof server.baseurl === 'string') {
            sanitized_servers[server_id] = server;
        }
    }

    if (Object.keys(sanitized_servers).length !== Object.keys(connected_servers).length) {
        storage.set('connected_servers', sanitized_servers);
    }

    connected_servers = sanitized_servers;
    return connected_servers;
}


function handleSuccessServerInfo(data, baseurl, auto_connect) {
    curr_req = false;

    connected_servers = getConnectedServers();
    for (var server_id in connected_servers) {
        var server = connected_servers[server_id]
        if (!server || typeof server !== 'object') {
            continue;
        }
        if (server.baseurl == baseurl) {
            if (server.id != data.Id && server.id !== false) {
                //server has changed warn user.
                hideConnecting();
                displayError("The server ID has changed since the last connection, please check if you are reaching your own server. To connect anyway, click connect again.");
                delete connected_servers[server_id]
                connected_servers[data.Id] = ({ 'baseurl': baseurl, 'auto_connect': false, 'id': false })
                storage.set('connected_servers', connected_servers)
                return false
            }
        }
    }


    connected_servers = lruStrategy(connected_servers,4, { 'baseurl': baseurl, 'auto_connect': auto_connect, 'id': data.Id, 'Name':data.ServerName })

    storage.set('connected_servers', connected_servers);


    getManifest(baseurl)
    return true;
}

function lruStrategy(old_items,max_items,new_item) {
    var result = {}
    var id = new_item.id
    // Guard against a server response without an Id: fall back to the URL as the
    // key so distinct servers never collide on a single "undefined" entry.
    if (id === undefined || id === null || id === false || id === '') {
        id = new_item.baseurl;
    }

    delete old_items[id] // LRU: re-insert entry (in front) each time it is used
    result[id] =  new_item
    var keys = Object.keys(old_items)
    for (var i=0; i<max_items-1 && i<keys.length; i++){
        var current_key=keys[i]
        if (current_key !== undefined) {
            result[current_key] = old_items[current_key]
        }
    }
    return result
}

function handleSuccessManifest(data, baseurl) {
    var startUrl = (data && typeof data.start_url === 'string' && data.start_url.length > 0) ? data.start_url : 'index.html';
    // Treat start_url strictly as a server-relative path. Reject absolute URLs,
    // protocol-relative URLs and parent-directory traversal so a manifest cannot
    // redirect the webview off the chosen server.
    if (/^[a-z][a-z0-9+.-]*:/i.test(startUrl) || startUrl.indexOf('//') === 0 || startUrl.indexOf('..') !== -1) {
        startUrl = 'index.html';
    }
    if (startUrl.indexOf("/web") !== -1) {
        var hosturl = normalizeUrl(baseurl + "/" + startUrl);
    } else {
        var hosturl = normalizeUrl(baseurl + "/web/" + startUrl);
    }

    curr_req = false;

    // Read the current persisted list rather than relying on a stale global
    // left behind by an earlier handleSuccessServerInfo call.
    connected_servers = getConnectedServers();
    for (var server_id in connected_servers) {
        var info = connected_servers[server_id]
        if (!info || typeof info !== 'object') {
            continue;
        }
        if (info['baseurl' ] == baseurl) {
            info['hosturl'] = hosturl
            info['Address'] = info['Address'] || baseurl

            storage.set('connected_servers', connected_servers)
            debugLog("martin:handleSuccessManifest modified server");
            debugLog(info);

        // avoid Promise as it's buggy in some WebOS
            getTextToInject(function (bundle) {
                handoff(hosturl, bundle, info.id && info.id !== false ? info.id : null);
            }, function (error) {
                console.error(error);
                displayError(error);
                hideConnecting();
                curr_req = false;
            });
            return;
        }
    }
    // Fallback path: keep behavior deterministic even if no prior server entry is found.
    var address = baseurl.replace(/^https?:\/\//i, '').split('/')[0];
    var fallbackName = (data && typeof data.shortname === 'string' && data.shortname.length > 0) ? data.shortname : address;
    var fallbackId = fallbackName || baseurl;
    connected_servers = lruStrategy(getConnectedServers(), 4, {
        'baseurl': baseurl,
        'hosturl': hosturl,
        'Name': fallbackName,
        'Address': address,
        'auto_connect': false,
        'id': fallbackId
    });
    storage.set('connected_servers', connected_servers)
    debugLog("martin:handleSuccessManifest added server");
    debugLog(connected_servers[fallbackId]);

    getTextToInject(function (bundle) {
        handoff(hosturl, bundle, null);
    }, function (error) {
        console.error(error);
        displayError(error);
        hideConnecting();
        curr_req = false;
    });
}

function handleAbort() {
    debugLog("Aborted.")
    hideConnecting();
    curr_req = false;
}

function handleFailure(data) {
    debugLog("Failure:", data)
    debugLog("Could not connect to server...")
    if (data.error == 'timeout') {
        displayError("The request timed out.")
    } else if (data.error == 'abort') {
        displayError("The request was aborted.")
    } else if (typeof data.error === 'string') {
        displayError(data.error);
    } else if (typeof data.error === 'number' && data.error > 0) {
        displayError("Got HTTP error " + data.error.toString() + " from server, are you connecting to a Jellyfin Server?")
    } else {
        displayError("Unknown error occured, are you connecting to a Jellyfin Server?")
    }

    hideConnecting();
    curr_req = false;
}

function abort() {
    if (curr_req) {
        curr_req.abort()
    } else {
        hideConnecting();
    }
    debugLog("Aborting...");
}

function loadUrl(url, success, failure) {
    var xhr = new XMLHttpRequest();

    xhr.open('GET', url);

    xhr.onload = function () {
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
            success(xhr.responseText);
        } else {
            failure("Failed to load '" + url + "' (HTTP " + xhr.status + ")");
        }
    };

    xhr.onerror = function () {
        failure("Failed to load '" + url + "'");
    }

    xhr.send();
}

var injectBundleCache = null;
var activeHandoffCleanup = null;
var HANDOFF_INJECTION_TIMEOUT_MS = 45000;

function getTextToInject(success, failure) {
    if (injectBundleCache) {
        // Local app assets never change at runtime; reuse the first load
        // instead of re-fetching webOS.js/webOS.css on every (re)connect.
        success(injectBundleCache);
        return;
    }

    var bundle = {};

    var urls = ['js/webOS.js', 'css/webOS.css'];

    // imitate promises as they're borked in at least WebOS 2
    var looper = function (idx) {
        if (idx >= urls.length) {
            injectBundleCache = bundle;
            success(bundle);
        } else {
            var url = urls[idx];
            var ext = url.split('.').pop();
            loadUrl(url, function (data) {
                bundle[ext] = (bundle[ext] || '') + data;
                looper(idx + 1);
            }, failure);
        }
    };
    looper(0);
}

function injectScriptText(document, text) {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.text = text;
    (document.head || document.documentElement).appendChild(script);
}

function injectStyleText(document, text) {
    var style = document.createElement('style');
    style.textContent = text;
    (document.body || document.head || document.documentElement).appendChild(style);
}

function parseHandoffUrl(value) {
    var anchor = document.createElement('a');
    anchor.href = value;
    return {
        protocol: anchor.protocol,
        host: anchor.host
    };
}

function getHandoffUrlOrigin(value) {
    var parsed = parseHandoffUrl(value);
    if (!parsed.protocol || !parsed.host) {
        return '';
    }
    return parsed.protocol + '//' + parsed.host;
}

function getHandoffDocumentHref(contentDocument) {
    var href = '';
    try {
        href = contentDocument && contentDocument.location ? contentDocument.location.href : '';
    } catch (error) {
        return '';
    }
    return href;
}

function shouldValidateRedirectedHandoffDocument(contentDocument, targetUrl) {
    var currentOrigin = getHandoffDocumentOrigin(contentDocument);
    var current = parseHandoffUrl(currentOrigin);
    var target = parseHandoffUrl(targetUrl);
    return !!currentOrigin
        && currentOrigin !== getHandoffUrlOrigin(targetUrl)
        && !(target.protocol === 'https:' && current.protocol === 'http:');
}

function getHandoffDocumentOrigin(contentDocument) {
    var href = getHandoffDocumentHref(contentDocument);
    if (!href || href === 'about:blank' || href.indexOf('about:') === 0) {
        return '';
    }
    return getHandoffUrlOrigin(href);
}

function isRemoteHandoffDocument(contentDocument) {
    var href = getHandoffDocumentHref(contentDocument);

    if (!href || href === 'about:blank' || href.indexOf('about:') === 0) {
        return false;
    }

    var current = parseHandoffUrl(href);
    return current.protocol === 'http:' || current.protocol === 'https:';
}

function handoff(url, bundle, expectedServerId) {
    debugLog("Handoff called with: ", url)
    //hideConnecting();

    if (activeHandoffCleanup) {
        activeHandoffCleanup();
    }

    stopDiscovery();
    document.querySelector('.container').style.display = 'none';

    var contentFrame = document.querySelector('#contentFrame');

    var timer;
    var injectedDocument = null;
    var domContentLoadedDocument = null;
    var handoffCleanedUp = false;
    var acceptedHandoffOrigin = '';
    var injectionFailureTimer = null;
    var validatedRedirectOrigins = {};
    var validatingRedirectOrigins = {};
    var redirectValidationRequests = [];
    var frameNavigationStarted = false;
    var unloadWindow = null;

    function clearLoadPollTimer() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function clearInjectionFailureTimer() {
        if (injectionFailureTimer) {
            clearTimeout(injectionFailureTimer);
            injectionFailureTimer = null;
        }
    }

    function scheduleInjectionFailureTimer(message) {
        if (injectionFailureTimer) {
            return;
        }

        injectionFailureTimer = setTimeout(function () {
            failHandoff(message);
        }, HANDOFF_INJECTION_TIMEOUT_MS);
    }

    function abortRedirectValidationRequests() {
        for (var i = 0; i < redirectValidationRequests.length; i++) {
            var request = redirectValidationRequests[i];
            if (request && request.abort) {
                try {
                    request.abort();
                } catch (error) {
                    debugLog('Failed to abort handoff redirect validation:', error);
                }
            }
        }
        redirectValidationRequests = [];
    }

    function getContentDocument() {
        try {
            return contentFrame.contentDocument;
        } catch (error) {
            return null;
        }
    }

    function getContentWindow() {
        try {
            return contentFrame.contentWindow;
        } catch (error) {
            return null;
        }
    }

    function removeUnloadListener() {
        if (unloadWindow) {
            unloadWindow.removeEventListener('unload', onUnload);
            unloadWindow = null;
        }
    }

    function addUnloadListener() {
        var nextWindow = getContentWindow();
        if (!nextWindow || nextWindow === unloadWindow) {
            return;
        }

        removeUnloadListener();
        unloadWindow = nextWindow;
        unloadWindow.addEventListener('unload', onUnload);
    }

    function ensureLoadPollTimer() {
        if (timer) {
            return;
        }

        timer = setInterval(function () {
            var contentDocument = getContentDocument();
            if (!contentDocument) {
                return;
            }

            switch (contentDocument.readyState) {
                case 'loading':
                    if (domContentLoadedDocument !== contentDocument) {
                        if (domContentLoadedDocument) {
                            domContentLoadedDocument.removeEventListener('DOMContentLoaded', onDomContentLoaded);
                        }
                        domContentLoadedDocument = contentDocument;
                        contentDocument.addEventListener('DOMContentLoaded', onDomContentLoaded);
                    }
                    break;

                // In the case of "loading" is not caught
                case 'interactive':
                case 'complete':
                    onLoad(false);
                    break;
            }
        }, 50);
    }

    function onDomContentLoaded() {
        onLoad(false);
    }

    function onFrameLoad() {
        if (!frameNavigationStarted) {
            return;
        }
        onLoad(true);
    }

    function validateRedirectedHandoffOrigin(origin) {
        if (!origin || validatedRedirectOrigins[origin] || validatingRedirectOrigins[origin]) {
            return;
        }

        validatingRedirectOrigins[origin] = true;
        var request = new XMLHttpRequest();
        var validationUrl = normalizeUrl(origin + "/System/Info/Public");

        request.open('GET', validationUrl);
        request.timeout = 5000;
        request.onreadystatechange = function () {
            if (request.readyState !== XMLHttpRequest.DONE) {
                return;
            }

            validatingRedirectOrigins[origin] = false;
            if (request.status !== 200 || !request.responseURL || getHandoffUrlOrigin(request.responseURL) !== origin) {
                return;
            }

            var data = null;
            try {
                data = JSON.parse(request.responseText);
            } catch (error) {
                data = null;
            }

            if (data && data.ProductName == "Jellyfin Server"
                && (!expectedServerId || data.Id === expectedServerId)) {
                validatedRedirectOrigins[origin] = true;
                if (!handoffCleanedUp && getHandoffDocumentOrigin(getContentDocument()) === origin) {
                    onLoad(true);
                }
            }
        };
        request.onerror = function () {
            validatingRedirectOrigins[origin] = false;
        };
        request.ontimeout = function () {
            validatingRedirectOrigins[origin] = false;
        };
        request.onabort = function () {
            validatingRedirectOrigins[origin] = false;
        };
        request.send();
        redirectValidationRequests.push(request);
    }

    function onLoad(allowRedirectedDocument) {
        if (handoffCleanedUp) {
            return;
        }
        if (!frameNavigationStarted) {
            return;
        }

        var contentDocument = getContentDocument();
        if (!contentDocument || contentDocument === injectedDocument) {
            return;
        }

        // Redirects and about:blank transitions can briefly expose intermediate
        // documents. Polling injects only into the selected origin. Other
        // origins must first validate as the same Jellyfin server via
        // /System/Info/Public before receiving the privileged webOS bundle.
        var currentOrigin = getHandoffDocumentOrigin(contentDocument);
        var targetOrigin = getHandoffUrlOrigin(url);
        var isTargetOrigin = currentOrigin && currentOrigin === targetOrigin;
        var isAcceptedOrigin = acceptedHandoffOrigin && currentOrigin === acceptedHandoffOrigin;
        var isInitialRedirectedOrigin = !acceptedHandoffOrigin
            && allowRedirectedDocument
            && isRemoteHandoffDocument(contentDocument)
            && !!validatedRedirectOrigins[currentOrigin];

        if (!isTargetOrigin && !isAcceptedOrigin && !isInitialRedirectedOrigin) {
            if (!acceptedHandoffOrigin
                && allowRedirectedDocument
                && isRemoteHandoffDocument(contentDocument)
                && shouldValidateRedirectedHandoffDocument(contentDocument, url)) {
                validateRedirectedHandoffOrigin(currentOrigin);
            }
            scheduleInjectionFailureTimer("Failed to load Jellyfin Web in the webOS frame. The server may have redirected to an unsupported origin.");
            ensureLoadPollTimer();
            return;
        }

        clearLoadPollTimer();
        clearInjectionFailureTimer();
        if (domContentLoadedDocument) {
            domContentLoadedDocument.removeEventListener('DOMContentLoaded', onDomContentLoaded);
            domContentLoadedDocument = null;
        }
        contentDocument.removeEventListener('DOMContentLoaded', onDomContentLoaded);
        injectedDocument = contentDocument;
        if (!acceptedHandoffOrigin) {
            acceptedHandoffOrigin = currentOrigin;
        }
        addUnloadListener();

        injectScriptText(contentDocument, 'window.AppInfo = ' + JSON.stringify(appInfo) + ';');
        injectScriptText(contentDocument, 'window.DeviceInfo = ' + JSON.stringify(deviceInfo) + ';');
        injectScriptText(contentDocument, 'window.WebOSFeatureOverrides = ' + JSON.stringify(getEffectiveFeatureOverrides()) + ';');

        if (bundle.js) {
            injectScriptText(contentDocument, bundle.js);
        }

        if (bundle.css) {
            injectStyleText(contentDocument, bundle.css);
        }
    }

    function onUnload() {
        removeUnloadListener();
        clearLoadPollTimer();
        ensureLoadPollTimer();
        scheduleInjectionFailureTimer("Failed to reload Jellyfin Web in the webOS frame.");
    }

    function cleanupHandoff() {
        handoffCleanedUp = true;
        clearLoadPollTimer();
        clearInjectionFailureTimer();
        abortRedirectValidationRequests();
        if (domContentLoadedDocument) {
            domContentLoadedDocument.removeEventListener('DOMContentLoaded', onDomContentLoaded);
            domContentLoadedDocument = null;
        }
        removeUnloadListener();
        contentFrame.removeEventListener('load', onFrameLoad);
        if (activeHandoffCleanup === cleanupHandoff) {
            activeHandoffCleanup = null;
        }
    }

    function failHandoff(message) {
        cleanupHandoff();
        contentFrame.style.display = 'none';
        contentFrame.src = '';
        document.querySelector('.container').style.display = '';
        startDiscovery();
        hideConnecting();
        displayError(message);
    }

    activeHandoffCleanup = cleanupHandoff;

    // In the case of "loading" and "interactive" are not caught
    contentFrame.addEventListener('load', onFrameLoad);

    waitForDeviceInfo(function () {
        if (handoffCleanedUp) {
            return;
        }
        frameNavigationStarted = true;
        addUnloadListener();
        contentFrame.style.display = '';
        contentFrame.src = url;
        contentFrame.focus();
        scheduleInjectionFailureTimer("Failed to load Jellyfin Web in the webOS frame. The server did not finish loading in time.");
    });
}

window.addEventListener('message', function (event) {
    var contentFrame = document.querySelector('#contentFrame');
    if (!contentFrame || event.source !== contentFrame.contentWindow) {
        return;
    }

    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') {
        return;
    }

    switch (msg.type) {
        case 'WebOS.featureOverrides':
            storage.set(featureOverrideStorageKey, sanitizeFeatureOverrides(msg.data));
            break;
        case 'selectServer':
            if (activeHandoffCleanup) {
                activeHandoffCleanup();
            }
            startDiscovery();
            document.querySelector('.container').style.display = '';
            hideConnecting();
            contentFrame.style.display = 'none';
            contentFrame.src = '';
            break;
        case 'AppHost.exit':
            webOS.platformBack();
            break;
    }
});

/* Server auto-discovery */

var discovered_servers = {};
var connected_servers = {};

function renderServerList(server_list) {
    for (var server_id in server_list) {
        var server = server_list[server_id];
        if (!server || typeof server !== 'object') {
            continue;
        }
        renderSingleServer(server_id, server);
    }
}

function renderSingleServer(server_id, server) {
    var server_list = document.getElementById("serverlist");
    var server_card = document.getElementById("server_" + server_id);

    if (!server_card) {
        server_card = document.createElement("li");
        server_card.id = "server_" + server_id;
        server_card.className = "server_card";

        // Server name
        var title = document.createElement("div");
        title.className = "server_card_title";
        server_card.appendChild(title);

        // Server URL
        var server_url = document.createElement("div");
        server_url.className = "server_card_url";
        server_card.appendChild(server_url);

        // Button
        var btn = document.createElement("button");
        btn.innerText = "Connect";
        btn.type = "button";
        btn.onclick = function () {
            var urlfield = document.getElementById("baseurl");
            urlfield.value = this.value;
            handleServerSelect();
        };
        server_card.appendChild(btn);

        server_list.appendChild(server_card);
    }

    // Discovery re-renders the same servers every ~15s; update text in place
    // instead of tearing the card down and rebuilding closures each cycle.
    server_card.querySelector(".server_card_title").innerText = server.Name;
    server_card.querySelector(".server_card_url").innerText = server.Address;
    server_card.querySelector("button").value = server.Address;
}


var servers_verifying = {};

function verifyThenAdd(server) {
    if (!server || typeof server !== 'object' || typeof server.Id !== 'string' || !server.Id) {
        return;
    }
    if (typeof server.Address !== 'string' || !validURL(normalizeUrl(server.Address))) {
        debugLog("Ignoring discovered server with invalid address:", server.Address);
        return;
    }
    if (servers_verifying[server.Id]) {
        return;
    }
    servers_verifying[server.Id] = server;

    ajax.request(normalizeUrl(server.Address + "/System/Info/Public"), {
        method: "GET",
        success: function (data) {
            debugLog("success");
            debugLog(server);
            debugLog(data);

            // TODO: Do we want to autodiscover only Jellyfin servers, or anything that responds to "who is JellyfinServer?"
            if (data.ProductName == "Jellyfin Server") {
                server.system_info_public = data;
                if (!discovered_servers[server.Id]) {
                    discovered_servers[server.Id] = server;
                    renderServerList(discovered_servers);
                }
            }
            servers_verifying[server.Id] = true;
        },
        error: function (data) {
            debugLog("error");
            debugLog(server);
            debugLog(data);
            servers_verifying[server.Id] = false;
        },
        abort: function () {
            debugLog("abort");
            debugLog(server);
            servers_verifying[server.Id] = false;
        },
        timeout: 5000
    });
}


var discover = null;
var discoveryToken = 'discovery-' + new Date().getTime();

function startDiscovery() {
    if (discover) {
        return;
    }
    debugLog("Starting server autodiscovery...");
    discover = webOS.service.request("luna://org.jellyfin.webos.service", {
        method: "discover",
        parameters: {
            uniqueToken: discoveryToken
        },
        subscribe: true,
        resubscribe: true,
        onSuccess: function (args) {
            debugJsonLog('OK:', args);

            if (args.results) {
                for (var server_id in args.results) {
                    verifyThenAdd(args.results[server_id]);
                }
            }
        },
        onFailure: function (args) {
            debugJsonLog('ERR:', args);
        }
    });
}

function stopDiscovery() {
    if (discover) {
        try {
            discover.cancel();
        } catch (err) {
            console.warn(err);
        }
        discover = null;
    }
}

startDiscovery();
