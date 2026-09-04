# jellyfin-webos local fork

This fork carries local webOS fixes on top of Jellyfin for webOS. It is aimed at
real LG webOS devices where the hosted Jellyfin Web UI exposes TV-specific
problems that are hard to solve from the server alone.

## Relationship to upstream

This is a fork of [jellyfin/jellyfin-webos](https://github.com/jellyfin/jellyfin-webos).
It keeps the full upstream history; the local work sits on top of it as ordinary
commits rather than on a tracked branch, so `git log` is the record of what
diverges. `CONTRIBUTORS.md` is inherited from upstream unchanged and lists
upstream's contributors, not this fork's.

**The build is deliberately indistinguishable from the official app, and that
has consequences.** `frontend/appinfo.json` keeps upstream's app id
(`org.jellyfin.webos`) and version, so:

- installing this ipk **replaces** an official Jellyfin install on the TV rather
  than sitting alongside it, and installing the official one replaces this;
- the TV's app info screen shows the same name and version either way, so there
  is no way to tell from the TV which build is running. The in-app playback
  diagnostics overlay is the reliable check — it only exists in this fork.

Keeping the id matters because the Homebrew Channel and the official store treat
it as the identity of the app; changing it would fork the install rather than
update it. If you need to tell builds apart at a glance, change the version in
`frontend/appinfo.json` via `npm version` (which keeps `package.json` in step,
and `check:version` fails the build if they drift).

## Platform baseline

This fork targets **webOS 5.0 and later**, which means:

| Surface | Baseline |
| --- | --- |
| Browser engine | **Chromium 68** — ES2018 |
| Service runtime | webOS 5.0's Node.js — `const`/`let` and `Buffer.from` are in use |
| Transpiling | **none** — `ares-package --no-minify` ships exactly what is authored |

webOS major versions are tied to model year and LG does not upgrade them, so
webOS 5.0 means 2020 hardware. The baseline is what runs on the oldest device
this app is expected to reach, not what the newest device supports.

Because nothing is transpiled, source language *is* target language. ES2018 and
older is fine — `Promise`, `Object.assign`, `Array.prototype.includes`,
`String.prototype.trimStart` all exist. Anything newer does not:

This table is the full banned set enforced by the tool; keep the two in step.

| Not available | Since |
| --- | --- |
| `?.`, `??` | Chromium 80 |
| `??=`, `\|\|=`, `&&=` | Chromium 85 |
| public class fields (`x = 1`) | Chromium 72 |
| private class fields (`#name`) | Chromium 74 |
| numeric separators (`1_000`) | Chromium 75 |
| `class` static initialization blocks | Chromium 94 |
| `Array.prototype.flat` / `flatMap` | Chromium 69 |
| `globalThis`, `queueMicrotask` | Chromium 71 |
| `Object.fromEntries`, `String.prototype.matchAll` | Chromium 73 |
| `Promise.allSettled` | Chromium 76 |
| `String.prototype.replaceAll`, `Promise.any` | Chromium 85 |
| `.at()`, `Object.hasOwn`, `structuredClone` | Chromium 92+ |
| `findLast` / `findLastIndex` | Chromium 97 |

`npm run check:baseline` enforces this. It exists because `check:syntax` cannot:
that step shells out to `node --check`, and Node accepts `?.` happily, so a
violation would pass CI green and then white-screen the TV with a parse error at
load. The check is a lexical scan, not a parser — it catches the common
accidents rather than proving compatibility.

To raise the baseline, change the table in `tools/check-baseline.js` and this
section together, and be explicit about which model years are being dropped.

`services/` ships untranspiled too, to the TV's Node service runtime (roughly
Node 8), and `check:baseline` scans it against its own table. The two trees have
nearly the same syntax ceiling, but a few things differ — optional catch binding
(`catch {`) and `for await` parse on Chromium 68 and not on Node 8. A service
that throws at load does not look like a crash; it looks like server discovery
quietly not working, which is why it is checked rather than left to discipline.

The main local patch surface is:

- `frontend/js/index.js` — the shell: server picker, discovery, handoff
- `frontend/js/ajax.js`, `frontend/js/storage.js` — shell XHR and storage
- `frontend/js/injected/` — the injected runtime (see below)
- `frontend/js/webOS.js` — the injected shell adapter
- `frontend/css/webOS.css`
- `services/service.js` — the Luna discovery service

