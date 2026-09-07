/**
 * sound.js -- 音效服务
 *
 * 分层（遵循代码规范）：
 *   - 本地数据：开关状态存 uni.storage
 *   - 业务逻辑：播放调度、实例池
 *
 * 设计要点：
 *   1. 实例池复用
 *      uni.createInnerAudioContext() 每次都创建、又不 destroy，在连续吃子时
 *      会迅速堆出几十个原生 player，Android 上直接卡顿甚至没声。这里给每种
 *      音效固定 2 个实例轮换，既能让同一音效叠着响（吃子连击不吞音），又不会
 *      无限增长。
 *
 *   2. 播放前 seek(0)
 *      复用实例必须手动回到起点，否则第二次播放会从上次结束位置开始 —— 表现
 *      为"只响一次就没声了"。
 *
 *   3. 全部静默失败
 *      音效属于锦上添花，任何异常都不能影响下棋。所有调用都包在 try/catch，
 *      出错只在 console 留痕，绝不向上抛。
 *
 *   4. 不阻塞
 *      play() 一律同步返回，不 await，避免拖慢走子动画。
 */

// 音效清单：key -> 文件名
const SOUND_FILES = {
  move: 'move.wav',        // 走子
  capture: 'capture.wav',  // 吃子
  select: 'select.wav',    // 选中棋子
  check: 'check.wav',      // 将军
  win: 'win.wav',          // 胜
  lose: 'lose.wav',        // 负
  draw: 'draw.wav',        // 和
  undo: 'undo.wav',        // 悔棋
  hint: 'hint.wav',        // 提示
  click: 'click.wav'       // 按钮
}

/**
 * 音频资源目录候选列表。
 *
 * 本次无声的真正原因就在这里，记一笔：
 * 原先写死 '/static/sounds/'（以斜杠开头的绝对路径）。图片用这种写法一切正常，
 * 因为 img 由 webview 按页面基准解析；但 innerAudioContext 走的是原生播放器，
 * 它会把 '/static/...' 当成【文件系统绝对路径】去找设备根目录下的 /static/sounds/，
 * 而实际文件在：
 *   /data/data/<pkg>/files/apps/__UNI__XXXX/www/static/sounds/
 * 找不到就静默失败 —— 不报错、不走 onError，表现就是彻底没声。
 *
 * 不再赌哪一种写法对：把几种常见形式都列出来，让程序在设备上自己试。
 * 首选 _www/ （App 端官方推荐，映射到应用资源目录）。
 */
/**
 * 解析音频目录为【设备上的真实绝对路径】。
 *
 * 为什么不再用相对路径候选列表：
 * 之前写 '/static/sounds/'（绝对路径）找不到文件；改成 '_www/static/sounds/'
 * 后，logcat 里已能看到 GenericSource: FileSource，说明文件确实被打开了。
 * 但“猬候选前缀”本身就不可靠，而且配合自愈逻辑反而会把已经正确的
 * 前缀换成错的（见下方 fallbackPath 删除说明）。
 *
 * plus.io.convertLocalFileSystemURL 能把 '_www/xxx' 直接转成
 * /data/data/<pkg>/files/apps/<appid>/www/xxx 这样的真实路径，
 * 不再依赖播放器内部的相对路径规则，一次到位。
 */
/**
 * 统一提取异常文本。
 * 直接把 error 对象拼进字符串只会得到 [object Object]，
 * 排查时等于什么都没说。
 */
function errText(e) {
  if (!e) return '未知'
  return e.message || e.errMsg || String(e)
}

function resolveSoundDir() {
  // #ifdef APP-PLUS
  try {
    if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
      const abs = plus.io.convertLocalFileSystemURL('_www/static/sounds/')
      if (abs) return abs.charAt(abs.length - 1) === '/' ? abs : abs + '/'
    }
  } catch (e) {}
  return '_www/static/sounds/'
  // #endif
  // #ifndef APP-PLUS
  return '/static/sounds/'
  // #endif
}
const POOL_SIZE = 2          // 每种音效的实例数
const STORAGE_KEY = 'xq_sound_on'

class SoundService {
  constructor() {
    this.enabled = true
    this.pools = {}          // key -> [ctx, ctx]
    this.cursor = {}         // key -> 下一个使用的下标
    this.ready = false
    this.dir = ''            // 音频目录（延迟到首次使用时解析，plus 此时才就绪）
    this.lastError = ''      // 最近一次错误，供页面上的自检按钮展示
    this.audioOptionApplied = false
    this.audioOptionOk = false
    this.loadSetting()
  }

