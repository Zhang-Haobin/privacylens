# 手动上传与 Vercel Preview 验证

GitHub 上传和部署由项目所有者操作。本轮仅做本地准备，没有云端配置变更、真实 provider 调用或部署。

## 上传

- 项目根目录是 `sites/privacylens/`，不是它上面的 PrivacyLens 文件夹。上传后的仓库根目录应直接包含 `package.json`、`vercel.json`、`dist/`、`api/` 和 `lib/`。
- 修复已按项目所有者要求提交并合入本地 `main`；GitHub 上传或推送、云端部署仍由项目所有者操作。
- 建议先上传到单独的验证分支。当前 README 记录了 `main` 推送会触发 Production；实际规则以你的 Vercel 项目设置为准。
- `qa/delivery/privacylens-github-source.zip` 是干净源代码包。使用 GitHub 网页上传时，先解压并上传其中的文件；不要只上传 ZIP 本身。
- 包内保留测试源码、合成用例和必要 OCR 模型，排除 `.git`、本地 `.env`、`node_modules`、生成的截图/请求捕获，以及历史 Sites 关联目录。
- `.gitignore` 主要约束 Git 跟踪；拖拽文件到 GitHub 网页前仍须确认没有选入秘密文件。本地 `.env` 不应上传，只有空值示例 `.env.example` 可以入库。

## Preview 部署前

1. 确认 Vercel 团队、项目、GitHub 仓库、验证分支和 Production 分支；本轮目标只选 Preview。
2. 确认项目根目录、Framework 为 Other/null、Output Directory 为 `dist`，Install/Build Command 按 `vercel.json` 保持空值。不要因空构建命令而漏传预生成的 OCR 资产。
3. 在 Preview 环境单独配置服务端 `OPENAI_API_KEY` 和 HTTPS `OPENAI_BASE_URL`。不要使用前端公开变量前缀，不要把值写进 `dist/`。
4. 保持 `PRIVACYLENS_ENABLE_LEGACY_IMAGE_AI` 未设置。默认图片接口应返回 410。
5. 确认部署实际采用的受支持 Node 主版本。当前 `engines.node` 为开放范围 `>=22`，本机测试运行时为 Node 26；本地通过不代表目标 Node 版本已经验证。若固定版本，同步 package/lockfile 后重新检查。
6. 保持 `api/ai.js` 的 function duration 为 60 秒；应用预算为后端 50 秒、首轮最多 35 秒、重试使用剩余预算、浏览器 55 秒。
7. 启用覆盖 Preview 页面及 `/api/ai` 的访问保护，用未登录请求实际验证。没有确认保护前，不暴露可工作的 AI 端点。
8. 使用独立、可撤销且有低额度限制的 provider 测试凭据；检查 provider 侧的配额/费用限制。Vercel 平台费用控制不能视为第三方 provider 的费用硬上限，也不要为测试修改其他项目的计费设置。

`.vercelignore` 采用部署白名单，仅允许 `dist/`、`api/`、`lib/`、package 文件及 `vercel.json`。源代码包用于 GitHub；它与 Vercel 实际部署文件集合不同。

## Preview 验证

- 使用合成技术截图，确认静态页面、默认英文及繁简中文 OCR 资产都正常加载。
- 检查凭据、本机用户目录遮挡及调试信息保留。发送预览及浏览器 Network 请求体中，合成凭据应被占位符替换，原始 OCR ID 仍保留。
- 在访问受限且 provider 用量可控后，少量调用真实 AI，确认固定模型、参数、schema 与 ID 校验兼容。一次页面请求可能产生两次 provider 调用，额度按 provider 尝试次数计算。
- 检查错误、取消、超时均保留已有遮挡；完整的故障注入只能在隔离验证环境进行，不把 QA 服务器或调试开关发布到正式页面。
- 检查旧图片接口默认 410、文本接口拒绝图片。
- 桌面和移动视口调整遮挡并导出 PNG，核对完整不透明覆盖、原始分辨率及调试区域。
- 用合成数据检查请求体，不记录原始 OCR 或凭据。浏览器请求检查只能证明浏览器到 Vercel 的内容；provider 侧验证应另行记录证据。
- 分别记录已验证功能、失败、剩余风险及目标运行时；不要自动提升到 Production。

## 本地复核

```sh
npm test
node accuracy-lab/technical/predeploy-audit.mjs
git diff --check
```

前一阶段的详细结果见 `SECURITY_HARDENING_REPORT.md`。本地测试全部使用合成数据和模拟 provider，尚未验证真实 Vercel/真实 provider。

参考：[部署文件白名单](https://vercel.com/docs/deployments/vercel-ignore)、[Deployment Protection](https://vercel.com/docs/deployment-protection)、[Node 版本](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)、[Spend Management](https://vercel.com/docs/spend-management)。
