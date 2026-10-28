# Phase 1 — Security Hardening & Deployment Readiness

日期：2026-10-28。基于提交 `273f6b1` 的工作区修改。

后续交付记录：按项目所有者要求，修复已提交并合入本地 `main`；未推送、未部署。下文的“本轮”记录保留安全验收完成时的状态。

**结论：B1/B2 的本地修复与针对性验证通过，可以进入受控 Vercel Preview 验证；尚不能宣称 Production 或真实 provider 验证通过。本轮没有部署、推送或创建提交。**

原始发现保留在 `PREDEPLOYMENT_REVIEW.md`；该报告描述的是修复前状态。所有测试只用合成凭据，provider 传输均由本地 stub 替代。

## 1. 文件变更

| 文件 | 用途 |
| --- | --- |
| `dist/technical-detection.js` | 凭据检测、规范化视图、保守脱敏及重复片段匹配 |
| `dist/ai-policy.js`（新增） | 浏览器与服务端共用时间预算 |
| `lib/ai.js` | 整体截止时间、剩余预算重试、完整 schema 校验、旧图片接口默认关闭 |
| `dist/api-client.js`（新增） | JSON 与非 JSON 平台错误处理 |
| `dist/app.js`、`dist/index.html`、`dist/styles.css` | 发送文字预览、55 秒浏览器超时、接入错误处理 |
| `server.mjs` | 提供新增的浏览器模块 |
| `tests/security-hardening.test.js`（新增）、`tests/ai.test.js` | 新安全用例及显式开启兼容接口的旧合同测试 |
| `accuracy-lab/technical/credential-audit-fixtures.mjs`（新增） | 合成边界输入及按原词 ID 检查发送片段 |
| `accuracy-lab/technical/predeploy-audit.mjs`（增强原有未跟踪文件） | 客户端、直接请求、provider 两轮、截止时间审查 |
| `accuracy-lab/technical/predeploy-image-audit.mjs`（新增） | 四张真实 OCR 图片的凭据片段与 provider 发送审查 |
| `accuracy-lab/technical/predeploy-browser-server.mjs`、`predeploy-browser.html`、`predeploy-browser-capture.js`（新增） | 仅本机的真实浏览器请求、平台错误及导出验证工具 |
| `README.md`、`.env.example`、`accuracy-lab/technical/README.md` | 更新行为、运行方式与能力边界 |
| `SECURITY_HARDENING_REPORT.md`（本文件） | 验证记录与部署建议 |

没有引入运行时依赖或 Phase 2 功能；`vercel.json` 的 60 秒限制保持原值。

## 2. B1：根因与修复

- 在独立检测视图中进行 NFKC 规范化、常见 Unicode 破折号/引号转换和零宽字符处理。按规范化后的词跨度映射回原始 ID；原始 OCR 文字、ID、框及本地对象不改写。发送副本仅包含白名单字段。
- 标签允许字母间 OCR 空格及下划线前缀变量，覆盖全角冒号/等号、`DB_PASSWORD`、`API_KE Y`、命令行参数等。
- 已知密钥前缀不再依赖去空白视图中的起始单词边界，避免 `echo` 与密钥相连后漏检；认证 scheme 不区分大小写。
- 引号解析考虑反斜杠转义，值内出现其他凭据标签不会提前结束当前引用值。OCR 拆开的 Cookie 标签保留整条 cookie 值的脱敏，避免分号后的值残留。
- 强凭据标签缺少可解析赋值符、缺少值或引号不闭合时，保守替换相关 OCR 区域及合理续行；明确的调试边界、闭合引号及分号允许保留独立的调试信息。普通 token 讨论和无标签随机串不会一律当作凭据。
- 重复/重新分词的秘密值和已知片段会映射到全部相关原始词。用户将图片字段设为 Keep 不会绕过发送脱敏。
- AI 对话框新增可展开的发送文字预览，使用 `textContent` 显示；保留明确同意与取消。预览不是匿名化保证，也不替代自动检测。

