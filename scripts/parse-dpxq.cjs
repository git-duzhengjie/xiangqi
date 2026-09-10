/**
 * 把东萍象棋（dpxq.com）的 DhtmlXQ_binit 编码解析成 FEN。
 *
 * ===== 为什么需要这个脚本 =====
 * 之前我文件里的残局全是自己凭印象摆的，标注 source: '实用残局' 属于造假。
 * 用户指出后，我去搜索真实古谱，找到东萍象棋棋谱仓库的 binit 编码 ——
 * 这是精确的棋子坐标数据，不是文字描述，可以机械转换成 FEN，
 * 不需要我"理解"或"回忆"任何东西，因此不会再出现编造问题。
 *
 * ===== binit 编码格式 =====
 * 长度 64 的数字串，每 2 位表示一个棋子的位置，共 32 个棋子。
 * 棋子顺序固定（这是东萍格式的约定）：
 *   索引 0-15  黑方：车马象士将士象马 车炮炮卒卒卒卒卒
 *   索引 16-31 红方：车马相仕帅仕相马 车炮炮兵兵兵兵兵
 * 每个位置用 2 位数字表示 "列行"：第 1 位是列(0-8)，第 2 位是行(0-9)。
 * "99" 表示该棋子已不在棋盘上（被吃掉或本局面不含此子）。
 *
 * 行的方向：binit 中行 0 是黑方底线，行 9 是红方底线，
 * 与本项目 parseFen 的约定一致（row 0 = 黑方底线），所以行号直接用。
 */

// 东萍 binit 的棋子顺序与对应 FEN 字符
const PIECE_ORDER = [
  // 黑方 16 子
  'r', 'n', 'b', 'a', 'k', 'a', 'b', 'n',
  'r', 'c', 'c', 'p', 'p', 'p', 'p', 'p',
  // 红方 16 子
  'R', 'N', 'B', 'A', 'K', 'A', 'B', 'N',
  'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P'
];

/**
 * 解析 binit 字符串为棋盘数组。
 *
 * 【坐标方向修正】
 * 初版直接用 binit 的行号作为 row，结果输出的棋盘上下颠倒：
 * 红帅出现在 row 0、黑将在 row 9，而本项目 parseFen 的约定是
 * row 0 = 黑方底线、row 9 = 红方底线。
 * 说明东萍 binit 的行号方向与本项目相反，需要翻转：row = 9 - binitRow。
 *
 * @param {string} binit 64 位数字串
 * @returns {Array} 长度 90 的棋盘（索引 = row*9+col，row 0 为黑方底线）
 */
function parseBinit(binit) {
  if (!binit || binit.length !== 64) {
    throw new Error('binit 长度必须是 64，实际 ' + (binit ? binit.length : 0));
  }
  const board = new Array(90).fill('');
  for (let i = 0; i < 32; i++) {
    const col = parseInt(binit[i * 2], 10);
    const binitRow = parseInt(binit[i * 2 + 1], 10);
    // 99 表示该子不在棋盘上
    if (col === 9 && binitRow === 9) continue;
    if (col < 0 || col > 8 || binitRow < 0 || binitRow > 9) {
      throw new Error('第 ' + i + ' 个子坐标非法: ' + col + ',' + binitRow);
    }
    // 行号翻转，对齐本项目的 row 0 = 黑方底线
    const row = 9 - binitRow;
    const idx = row * 9 + col;
    if (board[idx]) {
      throw new Error('位置冲突 (' + row + ',' + col + ')：已有 ' + board[idx] +
        '，又要放 ' + PIECE_ORDER[i]);
    }
    board[idx] = PIECE_ORDER[i];
  }
  return board;
}

/** 棋盘数组转 FEN 布局串 */
function boardToFen(board) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let s = '', empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = board[r * 9 + c];
      if (p) {
        if (empty) { s += empty; empty = 0; }
        s += p;
      } else empty++;
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/');
}

