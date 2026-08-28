/* global window */
(function (window) {
    var Runtime = window.__JellyfinWebOSPatchRuntime = window.__JellyfinWebOSPatchRuntime || {};

    // One definition of "what kind of stream is this".
    //
    // These predicates used to exist twice with opposite answers: webOS.js read
    // a missing Type as "not video" while hdrDecisions read it as "video", and
    // the subtitle pair disagreed the same way. The same PlaybackInfo payload
    // could therefore be classified one way by the HDR verdict and the other by
    // the diagnostics next to it.
    //
    // The resolved semantics: a stream states its own kind, and one that does
    // not state it is unknown -- never assumed to be the kind being asked about.
    // Guessing "video" let an audio track's title feed the HDR text scan and let
    // an audio codec drive the stream-copy prediction.
    //
    // Jellyfin serialises MediaStream.Type as a PascalCase string, but the API
    // has also emitted camelCase and the numeric enum, so all three are read.

    var STREAM_TYPE_ENUM = {
        audio: 0,
        video: 1,
        subtitle: 2,
        embeddedimage: 3,
        lyric: 4
    };

    function readStreamType(stream) {
        if (!stream || typeof stream !== 'object') {
            return null;
        }

        var type = Object.prototype.hasOwnProperty.call(stream, 'Type') ? stream.Type : stream.type;
        if (type === null || type === undefined || type === '') {
            return null;
        }
        return type;
    }

    function isStreamOfType(stream, name) {
        var type = readStreamType(stream);
        if (type === null) {
            return false;
        }

        var expected = STREAM_TYPE_ENUM[name];
        if (typeof type === 'number') {
            return type === expected;
        }

        var normalized = type.toString().toLowerCase();
        return normalized === name || normalized === expected.toString();
    }

    function isVideoMediaStream(stream) {
        return isStreamOfType(stream, 'video');
    }

    function isAudioMediaStream(stream) {
        return isStreamOfType(stream, 'audio');
    }

    function isSubtitleMediaStream(stream) {
        return isStreamOfType(stream, 'subtitle');
    }

    // True only when the stream says outright that it is not this kind. Callers
    // that want to fall back to another signal (a codec check, say) use this to
    // tell "said no" apart from "did not say".
    function hasDeclaredStreamType(stream) {
        return readStreamType(stream) !== null;
    }

    Runtime.define('core.mediaStreams', {
        readStreamType: readStreamType,
        isStreamOfType: isStreamOfType,
        isVideoMediaStream: isVideoMediaStream,
        isAudioMediaStream: isAudioMediaStream,
        isSubtitleMediaStream: isSubtitleMediaStream,
        hasDeclaredStreamType: hasDeclaredStreamType
    });
}(window));
