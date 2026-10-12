#!/usr/bin/env node
/**
 * 主题联动补丁 · 校验器（跨平台，Node >= 18）
 * ------------------------------------------------------------------
 * 静态检查 + 把补丁注入的两个函数从目标文件里抽出来**实际执行**做行为测试。
 * 用法：
 *   node verify-accent-follow.mjs                        # 自动定位
 *   node verify-accent-follow.mjs --path <whale-widget.js>
 * 退出码：0 = 全部通过，1 = 有失败，2 = 用法/找不到文件
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
let target = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--path' || args[i] === '-p') target = args[++i] || ''
  else if (!args[i].startsWith('-') && !target) target = args[i]
}
if (!target) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const tail = ['node_modules', 'dsh-whale-widget', 'assets', 'whale-widget.js']
  for (const p of ['desktop', 'web', 'tui']) {
    const c = path.join(home, 'profiles', p, ...tail)
    if (fs.existsSync(c)) { target = c; console.log('自动定位到：' + target); break }
  }
}
if (!target) { console.error('用法：node verify-accent-follow.mjs --path <whale-widget.js>'); process.exit(2) }
if (!fs.existsSync(target)) { console.error('文件不存在：' + target); process.exit(2) }

const src = fs.readFileSync(target, 'utf8')

const results = []
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) }) }

// ---------------- 静态：变量定义与引用 ----------------
check('CSS :root 变量已注入', src.includes(':root{--dshw-accent:#203170;--dshw-accent-rgb:32,49,112}'))
const varRefs = (src.match(/var\(--dshw-accent,/g) || []).length
const rgbRefs = (src.match(/rgba\(var\(--dshw-accent-rgb,/g) || []).length
check('主色 var() 引用 > 150 处', varRefs > 150, varRefs)
check('半透明 var() 引用 > 150 处', rgbRefs > 150, rgbRefs)

// ---------------- 静态：必须原样保留的地方 ----------------
check('泡泡框兜底 SVG 描边仍为 #203170（3 处）', (src.match(/stroke="#203170"/g) || []).length === 3)
check('默认画笔 line 仍为 #203170', src.includes("line: '#203170'"))
check('值比较逻辑未被替换', src.includes("=== '#203170'"))
check('用量图配色盘未被替换', src.includes("USAGE_PALETTE = ['#203170'"))
check('取色器默认值未被替换', src.includes("defaultHex || '#203170'"))
check('模块默认内容色未被替换', src.includes('color: "#203170"'))
check('canvas 2D 颜色未被替换', src.includes("ctx.strokeStyle = '#203170'"))

// ---------------- 静态：钩子 ----------------
check('dshwAccentSync 已定义', src.includes('function dshwAccentSync'))
check('dshwAccentRgbOf 已定义', src.includes('function dshwAccentRgbOf'))
check('framesNow 内已挂钩子', /if \(!bubbleFrames\) syncFramesFromCfg\(\)\s*\r?\n\s*dshwAccentSync\(\)/.test(src))
check('toggleMenu 内已挂钩子', /try \{ dshwAccentSync\(\) \} catch \(err\) \{\}/.test(src))
check('dshwAccentSync 恰好出现 3 次（1 定义 + 2 调用）', (src.match(/dshwAccentSync/g) || []).length === 3,
  (src.match(/dshwAccentSync/g) || []).length)

// ---------------- 静态：角色自动选中 ----------------
const roleVarRe = /var DSHW_PRESET_ROLE_NAME = ("(?:[^"\\]|\\.)*")/
const roleVar = roleVarRe.exec(src)
check('DSHW_PRESET_ROLE_NAME 已注入', !!roleVar, roleVar ? roleVar[1] : '未找到')
check('dshwPresetRoleOf 已定义', src.includes('function dshwPresetRoleOf'))
check('loadRoles 内已挂自动选中钩子',
  /var dshwPresetRole = dshwPresetRoleOf\(roleList\)\s*\r?\n\s*if \(dshwPresetRole\) applyRole\(/.test(src))
check('dshwPresetRoleOf 恰好出现 2 次（1 定义 + 1 调用）',
  (src.match(/dshwPresetRoleOf/g) || []).length === 2, (src.match(/dshwPresetRoleOf/g) || []).length)

// ---------------- 行为：抽出补丁函数实际执行 ----------------
function grab(name) {
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('找不到函数 ' + name)
  const j = src.indexOf('{', i)
  let d = 0
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1) }
  }
  throw new Error('括号不平衡：' + name)
}

const code = [
  'var bubbleFrames = null;',
  "var dshwAccentLast = '';",
  grab('dshwAccentRgbOf'),
  grab('dshwAccentSync'),
  'return {',
  '  setFrames: function (f) { bubbleFrames = f },',
  '  sync: dshwAccentSync,',
  '  rgbOf: dshwAccentRgbOf',
  '}'
].join('\n')

function mkDoc() {
  const store = {}
  return { doc: { documentElement: { style: { setProperty: (k, v) => { store[k] = v } } } }, store }
}
function mkApi() {
  const h = mkDoc()
  // eslint-disable-next-line no-new-func
  const api = new Function('document', code)(h.doc)
  return { api, store: h.store }
}

let ok = true
try { mkApi(); check('补丁函数可被解析载入', true) } catch (e) { ok = false; check('补丁函数可被解析载入', false, e.message) }

if (ok) {
  const { api } = mkApi()

  check("rgbOf('#203170')", api.rgbOf('#203170') === '32,49,112', api.rgbOf('#203170'))
  check("rgbOf('#abc') 短写", api.rgbOf('#abc') === '170,187,204', api.rgbOf('#abc'))
  check("rgbOf('rgb(1,2,3)')", api.rgbOf('rgb(1,2,3)') === '1,2,3', api.rgbOf('rgb(1,2,3)'))
  check("rgbOf('rgba(4,5,6,.5)')", api.rgbOf('rgba(4,5,6,.5)') === '4,5,6', api.rgbOf('rgba(4,5,6,.5)'))
  check("rgbOf('transparent') 视为无效", api.rgbOf('transparent') === '', api.rgbOf('transparent'))

  const cases = [
    ['内置框 → 主色 #203170', { defaultFrameId: 'frame_classic', frames: [{ id: 'frame_classic', slots: { big: { paint: { lineOn: true, line: '#203170' } } } }] }, '#203170', '32,49,112'],
    ['自定义描边 #e0433f → 跟随', { defaultFrameId: 'f1', frames: [{ id: 'f1', slots: { big: { paint: { lineOn: true, line: '#e0433f' } } } }] }, '#e0433f', '224,67,63'],
    ['自定义描边 rgb() 写法 → 跟随', { defaultFrameId: 'f1', frames: [{ id: 'f1', slots: { big: { paint: { lineOn: true, line: 'rgb(12,34,56)' } } } }] }, 'rgb(12,34,56)', '12,34,56'],
    ['描边关闭(lineOn:false) → 回退', { defaultFrameId: 'f1', frames: [{ id: 'f1', slots: { big: { paint: { lineOn: false, line: '#00ff00' } } } }] }, '#203170', '32,49,112'],
    ['描边 transparent → 回退', { defaultFrameId: 'f1', frames: [{ id: 'f1', slots: { big: { paint: { lineOn: true, line: 'transparent' } } } }] }, '#203170', '32,49,112']
  ]
  for (const [name, frames, wantHex, wantRgb] of cases) {
    const { api: a, store } = mkApi()
    a.setFrames(frames)
    a.sync()
    check(name, store['--dshw-accent'] === wantHex && store['--dshw-accent-rgb'] === wantRgb,
      `${store['--dshw-accent']} / ${store['--dshw-accent-rgb']}`)
  }

  const { api: a5, store: s5 } = mkApi()
  a5.setFrames(null)
  a5.sync()
  check('无框库时不抛错、不写变量', Object.keys(s5).length === 0, JSON.stringify(s5))

  // ---- 角色自动选中的行为测试 ----
  function rolePick(roleLiteral) {
    const code2 = [
      'var DSHW_PRESET_ROLE_NAME = ' + roleLiteral + ';',
      grab('dshwPresetRoleOf'),
      'return dshwPresetRoleOf'
    ].join('\n')
    // eslint-disable-next-line no-new-func
    return new Function(code2)()
  }
  const roles = [
    { id: 'default', name: '小鲸鱼', url: '/dsh-whale/image.png' },
    { id: 'role_abc', name: '华小科', url: '/dsh-whale/role-image.png?id=role_abc' }
  ]
  // 用固定的名字测函数逻辑（不依赖注入值，--no-preset-role 时也成立）
  const pickFixed = rolePick('"华小科"')
  const hit = pickFixed(roles)
  check('自动选中：命中同名角色', !!(hit && hit.id === 'role_abc'), hit ? hit.id : 'null')
  check('自动选中：不会选中内置 default', !(hit && hit.id === 'default'))
  check('自动选中：名字不匹配时返回 null', pickFixed([roles[0], { id: 'role_z', name: '别的' }]) === null)
  check('自动选中：名字为空串时不做任何事', rolePick("''")(roles) === null)
  check('自动选中：列表为空 / null 时不抛错', pickFixed([]) === null && pickFixed(null) === null)

  // 注入值必须与行为一致：非空 → 命中同名角色；空串 → 什么都不做
  const injected = roleVar ? roleVar[1] : "''"
  const pickInjected = rolePick(injected)
  const injHit = pickInjected(roles)
  let injOk
  if (injected === '""') injOk = injHit === null
  else { let nm = ''; try { nm = JSON.parse(injected) } catch (e) { nm = null }; injOk = !!(nm && injHit && injHit.name === nm) }
  check('注入的角色名与实际行为一致', injOk, injected + ' -> ' + (injHit ? injHit.name : 'null'))
}

let bad = 0
for (const r of results) {
  if (!r.ok) bad++
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''))
}
console.log('\n' + (bad === 0 ? 'ALL PASS' : bad + ' FAILED') + '  (' + results.length + ' checks)')
process.exit(bad === 0 ? 0 : 1)
