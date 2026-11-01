# Third-party notice: mpv Advanced Player

Vivid Cinema redistributes mpv as a **separate executable process** for Windows offline playback. Vivid does not link mpv into the Electron application. The mpv window and its keyboard/OSD controls are provided by the upstream mpv program.

## Exact bundled build

- Project: mpv
- Build version: `0.41.0-dev-g9e2ed65eb`
- mpv source commit: `9e2ed65eb0c02f99a352dfa1ad3c85ecceefe005`
- Upstream source: https://github.com/mpv-player/mpv/tree/9e2ed65eb0c02f99a352dfa1ad3c85ecceefe005
- Upstream build workflow run: https://github.com/mpv-player/mpv/actions/runs/41103006513
- Build workflow source: https://github.com/mpv-player/mpv/blob/4013a3c9b6f6b3b4d2d8f971e91c2e1eab3f8184/.github/workflows/build.yml
- Downloaded asset: `mpv-v0.41.0-dev-g9e2ed65eb-41103006513-x86_64-w64-mingw32-full.zip`
- SHA-256: `24a5ac969219767c617f5d109761d4e24db8ba05dee30db485ea756415dc63b4`
- FFmpeg runtime reported by the upstream build: `git-2026-10-30-a3c5339`
- FFmpeg source commit: `a3c5339578cb1d54322e06b6bd1c8852fc6abc29`
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/commit/a3c5339578cb1d54322e06b6bd1c8852fc6abc29

## Licensing

mpv is licensed under GPL-2.0-or-later by default. The selected upstream Windows build is the full GPL-enabled build and includes FFmpeg and additional third-party libraries. The licences and redistribution obligations of the exact binaries are determined by the build configuration and all included components; this notice is not a substitute for those component notices.

The Vivid application remains separately distributed. Bundling this executable does not grant Vivid rights to relicense mpv or its dependencies. Review the upstream `Copyright` file and the relevant FFmpeg and dependency licences before redistributing a release.

## Corresponding source and release gate

The exact mpv and FFmpeg source revisions and the upstream build workflow are identified above. The upstream workflow also obtains and builds additional dependencies. Before publishing a Vivid installer containing this runtime, the release process must include or host the complete corresponding source for the exact binary build, including the build scripts and source for every GPL-covered component, together with all required licence notices and any written offer required by the applicable licence.

**Release compliance gate:** do not publish a public Vivid installer containing this runtime until both `CORRESPONDING-SOURCE.zip` and `SOURCE-MANIFEST.json` have been assembled, verified, and made available to recipients as release assets. The Windows release workflow intentionally fails closed if either file is missing. The archive must contain the complete corresponding source for the exact binary build, including the build scripts and source for every GPL-covered component. The source links above are provenance references; they are not, by themselves, a claim that the complete corresponding-source bundle is already included in this repository.

Upstream references:
- https://github.com/mpv-player/mpv#license
- https://github.com/mpv-player/mpv/blob/master/Copyright
- https://www.ffmpeg.org/legal.html
