# Phase 1 部署前审查

审查日期：2026-10-28。审查提交：`273f6b1`。**结论：暂不部署；有两项 Blocking。** 本轮没有修改产品代码、部署配置或 Phase 2 功能。新增了独立审查脚本和本报告；测试服务器和生成物在忽略的 `qa/predeployment/` 中。

## Blocking

**B1 — 部分明显凭据仍会进入客户端请求及两次 provider 请求。**

复现位置：`dist/technical-detection.js:3`、`:40`、`:62`、`:73`。原有正例的拆分值、重复 token 和标准认证头可以脱敏，但新增 13 项边界审查中，有 7 种可改进的格式漏检，另有 1 种未知且无标签的凭据格式未被识别。未命中的文本不会被拒绝发送，服务端使用相同筛查器，两次请求均保留这些值。

| 测试形式 | 客户端与重试结果 | 根因 |
| --- | --- | --- |
| `API_KEY：...`、`access_token＝...` | 原文残留 | 英文标签只接受 ASCII 冒号或等号 |
| `DB_PASSWORD=...` | 原文残留 | 单词边界不接受下划线前缀变量名 |
| `echo sk-proj-...` | 原文残留 | 去空白后命令与密钥相连，破坏前缀匹配的单词边界 |
| OCR 将标签拆成 `API_KE Y:` | 原文残留 | 只容忍部分固定位置的标签空白 |
| 含转义引号、被拆词的密码值 | 后半部分残留 | 用第一个同类引号结束值，没有处理转义 |
| 无 Authorization 标签的 `bearer ...` | 原文残留 | 独立 Bearer 检测区分大小写 |
| 未知前缀、无标签的高熵值 | 原文残留，属于已知能力边界 | 不能从任意字符串可靠判断秘密 |

补充真实截图测试确认：Java 异常图中的合成 `DB_PASSWORD` 值被 OCR 完整读出，却既未产生凭据遮挡候选，也未在发送副本中替换。JavaScript 终端图的密钥被 OCR 改写了字符，因而没有泄露“精确原字符串”，但一个凭据形态的 OCR 词仍原样进入请求，不能把精确字符串检查阴性当作脱敏成功。Python 标准密码赋值对照正常。

发布前应修复这些可复现格式，并为无法可靠解析的高风险行提供排除或发送前复核机制。规范化只能作用于检测视图，并正确映射回原词 ID；不能破坏本地原始 OCR 和几何。未知格式和完全漏掉的文字仍不可能得到全面保证。

复现：`node accuracy-lab/technical/predeploy-audit.mjs`。脚本只使用合成值和模拟 fetch，记录布尔结果，不向真实 provider 发送数据；发现上述问题时返回退出码 1。证据：`qa/predeployment/sanitizer-audit.json`、`qa/predeployment/image-audit.json`。

**B2 — 重试预算超过生产函数时限。**

`lib/ai.js:239` 每次 provider 请求允许 45 秒，未知 ID 可触发第二次请求，总计最多约 90 秒，另有解析和网络开销；`dist/app.js:750` 的浏览器上限是 100 秒。`vercel.json:8` 明确将函数限制为 60 秒。首个请求较慢且触发重试时，合法流程可能被平台提前终止。这是配置与代码预算分析，并非本轮观察到的线上故障。

