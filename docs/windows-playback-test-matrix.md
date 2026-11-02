# Windows playback verification matrix

Status: **prepared; all physical-device tests pending**.

This matrix is for manual verification of the Electron/Chromium player on real Windows hardware. It is not a statement of codec support and contains no assumed pass results. Use media files that the tester owns or is authorized to use. Record the actual codec/profile and stream details from a trusted media-inspection tool; do not infer them from the filename or extension.

## Test environment record

Complete one environment record for each machine/build combination. Repeat the matrix after changing the Electron build, Windows version, GPU driver or relevant hardware-acceleration settings.

| Field | Record |
|---|---|
| Test date / tester | Pending |
| Windows edition, version and build | Pending |
| Architecture (x64 / arm64) | Pending |
| Vivid Cinema version / Git commit | Pending |
| Electron version and bundled Chromium version | Pending |
| GPU model and driver version | Pending |
| Hardware acceleration setting / GPU process status | Pending |
| CPU model | Pending |
| RAM | Pending |
| Storage type and free space | Pending |
| Display resolution / refresh rate | Pending |
| Power mode (AC / battery, power profile) | Pending |

## Result vocabulary

- **Pending** — not yet executed on physical Windows hardware.
- **Pass** — the stated test completed and the observed result met the expected behaviour.
- **Fail** — the test was run and the expected behaviour was not met.
- **Blocked** — the test could not be run; record the reason.
- **Not supported** — the runtime explicitly cannot decode or expose the tested stream/track. Record the exact error or unavailable API. This is a compatibility observation, not automatically an application defect.

For every non-pending result, record the media file identifier, file hash, container, video codec/profile/bit depth, resolution, nominal and measured frame rate, bitrate, audio codec/channels, subtitle type, result, error text, dropped-frame observations and notes. Do not record only the extension.

## Playback and container/codec matrix

Use separate known-good sample files for each row. Where a codec has multiple profiles or bit depths, record the exact profile and bit depth tested. All rows begin as **Pending**.

| ID | Sample to test | Required observations |
|---|---|---|
| WIN-M01 | MP4, H.264/AVC, 8-bit, AAC audio | Open from native picker; start/pause; audio output; duration and metadata; seek forward/back; end-of-file behaviour |
| WIN-M02 | MP4, HEVC/H.265, 10-bit, AAC audio | Whether the bundled Windows runtime decodes video and audio; record exact profile, hardware/software decode observation and errors |
| WIN-M03 | MKV, H.264/AVC, AC-3 audio | Video/audio decode; audio channel output; seek and resume |
| WIN-M04 | MKV, HEVC/H.265, TrueHD audio | Video decode and audio-track availability/output independently; record whether TrueHD is decoded, passed through, downmixed or unavailable |
| WIN-M05 | WebM, VP9, Opus audio | Video/audio decode; seek; playback stability |
| WIN-M06 | WebM, AV1, Opus audio | Video/audio decode; record AV1 profile, bit depth and hardware acceleration observation |
| WIN-M07 | AVI, MPEG-4 Part 2, MP3 audio | Container demuxing, video/audio playback, seek behaviour |
| WIN-M08 | MOV, ProRes video, PCM or AAC audio | Whether the runtime can decode the selected ProRes profile; playback, seek and error handling |
| WIN-M09 | MPEG-TS, H.264/AVC, AAC audio | Playback from local file; duration reporting; repeated seek and recovery |
| WIN-M10 | M2TS, H.264/AVC, DTS audio | Video playback and audio availability/output independently; record exact DTS variant |
| WIN-M11 | MP4 with variable-frame-rate H.264 video and AAC audio | Playback continuity; metadata-reported nominal rate; frame-step behaviour; seek preview and committed seek |
| WIN-M12 | MP4 with constant-frame-rate H.264 at 23.976/24/25/29.97/50/60 fps (separate files) | Record reported rate; test one-frame forward/back at several positions; note that Chromium seeking is not guaranteed frame-exact |
| WIN-M13 | MKV with a video track lacking usable nominal frame-rate metadata | Confirm frame-step controls remain disabled instead of assuming 30 fps; ordinary playback and seeking still work if decodable |
| WIN-M14 | Corrupt/truncated media sample and unsupported-codec sample | Clear error/status; app remains responsive; select a different valid file and resume normal playback |

## Subtitle and track matrix

Run each subtitle case against a media file known to contain the specified track. For embedded formats, record the exact stream codec and whether Chromium exposes a selectable text track. Bitmap subtitle support must not be inferred from external subtitle support.

