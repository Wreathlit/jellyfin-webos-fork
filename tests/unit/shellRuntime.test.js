const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const shellPath = path.join(root, 'frontend', 'js', 'index.js');

function addEventTarget(target) {
    const listeners = {};

    target.addEventListener = function (type, listener) {
        listeners[type] = listeners[type] || [];
        if (listeners[type].indexOf(listener) === -1) {
            listeners[type].push(listener);
        }
    };
    target.removeEventListener = function (type, listener) {
        if (!listeners[type]) {
            return;
        }
        listeners[type] = listeners[type].filter(function (candidate) {
            return candidate !== listener;
        });
    };
    target.dispatchTestEvent = function (type, event) {
        const currentListeners = (listeners[type] || []).slice();
        for (const listener of currentListeners) {
            listener(event || {});
        }
    };

    return target;
}

function createContentDocument(href) {
    const scripts = [];
    const documentListeners = {};

    function appendChild(node) {
        if (node && node.type === 'text/javascript') {
            scripts.push(node.text);
        }
        return node;
    }

    return {
        location: { href: href },
        readyState: 'complete',
        head: { appendChild: appendChild },
        body: { appendChild: appendChild },
        documentElement: { appendChild: appendChild },
        createElement() {
            return {};
        },
        addEventListener(type, listener) {
            documentListeners[type] = listener;
        },
        removeEventListener(type, listener) {
            if (documentListeners[type] === listener) {
                delete documentListeners[type];
            }
        },
        injectedScripts: scripts
    };
}

function extractBridgeToken(contentDocument) {
    const prefix = 'window.WebOSBridgeToken = ';
    const tokenScript = contentDocument.injectedScripts.find(function (script) {
        return script.indexOf(prefix) === 0;
    });

    assert(tokenScript, 'handoff should inject a per-document bridge token');
    return JSON.parse(tokenScript.substring(prefix.length, tokenScript.length - 1));
}

function createFakeElement(tagName) {
    return {
        tagName: tagName,
        children: [],
        className: '',
        innerText: '',
        style: {},
        attributes: {},
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index !== -1) {
                this.children.splice(index, 1);
            }
            return child;
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
        },
        querySelector(selector) {
            for (const child of this.children) {
                const matches = selector.charAt(0) === '.'
                    ? child.className === selector.slice(1)
                    : child.tagName === selector;
                if (matches) {
                    return child;
                }

                const nested = child.querySelector ? child.querySelector(selector) : null;
                if (nested) {
                    return nested;
                }
            }
            return null;
        }
    };
}

