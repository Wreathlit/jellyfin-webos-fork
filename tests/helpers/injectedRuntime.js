// Test harness for the injected runtime (frontend/js/webOS.js plus the modules
// under frontend/js/injected/).
//
// That bundle is a single IIFE that exports nothing but window.NativeShell, so
// its behavior can only be observed the way Jellyfin Web observes it: through
// the NativeShell surface, the patched fetch/XMLHttpRequest, the patched
// Node.prototype insertion methods, and the DOM it mutates. This module builds
// just enough of a browser for that — a deterministic clock and a small DOM —
// and loads the bundle into a fresh vm context.
//
// Everything here is deliberately minimal: it implements the APIs the bundle
// actually uses (see the API census in the review notes), not a general DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');

// Same list, same order, as injectedScriptUrls in frontend/js/index.js.
// tools/check-injected-assets.js enforces that order for the shipping app.
const BUNDLE_FILES = [
    'frontend/js/injected/core/runtime.js',
    'frontend/js/injected/core/urls.js',
    'frontend/js/injected/core/features.js',
    'frontend/js/injected/core/mediaStreams.js',
    'frontend/js/injected/playback/profilePatches.js',
    'frontend/js/injected/playback/hdrDecisions.js',
    'frontend/js/injected/playback/playbackInfoPatches.js',
    'frontend/js/injected/subtitles/scriptPatches.js',
    'frontend/js/webOS.js'
];

function createClock(startMs) {
    let now = typeof startMs === 'number' ? startMs : 1600000000000;
    let sequence = 0;
    const scheduled = new Map();

    function schedule(callback, delay, intervalMs) {
        const id = ++sequence;
        scheduled.set(id, {
            callback: callback,
            due: now + (delay > 0 ? delay : 0),
            interval: intervalMs
        });
        return id;
    }

    function nextDueBefore(limit) {
        let best = null;
        for (const [id, timer] of scheduled) {
            if (timer.due <= limit && (best === null || timer.due < best.timer.due)) {
                best = { id: id, timer: timer };
            }
        }
        return best;
    }

    return {
        now() {
            return now;
        },
        setTimeout(callback, delay) {
            return schedule(callback, delay, null);
        },
        clearTimeout(id) {
            scheduled.delete(id);
        },
        setInterval(callback, delay) {
            return schedule(callback, delay, delay > 0 ? delay : 1);
        },
        clearInterval(id) {
            scheduled.delete(id);
        },
        pendingCount() {
            return scheduled.size;
        },
        // Advance time, running every callback that comes due in order. Timers
        // scheduled by those callbacks run too if they fall inside the window,
        // which is what makes the bundle's self-rescheduling scan loops work.
        tick(ms) {
            const target = now + ms;
            let guard = 0;
            for (;;) {
                const next = nextDueBefore(target);
                if (!next) {
                    break;
                }
                if (++guard > 10000) {
                    throw new Error('clock.tick: timer callbacks are not converging');
                }

                now = Math.max(now, next.timer.due);
                if (next.timer.interval) {
                    next.timer.due = now + next.timer.interval;
                } else {
                    scheduled.delete(next.id);
                }
                next.timer.callback();
            }
            now = target;
        }
    };
}

function createClassList(element) {
    const names = [];
    return {
        add() {
            for (const name of arguments) {
                if (names.indexOf(name) === -1) {
                    names.push(name);
                }
            }
        },
        remove() {
            for (const name of arguments) {
                const index = names.indexOf(name);
                if (index !== -1) {
                    names.splice(index, 1);
                }
            }
        },
        contains(name) {
            return names.indexOf(name) !== -1;
        },
        toggle(name, force) {
            const has = names.indexOf(name) !== -1;
            const next = force === undefined ? !has : !!force;
            if (next) {
                this.add(name);
            } else {
                this.remove(name);
            }
            return next;
        },
        get length() {
            return names.length;
        },
        toString() {
            return names.join(' ');
        },
        _names: names,
        _element: element
    };
}

// Blink gives every length in an inline transform a unit when it serializes the
// declaration back, so 'translateY(0)' reads back as 'translateY(0px)'.
// Modelling just that keeps a comparison against the literal the bundle writes
// honest -- storing the raw string made the header pin check look correct here
// while it could never match on a TV.
function serializeTransformValue(value) {
    return String(value).replace(/\(\s*0\s*\)/g, '(0px)');
}

