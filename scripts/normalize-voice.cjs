/**
 * 把 voice_*.wav 归一到与其他音效一致的响度。
 *
 * 背景：voice_check / voice_capture 这两个语音文件并不是
 * make-sounds.cjs 生成的（该脚本的 defs 里没有它们，只在注释中被提及），
 * 所以重跑生成脚本时它们完全没被处理，voice_check 一直停在 -19.4 dB，
 * 比其他音效小了近 6 dB。
 *
 * 这里对它们单独做一次和 make-sounds.cjs 完全相同的处理：
 * RMS 归一到 0.20 + tanh 软限幅 + 收尾淡出。
 * 直接读写 WAV 的 PCM 数据，不重新编码，保持原有采样率与格式。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'app/static/sounds';
const TARGET_RMS = 0.20;
const CEILING = 0.99;

function process(file) {
  const buf = fs.readFileSync(file);

  // 定位 data 段与格式信息，不假设固定 44 字节头
  let pos = 12, dataOff = -1, dataLen = 0, rate = 22050;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12);
    else if (id === 'data') { dataOff = pos + 8; dataLen = size; break; }
    pos += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error('未找到 data 段: ' + file);

  const n = Math.floor(dataLen / 2);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(dataOff + i * 2) / 32768;

  // ---- 记录处理前的状态 ----
  let sq = 0, peak0 = 0;
  for (const v of s) { sq += v * v; const a = Math.abs(v); if (a > peak0) peak0 = a; }
  const rms0 = Math.sqrt(sq / n);

  if (rms0 < 0.0001) { console.log('  跳过（近似静音）'); return null; }

  // ---- 与 make-sounds.cjs 完全一致的归一流程 ----
  const gain = TARGET_RMS / rms0;
  for (let i = 0; i < n; i++) s[i] *= gain;

  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));

  if (peak > CEILING) {
    // tanh 软限幅：压平尖峰但保住整体能量，避免等比压回导致 RMS 一起掉
    const drive = peak / CEILING;
    for (let i = 0; i < n; i++) s[i] = CEILING * Math.tanh(s[i] * drive / CEILING);

    let sq2 = 0;
    for (const v of s) sq2 += v * v;
    const rms2 = Math.sqrt(sq2 / n);
    if (rms2 > 0.0001 && rms2 < TARGET_RMS) {
      const trim = Math.min(TARGET_RMS / rms2, 1.25);
      for (let i = 0; i < n; i++) s[i] = Math.max(-CEILING, Math.min(CEILING, s[i] * trim));
    }
  }

  // 收尾淡出，消除爆音
  const fade = Math.min(Math.floor(rate * 0.012), Math.floor(n * 0.2));
  for (let i = 0; i < fade; i++) s[n - 1 - i] *= i / fade;

  // ---- 写回原文件，只改 PCM 数据区 ----
  const out = Buffer.from(buf);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, s[i]));
    out.writeInt16LE(Math.round(v * 32767), dataOff + i * 2);
  }
  fs.writeFileSync(file, out);

  let sq3 = 0, peak3 = 0;
  for (const v of s) { sq3 += v * v; const a = Math.abs(v); if (a > peak3) peak3 = a; }
  const rms3 = Math.sqrt(sq3 / n);

  return {
    rms0, rms3, peak0, peak3,
    db0: 20 * Math.log10(rms0),
    db3: 20 * Math.log10(rms3)
  };
}

const targets = fs.readdirSync(DIR)
  .filter(f => f.startsWith('voice_') && f.endsWith('.wav'))
  .sort();

console.log('归一 voice_*.wav 到 RMS ' + TARGET_RMS + '（与其他音效一致）');
console.log('');

for (const f of targets) {
  console.log(f + ':');
  const r = process(path.join(DIR, f));
  if (r) {
    console.log('  RMS  ' + r.rms0.toFixed(4) + ' -> ' + r.rms3.toFixed(4) +
      '   (' + r.db0.toFixed(1) + ' dB -> ' + r.db3.toFixed(1) + ' dB，' +
      '提升 ' + (r.db3 - r.db0).toFixed(1) + ' dB)');
    console.log('  峰值 ' + r.peak0.toFixed(3) + ' -> ' + r.peak3.toFixed(3));
  }
}
console.log('');
console.log('完成');
