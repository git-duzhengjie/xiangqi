/**
 * 生成象棋 App 所需的全部音效（WAV, 22050Hz 16bit 单声道）
 *
 * 为什么自己合成而不是下载：
 *   1. 权重那次教训 —— 运行时依赖网络资源会带来不确定性；音效属于核心体验，
 *      必须随包内置。
 *   2. 网上素材版权状况普遍不清晰，上架 App Store 有风险。
 *   3. 象棋音效本质就是短促打击声 + 简单音调，合成完全够用，且体积可控
 *      （全部 8 个文件加起来只有几十 KB）。
 *
 * 零第三方依赖，只用 Node 内置 Buffer 手写 WAV 头。
 */
const fs = require('fs');
const path = require('path');

const SR = 22050;          // 采样率
const OUT = path.join('app', 'static', 'sounds');

// ---------- WAV 封装 ----------
function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);        // fmt chunk size
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(1, 22);         // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);    // byte rate
  buf.writeUInt16LE(2, 32);         // block align
  buf.writeUInt16LE(16, 34);        // bits
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const len = sec => Math.floor(SR * sec);
const env = (i, n, atk, dec) => {
  // 简单 AD 包络：atk/dec 为占比
  const t = i / n;
  if (t < atk) return t / atk;
  const d = (t - atk) / (1 - atk);
  return Math.pow(1 - d, dec);
};

/** 噪声冲击 —— 模拟棋子落在木板上的"哒" */
function woodHit(dur, tone, bright, vol) {
  const n = len(dur);
  const s = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const e = env(i, n, 0.002, 4.5);
    // 噪声成分（打击感）
    const noise = (Math.random() * 2 - 1);
    lp += (noise - lp) * bright;         // 一阶低通，控制"闷/脆"
    // 木头共鸣（两个衰减正弦）
    const t = i / SR;
    const body =
      Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * 38) * 0.55 +
      Math.sin(2 * Math.PI * tone * 1.94 * t) * Math.exp(-t * 55) * 0.28;
    s[i] = (lp * 0.75 + body) * e * vol;
  }
  return s;
}

/** 纯音序列 —— 用于提示/胜负等旋律型音效 */
function tones(notes, vol) {
  const total = notes.reduce((a, x) => a + x.d, 0);
  const n = len(total);
  const s = new Float32Array(n);
  let off = 0;
  for (const nt of notes) {
    const ln = len(nt.d);
    for (let i = 0; i < ln && off + i < n; i++) {
      const t = i / SR;
      const e = env(i, ln, 0.06, 2.2);
      // 基频 + 八度泛音，听感更饱满
      const w =
        Math.sin(2 * Math.PI * nt.f * t) * 0.62 +
        Math.sin(2 * Math.PI * nt.f * 2 * t) * 0.24 +
        Math.sin(2 * Math.PI * nt.f * 3 * t) * 0.10;
      s[off + i] += w * e * vol * (nt.v == null ? 1 : nt.v);
    }
    off += ln;
  }
  return s;
}

/** 混合两段（长度取较长） */
function mix(a, b) {
  const n = Math.max(a.length, b.length);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = (i < a.length ? a[i] : 0) + (i < b.length ? b[i] : 0);
  }
  return s;
}

// ---------- 各音效定义 ----------
// 音名频率
const F = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00, C6: 1046.50,
  G3: 196.00, C3: 130.81, E3: 164.81, A3: 220.00
};

const defs = {
  // 走子：清脆的木质落子声
  move: () => woodHit(0.13, 520, 0.50, 1.0),

  // 吃子：更重、更闷，带一点低频冲击，体现"打击"
  capture: () => {
    const hit = woodHit(0.22, 340, 0.45, 1.0);
    const low = tones([{ f: 165, d: 0.10 }], 0.45);
    return mix(hit, low);
  },

  // 选中棋子：极轻的一声"嗒"，不能吵
  select: () => woodHit(0.055, 1100, 0.75, 0.45),

  // 将军：短促上行两音，带紧张感
  check: () => tones([
    { f: F.A4, d: 0.11 },
    { f: F.E5, d: 0.20 }
  ], 0.42),

  // 胜利：上行大三和弦琶音
  win: () => tones([
    { f: F.C5, d: 0.13 },
    { f: F.E5, d: 0.13 },
    { f: F.G5, d: 0.13 },
    { f: F.C6, d: 0.34 }
  ], 0.40),

  // 失败：下行小调，低沉
  lose: () => tones([
    { f: F.A4, d: 0.17 },
    { f: F.F4, d: 0.17 },
    { f: F.C4, d: 0.20 },
    { f: F.A3, d: 0.40 }
  ], 0.38),

  // 和棋：平稳两音，无倾向性
  draw: () => tones([
    { f: F.G4, d: 0.20 },
    { f: F.C5, d: 0.32 }
  ], 0.34),

  // 悔棋：倒放感的下行短音
  undo: () => tones([
    { f: F.E5, d: 0.08 },
    { f: F.C5, d: 0.14 }
  ], 0.30),

  // 提示：明亮的两声"叮"
  hint: () => tones([
    { f: F.E5, d: 0.09 },
    { f: 0, d: 0.03, v: 0 },
    { f: F.A5, d: 0.20 }
  ], 0.32),

  // 按钮点击：极短的轻响
  click: () => woodHit(0.04, 1400, 0.85, 0.40)
};

