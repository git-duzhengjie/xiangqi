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
  click: 'click.wav',      // 按钮
  voice_check: 'voice_check.wav',   // 人声：将军
  voice_capture: 'voice_capture.wav' // 人声：吃
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

/**
 * 列出所有候选音频目录写法，按「最可能可用」排序。
 *
 * 不再返回单一路径。历次修复的教训是：到底哪种写法能被播放器打开，
 * 取决于基座版本、Android 版本、资源是否被解压到应用私有目录等多个
 * 变量，靠静态推理无法确定 —— 我据此断定过两次，两次都错。
 * 所以这里把所有可能性都列出来，交给运行时探测去筛。
 *
 * @returns {string[]} 候选目录前缀数组
 */
function resolveSoundCandidates() {
  const list = []

  // #ifdef APP-PLUS
  // 先尝试把 _www 换算成设备真实路径。
  // 若基座已把资源解压到私有目录，这条就能用；若资源仍在 APK 的
  // assets 内部则换算结果不存在。两种情况都可能，所以两种写法都留。
  try {
    if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
      const abs = plus.io.convertLocalFileSystemURL('_www/static/sounds/')
      if (abs) {
        // file:// 前缀版本。第4版自检面板曾在真机实测这种写法能 canplay，
        // 因此排在最前面 —— 那是目前唯一有过正面实测结果的写法。
        if (abs.indexOf('file://') === 0) {
          list.push(abs)
        } else {
          list.push('file://' + abs)
          // 裸绝对路径。第4版实测报 MediaError，但换个基座可能就行，留作候选。
          list.push(abs)
        }
      }
    }
  } catch (e) {}

  // 基座相对路径，由基座内部从 assets 读取。
  list.push('_www/static/sounds/')
  // #endif

  // 通用写法，H5 与部分基座可用
  list.push('/static/sounds/')
  list.push('static/sounds/')

  // 去重但保持顺序
  const seen = {}
  return list.filter(p => {
    if (!p || seen[p]) return false
    seen[p] = 1
    return true
  })
}
const STORAGE_KEY = 'xq_sound_on'

// 已验证可用的音频目录写法。运行时探测成功后持久化，下次启动直接命中，
// 省掉一轮探测，也避免首次播放时因探测尚未完成而用错路径。
const STORAGE_KEY_DIR = 'xq_sound_dir'

