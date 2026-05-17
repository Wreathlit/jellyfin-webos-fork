// -*- coding: utf-8 -*-

/*
 * Backend node.js service for server autodiscovery.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var pkgInfo = require('./package.json');
var Service = require('webos-service');
var net = require('net');
var url = require('url');

// Register com.yourdomain.@DIR@.service, on both buses
var service = new Service(pkgInfo.name);

var DEBUG_LOG = false;
function log() {
	if (DEBUG_LOG && typeof console !== 'undefined' && console.log) {
		console.log.apply(console, arguments);
	}
}

// Discovery responses arrive over unauthenticated UDP broadcast and are
// attacker-influenceable; validate them before storing or forwarding to the UI.
var MAX_SCAN_RESULTS = 64;
var MAX_SCAN_RESULTS_PER_SOURCE = 8;
var UNSAFE_MAP_KEYS = {
	'__proto__': true,
	'constructor': true,
	'hasOwnProperty': true,
	'prototype': true,
	'toString': true,
	'valueOf': true
};

function hasOwn(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function isSafeMapKey(value) {
	return typeof value === 'string'
		&& value.length > 0
		&& value.length <= 256
		&& !UNSAFE_MAP_KEYS[value]
		&& !/[\u0000-\u001f\u007f]/.test(value);
}

function isValidServerAddress(address) {
	if (typeof address !== 'string' || address.length === 0 || address.length > 2048) {
		return false;
	}

	// Require a plain http(s) origin: scheme + host(:port), optional path,
	// no embedded credentials ('@') and no whitespace.
	if (/[\u0000-\u001f\u007f\s@\\]/.test(address)) {
		return false;
	}

	var authorityMatch = /^https?:\/\/([^\/?#]+)/i.exec(address);
	if (!authorityMatch || !authorityMatch[1]) {
		return false;
	}
	var authority = authorityMatch[1];
	if (authority.charAt(0) === '[') {
		var ipv6End = authority.indexOf(']');
		var ipv6Rest = ipv6End >= 0 ? authority.substring(ipv6End + 1) : '';
		if (ipv6End <= 0 || (ipv6Rest && !/^:\d+$/.test(ipv6Rest))) {
			return false;
		}
	} else if (authority.indexOf(':') !== -1 && !/^[^:]+:\d+$/.test(authority)) {
		return false;
	}

	var parsed = url.parse(address);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return false;
	}
	if (!parsed.hostname || !parsed.host || parsed.auth || parsed.hash) {
		return false;
	}
	if (parsed.search || parsed.query) {
		return false;
	}
	if (authority.charAt(0) === '[' && net.isIP(parsed.hostname) !== 6) {
		return false;
	}
	if (parsed.hostname.length > 253) {
		return false;
	}
	if (parsed.port) {
		var port = parseInt(parsed.port, 10);
		if (!/^\d+$/.test(parsed.port) || port <= 0 || port > 65535) {
			return false;
		}
	}

	return true;
}

var dgram = require('dgram');
var client4 = dgram.createSocket("udp4");

// var client6;
// try {
// 	client6 = dgram.createSocket("udp6");
// } catch (err) {
// 	log(err);
// 	client6 = false;
// }

const JELLYFIN_DISCOVERY_PORT = 7359;
const JELLYFIN_DISCOVERY_MESSAGE = "who is JellyfinServer?";

const SCAN_INTERVAL = 15 * 1000;
const SCAN_RESULT_TTL = 5 * SCAN_INTERVAL;
const SCAN_ON_START = true;

var scanresult = Object.create(null);

function createResultMap() {
	return Object.create(null);
}

function pruneScanResults() {
	var now = Date.now();
	for (var serverId in scanresult) {
		if (!hasOwn(scanresult, serverId)) {
			continue;
		}

		var server = scanresult[serverId];
		if (!server || typeof server.lastSeen !== 'number' || (now - server.lastSeen) > SCAN_RESULT_TTL) {
			delete scanresult[serverId];
		}
	}
}

function evictOldestScanResult() {
	var oldestServerId = null;
	var oldestLastSeen = Infinity;

	for (var serverId in scanresult) {
		if (!hasOwn(scanresult, serverId)) {
			continue;
		}

		var server = scanresult[serverId];
		var lastSeen = server && typeof server.lastSeen === 'number' ? server.lastSeen : 0;
		if (lastSeen < oldestLastSeen) {
			oldestLastSeen = lastSeen;
			oldestServerId = serverId;
		}
	}

	if (oldestServerId !== null) {
		delete scanresult[oldestServerId];
		return true;
	}

	return false;
}

function countScanResultsForSource(address) {
	var count = 0;
	for (var serverId in scanresult) {
		if (!hasOwn(scanresult, serverId)) {
			continue;
		}

		var server = scanresult[serverId];
		if (server && server.source && server.source.address === address) {
			count++;
		}
	}
	return count;
}

function sendScanResults(server_id) {
	pruneScanResults();
	log("Sending responses, subscription count=" + Object.keys(subscriptions).length);
	for (var i in subscriptions) {
		if (hasOwn(subscriptions, i)) {
			var s = subscriptions[i];
			if (server_id) {
				if (!hasOwn(scanresult, server_id)) {
					continue;
				}
				var res = createResultMap();
				res[server_id] = scanresult[server_id];
				s.respond({
					results: res
				});
			} else {
			s.respond({
				results: scanresult,
			});
			}
		}
	}
}

function handleDiscoveryResponse(message, remote) {
	try {
		var msg = JSON.parse(message.toString('utf-8'));

		if (typeof msg == "object" && msg !== null &&
			isSafeMapKey(msg.Id) &&
			typeof msg.Name == "string" && msg.Name.length <= 256 &&
			typeof msg.Address == "string" && isValidServerAddress(msg.Address)) {

			var isNewServerId = !hasOwn(scanresult, msg.Id);
			if (isNewServerId && countScanResultsForSource(remote.address) >= MAX_SCAN_RESULTS_PER_SOURCE) {
				return;
			}

			if (isNewServerId && Object.keys(scanresult).length >= MAX_SCAN_RESULTS) {
				pruneScanResults();
				if (Object.keys(scanresult).length >= MAX_SCAN_RESULTS) {
					evictOldestScanResult();
				}
			}

			scanresult[msg.Id] = {
				Id: msg.Id,
				Name: msg.Name,
				Address: msg.Address
			};
			scanresult[msg.Id].source = {
				address: remote.address,
				port: remote.port,
			};
			scanresult[msg.Id].lastSeen = Date.now();

			sendScanResults(msg.Id);
		}
	} catch (err) {
		log(err);
	}
}

function sendJellyfinDiscovery() {
	var msg = Buffer.from(JELLYFIN_DISCOVERY_MESSAGE);
	client4.send(msg, 0, msg.length, 7359, "255.255.255.255");

	// if (client6) {
	// 	client6.send(msg, 0, msg.length, 7359, "ff08::1"); // All organization-local nodes
	// }

}

function discoverInitial() {
	if (SCAN_ON_START) {
		sendJellyfinDiscovery();
	}
}

client4.on("listening", function () {
	var address = client4.address();
	log('UDP Client listening on ' + address.address + ":" + address.port);
	client4.setBroadcast(true)
	client4.setMulticastTTL(128);
	//client.addMembership('230.185.192.108');
});

client4.on("message", handleDiscoveryResponse);
client4.bind({
	port: JELLYFIN_DISCOVERY_PORT
}, discoverInitial);


// if (client6) {
// 	client6.on("listening", function () {
// 		var address = client4.address();
// 		log('UDP Client listening on ' + address.address + ":" + address.port);
// 		client6.setMulticastTTL(128);
// 		//client.addMembership('230.185.192.108');
// 	});

// 	client6.on("message", handleDiscoveryResponse);

// 	try { // client6 bind failing even in a try catch.
// 		//client6.bind(JELLYFIN_DISCOVERY_PORT, discoverInitial);
// 	} catch (err) {
// 		log(err);
// 	}
// }


var interval;
var subscriptions = Object.create(null);

function createInterval() {
	if (interval) {
		return;
	}
	log("create new interval");
	interval = setInterval(function () {
		sendJellyfinDiscovery();
	}, SCAN_INTERVAL);
}

var discover = service.register("discover");
discover.on("request", function (message) {
	sendScanResults();
	var uniqueToken = message.uniqueToken;
	log("discover callback, uniqueToken: " + uniqueToken + ", token: " + message.token);

	sendJellyfinDiscovery();

	if (message.isSubscription) {
		subscriptions[uniqueToken] = message;
		if (!interval) {
			createInterval();
		}
	}
});
discover.on("cancel", function (message) {
	var uniqueToken = message.uniqueToken;
	log("Canceled " + uniqueToken);
	delete subscriptions[uniqueToken];
	var keys = Object.keys(subscriptions);
	if (keys.length === 0) {
		log("no more subscriptions, canceling interval");
		clearInterval(interval);
		interval = undefined;
	}
});
