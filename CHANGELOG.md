# 更新记录

本文件记录本仓库（工具脚本）的版本，与上游挂件版本无关。

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
