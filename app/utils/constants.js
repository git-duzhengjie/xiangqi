/**
 * constants.js  --  中国象棋常量与坐标系定义
 *
 * 【坐标系约定】（与 UCI / FEN 标准一致，务必统一）
 *   - 棋盘 9 列(file a..i) x 10 行(rank 0..9)
 *   - 内部用一维数组 board[90]，索引 idx = row * 9 + col
 *   - row = 0 是黑方底线（上方），row = 9 是红方底线（下方）
 *   - UCI 记谱: 列用 a..i（左到右），行用 0..9（下到上）
 *     故 UCI 的 rank = 9 - row
 *     例：红方炮二平五 h7e7 -> 内部 (row2,col7) -> (row2,col4)
 */

// ---------- 棋盘尺寸 ----------
export const COLS = 9
export const ROWS = 10
export const BOARD_SIZE = COLS * ROWS // 90

// ---------- 阵营 ----------
export const RED = 'r'   // 红方（下方，先行）
export const BLACK = 'b' // 黑方（上方）

// ---------- 棋子类型 ----------
export const KING = 'k'    // 帅/将
export const ADVISOR = 'a' // 仕/士
export const BISHOP = 'b'  // 相/象
export const KNIGHT = 'n'  // 马
export const ROOK = 'r'    // 车
export const CANNON = 'c'  // 炮
export const PAWN = 'p'    // 兵/卒

/**
 * 棋子编码：大写=红方，小写=黑方（与 FEN 一致）
 * K/A/B/N/R/C/P  红
 * k/a/b/n/r/c/p  黑
 */
export const EMPTY = null

// ---------- 棋子中文名 ----------
export const PIECE_NAMES = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒'
}

// ---------- 初始局面 FEN ----------
// 标准开局：黑方在上（小写），红方在下（大写），红先行
export const INITIAL_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

// ---------- 难度配置 ----------
// Pikafish 通过限制搜索深度/时间/技能等级来调节棋力
export const DIFFICULTY_LEVELS = [
  { id: 1, name: '入门', depth: 1,  movetime: 100,  elo: 1000, desc: '适合初学者' },
  { id: 2, name: '简单', depth: 3,  movetime: 200,  elo: 1400, desc: '会吃子，偶有失误' },
  { id: 3, name: '普通', depth: 6,  movetime: 500,  elo: 1800, desc: '业余中等水平' },
  { id: 4, name: '困难', depth: 10, movetime: 1000, elo: 2200, desc: '业余强手' },
  { id: 5, name: '专家', depth: 14, movetime: 2000, elo: 2600, desc: '接近专业棋手' },
  { id: 6, name: '大师', depth: 20, movetime: 4000, elo: 3000, desc: '专业大师水平' },
  { id: 7, name: '棋神', depth: 0,  movetime: 8000, elo: 9999, desc: '引擎全力，人类难胜' }
]

// ---------- 对局结果 ----------
export const GAME_RESULT = {
  PLAYING: 'playing',
  RED_WIN: 'red_win',
  BLACK_WIN: 'black_win',
  DRAW: 'draw'
}

// ---------- 九宫范围（将/帅、士 活动区）----------
// 黑方九宫: row 0..2, col 3..5 ; 红方九宫: row 7..9, col 3..5
export function inPalace(row, col, side) {
  if (col < 3 || col > 5) return false
  return side === RED ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2)
}

// ---------- 是否己方半场（相/象 不可过河）----------
export function inOwnHalf(row, side) {
  return side === RED ? row >= 5 : row <= 4
}

// ---------- 是否已过河（兵/卒 过河后可横走）----------
export function crossedRiver(row, side) {
  return side === RED ? row <= 4 : row >= 5
}

// ---------- 坐标合法性 ----------
export function inBoard(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS
}

// ---------- 索引 <-> 行列 ----------
export function toIndex(row, col) {
  return row * COLS + col
}
export function toRowCol(index) {
  return { row: Math.floor(index / COLS), col: index % COLS }
}

// ---------- 判断棋子归属 ----------
export function pieceSide(piece) {
  if (!piece) return null
  return piece === piece.toUpperCase() ? RED : BLACK
}

// ---------- 取棋子类型（统一小写）----------
export function pieceType(piece) {
  return piece ? piece.toLowerCase() : null
}

// ---------- 是否同阵营 ----------
export function isSameSide(p1, p2) {
  if (!p1 || !p2) return false
  return pieceSide(p1) === pieceSide(p2)
}

// ---------- 内部坐标 <-> UCI 记谱 ----------
const FILE_CHARS = 'abcdefghi'

/** (row,col) -> 'h7' */
export function toUciSquare(row, col) {
  return FILE_CHARS[col] + (ROWS - 1 - row)
}

/** 'h7' -> {row,col} */
export function fromUciSquare(sq) {
  const col = FILE_CHARS.indexOf(sq[0])
  const rank = parseInt(sq[1], 10)
  return { row: ROWS - 1 - rank, col }
}

/** {from:{row,col},to:{row,col}} -> 'h7e7' */
export function moveToUci(from, to) {
  return toUciSquare(from.row, from.col) + toUciSquare(to.row, to.col)
}

/** 'h7e7' -> {from,to} */
export function uciToMove(uci) {
  return {
    from: fromUciSquare(uci.slice(0, 2)),
    to: fromUciSquare(uci.slice(2, 4))
  }
}
