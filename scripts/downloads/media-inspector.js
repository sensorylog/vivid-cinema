const text = (bytes, start, length) => new TextDecoder("ascii").decode(bytes.subarray(start, start + length));
const u32 = (view, offset) => view.getUint32(offset, false);
const u64 = (view, offset) => Number(view.getBigUint64(offset, false));
const fourCC = (bytes, offset) => text(bytes, offset, 4);
const printable = value => /^[\\x20-\\x7e]{4}$/.test(value);

function mp4Boxes(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end && offset + 8 <= bytes.length) {
    let size = u32(view, offset);
    const type = fourCC(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) break;
      size = u64(view, offset + 8); header = 16;
    } else if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > end || offset + size > bytes.length) break;
    boxes.push({ type, start: offset, data: offset + header, end: offset + size, size });
    offset += size;
  }
  return boxes;
}

function parseMp4(bytes) {
  const top = mp4Boxes(bytes, 0, bytes.length);
  if (!top.some(box => box.type === "ftyp" || box.type === "moov")) return null;
  const moov = top.find(box => box.type === "moov");
  if (!moov) return { format: "MP4 / ISO Base Media", complete: false, tracks: [], note: "The movie index was not present in the inspected byte range." };
  const children = (box, type) => mp4Boxes(bytes, box.data, box.end).filter(item => !type || item.type === type);
  const tracks = [];
  let duration = null;
  const mvhd = children(moov, "mvhd")[0];
  if (mvhd && mvhd.data + 20 <= mvhd.end) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = bytes[mvhd.data];
    const timescaleOffset = mvhd.data + (version === 1 ? 20 : 12);
    const durationOffset = mvhd.data + (version === 1 ? 24 : 16);
    if (durationOffset + (version === 1 ? 8 : 4) <= mvhd.end) {
      const scale = u32(view, timescaleOffset);
      const ticks = version === 1 ? u64(view, durationOffset) : u32(view, durationOffset);
      if (scale) duration = ticks / scale;
    }
  }
  for (const trak of children(moov, "trak")) {
    const trakChildren = children(trak);
    const mdia = trakChildren.find(item => item.type === "mdia");
    if (!mdia) continue;
    const mdiaChildren = children(mdia);
    const hdlr = mdiaChildren.find(item => item.type === "hdlr");
    const handler = hdlr && hdlr.data + 12 <= hdlr.end ? fourCC(bytes, hdlr.data + 8) : "unknown";
    const kind = handler === "vide" ? "video" : handler === "soun" ? "audio" : handler;
    const minf = mdiaChildren.find(item => item.type === "minf");
    const stbl = minf && children(minf, "stbl")[0];
    const stsd = stbl && children(stbl, "stsd")[0];
    let codec = "Unknown";
    if (stsd && stsd.data + 16 <= stsd.end) {
      const entrySize = u32(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), stsd.data + 8);
      if (entrySize >= 8 && stsd.data + 8 + entrySize <= stsd.end) codec = fourCC(bytes, stsd.data + 16);
    }
    const mdhd = mdiaChildren.find(item => item.type === "mdhd");
    let language = "";
    if (mdhd && mdhd.data + 24 <= mdhd.end) {
      const version = bytes[mdhd.data];
      const languageOffset = mdhd.data + (version === 1 ? 32 : 20);
      if (languageOffset + 2 <= mdhd.end) {
        const packed = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(languageOffset, false);
        if (packed) language = [((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60].map(code => String.fromCharCode(code)).join("");
      }
    }
    tracks.push({ kind, codec, language: /^[a-z]{3}$/.test(language) ? language : "", source: "MP4 sample description" });
  }
  const tkhd = children(moov, "trak").map(trak => {
    const box = children(trak, "tkhd")[0];
    if (!box) return null;
    const version = bytes[box.data];
    const offset = box.data + (version === 1 ? 88 : 76);
    if (offset + 8 > box.end) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(offset, false) / 65536, height: view.getUint32(offset + 4, false) / 65536 };
  }).find(Boolean);
  return { format: "MP4 / ISO Base Media", duration, width: tkhd?.width || 0, height: tkhd?.height || 0, tracks, complete: true, note: "Track codecs are read from MP4 sample descriptions." };
}

function readVint(bytes, offset, keepMarker = false) {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  let mask = 0x80, length = 1;
  while (length <= 8 && !(first & mask)) { mask >>= 1; length++; }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
  const unknown = !keepMarker && Array.from(bytes.subarray(offset, offset + length)).every(byte => byte === 0xff);
  return { value, length, unknown };
}