`frontend/js/injected/` is the modular runtime injected into the iframe. The
split is uniform: each module owns pure decisions and text transforms, and
`webOS.js` keeps everything impure — DOM scanning, fetch/XHR and script
interception, playback state, runtime counters, diagnostics — and passes the
current settings in. That is also what makes the modules testable without a TV.

- `core/features.js` — boolean and numeric setting metadata: storage keys,
  defaults, ranges, settings text. Boolean overrides go through the existing
  postMessage whitelist; HDR brightness and subtitle opacity stay local.
- `playback/profilePatches.js` — device profile compatibility transforms:
  bitrate caps, known-bad video capability reporting, audio-transcode video-copy
  allowance, subtitle delivery profiles, optional LPCM/PCM DirectPlay expansion.
- `playback/playbackInfoPatches.js` — PlaybackInfo URL/body bitrate and nested
  device-profile body patching, plus burned-in subtitle de-duplication.
- `playback/hdrDecisions.js` — HDR/Dolby Vision and video-delivery decisions
  used by the dimming logic.
- `subtitles/scriptPatches.js` — ASS/PGS renderer script text replacement, and
  which patch families matched.
- `subtitles.assTimeSync` — registered from the same asset; the ASS worker
  clock-sample decision, split out so it is testable on its own.

## Why this fork exists

The upstream webOS app is mostly a wrapper around Jellyfin Web, so anything the
TV gets wrong about playback has to be corrected on the webOS side: bitrate
intent, device capability handoff, subtitle delivery and rendering, HDR UI
brightness, pointer and focus behavior. DevTools is not reliably available
during TV testing, which is why there is an on-screen diagnostics overlay.

## Local problem log

Each entry records the cause and the reasoning that settled it, including
approaches that were tried and rejected. Several of those looked correct.

### Playback bitrate and quality menu

Problem: new playback sessions can fall back to Jellyfin Web's upstream
`60 Mbps` cap, and the quality action sheet can miss the locally injected
high-bitrate entries.

Cause: Jellyfin Web derives the request bitrate from its own bandwidth
detection, which underestimates badly on these panels. Upstream UI changes also
made the old menu injection too dependent on one action-sheet DOM shape, and
real-device traces showed action sheets being created before the webOS adapter
reaches the normal `PLAYING` / media-session state. High-bitrate HDR files can
additionally hit the upstream device profile's static-playback bitrate limit
even when the PlaybackInfo request bitrate was raised.

Approach:

- add extra high bitrate menu entries: `120 Mbps`, `100 Mbps`, `95 Mbps`, and `80 Mbps`;
- force PlaybackInfo `MaxStreamingBitrate` / `maxStreamingBitrate` in both URL
  query strings and request bodies, but only inside the short playback-start
  window. Outside it, requests pass through untouched, so a bitrate the
  player's own bandwidth detection has lowered on a congested network holds
  instead of being re-raised into a buffering loop;
- keep two different "the user picked a quality" signals separate:
  - a pick made in the player this session (including `Auto`) ends the force
    for the session through the fork's player-menu hook. `Auto` then runs
    Jellyfin Web's bandwidth detection and switches using the detected rate;
  - a concrete bitrate saved through Jellyfin Web's quality setting is a
    durable preference. On each forced request, both
    `enableautobitratebitrate-Video-<isInNetwork>` values are read: `false`
    records a concrete bitrate and wins across app restarts, while `true`
    records `Auto` and does not disable the startup correction;
  - the requested bitrate itself carries no intent (bandwidth detection
    rewrites `maxbitrate-*` on its own) and is never consulted;
- raise device profile `MaxStreamingBitrate` and `MaxStaticBitrate` to the
  highest local bitrate option, unconditionally. The server's
  `MediaOptions.GetMaxBitrate` returns the request's `MaxBitrate` before it ever
  consults either profile field, so a raised ceiling cannot outgrow an explicit
  user selection, while leaving Jellyfin Web's hardcoded `MaxStaticBitrate` in
  place is what rejects a high bitrate remux for direct play;
- keep arming the playback-start window from playback-start signals and new
  PlaybackInfo item ids. The window gates the force, guards the per-item
  re-arm, and marks scripts worth fetching speculatively before a renderer
  bundle has been classified;
