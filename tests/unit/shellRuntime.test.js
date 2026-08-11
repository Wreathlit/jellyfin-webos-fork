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

function loadShell() {
    const timers = [];
    const clearedTimers = [];
    const intervals = [];
    const clearedIntervals = [];
    const xhrRequests = [];
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
        '#error': { style: {}, textContent: '' }
    };
    const storedValues = [];
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
        createElement(tagName) {
            if (tagName !== 'a') {
                return {};
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
            get() {
                return null;
            },
            set(name, value) {
                storedValues.push({ name: name, value: value });
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
        storedValues: storedValues,
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
    const shell = loadShell();

    shell.context.handoff('https://trusted.example/web/index.html', { js: '', css: '' }, 'server-id');

    assert(shell.timers.some(function (timer) {
        return timer.delay === 45000;
    }), 'the total handoff timeout should start before device info is ready');
    assert.strictEqual(shell.contentFrame.src, '', 'navigation should still wait for device info');
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
