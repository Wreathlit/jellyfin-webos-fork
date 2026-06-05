# jellyfin-webos local fork

This fork carries local webOS fixes on top of Jellyfin for webOS. It is aimed at
real LG webOS devices where the hosted Jellyfin Web UI exposes TV-specific
problems that are hard to solve from the server alone.

The main local patch surface is:

- `frontend/js/index.js`
- `frontend/js/injected/`
- `frontend/js/webOS.js`
- `frontend/css/webOS.css`

`frontend/js/injected/` is the behavior-preserving modular runtime used by the
iframe injection path. Its current `core/features.js` registry owns boolean and
numeric setting metadata such as storage keys, defaults, ranges, and settings
text. Boolean feature overrides still use the existing postMessage whitelist;
HDR brightness and subtitle opacity remain local numeric display settings.
`playback/profilePatches.js` owns the pure device profile compatibility
transforms: bitrate caps, known-bad video capability reporting, audio-transcode
video-copy allowance, subtitle delivery profile reporting, and the optional
LPCM/PCM DirectPlay audio copy expansion. `webOS.js` keeps the runtime hooks and
passes the current settings into that module. `playback/playbackInfoPatches.js`
owns pure PlaybackInfo URL/body bitrate and nested device-profile body patching;
fetch/XHR interception, playback-start force windows, and diagnostics stay in
`webOS.js`. `subtitles/scriptPatches.js` owns pure ASS/PGS renderer script text
replacement and reports which patch families matched; script interception,
runtime counters, warning policy, and DOM/XHR behavior stay in `webOS.js`.
`playback/hdrDecisions.js` owns pure HDR/Dolby Vision and video-delivery
decisions used by the dimming logic; DOM scanning, playback state, and the
actual dim class stay in `webOS.js`.

## Why this fork exists

The upstream webOS app is mostly a wrapper around Jellyfin Web. On recent LG
TVs, several playback behaviors still need webOS-side intervention:

- playback startup can ignore high bitrate intent before the player reaches the
  normal `PLAYING` state;
- iframe handoff can race async webOS device information and can lose TV remote
  focus;
- Jellyfin Web quality action sheets changed enough that old menu injection can
  attach to the wrong DOM or not attach at all;
- pointer-mode clicks can be consumed by TV focus handling before the intended
  card/button action runs;
- complex ASS subtitles can stutter or visually jump when webOS reports small
  backward media-time samples to the subtitle renderer;
- complex PGS subtitles can flash stale text when libpgs reuses object ids in
  worker/offscreen paths that this fork cannot safely patch in-place;
- debugging real-device playback needs an on-screen overlay because DevTools is
  not always available during TV testing.

## Local problem log

### Playback bitrate and quality menu

Problem: new playback sessions can fall back to Jellyfin Web's upstream
`60 Mbps` cap, and the quality action sheet can miss the locally injected
high-bitrate entries.

Cause: real-device traces showed that Jellyfin Web can issue PlaybackInfo
requests and create quality action sheets before the webOS adapter reaches the
normal `PLAYING` / media-session state. Upstream UI changes also made the old
menu injection too dependent on one action-sheet DOM shape. High-bitrate HDR
files can also hit the upstream device profile's static-playback bitrate limit
even when the PlaybackInfo request bitrate was raised.

Approach:

- add extra high bitrate menu entries: `120 Mbps`, `100 Mbps`, `95 Mbps`, and `80 Mbps`;
- force PlaybackInfo `MaxStreamingBitrate` / `maxStreamingBitrate` in both URL
  query strings and request bodies for every PlaybackInfo request;
- raise device profile `MaxStreamingBitrate` and `MaxStaticBitrate` to the
  highest local bitrate option so direct play is not rejected by the profile's
  static bitrate cap;
- arm that force window from explicit playback-start signals and from new
  PlaybackInfo item ids for diagnostics and compatibility with older traces;
- patch only bitrate-shaped menu items inside the action-sheet scroller to avoid
  false positives;
- keep the quality-menu observer active so late-created action sheets are still
  patched.

