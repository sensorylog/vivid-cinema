import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("desktop packaging is opt-in and preserves existing scripts", () => {
  assert.equal(pkg.scripts["desktop:start"], "electron desktop/main.cjs");
  assert.match(pkg.scripts["desktop:dist"], /make-windows-icon\.cjs/);
  assert.match(pkg.scripts["desktop:dist"], /electron-builder --win nsis portable/);
  assert.match(pkg.scripts["desktop:dist"], /--publish never/);
  assert.match(pkg.scripts.test, /tests\/desktop-build\.test\.mjs/);
  assert.equal(pkg.scripts["check:syntax"], "node automation/check-syntax.mjs");
  assert.ok(pkg.scripts["test:rules"]);
});
test("Windows installer and portable executable targets use Vivid branding", () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package version must be valid semantic version");
  assert.ok(pkg.devDependencies.electron);
  assert.ok(pkg.devDependencies["electron-builder"]);
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.match(pkg.scripts["desktop:publish"], /electron-builder --win nsis --publish never/);
  assert.deepEqual(pkg.build.publish[0], { provider: "github", owner: "sensorylog", repo: "vivid-cinema", releaseType: "release" });
  assert.ok(pkg.build.files.includes("!node_modules/**"));
  assert.ok(pkg.build.files.includes("node_modules/electron-updater/**"));
  assert.ok(pkg.build.files.includes("node_modules/builder-util-runtime/**"));
  assert.ok(pkg.build.files.includes("node_modules/ms/**"));
  assert.deepEqual(pkg.build.win.target.map((target) => target.target), ["nsis", "portable"]);
  assert.equal(pkg.build.asar, true);
  assert.equal(pkg.build.win.icon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.installerIcon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.uninstallerIcon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.win.icon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.installerIcon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.uninstallerIcon, "icons/vivid-icon.ico");
  assert.ok(fs.existsSync(path.join(root, "icons", "vivid-icon.ico")));
  assert.ok(fs.existsSync(path.join(root, "icons", "vivid-icon.svg")));
  assert.ok(fs.existsSync(path.join(root, "icons", "vivid-icon-180.png")));
});
test("desktop runtime starts from the bundled local app and keeps hosted recovery available", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  assert.match(main, /app\.getAppPath\(\)/);
  assert.match(main, /"ETag": etag/);
  assert.match(main, /writeHead\(304, cacheHeaders\)/);
  assert.match(main, /if-none-match/);
  assert.match(main, /"Cache-Control": "no-cache"/);
  assert.match(main, /HOSTED_APP_URL = "https:\/\/vivid-cinema\.pages\.dev\/home\.html"/);
  assert.doesNotMatch(main, /vivid-cinema\.web\.app|FIREBASE_FALLBACK|fallbackToFirebase/);
  assert.match(main, /loadURL\(localOrigin \+ "\/home\.html"\)/);
  assert.match(main, /bundled application first/);
  assert.match(main, /trying the hosted app/);
  assert.match(main, /loadURL\(HOSTED_APP_URL\)/);
  assert.doesNotMatch(main, /HOSTED_LOAD_TIMEOUT_MS|Cloudflare Pages app load timed out/);
  assert.doesNotMatch(main, /clearHostedLoadTimeout/, "startup must not call an undefined hosted-load timeout helper");
  assert.match(main, /did-fail-load/);
  assert.match(main, /LOADING_HTML/);
  assert.match(main, /loadURL\(LOADING_URL\)/);
  assert.match(main, /hostedLoadStarted/);
  assert.match(main, /localOrigin \+ "\/home\.html"/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /isFirebaseAuthPopup/);
  assert.match(main, /startsWith\(absoluteRoot \+ path\.sep\)/);
  assert.match(main, /vivid-icon\.ico/);
  assert.match(main, /fullscreen:\s*true/);
  assert.match(main, /win\.setFullScreen\(!win\.isFullScreen\(\)\)/);
  assert.match(main, /input\.key === "F11"/);
  assert.match(main, /icon:\s*appIcon/);
  assert.match(main, /setAppUserModelId\("com\.axisvision\.vividcinema"\)/);
  assert.match(main, /win\.show\(\)/);
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /second-instance/);
  assert.match(main, /Menu\.setApplicationMenu/);
  assert.match(main, /About Vivid Cinema/);
  assert.match(main, /CmdOrCtrl\+R/);
  assert.match(main, /CmdOrCtrl\+Shift\+R/);
  assert.match(main, /CmdOrCtrl\+0/);
  assert.match(main, /input\.key === "F12"/);
  assert.match(main, /input\.key\.toLowerCase\(\) === "i"/);
});
test("file and native WebView entry points redirect before Firebase modules initialize", () => {
  const redirect = fs.readFileSync(path.join(root, "scripts", "platform-origin-redirect.js"), "utf8");
  assert.match(redirect, /window\.location\.protocol === "file:"/);
  assert.match(redirect, /appassets\.androidplatform\.net/);
  assert.match(redirect, /isUntrustedNativeOrigin/);
  assert.doesNotMatch(redirect, /\\bElectron\\b/);
  assert.match(redirect, /https:\/\/vivid-cinema\.pages\.dev\//);
  assert.match(redirect, /window\.location\.replace\(target\.href\)/);
  const syntaxChecker = fs.readFileSync(path.join(root, "automation", "check-syntax.mjs"), "utf8");
  assert.match(syntaxChecker, /scripts\/platform-origin-redirect\.js/);
  for (const page of ["index.html", "home.html", "for-you.html"]) {
    const source = fs.readFileSync(path.join(root, page), "utf8");
    const tag = '<script defer src="scripts/platform-origin-redirect.js"></script>';
    assert.ok(source.includes(tag), page + " includes the native-origin redirect");
    assert.ok(source.indexOf(tag) < source.indexOf('type="module"'), page + " redirects before Firebase modules run");
  }
});
test("native-origin redirect routes only unsupported wrappers to trusted hosting", () => {
  const redirectSource = fs.readFileSync(path.join(root, "scripts", "platform-origin-redirect.js"), "utf8");
  const runRedirect = (href, userAgent) => {
    const parsed = new URL(href);
    let destination = null;
    const location = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      replace(value) { destination = value; }
    };
    vm.runInNewContext(redirectSource, {
      window: { location },
      navigator: { userAgent },
      URL
    });
    return destination;
  };

  assert.equal(
    runRedirect("file:///android_asset/www/home.html?source=apk#recall", "Android WebView"),
    "https://vivid-cinema.pages.dev/home.html?source=apk#recall"
  );
  assert.equal(
    runRedirect(
      "https://08293d6d.vivid-cinema.pages.dev/for-you.html?source=apk",
      "Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) AppleWebKit/537.36"
    ),
    "https://vivid-cinema.pages.dev/for-you.html?source=apk"
  );
  assert.equal(
    runRedirect(
      "https://vivid-cinema.web.app/home.html",
      "Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) AppleWebKit/537.36"
    ),
    "https://vivid-cinema.pages.dev/home.html"
  );
  assert.equal(
    runRedirect("http://localhost:1234/home.html", "Mozilla/5.0 Windows Electron/36.4.0"),
    null
  );
  assert.equal(
    runRedirect("https://08293d6d.vivid-cinema.pages.dev/home.html", "Mozilla/5.0 Chrome/130.0"),
    null
  );
});
test("Windows icon preparation creates a valid ICO container from the checked-in Vivid PNG", () => {
  const script = fs.readFileSync(path.join(root, "desktop", "make-windows-icon.cjs"), "utf8");
  assert.match(script, /vivid-icon-180\.png/);
  assert.match(script, /vivid-icon\.ico/);
  assert.match(script, /writeFileSync/);
});
test("Windows app checks for updates and offers download plus restart-to-install", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  const preloadPath = path.join(root, "desktop", "preload.cjs");
  assert.ok(fs.existsSync(preloadPath));
  const preload = fs.readFileSync(preloadPath, "utf8");
  const redirect = fs.readFileSync(path.join(root, "scripts", "platform-origin-redirect.js"), "utf8");
  assert.match(main, /require\("electron-updater"\)/);
  assert.match(main, /^const \{ DesktopDownloadEngine \} = require\("\.\/download-engine\.cjs"\);/m);
  assert.doesNotMatch(main, /getDownloadEngine|downloadEnginePromise/, "download engine must not be deferred until the first renderer request");
  assert.match(main, /function configureDownloadEngine\(\) \{\s*\/\/ Match the known-working 1\.0\.28 lifecycle[\s\S]*?downloadEngine = new DesktopDownloadEngine\(\{ app, BrowserWindow, dialog, shell \}\);/);
  assert.match(main, /return downloadEngine\.start\(result, media\)/);
  assert.match(main, /return downloadEngine\.search\(query\)/);
  assert.match(main, /configureDownloadEngine\(\);\s*configureOfflineMediaProtocol\(\);\s*createWindow\(\);/, "engine must be ready before the renderer window opens");
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(main, /setInterval\(check, 6 \* 60 \* 60 \* 1000\)/);
  assert.match(main, /vivid-update-download/);
  assert.match(main, /vivid-update-install/);
  assert.match(main, /PORTABLE_EXECUTABLE_FILE/);
  assert.match(preload, /Vivid Cinema update/);
  assert.match(preload, /vivid-cinema\.pages\.dev/);
  assert.doesNotMatch(preload, /vivid-cinema\.web\.app/, "desktop update UI must not trust Firebase Hosting");
  assert.match(preload, /trustedHosts/);
  assert.match(preload, /hardwareConcurrency/);
  assert.match(preload, /vivid-performance-legacy/);
  assert.match(preload, /vivid-performance\.css/);
  assert.ok(fs.existsSync(path.join(root, "styles", "vivid-performance.css")));
  assert.doesNotMatch(preload, /netlify/i, "desktop update UI must not depend on the retired host");
  assert.doesNotMatch(main, /netlify/i, "desktop runtime must not depend on the retired host");
  assert.doesNotMatch(redirect, /netlify/i, "native redirect must use the current primary host");
  assert.match(preload, /Restart & install/);
  assert.match(preload, /vivid-update-status/);
  assert.ok(fs.existsSync(path.join(root, "styles", "vivid-desktop-update.css")));
});

