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

// 【目录职责】根据 .gitignore 的明确设计：
//   native/android/java/...            ← 源码的【唯一权威位置】，入库，CI 使用
//   app/nativeplugins/XiangqiEngine/.. ← 已组装的插件目录，属于构建产物，
//                                        已被 gitignore，CI 环境根本不存在
//
// 因此 native 下那份必须存在且必须编译通过；
// app 下那份只在本地存在时才检查 —— 它是开发机上实际运行的副本，
// 若与 native 不一致，会出现“改了源头但本地跑的还是旧插件”的假象，
// 所以本地仍要做一致性比对并提醒重新安装。
const NATIVE_SRC = {
  label: 'native 源头 (权威位置)',
  dir: path.join(repoRoot, 'native', 'android', 'java'),
  required: true,
};
const PLUGIN_SRC = {
  label: 'app 插件目录 (本地产物)',
  dir: path.join(
    repoRoot, 'app', 'nativeplugins', 'XiangqiEngine',
    'android', 'src', 'main', 'java'
  ),
  required: false,
};

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

// native 源头：必须存在
if (!fs.existsSync(NATIVE_SRC.dir)) fail(`源码目录不存在: ${NATIVE_SRC.dir}`);
NATIVE_SRC.files = collectJava(NATIVE_SRC.dir);
if (NATIVE_SRC.files.length === 0) fail(`${NATIVE_SRC.label} 下未找到 Java 源文件`);

// app 插件副本：可选（CI 上被 gitignore，根本不存在）
const hasPlugin = fs.existsSync(PLUGIN_SRC.dir);
PLUGIN_SRC.files = hasPlugin ? collectJava(PLUGIN_SRC.dir) : [];

const COMPILE_TARGETS = [NATIVE_SRC];
if (hasPlugin && PLUGIN_SRC.files.length > 0) COMPILE_TARGETS.push(PLUGIN_SRC);

console.log(`  桩类文件   : ${stubs.length}`);
console.log(`  ${NATIVE_SRC.label} : ${NATIVE_SRC.files.length} 个文件`);
console.log(
  hasPlugin && PLUGIN_SRC.files.length > 0
    ? `  ${PLUGIN_SRC.label} : ${PLUGIN_SRC.files.length} 个文件`
    : `  ${PLUGIN_SRC.label} : 未安装，跳过（CI 环境属正常）`
);

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

// 一致性校验：仅在本地（app 插件已安装）时做。
// 目的是防止“改了 native 源头但本地跑的还是旧插件”，
// 那会让人误以为修复无效。
console.log('');
if (hasPlugin && PLUGIN_SRC.files.length > 0) {
  console.log('  —— 源头与本地插件一致性校验 ——');
  const rel = (base, f) => path.relative(base, f).replace(/\\/g, '/');
  const mapA = new Map(NATIVE_SRC.files.map(f => [rel(NATIVE_SRC.dir, f), f]));
  const mapB = new Map(PLUGIN_SRC.files.map(f => [rel(PLUGIN_SRC.dir, f), f]));

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  let diffCount = 0;
  for (const k of [...allKeys].sort()) {
    if (!mapA.has(k)) { console.log(`    [异常] native 源头缺: ${k}`); diffCount++; continue; }
    if (!mapB.has(k)) { console.log(`    [过时] 本地插件缺: ${k}`); diffCount++; continue; }
    const ta = fs.readFileSync(mapA.get(k), 'utf8').replace(/\r\n/g, '\n');
    const tb = fs.readFileSync(mapB.get(k), 'utf8').replace(/\r\n/g, '\n');
    if (ta !== tb) { console.log(`    [过时] ${k}`); diffCount++; }
    else console.log(`    [OK] ${k}`);
  }
  if (diffCount > 0) {
    console.log('');
    console.log(`  [提醒] 本地插件有 ${diffCount} 处与源头不一致。`);
    console.log('         native/ 是唯一权威位置，请重跑 CI 并用');
    console.log('         scripts/install-artifact.ps1 重新安装插件，');
    console.log('         否则本地跑的仍是旧代码，会让人误以为修复无效。');
  }
} else {
  console.log('  —— 跳过一致性校验（本地未安装插件）——');
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqjavac-'));

let ok = true;
let produced = true;

for (const s of COMPILE_TARGETS) {
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
