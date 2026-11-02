"use strict";

const path = require("node:path");
const crypto = require("node:crypto");

const LOCAL_VIDEO_EXTENSIONS = Object.freeze([
  "mp4", "m4v", "mkv", "avi", "mov", "webm", "ogv", "ogg",
  "mpg", "mpeg", "m1v", "m2v", "vob", "wmv", "asf", "flv",
  "ts", "m2ts", "mts", "3gp", "3gpp", "3g2", "qt", "mp4v", "f4v"
]);

function isSupportedLocalVideoFile(filePath) {
  const extension = path.extname(String(filePath || "")).slice(1).toLowerCase();
  return LOCAL_VIDEO_EXTENSIONS.includes(extension);
}

function createLocalMediaRegistry({ maxEntries = 8, createToken = () => crypto.randomBytes(32).toString("hex") } = {}) {
  const entries = new Map();

  return Object.freeze({
    register(filePath, senderId) {
      if (!isSupportedLocalVideoFile(filePath)) throw new Error("Choose a supported video file.");
      if (!Number.isInteger(senderId)) throw new Error("Invalid media requester.");
      const token = createToken();
      entries.set(token, { filePath: path.resolve(filePath), senderId });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return token;
    },
    get(token) {
      return entries.get(String(token || "")) || null;
    },
    release(token, senderId) {
      const key = String(token || "");
      const entry = entries.get(key);
      if (!entry || entry.senderId !== senderId) return false;
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  });
}

module.exports = { createLocalMediaRegistry, isSupportedLocalVideoFile, LOCAL_VIDEO_EXTENSIONS };
