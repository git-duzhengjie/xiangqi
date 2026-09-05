/**
 * game.js  --  对局页面脚本
 *
 * 分层（遵循代码规范）：
 *   - 数据服务：本地存档 storage.js / 远程无
 *   - 业务逻辑：本文件（局面状态机 + 引擎调度）
 *   - 规则裁决：utils/rules.js
 *   - AI 引擎：utils/engine.js
 */

import {
  RED, BLACK, INITIAL_FEN, DIFFICULTY_LEVELS, GAME_RESULT,
  COLS, ROWS, PIECE_NAMES, pieceSide, moveToUci
} from '@/utils/constants.js'
import {
  parseFen, toFen, initialState, genLegalMoves, genAllLegalMoves,
  applyMoveToBoard, isKingInCheck, isCheckmate, judgeResult, moveToChinese
} from '@/utils/rules.js'
import engine from '@/utils/engine.js'
import { getLocalNnue, NNUE_INFO } from '@/utils/nnue.js'

export default {
  data() {
    return {
      // ---- 局面状态 ----
      board: [],
      currentSide: RED,
      selected: null,        // { row, col }
      legalTargets: [],      // [{row,col}]
      lastMove: null,        // { from, to }
      history: [],           // [{ side, uci, chinese, boardBefore }]
      uciMoves: [],          // 供引擎的着法序列

      // ---- 画布 ----
      boardW: 350,
      boardH: 390,
      cell: 38,
      padding: 20,
      ctx: null,
      dpr: 1,

      // ---- 交互/状态 ----
      thinking: false,
      gameOver: false,
      result: GAME_RESULT.PLAYING,
      difficultyId: 3,
      showMenu: false,
      showMoves: false,
      engineMsg: '',
      engineReady: false,
      hintMove: null
    }
  },

  computed: {
    difficultyName() {
      const lv = DIFFICULTY_LEVELS.find(l => l.id === this.difficultyId)
      return lv ? `难度：${lv.name}` : '中国象棋'
    },
    redStatus() {
      if (this.gameOver) return ''
      if (this.currentSide === RED) {
        return isKingInCheck(this.board, RED) ? '被将军！' : '您的回合'
      }
      return '等待中'
    },
    blackStatus() {
      if (this.gameOver) return ''
      if (this.currentSide === BLACK) {
        return this.thinking ? '思考中…' : (isKingInCheck(this.board, BLACK) ? '被将军！' : '引擎回合')
      }
      return this.engineReady ? '就绪' : '未加载'
    },
    resultText() {
      switch (this.result) {
        case GAME_RESULT.RED_WIN: return '🎉 您赢了！'
        case GAME_RESULT.BLACK_WIN: return '😢 您输了'
        case GAME_RESULT.DRAW: return '🤝 和棋'
        default: return ''
      }
    },
    resultSub() {
      const lv = DIFFICULTY_LEVELS.find(l => l.id === this.difficultyId)
      const name = lv ? lv.name : ''
      if (this.result === GAME_RESULT.RED_WIN) return `战胜「${name}」难度，共 ${this.history.length} 步`
      if (this.result === GAME_RESULT.BLACK_WIN) return `再接再厉，共 ${this.history.length} 步`
      return `共 ${this.history.length} 步`
    }
  },

  onLoad(options) {
    if (options && options.level) {
      this.difficultyId = parseInt(options.level, 10) || 3
    }
    this.initBoardSize()
    this.resetGame()
    this.setupEngine()
  },

  onUnload() {
    engine.stop()
  },

  methods: {
    /* ============ 初始化 ============ */

    initBoardSize() {
      const info = uni.getSystemInfoSync()
      const w = info.windowWidth
      this.padding = Math.round(w * 0.05)
      // 9 列 8 间隔，10 行 9 间隔
      this.cell = Math.floor((w - this.padding * 2) / 8)
      this.boardW = this.cell * 8 + this.padding * 2
      this.boardH = this.cell * 9 + this.padding * 2
      this.dpr = info.pixelRatio || 2
    },

    async setupEngine() {
      if (!engine.isAvailable()) {
        this.engineMsg = '⚠️ 原生插件未加载，请用自定义基座运行'
        setTimeout(() => { this.engineMsg = '' }, 4000)
        return
      }
      // 引擎权重约 49MB，未下载时先征得同意，不静默跑流量
      const cachedNnue = await getLocalNnue()
      if (!cachedNnue) {
        const agreed = await new Promise(resolve => {
          uni.showModal({
            title: '首次使用需下载引擎数据',
            content: 'AI 引擎需要约 ' + NNUE_INFO.approxMB + 'MB 神经网络数据，仅首次下载，建议在 Wi-Fi 下进行。',
            confirmText: '立即下载',
            cancelText: '稍后',
            success: r => resolve(!!r.confirm),
            fail: () => resolve(false)
          })
        })
        if (!agreed) {
          this.engineMsg = '未下载引擎数据，AI 暂不可用'
          setTimeout(() => { this.engineMsg = '' }, 4000)
          return
        }
      }

      this.engineMsg = '引擎加载中…'
      const res = await engine.init({
        autoDownload: true,
        onProgress: (percent) => {
          this.engineMsg = `下载引擎数据 ${percent}%`
        }
      })
      if (res.success) {
        this.engineReady = true
        engine.setDifficulty(this.difficultyId)
        engine.newGame()
        this.engineMsg = '引擎就绪 ✓'
        setTimeout(() => { this.engineMsg = '' }, 1500)
      } else {
        this.engineMsg = '引擎失败：' + (res.error || '未知')
        setTimeout(() => { this.engineMsg = '' }, 5000)
      }
    },

    resetGame() {
      const st = initialState()
      this.board = st.board
      this.currentSide = RED
      this.selected = null
      this.legalTargets = []
      this.lastMove = null
      this.hintMove = null
      this.history = []
      this.uciMoves = []
      this.gameOver = false
      this.result = GAME_RESULT.PLAYING
      this.thinking = false
      this.$nextTick(() => this.draw())
    },

    /* ============ 棋盘绘制 ============ */

    /** 行列 -> 画布坐标 */
    posToXY(row, col) {
      return {
        x: this.padding + col * this.cell,
        y: this.padding + row * this.cell
      }
    },

    /** 画布坐标 -> 行列（含容错） */
    xyToPos(x, y) {
      const col = Math.round((x - this.padding) / this.cell)
      const row = Math.round((y - this.padding) / this.cell)
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
      // 容错：点击点距交叉点过远则无效
      const p = this.posToXY(row, col)
      const dist = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2)
      if (dist > this.cell * 0.6) return null
      return { row, col }
    },

    draw() {
      const ctx = uni.createCanvasContext('boardCanvas', this)
      this.drawBoard(ctx)
      this.drawMarks(ctx)
      this.drawPieces(ctx)
      ctx.draw()
    },

    /** 绘制棋盘网格、河界、九宫斜线 */
    drawBoard(ctx) {
      const { padding: pd, cell: cs, boardW: W, boardH: H } = this

      // 背景
      ctx.setFillStyle('#F0D9A7')
      ctx.fillRect(0, 0, W, H)

      ctx.setStrokeStyle('#8B5A2B')
      ctx.setLineWidth(1)

      // 横线 10 条
      for (let r = 0; r < ROWS; r++) {
        const y = pd + r * cs
        ctx.beginPath()
        ctx.moveTo(pd, y)
        ctx.lineTo(pd + cs * (COLS - 1), y)
        ctx.stroke()
      }

      // 竖线 9 条（中间 7 条在河界处断开）
      for (let c = 0; c < COLS; c++) {
        const x = pd + c * cs
        if (c === 0 || c === COLS - 1) {
          ctx.beginPath()
          ctx.moveTo(x, pd)
          ctx.lineTo(x, pd + cs * (ROWS - 1))
          ctx.stroke()
        } else {
          // 上半：row0..4
          ctx.beginPath()
          ctx.moveTo(x, pd)
          ctx.lineTo(x, pd + cs * 4)
          ctx.stroke()
          // 下半：row5..9
          ctx.beginPath()
          ctx.moveTo(x, pd + cs * 5)
          ctx.lineTo(x, pd + cs * 9)
          ctx.stroke()
        }
      }

      // 九宫斜线（黑方 row0-2，红方 row7-9，col3-5）
      const palaces = [[0, 2], [7, 9]]
      palaces.forEach(([r1, r2]) => {
        const a = this.posToXY(r1, 3), b = this.posToXY(r2, 5)
        const c = this.posToXY(r1, 5), d = this.posToXY(r2, 3)
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke()
      })

      // 河界文字
      ctx.setFillStyle('#8B5A2B')
      ctx.setFontSize(Math.max(12, cs * 0.42))
      ctx.setTextAlign('center')
      ctx.setTextBaseline('middle')
      const midY = pd + cs * 4.5
      ctx.fillText('楚', pd + cs * 1.2, midY)
      ctx.fillText('河', pd + cs * 2.4, midY)
      ctx.fillText('汉', pd + cs * 5.6, midY)
      ctx.fillText('界', pd + cs * 6.8, midY)
    },

    /** 绘制选中框、可走点、上一步、提示 */
    drawMarks(ctx) {
      const cs = this.cell

      // 上一步起落点
      if (this.lastMove) {
        ctx.setStrokeStyle('#4A90D9')
        ctx.setLineWidth(2)
        ;[this.lastMove.from, this.lastMove.to].forEach(p => {
          const { x, y } = this.posToXY(p.row, p.col)
          const r = cs * 0.42
          ctx.strokeRect(x - r, y - r, r * 2, r * 2)
        })
      }

      // 提示箭头（绿色）
      if (this.hintMove) {
        const a = this.posToXY(this.hintMove.from.row, this.hintMove.from.col)
        const b = this.posToXY(this.hintMove.to.row, this.hintMove.to.col)
        ctx.setStrokeStyle('#2ECC71')
        ctx.setLineWidth(3)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      // 选中棋子
      if (this.selected) {
        const { x, y } = this.posToXY(this.selected.row, this.selected.col)
        ctx.setStrokeStyle('#E74C3C')
        ctx.setLineWidth(3)
        ctx.beginPath()
        ctx.arc(x, y, cs * 0.44, 0, Math.PI * 2)
        ctx.stroke()
      }

      // 可落子点
      this.legalTargets.forEach(t => {
        const { x, y } = this.posToXY(t.row, t.col)
        const occupied = !!this.board[t.row * COLS + t.col]
        if (occupied) {
          // 可吃子：红圈
          ctx.setStrokeStyle('#E74C3C')
          ctx.setLineWidth(2)
          ctx.beginPath()
          ctx.arc(x, y, cs * 0.44, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          // 空位：小圆点
          ctx.setFillStyle('rgba(46,204,113,0.65)')
          ctx.beginPath()
          ctx.arc(x, y, cs * 0.14, 0, Math.PI * 2)
          ctx.fill()
        }
      })
    },

    /** 绘制棋子 */
    drawPieces(ctx) {
      const cs = this.cell
      const r = cs * 0.42

      for (let i = 0; i < this.board.length; i++) {
        const p = this.board[i]
        if (!p) continue
        const row = Math.floor(i / COLS), col = i % COLS
        const { x, y } = this.posToXY(row, col)
        const isRed = pieceSide(p) === RED

        // 棋子底（模拟木质）
        ctx.setFillStyle('#FFF8E7')
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()

        // 外圈
        ctx.setStrokeStyle(isRed ? '#C0392B' : '#2C3E50')
        ctx.setLineWidth(2)
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.stroke()

        // 内圈
        ctx.setLineWidth(1)
        ctx.beginPath()
        ctx.arc(x, y, r * 0.82, 0, Math.PI * 2)
        ctx.stroke()

        // 字
        ctx.setFillStyle(isRed ? '#C0392B' : '#2C3E50')
        ctx.setFontSize(r * 1.1)
        ctx.setTextAlign('center')
        ctx.setTextBaseline('middle')
        ctx.fillText(PIECE_NAMES[p] || p, x, y)
      }
    },

    /* ============ 交互：点击走子 ============ */

    onTouch(e) {
      if (this.gameOver || this.thinking) return
      if (this.currentSide !== RED) return   // 只能控制红方

      const t = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches[0]
      if (!t) return
      const pos = this.xyToPos(t.x, t.y)
      if (!pos) return

      this.hintMove = null
      const piece = this.board[pos.row * COLS + pos.col]

      // 已选中时：尝试落子
      if (this.selected) {
        const isTarget = this.legalTargets.some(m => m.row === pos.row && m.col === pos.col)
        if (isTarget) {
          this.doMove(this.selected, pos)
          return
        }
        // 点到自己另一个子：换选
        if (piece && pieceSide(piece) === RED) {
          this.selectPiece(pos)
          return
        }
        // 其他：取消选中
        this.selected = null
        this.legalTargets = []
        this.draw()
        return
      }

      // 未选中：选自己的子
      if (piece && pieceSide(piece) === RED) {
        this.selectPiece(pos)
      }
    },

    selectPiece(pos) {
      this.selected = pos
      this.legalTargets = genLegalMoves(this.board, pos.row, pos.col)
      this.draw()
    },

    /** 执行一步走子（含记谱、切手、裁决） */
    doMove(from, to) {
      const boardBefore = this.board.slice()
      const side = this.currentSide
      const chinese = moveToChinese(boardBefore, from, to)
      const uci = moveToUci(from, to)

      this.board = applyMoveToBoard(this.board, from, to)
      this.history.push({ side, uci, chinese, boardBefore, from, to })
      this.uciMoves.push(uci)
      this.lastMove = { from, to }
      this.selected = null
      this.legalTargets = []
      this.currentSide = side === RED ? BLACK : RED
      this.draw()

      // 裁决局面
      const res = judgeResult(this.board, this.currentSide)
      if (res !== GAME_RESULT.PLAYING) {
        this.endGame(res)
        return
      }

      // 轮到引擎
      if (this.currentSide === BLACK) {
        this.engineTurn()
      }
    },

    /* ============ 引擎应招 ============ */

    async engineTurn() {
      if (!this.engineReady) {
        // 引擎不可用时的降级：随机合法走法（仅保证可玩）
        this.fallbackMove()
        return
      }
      this.thinking = true
      const res = await engine.think(INITIAL_FEN, this.uciMoves)
      this.thinking = false

      if (!res.success || !res.bestmove) {
        this.fallbackMove()
        return
      }
      const mv = this.parseUci(res.bestmove)
      if (!mv) {
        this.fallbackMove()
        return
      }
      // 安全校验：引擎返回的着法也要过规则层
      const legal = genLegalMoves(this.board, mv.from.row, mv.from.col)
        .some(m => m.row === mv.to.row && m.col === mv.to.col)
      if (!legal) {
        console.warn('引擎返回非法着法:', res.bestmove)
        this.fallbackMove()
        return
      }
      this.doMove(mv.from, mv.to)
    },

    /** UCI 字符串 -> 内部坐标 */
    parseUci(uci) {
      if (!uci || uci.length < 4) return null
      const files = 'abcdefghi'
      const fc = files.indexOf(uci[0])
      const fr = parseInt(uci[1], 10)
      const tc = files.indexOf(uci[2])
      const tr = parseInt(uci[3], 10)
      if (fc < 0 || tc < 0 || isNaN(fr) || isNaN(tr)) return null
      return {
        from: { row: ROWS - 1 - fr, col: fc },
        to: { row: ROWS - 1 - tr, col: tc }
      }
    },

    /** 引擎不可用时的傅底走法 */
    fallbackMove() {
      const moves = genAllLegalMoves(this.board, this.currentSide)
      if (!moves.length) {
        this.endGame(judgeResult(this.board, this.currentSide))
        return
      }
      // 优先吃子
      const captures = moves.filter(m => !!this.board[m.to.row * COLS + m.to.col])
      const pool = captures.length ? captures : moves
      const pick = pool[Math.floor(Math.random() * pool.length)]
      setTimeout(() => this.doMove(pick.from, pick.to), 300)
    },

    endGame(result) {
      this.result = result
      this.gameOver = true
      this.thinking = false
      engine.stop()
    },

    /* ============ 操作按钮 ============ */

    /** 悔棋：退回两步（引擎+自己） */
    onUndo() {
      if (this.thinking) {
        uni.showToast({ title: '引擎思考中', icon: 'none' })
        return
      }
      if (!this.history.length) {
        uni.showToast({ title: '无可悔棋', icon: 'none' })
        return
      }
      // 退到上一次轮到红方的局面
      let steps = 0
      while (this.history.length && steps < 2) {
        const last = this.history.pop()
        this.uciMoves.pop()
        this.board = last.boardBefore
        this.currentSide = last.side
        steps++
        if (last.side === RED) break
      }
      this.gameOver = false
      this.result = GAME_RESULT.PLAYING
      this.selected = null
      this.legalTargets = []
      this.hintMove = null
      const h = this.history[this.history.length - 1]
      this.lastMove = h ? { from: h.from, to: h.to } : null
      this.draw()
    },

    /** 提示：用较高强度算一步 */
    async onHint() {
      if (this.gameOver || this.thinking) return
      if (this.currentSide !== RED) return
      if (!this.engineReady) {
        uni.showToast({ title: '引擎未就绪', icon: 'none' })
        return
      }
      uni.showLoading({ title: '分析中…' })
      const res = await engine.hint(INITIAL_FEN, this.uciMoves)
      uni.hideLoading()
      if (res.success && res.bestmove) {
        this.hintMove = this.parseUci(res.bestmove)
        this.draw()
      } else {
        uni.showToast({ title: '无推荐着法', icon: 'none' })
      }
    },

    onRestart() {
      this.showMenu = false
      engine.stop()
      engine.newGame()
      this.resetGame()
    },

    changeDifficulty() {
      this.showMenu = false
      const items = DIFFICULTY_LEVELS.map(l => `${l.name}（${l.desc}）`)
      uni.showActionSheet({
        itemList: items,
        success: r => {
          const lv = DIFFICULTY_LEVELS[r.tapIndex]
          if (!lv) return
          this.difficultyId = lv.id
          engine.setDifficulty(lv.id)
          uni.showToast({ title: `已切换：${lv.name}`, icon: 'none' })
        }
      })
    },

    goBack() {
      engine.stop()
      uni.navigateBack()
    }
  }
}
