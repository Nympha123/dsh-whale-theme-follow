# dsh-whale-theme-follow

给 [DSH 小鲸鱼记账挂件](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（`dsh-whale-widget`）的本地增强工具集：

| 工具 | 作用 |
|---|---|
| **`install-all.mjs`** | **一键装完下面三件事**（推荐入口） |
| `apply-accent-follow.mjs` | 菜单 / 面板主色**跟随泡泡描边色**；并让前端在没保存过角色时**自动选中指定角色** |
| `install-role-image.mjs` | 把角色图安装进 `$DSH_HOME/whale-roles/`（用户数据，不随插件升级丢失） |
| `install-bubble-frame.mjs` | 把泡泡框预设**合并**进泡泡配置，可选设为保底框 |
| `verify-accent-follow.mjs` · `tests/tools-check.mjs` | 37 项 / 25 项校验 |

全部只操作**本机安装**，不联网、不上传任何文件。

> 上游插件没有「菜单主题色」设置项（菜单配色是写死在前端 CSS 里的常量），
> 也没有「一键导入角色 + 泡泡框」的入口。本仓库把这两件事补上，且**不复制上游任何代码或素材**
> —— 见[素材与授权](#素材与授权)。

---

## 环境要求

- **Node.js ≥ 18**（挂件本身跑在 Node 上，所以它必然存在）
- 已通过 `dsh plugin` 安装 **`dsh-whale-widget`**（桌面端 / `dsh web` 均可）
- 已验证：上游 **v0.4.2** + DeepSeek Harness 桌面端（Windows）；LF/CRLF 两种换行都验过

## 一键安装

```bash
node install-all.mjs --dry-run     # 先看会做什么，不写盘
node install-all.mjs               # 真跑
```

它会按顺序：

1. **打补丁**（主题联动 + 角色自动选中）→ 自动定位已安装的 `assets/whale-widget.js`
2. **装角色图** → `roles/` 里的 png/gif 全装进 `$DSH_HOME/whale-roles/`
3. **导入泡泡框** → `presets/huaxiaoke.frame.json` 合并进 `$DSH_HOME/.dshw-bubble.json` 并设为保底框

可选开关：`--dsh-home <目录>`、`--path <文件>`、`--backup-dir <目录>`、
`--preset <文件>`、`--preset-role <名字>`、`--no-default`、
`--skip-patch` / `--skip-role` / `--skip-frame`、`--dry-run`。

> ### ⚠️ 装完必须做的一件事
>
> **完全退出并重开 DSH**（桌面端含系统托盘），再打开挂件。
>
> 而且**在重启之前，不要在界面里改「自定义泡泡」的设置** ——
> 前端内存里有一份完整配置副本，只有你点「保存」时才会回写；
> 那时它会把刚导入的泡泡框覆盖掉。
> （`install-bubble-frame.mjs` 探测到 DSH 在运行时会主动提示这件事。）

---

## 一、主题联动（`apply-accent-follow.mjs`）

### 它做了什么

| 改动 | 内容 |
|---|---|
| 颜色变量化 | `#203170` → `var(--dshw-accent,#203170)`；`rgba(32,49,112,α)` → `rgba(var(--dshw-accent-rgb,32,49,112),α)` |
| 运行时取色 | 注入 `dshwAccentSync()`：从**保底泡泡框**的 `slots.big.paint.line` 读描边色，写进 `<html>` 的 `--dshw-accent` / `--dshw-accent-rgb` |
| 挂钩点 | `framesNow()`（每次取框库）+ `toggleMenu()`（每次开关菜单），带缓存守卫，重复调用几乎零开销 |

变量定义在 `:root`，所以挂在 `body` 上的浮层（下拉、提示、子面板）也一并生效。
在 v0.4.2 上实测：替换 **158 行主色 + 185 行半透明色**（共 360 处 `var()` 引用），按名单**有意保留 14 行**。

### 跟随规则

| 情况 | 结果 |
|---|---|
| 保底框描边是普通色值（`#rgb` / `#rrggbb` / `rgb()` / `rgba()`） | 菜单主色 = 该颜色 |
| 「关掉 = 没有描边」（`lineOn: false`）或描边是 `transparent` / 无效值 | 回退 `#203170` |
| 框库还没同步（启动早期） | 不写变量，样式表兜底值生效 |

> 跟随的是**保底框**。所以「把华小科框设为保底框」之后，菜单主色会变成它的描边色 `#a85c6a`。

### 角色自动选中

「当前选中哪个角色」存在浏览器 `localStorage['dshw-role']`，**脚本改不到**。
所以补丁在前端 `loadRoles()` 里加了一条：**localStorage 为空时自动选中同名的角色**。

- 名字由 `--preset-role` 决定，默认「华小科」；`--preset-role ""` / `--no-preset-role` = 完全保持原行为
- 你一旦在「菜单 → 角色」里自己选过，localStorage 就有值，这条路不再触发
- 代价：安装后**第一次**加载会先闪一下默认鲸鱼再切过去（选中会写回 localStorage，之后不再闪）

### 有意**不**跟随的地方

按**内容特征**（不是行号）排除，上游小改版一般仍然有效：内置泡泡框兜底 SVG 与 `framePaintDefaults()` 的 `line`
（**取色的源头**，必须保持真色值）、`USAGE_PALETTE` 与图表系列色（数据可视化配色）、
canvas 2D 颜色（不吃 CSS 变量）、取色器默认值与 `<input type=color>` 初值（必须是真色值）、
泡泡模块默认内容色（会写进你的配置）、以及 `=== '#203170'` 那处**值比较逻辑**。

### 参数

```text
-p, --path <文件>       目标文件（省略则自动定位）
    --backup-dir <目录>  备份目录（默认与目标文件同目录）
    --dsh-home <目录>    DSH 数据目录（默认 $DSH_HOME 或 ~/.dsh）
    --preset-role <名字> 没保存过角色时自动选中的角色名（默认「华小科」）
    --no-preset-role     不做角色自动选中（只改主题联动）
    --dry-run / --revert
```

---

## 二、角色图（`install-role-image.mjs`）

```bash
node install-role-image.mjs --from-dir roles          # 批量装（文件名去扩展名 = 显示名）
node install-role-image.mjs --image 某图.png --name 名字 --pin
node install-role-image.mjs --list
node install-role-image.mjs --remove <角色id>
```

**为什么走 `$DSH_HOME/whale-roles/` 而不是塞进插件包**：插件升级会**整包覆盖** `node_modules`，
塞进去的图必丢；`whale-roles/` 是**用户数据**，升级不受影响。这也正是插件官方「自定义角色」的存储位置，
索引格式与在界面里上传的完全一致（`{version:1,roles:[{id,name,format,pinnedAt,createdAt}]}`，2 空格缩进）。

细节：格式按**文件内容**（PNG / GIF magic bytes）判定，不看扩展名；id 必须匹配 `^[A-Za-z0-9_-]{1,64}$`；
**重复安装同一个名字会复用已有 id**，不会长出第二个同名角色。

---

## 三、泡泡框预设（`install-bubble-frame.mjs`）

```bash
node install-bubble-frame.mjs                 # 默认用 presets/huaxiaoke.frame.json
node install-bubble-frame.mjs --list          # 看当前框库与保底框
node install-bubble-frame.mjs --no-default    # 只导入，不设为保底框
```

**合并而不是覆盖**：只动 `frames` 与 `defaultFrameId`，你的 `items`（点击序列）与 `lib`（模块库）**逐字节不变**。
写盘格式与宿主 `writeBubbleConfig()` 完全一致（2 空格缩进、键序 `v/items/lib/tapAdvance/frames/defaultFrameId`）。
命中规则：先按 `frameId`、再按**框名**；按名字命中时**保留原有 id 与 createdAt**。

### ⚠️ 两个已实测确认的限制

1. **泡泡配置必须已有非空 `items`，否则插件不会加载 `frames`。**
   前端 `applyBubbleCfgSeq()` 在 `items` 为空时直接 `return`，而让框库生效的 `syncFramesFromCfg()` 排在它之后。
   全新机器请先**打开挂件 →「自定义泡泡」→ 点一次「保存」**（不用改任何东西）生成配置，
   再退出 DSH 跑本工具 —— 工具本身也会这样提示并拒绝写入。
2. **导入后要先重启 DSH，再在界面里改泡泡设置**（理由见上面的警告框）。

预设里**默认不允许携带自定义 SVG 代码**（那会绕过宿主的净化，需显式 `--allow-svg-code`）。
随仓库附带的 `presets/huaxiaoke.frame.json` 只引用内置几何（`svgPreset: "classic"`）+ 一套配色与安全区，不含任何上游代码。

---

## 插件升级后怎么办

上游更新会覆盖 `assets/whale-widget.js`，**重跑一次即可**（角色图与泡泡框在用户数据目录，不受影响）：

```bash
node install-all.mjs
```

如果上游改了被锚定的代码，脚本会**明确报错并指出是哪个锚点没命中**，不会留下半成品：

```text
打补丁失败：锚点「loadRoles 角色自动选中」命中 0 次（应为 1）
（上游可能改了这些代码片段；请到仓库开 issue 并附上插件版本）
```

## 还原 / 卸载

```bash
node apply-accent-follow.mjs --revert              # 用最近备份还原前端
node install-bubble-frame.mjs --list               # 看导入的框
node install-role-image.mjs --remove <角色id>      # 删角色
```

补丁先备份（`whale-widget.orig-<时间戳>.js`）、泡泡框先备份（`.dshw-bubble.bak-<时间戳>.json`）；
补丁还会用 `vm.Script` 做语法校验，**校验不通过自动还原**。本工具不修改任何配置格式、记账数据或网络行为。

---

## 校验

```bash
node verify-accent-follow.mjs   # 37 项：静态检查 + 把注入的函数抽出来实际执行
node tests/tools-check.mjs      # 25 项：数据类工具在临时目录里跑真实增删改
```

`verify-accent-follow.mjs` 一半的检查是**把补丁注入的函数从目标文件里抽出来实际执行**，
例如 `自定义描边 #e0433f → 主色跟随 [#e0433f / 224,67,63]`、`描边关闭 → 回退 #203170`、
`注入的角色名与实际行为一致`。`tests/tools-check.mjs` 覆盖合并、幂等、拒绝路径（无配置 / items 为空）与
**dry-run 零副作用**，不依赖上游包、不联网。

CI（`.github/workflows/verify.yml`）三个作业：仓库守卫（不得跟踪上游文件）、
数据类工具自检、以及 npm / GitHub 两种安装来源各跑一遍
打补丁 → 校验 → 幂等 → 还原可复现，并**断言两源结果逐字节一致**。

## 兼容性

| 上游版本 | 结果 |
|---|---|
| v0.4.2 | ✅ 已验证（Windows + 桌面端；37 + 25 项全过；LF / CRLF 均通过） |
| 更早版本 | ⚠️ 未验证（锚点可能不存在） |
| 未来版本 | 重跑即可；锚点失配会明确报错 |

---

## 素材与授权

- 本仓库**只包含工具脚本、预设与文档**，**不包含上游插件的任何代码或素材**。
  脚本在你本机的安装目录 / 用户数据目录上原地工作，仓库不再分发上游内容。
- 上游 `assets/**` 与 `icon.png` **不在 MIT 覆盖范围内**（见上游 `PROVENANCE.md`）：
  按 as-is 随插件分发，**不授予再许可**。这也是本仓库不打包整份插件的原因。
- `roles/` 目录**默认被 `.gitignore` 忽略**：角色图通常是第三方素材，授权状态往往无法举证。
  你可以把自己的图放进去本地使用；想随仓库分发，请在 `.gitignore` 里为该文件加一条 `!` 例外，
  并在 `NOTICE.md` 里写明来源与许可。
- 本仓库**已纳入一张**：`roles/华小科.png`（维护者所在部门美术老师的原创作品，已获授权），
  以及 `presets/huaxiaoke.frame.json`（同一套外观的泡泡框预设，只含配色与安全区，不含上游代码）。
  来源与许可记在 [NOTICE.md](NOTICE.md)。

## 致谢

- 挂件本体：[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT，素材另计）
- 本仓库工具以 MIT 发布，见 [LICENSE](LICENSE)；第三方归属见 [NOTICE.md](NOTICE.md)

---

## English summary

Local-only enhancers for the **DSH whale balance widget** (`dsh-whale-widget`):

1. **`apply-accent-follow.mjs`** — upstream hardcodes its menu/panel accent colour (`#203170`) in the
   front-end CSS and offers no theme setting. This rewrites those literals into CSS variables and injects
   `dshwAccentSync()`, which reads the **bubble frame's stroke colour** and publishes it as `--dshw-accent`
   on `:root`. It also makes the front-end **auto-select a named character** when the browser has no saved
   choice (`localStorage` is outside a script's reach).
2. **`install-role-image.mjs`** — installs character images into the widget's *user data* directory
   (`$DSH_HOME/whale-roles/`) so they survive plugin upgrades, using exactly the index format the widget writes.
3. **`install-bubble-frame.mjs`** — **merges** a bubble-frame preset into `$DSH_HOME/.dshw-bubble.json`
   (optionally setting it as the default frame), touching only `frames` / `defaultFrameId` and leaving your
   click sequence and module library byte-identical.
4. **`install-all.mjs`** — runs all three in order.

Requirements: Node ≥ 18 and an installed `dsh-whale-widget` (verified against **v0.4.2**). Everything is
idempotent, backs up before writing, syntax-checks its output, and rolls back on failure.
`install-all.mjs --dry-run` writes nothing at all. Verification: 37 checks in `verify-accent-follow.mjs`
(half of them execute the injected functions extracted from the patched file) plus 25 checks in
`tests/tools-check.mjs`.

Two constraints, both confirmed in the plugin source: bubble **frames only load when `items` is non-empty**,
and the front-end holds an in-memory config copy, so **restart DSH after importing** and don't touch bubble
settings before that.

The repository ships **no upstream code or assets**; upstream artwork is explicitly *not* covered by its MIT
licence. Licensed MIT — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
