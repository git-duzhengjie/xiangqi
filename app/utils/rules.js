/**
 * rules.js  --  中国象棋规则引擎（纯 JS，无副作用）
 *
 * 职责：
 *   1. FEN <-> 棋盘数组 互转
 *   2. 七种棋子的走法生成（含马腿、象眼、炮翻山、兵过河）
 *   3. 将军 / 应将 / 绝杀 / 困毙 判定
 *   4. 白脸将（双将对面）非法判定
 *   5. 中文记谱生成
 *
 * 说明：本文件只做规则裁决，不含 AI 搜索。AI 由 Pikafish 引擎负责。
 */

import {
  COLS, ROWS, RED, BLACK, INITIAL_FEN, GAME_RESULT,
  inPalace, inOwnHalf, crossedRiver, inBoard,
  pieceSide, pieceType, isSameSide, PIECE_NAMES
} from './constants.js'

/* ==========================================================
 *  一、FEN 解析与生成
 * ========================================================== */

/**
 * FEN -> { board: Array(90), side, halfMove, fullMove }
 * board 索引 = row * 9 + col，row0 为黑方底线
 */
export function parseFen(fen) {
  const parts = (fen || INITIAL_FEN).trim().split(/\s+/)
  const layout = parts[0]
  const side = parts[1] === 'b' ? BLACK : RED
  const halfMove = parseInt(parts[4], 10) || 0
  const fullMove = parseInt(parts[5], 10) || 1

  const board = new Array(COLS * ROWS).fill(null)
  const rows = layout.split('/')

  for (let r = 0; r < rows.length && r < ROWS; r++) {
    let c = 0
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        c += parseInt(ch, 10)
      } else {
        if (c < COLS) board[r * COLS + c] = ch
        c++
      }
    }
  }
  return { board, side, halfMove, fullMove }
}

/** { board, side, halfMove, fullMove } -> FEN */
export function toFen(state) {
  const { board, side, halfMove = 0, fullMove = 1 } = state
  const rows = []
  for (let r = 0; r < ROWS; r++) {
    let line = ''
    let empty = 0
    for (let c = 0; c < COLS; c++) {
      const p = board[r * COLS + c]
      if (p) {
        if (empty > 0) { line += empty; empty = 0 }
        line += p
      } else {
        empty++
      }
    }
    if (empty > 0) line += empty
    rows.push(line)
  }
  return `${rows.join('/')} ${side === RED ? 'w' : 'b'} - - ${halfMove} ${fullMove}`
}

/** 生成初始局面 */
export function initialState() {
  return parseFen(INITIAL_FEN)
}

/* ==========================================================
 *  二、辅助查询
 * ========================================================== */

function at(board, row, col) {
  if (!inBoard(row, col)) return undefined
  return board[row * COLS + col]
}

/** 找到某方将/帅的位置，返回 {row,col} 或 null */
export function findKing(board, side) {
  const target = side === RED ? 'K' : 'k'
  for (let i = 0; i < board.length; i++) {
    if (board[i] === target) {
      return { row: Math.floor(i / COLS), col: i % COLS }
    }
  }
  return null
}

/** 统计两点之间（同行或同列）的棋子数，不含两端 */
function countBetween(board, a, b) {
  let cnt = 0
  if (a.row === b.row) {
    const lo = Math.min(a.col, b.col), hi = Math.max(a.col, b.col)
    for (let c = lo + 1; c < hi; c++) if (at(board, a.row, c)) cnt++
  } else if (a.col === b.col) {
    const lo = Math.min(a.row, b.row), hi = Math.max(a.row, b.row)
    for (let r = lo + 1; r < hi; r++) if (at(board, r, a.col)) cnt++
  } else {
    return -1
  }
  return cnt
}

/* ==========================================================
 *  三、单个棋子的走法生成（不考虑是否自将，纯几何规则）
 * ========================================================== */

/** 帅/将：九宫内直走一步 */
function genKingMoves(board, row, col, side) {
  const res = []
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (const [dr, dc] of dirs) {
    const r = row + dr, c = col + dc
    if (!inBoard(r, c) || !inPalace(r, c, side)) continue
    const t = at(board, r, c)
    if (!t || pieceSide(t) !== side) res.push({ row: r, col: c })
  }
  return res
}

/** 仕/士：九宫内斜走一步 */
function genAdvisorMoves(board, row, col, side) {
  const res = []
  const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  for (const [dr, dc] of dirs) {
    const r = row + dr, c = col + dc
    if (!inBoard(r, c) || !inPalace(r, c, side)) continue
    const t = at(board, r, c)
    if (!t || pieceSide(t) !== side) res.push({ row: r, col: c })
  }
  return res
}

