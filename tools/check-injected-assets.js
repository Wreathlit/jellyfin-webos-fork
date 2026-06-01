const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'frontend', 'js', 'index.js');
const indexText = fs.readFileSync(indexPath, 'utf8');

function extractArray(name) {
    const match = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];').exec(indexText);
    if (!match) {
        throw new Error('Cannot find ' + name + ' in frontend/js/index.js');
    }

    const result = [];
    const itemPattern = /['"]([^'"]+)['"]/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(match[1])) !== null) {
        result.push(itemMatch[1]);
    }
    return result;
}

function assertGitTracked(relativePath) {
    childProcess.execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
        cwd: root,
        stdio: 'ignore'
    });
}

const assets = extractArray('injectedScriptUrls').concat(extractArray('injectedStyleUrls'));
const missing = [];
const untracked = [];
const orderErrors = [];

function assertScriptBefore(first, second) {
    const firstIndex = extractArray('injectedScriptUrls').indexOf(first);
    const secondIndex = extractArray('injectedScriptUrls').indexOf(second);
    if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
        orderErrors.push(first + ' must be injected before ' + second);
    }
}

assertScriptBefore('js/injected/core/runtime.js', 'js/injected/core/features.js');
assertScriptBefore('js/injected/core/features.js', 'js/injected/playback/profilePatches.js');
assertScriptBefore('js/injected/playback/profilePatches.js', 'js/injected/playback/hdrDecisions.js');
assertScriptBefore('js/injected/playback/hdrDecisions.js', 'js/injected/playback/playbackInfoPatches.js');
assertScriptBefore('js/injected/playback/playbackInfoPatches.js', 'js/injected/subtitles/scriptPatches.js');
assertScriptBefore('js/injected/subtitles/scriptPatches.js', 'js/webOS.js');

for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const relativePath = path.join('frontend', asset).replace(/\\/g, '/');
    const absolutePath = path.join(root, relativePath);

    if (!fs.existsSync(absolutePath)) {
        missing.push(relativePath);
        continue;
    }

    try {
        assertGitTracked(relativePath);
    } catch (error) {
        untracked.push(relativePath);
    }
}

if (missing.length || untracked.length || orderErrors.length) {
    if (missing.length) {
        console.error('Missing injected asset(s):');
        for (let i = 0; i < missing.length; i++) {
            console.error('  - ' + missing[i]);
        }
    }
    if (untracked.length) {
        console.error('Untracked injected asset(s):');
        for (let j = 0; j < untracked.length; j++) {
            console.error('  - ' + untracked[j]);
        }
    }
    if (orderErrors.length) {
        console.error('Invalid injected script order:');
        for (let k = 0; k < orderErrors.length; k++) {
            console.error('  - ' + orderErrors[k]);
        }
    }
    process.exit(1);
}

console.log('Injected assets are present and tracked.');
