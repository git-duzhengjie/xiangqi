/**
 * test_rules.mjs -- 规则引擎验证脚本（Node 直接运行）
 * 运行: node test_rules.mjs
 */
import {
  parseFen, toFen, initialState, genPieceMoves, genLegalMoves,
  genAllLegalMoves, isKingInCheck, isKingsFacing, isCheckmate,
  applyMoveToBoard, moveToChinese, findKing, judgeResult
} from '../app/utils/rules.js'
import { RED, BLACK, INITIAL_FEN, moveToUci, uciToMove, toUciSquare, fromUciSquare } from '../app/utils/constants.js'

let pass = 0, fail = 0
function check(name, actual, expect) {
  const ok = JSON.stringify(actual) === JSON.stringify(expect)
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  actual=${JSON.stringify(actual)} expect=${JSON.stringify(expect)}`) }
}

console.log('=== 1. FEN 解析与回写 ===')
const st = initialState()
check('FEN 往返一致', toFen(st), INITIAL_FEN)
check('红方先行', st.side, RED)
// 红帅应在 row9,col4
check('红帅位置', findKing(st.board, RED), { row: 9, col: 4 })
check('黑将位置', findKing(st.board, BLACK), { row: 0, col: 4 })

console.log('=== 2. 坐标 <-> UCI ===')
check('(9,4)->e0', toUciSquare(9, 4), 'e0')
check('(0,4)->e9', toUciSquare(0, 4), 'e9')
check('e0->(9,4)', fromUciSquare('e0'), { row: 9, col: 4 })
// 炮二平五: 红右炮 (row7,col7) -> (row7,col4)
check('炮二平五 UCI', moveToUci({ row: 7, col: 7 }, { row: 7, col: 4 }), 'h2e2')

console.log('=== 3. 开局走法数 ===')
// 中国象棋标准开局，红方合法首着共 44 种
const opening = genAllLegalMoves(st.board, RED)
check('开局红方合法走法=44', opening.length, 44)

console.log('=== 4. 马腿限制 ===')
// 开局红马 (9,1)：右上被兵/相占位，实际只有 2 种走法
const knightMoves = genLegalMoves(st.board, 9, 1)
check('开局左马走法=2', knightMoves.length, 2)

console.log('=== 5. 炮翻山吃子 ===')
// 空盘: 红炮(5,4)，黑车(2,4)，中间(4,4)放黑卒作炮架
{
  const b = new Array(90).fill(null)
  b[5 * 9 + 4] = 'C'
  b[4 * 9 + 4] = 'p'   // 炮架
  b[2 * 9 + 4] = 'r'   // 目标
  b[9 * 9 + 4] = 'K'
  b[0 * 9 + 4] = 'k'
  const ms = genPieceMoves(b, 5, 4)
  const canEat = ms.some(m => m.row === 2 && m.col === 4)
  const cannotJumpToPawn = !ms.some(m => m.row === 4 && m.col === 4)
  check('炮可隔子吃车', canEat, true)
  check('炮不可吃炮架', cannotJumpToPawn, true)
}

console.log('=== 6. 象眼被堵 ===')
{
  const b = new Array(90).fill(null)
  b[9 * 9 + 2] = 'B'      // 红相 (9,2)
  b[8 * 9 + 3] = 'P'      // 象眼放自己兵
  b[9 * 9 + 4] = 'K'
  b[0 * 9 + 4] = 'k'
  const ms = genPieceMoves(b, 9, 2)
  const blocked = !ms.some(m => m.row === 7 && m.col === 4)
  check('象眼被堵不可走', blocked, true)
}

console.log('=== 7. 白脸将判定 ===')
{
  const b = new Array(90).fill(null)
  b[9 * 9 + 4] = 'K'
  b[0 * 9 + 4] = 'k'
  check('同列无子=白脸将', isKingsFacing(b), true)
  b[5 * 9 + 4] = 'P'
  check('中间有子=非白脸将', isKingsFacing(b), false)
}

console.log('=== 8. 兵过河横走 ===')
{
  const b = new Array(90).fill(null)
  b[9 * 9 + 4] = 'K'; b[0 * 9 + 4] = 'k'
  b[6 * 9 + 0] = 'P'          // 红兵未过河 (row6)
  check('未过河兵只能前进', genPieceMoves(b, 6, 0).length, 1)
  b[6 * 9 + 0] = null
  b[4 * 9 + 0] = 'P'          // 红兵已过河 (row4<=4)
  // 前进 + 右横走（左侧越界）= 2
  check('过河兵可横走', genPieceMoves(b, 4, 0).length, 2)
}

console.log('=== 9. 将军与绝杀 ===')
{
  // 黑将 e9(0,4)，红车 e8(1,4) 贴脸将军，红车受红帅保护(帅在同列)
  const b = new Array(90).fill(null)
  b[0 * 9 + 4] = 'k'
  b[1 * 9 + 4] = 'R'
  b[9 * 9 + 4] = 'K'
  check('黑方被将军', isKingInCheck(b, BLACK), true)
  // 黑将可斜? 将只能直走，(0,3)(0,5)(1,4吃车但车后有帅->白脸将? 吃车后同列仅帅,中间空=白脸将非法)
  const km = genLegalMoves(b, 0, 4)
  check('黑将有逃跑点', km.length > 0, true)
}
{
  // 双车绝杀：红车 a9(0,0) 沿第0横线将军，红车 i8(1,8) 封锁第1横线
  // 黑将 e9(0,4) 无处可逃：(0,3)(0,5) 被 a9 车控，(1,3)(1,4)(1,5) 被 i8 车控
  const b = new Array(90).fill(null)
  b[0 * 9 + 4] = 'k'
  b[0 * 9 + 0] = 'R'   // 横线将军
  b[1 * 9 + 8] = 'R'   // 封锁退路
  b[9 * 9 + 3] = 'K'   // 红帅避开中线，防止白脸将干扰
  check('黑方被将军', isKingInCheck(b, BLACK), true)
  check('构造绝杀成立', isCheckmate(b, BLACK), true)
  check('绝杀后判红胜', judgeResult(b, BLACK), 'red_win')
}

console.log('=== 10. 中文记谱 ===')
{
  const s = initialState()
  // 炮二平五: (7,7)->(7,4)
  check('炮二平五', moveToChinese(s.board, { row: 7, col: 7 }, { row: 7, col: 4 }), '炮二平五')
  // 红方纵线自右向左数：col8=一 ... col0=九
  // 马八进七: 红左马(9,1) -> (7,2)
  check('马八进七', moveToChinese(s.board, { row: 9, col: 1 }, { row: 7, col: 2 }), '马八进七')
  // 马二进三: 红右马(9,7) -> (7,6)
  check('马二进三', moveToChinese(s.board, { row: 9, col: 7 }, { row: 7, col: 6 }), '马二进三')
  // 兵七进一: 红兵 col2 -> 前进一步
  check('兵七进一', moveToChinese(s.board, { row: 6, col: 2 }, { row: 5, col: 2 }), '兵七进一')
  // 兵三进一: 红兵 col6
  check('兵三进一', moveToChinese(s.board, { row: 6, col: 6 }, { row: 5, col: 6 }), '兵三进一')
}

console.log('=== 11. 合法性过滤（不可自将）===')
{
  // 红帅(9,4)，黑车(5,4) 盯着中线；红兵(7,4)挡着，此兵不可横移否则送将
  const b = new Array(90).fill(null)
  b[9 * 9 + 4] = 'K'
  b[0 * 9 + 4] = 'k'
  b[5 * 9 + 4] = 'r'
  b[7 * 9 + 4] = 'P'
  const pm = genLegalMoves(b, 7, 4)
  // 兵只能沿中线前进(6,4)，横走会暴露红帅
  const onlyForward = pm.every(m => m.col === 4)
  check('挡将之兵不可横移', onlyForward, true)
}

console.log(`\n===== 结果: PASS=${pass}  FAIL=${fail} =====`)
process.exit(fail > 0 ? 1 : 0)
