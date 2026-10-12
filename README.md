# dsh-whale-theme-follow

给 [DSH 小鲸鱼记账挂件](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（`dsh-whale-widget`）的两个**本地增强工具**：

| 工具 | 作用 |
|---|---|
| `apply-accent-follow.mjs` | 让**菜单 / 面板的主色跟随泡泡的描边色** —— 改泡泡框描边，菜单跟着换色 |
| `install-role-image.mjs` | 把**角色图**安装进 `$DSH_HOME/whale-roles/`，不随插件升级丢失 |

两个都只操作**本机安装**，不联网、不上传任何文件。

> 上游插件本身**没有**「菜单主题色」设置项：菜单配色是写死在前端 CSS 里的常量。
> 本仓库用「颜色变量化 + 运行时取色」把这条路补上，并且**不复制上游任何代码或素材** ——
> 见下方[素材与授权](#素材与授权)。

---

## 环境要求

- **Node.js ≥ 18**（挂件运行在 Node 上，所以它必然存在）
- 已通过 `dsh plugin` 安装 **`dsh-whale-widget`**（桌面端 / `dsh web` 均可）
- 已验证：上游 **v0.4.2** + DeepSeek Harness 桌面端（Windows）

## 快速开始

```bash
# 1) 菜单主色跟随泡泡描边色
node apply-accent-follow.mjs

# 2) 校验（27 项：静态检查 + 把补丁函数抽出来实际执行）
node verify-accent-follow.mjs
```

不带参数时会**自动定位**已安装的插件文件（`$DSH_HOME/profiles/{desktop,web,tui}/node_modules/dsh-whale-widget/assets/whale-widget.js`）。
也可以显式指定：

```bash
node apply-accent-follow.mjs --path "~/.dsh/profiles/desktop/node_modules/dsh-whale-widget/assets/whale-widget.js"
```

跑完**重启 DSH**（桌面端完全退出重开），再硬刷新页面。

---

## 一、主题联动（`apply-accent-follow.mjs`）

### 它做了什么

| 改动 | 内容 |
|---|---|
| 颜色变量化 | `#203170` → `var(--dshw-accent,#203170)`；`rgba(32,49,112,α)` → `rgba(var(--dshw-accent-rgb,32,49,112),α)` |
| 运行时取色 | 注入 `dshwAccentSync()`：从**保底泡泡框**的 `slots.big.paint.line` 读描边色，写进 `<html>` 的 `--dshw-accent` / `--dshw-accent-rgb` |
| 挂钩点 | `framesNow()`（每次取框库时）+ `toggleMenu()`（每次开关菜单时），带缓存守卫，重复调用几乎零开销 |

变量定义在 `:root`，所以挂在 `body` 上的浮层（下拉、提示、子面板）也一并生效。
在 v0.4.2 上实测：替换 **158 行主色 + 185 行半透明色**（共 360 处 `var()` 引用），按名单**有意保留 14 行**。

### 怎么改颜色

1. **重启 DSH**（桌面端完全退出重开）
2. 主菜单 →「**自定义泡泡**」
3. 新建一个框，或**复制**「经典（内置）」—— 内置框是**只读**的，改不了它的描边
4. 确认在 **SVG 模式**（「外观」一节只在 SVG 模式出现）→「**描边**」→ 选颜色
5. 保存，并让这个框成为**保底框**（在框库里选中即设为保底）
6. 菜单主色随之变化；下次打开菜单会重新取色

### 跟随规则

| 情况 | 结果 |
|---|---|
| 保底框描边是普通色值（`#rgb` / `#rrggbb` / `rgb()` / `rgba()`） | 菜单主色 = 该颜色 |
| 该槽位「关掉 = 没有描边」（`lineOn: false`） | 回退 `#203170` |
| 描边是 `transparent` / `none` / 无效值 | 回退 `#203170` |
| 框库还没同步（启动早期） | 不写变量，样式表兜底值 `#203170` 生效 |

> 跟随的是**保底框**（`defaultFrameId`）。如果你希望它跟随"当前显示的那个泡泡"（即点击序列各自指定的框），
> 改 `dshwAccentSync()` 里的取色来源即可，欢迎提 PR。

### 有意**不**跟随的地方

这些行由脚本按**内容特征**（不是行号）排除，所以上游小改版一般仍然有效：

- `stroke="#203170"`（内置泡泡框兜底 SVG）与 `framePaintDefaults()` 的 `line` —— 它们是**取色的源头**，必须保持真色值；
- `USAGE_PALETTE` 与用量图的图表系列色 —— 数据可视化配色，跟主题走会误导；
- `ctx.fillStyle/strokeStyle` 的 canvas 2D 颜色 —— canvas 不吃 CSS 变量；
- 取色器默认值 `defaultHex || '#203170'` 与 `<input type=color>` 的初值 —— 必须是真色值；
- 泡泡模块默认内容色 `color: "#203170"` —— 会被写进用户配置；
- `=== '#203170'` 那处**值比较逻辑** —— 替换会改变行为。

### 参数

```text
-p, --path <文件>       目标文件（省略则自动定位）
    --backup-dir <目录>  备份目录（默认与目标文件同目录）
    --dsh-home <目录>    DSH 数据目录（默认 $DSH_HOME 或 ~/.dsh）
    --dry-run           只报告将要做的改动，不写盘
    --revert            用备份目录里最新的备份还原
```

安全设计：**幂等**（已打过则跳过）· **先备份**（`whale-widget.orig-<时间戳>.js`）·
**语法校验**（用 `vm.Script` 只解析不执行）· **校验不通过自动还原**（不留半成品）。

---

## 二、角色图安装（`install-role-image.mjs`）

```bash
# 装单张（--pin 让它排在角色列表最上面）
node install-role-image.mjs --image "我的角色.png" --name "华小科" --pin

# 批量装 roles/ 目录里的 png / gif（文件名去扩展名作为显示名）
node install-role-image.mjs --from-dir roles

# 看看装了哪些
node install-role-image.mjs --list

# 删掉一个
node install-role-image.mjs --remove role_xxxxx
```

### 为什么走 `$DSH_HOME/whale-roles/` 而不是塞进插件包

- 插件升级会**整包覆盖** `node_modules`，塞进去的图必丢；`whale-roles/` 是**用户数据**，升级不受影响；
- 这正是插件官方「自定义角色」的存储位置，索引 `roles.json` 的格式与在界面里上传的完全一致
  （`{version:1, roles:[{id,name,format,pinnedAt,createdAt}]}`，2 空格缩进）；
- 所以装完在「菜单 → 角色」里直接就能看到。

### 两个必须知道的点

1. **装完要在「菜单 → 角色」里选中它一次。** 当前选中的是哪个角色存在浏览器
   `localStorage['dshw-role']`，是客户端状态，脚本无法代你选择。
2. **格式由文件内容判定**（PNG / GIF 的 magic bytes），不看扩展名 —— 避免 `.png` 里装的是 GIF 导致图裂。
   角色 id 必须匹配 `^[A-Za-z0-9_-]{1,64}$`，且不能是内置的 `default`。

---

## 插件升级后怎么办

上游更新会覆盖 `assets/whale-widget.js`，**重跑一次补丁**即可（角色图不用管，它在用户数据目录）：

```bash
node apply-accent-follow.mjs && node verify-accent-follow.mjs
```

如果上游改了被锚定的那几行代码，脚本会**明确报错并指出是哪个锚点没命中**，不会留下半成品：

```text
打补丁失败：锚点「framesNow 钩子 + 取色函数」命中 0 次（应为 1）
（上游可能改了这些代码片段；请到仓库开 issue 并附上插件版本）
```

## 还原 / 卸载

```bash
# 还原前端（用最近的备份）
node apply-accent-follow.mjs --revert

# 删除角色
node install-role-image.mjs --remove <角色id>
```

本工具不修改任何配置格式、记账数据或网络行为，随时可逆。

---

## 校验都查了什么

`verify-accent-follow.mjs` 会做 27 项检查，其中一半是**把补丁注入的两个函数从目标文件里抽出来实际执行**：

```text
PASS  CSS :root 变量已注入
PASS  主色 var() 引用 > 150 处   [161]
PASS  半透明 var() 引用 > 150 处   [199]
PASS  泡泡框兜底 SVG 描边仍为 #203170（3 处）
PASS  值比较逻辑未被替换 / 用量图配色盘未被替换 / 取色器默认值未被替换
PASS  dshwAccentSync 恰好出现 3 次（1 定义 + 2 调用）
PASS  自定义描边 #e0433f → 主色跟随   [#e0433f / 224,67,63]
PASS  描边关闭(lineOn:false) → 回退   [#203170 / 32,49,112]
PASS  无框库时不抛错、不写变量   [{}]
ALL PASS  (27 checks)
```

CI（`.github/workflows/verify.yml`）会在 Ubuntu 上拉取指定上游版本、打补丁、校验，并复验**幂等性**。

## 兼容性

| 上游版本 | 结果 |
|---|---|
| v0.4.2 | ✅ 已验证（Windows + 桌面端；27 项校验全过） |
| 更早版本 | ⚠️ 未验证（锚点可能不存在） |
| 未来版本 | 重跑即可；锚点失配会明确报错 |

同时也验证过 **LF 换行**的文件（CI 在 Linux 上跑的就是这种），补丁与校验同样通过。

---

## 素材与授权

- 本仓库**只包含工具脚本与文档**，**不包含上游插件的任何代码或素材**。
  脚本在你本机的安装目录上原地修改，仓库本身不再分发上游内容。
- 上游 `assets/**` 与 `icon.png` **不在 MIT 覆盖范围内**（见上游 `PROVENANCE.md`）：
  按 as-is 随插件分发，**不授予再许可**。这也是本仓库不打包整份插件的原因。
- `roles/` 目录**默认被 `.gitignore` 忽略**：角色图通常是第三方素材（角色形象多为他人或机构所有），
  授权状态往往无法举证。请把图放在 `roles/` 里本地使用，**不要直接提交**。
  如果你确实拥有某张图的权利（自己创作 / 已获授权 / 自由许可），
  可以用 `git add -f roles/<文件>` 强制纳入，并在 `NOTICE.md` 里补上它的来源与许可。

## 致谢

- 挂件本体：[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT，素材另计）
- 本仓库的工具脚本以 MIT 发布，见 [LICENSE](LICENSE)；第三方归属见 [NOTICE.md](NOTICE.md)

---

## English summary

Two small local-only tools for the **DSH whale balance widget** (`dsh-whale-widget`):

1. **`apply-accent-follow.mjs`** — upstream hardcodes its menu/panel accent colour
   (`#203170`) in the front-end CSS and offers no theme setting. This script rewrites those
   literals into CSS variables and injects a small `dshwAccentSync()` that reads the
   **bubble frame's stroke colour** and publishes it as `--dshw-accent` on `:root`.
   Change the bubble outline → the menu follows.
2. **`install-role-image.mjs`** — installs character images into the widget's *user data*
   directory (`$DSH_HOME/whale-roles/`) so they survive plugin upgrades, using exactly the
   index format the widget itself writes.

Requirements: Node ≥ 18 and an installed `dsh-whale-widget` (verified against **v0.4.2**).
Both tools are idempotent, back up before writing, syntax-check their output, and roll back
on failure. `verify-accent-follow.mjs` runs 27 checks — half of them execute the injected
functions extracted from the patched file.

The repository ships **no upstream code or assets**; upstream artwork is explicitly *not*
covered by its MIT licence, and character art under `roles/` is gitignored by default.
Licensed MIT — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