function loadShell() {
    const timers = [];
    const clearedTimers = [];
    const intervals = [];
    const clearedIntervals = [];
    const xhrRequests = [];
    const ajaxRequests = [];
    const serverList = createFakeElement('ul');
    const contentWindow = addEventTarget({});
    const contentFrame = addEventTarget({
        contentWindow: contentWindow,
        contentDocument: createContentDocument('about:blank'),
        style: {},
        src: '',
        focusCalls: 0,
        focus() {
            this.focusCalls++;
        }
    });
    const elements = {
        '#contentFrame': contentFrame,
        '.container': { style: {} },
        '#serverInfoForm': { style: {} },
        '#busy': { style: {} },
        '#error': { style: {}, textContent: '' },
        // navigationInit() probes these; zero-sized means "not visible", which
        // keeps focus handling out of the way of the assertions below.
        '#connect': { offsetWidth: 0, offsetHeight: 0, focus() {} },
        '#abort': { offsetWidth: 0, offsetHeight: 0, focus() {} }
    };
    const storedValues = [];
    const storedState = {};
    let deviceInfoCallback;
    let platformBackCalls = 0;
    const testConsole = {
        log() {},
        warn() {},
        error() {}
    };

    const window = addEventTarget({
        console: testConsole
    });
    const document = {
        onkeydown: null,
        querySelector(selector) {
            return elements[selector] || null;
        },
        getElementById(id) {
            if (id === 'serverlist') {
                return serverList;
            }

            for (const child of serverList.children) {
                if (child.id === id) {
                    return child;
                }
            }
            return null;
        },
        createElement(tagName) {
            if (tagName !== 'a') {
                return createFakeElement(tagName);
            }

            const anchor = {};
            Object.defineProperty(anchor, 'href', {
                get() {
                    return this.value;
                },
                set(value) {
                    const parsed = new URL(value, 'https://shell.invalid/');
                    this.value = parsed.href;
                    this.protocol = parsed.protocol;
                    this.host = parsed.host;
                }
            });
            return anchor;
        }
    };
    function FakeXMLHttpRequest() {
        xhrRequests.push(this);
    }
    FakeXMLHttpRequest.DONE = 4;
    FakeXMLHttpRequest.prototype.open = function (method, url) {
        this.method = method;
        this.url = url;
    };
    FakeXMLHttpRequest.prototype.send = function () {
        this.sent = true;
    };
    FakeXMLHttpRequest.prototype.abort = function () {
        this.aborted = true;
        if (this.onabort) {
            this.onabort();
        }
    };
    const context = {
        window: window,
        document: document,
        console: testConsole,
        storage: {
            get(name) {
                return Object.prototype.hasOwnProperty.call(storedState, name) ? storedState[name] : null;
            },
            set(name, value) {
                storedState[name] = value;
                storedValues.push({ name: name, value: value });
                return value;
            },
            exists(name) {
                return Object.prototype.hasOwnProperty.call(storedState, name);
            },
            remove(name) {
                delete storedState[name];
            }
        },
        ajax: {
            request(url, settings) {
                const request = {
                    url: url,
                    settings: settings,
                    aborted: false,
                    abort() {
                        this.aborted = true;
                    }
                };
                ajaxRequests.push(request);
                return request;
            }
        },
        webOS: {
            deviceInfo(callback) {
                deviceInfoCallback = callback;
            },
            platformBack() {
                platformBackCalls++;
            },
            service: {
                request() {
                    return {
                        cancel() {}
                    };
                }
            }
        },
        setTimeout(callback, delay) {
            const timer = { callback: callback, delay: delay };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            clearedTimers.push(timer);
        },
        setInterval(callback, delay) {
            const interval = { callback: callback, delay: delay };
            intervals.push(interval);
            return interval;
        },
        clearInterval(interval) {
            clearedIntervals.push(interval);
        },
        XMLHttpRequest: FakeXMLHttpRequest,
        navigator: { userAgent: 'test' },
        btoa(value) {
            return Buffer.from(value).toString('base64');
        }
    };
    window.window = window;
    window.event = null;

    vm.runInNewContext(fs.readFileSync(shellPath, 'utf8'), context, {
        filename: shellPath
    });

    return {
        context: context,
        window: window,
        contentWindow: contentWindow,
        contentFrame: contentFrame,
        timers: timers,
        clearedTimers: clearedTimers,
        intervals: intervals,
        clearedIntervals: clearedIntervals,
        xhrRequests: xhrRequests,
        ajaxRequests: ajaxRequests,
        storedValues: storedValues,
        seedStorage(name, value) {
            storedState[name] = value;
        },
        readStorage(name) {
            return storedState[name];
        },
        getServerCard(id) {
            return document.getElementById(id);
        },
        setContentDocument(contentDocument) {
            contentFrame.contentDocument = contentDocument;
        },
        getDeviceInfoCallback() {
            return deviceInfoCallback;
        },
        getPlatformBackCalls() {
            return platformBackCalls;
        }
    };
}

function sendShellMessage(shell, origin, token, type, data) {
    shell.window.dispatchTestEvent('message', {
        source: shell.contentWindow,
        origin: origin,
        data: {
            type: type,
            data: data,
            webOSBridgeToken: token
        }
    });
}

{
    const shell = loadShell();
    let resolvedInfo = null;

    shell.context.waitForDeviceInfo(function (info) {
        resolvedInfo = info;
    });

    assert.strictEqual(resolvedInfo, null, 'device info wait should remain pending before callback or timeout');
    assert.strictEqual(shell.timers.length, 1, 'device info should have a fallback timer');
    assert.strictEqual(shell.timers[0].delay, 5000);

    shell.timers[0].callback();
    assert(resolvedInfo && typeof resolvedInfo === 'object', 'timeout should release waiters with conservative capabilities');
    assert.strictEqual(Object.keys(resolvedInfo).length, 0);

    shell.getDeviceInfoCallback()({ hdr10: true });
    shell.context.waitForDeviceInfo(function (info) {
        resolvedInfo = info;
    });
    assert.strictEqual(resolvedInfo.hdr10, true, 'a late real callback should be retained for future handoffs');
}

