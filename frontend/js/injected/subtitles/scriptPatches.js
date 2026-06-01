/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};

    function buildAssRenderAheadReplacement(originalValue) {
        return 'renderAhead:(window.WebOSAssRendererOptions&&window.WebOSAssRendererOptions.limitRenderAhead?window.WebOSAssRendererOptions.renderAheadMiB:' + originalValue + ')';
    }

    function buildPgsRenderAtVideoTimestampReplacement(methodPrefix) {
        return methodPrefix + '{if(this.video){var t=this.video.currentTime+this.$timeOffset;this.renderAtTimestamp(window.WebOSMonotonicMediaTime?window.WebOSMonotonicMediaTime.get(this.video,"pgs",t):t)}}';
    }

    function buildPgsAsyncSubtitleDataGuardReplacement() {
        return 'e.prototype.render=function(t){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,t))return;this.__webosLatestPgsIndex=t;window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.request(t);this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){if(e.data&&typeof e.data.index==="number"&&typeof this.__webosLatestPgsIndex==="number"&&e.data.index!==this.__webosLatestPgsIndex){window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.drop(e.data.index,this.__webosLatestPgsIndex);return}window.WebOSPgsAsyncStats&&window.WebOSPgsAsyncStats.draw(e.data&&e.data.index);var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
    }

    function buildPgsOffscreenRenderGuardReplacement() {
        return 'e.prototype.render=function(t){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,t))return;this.worker.postMessage({op:"render",index:t})}';
    }

    function buildPgsMainThreadRenderGuardReplacement(prototypeName, indexName, selfName, subtitleDataName) {
        return prototypeName + '.prototype.render=function(' + indexName + '){if(window.WebOSPgsRenderGuard&&!window.WebOSPgsRenderGuard.request(this,' + indexName + '))return;this.__webosLatestPgsIndex=' + indexName + ';window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.request(' + indexName + ');var ' + selfName + '=this,__webosRaf=window.requestAnimationFrame||function(e){return setTimeout(e,16)},__webosDefer=window.setTimeout||function(e){return __webosRaf(e)};__webosDefer((function(){if(' + selfName + '.__webosLatestPgsIndex!==' + indexName + '){window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.drop(' + indexName + ',' + selfName + '.__webosLatestPgsIndex);return}var ' + subtitleDataName + '=' + selfName + '.pgs.getSubtitleAtIndex(' + indexName + ');' + selfName + '.pgs.cacheSubtitleAtIndex(' + indexName + '+1);__webosRaf((function(){if(' + selfName + '.__webosLatestPgsIndex!==' + indexName + '){window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.drop(' + indexName + ',' + selfName + '.__webosLatestPgsIndex);return}window.WebOSPgsMainThreadStats&&window.WebOSPgsMainThreadStats.draw(' + indexName + ');' + selfName + '.renderer.draw(' + subtitleDataName + ')}))}),0)}';
    }

    function buildPgsLatestObjectDataReplacement(match, compositionName, paletteName, contextName, widthName, heightName, chunksName, indexName, arrayName, objectName) {
        return 'getPixelDataFromComposition=function(' + compositionName + ',' + paletteName + ',' + contextName + '){var ' + widthName + '=0,' + heightName + '=0,' + chunksName + '=[];if(window.WebOSPgsRendererOptions&&window.WebOSPgsRendererOptions.patchObjectReuse){for(var ' + indexName + '=' + contextName + '.length-1;' + indexName + '>=0;' + indexName + '--){var ' + objectName + '=' + contextName + '[' + indexName + '];if(' + objectName + '.id==' + compositionName + '.id){' + objectName + '.data&&' + chunksName + '.push(' + objectName + '.data);if(' + objectName + '.isFirstInSequence){' + widthName + '=' + objectName + '.width,' + heightName + '=' + objectName + '.height;break}}}' + chunksName + '.reverse()}else{for(var ' + indexName + '=0,' + arrayName + '=' + contextName + ';' + indexName + '<' + arrayName + '.length;' + indexName + '++){var ' + objectName + '=' + arrayName + '[' + indexName + '];' + objectName + '.id==' + compositionName + '.id&&(' + objectName + '.isFirstInSequence&&(' + widthName + '=' + objectName + '.width,' + heightName + '=' + objectName + '.height),' + objectName + '.data&&' + chunksName + '.push(' + objectName + '.data))}}if(0!=' + chunksName + '.length){';
    }

    function buildPgsForceMainThreadModeReplacement(match, optionsName, modeName, modeHelperName) {
        return 'createPgsRenderer=function(' + optionsName + '){var ' + modeName + ';switch(window.WebOSPgsRendererOptions&&window.WebOSPgsRendererOptions.forceMainThread?"mainThread":null!==(' + modeName + '=' + optionsName + '.mode)&&void 0!==' + modeName + '?' + modeName + ':' + modeHelperName + '.getRendererModeByPlatform()){';
    }

    function patchAssRendererScriptText(text) {
        var result = {
            text: text,
            patched: false
        };

        if (!text || typeof text !== 'string' || text.indexOf('renderAhead') === -1) {
            return result;
        }

        var patched = text;
        patched = patched.replace(/renderAhead\s*:\s*(90\.0)\b/g, function (match, originalValue) {
            return buildAssRenderAheadReplacement(originalValue);
        });
        patched = patched.replace(/renderAhead\s*:\s*(90)(?!\.)\b/g, function (match, originalValue) {
            return buildAssRenderAheadReplacement(originalValue);
        });

        result.text = patched;
        result.patched = patched !== text;
        return result;
    }

    function patchPgsRendererScriptText(text, options) {
        var result = {
            text: text,
            patched: false,
            time: false,
            async: false,
            render: false,
            mainThread: false,
            objectData: false,
            mode: false,
            mayPatchMode: false,
            mayPatchObjectData: false,
            criticalMissing: false
        };

        if (!text || typeof text !== 'string') {
            return result;
        }

        var mayPatchTime = text.indexOf('renderAtVideoTimestamp') !== -1 && text.indexOf('video.currentTime') !== -1;
        var mayPatchAsync = text.indexOf('requestSubtitleData') !== -1 && text.indexOf('subtitleData') !== -1;
        var mayPatchRender = text.indexOf('op:"render"') !== -1 && text.indexOf('transferControlToOffscreen') !== -1;
        var mayPatchMainThread = text.indexOf('getSubtitleAtIndex') !== -1 && text.indexOf('cacheSubtitleAtIndex') !== -1;
        var mayPatchObjectData = text.indexOf('getPixelDataFromComposition') !== -1 && text.indexOf('isFirstInSequence') !== -1;
        var mayPatchMode = text.indexOf('createPgsRenderer') !== -1 && text.indexOf('getRendererModeByPlatform') !== -1;

        result.mayPatchMode = mayPatchMode;
        result.mayPatchObjectData = mayPatchObjectData;

        if (!mayPatchTime && !mayPatchAsync && !mayPatchRender && !mayPatchMainThread && !mayPatchObjectData && !mayPatchMode) {
            return result;
        }

        var patched = text;
        if (mayPatchTime) {
            var beforeTimePatch = patched;
            var prototypeNeedle = 'renderAtVideoTimestamp=function(){this.video&&this.renderAtTimestamp(this.video.currentTime+this.$timeOffset)}';
            var prototypeReplacement = buildPgsRenderAtVideoTimestampReplacement('renderAtVideoTimestamp=function()');
            patched = patched.split(prototypeNeedle).join(prototypeReplacement);
            patched = patched.replace(
                /renderAtVideoTimestamp\s*=\s*function\s*\(\)\s*\{\s*this\.video\s*&&\s*this\.renderAtTimestamp\s*\(\s*this\.video\.currentTime\s*\+\s*this\.\$timeOffset\s*\)\s*\}/g,
                prototypeReplacement
            );
            patched = patched.replace(
                /renderAtVideoTimestamp\s*\(\)\s*\{\s*this\.video\s*&&\s*this\.renderAtTimestamp\s*\(\s*this\.video\.currentTime\s*\+\s*this\.\$timeOffset\s*\)\s*\}/g,
                buildPgsRenderAtVideoTimestampReplacement('renderAtVideoTimestamp()')
            );
            result.time = patched !== beforeTimePatch;
        }

        if (mayPatchObjectData) {
            var beforeObjectDataPatch = patched;
            patched = patched.replace(
                /getPixelDataFromComposition=function\((\w+),(\w+),(\w+)\)\{for\(var (\w+)=0,(\w+)=0,(\w+)=\[\],(\w+)=0,(\w+)=\3;\7<\8\.length;\7\+\+\)\{var (\w+)=\8\[\7\];\9\.id==\1\.id&&\(\9\.isFirstInSequence&&\(\4=\9\.width,\5=\9\.height\),\9\.data&&\6\.push\(\9\.data\)\)\}if\(0!=\6\.length\)\{/g,
                buildPgsLatestObjectDataReplacement
            );
            result.objectData = patched !== beforeObjectDataPatch;
        }

        if (mayPatchMainThread) {
            var beforeMainThreadPatch = patched;
            patched = patched.replace(
                /(\w+)\.prototype\.render=function\((\w+)\)\{var (\w+)=this,(\w+)=this\.pgs\.getSubtitleAtIndex\(\2\);requestAnimationFrame\(\(function\(\)\{\3\.renderer\.draw\(\4\)\}\)\),this\.pgs\.cacheSubtitleAtIndex\(\2\+1\)\}/g,
                function (match, prototypeName, indexName, selfName, subtitleDataName) {
                    return buildPgsMainThreadRenderGuardReplacement(prototypeName, indexName, selfName, subtitleDataName);
                }
            );
            result.mainThread = patched !== beforeMainThreadPatch;
        }

        if (mayPatchAsync) {
            var beforeAsyncPatch = patched;
            var asyncSubtitleDataNeedle = 'e.prototype.render=function(t){this.worker.postMessage({op:"requestSubtitleData",index:t})},e.prototype.onWorkerMessage=function(e){if("subtitleData"===e.data.op){var r=e.data.subtitleData;this.renderer&&this.renderer.draw(r)}else t.prototype.onWorkerMessage.call(this,e)}';
            patched = patched.split(asyncSubtitleDataNeedle).join(buildPgsAsyncSubtitleDataGuardReplacement());
            result.async = patched !== beforeAsyncPatch;
        }

        if (mayPatchRender) {
            var beforeRenderPatch = patched;
            var offscreenRenderNeedle = 'e.prototype.render=function(t){this.worker.postMessage({op:"render",index:t})}';
            patched = patched.split(offscreenRenderNeedle).join(buildPgsOffscreenRenderGuardReplacement());
            result.render = patched !== beforeRenderPatch;
        }

        if (mayPatchMode) {
            var beforeModePatch = patched;
            patched = patched.replace(
                /createPgsRenderer=function\((\w+)\)\{var (\w+);switch\(null!==\(\2=\1\.mode\)&&void 0!==\2\?\2:(\w+)\.getRendererModeByPlatform\(\)\)\{/g,
                buildPgsForceMainThreadModeReplacement
            );
            result.mode = patched !== beforeModePatch;
        }

        result.text = patched;
        result.patched = patched !== text;
        result.criticalMissing = !!((options && options.forceMainThread && mayPatchMode && !result.mode)
            || (options && options.patchObjectReuse && mayPatchObjectData && !result.objectData));
        return result;
    }

    function patchSubtitleRendererScriptText(text, options) {
        var ass = patchAssRendererScriptText(text, options);
        var pgs = patchPgsRendererScriptText(ass.text, options);

        return {
            text: pgs.text,
            ass: ass,
            pgs: pgs,
            patched: pgs.text !== text
        };
    }

    Runtime.define('subtitles.scriptPatches', {
        buildAssRenderAheadReplacement: buildAssRenderAheadReplacement,
        buildPgsRenderAtVideoTimestampReplacement: buildPgsRenderAtVideoTimestampReplacement,
        buildPgsAsyncSubtitleDataGuardReplacement: buildPgsAsyncSubtitleDataGuardReplacement,
        buildPgsOffscreenRenderGuardReplacement: buildPgsOffscreenRenderGuardReplacement,
        buildPgsMainThreadRenderGuardReplacement: buildPgsMainThreadRenderGuardReplacement,
        buildPgsLatestObjectDataReplacement: buildPgsLatestObjectDataReplacement,
        buildPgsForceMainThreadModeReplacement: buildPgsForceMainThreadModeReplacement,
        patchAssRendererScriptText: patchAssRendererScriptText,
        patchPgsRendererScriptText: patchPgsRendererScriptText,
        patchSubtitleRendererScriptText: patchSubtitleRendererScriptText
    });
})(window);
