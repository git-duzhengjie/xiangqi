// 语法校验：用 Node 自带解析器直接验证文件能否被正确解析
// 比手工数括号可靠得多——手工计数会把注释和字符串里的括号也算进去，产生假报警
const fs = require('fs');
const path = process.argv[2];
const src = fs.readFileSync(path, 'utf8');

try {
  // 用 Function 构造器触发完整语法解析（不执行代码体）
  // 先把 ES Module 语法转成可解析形式
  const stripped = src
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]*['"]\s*;?/gm, '')
    .replace(/^\s*import\s+['"][^'"]*['"]\s*;?/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'var __d = ')
    .replace(/^\s*export\s+/gm, '');
  new Function(stripped);
  console.log('[PASS] ' + path + ' 语法解析通过');
} catch (e) {
  console.log('[FAIL] ' + path);
  console.log('  ' + e.message);
  process.exit(1);
}