{
    const shell = loadShell();
    const fallbackTimer = shell.timers[0];
    let resolvedInfo = null;

    shell.getDeviceInfoCallback()({ hdr10: true });
    shell.context.waitForDeviceInfo(function (info) {
        resolvedInfo = info;
    });

    assert.strictEqual(resolvedInfo.hdr10, true, 'the real device callback should resolve pending waits');
    assert(shell.clearedTimers.indexOf(fallbackTimer) !== -1, 'the real callback should clear the fallback timer');
}

{
    // The 5s fallback injects an empty DeviceInfo. A real answer arriving after
    // that must reach the already-running frame, otherwise the whole session
    // reports no HDR10/Dolby Vision/Atmos support.
    const shell = loadShell();
    const trustedUrl = 'https://trusted.example/web/index.html';

    shell.getDeviceInfoCallback()({});
    shell.context.handoff(trustedUrl, { js: '', css: '' }, 'server-id');

    const contentDocument = createContentDocument(trustedUrl);
    shell.setContentDocument(contentDocument);
    shell.contentFrame.dispatchTestEvent('load');

    const prefix = 'window.DeviceInfo = ';
    const injectedBefore = contentDocument.injectedScripts.filter(function (script) {
        return script.indexOf(prefix) === 0;
    });
    assert.strictEqual(injectedBefore.length, 1, 'the handoff injects DeviceInfo once');
    assert.deepStrictEqual(JSON.parse(injectedBefore[0].slice(prefix.length, -1)), {});

    shell.getDeviceInfoCallback()({ hdr10: true, dolbyVision: true });

    const injectedAfter = contentDocument.injectedScripts.filter(function (script) {
        return script.indexOf(prefix) === 0;
    });
    assert.strictEqual(injectedAfter.length, 2, 'a late device callback should re-inject DeviceInfo');
    assert.deepStrictEqual(
        JSON.parse(injectedAfter[1].slice(prefix.length, -1)),
        { hdr10: true, dolbyVision: true },
        'the re-injected value should carry the real capabilities'
    );
}

{
    const shell = loadShell();

    shell.context.handoff('https://trusted.example/web/index.html', { js: '', css: '' }, 'server-id');

    assert(!shell.timers.some(function (timer) {
        return timer.delay === 45000;
    }), 'the injection timeout must not consume its budget while device info is pending');
    assert.strictEqual(shell.contentFrame.src, '', 'navigation should still wait for device info');

    shell.getDeviceInfoCallback()({ hdr10: true });

    assert(shell.timers.some(function (timer) {
        return timer.delay === 45000;
    }), 'the total handoff timeout should be armed from navigation start, not handoff entry');
    assert.strictEqual(shell.contentFrame.src, 'https://trusted.example/web/index.html');
}