/** 相/象：走田字，不可过河，象眼被堵则不可行 */
function genBishopMoves(board, row, col, side) {
  const res = []
  const dirs = [[-2, -2], [-2, 2], [2, -2], [2, 2]]
  for (const [dr, dc] of dirs) {
    const r = row + dr, c = col + dc
    if (!inBoard(r, c)) continue
    if (!inOwnHalf(r, side)) continue          // 相/象不可过河
    // 象眼（田字中心）
    if (at(board, row + dr / 2, col + dc / 2)) continue
    const t = at(board, r, c)
    if (!t || pieceSide(t) !== side) res.push({ row: r, col: c })
  }
  return res
}

/** 马：走日字，蹭马腿则不可行 */
function genKnightMoves(board, row, col, side) {
  const res = []
  // [目标偏移, 马腿偏移]
  const moves = [
    [-2, -1, -1, 0], [-2, 1, -1, 0],
    [2, -1, 1, 0], [2, 1, 1, 0],
    [-1, -2, 0, -1], [1, -2, 0, -1],
    [-1, 2, 0, 1], [1, 2, 0, 1]
  ]
  for (const [dr, dc, lr, lc] of moves) {
    const r = row + dr, c = col + dc
    if (!inBoard(r, c)) continue
    if (at(board, row + lr, col + lc)) continue // 马腿被堵
    const t = at(board, r, c)
    if (!t || pieceSide(t) !== side) res.push({ row: r, col: c })
  }
  return res
}

/** 车：直线滑动，遇子停，可吃异方 */
function genRookMoves(board, row, col, side) {
  const res = []
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (const [dr, dc] of dirs) {
    let r = row + dr, c = col + dc
    while (inBoard(r, c)) {
      const t = at(board, r, c)
      if (!t) {
        res.push({ row: r, col: c })
      } else {
        if (pieceSide(t) !== side) res.push({ row: r, col: c })
        break
      }
      r += dr; c += dc
    }
  }
  return res
}

/** 炮：空走同车；吃子需隔一个棋子（翻山） */
function genCannonMoves(board, row, col, side) {
  const res = []
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (const [dr, dc] of dirs) {
    let r = row + dr, c = col + dc
    // 阶段1：未遇炮架，只能走空格
    while (inBoard(r, c) && !at(board, r, c)) {
      res.push({ row: r, col: c })
      r += dr; c += dc
    }
    // 阶段2：越过炮架，寻找第一个棋子
    if (!inBoard(r, c)) continue
    r += dr; c += dc
    while (inBoard(r, c)) {
      const t = at(board, r, c)
      if (t) {
        if (pieceSide(t) !== side) res.push({ row: r, col: c })
        break
      }
      r += dr; c += dc
    }
  }
  return res
}

/** 兵/卒：向前一步；过河后可左右横走，不可后退 */
function genPawnMoves(board, row, col, side) {
  const res = []
  const forward = side === RED ? -1 : 1  // 红方向上(row 减小)
  const cands = [[forward, 0]]
  if (crossedRiver(row, side)) {
    cands.push([0, -1], [0, 1])
  }
  for (const [dr, dc] of cands) {
    const r = row + dr, c = col + dc
    if (!inBoard(r, c)) continue
    const t = at(board, r, c)
    if (!t || pieceSide(t) !== side) res.push({ row: r, col: c })
  }
  return res
}

/**
 * 生成指定位置棋子的所有几何走法（未过滤自将）
 */
export function genPieceMoves(board, row, col) {
  const p = at(board, row, col)
  if (!p) return []
  const side = pieceSide(p)
  switch (pieceType(p)) {
    case 'k': return genKingMoves(board, row, col, side)
    case 'a': return genAdvisorMoves(board, row, col, side)
    case 'b': return genBishopMoves(board, row, col, side)
    case 'n': return genKnightMoves(board, row, col, side)
    case 'r': return genRookMoves(board, row, col, side)
    case 'c': return genCannonMoves(board, row, col, side)
    case 'p': return genPawnMoves(board, row, col, side)
    default: return []
  }
}

/* ==========================================================
 *  四、将军 / 合法性 / 胜负判定
 * ========================================================== */

/**
 * 判断 side 方的将/帅是否正在被攻击（被将军）
 */
export function isKingInCheck(board, side) {
  const king = findKing(board, side)
  if (!king) return true   // 将already被吃，视为死局

  const enemy = side === RED ? BLACK : RED

  // 遍历所有敌方棋子，看是否有走法能吃到我方将
  for (let i = 0; i < board.length; i++) {
    const p = board[i]
    if (!p || pieceSide(p) !== enemy) continue
    const r = Math.floor(i / COLS), c = i % COLS
    const moves = genPieceMoves(board, r, c)
    for (const m of moves) {
      if (m.row === king.row && m.col === king.col) return true
    }
  }
  return false
}

/**
 * 白脸将（对脸将）：双方将/帅同列且中间无子 —— 非法局面
 */
