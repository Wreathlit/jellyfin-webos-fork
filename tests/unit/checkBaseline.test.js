const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stripNonCode, findViolations } = require('../../tools/check-baseline');

const root = path.resolve(__dirname, '..', '..');

function labelsFor(source) {
    return findViolations(source).map(function (violation) {
        return violation.label;
    });
}

function assertFlags(source, expectedFragment) {
    const labels = labelsFor(source);
    assert.ok(
        labels.some(function (label) {
            return label.indexOf(expectedFragment) !== -1;
        }),
        'expected ' + JSON.stringify(source) + ' to be flagged for ' + expectedFragment
            + ', got ' + JSON.stringify(labels)
    );
}

function assertClean(source) {
    assert.deepStrictEqual(
        labelsFor(source),
        [],
        'expected ' + JSON.stringify(source) + ' to pass the baseline check'
    );
}

// --- constructs that would parse in Node but die on Chromium 68 -------------

assertFlags('var name = user?.profile;', 'optional chaining');
assertFlags('var name = user ?? fallback;', 'nullish coalescing');
assertFlags('count ??= 0;', 'logical assignment');
assertFlags('count ||= 0;', 'logical assignment');
assertFlags('count &&= 0;', 'logical assignment');
assertFlags('class A { #secret = 1; }', 'private class field');
assertFlags('class A { static { init(); } }', 'class static initialization block');

// --- builtins newer than the baseline ---------------------------------------

assertFlags('var all = groups.flat();', 'flat()');
assertFlags('var all = groups.flatMap(fn);', 'flatMap()');
assertFlags('var top = globalThis.window;', 'globalThis');
assertFlags('var o = Object.fromEntries(pairs);', 'Object.fromEntries()');
assertFlags('if (Object.hasOwn(o, "k")) {}', 'Object.hasOwn()');
assertFlags('Promise.allSettled(list);', 'Promise.allSettled()');
assertFlags('Promise.any(list);', 'Promise.any()');
assertFlags('var copy = structuredClone(value);', 'structuredClone()');
assertFlags('var s = text.replaceAll("a", "b");', 'replaceAll()');
assertFlags('var m = text.matchAll(re);', 'matchAll()');
assertFlags('var last = list.at(-1);', 'at()');
assertFlags('var last = list.findLast(fn);', 'findLast()');
assertFlags('queueMicrotask(fn);', 'queueMicrotask()');

// --- things that must NOT be flagged ----------------------------------------

// A ternary whose consequent is a fractional literal is valid ES5 and reads
// exactly like optional chaining.
assertClean('var x = cond ?.5 : 1;');
assertClean('var x = cond ? .5 : 1;');

// Hazards mentioned in prose or data must not trip the scan — this file and
// the runtime are full of both.
assertClean('// user?.profile is not allowed here');
assertClean('/* migrate away from a ?? b */');
assertClean('var message = "use a?.b instead";');
assertClean("var message = 'a ?? b';");

// Regex literals survive stripping, including ones containing the hazard
// characters and a division that follows.
assertClean('var re = /a??b/;');
assertClean('var re = /(\\d+(?:\\.\\d+)?)\\s*(mbps)/i;');
assertClean('var ratio = total / count;');
assertClean('var ratio = (a + b) / 2;');

// ES2018 and older must pass untouched.
assertClean('var merged = Object.assign({}, a, b);');
assertClean('if (list.includes(value)) {}');
assertClean('Promise.resolve(value).then(fn);');
assertClean('var index = list.findIndex(fn);');

// --- stripNonCode keeps line numbers stable ---------------------------------

{
    const source = [
        'var a = 1;',
        '// user?.profile',
        'var b = user?.profile;'
    ].join('\n');

    const violations = findViolations(source);
    assert.strictEqual(violations.length, 1, 'only the real violation should be reported');
    assert.strictEqual(violations[0].line, 3, 'the reported line must match the original file');

    assert.strictEqual(
        stripNonCode(source).split('\n').length,
        3,
        'stripping must preserve the line count'
    );
}

// --- the shipping tree must actually be clean -------------------------------

{
    const shippedFiles = [
        'frontend/js/index.js',
        'frontend/js/ajax.js',
        'frontend/js/storage.js',
        'frontend/js/webOS.js',
        'frontend/js/injected/core/runtime.js',
        'frontend/js/injected/core/features.js',
        'frontend/js/injected/playback/profilePatches.js',
        'frontend/js/injected/playback/hdrDecisions.js',
        'frontend/js/injected/playback/playbackInfoPatches.js',
        'frontend/js/injected/subtitles/scriptPatches.js'
    ];

    for (const relativePath of shippedFiles) {
        const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
        assert.deepStrictEqual(
            findViolations(source),
            [],
            relativePath + ' must stay within the Chromium 68 baseline'
        );
    }
}