function createStyle() {
    let transformValue = '';
    const style = {
        get transform() {
            return transformValue;
        },
        set transform(value) {
            transformValue = serializeTransformValue(value);
        },
        setProperty(name, value) {
            if (name === 'transform') {
                transformValue = serializeTransformValue(value);
                return;
            }
            style[name] = value;
        },
        removeProperty(name) {
            if (name === 'transform') {
                transformValue = '';
                return;
            }
            delete style[name];
        },
        getPropertyValue(name) {
            if (name === 'transform') {
                return transformValue;
            }
            return style[name] === undefined ? '' : style[name];
        }
    };
    return style;
}

// Selector support is intentionally limited to what the bundle uses: a
// comma-separated list of tag names, .class, [attr] and [attr="value"].
function matchesSimpleSelector(element, selector) {
    selector = selector.trim();
    if (!selector) {
        return false;
    }

    if (selector.charAt(0) === '.') {
        return element.classList.contains(selector.slice(1));
    }

    if (selector.charAt(0) === '[') {
        const attributeMatch = /^\[([^\]=]+)(?:\s*=\s*"?([^\]"]*)"?)?\]$/.exec(selector);
        if (!attributeMatch) {
            return false;
        }
        const value = element.getAttribute(attributeMatch[1]);
        if (attributeMatch[2] === undefined) {
            return value !== null;
        }
        return value === attributeMatch[2];
    }

    // Tag plus optional class/attribute qualifiers, e.g. 'button.selected'.
    const parts = selector.split(/(?=[.[])/);
    const tag = parts.shift();
    if (tag && element.tagName !== tag.toLowerCase()) {
        return false;
    }
    for (const part of parts) {
        if (!matchesSimpleSelector(element, part)) {
            return false;
        }
    }
    return true;
}

function matchesSelector(element, selector) {
    return selector.split(',').some(function (candidate) {
        return matchesSimpleSelector(element, candidate);
    });
}

function collectDescendants(node, result) {
    for (const child of node.childNodes) {
        result.push(child);
        collectDescendants(child, result);
    }
    return result;
}

