/**
 * check-android-plugin.js -- Android 原生插件 Java 源码编译校验
 *
 * 【为什么需要这个脚本】
 * uni-app 原生插件的 Java 代码只在「HBuilderX 云打包」阶段才会被编译，
 * 本地和 CI 都不做任何检查。这导致编译错误会一路溜到真机上，
 * 表现却只是「原生插件未加载」这种毫无指向性的提示，排查成本极高。
 *
 * 实际踩过的坑：XiangqiEngineModule 里误用了 fastjson 不存在的
 *   options.optString(key, fallback)     <-- 这是 Android org.json 的 API
 * 正确应为
 *   options.getString(key)
 * 该错误让整个插件类无法生成，requireNativePlugin('XiangqiEngine')
 * 返回 null，Android 端引擎完全不可用。
 *
 * 【原理】
 * DCloud 的 Android SDK 只通过网盘分发、未上传 maven，CI 拿不到 aar，
 * 所以用 native/android/stubs 下的最小桩类复刻所需 API 签名，
 * 再用纯 javac 编译插件源码，即可在不依赖 SDK 的前提下做类型检查。
 *
 * 【用法】
 *   node scripts/check-android-plugin.js
 * 退出码 0 表示通过，非 0 表示有编译错误。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const stubDir = path.join(repoRoot, 'native', 'android', 'stubs');

// 【重要】Java 源码在仓库里有两份副本：
//   native/android/java/...             ← CI 组装插件时的拷贝源头
//   app/nativeplugins/XiangqiEngine/... ← 本地 HBuilderX 实际使用的
// 曾因只改了 app 下那份、没改 native 源头，导致 CI 产物里仍是旧代码，
// 装上去依旧报错，白白排查很久。故两份都编译，并强制校验内容一致。
const SRC_DIRS = [
  {
    label: 'native 源头 (CI 使用)',
    dir: path.join(repoRoot, 'native', 'android', 'java'),
  },
  {
    label: 'app 插件目录 (本地使用)',
    dir: path.join(
      repoRoot, 'app', 'nativeplugins', 'XiangqiEngine',
      'android', 'src', 'main', 'java'
    ),
  },
];

function collectJava(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...collectJava(p));
    else if (name.endsWith('.java')) out.push(p);
  }
  return out;
}

function fail(msg) {
  console.error(`\n[FAIL] ${msg}`);
  process.exit(1);
}

console.log('');
console.log('Android 插件 Java 编译校验');
console.log('='.repeat(46));

if (!fs.existsSync(stubDir)) fail(`桩类目录不存在: ${stubDir}`);

const stubs = collectJava(stubDir);

let totalSrc = 0;
for (const s of SRC_DIRS) {
  if (!fs.existsSync(s.dir)) fail(`源码目录不存在: ${s.dir}`);
  s.files = collectJava(s.dir);
  if (s.files.length === 0) fail(`${s.label} 下未找到 Java 源文件`);
  totalSrc += s.files.length;
}

console.log(`  桩类文件   : ${stubs.length}`);
SRC_DIRS.forEach(s => {
  console.log(`  ${s.label} : ${s.files.length} 个文件`);
});

// 关键防呆：桩类里绝不能出现 optString，
// 否则会把真实的 API 误用「合法化」，让校验形同虚设。
const fastjsonStub = path.join(stubDir, 'com', 'alibaba', 'fastjson', 'JSONObject.java');
if (fs.existsSync(fastjsonStub)) {
  const txt = fs.readFileSync(fastjsonStub, 'utf8');
  // 只看真实的方法声明，不能直接搜关键字 ——
  // 桩类注释里特意写了「不要添加 optString」的说明，
  // 简单搜关键字会把这段说明本身当成违规。
  const declared = /^[^/*]*\b(?:public|protected)\s+[\w<>\[\],\s.]+\boptString\s*\(/m.test(txt);
  if (declared) {
    fail('桩类 JSONObject 中声明了 optString —— fastjson 并无此方法，'
       + '加入桩会掩盖真实错误，请删除');
  }
  console.log('  桩类防呆   : OK (未声明 optString)');
}

// 一致性校验：两份副本同名文件内容必须完全相同，
// 否则“本地正常但 CI 产物是旧代码”的坑会反复出现。
console.log('');
console.log('  —— 双副本一致性校验 ——');
const [a, b] = SRC_DIRS;
const rel = (base, f) => path.relative(base, f).replace(/\\/g, '/');
const mapA = new Map(a.files.map(f => [rel(a.dir, f), f]));
const mapB = new Map(b.files.map(f => [rel(b.dir, f), f]));

const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
let diffCount = 0;
for (const k of [...allKeys].sort()) {
  if (!mapA.has(k)) { console.log(`    [缺失] native 源头缺: ${k}`); diffCount++; continue; }
  if (!mapB.has(k)) { console.log(`    [缺失] app 插件目录缺: ${k}`); diffCount++; continue; }
  const ta = fs.readFileSync(mapA.get(k), 'utf8').replace(/\r\n/g, '\n');
  const tb = fs.readFileSync(mapB.get(k), 'utf8').replace(/\r\n/g, '\n');
  if (ta !== tb) { console.log(`    [不一致] ${k}`); diffCount++; }
  else console.log(`    [OK] ${k}`);
}
if (diffCount > 0) {
  fail(`两份 Java 副本有 ${diffCount} 处不一致。`
     + '请保持 native/android/java 与 app/nativeplugins/.../java 完全同步，'
     + '否则 CI 打出的插件会是旧代码。');
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqjavac-'));

let ok = true;
let produced = true;

for (const s of SRC_DIRS) {
  console.log('');
  console.log(`  —— 编译 ${s.label} ——`);
  const dst = path.join(outDir, s.label.replace(/[^\w]/g, '_'));
  fs.mkdirSync(dst, { recursive: true });

  let output = '';
  try {
    output = execFileSync(
      'javac',
      ['-encoding', 'UTF-8', '-nowarn', '-d', dst, ...stubs, ...s.files],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    ok = false;
    output = (e.stdout || '') + (e.stderr || '');
  }

  if (output.trim()) {
    output.trim().split(/\r?\n/).forEach(l => console.log('    ' + l));
  }

  // 确认插件主类真的生成了 class，防止“没报错但什么也没产出”
  const cls = path.join(dst, 'com', 'xiangqi', 'engine', 'XiangqiEngineModule.class');
  const has = fs.existsSync(cls);
  if (!has) produced = false;
  console.log(`    XiangqiEngineModule.class : ${has ? '已生成' : '未生成'}`);
}

fs.rmSync(outDir, { recursive: true, force: true });

console.log('');
if (!ok || !produced) {
  console.error('[FAIL] Android 插件 Java 编译校验未通过');
  console.error('       请修正上述错误后再提交，否则云打包会静默产出不可用插件。');
  process.exit(1);
}

console.log('[PASS] Android 插件 Java 编译校验通过');
console.log('');
