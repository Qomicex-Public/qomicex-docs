## 目标

把站点标题从 `QML Docs` 改成 SEO 友好的 `Qomicex Docs - QML启动器xxx` 形式，并保证标题按当前语言正确展示。保留 `Qomicex Docs`、`QML`、`i18n`、占位符 `xxx` 原样不动。

## 实测确认的机制（已在本地验证）

Mintlify 的 `<title>` 由 `页面 title + " - " + 站点 name` 拼成，`og:title` 同理。实测证据：

| 场景 | 实际渲染结果 |
|---|---|
| 首页 title 写成完整品牌句 | `Qomicex Docs - QML启动器用户手册与插件开发指南 - Qomicex Docs - QML启动器` ← **重复，错误** |
| 首页 title 只写描述部分（修正） | `QML启动器用户手册与插件开发指南 - Qomicex Docs - QML启动器`（41 字符，无重复） |
| 子页 `guide/faq` | `常见问题 - Qomicex Docs - QML启动器`（自动继承后缀） |
| 子页 `plugins/manifest` | `manifest 清单详解 - Qomicex Docs - QML启动器` |

结论：**`Qomicex Docs - QML启动器` 这段固定前缀只能写一处（`docs.json` 的 `name`）**，页面 title 里不能再重复，否则后缀翻倍。

## 标题文案

固定品牌前缀（写入 `docs.json` → `name`）：

```
Qomicex Docs - QML启动器
```

首页（`index.mdx` → `title`）：

```
QML启动器用户手册与插件开发指南
```

最终首页 `<title>`：`QML启动器用户手册与插件开发指南 - Qomicex Docs - QML启动器`

> 说明：`xxx` 保留为可替换的描述段。本次把它落为 `用户手册与插件开发指南`。若你想换别的描述（如 `官方文档`、`下载与插件开发`），只改首页 `title` 一处，后缀自动跟随，不会重复。

## 改动文件

1. **`docs.json`**
   - `name`: `"QML Docs"` → `"Qomicex Docs - QML启动器"`
   - `description`: → `"Qomicex Docs - QML启动器用户手册与插件开发指南"`
   - 新增 `"seo": { "metatags": { "og:locale": "zh_CN" } }`

2. **`index.mdx`**
   - `title`: `"QML Docs"` → `"QML启动器用户手册与插件开发指南"`
   - `description`: 写成长描述（含 `Qomicex Docs - QML启动器` 品牌词 + 覆盖的使用/开发主题），用于搜索结果摘要。

3. **新增 `docs.json` 的 `navigation.languages`**（为 i18n 打底，当前仅中文）

   实测 `languages` 结构被 CLI 接受（`build validation passed`），页面全部正常渲染。方案：把现有 `pages` 数组原样搬进：

   ```json
   "navigation": {
     "languages": [
       { "language": "zh-CN", "default": true, "pages": [ ...现有 6 个分组... ] }
     ]
   }
   ```

   这样中文是唯一语言且为默认，`default: true` 明确语言归属，后续加语言时标题不硬编码、不会串。

## 各语言下的处理规则

| 规则 | 内容 |
|---|---|
| **不硬编码语言** | 品牌前缀 `Qomicex Docs - QML启动器` 只存在于 `docs.json` 一处；页面 title 只写本页描述，禁止再写品牌名。 |
| **中文（zh-CN，默认）** | 首页 title `QML启动器用户手册与插件开发指南`；子页 title 沿用现有中文（`常见问题`、`实例管理`…）。`og:locale` = `zh_CN`。 |
| **新增语言时** | 在 `languages` 数组追加 `{ "language": "en", "pages": [...] }`，**各自维护本语言页面的 title 文案**，不复制中文串；`name` 保持单一品牌前缀，不再叠语言。 |
| **缺失翻译** | 未提供某语言的页面，Mintlify 不会伪造该语言页面；该语言导航里不列该页即可，避免出现"英文页里塞中文标题"。 |
| **切换语言一致性** | 语言切换后 title 后缀始终来自同一 `name`，因此各语言只差前缀描述部分，品牌串完全一致。 |
| **占位符 `xxx`** | 保留为首页描述段的角色；需要换文案时只替换这一段，`Qomicex Docs`、`QML` 不得改动。 |

## 验证方式

改完后按顺序执行，全部在本地完成，不产生部署变更：

1. `mint validate` → 期望 `success build validation passed`（无 error / warning）
2. `mint dev --no-open --port 3399` 后逐项断言：
   - `/` → `<title>` 恰为 `QML启动器用户手册与插件开发指南 - Qomicex Docs - QML启动器`
   - 断言标题中 `Qomicex Docs - QML启动器` **只出现 1 次**（防止后缀翻倍回归）
   - 标题总长 ≤ 60 字符（利于搜索结果完整展示）
   - `og:title` 与 `<title>` 完全一致
   - `og:site_name` = `Qomicex Docs - QML启动器`
   - 子页 `/guide/faq`、`/plugins/manifest` 标题均以 ` - Qomicex Docs - QML启动器` 结尾
   - 全站 49 个路由 `A parsing error occurred` 出现次数为 0
3. `mint broken-links --check-anchors` → 仅允许已知的 3 条中文锚点告警（迁移时已存在，非本次引入）
4. 回归检查：`guide` 侧边栏分组、插件开发五个子组仍在（`languages` 包裹后导航不丢）

## 已知限制（需你知情）

- 本地预览（`mint dev`）的 `<html lang>` 仍输出 `en`，我实测无法通过 `docs.json` 覆盖它；`languages` 的 `language: "zh-CN"` 是声明式配置，**`html lang` 与 `hreflang` 需要部署到 Mintlify 后才真正生效**（官方站 `mintlify.com/docs` 已输出 `hreflang="en|fr|es|zh"`）。这部分我只能部署后复验，不能凭本地结果断言。
- `seo.metatags` 写入的是 `name="og:locale"` 而非 `property="og:locale"`；多数爬虫两种都读，但严格按 OG 规范的话 `property` 更标准。若你要求绝对规范，可改为不设该项，仅靠 `languages` 驱动。
- 本次不改任何页面正文、不改 URL、不删除现有页面，因此不影响已推送的 49 页内容。

## 交付

改完后 commit 并可推送（沿用 `main`），提交信息形如：
`seo: 站点标题改为 Qomicex Docs - QML启动器，补齐语言声明`
