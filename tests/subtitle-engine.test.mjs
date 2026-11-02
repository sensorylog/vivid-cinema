import test from "node:test";
import assert from "node:assert/strict";
import { choosePreferredTrack, normalizeLanguageTag, parseSubtitleFile } from "../scripts/downloads/subtitle-engine.js";
import { playbackProfileKey } from "../scripts/downloads/playback-preferences.js";

test("parses numbered SRT cues and normalizes comma timestamps", () => {
  const cues = parseSubtitleFile("1\n00:00:01,250 --> 00:00:03,500\nHello\nworld\n\n2\n00:00:04,000 --> 00:00:05,000\nGoodbye", "srt");
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1.25);
  assert.equal(cues[0].end, 3.5);
  assert.equal(cues[0].text, "Hello\nworld");
});

test("parses WebVTT with optional cue identifiers and short timestamps", () => {
  const cues = parseSubtitleFile("WEBVTT\n\nintro\n00:01.000 --> 00:03.250\nA VTT cue\n\n00:00:04.000 --> 00:00:05.000\nSecond cue", "vtt");
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 3.25);
  assert.equal(cues[0].text, "A VTT cue");
});

test("parses ASS styles, inline formatting, colours, and comma-containing dialogue", () => {
  const ass = `[Script Info]
Title: Sample
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{i1}Hello, world!{i0}\NSecond line`;
  const cues = parseSubtitleFile(ass, "ass");
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].text, "Hello, world!\nSecond line");
  assert.equal(cues[0].style.fontFamily, "Arial");
  assert.equal(cues[0].style.fontSize, 32);
  assert.equal(cues[0].runs[0].style.italic, true);
});

test("rejects unsupported and empty subtitle files", () => {
  assert.throws(() => parseSubtitleFile("x", "txt"), /Choose an SRT/);
  assert.throws(() => parseSubtitleFile("no cues", "srt"), /No readable subtitle cues/);
});

test("matches preferred language by exact tag then base language", () => {
  const tracks = [{ language: "fr" }, { language: "en-US" }, { language: "ja-JP" }];
  assert.equal(normalizeLanguageTag("EN_us"), "en-us");
  assert.equal(choosePreferredTrack(tracks, "en"), 1);
  assert.equal(choosePreferredTrack(tracks, "ja-JP"), 2);
  assert.equal(choosePreferredTrack(tracks, "de"), -1);
});

test("stores playback preference profiles per movie, show episode, and media file", () => {
  assert.equal(playbackProfileKey({ id: "job", media: { id: 55, media_type: "movie" } }, 0), "movie:55:file:0");
  assert.equal(playbackProfileKey({ id: "job", media: { id: 77, media_type: "tv", season: 2, episode: 4 } }, 1), "tv:77:s2e4:file:1");
});
