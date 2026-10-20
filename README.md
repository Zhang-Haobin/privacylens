# PrivacyLens — CCST9003 interactive prototype

A browser-only demonstration of **recipient- and purpose-dependent disclosure decisions** for order screenshots.

## Run

From this directory, run `python3 -m http.server 4173 --directory dist` and open `http://localhost:4173`.

No package installation, API key, build step, or external asset request is needed. You can also open `dist/index.html` through a local server as above. Source: `dist/index.html`, `dist/styles.css`, `dist/app.js`.

## Deploy with GitHub and Vercel

Push this directory (the one containing `vercel.json`) to a GitHub repository, then import that repository in Vercel. Use the repository root as **Root Directory** and **Other** as the framework preset. `vercel.json` disables installation/build commands and publishes `dist` directly. No environment variables are required.

Vercel's GitHub integration deploys changes pushed to `main` to production and creates preview deployments for pull requests. Commit the files inside `dist`: they are the source for this buildless project. Keep `.vercel`, local environment files and credentials out of Git.

## What works

- Fictional order screenshot generated in the browser; six pre-labelled personal fields.
- Public delivery-delay post: all six sample fields are masked.
- Initial delivery enquiry to verified official support: order number retained, five other sample fields masked.
- Explanations for each recommendation and user overrides.
- Original/protected views; context changes reapply sample recommendations and retain manual masks.
- User-supplied PNG/JPEG/WebP images, opened locally in memory, with **manual editing only**.
- Draw solid masks, remove individual manual masks, undo last mask, reset.
- Review dialog with the exact output preview, mandatory confirmation, then flattened PNG download.
- Responsive layout, keyboard accessible field switches and dialogs.

## Deliberate limitations

**No OCR, AI model, real automatic detection, measured accuracy, or privacy guarantee is implemented.** The demo uses known sample rectangles. Uploaded images do not receive those sample rectangles. Manual editing requires pointer/touch interaction. No image data is uploaded or persisted by the app, and no analytics or remote font scripts are used. The hosted page itself still uses its hosting platform's ordinary access infrastructure.

The two scenarios are intentionally paired with their purposes. “Official support” means an **initial delivery-status lookup**, not payment verification, address changes, or an arbitrary recipient claiming to be support. Recommendations are reset when context changes; field explanations identify overrides.

## 60–90 second classroom demo

1. Start with the fictional order and “A public audience”. Show that delivery status remains visible while all six personal fields are covered.
2. Select “Official customer support”. Point out that the order number becomes visible because it helps locate this order. Other personal fields remain covered.
3. Read the order-number explanation, then override it using its switch. This demonstrates user control.
4. Select “Add a mask”, draw over a region and undo/remove it.
5. Select “Review & export”, review the full image, tick the confirmation and download the PNG.
6. Optionally import a fictional screenshot of your own; explicitly state that this version requires manual masks on imported images.

## Proposal notes / 提案完善建议

目前 Part 1 已有较清晰的问题、目标用户、竞品和可实现范围。Part 2 与 Part 3 仍需补齐。

- **Project outcome:** 用网页原型演示选择分享对象与目的 → 建议遮挡及原因 → 用户调整 → 导出副本。不要把预设示例写成真实 OCR 或 AI 能力。
- **Technical:** 当前版本是前端 Canvas + 明确的情境规则 + 示例字段坐标。下一阶段接入真实 OCR、字段检测与框坐标映射，再评估漏检和误检。
- **Division of labour:** 根据真实组员人数分配背景研究、技术/演示、商业、伦理和整合；姓名与负责人应由小组确认。
- **Evaluation:** 在相同的虚构截图、相同分享任务下，对比手动遮挡、固定类别遮挡和情境建议。记录漏遮、过度遮挡、任务时间与结果是否仍有用。小样本结果只支持初步观察，不能声称已证明产品效果。
- **Business:** 在免费基础工具已存在的前提下，阐明学生为何愿意多做一步情境选择，再讨论免费体验、付费功能或机构合作等假设；这些不是已验证的商业模式。
- **Ethics:** 明确解释误检/漏检、第三方隐私、用户过度依赖，以及“客服”身份需要用户核实；导出前由用户检查。
- **Timeline:** 按实际截止日期安排原型、试用、整理结果、个人两分钟讲稿、三分钟视频与彩排。本次未提供确切日期，因此没有编造截止日期或组员分工。

The proposal's references and product claims were not independently verified as part of building this prototype. Verify bibliographic details and original sources before submission.
