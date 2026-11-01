# Vivid Cinema Windows offline player: audit and upgrade plan

Audit baseline: PR #423 head `48d15d884337e8fde3cfe1d72d7e80978d46dc40` (1 November 2026).

## Existing implementation

The Windows desktop application uses Electron 36.4.x and the browser's native `HTMLVideoElement` for offline playback. The download engine stores completed torrent files under the Vivid Cinema download directory and exposes them to the renderer through a token-gated `vivid-media://` protocol. The renderer owns the Vivid player UI.

Existing user-facing features worth preserving:
- custom Vivid playback controls, fullscreen, 10-second seek, volume and speed controls;
- saved playback positions, resume/restart prompt and next-episode action;
- native text-track selection, external SRT/VTT loading, subtitle size and subtitle offset;
- per-download multi-file selection and local playback.

## Findings and limitations

1. **Container extension is not codec support.** The main-process protocol maps extensions to MIME types. A Matroska/AVI/MP4 extension says nothing definitive about the audio/video codecs, profiles, bit depth or level inside the file. Chromium's decoder support depends on the actual build and platform.
2. **Chromium's built-in decoder is not a universal media engine.** Chromium documents a limited set of containers and codecs; proprietary codecs vary by build. Unsupported audio can produce video-without-sound, and unsupported video can fail entirely.
3. **Audio-track UI is conditional.** The renderer depends on `HTMLMediaElement.audioTracks`; if Chromium does not expose it for a given source/build, the track picker is hidden.
4. **Subtitle support is narrow.** External SRT is converted to WebVTT and external WebVTT is supported. Advanced embedded subtitle formats such as ASS/SSA, PGS and VobSub are not implemented by this HTML player.
5. **Error diagnostics are generic.** The current error handler reports a broad unsupported-codec message. The MKV silent-audio heuristic uses `webkitAudioDecodedByteCount`, which is not a portable codec-inspection interface.
6. **Local streaming is a critical playback path.** Seeking depends on correct HTTP-style byte-range responses from the custom Electron protocol. The original range parser was inline and did not reject malformed/multiple ranges consistently.
7. **No universal zero-lag guarantee is possible.** Performance depends on codec/profile, resolution, frame rate, bitrate, storage speed, GPU/driver and thermal/power limits. The player should select hardware decoding when proven safe and fall back to software decoding or a clear compatibility message when necessary.

## Research conclusions

- Chromium's published media support lists MP4, Ogg, WebM, WAV, Matroska and HLS containers, with AV1/VP8/VP9 and platform/build-dependent proprietary codecs. See https://www.chromium.org/audio-video/.
- MediaCapabilities `decodingInfo()` can report whether a specified codec/profile/resolution/bitrate configuration is supported, smooth and power-efficient. It is a preflight hint, not a decoder and not a substitute for actual file inspection. See https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo.
- Windows Media Foundation has its own platform codec/container matrix and optional codec dependencies; relying on Windows alone will not guarantee all media formats. See https://learn.microsoft.com/windows/win32/medfound/supported-media-formats-in-media-foundation and https://learn.microsoft.com/windows/apps/develop/media-authoring-processing/supported-codecs.
- mpv is a strong candidate for a second, advanced playback engine: it supports a broad set of formats, hardware-decoding APIs, buffering controls, track selection and a JSON IPC interface (including named pipes on Windows). See https://mpv.io/manual/stable/ and https://github.com/mpv-player/mpv.
- mpv is GPLv2-or-later by default; an LGPL mode exists with feature restrictions. FFmpeg's build flags and included libraries affect redistribution obligations. Any bundled engine must be pinned, reproducibly built or provenance-verified, accompanied by required notices/source, and reviewed for codec patent obligations. See https://github.com/mpv-player/mpv#license, https://github.com/mpv-player/mpv/blob/master/Copyright and https://www.ffmpeg.org/legal.html.

## Recommended architecture

