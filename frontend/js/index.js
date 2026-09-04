/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var curr_req = false;
// Incremented by every new connection attempt and by abort(). handleSuccessManifest
// clears curr_req before assembling the injection bundle, so from that point on
// this counter is the only thing that can still cancel a connection.
var connectGeneration = 0;
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

function serializeInjectJson(value) {
    // JSON.stringify does not escape U+2028/U+2029, which pre-ES2019
    // Chromium (webOS 4.x/5.x) rejects inside string literals. Escape them
    // so injected `window.X = {...};` scripts parse on every platform.
    // JSON.stringify(undefined) returns the undefined value rather than a
    // string, so mirror the old string-concatenation behavior and emit
    // `undefined` instead of throwing.
    if (value === undefined) {
        return 'undefined';
    }
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

var deviceInfo;
var deviceInfoReady = false;
var deviceInfoCallbacks = [];
var deviceInfoTimeout = null;
var DEVICE_INFO_WAIT_TIMEOUT_MS = 5000;

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

function updateFrameDeviceInfo(info) {
    // A deviceInfo callback that lands after the 5s fallback already injected
    // an empty window.DeviceInfo into the frame: re-inject the real one so the
    // session does not run with degraded capability data. The injected runtime
    // reads window.DeviceInfo at use time via getLiveDeviceInfo() in webOS.js —
    // it never keeps a value bound when the bundle ran, so this reassignment
    // is picked up.
    //
    // Route it through the updater the active handoff publishes instead of
    // resolving the frame's current document here. The TV's capability
    // fingerprint (model, firmware, panel, HDR/DV/Atmos support) must only
    // reach a document the handoff origin gate already accepted; a frame
    // parked on a redirected origin that is still being validated — or one
    // that failed and is waiting out the 45s injection timeout — must not be
    // handed it.
    if (!activeHandoffDeviceInfoUpdater) {
        return;
    }

    try {
        activeHandoffDeviceInfoUpdater(info);
    } catch (error) {
        // Ignore cross-origin or detached document errors.
    }
}

function completeDeviceInfo(info) {
    deviceInfo = info && typeof info === 'object' ? info : {};

    // A real callback may arrive after the fallback fired. Keep the newer
    // information for future handoffs, but only flush the waiters once.
    if (deviceInfoReady) {
        updateFrameDeviceInfo(deviceInfo);
        return;
    }

    deviceInfoReady = true;
    if (deviceInfoTimeout !== null) {
        clearTimeout(deviceInfoTimeout);
        deviceInfoTimeout = null;
    }
    flushDeviceInfoCallbacks();
}

deviceInfoTimeout = setTimeout(function () {
    deviceInfoTimeout = null;
    if (window.console && console.warn) {
        console.warn('webOS deviceInfo timed out; continuing with conservative capabilities.');
    }
    completeDeviceInfo({});
}, DEVICE_INFO_WAIT_TIMEOUT_MS);

try {
    webOS.deviceInfo(completeDeviceInfo);
} catch (error) {
    if (window.console && console.warn) {
        console.warn('webOS deviceInfo failed; continuing with conservative capabilities.', error);
    }
    completeDeviceInfo({});
}

function isVisible(element) {
    return element.offsetWidth > 0 && element.offsetHeight > 0;
}

function findIndex(array, currentNode) {
    // Identity, not isEqualNode: activeElement is itself a member of the
    // candidate list, and structural equality would match whichever equivalent
    // element came first -- two cards for servers with the same name and
    // address are structurally identical.
    for (var i = 0; i < array.length; i++) {
        if (array[i] === currentNode) {
            return i;
        }
    }
    return -1;
}

var FOCUSABLE_SELECTOR = 'input, button, a, area, object, select, textarea, [contenteditable]';

// Hidden elements must not occupy a slot in the ordering. The Abort button sits
// inside the hidden busy overlay but last in document order, so an unfiltered
// list clamped "one past the last card" onto it -- and focus() on a
// display:none element silently does nothing, which read as a dead key.
function getFocusCandidates() {
    var all = document.querySelectorAll(FOCUSABLE_SELECTOR);
    var visible = [];
    for (var i = 0; i < all.length; i++) {
        if (isVisible(all[i])) {
            visible.push(all[i]);
        }
    }
    return visible;
}

function navigate(amount) {
    debugLog("Navigating " + amount.toString() + "...")
    var element = document.activeElement;
    if (element === null) {
        navigationInit();
    } else if (!isVisible(element) || element.tagName == 'BODY') {
        navigationInit();
    } else {
        var allElements = getFocusCandidates();

        //Find the current tab index.
        var currentIndex = findIndex(allElements, element);
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
function getFocusCandidateBox(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
        return null;
    }

    var rect = element.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
        return null;
    }

    return {
        centerX: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.top + rect.height
    };
}

// The server cards wrap in a flex row, so neighbours on the same line are only
// reachable left/right. Pick the nearest visible candidate on that side whose
// vertical extent still overlaps the current one, so focus stays on its row.
function navigateHorizontally(direction) {
    var element = document.activeElement;
    if (!element || element.tagName == 'BODY' || !isVisible(element)) {
        navigationInit();
        return;
    }

    var origin = getFocusCandidateBox(element);
    if (!origin) {
        // No layout information available; fall back to document order.
        navigate(direction);
        return;
    }

    var candidates = getFocusCandidates();
    var best = null;
    var bestDistance = -1;

    for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (candidate === element) {
            continue;
        }

        var box = getFocusCandidateBox(candidate);
        if (!box) {
            continue;
        }

        var offset = box.centerX - origin.centerX;
        if (direction > 0 ? offset <= 0 : offset >= 0) {
            continue;
        }

        if (box.bottom <= origin.top || box.top >= origin.bottom) {
            continue;
        }

        var distance = offset < 0 ? -offset : offset;
        if (bestDistance < 0 || distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }

    if (best) {
        best.focus();
    }
}

function leftArrowPressed() {
    navigateHorizontally(-1);
}

function rightArrowPressed() {
    navigateHorizontally(1);
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
        refreshServerList();
    }
}
// Just ensure that the string has no spaces, and begins with either http:// or https:// (case insensitively), and isn't empty after the ://
function validURL(str) {
    var pattern = /^https?:\/\/\S+$/i;
    return !!pattern.test(str);
}

