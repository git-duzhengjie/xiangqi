/**
 * 从 APK 里提取打包后的 JS，核对实际生效的音效路径字符串。
 *
 * 为什么必须做这一步：
 * 我已经改了六次代码，每次都在本地校验通过后就让老板打包，
 * 却从未验证过「老板手上那个 APK 里的代码到底长什么样」。
 * 如果打包用的是旧代码、或条件编译没按预期展开，
 * 那我这几轮改动全是空转 —— 这个假设必须先排除。
 *
 * 手写 zip 解析 + zlib.inflateRawSync，零第三方依赖。
 */
const fs = require('fs');
const zlib = require('zlib');

const apk = process.argv[2] || (process.env.TEMP + '\\xq_base.apk');
if (!fs.existsSync(apk)) { console.log('APK 不存在: ' + apk); process.exit(1); }

const buf = fs.readFileSync(apk);
console.log('APK: ' + (buf.length / 1024 / 1024).toFixed(1) + ' MB');

// ---- 定位 EOCD ----
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.log('未找到 EOCD'); process.exit(1); }

let total = buf.readUInt16LE(eocd + 10);
let cdOff = buf.readUInt32LE(eocd + 16);
if (cdOff === 0xFFFFFFFF || total === 0xFFFF) {
  for (let i = eocd - 20; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x07064b50) {
      const z = Number(buf.readBigUInt64LE(i + 8));
      if (buf.readUInt32LE(z) === 0x06064b50) {
        total = Number(buf.readBigUInt64LE(z + 32));
        cdOff = Number(buf.readBigUInt64LE(z + 48));
      }
      break;
    }
  }
}

// ---- 遍历中央目录，收集 js 条目 ----
const entries = [];
let pos = cdOff;
for (let n = 0; n < total && pos + 46 <= buf.length; n++) {
  if (buf.readUInt32LE(pos) !== 0x02014b50) break;
  const method   = buf.readUInt16LE(pos + 10);
  const compSize = buf.readUInt32LE(pos + 20);
  const rawSize  = buf.readUInt32LE(pos + 24);
  const nameLen  = buf.readUInt16LE(pos + 28);
  const extraLen = buf.readUInt16LE(pos + 30);
  const cmtLen   = buf.readUInt16LE(pos + 32);
  const lho      = buf.readUInt32LE(pos + 42);
  const name     = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
  if (/\.js$/i.test(name) && name.indexOf('www/') >= 0) {
    entries.push({ name, method, compSize, rawSize, lho });
  }
  pos += 46 + nameLen + extraLen + cmtLen;
}

console.log('www 下的 JS 文件: ' + entries.length + ' 个');
console.log('');

function extract(e) {
  // 读本地文件头拿到真实数据偏移
  if (buf.readUInt32LE(e.lho) !== 0x04034b50) return null;
  const nLen = buf.readUInt16LE(e.lho + 26);
  const xLen = buf.readUInt16LE(e.lho + 28);
  const off  = e.lho + 30 + nLen + xLen;
  const raw  = buf.slice(off, off + e.compSize);
  try {
    return e.method === 0 ? raw : zlib.inflateRawSync(raw);
  } catch (err) {
    return null;
  }
}

// 关键字：这些字符串能唯一区分我改的每一版
const marks = [
  { key: "_www/static/sounds/",       label: "相对路径 _www/（第6版，最新）" },
  { key: "file://",                   label: "file:// 前缀（第4版）" },
  { key: "convertLocalFileSystemURL", label: "路径换算调用（旧版逻辑）" },
  { key: "/static/sounds/",           label: "根相对路径 /static/" },
  { key: "resetPipeline",             label: "resetPipeline（第5版新增）" },
  { key: "setInnerAudioOption",       label: "全局音频配置" },
  { key: "dirIsFallback",             label: "兜底路径标记" },
  { key: "obeyMuteSwitch",            label: "静音开关属性" }
];

let found = false;
for (const e of entries) {
  const data = extract(e);
  if (!data) continue;
  const s = data.toString('utf8');
  if (s.indexOf('sounds') < 0) continue;

  found = true;
  console.log('=== ' + e.name + ' (' + (e.rawSize / 1024).toFixed(0) + ' KB) ===');
  for (const m of marks) {
    let c = 0, p = 0;
    while ((p = s.indexOf(m.key, p)) >= 0) { c++; p += m.key.length; }
    console.log('  ' + (c > 0 ? '[有] ' : '[无] ') + m.label +
      (c > 0 ? '  x' + c : ''));
  }

  // 把 sounds 附近的真实代码片段打出来，直接看路径怎么拼的
  console.log('');
  console.log('  --- 路径相关代码片段 ---');
  const re = /.{90}sounds.{90}/g;
  let m2, shown = 0;
  while ((m2 = re.exec(s)) !== null && shown < 6) {
    console.log('  ...' + m2[0].replace(/\s+/g, ' ') + '...');
    shown++;
  }
  console.log('');
}

if (!found) console.log('未在任何 JS 中找到 sounds 相关代码');