1. Preserve the current native Chromium/Vivid player for formats that it demonstrably decodes well.
2. Add a dedicated advanced-engine fallback for files the browser cannot decode, including unsupported audio-only cases. mpv is the leading candidate; do not claim universal support until a pinned Windows build is verified and end-to-end tested.
3. Keep the engine process in Electron's main process. Never expose a generic shell/command execution bridge to the renderer. Use a narrowly scoped IPC API, unique per-session IPC endpoint, argument arrays (never shell interpolation), process lifecycle handling and explicit allowlisted commands. mpv's IPC is intentionally unauthenticated and must remain local/private.
4. Inspect actual file streams before playback where possible: container, video/audio codec, profile, bit depth, resolution, frame rate, bitrate, languages, chapters and subtitle formats. Use this to choose the engine and explain compatibility.
5. Add playback observability: startup time, buffering/waiting, decode errors, dropped frames where available, selected tracks and recovery outcome. Keep diagnostics local and privacy-preserving.
6. Test with a codec/container matrix on real Windows hardware, including 1080p/4K H.264, HEVC, AV1, VP9, MPEG-2, VC-1, VP8; AAC, AC-3/E-AC-3, DTS, TrueHD, FLAC, Opus; MKV, MP4, MOV, AVI, WebM, TS/M2TS, MPEG, WMV, FLV, 3GP; SRT, WebVTT, ASS/SSA, PGS and VobSub. The test suite must record the exact tested engine/build/GPU/driver.
7. Do not promise every file or zero dropped frames: encrypted/DRM content, corrupted files, unsupported hardware codecs and extreme bitrates can still fail. Give users a clear reason and recovery option.

## First reliability tranche

This PR hardens local byte-range delivery and verifies GET/HEAD, suffix/open-ended ranges, invalid/multiple ranges and common MIME mappings. It also keeps the player architecture unchanged while the advanced-engine packaging and licensing decision is made.


## Advanced Player implementation tranche

The Windows desktop branch now has an opt-in mpv fallback path:

- The signed upstream mpv 0.41.0 stable Windows x64 release archive is downloaded during desktop preparation and verified against its SHA-256 digest before extraction. This avoids shipping an untested development build. The official release binary omits some optional features that are not required for file playback. The binary is not checked into the Git repository.
- Electron main process owns process creation and shutdown. The renderer receives only `openAdvancedPlayer(jobId, fileIndex)` and `stopAdvancedPlayer()`; it cannot pass arbitrary paths, commands, or shell arguments.
- The executable is launched with an argument array and `shell: false`, with mpv user configuration disabled, the upstream on-screen controller enabled, and `--hwdec=auto-safe` so mpv can use a safe hardware decoder when available.
- A per-launch random Windows named pipe is used only by the main process. The renderer cannot access it. mpv's time-position property is observed to preserve the existing Vivid resume position while the advanced engine is playing.
- The existing HTML player remains the default. Users explicitly open the separate native mpv window from the offline player when they need the advanced engine.

### Boundaries and release blockers

- The current pinned runtime is Windows x64. Windows ARM64, macOS, Android and browser playback are not enabled by this tranche.
- The advanced window uses mpv's own OSD/keyboard controls; Vivid's HTML player controls do not overlay the native mpv window.
- The pinned binary's provenance and mpv/FFmpeg source revisions are recorded in `licenses/mpv/NOTICE.md`. The complete corresponding-source bundle for every GPL-covered component and required notices still needs to be assembled and verified before a public release containing this runtime. The notice explicitly records this as a release compliance gate.
- CI can prove that the pinned archive downloads, checksum validation runs, the launcher contract is tested, and Windows packaging succeeds. It cannot prove that every codec works or that playback is smooth on all hardware. Real-device playback testing against the documented codec matrix remains required.


### Cache and distribution safety

The offline-player stylesheet and script now have new versioned URLs, and the service-worker shell cache is bumped to v265 so older cached renderer code cannot hide the new control. Windows CI downloads and checksum-verifies the stable mpv archive, then removes the executable before producing pull-request and non-release preview artifacts. Local Windows packaging and a public release retain the pinned runtime. A public release is fail-closed until both `licenses/mpv/CORRESPONDING-SOURCE.zip` and `licenses/mpv/SOURCE-MANIFEST.json` are present and verified, and the workflow publishes both beside the installer.
