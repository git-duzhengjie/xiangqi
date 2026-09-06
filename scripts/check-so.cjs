#!/usr/bin/env node
/**
 * 校验 libpikafish.so 是否可被 Android 正常 dlopen。
 *
 * 【为什么需要这个脚本】
 * 链接共享库时 ld 默认允许未解析符号存在（留给运行时解析），
 * 所以哪怕某个函数根本没人实现，.so 也能顺利生成、CI 一路绿灯，
 * 直到真机 dlopen 才报 "failed to link libpikafish.so"，排查成本极高。
 *
 * 曾踩：pikafish_jni.cpp 声明 pikafish_main 时漏写 extern "C"，
 * 符号被 C++ 修饰成 _Z13pikafish_mainiPPc，与 engine_main.cpp 中
 * extern "C" 定义的 pikafish_main 对不上，一路漏到手机上才炸。
 *
 * 本脚本直接解析 ELF，检查：
 *   1. 架构与目录名一致（arm64-v8a 必须是 AARCH64，x86_64 必须是 x86-64）
 *   2. 三个 JNI 入口符号齐备
 *   3. 无「本该由自己实现」的未定义符号（白名单外的 C++ 修饰名一律视为错误）
 *
 * 用法: node scripts/check-so.cjs <libs目录>
 */
const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error('[FAIL] ' + msg);
  process.exitCode = 1;
}

function parseElf(buf) {
  if (buf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  const is64 = buf[4] === 2;
  if (!is64) throw new Error('expect 64-bit ELF');
  const machine = buf.readUInt16LE(18);
  const machMap = { 0xB7: 'AARCH64', 0x3E: 'x86-64', 0x28: 'ARM', 0x03: 'x86' };

  const shoff = Number(buf.readBigUInt64LE(0x28));
  const shentsize = buf.readUInt16LE(0x3A);
  const shnum = buf.readUInt16LE(0x3C);
  const shstrndx = buf.readUInt16LE(0x3E);

  const sec = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    sec.push({
      nameOff: buf.readUInt32LE(o),
      offset: Number(buf.readBigUInt64LE(o + 0x18)),
      size: Number(buf.readBigUInt64LE(o + 0x20)),
      entsize: Number(buf.readBigUInt64LE(o + 0x38)),
    });
  }
  const shstr = sec[shstrndx];
  const strAt = (base, off) => {
    let e = base + off;
    while (buf[e] !== 0) e++;
    return buf.toString('utf8', base + off, e);
  };
  for (const s of sec) s.name = strAt(shstr.offset, s.nameOff);

  const dyn = sec.find(s => s.name === '.dynamic');
  const dynstr = sec.find(s => s.name === '.dynstr');
  const needed = [];
  if (dyn && dynstr) {
    for (let o = dyn.offset; o < dyn.offset + dyn.size; o += 16) {
      const tag = Number(buf.readBigUInt64LE(o));
      const val = Number(buf.readBigUInt64LE(o + 8));
      if (tag === 0) break;
      if (tag === 1) needed.push(strAt(dynstr.offset, val));
    }
  }

  const dynsym = sec.find(s => s.name === '.dynsym');
  const undef = [], defined = [];
  if (dynsym && dynstr) {
    const esz = dynsym.entsize || 24;
    for (let o = dynsym.offset; o < dynsym.offset + dynsym.size; o += esz) {
      const nm = buf.readUInt32LE(o);
      const info = buf[o + 4];
      const shndx = buf.readUInt16LE(o + 6);
      if (!nm) continue;
      const name = strAt(dynstr.offset, nm);
      // bind: 高 4 位，2 = STB_WEAK（弱符号允许未定义）
      const weak = (info >> 4) === 2;
      if (shndx === 0) { if (!weak) undef.push(name); }
      else defined.push(name);
    }
  }
  return { machine: machMap[machine] || ('0x' + machine.toString(16)), needed, undef, defined };
}

const EXPECT_ARCH = { 'arm64-v8a': 'AARCH64', 'x86_64': 'x86-64' };
const JNI_SYMS = [
  'Java_com_xiangqi_engine_PikafishBridge_nativeInit',
  'Java_com_xiangqi_engine_PikafishBridge_nativeSend',
  'Java_com_xiangqi_engine_PikafishBridge_nativeReadLine',
];

const libsDir = process.argv[2];
if (!libsDir || !fs.existsSync(libsDir)) {
  console.error('用法: node scripts/check-so.cjs <libs目录>');
  process.exit(1);
}

console.log('');
console.log('libpikafish.so ELF check');
console.log('='.repeat(60));

let found = 0;
for (const abi of Object.keys(EXPECT_ARCH)) {
  const p = path.join(libsDir, abi, 'libpikafish.so');
  if (!fs.existsSync(p)) { console.log('  ' + abi + ': (not built, skip)'); continue; }
  found++;
  console.log('');
  console.log('  [' + abi + ']');

  const e = parseElf(fs.readFileSync(p));
  const sizeKB = (fs.statSync(p).size / 1024).toFixed(1);
  console.log('    size      : ' + sizeKB + ' KB');
  console.log('    arch      : ' + e.machine);
  console.log('    DT_NEEDED : ' + e.needed.join(', '));

  if (e.machine !== EXPECT_ARCH[abi]) {
    fail(abi + ' arch mismatch: expect ' + EXPECT_ARCH[abi] + ', got ' + e.machine);
  } else {
    console.log('    arch OK');
  }

  for (const s of JNI_SYMS) {
    if (e.defined.includes(s)) console.log('    JNI OK    : ' + s);
    else fail(abi + ' missing JNI symbol: ' + s);
  }

  // C++ 修饰名（_Z 开头）未定义 = 自己人没实现，必然 dlopen 失败
  const badCxx = e.undef.filter(s => s.startsWith('_Z'));
  if (badCxx.length) {
    fail(abi + ' has ' + badCxx.length + ' undefined C++ symbol(s) '
       + '-- these will cause "dlopen failed: failed to link":');
    for (const s of badCxx) console.error('           ' + s);
  } else {
    console.log('    no undefined C++ symbols');
  }

  // 依赖库必须都是系统库
  const allowed = ['liblog.so', 'libm.so', 'libdl.so', 'libc.so', 'libandroid.so'];
  const extra = e.needed.filter(n => !allowed.includes(n));
  if (extra.length) {
    fail(abi + ' depends on non-system lib(s): ' + extra.join(', ')
       + ' -- these must be shipped in the same libs/ dir or dlopen fails');
  } else {
    console.log('    deps are system libs only');
  }
}

console.log('');
if (found === 0) { console.error('[FAIL] no .so found under ' + libsDir); process.exit(1); }
if (process.exitCode) { console.error('[FAIL] so check failed'); process.exit(1); }
console.log('[PASS] ' + found + ' .so verified, safe to dlopen');
