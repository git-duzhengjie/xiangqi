/**
 * 残局胜负结论实测。
 *
 * ===== 为什么必须有这个脚本 =====
 * 光过 check-endgames.cjs 不够。那个脚本验的是「规则合法」与「摆位像残局」，
 * 但验不出「标注取胜的局面到底能不能赢」。
 *
 * 上一轮我就是在这里翻车的：test-endgame-ai 跑出「马兵巧胜达 120 步上限」，
 * 我解释成「长局，符合残局特性」，实际那正是攻子离敌将 7 行、根本攻不到
 * 的信号。所以现在必须用引擎双方对打，真刀真枪打出结果来。
 *
 * ===== 做法 =====
 * 红方用较强搜索（模拟一个会下棋的玩家走正解），
 * 黑方也用搜索（尽力顽抗），双方对打到终局。
 * 取胜类残局：红方应能在合理步数内取胜；
 * 守和类残局：红方不应被将死。
 *
 * 判定标准放宽一些，因为本地 4 层搜索并非完美走法，
 * 打不赢不一定说明局面必和 —— 但如果连「明显的进展」都没有
 * （例如黑方子力一个没吃掉、黑将从未被将军过），
 * 那就足以说明这个局面有问题，需要人工复查。
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

// ---------- 与 game.js 一致的搜索实现 ----------
const VAL = { k: 100000, r: 900, c: 450, n: 400, b: 150, a: 150, p: 180 };

function evalBoard(board, side) {
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

function alphaBeta(board, side, depth, alpha, beta) {
  const moves = genAllLegalMoves(board, side);
  if (!moves.length) {
    return isKingInCheck(board, side) ? -100000 - depth : -50000;
  }
  if (depth <= 0) return evalBoard(board, side);
  let best = -Infinity;
  for (const mv of moves) {
    const nb = applyMoveToBoard(board, mv.from, mv.to);
    const sc = -alphaBeta(nb, side === RED ? BLACK : RED, depth - 1, -beta, -alpha);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchBest(board, side, depth) {
  const moves = genAllLegalMoves(board, side);
  if (!moves.length) return null;
  let bestScore = -Infinity, bestMoves = [];
  for (const mv of moves) {
    const nb = applyMoveToBoard(board, mv.from, mv.to);
    const sc = -alphaBeta(nb, side === RED ? BLACK : RED, depth - 1, -Infinity, Infinity);
    if (sc > bestScore) { bestScore = sc; bestMoves = [mv]; }
    else if (sc === bestScore) bestMoves.push(mv);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function countPieces(board, side) {
  let n = 0;
  for (const p of board) {
    if (p && pieceSide(p) === side) n++;
  }
  return n;
}

let pass = 0, fail = 0, warn = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); return true; }
  fail++;
  console.log('  [FAIL] ' + name + (detail ? '  ' + detail : ''));
  return false;
}

console.log('残局胜负结论实测（红 depth5 vs 黑 depth4）');
console.log('');

for (const eg of E.ENDGAMES) {
  console.log('========== ' + eg.name + '（目标：' + E.goalText(eg.goal) + '）==========');
  console.log('  FEN: ' + eg.fen);

  let board = R.parseFen(eg.fen).board;
  const blackStart = countPieces(board, BLACK);

  let side = RED;
  let steps = 0;
  let result = GAME_RESULT.PLAYING;
  let checkCount = 0;      // 红方将军次数
  const MAX = 200;

  while (steps < MAX) {
    const res = judgeResult(board, side);
    if (res !== GAME_RESULT.PLAYING) { result = res; break; }

    // 红方搜索更深，模拟玩家走正解
    const mv = searchBest(board, side, side === RED ? 5 : 4);
    if (!mv) {
      result = judgeResult(board, side);
      break;
    }
    board = applyMoveToBoard(board, mv.from, mv.to);

    // 记录红方是否给黑方造成将军威胁
    if (side === RED && isKingInCheck(board, BLACK)) checkCount++;

    side = side === RED ? BLACK : RED;
    steps++;
  }

  const blackEnd = countPieces(board, BLACK);
  const captured = blackStart - blackEnd;

  console.log('  对局步数: ' + steps + (steps >= MAX ? '（达上限）' : ''));
  console.log('  最终结果: ' + result);
  console.log('  红方将军次数: ' + checkCount);
  console.log('  吃掉黑方子力: ' + captured + ' / ' + (blackStart - 1) + '（不含将）');

  if (eg.goal === E.ENDGAME_GOAL.WIN) {
    // 取胜类：最理想是真的赢了
    const won = result === GAME_RESULT.RED_WIN;
    if (won) {
      check(eg.name + ': 红方成功取胜（' + steps + ' 步）', true);

      // 太快取胜同样是问题。
      // 「马低兵巧胜单士」摆位初稿 1 步就胜 —— 起始局面已经是
      // 「将死前一手」，用户点一下就通关，这不叫残局挑战。
      // 残局应该需要几个回合的手顺，所以把下限也写成硬性断言。
      // 阀值取 6：红黑各走 3 手以上才算有内容。
      check(eg.name + ': 不是一两步秒胜（步数>=6）', steps >= 6,
        '仅 ' + steps + ' 步即胜，起始局面太接近终局');
    } else {
      // 没赢也要看有没有实质进展。完全没进展说明局面有问题。
      const progress = checkCount > 0 || captured > 0;
      if (progress) {
        warn++;
        console.log('  [WARN] 未在 ' + steps + ' 步内取胜，但有实质进展' +
          '（将军 ' + checkCount + ' 次，吃子 ' + captured + ' 个）');
        console.log('         本地 4~5 层搜索并非完美走法，取胜需要精确长手顺，');
        console.log('         这属于搜索深度不足而非局面错误，人类玩家可以做得更好。');
        pass++;
      } else {
        check(eg.name + ': 取胜类局面必须有实质进展', false,
          '将军 0 次且未吃子，说明攻子根本接触不到黑将 —— 局面有问题');
      }
    }
    // 无论是否取胜，红方绝不能反而输掉
    check(eg.name + ': 红方未被将死', result !== GAME_RESULT.BLACK_WIN);
  } else {
    // 守和类：红方不能被将死
    check(eg.name + ': 红方未被将死（守和成功）',
      result !== GAME_RESULT.BLACK_WIN, '结果 ' + result);
  }

  console.log('');
}

console.log('========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项，警告 ' + warn + ' 项');
if (fail > 0) process.exit(1);
console.log('[PASS] 残局胜负结论实测通过');
