import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getProviderAdapter,
  listProviderAdapters,
  providerSupports,
  sendProviderCommand
} from "../scripts/playback/provider-adapters.js";
import { getGuestPlaybackAction } from "../scripts/playback/watch-room-playback-policy.js";

test("provider registry keeps Player 1 and Player 2 identities distinct", () => {
  assert.equal(getProviderAdapter("player1", "vidsrc").label, "VidSrc");
  assert.equal(getProviderAdapter("player2", "vidsrc-embed").label, "VidSrc Embed");
  assert.equal(getProviderAdapter("player1", "vidsrc-embed"), null);
  assert.equal(getProviderAdapter("player2", "vidsrc"), null);
});

test("only documented VidSrc and CineSRC bridges advertise room-control capabilities", () => {
  const adapters = listProviderAdapters();
  const capable = adapters.filter(adapter => Object.values(adapter.capabilities).some(Boolean));
  assert.deepEqual(capable.map(adapter => adapter.playerId + ":" + adapter.providerId), ["player1:vidsrc", "player2:cinesrc"]);
  for (const adapter of adapters) {
    if (!((adapter.playerId === "player1" && adapter.providerId === "vidsrc") || (adapter.playerId === "player2" && adapter.providerId === "cinesrc"))) {
      assert.equal(Object.values(adapter.capabilities).some(Boolean), false);
    }
  }
  assert.equal(providerSupports("player1", "vidsrc", "canSeek"), true);
  assert.equal(providerSupports("player2", "vidsrc-embed", "canSeek"), false);
  assert.equal(providerSupports("player2", "cinesrc", "canSeek"), true);
  assert.equal(providerSupports("player2", "vidlink", "canReadPosition"), false);
});

test("commands require a supported action and matching iframe origin", () => {
  const calls = [];
  const frame = { src: "https://vidsrc.sh/embed/movie/27205", contentWindow: { postMessage: (...args) => calls.push(args) } };
  const adapter = getProviderAdapter("player1", "vidsrc");
  assert.equal(sendProviderCommand({ adapter, frame, action: "play" }), true);
  assert.deepEqual(calls[0], [{ player: true, action: "play" }, "https://vidsrc.sh"]);
  assert.equal(sendProviderCommand({ adapter, frame, action: "seek", position: 91.8 }), true);
  assert.deepEqual(calls[1], [{ player: true, action: "seek91" }, "https://vidsrc.sh"]);
  assert.equal(sendProviderCommand({ adapter, frame, action: "pause" }), true);
  assert.equal(sendProviderCommand({ adapter, frame, action: "volume" }), false);
  assert.equal(sendProviderCommand({ adapter: getProviderAdapter("player2", "vidsrc-embed"), frame, action: "play" }), false);
  assert.equal(sendProviderCommand({ adapter, frame: { ...frame, src: "https://evil.example/embed" }, action: "play" }), false);
});


test("CineSRC uses its documented command protocol and verified origin", () => {
  const calls = [];
  const frame = {
    src: "https://cinesrc.st/embed/movie/1084242",
    contentWindow: { postMessage: (...args) => calls.push(args) }
  };
  const adapter = getProviderAdapter("player2", "cinesrc");
  assert.equal(providerSupports("player2", "cinesrc", "canPlay"), true);
  assert.equal(sendProviderCommand({ adapter, frame, action: "play" }), true);
  assert.deepEqual(calls[0], [{ type: "cinesrc:command", command: "play", args: [] }, "https://cinesrc.st"]);
  assert.equal(sendProviderCommand({ adapter, frame, action: "pause" }), true);
  assert.deepEqual(calls[1], [{ type: "cinesrc:command", command: "pause", args: [] }, "https://cinesrc.st"]);
  assert.equal(sendProviderCommand({ adapter, frame, action: "seek", position: 123.5 }), true);
  assert.deepEqual(calls[2], [{ type: "cinesrc:command", command: "seek", args: [123.5] }, "https://cinesrc.st"]);
  assert.equal(sendProviderCommand({ adapter, frame: { ...frame, src: "https://evil.example/embed" }, action: "play" }), false);
});

test("guest playback stays paused until the member explicitly joins the screening", () => {
  assert.equal(getGuestPlaybackAction({ role: "guest", joinedPlayback: false, playbackStatus: "playing" }), "pause");
  assert.equal(getGuestPlaybackAction({ role: "guest", joinedPlayback: false, playbackStatus: "paused" }), "pause");
  assert.equal(getGuestPlaybackAction({ role: "guest", joinedPlayback: true, playbackStatus: "playing" }), "follow");
  assert.equal(getGuestPlaybackAction({ role: "guest", joinedPlayback: true, playbackStatus: "paused" }), "pause");
  assert.equal(getGuestPlaybackAction({ role: "host", joinedPlayback: false, playbackStatus: "playing" }), "ignore");
});

test("Watch Room client actively holds guests before and during host playback", async () => {
  const client = await readFile(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  assert.match(client, /function pauseGuestPlayer\(/);
  assert.match(client, /getGuestPlaybackAction\(\{ role, joinedPlayback, playbackStatus: state\.status \}\)/);
  assert.match(client, /else if \(role === "guest"\) pauseGuestPlayer\(/);
  assert.match(client, /if \(state\.status === "paused" \|\| state\.status === "ended"\) \{/);
  assert.match(client, /Your player is ready and paused/);
});
