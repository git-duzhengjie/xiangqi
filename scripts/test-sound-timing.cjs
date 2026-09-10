/**
 * 用桩环境模拟 sound.js 的真实时序，验证首次启动能否出声。
 *
 * 之前两次修复都"看着对"但上机还是没声，原因是只做了静态字符串校验，
 * 没有真正跑一遍状态流转。这里把 uni / plus 都桩掉，
 * 按真机的三种时序各跑一遍，直接断言最终有没有用正确路径播出声音。
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync('app/utils/sound.js', 'utf8');

function runScenario(name, opts) {
  const log = [];
  const created = [];   // 记录每个实例的 src
  const played = [];    // 记录真正 play 的 src

  // ---- 桩：plus ----
  let plusReady = opts.plusReadyAtStart;
  const plusStub = {
    get io() {
      if (!plusReady) return undefined;
      return {
        convertLocalFileSystemURL: (p) => '/data/app/xiangqi/' + p.replace('_www/', '')
      };
    }
  };

  // ---- 桩：uni ----
  let optionOk = opts.audioOptionWorksAtStart;
  const store = {};
  const uniStub = {
    getStorageSync: (k) => store[k] !== undefined ? store[k] : '',
    setStorageSync: (k, v) => { store[k] = v; },
    setInnerAudioOption: opts.hasSetInnerAudioOption
      ? (cfg) => {
          if (!optionOk) {
            log.push('setInnerAudioOption 调用但失败');
            if (cfg.fail) cfg.fail({ errMsg: 'not ready' });
            return;
          }
          log.push('setInnerAudioOption 成功 obeyMuteSwitch=' + cfg.obeyMuteSwitch);
        }
      : undefined,
    createInnerAudioContext: () => {
      const ctx = {
        _src: '', loop: false, autoplay: false, volume: 1,
        set src(v) { this._src = v; },
        get src() { return this._src; },
        play() { played.push(this._src); },
        stop() {}, destroy() {}, seek() {},
        onError() {}, onCanplay() {}, onPlay() {}, onEnded() {}
      };
      created.push(ctx);
      return ctx;
    }
  };

  // ---- 加载模块（把 export default 换成赋值给 module.exports）----
  const code = SRC
    .replace(/export default new SoundService\(\)/, 'module.exports = new SoundService()')
    .replace(/\/\/ #ifdef[\s\S]*?\/\/ #endif/g, m => m);  // 保留

  const mod = { exports: {} };
  const fn = new Function('uni', 'plus', 'module', 'console', 'document', 'setTimeout', code);
  const consoleStub = { log(){}, warn(){}, error(){} };
  fn(uniStub, plusStub, mod, consoleStub, { addEventListener(){} }, (f) => f);
  const sound = mod.exports;

  // ---- 时序 1：对局页 onLoad 调 preload（此时可能 plus 未就绪）----
  sound.preload();
  log.push('after preload#1 dir=' + sound.dir + ' fallback=' + sound.dirIsFallback + ' ready=' + sound.ready);

  // ---- 时序 2：plusready 触发（App.vue 的预热）----
  if (opts.plusBecomesReady) {
    plusReady = true;
    optionOk = true;
    sound.preload();
    log.push('after preload#2 dir=' + sound.dir + ' fallback=' + sound.dirIsFallback + ' ready=' + sound.ready);
  }

  // ---- 时序 3：用户点棋子，播放音效 ----
  played.length = 0;
  sound.play('move');

  const ok = played.length > 0 && played[0].indexOf('file://') === 0;

  console.log('===== ' + name + ' =====');
  log.forEach(l => console.log('  ' + l));
  console.log('  播放的 src: ' + (played[0] || '(无)'));
  console.log('  结果: ' + (ok ? '[PASS] 有声，且路径正确' : '[FAIL] 无声或路径错误'));
  console.log('');
  return ok;
}

let allOk = true;

// 场景 A：最糟情况 —— preload 时 plus 未就绪、音频配置也没生效，之后才就绪
allOk &= runScenario('A. plus 延迟就绪（真机最常见，即老板遇到的情况）', {
  plusReadyAtStart: false,
  audioOptionWorksAtStart: false,
  hasSetInnerAudioOption: true,
  plusBecomesReady: true
});

// 场景 B：plus 一开始就绪（理想情况）
allOk &= runScenario('B. plus 启动即就绪', {
  plusReadyAtStart: true,
  audioOptionWorksAtStart: true,
  hasSetInnerAudioOption: true,
  plusBecomesReady: false
});

// 场景 C：基座不支持 setInnerAudioOption，但 plus 会就绪
allOk &= runScenario('C. 基座无 setInnerAudioOption', {
  plusReadyAtStart: false,
  audioOptionWorksAtStart: false,
  hasSetInnerAudioOption: false,
  plusBecomesReady: true
});

// 场景 D：plus 始终不就绪（极端兜底，只要不崩就算过）
runScenario('D. plus 始终不就绪（仅验证不崩溃）', {
  plusReadyAtStart: false,
  audioOptionWorksAtStart: false,
  hasSetInnerAudioOption: true,
  plusBecomesReady: false
});

console.log(allOk ? '★ 关键场景 A/B/C 全部通过' : '★ 存在失败场景，需继续修');
process.exit(allOk ? 0 : 1);
