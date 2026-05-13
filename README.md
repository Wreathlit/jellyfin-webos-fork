# jellyfin-webos local fork

This fork carries local webOS fixes on top of Jellyfin for webOS. It is aimed at
real LG webOS devices where the hosted Jellyfin Web UI exposes TV-specific
problems that are hard to solve from the server alone.

The main local patch surface is:

- `frontend/js/webOS.js`
- `frontend/css/webOS.css`

## Why this fork exists

The upstream webOS app is mostly a wrapper around Jellyfin Web. On recent LG
TVs, several playback behaviors still need webOS-side intervention:

- playback startup can ignore high bitrate intent before the player reaches the
  normal `PLAYING` state;
- Jellyfin Web quality action sheets changed enough that old menu injection can
  attach to the wrong DOM or not attach at all;
- complex ASS subtitles can stutter or visually jump when webOS reports small
  backward media-time samples to the subtitle renderer;
- complex PGS subtitles can flash stale text because libpgs may schedule worker
  draws asynchronously;
- debugging real-device playback needs an on-screen overlay because DevTools is
  not always available during TV testing.

## Local changes

### Playback bitrate and quality menu

- Adds extra high bitrate menu entries: `120 Mbps`, `100 Mbps`, and `80 Mbps`.
- Forces PlaybackInfo `MaxStreamingBitrate` / `maxStreamingBitrate` in both URL
  query strings and request bodies during playback startup.
- Arms a short force window from explicit playback-start signals and from new
  PlaybackInfo item ids, so new videos do not fall back to Jellyfin Web's
  `60 Mbps` cap before media-session state is ready.
- Narrows quality action-sheet patching to bitrate-shaped menu items inside the
  action sheet scroller, reducing false positives when Jellyfin Web changes menu
  structure.
- Keeps the quality menu observer active so late-created action sheets are
  patched even when Jellyfin Web opens them before playback state settles.

Review note: do not narrow this back to `PLAYING` state only. On real devices,
Jellyfin Web can create PlaybackInfo requests and quality action sheets before
`updateMediaSession()` / fullscreen state has settled. If the observer or force
window waits for `PLAYING`, a newly opened video can keep the upstream `60 Mbps`
cap until the user manually changes quality.

### Settings injection

The fork injects webOS-specific settings into the current playback/settings UI
using a conservative always-on observer instead of relying on one fixed upstream
DOM shape or route name.

Injected controls include:

- HDR/DV UI dim brightness for playback overlays and ASS/PGS subtitles;
- HDR/DV ASS/PGS subtitle opacity;
- disable ASS render-ahead;
- drop ASS animations, for diagnostics only;
- playback diagnostics overlay.

The settings are persisted through the same local feature override mechanism
used by the webOS adapter.

Review note: this observer is intentionally not route-gated. Playback/settings
menus are not active while video is rendering, so the practical cost is low, and
route-gating caused injected controls to disappear after leaving and re-entering
the Playback settings page.

### ASS subtitle fixes

ASS rendering is handled through Jellyfin/libass script and worker patching:

- patches libass renderer script options so `renderAhead` defaults to `0` on
  webOS;
- keeps `dropAllAnimations` disabled by default, because dropping ASS animations
  removes subtitle effects and defeats the purpose of the fix;
- clamps small backward `currentTime` messages posted to the ASS worker instead
  of actively re-syncing the worker at high frequency;
- leaves large backward jumps and seek behavior alone.

Reason: testing showed that active time sync reduced visible rollback but turned
media-time jitter into high-frequency visual stutter. Letting libass run on its
own clock while clamping only small backward samples produced the best observed
result.

### PGS subtitle fixes (unfinished)

PGS rendering uses libpgs, which can run in several modes. This fork instruments
and guards all relevant paths found during real-device testing:

- patches `renderAtVideoTimestamp()` to pass PGS time through a monotonic helper;
- counts raw backward PGS media-time samples and clamped samples separately;
- guards `workerWithoutOffscreenCanvas` subtitle-data replies against stale
  returned indexes;
- guards OffscreenCanvas `render` posts against non-seek backward indexes;

Reason: on the tested device, PGS client `render req/post` increased while
`back/drop` stayed at zero, meaning the main thread was not sending backward
indexes. A worker-side Blob URL patch was tested but disabled because it can
prevent PGS workers from starting on webOS WebView. If stale PGS text persists,
the next safe path is to inspect libpgs display-set parsing or find a non-Blob
worker patch strategy.

Status: unfinished. The current code keeps diagnostics and client-side guards,
but the remaining stale-text flash has not been fully fixed.

### Playback diagnostics overlay

The diagnostics overlay is enabled from the injected settings UI. It reports:

- playback state and dynamic range;
- `requestAnimationFrame` FPS;
- `requestVideoFrameCallback` FPS when available;
- long-task count, duration, and max duration;
- video dimensions, time, paused state, ready state, and playback rate;
- ASS canvas size and CSS size;
- ASS script/worker patch counters and media-time clamp counters;
- PGS script/client patch counters, media-time counters, render counters, and
  stale draw/drop counters;
- browser user agent.

This is intentionally verbose because it is used to decide whether a real-device
test is hitting the expected patched path.

### HDR UI dimming

The fork keeps HDR/DV UI dimming support for playback overlays and keeps the
ASS/libass and PGS/image subtitle brightness controls for HDR/DV viewing. The
HDR/DV UI brightness slider updates the UI brightness variable plus derived
subtitle brightness variables used by ASS and PGS overlays. A separate subtitle
opacity slider controls the single subtitle opacity variable shared by ASS and
PGS overlays. These controls are independent of the ASS timing fixes.

Review note: ASS and PGS intentionally share `--webos-hdr-subtitle-opacity`.
There is only one opacity slider and both subtitle families should move
together. Keeping a second `--webos-hdr-pgs-opacity` variable made the code look
more configurable than the UI actually is and caused unnecessary CR noise.

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
- If PGS still flashes old text while all backward/drop counters stay at zero,
  inspect the PGS display-set parsing path next; the stale text may already be
  present in the subtitle data returned for the current index.

## Upstream README

See the upstream project documentation:

https://github.com/jellyfin/jellyfin-webos/blob/master/README.md
