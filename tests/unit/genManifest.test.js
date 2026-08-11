const assert = require('assert');
const manifestTools = require('../../tools/gen-manifest');

assert.strictEqual(
    manifestTools.normalizeRepositoryUrl('git+https://github.com/Wreathlit/jellyfin-webos-fork.git'),
    'https://github.com/Wreathlit/jellyfin-webos-fork'
);

const manifest = manifestTools.createManifest({
    id: 'org.jellyfin.webos',
    version: '1.2.2',
    type: 'web',
    title: 'Jellyfin',
    appDescription: 'Test'
}, {
    repository: {
        type: 'git',
        url: 'https://github.com/Wreathlit/jellyfin-webos-fork.git'
    }
}, 'org.jellyfin.webos_1.2.2_all.ipk', 'abc123', {
    GITHUB_SHA: '0123456789abcdef'
});

assert.strictEqual(manifest.sourceUrl, 'https://github.com/Wreathlit/jellyfin-webos-fork');
assert.strictEqual(
    manifest.iconUri,
    'https://github.com/Wreathlit/jellyfin-webos-fork/raw/0123456789abcdef/frontend/submission-icon.png'
);
assert.strictEqual(manifest.ipkHash.sha256, 'abc123');
assert.throws(function () {
    manifestTools.createManifest({}, {}, 'file.ipk', 'hash', {});
}, /repository URL/);
