// 检测截图中的棋子位置：棋子是彩色圆形（红/黑字），底色是木色棋盘
// 思路：扫描高饱和度或深色的连通块，输出中心坐标
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
console.log(`图像 ${w}x${h}`);

// 采样若干行，输出每行的颜色分布，找出棋盘区域
console.log('\n=== 各区域主色采样（每 100px 一行，横向 9 点）===');
for (let y = 250; y < h - 100; y += 100) {
  let line = `y=${String(y).padStart(4)}: `;
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(w * (k + 0.5) / 9);
    const i = (y * w + x) * ch;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    let tag = '..';
    if (r > 150 && g < 110 && b < 110) tag = 'R!';       // 红棋
    else if (mx < 90) tag = 'B!';                          // 黑棋
    else if (sat > 0.35) tag = 'c ';
    line += tag + ' ';
  }
  console.log(line);
}
