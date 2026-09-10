/**
 * 残局库校验脚本。
 *
 * 为什么必须有这个脚本：
 * 象棋残局对棋子位置极其敏感，差一个兵的位置，胜负结论就可能完全反转
 * （从「巧胜」变成「必和」甚至「必败」），那样残局就失去了挑战意义。
 * 手工核对 FEN 很容易看漏，所以用项目自己的规则引擎逐条验证。
 *
 * 校验项：
 *   1. FEN 能被 parseFen 正确解析，且回写 toFen 后布局一致
 *   2. 双方各有且仅有一个将/帅
 *   3. 棋子在合法区域（士象不出界、兵卒不在对方底线）
 *   4. 将帅不照面（这是非法局面，引擎会拒绝）
 *   5. 先行方有合法着法可走，且不是开局即被将死
 *   6. 目标类型合法
 *
 * 零依赖：手工剥离 ES module 语法后用 Function 求值，
 * 避免为一个校验脚本引入构建工具。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 把 ES module 源码转成 CommonJS 可执行的形式 */
function loadModule(relPath, deps) {
  let src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  // 去掉 import 语句（依赖由 deps 注入）
  src = src.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  // export 关键字剥掉，保留声明本身
  src = src.replace(/^\s*export\s+(const|function|class|let|var)\s/gm, '$1 ');
  src = src.replace(/^\s*export\s+default\s+/gm, 'const __default = ');
  src = src.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  const names = Object.keys(deps);
  const vals = names.map(k => deps[k]);
  // 收集顶层声明名，作为模块导出
  const decls = [];
  const re = /^(?:const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src)) !== null) decls.push(m[1]);

  const body = src + '\n;return {' +
    [...new Set(decls)].map(n => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(',') +
    '};';
  return new Function(...names, body)(...vals);
}

// ---------- 加载 constants 与 rules ----------
const constants = loadModule('app/utils/constants.js', {});
const rules = loadModule('app/utils/rules.js', {
  COLS: constants.COLS, ROWS: constants.ROWS,
  RED: constants.RED, BLACK: constants.BLACK,
  EMPTY: constants.EMPTY,
  INITIAL_FEN: constants.INITIAL_FEN,
  PIECE_NAMES: constants.PIECE_NAMES,
  inPalace: constants.inPalace, inOwnHalf: constants.inOwnHalf,
  crossedRiver: constants.crossedRiver, inBoard: constants.inBoard,
  toIndex: constants.toIndex, toRowCol: constants.toRowCol,
  // 注意：这里必须用 constants.js 真实导出的函数名。
  // 最初我凭印象注入了 isRed / isBlack / sideOf，实际并不存在，
  // 导致 genAllLegalMoves 内部抱 ReferenceError，而校验脚本的 try 又
  // 把异常吞了，表现为「红方着法数 0」，差点让我误判为 FEN 写错。
  pieceSide: constants.pieceSide, pieceType: constants.pieceType,
  isSameSide: constants.isSameSide,
  toUciSquare: constants.toUciSquare, fromUciSquare: constants.fromUciSquare,
  moveToUci: constants.moveToUci, uciToMove: constants.uciToMove,
  GAME_RESULT: constants.GAME_RESULT
});
const endgames = loadModule('app/utils/endgames.js', {});

const { COLS, ROWS, RED, BLACK } = constants;
const { parseFen, toFen, genAllLegalMoves, isCheckmate, isStalemate } = rules;

let pass = 0, fail = 0;
const failed = [];

function check(name, cond, detail) {
  if (cond) { pass++; return true; }
  fail++;
  failed.push(name + (detail ? ' -> ' + detail : ''));
  console.log('  [FAIL] ' + name + (detail ? '  ' + detail : ''));
  return false;
}

console.log('残局库校验');
console.log('共 ' + endgames.ENDGAMES.length + ' 个局面');
console.log('');

const seenId = {};

