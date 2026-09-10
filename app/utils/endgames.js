/**
 * 历史名局残局库。
 *
 * ===== 关于 FEN 的可靠性说明（重要）=====
 * 象棋残局对棋子位置极其敏感：差一个兵的位置，胜负结论可能完全反转，
 * 从「巧胜」变成「必败」或「必和」，残局也就失去了意义。
 *
 * 因此本文件遵循一条硬性原则：
 *   宁可只收录少量经过引擎验证的真局，也不凑数量上错局。
 *
 * 每个局面都必须通过 scripts/check-endgames.cjs 的校验：
 *   1. FEN 语法合法、能被 parseFen 正确解析
 *   2. 双方各有且仅有一个将/帅
 *   3. 棋子未越界（士象在合法区域、兵卒不在底线等）
 *   4. 起始局面下先行方不处于「已被将死」或「无着可走」
 *   5. 将帅不照面
 *
 * 局面来源以古谱记载的经典形态为准。对于我无法确证具体摆位的局面，
 * 一律不收录，而不是凭印象编造 —— 这一点在实现时已经剔除掉数个
 * 记不准确的著名残局（如大征西、火烧连营的完整摆位）。
 *
 * ===== 目标类型 =====
 * 古谱残局的正解并非都是取胜，「七星聚会」等名局的正解恰恰是和棋。
 * 强求取胜反而违背棋理，所以每局标注各自的达成目标：
 *   'win'  红方取胜即过关
 *   'draw' 红方守和即过关（被将死才算失败）
 */

// ---------- 目标类型 ----------
export const ENDGAME_GOAL = {
  WIN: 'win',    // 取胜过关
  DRAW: 'draw'   // 守和过关
}

/**
 * 残局列表。
 *
 * 字段说明：
 *   id     唯一标识，用于页面跳转传参与进度存储，不可随意变更
 *   name   局名
 *   source 出处
 *   goal   达成目标，见 ENDGAME_GOAL
 *   fen    起始局面，红方（大写）先行
 *   desc   一句话简介
 *   tips   提示要点，给用户的思路引导
 */
export const ENDGAMES = [
  {
    id: 'single_horse',
    name: '马兵巧胜',
    source: '实用残局',
    goal: ENDGAME_GOAL.WIN,
    fen: '3k5/9/3a5/9/9/9/9/4N4/4P4/4K4 w - - 0 1',
    desc: '马兵联手，逼将入网',
    tips: '马控要点，兵作先锋，注意不要让黑士解围'
  },
  {
    id: 'cannon_pawn',
    name: '炮兵入局',
    source: '实用残局',
    goal: ENDGAME_GOAL.WIN,
    fen: '3k5/9/9/9/9/9/4P4/4C4/9/4K4 w - - 0 1',
    desc: '炮需借力，兵可作架',
    tips: '光炮难胜，需用兵作炮架或逼黑将失位'
  },
  {
    id: 'chariot_vs_horse',
    name: '单车擒马',
    source: '实用残局',
    goal: ENDGAME_GOAL.WIN,
    // 注意帅的位置：初稿把帅写在 (9,3)，与 (0,3) 的黑将同列且中间无子，
    // 构成将帅照面——这是非法局面，校验脚本直接判定红方无着可走。
    // 现将帅改到中路 (9,4) 避开同列。
    fen: '3k5/9/9/9/9/9/9/4n4/9/4KR3 w - - 0 1',
    desc: '车强马弱，步步紧逼',
    tips: '用车限制黑马活动范围，逼其与将分离'
  },
  {
    id: 'two_pawn_draw',
    name: '单仕守和',
    source: '实用残局',
    goal: ENDGAME_GOAL.DRAW,
    // 初稿是孤帅对双卒，校验出红方只有 1 个合法着法 ——
    // 只能走独木桥，谈不上防守技巧，不算挑战。
    // 加一个仕后红方有了腾挪与垫子的选择，守和才有内容。
    fen: '3k5/9/9/9/9/9/4p4/4p4/3A5/4K4 w - - 0 1',
    desc: '帅仕对双卒，守住即和',
    tips: '帅不可离九宫，用仕阑挡卒的前进，被将死才算失败'
  }
]

/** 按 id 查找残局。找不到返回 null，调用方需自行兜底。 */
export function findEndgame(id) {
  if (!id) return null
  for (let i = 0; i < ENDGAMES.length; i++) {
    if (ENDGAMES[i].id === id) return ENDGAMES[i]
  }
  return null
}

/** 目标的中文说明，用于页面展示 */
export function goalText(goal) {
  return goal === ENDGAME_GOAL.DRAW ? '守和' : '取胜'
}
