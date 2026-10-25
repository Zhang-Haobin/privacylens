# PrivacyLens — CCST9003 interactive prototype

A screenshot editor demonstrating **recipient- and purpose-dependent disclosure decisions**, with optional server-side AI detection through an OpenAI-compatible provider.

## Run

Requires Node.js 22.9+ (or a newer supported Node.js release). No npm packages or build step are needed.

From this directory:

```sh
cp .env.example .env
npm run dev
```

Open `http://localhost:4173`. Edit `.env` to set the server key, then restart the server. Without a key, the fictional sample, manual editing and export still work; AI requests show a configuration message. A plain static HTTP server supports manual editing only and cannot run `/api/ai`.

## 接入 novacode API / AI setup

In your **local `.env`** or **Vercel project → Settings → Environment Variables**, set:

```dotenv
OPENAI_API_KEY=你的实际密钥
OPENAI_BASE_URL=https://ai.novacode.top/v1
```

`OPENAI_API_KEY` is the variable name; its value must be your actual key. Do not paste the Markdown link syntax into `OPENAI_BASE_URL`, and do not include `/chat/completions` in it. This is a third-party provider, not an OpenAI-hosted endpoint.

The backend is locked to **`gpt-6-luna`**. The editor has no model list, selector or model-ID input. It sends no model parameter. Requests attempting to use another model are rejected before contacting the provider. Legacy `OPENAI_MODEL` environment variables are ignored; there is no automatic fallback to another model. The former model-list action returns 404.

To run detection:

1. Configure the API key and base URL, then start the local server or redeploy.
2. Choose the fictional sample or import an image.
3. Tick the AI transfer checkbox and click **Detect sensitive details**.
4. Review every mask, adjust switches and draw additional masks for missed details before exporting.

Your provider must grant access to `gpt-6-luna`. Its actual prices may differ from official OpenAI rates, and its image compatibility and localization accuracy still need live verification.

Only the backend reads the key. Do not put credentials in `dist/`, a public-prefixed environment variable, Git or browser storage. `.env` is ignored; `.env.example` contains no secret.

AI requests go to `POST {OPENAI_BASE_URL}/chat/completions` with an `image_url` data URL. No optional JSON-mode parameter is required; the prompt requests JSON and the backend validates it. Invalid/truncated output is rejected as a whole without replacing existing masks. There are no automatic retries that could trigger additional paid calls.

Cost controls: the prompt asks only for categories and boxes (labels and explanations are generated locally); completion output is capped at 2048 tokens; `gpt-6-luna` requests set `reasoning_effort: none`. These parameters require compatible provider support. Hitting the output cap shows an error and keeps existing masks; it never silently applies incomplete output. No conversation history is sent, and changing the sharing context reuses detected fields without another AI request. Image detail remains `high` to retain screenshot-text legibility. Actual token use and detection accuracy have not been measured on the live service.

The browser re-encodes an **unmasked** copy as JPEG, resizes to at most 2400 pixels per side, and reduces large payloads before transmission. Model boxes use normalized coordinates; the browser maps them to the original image with a small padding. This is model-based localization, not precise OCR. Verify the boxes visually. Original-resolution export and manual masks remain local.

## Deploy with GitHub and Vercel

Push this directory (the one containing `vercel.json` and `package.json`) to a GitHub repository, then import that repository in Vercel. Use the repository root as **Root Directory** and **Other** as the framework preset. `vercel.json` disables installation/build commands and publishes `dist` plus the Node.js function in `api/ai.js`. Keep `api/`, `lib/` and `package.json` in the deployment; deploying only `dist` does not enable AI.

Set the variables above for the environments you use (Production and/or Preview), then redeploy. The function has a 60-second duration setting; provider calls time out after 45 seconds. The client and server cap request sizes below Vercel's function payload limit.

This local checkout also retains an earlier Sites static-hosting manifest. Publishing `dist` to a static-only host will not run the Vercel API function. This update prepares the Vercel/local implementation; it does not migrate or publish the earlier Sites deployment.

The AI endpoint uses the deployment's server key and has no user authentication or distributed rate limiter. For a public deployment, configure deployment access or platform rate limits appropriate to your audience and provider budget. Same-origin checks prevent cross-site browser requests; they do not authenticate arbitrary clients.

Vercel's GitHub integration deploys changes pushed to `main` to production and creates preview deployments for pull requests. Commit the files inside `dist`: they are the source for this buildless project. Keep `.vercel`, local environment files and credentials out of Git.

