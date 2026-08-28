const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'frontend', 'js', 'index.js');
const indexText = fs.readFileSync(indexPath, 'utf8');

// Drop comments while keeping string literals intact. check-baseline's
// stripNonCode blanks strings too, and the manifest entries *are* the strings,
// so this only runs over an already-extracted array body -- a region that holds
// nothing but strings, commas and comments, and therefore cannot contain a
// regex literal for the '//' scan to trip over.
function stripCommentsFromArrayBody(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];

        if (ch === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') {
                i++;
            }
            continue;
        }

        if (ch === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
                i++;
            }
            i += 2;
            continue;
        }

        if (ch === "'" || ch === '"') {
            const quote = ch;
            out += ch;
            i++;
            while (i < source.length) {
                if (source[i] === '\\') {
                    out += source[i] + (source[i + 1] || '');
                    i += 2;
                    continue;
                }
                out += source[i];
                const closed = source[i] === quote;
                i++;
                if (closed) {
                    break;
                }
            }
            continue;
        }

        out += ch;
        i++;
    }
    return out;
}

function extractArray(name) {
    const match = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];').exec(indexText);
    if (!match) {
        throw new Error('Cannot find ' + name + ' in frontend/js/index.js');
    }

    // Without stripping comments first, an entry commented out during debugging
    // still satisfied every check here -- the file exists, is tracked, and keeps
    // its slot in the order assertions -- while the TV never loaded it and the
    // module chain broke at runtime.
    const body = stripCommentsFromArrayBody(match[1]);
    const result = [];
    const itemPattern = /['"]([^'"]+)['"]/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(body)) !== null) {
        result.push(itemMatch[1]);
    }
    return result;
}

// Walk frontend/js/injected for the reverse direction: every module on disk
// must appear in the manifest. A new file that nobody registered ships inside
// the ipk and is simply never injected, with no error anywhere.
function listInjectedModules(dir, prefix, out) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        const relative = prefix + entry.name;
        if (entry.isDirectory()) {
            listInjectedModules(absolute, relative + '/', out);
        } else if (entry.isFile() && /\.js$/i.test(entry.name)) {
            out.push(relative);
        }
    }
    return out;
}

function assertGitTracked(relativePath) {
    childProcess.execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
        cwd: root,
        stdio: 'ignore'
    });
}

const injectedScriptUrls = extractArray('injectedScriptUrls');
const injectedStyleUrls = extractArray('injectedStyleUrls');
const assets = injectedScriptUrls.concat(injectedStyleUrls);
const missing = [];
const untracked = [];
const orderErrors = [];

const injectedRoot = path.join(root, 'frontend', 'js', 'injected');
const unregistered = listInjectedModules(injectedRoot, 'js/injected/', [])
    .filter((relative) => injectedScriptUrls.indexOf(relative) === -1);

// Same reverse direction for the injected stylesheet. It is a fixed one-entry
// list rather than a directory, so assert the entry itself is still there:
// commenting it out passes every other check while the TV loses all fork CSS.
const REQUIRED_STYLE_URLS = ['css/webOS.css'];
const missingStyles = REQUIRED_STYLE_URLS
    .filter((required) => injectedStyleUrls.indexOf(required) === -1);

function assertScriptBefore(first, second) {
    const firstIndex = injectedScriptUrls.indexOf(first);
    const secondIndex = injectedScriptUrls.indexOf(second);
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

if (missing.length || untracked.length || orderErrors.length || unregistered.length || missingStyles.length) {
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
    if (unregistered.length) {
        console.error('Injected module(s) missing from injectedScriptUrls in frontend/js/index.js:');
        for (let m = 0; m < unregistered.length; m++) {
            console.error('  - ' + unregistered[m]);
        }
    }
    if (missingStyles.length) {
        console.error('Required stylesheet(s) missing from injectedStyleUrls in frontend/js/index.js:');
        for (let n = 0; n < missingStyles.length; n++) {
            console.error('  - ' + missingStyles[n]);
        }
    }
    process.exit(1);
}

console.log('Injected assets are present and tracked.');
