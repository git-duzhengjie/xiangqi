// 验证图标中「帥」字是否真正居中（PNG 像素级扫描，零依赖）
// 只统计「内圈以内」的红色像素，避开红色双圈边框，
// 求墨迹包围盒中心，与棋子圆心比对偏移。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = path.join(process.cwd(), 'app', 'static', 'icons');

// 极简 PNG 解码：仅支持 8bit 真彩色(2)/带Alpha(6)，非隔行
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth);
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!ch) throw new Error('colorType ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const cur = px.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0, x = line[i];
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('filter ' + ft);
      }
      cur[i] = v & 0xff;
    }
  }
  return { w, h, ch, px, hasAlpha: colorType === 6 };
}

// 小尺寸（<40px）像素太少，抹平后包围盒误差占比大，不作为判定依据；
// 取 40px 以上全部尺寸验证。
const targets = [40, 48, 57, 58, 60, 72, 76, 80, 87, 96, 114, 120, 144, 152, 167, 180, 192, 512, 1024];
console.log('');
console.log('Icon glyph centering check (pixel scan)');
console.log('='.repeat(68));
console.log('  ' + 'file'.padEnd(14) + 'dx'.padStart(7) + 'dy'.padStart(7)
  + 'dx%'.padStart(8) + 'dy%'.padStart(8) + '  alpha' + '   verdict');
console.log('  ' + '-'.repeat(64));

let fail = 0, checked = 0;
for (const s of targets) {
  const p = path.join(dir, 'icon-' + s + '.png');
  if (!fs.existsSync(p)) { console.log('  icon-' + s + '.png MISSING'); fail++; continue; }

  const img = decodePng(fs.readFileSync(p));
  const { w, ch, px, hasAlpha } = img;

  const margin = Math.floor(s * 0.055);
  const d = s - margin * 2;
  const cx = margin + d / 2, cy = margin + d / 2;
  // 扫描半径必须确保完全避开内圈红环：
  //   内圈环心半径 = d/2 - s*0.085，线宽 penW 以环心为中向两侧各占 penW/2，
  //   再加上抗锯齿渗边。早先只减 penW 一倍，导致 120px 下环的抗锯齿
  //   像素渗进扫描区被误当成字形，包围盒被拉偏，误报 OFF-CENTER。
  const penW = Math.max(1, s * 0.018);
  const rSafe = d / 2 - s * 0.085 - penW - Math.max(2, s * 0.02);

  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, cnt = 0;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const ddx = x - cx, ddy = y - cy;
      if (ddx * ddx + ddy * ddy > rSafe * rSafe) continue;
      const o = (y * w + x) * ch;
      const R = px[o], G = px[o + 1], B = px[o + 2];
      if (R > 120 && G < 90 && B < 95) {
        cnt++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (cnt === 0) { console.log('  icon-' + s + '.png NO GLYPH PIXELS!'); fail++; continue; }

  const offX = (minX + maxX) / 2 - cx;
  const offY = (minY + maxY) / 2 - cy;
  const pctX = offX / s * 100, pctY = offY / s * 100;
  const centered = Math.abs(pctX) <= 1 && Math.abs(pctY) <= 1;
  const ok = centered && !hasAlpha;
  if (!ok) fail++;
  checked++;

  console.log('  ' + ('icon-' + s + '.png').padEnd(14)
    + offX.toFixed(1).padStart(7) + offY.toFixed(1).padStart(7)
    + (pctX.toFixed(2) + '%').padStart(8) + (pctY.toFixed(2) + '%').padStart(8)
    + (hasAlpha ? '  YES!' : '    no')
    + '   ' + (hasAlpha ? 'HAS ALPHA!' : centered ? 'OK' : 'OFF-CENTER'));
}

console.log('');
if (checked === 0) { console.log('[FAIL] nothing checked'); process.exit(1); }
if (fail === 0) {
  console.log('[PASS] ' + checked + ' icons: glyph centered (offset <1%), no alpha channel');
  process.exit(0);
}
console.log('[FAIL] ' + fail + ' problem(s)');
process.exit(1);
