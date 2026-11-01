"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { AdvancedPlayer, createMpvArgs, resolveMpvExecutable } = require("../desktop/advanced-player.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

test("mpv executable resolution separates packaged and development paths", () => {
  assert.equal(
    resolveMpvExecutable({ isPackaged: true, resourcesPath: "C:/App/resources", appPath: "C:/src" }),
    path.join("C:/App/resources", "mpv", "mpv.exe")
  );
  assert.equal(
    resolveMpvExecutable({ isPackaged: false, resourcesPath: "C:/App/resources", appPath: "C:/src" }),
    path.join("C:/src", "desktop", "vendor", "mpv", "mpv.exe")
  );
});

test("mpv launch arguments use safe decoding defaults and never invoke a shell", () => {
  const media = "C:\\Users\\A User\\Downloads\\film; & $().mkv";
  const args = createMpvArgs(media);
  assert.ok(args.includes("--hwdec=auto-safe"));
  assert.ok(args.includes("--no-config"));
  assert.ok(args.includes("--osc=yes"));
  assert.ok(args.includes("--"));
  assert.equal(args.at(-1), media);
  assert.ok(!args.some(value => value.includes("cmd.exe") || value.includes("powershell")));
});

test("advanced player launches only a validated completed download through a direct process spawn", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vivid-advanced-player-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mediaPath = path.join(root, "movie.mkv");
  const executable = path.join(root, "mpv.exe");
  fs.writeFileSync(mediaPath, "media");
  fs.writeFileSync(executable, "runtime");

  const calls = [];
  const children = [];
  const player = new AdvancedPlayer({
    app: { isPackaged: true, getAppPath: () => root },
    downloadEngine: { mediaFile: (id, index) => id === "job-1" && index === 0 ? mediaPath : null },
    platform: "win32",
    resourcesPath: root,
    spawnImpl: (...args) => {
      calls.push(args);
      const child = fakeChild();
      children.push(child);
      return child;
    }
  });

  assert.deepEqual(await player.open("job-1", 0), { started: true, engine: "mpv" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], executable);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].detached, false);
  assert.equal(calls[0][1].at(-1), fs.realpathSync(mediaPath));

  await player.open("job-1", 0);
  assert.equal(children[0].killed, true, "opening another title stops the previous mpv process");
  assert.equal(calls.length, 2);
  player.stop();
  assert.equal(children[1].killed, true);
});

test("advanced player rejects unknown jobs, missing runtime and non-Windows launch", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vivid-advanced-player-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mediaPath = path.join(root, "movie.mkv");
  fs.writeFileSync(mediaPath, "media");

  const missingRuntime = new AdvancedPlayer({
    app: { isPackaged: true, getAppPath: () => root },
    downloadEngine: { mediaFile: () => mediaPath },
    platform: "win32",
    resourcesPath: root
  });
  await assert.rejects(missingRuntime.open("job-1"), /runtime is missing/);

  const nonWindows = new AdvancedPlayer({
    app: { isPackaged: true, getAppPath: () => root },
    downloadEngine: { mediaFile: () => mediaPath },
    platform: "linux",
    resourcesPath: root
  });
  await assert.rejects(nonWindows.open("job-1"), /Windows desktop app only/);
  await assert.rejects(missingRuntime.open("unknown-job"), /not ready to play/);
  await assert.rejects(missingRuntime.open("job-1", -1), /invalid/);
});
