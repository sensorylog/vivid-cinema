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
  assert.equal(pkg.version, "1.0.2");
  assert.ok(pkg.devDependencies.electron);
  assert.ok(pkg.devDependencies["electron-builder"]);
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.equal(pkg.scripts["desktop:publish"].includes("--publish always"), true);
  assert.deepEqual(pkg.build.publish[0], { provider: "github", owner: "sensorylog", repo: "vivid-cinema", releaseType: "release" });
  assert.ok(pkg.build.files.includes("!node_modules/**"));
  assert.ok(pkg.build.files.includes("node_modules/electron-updater/**"));
  assert.ok(pkg.build.files.includes("node_modules/builder-util-runtime/**"));
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
test("desktop runtime uses Netlify first, Firebase Hosting second, and a bundled offline fallback last", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  assert.match(main, /app\.getAppPath\(\)/);
  assert.match(main, /HOSTED_APP_URL = "https:\/\/vivid-cinema\.netlify\.app\/home\.html"/);
  assert.match(main, /FIREBASE_FALLBACK_URL = "https:\/\/vivid-cinema\.web\.app\/home\.html"/);
  assert.match(main, /fallbackToFirebase/);
  assert.match(main, /FIREBASE_FALLBACK_ORIGIN/);
  assert.match(main, /loadURL\(HOSTED_APP_URL\)/);
  assert.match(main, /did-fail-load/);
  assert.match(main, /HOSTED_LOAD_TIMEOUT_MS = 12000/);
  assert.match(main, /LOADING_HTML/);
  assert.match(main, /loadURL\(LOADING_URL\)/);
  assert.match(main, /hostedLoadStarted/);
  assert.match(main, /Netlify app load timed out after/);
  assert.match(main, /Firebase Hosting fallback timed out after/);
  assert.match(main, /localOrigin \+ "\/home\.html"/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /isFirebaseAuthPopup/);
  assert.match(main, /startsWith\(absoluteRoot \+ path\.sep\)/);
  assert.match(main, /vivid-icon\.ico/);
  assert.match(main, /win\.maximize\(\)/);
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
  assert.match(redirect, /https:\/\/vivid-cinema\.netlify\.app\//);
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
    "https://vivid-cinema.netlify.app/home.html?source=apk#recall"
  );
  assert.equal(
    runRedirect(
      "https://deploy-preview-342--vivid-cinema.netlify.app/for-you.html?source=apk",
      "Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) AppleWebKit/537.36"
    ),
    "https://vivid-cinema.netlify.app/for-you.html?source=apk"
  );
  assert.equal(
    runRedirect(
      "https://vivid-cinema.web.app/home.html",
      "Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) AppleWebKit/537.36"
    ),
    null
  );
  assert.equal(
    runRedirect("http://localhost:1234/home.html", "Mozilla/5.0 Windows Electron/36.4.0"),
    null
  );
  assert.equal(
    runRedirect("https://deploy-preview-342--vivid-cinema.netlify.app/home.html", "Mozilla/5.0 Chrome/130.0"),
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
  assert.match(main, /require\("electron-updater"\)/);
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(main, /setInterval\(check, 6 \* 60 \* 60 \* 1000\)/);
  assert.match(main, /vivid-update-download/);
  assert.match(main, /vivid-update-install/);
  assert.match(main, /PORTABLE_EXECUTABLE_FILE/);
  assert.match(preload, /Vivid Cinema update/);
  assert.match(preload, /Restart & install/);
  assert.match(preload, /vivid-update-status/);
});

test("Windows workflow builds on demand or on release tags", () => {
  const file = path.join(root, ".github", "workflows", "windows-desktop.yml");
  assert.ok(fs.existsSync(file));
  const workflow = fs.readFileSync(file, "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /desktop:publish/);
  assert.match(workflow, /GH_TOKEN:.*secrets\.GITHUB_TOKEN/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /Verify release tag matches app version/);
  assert.match(workflow, /pull_request/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /desktop:dist/);
  assert.match(workflow, /icons\/\*\*/);
  assert.match(workflow, /Vivid-Cinema-Setup/);
  assert.match(workflow, /Vivid-Cinema-Portable/);
});