- patch only bitrate-shaped menu items inside the action-sheet scroller to avoid
  false positives;
- keep recognising a quality menu separate from deciding whether to extend it.
  Jellyfin Web derives the menu from the source resolution, so a 720p-or-lower
  source never shows a `60 Mbps` entry. Requiring one before installing the
  player-menu hook meant a downgrade picked on such a source never reached the
  "user picked a quality" signal and was re-raised for the rest of the window —
  the exact buffering case the pick was meant to fix. The hook is now installed
  on any bitrate menu; only the extra high-bitrate entries stay gated on the
  legacy cap;
- re-read the stored concrete-pick flag on each forced request instead of only
  snapshotting it when the window arms. Jellyfin Web writes that flag before it
  issues the PlaybackInfo for the pick, so this also catches a selection whose
  menu markup the hook did not recognise;
- keep the quality-menu observer active so late-created action sheets are still
  patched.

Status: active workaround. The force is bounded to the playback-start window
and must never become a permanent minimum: any player-menu choice takes
precedence for the session, and any concrete settings-page choice takes
precedence durably.

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
- do not rewrite PlaybackInfo subtitle delivery responses locally, with the one
  exception described in `Always burn in subtitle on transcoding` below. BDMV
  folder PGS delivery failures have been traced to upstream/server path
  selection, so the client should not synthesize subtitle URLs or override
  server delivery methods to work around a delivery failure;
- respect Jellyfin's native subtitle burn-in controls. `Burn subtitles` gates
  the client-rendered ASS/SSA/PGS profiles before the server chooses a delivery
  method; `Always burn in subtitle on transcoding` is passed through separately
  for cases where transcoding is already selected. Client-rendered PGS delivery
  is only preferred when burn-in is not required, and it may not override the
  user's burn-in mode;
- keep the last PlaybackInfo payload available for the playback-start fallback
  window for HDR detection without adding more subtitle delivery heuristics.

#### Always burn in subtitle on transcoding

Problem: with this setting enabled, an ASS/SSA subtitle is burned into a
transcoded video *and* rendered a second time by Jellyfin Web on top of it.

Cause: the setting reaches the server as `AlwaysBurnInSubtitleWhenTranscoding`,
and `StreamInfo.ToUrl()` then appends `SubtitleStreamIndex` to the transcoding
URL even when the device profile resolved that subtitle to `External`. The same
method only appends `SubtitleMethod` for non-`External` delivery. When the video
is actually encoded, `EncodingHelper` burns the selected subtitle because the
always-burn flag is set, while the PlaybackInfo response still reports the
stream as `External` with a `DeliveryUrl`, so Jellyfin Web renders it
client-side as well. Upstream compensates inside
`htmlVideoPlayer.setCurrentTrackElement()` by querying `/Sessions` and forcing
`Encode` when `TranscodingInfo.IsVideoDirect` is false, but that lookup races
playback start and frequently misses on webOS.

Approach: when the media source's own `TranscodingUrl` says the server is going
to burn the subtitle in, and the PlaybackInfo response shows a real video encode
(not DirectPlay, DirectStream, explicit `VideoCodec=copy`, or an inferred
video-copy path), rewrite the `External`/`Hls` subtitle streams of that media
source to `Encode`. This is the same decision upstream makes from
`IsVideoDirect`, taken from the payload instead of session state, so it cannot
race.

The gate is the server's own announcement, not the client setting: since 10.10
`MediaInfoHelper` appends `&alwaysBurnInSubtitleWhenTranscoding=true` to each
`TranscodingUrl` it builds under `if (streamInfo.AlwaysBurnInSubtitleWhenTranscoding)`.
Do not add a localStorage fallback for servers that do not send it. 10.9 and
older have no `AlwaysBurnInSubtitleWhenTranscoding` at all — the property is
absent from `MediaOptions` — so they never burn the subtitle in and there is
nothing to de-duplicate. On those servers forcing `Encode` from the client
setting would drop the client-side render with nothing burned in behind it, and
the subtitle would disappear entirely. Only a server that announces the flag can
produce the duplicate.