class SoundService {
  constructor() {
    this.enabled = true
    // 实例改为播放时现建现销，这两个字段已不再用于复用，
    // 仅为兼容 stopAll / destroy / releasePools 的既有清理逻辑而保留。
    this.pools = {}
    this.candidates = []     // 候选目录列表，运行时探测用
    this.probing = false     // 是否正在探测，避免并发重复探测
    this.probeDone = false   // 是否已探测出可用目录
    this.dirConfirmed = false // 是否已由 onPlay 确认该目录真的能出声
    this.cursor = {}         // key -> 下一个使用的下标
    this.ready = false
    this.dir = ''            // 音频目录（延迟到首次使用时解析，plus 此时才就绪）
    this.lastError = ''      // 最近一次错误，供页面上的自检按钮展示
    this.audioOptionApplied = false
    this.audioOptionOk = false
    this.dirIsFallback = false   // 当前 this.dir 是不是 plus 不可用时的兜底路径
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
    // 只做目录探测，不再预先创建任何实例。
    //
    // 旧版本会在这里把 12 个音效 x 2 个实例全部建好，本意是减少首次
    // 播放延迟，实际却是无声的根因：实例在池中闲置十几秒后底层
    // MediaPlayer 已失效，play() 静默无效。详见 play() 内的说明。
    //
    // 现在实例改为播放时现建现销，这里只需把可用的目录写法探测出来，
    // 避免首次落子时才开始探测而错过第一声。
    this.applyAudioOption()
    try {
      this.ensureDir()
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
        // 该 API 在部分基座上不存在，属于可选优化而非故障。
        // 实测证明：即便它不可用，只要 src 带 file:// 前缀，
        // canplay > play > ended 依然能完整触发，音频正常播出。
        // 因此不写入 lastError —— 否则会一直顶掉真正的播放错误，
        // 让自检面板显示一个无关紧要的"错误"，干扰后续排查。
        this.audioOptionOk = false
      }
    } catch (e) {
      this.lastError = 'setInnerAudioOption: ' + errText(e)
    }
  }

  /**
   * 确保 this.dir 是设备上可用的真实路径。
   *
   * 为什么单独抽成一个方法：
   * 音频目录依赖 plus.io.convertLocalFileSystemURL，而 preload 在页面
   * onLoad 阶段就跑了，那时 plus 常常还没就绪，只能拿到兜底的相对路径
   * '_www/static/sounds/'。这个路径 Android 原生播放器打不开，报 MediaError。
   *
   * 上一版的修复把"重试解析"写进了 ensurePool，但位置在
   * "if (this.pools[key]) return" 早退之后 —— preload 已经用兜底路径
   * 把池子建好了，此后每次 play 都在第一行直接返回，重试代码一次都没执行。
   * 表现就是首次启动始终无声，必须手动关一次音效再打开（stopAll 会清空
   * pools，早退失效，才轮到重试逻辑）。
   *
   * 所以这里独立出来，由 ensurePool 在早退【之前】调用，保证每次取实例
   * 都会检查一遍路径是否还停留在兜底状态。
   *
   * @returns {boolean} 是否已拿到可用目录
   */
  ensureDir() {
    // 已探测出可用目录就直接复用
    if (this.dir && this.probeDone) return true

    // 优先使用上次已验证可用的写法。
    // 探测是异步的（要等 canplay 回调），而用户可能在探测完成前就已经
    // 落子了；没有这层缓存的话，首声仍然会用到未经验证的候选项。
    if (!this.dir) {
      try {
        const saved = uni.getStorageSync(STORAGE_KEY_DIR)
        if (saved) {
          this.dir = saved
          this.probeDone = true
          this.dirIsFallback = false
          return true
        }
      } catch (e) {}
    }

    // 尚未探测出结果时，先用候选列表里的第一个顶着，保证有声可播；
    // 同时在后台启动探测，一旦发现真正可用的写法就切换过去。
    if (!this.dir) {
      try {
        this.candidates = resolveSoundCandidates()
        this.dir = this.candidates[0] || '/static/sounds/'
      } catch (e) {
        this.lastError = '目录解析失败: ' + errText(e)
        this.dir = '/static/sounds/'
      }
      this.dirIsFallback = false
    }

    this.probeDir()
    return !!this.dir
  }

  /**
   * 在真机上逐个试探候选路径，找出播放器真正能打开的那一种。
   *
   * 为什么需要运行时探测：
   * 此前六次修复，每次都基于某种理论断定「哪种写法是对的」，然后全局
   * 只用那一种，六次全错。第4版自检面板实测 file:// 能 canplay、裸绝对
   * 路径报 MediaError；第6版又根据「资源在 APK assets 内部」推断绝对
   * 路径不存在，改用相对路径 —— 很可能亲手毁掉了唯一可用的写法。
   *
   * 路径可用性取决于基座版本、Android 版本、资源是否被解压到私有目录
   * 等多个变量，静态推理覆盖不了。所以改为：把所有候选写法都建一个
   * 临时实例挂上 canplay / error 回调，以 canplay 为唯一判据，
   * 谁能播就用谁，并把结果持久化，下次启动直接命中。
   *
   * 注意探测时不调用 play()，只看能否解码，避免多个候选同时出声叠音。
   */
  probeDir() {
    if (this.probing || this.probeDone) return
    if (!uni.createInnerAudioContext) return

    const list = (this.candidates && this.candidates.length)
      ? this.candidates
      : resolveSoundCandidates()
    if (!list.length) return

    this.probing = true
    // 拿一个体积最小的音效做探针，减少解码开销
    const probeFile = SOUND_FILES.select || SOUND_FILES.move ||
      SOUND_FILES[Object.keys(SOUND_FILES)[0]]
    const tmp = []
    let settled = false

    const cleanup = () => {
      tmp.forEach(c => { try { c.destroy() } catch (e) {} })
      tmp.length = 0
    }

    // 命中：锁定该目录，重建实例池
    const win = (dir) => {
      if (settled) return
      settled = true
      this.probing = false
      this.probeDone = true

      const changed = this.dir !== dir
      this.dir = dir
      this.probeResult = dir

      // 注意：这里故意不持久化。
      //
      // canplay 只证明文件能被解码，不等于扬声器真的出声。
      // 第4版就是被这个差别坑过：自检面板显示 file:// 能 canplay
      // 甚至 canplay>play>ended 全跳完了，实际仍然没声音。
      // 若在此处就写入缓存，一旦记住一个能解码但不出声的写法，
      // 以后每次启动都会直接命中它、跳过探测，反而把问题锁死。
      // 因此持久化推到 markDirWorking()，由正式播放链路的
      // onPlay 回调触发 —— 那才是真正出过声的证据。

      if (changed) this.releasePools()
      cleanup()
    }

    list.forEach(dir => {
      let ctx = null
      try {
        ctx = uni.createInnerAudioContext()
      } catch (e) { return }
      if (!ctx) return
      tmp.push(ctx)

      try { ctx.onCanplay(() => win(dir)) } catch (e) {}
      try {
        ctx.onError((err) => {
          // 仅记录，不影响其他候选继续探测
          this.probeErrors = this.probeErrors || {}
          this.probeErrors[dir] = errText(err)
        })
      } catch (e) {}
      // 只赋 src 触发解码，不调 play()，避免多个候选同时出声
      try { ctx.src = dir + probeFile } catch (e) {}
    })

    // 兜底：2 秒内没有任何候选 canplay，就保持当前 dir 并放行，
    // 允许后续 resetPipeline 再次探测（不置 probeDone）。
    setTimeout(() => {
      if (settled) return
      settled = true
      this.probing = false
      cleanup()
    }, 2000)
  }

  /** 销毁并清空全部实例池（内部复用，不改变 enabled 状态） */
  releasePools() {
    try {
      Object.keys(this.pools).forEach(k => {
        const pool = this.pools[k] || []
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
   * 标记当前目录写法确实能出声，并持久化下来。
   *
   * 由正式播放链路的 onPlay 回调调用。onPlay 表示播放器已真正开始
   * 输出音频，比探测阶段的 canplay 可靠得多 —— canplay 仅代表解码
   * 就绪，第4版曾出现过 canplay/play/ended 全部触发却依然无声的情况。
   *
   * 只写一次，避免每次播放都碰存储。
   */
  markDirWorking() {
    if (this.dirConfirmed || !this.dir) return
    this.dirConfirmed = true
    this.probeDone = true
    try { uni.setStorageSync(STORAGE_KEY_DIR, this.dir) } catch (e) {}
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

    // 每次播放都新建一个一次性实例，播完立即销毁。
    //
    // 为什么不用实例池预建（这是本问题的真正根因）：
    // 老板反馈「关闭一次音效再开启就正常」，而手动关开的实际效果是
    // stopAll() 清空池子且不重建，于是下一次落子时 ensurePool 现场
    // 创建实例并立刻 play —— 实例【创建即播放】，寿命仅几毫秒。
    // 而预建方案会让实例在池中闲置十几秒，其底层 MediaPlayer 已被
    // 系统回收或退出可播状态，JS 对象却还在，于是 play() 静默失效：
    // 不报错、不触发任何回调、audio_flinger 中没有 active track。
    // 实测现象完全吻合：MediaPlayer 被海量创建、全程零 error、
    // 0 active tracks。
    //
    // 所以这里坚持现用现造。innerAudioContext 创建开销很小，
    // 而可靠性远比复用省下的那点开销重要。
    try {
      if (!this.ensureDir()) return
      this.applyAudioOption()

      let ctx = null
      try {
        ctx = uni.createInnerAudioContext()
      } catch (e) {
        this.lastError = key + ' 创建失败: ' + errText(e)
        return
      }
      if (!ctx) return

      // 属性逐个独立 try。
      // 历史教训：把创建与多个属性赋值合在一个 try 里，一旦某个属性是
      // 只读 getter（obeyMuteSwitch 在本基座上就是）赋值抛 TypeError，
      // 整个实例会被丢弃，表现为实例池恒为空、彻底无声。
      try { ctx.loop = false } catch (e) {}
      try { ctx.autoplay = false } catch (e) {}
      try { ctx.volume = 1.0 } catch (e) {}
      try { ctx.obeyMuteSwitch = false } catch (e) {}

      // 销毁只执行一次，避免 ended 与超时兜底重复 destroy
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        try { ctx.destroy() } catch (e) {}
      }

      try { ctx.onEnded(dispose) } catch (e) {}
      try {
        ctx.onError((err) => {
          this.lastError = key + ': ' + errText(err)
          console.warn('[sound] 播放出错 ' + this.lastError)
          dispose()
        })
      } catch (e) {}
      // onPlay 表示真正开始输出音频，此时才确认该路径写法可用并持久化。
      // 比探测阶段的 canplay 可靠得多：canplay 只代表解码就绪。
      try { ctx.onPlay(() => this.markDirWorking()) } catch (e) {}

      // 兜底销毁：某些情况下 ended 不会触发（如文件损坏、播放被打断），
      // 不兜底会导致原生 MediaPlayer 泄漏。
      // 3 秒足够覆盖最长的音效（最长约 1.4 秒）。
      setTimeout(dispose, 3000)

      try { ctx.src = this.dir + SOUND_FILES[key] } catch (e) {
        this.lastError = key + ' 设置 src 失败: ' + errText(e)
        dispose()
        return
      }

      // 直接 play()，不 stop()、不 seek()。
      // 新建实例仍在异步 prepare，seek 属于非法调用，会让播放器进入
      // 异常态，紧跟的 play() 同样无声；stop() 会打到 Stopped 态，
      // 必须重新 prepare 才能播。一次性实例天然从头播放，无需重置进度。
      ctx.play()
    } catch (e) {
      this.lastError = key + ' play 异常: ' + errText(e)
      console.warn('[sound] play 异常', e)
    }
  }

  /* ---------- 语义化快捷方法 ---------- */
  // 让调用方读起来是"发生了什么"，而不是"放哪个文件"

  playMove(isCapture) {
    // 吃子直接播人声"吃"，比木质撞击声更清晰直观。
    // 普通走子保留木质落子声，不喧宾夺主。
    this.play(isCapture ? 'voice_capture' : 'move')
  }

  playSelect() { this.play('select') }
  playCheck() { this.play('voice_check') }
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
   * 彻底重置音效链路，等价于用户手动「关一次音效再打开」，但更干净。
   *
   * 背景：首次启动无声的问题反复修了三次都没根治。用户反馈的规律始终
   * 一致 —— 手动把音效关掉再打开，声音立刻就正常了。既然这条路径经过
   * 真机验证确实有效，就直接把它自动化，不再依赖对「哪个环节尚未就绪」
   * 的推断。
   *
   * 做的事情比手动关开更彻底：
   *   1. 销毁并清空全部实例池（等同 stopAll 的效果）
   *   2. 清掉 dir 与 dirIsFallback，强制下次重新解析音频目录
   *   3. 清掉 audioOptionApplied 与 audioOptionOk，强制重新下发
   *      uni.setInnerAudioOption（obeyMuteSwitch 等配置）
   *   4. 立即重新预热一遍
   *
   * 第 2、3 步是手动关开做不到的：那些一次性标记会一直留在内存里，
   * 即便实例重建了，路径与音频配置仍可能停留在启动初期的错误状态。
   *
   * 注意：不改动 this.enabled，用户自己的音效开关偏好必须保持原样。
   */
  resetPipeline() {
    // 第一步：销毁全部实例。innerAudioContext 是原生资源，
    // 只把引用丢掉会泄漏原生层的 MediaPlayer，必须显式 destroy。
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

    // 第二步：清掉路径缓存，强制重新解析。
    // 启动早期 plus 未就绪时只能拿到兜底的相对路径，
    // 这里清零后下次 ensureDir 会重新走一遍 convertLocalFileSystemURL。
    this.dir = ''
    this.dirIsFallback = false

    // 探测状态也要清掉，否则 App.vue 的三道保险重置时会因为
    // probeDone 仍为 true 而直接复用旧目录，得不到重新探测的机会。
    this.probing = false
    this.probeDone = false
    this.dirConfirmed = false
    this.candidates = []

    // 第三步：清掉音频配置标记，强制重新下发全局设置。
    // obeyMuteSwitch=false 必须真正生效，否则音效会被系统静音键吞掉。
    this.audioOptionApplied = false
    this.audioOptionOk = false
    this.lastError = ''

    // 第四步：立刻重新预热。此时若 plus 已就绪，就能一次拿到
    // file:// 真实路径并把配置下发成功，第一声就是对的。
    this.preload()
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
