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
  RED, BLACK, INITIAL_FEN, DIFFICULTY_LEVELS, ENDGAME_ENGINE, GAME_RESULT,
  COLS, ROWS, PIECE_NAMES, pieceSide, moveToUci
} from '@/utils/constants.js'
import {
  parseFen, toFen, initialState, genLegalMoves, genAllLegalMoves,
  applyMoveToBoard, isKingInCheck, isCheckmate, judgeResult, moveToChinese
} from '@/utils/rules.js'
import { ENDGAME_GOAL, findEndgame } from '@/utils/endgames.js'
import engine from '@/utils/engine.js'
import sound from '@/utils/sound.js'

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
      difficultyId: 2,

      // ---- 残局挑战 ----
      // startFen 是本局起始局面。普通对局为 INITIAL_FEN，残局为该局 FEN。
      // 必须单独保存：引擎的 think/hint 都以「起始局面 + 着法序列」推演，
      // 原代码这两处写死 INITIAL_FEN，残局下会让引擎与实际棋盘完全脱节。
      startFen: INITIAL_FEN,
      endgame: null,          // 当前残局对象，普通对局为 null
      showMenu: false,
      showMoves: false,
      engineMsg: '',
      engineReady: false,
      hintMove: null,
      soundOn: true
    }
  },

  computed: {
    difficultyName() {
      // 残局显示局名与目标，比显示「难度：困难」更有信息量：
      // 残局固定最高难度，显示难度等于没有区分度，
      // 而「取胜 / 守和」是用户全程需要记住的目标。
      if (this.endgame) {
        const target = this.endgame.goal === ENDGAME_GOAL.DRAW ? '守和' : '取胜'
        return `${this.endgame.name}（${target}）`
      }
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
      // 残局的胜负含义与普通对局不同：守和类残局里「和棋」就是过关。
      // 直接沿用普通文案会把过关显示成中性的「和棋」，用户无法判断成败。
      if (this.endgame) {
        return this.endgamePassed ? '🏆 挑战成功！' : '💔 挑战失败'
      }
      switch (this.result) {
        case GAME_RESULT.RED_WIN: return '🎉 您赢了！'
        case GAME_RESULT.BLACK_WIN: return '😢 您输了'
        case GAME_RESULT.DRAW: return '🤝 和棋'
        default: return ''
      }
    },

    /**
     * 残局是否达成目标。
     *
     * 取胜类（win） —— 只有红胜算过关，和棋与输棋都算失败。
     * 守和类（draw）—— 和棋是正解，红胜自然更好，只有被将死才失败。
     *
     * 古谱名局的正解并非都是取胜（如七星聚会的正解就是和棋），
     * 若一律要求取胜反而违背棋理，所以每局各自标注目标。
     */
    endgamePassed() {
      if (!this.endgame) return false
      if (this.endgame.goal === ENDGAME_GOAL.DRAW) {
        return this.result === GAME_RESULT.DRAW ||
               this.result === GAME_RESULT.RED_WIN
      }
      return this.result === GAME_RESULT.RED_WIN
    },

    resultSub() {
      if (this.endgame) {
        const target = this.endgame.goal === ENDGAME_GOAL.DRAW ? '守和' : '取胜'
        if (this.endgamePassed) {
          return `「${this.endgame.name}」${target}成功，共 ${this.history.length} 步`
        }
        // 失败时把目标说清楚，否则用户不知道自己差在哪里
        const why = this.result === GAME_RESULT.DRAW ? '本局需要取胜，和棋不算过关' : '再试一次'
        return `目标：${target}。${why}`
      }
      const lv = DIFFICULTY_LEVELS.find(l => l.id === this.difficultyId)
      const name = lv ? lv.name : ''
      if (this.result === GAME_RESULT.RED_WIN) return `战胜「${name}」难度，共 ${this.history.length} 步`
      if (this.result === GAME_RESULT.BLACK_WIN) return `再接再厉，共 ${this.history.length} 步`
      return `共 ${this.history.length} 步`
    }
  },

  onLoad(options) {
    // 残局优先。残局固定使用最高难度：少子局面下弱引擎容易随手放水，
    // 那样"过关"就没有意义了。
    if (options && options.endgame) {
      const eg = findEndgame(options.endgame)
      if (eg) {
        this.endgame = eg
        this.startFen = eg.fen
        // 用残局专用参数，不取难度表最后一档。
        // 残局是极端缺子局面，depth=10 深搜收益很小却最容易让原生引擎
        // 出问题（实测走一步即导致模拟器进程崩溃，而 JS 规则层
        // 36 个着法全链路零异常，问题在原生搜索侧）。
        this.difficultyId = ENDGAME_ENGINE.id
      }
    } else if (options && options.level) {
      this.difficultyId = parseInt(options.level, 10) || 2
    }
    this.initBoardSize()
    // 预加载音效：不预载也能响，但首声会有延迟，落子手感会"慢半拍"
    sound.preload()
    this.soundOn = sound.isEnabled()
    this.resetGame()
    this.setupEngine()
  },

  onUnload() {
    engine.stop()
    // innerAudioContext 是原生资源，不释放会泄漏
    sound.destroy()
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
      // 权重已随包内置，无需征询下载、也不跑流量，直接启动即可。
      this.engineMsg = '引擎加载中…'
      const res = await engine.init({
        // 阶段回调：一直停在「引擎加载中…」时看不出卡在哪一步，
        // 把当前步骤显示出来，用户截个图就能定位
        onStage: (s) => {
          this.engineMsg = '引擎加载中：' + s
        }
      })
      if (res.success) {
        this.engineReady = true
        engine.setDifficulty(this.difficultyId)
        engine.newGame()
        this.engineMsg = '引擎就绪 ✓'
        setTimeout(() => { this.engineMsg = '' }, 1500)
      } else if (res.timeout) {
        // 超时单独提示并带出阶段名，避免只给一个笼统的失败
        this.engineMsg = '引擎启动超时（卡在：' + (res.stage || '未知') + '），请重试'
        setTimeout(() => { this.engineMsg = '' }, 8000)
      } else {
        this.engineMsg = '引擎失败：' + (res.error || '未知')
        setTimeout(() => { this.engineMsg = '' }, 5000)
      }
    },

    resetGame() {
      // 残局要还原到该残局的起始局面，不能用 initialState()（标准开局）。
      const st = this.endgame ? parseFen(this.startFen) : initialState()
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
      sound.playSelect()
      this.draw()
    },

    /** 执行一步走子（含记谱、切手、裁决） */
    doMove(from, to) {
      const boardBefore = this.board.slice()
      const side = this.currentSide
      const chinese = moveToChinese(boardBefore, from, to)
      const uci = moveToUci(from, to)

      // 落子音要在改动棋盘【之前】判断是否吃子：
      // applyMoveToBoard 执行后目标格必然有子，那时已分不出是吃子还是平移
      const isCapture = !!boardBefore[to.row * COLS + to.col]

      this.board = applyMoveToBoard(this.board, from, to)
      this.history.push({ side, uci, chinese, boardBefore, from, to })
      this.uciMoves.push(uci)
      this.lastMove = { from, to }
      this.selected = null
      this.legalTargets = []
      this.currentSide = side === RED ? BLACK : RED
      this.draw()

      sound.playMove(isCapture)

      // 裁决局面
      const res = judgeResult(this.board, this.currentSide)
      if (res !== GAME_RESULT.PLAYING) {
        this.endGame(res)
        return
      }

      // 将军提示音：错开落子声，否则两声叠在一起听不清
      if (isKingInCheck(this.board, this.currentSide)) {
        setTimeout(() => sound.playCheck(), 220)
      }

      // 轮到引擎
      if (this.currentSide === BLACK) {
        this.engineTurn()
      }
    },

    /* ============ 引擎应招 ============ */

    async engineTurn() {
      // 残局一律使用纯 JS 搜索，不碰原生引擎。
      //
      // 已确认的两个事实：
      //   1. 崩溃在原生层 —— 模拟器整个进程挂掉，JS 异常做不到；
      //   2. JS 规则层干净 —— 4 个残局 36 个着法全链路零异常
      //      （scripts/repro-endgame-crash.cjs）。
      // 根因尚未证实（设备离线抓不到 logcat），所以不去赌参数，
      // 而是让残局彻底不依赖原生引擎：只要不调用它，就不会被它拖垮。
      //
      // 残局子力少、分支因子小，本地 alpha-beta 搜到 4 层已经很强，
      // 且是毫秒级，完全够用。普通对局仍走原生 Pikafish，棋力不变。
      if (this.endgame) {
        this.localEngineTurn()
        return
      }

      if (!this.engineReady) {
        // 引擎不可用时的降级：随机合法走法（仅保证可玩）
        this.fallbackMove()
        return
      }
      this.thinking = true

      // 引擎调用整体包 try。
      // 残局下实测走一步会让整个模拟器崩溃，而 JS 规则层已验证完全干净
      // （4 个残局 36 个着法全链路零异常），说明问题在原生搜索侧。
      // 原生崩溃 JS 拦不住，但至少要做到：
      //   1) 异常时不把 thinking 永久置 true，否则页面永远卡在「思考中」；
      //   2) 任何异常都降级到纯 JS 的 fallbackMove，保证对局能继续。
      let res = null
      try {
        res = await engine.think(this.startFen, this.uciMoves)
      } catch (e) {
        console.warn('[game] 引擎 think 异常，降级为本地走法', e)
        this.thinking = false
        this.fallbackMove()
        return
      }
      this.thinking = false

      if (!res || !res.success || !res.bestmove) {
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

    /**
     * 残局专用的本地搜索（alpha-beta 极小化极大）。
     *
     * 只在残局使用，不参与普通对局 —— 普通对局的开局与中局分支因子大，
     * 纯 JS 搜索深度上不去，棋力不如原生 Pikafish。
     * 但残局子力极少，4 层搜索配合子力价值评估已经相当准，
     * 而且完全不依赖原生层，不会被原生崩溃影响。
     */
    localEngineTurn() {
      this.thinking = true
      // 让出一帧再算，否则"思考中"提示来不及渲染，界面像卡住
      setTimeout(() => {
        let best = null
        try {
          // 旧版固定 4 层。四大名局是 7~8 子的复杂局面，4 层远远不够，
          // 改为迭代加深：在时限内尽可能往深里搜。
          best = this.searchIterative(this.board, BLACK, 1200)
        } catch (e) {
          console.warn('[game] 本地搜索异常，降级为随机走法', e)
        }
        this.thinking = false
        if (best && best.from && best.to) {
          this.doMove(best.from, best.to)
        } else {
          // 搜索没结果说明已无着可走，交给 fallback 去裁决终局
          this.fallbackMove()
        }
      }, 50)
    },

    /**
     * 迭代加深搜索入口。
     *
     * 从 2 层开始逐层加深，每完成一层就检查是否超时；
     * 超时则返回上一层已完成的最优着法（这是迭代加深的核心优势：
     * 任何时刻中断都有一个完整可用的结果）。
     *
     * 至少保证跑完 4 层，避免时限太紧反而比旧版更弱。
     *
     * @param {Array} board 当前棋盘
     * @param {string} side 走子方
     * @param {number} timeLimit 时间上限（毫秒）
     */
    searchIterative(board, side, timeLimit) {
      const start = Date.now()
      let best = null
      const MIN_DEPTH = 4     // 至少搜到 4 层（不低于旧版水平）
      const MAX_DEPTH = 10
      for (let d = 2; d <= MAX_DEPTH; d++) {
        const r = this.searchBest(board, side, d)
        if (r) best = r
        const used = Date.now() - start
        // 已达最低深度且时间用掉一半以上就停：
        // 下一层的耗时通常是本层的 3~5 倍，硬上会明显卡顿
        if (d >= MIN_DEPTH && used > timeLimit / 3) break
      }
      return best
    },

    /**
     * 着法排序（MVV-LVA：最有价值受害者 / 最低价值攻击者）。
     *
     * alpha-beta 的剪枝效率高度依赖搜索顺序：先搜到好棋，
     * 后面的差棋就能大批剪掉。旧版完全不排序，等于把剪枝能力浪费了。
     * 排序后同等时间内通常能多搜 1~2 层，这是提升棋力最省力的一步。
     *
     * 排序依据：优先吃价值高的子，且用价值低的子去吃更好
     * （用兵吃车远优于用车吃兵）。
     */
    sortMoves(moves, board) {
      const M = { k: 50000, r: 900, c: 450, n: 400, b: 150, a: 150, p: 100 }
      const scored = moves.map(mv => {
        const target = board[mv.to.row * COLS + mv.to.col]
        const attacker = board[mv.from.row * COLS + mv.from.col]
        let s = 0
        if (target) {
          s = (M[target.toLowerCase()] || 0)
            - (M[attacker.toLowerCase()] || 0) * 0.1
        }
        return { mv: mv, s: s }
      })
      scored.sort((a, b) => b.s - a.s)
      return scored.map(x => x.mv)
    },

    /**
     * 搜索最佳着法。
     * @param {Array} board 当前棋盘
     * @param {string} side  走子方
     * @param {number} depth 搜索层数
     * @returns {{from,to}|null}
     */
    searchBest(board, side, depth) {
      let moves = genAllLegalMoves(board, side)
      if (!moves.length) return null

      // 排序后搜索，剪枝效率大幅提升
      moves = this.sortMoves(moves, board)

      let bestScore = -Infinity
      let bestMoves = []
      for (const mv of moves) {
        const nb = applyMoveToBoard(board, mv.from, mv.to)
        // 取负：对手视角的最优就是自己视角的最差
        const sc = -this.alphaBeta(nb, side === RED ? BLACK : RED,
          depth - 1, -Infinity, Infinity)
        if (sc > bestScore) {
          bestScore = sc
          bestMoves = [mv]
        } else if (sc === bestScore) {
          // 同分随机，避免每局走得一模一样
          bestMoves.push(mv)
        }
      }
      return bestMoves.length
        ? bestMoves[Math.floor(Math.random() * bestMoves.length)]
        : null
    },

    /** alpha-beta 剪枝搜索，返回 side 视角的分数 */
    alphaBeta(board, side, depth, alpha, beta) {
      const moves = genAllLegalMoves(board, side)
      // 无着可走：被将死或困死，都是极差局面
      if (!moves.length) {
        return isKingInCheck(board, side) ? -100000 - depth : -50000
      }
      // 叶子节点不直接打分，先做静态搜索把兑子过程走完。
      // 旧版在这里直接 evalBoard，会产生「视野效应」：
      // 恰好停在兑子中途时，AI 以为自己净赚一子，实际下一手就被吃回。
      if (depth <= 0) return this.quiesce(board, side, alpha, beta, 0)

      // 深层节点也排序。浅层（depth 1）排序收益小于开销，故跳过。
      const ordered = depth > 1 ? this.sortMoves(moves, board) : moves

      let best = -Infinity
      for (const mv of ordered) {
        const nb = applyMoveToBoard(board, mv.from, mv.to)
        const sc = -this.alphaBeta(nb, side === RED ? BLACK : RED,
          depth - 1, -beta, -alpha)
        if (sc > best) best = sc
        if (best > alpha) alpha = best
        if (alpha >= beta) break        // 剪枝
      }
      return best
    },

    /**
     * 静态搜索：只继续搜索吃子着法，直到局面安静为止。
     *
     * 为什么必须有：主搜索到达指定深度就停下来打分，如果那一刻
     * 正在兑子中途（我方刚吃掉对方车，对方下一手就能吃回我方车），
     * 评估结果会严重偏离真实价值 —— 这就是「视野效应」。
     * 残局子力少，一次这样的误判往往直接输掉。
     *
     * depth 限制：静态搜索理论上会自然收敛（吃子着法有限），
     * 但极端局面下可能很深，故加 6 层上限保护，防止手机上卡死。
     */
    quiesce(board, side, alpha, beta, qd) {
      // stand-pat：不吃子（保持现状）的评分作为下限。
      // 因为走子方总可以选择不进行兑换。
      const standPat = this.evalBoard(board, side)
      if (standPat >= beta) return beta
      if (standPat > alpha) alpha = standPat

      // 上限保护：静态搜索通常几层内收敛，超过 6 层直接返回
      if (qd >= 6) return alpha

      const moves = genAllLegalMoves(board, side)
      if (!moves.length) {
        return isKingInCheck(board, side) ? -100000 : -50000
      }

      // 只保留吃子着法
      const captures = []
      for (const mv of moves) {
        if (board[mv.to.row * COLS + mv.to.col]) captures.push(mv)
      }
      if (!captures.length) return alpha

      const ordered = this.sortMoves(captures, board)
      for (const mv of ordered) {
        const nb = applyMoveToBoard(board, mv.from, mv.to)
        const sc = -this.quiesce(nb, side === RED ? BLACK : RED,
          -beta, -alpha, qd + 1)
        if (sc >= beta) return beta
        if (sc > alpha) alpha = sc
      }
      return alpha
    },

    /**
     * 位置价值加成。
     *
     * 旧版评估只数子力，AI 不知道「车占中线远强于窝在角落」，
     * 于是在子力相等的所有走法里随机选一个，走出来毫无棋理。
     *
     * 这里给出各类子的位置偏好（象棋常识）：
     *   兵卒：过河才有攻击力，越深入越值钱
     *   马  ：边马是弱马，应往中心跳
     *   车  ：占中路与要道
     *   炮  ：需要开阔直线
     * 返回值相对子力价值是小量（几十分），只在子力相等时起决定作用，
     * 不会让 AI 为了占位而丢子。
     *
     * @param {string} p 棋子字符
     * @param {number} row 行（0 = 黑方底线）
     * @param {number} col 列
     */
    positionBonus(p, row, col) {
      const isRedPiece = p === p.toUpperCase()
      const type = p.toLowerCase()
      // 归一化为「自己视角的推进行数」：越大表示越深入敌阵
      const adv = isRedPiece ? (9 - row) : row
      // 距中路的偏离量，0 表示正好在中线
      const offCenter = Math.abs(col - 4)

      if (type === 'p') {
        // 兵卒：未过河几乎没有攻击价值，过河后递增
        const crossed = isRedPiece ? (row <= 4) : (row >= 5)
        if (!crossed) return 0
        return 25 + adv * 12 + (4 - offCenter) * 4
      }
      if (type === 'n') {
        // 马：边马是弱马。col 0/8 扣分，中心加分
        const edgePenalty = (col === 0 || col === 8) ? -20 : 0
        return (4 - offCenter) * 6 + edgePenalty
      }
      if (type === 'r') {
        // 车：占中线与要道
        return (4 - offCenter) * 7 + 8
      }
      if (type === 'c') {
        // 炮：中路炮威力大
        return (4 - offCenter) * 5
      }
      return 0
    },

    /**
     * 局面评估：子力价值 + 行动自由度 + 困死预警。
     * 返回 side 视角的分数，越大越有利。
     *
     * 为何加后两项：
     * 初版只算子力与将军，结果守和残局出现严重问题 ——
     * 同一个局面反复实测，时而守住、时而 10 步被判负。
     * 复盘发现终局是红帅被「困死」（isStalemate：未被将军但无着可走，
     * 象棋规则里同样判负）。
     *
     * 根因在评估函数：它完全不知道「没棋可走」有多危险。
     * 子力相等时所有走法得分一样，于是随机挑一个 ——
     * 可能恰好把帅送进死角。这也解释了为何同一 FEN 两次结果相反：
     * 胜负取决于随机选中哪个同分着法，而不是棋理。
     *
     * 当时我差点继续去换残局摆位（已经换了三版），
     * 但那是治症不治本：真正的缺陷是 AI 会自杀，
     * 换任何局面都会偶发。
     */
    evalBoard(board, side) {
      // 残局里兵的价值被显著放大：过河兵能直接参与攻杀，
      // 且往往是取胜的唯一资本，用开局的兵值会严重低估。
      const VAL = { k: 100000, r: 900, c: 450, n: 400, b: 150, a: 150, p: 180 }
      let score = 0
      for (let i = 0; i < board.length; i++) {
        const p = board[i]
        if (!p) continue
        const v = VAL[p.toLowerCase()] || 0
        // 子力价值 + 位置价值。位置价值是小量，只在子力相等时决定选择，
        // 避免 AI 在所有同子力走法里随机挑一个（旧版就是这样，
        // 走出来毫无棋理，这是「弱智」感的主要来源之一）。
        const pos = this.positionBonus(p, Math.floor(i / COLS), i % COLS)
        score += (pieceSide(p) === side) ? (v + pos) : -(v + pos)
      }

      const opp = side === RED ? BLACK : RED

      // 将军加分，鼓励主动进攻而不是原地磨
      if (isKingInCheck(board, opp)) score += 30
      if (isKingInCheck(board, side)) score -= 30

      // 行动自由度：可走着法越多越安全。
      // 权重取 8，比子力小很多（不会为了多一步选择而丢子），
      // 但足以在子力相等时拉开差距，让 AI 偏好保持腾挪空间。
      const myMoves = genAllLegalMoves(board, side)
      score += myMoves.length * 8

      // 困死预警：只剩很少走法时重罚。
      // 这是守和残局的关键 —— 帅被逐步堵死的过程必须在评估里
      // 提前反映出来，否则搜索要到真的无着可走才发现，那时已经来不及。
      if (myMoves.length <= 2) score -= 800
      if (myMoves.length <= 1) score -= 3000

      return score
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
      // 稍延迟：让最后一步的落子声先放完，避免与结束音打架
      setTimeout(() => sound.playResult(result), 300)
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
      sound.playUndo()
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
      const res = await engine.hint(this.startFen, this.uciMoves)
      uni.hideLoading()
      if (res.success && res.bestmove) {
        this.hintMove = this.parseUci(res.bestmove)
        sound.playHint()
        this.draw()
      } else {
        uni.showToast({ title: '无推荐着法', icon: 'none' })
      }
    },

    onRestart() {
      this.showMenu = false
      sound.playClick()
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

    /** 声音开关：状态持久化，下次进来保持 */
    toggleSound() {
      this.soundOn = sound.toggle()
      // 开启时给一声反馈，让用户确认真的有声了
      if (this.soundOn) sound.playClick()
      uni.showToast({
        title: this.soundOn ? '🔊 音效已开启' : '🔇 音效已关闭',
        icon: 'none',
        duration: 1200
      })
    },

    goBack() {
      sound.playClick()
      engine.stop()
      uni.navigateBack()
    }
  }
}
