/**
 * 验证音效链路在各种启动时序下都能正常出声。
 *
 * 断言标准已随根因修正而更新。
 *
 * adb 实测确证：打包后音效资源位于 APK 内部
 *   assets/apps/__UNI__FDB861F/www/static/sounds/*.wav
 * assets 是 APK（zip）条目，不是文件系统上的独立文件，因此
 * plus.io.convertLocalFileSystemURL 换算出的 /data/... 绝对路径
 * 根本不存在，加 file:// 前缀同样打不开，播放器会静默失败
 * （零 error、audio_flinger 中 0 active tracks）。
 *
 * 所以正确的路径形式是基座能识别的相对路径 '_www/static/sounds/'，
 * 由基座自己从 assets 读取。本测试据此断言：
 * 无论 plus 何时就绪，播放用的 src 都必须是该相对路径。
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

  // assets 内资源必须用基座相对路径，不能是 file:// 或 /data/ 绝对路径
  check('播放路径是基座相对路径 _www/', afterSrc.indexOf('_www/static/sounds/') === 0);
  check('播放路径不含 file:// 前缀', afterSrc.indexOf('file://') !== 0);
  check('播放路径不是 /data/ 绝对路径', afterSrc.indexOf('/data/') !== 0);
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
  check('路径依然是相对路径', (env.played[0] || '').indexOf('_www/static/sounds/') === 0);
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
