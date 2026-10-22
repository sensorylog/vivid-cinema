const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pngPath = path.join(root, "icons", "vivid-icon-180.png");
const icoPath = path.join(root, "icons", "vivid-icon.ico");
const png = fs.readFileSync(pngPath);

// ICO v1 header + one image directory entry. PNG-compressed icon payloads are
// supported by modern Windows and preserve the checked-in Vivid artwork exactly.
if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") {
  throw new Error("Vivid Cinema icon source is not a valid PNG");
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== height || width > 256 || width < 16) {
  throw new Error(`Unexpected Vivid Cinema icon dimensions: ${width}x${height}`);
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry.writeUInt8(width === 256 ? 0 : width, 0);
entry.writeUInt8(height === 256 ? 0 : height, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log(`Prepared Vivid Cinema Windows icon: ${icoPath} (${width}x${height})`);
