/**
 * 量化 10 个音效的实际响度，找出「听起来太小」的到底是哪几个。
 *
 * 为什么不能只看 vol 参数：make-sounds.cjs 末尾有一段把峰值归一化到
 * 0.95 的处理，会把各音效 vol 参数的差异基本抹平。所以 move 的 vol
 * 明明是 1.0（和 capture 相同），听起来却小得多。
 *
 * 人耳感知的响度取决于 RMS（有效值）而非峰值：
 *   - 木头敲击类是极短的瞬态，峰值很高但能量集中在几毫秒内，RMS 很低
 *   - 持续的乐音峰值相同时 RMS 高得多，所以显得响
 * 这里同时输出峰值、RMS 和 dBFS，用 capture / check 作为基准来对比。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'app/static/sounds';

function readWav(file) {
  const buf = fs.readFileSync(file);
  // 遍历 chunk 找 data 段，不假设固定 44 字节头
  let pos = 12, dataOff = -1, dataLen = 0, fmt = {};
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt.channels = buf.readUInt16LE(pos + 10);
      fmt.rate = buf.readUInt32LE(pos + 12);
      fmt.bits = buf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      dataOff = pos + 8; dataLen = size; break;
    }
    pos += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error('未找到 data 段: ' + file);

  const n = Math.floor(dataLen / 2);
  let peak = 0, sumSq = 0;
  // 同时统计「高能量样本占比」，用来区分瞬态与持续音
  let loudCount = 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(dataOff + i * 2) / 32768;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    if (a > 0.2) loudCount++;
  }
  const rms = Math.sqrt(sumSq / n);
  return {
    dur: n / (fmt.rate || 22050),
    peak, rms,
    peakDb: 20 * Math.log10(peak || 1e-9),
    rmsDb: 20 * Math.log10(rms || 1e-9),
    loudRatio: loudCount / n
  };
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.wav')).sort();
const rows = files.map(f => {
  const r = readWav(path.join(DIR, f));
  return { name: f.replace('.wav', ''), ...r };
});

// 以 capture / check 的 RMS 作为「够响」的基准
const ref = rows.filter(r => r.name === 'capture' || r.name === 'check');
const refRms = ref.reduce((a, b) => a + b.rms, 0) / ref.length;

console.log('基准 = capture 与 check 的平均 RMS = ' + refRms.toFixed(4) +
  ' (' + (20 * Math.log10(refRms)).toFixed(1) + ' dBFS)');
console.log('');
console.log('音效        时长   峰值   峰值dB   RMS     RMS_dB   高能占比  相对基准');
console.log('--------------------------------------------------------------------------');

rows.sort((a, b) => a.rms - b.rms);
for (const r of rows) {
  const rel = 20 * Math.log10(r.rms / refRms);
  const flag = rel < -4 ? '  <== 偏小' : (rel < -2 ? '  <- 略小' : '');
  console.log(
    r.name.padEnd(11) +
    r.dur.toFixed(3).padStart(5) + ' ' +
    r.peak.toFixed(3).padStart(6) + ' ' +
    r.peakDb.toFixed(1).padStart(7) + ' ' +
    r.rms.toFixed(4).padStart(7) + ' ' +
    r.rmsDb.toFixed(1).padStart(8) + ' ' +
    (r.loudRatio * 100).toFixed(1).padStart(7) + '% ' +
    (rel >= 0 ? '+' : '') + rel.toFixed(1) + ' dB' + flag
  );
}

console.log('');
console.log('说明：峰值几乎都被归一化到 0.95 左右，所以峰值一致但 RMS 差很多，');
console.log('      RMS 低的就是老板反馈「声音太小」的那几个。');
