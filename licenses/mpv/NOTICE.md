# Third-party notice: mpv Advanced Player

Vivid Cinema redistributes mpv as a **separate executable process** for Windows offline playback. Vivid does not link mpv into the Electron application. The native mpv window, on-screen controller, track selection and keyboard controls are provided by the upstream mpv program.

## Exact bundled build

- Project: mpv
- Stable version: `0.41.0`
- mpv source commit: `41f6a645068483470267271e1d09966ca3b9f413`
- Source tag: `v0.41.0` (signed upstream release tag)
- Upstream source: https://github.com/mpv-player/mpv/tree/41f6a645068483470267271e1d09966ca3b9f413
- Upstream release: https://github.com/mpv-player/mpv/releases/tag/v0.41.0
- Downloaded asset: `mpv-v0.41.0-x86_64-w64-mingw32.zip`
- SHA-256: `a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de`

The selected archive is the upstream stable Windows x86_64 release asset, not an untested development build. Upstream notes that its release CI binaries omit some optional features (for example, encoding support). Encoding is not needed for Vivid's playback use case. This build must not be described as supporting every optional mpv feature or every possible media codec.

The exact FFmpeg revision and all other bundled component revisions must be recorded in `SOURCE-MANIFEST.json` after inspecting the exact release binary and corresponding upstream build inputs. Do not guess those revisions.

## Licensing

mpv is licensed under GPL-2.0-or-later by default. The binary also contains or depends on FFmpeg and other third-party components. The licence and redistribution obligations of the exact binaries depend on the build configuration and every included component; this notice is not a substitute for those component notices.

The upstream mpv `Copyright`, `LICENSE.GPL` and `LICENSE.LGPL` texts are included beside this notice in the installed application's `resources/licenses/mpv` directory. The Vivid application remains separately distributed. Bundling this executable does not grant Vivid rights to relicense mpv or its dependencies. The complete corresponding-source archive must also carry all required FFmpeg and other dependency notices.

## Corresponding source and release gate

Before redistribution, the exact source archive must contain the corresponding source for the bundled mpv, FFmpeg and every GPL-covered component, along with the relevant build scripts and required licence notices. `SOURCE-MANIFEST.json` must identify the exact mpv commit, the exact 40-character FFmpeg commit, every relevant component and licence, and the SHA-256 of the source archive.

**Release compliance gate:** do not publish a public Vivid installer containing this runtime until both `CORRESPONDING-SOURCE.zip` and `SOURCE-MANIFEST.json` have been assembled, independently checked against the binary, and made available to recipients as release assets. Both local redistributable desktop packaging commands and the Windows release workflow intentionally fail closed if either file is missing or the manifest does not match the pinned mpv revision and source archive hash. Running the desktop app locally for development is not a redistributable package build. The source links above are provenance references; they are not, by themselves, a claim that the complete corresponding-source bundle is already included in this repository.

Upstream references:
- https://mpv.io/installation/
- https://github.com/mpv-player/mpv#license
- https://github.com/mpv-player/mpv/blob/41f6a645068483470267271e1d09966ca3b9f413/Copyright
- https://www.ffmpeg.org/legal.html
