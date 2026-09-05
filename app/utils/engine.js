/**
 * engine.js  --  Pikafish 引擎 JS 封装层
 *
 * 职责：
 *   1. 把原生插件的 callback 风格包装成 Promise
 *   2. 管理引擎生命周期（初始化 / 新局 / 释放）
 *   3. 难度控制：depth / movetime + 低难度拟人化
 *
 * 【拟人化说明】
 * Pikafish 沿用新版 Stockfish，已移除 Skill Level 选项。
 * 若只靠限制 depth，低难度表现为"大部分走得极强、偶尔突然送子"，
 * 不像人。这里的做法是：低难度时开 MultiPV 取多个候选着法，
 * 再按权重随机挑一个（越低难度越可能选次优着），手感更接近真人。
 */

import { DIFFICULTY_LEVELS } from './constants.js'

const PLUGIN_NAME = 'XiangqiEngine'

class XiangqiEngine {
  constructor() {
    this.plugin = null
    this.inited = false
    this.difficulty = DIFFICULTY_LEVELS[2] // 默认"普通"
    this.multiPvLines = []                 // 当前一次搜索的候选着法
    this.onInfo = null                     // 外部可注册：接收 info 输出
  }

  /** 获取原生插件实例 */
  _getPlugin() {
    if (this.plugin) return this.plugin
    // #ifdef APP-PLUS
    this.plugin = uni.requireNativePlugin(PLUGIN_NAME)
    // #endif
    return this.plugin
  }

  /** 引擎是否可用（仅 App 端可用） */
  isAvailable() {
    return !!this._getPlugin()
  }

  /**
   * 初始化引擎
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  init() {
    return new Promise(resolve => {
      const p = this._getPlugin()
      if (!p) {
        resolve({ success: false, error: '原生插件不可用（请使用自定义基座运行）' })
        return
      }

      // 注册输出监听：收集 MultiPV 候选 + 透传 info
      p.onOutput(res => {
        if (!res || !res.line) return
        this._handleLine(res.line)
      })

      p.initEngine(res => {
        this.inited = !!(res && res.success)
        if (this.inited) {
          // 线程数按设备核心数，留一个核给 UI
          const cores = this._cpuCores()
          p.setOptions({ threads: Math.max(1, cores - 1), hash: 64 }, () => {})
        }
        resolve(res || { success: false, error: 'no response' })
      })
    })
  }

  _cpuCores() {
    try {
      const info = uni.getSystemInfoSync()
      // uniapp 未直接暴露核心数，按内存粗略估计，保守取 2~4
      return info.platform === 'ios' ? 3 : 3
    } catch (e) {
      return 2
    }
  }

  /** 解析引擎输出行，收集 MultiPV 候选着法 */
  _handleLine(line) {
    if (this.onInfo) this.onInfo(line)

    // info depth 12 ... multipv 2 score cp -35 ... pv h2e2 ...
    if (line.startsWith('info') && line.includes(' pv ')) {
      const mpMatch = line.match(/multipv\s+(\d+)/)
      const pvMatch = line.match(/\spv\s+(\S+)/)
      const cpMatch = line.match(/score\s+cp\s+(-?\d+)/)
      const mateMatch = line.match(/score\s+mate\s+(-?\d+)/)
      if (pvMatch) {
        const idx = mpMatch ? parseInt(mpMatch[1], 10) : 1
        this.multiPvLines[idx - 1] = {
          move: pvMatch[1],
          cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
          mate: mateMatch ? parseInt(mateMatch[1], 10) : null
        }
      }
    }
  }

  /** 设置难度（1~7） */
  setDifficulty(levelId) {
    const lv = DIFFICULTY_LEVELS.find(l => l.id === levelId)
    if (lv) this.difficulty = lv
    const p = this._getPlugin()
    if (p && this.inited) {
      // 低难度开 MultiPV 以便随机选次优着，实现拟人化
      const multiPv = this._multiPvFor(lv)
      p.setOptions({ multiPv }, () => {})
    }
    return this.difficulty
  }

  _multiPvFor(lv) {
    if (!lv) return 1
    if (lv.id <= 2) return 5   // 入门/简单：候选多，容易走软手
    if (lv.id === 3) return 3  // 普通
    if (lv.id === 4) return 2  // 困难
    return 1                   // 专家以上：只走最优
  }

  /** 开始新对局 */
  newGame() {
    const p = this._getPlugin()
    if (p && this.inited) p.newGame()
    this.multiPvLines = []
  }

  /**
   * 请求引擎走子
   * @param {string} fen    起始局面（通常是开局 FEN）
   * @param {string[]} moves 从该局面起走过的 UCI 着法
   * @returns {Promise<{success:boolean, bestmove?:string, error?:string}>}
   */
  think(fen, moves = []) {
    return new Promise(resolve => {
      const p = this._getPlugin()
      if (!p || !this.inited) {
        resolve({ success: false, error: '引擎未初始化' })
        return
      }

      this.multiPvLines = []
      const lv = this.difficulty

      p.go({
        fen: fen || '',
        moves: moves.join(' '),
        depth: lv.depth || 0,
        movetime: lv.movetime || 1000
      }, res => {
        if (!res || !res.success) {
          resolve(res || { success: false, error: '引擎无响应' })
          return
        }
        // 低难度：从候选中按权重随机，制造"人味"
        const picked = this._humanize(res.bestmove)
        resolve({ success: true, bestmove: picked, raw: res.bestmove })
      })
    })
  }

  /**
   * 拟人化选着：低难度时有概率选择次优着法
   * 概率随难度递减，且排除会立即丢大子的着法（cp 差距过大则不选）
   */
  _humanize(bestmove) {
    const lv = this.difficulty
    if (lv.id >= 5) return bestmove              // 专家以上不做手脚
    const cands = this.multiPvLines.filter(c => c && c.move)
    if (cands.length <= 1) return bestmove

    // 选次优着的概率
    const softProb = { 1: 0.75, 2: 0.5, 3: 0.25, 4: 0.1 }[lv.id] || 0
    if (Math.random() > softProb) return bestmove

    const best = cands[0]
    // 容忍的分数损失（分值，越低难度容忍越大）
    const tolerance = { 1: 400, 2: 250, 3: 120, 4: 60 }[lv.id] || 0

    const acceptable = cands.filter(c => {
      if (c.mate != null) return false           // 别乱动杀棋
      if (best.cp == null || c.cp == null) return true
      return Math.abs(best.cp - c.cp) <= tolerance
    })
    if (acceptable.length <= 1) return bestmove

    // 从可接受候选里随机（跳过最优着，偏向次优）
    const pool = acceptable.slice(1)
    const pick = pool[Math.floor(Math.random() * pool.length)]
    return pick && pick.move ? pick.move : bestmove
  }

  /** 中断思考 */
  stop() {
    const p = this._getPlugin()
    if (p && this.inited) p.stop()
  }

  /** 求提示：用较高强度算一步，但不改变当前难度设置 */
  hint(fen, moves = []) {
    return new Promise(resolve => {
      const p = this._getPlugin()
      if (!p || !this.inited) {
        resolve({ success: false, error: '引擎未初始化' })
        return
      }
      p.go({
        fen: fen || '',
        moves: moves.join(' '),
        depth: 12,
        movetime: 1500
      }, res => resolve(res || { success: false }))
    })
  }

  dispose() {
    const p = this._getPlugin()
    if (p) p.dispose()
    this.inited = false
  }
}

// 单例导出
export default new XiangqiEngine()