{
    const shell = loadShell();
    const trustedUrl = 'https://trusted.example/web/index.html';
    const trustedOrigin = 'https://trusted.example';

    shell.getDeviceInfoCallback()({ hdr10: true });
    shell.context.handoff(trustedUrl, { js: '', css: '' }, 'server-id');

    // The listener initially belongs to about:blank. Its unload must not grant
    // or retain bridge access for the document that is about to load.
    shell.contentWindow.dispatchTestEvent('unload');
    const firstDocument = createContentDocument(trustedUrl);
    shell.setContentDocument(firstDocument);
    shell.contentFrame.dispatchTestEvent('load');
    const firstToken = extractBridgeToken(firstDocument);

    sendShellMessage(shell, 'https://redirect.example', firstToken, 'AppHost.exit');
    sendShellMessage(shell, trustedOrigin, 'wrong-token', 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 0, 'origin and token must both match the active document');

    sendShellMessage(shell, trustedOrigin, firstToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 1, 'the active document token should authorize shell messages');

    shell.contentWindow.dispatchTestEvent('unload');
    sendShellMessage(shell, trustedOrigin, firstToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 1, 'unload must revoke the document token immediately');

    const secondDocument = createContentDocument(trustedUrl);
    shell.setContentDocument(secondDocument);
    shell.contentFrame.dispatchTestEvent('load');
    const secondToken = extractBridgeToken(secondDocument);

    assert.notStrictEqual(secondToken, firstToken, 'a same-origin document reload must rotate the bridge token');
    sendShellMessage(shell, trustedOrigin, firstToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 1, 'queued messages from the old same-origin document must be rejected');
    sendShellMessage(shell, trustedOrigin, secondToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 2, 'the reloaded document should use its new token');

    const staleCleanup = shell.context.activeHandoffCleanup;
    shell.context.handoff(trustedUrl, { js: '', css: '' }, 'server-id');
    shell.contentWindow.dispatchTestEvent('unload');
    const thirdDocument = createContentDocument(trustedUrl);
    shell.setContentDocument(thirdDocument);
    shell.contentFrame.dispatchTestEvent('load');
    const thirdToken = extractBridgeToken(thirdDocument);

    sendShellMessage(shell, trustedOrigin, secondToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 2, 'a new handoff must reject the previous handoff token');
    staleCleanup();
    sendShellMessage(shell, trustedOrigin, thirdToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 3, 'stale cleanup must not revoke a newer handoff');

    shell.context.activeHandoffCleanup();
    sendShellMessage(shell, trustedOrigin, thirdToken, 'WebOS.featureOverrides', {
        assTimeSyncFixEnabled: false
    });
    assert.strictEqual(shell.storedValues.length, 0, 'current cleanup must revoke feature-override access');
}

{
    const shell = loadShell();
    const targetUrl = 'https://target.example/web/index.html';
    const targetOrigin = 'https://target.example';
    const redirectUrl = 'https://redirect.example/web/index.html';
    const redirectOrigin = 'https://redirect.example';

    shell.getDeviceInfoCallback()({});
    shell.context.handoff(targetUrl, { js: '', css: '' }, 'server-id');
    shell.contentWindow.dispatchTestEvent('unload');

    const redirectDocument = createContentDocument(redirectUrl);
    shell.setContentDocument(redirectDocument);
    shell.contentFrame.dispatchTestEvent('load');
    assert.strictEqual(shell.xhrRequests.length, 1, 'a cross-origin redirect must be validated before injection');

    const validationRequest = shell.xhrRequests[0];
    validationRequest.readyState = 4;
    validationRequest.status = 200;
    validationRequest.responseURL = redirectOrigin + '/System/Info/Public';
    validationRequest.responseText = JSON.stringify({
        ProductName: 'Jellyfin Server',
        Id: 'server-id'
    });
    validationRequest.onreadystatechange();

    const redirectToken = extractBridgeToken(redirectDocument);
    sendShellMessage(shell, redirectOrigin, redirectToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 1, 'the validated redirect document should own its bridge token');

    shell.contentWindow.dispatchTestEvent('unload');
    const returnedTargetDocument = createContentDocument(targetUrl);
    shell.setContentDocument(returnedTargetDocument);
    shell.contentFrame.dispatchTestEvent('load');
    const returnedTargetToken = extractBridgeToken(returnedTargetDocument);

    assert.notStrictEqual(returnedTargetToken, redirectToken);
    sendShellMessage(shell, redirectOrigin, redirectToken, 'AppHost.exit');
    sendShellMessage(shell, targetOrigin, redirectToken, 'AppHost.exit');
    sendShellMessage(shell, redirectOrigin, returnedTargetToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 1, 'old tokens and origin/token mismatches must fail after returning to the target origin');

    sendShellMessage(shell, targetOrigin, returnedTargetToken, 'AppHost.exit');
    assert.strictEqual(shell.getPlatformBackCalls(), 2, 'the returned target document should be authorized with its own origin');
}

function countDeviceInfoInjections(contentDocument) {
    const prefix = 'window.DeviceInfo = ';
    return contentDocument.injectedScripts.filter(function (script) {
        return script.indexOf(prefix) === 0;
    }).length;
}

