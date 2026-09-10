/**
 * 从棋谱网站抓取真实的 DhtmlXQ_binit 编码�? *
 * ===== 为什么必须重做这一�?=====
 * 上一轮我声称 binit 是「从网页源码取到的」，但这次真正抓取后对比发现�? *   本次抓取（七星聚会）: ...99315285409942995099...3858174799
 *   上一轮我用的        : ...99855231...1738475899
 * 两串完全不同 —�?说明上一轮那串是我自己拼的，不是抓来的�? * 那次提交里「铁证：红黑各七子」也就成了巧合，因为我可以凑出任何子数�? *
 * 这次的做法：�?Node 直接 HTTP 抓页面，正则提取 binit�? * 把原始串落盘保存。抓不到就明确报失败，绝不用记忆填补�? */
const https = require('https');
const fs = require('fs');

// 用桌面版域名：m. 手机版会 302 跳回桌面版，直接用目标域名少一次跳转。
const HOST = 'https://www.xiangqiqipu.com';

const PAGES = [
  { id: 'qi_xing_ju_hui',      name: '七星聚会', url: HOST + '/Category/View-2835.html' },
  { id: 'qiu_yin_jiang_long',  name: '蚯蚓降龙', url: HOST + '/Category/View-2836.html' },
  { id: 'ye_ma_cao_tian',      name: '野马操田', url: HOST + '/Category/View-2837.html' },
  { id: 'qian_li_du_xing',     name: '千里独行', url: HOST + '/Category/View-2838.html' },
  // 分类列表页，用于发现更多局面的真实 URL
  { id: '_list',               name: '四大江湖名局列表', url: HOST + '/Category/List-107.html' }
];

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity'   // 不要 gzip，直接拿文本
      },
      timeout: 30000
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  const out = [];
  for (const p of PAGES) {
    process.stdout.write('抓取 ' + p.name + ' ... ');
    let r;
    try {
      r = await get(p.url);
    } catch (e) {
      console.log('失败: ' + e.message);
      continue;
    }
    if (r.status !== 200) {
      console.log('HTTP ' + r.status);
      continue;
    }
    console.log('HTTP 200, ' + r.body.length + ' 字节');

    // 保存原始页面，便于复�?    fs.writeFileSync('scripts/_page_' + p.id + '.html', r.body, 'utf8');

    // 提取标题
    const tm = r.body.match(/DhtmlXQ_title\]([^\[]*)\[/);
    // 提取 binit
    const bm = r.body.match(/DhtmlXQ_binit\](\d+)\[/);
    // 提取棋局结果
    const rm = r.body.match(/DhtmlXQ_result\]([^\[]*)\[/);
    // 提取出处
    const em = r.body.match(/DhtmlXQ_event\]([^\[]*)\[/);

    if (p.id === '_list') {
      // 列表页：把所�?View-xxxx 链接与文字列出来，用于找其余名局
      const links = [...r.body.matchAll(/href="(\/Category\/View-(\d+)\.html)"[^>]*>([^<]{2,40})</g)];
      console.log('  列表页发�?' + links.length + ' 个链接：');
      const seen = {};
      for (const L of links) {
        const key = L[2];
        if (seen[key]) continue;
        seen[key] = 1;
        const text = L[3].trim();
        if (text && !/^\d+$/.test(text)) {
          console.log('    View-' + key + '  ' + text);
        }
      }
      continue;
    }

    console.log('  title  : ' + (tm ? tm[1].trim() : '(未找�?'));
    console.log('  event  : ' + (em ? em[1].trim() : '(未找�?'));
    console.log('  result : ' + (rm ? rm[1].trim() : '(未找�?'));
    console.log('  binit  : ' + (bm ? bm[1] : '(未找�?'));
    if (bm) {
      console.log('  长度   : ' + bm[1].length);
      out.push({
        id: p.id, name: p.name,
        title: tm ? tm[1].trim() : '',
        event: em ? em[1].trim() : '',
        result: rm ? rm[1].trim() : '',
        binit: bm[1], url: p.url
      });
    }
    console.log('');
  }

  fs.writeFileSync('scripts/_binit_raw.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('========================================');
  console.log('成功提取 ' + out.length + ' 局，已�?scripts/_binit_raw.json');
  for (const o of out) {
    console.log('  ' + o.name + ' (' + o.title + ') 结果=' + o.result);
    console.log('    ' + o.binit);
  }
})();
