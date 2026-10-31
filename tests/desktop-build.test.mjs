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
test("desktop runtime uses Cloudflare Pages first and bundled offline fallback without Firebase Hosting", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  assert.match(main, /app\.getAppPath\(\)/);
  assert.match(main, /HOSTED_APP_URL = "https:\/\/vivid-cinema\.pages\.dev\/home\.html"/);
  assert.doesNotMatch(main, /vivid-cinema\.web\.app|FIREBASE_FALLBACK|fallbackToFirebase/);
  assert.match(main, /fallbackToLocal\("Cloudflare Pages app load timed out after/);
  assert.match(main, /loadURL\(HOSTED_APP_URL\)/);
  assert.match(main, /did-fail-load/);
  assert.match(main, /HOSTED_LOAD_TIMEOUT_MS = 12000/);
  assert.match(main, /LOADING_HTML/);
  assert.match(main, /loadURL\(LOADING_URL\)/);
  assert.match(main, /hostedLoadStarted/);
  assert.match(main, /Cloudflare Pages app load timed out after/);
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