Status: active workaround. Do not narrow this back to `PLAYING` state only; that
reintroduces the startup race where a newly opened video can keep the upstream
`60 Mbps` cap until the user manually changes quality.

### Audio-only transcode with client-rendered subtitles

Problem: when unsupported audio triggers audio transcoding while video is copied,
ASS and PGS subtitles can disappear even though they render in direct playback.

Cause: the server can put audio-only transcode into a video direct-stream
pipeline where the video is copied (`PlayMethod=DirectStream` or
`TranscodingUrl` with `Static=true`). In that mode Jellyfin's subtitle selection
is driven by the client device profile. If the profile does not explicitly
advertise external ASS/PGS support, or if HLS text subtitles are not allowed in
the manifest, the video-copy/audio-transcode path can lose the subtitle delivery
declaration. Server-side subtitle extraction settings can also make
`StreamBuilder` fall back to `Encode` for internal ASS/PGS during a transcode
path even though the subtitle API can still serve the raw subtitle stream for
client rendering.

Approach:

- keep the HEVC/H265 video-copy patch for audio-only transcode;
- explicitly advertise external `ass`, `ssa`, `pgssub`, and `pgs` subtitle
  profiles for Jellyfin Web's client-side renderers only when Jellyfin Web's
  native `Burn subtitles` mode still allows that class of subtitle to be
  client-rendered;
- prefer External delivery for existing PGS subtitle profiles so Jellyfin picks
  the client-rendered PGS path before Embed/Encode when burn-in is not required;
- enable subtitles in HLS video transcoding manifests so text subtitle tracks
  remain visible when the server chooses an HLS direct-stream path;
- do not rewrite PlaybackInfo subtitle delivery responses locally. BDMV folder
  PGS delivery failures have been traced to upstream/server path selection, so
  the client should not synthesize subtitle URLs or override server delivery
  methods;
- respect Jellyfin's native subtitle burn-in controls. `Burn subtitles` gates
  the client-rendered ASS/SSA/PGS profiles before the server chooses a delivery
  method; `Always burn in subtitle on transcoding` is passed through separately
  for cases where transcoding is already selected. webOS profile reporting can
  still make unsupported video formats such as interlaced H264 transcode, and
  can prefer client-rendered PGS delivery when burn-in is not required, but it
  must not override the user's burn-in mode;
- keep the last PlaybackInfo payload available for the playback-start fallback
  window for HDR detection without adding more subtitle delivery heuristics.

Status: active workaround. This fork still advertises client-renderable subtitle
profiles and keeps the HEVC/H265 video-copy path, but it no longer rewrites
PlaybackInfo subtitle delivery. PGS timing/main-thread/object-reuse fixes are
renderer-side patches and are separate from server subtitle delivery.

### Playback decision boundaries

The playback compatibility patches intentionally keep four decisions separate:

- Video transcoding is controlled by video/container capability reporting. The
  fork only removes known-bad direct-play claims such as DVD/MPEG and interlaced
  H264 support; it should not use subtitle state to decide video codec support.
- Audio transcoding is controlled by Jellyfin Web's audio capability and
  passthrough profile generation. The fork only allows video codec copy in video
  transcode profiles for codecs that the patched device profile still reports as
  direct-play capable, so unsupported audio can transcode without dragging
  supported HEVC/HDR video into a video encode. Unsupported video codecs must
  still transcode. The experimental LPCM/PCM audio-copy option is default-off;
  when enabled it only appends Blu-ray/DVD LPCM and common PCM codec names to
  existing video DirectPlay audio codec lists, so it does not bypass video
  codec capability checks or advertise PCM as a supported HLS/fMP4 transcode
  output.
- Subtitle burn-in is controlled by Jellyfin's native settings and the selected
  video path. The fork reads the saved `subtitleburnin` mode and follows
  upstream `subtitleburnin` gating for the subtitle profiles it owns: `all`
  prevents the fork from adding or converting ASS/SSA/PGS External delivery,
  `allcomplexformats` prevents ASS/SSA and PGS External delivery, and
  `onlyimageformats` prevents PGS External delivery. It also does not force
  `AlwaysBurnInSubtitleWhenTranscoding`, synthesize PlaybackInfo subtitle URLs,
  delete subtitle burn-in query parameters, or clean up unrelated upstream
  subtitle profiles.
