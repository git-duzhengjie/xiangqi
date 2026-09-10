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
  const playedCtx = [];    // 实际调用过 play 的实例
  const createdCtx = [];   // 所有被创建的实例
  const destroyCount = { n: 0 };
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
    createInnerAudioContext: () => {
      const ctx = {
        _src: '', loop: false, autoplay: false, volume: 1, obeyMuteSwitch: true,
        _destroyed: false,
        _endedCb: null,
        set src(v) { this._src = v; }, get src() { return this._src; },
        play() { played.push(this._src); playedCtx.push(ctx); },
        stop() {}, seek() {},
        destroy() { this._destroyed = true; destroyCount.n++; },
        onError() {}, onCanplay() {}, onPlay() {},
        onEnded(cb) { ctx._endedCb = cb; }
      };
      createdCtx.push(ctx);
      return ctx;
    }
  };

  const code = SRC.replace(/export default new SoundService\(\)/, 'module.exports = new SoundService()');
  const mod = { exports: {} };
  const fn = new Function('uni', 'plus', 'module', 'console', 'document', 'setTimeout', code);
  fn(uniStub, plusStub, mod, { log(){}, warn(){}, error(){} }, { addEventListener(){} }, (f) => f);

  return {
    sound: mod.exports,
    played,
    playedCtx,
    createdCtx,
    destroyCount,
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
console.log('===== 场景 5：实例现建现销（本次根因）=====');
{
  const env = build({ plusReadyAtStart: true, optionWorksAtStart: true });

  // preload 不应该预建任何【留待复用的播放实例】。
  //
  // 旧实现会在这里建好 12 个音效 x 2 = 24 个实例常驻池中，它们闲置
  // 十几秒后底层 MediaPlayer 已失效，play() 便静默无效 —— 这正是
  // 「关一次音效再开就正常」的原因：手动关开使实例变成现用现造。
  //
  // 注意 preload 会调 probeDir 为每个候选路径建临时探测实例，
  // 那些实例 2 秒内就销毁、不参与播放，属于正常行为，不能算预建。
  // 所以判据不是「创建数为 0」，而是「没有实例被 play 过」，
  // 以及后面验证的「每次播放都新建、不复用」。
  env.sound.preload();
  const probeCount = env.createdCtx.length;
  console.log('  preload 后创建的探测实例数: ' + probeCount + '（均为临时探测，2秒内销毁）');
  check('preload 未播放任何实例', env.playedCtx.length === 0);
  const afterPreload = env.createdCtx.length;

  // 第一次播放：应当现场新建实例
  env.sound.play('move');
  const after1 = env.createdCtx.length;
  console.log('  第一次 play 后已创建实例数: ' + after1);
  check('play 时现场创建实例', after1 > afterPreload);
  check('新建的实例确实被 play', env.playedCtx.length === 1);

  // 模拟播放结束，实例应被销毁
  const c1 = env.playedCtx[0];
  if (c1 && c1._endedCb) c1._endedCb();
  console.log('  ended 后 destroy 次数: ' + env.destroyCount.n);
  check('播完立即销毁实例', c1 && c1._destroyed === true);

  // 第二次播放：必须是全新实例，不能复用第一个
  env.sound.play('move');
  const c2 = env.playedCtx[1];
  console.log('  第二次 play 是否复用旧实例: ' + (c1 === c2));
  check('第二次播放不复用旧实例', c1 !== c2);
  check('每次播放都新建实例', env.createdCtx.length > after1);
}

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log(fail === 0 ? '★ 全部通过' : '★ 存在失败');
process.exit(fail === 0 ? 0 : 1);
