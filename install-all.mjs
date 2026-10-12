#!/usr/bin/env node
/**
 * 小鲸鱼挂件 · 一键安装（跨平台，Node >= 18）
 * ------------------------------------------------------------------
 * 按顺序跑三件事：
 *   1. 主题联动补丁 + 角色自动选中   apply-accent-follow.mjs
 *   2. 角色图安装到用户数据目录       install-role-image.mjs
 *   3. 泡泡框预设合并进泡泡配置       install-bubble-frame.mjs
 *
 * 用法：
 *   node install-all.mjs                 # 全部
 *   node install-all.mjs --dry-run       # 只报告，不写任何东西
 *   node install-all.mjs --skip-frame     # 单独跳过某一步（同理 --skip-patch / --skip-role）
 *
 * 子进程用 stdio:'inherit' 启动：输出直接进终端，也避免在受限沙箱里
 * 因管道（named pipe）被拒而失败。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL_VERSION = '0.2.0'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const USAGE = `小鲸鱼挂件 · 一键安装 v${TOOL_VERSION}

用法：
  node install-all.mjs [选项]

选项：
      --dsh-home <目录>   数据目录（默认 $DSH_HOME 或 ~/.dsh）
      --preset <文件>     泡泡框预设（默认 presets/huaxiaoke.frame.json）
      --preset-role <名字> 自动选中的角色名（默认「华小科」；"--preset-role ''" 关闭）
  -p, --path <文件>       插件前端文件（默认自动在 DSH_HOME 下查找）
      --backup-dir <目录> 备份目录（补丁与泡泡框各自先备份；默认就地备份）
      --no-default        导入泡泡框但不设为保底框
      --skip-patch        跳过主题联动补丁
      --skip-role         跳过角色图安装
      --skip-frame        跳过泡泡框导入
      --dry-run           全部只报告，不写盘
  -h, --help              显示帮助`

function parseArgs(argv) {
  const o = { dshHome: '', preset: '', presetRole: null, path: '', backupDir: '', noDefault: false, skipPatch: false, skipRole: false, skipFrame: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dsh-home') o.dshHome = argv[++i] || ''
    else if (a === '--preset') o.preset = argv[++i] || ''
    else if (a === '--preset-role') o.presetRole = argv[++i] == null ? '' : argv[i]
    else if (a === '--path' || a === '-p') o.path = argv[++i] || ''
    else if (a === '--backup-dir') o.backupDir = argv[++i] || ''
    else if (a === '--no-default') o.noDefault = true
    else if (a === '--skip-patch') o.skipPatch = true
    else if (a === '--skip-role') o.skipRole = true
    else if (a === '--skip-frame') o.skipFrame = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a === '--version' || a === '-v') o.version = true
    else { console.error('未知参数：' + a); process.exit(2) }
  }
  return o
}

const args = parseArgs(process.argv.slice(2))
if (args.help) { console.log(USAGE); process.exit(0) }
if (args.version) { console.log(TOOL_VERSION); process.exit(0) }

const verbose = process.argv.includes('--show-subcommand')

function run(label, script, extra) {
  const file = path.join(SCRIPT_DIR, script)
  if (!fs.existsSync(file)) {
    console.log(`\n=== ${label} ===\n✗ 找不到脚本：${file}`)
    return { label, code: 127 }
  }
  const argv = [file].concat(extra)
  console.log(`\n=== ${label} ===`)
  if (verbose) console.log('$ node ' + argv.map((s) => (s.includes(' ') ? JSON.stringify(s) : s)).join(' '))
  const r = spawnSync(process.execPath, argv, { stdio: 'inherit' })
  if (r.error) { console.log('✗ 无法启动子进程：' + r.error.message); return { label, code: 1 } }
  return { label, code: r.status == null ? 1 : r.status }
}

const common = []
if (args.dshHome) common.push('--dsh-home', args.dshHome)
if (args.dryRun) common.push('--dry-run')
// 只有补丁与泡泡框导入支持 --backup-dir（角色图安装没有备份概念）
const withBackup = args.backupDir ? common.concat(['--backup-dir', args.backupDir]) : common

const results = []

// 1) 主题联动补丁（含角色自动选中）
if (args.skipPatch) {
  console.log('\n=== 主题联动补丁 ===\n（--skip-patch，已跳过）')
} else {
  const extra = withBackup.slice()
  if (args.presetRole !== null) extra.push('--preset-role', args.presetRole)
  if (args.path) extra.push('--path', args.path)
  results.push(run('主题联动补丁（菜单主色跟随泡泡描边 + 角色自动选中）', 'apply-accent-follow.mjs', extra))
}

// 2) 角色图
if (args.skipRole) {
  console.log('\n=== 角色图安装 ===\n（--skip-role，已跳过）')
} else {
  const rolesDir = path.join(SCRIPT_DIR, 'roles')
  const imgs = fs.existsSync(rolesDir)
    ? fs.readdirSync(rolesDir).filter((f) => /\.(png|gif|apng)$/i.test(f))
    : []
  if (!imgs.length) {
    console.log('\n=== 角色图安装 ===\n（roles/ 里没有 png / gif，已跳过）')
  } else {
    const extra = common.slice()
    extra.push('--from-dir', rolesDir)
    if (args.presetRole) extra.push('--name', args.presetRole)
    results.push(run(`角色图安装（${imgs.join(', ')}）`, 'install-role-image.mjs', extra))
  }
}

// 3) 泡泡框预设
if (args.skipFrame) {
  console.log('\n=== 泡泡框导入 ===\n（--skip-frame，已跳过）')
} else {
  const extra = withBackup.slice()
  if (args.preset) extra.push('--preset', args.preset)
  if (args.noDefault) extra.push('--no-default')
  results.push(run('泡泡框导入（合并进泡泡配置）', 'install-bubble-frame.mjs', extra))
}

// ---- 汇总 ----
console.log('\n================ 汇总 ================')
if (!results.length) console.log('没有任何步骤被执行。')
let bad = 0
for (const r of results) {
  if (r.code !== 0) bad++
  console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.label}${r.code === 0 ? '' : '   (exit ' + r.code + ')'}`)
}
if (args.dryRun) {
  console.log('\n[dry-run] 什么都没写盘。')
  process.exit(0)
}
console.log('')
if (bad) {
  console.log('有步骤失败 —— 上面每一条都写了原因；泡泡框导入失败最常见的原因是')
  console.log('「泡泡配置还没有非空 items」，按它的提示先让挂件生成一次配置再重跑。')
} else {
  console.log('全部完成。')
}
console.log('最后一步（必须）：**完全退出并重开 DSH**（桌面端含托盘），再打开挂件。')
console.log('重启前请不要在界面里改泡泡设置 —— 前端内存里的旧配置会把导入覆盖掉。')
process.exit(bad ? 1 : 0)
