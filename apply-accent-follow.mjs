#!/usr/bin/env node
/**
 * 小鲸鱼挂件 · 主题联动补丁（跨平台版，Node >= 18）
 * ------------------------------------------------------------------
 * 把前端里写死的主色换成 CSS 变量，让「菜单 / 面板主色」跟随「泡泡描边色」：
 *   #203170            -> var(--dshw-accent, #203170)
 *   rgba(32,49,112,α)  -> rgba(var(--dshw-accent-rgb, 32,49,112), α)
 * 并注入 dshwAccentSync()：从保底泡泡框的 slots.big.paint.line 取色写入这两个变量。
 *
 * 用法：
 *   node apply-accent-follow.mjs                 # 自动定位已安装的插件文件
 *   node apply-accent-follow.mjs --path <文件>
 *   node apply-accent-follow.mjs --dry-run       # 只报告将要做什么，不写盘
 *   node apply-accent-follow.mjs --revert        # 用最近的备份还原
 *
 * 特性：幂等 / 先备份 / 用 vm 做语法校验 / 校验不通过自动还原
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const TOOL_VERSION = '0.1.0'

// ---------------------------------------------------------------- 排除名单
// 这些行必须保持真色值或原样：它们是「泡泡自己的颜色」、数据可视化配色，
// 或者一旦替换就会改变行为（值比较 / 取色器 / canvas 2D）。
const KEEP_PATTERNS = [
  /stroke="#203170"/,                        // 内置泡泡框兜底 SVG —— 泡泡描边的源头
  /line:\s*'#203170'/,                       // framePaintDefaults 的默认描边 —— 源头
  /USAGE_PALETTE/,                           // 用量图分类配色盘
  /hoverIdx/,                                // 用量图画布系列色
  /ctx\.(?:fillStyle|strokeStyle)\s*=\s*'(?:#203170|rgba\(32,49,112,)/, // canvas 2D 不吃 CSS 变量
  /===\s*'#203170'/,                         // 值比较逻辑
  /defaultHex\s*\|\|\s*'#203170'/,           // 取色器默认值必须是真色值
  /inp\.value\s*=\s*'#203170'/,              // <input type=color> 只能吃真色值
  /color:\s*"#203170"/,                      // 泡泡模块默认内容（会被写进用户配置）
  /frameEditColor\(lnRow,\s*'line',\s*'#203170'\)/ // 编辑框「描边」默认值
]

// ------------------------------------------------------- 运行时注入的取色函数
const HELPER = String.raw`// ===== 本地补丁（theme-follow）：菜单 / 面板主色跟随泡泡描边色 =====
// 取色来源：保底框（defaultFrameId）大泡泡槽位的描边色 slots.big.paint.line
//   —— 改「自定义泡泡 → 外观 → 描边」或把某个框设为保底，主色即随之变化。
// 写进 <html> 的 --dshw-accent / --dshw-accent-rgb；样式表与内联样式里的 var() 引用
// 都会跟着换色（内联样式挂在 body 上的浮层同样生效，因为变量定义在 :root）。
var dshwAccentLast = ''
function dshwAccentRgbOf(c) {
  var s = String(c == null ? '' : c).trim()
  var m = /^#([0-9a-fA-F]{3})$/.exec(s)
  if (m) return parseInt(m[1].charAt(0) + m[1].charAt(0), 16) + ',' + parseInt(m[1].charAt(1) + m[1].charAt(1), 16) + ',' + parseInt(m[1].charAt(2) + m[1].charAt(2), 16)
  m = /^#([0-9a-fA-F]{6})$/.exec(s)
  if (m) return parseInt(m[1].slice(0, 2), 16) + ',' + parseInt(m[1].slice(2, 4), 16) + ',' + parseInt(m[1].slice(4, 6), 16)
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s)
  if (m) return (Number(m[1]) | 0) + ',' + (Number(m[2]) | 0) + ',' + (Number(m[3]) | 0)
  return ''
}
function dshwAccentSync() {
  try {
    var f = bubbleFrames
    if (!f || !f.frames || !f.frames.length) return
    var want = ''
    for (var i = 0; i < f.frames.length; i++) {
      if (f.frames[i].id !== f.defaultFrameId) continue
      var sl = f.frames[i].slots
      var p = sl && sl.big ? sl.big.paint : null
      if (p && p.lineOn !== false) {
        var c = String(p.line == null ? '' : p.line).trim()
        if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(c) || /^rgba?\(/i.test(c)) want = c
      }
      break
    }
    if (!want) want = '#203170'
    if (want === dshwAccentLast) return
    dshwAccentLast = want
    var el = document.documentElement
    if (!el || !el.style) return
    el.style.setProperty('--dshw-accent', want)
    el.style.setProperty('--dshw-accent-rgb', dshwAccentRgbOf(want) || '32,49,112')
  } catch (err) {}
}`

// ------------------------------------------------------------------ CLI
function parseArgs(argv) {
  const out = { path: '', backupDir: '', dryRun: false, revert: false, dshHome: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--path' || a === '-p') out.path = argv[++i] || ''
    else if (a === '--backup-dir') out.backupDir = argv[++i] || ''
    else if (a === '--dsh-home') out.dshHome = argv[++i] || ''
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--revert') out.revert = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--version' || a === '-v') out.version = true
    else if (!a.startsWith('-') && !out.path) out.path = a
    else { console.error('未知参数：' + a); process.exit(2) }
  }
  return out
}

const USAGE = `小鲸鱼挂件 · 主题联动补丁 v${TOOL_VERSION}

用法：
  node apply-accent-follow.mjs [--path <whale-widget.js>] [选项]

选项：
  -p, --path <文件>      目标文件；省略时自动在 DSH_HOME 下查找
      --backup-dir <目录> 备份目录（默认与目标文件同目录）
      --dsh-home <目录>   DSH 数据目录（默认 $DSH_HOME 或 ~/.dsh）
      --dry-run           只报告将要做的改动，不写盘
      --revert            用备份目录里最新的备份还原目标文件
  -h, --help              显示帮助
  -v, --version           显示版本`

function guessTarget(dshHome) {
  const home = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const tail = ['node_modules', 'dsh-whale-widget', 'assets', 'whale-widget.js']
  const cands = [
    path.join(home, 'profiles', 'desktop', ...tail), // 官方桌面客户端
    path.join(home, 'profiles', 'web', ...tail),     // dsh web
    path.join(home, 'profiles', 'tui', ...tail)
  ]
  for (const c of cands) if (fs.existsSync(c)) return c
  return null
}

// -------------------------------------------------------------- 核心变换
function transform(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const lines = src.split(/\r?\n/)

  let nHex = 0, nRgb = 0, nKept = 0
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]
    if (!t.includes('#203170') && !t.includes('rgba(32,49,112,')) continue
    if (KEEP_PATTERNS.some((re) => re.test(t))) { nKept++; continue }
    let u = t
    if (u.includes('#203170')) { u = u.split('#203170').join('var(--dshw-accent,#203170)'); nHex++ }
    if (u.includes('rgba(32,49,112,')) { u = u.split('rgba(32,49,112,').join('rgba(var(--dshw-accent-rgb,32,49,112),'); nRgb++ }
    lines[i] = u
  }
  let body = lines.join(eol)

  const A1_OLD = ["  '.dshwv-resempty{color:#9fb0d9;font-size:12px;padding:2px 6px}'", String.raw`].join('\n')`].join(eol)
  const A1_NEW = ["  '.dshwv-resempty{color:#9fb0d9;font-size:12px;padding:2px 6px}',", "  ':root{--dshw-accent:#203170;--dshw-accent-rgb:32,49,112}'", String.raw`].join('\n')`].join(eol)

  const A2_OLD = ['function framesNow() {', '  if (!bubbleFrames) syncFramesFromCfg()', '  return bubbleFrames', '}'].join(eol)
  const A2_NEW = ['function framesNow() {', '  if (!bubbleFrames) syncFramesFromCfg()', '  dshwAccentSync()', '  return bubbleFrames', '}'].join(eol)

  const A3_OLD = ['  try { resyncSizeCfg() } catch (err) {}', '  menuOpen = !menuOpen'].join(eol)
  const A3_NEW = ['  try { resyncSizeCfg() } catch (err) {}', '  try { dshwAccentSync() } catch (err) {}', '  menuOpen = !menuOpen'].join(eol)

  const edits = [
    { name: 'CSS :root 变量', old: A1_OLD, neu: A1_NEW },
    { name: 'framesNow 钩子 + 取色函数', old: A2_OLD, neu: A2_NEW + eol + HELPER },
    { name: 'toggleMenu 钩子', old: A3_OLD, neu: A3_NEW }
  ]

  for (const e of edits) {
    const n = body.split(e.old).length - 1
    if (n !== 1) throw new Error(`锚点「${e.name}」命中 ${n} 次（应为 1）`)
    body = body.replace(e.old, () => e.neu)
  }

  return { body, nHex, nRgb, nKept }
}

// ------------------------------------------------------------------ 主流程
const args = parseArgs(process.argv.slice(2))
if (args.help) { console.log(USAGE); process.exit(0) }
if (args.version) { console.log(TOOL_VERSION); process.exit(0) }

let target = args.path
if (!target) {
  target = guessTarget(args.dshHome)
  if (!target) {
    console.error('找不到已安装的插件文件。请用 --path 指定，例如：')
    console.error('  node apply-accent-follow.mjs --path "$HOME/.dsh/profiles/desktop/node_modules/dsh-whale-widget/assets/whale-widget.js"')
    process.exit(2)
  }
  console.log('自动定位到：' + target)
}
target = path.resolve(target)
if (!fs.existsSync(target)) { console.error('目标文件不存在：' + target); process.exit(1) }

const backupDir = args.backupDir ? path.resolve(args.backupDir) : path.dirname(target)
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

// --revert：用最新备份还原
if (args.revert) {
  const baks = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter((f) => /^whale-widget\.orig-.*\.js$/.test(f)).sort()
    : []
  if (!baks.length) { console.error('备份目录里没有找到 whale-widget.orig-*.js：' + backupDir); process.exit(1) }
  const newest = path.join(backupDir, baks[baks.length - 1])
  fs.copyFileSync(newest, target)
  console.log(`已还原：${target}\n    来源：${newest}`)
  process.exit(0)
}

const src = fs.readFileSync(target, 'utf8')
if (src.includes('dshwAccentSync')) {
  console.log('已打过补丁，未做任何修改：' + target)
  process.exit(0)
}

let result
try {
  result = transform(src)
} catch (err) {
  console.error('打补丁失败：' + err.message)
  console.error('（上游可能改了这些代码片段；请到仓库开 issue 并附上插件版本）')
  process.exit(1)
}

// 用 vm 做语法校验（只解析、不执行）
try { new vm.Script(result.body, { filename: target }) } catch (err) {
  console.error('语法校验未通过，未写盘：' + err.message)
  process.exit(1)
}

if (args.dryRun) {
  console.log(`[dry-run] ${target}`)
  console.log(`  将替换主色        : ${result.nHex} 行`)
  console.log(`  将替换半透明色    : ${result.nRgb} 行`)
  console.log(`  按名单保留        : ${result.nKept} 行`)
  console.log('  未写盘。')
  process.exit(0)
}

fs.mkdirSync(backupDir, { recursive: true })
const bak = path.join(backupDir, `whale-widget.orig-${stamp}.js`)
fs.writeFileSync(bak, src, 'utf8')

try {
  fs.writeFileSync(target, result.body, 'utf8')
} catch (err) {
  console.error('写入失败：' + err.message)
  process.exit(1)
}

const vars = (result.body.match(/var\(--dshw-accent/g) || []).length
console.log(`补丁已应用：${target}`)
console.log(`  备份            : ${bak}`)
console.log(`  语法校验        : pass（vm.Script）`)
console.log(`  替换主色        : ${result.nHex} 行`)
console.log(`  替换半透明色    : ${result.nRgb} 行`)
console.log(`  按名单保留      : ${result.nKept} 行`)
console.log(`  现用变量引用    : ${vars} 处`)
console.log('  下一步          : 重启 DSH（桌面端请完全退出重开），再硬刷新页面')
