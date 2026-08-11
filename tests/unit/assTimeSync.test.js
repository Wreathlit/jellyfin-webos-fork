const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
const subtitlePatchesPath = path.join(root, 'frontend', 'js', 'injected', 'subtitles', 'scriptPatches.js');
const window = {};
const context = { window: window };

vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
    filename: runtimePath
});
vm.runInNewContext(fs.readFileSync(subtitlePatchesPath, 'utf8'), context, {
    filename: subtitlePatchesPath
});

const timeSync = window.__JellyfinWebOSPatchRuntime.get('subtitles.assTimeSync');
const options = {
    enabled: true,
    backwardToleranceSeconds: 0.03,
    seekBackSeconds: 0.75
};

assert(timeSync, 'ASS time-sync module should register');

function applyVideoTimeMessage(entry, message, now) {
    const result = timeSync.evaluateVideoTimeSample(entry, message, now, options);

    if (result.hasCurrentTime) {
        entry.lastPostedCurrentTime = result.currentTime;
        entry.lastPostedAt = now;
    } else if (result.resetAnchor) {
        entry.lastPostedCurrentTime = null;
        entry.lastPostedAt = now;
    }
    entry.lastPostedPaused = result.isPaused;
    entry.lastPostedRate = result.rate;

    return result;
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: false,
        lastPostedRate: 1
    };
    const result = timeSync.evaluateVideoTimeSample(entry, {
        currentTime: 10,
        isPaused: true
    }, 100, options);

    assert.strictEqual(result.clamped, false, 'a pause transition must be treated as an authoritative clock stop');
    assert.strictEqual(result.currentTime, 10);
    assert.strictEqual(result.isPaused, true);
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: false,
        lastPostedRate: 1
    };
    const result = timeSync.evaluateVideoTimeSample(entry, {
        currentTime: 10,
        isPaused: false
    }, 100, options);

    assert.strictEqual(result.clamped, true, 'a small lag across consecutive playing samples should still be clamped');
    assert.strictEqual(result.currentTime, 10.1);
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: true,
        lastPostedRate: 1
    };
    const result = timeSync.evaluateVideoTimeSample(entry, {
        currentTime: 10,
        isPaused: false
    }, 100, options);

    assert.strictEqual(result.clamped, false, 'resuming from pause must not extrapolate across the paused interval');
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: false,
        lastPostedRate: 1
    };
    const result = timeSync.evaluateVideoTimeSample(entry, {
        currentTime: 9,
        isPaused: false
    }, 100, options);

    assert.strictEqual(result.clamped, false, 'large backwards seeks must remain untouched');
    assert.strictEqual(result.currentTime, 9);
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: false,
        lastPostedRate: 1
    };
    const rateChange = applyVideoTimeMessage(entry, {
        target: 'video',
        rate: 2
    }, 100);

    assert.strictEqual(rateChange.resetAnchor, true, 'a rate-only change must invalidate the old clock slope');
    assert.strictEqual(entry.lastPostedCurrentTime, null);
    assert.strictEqual(entry.lastPostedRate, 2);

    const nextSample = applyVideoTimeMessage(entry, {
        target: 'video',
        currentTime: 10.4,
        isPaused: false
    }, 250);
    assert.strictEqual(nextSample.clamped, false, 'the first sample after a rate-only change must be authoritative');
    assert.strictEqual(entry.lastPostedCurrentTime, 10.4);
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: false,
        lastPostedRate: 2
    };
    applyVideoTimeMessage(entry, {
        target: 'video',
        rate: 0.5
    }, 500);
    const delayedDownshiftSample = applyVideoTimeMessage(entry, {
        target: 'video',
        currentTime: 10.3,
        isPaused: false
    }, 600);

    assert.strictEqual(delayedDownshiftSample.clamped, false, 'a delayed downshift notification must not preserve a speculative old-rate anchor');
    assert.strictEqual(entry.lastPostedCurrentTime, 10.3);
}

{
    const entry = {
        lastPostedCurrentTime: 10,
        lastPostedAt: 0,
        lastPostedPaused: false,
        lastPostedRate: 1
    };
    const pause = applyVideoTimeMessage(entry, {
        target: 'video',
        isPaused: true
    }, 100);
    assert.strictEqual(pause.resetAnchor, true, 'a pause-only transition must invalidate the playing anchor');

    const resume = applyVideoTimeMessage(entry, {
        target: 'video',
        isPaused: false
    }, 500);
    assert.strictEqual(resume.resetAnchor, true, 'a resume-only transition must wait for a real clock sample');

    const nextSample = applyVideoTimeMessage(entry, {
        target: 'video',
        currentTime: 10.2,
        isPaused: false
    }, 600);
    assert.strictEqual(nextSample.clamped, false);
    assert.strictEqual(entry.lastPostedCurrentTime, 10.2);
}