Audio-only transcode and direct play are untouched and keep client-side ASS/PGS
rendering, which needs care because the server does not always serialize an
eventual video copy as `VideoCodec=copy`: the HLS URL normally carries the
target codec list and `EncodingHelper` selects `copy` only when the request
begins. The fork therefore recognizes an implicit copy only when video stream
copy is allowed, the source video codec appears in that target list, and the
source satisfies the URL's request-time codec constraints. It mirrors Jellyfin's
profile/range, dimensions, frame-rate, bitrate, bit-depth, reference-frame and
level checks, plus required AVC framing, non-anamorphic output, deinterlacing,
subtitle encoding, and non-AVC H264 in an AVI container. `TranscodeReasons` is
deliberately not a gate because upstream `TryStreamCopy` never reads it. This
pre-playback prediction is used only by the subtitle race workaround; it is not
reported as the actual playback state because request-time server constraints
can still produce a different result. The device profile remains unchanged so
no path is forced into a transcode it did not need.

The correction has to land before Jellyfin Web reads the response, so it runs on
both transports. On `fetch` the patched payload is handed back as a new
`Response`. On `XMLHttpRequest` the listener is registered from `open()`, which
puts it ahead of the `onreadystatechange`/`onloadend` handler an api client
assigns between `open()` and `send()`, and it runs on `readystatechange(DONE)`
because `load`/`loadend` are already too late. A `responseType=json` body is the
parsed object itself and is edited in place; a text body cannot be replaced, so
the instance shadows `responseText`/`response` with the rewritten JSON and the
shadow is cleared on the next `open()`.

Status: active workaround. This is the only PlaybackInfo subtitle delivery
rewrite in the fork.

### Playback decision boundaries

The playback compatibility patches intentionally keep four decisions separate:

- Video transcoding is controlled by video/container capability reporting. The
  fork only removes known-bad direct-play claims such as DVD/MPEG; it should not
  use subtitle state to decide video codec support, and it never *adds* a video
  capability claim — see the H264 High 10 note below for why that direction was
  tried and rejected. Everything else about H264/HEVC capability, including the
  `IsInterlaced` condition, is left to Jellyfin Web's own reporting. If a
  transcode looks wrong, read `why=` in the diagnostics overlay first; the
  server records the condition it actually failed on, and guessing from which
  patch the fork happens to own has already produced one wrong diagnosis.
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
  `onlyimageformats` prevents PGS External delivery.
  `alwaysBurnInSubtitleWhenTranscoding` is handled entirely in the PlaybackInfo
  response, as described above; the device profile is left alone. The fork never
  forces that flag, synthesizes PlaybackInfo subtitle URLs, deletes burn-in query
  parameters, or cleans up unrelated upstream subtitle profiles.
- HDR/DV UI dimming is applied only when the detected playback range is HDR/DV
  and PlaybackInfo indicates that the video stream is DirectPlay, DirectStream,
  or transcode-with-video-copy (`VideoCodec=copy`). `Static=true` is classified
  as DirectStream. If video delivery is unknown or is a video transcode, the UI
  dim class is not enabled.

#### H264 High 10 (Hi10P) always transcodes — do not try to force it

10-bit H264 sources always transcode on webOS with
`VideoProfileNotSupported`, because Jellyfin Web only appends `high 10` to the
H264 `VideoProfile` condition when `!browser.web0s` — a hardcode, not a
capability probe, so the TV's own `canPlayType` answer is never consulted.

This was tried as a default-off switch that appended `high 10` to that
condition, and it has been removed again. The condition then passed and the
server did hand out DirectPlay, but the TV's decoder failed on the stream,
Jellyfin Web's `onPlaybackError` retried with `EnableDirectPlay: false`, and the
same item transcoded anyway — now reported as `DirectPlayError`, which
`StreamBuilder` emits precisely when every profile condition passes but direct
play was disabled by the client. LG H264 decoding is 8-bit High profile; 10-bit
on these panels only exists on the HEVC Main10 / VP9 Profile 2 / AV1 paths.
Upstream's hardcode matches the hardware.

Forcing the claim is therefore strictly worse than leaving it alone: instead of
going straight to a transcode, every 10-bit item pays a failed direct-play
attempt, a playback error, and a second PlaybackInfo round trip first. Check
`why=` in the diagnostics overlay before revisiting this.

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

