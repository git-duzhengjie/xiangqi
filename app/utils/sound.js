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

const BASE = '/static/sounds/'
const POOL_SIZE = 2          // 每种音效的实例数
const STORAGE_KEY = 'xq_sound_on'

class SoundService {
  constructor() {
    this.enabled = true
    this.pools = {}          // key -> [ctx, ctx]
    this.cursor = {}         // key -> 下一个使用的下标
    this.ready = false
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
        ctx.src = BASE + file
        // 音效不能循环，也不该抢占背景音乐焦点
        ctx.loop = false
        ctx.obeyMuteSwitch = true    // 跟随系统静音键（iOS 上很重要）
        ctx.onError((err) => {
          console.warn('[sound] 播放出错 ' + key + ':', err)
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

      // 复用实例必须先回到起点，否则第二次播放没声音
      try { ctx.stop() } catch (e) {}
      try { ctx.seek(0) } catch (e) {}
      ctx.play()
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
    try {
      Object.values(this.pools).forEach(pool => {
        pool.forEach(ctx => { try { ctx.stop() } catch (e) {} })
      })
    } catch (e) {}
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