function createDom(clock) {
    // The bundle patches Node.prototype.appendChild / insertBefore to intercept
    // subtitle renderer scripts, so harness elements must really inherit from
    // this constructor for that interception to be exercised.
    function Node() {
        this.childNodes = [];
        this.parentNode = null;
    }

    Node.prototype.appendChild = function (child) {
        return this.insertBefore(child, null);
    };

    Node.prototype.insertBefore = function (child, reference) {
        if (!child) {
            return child;
        }
        if (child.parentNode && child.parentNode.removeChild) {
            child.parentNode.removeChild(child);
        }

        const index = reference ? this.childNodes.indexOf(reference) : -1;
        if (index === -1) {
            this.childNodes.push(child);
        } else {
            this.childNodes.splice(index, 0, child);
        }
        child.parentNode = this;
        return child;
    };

    Node.prototype.removeChild = function (child) {
        const index = this.childNodes.indexOf(child);
        if (index !== -1) {
            this.childNodes.splice(index, 1);
            child.parentNode = null;
        }
        return child;
    };

    function Element(tagName) {
        Node.call(this);
        this.tagName = String(tagName).toLowerCase();
        this.nodeType = 1;
        this.attributes = {};
        this.style = createStyle();
        this.classList = createClassList(this);
        this.listeners = { capture: {}, bubble: {} };
        this._text = '';
    }

    Element.prototype = Object.create(Node.prototype);
    Element.prototype.constructor = Element;

    Object.defineProperty(Element.prototype, 'children', {
        get() {
            return this.childNodes.filter(function (node) {
                return node.nodeType === 1;
            });
        }
    });

    Object.defineProperty(Element.prototype, 'textContent', {
        get() {
            if (!this.childNodes.length) {
                return this._text;
            }
            return this._text + this.childNodes.map(function (node) {
                return node.textContent || '';
            }).join('');
        },
        set(value) {
            this.childNodes.length = 0;
            this._text = value === null || value === undefined ? '' : String(value);
        }
    });

    Object.defineProperty(Element.prototype, 'className', {
        get() {
            return this.classList.toString();
        },
        set(value) {
            this.classList._names.length = 0;
            String(value).split(/\s+/).forEach(function (name) {
                if (name) {
                    this.classList.add(name);
                }
            }, this);
        }
    });

    Element.prototype.setAttribute = function (name, value) {
        this.attributes[name] = String(value);
        if (name === 'class') {
            this.className = value;
        }
    };

    Element.prototype.getAttribute = function (name) {
        if (name === 'class') {
            return this.className;
        }
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    };

    Element.prototype.removeAttribute = function (name) {
        delete this.attributes[name];
    };

    Element.prototype.hasAttribute = function (name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
    };

    Element.prototype.querySelectorAll = function (selector) {
        return collectDescendants(this, []).filter(function (node) {
            return node.nodeType === 1 && matchesSelector(node, selector);
        });
    };

    Element.prototype.querySelector = function (selector) {
        return this.querySelectorAll(selector)[0] || null;
    };

    Element.prototype.matches = function (selector) {
        return matchesSelector(this, selector);
    };

    Element.prototype.closest = function (selector) {
        let node = this;
        while (node && node.nodeType === 1) {
            if (matchesSelector(node, selector)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    };

    Element.prototype.cloneNode = function (deep) {
        const copy = new Element(this.tagName);
        copy.attributes = Object.assign({}, this.attributes);
        copy.className = this.className;
        copy._text = this._text;
        if (deep) {
            for (const child of this.childNodes) {
                copy.appendChild(child.cloneNode(true));
            }
        }
        return copy;
    };

    Element.prototype.addEventListener = function (type, listener, capture) {
        const bucket = capture ? this.listeners.capture : this.listeners.bubble;
        bucket[type] = bucket[type] || [];
        bucket[type].push(listener);
    };

    Element.prototype.removeEventListener = function (type, listener, capture) {
        const bucket = capture ? this.listeners.capture : this.listeners.bubble;
        if (!bucket[type]) {
            return;
        }
        bucket[type] = bucket[type].filter(function (candidate) {
            return candidate !== listener;
        });
    };

    // Real capture-then-bubble propagation: the quality action-sheet hook is
    // registered with capture=true on the dialog and must see a click that
    // originates on a descendant menu item.
    Element.prototype.dispatchEvent = function (event) {
        const chain = [];
        let node = this;
        while (node) {
            chain.push(node);
            node = node.parentNode;
        }

        event.target = event.target || this;
        let stopped = false;
        event.stopPropagation = function () {
            stopped = true;
        };
        event.preventDefault = event.preventDefault || function () {
            event.defaultPrevented = true;
        };

        for (let i = chain.length - 1; i >= 0 && !stopped; i--) {
            const listeners = (chain[i].listeners.capture[event.type] || []).slice();
            for (const listener of listeners) {
                event.currentTarget = chain[i];
                listener.call(chain[i], event);
            }
        }

        for (let i = 0; i < chain.length && !stopped; i++) {
            const listeners = (chain[i].listeners.bubble[event.type] || []).slice();
            for (const listener of listeners) {
                event.currentTarget = chain[i];
                listener.call(chain[i], event);
            }
        }

        return !event.defaultPrevented;
    };

    Element.prototype.focus = function () {
        this.focused = true;
    };
    Element.prototype.click = function () {
        this.dispatchEvent({ type: 'click', target: this });
    };
    Element.prototype.getClientRects = function () {
        return this.hidden ? [] : [{ width: 100, height: 20 }];
    };
    Element.prototype.getBoundingClientRect = function () {
        return { top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20 };
    };
    Element.prototype.scrollIntoView = function () {};

    const documentElement = new Element('html');
    const head = new Element('head');
    const body = new Element('body');
    documentElement.appendChild(head);
    documentElement.appendChild(body);

    const document = {
        nodeType: 9,
        documentElement: documentElement,
        head: head,
        body: body,
        scrollingElement: documentElement,
        listeners: {},
        createElement(tagName) {
            return new Element(tagName);
        },
        createEvent(type) {
            const event = { type: '', initEvent(name) { event.type = name; }, eventInterface: type };
            return event;
        },
        querySelector(selector) {
            return documentElement.querySelector(selector);
        },
        querySelectorAll(selector) {
            return documentElement.querySelectorAll(selector);
        },
        getElementById(id) {
            return documentElement.querySelectorAll('[id="' + id + '"]')[0] || null;
        },
        addEventListener(type, listener) {
            document.listeners[type] = document.listeners[type] || [];
            document.listeners[type].push(listener);
        },
        removeEventListener(type, listener) {
            if (!document.listeners[type]) {
                return;
            }
            document.listeners[type] = document.listeners[type].filter(function (candidate) {
                return candidate !== listener;
            });
        }
    };

    return { Node: Node, Element: Element, document: document, clock: clock };
}

function createLocalStorage(seed) {
    const values = Object.assign({}, seed);
    return {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
        },
        setItem(key, value) {
            values[key] = String(value);
        },
        removeItem(key) {
            delete values[key];
        },
        clear() {
            for (const key of Object.keys(values)) {
                delete values[key];
            }
        },
        _values: values
    };
}

function createFetchStub(state) {
    return function fetchStub(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const record = {
            url: url,
            init: init || null,
            method: (init && init.method) || 'GET',
            body: init ? init.body : undefined
        };
        state.fetchCalls.push(record);

        const handler = state.fetchResponders[state.fetchResponders.length - 1];
        const result = handler ? handler(record) : null;

        // A responder may describe a failure instead of a payload. Without this
        // the stub always resolved 200 + JSON, so every defensive branch in the
        // runtime -- json() rejecting, a non-2xx passthrough, a probe retrying
        // after a network error -- was unreachable from the tests.
        const isEnvelope = result !== null
            && typeof result === 'object'
            && (
                Object.prototype.hasOwnProperty.call(result, 'reject')
                || Object.prototype.hasOwnProperty.call(result, 'status')
                || Object.prototype.hasOwnProperty.call(result, 'bodyText')
                || Object.prototype.hasOwnProperty.call(result, 'ok')
            );

        if (isEnvelope && result.reject) {
            const error = result.reject instanceof Error
                ? result.reject
                : new TypeError(typeof result.reject === 'string' ? result.reject : 'Failed to fetch');
            record.rejected = error;
            return Promise.reject(error);
        }

        const status = isEnvelope && typeof result.status === 'number' ? result.status : 200;
        const ok = isEnvelope && typeof result.ok === 'boolean' ? result.ok : (status >= 200 && status < 300);
        const contentType = isEnvelope && result.contentType ? result.contentType : 'application/json';
        const payload = isEnvelope
            ? (Object.prototype.hasOwnProperty.call(result, 'body') ? result.body : null)
            : result;

        let bodyText;
        if (isEnvelope && typeof result.bodyText === 'string') {
            bodyText = result.bodyText;
        } else {
            bodyText = payload === null || payload === undefined ? '' : JSON.stringify(payload);
        }

        record.status = status;
        record.responseText = bodyText;
        return Promise.resolve({
            ok: ok,
            status: status,
            url: url,
            headers: { get() { return contentType; } },
            clone() {
                return this;
            },
            text() {
                return Promise.resolve(bodyText);
            },
            json() {
                // Mirror the browser: json() rejects on a body that is not JSON
                // rather than resolving a parsed value the caller never sent.
                try {
                    return Promise.resolve(bodyText === '' ? null : JSON.parse(bodyText));
                } catch (error) {
                    return Promise.reject(error);
                }
            }
        });
    };
}

function createXhrClass(state) {
    function FakeXMLHttpRequest() {
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
        this.responseType = '';
        this.aborted = false;
        this.listeners = {};
        state.xhrRequests.push(this);
    }

    FakeXMLHttpRequest.UNSENT = 0;
    FakeXMLHttpRequest.OPENED = 1;
    FakeXMLHttpRequest.HEADERS_RECEIVED = 2;
    FakeXMLHttpRequest.LOADING = 3;
    FakeXMLHttpRequest.DONE = 4;

    FakeXMLHttpRequest.prototype.open = function (method, url) {
        this.method = method;
        this.url = url;
        this.readyState = 1;
    };
    FakeXMLHttpRequest.prototype.setRequestHeader = function () {};
    FakeXMLHttpRequest.prototype.send = function (body) {
        this.sent = true;
        this.requestBody = body;
    };
    FakeXMLHttpRequest.prototype.addEventListener = function (type, listener) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(listener);
    };
    FakeXMLHttpRequest.prototype.removeEventListener = function (type, listener) {
        if (!this.listeners[type]) {
            return;
        }
        this.listeners[type] = this.listeners[type].filter(function (candidate) {
            return candidate !== listener;
        });
    };
    FakeXMLHttpRequest.prototype.dispatch = function (type) {
        const listeners = (this.listeners[type] || []).slice();
        for (const listener of listeners) {
            listener.call(this, { type: type, target: this });
        }
        const inline = this['on' + type];
        if (typeof inline === 'function') {
            inline.call(this, { type: type, target: this });
        }
    };
    FakeXMLHttpRequest.prototype.abort = function () {
        this.aborted = true;
        this.readyState = 4;
        this.status = 0;
        this.dispatch('readystatechange');
        this.dispatch('abort');
        this.dispatch('loadend');
    };
    // Deliver a response the way a browser does: readystatechange(DONE) first,
    // then load/loadend. The bundle relies on that ordering to correct a
    // PlaybackInfo body before the api client's own handler sees it.
    FakeXMLHttpRequest.prototype.respond = function (status, responseText) {
        this.readyState = 4;
        this.status = status;
        this.responseText = responseText === undefined ? '' : responseText;
        this.dispatch('readystatechange');
        this.dispatch('load');
        this.dispatch('loadend');
    };

    return FakeXMLHttpRequest;
}

