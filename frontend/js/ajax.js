/* 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * This file incorporates work covered by the following copyright and
 * permission notice:
 * 
 *   Copyright 2019 Simon J. Hogan
 * 
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 * 
*/

var ajax = new AJAX();

function AJAX() {};

AJAX.prototype.request = function(url, settings) {
	var method = (settings.method) ? settings.method : "GET";
	var xhr = new XMLHttpRequest();
	var aborted = false;
	// A request settles exactly once. Per the XHR spec the request error steps
	// set readyState to DONE and fire readystatechange *before* firing the
	// timeout/error event, so without this guard both the terminal branch below
	// and ontimeout/onerror reported the same failure to the caller.
	var settled = false;

	function succeed(payload) {
		if (settled) {
			return;
		}
		settled = true;
		if (!settings.success) {
			return;
		}

		try {
			settings.success(payload);
		} catch (error) {
			// The handler threw after the request itself succeeded. Reporting
			// this as a transport or JSON failure would mislabel it -- a
			// SyntaxError from the handler used to surface as "the server did
			// not return valid JSON data" -- but swallowing it entirely leaves
			// the caller stuck on its busy screen with nothing to react to, so
			// hand back a reason that names what actually happened.
			console.error(error);
			if (settings.error) {
				settings.error({error: "The server response could not be processed."});
			}
		}
	}

	function fail(payload) {
		if (settled) {
			return;
		}
		settled = true;
		if (settings.error) {
			settings.error(payload);
		}
	}

	function cancel(payload) {
		if (settled) {
			return;
		}
		settled = true;
		if (settings.abort) {
			settings.abort(payload);
		}
	}

	// Report a setup failure asynchronously: callers assign the return value
	// to their in-flight request handle, and settling before that assignment
	// would let the handler's cleanup be overwritten by a stale handle.
	function failAsync(payload) {
		setTimeout(function () {
			fail(payload);
		}, 0);
	}

	try {
		xhr.open(method, url);

		if (settings.headers) {
			for (var h in settings.headers) {
				if (settings.headers.hasOwnProperty(h)) {
					xhr.setRequestHeader(h, settings.headers[h]);
				}
			}
		}

		if (settings.timeout) {
			xhr.timeout = settings.timeout;
		}
	} catch (error) {
		// An address can pass the caller's loose validation and still be
		// rejected by the URL parser -- a bare IPv6 literal, an empty host, a
		// non-numeric port. open() throws synchronously for those, which used
		// to escape as an uncaught exception from the click handler and strand
		// the "Connecting..." screen with no message and no recovery.
		console.error(error);
		failAsync({error: "Could not parse the server address. Check it for typos, and wrap IPv6 addresses in square brackets."});
		return xhr;
	}

	xhr.ontimeout = function (event) {
		fail({error: "timeout"});
	}

	xhr.onerror = function (event) {
		fail({error: event.target.status});
	}

	xhr.onabort = function (event) {
		cancel({error: "abort"});
	}

	xhr.onreadystatechange = function () {
		// abort() moves readyState to DONE and fires readystatechange with
		// status 0 *before* the abort event. Without this guard the terminal
		// branch below reports a generic transport failure ("are you connecting
		// to a Jellyfin Server?") that settings.abort has no way to take back,
		// so cancelling a connection attempt showed an error about the server.
		if (aborted) {
			return;
		}

		if (xhr.readyState == XMLHttpRequest.DONE) {
			if (xhr.status == 200) {
				var payload;
				try {
					payload = JSON.parse(xhr.responseText);
				} catch (error) {
					console.error(error);
					fail({error: "The server did not return valid JSON data."});
					return;
				}
				succeed(payload);
            } else if (xhr.status == 204) {
                succeed({success: true});
            } else if (xhr.status === 0) {
                // Status 0 at DONE means the transport failed, and the spec
                // fires this readystatechange *before* the event that says
                // which failure it was. Settling here would claim the generic
                // slot first and silence ontimeout's specific message, turning
                // every unreachable-server timeout into "Unknown error".
                // Defer so the specific handler settles first; this only lands
                // if none of them does.
                failAsync({error: 0});
            } else {
                fail({error: xhr.status});
			}
        }
	}

	// Callers abort through the returned object, so mark the request as
	// cancelled before the native abort() dispatches its events.
	var nativeAbort = xhr.abort;
	xhr.abort = function () {
		aborted = true;
		return nativeAbort.apply(xhr, arguments);
	};

	try {
		if (settings.data) {
			xhr.send(JSON.stringify(settings.data));
		} else {
			xhr.send();
		}
	} catch (error) {
		// send() throws on a blocked scheme or unserializable body.
		console.error(error);
		failAsync({error: "The request could not be sent."});
	}
	return xhr;
};
