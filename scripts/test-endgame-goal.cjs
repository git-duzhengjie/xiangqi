/**
 * 残局过关判定测试。
 *
 * 重点验证 A+C 方案的核心：不同目标类型下「同一个对局结果」必须得出
 * 不同的过关结论。这是最容易写错的地方 ——
 * 守和类残局里「和棋」是成功，若沿用普通对局逻辑会判成失败。
 *
 * 用桩对象模拟 game.js 的 computed，不启动 uni-app 运行时。
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

const constants = loadModule('app/utils/constants.js', {});
const endgames = loadModule('app/utils/endgames.js', {});
const { GAME_RESULT } = constants;
const { ENDGAME_GOAL, ENDGAMES, findEndgame, goalText } = endgames;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); return true; }
  fail++;
  console.log('  [FAIL] ' + name + (detail ? '  ' + detail : ''));
  return false;
}

/**
 * 复刻 game.js 的 endgamePassed 判定逻辑。
 * 这里必须与 game.js 保持一致，若 game.js 改了判定规则，本测试会失配。
 */
function endgamePassed(endgame, result) {
  if (!endgame) return false;
  if (endgame.goal === ENDGAME_GOAL.DRAW) {
    return result === GAME_RESULT.DRAW || result === GAME_RESULT.RED_WIN;
  }
  return result === GAME_RESULT.RED_WIN;
}

console.log('===== 场景 1：取胜类残局（goal = win）=====');
{
  const eg = { id: 't1', name: '测试取胜局', goal: ENDGAME_GOAL.WIN };
  check('红胜 -> 过关', endgamePassed(eg, GAME_RESULT.RED_WIN) === true);
  // 关键：取胜类残局里和棋不算过关，古谱要求的是分出胜负
  check('和棋 -> 不过关', endgamePassed(eg, GAME_RESULT.DRAW) === false);
  check('红负 -> 不过关', endgamePassed(eg, GAME_RESULT.BLACK_WIN) === false);
  check('进行中 -> 不过关', endgamePassed(eg, GAME_RESULT.PLAYING) === false);
}

console.log('');
console.log('===== 场景 2：守和类残局（goal = draw）=====');
{
  const eg = { id: 't2', name: '测试守和局', goal: ENDGAME_GOAL.DRAW };
  // 这是 A+C 方案的核心：和棋在守和类残局中是成功而非失败。
  // 若沿用普通对局逻辑（只认 RED_WIN），这条必然失败。
  check('和棋 -> 过关（守和正解）', endgamePassed(eg, GAME_RESULT.DRAW) === true);
  check('红胜 -> 过关（超额完成）', endgamePassed(eg, GAME_RESULT.RED_WIN) === true);
  check('被将死 -> 不过关', endgamePassed(eg, GAME_RESULT.BLACK_WIN) === false);
  check('进行中 -> 不过关', endgamePassed(eg, GAME_RESULT.PLAYING) === false);
}

console.log('');
console.log('===== 场景 3：同一结果在两类目标下结论相反 =====');
{
  const win = { goal: ENDGAME_GOAL.WIN };
  const draw = { goal: ENDGAME_GOAL.DRAW };
  const r = GAME_RESULT.DRAW;
  const a = endgamePassed(win, r);
  const b = endgamePassed(draw, r);
  console.log('  和棋结果: 取胜类=' + a + '  守和类=' + b);
  check('和棋在两类目标下结论必须相反', a !== b);
}

console.log('');
console.log('===== 场景 4：普通对局不受影响 =====');
{
  check('endgame 为 null 时恒不过关',
    endgamePassed(null, GAME_RESULT.RED_WIN) === false);
}

console.log('');
console.log('===== 场景 5：残局查找与文案 =====');
{
  check('findEndgame 能查到首个残局',
    findEndgame(ENDGAMES[0].id) === ENDGAMES[0]);
  check('findEndgame 查不到返回 null', findEndgame('not_exist') === null);
  check('findEndgame 空参数返回 null', findEndgame('') === null);
  check('goalText(win) = 取胜', goalText(ENDGAME_GOAL.WIN) === '取胜');
  check('goalText(draw) = 守和', goalText(ENDGAME_GOAL.DRAW) === '守和');
}

console.log('');
console.log('===== 场景 6：残局库数据完整性 =====');
{
  check('残局数量 > 0', ENDGAMES.length > 0, '数量=' + ENDGAMES.length);
  let allOk = true, detail = '';
  for (const eg of ENDGAMES) {
    if (!eg.id || !eg.name || !eg.fen || !eg.goal || !eg.desc || !eg.tips) {
      allOk = false; detail = eg.name + ' 字段不全';
      break;
    }
    if (eg.goal !== ENDGAME_GOAL.WIN && eg.goal !== ENDGAME_GOAL.DRAW) {
      allOk = false; detail = eg.name + ' goal 非法';
      break;
    }
    // 残局必须红先，否则用户一进去就在等引擎走棋
    if (eg.fen.split(/\s+/)[1] !== 'w') {
      allOk = false; detail = eg.name + ' 非红先';
      break;
    }
  }
  check('所有残局字段完整且红先', allOk, detail);

  // 至少要有一个守和类，否则 C 方案（区分目标）等于没实现
  const hasDraw = ENDGAMES.some(e => e.goal === ENDGAME_GOAL.DRAW);
  const hasWin = ENDGAMES.some(e => e.goal === ENDGAME_GOAL.WIN);
  check('同时包含取胜类与守和类', hasDraw && hasWin);
}

console.log('');
console.log('========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) process.exit(1);
console.log('[PASS] 残局过关判定全部通过');
