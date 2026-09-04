const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stripNonCode, findViolations } = require('../../tools/check-baseline');
const { BUNDLE_FILES } = require('../helpers/injectedRuntime');

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
    // Derived, not hand-copied. This list used to be maintained by hand and had
    // already drifted -- core/mediaStreams.js joined the bundle and was never
    // added here, so the assertion below silently stopped covering it while
    // still claiming the shipping tree was clean.
    const shippedFiles = ['frontend/js/index.js', 'frontend/js/ajax.js', 'frontend/js/storage.js']
        .concat(BUNDLE_FILES);

    for (const relativePath of shippedFiles) {
        const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
        assert.deepStrictEqual(
            findViolations(source),
            [],
            relativePath + ' must stay within the Chromium 68 baseline'
        );
    }
}

// Template literals used to be blanked whole, interpolations included, so any
// hazard written inside `${...}` was invisible to the scan that exists to catch
// exactly that class of parse error.
{
    assert.deepStrictEqual(
        labelsFor('var a = `x ${b ?? c}`;'),
        ['nullish coalescing `??`'],
        'a hazard inside a template interpolation must be reported'
    );
    assert.deepStrictEqual(
        labelsFor('var a = `${user?.name}`;'),
        ['optional chaining `?.`'],
        'optional chaining inside an interpolation must be reported'
    );
    assert.deepStrictEqual(
        labelsFor('var a = `literal ?? text`;'),
        [],
        'the static text of a template literal is still not code'
    );
    assert.deepStrictEqual(
        labelsFor('var a = `outer ${ `inner ?? text` } end`;'),
        [],
        'a nested template literal keeps its static text out of the scan'
    );
}

// Two parse-level violations Node 22 accepts, so check:syntax cannot see them
// either: without these rules they reached the TV and white-screened on load.
{
    assert.deepStrictEqual(
        labelsFor('var n = 1_000_000;'),
        ['numeric separator `1_000`'],
        'numeric separators must be reported'
    );
    assert.deepStrictEqual(
        labelsFor('var a = 0xFF, b = 1000, c = 1.5e3;'),
        [],
        'ordinary numeric literals must not trip the separator rule'
    );

    assert.deepStrictEqual(
        labelsFor('class A { count = 1; }'),
        ['public class field `x = 1`'],
        'public class fields must be reported'
    );
    assert.deepStrictEqual(
        labelsFor('class A { static x = 2; }'),
        ['public class field `x = 1`'],
        'static public class fields must be reported'
    );
    assert.deepStrictEqual(
        labelsFor('class A { m() { var x = 1; x = 2; this.y = 3; } }'),
        [],
        'assignment inside a method body is not a field declaration'
    );
    assert.deepStrictEqual(
        labelsFor('function f() { var count = 1; count = 2; }'),
        [],
        'plain assignment outside a class must not be reported'
    );
}

// services/ ships untranspiled to a much older Node than the CI host, and used
// to be scanned by nothing: `node --check` runs on Node 22 and accepts anything
// it can parse. A service that throws at load looks like discovery silently
// breaking, not like a crash.
{
    const { BANNED_NODE, SCAN_TARGETS } = require('../../tools/check-baseline');

    assert.ok(
        SCAN_TARGETS.some(function (target) {
            return target.root === 'services';
        }),
        'services/ must be part of the baseline scan'
    );

    const nodeLabels = findViolations('try { risky(); } catch { }', BANNED_NODE)
        .map(function (violation) {
            return violation.label;
        });
    assert.deepStrictEqual(
        nodeLabels,
        ['optional catch binding `catch {`'],
        'optional catch binding parses on Chromium 68 but not on Node 8'
    );
    assert.deepStrictEqual(
        labelsFor('try { risky(); } catch { }'),
        [],
        'the browser table must not report optional catch binding'
    );

    const serviceSource = fs.readFileSync(path.join(root, 'services', 'service.js'), 'utf8');
    assert.deepStrictEqual(
        findViolations(serviceSource, BANNED_NODE),
        [],
        'services/service.js must stay within the Node 8 baseline'
    );
}

// README documents the baseline and check-baseline.js enforces it, and the
// README itself asks for the two to be changed together. They had already
// drifted: the table was missing Promise.allSettled, both class-field forms,
// static blocks and findLast, so a contributor could read the table, use one of
// them, and be rejected by CI -- or read it as a whitelist and be misled.
{
    const readmePath = path.join(root, 'README.md');
    const readme = fs.readFileSync(readmePath, 'utf8');

    const tableStart = readme.indexOf('| Not available | Since |');
    assert.notStrictEqual(tableStart, -1, 'README must document the banned baseline features');
    const tableEnd = readme.indexOf('\n\n', tableStart);
    const table = readme.slice(tableStart, tableEnd === -1 ? readme.length : tableEnd);

    // A distinctive fragment of each rule that must appear somewhere in the
    // table. Matching the label verbatim would just re-encode the tool's
    // strings; this checks the reader can actually find the construct.
    const documented = {
        'optional chaining `?.`': '?.',
        'logical assignment `??=`': '??=',
        'logical assignment `||=`': '|=',
        'logical assignment `&&=`': '&&=',
        'nullish coalescing `??`': '??',
        'private class field `#name`': '#name',
        'class static initialization block': 'static initialization',
        'numeric separator `1_000`': '1_000',
        'public class field `x = 1`': 'x = 1',
        '`globalThis`': 'globalThis',
        '`queueMicrotask()`': 'queueMicrotask',
        '`Object.fromEntries()`': 'Object.fromEntries',
        '`Object.hasOwn()`': 'Object.hasOwn',
        '`Promise.allSettled()`': 'Promise.allSettled',
        '`Promise.any()`': 'Promise.any',
        '`structuredClone()`': 'structuredClone',
        '`Array.prototype.flat()`': 'flat',
        '`Array.prototype.flatMap()`': 'flatMap',
        '`String.prototype.matchAll()`': 'matchAll',
        '`String.prototype.replaceAll()`': 'replaceAll',
        '`Array.prototype.findLast()`': 'findLast',
        '`Array.prototype.at()`': '.at()'
    };

    const { BANNED } = require('../../tools/check-baseline');
    const undocumented = [];
    for (const rule of BANNED) {
        const probe = documented[rule.label];
        if (!probe) {
            undocumented.push(rule.label + ' (no README probe defined)');
            continue;
        }
        if (table.indexOf(probe) === -1) {
            undocumented.push(rule.label);
        }
    }

    assert.deepStrictEqual(
        undocumented,
        [],
        'every banned construct must appear in the README baseline table'
    );
}
