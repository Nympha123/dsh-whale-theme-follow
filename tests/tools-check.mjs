#!/usr/bin/env node
/**
 * 自检：两个"改数据"的工具（泡泡框导入 / 角色图安装）在临时目录里跑一遍。
 * 不依赖上游插件包，也不需要联网 —— CI 与本地都能秒跑。
 *
 *   node tests/tools-check.mjs
 *
 * 子进程用 stdio:'ignore'+stderr 继承：不建管道，避免在受限沙箱里被拒。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const ok = (name, cond, detail) => results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) })

function run(script, argv) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script)].concat(argv), {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return r.status == null ? 1 : r.status
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const bubbleFile = (home) => path.join(home, '.dshw-bubble.json')
const rolesFile = (home) => path.join(home, 'whale-roles', 'roles.json')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-tools-'))
try {
  // ---------------- 泡泡框导入 ----------------
  const home = path.join(tmp, 'home')
  fs.mkdirSync(home, { recursive: true })
  const minimal = { v: 1, items: [{ kind: 'custom', modules: [{ type: 'text', text: 'hi', size: 6 }] }], lib: [], tapAdvance: false }
  fs.writeFileSync(bubbleFile(home), JSON.stringify(minimal, null, 2), 'utf8')

  ok('泡泡框导入 exit 0', run('install-bubble-frame.mjs', ['--dsh-home', home]) === 0)

  let cfg = readJson(bubbleFile(home))
  const raw = fs.readFileSync(bubbleFile(home), 'utf8')
  ok('导入后恰好 1 个框', cfg.frames && cfg.frames.length === 1, cfg.frames && cfg.frames.length)
  ok('保底框指向导入的框', cfg.defaultFrameId === cfg.frames[0].id, cfg.defaultFrameId)
  ok('框名与预设一致（华小科）', cfg.frames[0].name === '华小科', cfg.frames[0].name)
  ok('描边取自预设 #a85c6a', cfg.frames[0].slots.big.paint.line === '#a85c6a', cfg.frames[0].slots.big.paint.line)
  ok('items 未被改动', JSON.stringify(cfg.items) === JSON.stringify(minimal.items))
  ok('lib / tapAdvance 未被改动', JSON.stringify(cfg.lib) === '[]' && cfg.tapAdvance === false)
  ok('顶层键顺序 = v,items,lib,tapAdvance,frames,defaultFrameId',
    Object.keys(cfg).join(',') === 'v,items,lib,tapAdvance,frames,defaultFrameId', Object.keys(cfg).join(','))
  ok('写出的文件不带 BOM', raw.charCodeAt(0) !== 0xfeff)
  ok('2 空格缩进', raw.split('\n')[1] === '  "v": 1,')

  ok('再导入一次 exit 0', run('install-bubble-frame.mjs', ['--dsh-home', home]) === 0)
  cfg = readJson(bubbleFile(home))
  ok('再导入不会长出第二个框（幂等）', cfg.frames.length === 1, cfg.frames.length)

  // 拒绝路径：没有配置 / items 为空
  const empty = path.join(tmp, 'empty')
  fs.mkdirSync(empty, { recursive: true })
  ok('配置文件不存在时明确失败', run('install-bubble-frame.mjs', ['--dsh-home', empty]) !== 0)
  const ei = path.join(tmp, 'emptyitems')
  fs.mkdirSync(ei, { recursive: true })
  fs.writeFileSync(bubbleFile(ei), JSON.stringify({ v: 1, items: [], lib: [], tapAdvance: false }), 'utf8')
  ok('items 为空时明确失败', run('install-bubble-frame.mjs', ['--dsh-home', ei]) !== 0)

  // ---------------- 角色图安装 ----------------
  const rolesDir = path.join(ROOT, 'roles')
  const imgs = fs.existsSync(rolesDir) ? fs.readdirSync(rolesDir).filter((f) => /\.(png|gif)$/i.test(f)) : []
  if (!imgs.length) {
    ok('roles/ 里至少有一张图可测', false, '空目录')
  } else {
    ok('角色图安装 exit 0', run('install-role-image.mjs', ['--dsh-home', home, '--from-dir', rolesDir]) === 0)
    let roles = readJson(rolesFile(home))
    const hit = roles.roles.filter((r) => r.name === '华小科')
    ok('装出恰好一个「华小科」', hit.length === 1, hit.length)
    ok('内置 default 仍在列表里', roles.roles.some((r) => r.id === 'default'))
    const id1 = hit[0] && hit[0].id
    ok('角色 id 合法', /^[A-Za-z0-9_-]{1,64}$/.test(id1 || ''), id1)

    ok('再装一次 exit 0', run('install-role-image.mjs', ['--dsh-home', home, '--from-dir', rolesDir]) === 0)
    roles = readJson(rolesFile(home))
    const hit2 = roles.roles.filter((r) => r.name === '华小科')
    ok('再装不会重复（复用同一 id）', hit2.length === 1 && hit2[0].id === id1, hit2.length + ' / ' + (hit2[0] && hit2[0].id))
    ok('图片文件已落盘', fs.existsSync(path.join(home, 'whale-roles', id1 + '.png')))
  }

  // ---------------- dry-run 零副作用 ----------------
  const dr = path.join(tmp, 'dryrun')
  fs.mkdirSync(dr, { recursive: true })
  fs.writeFileSync(bubbleFile(dr), JSON.stringify(minimal, null, 2), 'utf8')
  const beforeDr = fs.readFileSync(bubbleFile(dr), 'utf8')

  if (imgs.length) {
    ok('角色图 dry-run exit 0', run('install-role-image.mjs', ['--dsh-home', dr, '--from-dir', rolesDir, '--dry-run']) === 0)
    ok('角色图 dry-run 不创建 whale-roles 目录', !fs.existsSync(path.join(dr, 'whale-roles')))
  }
  ok('泡泡框 dry-run exit 0', run('install-bubble-frame.mjs', ['--dsh-home', dr, '--dry-run']) === 0)
  ok('泡泡框 dry-run 不改动配置文件', fs.readFileSync(bubbleFile(dr), 'utf8') === beforeDr)
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (err) {}
}

let bad = 0
for (const r of results) {
  if (!r.ok) bad++
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''))
}
console.log('\n' + (bad === 0 ? 'ALL PASS' : bad + ' FAILED') + '  (' + results.length + ' checks)')
process.exit(bad === 0 ? 0 : 1)