  /* ---------- 本地数据 ---------- */

  loadSetting() {
    try {
      const v = uni.getStorageSync(STORAGE_KEY)
      // 未设置过时默认开启；存的是字符串 '0' / '1'
      this.enabled = (v === '' || v === null || v === undefined) ? true : v === '1'
    } catch (e) {
      this.enabled = true
    }
  }

  saveSetting() {
    try {
      uni.setStorageSync(STORAGE_KEY, this.enabled ? '1' : '0')
    } catch (e) {
      // 存不进去就算了，不影响本次会话
    }
  }

  /* ---------- 实例管理 ---------- */

  /**
   * 预加载全部音效。
   * 在对局页 onLoad 里调一次即可；不调也能用（首次 play 会懒加载），
   * 只是第一声可能有轻微延迟。
   */
  preload() {
    if (this.ready) return
    this.applyAudioOption()
    try {
      Object.keys(SOUND_FILES).forEach(key => this.ensurePool(key))
      this.ready = true
    } catch (e) {
      this.lastError = 'preload: ' + errText(e)
      console.warn('[sound] preload 失败:', e)
    }
  }

  /**
   * 全局关闭"跟随系统静音开关"。
   *
   * 自检实测：ctx.obeyMuteSwitch 在本基座上只有 getter，赋值直接抛
   * "Cannot set property obeyMuteSwitch ... which has only a getter"，
   * 也就是说它一直保持默认值 true —— 跟随系统静音键。
   * 而模拟器默认就处于静音开关打开的状态，真机的勿扰模式同样会命中，
   * 结果就是音效被系统静默吞掉：不报错、不回调、日志干净，
   * 表现正是"开关看得见、声音听不到"。
   *
   * 实例属性改不动，就改全局配置：uni.setInnerAudioOption 是官方提供的
   * 全局入口，对之后创建的所有 innerAudioContext 生效，绕开只读限制。
   * 必须在创建实例之前调用。
   */
  applyAudioOption() {
    if (this.audioOptionApplied) return
    this.audioOptionApplied = true
    try {
      if (uni.setInnerAudioOption) {
        uni.setInnerAudioOption({
          obeyMuteSwitch: false,   // 不跟随系统静音键
          mixWithOther: true,      // 允许与其他音频共存，避免抢焦点失败导致无声
          fail: (err) => { this.lastError = 'setInnerAudioOption: ' + errText(err) }
        })
        this.audioOptionOk = true
      } else {
        this.lastError = 'setInnerAudioOption 不可用'
      }
    } catch (e) {
      this.lastError = 'setInnerAudioOption: ' + errText(e)
    }
  }

  ensurePool(key) {
    if (this.pools[key]) return this.pools[key]
    const file = SOUND_FILES[key]
    if (!file) return null

    // 创建任何实例前，先确保全局音频配置已生效
    this.applyAudioOption()

    // 延迟解析目录：模块刚导入时 plus 可能还没就绪，放到真正要用时再算
    if (!this.dir) {
      try { this.dir = resolveSoundDir() }
      catch (e) { this.lastError = '目录解析失败: ' + errText(e); return null }
    }

    const arr = []
    for (let i = 0; i < POOL_SIZE; i++) {
      let ctx = null
      try {
        ctx = uni.createInnerAudioContext()
      } catch (e) {
        // 必须把异常存下来。之前这里只有 console.warn，而正式包会剥离 console，
        // 导致自检弹窗显示"创建失败"但"最近错误: 无"，真正原因被吞得一干二净。
        this.lastError = '创建' + key + '失败: ' + errText(e)
        continue
      }

      // 属性逐个隔离赋值。
      // ES 模块是严格模式，给只读属性赋值会直接抛 TypeError 而非静默忽略；
      // 原先四个赋值和 createInnerAudioContext 共用一个 try，任意一个抛错都会
      // 让整个实例被丢弃，最终表现为"实例池 0 种"，却看不出是哪一步的问题。
      // 拆开之后，即便某个属性不被当前基座支持，实例本身仍然可用。
      try { ctx.src = this.dir + file } catch (e) { this.lastError = 'src: ' + errText(e) }
      try { ctx.loop = false } catch (e) {}
      try { ctx.autoplay = false } catch (e) {}
      // 这里不再给 ctx.obeyMuteSwitch 赋值：自检已证实它在本基座上只有 getter，
      // 赋值必然抛错。改由 applyAudioOption() 通过全局 API 统一设置。
      // 保留 try 只是为了兼容个别允许写入的平台，失败也不影响后续。
      try { ctx.obeyMuteSwitch = false } catch (e) {}
      try { ctx.volume = 1.0 } catch (e) {}

      try {
        ctx.onError((err) => {
          this.lastError = key + ': ' + (err && (err.errMsg || err.errCode || JSON.stringify(err)))
          console.warn('[sound] 播放出错 ' + this.lastError)
        })
      } catch (e) {}

      arr.push(ctx)
    }

    if (!arr.length) return null
    this.pools[key] = arr
    this.cursor[key] = 0
    return arr
  }

