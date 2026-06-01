const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(root, 'frontend', 'js', 'injected', 'core', 'runtime.js');
const scriptPatchesPath = path.join(root, 'frontend', 'js', 'injected', 'subtitles', 'scriptPatches.js');

function loadScriptPatches() {
    const window = {};
    const context = {
        window: window
    };

    vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), context, {
        filename: runtimePath
    });
    vm.runInNewContext(fs.readFileSync(scriptPatchesPath, 'utf8'), context, {
        filename: scriptPatchesPath
    });

    return window.__JellyfinWebOSPatchRuntime.get('subtitles.scriptPatches');
}

const patches = loadScriptPatches();
assert(patches, 'subtitles.scriptPatches should register');

{
    const source = 'var opts={renderAhead:90.0};var opts2={renderAhead:90};';
    const result = patches.patchAssRendererScriptText(source);

    assert.strictEqual(result.patched, true);
    assert(result.text.indexOf('window.WebOSAssRendererOptions') !== -1);
    assert(result.text.indexOf('limitRenderAhead') !== -1);
}

{
    const source = 'var opts={renderAhead:30};';
    const result = patches.patchAssRendererScriptText(source);

    assert.strictEqual(result.text, source);
    assert.strictEqual(result.patched, false);
}

{
    const source = 'a.prototype.renderAtVideoTimestamp=function(){this.video&&this.renderAtTimestamp(this.video.currentTime+this.$timeOffset)}';
    const result = patches.patchPgsRendererScriptText(source, {});

    assert.strictEqual(result.time, true);
    assert(result.text.indexOf('window.WebOSMonotonicMediaTime') !== -1);
}

{
    const source = 'e.prototype.render=function(t){this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
    const result = patches.patchPgsRendererScriptText(source, {});

    assert.strictEqual(result.async, true);
    assert(result.text.indexOf('window.WebOSPgsRenderGuard') !== -1);
    assert(result.text.indexOf('window.WebOSPgsAsyncStats') !== -1);
}

{
    const source = 'transferControlToOffscreen;e.prototype.render=function(t){this.worker.postMessage({op:"render",index:t})}';
    const result = patches.patchPgsRendererScriptText(source, {});

    assert.strictEqual(result.render, true);
    assert(result.text.indexOf('window.WebOSPgsRenderGuard') !== -1);
}

{
    const source = 'a.prototype.render=function(b){var c=this,d=this.pgs.getSubtitleAtIndex(b);requestAnimationFrame((function(){c.renderer.draw(d)})),this.pgs.cacheSubtitleAtIndex(b+1)}';
    const result = patches.patchPgsRendererScriptText(source, {});

    assert.strictEqual(result.mainThread, true);
    assert(result.text.indexOf('window.WebOSPgsMainThreadStats') !== -1);
    assert(result.text.indexOf('setTimeout') !== -1);
}

{
    const source = 'getPixelDataFromComposition=function(a,b,c){for(var d=0,e=0,f=[],g=0,h=c;g<h.length;g++){var i=h[g];i.id==a.id&&(i.isFirstInSequence&&(d=i.width,e=i.height),i.data&&f.push(i.data))}if(0!=f.length){return f}}';
    const result = patches.patchPgsRendererScriptText(source, {
        patchObjectReuse: true
    });

    assert.strictEqual(result.objectData, true);
    assert.strictEqual(result.criticalMissing, false);
    assert(result.text.indexOf('window.WebOSPgsRendererOptions') !== -1);
    assert(result.text.indexOf('patchObjectReuse') !== -1);
}

{
    const source = 'createPgsRenderer=function(a){var b;switch(null!==(b=a.mode)&&void 0!==b?b:c.getRendererModeByPlatform()){case"mainThread":return 1}}';
    const result = patches.patchPgsRendererScriptText(source, {
        forceMainThread: true
    });

    assert.strictEqual(result.mode, true);
    assert.strictEqual(result.criticalMissing, false);
    assert(result.text.indexOf('forceMainThread') !== -1);
}

{
    const source = 'createPgsRenderer=function(a){switch(a.mode||b.getRendererModeByPlatform()){case"mainThread":return 1}}';
    const result = patches.patchPgsRendererScriptText(source, {
        forceMainThread: true
    });

    assert.strictEqual(result.mayPatchMode, true);
    assert.strictEqual(result.mode, false);
    assert.strictEqual(result.criticalMissing, true);
}

{
    const source = 'renderAhead:90;e.prototype.render=function(t){this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
    const result = patches.patchSubtitleRendererScriptText(source, {});

    assert.strictEqual(result.patched, true);
    assert.strictEqual(result.ass.patched, true);
    assert.strictEqual(result.pgs.async, true);
}