function normalizeUrl(url) {
    url = url.trimStart();
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
        debugLog(baseurl, auto_connect);

        // Cancel any in-flight attempt *before* showing the busy screen.
        // abort() synchronously dispatches the abort event, whose handler calls
        // hideConnecting() -- ordered the other way round it tore down the busy
        // screen that had just been put up and left the UI on the form.
        if (curr_req) {
            debugLog("There is an active request.");
            abort();
        }

        // Open a fresh generation so this attempt is not cancelled by the
        // abort() that may have just retired the previous one.
        connectGeneration++;
        displayConnecting();
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
                // Reset only what the ID change invalidates — the identity and
                // the auto-connect consent. Carrying the display fields over
                // keeps the saved entry renderable if the user declines: the
                // replacement used to drop Name/Address/hosturl, leaving a card
                // titled "undefined" on the next launch.
                delete connected_servers[server_id]
                connected_servers[data.Id] = ({
                    'baseurl': baseurl,
                    'hosturl': server.hosturl,
                    'Name': server.Name,
                    'Address': server.Address || baseurl,
                    'auto_connect': false,
                    'id': false
                })
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

        // Callback style, not promises. Promise is available on the supported
        // baseline; this is kept because getTextToInject also serves the
        // sequential loader below, not because promises are unsafe.
            var manifestGeneration = connectGeneration;
            getTextToInject(function (bundle) {
                if (connectGeneration !== manifestGeneration) {
                    debugLog("Connection was cancelled while the injection bundle loaded.");
                    return;
                }
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
    // Persist the id as the "unknown id" sentinel (false), not a name/address. Storing a
    // non-GUID here would make a later reconnect compare it against the real server Id and
    // spuriously trip the "server ID has changed" warning. lruStrategy keys the entry under
    // baseurl when id is false.
    connected_servers = lruStrategy(getConnectedServers(), 4, {
        'baseurl': baseurl,
        'hosturl': hosturl,
        'Name': fallbackName,
        'Address': address,
        'auto_connect': false,
        'id': false
    });
    storage.set('connected_servers', connected_servers)
    debugLog("martin:handleSuccessManifest added server");
    debugLog(connected_servers[baseurl]);

    var fallbackGeneration = connectGeneration;
    getTextToInject(function (bundle) {
        if (connectGeneration !== fallbackGeneration) {
            debugLog("Connection was cancelled while the injection bundle loaded.");
            return;
        }
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
    // Bump first: past the manifest step there is no XHR left to cancel, but
    // the bundle is still being assembled and handoff() would still run. The
    // generation check in the getTextToInject callbacks is what actually stops
    // it, so it has to be invalidated even on the curr_req path.
    connectGeneration++;
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
// Published by handoff() once a document has passed the origin gate and been
// injected; cleared by that handoff's cleanup. Read by updateFrameDeviceInfo.
var activeHandoffDeviceInfoUpdater = null;
var activeHandoffMessageOrigin = '';
var activeHandoffMessageToken = '';
var handoffMessageTokenSequence = 0;
var HANDOFF_INJECTION_TIMEOUT_MS = 45000;
var injectedScriptUrls = [
    'js/injected/core/runtime.js',
    'js/injected/core/urls.js',
    'js/injected/core/features.js',
    'js/injected/core/mediaStreams.js',
    'js/injected/playback/profilePatches.js',
    'js/injected/playback/hdrDecisions.js',
    'js/injected/playback/playbackInfoPatches.js',
    'js/injected/subtitles/scriptPatches.js',
    'js/webOS.js'
];
var injectedStyleUrls = [
    'css/webOS.css'
];

function getTextToInject(success, failure) {
    if (injectBundleCache) {
        // Local app assets never change at runtime; reuse the first load
        // instead of re-fetching injected JS/CSS on every (re)connect.
        success(injectBundleCache);
        return;
    }

    var bundle = {};

    var urls = [];
    for (var scriptIndex = 0; scriptIndex < injectedScriptUrls.length; scriptIndex++) {
        urls.push({
            url: injectedScriptUrls[scriptIndex],
            type: 'js'
        });
    }
    for (var styleIndex = 0; styleIndex < injectedStyleUrls.length; styleIndex++) {
        urls.push({
            url: injectedStyleUrls[styleIndex],
            type: 'css'
        });
    }

    // Ordering is a concatenation requirement, not a fetch requirement. Every
    // request goes out at once and the parts are assembled in injectedScriptUrls
    // order once the last one lands; the loader used to issue each request from
    // the previous one's callback, putting nine local round trips -- 275 KB of
    // webOS.js among them -- on the launch path in series before the frame could
    // start navigating.
    var parts = new Array(urls.length);
    var remaining = urls.length;
    var failed = false;

    var finish = function () {
        for (var partIndex = 0; partIndex < urls.length; partIndex++) {
            var part = urls[partIndex];
            var separator = part.type === 'js' ? '\n;\n' : '\n';
            bundle[part.type] = (bundle[part.type] || '') + parts[partIndex] + separator;
        }
        injectBundleCache = bundle;
        success(bundle);
    };

    if (!remaining) {
        finish();
        return;
    }

    var onPartFailed = function (error) {
        if (failed) {
            return;
        }
        // One failure fails the bundle; the rest are in flight and their
        // callbacks are ignored from here.
        failed = true;
        failure(error);
    };

    var onPartLoaded = function (index, data) {
        if (failed) {
            return;
        }
        parts[index] = data;
        remaining--;
        if (remaining === 0) {
            finish();
        }
    };

    for (var loadIndex = 0; loadIndex < urls.length; loadIndex++) {
        (function (index) {
            loadUrl(urls[index].url, function (data) {
                onPartLoaded(index, data);
            }, onPartFailed);
        })(loadIndex);
    }
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

    // MessageEvent.origin follows WHATWG origin serialization, which omits
    // default ports ('https://host:443' -> 'https://host'), while anchor.host
    // preserves an explicit ':443'/':80'. Normalize here so the origin stored
    // at setActiveHandoffMessageAuthorization matches the frame's event.origin
    // even when the saved server URL spells out the default port.
    var host = parsed.host;
    if (parsed.protocol === 'https:' && host.slice(-4) === ':443') {
        host = host.slice(0, -4);
    } else if (parsed.protocol === 'http:' && host.slice(-3) === ':80') {
        host = host.slice(0, -3);
    }

    return parsed.protocol + '//' + host;
}

function createHandoffMessageToken() {
    handoffMessageTokenSequence++;

    var cryptoObject = window.crypto;
    if (cryptoObject && cryptoObject.getRandomValues) {
        try {
            var values = new Uint32Array(4);
            cryptoObject.getRandomValues(values);
            return 'webos-' + handoffMessageTokenSequence + '-'
                + values[0].toString(16) + '-'
                + values[1].toString(16) + '-'
                + values[2].toString(16) + '-'
                + values[3].toString(16);
        } catch (error) {
            debugLog('Unable to generate bridge token with crypto:', error);
        }
    }

    return 'webos-' + handoffMessageTokenSequence + '-'
        + new Date().getTime().toString(36) + '-'
        + Math.floor(Math.random() * 0x100000000).toString(16) + '-'
        + Math.floor(Math.random() * 0x100000000).toString(16);
}

function setActiveHandoffMessageAuthorization(origin, token) {
    activeHandoffMessageOrigin = origin && token ? origin : '';
    activeHandoffMessageToken = origin && token ? token : '';
}

function clearActiveHandoffMessageAuthorization() {
    activeHandoffMessageOrigin = '';
    activeHandoffMessageToken = '';
}

function isMessageFromActiveHandoff(event, contentFrame) {
    var message = event && event.data;
    return !!contentFrame
        && !!activeHandoffMessageOrigin
        && !!activeHandoffMessageToken
        && event.source === contentFrame.contentWindow
        && event.origin === activeHandoffMessageOrigin
        && message && typeof message === 'object'
        && message.webOSBridgeToken === activeHandoffMessageToken;
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
        var documentMessageToken = createHandoffMessageToken();
        injectScriptText(contentDocument, 'window.WebOSBridgeToken = ' + serializeInjectJson(documentMessageToken) + ';');
        setActiveHandoffMessageAuthorization(currentOrigin, documentMessageToken);
        addUnloadListener();

        injectScriptText(contentDocument, 'window.AppInfo = ' + serializeInjectJson(appInfo) + ';');
        injectScriptText(contentDocument, 'window.DeviceInfo = ' + serializeInjectJson(deviceInfo) + ';');
        injectScriptText(contentDocument, 'window.WebOSFeatureOverrides = ' + serializeInjectJson(getEffectiveFeatureOverrides()) + ';');

        // Only an accepted document may receive a late deviceInfo answer.
        // injectedDocument is read live, so a same-origin reload updates the
        // newest accepted document while a document the frame moved on to
        // without passing the origin gate is skipped.
        activeHandoffDeviceInfoUpdater = function (info) {
            if (handoffCleanedUp
                || !injectedDocument
                || getContentDocument() !== injectedDocument
                || !injectedDocument.head) {
                return;
            }
            injectScriptText(injectedDocument, 'window.DeviceInfo = ' + serializeInjectJson(info) + ';');
        };

        if (bundle.js) {
            injectScriptText(contentDocument, bundle.js);
        }

        if (bundle.css) {
            injectStyleText(contentDocument, bundle.css);
        }
    }

    function onUnload() {
        if (activeHandoffCleanup === cleanupHandoff) {
            clearActiveHandoffMessageAuthorization();
        }
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
            clearActiveHandoffMessageAuthorization();
            activeHandoffDeviceInfoUpdater = null;
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
        // Arm the injection failure timer from navigation start so the 45s
        // budget is not shortened by the device-info wait above.
        scheduleInjectionFailureTimer("Failed to load Jellyfin Web in the webOS frame. The server did not finish loading in time.");
        addUnloadListener();
        contentFrame.style.display = '';
        contentFrame.src = url;
        contentFrame.focus();
    });
}

window.addEventListener('message', function (event) {
    var contentFrame = document.querySelector('#contentFrame');
    if (!isMessageFromActiveHandoff(event, contentFrame)) {
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
            // Rebuild from current state: the server just disconnected from was
            // stored during this session and had no card, while entries evicted
            // by the LRU still had one.
            refreshServerList();
            document.querySelector('.container').style.display = '';
            hideConnecting();
            contentFrame.style.display = 'none';
            contentFrame.src = '';
            break;
        case 'AppHost.exit':
            webOS.platformBack();
            break;
        case 'openUrl':
            // AppHost advertises 'targetblank' and 'externallinkdisplay', so
            // jellyfin-web does route external links here. Without a handler the
            // message was dropped and the link silently did nothing.
            openExternalUrl(msg.data && msg.data.url);
            break;
        case 'downloadFile':
            // 'filedownload' is deliberately absent from AppHost.supports, so
            // jellyfin-web should never offer a download on this client. Warn
            // rather than dropping it, to catch the day that stops being true.
            console.warn('Ignoring downloadFile request; downloads are unsupported on webOS.');
            break;
        default:
            debugLog('Unhandled bridge message type:', msg.type);
            break;
    }
});

// Hand an external link to the TV browser. The URL comes from the server page,
// so only http(s) is accepted -- anything else could target a luna:// service
// or another app.
function openExternalUrl(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        console.warn('Refusing to open a non-http(s) external URL.');
        return;
    }

    try {
        webOS.service.request('luna://com.webos.applicationManager', {
            method: 'launch',
            parameters: {
                id: 'com.webos.app.browser',
                params: { target: url }
            },
            onFailure: function (error) {
                console.warn('Failed to open external URL:', error);
            }
        });
    } catch (error) {
        console.warn('Failed to open external URL:', error);
    }
}

/* Server auto-discovery */

var discovered_servers = {};
var connected_servers = {};

// Compare two server addresses for "is this the same endpoint". Discovery and
// the stored entry can spell the same server differently (trailing slash,
// case in the host, an explicit default port), and treating those as different
// would leave the user looking at two cards for one server.
function isSameServerAddress(a, b) {
    if (!a || !b) {
        return false;
    }

    return normalizeServerAddressForCompare(a) === normalizeServerAddressForCompare(b);
}

// Strip the port when it is the scheme default, so ":80"/":443" and the bare
// host compare equal. This used to be two anchored regexes that only matched at
// end of string, so a server with a path kept its port:
// 'http://nas.local/jellyfin' and 'http://nas.local:80/jellyfin' compared
// unequal and the discovered server got a card of its own -- the duplicate card
// this helper exists to prevent. getHandoffUrlOrigin() answers the same way for
// the origin it compares.
function stripDefaultPort(normalized) {
    var schemes = [['http://', ':80'], ['https://', ':443']];
    for (var i = 0; i < schemes.length; i++) {
        var scheme = schemes[i][0];
        var port = schemes[i][1];
        if (normalized.indexOf(scheme) !== 0) {
            continue;
        }

        var rest = normalized.substring(scheme.length);
        var pathIndex = rest.indexOf('/');
        var authority = pathIndex === -1 ? rest : rest.substring(0, pathIndex);
        var tail = pathIndex === -1 ? '' : rest.substring(pathIndex);
        if (authority.length > port.length
            && authority.substring(authority.length - port.length) === port) {
            authority = authority.substring(0, authority.length - port.length);
        }
        return scheme + authority + tail;
    }
    return normalized;
}

function normalizeServerAddressForCompare(address) {
    var normalized = normalizeUrl(address).toLowerCase();
    while (normalized.charAt(normalized.length - 1) === '/') {
        normalized = normalized.substring(0, normalized.length - 1);
    }
    return stripDefaultPort(normalized);
}

// A discovered server shares the saved server's card only when it points at the
// same address; otherwise it gets a card of its own so it cannot overwrite one.
function getDiscoveredServerCardKey(server) {
    var saved = getConnectedServers()[server.Id];
    if (!saved || !saved.baseurl) {
        return server.Id;
    }

    if (isSameServerAddress(saved.baseurl, server.Address)) {
        return server.Id;
    }

    return 'discovered_' + server.Id;
}

// Reconcile the rendered list against the servers that currently exist, adding
// and updating cards *and removing stale ones*. Rendering used to be add-only
// and ran just once at startup, so an LRU-evicted server, a discovered server
// that went offline, and a server first connected to during this session all
// left the picker showing entries that no longer matched anything.
function refreshServerList() {
    var list = document.getElementById("serverlist");
    if (!list) {
        return;
    }

    var live = {};

    var saved = getConnectedServers();
    for (var saved_id in saved) {
        var saved_server = saved[saved_id];
        if (!saved_server || typeof saved_server !== 'object') {
            continue;
        }
        live["server_" + saved_id] = true;
        renderSingleServer(saved_id, saved_server);
    }

    for (var discovered_id in discovered_servers) {
        var discovered_server = discovered_servers[discovered_id];
        if (!discovered_server || typeof discovered_server !== 'object') {
            continue;
        }
        var card_key = getDiscoveredServerCardKey(discovered_server);
        live["server_" + card_key] = true;
        renderSingleServer(card_key, discovered_server);
    }

    // Walk the child list rather than querySelectorAll: the cards are this
    // list's direct children, so the sweep needs no selector-engine support.
    var children = list.children || list.childNodes;
    if (!children) {
        return;
    }
    for (var i = children.length - 1; i >= 0; i--) {
        var card = children[i];
        if (!card || !card.id || card.id.indexOf("server_") !== 0) {
            continue;
        }
        if (!live[card.id]) {
            list.removeChild(card);
        }
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
    // Address is only populated after the manifest step; fall back to baseurl so a card
    // whose handshake never completed never renders or connects to "undefined".
    var serverAddress = server.Address || server.baseurl || '';
    server_card.querySelector(".server_card_title").innerText = server.Name || serverAddress;
    server_card.querySelector(".server_card_url").innerText = serverAddress;
    server_card.querySelector("button").value = serverAddress;
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
    // The service re-broadcasts every ~15s and rewrites Address each time, so
    // re-verify whenever the address moved (DHCP lease change, network
    // reconfiguration, PublishedServerUrl edit). Skipping an unchanged address
    // keeps the steady-state request count at zero; the previous "verified
    // once, never again" flag left the first-seen address rendered — and
    // selected — for the lifetime of the app process.
    var knownServer = discovered_servers[server.Id];
    if (knownServer && knownServer.Address === server.Address) {
        return;
    }
    // servers_verifying is strictly an in-flight marker; every terminal handler
    // clears it so a later address change can be checked.
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

            delete servers_verifying[server.Id];

            // TODO: Do we want to autodiscover only Jellyfin servers, or anything that responds to "who is JellyfinServer?"
            if (data.ProductName != "Jellyfin Server") {
                return;
            }

            // Bind the announced identity to the response. A responder that
            // does not claim the Id it was broadcast under is not the server
            // the broadcast described. (An announcer that controls its own
            // /System/Info/Public can still echo any Id, so this is a
            // consistency check, not an authentication of the peer.)
            if (typeof data.Id === 'string' && data.Id && data.Id !== server.Id) {
                debugLog("Ignoring discovered server whose reported Id does not match its broadcast Id:", server.Id, data.Id);
                return;
            }

            server.system_info_public = data;
            discovered_servers[server.Id] = server;

            // Discovery rides on unauthenticated UDP, so any LAN peer can
            // announce itself under a saved server's Id. Cards are keyed by Id,
            // so rendering such an announcement normally would silently rewrite
            // a previously connected server's card -- name, URL and the Connect
            // button target alike. getDiscoveredServerCardKey gives a
            // mismatched address its own card instead: a genuine address change
            // still shows up and stays selectable, but it can no longer
            // impersonate the saved entry.
            refreshServerList();
        },
        error: function (data) {
            debugLog("error");
            debugLog(server);
            debugLog(data);
            delete servers_verifying[server.Id];
        },
        abort: function () {
            debugLog("abort");
            debugLog(server);
            delete servers_verifying[server.Id];
        },
        timeout: 5000
    });
}


