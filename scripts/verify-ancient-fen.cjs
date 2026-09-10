/**
 * 用项目自己的规则引擎验证从古谱转换来的 FEN 是否合法可用。
 *
 * 这一步不能省：binit 解析正确不代表局面能被本项目正常使用，
 * 还要确认 parseFen 能解析、双方走法能生成、红方先行有棋可走。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function loadModule(relPath, deps) {
  let src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  src = src.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  src = src.replace(/^\s*export\s+(const|function|class|let|var)\s/gm, '$1 ');
  src = src.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  const names = Object.keys(deps);
  const vals = names.map(k => deps[k]);
  const decls = [];
  const re = /^(?:const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src)) !== null) decls.push(m[1]);
  const body = src + '\n;return {' +
    [...new Set(decls)].map(n => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(',') +
    '};';
  return new Function(...names, body)(...vals);
}

const C = loadModule('app/utils/constants.js', {});
const R = loadModule('app/utils/rules.js', {
  COLS: C.COLS, ROWS: C.ROWS, RED: C.RED, BLACK: C.BLACK, EMPTY: C.EMPTY,
  INITIAL_FEN: C.INITIAL_FEN, PIECE_NAMES: C.PIECE_NAMES,
  inPalace: C.inPalace, inOwnHalf: C.inOwnHalf, crossedRiver: C.crossedRiver,
  inBoard: C.inBoard, toIndex: C.toIndex, toRowCol: C.toRowCol,
  pieceSide: C.pieceSide, pieceType: C.pieceType, isSameSide: C.isSameSide,
  toUciSquare: C.toUciSquare, fromUciSquare: C.fromUciSquare,
  moveToUci: C.moveToUci, uciToMove: C.uciToMove, GAME_RESULT: C.GAME_RESULT
});

const { RED, BLACK, COLS } = C;

// 从 parse-dpxq.cjs 转换得到的真实古谱 FEN
const CASES = [
  {
    name: '七星聚会',
    source: '《百局象棋谱》第1局',
    fen: '4k1rr1/3P1P3/1P2P2c1/9/8p/9/9/4Bp3/3p5/4RK3 w - - 0 1',
    expectRed: 7, expectBlack: 7,
    goal: 'draw',
    reason: '古谱与维基均记载：红方看似有胜机，实为和棋。正解为守和。'
  },
  {
    name: '蚯蚓降龙',
    source: '《百局象棋谱》',
    fen: '5k2r/4P1P2/9/9/5r2p/2P6/9/4B4/4A4/3AK4 w - - 0 1',
    expectRed: 7, expectBlack: 4,
    goal: 'draw',
    reason: '双车对双卒，车强却被卒牵制；古谱记载为和局。'
  }
];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); return true; }
  fail++;
  console.log('  [FAIL] ' + name + (detail ? '  ' + detail : ''));
  return false;
}

for (const c of CASES) {
  console.log('===== ' + c.name + '（' + c.source + '）=====');
  console.log('FEN: ' + c.fen);

  let st;
  try {
    st = R.parseFen(c.fen);
  } catch (e) {
    check(c.name + ': parseFen 可解析', false, e.message);
    console.log('');
    continue;
  }
  check(c.name + ': parseFen 可解析', !!st && !!st.board);

  // 回写一致，确认无解析歧义
  const back = R.toFen(st).split(/\s+/)[0];
  const orig = c.fen.split(/\s+/)[0];
  check(c.name + ': FEN 回写一致', back === orig, back);

  check(c.name + ': 红方先行', st.side === RED);

  // 子力数量核对（七星聚会的 7:7 是局名由来，可独立验证）
  let redN = 0, blackN = 0;
  for (const p of st.board) {
    if (!p) continue;
    if (p === p.toUpperCase()) redN++; else blackN++;
  }
  check(c.name + ': 红方子数 = ' + c.expectRed, redN === c.expectRed, '实际 ' + redN);
  check(c.name + ': 黑方子数 = ' + c.expectBlack, blackN === c.expectBlack, '实际 ' + blackN);

  // 将帅各一枚
  let kc = 0, Kc = 0;
  for (const p of st.board) {
    if (p === 'k') kc++;
    if (p === 'K') Kc++;
  }
  check(c.name + ': 帅将各一枚', kc === 1 && Kc === 1, 'K=' + Kc + ' k=' + kc);

  // 走法生成
  const rm = R.genAllLegalMoves(st.board, RED) || [];
  const bm = R.genAllLegalMoves(st.board, BLACK) || [];
  console.log('  红方着法 ' + rm.length + ' 个，黑方着法 ' + bm.length + ' 个');
  check(c.name + ': 红方有着可走', rm.length > 0);
  check(c.name + ': 红方选择充足(>=3)', rm.length >= 3, '仅 ' + rm.length);
  check(c.name + ': 黑方有着可走', bm.length > 0);

  // 开局不能已经终局
  check(c.name + ': 开局未被将死', !R.isCheckmate(st.board, RED));
  check(c.name + ': 开局未被困死', !R.isStalemate(st.board, RED));

  // 全部红方着法跑一遍完整链路，确保不会崩
  let chainErr = null;
  for (const mv of rm) {
    try {
      R.moveToChinese(st.board, mv.from, mv.to);
      C.moveToUci(mv.from, mv.to);
      const nb = R.applyMoveToBoard(st.board, mv.from, mv.to);
      R.judgeResult(nb, BLACK);
      R.isKingInCheck(nb, BLACK);
      R.genAllLegalMoves(nb, BLACK);
    } catch (e) {
      chainErr = e.message;
      break;
    }
  }
  check(c.name + ': 全部着法链路无异常', !chainErr, chainErr || '');

  console.log('  目标: ' + c.goal + ' —— ' + c.reason);
  console.log('');
}

console.log('========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) process.exit(1);
console.log('[PASS] 古谱 FEN 全部通过规则引擎验证');
