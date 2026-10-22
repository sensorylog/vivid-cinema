import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("desktop packaging is opt-in and preserves existing scripts", () => {
  assert.equal(pkg.scripts["desktop:start"], "electron desktop/main.cjs");
  assert.match(pkg.scripts["desktop:dist"], /make-windows-icon\.cjs/);
  assert.match(pkg.scripts["desktop:dist"], /electron-builder --win nsis portable/);
  assert.match(pkg.scripts.test, /tests\/desktop-build\.test\.mjs/);
  assert.equal(pkg.scripts["check:syntax"], "node automation/check-syntax.mjs");
  assert.ok(pkg.scripts["test:rules"]);
});
test("Windows installer and portable executable targets use Vivid branding", () => {
  assert.ok(pkg.devDependencies.electron);
  assert.ok(pkg.devDependencies["electron-builder"]);
  assert.deepEqual(pkg.build.win.target.map((target) => target.target), ["nsis", "portable"]);
  assert.equal(pkg.build.asar, true);
  assert.equal(pkg.build.win.icon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.installerIcon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.uninstallerIcon, "icons/vivid-icon.ico");
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.ok(fs.existsSync(path.join(root, "icons", "vivid-icon.svg")));
  assert.ok(fs.existsSync(path.join(root, "icons", "vivid-icon-180.png")));
});
test("desktop runtime bundles the local app with a restricted renderer", () => {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  assert.match(main, /app\.getAppPath\(\)/);
  assert.match(main, /loadURL\(localOrigin \+ "\/home\.html"\)/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /isFirebaseAuthPopup/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /startsWith\(absoluteRoot \+ path\.sep\)/);
  assert.match(main, /icon:\s*appIcon/);
  assert.match(main, /setAppUserModelId\("com\.axisvision\.vividcinema"\)/);
  assert.match(main, /win\.maximize\(\)/);
  assert.match(main, /win\.show\(\)/);
});
test("Windows icon preparation creates a valid ICO container from the checked-in Vivid PNG", () => {
  const script = fs.readFileSync(path.join(root, "desktop", "make-windows-icon.cjs"), "utf8");
  assert.match(script, /vivid-icon-180\.png/);
  assert.match(script, /vivid-icon\.ico/);
  assert.match(script, /writeFileSync/);
});
test("Windows workflow builds on demand or on release tags", () => {
  const file = path.join(root, ".github", "workflows", "windows-desktop.yml");
  assert.ok(fs.existsSync(file));
  const workflow = fs.readFileSync(file, "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /pull_request/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /desktop:dist/);
  assert.match(workflow, /icons\/**/);
  assert.match(workflow, /Vivid-Cinema-Setup/);
  assert.match(workflow, /Vivid-Cinema-Portable/);
});