- wait for `webOS.deviceInfo()` before assigning the Jellyfin Web iframe URL,
  but continue with conservative defaults after a bounded timeout;
- re-inject `window.DeviceInfo` if the real callback lands after that timeout,
  and read it back through `getLiveDeviceInfo()` in the injected runtime. The
  bundle always reads the window global at playback start, so a shell-side
  re-injection is picked up without needing an IIFE-bound copy. Capability data
  is consumed at playback start, which is normally late enough for the late
  answer to count;
- route that re-injection through an updater the handoff publishes only after a
  document passes the origin gate, instead of writing to whatever document the
  frame currently holds. The capability payload is a device fingerprint (model,
  firmware, panel size, HDR/DV/Atmos support), and the frame can legitimately be
  sitting on a refused origin while its `/System/Info/Public` validation is
  still outstanding or its 45s failure timeout has not fired;
- arm the injection failure timeout from navigation start rather than from
  handoff entry, so the device-info wait does not eat into its budget;
- accept shell-control messages only from the iframe origin and per-document
  bridge token established by the current handoff, and invalidate both on
  document unload or handoff cleanup;
- focus the content iframe after handoff so normal TV navigation starts inside
  Jellyfin Web.

Status: active workaround. The device-info wait is based on upstream PR #331,
and iframe focus follows upstream PR #332. A stalled device-info callback no
longer leaves the app on a permanent blank screen.

### Server picker and discovery

Problem: cancelling a connection attempt reported a server error instead of a
cancellation; a discovered server that changed address kept an unusable card
until the app was relaunched; and a saved server whose ID had changed rendered
as `undefined`.

Cause: three independent shell defects.

- `XMLHttpRequest.abort()` moves `readyState` to `DONE` with status `0` and
  fires `readystatechange` *before* the `abort` event, so `ajax.js` reported a
  generic transport failure first. The shell turned that into "are you
  connecting to a Jellyfin Server?", and the later abort callback only hid the
  spinner — it could not retract the message.
- `verifyThenAdd()` kept its per-Id guard set forever after one success and
  stored the record only when absent, while the discovery service rewrites
  `Address` on every broadcast. A DHCP lease change or `PublishedServerUrl` edit
  therefore left the first-seen address in the card and its connect button.
- The server-ID-change path replaced the saved entry with a stub holding only
  `baseurl`/`auto_connect`/`id`, discarding `Name`, `Address` and `hosturl`
  before the user had agreed to anything. If they declined, the next launch
  rendered `server.Name` — `undefined` — as the card title.

Approach:

- treat an aborted request as aborted: `ajax.js` marks the request cancelled in
  its own `abort()` wrapper and the terminal branch returns early, so only the
  abort callback runs;
- keep `servers_verifying` as a strict in-flight marker cleared by every
  terminal handler, re-verify a server whenever its broadcast address changed,
  and repaint that one card. An unchanged address still costs no request, so the
  steady state is unaffected;
- on an ID change, reset only what the change invalidates — the identity and the
  auto-connect consent — and carry the display fields over; also fall back to the
  address for the card title so a record saved without a name is still readable.

A later pass found three more defects on the same boundary, all about how a
server *leaves* the list.

- expiry was only ever checked when a UDP reply arrived: `sendScanResults()` runs
  from the discovery socket handler, and the 15 s interval merely re-broadcast
  the probe. With a single server on the network, the server going offline was
  also the only thing that could have announced its own removal, so its card —
  Connect button and all — outlived it for the life of the app. That is the
  symptom the delta/snapshot split above was meant to fix, and it only worked
  while some *other* server kept answering. The interval prunes and publishes
  now, and publishes nothing when nothing expired.
- the first reply to a new subscription is a complete, freshly pruned snapshot,
  but it was sent without `full: true`, so the shell classified it as a delta.
  Reconnecting after `stopDiscovery()`, or to a service that had restarted, was
  therefore the one moment the shell most needed to reconcile and the one moment
  it did not.
