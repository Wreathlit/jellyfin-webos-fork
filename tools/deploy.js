#!/usr/bin/env node

// Installs the packaged ipk on the connected TV.
//
// This exists because the npm script it replaced used `${npm_package_version}`,
// POSIX shell syntax that cmd.exe does not expand. npm runs scripts through
// cmd.exe on Windows by default, so `npm run deploy` handed ares-install a
// literal `${npm_package_version}` and always failed -- on the very platform
// this repository is developed on.
//
// The version comes from frontend/appinfo.json rather than package.json:
// ares-package names the ipk after the appinfo version, so that is the one that
// matches the file on disk even if the two ever drift.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appInfoPath = path.join(root, 'frontend', 'appinfo.json');
const appInfo = JSON.parse(fs.readFileSync(appInfoPath, 'utf8'));
const ipkName = appInfo.id + '_' + appInfo.version + '_all.ipk';

const outDir = process.argv[2] || 'build';
const ipkPath = path.join(root, outDir, ipkName);

if (!fs.existsSync(ipkPath)) {
    console.error('Package not found: ' + path.relative(root, ipkPath).replace(/\\/g, '/'));
    console.error('Run `npm run package` first, or pass the output directory: npm run deploy -- build-local');
    process.exit(1);
}

const result = childProcess.spawnSync('ares-install', [ipkPath], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});

if (result.error) {
    console.error('Failed to run ares-install:', result.error.message);
    process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