{
    // A late deviceInfo answer carries the TV's capability fingerprint (model,
    // firmware, panel size, HDR/DV/Atmos support). It must only reach a document
    // the handoff origin gate accepted — never one parked on a refused origin
    // while its /System/Info/Public validation is still outstanding.
    const shell = loadShell();

    shell.getDeviceInfoCallback()({});
    shell.context.handoff('https://target.example/web/index.html', { js: '', css: '' }, 'server-id');
    shell.contentWindow.dispatchTestEvent('unload');

    const foreignDocument = createContentDocument('https://redirect.example/web/index.html');
    shell.setContentDocument(foreignDocument);
    shell.contentFrame.dispatchTestEvent('load');

    assert.strictEqual(countDeviceInfoInjections(foreignDocument), 0, 'an unvalidated origin must not be injected');
    assert.strictEqual(shell.xhrRequests.length, 1, 'the refused origin should still be under validation');

    shell.getDeviceInfoCallback()({ hdr10: true, modelName: 'OLED65' });

    assert.strictEqual(
        countDeviceInfoInjections(foreignDocument),
        0,
        'a late device callback must not leak capabilities into an unaccepted document'
    );
}

{
    // Once the frame navigates away from the accepted document, the stale
    // document must not be written to either.
    const shell = loadShell();
    const trustedUrl = 'https://trusted.example/web/index.html';

    shell.getDeviceInfoCallback()({});
    shell.context.handoff(trustedUrl, { js: '', css: '' }, 'server-id');

    const acceptedDocument = createContentDocument(trustedUrl);
    shell.setContentDocument(acceptedDocument);
    shell.contentFrame.dispatchTestEvent('load');
    assert.strictEqual(countDeviceInfoInjections(acceptedDocument), 1, 'the handoff injects DeviceInfo once');

    shell.contentWindow.dispatchTestEvent('unload');
    const foreignDocument = createContentDocument('https://redirect.example/web/index.html');
    shell.setContentDocument(foreignDocument);

    shell.getDeviceInfoCallback()({ hdr10: true });

    assert.strictEqual(countDeviceInfoInjections(acceptedDocument), 1, 'a document the frame already left must not be re-injected');
    assert.strictEqual(countDeviceInfoInjections(foreignDocument), 0, 'the document that replaced it was never accepted');
}

{
    // Cleanup revokes late injection along with the bridge token.
    const shell = loadShell();
    const trustedUrl = 'https://trusted.example/web/index.html';

    shell.getDeviceInfoCallback()({});
    shell.context.handoff(trustedUrl, { js: '', css: '' }, 'server-id');

    const acceptedDocument = createContentDocument(trustedUrl);
    shell.setContentDocument(acceptedDocument);
    shell.contentFrame.dispatchTestEvent('load');

    shell.context.activeHandoffCleanup();
    shell.getDeviceInfoCallback()({ hdr10: true });

    assert.strictEqual(countDeviceInfoInjections(acceptedDocument), 1, 'cleanup must revoke late device-info injection');
}

{
    // Discovery repeats every ~15s and rewrites Address each cycle. An unchanged
    // address must not cost a request, but a server that moves must be
    // re-verified and repainted instead of keeping a dead address forever.
    const shell = loadShell();

    shell.context.verifyThenAdd({ Id: 'srv-1', Name: 'Living Room', Address: 'http://192.168.0.10:8096' });
    assert.strictEqual(shell.ajaxRequests.length, 1, 'a newly discovered server is verified once');
    shell.ajaxRequests[0].settings.success({ ProductName: 'Jellyfin Server' });

    shell.context.verifyThenAdd({ Id: 'srv-1', Name: 'Living Room', Address: 'http://192.168.0.10:8096' });
    assert.strictEqual(shell.ajaxRequests.length, 1, 'an unchanged address must not be re-verified every cycle');

    shell.context.verifyThenAdd({ Id: 'srv-1', Name: 'Living Room', Address: 'http://192.168.0.42:8096' });
    assert.strictEqual(shell.ajaxRequests.length, 2, 'a re-addressed server must be re-verified');
    shell.ajaxRequests[1].settings.success({ ProductName: 'Jellyfin Server' });

    const card = shell.getServerCard('server_srv-1');
    assert.strictEqual(card.querySelector('.server_card_url').innerText, 'http://192.168.0.42:8096');
    assert.strictEqual(card.querySelector('button').value, 'http://192.168.0.42:8096', 'the card must connect to the current address');
}

