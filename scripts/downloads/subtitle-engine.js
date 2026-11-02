const TIME = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/;

function toSeconds(value) {
  const match = TIME.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]), seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + Number(("0." + match[4]));
}

function assColor(value) {
  const match = /&H([0-9A-F]{1,8})&?/i.exec(String(value || ""));
  if (!match) return null;
  const raw = match[1].padStart(8, "0");
  const alpha = parseInt(raw.slice(0, 2), 16);
  const blue = raw.slice(-6, -4), green = raw.slice(-4, -2), red = raw.slice(-2);
  return "rgba(" + parseInt(red, 16) + "," + parseInt(green, 16) + "," + parseInt(blue, 16) + "," + (1 - alpha / 255).toFixed(3) + ")";
}

function parseSrt(source) {
  const normalized = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues = [];
  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const timingIndex = lines.findIndex(line => /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(line));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].split("-->");
    const start = toSeconds(timing[0]);
    const end = toSeconds(timing[1].trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (start !== null && end !== null && end > start && text) cues.push({ start, end, text, format: "srt" });
  }
  return cues;
}

function parseVtt(source) {
  const normalized = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:\s|$)/.test(normalized.trimStart())) throw new Error("This is not a valid WebVTT subtitle file.");
  const cues = [];
  for (const block of normalized.replace(/^WEBVTT[^\n]*\n/, "").split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const timingIndex = lines.findIndex(line => /\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/.test(line));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].split("-->");
    const start = toSeconds(timing[0]);
    const end = toSeconds(timing[1].trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (start !== null && end !== null && end > start && text) cues.push({ start, end, text, format: "vtt" });
  }
  return cues;
}

function parseAssTimestamp(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]), seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + Number("0." + match[4].padEnd(2, "0"));
}

function parseAssRuns(sourceText, baseStyle) {
  let current = { ...baseStyle }, plain = "", runs = [];
  const append = text => {
    if (!text) return;
    plain += text;
    const previous = runs[runs.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(current)) previous.text += text;
    else runs.push({ text, style: { ...current } });
  };
  const parts = String(sourceText || "").split(/(\{[^}]*\})/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("{") && part.endsWith("}")) {
      const tags = part.slice(1, -1);
      for (const match of tags.matchAll(/\\(b|i|u)(-?\d+)|\\fs(\d+(?:\.\d+)?)|\\fn([^\\}]+)|\\(?:1c|c)&H([0-9A-F]+)&?|\\3c&H([0-9A-F]+)&?|\\bord(\d+(?:\.\d+)?)|\\shad(\d+(?:\.\d+)?)|\\an([1-9])/gi)) {
        if (match[1]) current[{ b: "bold", i: "italic", u: "underline" }[match[1].toLowerCase()]] = Number(match[2]) !== 0;
        if (match[3]) current.fontSize = Math.max(8, Math.min(96, Number(match[3])));
        if (match[4]) current.fontFamily = match[4].trim().slice(0, 80);
        if (match[5]) current.color = assColor("&H" + match[5] + "&") || current.color;
        if (match[6]) current.outlineColor = assColor("&H" + match[6] + "&") || current.outlineColor;
        if (match[7]) current.outline = Math.max(0, Math.min(8, Number(match[7])));
        if (match[8]) current.shadow = Math.max(0, Math.min(8, Number(match[8])));
        if (match[9]) current.alignment = Number(match[9]);
      }
      continue;
    }
    append(part.replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ").replace(/\\[{}]/g, ""));
  }
  return { text: plain, runs };
}

function parseAss(source) {
  const lines = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let section = "", styleFormat = [], eventFormat = [], styles = new Map(), cues = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) { section = sectionMatch[1].toLowerCase(); continue; }
    const styleSection = section === "v4+ styles" || section === "v4 styles";
    if (styleSection) {
      const formatMatch = /^Format:\s*(.+)$/i.exec(line);
      if (formatMatch) { styleFormat = formatMatch[1].split(",").map(x => x.trim().toLowerCase()); continue; }
      const styleMatch = /^Style:\s*(.*)$/i.exec(line);
      if (styleMatch && styleFormat.length) {
        const values = styleMatch[1].split(",");
        if (values.length < styleFormat.length) continue;
        const data = Object.fromEntries(styleFormat.map((key, index) => [key, values[index]?.trim() || ""]));
        styles.set(data.name || "Default", {
          fontFamily: (data.fontname || "Arial").slice(0, 80),
          fontSize: Math.max(8, Math.min(96, Number(data.fontsize) || 24)),
          color: assColor(data.primarycolour) || "#ffffff",
          outlineColor: assColor(data.outlinecolour) || "rgba(0,0,0,.95)",
          bold: Number(data.bold) !== 0, italic: Number(data.italic) !== 0,
          underline: Number(data.underline) !== 0,
          outline: Math.max(0, Math.min(8, Number(data.outline) || 0)),
          shadow: Math.max(0, Math.min(8, Number(data.shadow) || 0)),
          alignment: Math.max(1, Math.min(9, Number(data.alignment) || 2))
        });
      }
      continue;
    }
    if (section !== "events") continue;
    const formatMatch = /^Format:\s*(.+)$/i.exec(line);
    if (formatMatch) { eventFormat = formatMatch[1].split(",").map(x => x.trim().toLowerCase()); continue; }
    const dialogue = /^Dialogue:\s*(.*)$/i.exec(line);
    if (!dialogue || !eventFormat.length) continue;
    const values = dialogue[1].split(",");
    if (values.length < eventFormat.length) continue;
    const fields = values.slice(0, eventFormat.length - 1);
    fields.push(values.slice(eventFormat.length - 1).join(","));
    const data = Object.fromEntries(eventFormat.map((key, index) => [key, fields[index] ?? ""]));
    const start = parseAssTimestamp(data.start), end = parseAssTimestamp(data.end);
    if (start === null || end === null || end <= start) continue;
    const base = { ...(styles.get(data.style || "Default") || styles.get("Default") || {}) };
    const parsed = parseAssRuns(data.text, base);
    if (!parsed.text.trim()) continue;
    cues.push({ start, end, text: parsed.text, runs: parsed.runs, style: base, alignment: base.alignment || 2, format: "ass" });
  }
  return cues;
}