function createMutationObserverClass(state) {
    function FakeMutationObserver(handler) {
        this.handler = handler;
        this.targets = [];
        // Not connected until observe() is called. Starting at false let tests
        // deliver mutations to observers the bundle had merely constructed, so
        // a case could pass through an observer that never fires on a TV.
        this.disconnected = true;
        state.observers.push(this);
    }

    FakeMutationObserver.prototype.observe = function (target, config) {
        this.disconnected = false;
        this.targets.push({ target: target, config: config });
    };
    FakeMutationObserver.prototype.disconnect = function () {
        this.disconnected = true;
        this.targets = [];
    };
    FakeMutationObserver.prototype.takeRecords = function () {
        return [];
    };
    // Tests drive mutations explicitly; the harness never invents them.
    FakeMutationObserver.prototype.trigger = function (mutations) {
        this.handler(mutations || [], this);
    };

    return FakeMutationObserver;
}

function loadInjectedRuntime(options) {
    options = options || {};

    const clock = createClock(options.startTime);
    const dom = createDom(clock);
    const state = {
        fetchCalls: [],
        fetchResponders: [],
        xhrRequests: [],
        observers: [],
        messages: [],
        warnings: [],
        workers: []
    };

    const localStorage = createLocalStorage(options.localStorage);
    const FakeXMLHttpRequest = createXhrClass(state);
    const FakeMutationObserver = createMutationObserverClass(state);

    const testConsole = {
        log() {},
        warn() {
            state.warnings.push(Array.prototype.slice.call(arguments).join(' '));
        },
        error() {
            state.warnings.push(Array.prototype.slice.call(arguments).join(' '));
        }
    };

    // webOS.js installs the ASS time-sync interception by patching
    // Worker.prototype.postMessage, and returns immediately when window.Worker
    // is missing. Without this stub that whole path -- worker identification,
    // the backward-time clamp, and the destroy/terminate cleanup -- never ran
    // in any harness test, so it was covered only by a hand-copy of the wiring
    // in assTimeSync.test.js.
    function FakeWorker(scriptUrl) {
        this.scriptUrl = scriptUrl || '';
        this.posted = [];
        this.terminated = false;
        state.workers.push(this);
    }
    FakeWorker.prototype.postMessage = function (message) {
        this.posted.push(message);
    };
    FakeWorker.prototype.terminate = function () {
        this.terminated = true;
    };
    FakeWorker.prototype.addEventListener = function () {};
    FakeWorker.prototype.removeEventListener = function () {};

    const windowListeners = {};
    const window = {
        AppInfo: Object.assign({
            deviceId: 'test-device',
            deviceName: 'Test TV',
            appName: 'Jellyfin for WebOS',
            appVersion: '1.2.2'
        }, options.appInfo),
        DeviceInfo: Object.assign({ hdr10: true, dolbyVision: true }, options.deviceInfo),
        WebOSFeatureOverrides: options.featureOverrides || {},
        WebOSBridgeToken: 'test-token',
        console: testConsole,
        localStorage: localStorage,
        location: { href: 'https://server.example/web/index.html', hash: '#!/video', pathname: '/web/index.html' },
        history: { pushState() {}, replaceState() {} },
        innerWidth: 1920,
        innerHeight: 1080,
        performance: { now() { return clock.now(); } },
        Promise: Promise,
        MutationObserver: FakeMutationObserver,
        XMLHttpRequest: FakeXMLHttpRequest,
        Worker: FakeWorker,
        Node: dom.Node,
        // Chromium 68 has the URL constructor, and fetch() accepts one as its
        // input, so the bundle has to keep recognising that shape.
        URL: URL,
        addEventListener(type, listener) {
            windowListeners[type] = windowListeners[type] || [];
            windowListeners[type].push(listener);
        },
        removeEventListener(type, listener) {
            if (!windowListeners[type]) {
                return;
            }
            windowListeners[type] = windowListeners[type].filter(function (candidate) {
                return candidate !== listener;
            });
        },
        requestAnimationFrame(callback) {
            return clock.setTimeout(function () {
                callback(clock.now());
            }, 16);
        },
        cancelAnimationFrame(id) {
            clock.clearTimeout(id);
        },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval
    };

    window.window = window;
    window.document = dom.document;
    window.top = {
        postMessage(message) {
            state.messages.push(message);
        }
    };
    window.fetch = createFetchStub(state);

    // Date.now drives every playback window in the bundle, so it must follow
    // the harness clock rather than wall time.
    function FakeDate(...args) {
        if (!(this instanceof FakeDate)) {
            return new Date(clock.now()).toString();
        }
        return args.length ? new Date(...args) : new Date(clock.now());
    }
    FakeDate.now = function () {
        return clock.now();
    };
    FakeDate.parse = Date.parse;
    FakeDate.UTC = Date.UTC;
    FakeDate.prototype = Date.prototype;

    const context = {
        window: window,
        document: dom.document,
        console: testConsole,
        localStorage: localStorage,
        navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV)' },
        Date: FakeDate,
        Promise: Promise,
        MutationObserver: FakeMutationObserver,
        XMLHttpRequest: FakeXMLHttpRequest,
        Worker: FakeWorker,
        Node: dom.Node,
        URL: URL,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
        requestAnimationFrame: window.requestAnimationFrame,
        cancelAnimationFrame: window.cancelAnimationFrame,
        JSON: JSON,
        Math: Math,
        isNaN: isNaN,
        parseInt: parseInt,
        parseFloat: parseFloat,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent
    };
    context.globalThis = context;

    vm.createContext(context);
    for (const relativePath of BUNDLE_FILES) {
        const filePath = path.join(root, relativePath);
        vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
    }

    function flushPromises() {
        // The bundle's fetch path resolves through real promises; drain the
        // microtask queue between clock steps.
        return new Promise(function (resolve) {
            setImmediate(resolve);
        });
    }

    return {
        context: context,
        window: window,
        document: dom.document,
        Element: dom.Element,
        clock: clock,
        state: state,
        localStorage: localStorage,
        nativeShell: window.NativeShell,
        createElement(tagName, options) {
            const element = new dom.Element(tagName);
            if (options && options.className) {
                element.className = options.className;
            }
            if (options && options.text) {
                element.textContent = options.text;
            }
            if (options && options.attributes) {
                for (const name of Object.keys(options.attributes)) {
                    element.setAttribute(name, options.attributes[name]);
                }
            }
            return element;
        },
        respondToFetch(responder) {
            state.fetchResponders.push(responder);
        },
        isHdrDimmed() {
            return dom.document.body.classList.contains('webos-hdr-ui-dim');
        },
        flushPromises: flushPromises,
        async settle(ms) {
            await flushPromises();
            clock.tick(ms === undefined ? 0 : ms);
            await flushPromises();
        }
    };
}

// Load the injected modules in BUNDLE_FILES order, up to and including the one
// named, and return the module registry.
//
// Each module test used to hand-list its own dependency chain, so a module that
// gained a dependency had to be threaded into every list by hand -- and when it
// was not, the module under test silently degraded inside its own test instead
// of failing. Slicing the real manifest cannot drift from it.
function loadInjectedModules(moduleFileName) {
    const index = BUNDLE_FILES.findIndex(function (file) {
        return file.indexOf('/' + moduleFileName) !== -1 || file === moduleFileName;
    });
    if (index === -1) {
        throw new Error('No injected module matching ' + moduleFileName + ' in BUNDLE_FILES');
    }

    const window = {};
    const context = { window: window };
    for (const relativePath of BUNDLE_FILES.slice(0, index + 1)) {
        const filePath = path.join(root, relativePath);
        vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
    }
    return window.__JellyfinWebOSPatchRuntime;
}

module.exports = {
    loadInjectedRuntime: loadInjectedRuntime,
    loadInjectedModules: loadInjectedModules,
    createClock: createClock,
    BUNDLE_FILES: BUNDLE_FILES
};