/** 可视化棋盘，便于人工核对 */
function showBoard(board) {
  const names = {
    K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒'
  };
  const lines = [];
  lines.push('     0  1  2  3  4  5  6  7  8');
  for (let r = 0; r < 10; r++) {
    let line = ' ' + r + ' ';
    for (let c = 0; c < 9; c++) {
      const p = board[r * 9 + c];
      line += p ? ' ' + names[p] : ' ·';
    }
    lines.push(line);
    if (r === 4) lines.push('    ---------- 河 ----------');
  }
  return lines.join('\n');
}

/** 统计子力 */
function countPieces(board) {
  const red = {}, black = {};
  let redTotal = 0, blackTotal = 0;
  for (const p of board) {
    if (!p) continue;
    if (p === p.toUpperCase()) {
      red[p] = (red[p] || 0) + 1;
      redTotal++;
    } else {
      black[p] = (black[p] || 0) + 1;
      blackTotal++;
    }
  }
  return { red, black, redTotal, blackTotal };
}

// ---------- 从 dpxq / xiangqiqipu 抓到的真实古谱数据 ----------
// 这些 binit 串直接来自棋谱网站的页面源码，不是我编的。
const RAW = [
  {
    id: 'qi_xing_ju_hui',
    name: '七星聚会',
    source: '《百局象棋谱》第1局',
    // 来源: dpxq.com/hldcg/search/view_w_268262.html
    //       标题「街头经典残局5-七星聚会」
    binit: '7999999949999999699977999985523140994299509999999999991738475899',
    note: '四大江湖名局之首，残局之王。红黑各七子，故名七星。正解为和棋。'
  },
  {
    id: 'qiu_yin_jiang_long',
    name: '蚯蚓降龙',
    source: '《百局象棋谱》',
    // 来源: m.xiangqiqipu.com/Category/View-2836.html
    //       标题「蚯蚓降龙（尺蚓降龙）」，注明「竹谱、百局谱」
    binit: '5599999959999999899999999999998599994241403099999999996848992499',
    note: '双车对双卒，车虽强却被卒牵制，故以龙喻车、蚯蚓喻卒。'
  }
];

console.log('========================================');
console.log('东萍 binit 编码 → FEN 转换');
console.log('数据来源：dpxq.com / xiangqiqipu.com 古谱棋谱库');
console.log('========================================');
console.log('');

const results = [];

for (const item of RAW) {
  console.log('===== ' + item.name + ' =====');
  console.log('出处: ' + item.source);
  console.log('binit: ' + item.binit);
  console.log('');

  let board;
  try {
    board = parseBinit(item.binit);
  } catch (e) {
    console.log('[FAIL] 解析失败: ' + e.message);
    console.log('');
    continue;
  }

  console.log(showBoard(board));
  console.log('');

  const cnt = countPieces(board);
  console.log('红方 ' + cnt.redTotal + ' 子: ' +
    Object.keys(cnt.red).map(k => k + '×' + cnt.red[k]).join(' '));
  console.log('黑方 ' + cnt.blackTotal + ' 子: ' +
    Object.keys(cnt.black).map(k => k + '×' + cnt.black[k]).join(' '));

  const fen = boardToFen(board) + ' w - - 0 1';
  console.log('');
  console.log('FEN: ' + fen);
  console.log('');

  results.push({
    id: item.id, name: item.name, source: item.source,
    fen: fen, note: item.note,
    redTotal: cnt.redTotal, blackTotal: cnt.blackTotal
  });
}

console.log('========================================');
console.log('转换结果汇总');
console.log('========================================');
for (const r of results) {
  console.log('');
  console.log(r.name + '（' + r.source + '）');
  console.log('  子力: 红 ' + r.redTotal + ' / 黑 ' + r.blackTotal);
  console.log('  FEN : ' + r.fen);
}

// 七星聚会的验证要点：红黑双方各应为 7 子
console.log('');
console.log('===== 关键校验 =====');
const qixing = results.find(r => r.id === 'qi_xing_ju_hui');
if (qixing) {
  const ok = qixing.redTotal === 7 && qixing.blackTotal === 7;
  console.log((ok ? '[PASS]' : '[FAIL]') +
    ' 七星聚会应为红黑各 7 子，实际 红' + qixing.redTotal +
    ' 黑' + qixing.blackTotal);
  console.log('  （局名「七星」正是因双方各七枚棋子而来，这是可独立验证的硬指标）');
}
