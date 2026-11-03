# Windows desktop release

Vivid Cinema's Windows desktop application is an Electron app packaged as an NSIS installer and a portable executable.

## Supported runtime

- Electron **45.2.1** (Chromium 156, Node.js 24.22.x).
- Windows **10 or later**, x64.
- The current media runtime uses Windows x64 FFmpeg/FFprobe binaries. Do not add an ARM64 target until the FFmpeg and FFprobe runtime packages and their packaging tests provide matching Windows ARM64 executables.
- The NSIS installer supports in-app updates through `electron-updater`. The portable executable is a manual-update distribution and does not use the installer updater.

Electron 44 and later no longer publish 32-bit Windows builds, so this project intentionally ships x64 only.

## Packaging layout

- The root package owns the Electron runtime and electron-builder.
- `desktop/package.json` is the isolated runtime dependency manifest for the desktop process.
- Desktop runtime modules are installed under `desktop/node_modules` and included in `app.asar`.
- FFmpeg and FFprobe binaries are unpacked from ASAR so Windows can execute them.
- The app itself is loaded from `app.asar`; ASAR integrity validation and Electron fuses are enabled in the packaged binary.

Do not add a second Electron or electron-builder runtime to `desktop/package.json`. Keep the root and desktop manifests and lockfiles synchronized.

## Windows signing

Production releases require a trusted Authenticode certificate. Configure these repository Actions secrets:

- `WIN_CSC_LINK`: PFX/P12 path, HTTPS URL, or base64-encoded certificate accepted by electron-builder.
- `WIN_CSC_KEY_PASSWORD`: certificate password (only required when the certificate is password-protected).

The production workflow fails closed when the certificate is missing or either generated executable has an invalid signature. The installer and portable executable must have the same signer.

## Release process

1. Bump `package.json`, `package-lock.json`, `desktop/package.json`, and `desktop/package-lock.json` together.
2. If the offline app shell or player modules change, increment `CACHE_NAME` in `service-worker.js` and update the versioned player import/precache URLs.
3. Open a PR. Windows CI installs the root and isolated desktop dependencies, checks their lockfiles, runs the regression suite, syntax checks, FFmpeg/HLS/subtitle integration, seeded-torrent integration, and builds installer plus portable artifacts.
4. Merge only after the Windows build and regression checks pass.
5. A version-changing push to `main` triggers the production workflow. After checking the signing certificate, it creates or reuses the version tag and a **draft** GitHub release before packaging. The `desktop:dist` script uses `--publish onTagOrDraft`, so electron-builder writes `latest.yml`, the installer blockmap, and the signed binaries into that draft rather than publishing them immediately.
6. CI verifies the update manifest, both Authenticode signatures, matching publisher identity, and the complete draft asset set. Only then does it make the release public.
7. Never overwrite an already-public release. Use a new semantic version for changed binaries.

Required release assets:

- `Vivid-Cinema-Setup-<version>.exe`
- `Vivid-Cinema-Portable-<version>.exe`
- `Vivid-Cinema-Setup-<version>.exe.blockmap`
- `latest.yml`

## Manual Windows smoke test

CI is not a substitute for testing the actual installer on a Windows machine. Before calling a release fully verified:

- Install over the previous version and confirm user data and download history remain available.
- Launch online and offline; confirm the bundled local app loads without waiting on the network.
- Open a local video and a completed download; test play/pause, seek, resume, subtitle selection, audio selection, and source switching.
- Test an H.264/AAC file (passthrough) and a non-Chromium-compatible file (FFmpeg transcode). Confirm audio/video remain synchronized and the UI stays responsive.
- Close the window during playback and confirm FFmpeg processes and temporary transcode files are cleaned up.
- Install a newer signed release and verify the in-app update downloads, verifies, restarts, and reports the new version.
- Run the portable build separately and confirm its manual-update behavior.

## Security and runtime notes

The main window keeps Node integration disabled, context isolation enabled, renderer sandboxing enabled, and web security enabled. IPC handlers validate the calling frame and trusted origin. Do not expose raw `ipcRenderer` or general filesystem/process APIs to the renderer.

Electron 45 removes several Node shims/globals from sandboxed preload scripts. Keep the preload compatible with Web APIs and Electron's restricted preload `require()` surface; do not add `Buffer`, `setImmediate`, `clearImmediate`, or Node `events`/`timers`/`url` shims to the sandboxed preload.
