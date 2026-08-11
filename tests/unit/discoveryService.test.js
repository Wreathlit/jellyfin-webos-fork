const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const servicePath = path.join(root, 'services', 'service.js');

function loadDiscoveryService() {
    const handlers = {};
    const socketListeners = {};
    const sendCalls = [];
    const intervalCallbacks = [];
    const clearedIntervals = [];

    function FakeService() {}
    FakeService.prototype.register = function (name) {
        handlers[name] = handlers[name] || {};
        return {
            on(eventName, listener) {
                handlers[name][eventName] = listener;
            }
        };
    };

    const socket = {
        on(eventName, listener) {
            socketListeners[eventName] = listener;
        },
        bind(options, listener) {
            this.bindOptions = options;
            this.bindListener = listener;
        },
        send() {
            sendCalls.push(Array.prototype.slice.call(arguments));
        },
        address() {
            return { address: '0.0.0.0', port: 7359 };
        },
        setBroadcast() {},
        setMulticastTTL() {}
    };

    const context = {
        Buffer: Buffer,
        console: {
            log() {},
            warn() {},
            error() {}
        },
        setInterval(callback, delay) {
            const interval = { callback: callback, delay: delay };
            intervalCallbacks.push(interval);
            return interval;
        },
        clearInterval(interval) {
            clearedIntervals.push(interval);
        },
        require(name) {
            if (name === './package.json') {
                return { name: 'org.jellyfin.webos.service' };
            }
            if (name === 'webos-service') {
                return FakeService;
            }
            if (name === 'dgram') {
                return {
                    createSocket() {
                        return socket;
                    }
                };
            }
            return require(name);
        }
    };

    vm.runInNewContext(fs.readFileSync(servicePath, 'utf8'), context, {
        filename: servicePath
    });

    return {
        context: context,
        handlers: handlers,
        socketListeners: socketListeners,
        sendCalls: sendCalls,
        intervalCallbacks: intervalCallbacks,
        clearedIntervals: clearedIntervals
    };
}

{
    const service = loadDiscoveryService();
    const responses = [];
    service.context.scanresult.cached = {
        Id: 'cached',
        Name: 'Cached Server',
        Address: 'http://192.0.2.10:8096',
        source: { address: '192.0.2.10', port: 7359 },
        lastSeen: Date.now()
    };

    service.handlers.discover.request({
        uniqueToken: 'one-shot',
        isSubscription: false,
        respond(payload) {
            responses.push(payload);
        }
    });

    assert.strictEqual(responses.length, 1, 'a one-shot request must receive an immediate response');
    assert.strictEqual(responses[0].returnValue, true);
    assert.strictEqual(responses[0].results.cached.Name, 'Cached Server');
    assert.strictEqual(Object.keys(service.context.subscriptions).length, 0);
    assert.strictEqual(service.sendCalls.length, 1, 'the request should still refresh the discovery cache');
}

{
    const service = loadDiscoveryService();
    const responses = [];
    const subscription = {
        uniqueToken: 'subscriber',
        isSubscription: true,
        respond(payload) {
            responses.push(payload);
        }
    };

    service.handlers.discover.request(subscription);

    assert.strictEqual(responses.length, 1, 'a new subscription must receive an initial response');
    assert.strictEqual(responses[0].returnValue, true);
    assert.strictEqual(service.context.subscriptions.subscriber, subscription);
    assert.strictEqual(service.intervalCallbacks.length, 1, 'the first subscription should start periodic discovery');

    service.context.handleDiscoveryResponse(Buffer.from(JSON.stringify({
        Id: 'fresh',
        Name: 'Fresh Server',
        Address: 'http://192.0.2.20:8096'
    })), {
        address: '192.0.2.20',
        port: 7359
    });

    assert.strictEqual(responses.length, 2, 'a subscribed request should receive later discovery updates');
    assert.strictEqual(responses[1].returnValue, true);
    assert.strictEqual(responses[1].results.fresh.Name, 'Fresh Server');

    service.handlers.discover.cancel(subscription);
    assert.strictEqual(Object.keys(service.context.subscriptions).length, 0);
    assert.strictEqual(service.clearedIntervals.length, 1, 'the final cancellation should stop periodic discovery');
}
