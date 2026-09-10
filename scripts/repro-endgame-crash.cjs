/**
 * 复现「残局走一步就崩」。
 *
 * 设备已离线抓不到 logcat，改用纯 JS 复刻 doMove 的完整链路：
 *   parseFen -> genLegalMoves -> applyMoveToBoard -> moveToChinese
 *   -> moveToUci -> judgeResult -> isKingInCheck
 * 逐个环节单独 try，谁抛异常就定位到谁。
 *
 * 重点怀疑 moveToChinese：中文记谱要判断「前/后」「几路」，
 * 依赖同列同类棋子的数量。残局棋子极少且分布极端（比如黑方只有一个将、
 * 红方只有一兵一马），很容易走到记谱函数没覆盖的分支。
 * 这类函数在标准开局下永远不会遇到这些边界。
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

console.log('rules 导出: ' + Object.keys(R).filter(k => typeof R[k] === 'function').join(', '));
console.log('');

let crash = 0;

for (const eg of E.ENDGAMES) {
  console.log('========== ' + eg.name + ' ==========');
  console.log('FEN: ' + eg.fen);

  let st;
  try {
    st = R.parseFen(eg.fen);
  } catch (e) {
    console.log('  [CRASH] parseFen: ' + e.message);
    crash++; continue;
  }

  // 找出红方所有可走着法
  let allMoves = [];
  try {
    allMoves = R.genAllLegalMoves(st.board, C.RED) || [];
  } catch (e) {
    console.log('  [CRASH] genAllLegalMoves: ' + e.message);
    crash++; continue;
  }
  console.log('  红方着法数: ' + allMoves.length);

  // 逐个着法跑完整 doMove 链路
  let idx = 0;
  for (const mv of allMoves) {
    idx++;
    // 着法结构可能是 {from:{row,col},to:{row,col}} 或 {row,col} 形式，
    // 这里做兼容处理，取不到就跳过并报告
    let from, to;
    if (mv.from && mv.to) { from = mv.from; to = mv.to; }
    else if (mv.fromRow !== undefined) {
      from = { row: mv.fromRow, col: mv.fromCol };
      to = { row: mv.toRow, col: mv.toCol };
    } else {
      console.log('  [WARN] 着法结构未知: ' + JSON.stringify(mv));
      break;
    }

    const boardBefore = st.board.slice();

    // --- moveToChinese ---
    try {
      R.moveToChinese(boardBefore, from, to);
    } catch (e) {
      console.log('  [CRASH] moveToChinese  着法#' + idx +
        ' (' + from.row + ',' + from.col + ')->(' + to.row + ',' + to.col + ')');
      console.log('          ' + e.constructor.name + ': ' + e.message);
      crash++;
      continue;
    }

    // --- moveToUci ---
    try {
      C.moveToUci(from, to);
    } catch (e) {
      console.log('  [CRASH] moveToUci 着法#' + idx + ': ' + e.message);
      crash++; continue;
    }

    // --- applyMoveToBoard ---
    let nb;
    try {
      nb = R.applyMoveToBoard(boardBefore, from, to);
    } catch (e) {
      console.log('  [CRASH] applyMoveToBoard 着法#' + idx + ': ' + e.message);
      crash++; continue;
    }

    // --- judgeResult ---
    try {
      R.judgeResult(nb, C.BLACK);
    } catch (e) {
      console.log('  [CRASH] judgeResult 着法#' + idx + ': ' + e.message);
      crash++; continue;
    }

    // --- isKingInCheck ---
    try {
      R.isKingInCheck(nb, C.BLACK);
    } catch (e) {
      console.log('  [CRASH] isKingInCheck 着法#' + idx + ': ' + e.message);
      crash++; continue;
    }

    // --- 黑方应招（引擎不可用时的兜底路径也要能跑）---
    try {
      R.genAllLegalMoves(nb, C.BLACK);
    } catch (e) {
      console.log('  [CRASH] 黑方 genAllLegalMoves 着法#' + idx + ': ' + e.message);
      crash++; continue;
    }
  }
  console.log('  已跑完 ' + idx + ' / ' + allMoves.length + ' 个着法');
  console.log('');
}

console.log('========================================');
if (crash > 0) {
  console.log('发现 ' + crash + ' 处异常');
  process.exit(1);
}
console.log('[PASS] 所有残局的所有着法均未抛异常');
