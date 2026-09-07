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
const BASE_CANDIDATES = [
  '_www/static/sounds/',   // App 端正解
  '/static/sounds/',       // H5 / 小程序
  'static/sounds/'         // 相对路径兼容
]
const POOL_SIZE = 2          // 每种音效的实例数
const STORAGE_KEY = 'xq_sound_on'

class SoundService {
  constructor() {
    this.enabled = true
    this.pools = {}          // key -> [ctx, ctx]
    this.cursor = {}         // key -> 下一个使用的下标
    this.ready = false
    this.baseIndex = 0       // 当前使用的路径候选下标
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
    try {
      Object.keys(SOUND_FILES).forEach(key => this.ensurePool(key))
      this.ready = true
    } catch (e) {
      console.warn('[sound] preload 失败:', e)
    }
  }

  ensurePool(key) {
    if (this.pools[key]) return this.pools[key]
    const file = SOUND_FILES[key]
    if (!file) return null

    const arr = []
    for (let i = 0; i < POOL_SIZE; i++) {
      try {
        const ctx = uni.createInnerAudioContext()
        ctx.src = BASE_CANDIDATES[this.baseIndex] + file
        // 音效不能循环，也不该抢占背景音乐焦点
        ctx.loop = false
        // 必须为 false。原先写 true（“跟随系统静音键”听着很合理），结果模拟器上完全无声。
        // 许多 Android 模拟器（MuMu / 雷电等）默认处于静音开关打开的状态，部分真机的
        // 勿扰模式也会命中；一旦命中，音效被系统静默地吞掉 —— 不报错、不回调、
        // 日志干净，表现就是“开关看得见、声音听不到”，排查成本极高。
        // 棋类游戏的落子声属于核心反馈而非背景音乐，用户想静音会直接用我们自己的
        // 🔊 开关，没必要再受系统静音键限制。
        ctx.obeyMuteSwitch = false
        ctx.volume = 1.0
        ctx.onError((err) => {
          console.warn('[sound] 播放出错 ' + key + ':', JSON.stringify(err))
          // 路径自愈：各平台/基座对音频 src 的解析规则不一致，写死一种写法很容易
          // 一错到底、而且静默无声。这里在首次出错时自动换下一个候选前缀重建，
          // 避免“改一次路径就要重打包验证一次”的反复折腾。
          this.fallbackPath(key)
        })
        arr.push(ctx)
      } catch (e) {
        console.warn('[sound] 创建实例失败 ' + key + ':', e)
      }
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
  /**
   * 路径自愈：当前前缀播不出声时，换下一个候选重建实例池。
   *
   * 为什么需要它：音频 src 的解析规则在不同平台、不同基座下并不一致，
   * 而一旦写错就是静默无声，既不报错也无日志（生产构建还会剥离
   * console.log）。光靠推断很容易一错再错，每试一次都要重新打包。
   * 所以直接把候选列表内置，让它在设备上自己试出能用的那个。
   */
  fallbackPath(key) {
    if (this.baseIndex >= BASE_CANDIDATES.length - 1) return
    this.baseIndex++
    const next = BASE_CANDIDATES[this.baseIndex]
    console.warn('[sound] 路径失败，切换到: ' + next)
    // 销毁全部旧实例，下次 play 会用新前缀重建
    try {
      Object.values(this.pools).forEach(pool => {
        pool.forEach(c => { try { c.destroy() } catch (e) {} })
      })
    } catch (e) {}
    this.pools = {}
    this.cursor = {}
    this.ready = false
  }

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

      // 关键：这里绝不能先 stop()。
      //
      // Android 底层是 MediaPlayer 状态机，stop() 会把它打到 Stopped 态，
      // 必须重新 prepare() 才能再播；此时直接 play() 会被静默丢弃 ——
      // 不报错、不回调，表现就是彻底没声。我之前为了“回到起点”加的
      // stop()，恰恰把播放器打成了不可播状态。
      //
      // 正确做法：直接 seek(0) + play()。seek 在 Started/Paused/Prepared 态
      // 都合法，既能重头播放，又不会破坏状态机。
      try { ctx.seek(0) } catch (e) {}
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