for (const eg of endgames.ENDGAMES) {
  console.log('=== ' + eg.name + '（' + eg.source + '，目标：' +
    endgames.goalText(eg.goal) + '）===');
  console.log('  FEN: ' + eg.fen);

  // --- id 唯一 ---
  check(eg.name + ': id 唯一', !seenId[eg.id], 'id=' + eg.id);
  seenId[eg.id] = 1;

  // --- 目标类型合法 ---
  check(eg.name + ': 目标类型合法',
    eg.goal === endgames.ENDGAME_GOAL.WIN || eg.goal === endgames.ENDGAME_GOAL.DRAW,
    'goal=' + eg.goal);

  // --- 解析 ---
  let st = null;
  try { st = parseFen(eg.fen); } catch (e) {
    check(eg.name + ': FEN 可解析', false, e.message);
    console.log('');
    continue;
  }
  check(eg.name + ': FEN 可解析', !!st && !!st.board);

  // --- 回写一致（确认没有解析歧义）---
  const back = toFen(st).split(/\s+/)[0];
  const orig = eg.fen.split(/\s+/)[0];
  check(eg.name + ': FEN 回写一致', back === orig, back + ' vs ' + orig);

  // --- 红先行 ---
  check(eg.name + ': 红方先行', st.side === RED);

  // --- 将帅数量 ---
  let kCount = 0, KCount = 0;
  const pieces = { K: 0, k: 0 };
  for (const p of st.board) {
    if (!p) continue;
    if (p === 'K') KCount++;
    if (p === 'k') kCount++;
  }
  check(eg.name + ': 红方恰好一个帅', KCount === 1, '数量=' + KCount);
  check(eg.name + ': 黑方恰好一个将', kCount === 1, '数量=' + kCount);

  // --- 棋子位置合法性 ---
  let posErr = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = st.board[r * COLS + c];
      if (!p) continue;
      const up = p.toUpperCase();
      const side = p === up ? RED : BLACK;
      // 将/帅、士 必须在九宫
      if (up === 'K' || up === 'A') {
        if (!constants.inPalace(r, c, side)) {
          posErr.push(p + '@' + r + ',' + c + ' 不在九宫');
        }
      }
      // 象/相 不可过河
      if (up === 'B') {
        if (!constants.inOwnHalf(r, side)) {
          posErr.push(p + '@' + r + ',' + c + ' 已过河');
        }
      }
      // 兵/卒 不可在自己底线之后（红兵不能在 row 9，黑卒不能在 row 0）
      if (up === 'P') {
        if (side === RED && r === 9) posErr.push(p + '@' + r + ',' + c + ' 红兵在底线');
        if (side === BLACK && r === 0) posErr.push(p + '@' + r + ',' + c + ' 黑卒在底线');
      }
    }
  }
  check(eg.name + ': 棋子位置合法', posErr.length === 0, posErr.join('; '));

  // --- 将帅照面检查（同列且中间无子为非法局面）---
  let kPos = null, KPos = null;
  for (let i = 0; i < st.board.length; i++) {
    if (st.board[i] === 'k') kPos = i;
    if (st.board[i] === 'K') KPos = i;
  }
  if (kPos !== null && KPos !== null) {
    const kc = kPos % COLS, Kc = KPos % COLS;
    const kr = Math.floor(kPos / COLS), Kr = Math.floor(KPos / COLS);
    let facing = false;
    if (kc === Kc) {
      facing = true;
      const lo = Math.min(kr, Kr) + 1, hi = Math.max(kr, Kr);
      for (let r = lo; r < hi; r++) {
        if (st.board[r * COLS + kc]) { facing = false; break; }
      }
    }
    check(eg.name + ': 将帅不照面', !facing);
  }

  // --- 先行方有着可走 ---
  // 注意：这里故意不用 try 包裹。
  // 最初写成 try{...}catch(e){} 后，一个因依赖注入名写错引发的
  // ReferenceError 被静默吞掉，表现为「红方着法数 0」，
  // 差点让我误判为残局 FEN 写错而去改数据。校验脚本必须让
  // 意外异常直接崩掉，否则它自己就成了错误源。
  const moves = genAllLegalMoves(st.board, RED) || [];
  console.log('  红方可走着法数: ' + moves.length);
  check(eg.name + ': 红方有合法着法', moves.length > 0);

  // 着法太少等于没有选择。
  // 「双卒守和」初稿红方只有 1 个合法着法，用户只能走独木桥，
  // 谈不上防守技巧，根本不构成挑战。这条门槛防止以后再收录
  // 这类局面——它不是规则错误，但是设计错误，同样得拦住。
  check(eg.name + ': 红方有足够的选择空间（>=3 着）', moves.length >= 3,
    '仅 ' + moves.length + ' 着');

  // --- 不能开局即被将死/困死 ---
  const mated = isCheckmate(st.board, RED);
  const stuck = isStalemate(st.board, RED);
  check(eg.name + ': 开局未被将死', !mated);
  check(eg.name + ': 开局未被困死', !stuck);

  // --- 守和类局面必须确实有威胁（否则毫无挑战）---
  if (eg.goal === endgames.ENDGAME_GOAL.DRAW) {
    const blackMoves = genAllLegalMoves(st.board, BLACK) || [];
    console.log('  黑方可走着法数: ' + blackMoves.length);
    check(eg.name + ': 守和局面黑方有攻击手段', blackMoves.length > 0);
  }

  console.log('');
}

console.log('========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) {
  console.log('');
  console.log('失败明细：');
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('[PASS] 残局库校验全部通过');
}
