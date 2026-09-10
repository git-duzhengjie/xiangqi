/**
 * 直接解析 APK（zip）的中央目录，列出所有 wav 条目。
 *
 * 为什么要做这一步：adb 已经排除了播放器和音量问题
 * （MediaPlayer 海量创建、全程零 error、媒体音量 30/100、未静音），
 * 但设备上 0 active tracks，说明根本没有音频数据被送去播放。
 * 那就必须回答一个最基础的问题：WAV 文件到底有没有被打进 APK？
 *
 * 发布包不可调试，run-as 与 su 都进不去私有目录，
 * 所以直接把 APK 拉下来手工解析 zip 中央目录，零依赖。
 */
const fs = require('fs');

const apk = process.env.TEMP + '\\xq_base.apk';
const buf = fs.readFileSync(apk);
console.log('APK 大小: ' + (buf.length / 1024 / 1024).toFixed(1) + ' MB');

// ---- 定位 EOCD（End of Central Directory）----
// 从尾部往前找签名 0x06054b50，最多回退 64KB + 22 字节
let eocd = -1;
const minPos = Math.max(0, buf.length - 65558);
for (let i = buf.length - 22; i >= minPos; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.log('未找到 EOCD，可能不是标准 zip'); process.exit(1); }

let total = buf.readUInt16LE(eocd + 10);
let cdSize = buf.readUInt32LE(eocd + 12);
let cdOff = buf.readUInt32LE(eocd + 16);

// zip64 兜底：字段为 0xFFFF/0xFFFFFFFF 时需要读 zip64 EOCD
if (cdOff === 0xFFFFFFFF || total === 0xFFFF) {
  for (let i = eocd - 20; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(i + 8));
      if (buf.readUInt32LE(z64) === 0x06064b50) {
        total = Number(buf.readBigUInt64LE(z64 + 32));
        cdOff = Number(buf.readBigUInt64LE(z64 + 48));
      }
      break;
    }
  }
}

console.log('中央目录条目总数: ' + total);
console.log('');

// ---- 遍历中央目录，收集条目 ----
const wavs = [];
const soundDirs = new Set();
let staticCount = 0;
let pos = cdOff;

for (let n = 0; n < total && pos + 46 <= buf.length; n++) {
  if (buf.readUInt32LE(pos) !== 0x02014b50) break;

  const method   = buf.readUInt16LE(pos + 10);
  const compSize = buf.readUInt32LE(pos + 20);
  const rawSize  = buf.readUInt32LE(pos + 24);
  const nameLen  = buf.readUInt16LE(pos + 28);
  const extraLen = buf.readUInt16LE(pos + 30);
  const cmtLen   = buf.readUInt16LE(pos + 32);
  const name     = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

  if (/\.wav$/i.test(name)) {
    wavs.push({ name, rawSize, compSize, method });
    const d = name.substring(0, name.lastIndexOf('/') + 1);
    soundDirs.add(d);
  }
  if (name.indexOf('static/') >= 0) staticCount++;

  pos += 46 + nameLen + extraLen + cmtLen;
}

console.log('=== APK 内 WAV 文件 ===');
if (wavs.length === 0) {
  console.log('!!! 一个 WAV 都没有 —— 音效资源根本没被打进包里 !!!');
} else {
  console.log('共 ' + wavs.length + ' 个：');
  console.log('');
  for (const w of wavs) {
    console.log('  ' + w.name);
    console.log('      原始 ' + w.rawSize + ' 字节, 压缩后 ' + w.compSize +
      ', 方法 ' + (w.method === 0 ? 'STORED(不压缩)' : 'DEFLATE(压缩)'));
  }
  console.log('');
  console.log('所在目录:');
  soundDirs.forEach(d => console.log('  ' + d));
}

console.log('');
console.log('包含 static/ 的条目数: ' + staticCount);
