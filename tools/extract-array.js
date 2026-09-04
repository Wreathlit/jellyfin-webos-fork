// One reader for the string-array literals in frontend/js/index.js.
//
// Three copies of this used to exist -- here, in tests/unit/harnessFidelity.test.js
// and in tests/unit/featureRegistry.test.js -- and they had drifted in exactly
// the way that matters: the featureRegistry copy stripped no comments at all, so
// an entry commented out during debugging still satisfied the assertion that the
// injected feature registry and the shell whitelist agree, while the shell
// silently dropped that override from every broadcast. That is the same failure
// the comment below records for injectedScriptUrls.

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

// Returns the string entries of `var <name> = [ ... ];` found in `source`, with
// commented-out entries left out. Throws when the declaration is missing, so a
// rename fails loudly instead of silently yielding an empty list.
function extractArray(source, name) {
    const match = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];').exec(source);
    if (!match) {
        throw new Error('Cannot find ' + name + ' in the given source');
    }

    const body = stripCommentsFromArrayBody(match[1]);
    const result = [];
    const itemPattern = /['"]([^'"]+)['"]/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(body)) !== null) {
        result.push(itemMatch[1]);
    }
    return result;
}

module.exports = {
    extractArray: extractArray,
    stripCommentsFromArrayBody: stripCommentsFromArrayBody
};
