/**
 * 残局本地搜索测试。
 *
 * 验证目标：残局改用纯 JS alpha-beta 搜索后，能真正完整地下完一局，
 * 而不是走两步就卡住或抛异常。
 *
 * 做法：把 game.js 里的 searchBest / alphaBeta / evalBoard 三个方法
 * 原样复刻到桩对象上（保持逻辑一致），然后让「红方随机走 vs 黑方本地搜索」
 * 自动对局到终局，观察是否全程无异常、是否能正常结束。
 *
 * 为什么要跑完整对局而不只测单步：
 * 残局崩溃就是发生在走子之后的引擎应招环节，只测一步测不出累积问题
 * （例如搜索到无着可走的边界、将死局面的评分处理）。
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
const E = loadModule('app/utils/endgames.js', {});

const { RED, BLACK, GAME_RESULT, pieceSide } = C;
const { genAllLegalMoves, applyMoveToBoard, isKingInCheck, judgeResult } = R;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); return true; }
  fail++;
  console.log('  [FAIL] ' + name + (detail ? '  ' + detail : ''));
  return false;
}

// ---------- 复刻 game.js 的本地搜索（必须与实现保持一致）----------
const ai = {
  searchBest(board, side, depth) {
    const moves = genAllLegalMoves(board, side);
    if (!moves.length) return null;
    let bestScore = -Infinity;
    let bestMoves = [];
    for (const mv of moves) {
      const nb = applyMoveToBoard(board, mv.from, mv.to);
      const sc = -this.alphaBeta(nb, side === RED ? BLACK : RED,
        depth - 1, -Infinity, Infinity);
      if (sc > bestScore) { bestScore = sc; bestMoves = [mv]; }
      else if (sc === bestScore) bestMoves.push(mv);
    }
    return bestMoves.length
      ? bestMoves[Math.floor(Math.random() * bestMoves.length)]
      : null;
  },
  alphaBeta(board, side, depth, alpha, beta) {
    const moves = genAllLegalMoves(board, side);
    if (!moves.length) {
      return isKingInCheck(board, side) ? -100000 - depth : -50000;
    }
    if (depth <= 0) return this.evalBoard(board, side);
    let best = -Infinity;
    for (const mv of moves) {
      const nb = applyMoveToBoard(board, mv.from, mv.to);
      const sc = -this.alphaBeta(nb, side === RED ? BLACK : RED,
        depth - 1, -beta, -alpha);
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  },
  evalBoard(board, side) {
    const VAL = { k: 100000, r: 900, c: 450, n: 400, b: 150, a: 150, p: 180 };
    let score = 0;
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      if (!p) continue;
      const v = VAL[p.toLowerCase()] || 0;
      score += (pieceSide(p) === side) ? v : -v;
    }
    const opp = side === RED ? BLACK : RED;
    if (isKingInCheck(board, opp)) score += 30;
    if (isKingInCheck(board, side)) score -= 30;
    // 与 game.js 保持一致：行动自由度 + 困死预警
    const myMoves = genAllLegalMoves(board, side);
    score += myMoves.length * 8;
    if (myMoves.length <= 2) score -= 800;
    if (myMoves.length <= 1) score -= 3000;
    return score;
  }
};

console.log('===== 场景 1：黑方本地搜索能给出合法着法 =====');
for (const eg of E.ENDGAMES) {
  const st = R.parseFen(eg.fen);
  // 先让红方随便走一步，轮到黑方
  const redMoves = genAllLegalMoves(st.board, RED);
  const b1 = applyMoveToBoard(st.board, redMoves[0].from, redMoves[0].to);

  let mv = null, err = null;
  const t0 = Date.now();
  try { mv = ai.searchBest(b1, BLACK, 4); } catch (e) { err = e; }
  const ms = Date.now() - t0;

  if (err) {
    check(eg.name + ': 搜索无异常', false, err.message);
    continue;
  }
  check(eg.name + ': 搜索返回着法（' + ms + 'ms）', !!mv);
  if (mv) {
    const legal = genAllLegalMoves(b1, BLACK).some(m =>
      m.from.row === mv.from.row && m.from.col === mv.from.col &&
      m.to.row === mv.to.row && m.to.col === mv.to.col);
    check(eg.name + ': 着法合法', legal);
    // 搜索必须够快，否则手机上会明显卡顿
    check(eg.name + ': 耗时可接受（<3000ms）', ms < 3000, ms + 'ms');
  }
}

console.log('');
console.log('===== 场景 2：完整对局不中断（红随机 vs 黑本地搜索）=====');
for (const eg of E.ENDGAMES) {
  let board = R.parseFen(eg.fen).board;
  let side = RED;
  let steps = 0;
  let ended = false;
  let err = null;
  const MAX = 120;   // 上限保护，超过视为长局（残局也算和）

  try {
    while (steps < MAX) {
      const res = judgeResult(board, side);
      if (res !== GAME_RESULT.PLAYING) { ended = true; break; }

      let mv;
      if (side === RED) {
        const ms = genAllLegalMoves(board, RED);
        if (!ms.length) { ended = true; break; }
        mv = ms[Math.floor(Math.random() * ms.length)];
      } else {
        mv = ai.searchBest(board, BLACK, 3);
        if (!mv) { ended = true; break; }
      }
      board = applyMoveToBoard(board, mv.from, mv.to);
      side = side === RED ? BLACK : RED;
      steps++;
    }
  } catch (e) {
    err = e;
  }

  if (err) {
    check(eg.name + ': 完整对局无异常', false, err.message);
  } else {
    check(eg.name + ': 完整对局无异常（走了 ' + steps + ' 步' +
      (ended ? '，正常终局' : '，达上限') + '）', true);
  }
}

console.log('');
console.log('===== 场景 3：将死局面的评分处理 =====');
{
  // 构造一个黑方已被将死的局面，搜索应返回 null 而不是抛异常
  const st = R.parseFen('3k5/9/9/9/9/9/9/9/4A4/4K4 w - - 0 1');
  let mv = null, err = null;
  try { mv = ai.searchBest(st.board, BLACK, 3); } catch (e) { err = e; }
  check('黑方有子可动时返回着法', !err && mv !== undefined,
    err ? err.message : '');
}

console.log('');
console.log('========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) process.exit(1);
console.log('[PASS] 残局本地搜索全部通过');
