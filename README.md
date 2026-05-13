# jellyfin-webos local fork

This fork carries local webOS fixes on top of Jellyfin for webOS. It is aimed at
real LG webOS devices where the hosted Jellyfin Web UI exposes TV-specific
problems that are hard to solve from the server alone.

The main local patch surface is:

- `frontend/js/index.js`
- `frontend/js/webOS.js`
- `frontend/css/webOS.css`

## Why this fork exists

The upstream webOS app is mostly a wrapper around Jellyfin Web. On recent LG
TVs, several playback behaviors still need webOS-side intervention:

- playback startup can ignore high bitrate intent before the player reaches the
  normal `PLAYING` state;
- iframe handoff can race async webOS device information and can lose TV remote
  focus;
- Jellyfin Web quality action sheets changed enough that old menu injection can
  attach to the wrong DOM or not attach at all;
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
menu injection too dependent on one action-sheet DOM shape.

Approach:

- add extra high bitrate menu entries: `120 Mbps`, `100 Mbps`, and `80 Mbps`;
- force PlaybackInfo `MaxStreamingBitrate` / `maxStreamingBitrate` in both URL
  query strings and request bodies during a short playback-start window;
- arm that force window from explicit playback-start signals and from new
  PlaybackInfo item ids;
- patch only bitrate-shaped menu items inside the action-sheet scroller to avoid
  false positives;
- keep the quality-menu observer active so late-created action sheets are still
  patched.

Status: active workaround. Do not narrow this back to `PLAYING` state only; that
reintroduces the startup race where a newly opened video can keep the upstream
`60 Mbps` cap until the user manually changes quality.

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
- group them under secondary headings: HDR UI, ASS subtitles, PGS subtitles, and
  diagnostics;
- move already-injected controls into the grouped block instead of duplicating
  them;
- throttle mutation-triggered injection refreshes and ignore mutations inside
  the injected block, so sliders and checkboxes keep focus while being used.

Injected controls:

- HDR/DV UI dim brightness for playback overlays and ASS/PGS subtitles;
- HDR/DV ASS/PGS subtitle opacity;
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
image subtitles after they reach the webOS WebView.

Approach:

- add an HDR/DV UI brightness slider backed by CSS variables;
- apply dimming to OSD/dialog/action-sheet UI without touching the video pixels;
- derive ASS and PGS subtitle brightness from the same UI brightness setting;
- add one shared subtitle opacity slider for ASS and PGS overlays.

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
  webOS;
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
  instead of all matching object definitions since the last epoch break.

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