- HDR/DV UI dimming is applied only when the detected playback range is HDR/DV
  and PlaybackInfo indicates that the video stream is DirectPlay, DirectStream,
  or transcode-with-video-copy (`VideoCodec=copy`). `Static=true` is classified
  as DirectStream. If video delivery is unknown or is a video transcode, the UI
  dim class is not enabled.

The diagnostics overlay prints
`video=directplay|directstream|copy|transcode|unknown` next to `range=...` so HDR
dimming issues can be separated from codec, audio, and subtitle routing.

### LPCM/PCM audio copy option

Problem: some LPCM/PCM tracks are still converted to AAC even when the TV is
connected to an AVR. This blocks testing whether the receiver path can handle
PCM directly.

Cause: Jellyfin Web's webOS profile only advertises a narrow PCM set by
default. Blu-ray/DVD LPCM and other PCM variants can therefore look unsupported,
and the server chooses audio transcode even when the video is otherwise
copyable.

Approach:

- expose `webOS: Allow LPCM/PCM audio copy` as a default-off playback setting;
- add `pcm_s16le`, `pcm_s24le`, `pcm_bluray`, and `pcm_dvd` to existing video
  DirectPlay audio codec lists;
- do not patch video transcode audio codec lists yet, because advertising PCM
  for every HLS/fMP4/TS path can prevent the normal AAC fallback and produce an
  unplayable stream;
- do not create new codec lists when a profile omitted `AudioCodec`, because
  that could accidentally narrow an upstream "unrestricted" profile.

Status: experimental. Enable it only for ARC/eARC/receiver tests and restart
playback after changing. This first version is intentionally limited to
DirectPlay. If the selected container/protocol cannot carry the PCM track on a
given path, the server or player may still need to transcode audio.

### Startup handoff and iframe focus

Problem: Dolby Vision / HDR capability detection can be inconsistent at app
startup, and TV remote navigation can start with focus outside the hosted
Jellyfin Web iframe after it is loaded.

Cause: `webOS.deviceInfo()` is asynchronous, but Jellyfin Web receives
`window.DeviceInfo` during iframe script injection. If the iframe is loaded
before the Luna callback finishes, HDR/DV flags can be injected as `null`.

Approach:

- wait for `webOS.deviceInfo()` before assigning the Jellyfin Web iframe URL;
- focus the content iframe after handoff so normal TV navigation starts inside
  Jellyfin Web.

Status: active workaround. The device-info wait is based on upstream PR #331,
and iframe focus follows upstream PR #332.

### Pointer click activation

Problem: in pointer mode, clicking a focusable card/button can first move focus
and scroll the list toward centering that item instead of immediately running
the clicked action. This is especially visible when Jellyfin Web currently has
no useful focus, but the expected mouse behavior is the same even when another
item is focused.

Cause: the TV layout focus manager can treat the first pointer interaction as a
focus request. That focus path can call scroll positioning before the normal
click action is allowed to run.

Approach:

- capture primary pointer/mouse down events before Jellyfin Web focus handling;
- resolve the nearest actionable container, such as a card, list item, button,
  link, role button/link/menu item, or `data-action` element;
- if that container can directly respond to click, call its `click()` handler at
  the container level and suppress the following native click to avoid double
  activation;
- if the target cannot directly respond to click, focus it with
  `preventScroll` and restore the surrounding scroll containers.

Status: active workaround. Injected settings controls are skipped so sliders and
checkboxes keep their native behavior.

### Settings injection

Problem: locally injected playback options can disappear after leaving and
re-entering the Playback settings page, or fail when Jellyfin Web changes route
names / setting DOM structure.

Cause: the hosted Jellyfin Web settings UI is rebuilt dynamically. A route-gated
or single-anchor injection strategy can miss the later DOM instance.

Approach:

- keep a conservative always-on observer for settings injection;
- persist settings through the local webOS feature override state;
- append all local controls to the end of the Playback settings content;
- never fall back to injecting into `body`; if the Playback settings container
  cannot be found, remove any stale injected block;