  /* ---------- 播放 ---------- */

  /**
   * 播放指定音效。任何异常都吞掉，绝不影响棋局。
   * @param {string} key SOUND_FILES 中的键
   */
  play(key) {
    if (!this.enabled) return
    if (!SOUND_FILES[key]) {
      console.warn('[sound] 未知音效: ' + key)
      return
    }
    try {
      const pool = this.ensurePool(key)
      if (!pool || !pool.length) return

      const idx = this.cursor[key] % pool.length
      this.cursor[key] = (idx + 1) % pool.length
      const ctx = pool[idx]

      // 关键：这里既不能 stop()，也不要无条件 seek(0)。
      //
      // 1) stop() 会把 Android 底层 MediaPlayer 打到 Stopped 态，必须重新
      //    prepare() 才能再播，此时 play() 会被静默丢弃。
      // 2) seek() 同样危险：刚创建的实例还在异步 prepare，尚未进入
      //    Prepared 态，此时 seek 属于非法调用，会让播放器进入异常状态，
      //    紧跟着的 play() 同样无声。日志里的表现就是：文件已打开
      //    （GenericSource: FileSource）、播放器已建好，却始终没有 AudioTrack。
      //
      // 正确做法：直接 play()。重头播放靠实例池轮换来保证（同一音效两个
      // 实例交替用），而不是靠手动重置进度。只有在确实已经播放过、
      // 确保处于已就绪状态时，重置进度才是安全的。
      if (ctx.__xqPlayed) {
        try { ctx.seek(0) } catch (e) {}
      }
      ctx.__xqPlayed = true
      ctx.play()
      // 留一条痕迹：无声问题最难的是分不清“没调用”还是“调了没响”，
      // 有了这行日志，adb logcat 一搜就能区分两者
      console.log('[sound] play ' + key)
    } catch (e) {
      console.warn('[sound] play 异常 ' + key + ':', e)
    }
  }

  /* ---------- 语义化快捷方法 ---------- */
  // 让调用方读起来是"发生了什么"，而不是"放哪个文件"

  playMove(isCapture) {
    this.play(isCapture ? 'capture' : 'move')
  }

  playSelect() { this.play('select') }
  playCheck() { this.play('check') }
  playUndo() { this.play('undo') }
  playHint() { this.play('hint') }
  playClick() { this.play('click') }

  /** 按对局结果播放对应音效 */
  playResult(result) {
    if (result === 'red_win') this.play('win')
    else if (result === 'black_win') this.play('lose')
    else if (result === 'draw') this.play('draw')
  }

  /* ---------- 开关 ---------- */

  isEnabled() { return this.enabled }

  setEnabled(on) {
    this.enabled = !!on
    this.saveSetting()
    if (!this.enabled) this.stopAll()
  }

  /** 返回切换后的状态 */
  toggle() {
    this.setEnabled(!this.enabled)
    return this.enabled
  }