test("Windows workflow builds on demand or on release tags", () => {
  const file = path.join(root, ".github", "workflows", "windows-desktop.yml");
  assert.ok(fs.existsSync(file));
  const workflow = fs.readFileSync(file, "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /desktop:dist/);
  assert.match(workflow, /GH_TOKEN:.*secrets\.GITHUB_TOKEN/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /Decide whether this push publishes a release/);
  assert.match(workflow, /Ensure matching release tag exists before publishing/);
  assert.match(workflow, /git tag -a \$tag/);
  assert.match(workflow, /git push origin "refs\/tags\/\$tag"/);
  assert.match(workflow, /Verify updater metadata was generated/);
  assert.match(workflow, /Build auto-updatable Windows release files/);
  assert.match(workflow, /Publish installer and updater metadata together/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /Verify published updater assets/);
  assert.match(workflow, /releases\/tags\/\$tag/);
  assert.match(workflow, /Vivid-Cinema-Setup-\$version\.exe\.blockmap/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /pull_request/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /desktop:dist/);
  assert.match(workflow, /icons\/\*\*/);
  assert.match(workflow, /Vivid-Cinema-Setup/);
  assert.match(workflow, /Vivid-Cinema-Portable/);
  assert.match(workflow, /Vivid-Cinema-Portable-\$version\.exe/);
});


test("native dropdown options keep readable contrast in Windows Chromium", () => {
  const css = fs.readFileSync(path.join(root, "styles", "vivid-audit-fixes.css"), "utf8");
  assert.ok(css.includes("select option,"));
  assert.ok(css.includes("background-color:#111318;color:#f4f2ed"));
  assert.ok(css.includes('html[data-vivid-theme="light"] select option,'));
  assert.ok(css.includes("background-color:#fff;color:#111216"));
  assert.ok(css.includes("select{color-scheme:dark}"));
  assert.ok(css.includes('html[data-vivid-theme="light"] select{color-scheme:light}'));
});


test("Windows desktop recovers from failed later-page navigation instead of leaving a black screen", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  assert.match(main, /RECOVERY_HTML/);
  assert.match(main, /RECOVERY_URL/);
  assert.match(main, /navigationRecoveryInProgress/);
  assert.match(main, /recoverAppNavigation/);
  assert.match(main, /showAppRecoveryPage/);
  assert.match(main, /renderer process exited/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /app page navigation failed; retrying its existing origin/);
  assert.match(main, /!hostedAppLoaded/);
  assert.match(main, /https:\/\/vivid-cinema\.pages\.dev\/home\.html/);
  assert.match(main, /Try offline copy/);
  assert.match(main, /localOrigin \+ "\/home\.html"/);
});

