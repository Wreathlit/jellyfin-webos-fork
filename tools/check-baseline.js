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
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');

// Two first-party trees ship untranspiled, to two different engines.
//
//   frontend/  -> webOS 5.0 web engine == Chromium 68 == ES2018
//   services/  -> webOS 5.0 Node service runtime, roughly Node 8
//
// services/ used to be scanned by nothing at all: `npm run check:syntax` runs
// `node --check` on the CI host's Node 22, so anything it can parse passed. A
// background service that throws at load is harder to notice than a white
// screen -- it just looks like server discovery quietly stopped working.
//
// The vendored webOSTVjs SDK is shipped as delivered by LG and is not ours to
// police.
const SCAN_TARGETS = [
    { root: 'frontend', engine: 'Chromium 68 (webOS 5.0)', banned: 'browser' },
    { root: 'services', engine: 'Node 8 (webOS 5.0 service runtime)', banned: 'node' }
];
const IGNORED_PATH_PATTERN = /(^|[\\/])webOSTVjs-/;

// Each rule carries the first version of *each* engine that supports it, so one
// table serves both trees. A null means the baseline already has it.
const RULES = [
    // Syntax — a violation here is a parse error, so the whole file dies.
    { syntax: true, pattern: /\?\.(?!\d)/g, label: 'optional chaining `?.`', browser: 'Chromium 80', node: 'Node 14' },
    { syntax: true, pattern: /\?\?=/g, label: 'logical assignment `??=`', browser: 'Chromium 85', node: 'Node 15' },
    { syntax: true, pattern: /\|\|=/g, label: 'logical assignment `||=`', browser: 'Chromium 85', node: 'Node 15' },
    { syntax: true, pattern: /&&=/g, label: 'logical assignment `&&=`', browser: 'Chromium 85', node: 'Node 15' },
    { syntax: true, pattern: /\?\?/g, label: 'nullish coalescing `??`', browser: 'Chromium 80', node: 'Node 14' },
    { syntax: true, pattern: /(^|[^\w$.])#[A-Za-z_$]/g, label: 'private class field `#name`', browser: 'Chromium 74', node: 'Node 12' },
    { syntax: true, pattern: /\bstatic\s*\{/g, label: 'class static initialization block', browser: 'Chromium 94', node: 'Node 16.11' },
    // Optional catch binding parses on Chromium 68 but not on Node 8.
    { syntax: true, pattern: /\bcatch\s*\{/g, label: 'optional catch binding `catch {`', browser: null, node: 'Node 10' },
    // survivesParse: grammar the parse gate's ecmaVersion may accept while the
    // engine does not, so these keep running even for a file that parses.
    // Raising PARSE_ECMA_VERSION.node must not silently drop them again.
    { syntax: true, survivesParse: true, pattern: /\bfor\s+await\b/g, label: 'async iteration `for await`', browser: null, node: 'Node 10' },
    { syntax: true, survivesParse: true, pattern: /\basync\s+function\s*\*/g, label: 'async generator `async function*`', browser: null, node: 'Node 10' },
    // A digit run containing an underscore. Strings and comments are already
    // blanked out by this point, so a false positive would need a bare numeric
    // literal spelled with separators -- which is the thing being banned.
    { syntax: true, pattern: /\b\d[\d_]*_[\d_]*\b/g, label: 'numeric separator `1_000`', browser: 'Chromium 75', node: 'Node 12.5' },
    // Public class fields. Matched inside a class body only, because
    // `identifier =` is ordinary assignment anywhere else; see
    // findClassFieldViolations below.
    { syntax: true, pattern: null, classField: true, label: 'public class field `x = 1`', browser: 'Chromium 72', node: 'Node 12' },

    // Builtins — a violation here is a TypeError at the call site, so it only
    // breaks the feature that touches it. Still a white screen if it runs at
    // startup.
    { pattern: /\bglobalThis\b/g, label: '`globalThis`', browser: 'Chromium 71', node: 'Node 12' },
    { pattern: /\bqueueMicrotask\s*\(/g, label: '`queueMicrotask()`', browser: 'Chromium 71', node: 'Node 11' },
    { pattern: /\bObject\.fromEntries\b/g, label: '`Object.fromEntries()`', browser: 'Chromium 73', node: 'Node 12' },
    { pattern: /\bObject\.hasOwn\b/g, label: '`Object.hasOwn()`', browser: 'Chromium 93', node: 'Node 16.9' },
    { pattern: /\bPromise\.allSettled\b/g, label: '`Promise.allSettled()`', browser: 'Chromium 76', node: 'Node 12.9' },
    { pattern: /\bPromise\.any\b/g, label: '`Promise.any()`', browser: 'Chromium 85', node: 'Node 15' },
    { pattern: /\bstructuredClone\s*\(/g, label: '`structuredClone()`', browser: 'Chromium 98', node: 'Node 17' },
    { pattern: /\.flat\s*\(/g, label: '`Array.prototype.flat()`', browser: 'Chromium 69', node: 'Node 11' },
    { pattern: /\.flatMap\s*\(/g, label: '`Array.prototype.flatMap()`', browser: 'Chromium 69', node: 'Node 11' },
    { pattern: /\.matchAll\s*\(/g, label: '`String.prototype.matchAll()`', browser: 'Chromium 73', node: 'Node 12' },
    { pattern: /\.replaceAll\s*\(/g, label: '`String.prototype.replaceAll()`', browser: 'Chromium 85', node: 'Node 15' },
    { pattern: /\.findLast(Index)?\s*\(/g, label: '`Array.prototype.findLast()`', browser: 'Chromium 97', node: 'Node 18' },
    { pattern: /\.at\s*\(/g, label: '`Array.prototype.at()`', browser: 'Chromium 92', node: 'Node 16.6' }
];

function rulesFor(engine) {
    return RULES
        .filter((rule) => rule[engine])
        .map((rule) => ({
            pattern: rule.pattern,
            syntax: rule.syntax,
            classField: rule.classField,
            survivesParse: rule.survivesParse,
            label: rule.label,
            since: rule[engine]
        }));
}

// The browser table stays exported under its original name: it is what the
// README documents and what checkBaseline.test.js asserts against.
const BANNED = rulesFor('browser');
const BANNED_NODE = rulesFor('node');

// A `/` opens a regex literal only where a value cannot already have ended.
const REGEX_ALLOWED_AFTER = /[(,=:[!&|?{};+\-*%~^<>]$/;
const REGEX_ALLOWED_KEYWORDS = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

function blankOut(text) {
    return text.replace(/[^\n]/g, ' ');
}

// Blank a plain quoted string starting at `start`. Returns the replacement text
// (same length as what it consumed) and the index just past the literal.
function stripQuotedLiteral(source, start) {
    const quote = source[start];
    let cursor = start + 1;
    while (cursor < source.length) {
        if (source[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if (source[cursor] === quote) {
            cursor++;
            break;
        }
        cursor++;
    }
    return { text: blankOut(source.slice(start, cursor)), end: cursor };
}

// Blank a template literal's static text while keeping each `${...}` expression
// as code. Recurses so a literal nested inside an interpolation is handled the
// same way instead of its opening backtick being read as the outer one's close.
function stripTemplateLiteral(source, start) {
    let text = ' ';
    let cursor = start + 1;
    let staticStart = cursor;

    while (cursor < source.length) {
        if (source[cursor] === '\\') {
            cursor += 2;
            continue;
        }

        if (source[cursor] === '$' && source[cursor + 1] === '{') {
            text += blankOut(source.slice(staticStart, cursor)) + '  ';
            cursor += 2;

            let depth = 1;
            while (cursor < source.length && depth > 0) {
                const current = source[cursor];

                if (current === '\\') {
                    text += source.slice(cursor, cursor + 2);
                    cursor += 2;
                    continue;
                }
                if (current === '`') {
                    const nested = stripTemplateLiteral(source, cursor);
                    text += nested.text;
                    cursor = nested.end;
                    continue;
                }
                if (current === '"' || current === '\'') {
                    const nested = stripQuotedLiteral(source, cursor);
                    text += nested.text;
                    cursor = nested.end;
                    continue;
                }
                if (current === '{') {
                    depth++;
                } else if (current === '}') {
                    depth--;
                    if (depth === 0) {
                        text += ' ';
                        cursor++;
                        break;
                    }
                }

                text += current;
                cursor++;
            }

            staticStart = cursor;
            continue;
        }

        if (source[cursor] === '`') {
            cursor++;
            break;
        }
        cursor++;
    }

    text += blankOut(source.slice(staticStart, cursor));
    return { text: text, end: cursor };
}

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

        // Template literals need their `${...}` interpolations kept as code:
        // blanking the whole literal hid every hazard written inside one, which
        // is exactly the parse error this scan exists to catch. Every branch
        // below emits exactly as many characters as it consumes, so reported
        // line numbers keep matching the original file.
        if (char === '`') {
            const scanned = stripTemplateLiteral(source, index);
            out += scanned.text;
            index = scanned.end;
            lastSignificant = 'x';
            continue;
        }

        if (char === '"' || char === '\'') {
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

// `name = value` is ordinary assignment everywhere except directly inside a
// class body, where it declares a public class field -- a parse error on the
// baseline. Walk each class body's braces so the check stays lexical without
// mistaking assignments in methods for field declarations.
function findClassFieldViolations(code) {
    const violations = [];
    const classPattern = /\bclass\b[^{;]*\{/g;
    let match;

    while ((match = classPattern.exec(code)) !== null) {
        let cursor = classPattern.lastIndex;
        let depth = 1;
        const bodyStart = cursor;

        while (cursor < code.length && depth > 0) {
            const char = code[cursor];
            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
            }
            cursor++;
        }

        // Only depth-1 text is the class body itself; anything deeper is a
        // method body where assignment is legal.
        const body = code.slice(bodyStart, cursor - 1);
        let bodyDepth = 0;
        let lineOffset = bodyStart;
        const fieldPattern = /(^|[;}\n])\s*(?:static\s+)?([A-Za-z_$][\w$]*)\s*=[^=]/g;

        for (let i = 0; i < body.length; i++) {
            if (body[i] === '{') {
                bodyDepth++;
            } else if (body[i] === '}') {
                bodyDepth--;
            }
        }

        if (bodyDepth !== 0) {
            continue;
        }

        let fieldMatch;
        fieldPattern.lastIndex = 0;
        while ((fieldMatch = fieldPattern.exec(body)) !== null) {
            // Reject matches nested inside a method body.
            let nesting = 0;
            for (let i = 0; i < fieldMatch.index; i++) {
                if (body[i] === '{') {
                    nesting++;
                } else if (body[i] === '}') {
                    nesting--;
                }
            }
            if (nesting !== 0) {
                continue;
            }

            const absolute = lineOffset + fieldMatch.index;
            violations.push({
                line: code.slice(0, absolute).split('\n').length,
                label: 'public class field `x = 1`',
                since: 'Chromium 72'
            });
        }
    }

    return violations;
}

function findViolations(source, banned) {
    const code = stripNonCode(source);
    const violations = [];

    for (const rule of (banned || BANNED)) {
        if (rule.classField) {
            for (const violation of findClassFieldViolations(code)) {
                violations.push({ line: violation.line, label: rule.label, since: rule.since });
            }
            continue;
        }
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

// The lexical scan cannot decide `/` between regex and division, and it cannot
// see class-body grammar, so it both missed real hazards and blocked valid
// code. Verified against the previous implementation: `class A { count; }` and
// `class A { [k] = 1; }` reported nothing (both parse errors on Chromium 68),
// `x = i++ / 2; var s = a ?? b;` reported nothing (the `/` after `++` opened a
// "regex" that swallowed the `??`), and `/a/d` reported nothing; while a
// multi-line default parameter in a class method and `if (ok) /#t/.test(s)`
// were both reported as class fields.
//
// A parser settles all of that. acorn is a tools-only devDependency and never
// ships. Anything the target ecmaVersion rejects is a parse error on the TV, so
// the parser's own message and position is the report. The tables below stay:
// they name builtins, which no parser can judge, and they still describe a
// hazard more precisely than "Unexpected token" when they do fire.
// The grammar each engine actually has, which is not the newest spec it mostly
// implements.
//
// Chromium 68 has all of ES2019 syntax -- optional catch binding shipped in 66
// and the JSON superset in 66 -- so 2019 is exact there.
//
// Node 8 is NOT ES2018. Object rest/spread arrived in 8.3, but async iteration
// (`for await`), async generators and the ES2018 regex features -- lookbehind,
// named capture groups, the `s` flag -- are all Node 10. Parsing services/ at
// 2018 accepted every one of them, and since a file that parses skips the
// syntax rules, `for await` went from reported to reported by nothing. 2017 is
// the honest floor and services/service.js parses cleanly at it. If a services/
// file ever needs object rest/spread, raise this to 2018; the survivesParse
// rules keep covering the rest.
const PARSE_ECMA_VERSION = {
    browser: 2019,
    node: 2017
};

function findParseViolation(source, banned) {
    const ecmaVersion = banned === 'node' ? PARSE_ECMA_VERSION.node : PARSE_ECMA_VERSION.browser;
    try {
        acorn.parse(source, {
            ecmaVersion: ecmaVersion,
            sourceType: 'script',
            allowReturnOutsideFunction: false
        });
        return null;
    } catch (error) {
        const line = typeof error.loc === 'object' && error.loc ? error.loc.line : 0;
        const column = typeof error.loc === 'object' && error.loc ? error.loc.column : 0;
        return {
            line: line,
            label: 'not valid ES' + ecmaVersion + ': ' + String(error.message).replace(/\s*\(\d+:\d+\)\s*$/, '')
                + ' (column ' + column + ')',
            since: 'a newer engine'
        };
    }
}

function main() {
    let failures = 0;
    let scanned = 0;

    for (const target of SCAN_TARGETS) {
        const files = collectJavaScriptFiles(path.join(root, target.root), []).sort();
        const banned = target.banned === 'node' ? BANNED_NODE : BANNED;
        scanned += files.length;

        for (const file of files) {
            const relativePath = path.relative(root, file).replace(/\\/g, '/');
            const source = fs.readFileSync(file, 'utf8');

            const parseViolation = findParseViolation(source, target.banned);
            if (parseViolation) {
                failures++;
                console.error(
                    relativePath + ':' + parseViolation.line + '  ' + parseViolation.label
                    + ', baseline is ' + target.engine
                );
                // The lexical pass would be reading a file it cannot tokenize
                // correctly, so do not pile guesses on top of a parse error.
                continue;
            }

            // The file parses at the baseline, so almost no syntax rule can be
            // true of it -- and running them anyway is where the false positives
            // were: `if (ok) /#tag/.test(s)` was read as a private class field
            // and a multi-line default parameter as a public one, because the
            // scan cannot tell a regex from a division.
            //
            // "Almost", because the parse gate can only reject what its
            // ecmaVersion rejects, and a rule marked survivesParse describes
            // grammar the version accepts while the engine does not. The
            // builtins run for a different reason: a missing method is a
            // TypeError at the call site, not a parse error, so no parser can
            // judge it.
            const stillApplicable = banned.filter(function (rule) {
                return !rule.syntax || rule.survivesParse;
            });
            for (const violation of findViolations(source, stillApplicable)) {
                failures++;
                console.error(
                    relativePath + ':' + violation.line + '  ' + violation.label
                    + ' requires ' + violation.since + ', baseline is ' + target.engine
                );
            }
        }
    }

    if (failures) {
        console.error(
            '\nEngine baseline check failed (' + failures + ').\n'
            + 'frontend/ and services/ both ship untranspiled to webOS 5.0:\n'
            + '  frontend/ -> Chromium 68 / ES2018\n'
            + '  services/ -> Node 8 service runtime\n'
            + 'Use a compatible form, or raise the baseline deliberately in\n'
            + 'tools/check-baseline.js and README.md together.'
        );
        process.exitCode = 1;
        return;
    }

    console.log(
        'Engine baseline check passed (' + scanned + ' files; '
        + 'frontend Chromium 68, services Node 8).'
    );
}

if (require.main === module) {
    main();
}

module.exports = {
    stripNonCode: stripNonCode,
    findViolations: findViolations,
    findParseViolation: findParseViolation,
    PARSE_ECMA_VERSION: PARSE_ECMA_VERSION,
    BANNED: BANNED,
    BANNED_NODE: BANNED_NODE,
    SCAN_TARGETS: SCAN_TARGETS
};
