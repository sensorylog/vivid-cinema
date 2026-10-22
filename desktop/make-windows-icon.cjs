const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const pngPath = path.join(root, "icons", "vivid-icon-180.png");
const icoPath = path.join(root, "icons", "vivid-icon.ico");
const input = fs.readFileSync(pngPath);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error("Vivid Cinema icon source is not a valid PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (bitDepth !== 8 || ![3, 6].includes(colorType) || interlace !== 0 || !width || width !== height) {
    throw new Error("Expected a non-interlaced, 8-bit indexed or RGBA square PNG for the Vivid icon");
  }

  const bytesPerPixel = colorType === 6 ? 4 : 1;
  const stride = width * bytesPerPixel;
  const compressed = zlib.inflateSync(Buffer.concat(imageData));
  const decoded = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = compressed[sourceOffset++];
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = compressed[sourceOffset++];
      const left = x >= bytesPerPixel ? decoded[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[rowOffset - stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? decoded[rowOffset - stride + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error("Unsupported PNG filter: " + filter);
      decoded[rowOffset + x] = (raw + predictor) & 255;
    }
  }

  if (colorType === 6) return { width, height, pixels: decoded };
  if (!palette || palette.length % 3 !== 0) throw new Error("Indexed Vivid PNG is missing its color palette");
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < decoded.length; i++) {
    const colorOffset = decoded[i] * 3;
    if (colorOffset + 2 >= palette.length) throw new Error("Vivid PNG contains an invalid palette index");
    const target = i * 4;
    pixels[target] = palette[colorOffset];
    pixels[target + 1] = palette[colorOffset + 1];
    pixels[target + 2] = palette[colorOffset + 2];
    pixels[target + 3] = transparency && decoded[i] < transparency.length ? transparency[decoded[i]] : 255;
  }
  return { width, height, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function resizeRgba(source, size) {
  const output = Buffer.alloc(size * (size * 4 + 1));
  const srcStride = source.width * 4;
  let targetOffset = 0;
  for (let y = 0; y < size; y++) {
    output[targetOffset++] = 0;
    const sy = Math.max(0, Math.min(source.height - 1, (y + 0.5) * source.height / size - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, (x + 0.5) * source.width / size - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const wx = sx - x0;
      for (let channel = 0; channel < 4; channel++) {
        const topLeft = source.pixels[y0 * srcStride + x0 * 4 + channel];
        const topRight = source.pixels[y0 * srcStride + x1 * 4 + channel];
        const bottomLeft = source.pixels[y1 * srcStride + x0 * 4 + channel];
        const bottomRight = source.pixels[y1 * srcStride + x1 * 4 + channel];
        const top = topLeft + (topRight - topLeft) * wx;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * wx;
        output[targetOffset++] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function makePng(size, rgbaRows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = zlib.deflateSync(rgbaRows, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const iconSize = 256;
const source = readPng(input);
const png = makePng(iconSize, resizeRgba(source, iconSize));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // 0 means 256 pixels in the ICO format.
entry.writeUInt8(0, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log(`Prepared Vivid Cinema Windows icon: ${icoPath} (${iconSize}x${iconSize})`);
