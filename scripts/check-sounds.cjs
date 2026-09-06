/**
 * 音效系统校验（零依赖，手写 WAV 头解析）
 *
 * 上次桩类说谎的教训：能编过 ≠ 真能跑。所以这里不只看"文件在不在"，
 * 而是真的把每个 WAV 拆开验头、验数据长度、验是否静音。
 */
const fs = require('fs');
const path = require('path');

let bad = 0;
const ok = (c, m) => { console.log('  ' + (c ? '[OK]  ' : '[FAIL]') + ' ' + m); if (!c) bad++; };

// ---------- 1. WAV 文件真实性 ----------
console.log('=== 1. WAV 文件解析校验 ===');
const dir = 'app/static/sounds';
const expect = ['move', 'capture', 'select', 'check', 'win', 'lose', 'draw', 'undo', 'hint', 'click'];
let totalKB = 0;

for (const name of expect) {
  const fp = path.join(dir, name + '.wav');
  if (!fs.existsSync(fp)) { ok(false, name + '.wav 不存在'); continue; }
  const b = fs.readFileSync(fp);

  const riff = b.toString('ascii', 0, 4);
  const wave = b.toString('ascii', 8, 12);
  const fmtId = b.toString('ascii', 12, 16);
  const audioFmt = b.readUInt16LE(20);
  const ch = b.readUInt16LE(22);
  const sr = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  const dataId = b.toString('ascii', 36, 40);
  const dataLen = b.readUInt32LE(40);

  const headOk = riff === 'RIFF' && wave === 'WAVE' && fmtId === 'fmt ' && dataId === 'data';
  const fmtOk = audioFmt === 1 && ch === 1 && sr === 22050 && bits === 16;
  const lenOk = dataLen === b.length - 44 && dataLen > 0;

  // 峰值检查：全 0 就是哑的
  let peak = 0;
  for (let i = 44; i + 1 < b.length; i += 2) {
    const v = Math.abs(b.readInt16LE(i));
    if (v > peak) peak = v;
  }
  const audible = peak > 3000;   // 至少要有像样的音量

  const dur = (dataLen / 2 / sr).toFixed(2);
  const kb = (b.length / 1024).toFixed(1);
  totalKB += b.length / 1024;

  ok(headOk && fmtOk && lenOk && audible,
    (name + '.wav').padEnd(14) + dur + 's  ' + kb.padStart(5) + 'KB  peak=' +
    (peak / 32767 * 100).toFixed(0) + '%' +
    (headOk ? '' : ' [头损坏]') + (fmtOk ? '' : ' [格式错]') +
    (lenOk ? '' : ' [长度错]') + (audible ? '' : ' [无声!]'));
}
console.log('  合计 ' + totalKB.toFixed(1) + ' KB');

// ---------- 2. sound.js 与文件清单一致 ----------
console.log('');
console.log('=== 2. sound.js 引用一致性 ===');
const sjs = fs.readFileSync('app/utils/sound.js', 'utf8');
const refs = [...sjs.matchAll(/(\w+):\s*'([\w-]+\.wav)'/g)].map(m => m[2]);
ok(refs.length === expect.length, 'SOUND_FILES 声明 ' + refs.length + ' 项');
for (const f of refs) {
  ok(fs.existsSync(path.join(dir, f)), '引用的 ' + f + ' 存在于磁盘');
}
ok(sjs.includes('destroy()'), '提供 destroy（防原生资源泄漏）');
ok(sjs.includes('seek(0)'), '复用实例前 seek(0)（否则第二次播放无声）');
ok(sjs.includes('obeyMuteSwitch'), '跟随系统静音键');
ok(/catch\s*\(/.test(sjs), '异常兜底存在');

// ---------- 3. game.js 触发点 ----------
console.log('');
console.log('=== 3. game.js 触发点 ===');
const g = fs.readFileSync('app/pages/game/game.js', 'utf8');
const hooks = [
  ['sound.preload()', '预加载'],
  ['sound.destroy()', '页面卸载释放'],
  ['sound.playSelect()', '选中棋子'],
  ['sound.playMove(isCapture)', '走子/吃子'],
  ['sound.playCheck()', '将军'],
  ['sound.playResult(result)', '胜负和'],
  ['sound.playUndo()', '悔棋'],
  ['sound.playHint()', '提示'],
  ['sound.playClick()', '按钮'],
  ['sound.toggle()', '开关切换']
];
for (const [k, label] of hooks) ok(g.includes(k), label);

// 关键顺序：isCapture 必须在棋盘被改动前算出来
const iCap = g.indexOf('const isCapture');
const iApply = g.indexOf('this.board = applyMoveToBoard(this.board, from, to)');
ok(iCap > 0 && iCap < iApply, 'isCapture 在 applyMoveToBoard 之前求值');

// ---------- 4. vue / css ----------
console.log('');
console.log('=== 4. 界面开关 ===');
const v = fs.readFileSync('app/pages/game/game.vue', 'utf8');
const c = fs.readFileSync('app/pages/game/game.css', 'utf8');
ok(v.includes('toggleSound'), 'vue 绑定 toggleSound');
ok(v.includes('soundOn ?'), 'vue 图标随状态切换');
ok(c.includes('.btn-sound'), 'css 有 .btn-sound');
ok(/\.title\s*\{[^}]*flex:\s*1/.test(c), 'title 加 flex:1（顶栏多一个元素后仍居中）');
ok(g.includes('soundOn: true'), 'data 有 soundOn');
ok(g.includes('sound.isEnabled()'), 'onLoad 同步持久化状态');

// ---------- 5. 括号配平 ----------
console.log('');
console.log('=== 5. 语法自检 ===');
for (const [f, label] of [['app/utils/sound.js', 'sound.js'], ['app/pages/game/game.js', 'game.js']]) {
  const s = fs.readFileSync(f, 'utf8');
  let d = 0, p = 0;
  for (const ch of s) {
    if (ch === '{') d++; else if (ch === '}') d--;
    if (ch === '(') p++; else if (ch === ')') p--;
  }
  ok(d === 0 && p === 0, label + ' 括号配平 {}=' + d + ' ()=' + p);
}

console.log('');
console.log(bad === 0 ? '[PASS] 音效系统校验全部通过' : '[FAIL] ' + bad + ' 项未通过');
process.exit(bad === 0 ? 0 : 1);