- `startDiscovery()` passed `resubscribe: true`, which the vendored webOSTV 1.2.11
  bridge does not implement — it reads service/method/parameters/subscribe and
  the three callbacks and nothing else. A lost subscription was gone for good
  while the non-null `discover` handle kept every later `startDiscovery()` at its
  guard, so the picker silently stopped finding servers. `onFailure` now drops the
  handle. The `uniqueToken` sent in `parameters` went the same way: the service
  keys subscriptions on the token LS2 attaches to the message, never on that one.

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
  subtitles, and diagnostics. The legacy PGS group is omitted when Jellyfin Web
  uses the newer `libbitsub` backend;
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
- test UI text with a stricter rule than a metadata field. The scanned OSD
  containers flatten the item title into the same string as the media info
  (`.osdTitle` sits inside `.videoOsdBottom`), and `dovi` and `hlg` are short
  enough to hide inside ordinary names — "Ludovico Einaudi", "Wahlgren" and
  "Kohlgruber" all used to read as HDR and dim an SDR playback for its whole
  duration. In text a marker only counts when it starts a word, which still
  accepts composites such as `DOVIWithHDR10`; metadata fields keep the
  permissive substring test, because a structured value is not free text;
- after entering playback, run a short delayed fallback window that reapplies
  cached PlaybackInfo hints, refreshes item metadata detection, and scans visible
  playback UI text again;
- keep HDR fields and video delivery as separate evidence. Jellyfin's HDR fields
  describe the selected source, while a real video transcode produces SDR; UI
  dimming therefore still requires DirectPlay, DirectStream, or video copy;
- do not promote a same-codec HLS `TranscodingUrl` to an observed video copy.
  PlaybackInfo is created before request-time `TryStreamCopy`, so the same URL
  shape can finish as either DirectStream or a real video transcode;
- for ambiguous HLS playback, briefly query the current device's `/Sessions`
  entry after playback starts and let `TranscodingInfo.IsVideoDirect` override
  the provisional PlaybackInfo value: `true` becomes `directstream`, while
  `false` remains `transcode`. Existing player-stats session requests are also
  observed, and item/media-source/device matching prevents stale sessions from
  changing the current playback;
- track how the HDR holding the correction window was derived as a flag passed
  to `setPlaybackDynamicRange()`, not by comparing its `reason` string to
  `'playback-ui'`. `reason` is descriptive text that callers prefix, so the
  delayed fallback recorded its OSD-text guess as
  `playback-start-fallback-playback-ui` and the escape hatch — accept an
  authoritative SDR that contradicts a UI-text HDR — never matched. It also
  overwrote a correctly labelled guess the scheduled scanner had already stored,
  turning a recoverable state into a stuck one. A title containing an HDR token
  on SDR content could therefore dim the whole session;
- keep the escape hatch from being one-shot. Accepting an authoritative SDR over
  a UI-text HDR clears the correction window, and that window was the only thing
  holding the OSD-text guess accountable, so the 3 s fallback re-read the same
  unchanged title and re-applied HDR with nothing left to contradict it. A held
  HDR verdict then switches the OSD observer off, so the session stayed dimmed.
  Once an authoritative source has overruled the UI text, that is latched for the
  rest of the playback and no UI-text HDR is accepted again;
- treat item metadata as an authoritative corrector, not a filler. The delayed
  fallback only applied its `/Items` answer when the current verdict was unknown
  or the answer was HDR, so an authoritative SDR could never correct a UI-text
  HDR there. It now goes through `setPlaybackDynamicRange()` unconditionally and
  lets that function arbitrate, matching the media-session path. This matters
  more than it looks: on Jellyfin Web 10.11 `NativeShell.updateMediaSession` is
  never called for local video playback — `mediaSessionSubscriber` returns early
  for `isLocalPlayer && isVideo`, and it is the only caller in the client — so
  the `/Items` fetch is the only authoritative corrector left. The state machine
  still enters and leaves playback through `enableFullscreen`/`disableFullscreen`,
  and the per-item bitrate re-arm still fires from the PlaybackInfo path;
- resolve a pending PlaybackInfo hint through the cache key that this playback's
  own response wrote. The cache is keyed `<itemId>|<mediaSourceId>` and outlives
  a playback, so an item with several versions accumulates one entry per source;
  scanning by item id and preferring `hdr` let another version's hint dim an SDR
  playback, and the resulting HDR then latched the correction window against the
  correct SDR. Without such a key, sibling entries are used only when they agree.

