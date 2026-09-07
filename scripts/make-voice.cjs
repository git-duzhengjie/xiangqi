/**
 * 把 Windows TTS 生成的人声 WAV 处理成与其余音效一致的规格：
 *   22050Hz / 16bit / 单声道 / 裁掉首尾静音 / 归一化
 *
 * 为什么要处理：TTS 默认输出多为 16000Hz 或 22050Hz，且前后带大段静音，
 * 直接用会导致"点了半天才出声"，而采样率不一致在部分机型上也容易出问题。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join('app', 'static', 'sounds', '_voice_raw');
const OUT = path.join('app', 'static', 'sounds');
const TARGET_SR = 22050;

/** 解析 WAV，返回 {sampleRate, channels, bits, samples(Float32 已混单声道)} */
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('非 RIFF');
  let pos = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const sz = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(pos + 8),
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22)
      };
    } else if (id === 'data') { dataOff = pos + 8; dataLen = sz; }
    pos += 8 + sz + (sz % 2);
  }
  if (!fmt || !dataOff) throw new Error('缺少 fmt/data');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error('仅支持 16bit PCM，当前 fmt=' + fmt.format + ' bits=' + fmt.bits);

  const frames = Math.floor(dataLen / (2 * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      sum += buf.readInt16LE(dataOff + (i * fmt.channels + c) * 2) / 32768;
    }
    out[i] = sum / fmt.channels;   // 混为单声道
  }
  return { sampleRate: fmt.sampleRate, samples: out };
}

/** 线性插值重采样 */
function resample(src, from, to) {
  if (from === to) return src;
  const ratio = from / to;
  const n = Math.floor(src.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const f = p - i0;
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}

/** 裁掉首尾静音（阈值以下视为静音），并留一点余量避免削掉气声 */
function trimSilence(s, thr = 0.012) {
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < thr) a++;
  while (b > a && Math.abs(s[b]) < thr) b--;
  const pad = Math.floor(TARGET_SR * 0.012);
  a = Math.max(0, a - pad);
  b = Math.min(s.length - 1, b + pad);
  return s.slice(a, b + 1);
}

/** 归一化到目标峰值 */
function normalize(s, target = 0.95) {
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.001) {
    const g = target / peak;
    for (let i = 0; i < s.length; i++) s[i] = Math.max(-1, Math.min(1, s[i] * g));
  }
  return s;
}

/** 尾部淡出，避免咔哒声 */
function fadeOut(s, ms = 15) {
  const n = Math.min(Math.floor(TARGET_SR * ms / 1000), Math.floor(s.length * 0.3));
  for (let i = 0; i < n; i++) {
    s[s.length - 1 - i] *= i / n;
  }
  return s;
}

function toWav(samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

if (!fs.existsSync(SRC)) { console.error('缺少原始语音目录: ' + SRC); process.exit(1); }

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.wav'));
console.log('处理人声 -> ' + OUT);
for (const f of files) {
  const raw = fs.readFileSync(path.join(SRC, f));
  const { sampleRate, samples } = parseWav(raw);
  let s = resample(samples, sampleRate, TARGET_SR);
  s = trimSilence(s);
  s = normalize(s, 0.95);
  s = fadeOut(s);
  const out = toWav(s, TARGET_SR);
  fs.writeFileSync(path.join(OUT, f), out);
  const dur = (s.length / TARGET_SR).toFixed(3);
  console.log('  ' + f.padEnd(20) + sampleRate + 'Hz -> ' + TARGET_SR + 'Hz  ' + dur + 's  ' + out.length + 'B');
}
console.log('完成');
