import test from "node:test";
import assert from "node:assert/strict";
import {
  getProviderAdapter,
  listProviderAdapters,
  providerSupports,
  sendProviderCommand
} from "../scripts/playback/provider-adapters.js";

test("provider registry keeps Player 1 and Player 2 identities distinct", () => {
  assert.equal(getProviderAdapter("player1", "vidsrc").label, "VidSrc");
  assert.equal(getProviderAdapter("player2", "vidsrc-embed").label, "VidSrc Embed");
  assert.equal(getProviderAdapter("player1", "vidsrc-embed"), null);
  assert.equal(getProviderAdapter("player2", "vidsrc"), null);
});

test("only the existing Player 1 VidSrc bridge advertises room-control capabilities", () => {
  const adapters = listProviderAdapters();
  const capable = adapters.filter(adapter => Object.values(adapter.capabilities).some(Boolean));
  assert.deepEqual(capable.map(adapter => adapter.playerId + ":" + adapter.providerId), ["player1:vidsrc"]);
  for (const adapter of adapters) {
    if (adapter.playerId === "player2" || adapter.providerId !== "vidsrc") {
      assert.equal(Object.values(adapter.capabilities).some(Boolean), false);
    }
  }
  assert.equal(providerSupports("player1", "vidsrc", "canSeek"), true);
  assert.equal(providerSupports("player2", "vidsrc-embed", "canSeek"), false);
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