| ID | Sample to test | Required observations |
|---|---|---|
| WIN-S01 | External SRT | Load, select, render, change subtitle size and offset; verify cues at multiple timestamps |
| WIN-S02 | External WebVTT | Load, select, render and verify timing |
| WIN-S03 | External ASS | Verify styled text, positioning and rendering; record unsupported styling |
| WIN-S04 | External SSA | Verify parsing and rendering; record unsupported styling |
| WIN-S05 | Embedded text subtitle track (e.g. WebVTT or supported text codec) | Whether Chromium exposes the track; select/deselect and verify displayed cues |
| WIN-S06 | Embedded bitmap subtitle track (PGS) | Record whether exposed/rendered; do not treat absence as a regression in external subtitle support |
| WIN-S07 | Embedded bitmap subtitle track (VobSub) | Record whether exposed/rendered; do not treat absence as a regression in external subtitle support |
| WIN-A01 | File with multiple audio tracks and distinct languages | Whether audioTracks API exposes tracks; select each available track; verify audible stream and language labels |
| WIN-A02 | File with multichannel audio (5.1 or 7.1) | Record output device, channel configuration and observed downmix/channel behaviour |

## Player interaction and local-file workflow

Run these against at least one known-good MP4/H.264/AAC file and one other container that successfully decodes on the test machine.

| ID | Scenario | Expected behaviour to verify |
|---|---|---|
| WIN-P01 | Open video file from the native picker | Picker opens; supported file opens in Vivid player; filesystem path is not exposed in renderer UI |
| WIN-P02 | Cancel the native picker | Current playback and player state remain usable; no error or stale grant |
| WIN-P03 | Open an unsupported extension or non-video file | File is rejected safely; no playback grant is created |
| WIN-P04 | Switch between two local files repeatedly | Previous local grant is released; new file opens; no stale preview or metadata |
| WIN-P05 | Close/navigate away from the player, then reopen a file | Local grant is released; subsequent file can be opened normally |
| WIN-P06 | Seek through beginning, middle and end of a large local file | Byte-range requests work; seeking does not require reading the entire file first |
| WIN-P07 | Scrub using mouse, touch-capable input (if present) and keyboard | Secondary preview follows the target; main playback time remains unchanged while scrubbing and changes on commit |
| WIN-P08 | Scrub rapidly in both directions | Preview eventually shows the latest requested target; stale frames do not replace newer preview frames |
| WIN-P09 | Frame-step forward/backward on known CFR samples | Controls are enabled only when a nominal rate was read; observe adjacent decoded frames and record any seek/decode approximation |
| WIN-P10 | Playback position and preference persistence | Downloaded-library playback retains its existing resume/preferences behaviour; local-file playback does not create a download-library resume record |
| WIN-P11 | Fullscreen, cinema mode and picture-in-picture (where supported) | Enter/exit each supported mode without losing playback or controls |
| WIN-P12 | Audio boost and audio delay (where supported) | Verify audible change, recovery after toggling and no persistent broken audio graph |
| WIN-P13 | Pause/resume after buffering, seek and window focus changes | Player recovers without renderer freeze or unintended position jump |
| WIN-P14 | Run for at least 30 minutes on a high-bitrate sample | Record dropped frames, CPU/GPU load, memory growth, thermal/power conditions and any stalls |

## Per-file result record

Copy this block for every sample actually tested. Do not replace Pending with Pass until the test has been run on the named physical Windows machine.

| Field | Value |
|---|---|
| Matrix ID / result | Pending |
| File identifier / SHA-256 | Pending |
| Container / file size | Pending |
| Video codec / profile / bit depth | Pending |
| Resolution / bitrate | Pending |
| Nominal FPS / measured FPS / CFR or VFR | Pending |
| Audio codec / channels / sample rate | Pending |
| Subtitle format / track type | Pending |
| Windows / Vivid / Electron / Chromium build | Pending |
| GPU / driver / acceleration observation | Pending |
| Playback / seek / track / subtitle observations | Pending |
| Frame-step / seek-preview observations | Pending |
| Dropped frames / stalls / CPU-GPU-memory notes | Pending |
| Error text / logs / screenshots reference | Pending |
| Tester / date / final result | Pending |

## Execution notes

1. Test the packaged Windows desktop build intended for release, not only a development server or browser tab.
2. Confirm the exact file streams with a media-inspection utility before testing. Keep the test asset and its SHA-256 identifier stable across runs.
3. Test local-picker playback and completed-download playback separately; both use the custom media protocol but exercise different grant and lookup paths.
4. For every failed or unsupported sample, preserve the exact error message and relevant application logs. Distinguish container/demux failures, unsupported codec/profile, audio output limitations, subtitle API limitations and protocol/range failures.
5. Repeat a failed case once after restarting the app. Do not repeatedly retry a clearly unsupported codec and report it as a pass.
6. Record results as observations for this specific machine/build. Do not generalize one Windows machine's result into universal codec support.
7. No physical Windows playback tests have been performed as part of preparing this matrix. All entries remain Pending until a tester records actual results.
