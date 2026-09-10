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
          best = this.searchBest(this.board, BLACK, 4)
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
     * 搜索最佳着法。
     * @param {Array} board 当前棋盘
     * @param {string} side  走子方
     * @param {number} depth 搜索层数
     * @returns {{from,to}|null}
     */
    searchBest(board, side, depth) {
      const moves = genAllLegalMoves(board, side)
      if (!moves.length) return null

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
      if (depth <= 0) return this.evalBoard(board, side)

      let best = -Infinity
      for (const mv of moves) {
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
        score += (pieceSide(p) === side) ? v : -v
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