26 个受支持边界用例全部通过客户端、服务端及两次 provider 请求体检查。另有独立的拆词 Cookie 多值测试。按敏感片段对应的原词 ID 要求占位替换，同时检查序列化文字，避免只检查原始精确字符串而忽略 OCR 改写。

实际图片审查曾再次发现 `sk-proj—-…` 的破折号替换，此次已加入修复和回归用例；最终四图审查通过。无标签、未知格式的随机秘密值依然可能发送，该用例明确记为能力边界，不计为安全通过。

证据：`qa/predeployment/sanitizer-audit.json`、`qa/predeployment/image-audit.json`。

## 3. 实际出站请求检查

### 浏览器 → 本地 API（生产 Vercel handler 的本地调用）

浏览器审查页调用生产 `textPayload`，通过真实 HTTP POST 发送 26 组输入。本地服务器捕获收到的请求体并按原词 ID 检查敏感片段。**26/26 通过。**

另在真实编辑器中加载合成 terminal 图片，用正常浏览器 OCR、同意流程与 AI 按钮发送请求。凭据在请求到达本地服务器前已替换，预览也显示占位符。

### 本地 handler → 模拟 provider

使用真实 `handleAI`，只替换 provider 的 fetch 传输。每组首轮故意返回未知 ID，第二轮返回合法结果。26 组输入和一次编辑器 OCR 请求均符合：两轮 provider 请求均无待保护片段；两轮 user 消息中的脱敏文字完全相同；没有恢复原文。

单元/专项审查还直接将未脱敏的合成 OCR 提交给 handler，验证服务端独立保护，全部通过。

证据：`qa/hardening-browser/browser-request-captures.json`（26 组）、`editor-request-captures.json`（含编辑器请求）。只有通过安全检查的合成内容会写入这些本地捕获文件；失败只记录标志。QA 文件位于发布目录之外。

**这不是真实浏览器 → Vercel 云端或 Vercel → 真实 provider 验证。没有外部 AI 请求，也没有测量真实 provider 延迟、精度或兼容性。**

## 4. B2：截止时间与重试

| 环节 | 当前预算 |
| --- | --- |
| Vercel function 配置 | 60 秒（不变） |
| handler 整体上限 | 50 秒，含请求体读取、provider 及解析 |
| provider 首轮 | 最多 35 秒，并受整体剩余预算限制 |
| 解析/校验/返回预留 | 2 秒 |
| provider 第二轮 | 只获得整体剩余时间减预留；少于 5 秒就不重试 |
| 浏览器请求 | 55 秒 |

整体 timer 会终止停滞的请求体读取并向 provider 传播 abort。慢响应体也受整体截止时间限制。生产默认使用单调时钟；测试可注入时钟以验证预算计算。

仅对完整 schema 合法、但 ID 未知的结果允许一次有明确纠正提示的完整重生成。先校验所有字段的 schema，避免某个字段的未知 ID 掩盖另一个字段的确定性 schema 错误。拒绝、截断、网络错误、schema 错误都不自动重试。第二次失败不返回部分字段，前端继续保留已有遮挡。

验证捕获到：首轮耗时 34 秒后，第二轮收到 **14 秒**预算；剩余时间不足时只调用一次并返回 504；超出截止时间的迟到成功结果也不接受。虚拟 timer 测试覆盖停滞请求体和慢 provider 响应体，均返回 504，并触发取消。

这些为代码、虚拟时间和模拟传输验证，不是线上耗时测量。

## 5. 旧图片接口

当前页面仍只调用 `action=classify-text`。`action=detect` 默认返回 **410**，在读取图片或联系 provider 前拒绝；`consent:true` 也不能开启它。