- put them under a dedicated `webOS playback fixes` main heading;
- group them under secondary headings: HDR UI, webOS audio, ASS subtitles, PGS
  subtitles, and diagnostics;
- move already-injected controls into the grouped block instead of duplicating
  them;
- throttle mutation-triggered injection refreshes and ignore mutations inside
  the injected block, so sliders and checkboxes keep focus while being used.

Injected controls:

- HDR/DV UI dim brightness for playback overlays and ASS/PGS subtitles;
- HDR/DV ASS/PGS subtitle opacity;
- experimental LPCM/PCM DirectPlay audio copy over ARC/eARC receiver paths;
- fix ASS time rollback;
- disable ASS render-ahead;
- force PGS main-thread renderer;
- patch PGS object reuse;
- playback diagnostics overlay.

Status: active workaround. The observer is intentionally not route-gated.
Playback/settings menus are not active while video is rendering, so the
practical cost is low.

### HDR UI and subtitle brightness

Problem: during HDR/Dolby Vision playback, Jellyfin Web overlays and subtitles
can be visually too bright on LG webOS panels. ASS and PGS overlays also need a
consistent subtitle opacity control.

Cause: the video plane and Web UI plane are handled differently by the TV. The
server cannot reliably tone-map Jellyfin Web overlays, canvas subtitles, and
image subtitles after they reach the webOS WebView. Jellyfin metadata can also
arrive through several paths: newer responses expose `VideoRange` /
`VideoRangeType` string enums, while some payloads still expose numeric
`MediaStream.Type` values. Some playback starts expose the decisive HDR signal
slightly after the adapter enters fullscreen, so applying the first unknown
result too eagerly can leave dimming disabled until the Playback Info panel text
appears and the UI-text fallback sees `HDR`.

Approach:

- add an HDR/DV UI brightness slider backed by CSS variables;
- apply dimming to OSD/dialog/action-sheet/Playback Info UI without touching the
  video pixels;
- derive ASS and PGS subtitle brightness from the same UI brightness setting;
- add one shared subtitle opacity slider for ASS and PGS overlays;
- accept both string and legacy numeric video stream types during HDR detection;
- inspect `VideoRange`, `VideoRangeType`, Dolby Vision, HDR10+, color-transfer,
  display-title, and Playback Info/player-stats text as fallback HDR signals;
- after entering playback, run a short delayed fallback window that reapplies
  cached PlaybackInfo hints, refreshes item metadata detection, and scans visible
  playback UI text again.

Status: active feature. ASS and PGS intentionally share
`--webos-hdr-subtitle-opacity`; keeping a separate PGS opacity variable made the
implementation look more configurable than the UI actually is.

### ASS subtitle timing

Problem: complex ASS subtitles can stutter, visually jump, or show small
animation rollbacks on webOS even when normal video playback rAF is stable.

Cause: device testing showed small backward `currentTime` samples reaching
libass. Active high-frequency time sync reduced visible rollback but converted
the jitter into high-frequency visual stutter. libass render-ahead can also
cache frames that are later replayed out of sync.

Approach:

- patch libass renderer script options so `renderAhead` defaults to `0` on
  webOS. The fragile script-text replacement is isolated in
  `subtitles/scriptPatches.js`, while `webOS.js` only records counters and
  performs script interception;
- expose the small-backward-time clamp as `webOS: Fix ASS time rollback`,
  enabled by default;
- clamp only small backward `currentTime` messages posted to the ASS worker when
  that option is enabled;
- leave large backward jumps and seek behavior alone;
- do not remove ASS animations, because that defeats the purpose of preserving
  animated subtitles.

Status: verified improvement. The best observed behavior came from letting
libass run on its own clock while preventing small backward media-time samples.

### PGS subtitle stale text

Problem: complex PGS subtitles, especially vertical/text-heavy tracks, can flash
the previous subtitle text just before the next subtitle appears.