Status: active feature. ASS and PGS intentionally share
`--webos-hdr-subtitle-opacity`; keeping a separate PGS opacity variable made the
implementation look more configurable than the UI actually is. Provenance of an
HDR verdict must stay a flag: encoding it in the `reason` string is what broke
the SDR escape hatch, and `reason` remains free-form diagnostic text.

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

### Subtitle renderer script interception

Problem: a renderer bundle whose inspection fetch outran its timeout was
downloaded twice.

Cause: on timeout the queue inserted the original `<script>` node — which
downloads the URL again — without aborting the inspection `XMLHttpRequest`. The
speculative path makes this easy to hit: early scripts get a 750 ms budget, so a
large chunk on a slow TV link routinely exceeds it.

Approach: abort the inspection request before inserting the original node. The
existing `fetchCompleted` guard already neutralises the callbacks that abort
dispatches.

Status: fixed. Bandwidth only — the original script still loads and executes
unpatched, which is the intended fallback.

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
`obj=on`; the isolation matrix behind that is under `Real-device notes`. Both
PGS switches remain available on `libpgs` for future isolation or for
evaluating a safe non-Blob worker patch. Jellyfin Web 12 replaces `libpgs` with
`libbitsub`; the injected runtime detects that backend from loaded player and
renderer scripts before applying PGS rewrites, removes these now-inapplicable
switches, and does not attempt to patch `libbitsub` pending real-device testing
of the final Jellyfin 12 build. ASS rewriting remains independent and can still
apply when both subtitle implementations share a bundle.

Backend classification prefers bundle content over the script URL, because a
hashed or mislabeled filename must not outrank the code actually loaded, and it
latches: once `libbitsub` is confirmed from content, an incidental `libpgs`
marker in some other bundle cannot flip it back. A URL-hint-only classification
is provisional and the same script's fetched content may still correct it — so
content that merely *confirms* the current backend has to promote the hint to
confirmed, otherwise the latch never closes and stays overridable forever.

### Playback diagnostics overlay

Problem: TV-side playback debugging often has to happen without reliable
DevTools access, and full console/script URLs are too noisy for real-device A/B
tests.

Cause: the relevant failures are timing and path-selection issues. The useful
signal is whether the expected patch path is active and whether counters move
during playback, not static environment strings.

Approach:

- provide an optional on-screen diagnostics overlay from the injected settings;
- show playback state, dynamic range, video-delivery classification, and
  `dim=<class>/<decision>@<brightness>` so HDR gating and CSS-class state can be
  distinguished, plus rAF FPS, `requestVideoFrameCallback` FPS when available,
  long-task stats, video dimensions/time, and dropped frames;
- show compact ASS patch/message/clamp counters;
- show the detected PGS backend and, for `libpgs`, compact
  patch/media-time/render/main-thread counters and active diagnostic switches;
- hide the legacy PGS counters when `libbitsub` is detected because they only
  instrument the old renderer and would otherwise be misleading;
- show `why=` with the server's own `TranscodeReasons` from the selected media
  source's transcoding URL (`direct` when there is none), so a transcode
  complaint can be checked against the reason the server actually recorded
  instead of a guess, plus `vid=<codec>/<profile>/<bits>/<level>` for the video
  stream those conditions were evaluated against;
- show `burn=` with the burn-in de-duplication state: `off` when the returned
  media-source URL does not enable `alwaysBurnInSubtitleWhenTranscoding`, otherwise
  `on/fixed:<transport>` or `on/skip:<transport>` depending on whether the
  PlaybackInfo response needed correcting;
- omit static values such as browser user agent and patched script URL.

Status: active diagnostic tool. On `libpgs`, PGS patch counters such as `mode1`
and `o1` mean the conditional hook was installed into that renderer. They do not
mean the switch is currently active; use `target=main/auto` and `obj=on/off` for
the active test case. On `libbitsub`, only `PGS backend=libbitsub` is shown.

### Injected runtime startup

Problem: the overlay stayed invisible after an app restart even with its setting
enabled and the checkbox showing checked, and only appeared after toggling the
setting off and on.

Cause: the injected runtime ended in a bare list of init statements, and one of
them called `initHdrUiInfoObserver()` — a function that stopped existing when
`hdrUiInfoObserver` was converted to the `createManagedObserver` factory. The
resulting `ReferenceError` aborted the rest of the list, so the initial
`updatePlaybackDiagnosticsOverlay()` and `refreshHdrUiDimming('init')` calls
never ran. Everything registered before that line kept working, which is why the
setting still persisted and its checkbox still rendered checked. Toggling the
setting recovered the overlay only because the change handler calls
`updatePlaybackDiagnosticsOverlay()` directly.