{
    // A failed verification must release the in-flight marker so the next
    // broadcast can retry.
    const shell = loadShell();

    shell.context.verifyThenAdd({ Id: 'srv-2', Name: 'Den', Address: 'http://192.168.0.11:8096' });
    assert.strictEqual(shell.ajaxRequests.length, 1);
    shell.ajaxRequests[0].settings.error({ error: 'timeout' });

    shell.context.verifyThenAdd({ Id: 'srv-2', Name: 'Den', Address: 'http://192.168.0.11:8096' });
    assert.strictEqual(shell.ajaxRequests.length, 2, 'a failed verification must not permanently block the server');
}

{
    // A record saved without a name must not render the literal "undefined".
    const shell = loadShell();

    shell.context.renderSingleServer('srv-3', {
        baseurl: 'http://192.168.0.12:8096',
        auto_connect: false,
        id: false
    });

    const card = shell.getServerCard('server_srv-3');
    assert.strictEqual(card.querySelector('.server_card_title').innerText, 'http://192.168.0.12:8096');
}

{
    // An ID change invalidates the identity and the auto-connect consent, not
    // the whole record: dropping the display fields left an unusable card
    // behind for users who declined the reconnect.
    const shell = loadShell();

    shell.seedStorage('connected_servers', {
        'old-id': {
            baseurl: 'https://server.example',
            hosturl: 'https://server.example/web/index.html',
            Name: 'Living Room',
            Address: 'server.example',
            auto_connect: true,
            id: 'old-id'
        }
    });

    const accepted = shell.context.handleSuccessServerInfo(
        { Id: 'new-id', ServerName: 'Somebody Else' },
        'https://server.example',
        true
    );

    assert.strictEqual(accepted, false, 'an ID change must stop the handoff and warn');

    const saved = shell.readStorage('connected_servers');
    assert.ok(!saved['old-id'], 'the stale identity must be dropped');

    const replacement = saved['new-id'];
    assert.strictEqual(replacement.Name, 'Living Room', 'the saved name must survive a declined reconnect');
    assert.strictEqual(replacement.Address, 'server.example');
    assert.strictEqual(replacement.hosturl, 'https://server.example/web/index.html');
    assert.strictEqual(replacement.auto_connect, false, 'auto connect must be re-confirmed after an ID change');
    assert.strictEqual(replacement.id, false, 'the unknown-id sentinel keeps the next reconnect from warning again');
}

// refreshServerList reconciles instead of only appending. Rendering used to run
// once at startup and never remove anything, so an LRU-evicted server kept a
// clickable card pointing at an entry that no longer existed.
{
    const shell = loadShell();
    shell.seedStorage('connected_servers', {
        'keep-id': {
            baseurl: 'https://keep.example',
            hosturl: 'https://keep.example/web/index.html',
            Name: 'Keep',
            Address: 'keep.example',
            id: 'keep-id'
        },
        'drop-id': {
            baseurl: 'https://drop.example',
            hosturl: 'https://drop.example/web/index.html',
            Name: 'Drop',
            Address: 'drop.example',
            id: 'drop-id'
        }
    });

    shell.context.refreshServerList();
    assert.ok(shell.getServerCard('server_keep-id'), 'a stored server must be rendered');
    assert.ok(shell.getServerCard('server_drop-id'), 'both stored servers must be rendered');

    // Evict one entry the way the LRU would, then reconcile again.
    shell.seedStorage('connected_servers', {
        'keep-id': {
            baseurl: 'https://keep.example',
            hosturl: 'https://keep.example/web/index.html',
            Name: 'Keep',
            Address: 'keep.example',
            id: 'keep-id'
        }
    });
    shell.context.refreshServerList();

    assert.ok(shell.getServerCard('server_keep-id'), 'a still-stored server must keep its card');
    assert.strictEqual(
        shell.getServerCard('server_drop-id'),
        null,
        'a server that is no longer stored must lose its card'
    );
}

