#!/usr/bin/env node
/**
 * 小鲸鱼挂件 · 角色图安装器（跨平台，Node >= 18）
 * ------------------------------------------------------------------
 * 把角色图安装进插件的**用户数据目录** $DSH_HOME/whale-roles/，并登记到 roles.json。
 * 为什么走用户数据目录而不是塞进插件包：
 *   · 插件升级会整包覆盖 node_modules，塞进去的图会丢；
 *   · whale-roles/ 是插件官方的自定义角色存储位置，索引格式与「资源管理」上传的一致；
 *   · 因此装完在「菜单 → 角色」里就能看到，且升级插件不受影响。
 *
 * 用法：
 *   node install-role-image.mjs --image <图片> [--name <显示名>] [--pin]
 *   node install-role-image.mjs --from-dir <目录>          # 批量装目录里的 png/gif
 *   node install-role-image.mjs --list                     # 列出已装角色
 *   node install-role-image.mjs --remove <角色id>          # 卸载一个角色
 * 选项：
 *   --dsh-home <目录>   数据目录（默认 $DSH_HOME 或 ~/.dsh）
 *   --id <id>           指定角色 id（默认自动生成 role_<base36>_<base36>）
 *   --dry-run           只报告，不写盘
 *
 * 注意：装完需要在「菜单 → 角色」里选中它并保存 —— 当前选中的是哪个角色存在浏览器
 *       localStorage['dshw-role']，脚本无法代你选择。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TOOL_VERSION = '0.2.0'
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_ROLE_ID = 'default'
const INDEX_NAME = 'roles.json'

const USAGE = `小鲸鱼挂件 · 角色图安装器 v${TOOL_VERSION}

用法：
  node install-role-image.mjs --image <图片> [--name <显示名>] [--pin]
  node install-role-image.mjs --from-dir <目录>
  node install-role-image.mjs --list
  node install-role-image.mjs --remove <角色id>

选项：
  --image <文件>      装单个角色图（png / gif / apng）
  --from-dir <目录>   批量安装该目录下的 *.png / *.gif（文件名去掉扩展名作为显示名）
  --name <名称>       显示名（默认取文件名）
  --id <id>           角色 id（默认自动生成）
  --pin               安装时置顶（pinnedAt = 现在）
  --list              列出已装角色
  --remove <id>       删除角色（连同图片文件）
  --dsh-home <目录>   数据目录（默认 $DSH_HOME 或 ~/.dsh）
  --dry-run           只报告，不写盘`

function parseArgs(argv) {
  const o = { image: '', fromDir: '', name: '', id: '', pin: false, list: false, remove: '', dshHome: '', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--image') o.image = argv[++i] || ''
    else if (a === '--from-dir') o.fromDir = argv[++i] || ''
    else if (a === '--name') o.name = argv[++i] || ''
    else if (a === '--id') o.id = argv[++i] || ''
    else if (a === '--pin') o.pin = true
    else if (a === '--list') o.list = true
    else if (a === '--remove') o.remove = argv[++i] || ''
    else if (a === '--dsh-home') o.dshHome = argv[++i] || ''
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a === '--version' || a === '-v') o.version = true
    else { console.error('未知参数：' + a); process.exit(2) }
  }
  return o
}

// 与插件 lib/index.js 的 pickRoleDir() 同逻辑：$DSH_HOME/whale-roles 优先，取第一个可写的
// create=false（dry-run / --list）时绝不建目录 —— 只读操作不该有副作用
function pickRoleDir(dshHome, create = true) {
  const home = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const cands = [path.join(home, 'whale-roles'), path.join(home, 'profiles', 'web', 'whale-roles')]
  for (const p of cands) {
    try {
      if (create) fs.mkdirSync(p, { recursive: true })
      fs.accessSync(p, fs.constants.W_OK)
      return p
    } catch (err) { /* 下一个 */ }
  }
  return cands[0]
}

// 由文件内容判定格式：magic bytes 说了算，扩展名只作兜底
function detectFormat(file) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(8)
  try { fs.readSync(fd, buf, 0, 8, 0) } finally { fs.closeSync(fd) }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png' // APNG 也是 PNG 容器
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  return ''
}
function extOf(format) { return format === 'gif' ? 'gif' : 'png' }

function readIndex(dir) {
  try {
    let s = fs.readFileSync(path.join(dir, INDEX_NAME), 'utf8')
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1) // 容忍 UTF-8 BOM
    const p = JSON.parse(s)
    if (p && Array.isArray(p.roles)) {
      if (!p.roles.some((r) => r && r.id === DEFAULT_ROLE_ID)) {
        p.roles.unshift({ id: DEFAULT_ROLE_ID, name: '小鲸鱼', pinnedAt: 1, createdAt: 0 })
      }
      return p
    }
  } catch (err) { /* 落到默认 */ }
  return { version: 1, roles: [{ id: DEFAULT_ROLE_ID, name: '小鲸鱼', pinnedAt: 1, createdAt: 0 }] }
}
function writeIndex(dir, index) {
  // 与插件 writeRolesIndex() 完全一致：2 空格缩进、UTF-8
  fs.writeFileSync(path.join(dir, INDEX_NAME), JSON.stringify(index, null, 2), 'utf8')
}
function newId() {
  const rand = Math.random().toString(36).slice(2, 8)
  return 'role_' + Date.now().toString(36) + '_' + rand
}