export function isKingsFacing(board) {
  const rk = findKing(board, RED)
  const bk = findKing(board, BLACK)
  if (!rk || !bk) return false
  if (rk.col !== bk.col) return false
  return countBetween(board, rk, bk) === 0
}

/** 在棋盘副本上执行一步走子，返回新 board */
export function applyMoveToBoard(board, from, to) {
  const nb = board.slice()
  nb[to.row * COLS + to.col] = nb[from.row * COLS + from.col]
  nb[from.row * COLS + from.col] = null
  return nb
}

/**
 * 生成某个棋子的全部【合法】走法
 * 过滤掉：走完后自己被将军、或形成白脸将
 */
export function genLegalMoves(board, row, col) {
  const p = at(board, row, col)
  if (!p) return []
  const side = pieceSide(p)
  const from = { row, col }

  return genPieceMoves(board, row, col).filter(to => {
    const nb = applyMoveToBoard(board, from, to)
    if (isKingsFacing(nb)) return false
    if (isKingInCheck(nb, side)) return false
    return true
  })
}

/**
 * 生成某一方所有合法走法
 * 返回 [{ from:{row,col}, to:{row,col} }, ...]
 */
export function genAllLegalMoves(board, side) {
  const res = []
  for (let i = 0; i < board.length; i++) {
    const p = board[i]
    if (!p || pieceSide(p) !== side) continue
    const r = Math.floor(i / COLS), c = i % COLS
    for (const to of genLegalMoves(board, r, c)) {
      res.push({ from: { row: r, col: c }, to })
    }
  }
  return res
}

/**
 * 判断某步是否合法
 */
export function isLegalMove(board, from, to) {
  return genLegalMoves(board, from.row, from.col)
    .some(m => m.row === to.row && m.col === to.col)
}

/**
 * 局面裁决：返回 GAME_RESULT
 * 无合法走法 = 被绝杀或困毙，均判负（中国象棋规则：困毙同样算输）
 */
export function judgeResult(board, side) {
  const moves = genAllLegalMoves(board, side)
  if (moves.length > 0) return GAME_RESULT.PLAYING
  // 无棋可走：该方输
  return side === RED ? GAME_RESULT.BLACK_WIN : GAME_RESULT.RED_WIN
}

/** 是否绝杀（被将且无解） */
export function isCheckmate(board, side) {
  return isKingInCheck(board, side) && genAllLegalMoves(board, side).length === 0
}

/** 是否困毙（未被将但无棋可走） */
export function isStalemate(board, side) {
  return !isKingInCheck(board, side) && genAllLegalMoves(board, side).length === 0
}

/* ==========================================================
 *  五、中文记谱
 * ========================================================== */

const CN_NUM_RED = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CN_NUM_BLACK = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９']

/** 列号 -> 中文纵线号（红方从右往左数，黑方从左往右数） */
function fileLabel(col, side) {
  return side === RED ? CN_NUM_RED[COLS - col] : CN_NUM_BLACK[col + 1]
}

/**
 * 生成中文记谱，如「炮二平五」「马8进7」
 * @param board 走子【前】的棋盘
 */
export function moveToChinese(board, from, to) {
  const p = at(board, from.row, from.col)
  if (!p) return ''
  const side = pieceSide(p)
  const name = PIECE_NAMES[p]
  const type = pieceType(p)

  // 同列同类多子时需用 前/后 区分
  let prefix = ''
  const sameCol = []
  for (let r = 0; r < ROWS; r++) {
    if (at(board, r, from.col) === p) sameCol.push(r)
  }
  if (sameCol.length > 1 && type !== 'k') {
    // 红方视角：row 小者在前（靠敌方）
    const sorted = side === RED ? sameCol.slice().sort((a, b) => a - b)
                               : sameCol.slice().sort((a, b) => b - a)
    const idx = sorted.indexOf(from.row)
    prefix = idx === 0 ? '前' : (idx === sorted.length - 1 ? '后' : '中')
  }

  const head = prefix ? prefix + name : name + fileLabel(from.col, side)

  // 纵向位移方向
  const forward = side === RED ? -1 : 1
  const dRow = to.row - from.row

  if (dRow === 0) {
    return `${head}平${fileLabel(to.col, side)}`
  }
  const isForward = (dRow * forward) > 0
  const verb = isForward ? '进' : '退'

  // 斜行棋子（马/相/仕）报目标纵线；直行棋子报步数
  if (type === 'n' || type === 'b' || type === 'a') {
    return `${head}${verb}${fileLabel(to.col, side)}`
  }
  const steps = Math.abs(dRow)
  const stepLabel = side === RED ? CN_NUM_RED[steps] : CN_NUM_BLACK[steps]
  return `${head}${verb}${stepLabel}`
}