var discover = null;

function startDiscovery() {
    if (discover) {
        return;
    }
    debugLog("Starting server autodiscovery...");
    // No resubscribe option: the vendored webOSTV bridge does not implement one
    // (it reads service/method/parameters/subscribe and the three callbacks and
    // nothing else), so passing it only made the failure path look handled.
    // The service keys subscriptions on the uniqueToken LS2 attaches to the
    // message, not on anything sent in parameters, so that went unread too.
    var failed = false;
    var request = webOS.service.request("luna://org.jellyfin.webos.service", {
        method: "discover",
        subscribe: true,
        onSuccess: function (args) {
            debugJsonLog('OK:', args);

            if (args.results) {
                // A full snapshot is authoritative about what still exists, so
                // drop entries it omits. Partial pushes only ever add or
                // update, which is why an offline server used to keep its card
                // for the lifetime of the app.
                if (args.full === true) {
                    var removedAny = false;
                    for (var known_id in discovered_servers) {
                        if (!Object.prototype.hasOwnProperty.call(args.results, known_id)) {
                            delete discovered_servers[known_id];
                            delete servers_verifying[known_id];
                            removedAny = true;
                        }
                    }
                    if (removedAny) {
                        refreshServerList();
                    }
                }

                for (var server_id in args.results) {
                    verifyThenAdd(args.results[server_id]);
                }
            }
        },
        onFailure: function (args) {
            debugJsonLog('ERR:', args);
            // A lost subscription never comes back on its own. Leaving the
            // handle set made every later startDiscovery() return at the guard
            // above, so the picker silently stopped finding servers for the
            // rest of the app's life.
            failed = true;
            if (discover && discover === request) {
                stopDiscovery();
            }
        }
    });

    discover = failed ? null : request;
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