function installOne(dir, file, name, id, pin, dryRun) {
  if (!fs.existsSync(file)) { console.error('图片不存在：' + file); return false }
  const format = detectFormat(file)
  if (!format) { console.error('不是可识别的 PNG / GIF：' + file); return false }

  // 没指定 id 时先按**名字**找已有角色并复用它的 id —— 这样重复安装不会长出第二个「华小科」
  let wantId = id
  if (!wantId) {
    const idx = readIndex(dir)
    const same = idx.roles.find((r) => r && r.id !== DEFAULT_ROLE_ID && r.name === name)
    wantId = same ? same.id : newId()
  }
  if (!ID_RE.test(wantId)) { console.error(`角色 id 不合法（需匹配 ${ID_RE}）：${wantId}`); return false }
  if (wantId === DEFAULT_ROLE_ID) { console.error('不能覆盖内置的 default 角色'); return false }

  const dest = path.join(dir, wantId + '.' + extOf(format))
  const bytes = fs.statSync(file).size
  if (dryRun) {
    console.log(`[dry-run] 将安装：${path.basename(file)}  ->  ${dest}`)
    console.log(`          显示名=${name}  id=${wantId}  format=${format}  ${bytes} 字节`)
    if (!id) console.log('          （这个 id 是预览值；实际安装时按名字复用已有角色，找不到才新建）')
    return true
  }
  fs.copyFileSync(file, dest)

  // 复用了 id 但格式变了（png <-> gif）时，清掉另一扩展名的旧文件，避免留孤儿
  const stale = path.join(dir, wantId + '.' + (extOf(format) === 'gif' ? 'png' : 'gif'))
  try { if (fs.existsSync(stale)) fs.unlinkSync(stale) } catch (err) {}

  const index = readIndex(dir)
  const existed = index.roles.find((r) => r && r.id === wantId)
  if (existed) {
    existed.name = name
    existed.format = format
    if (pin) existed.pinnedAt = Date.now()
  } else {
    index.roles.push({ id: wantId, name, format, pinnedAt: pin ? Date.now() : null, createdAt: Date.now() })
  }
  writeIndex(dir, index)
  console.log(`已安装角色「${name}」`)
  console.log(`  目录   : ${dir}`)
  console.log(`  图片   : ${wantId}.${extOf(format)}  (${bytes} 字节, ${format})`)
  console.log(`  索引   : ${INDEX_NAME}${existed ? '（已更新同名 id，未新建）' : ''}`)
  return true
}

// ------------------------------------------------------------------ 主流程
const args = parseArgs(process.argv.slice(2))
if (args.help) { console.log(USAGE); process.exit(0) }
if (args.version) { console.log(TOOL_VERSION); process.exit(0) }
if (!args.image && !args.fromDir && !args.list && !args.remove) { console.log(USAGE); process.exit(2) }

const dir = pickRoleDir(args.dshHome, !args.dryRun && !args.list)

if (args.list) {
  const index = readIndex(dir)
  console.log('角色目录：' + dir)
  console.log('角色索引：' + path.join(dir, INDEX_NAME))
  for (const r of index.roles) {
    if (r.id === DEFAULT_ROLE_ID) { console.log(`  ${r.id.padEnd(26)} ${r.name}   (内置)`); continue }
    const f = path.join(dir, r.id + '.' + extOf(r.format))
    const bytes = fs.existsSync(f) ? fs.statSync(f).size : 0
    console.log(`  ${r.id.padEnd(26)} ${r.name}   ${r.format || 'png'}  ${bytes} 字节  ${fs.existsSync(f) ? '' : '⚠ 图片文件缺失'}`)
  }
  process.exit(0)
}

if (args.remove) {
  const index = readIndex(dir)
  const i = index.roles.findIndex((r) => r && r.id === args.remove)
  if (i < 0) { console.error('没有这个角色 id：' + args.remove); process.exit(1) }
  if (args.remove === DEFAULT_ROLE_ID) { console.error('不能删除内置的 default 角色'); process.exit(1) }
  const role = index.roles[i]
  const f = path.join(dir, args.remove + '.' + extOf(role.format))
  if (args.dryRun) { console.log(`[dry-run] 将删除角色 ${args.remove}（图片 ${f}）`); process.exit(0) }
  try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch (err) { console.error('删除图片失败：' + err.message) }
  index.roles.splice(i, 1)
  writeIndex(dir, index)
  console.log(`已删除角色 ${args.remove}`)
  process.exit(0)
}

let ok = true
if (args.image) {
  const name = args.name || path.basename(args.image).replace(/\.[^.]+$/, '')
  ok = installOne(dir, args.image, name, args.id, args.pin, args.dryRun) && ok
}
if (args.fromDir) {
  if (!fs.existsSync(args.fromDir)) { console.error('目录不存在：' + args.fromDir); process.exit(1) }
  const files = fs.readdirSync(args.fromDir)
    .filter((f) => /\.(png|gif|apng)$/i.test(f))
    .map((f) => path.join(args.fromDir, f))
  if (!files.length) { console.error('目录里没有 png / gif：' + args.fromDir); process.exit(1) }
  for (const f of files) {
    const name = args.name && files.length === 1 ? args.name : path.basename(f).replace(/\.[^.]+$/, '')
    ok = installOne(dir, f, name, files.length === 1 ? args.id : '', args.pin, args.dryRun) && ok
  }
}

if (ok && !args.dryRun) {
  console.log('\n下一步：在挂件里点「菜单 → 角色」选中它（当前选中的角色存在浏览器 localStorage，脚本无法代选）。')
  console.log('提示：角色图由你自行提供，请确认拥有它的使用权；本工具只做本地安装，不上传任何文件。')
}
process.exit(ok ? 0 : 1)
