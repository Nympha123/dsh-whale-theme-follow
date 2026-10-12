# 更新记录

本文件记录本仓库（工具脚本）的版本，与上游挂件版本无关。

## v0.2.0 — 2026-10-12

一键安装：新增 `install-all.mjs`，一条命令跑完「主题联动补丁 → 角色图 → 泡泡框预设」。
针对上游 **v0.4.2** 验证通过。

### 新增 · 泡泡框导入（`install-bubble-frame.mjs`）

- 把 `presets/huaxiaoke.frame.json` **合并**进 `$DSH_HOME/.dshw-bubble.json`，可选设为保底框；
  只动 `frames` / `defaultFrameId`，`items`（点击序列）与 `lib`（模块库）逐字节不变
- 按宿主 `writeBubbleConfig()` 的**同一格式**写盘（2 空格缩进、键序 v/items/lib/tapAdvance/frames/defaultFrameId），不会有格式抖动
- 命中规则：先按 `frameId`、再按**框名**；按名字命中时**保留原有 id 与 createdAt**，重复导入不会长出第二个「华小科」
- 净化：颜色只放行 `#rgb` / `#rrggbb` / `rgb()` / `rgba()` / `transparent` / `none`，数值夹取，`cap`/`join` 白名单；
  **默认拒绝携带自定义 SVG 代码的预设**（那会绕过宿主的安全净化），需显式 `--allow-svg-code`
- 读 JSON 容忍 UTF-8 BOM（Windows 记事本另存为会加）
- 探测到 DSH 在运行会给出明确警告（导入后必须重启，否则前端内存里的旧配置会在下次保存时覆盖它）

### 新增 · 角色自动选中（并入 `apply-accent-follow.mjs`）

- 「当前选中哪个角色」存在浏览器 `localStorage['dshw-role']`，脚本改不到 ——
  因此补丁在前端的 `loadRoles()` 里加一条：**localStorage 为空时自动选中同名的角色**
- 名字由 `--preset-role` 决定（默认「华小科」），`--preset-role ""` / `--no-preset-role` = 完全保持原行为
- 用户一旦在「菜单 → 角色」里自己选过，localStorage 就有值，这条路不再触发
- 代价：安装后**第一次**加载会先闪一下默认鲸鱼再切过去（选中会写回 localStorage，之后不再闪）

### 修复

- 角色图安装器改为**按名字复用已有角色 id**，重复安装不再生成第二个同名角色
- 角色图安装器在 `--dry-run` / `--list` 时不再创建目录（干跑零副作用）
- 角色索引与泡泡配置读取均容忍 UTF-8 BOM

### 校验

- `verify-accent-follow.mjs`：25 → **37 项**（新增角色自动选中的静态与行为断言，含注入值与行为一致性）
- 新增 `tests/tools-check.mjs`：**25 项**，在临时目录里跑两个数据类工具，覆盖合并、幂等、
  拒绝路径（无配置 / items 为空）、dry-run 零副作用；不依赖上游包、不联网
- CI 增加 `tools` 作业，并保留 npm / GitHub 双来源的补丁一致性断言

## v0.1.0 — 2026-10-12

首个版本，针对上游 **v0.4.2** 验证通过。

### 主题联动（`apply-accent-follow.mjs` / `verify-accent-follow.mjs`）

- 把前端里写死的主色变量化：`#203170` → `var(--dshw-accent,#203170)`，
  `rgba(32,49,112,α)` → `rgba(var(--dshw-accent-rgb,32,49,112),α)`
  （实测替换 158 行主色 + 185 行半透明色，共 360 处引用）
- 注入 `dshwAccentSync()`：从**保底泡泡框**的 `slots.big.paint.line` 读描边色，
  写进 `<html>` 的 `--dshw-accent` / `--dshw-accent-rgb`；变量定义在 `:root`，
  挂在 `body` 上的浮层同样生效
- 挂钩 `framesNow()` 与 `toggleMenu()`，带缓存守卫
- 按**内容特征**（不是行号）排除 14 行：泡泡框兜底 SVG、默认画笔 `line`、
  用量图配色盘与图表系列色、canvas 2D 颜色、取色器默认值、模块默认内容色、值比较逻辑
- 安全性：幂等、先备份、用 `vm.Script` 做语法校验、校验不通过自动还原、锚点失配明确报错
- `verify-accent-follow.mjs`：27 项检查，其中一半把注入的函数从目标文件里抽出来**实际执行**
- 已验证 PowerShell 版与 Node 版输出**字节一致**；LF 与 CRLF 文件均通过

### 角色图安装（`install-role-image.mjs`）

- 安装到 `$DSH_HOME/whale-roles/`（用户数据目录，插件升级不受影响），
  索引格式与插件官方上传路径完全一致（2 空格缩进的 `roles.json`）
- 支持 `--image` / `--from-dir` / `--list` / `--remove` / `--pin` / `--dry-run`
- 格式按 **magic bytes** 判定（PNG / GIF），不看扩展名
- id 校验 `^[A-Za-z0-9_-]{1,64}$`，拒绝覆盖内置 `default`
- 已验证安装 / 列表 / 卸载往返后 `roles.json` 与操作前**字节一致**

### 附带素材

- `roles/华小科.png` —— 维护者所在部门美术老师的原创作品，已获授权随本仓库分发
  （版权归创作者及该部门所有，未授予再许可）。来源与许可见 `NOTICE.md`；
  已确认 PNG 内无文本 / EXIF 元数据块。clone 后 `node install-role-image.mjs --from-dir roles` 即可安装。