保留兼容代码和原合同测试。只有部署方明确设置服务端 `PRIVACYLENS_ENABLE_LEGACY_IMAGE_AI=true` 才恢复，恢复后仍要求独立图片 consent。Phase 1 应保持该变量未设置。文本接口继续拒绝图片。模型列表接口仍关闭。

## 6. 平台错误与遮挡保护

新增错误处理支持非 JSON 的 413、429、502、503、504 和其他服务器状态；有效 JSON 错误继续提供具体原因。504 不再误报“启动 npm run dev”。成功状态但正文无效也安全失败。

本机浏览器注入上述六类纯文本错误，均显示对应错误；每次失败后仍保留全部三个遮挡。已有人工调整后再进行 AI 成功重试与错误请求，导出仍完整覆盖。

证据：`qa/hardening-browser/platform-errors.json`（413/429/502/503/500）、`timeout-preview.png`（504 的预览和提示截图）。

## 7. 回归与导出结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | **145/145 通过**；原有 105 项仍通过 |
| 专项发送与预算审查 | **26/26** 受支持格式通过；未知无标签格式单列为限制 |
| 四图真实 OCR 审查 | Java env、JS 命令、Python 对照均不残留凭据片段；负例无候选；两轮 provider payload 均通过 |
| 技术图集真实 OCR | **14/14** 类型正确；**22/22** 字段完整覆盖；**42/42** 调试控制区未误遮 |
| 最终检测规则重放技术图集 | 同样 14/14、22/22、42/42 |
| 九图真实 OCR 回归 | **21/21** 检查通过 |
| 旧订单/学术/聊天等独立 OCR 文档重放 | **15/15** 类型不变；原有覆盖像素丢失 **0**；不等同于真实 AI 重测 |
| 浏览器发送与 provider 重试 | 26 组边界输入 + 编辑器真实 OCR 请求通过 |
| 桌面、390px 视口调整后 PNG | 两份均 1120×518；各 **3/3** 敏感矩形完整不透明覆盖，**4/4** 调试对照不变；意外修改为 **0**；无 PNG 文本/EXIF 块 |
| 视口切换后再次调大框 | 新增 **56** 个遮挡像素，原有遮挡丢失 **0** |
| API adapter 合成冒烟 | `api/ai.js` 返回 200，provider 收到脱敏副本 |
| JS 语法、diff 空白检查 | 通过 |

PNG 来自 QA 观察器读取生产导出流程已经生成、预览和下载共用的同一 blob，没有重新绘制。正常 Review → Download 按钮也在浏览器中操作验证。像素检查使用生成时独立标注的敏感文字矩形，包含字间空白，不以 OCR 框作为真值。

导出证据：`qa/hardening-browser/desktop-adjusted.png`、`mobile-adjusted.png`、`viewport-mask-comparison.json`；像素验证记录在 `accuracy-lab/technical/results/browser-terminal-hardened-*-verification.json`。390px 视口检查使用键盘调整，不代表真实手机触摸验证。

## 8. 剩余风险及部署建议

- 无标签未知秘密、严重 OCR 错字/漏字、无法推断的分词仍可能漏检；不能承诺完全无秘密发送。邮箱、地址、个人路径等其他 OCR 文本仍可能发送，预览和同意说明明确保留该限制。
- 保守的未解析区域规则可能多遮文字；当前调试对照与回归数据通过，不代表任意截图都无误遮。
- 真实 provider 的参数/schema 支持、延迟、费用、日志与保留政策尚未验证；测试通过不能证明真实模型检测准确率。
- 云端项目环境变量、访问控制、限流/费用保护、实际 Node 版本、平台构建/打包和部署仍未验证。现有 same-origin 检查不构成身份认证，应用仍没有分布式限流。

**建议：本地阻断修复已满足针对性验收，可进入受控 Vercel Preview。** 使用合成数据验证目标环境、真实 provider、超时/错误行为及环境访问保护，再决定 Production。保留旧图片接口默认关闭，不自动部署。
