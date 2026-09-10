/**
 * 验证音效链路在各种启动时序下都能正常建池并播放。
 *
 * 断言标准随设计变更而更新：不再校验某一种具体路径写法。
 *
 * 原因：此前六次修复，每次都基于某种理论断定「哪种写法是对的」，
 * 然后全局只用那一种 —— 第4版断定必须带 file:// 前缀，
 * 第6版又根据「资源在 APK assets 内部」断定必须用相对路径，
 * 两次都没解决问题。本轮已从设备拉取 APK 反解 app-service.js，
 * 确认打包代码确实是最新版，所以不是部署问题，是判断本身站不住。
 *
 * 现在改为运行时并行探测所有候选写法，以能否真正播放为唯一判据，
 * 因此测试只校验机制：候选列表是否生成、播放是否拿到候选中的路径、
 * 文件名是否正确、重置与开关行为是否正常。
 */
const fs = require('fs');
const SRC = fs.readFileSync('app/utils/sound.js', 'utf8');

function build(opts) {
  const played = [];
  const optionCalls = [];
  let plusReady = opts.plusReadyAtStart;
  let optionWorks = opts.optionWorksAtStart;

  const plusStub = {
    get io() {
      if (!plusReady) return undefined;
      return { convertLocalFileSystemURL: (p) => '/data/app/xiangqi/' + p.replace('_www/', '') };
    }
  };
  const store = {};
  const uniStub = {
    getStorageSync: (k) => store[k] !== undefined ? store[k] : '',
    setStorageSync: (k, v) => { store[k] = v; },
    setInnerAudioOption: (cfg) => {
      if (!optionWorks) {
        optionCalls.push('fail');
        if (cfg.fail) cfg.fail({ errMsg: 'audio module not ready' });
        return;
      }
      optionCalls.push('ok:obeyMuteSwitch=' + cfg.obeyMuteSwitch);
    },
    createInnerAudioContext: () => ({
      _src: '', loop: false, autoplay: false, volume: 1, obeyMuteSwitch: true,
      set src(v) { this._src = v; }, get src() { return this._src; },
      play() { played.push(this._src); },
      stop() {}, destroy() {}, seek() {},
      onError() {}, onCanplay() {}, onPlay() {}, onEnded() {}
    })
  };

  const code = SRC.replace(/export default new SoundService\(\)/, 'module.exports = new SoundService()');
  const mod = { exports: {} };
  const fn = new Function('uni', 'plus', 'module', 'console', 'document', 'setTimeout', code);
  fn(uniStub, plusStub, mod, { log(){}, warn(){}, error(){} }, { addEventListener(){} }, (f) => f);

  return {
    sound: mod.exports,
    played,
    optionCalls,
    makeReady: () => { plusReady = true; optionWorks = true; }
  };
}

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  [OK]   ' + label); }
  else { fail++; console.log('  [FAIL] ' + label); }
}

console.log('===== 场景 1：plus 延迟就绪（本次故障场景）=====');
{
  const env = build({ plusReadyAtStart: false, optionWorksAtStart: false });

  // 对局页 onLoad
  env.sound.preload();
  console.log('  preload 后: dir=' + env.sound.dir + ' fallback=' + env.sound.dirIsFallback);
  env.played.length = 0;
  env.sound.play('move');
  const beforeSrc = env.played[0] || '(无)';
  console.log('  重置前播放: ' + beforeSrc);

  // plus 就绪，App.vue 自动执行重置
  env.makeReady();
  env.sound.resetPipeline();
  console.log('  重置后: dir=' + env.sound.dir + ' fallback=' + env.sound.dirIsFallback + ' ready=' + env.sound.ready);
  console.log('  音频配置调用记录: ' + env.optionCalls.join(' -> '));

  env.played.length = 0;
  env.sound.play('move');
  const afterSrc = env.played[0] || '(无)';
  console.log('  重置后播放: ' + afterSrc);

  // 不再断言某一种具体写法。
  //
  // 历次修复的教训：到底哪种路径能被播放器打开，取决于基座版本、
  // Android 版本、资源是否被解压到私有目录等多个变量。我先后断定过
  // 「必须带 file://」和「必须是相对路径」，两次都错。
  // 现在改为运行时并行探测所有候选、以能否播放为唯一判据，
  // 所以测试也只校验机制本身：有路径、在候选集合内、文件名正确。
  const cands = env.sound.candidates || [];
  check('已生成候选路径列表', cands.length > 0);
  check('播放时拿到了非空路径', afterSrc.length > 0);
  check('播放路径以候选目录之一开头',
    cands.some(c => afterSrc.indexOf(c) === 0));
  check('播放路径指向正确的文件名', /move\.wav$/.test(afterSrc));
  check('重置后 dirIsFallback 为 false', env.sound.dirIsFallback === false);
  check('重置后 ready 为 true', env.sound.ready === true);
  check('音频配置最终设置成功', env.optionCalls.some(c => c.indexOf('ok:') === 0));
  check('obeyMuteSwitch 设为 false', env.optionCalls.some(c => c.indexOf('obeyMuteSwitch=false') >= 0));
}

console.log('');
console.log('===== 场景 2：resetPipeline 幂等性（会被调 3 次）=====');
{
  const env = build({ plusReadyAtStart: true, optionWorksAtStart: true });
  env.sound.preload();
  env.sound.resetPipeline();
  env.sound.resetPipeline();
  env.sound.resetPipeline();
  env.played.length = 0;
  env.sound.play('move');
  check('连续重置 3 次后依然有声', env.played.length > 0);
  check('路径依然指向正确文件', /move\.wav$/.test(env.played[0] || ''));
}

console.log('');
console.log('===== 场景 3：重置不影响用户的开关偏好 =====');
{
  const env = build({ plusReadyAtStart: true, optionWorksAtStart: true });
  env.sound.setEnabled(false);      // 用户主动关掉音效
  env.sound.resetPipeline();
  check('重置后仍保持关闭状态', env.sound.isEnabled() === false);
  env.played.length = 0;
  env.sound.play('move');
  check('关闭状态下确实不播放', env.played.length === 0);

  env.sound.setEnabled(true);
  env.played.length = 0;
  env.sound.play('move');
  check('重新打开后正常播放', env.played.length > 0);
}

console.log('');
console.log('===== 场景 4：plus 始终不就绪（不能崩）=====');
{
  let crashed = false;
  try {
    const env = build({ plusReadyAtStart: false, optionWorksAtStart: false });
    env.sound.preload();
    env.sound.resetPipeline();
    env.sound.resetPipeline();
    env.sound.play('move');
  } catch (e) { crashed = true; console.log('  异常: ' + e.message); }
  check('不抛异常', !crashed);
}

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log(fail === 0 ? '★ 全部通过' : '★ 存在失败');
process.exit(fail === 0 ? 0 : 1);