// ---------- 输出 ----------
fs.mkdirSync(OUT, { recursive: true });
console.log('生成音效 -> ' + OUT);
console.log('');

let total = 0;
const made = [];
for (const [name, fn] of Object.entries(defs)) {
  let s = fn();
  // 按 RMS（有效值）归一，而不是按峰值归一。
  //
  // 历史教训：这里原先是峰值归一到 0.95。峰值确实对齐得很整齐，
  // 但实测 RMS 差了整整 8 dB：
  //   capture / voice_check / move   RMS 约 -19 dB，高能量样本占比仅 6%
  //   check / undo / win / draw      RMS 约 -12 dB，高能量样本占比 31%
  // 因为木头敲击类是极短瞬态，能量集中在开头几毫秒，峰值虽高但总能量很小；
  // 持续乐音则相反。人耳感知的响度取决于 RMS，不是峰值，
  // 所以峰值对齐之后，走子/吃子/选择/点击这些短音听起来明显偏小。
  //
  // 这也是之前反复调各音效 vol 参数却毫无效果的原因 ——
  // 不管上游给多大增益，最后都被这段峰值归一化抹平成同一个峰值。
  //
  // 现在改为两步：
  //   1. 按 RMS 缩放到统一目标响度，保证主观音量一致
  //   2. 峰值保护：只有超过 0.99 才等比压回，避免削波爆音
  // 峰值保护会让极端瞬态音的 RMS 略低于目标，这是可接受的物理上限。
  let sumSq = 0;
  for (const v of s) sumSq += v * v;
  const rms = Math.sqrt(sumSq / s.length);

  if (rms > 0.0001) {
    // 目标 RMS = 0.20（约 -14 dBFS），全部音效统一到这个响度。
    const targetRms = 0.20;
    const gain = targetRms / rms;
    for (let i = 0; i < s.length; i++) s[i] = s[i] * gain;

    // 放大后先看峰值超了多少。
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));

    const ceiling = 0.99;
    if (peak > ceiling) {
      // 这里不能简单等比压回。
      //
      // 瞬态音（木头敲击）的波峰因数 peak/rms 高达 8~9 倍，
      // 要把 RMS 提到 0.20，峰值就得冲到 1.7 以上。若等比压回 0.99，
      // RMS 会被一起拉低回 -18 dB 左右，等于白干 —— 这正是上一版
      // voice_check 和 capture 仍然偏小 3 dB 的原因。
      //
      // 改用 tanh 软限幅：尖峰被平滑地压进上限，而中低幅度部分
      // 几乎不受影响，于是整体 RMS 能保住。tanh 连续可导，
      // 不会像 clamp 那样把波形削成方波产生爆音。
      // 尖峰只占几毫秒，轻微饱和人耳听不出失真，
      // 这也是真实打击乐器录音与唱片母带处理的常规做法。
      //
      // drive 控制饱和强度：峰值超得越多就压得越狠。
      const drive = peak / ceiling;
      for (let i = 0; i < s.length; i++) {
        s[i] = ceiling * Math.tanh(s[i] * drive / ceiling);
      }

      // 软限幅后再校一次 RMS。tanh 会带来少量能量损失，
      // 补一次增益让最终响度回到目标，同时用 clamp 兜住极端值。
      let sq2 = 0;
      for (const v of s) sq2 += v * v;
      const rms2 = Math.sqrt(sq2 / s.length);
      if (rms2 > 0.0001 && rms2 < targetRms) {
        const trim = Math.min(targetRms / rms2, 1.25);  // 补偿上限 1.25 倍，避免过度饱和
        for (let i = 0; i < s.length; i++) {
          s[i] = Math.max(-ceiling, Math.min(ceiling, s[i] * trim));
        }
      }
    }
  }
  // 收尾淡出，消除爆音
  const fade = Math.min(len(0.012), Math.floor(s.length * 0.2));
  for (let i = 0; i < fade; i++) {
    s[s.length - 1 - i] *= i / fade;
  }
  const wav = toWav(s);
  const fp = path.join(OUT, name + '.wav');
  fs.writeFileSync(fp, wav);
  total += wav.length;
  made.push(name);
  console.log('  ' + (name + '.wav').padEnd(16) +
    (s.length / SR).toFixed(3) + 's   ' +
    (wav.length / 1024).toFixed(1) + ' KB');
}

console.log('');
console.log('  共 ' + made.length + ' 个，合计 ' + (total / 1024).toFixed(1) + ' KB');