test("desktop download runtime dependencies are isolated and installed before launch or packaging", () => {
  const runtime = JSON.parse(fs.readFileSync(path.join(root, "desktop", "package.json"), "utf8"));
  const runtimeLock = JSON.parse(fs.readFileSync(path.join(root, "desktop", "package-lock.json"), "utf8"));
  assert.equal(runtime.dependencies.webtorrent, "1.9.7");
  assert.equal(runtime.dependencies["torrent-search-api"], "^2.1.4");
  assert.equal(runtimeLock.packages[""].dependencies.webtorrent, "1.9.7");
  assert.match(pkg.scripts["predesktop:start"], /npm --prefix desktop ci --omit=dev/);
  assert.match(pkg.scripts["predesktop:dist"], /npm --prefix desktop ci --omit=dev/);
  assert.ok(pkg.build.files.includes("desktop/node_modules/**"));
});

test("legacy desktop profile removes continuous decorative work", () => {
  const atmosphere = fs.readFileSync(path.join(root, "scripts", "atmosphere.js"), "utf8");
  const homeBreathe = fs.readFileSync(path.join(root, "scripts", "home-breathe.js"), "utf8");
  const hero = fs.readFileSync(path.join(root, "scripts", "tflix-hero.js"), "utf8");
  assert.match(atmosphere, /legacyPerformance/);
  assert.match(atmosphere, /requestAnimationFrame\(update\)/);
  assert.match(atmosphere, /if\(!legacyPerformance\)/);
  assert.match(atmosphere, /legacyPerformance \|\| reduceMotion/);
  assert.match(homeBreathe, /!legacyPerformance/);
  assert.match(hero, /if \(legacyPerformance\)/);
  assert.match(hero, /setTimeout\(advanceHero, NO_TRAILER_HOLD_MS\)/);
});


