/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};

    // One URL reader for the bundle.
    //
    // playback.hdrDecisions used to carry its own copy of the query parser and
    // the two had drifted in ways that changed verdicts: this one splits the
    // fragment off and strips ASCII tabs and newlines the way the WHATWG parser
    // does, while that one ran its regex over the raw string. The same
    // TranscodingUrl could therefore read as 'directstream' for the HDR verdict
    // (a `#route?Static=true` fragment taken for a query) and as something else
    // for the burned-in subtitle patch that reads it next, and a value with a
    // trailing CR/LF compared unequal to itself.
    //
    // Lives in core/ because both playback modules need it and neither loads
    // before the other.
    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeUrlInput(url) {
        // Match the WHATWG URL parser's input preprocessing: remove ASCII
        // tabs/newlines anywhere, then strip leading/trailing C0 controls and
        // spaces. Keep internal spaces because they are part of the path.
        return url
            .replace(/[\u0009\u000A\u000D]/g, '')
            .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
    }

    function splitUrlComponents(url) {
        url = normalizeUrlInput(url);

        var hash = '';
        var hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
            hash = url.substring(hashIndex);
            url = url.substring(0, hashIndex);
        }

        var query = '';
        var queryIndex = url.indexOf('?');
        if (queryIndex !== -1) {
            query = url.substring(queryIndex + 1);
            url = url.substring(0, queryIndex);
        }

        return {
            base: url,
            query: query,
            hash: hash
        };
    }

    function getQueryParameterValue(url, name) {
        if (!url || typeof url !== 'string' || !name) {
            return null;
        }

        var query = splitUrlComponents(url).query;
        // Case-insensitive for the same reason as playback.hdrDecisions: the
        // server binds query parameters without regard to case, so the spelling
        // in the URL depends on who built it.
        var pattern = new RegExp('(?:^|&)' + escapeRegExp(name) + '=([^&]*)', 'i');
        var match = pattern.exec(query);
        if (!match || match.length < 2) {
            return null;
        }

        try {
            return decodeURIComponent(match[1].replace(/\+/g, '%20'));
        } catch (error) {
            return match[1];
        }
    }

    // The path of a URL, with query and fragment removed and any authority
    // stripped. Shared because webOS.js classifies three more endpoints and was
    // doing it on the raw string: '/Items/x/PlaybackInfo?next=/sessions' satisfied
    // its Sessions test, and the fetch wrapper checks Sessions first, so that
    // PlaybackInfo request was read as a session list and skipped bitrate forcing,
    // HDR detection and the burned-in subtitle patch entirely.
    function getUrlPathname(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }

        var pathname = splitUrlComponents(url).base;
        // HTTP(S) URL parsing treats a raw backslash as a path separator. Do
        // not classify a different normalized path using the raw string.
        if (pathname.indexOf('\\') !== -1) {
            return '';
        }
        var hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(pathname);
        var isProtocolRelative = pathname.indexOf('//') === 0;
        var authorityMatch = null;
        if (hasScheme) {
            authorityMatch = /^[a-z][a-z0-9+.-]*:\/\/([^\/\s]+)(\/.*)?$/i.exec(pathname);
            if (!authorityMatch) {
                return '';
            }
            pathname = authorityMatch[2] || '/';
        } else if (isProtocolRelative) {
            authorityMatch = /^\/\/([^\/\s]+)(\/.*)?$/.exec(pathname);
            if (!authorityMatch) {
                return '';
            }
            pathname = authorityMatch[2] || '/';
        }
        return pathname;
    }

    Runtime.define('core.urls', {
        escapeRegExp: escapeRegExp,
        normalizeUrlInput: normalizeUrlInput,
        splitUrlComponents: splitUrlComponents,
        getQueryParameterValue: getQueryParameterValue,
        getUrlPathname: getUrlPathname
    });
})(window);
