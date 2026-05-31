const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const featuresPath = path.join(root, 'frontend', 'js', 'injected', 'core', 'features.js');
const indexPath = path.join(root, 'frontend', 'js', 'index.js');

function loadFeatureRegistry() {
    const window = {
        __JellyfinWebOSPatchRuntime: {
            modules: {},
            moduleOrder: [],
            define: function (name, module) {
                this.modules[name] = module;
                this.moduleOrder.push(name);
                return module;
            }
        }
    };

    vm.runInNewContext(fs.readFileSync(featuresPath, 'utf8'), {
        window: window
    }, {
        filename: featuresPath
    });

    return window.__JellyfinWebOSPatchRuntime.modules['core.features'];
}

function extractAllowedFeatureOverrides() {
    const text = fs.readFileSync(indexPath, 'utf8');
    const match = /var\s+allowed\s*=\s*\[([\s\S]*?)\];/.exec(text);
    assert(match, 'sanitizeFeatureOverrides allowed list should exist');

    const result = [];
    const itemPattern = /['"]([^'"]+)['"]/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(match[1])) !== null) {
        result.push(itemMatch[1]);
    }
    return result.sort();
}

const registry = loadFeatureRegistry();
assert(registry, 'feature registry should register core.features');

const expectedDefinitions = {
    playbackDiagnosticsEnabled: {
        storageKey: 'webos_playback_diagnostics_overlay',
        defaultValue: false,
        group: 'diagnostics'
    },
    disableAssRenderAhead: {
        storageKey: 'webos_disable_ass_render_ahead',
        defaultValue: true,
        group: 'ass'
    },
    assTimeSyncFixEnabled: {
        storageKey: 'webos_ass_time_sync_fix',
        defaultValue: true,
        group: 'ass'
    },
    pgsForceMainThread: {
        storageKey: 'webos_pgs_force_main_thread',
        defaultValue: true,
        group: 'pgs'
    },
    pgsPatchObjectReuse: {
        storageKey: 'webos_pgs_patch_object_reuse',
        defaultValue: true,
        group: 'pgs'
    },
    lpcmAudioCopyEnabled: {
        storageKey: 'webos_lpcm_audio_copy',
        defaultValue: false,
        group: 'audio'
    }
};

const definitions = registry.getBooleanDefinitions();
const keys = JSON.parse(JSON.stringify(definitions.map((definition) => definition.key).sort()));
assert.deepStrictEqual(keys, extractAllowedFeatureOverrides(), 'feature registry and host whitelist should match');
assert.deepStrictEqual(keys, Object.keys(expectedDefinitions).sort(), 'feature registry should contain the expected feature set');

for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    const expectedDefinition = expectedDefinitions[definition.key];
    assert(definition.key, 'feature key is required');
    assert(definition.storageKey, definition.key + ' storageKey is required');
    assert.strictEqual(typeof definition.defaultValue, 'boolean', definition.key + ' defaultValue should be boolean');
    assert(definition.title, definition.key + ' title is required');
    assert(definition.description, definition.key + ' description is required');
    assert.deepStrictEqual({
        storageKey: definition.storageKey,
        defaultValue: definition.defaultValue,
        group: definition.group
    }, expectedDefinition, definition.key + ' definition should keep its public contract');
}

assert.strictEqual(registry.getDefaultValue('playbackDiagnosticsEnabled', true), false);
assert.strictEqual(registry.getDefaultValue('disableAssRenderAhead', false), true);
assert.strictEqual(registry.getInitialBooleanValue('lpcmAudioCopyEnabled', {
    lpcmAudioCopyEnabled: true
}, false), true);

const storage = {
    values: {
        webos_disable_ass_render_ahead: '0',
        webos_ass_time_sync_fix: '1'
    },
    getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    },
    setItem: function (key, value) {
        this.values[key] = value;
    }
};

assert.strictEqual(registry.loadBooleanValue('disableAssRenderAhead', storage, true), false);
assert.strictEqual(registry.loadBooleanValue('assTimeSyncFixEnabled', storage, false), true);
registry.saveBooleanValue('lpcmAudioCopyEnabled', storage, true);
assert.strictEqual(storage.values.webos_lpcm_audio_copy, 'true');

const payload = registry.createOverridePayload({
    playbackDiagnosticsEnabled: true,
    disableAssRenderAhead: false,
    assTimeSyncFixEnabled: true,
    pgsForceMainThread: false,
    pgsPatchObjectReuse: true,
    lpcmAudioCopyEnabled: true,
    unrelated: true
});
assert.deepStrictEqual(Object.keys(payload).sort(), keys);
assert.strictEqual(payload.unrelated, undefined);