test("Vivid Ultra Player keeps Chromium playback and adds guarded native media controls", () => {
  const player = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles", "my-downloads.css"), "utf8");
  assert.match(page, /<video id="offline-player" controls playsinline preload="metadata"><\/video>/);
  assert.match(page, /offline-skip-back/);
  assert.match(page, /offline-skip-forward/);
  assert.match(page, /offline-subtitle-file/);
  assert.match(player, /parseSrtToVtt/);
  assert.match(player, /WEBVTT/);
  assert.match(player, /URL\.revokeObjectURL/);
  assert.match(player, /refreshAudioTracks/);
  assert.match(player, /if\(!select\|\|!tracks/);
  assert.match(player, /function describePlaybackError\(\)/);
  assert.match(player, /player\.addEventListener\("waiting"/);
  assert.match(player, /player\.addEventListener\("stalled"/);
  assert.doesNotMatch(player, /webkitAudioDecodedByteCount/);
  assert.match(styles, /offline-player-section\[data-subtitle-size="large"\]/);
});


test("Ultra Player adds explicit resume choices, safe series-next matching and cinema auto-hide", () => {
  const player = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles", "my-downloads.css"), "utf8");
  assert.match(page, /offline-resume-continue/);
  assert.match(page, /offline-resume-restart/);
  assert.match(page, /offline-next-episode/);
  assert.match(player, /getPlaybackPosition\(jobId,fileIndex\)/);
  const resumePromptPosition = player.indexOf('byId("offline-resume-prompt").hidden=false;', player.indexOf("player.addEventListener(\"loadedmetadata\""));
  const pauseForResumePrompt = player.indexOf("player.pause();", player.indexOf("player.addEventListener(\"loadedmetadata\""));
  assert.ok(resumePromptPosition >= 0 && pauseForResumePrompt > resumePromptPosition, "show resume prompt before pausing so the old saved position is not overwritten");
  assert.match(player, /Continue from /);
  assert.match(player, /clearPlaybackPosition/);
  assert.match(player, /function findNextEpisode\(job\)/);
  assert.match(player, /nextEpisode===episode\+1/);
  assert.match(player, /setTimeout\(\(\)=>\{/);
  assert.match(player, /controls-hidden/);
  assert.match(styles, /offline-player-section:fullscreen/);
  assert.match(styles, /controls-hidden \.offline-custom-controls/);
});


test("Ultra Player subtitle sync applies offsets from original cue timings", () => {
  const player = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  assert.match(page, /offline-subtitle-offset/);
  assert.match(player, /function applySubtitleOffset\(\)/);
  assert.match(player, /cue\.startTime=Math\.max\(0,base\.start\+offset\)/);
  assert.match(player, /cue\.endTime=Math\.max\(cue\.startTime\+0\.001,base\.end\+offset\)/);
  assert.match(player, /activeSubtitleTrack!==track\.track/);
});


test("Ultra Player exposes embedded and external subtitle track selection", () => {
  const player = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  assert.match(page, /offline-subtitle-track/);
  assert.match(player, /function refreshSubtitleTracks\(\)/);
  assert.match(player, /player\.textTracks/);
  assert.match(player, /tracks\[index\]\.mode=index===selected\?"showing":"disabled"/);
});


test("Ultra Player shows animated feedback for 10-second seeks and prevents page scrolling", () => {
  const player = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles", "my-downloads.css"), "utf8");
  assert.match(page, /offline-seek-feedback/);
  assert.match(player, /feedback\.textContent=seconds<0\?"−10 seconds":"\+10 seconds"/);
  assert.match(player, /event\.preventDefault\(\);seekBy\(10\)/);
  assert.match(player, /event\.preventDefault\(\);seekBy\(-10\)/);
  assert.match(styles, /@keyframes offline-seek-back/);
  assert.match(styles, /@keyframes offline-seek-forward/);
});


test("Windows Offline Library Stage 3 keeps download controls while grouping titles and simplifying statuses", () => {
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  const library = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles", "my-downloads.css"), "utf8");
  assert.match(page, /id="offline-library-tools"/);
  assert.match(page, /id="offline-library-tools"[^>]*hidden/);
  assert.match(page, /offline-library-count" hidden/);
  assert.match(library, /byId\("offline-library-tools"\)\.hidden=false/);
  assert.match(library, /byId\("offline-library-count"\)\.hidden=false/);
  assert.match(library, /vivid-desktop-offline-library/);
  assert.match(library, /offline-list-title"\)\.textContent="Your library"/);
  assert.match(styles, /body\.vivid-desktop-offline-library \.offline-progress/);
  assert.match(styles, /body\.vivid-desktop-offline-library \.offline-job-actions button/);
  assert.match(styles, /\.offline-progress\{height:4px/);
  assert.match(styles, /body\.vivid-desktop-offline-library \.offline-progress\{width:100%/);
  for (const filter of ["all", "downloading", "saved", "series", "attention"]) {
    assert.match(page, new RegExp('data-library-filter="' + filter + '"'));
  }
  assert.match(library, /function matchesLibrary\(job\)/);
  assert.match(library, /function episodeMarkup\(job\)/);
  assert.match(library, /function actionMarkup\(job\)/);
  assert.match(library, /data-action="pause"/);
  assert.match(library, /data-action="resume"/);
  assert.match(library, /data-action="cancel"/);
  assert.match(library, /data-action="play"/);
  assert.match(library, /data-action="play-file"/);
  assert.match(library, /image\.tmdb\.org\/t\/p\/w342/);
  assert.match(library, /async function hydratePosterArtwork\(\)/);
  assert.match(library, /tmdbApi\.tvDetailsBasic\(media\.id\)/);
  assert.match(library, /tmdbApi\.movieDetailsBasic\(media\.id\)/);
  assert.match(library, /candidateMedia\.poster_path=poster/);
  assert.match(library, /return "Downloading"/);
  assert.doesNotMatch(library, /job\.phase \|\| "Connecting to peers"/);
  assert.match(library, /poster\.split\("\/"\)\.includes\("\.\."\)/);
  assert.doesNotMatch(library, /discoveryDetail|lastNoPeerSource|trackerAnnounces/);
  assert.match(styles, /offline-library-tools\[hidden\].*display:none!important/);
  assert.match(styles, /offline-series-card/);
  assert.match(styles, /offline-media-card/);
  assert.match(styles, /prefers-reduced-motion/);
});


test("Windows desktop navigation keeps Home Search visible and restores previous-page Back", () => {
  const shell = fs.readFileSync(path.join(root, "scripts", "app-shell.js"), "utf8");
  const home = fs.readFileSync(path.join(root, "home.html"), "utf8");
  const searchPage = fs.readFileSync(path.join(root, "search.html"), "utf8");
  const liquidGlass = fs.readFileSync(path.join(root, "styles", "vivid-liquid-glass.css"), "utf8");

  // Home's shared header is rebuilt at startup. The Windows branch must use
  // the dedicated Search page route, not the website-only in-page dialog.
  assert.match(shell, /navLink\("search\.html", "bi-search", "Search", page === "search"\)/);
  assert.match(shell, /window\.vividDownloads\?\.available === true/);
  assert.match(shell, /vivid-windows-desktop/);
  assert.match(home, /data-search-trigger/);
  assert.match(searchPage, /id="search-page-input"/);
  assert.match(searchPage, /scripts\/search-page\.js/);
  assert.match(liquidGlass, /body\.vivid-windows-desktop \.vivid-topbar \.vivid-navlinks > a\[href="search\.html"\]/);

  // Every Windows content page gets a Back control; Home gets one only when
  // it was reached from another internal page. Direct entry remains sensible.
  assert.match(shell, /hasInternalPreviousPage = stack\.length > 1 && stack\.at\(-1\) === currentRoute\(\)/);
  assert.match(shell, /hasInternalPreviousPage \|\|= previous\?\.origin === location\.origin/);
  assert.match(shell, /if \(page === "home" && !hasInternalPreviousPage\) return/);
  assert.match(shell, /back\.href = "home\.html"/);
  assert.match(shell, /history\.back\(\)/);
});


test("Advanced Player uses a pinned mpv runtime, private IPC and guarded main-process launch", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "desktop", "preload.cjs"), "utf8");
  const advanced = fs.readFileSync(path.join(root, "desktop", "advanced-player.cjs"), "utf8");
  const prepare = fs.readFileSync(path.join(root, "desktop", "prepare-mpv.cjs"), "utf8");
  const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "windows-desktop.yml"), "utf8");
  const notice = fs.readFileSync(path.join(root, "licenses", "mpv", "NOTICE.md"), "utf8");

  assert.ok(fs.existsSync(path.join(root, "tests", "advanced-player.test.cjs")));
  assert.ok(pkg.scripts.test.includes("tests/advanced-player.test.cjs"));
  assert.ok(pkg.build.extraResources.some(item => item.from === "desktop/vendor/mpv" && item.to === "mpv"));
  const mpvNotices = pkg.build.extraResources.find(item => item.from === "licenses/mpv" && item.to === "licenses/mpv");
  assert.ok(mpvNotices);
  assert.ok(mpvNotices.filter.includes("Copyright"));
  assert.ok(mpvNotices.filter.includes("LICENSE.GPL"));
  assert.ok(mpvNotices.filter.includes("LICENSE.LGPL"));
  assert.ok(prepare.includes("ARCHIVE_SHA256"));
  assert.ok(prepare.includes("0.41.0"));
  assert.ok(prepare.includes("41f6a645068483470267271e1d09966ca3b9f413"));
  assert.ok(prepare.includes("a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de"));
  assert.ok(prepare.includes("checksum mismatch"));
  assert.ok(prepare.includes("Expand-Archive"));
  assert.ok(advanced.includes("--hwdec=auto-safe"));
  assert.ok(advanced.includes("shell: false"));
  assert.ok(advanced.includes("--no-config"));
  assert.ok(advanced.includes("observe_property"));
  assert.ok(advanced.includes("setPlaybackPosition"));
  assert.ok(main.includes("vivid-advanced-player-open"));
  assert.ok(main.includes("isTrustedDownloadSender(event)"));
  assert.ok(main.includes("advancedPlayer.open(id, fileIndex)"));
  assert.ok(preload.includes("openAdvancedPlayer: (id, fileIndex = 0)"));
  assert.ok(page.includes('id="offline-advanced-player"'));
  assert.ok(renderer.includes("engine.openAdvancedPlayer(id,fileIndex)"));
  assert.ok(workflow.includes("node desktop/prepare-mpv.cjs"));
  assert.ok(workflow.includes("approved checksum"));
  assert.ok(workflow.includes("mpv.exe\" --version"));
  assert.ok(workflow.includes("Remove mpv executable from non-release preview artifacts"));
  assert.ok(workflow.includes("CORRESPONDING-SOURCE.zip"));
  assert.ok(workflow.includes("SOURCE-MANIFEST.json"));
  assert.ok(workflow.includes("VIVID_SKIP_MPV_PREPARE: \"1\""));
  assert.ok(notice.includes("Release compliance gate"));
  assert.ok(notice.includes("complete corresponding-source bundle"));
  const syntaxChecker = fs.readFileSync(path.join(root, "automation", "check-syntax.mjs"), "utf8");
  assert.ok(syntaxChecker.includes("desktop/advanced-player.cjs"));
  assert.ok(syntaxChecker.includes("desktop/prepare-mpv.cjs"));
});