发布前应设置小于函数时限的端到端 deadline，或在确认项目计划允许后提高函数时限并留出余量；同时对齐客户端超时。Vercel 明确说明超出配置时限会终止函数。[官方时限说明](https://vercel.com/docs/functions/configuring-functions/duration)

## Important

- **不能将“原始 OCR 保留本地”理解为“原始文字全部不发送”。** 原始 OCR 对象、词 ID 和框在所有 13 项检查中未被修改；发送的是独立副本。但未被替换的邮箱、个人路径、内部主机名，以及漏检凭据，仍包含在副本中。图片上的 Hide/Keep 不控制发送内容。当前同意说明披露了残余敏感文本，但最好增加可检查的发送预览或排除选项。
- **并非所有外部 AI 路径都经过文本脱敏。** 当前编辑器只调用 `classify-text`：浏览器 `textPayload` 先筛查，后端再次筛查，重试复用同一份文本，未发现原文回退。兼容端点 `action=detect` 仍可在单独 consent 后发送完整 JPEG（`lib/ai.js:249`），不在本次文本脱敏保证内。公开发布前应决定是否禁用或隔离这个未被当前页面使用的路径。
- **平台非 JSON 错误提示不准确。** `dist/app.js:695` 先解析 JSON；HTML/纯文本的网关 504/413 会显示“启动 npm run dev 或部署 API”，而不是超时或大小提示。现有遮挡仍会保留，但用户可能误判部署状态。应按 HTTP 状态处理平台错误，再读取可选 JSON 信息。
- **生产环境与真实 provider 尚未验证。** 本地 `.env` 的 key 已设置、base URL 通过 HTTPS 校验，key 未进入 `dist`，`.env` 未被 Git 跟踪。没有读取或修改云端设置；需在发布前核对 Vercel 目标环境变量、项目根目录、实际 Node 版本及 provider 对固定模型、schema、参数的支持。当前代码也没有身份验证或跨实例限流；项目侧访问/费用保护是否已配置无法从仓库确认。

## Optional

- 将 `engines.node` 从 `>=22` 固定到明确主版本，减少本地和生产运行时漂移。Vercel 文档说明开放范围可能选用较新主版本。[Node 版本规则](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- 手机导出页中的宽幅截图文字较小，可考虑点开大图检查。编辑器现有缩放可用；本轮实际输出像素和遮挡正确。本轮验证为 390px 浏览器视口及键盘调整，不代表真实手机触摸或读屏器验证。

## 本轮通过的验证

| 检查 | 结果 |
| --- | --- |
| 全部现有回归测试 | 105/105 通过；涵盖订单、地址、学术、聊天、付款、框调整及 API 合同 |
| 原有九图真实 OCR 检查 | 21/21 通过 |
| 旧独立评估文档重放 | 15/15 类型不变，未丢失已覆盖像素；不等同于真实模型重测 |
| 现有技术图片集重新跑真实 OCR | 14/14 类型正确，22/22 标注字段完整覆盖，42/42 控制区未误遮；包含 Java、Python、JS、终端、配置及负例 |
| 新增四图检查 | Java 和 JS 两张暴露 B1 问题；Python 对照正常；localhost、公共文档、通用路径、错误码和版本负例没有产生遮挡候选 |
| 桌面和手机调整后 PNG | 两份均为 1120×518；3/3 敏感矩形完整不透明覆盖，4/4 调试控制区不变；无意外像素修改、文本或 EXIF 块 |
| 视口切换与再次调整 | 桌面框位置保留；手机再扩大 10 原图像素后新增 280 个遮挡像素，原有遮挡丢失为 0 |
| API 响应与错误合同 | 现有拒绝、截断、无效 ID、重复 ID、schema、授权、限流、超时测试通过；无非法部分结果覆盖旧框 |
| 静态文件与 API 入口 | 必需 OCR 资产存在；`api/ai.js` 入口模拟调用返回 200，provider 收到筛查副本；JS 语法和 diff 检查通过 |

PNG 验证采用 QA-only 观察器读取生产导出代码已经生成的同一个 blob，即导出预览与下载共用的 PNG；没有重新绘制导出图。分别在桌面和手机视口通过真实 UI 扩大框后触发导出，检查独立源标注文字矩形及保留区域。默认英文＋繁简中文 OCR 流程也在该浏览器检查中实际运行。

本地证据：`qa/predeployment/results/desktop-adjusted.png`、`mobile-adjusted.png`、`qa/predeployment/mobile-edit-state.json`；像素验证记录在 `accuracy-lab/technical/results/browser-terminal-predeploy-*-verification.json`。旧两份实际浏览器下载 PNG 仍保留在技术评估目录。本轮所有数据均为合成数据，没有真实外部模型调用。

## Vercel 兼容性结论

`framework:null`、空 build/install 命令与 `outputDirectory:dist` 与当前预生成静态站点结构相符，Phase 1 没有需要生产安装的新增依赖。API 只静态导入 `lib/ai.js`、`dist/privacy-types.js`、`dist/technical-detection.js`；已检查文件存在及入口调用。`export default { fetch }` 和项目的 ESM 配置符合官方 Node handler 文档。[Node handler](https://vercel.com/docs/functions/runtimes/node-js)、[静态配置](https://vercel.com/docs/project-configuration/vercel-json)

请求体限制低于平台 4.5 MB 限制，OCR 文本另有词数、字数和坐标校验；不是目前观察到的部署阻断点。[函数限制](https://vercel.com/docs/functions/limitations)

本机没有 Vercel CLI，也未连入目标项目运行 production build，因此以上是代码、资产和官方配置合同的检查，不能替代目标项目构建及发布后验证。不得据此宣称生产环境已经可用。应先解决 B1/B2，再做受控的目标环境验证；本轮未部署，也未引入 Phase 2。