  /**
   * 音效自检：逐步探测每一步，把结果直接弹到屏幕上。
   *
   * 为什么要做到这么细：正式包会剥离 console.log，adb 日志里看不到任何音效
   * 信息，无声时只能靠猜，而每验证一次都要重新打包。把每一步的成败都显示
   * 出来，一次打包就能定位到具体是哪个环节断的。
   */
  diagnose() {
    const L = []
    L.push('开关: ' + (this.enabled ? '开' : '关'))

    // 0) 全局音频配置（必须在创建实例前生效）
    this.applyAudioOption()
    L.push('全局静音跟随: ' + (this.audioOptionOk ? '已关闭' : '设置失败'))

    // 1) plus 是否就绪
    try {
      L.push('plus: ' + (typeof plus !== 'undefined' ? '就绪' : '不可用'))
    } catch (e) { L.push('plus: 不可用') }

    // 2) 目录解析
    try {
      if (!this.dir) this.dir = resolveSoundDir()
      L.push('目录: ' + this.dir)
    } catch (e) {
      L.push('目录解析失败: ' + errText(e))
      return this.showDiag(L)
    }

    // 3) 创建 API 是否可用（单独试一个，问题能精确到这一步）
    let probe = null
    try {
      probe = uni.createInnerAudioContext()
      L.push('createInnerAudioContext: 可用')
    } catch (e) {
      L.push('createInnerAudioContext 失败: ' + errText(e))
      return this.showDiag(L)
    }

    // 4) 逐个属性赋值试探。ES 模块是严格模式，给只读属性赋值会直接抛错，
    //    而不是静默忽略 —— 这类失败最容易被整块 try/catch 吞掉。
    try { probe.src = this.dir + SOUND_FILES.move; L.push('src 赋值: 成功') }
    catch (e) { L.push('src 赋值失败: ' + errText(e)) }
    try { probe.loop = false; L.push('loop 赋值: 成功') }
    catch (e) { L.push('loop 赋值失败: ' + errText(e)) }
    try { probe.obeyMuteSwitch = false; L.push('obeyMuteSwitch 赋值: 成功') }
    catch (e) { L.push('obeyMuteSwitch 赋值失败: ' + errText(e)) }
    try { probe.volume = 1.0; L.push('volume 赋值: 成功') }
    catch (e) { L.push('volume 赋值失败: ' + errText(e)) }

    // 5) 用探针实测一次播放，并挂上全部回调。
    //    关键在于把"到底有没有真正播出去"变成可观测的事实：
    //    onCanplay 说明解码成功，onPlay 说明播放器真的启动了，
    //    onEnded 说明完整播完。只看 duration 是不够的——刚创建的实例
    //    尚未加载完成，duration 本来就是 0，据此判断会误伤。
    const marks = []
    try { probe.onCanplay(() => marks.push('canplay')) } catch (e) {}
    try { probe.onPlay(() => marks.push('play')) } catch (e) {}
    try { probe.onEnded(() => marks.push('ended')) } catch (e) {}
    try { probe.onError((err) => marks.push('error:' + (err && (err.errMsg || err.errCode || JSON.stringify(err))))) } catch (e) {}

    try { probe.play(); L.push('探针 play(): 已调用') }
    catch (e) { L.push('探针 play() 失败: ' + errText(e)) }

    // 6) 走正式链路建池
    const pool = this.ensurePool('move')
    if (!pool || !pool.length) {
      L.push('实例池: 创建失败')
    } else {
      L.push('实例池: ' + pool.length + ' 个')
    }
    L.push('最近错误: ' + (this.lastError || '无'))

    // 等 800ms 收集回调结果再弹窗，否则一切都还没发生，看到的必然是空的
    setTimeout(() => {
      L.push('')
      L.push('回调: ' + (marks.length ? marks.join(' > ') : '无（未触发任何回调）'))
      L.push('时长: ' + (probe.duration || 0))
      try { probe.destroy() } catch (e) {}
      this.showDiag(L)
    }, 800)
  }

  showDiag(lines) {
    try {
      uni.showModal({ title: '音效自检', content: lines.join('\n'), showCancel: false })
    } catch (e) {}
    return lines.join('\n')
  }

  stopAll() {
    // 注意：stop() 会使实例进入 Stopped 态、后续无法直接 play，
    // 所以停完必须把池重建，否则重新开启音效后会发现“再也不响了”。
    try {
      Object.values(this.pools).forEach(pool => {
        pool.forEach(ctx => {
          try { ctx.stop() } catch (e) {}
          try { ctx.destroy() } catch (e) {}
        })
      })
    } catch (e) {}
    this.pools = {}
    this.cursor = {}
    this.ready = false
  }

  /**
   * 释放全部实例。
   * 页面 onUnload 时调用 —— innerAudioContext 是原生资源，不 destroy 会泄漏。
   */
  destroy() {
    try {
      Object.values(this.pools).forEach(pool => {
        pool.forEach(ctx => {
          try { ctx.stop() } catch (e) {}
          try { ctx.destroy() } catch (e) {}
        })
      })
    } catch (e) {}
    this.pools = {}
    this.cursor = {}
    this.ready = false
  }
}

export default new SoundService()
