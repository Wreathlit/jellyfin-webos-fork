const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const ajaxPath = path.join(root, 'frontend', 'js', 'ajax.js');
const ajaxSource = fs.readFileSync(ajaxPath, 'utf8');

function loadAjax() {
    const requests = [];
    const testConsole = {
        log() {},
        warn() {},
        error() {}
    };

    function FakeXMLHttpRequest() {
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
        this.aborted = false;
        requests.push(this);
    }

    FakeXMLHttpRequest.DONE = 4;
    FakeXMLHttpRequest.prototype.open = function (method, url) {
        this.method = method;
        this.url = url;
        this.readyState = 1;
    };
    FakeXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        this.headers = this.headers || {};
        this.headers[name] = value;
    };
    FakeXMLHttpRequest.prototype.send = function (body) {
        this.body = body;
        this.sent = true;
    };

    // Mirror the browser: abort() moves readyState to DONE with status 0 and
    // dispatches readystatechange *before* the abort event.
    FakeXMLHttpRequest.prototype.abort = function () {
        this.aborted = true;
        this.readyState = FakeXMLHttpRequest.DONE;
        this.status = 0;
        if (this.onreadystatechange) {
            this.onreadystatechange();
        }
        if (this.onabort) {
            this.onabort({ target: this });
        }
    };

    FakeXMLHttpRequest.prototype.respond = function (status, responseText) {
        this.readyState = FakeXMLHttpRequest.DONE;
        this.status = status;
        this.responseText = responseText === undefined ? '' : responseText;
        if (this.onreadystatechange) {
            this.onreadystatechange();
        }
    };

    const context = {
        XMLHttpRequest: FakeXMLHttpRequest,
        console: testConsole
    };

    vm.runInNewContext(ajaxSource, context, { filename: ajaxPath });

    return { context: context, requests: requests };
}

function createRecordingSettings(extra) {
    const calls = [];
    const settings = {
        method: 'GET',
        timeout: 5000,
        success(data) {
            calls.push({ type: 'success', data: data });
        },
        error(data) {
            calls.push({ type: 'error', data: data });
        },
        abort(data) {
            calls.push({ type: 'abort', data: data });
        }
    };

    if (extra) {
        for (const key of Object.keys(extra)) {
            settings[key] = extra[key];
        }
    }

    return { settings: settings, calls: calls };
}

{
    // Aborting a connection attempt must report exactly one abort and no
    // transport error. The DONE branch fires first with status 0, and the
    // shell's handleFailure turns error:0 into "are you connecting to a
    // Jellyfin Server?" — a message the later abort callback cannot retract.
    const ajaxRuntime = loadAjax();
    const recorder = createRecordingSettings();

    const request = ajaxRuntime.context.ajax.request('https://server.example/System/Info/Public', recorder.settings);
    request.abort();

    assert.deepStrictEqual(
        recorder.calls.map(function (call) {
            return call.type;
        }),
        ['abort'],
        'an aborted request must not also report a transport error'
    );
    assert.strictEqual(recorder.calls[0].data.error, 'abort');
    assert.strictEqual(ajaxRuntime.requests[0].aborted, true, 'the native abort must still run');
}

{
    // The abort guard must not swallow a response that arrives normally.
    const ajaxRuntime = loadAjax();
    const recorder = createRecordingSettings();

    ajaxRuntime.context.ajax.request('https://server.example/System/Info/Public', recorder.settings);
    ajaxRuntime.requests[0].respond(200, JSON.stringify({ ProductName: 'Jellyfin Server' }));

    assert.strictEqual(recorder.calls.length, 1);
    assert.strictEqual(recorder.calls[0].type, 'success');
    assert.strictEqual(recorder.calls[0].data.ProductName, 'Jellyfin Server');
}

{
    const ajaxRuntime = loadAjax();
    const recorder = createRecordingSettings();

    ajaxRuntime.context.ajax.request('https://server.example/System/Info/Public', recorder.settings);
    ajaxRuntime.requests[0].respond(500, '');

    assert.strictEqual(recorder.calls.length, 1);
    assert.strictEqual(recorder.calls[0].type, 'error');
    assert.strictEqual(recorder.calls[0].data.error, 500, 'HTTP failures must keep reporting their status');
}

{
    // A response body that is not JSON must be reported as such rather than as
    // a generic failure.
    const ajaxRuntime = loadAjax();
    const recorder = createRecordingSettings();

    ajaxRuntime.context.ajax.request('https://server.example/System/Info/Public', recorder.settings);
    ajaxRuntime.requests[0].respond(200, '<html>not jellyfin</html>');

    assert.strictEqual(recorder.calls.length, 1);
    assert.strictEqual(recorder.calls[0].type, 'error');
    assert.strictEqual(recorder.calls[0].data.error, 'The server did not return valid JSON data.');
}

{
    // A request aborted after it already completed must not retroactively
    // suppress the delivered result.
    const ajaxRuntime = loadAjax();
    const recorder = createRecordingSettings();

    const request = ajaxRuntime.context.ajax.request('https://server.example/System/Info/Public', recorder.settings);
    ajaxRuntime.requests[0].respond(204);
    request.abort();

    assert.strictEqual(recorder.calls[0].type, 'success');
    assert.strictEqual(recorder.calls[0].data.success, true);
}
