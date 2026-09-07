// 把截图缩成字符图，用于在无图形界面下"看"屏幕布局
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const bpp = ch * (bitDepth / 8);
  const stride = w * bpp;
  const px = Buffer.alloc(w * h * ch);
  let rp = 0, pp = 0;
  const prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++];
    raw.copy(cur, 0, rp, rp + stride); rp += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    cur.copy(px, pp); pp += stride;
    cur.copy(prev);
    cur = Buffer.alloc(stride);
  }
  return { w, h, ch, px };
}

const img = decodePNG(fs.readFileSync(process.argv[2]));
const { w, h, ch, px } = img;
console.log(`图像: ${w}x${h}`);

const COLS = 60, ROWS = 60;
const chars = ' .:-=+*#%@';
let out = '';
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor(c * w / COLS), x1 = Math.floor((c + 1) * w / COLS);
    const y0 = Math.floor(r * h / ROWS), y1 = Math.floor((r + 1) * h / ROWS);
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * w + x) * ch;
        sum += (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
        n++;
      }
    }
    const lum = n ? sum / n : 0;
    line += chars[Math.min(9, Math.floor((255 - lum) / 25.6))];
  }
  out += String(Math.floor(r * h / ROWS)).padStart(4) + ' |' + line + '\n';
}
console.log('    ' + ' y\\x'.padEnd(2));
console.log(out);
