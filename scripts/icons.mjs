import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, contents) {
  const payload = Buffer.concat([Buffer.from(name), contents]);
  const header = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  header.writeUInt32BE(contents.length);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([header, payload, checksum]);
}

function colorAt(x, y) {
  const dot = (x - 47) ** 2 + (y - 47) ** 2 < 6 ** 2;
  if (dot) return [242, 194, 48];
  const inLine = (left, right, middle) =>
    (x - Math.min(Math.max(x, left), right)) ** 2 + (y - middle) ** 2 < 2.5 ** 2;
  if (inLine(14, 43, 20) || inLine(14, 36, 31)) return [255, 255, 255];
  return [41, 71, 209];
}

function writeIcon(path, size, maskable) {
  const width = size * 3 + 1;
  const pixels = Buffer.alloc(width * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let px = (x + .5) * 64 / size;
      let py = (y + .5) * 64 / size;
      if (maskable) {
        px = (px - 32) / .72 + 32;
        py = (py - 32) / .72 + 32;
      }
      const ink = colorAt(px, py);
      pixels.set(ink, y * width + x * 3 + 1);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const publicDir = new URL('../public/', import.meta.url);
mkdirSync(new URL('icons/', publicDir), { recursive: true });
writeIcon(new URL('apple-touch-icon.png', publicDir), 180, false);
writeIcon(new URL('icons/icon-192.png', publicDir), 192, false);
writeIcon(new URL('icons/icon-512.png', publicDir), 512, false);
writeIcon(new URL('icons/maskable-512.png', publicDir), 512, true);
