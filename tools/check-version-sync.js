#!/usr/bin/env node

// Asserts package.json and frontend/appinfo.json carry the same version.
//
// tools/sync-version.js only runs from the `version` npm lifecycle hook, so it
// is skipped whenever the version is edited by hand or a release is cut by
// tagging directly. The two files then drift silently, and the drift is not
// visible until after release: ares-package names the ipk from the appinfo
// version and gen-manifest reads the same file, so a v1.3.0 tag can ship a
// 1.2.2 ipk and manifest -- and clients that decide "is there an update?" from
// the manifest version never see the release at all.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

const packageVersion = readJson('package.json').version;
const appInfoVersion = readJson('frontend/appinfo.json').version;

if (packageVersion !== appInfoVersion) {
    console.error(
        'Version mismatch:\n'
        + '  package.json        ' + packageVersion + '\n'
        + '  frontend/appinfo.json ' + appInfoVersion + '\n\n'
        + 'Run `npm version <new-version>` so tools/sync-version.js updates both,\n'
        + 'or edit frontend/appinfo.json to match.'
    );
    process.exit(1);
}

// appinfo requires x.y.z with non-negative integers; ares-package rejects
// anything else, and it is the version users see in the TV app list.
if (!/^\d+\.\d+\.\d+$/.test(appInfoVersion)) {
    console.error('frontend/appinfo.json version must be x.y.z, got: ' + appInfoVersion);
    process.exit(1);
}

console.log('Version sync check passed (' + packageVersion + ').');
