/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};

    Runtime.modules = Runtime.modules || {};
    Runtime.moduleOrder = Runtime.moduleOrder || [];
    Runtime.owner = 'jellyfin-webos-fork';

    Runtime.define = function (name, module) {
        if (!name) {
            return module;
        }

        if (!Object.prototype.hasOwnProperty.call(Runtime.modules, name)) {
            Runtime.moduleOrder.push(name);
        }
        Runtime.modules[name] = module || {};
        return Runtime.modules[name];
    };

    Runtime.get = function (name) {
        return Runtime.modules[name] || null;
    };

    Runtime.version = '1';
})(window);