Approach: run each startup step through a named `runInitStep()` wrapper that
catches and warns. A broken step now costs one feature and leaves a log line
naming it, instead of silently disabling every feature after it.

Status: fixed. Do not collapse the init table back into bare statements — the
failure mode it prevents produces no symptom at the failure site, and it cost
two wrong diagnoses (a stale overlay DOM node, then a missing retry loop) before
the actual cause was found by elimination.

## Build and test

Use Node.js 22 or 24, then install dependencies:

```sh
npm install
```

Run the unit tests, injected-asset checks, and JavaScript syntax checks (pure
Node, no TV required):

```sh
npm test
```

This runs `npm run check:assets` (injected-runtime asset manifest + load-order
check), `npm run check:syntax` (all project JavaScript parses),
`npm run check:baseline` (frontend stays within Chromium 68 / ES2018 — see
"Platform baseline"), and `npm run test:unit` (the unit tests under
`tests/unit/`). Run it before pushing — CI runs the same command on Node.js 22
and 24.

### Testing the injected runtime

`frontend/js/webOS.js` is a single IIFE that exports nothing but
`window.NativeShell`, so its internals cannot be imported the way the modules
under `frontend/js/injected/` can. `tests/helpers/injectedRuntime.js` loads the
whole bundle — the injected modules in their shipping order, then `webOS.js` —
into a `vm` context with a deterministic clock and a small DOM, and tests drive
it exactly as Jellyfin Web does:

- `NativeShell` calls (`enableFullscreen`, `updateMediaSession`, …);
- the patched `window.fetch` / `XMLHttpRequest`, through
  `respondToFetch()` and the recorded `state.xhrRequests`;
- the patched `Node.prototype` insertion methods, by appending a `<script>`;
- DOM events with real capture-then-bubble propagation.

Assertions are made on what the TV would actually show or send: the
`webos-hdr-ui-dim` body class, the injected DOM, and the request URLs that leave
the device. `clock.tick(ms)` advances `Date.now()` and the timer queue together,
so the playback-start windows can be crossed without waiting.

Two constraints matter when adding cases:

- the harness never invents mutations. A test that relies on the bundle's
  MutationObservers must deliver the mutation record itself;
- `tests/run.js` awaits a suite that exports a function or a promise. The
  bundle's fetch path resolves through real promises, so any suite touching it
  must export its runner rather than executing on `require`, or failures land
  after the run has already reported success.

New cases should be confirmed to fail against the unfixed code before being
committed; every case in `tests/unit/injectedRuntime.test.js` was.

Validate the IPK package structure (the webOS CLI comes from the
`@webos-tools/cli` devDependency, so `npm install` is enough):

```sh
npm run check
```

Build an IPK:

```sh
npm run package
```

If you prefer the containerized webOS SDK toolchain over a local install, `dev.sh` wraps
the same `ares-*` commands inside a Docker image, e.g. `./dev.sh ares-package --no-minify
services frontend`.

Install to a configured TV:

```sh
npm run deploy
```

`deploy` resolves the ipk name from `frontend/appinfo.json`, which is what
`ares-package` names the file after, so it does not go stale when the version
changes. It is a node script rather than a shell one-liner because npm runs
scripts through `cmd.exe` on Windows, where `${npm_package_version}` does not
expand.

When the default `build` output is locked by a previous install/test session,
write to a new output directory and point `deploy` at it:

```sh
ares-package --no-minify --outdir build-local services frontend
npm run deploy -- build-local
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
- PGS isolation matrix, as measured on the tested device:
  - `target=main`, `obj=on`: verified good.
  - `target=main`, `obj=off`: still flashes stale text, so the object-id reuse
    fix is required.
  - `target=auto`, `obj=on`: still flashes, because the active worker/offscreen
    path does not receive the main-script object-id patch.
  - `target=auto`, `obj=off`: upstream-like baseline, expected to flash.

## Upstream README

[Upstream project documentation](https://github.com/jellyfin/jellyfin-webos/blob/master/README.md)