Cause: diagnostics showed PGS render request/post counters increasing while
backward/drop counters stayed at zero. That ruled out a simple main-thread index
rollback. A worker-side Blob URL patch was tested but disabled because it can
prevent PGS workers from starting on webOS WebView. Further isolation found that
the stale text only disappears when libpgs is forced into the patchable
main-thread path and the object-id reuse fix is enabled. This points at stale
subtitle data in libpgs display-set parsing: reused object ids can concatenate
old ODS data with the current object data.

Approach:

- pass `renderAtVideoTimestamp()` through a monotonic media-time helper;
- count raw backward PGS media-time samples and clamped samples separately;
- guard main-thread delayed `requestAnimationFrame` draws against stale indexes;
- guard `workerWithoutOffscreenCanvas` subtitle-data replies against stale
  returned indexes;
- guard OffscreenCanvas `render` posts against non-seek backward indexes;
- force libpgs to use the `mainThread` renderer by default on webOS;
- patch libpgs object lookup so reused object ids use the newest ODS sequence
  instead of all matching object definitions since the last epoch break. The
  string rewrite patterns live in `subtitles/scriptPatches.js`; webOS runtime
  state, renderer options, monotonic-time helpers, and diagnostics stay in
  `webOS.js`.

Status: verified workaround. The verified good combination is `target=main`,
`obj=on`. `target=main`, `obj=off` still flashes, so the object-id reuse fix is
required. `target=auto`, `obj=on` still flashes on the tested device because the
active worker/offscreen path does not receive the main-script object-id patch.
The two PGS switches remain available for future isolation or for evaluating a
safe non-Blob worker patch.

### Playback diagnostics overlay

Problem: TV-side playback debugging often has to happen without reliable
DevTools access, and full console/script URLs are too noisy for real-device A/B
tests.

Cause: the relevant failures are timing and path-selection issues. The useful
signal is whether the expected patch path is active and whether counters move
during playback, not static environment strings.

Approach:

- provide an optional on-screen diagnostics overlay from the injected settings;
- show playback state, dynamic range, rAF FPS, `requestVideoFrameCallback` FPS
  when available, long-task stats, video dimensions/time, and dropped frames;
- show compact ASS patch/message/clamp counters;
- show compact PGS patch/media-time/render/main-thread counters and active PGS
  diagnostic switches;
- omit static values such as browser user agent, patched script URL, and CSS
  filter details.

Status: active diagnostic tool. PGS patch counters such as `mode1` and `o1`
mean the conditional hook was installed into libpgs. They do not mean the switch
is currently active; use `target=main/auto` and `obj=on/off` for the active test
case.

## Build and test

Install dependencies:

```sh
npm install
```

Validate package metadata:

```sh
npm run check
```

Build an IPK:

```sh
npm run package
```

When the default `build` output is locked by a previous install/test session,
write to a new output directory:

```sh
ares-package --no-minify --outdir build-local services frontend
```

Install to a configured TV:

```sh
ares-install -d tv build-local/org.jellyfin.webos_1.2.2_all.ipk
```

Launch:

```sh
ares-launch -d tv org.jellyfin.webos
```

## Real-device notes

- For ASS tests, `assWorker clamp` increasing means small backward video-time
  samples are being corrected.
- For PGS tests, `pgs time` increasing means the client libpgs time patch is
  active.
- For PGS OffscreenCanvas tests, `pgs render req/post` increasing means the
  client render path is active.
- In the current PGS workaround, `PGS ... target=main` and increasing `main`
  counters mean libpgs is using the forced main-thread renderer and the delayed
  draw guard is active. If `main` drop stays zero, the delayed draw guard did
  not contribute to the observed fix.
- The verified good PGS combination is `target=main`, `obj=on`.
- The verified isolation results are:
  - `target=main`, `obj=off`: still flashes stale text, so the object-id reuse
    fix is required.
  - `target=auto`, `obj=on`: still flashes stale text on the tested device,
    because the active worker/offscreen path does not receive the main-script
    object-id patch.
  - `target=auto`, `obj=off`: upstream-like baseline and expected to reproduce
    the stale-text flash.

## Upstream README

See the upstream project documentation:

https://github.com/jellyfin/jellyfin-webos/blob/master/README.md
