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

if (missing.length || untracked.length) {
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
    process.exit(1);
}

console.log('Injected assets are present and tracked.');
