#!/usr/bin/env node
/**
 * 小鲸鱼挂件 · 泡泡框导入器（跨平台，Node >= 18）
 * ------------------------------------------------------------------
 * 把预设里的泡泡框**合并**进 $DSH_HOME/.dshw-bubble.json（不覆盖你的点击序列与模块库），
 * 可选把它设为保底框（defaultFrameId）。
 *
 * 为什么写这个文件：宿主的 writeBubbleConfig() 就是往 .dshw-bubble.json 写
 * JSON.stringify(cfg, null, 2)，键顺序 v / items / lib / tapAdvance / frames / defaultFrameId。
 * 本工具按同样格式写，所以不会有格式抖动。
 *
 * ⚠️ 两个必须知道的限制（都已实测确认）：
 *   1. 配置文件**必须已有非空 items**，否则插件不会加载 frames ——
 *      前端 applyBubbleCfgSeq() 在 items 为空时直接 return，而 syncFramesFromCfg() 在它之后。
 *      全新机器请先打开挂件 →「自定义泡泡」→ 点一次「保存」生成配置，再回来跑本工具。
 *   2. 前端内存里有一份完整配置副本，只有你点「保存」时才会回写。
 *      所以导入后请**先重启 DSH**，不要先在界面里改泡泡设置。
 *
 * 用法：
 *   node install-bubble-frame.mjs                          # 用 presets/huaxiaoke.frame.json
 *   node install-bubble-frame.mjs --preset <文件>
 *   node install-bubble-frame.mjs --list
 *   node install-bubble-frame.mjs --no-default             # 只导入，不设为保底框
 *   node install-bubble-frame.mjs --dry-run
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL_VERSION = '0.2.0'
const BUILTIN_FRAME_ID = 'frame_classic'
const SLOT_KEYS = ['big', 'small1', 'small2']
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
// 本工具自己的防御上限：别让一个预设把框库撑得很大（不是插件的限制）
const MAX_FRAMES = 24

const USAGE = `小鲸鱼挂件 · 泡泡框导入器 v${TOOL_VERSION}

用法：
  node install-bubble-frame.mjs [选项]

选项：
      --preset <文件>     预设文件（默认 presets/huaxiaoke.frame.json）
      --dsh-home <目录>   数据目录（默认 $DSH_HOME 或 ~/.dsh）
      --backup-dir <目录> 备份目录（默认与配置文件同目录）
      --no-default        不把导入的框设为保底框
      --list              列出当前框库与保底框
      --allow-svg-code    允许预设携带自定义 SVG 代码（默认拒绝：会绕过宿主的安全净化）
      --dry-run           只报告，不写盘
  -h, --help              显示帮助`

function parseArgs(argv) {
  const o = { preset: '', dshHome: '', backupDir: '', noDefault: false, list: false, allowSvg: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--preset') o.preset = argv[++i] || ''
    else if (a === '--dsh-home') o.dshHome = argv[++i] || ''
    else if (a === '--backup-dir') o.backupDir = argv[++i] || ''
    else if (a === '--no-default') o.noDefault = true
    else if (a === '--list') o.list = true
    else if (a === '--allow-svg-code') o.allowSvg = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a === '--version' || a === '-v') o.version = true
    else { console.error('未知参数：' + a); process.exit(2) }
  }
  return o
}

// 读 JSON：容忍 UTF-8 BOM（Windows 记事本另存为 UTF-8 会加），并给出可读的报错
function readJson(file) {
  let s
  try { s = fs.readFileSync(file, 'utf8') } catch (err) { throw new Error('读不到文件：' + file) }
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  try { return JSON.parse(s) } catch (err) { throw new Error('JSON 解析失败（' + file + '）：' + err.message) }
}

// 与插件 BUBBLE_FILE_CANDIDATES 同序
function bubbleFileCandidates(dshHome) {
  const home = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return [path.join(home, '.dshw-bubble.json'), path.join(home, 'profiles', 'web', '.dshw-bubble.json')]
}
function pickBubbleFile(dshHome) {
  const c = bubbleFileCandidates(dshHome)
  for (const p of c) if (fs.existsSync(p)) return p
  return c[0]
}

// ---------------------------------------------------------------- 净化
// 这些规则镜像插件自己的 frameColor / frameNum / frameNormPaint 口径
const isHex = (s) => /^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s)
const isRgb = (s) => /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(s)
function color(v, def) {
  const s = String(v == null ? '' : v).trim()
  if (isHex(s) || isRgb(s)) return s
  if (s === 'transparent' || s === 'none') return s
  return def
}
function num(v, def, min, max) {
  let n = Number(v)
  if (!Number.isFinite(n)) n = def
  if (typeof min === 'number' && n < min) n = min
  if (typeof max === 'number' && n > max) n = max
  return Math.round(n * 1000) / 1000
}
function alpha(v, def) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : def
}
function oneOf(v, list, def) { return list.includes(v) ? v : def }

function normPaint(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  return {
    bgOn: p.bgOn !== false,
    bg: color(p.bg, '#FFFFFF'),
    bgAlpha: alpha(p.bgAlpha, 1),
    lineOn: p.lineOn !== false,
    line: color(p.line, '#203170'),
    lineW: num(p.lineW, 18, 0, 200),
    lineAlpha: alpha(p.lineAlpha, 1),
    dashOn: p.dashOn === true,
    dash: String(p.dash == null ? '0' : p.dash),
    cap: oneOf(p.cap, ['round', 'butt', 'square'], 'round'),
    join: oneOf(p.join, ['round', 'miter', 'bevel'], 'round'),
  }
}
function normSlot(raw, key, allowSvg) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const svgCode = String(s.svgCode == null ? '' : s.svgCode)
  if (svgCode && !allowSvg) {
    throw new Error(`预设的槽位 ${key} 带自定义 SVG 代码；它会绕过宿主的安全净化，默认拒绝。确需导入请加 --allow-svg-code`)
  }
  const out = {
    dx: num(s.dx, 0, -2000, 2000),
    dy: num(s.dy, 0, -2000, 2000),
    scale: num(s.scale, 1, 0.05, 20),
    kind: oneOf(s.kind, ['svg', 'image'], 'svg'),
    svgPreset: oneOf(s.svgPreset, ['classic', 'roundrect', 'zigzag', 'custom'], 'classic'),
    svgCode,
    imgId: String(s.imgId == null ? '' : s.imgId),
    imgScale: num(s.imgScale, 1, 0.05, 20),
    imgOpacity: alpha(s.imgOpacity, 1),
    paint: normPaint(s.paint),
  }
  if (key === 'small1' || key === 'small2') out.on = s.on !== false
  return out
}
function normFrame(raw, allowSvg) {
  const f = raw && typeof raw === 'object' ? raw : {}
  const name = String(f.name == null ? '' : f.name).trim()
  if (!name) throw new Error('预设里没有框名（frame.name）')
  const safe = f.safe && typeof f.safe === 'object' ? f.safe : {}
  const slots = {}
  for (const k of SLOT_KEYS) {
    if (f.slots && f.slots[k] !== undefined) slots[k] = normSlot(f.slots[k], k, allowSvg)
  }
  if (!slots.big) throw new Error('预设里缺少 big 槽位')
  return {
    name,
    builtin: false,
    pinned: 0,
    textColor: String(f.textColor == null ? '' : f.textColor),
    safe: {
      x: num(safe.x, 190, -5000, 5000),
      y: num(safe.y, 90, -5000, 5000),
      w: num(safe.w, 646, 1, 10000),
      h: num(safe.h, 400, 1, 10000),
    },
    slots,
  }
}

// ------------------------------------------------- 探测 DSH 是否在跑（仅提示）
function probeRunning(ports) {
  return new Promise((resolve) => {
    let pending = ports.length
    let hit = ''
    if (!pending) return resolve('')
    for (const p of ports) {
      const req = http.request({ host: '127.0.0.1', port: p, path: '/dsh-whale/bubble.json', method: 'GET', timeout: 400 }, (res) => {
        res.resume()
        if (!hit) hit = String(p)
        if (--pending === 0) resolve(hit)
      })
      req.on('error', () => { if (--pending === 0) resolve(hit) })
      req.on('timeout', () => { req.destroy(); if (--pending === 0) resolve(hit) })
      req.end()
    }
  })
}

// ------------------------------------------------------------------ 主流程
const args = parseArgs(process.argv.slice(2))
if (args.help) { console.log(USAGE); process.exit(0) }
if (args.version) { console.log(TOOL_VERSION); process.exit(0) }

const target = pickBubbleFile(args.dshHome)
const exists = fs.existsSync(target)

if (args.list) {
  console.log('泡泡配置：' + target + (exists ? '' : '  （还不存在）'))
  if (!exists) process.exit(0)
  const cfg = readJson(target)
  console.log('items 条数：' + (Array.isArray(cfg.items) ? cfg.items.length : 0) + '   （为 0 时插件不会加载 frames）')
  console.log('保底框 defaultFrameId：' + (cfg.defaultFrameId || '(无，走内置经典)'))
  console.log('框库：')
  for (const f of (cfg.frames || [])) {
    console.log(`  ${String(f.id).padEnd(28)} ${f.name}${f.id === BUILTIN_FRAME_ID ? '  (内置只读)' : ''}${f.id === cfg.defaultFrameId ? '  ← 保底' : ''}`)
  }
  if (!(cfg.frames || []).length) console.log('  （空，走内置经典框）')
  process.exit(0)
}

// 读预设
const presetPath = path.resolve(args.preset || path.join(SCRIPT_DIR, 'presets', 'huaxiaoke.frame.json'))
if (!fs.existsSync(presetPath)) { console.error('预设文件不存在：' + presetPath); process.exit(1) }
const preset = readJson(presetPath)
let frame
try {
  frame = normFrame(preset.frame, args.allowSvg)
} catch (err) { console.error('预设不合法：' + err.message); process.exit(1) }
const wantId = String(preset.frameId || (preset.preset ? 'frame_preset_' + preset.preset : 'frame_preset_custom'))
const setDefault = preset.setDefault !== false && !args.noDefault

// 读现有配置
const hasFile = fs.existsSync(target)
let cfg = null
if (hasFile) {
  try { cfg = readJson(target) } catch (err) { console.error('✗ ' + err.message); process.exit(1) }
}
if (!cfg || !Array.isArray(cfg.items) || !cfg.items.length) {
  console.error('✗ 这个 profile 还没有可用的泡泡配置（' + (hasFile ? 'items 为空' : '文件不存在') + '）：' + target)
  console.error('')
  console.error('  原因：插件前端的 applyBubbleCfgSeq() 在 items 为空时直接 return，')
  console.error('        而让框库生效的 syncFramesFromCfg() 排在它之后 ——')
  console.error('        也就是说没有非空 items 的配置，frames 根本不会被加载。')
  console.error('')
  console.error('  请这样做：打开挂件 →「自定义泡泡」→ 点一次「保存」（不用改任何东西），')
  console.error('            让插件生成配置并写入 items，然后退出 DSH 再来跑本工具。')
  process.exit(1)
}

// 合并：先按 id 命中，再按框名命中；命中就原地替换（保留原 id / createdAt / pinned）
const frames = Array.isArray(cfg.frames) ? cfg.frames.slice() : []
let resolvedId = wantId
let how = ''
let idx = frames.findIndex((f) => f && f.id === wantId && f.id !== BUILTIN_FRAME_ID)
if (idx >= 0) how = '按 frameId 命中，原地更新'
else {
  idx = frames.findIndex((f) => f && f.name === frame.name && f.id !== BUILTIN_FRAME_ID)
  if (idx >= 0) { resolvedId = frames[idx].id; how = '按框名「' + frame.name + '」命中，原地更新（保留原 id）' }
}
if (idx >= 0) {
  const old = frames[idx]
  frames[idx] = Object.assign({}, old, frame, { id: old.id, createdAt: old.createdAt, pinned: old.pinned })
} else {
  if (frames.length >= MAX_FRAMES) { console.error(`框库已有 ${frames.length} 个框，超过上限 ${MAX_FRAMES}，拒绝继续添加`); process.exit(1) }
  if (frames.some((f) => f && f.id === resolvedId)) { console.error('frameId 与既有框冲突：' + resolvedId); process.exit(1) }
  frames.push(Object.assign({ id: resolvedId, createdAt: Date.now() }, frame))
  how = '新增'
}

const currentDefault = cfg.defaultFrameId || BUILTIN_FRAME_ID
const out = Object.assign({}, cfg, {
  v: 1,
  items: cfg.items,
  lib: Array.isArray(cfg.lib) ? cfg.lib : [],
  tapAdvance: cfg.tapAdvance === true,
  frames,
  defaultFrameId: setDefault ? resolvedId : currentDefault,
})

console.log('预设      : ' + presetPath)
console.log('目标配置  : ' + target)
console.log('操作      : ' + how)
console.log('框        : ' + frame.name + '  id=' + resolvedId +
  '  描边=' + frame.slots.big.paint.line + '  文字色=' + (frame.textColor || '(默认)'))
console.log('保底框    : ' + currentDefault + (setDefault ? '  ->  ' + resolvedId : '  （不变）'))

if (args.dryRun) { console.log('\n[dry-run] 未写盘。'); process.exit(0) }

const backupDir = args.backupDir ? path.resolve(args.backupDir) : path.dirname(target)
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
fs.mkdirSync(backupDir, { recursive: true })
const bak = path.join(backupDir, '.dshw-bubble.bak-' + stamp + '.json')
fs.copyFileSync(target, bak)

// 与宿主 writeBubbleConfig 完全一致：2 空格缩进
fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8')

const back = readJson(target)
const okFrame = (back.frames || []).some((f) => f.id === resolvedId && f.name === frame.name)
const okDefault = !setDefault || back.defaultFrameId === resolvedId
console.log('\n已写入：' + target)
console.log('  备份      : ' + bak)
console.log('  回读校验  : 框在=' + okFrame + '  保底=' + okDefault + '  items 未被改动=' + (back.items.length === cfg.items.length))

const ports = (process.env.DSHW_PROBE_PORTS || '3080,19387').split(',').map((s) => Number(s.trim())).filter(Boolean)
const running = await probeRunning(ports)
if (running) {
  console.log('')
  console.log('⚠ 探测到本机 ' + running + ' 端口有 DSH 在运行。')
  console.log('  前端内存里有一份完整配置副本，你一旦在界面里点「保存」就会把这次导入覆盖掉。')
  console.log('  请**先重启 DSH**（桌面端完全退出重开），再打开挂件；在那之前不要改泡泡设置。')
} else {
  console.log('\n下一步：启动 / 重启 DSH，导入的框即生效。')
}