export function parseSubtitleFile(source, extension) {
  const ext = String(extension || "").replace(/^\./, "").toLowerCase();
  let cues;
  if (ext === "srt") cues = parseSrt(source);
  else if (ext === "vtt") cues = parseVtt(source);
  else if (ext === "ass" || ext === "ssa") cues = parseAss(source);
  else throw new Error("Choose an SRT, VTT, ASS or SSA subtitle file.");
  if (!cues.length) throw new Error("No readable subtitle cues were found in this file.");
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function normalizeLanguageTag(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

export function choosePreferredTrack(tracks, language) {
  const preferred = normalizeLanguageTag(language);
  if (!preferred) return -1;
  const list = Array.from(tracks || []);
  let index = list.findIndex(track => normalizeLanguageTag(track.language) === preferred);
  if (index < 0) index = list.findIndex(track => normalizeLanguageTag(track.language).split("-")[0] === preferred.split("-")[0]);
  return index;
}

function safeFont(value) {
  const font = String(value || "Arial").replace(/[^a-z0-9 ,_-]/gi, "").trim().slice(0, 60);
  return font || "Arial";
}

export function renderSubtitleAtTime(container, cues, time, preferences = {}) {
  const active = (cues || []).find(cue => time >= cue.start && time < cue.end);
  const key = active ? String(active.start) + ":" + String(active.end) + ":" + active.text : "";
  if (container.dataset.cueKey === key) return;
  container.dataset.cueKey = key;
  container.replaceChildren();
  if (!active) return;
  const position = preferences.position || "bottom";
  const alignment = Number(active.alignment || active.style?.alignment || 2);
  const vertical = alignment >= 7 ? "top" : alignment >= 4 ? "middle" : "bottom";
  const horizontal = [1, 4, 7].includes(alignment) ? "left" : [3, 6, 9].includes(alignment) ? "right" : "center";
  const box = document.createElement("div");
  box.className = "offline-rendered-subtitle";
  box.style.textAlign = horizontal;
  box.style[position === "top" || vertical === "top" ? "top" : position === "middle" || vertical === "middle" ? "top" : "bottom"] = "12%";
  if (position === "middle" || vertical === "middle") box.style.transform = "translateY(50%)";
  box.style.fontFamily = safeFont(preferences.font || active.style?.fontFamily || "Arial");
  box.style.fontSize = preferences.size === "small" ? "2.2vh" : preferences.size === "large" ? "4.2vh" : "3vh";
  box.style.color = preferences.color || active.style?.color || "#fff";
  const outlineColor = active.style?.outlineColor || "rgba(0,0,0,.95)";
  const outline = preferences.outline === false ? 0 : Math.max(1, Number(active.style?.outline) || 2);
  box.style.webkitTextStroke = outline + "px " + outlineColor;
  box.style.textShadow = preferences.shadow === false ? "none" : "1px 2px 3px rgba(0,0,0,.95)";
  box.style.background = "rgba(0,0,0," + Math.max(0, Math.min(.85, Number(preferences.background ?? .25))) + ")";
  box.style.padding = "3px 9px";
  box.style.borderRadius = "4px";
  box.style.whiteSpace = "pre-line";
  box.style.maxWidth = "92%";
  box.style.margin = "0 auto";
  const runs = active.runs?.length ? active.runs : [{ text: active.text, style: active.style || {} }];
  for (const run of runs) {
    const span = document.createElement("span");
    span.textContent = run.text;
    const style = run.style || {};
    if (style.bold) span.style.fontWeight = "700";
    if (style.italic) span.style.fontStyle = "italic";
    if (style.underline) span.style.textDecoration = "underline";
    if (style.fontFamily) span.style.fontFamily = safeFont(style.fontFamily);
    if (style.fontSize) span.style.fontSize = (Number(style.fontSize) / 24) + "em";
    if (style.color) span.style.color = style.color;
    if (style.outlineColor && style.outline) span.style.webkitTextStroke = style.outline + "px " + style.outlineColor;
    box.appendChild(span);
  }
  container.appendChild(box);
}

export function clearSubtitleOverlay(container) {
  if (!container) return;
  container.dataset.cueKey = "";
  container.replaceChildren();
}
