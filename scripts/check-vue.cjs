/**
 * 校验 .vue 文件：分别抽出 script 段做 JS 语法解析，并对 template 做基础配平检查。
 *
 * 为什么需要单独一个脚本：
 * check-syntax.cjs 按纯 JS 解析整个文件，遇到 <template> 开头必然报
 * Unexpected token '<'，那是脚本的适用范围问题，不是 .vue 文件有错。
 * 直接跳过 .vue 又会让首页这类改动完全没有语法保护，所以拆出来单独校验。
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.log('用法: node scripts/check-vue.cjs <file.vue> ...');
  process.exit(1);
}

let fail = 0;

for (const f of files) {
  const abs = path.resolve(f);
  if (!fs.existsSync(abs)) {
    console.log('[FAIL] ' + f + '  文件不存在');
    fail++;
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');

  // ---- 1) script 段语法 ----
  const sm = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!sm) {
    console.log('[WARN] ' + f + '  未找到 script 段');
  } else {
    let js = sm[1];
    // 去掉 ES module 语法后用 Function 构造做语法解析
    js = js.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    js = js.replace(/^\s*export\s+default\s+/m, 'const __c = ');
    try {
      new Function(js);
      console.log('[OK]   ' + f + '  script 段语法通过');
    } catch (e) {
      console.log('[FAIL] ' + f + '  script 段: ' + e.message);
      fail++;
    }
  }

  // ---- 2) template 标签配平 ----
  const tm = src.match(/<template>([\s\S]*)<\/template>/);
  if (tm) {
    const tpl = tm[1];
    // 只统计 view / text 这类成对标签，自闭合与 image 等不参与
    const pairs = ['view', 'text', 'scroll-view', 'canvas', 'button'];
    let tplOk = true;
    for (const tag of pairs) {
      const open = (tpl.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
      const close = (tpl.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      const selfClose = (tpl.match(new RegExp('<' + tag + '[^>]*/>', 'g')) || []).length;
      if (open - selfClose !== close) {
        console.log('[FAIL] ' + f + '  <' + tag + '> 标签不配平: 开 ' +
          (open - selfClose) + ' 闭 ' + close);
        tplOk = false;
        fail++;
      }
    }
    if (tplOk) console.log('[OK]   ' + f + '  template 标签配平');
  }

  // ---- 3) 模板里引用的方法必须在 script 中定义 ----
  if (sm && tm) {
    const js = sm[1];
    const tpl = tm[1];
    // 抽取 @click="fn(...)" / :class="{ x: fn(...) }" 里的方法名
    const used = new Set();
    const reCall = /[@:][\w-]+="[^"]*?([a-zA-Z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = reCall.exec(tpl)) !== null) used.add(m[1]);
    // 插值 {{ fn(...) }}
    const reMus = /\{\{\s*([a-zA-Z_$][\w$]*)\s*\(/g;
    while ((m = reMus.exec(tpl)) !== null) used.add(m[1]);

    const missing = [];
    for (const name of used) {
      // v-for 的迭代变量与内置不算
      if (['Math', 'String', 'Number', 'Boolean', 'Array', 'Object'].includes(name)) continue;
      if (js.indexOf(name) < 0) missing.push(name);
    }
    if (missing.length) {
      console.log('[FAIL] ' + f + '  模板引用但 script 未定义: ' + missing.join(', '));
      fail++;
    } else if (used.size) {
      console.log('[OK]   ' + f + '  模板引用的 ' + used.size + ' 个方法均已定义');
    }
  }
}

console.log('');
if (fail > 0) {
  console.log('共 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('[PASS] .vue 校验全部通过');