// A discovered server may not take over the card of a saved server sitting at a
// different address: cards are keyed by Id, and discovery rides on
// unauthenticated UDP, so that overwrite would repoint Connect at the announcer.
{
    const shell = loadShell();
    shell.seedStorage('connected_servers', {
        'shared-id': {
            baseurl: 'https://real.example',
            hosturl: 'https://real.example/web/index.html',
            Name: 'Real',
            Address: 'real.example',
            id: 'shared-id'
        }
    });

    const sameAddress = shell.context.getDiscoveredServerCardKey({
        Id: 'shared-id',
        Address: 'https://real.example/'
    });
    assert.strictEqual(
        sameAddress,
        'shared-id',
        'a trailing slash must not split one server across two cards'
    );

    const otherAddress = shell.context.getDiscoveredServerCardKey({
        Id: 'shared-id',
        Address: 'http://192.168.1.66:8096'
    });
    assert.strictEqual(
        otherAddress,
        'discovered_shared-id',
        'a different address under a saved Id must render as its own card'
    );
}

// The default-port strip was two regexes anchored at end of string, so it only
// fired when nothing followed the port: a server with a path kept its ':80' and
// compared unequal to the same server saved without one, which renders a second
// card for it -- the duplicate this helper exists to prevent.
{
    const shell = loadShell();
    const compare = shell.context.normalizeServerAddressForCompare;
    assert.strictEqual(typeof compare, 'function', 'the compare helper must be reachable');

    const samePairs = [
        ['http://nas.local/jellyfin', 'http://nas.local:80/jellyfin'],
        ['http://nas.local', 'http://nas.local:80'],
        ['https://nas.local/jf', 'https://nas.local:443/jf'],
        ['https://nas.local/', 'https://nas.local:443']
    ];
    for (const [a, b] of samePairs) {
        assert.strictEqual(
            compare(a),
            compare(b),
            a + ' and ' + b + ' are the same server'
        );
    }

    // A non-default port is part of the identity and must survive.
    assert.notStrictEqual(
        compare('http://nas.local:8096/jellyfin'),
        compare('http://nas.local/jellyfin'),
        'an explicit non-default port distinguishes two servers'
    );
    assert.strictEqual(
        compare('http://nas.local:8096'),
        'http://nas.local:8096',
        'a non-default port is kept verbatim'
    );
}

// The injected assets used to be fetched one at a time, each from the previous
// one's callback, on the launch path. Ordering is a concatenation requirement,
// not a fetch one: all nine requests go out at once and are assembled in
// injectedScriptUrls order.
{
    const shell = loadShell();
    const bundles = [];
    shell.context.getTextToInject(function (bundle) {
        bundles.push(bundle);
    }, function (error) {
        assert.fail('the bundle must load: ' + error);
    });

    const assetRequests = shell.xhrRequests.filter(function (request) {
        return String(request.url).indexOf('js/injected/') !== -1
            || String(request.url).indexOf('js/webOS.js') !== -1
            || String(request.url).indexOf('css/webOS.css') !== -1;
    });
    assert.ok(
        assetRequests.length > 1,
        'every injected asset must be requested before any of them has answered, got '
            + assetRequests.length
    );
    assert.strictEqual(bundles.length, 0, 'the bundle cannot be ready before the parts answer');

    // Answer out of order; the concatenation must still follow the manifest.
    for (let i = assetRequests.length - 1; i >= 0; i--) {
        assetRequests[i].status = 200;
        assetRequests[i].responseText = '/*' + assetRequests[i].url + '*/';
        assetRequests[i].onload();
    }

    assert.strictEqual(bundles.length, 1, 'the bundle is delivered once the last part lands');
    const js = bundles[0].js || '';
    let previous = -1;
    for (const url of shell.context.injectedScriptUrls) {
        const at = js.indexOf('/*' + url + '*/');
        assert.ok(at !== -1, url + ' must be in the bundle');
        assert.ok(at > previous, url + ' must appear in manifest order');
        previous = at;
    }
}