function ebmlElements(bytes, start, end) {
  const result = [];
  let offset = start;
  while (offset < end && offset < bytes.length) {
    const id = readVint(bytes, offset, true);
    if (!id) break;
    const size = readVint(bytes, offset + id.length);
    if (!size || (!size.unknown && !Number.isSafeInteger(size.value))) break;
    const data = offset + id.length + size.length;
    const elementEnd = size.unknown ? end : data + size.value;
    if (elementEnd > end || elementEnd > bytes.length) break;
    result.push({ id: id.value, data, end: elementEnd, size: size.value });
    offset = elementEnd;
  }
  return result;
}
const ebmlUint = (bytes, element) => {
  let value = 0;
  for (let i = element.data; i < element.end; i++) value = value * 256 + bytes[i];
  return value;
};
const ebmlString = (bytes, element) => new TextDecoder("utf-8").decode(bytes.subarray(element.data, element.end)).replace(/\\0+$/, "");
function parseMatroska(bytes) {
  const root = ebmlElements(bytes, 0, bytes.length);
  if (!root.some(element => element.id === 0x1a45dfa3)) return null;
  const segment = root.find(element => element.id === 0x18538067);
  if (!segment) return { format: "Matroska / WebM", tracks: [], complete: false, note: "Segment metadata was not available in the inspected byte range." };
  const top = ebmlElements(bytes, segment.data, segment.end);
  const info = top.find(element => element.id === 0x1549a966);
  const trackGroup = top.find(element => element.id === 0x1654ae6b);
  let duration = null;
  if (info) {
    const scale = ebmlElements(bytes, info.data, info.end).find(element => element.id === 0x2ad7b1);
    const dur = ebmlElements(bytes, info.data, info.end).find(element => element.id === 0x4489);
    if (dur) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let value = NaN;
      if (dur.size === 4) value = view.getFloat32(dur.data, false);
      if (dur.size === 8) value = view.getFloat64(dur.data, false);
      if (Number.isFinite(value)) duration = value * (scale ? ebmlUint(bytes, scale) : 1000000) / 1000000000;
    }
  }
  const tracks = [];
  if (trackGroup) for (const entry of ebmlElements(bytes, trackGroup.data, trackGroup.end).filter(element => element.id === 0xae)) {
    const fields = ebmlElements(bytes, entry.data, entry.end);
    const get = id => fields.find(element => element.id === id);
    const type = get(0x83), codec = get(0x86), language = get(0x22b59c) || get(0x22b59d);
    const kindValue = type ? ebmlUint(bytes, type) : 0;
    tracks.push({
      kind: kindValue === 1 ? "video" : kindValue === 2 ? "audio" : kindValue === 17 ? "subtitle" : "unknown",
      codec: codec ? ebmlString(bytes, codec) : "Unknown",
      language: language ? ebmlString(bytes, language) : "",
      source: "Matroska TrackEntry"
    });
  }
  return { format: "Matroska / WebM", duration, tracks, complete: Boolean(trackGroup), note: trackGroup ? "Track codecs and languages are read from Matroska TrackEntry metadata." : "Track metadata was not found in the inspected byte range." };
}

export function inspectMediaBytes(input, filename = "") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const mp4 = parseMp4(bytes);
  if (mp4) return { ...mp4, inspectedBytes: bytes.length, filename };
  const matroska = parseMatroska(bytes);
  if (matroska) return { ...matroska, inspectedBytes: bytes.length, filename };
  return { format: "Unrecognised or unsupported container", tracks: [], complete: false, inspectedBytes: bytes.length, filename, note: "No supported container signature was found in the inspected bytes." };
}

export async function inspectMediaUrl(url, filename = "", { fetchImpl = globalThis.fetch, maxBytes = 32 * 1024 * 1024 } = {}) {
  if (typeof fetchImpl !== "function" || !url) throw new Error("Media inspection is unavailable for this source.");
  const response = await fetchImpl(url, { headers: { Range: "bytes=0-" + (maxBytes - 1) } });
  if (!(response.ok || response.status === 206)) throw new Error("Could not read the media file for inspection (HTTP " + response.status + ").");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("The media file returned no readable data.");
  const result = inspectMediaBytes(bytes, filename);
  const rangeTotal = /\/(\d+)$/.exec(response.headers.get("content-range") || "");
  const fileSize = rangeTotal ? Number(rangeTotal[1]) : Number(response.headers.get("content-length")) || null;
  if (!result.complete && fileSize && fileSize > bytes.length) {
    const tailStart = Math.max(bytes.length, fileSize - Math.min(maxBytes, 8 * 1024 * 1024));
    try {
      const tailResponse = await fetchImpl(url, { headers: { Range: "bytes=" + tailStart + "-" + (fileSize - 1) } });
      if (tailResponse.ok || tailResponse.status === 206) {
        const tail = new Uint8Array(await tailResponse.arrayBuffer());
        const tailResult = inspectMediaBytes(tail, filename);
        if (tailResult.complete && tailResult.tracks.length) return { ...tailResult, fileSize, partial: true, note: tailResult.note + " Metadata was located in the file's trailing region." };
      }
    } catch {}
  }
  return { ...result, fileSize, partial: response.status === 206 || bytes.length >= maxBytes };
}