## What works

- Fictional order screenshot generated in the browser; six pre-labelled personal fields.
- Public delivery-delay post: all six sample fields are masked.
- Initial delivery enquiry to verified official support: order number retained, five other sample fields masked.
- Explanations for each recommendation and user overrides.
- Original/protected views; context changes reapply sample recommendations and retain manual masks.
- User-supplied PNG/JPEG/WebP images, opened locally in memory, with manual editing and **optional, explicitly initiated AI detection**.
- Server-side vision requests using `OPENAI_API_KEY` and `OPENAI_BASE_URL`, locked to `gpt-6-luna` with no user model selection.
- Validated AI suggestions with individual switches; public context hides all detected regions, while initial support context suggests keeping order/tracking numbers only. Manual masks survive detection and context changes.
- Failed detection retains existing masks; switching images cancels and invalidates stale results. Export waits for an active detection to finish or be cancelled by loading/resetting.
- Draw solid masks, remove individual manual masks, undo last mask, reset.
- Review dialog with the exact output preview, mandatory confirmation, then flattened PNG download.
- Responsive layout, keyboard accessible field switches and dialogs.

## Deliberate limitations

**No measured accuracy or privacy guarantee is provided.** Before an AI request, the sample uses known rectangles and imported images have no automatic masks. Optional AI detection requires a valid key and an image-capable model. A response with zero regions does not establish safety; model boxes can be inaccurate or incomplete. Precise OCR-based localization is not implemented. Manual editing requires pointer/touch interaction.

Manual-only editing sends no image data. AI detection sends an unmasked JPEG copy through the app server to the configured provider, only after the user selects the transfer checkbox and clicks Detect. The app does not persist images/results or print credentials/provider response bodies. Provider retention policies and hosting infrastructure policies still apply. No analytics or remote font scripts are used.

The two scenarios are intentionally paired with their purposes. “Official support” means an **initial delivery-status lookup**, not payment verification, address changes, or an arbitrary recipient claiming to be support. Recommendations are reset when context changes; field explanations identify overrides.

## 60–90 second classroom demo

1. Start with the fictional order and “A public audience”. Show that delivery status remains visible while all six personal fields are covered.
2. Select “Official customer support”. Point out that the order number becomes visible because it helps locate this order. Other personal fields remain covered.
3. Read the order-number explanation, then override it using its switch. This demonstrates user control.
4. Select “Add a mask”, draw over a region and undo/remove it.
5. Select “Review & export”, review the full image, tick the confirmation and download the PNG.
6. Optionally import a fictional screenshot of your own and use manual masks. If API settings are configured, explicitly opt in to AI transfer, run detection, and explain that its suggestions still need visual review.

## Proposal notes / 提案完善建议

目前 Part 1 已有较清晰的问题、目标用户、竞品和可实现范围。Part 2 与 Part 3 仍需补齐。

- **Project outcome:** 用网页原型演示选择分享对象与目的 → 建议遮挡及原因 → 用户调整 → 导出副本。不要把预设示例写成真实 OCR 或 AI 能力。
- **Technical:** 当前版本是前端 Canvas + 情境规则 + 示例坐标，并新增可选的兼容 OpenAI 格式视觉模型调用、结果校验和框坐标映射。尚未验证真实服务效果；下一阶段可接入精确 OCR 并评估漏检、误检和坐标偏差。
- **Division of labour:** 根据真实组员人数分配背景研究、技术/演示、商业、伦理和整合；姓名与负责人应由小组确认。
- **Evaluation:** 在相同的虚构截图、相同分享任务下，对比手动遮挡、固定类别遮挡和情境建议。记录漏遮、过度遮挡、任务时间与结果是否仍有用。小样本结果只支持初步观察，不能声称已证明产品效果。
- **Business:** 在免费基础工具已存在的前提下，阐明学生为何愿意多做一步情境选择，再讨论免费体验、付费功能或机构合作等假设；这些不是已验证的商业模式。
- **Ethics:** 明确解释误检/漏检、第三方隐私、用户过度依赖，以及“客服”身份需要用户核实；导出前由用户检查。
- **Timeline:** 按实际截止日期安排原型、试用、整理结果、个人两分钟讲稿、三分钟视频与彩排。本次未提供确切日期，因此没有编造截止日期或组员分工。

The proposal's references and product claims were not independently verified as part of building this prototype. Verify bibliographic details and original sources before submission.
