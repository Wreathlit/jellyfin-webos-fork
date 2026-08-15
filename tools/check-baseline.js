#!/usr/bin/env node

// Enforces the browser baseline for code that ships to the TV.
//
// package.json builds with `ares-package --no-minify` and there is no transpile
// step: the app runs exactly what is authored here. So every file under
// frontend/ must parse and run on the oldest supported engine.
//
//   Baseline: webOS 5.0  ==  Chromium 68  ==  ES2018
//
// `npm run check:syntax` cannot catch a violation — it shells out to
// `node --check`, and Node 22 accepts `?.` and `??` without complaint. A file
// using them passes CI green and then white-screens on the TV, because the
// failure is a parse error at load time.
//
// This is a lexical scan, not a parser. It strips comments, strings and regex
// literals, then looks for constructs and builtins that Chromium 68 lacks. It
// catches the common accidents; it is not a proof of compatibility. When a new
// hazard shows up, widen the table below rather than trusting the absence of
// output.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Only first-party code that ships inside the frontend. The vendored
// webOSTVjs SDK is shipped as delivered by LG and is not ours to police.
const SCAN_ROOTS = ['frontend'];
const IGNORED_PATH_PATTERN = /(^|[\\/])webOSTVjs-/;

const BANNED = [
    // Syntax — a violation here is a parse error, so the whole file dies.
    { pattern: /\?\.(?!\d)/g, label: 'optional chaining `?.`', since: 'Chromium 80' },
    { pattern: /\?\?=/g, label: 'logical assignment `??=`', since: 'Chromium 85' },
    { pattern: /\|\|=/g, label: 'logical assignment `||=`', since: 'Chromium 85' },
    { pattern: /&&=/g, label: 'logical assignment `&&=`', since: 'Chromium 85' },
    { pattern: /\?\?/g, label: 'nullish coalescing `??`', since: 'Chromium 80' },
    { pattern: /(^|[^\w$.])#[A-Za-z_$]/g, label: 'private class field `#name`', since: 'Chromium 74' },
    { pattern: /\bstatic\s*\{/g, label: 'class static initialization block', since: 'Chromium 94' },

    // Builtins — a violation here is a TypeError at the call site, so it only
    // breaks the feature that touches it. Still a white screen if it runs at
    // startup.
    { pattern: /\bglobalThis\b/g, label: '`globalThis`', since: 'Chromium 71' },
    { pattern: /\bqueueMicrotask\s*\(/g, label: '`queueMicrotask()`', since: 'Chromium 71' },
    { pattern: /\bObject\.fromEntries\b/g, label: '`Object.fromEntries()`', since: 'Chromium 73' },
    { pattern: /\bObject\.hasOwn\b/g, label: '`Object.hasOwn()`', since: 'Chromium 93' },
    { pattern: /\bPromise\.allSettled\b/g, label: '`Promise.allSettled()`', since: 'Chromium 76' },
    { pattern: /\bPromise\.any\b/g, label: '`Promise.any()`', since: 'Chromium 85' },
    { pattern: /\bstructuredClone\s*\(/g, label: '`structuredClone()`', since: 'Chromium 98' },
    { pattern: /\.flat\s*\(/g, label: '`Array.prototype.flat()`', since: 'Chromium 69' },
    { pattern: /\.flatMap\s*\(/g, label: '`Array.prototype.flatMap()`', since: 'Chromium 69' },
    { pattern: /\.matchAll\s*\(/g, label: '`String.prototype.matchAll()`', since: 'Chromium 73' },
    { pattern: /\.replaceAll\s*\(/g, label: '`String.prototype.replaceAll()`', since: 'Chromium 85' },
    { pattern: /\.findLast(Index)?\s*\(/g, label: '`Array.prototype.findLast()`', since: 'Chromium 97' },
    { pattern: /\.at\s*\(/g, label: '`Array.prototype.at()`', since: 'Chromium 92' }
];

// A `/` opens a regex literal only where a value cannot already have ended.
const REGEX_ALLOWED_AFTER = /[(,=:[!&|?{};+\-*%~^<>]$/;
const REGEX_ALLOWED_KEYWORDS = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

// Replace every non-code region with spaces, preserving newlines so reported
// line numbers still match the original file.
function stripNonCode(source) {
    let out = '';
    let index = 0;
    let lastSignificant = '';

    function blank(text) {
        return text.replace(/[^\n]/g, ' ');
    }

    while (index < source.length) {
        const rest = source.slice(index);

        if (rest.startsWith('//')) {
            const end = source.indexOf('\n', index);
            const stop = end === -1 ? source.length : end;
            out += blank(source.slice(index, stop));
            index = stop;
            continue;
        }

        if (rest.startsWith('/*')) {
            const end = source.indexOf('*/', index + 2);
            const stop = end === -1 ? source.length : end + 2;
            out += blank(source.slice(index, stop));
            index = stop;
            continue;
        }

        const char = source[index];

        if (char === '"' || char === '\'' || char === '`') {
            let cursor = index + 1;
            while (cursor < source.length) {
                if (source[cursor] === '\\') {
                    cursor += 2;
                    continue;
                }
                if (source[cursor] === char) {
                    cursor++;
                    break;
                }
                cursor++;
            }
            out += blank(source.slice(index, cursor));
            index = cursor;
            lastSignificant = 'x';
            continue;
        }

        if (char === '/'
            && (lastSignificant === ''
                || REGEX_ALLOWED_AFTER.test(lastSignificant)
                || REGEX_ALLOWED_KEYWORDS.test(lastSignificant))) {
            let cursor = index + 1;
            let inClass = false;
            let closed = false;
            while (cursor < source.length) {
                const current = source[cursor];
                if (current === '\\') {
                    cursor += 2;
                    continue;
                }
                if (current === '\n') {
                    break;
                }
                if (current === '[') {
                    inClass = true;
                } else if (current === ']') {
                    inClass = false;
                } else if (current === '/' && !inClass) {
                    cursor++;
                    closed = true;
                    break;
                }
                cursor++;
            }

            if (closed) {
                // Include trailing flags so `/re/g` does not leave a stray `g`.
                while (cursor < source.length && /[a-z]/.test(source[cursor])) {
                    cursor++;
                }
                out += blank(source.slice(index, cursor));
                index = cursor;
                lastSignificant = 'x';
                continue;
            }
        }

        out += char;
        index++;
        if (!/\s/.test(char)) {
            lastSignificant += char;
            if (lastSignificant.length > 16) {
                lastSignificant = lastSignificant.slice(-16);
            }
        }
    }

    return out;
}

function findViolations(source) {
    const code = stripNonCode(source);
    const violations = [];

    for (const rule of BANNED) {
        rule.pattern.lastIndex = 0;
        let match;
        while ((match = rule.pattern.exec(code)) !== null) {
            const line = code.slice(0, match.index).split('\n').length;
            violations.push({
                line: line,
                label: rule.label,
                since: rule.since
            });
            if (match.index === rule.pattern.lastIndex) {
                rule.pattern.lastIndex++;
            }
        }
    }

    return violations.sort((a, b) => a.line - b.line);
}

function collectJavaScriptFiles(directory, files) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (IGNORED_PATH_PATTERN.test(entryPath)) {
            continue;
        }
        if (entry.isDirectory()) {
            collectJavaScriptFiles(entryPath, files);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.js') {
            files.push(entryPath);
        }
    }
    return files;
}

function main() {
    const files = [];
    for (const scanRoot of SCAN_ROOTS) {
        collectJavaScriptFiles(path.join(root, scanRoot), files);
    }
    files.sort();

    let failures = 0;
    for (const file of files) {
        const relativePath = path.relative(root, file).replace(/\\/g, '/');
        for (const violation of findViolations(fs.readFileSync(file, 'utf8'))) {
            failures++;
            console.error(
                relativePath + ':' + violation.line + '  ' + violation.label
                + ' requires ' + violation.since + ', baseline is Chromium 68 (webOS 5.0)'
            );
        }
    }

    if (failures) {
        console.error(
            '\nBrowser baseline check failed (' + failures + ').\n'
            + 'frontend/ ships untranspiled to webOS 5.0 (Chromium 68 / ES2018).\n'
            + 'Use an ES2018-compatible form, or raise the baseline deliberately in\n'
            + 'tools/check-baseline.js and README.md together.'
        );
        process.exitCode = 1;
        return;
    }

    console.log('Browser baseline check passed (' + files.length + ' files, Chromium 68 / ES2018).');
}

if (require.main === module) {
    main();
}

module.exports = {
    stripNonCode: stripNonCode,
    findViolations: findViolations,
    BANNED: BANNED
};
