/**
 * test_sim.mjs -- 端到端模拟对局验证
 * 随机对弈 200 步，校验：UCI 往返、中文记谱、局面裁决不崩
 */
import {
  initialState, genAllLegalMoves, applyMoveToBoard, judgeResult, moveToChinese
} from '../app/utils/rules.js'
import { RED, BLACK, GAME_RESULT, moveToUci, ROWS } from '../app/utils/constants.js'

// 复刻 game.js 里的 parseUci，验证两侧解析一致
function parseUci(u) {
  const f = 'abcdefghi'
  return {
    from: { row: ROWS - 1 - parseInt(u[1], 10), col: f.indexOf(u[0]) },
    to: { row: ROWS - 1 - parseInt(u[3], 10), col: f.indexOf(u[2]) }
  }
}

let games = 0, totalSteps = 0, failures = 0

for (let g = 0; g < 20; g++) {
  const st = initialState()
  let side = RED
  let n = 0
  let result = GAME_RESULT.PLAYING

  while (n < 300) {
    const ms = genAllLegalMoves(st.board, side)
    if (!ms.length) { result = judgeResult(st.board, side); break }

    const m = ms[Math.floor(Math.random() * ms.length)]

    // 1) UCI 往返一致性
    const uci = moveToUci(m.from, m.to)
    const rt = parseUci(uci)
    if (rt.from.row !== m.from.row || rt.from.col !== m.from.col ||
        rt.to.row !== m.to.row || rt.to.col !== m.to.col) {
      console.log(`  FAIL UCI往返: ${uci}`)
      failures++
      break
    }

    // 2) 中文记谱非空
    const cn = moveToChinese(st.board, m.from, m.to)
    if (!cn || cn.length < 3) {
      console.log(`  FAIL 记谱异常: "${cn}" @ ${uci}`)
      failures++
      break
    }

    st.board = applyMoveToBoard(st.board, m.from, m.to)
    side = side === RED ? BLACK : RED
    n++
  }

  games++
  totalSteps += n
  if (g < 3) {
    console.log(`  局${g + 1}: ${n} 步, 结果=${result}`)
  }
}

console.log('')
console.log(`模拟对局数 = ${games}`)
console.log(`总步数     = ${totalSteps}（平均 ${Math.round(totalSteps / games)} 步/局）`)
console.log(`失败项     = ${failures}`)
console.log(failures === 0 ? '===== 端到端验证 PASS =====' : '===== 端到端验证 FAIL =====')
process.exit(failures === 0 ? 0 : 1)
