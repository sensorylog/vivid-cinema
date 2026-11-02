# Vivid Cinema Windows offline player: current-state audit

Audit baseline: `main` at `1c9d1e134796b99bffc418a787c3fe6dd77e6531` (Phase 4 merged, 2 November 2026).

This document describes the implementation present in the repository at the audit baseline. It distinguishes implemented behaviour from proposed work. Earlier planning notes are not evidence that a feature or runtime is present.

## Current implementation

The Windows desktop application uses Electron and Chromium's native `HTMLVideoElement` for local playback. The Electron main process owns the download engine and exposes completed downloads and user-selected local video files through the token-gated `vivid-media://` protocol. The renderer owns the Vivid player interface.

Implemented player and library capabilities include:

- Custom playback controls, high-resolution seeking, 10-second skip, keyboard shortcuts, playback speed, fullscreen and windowed cinema mode.
- Picture-in-picture when supported by the active Chromium/Windows media session.
- Frame-step controls. The current implementation uses `player.dataset.frameRate` when supplied and otherwise falls back to 30 fps; no general per-file frame-rate extraction is currently wired into that control.
- A live seek preview captured from the current video frame. This is not a separately generated thumbnail timeline; dragging the seek control changes the media current time.
- Audio boost and audio delay through the Web Audio API, subject to browser support and successful audio-graph creation.
- Chapter navigation and intro/credits skipping only when chapter metadata is exposed by the media.
- Saved playback positions and per-file playback preference profiles.
- External SRT, VTT, ASS and SSA parsing/rendering, subtitle appearance controls, timing offset and language preferences.
- Embedded audio/text track selection when Chromium exposes the relevant track APIs for the file and build.
- MP4/ISO-BMFF and Matroska/WebM metadata inspection, codec capability checks and local playback diagnostics.
- Movies-only library filtering, library sorting, saved-storage totals and per-file/multi-file size display.
- Native Windows file-picker support for opening ordinary local video files directly in the same player, without importing or copying them into the Vivid download library.

The automated tests cover media inspection, local protocol range handling, playback controls and state, subtitle parsing, preference persistence and library behaviour. Passing automated tests do not establish successful decoding of every real-world media file on physical Windows hardware.

## Permission handling

The desktop session grants only the existing fullscreen, media and notifications permission types, and only when the requesting origin is an exact trusted application origin (the configured Vivid hosted origin or the active local desktop origin) that also matches the active WebContents URL. Both Electron permission-request and permission-check handlers use the same fail-closed policy. Malformed, opaque, credential-bearing, lookalike and untrusted origins are denied. This origin restriction does not change the existing set of permission types.

## Local file opening

The Windows desktop renderer can request a native file picker through a narrow preload API. The main process accepts only supported video extensions, resolves the selected path, verifies that it is a regular file, and issues a random opaque media grant to the requesting renderer. The renderer receives a tokenized `vivid-media://local/` URL rather than a filesystem path. The media protocol serves only registered grants, supports byte-range seeking, and grants are released by the requesting renderer when the player closes or switches away; the registry is bounded and cleared at application shutdown. Selected files are played in place and are not copied into or added to the Vivid download library.

This remains Chromium playback, not an additional decoding engine: codec/profile support is still determined by the bundled Electron/Chromium build and Windows environment. The native picker currently filters to supported video-container extensions; subtitle files continue to be loaded separately through the existing subtitle picker.

## Confirmed architecture and limitations

1. **Native Chromium decoding is the only playback engine present.** The current player relies on the codecs and containers supported by the bundled Electron/Chromium build and the Windows environment. A file extension or container name does not establish that its contained video and audio codecs can be decoded.
2. **There is no general-purpose advanced playback engine in this baseline.** The repository's current `main` tree contains no mpv runtime, mpv launcher, mpv IPC integration, mpv preparation script, corresponding-source bundle or mpv source manifest. The root package scripts do not prepare or package mpv.
3. **Audio and embedded subtitle track access is conditional.** Track selection depends on APIs and tracks exposed by Chromium for the particular file and runtime. External subtitle parsing does not imply support for every embedded subtitle format, especially bitmap formats such as PGS and VobSub.
4. **Frame stepping is approximate unless a frame rate is supplied.** The current UI falls back to 30 fps when `player.dataset.frameRate` is absent. It is not yet a general frame-accurate stepping implementation.
5. **Seek preview is not a thumbnail system.** It captures a frame from the active video element while seeking rather than generating and displaying independent timeline thumbnails.
6. **Local streaming is a critical playback path.** Both completed downloads and explicitly selected local files are streamed through the custom Electron media protocol. Selected files receive scoped opaque grants rather than renderer-visible filesystem paths. Seeking depends on correct byte-range responses from this protocol.
7. **No universal compatibility or zero-dropped-frame guarantee is possible.** Results depend on codecs/profiles, resolution, frame rate, bitrate, storage, GPU/driver and system power/thermal limits. Unsupported, corrupted or unusually demanding media may still fail.

## mpv research status — proposal only

mpv remains a possible candidate for a future advanced playback engine because it offers broad format support, hardware-decoding options, track selection and a local IPC interface.

**It is not implemented or packaged by the current `main` branch.** References in earlier revisions of this document to a pinned mpv 0.41.0 runtime, verified upstream archive, Windows named-pipe integration, mpv licensing files, corresponding-source ZIP, source manifest, or release-time compliance gates described a proposed or historical implementation state that is not present in this audit baseline. Those statements must not be used as evidence that the current application contains mpv or that its distribution is blocked by an mpv-specific gate.

Any future decision to bundle mpv must be treated as a separate engineering and legal-compliance task. It must establish the exact binary provenance, build inputs, applicable license mode, required notices and corresponding source for the actual components being distributed, and must be validated in the Windows packaging/release workflow before being described as implemented.

## Remaining verification

- Run representative local media files on a physical Windows machine and record the exact Windows version, Electron build, GPU/driver, file container and audio/video codecs.
- Verify playback, seeking, audio output, track selection, external subtitles and error recovery using those files.
- Do not infer broad codec compatibility from extension checks, metadata inspection or CI packaging success alone.

## Scope of this audit-cleanup series

This cleanup series is limited to the six findings explicitly listed in the accompanying audit plan. It is not a general redesign and must not introduce unrelated features, deployment changes or torrent-feature work.
