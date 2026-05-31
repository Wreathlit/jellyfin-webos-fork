# webOS Container Refactor Assessment

This note records the now-started behavior-preserving module refactor and the
current decision to keep deferring a full Jellyfin client rewrite.

It is intentionally a planning and tracking document. The accepted work is the
incremental injected-runtime split; it does not mean a new standalone client has
been accepted for implementation.

## Current Shape

The app is already a Jellyfin Web container:

- `frontend/index.html` owns the local webOS shell page.
- `frontend/js/index.js` handles server selection, discovery, iframe handoff,
  webOS device info, and injection of local assets into the hosted Jellyfin Web
  page.
- `frontend/js/webOS.js` is the injected compatibility layer. It currently owns
  AppHost bridging, PlaybackInfo interception, bitrate patches, HDR UI dimming,
  ASS and PGS subtitle patches, settings injection, quality menu injection,
  pointer/focus fixes, playback state tracking, and diagnostics.
- `frontend/css/webOS.css` contains local CSS fixes for TV layout, HDR UI
  brightness, and subtitle overlays.
- `services/service.js` provides Jellyfin UDP discovery.

The largest maintenance risk is not the shell itself. The risk is that many
independent runtime patches are now concentrated in one injected script and
depend on Jellyfin Web internals that can move between upstream releases.

## Refactor Direction

If this is pursued, the target should be a rewritten webOS container and patch
framework, not a rewritten Jellyfin client.

The recommended direction is still to load the server-hosted Jellyfin Web UI in
an iframe, then inject a local compatibility layer. The difference is that the
compatibility layer should be modular and lifecycle-driven.

Suggested modules:

- `shell`: server list, auto discovery, iframe handoff, redirect/origin checks,
  webOS device info, and local persistence.
- `bridge`: AppHost implementation, postMessage protocol, and feature override
  synchronization.
- `playback-core`: playback state machine, current item/mediaSource tracking,
  PlaybackInfo request context, and playback-start fallback windows.
- `network-patches`: fetch/XHR hooks, bitrate enforcement, device profile
  patches, subtitle profile reporting, and delivery diagnostics.
- `ui-patches`: quality menu injection, settings injection, pointer/focus
  behavior, and header/focus fixes.
- `hdr`: HDR/Dolby Vision detection, UI dimming, subtitle brightness and
  opacity, PlaybackInfo/metadata/UI text fallback.
- `subtitle`: ASS timing fix, ASS render-ahead control, PGS renderer patches,
  and subtitle diagnostics.
- `diagnostics`: overlay, counters, feature state, and recent PlaybackInfo /
  subtitle delivery summaries.

The first implementation step should be behavior-preserving extraction, not a
new feature pass. Existing storage keys and feature defaults should remain
compatible so real-device testing is comparable.

## What Refactoring Would Improve

A container rewrite or module extraction can improve:

- patch ownership and reviewability;
- ability to enable, disable, and diagnose each workaround independently;
- resilience when Jellyfin Web changes a route, menu, bundle, renderer class, or
  request shape;
- merge conflict size when upstream webOS app changes;
- clearer separation between core playback request patches and optional UI
  injection.

It will not by itself remove all upstream compatibility cost. As long as this
app uses server-hosted Jellyfin Web, patches that touch menus, renderer scripts,
subtitle workers, or Jellyfin Web playback state will remain version-sensitive.

## Bitrate Handling Finding

The current bitrate issue should not be treated as a reason to rewrite the
whole container.

Jellyfin Web mainly generates the quality menu client-side from static bitrate
configurations and current media information. The server does not primarily
"send down" the displayed bitrate menu. The server decides DirectPlay,
DirectStream, or Transcode from PlaybackInfo inputs, including:

- `MaxStreamingBitrate` / `maxStreamingBitrate`;
- the posted device profile;
- `DeviceProfile.MaxStreamingBitrate`;
- `DeviceProfile.MaxStaticBitrate`;
- media source bitrate and stream compatibility;
- user/server remote bitrate limits when the server classifies the client as
  remote.

For the current intended LAN scenario, the existing core approach is mostly
sound:

- force PlaybackInfo query/body max bitrate;
- raise device profile streaming and static bitrate caps;
- keep this active during startup, before normal `PLAYING` state is reached.

The quality menu DOM injection should be considered auxiliary UI only. It is
not a reliable core playback control because it depends on upstream action-sheet
DOM shape and timing.

## Recommended Near-Term Bitrate Improvement

Do a small migration only if bitrate failures continue:

- add one local webOS max playback bitrate setting, defaulting to the highest
  known local option;
- use that value as the single source for PlaybackInfo URL/body/profile patches;
- optionally synchronize Jellyfin Web local settings such as the Video LAN and
  Video remote max bitrate keys so upstream code starts from the desired value;
- consider disabling automatic bitrate detection for Video in this webOS LAN
  profile if real-device traces show it writes lower values back;
- keep quality menu injection as display enhancement, not as the playback
  authority.

This is much smaller than a container rewrite and directly targets the observed
failure mode.

## When To Reconsider The Larger Refactor

Revisit the container/module refactor if any of these become true:

- `frontend/js/webOS.js` continues to grow in unrelated areas and CR starts
  missing real regressions;
- settings/menu injection and playback request patches keep interfering with
  each other;
- upstream Jellyfin Web changes repeatedly break the same class of patches;
- ASS/PGS renderer patches need multiple version-specific implementations;
- diagnostics need structured state from several independent patches;
- the app needs to support non-LAN scenarios with different bitrate policies.

Until then, prefer narrow behavior-preserving changes around the existing
runtime patch layer.

## Current Decision

The large client rewrite is still out of scope, but the behavior-preserving
module refactor has started. The first accepted direction is to keep the hosted
Jellyfin Web iframe and split the injected compatibility layer into ordered ES5
runtime modules.

Current migration constraints:

- preserve existing storage keys and feature defaults;
- keep `frontend/js/webOS.js` behavior available while pure logic and registries
  are extracted;
- avoid changing ASS/PGS renderer behavior during early infrastructure stages;
- add low-cost Node checks for injected asset manifests and pure decision
  logic before moving larger runtime hooks.

Continue to prefer narrow behavior-preserving changes. Only reconsider a full
client rewrite if the iframe-based patch model itself becomes the blocker.

Useful failure classification:

- `ContainerBitrateExceedsLimit` or similar bitrate-limit reasons mean the
  requested/profile bitrate is still too low or was overridden.
- `RemoteClientBitrateLimit` with `IsInLocalNetwork: False` means the server
  network configuration is misclassifying the TV as remote.
- codec/container/audio/subtitle transcode reasons are not fixed by adding more
  bitrate menu options.
- missing 95/100/120 Mbps text in the menu is not important if PlaybackInfo
  still results in DirectPlay.

## References Checked

- Jellyfin Web `qualityOptions.js`
- Jellyfin Web `playbackmanager.js`
- Jellyfin Web `appSettings.js`
- Jellyfin server `MediaInfoController.cs`
- Jellyfin server `MediaInfoHelper.cs`
- Jellyfin documentation: Transcoding, Bitrate and Resolution
- Jellyfin PRs: jellyfin-web#6071 and jellyfin#12644
