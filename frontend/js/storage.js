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

var storage = new STORAGE();

function STORAGE() {};

function getLocalStorage() {
	try {
		if (typeof window !== 'undefined' && window.localStorage) {
			return window.localStorage;
		}
	} catch (error) {
		// ignore inaccessible storage
	}

	return null;
}

STORAGE.prototype.get = function(name, isJSON) {	
	if (isJSON === undefined) {
		isJSON = true;	
	}

	var localStorageRef = getLocalStorage();
	if (!localStorageRef) {
		return;
	}

	var rawValue = localStorageRef.getItem(name);
	if (rawValue === null) {
		return;
	}

	if (isJSON) {
		try {
			return JSON.parse(rawValue);
		} catch (error) {
			console.warn('Failed to parse localStorage value for key:', name);
			return;
		}
	}

	return rawValue;
};

STORAGE.prototype.set = function(name, data, isJSON) {
	if (isJSON === undefined) {
		isJSON = true;	
	}

	var localStorageRef = getLocalStorage();
	if (!localStorageRef) {
		return data;
	}

	try {
		if (isJSON) {
			localStorageRef.setItem(name, JSON.stringify(data));
		} else {
			localStorageRef.setItem(name, data);
		}
	} catch (error) {
		console.warn('Failed to save localStorage value for key:', name);
	}
	
	return data;
};

STORAGE.prototype.remove = function(name) {
	var localStorageRef = getLocalStorage();
	if (localStorageRef) {
		localStorageRef.removeItem(name);	
	}	
};

STORAGE.prototype.exists = function(name) {
	var localStorageRef = getLocalStorage();
	if (localStorageRef && localStorageRef.getItem(name) !== null) {
		return true;
	}	
	return false;
};
