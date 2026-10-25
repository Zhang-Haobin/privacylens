# Verification record

## Visual refresh — 25 October 2026

- Removed the rotated privacy notice; it now aligns horizontally on desktop and appears as a full-width card on mobile.
- Refined typography, contrast, spacing, card borders, buttons and switches. Desktop preview aligns the screenshot at the top; responsive layouts use three columns, two columns and a single column at narrower widths.
- Local browser visual checks: desktop at approximately 1500 CSS pixels and the in-app mobile viewport at approximately 355 CSS pixels. Both displayed the upright privacy card and readable controls without visible overlap.
- Mobile interaction check: changing to support retained the order number and masked the other five sample fields. Export from Original view still opened the protected image with five masks; the download button remained disabled until review confirmation.
- `git diff --check` passed. No JavaScript, AI request parameters or backend model restrictions were changed in this refresh.

## Production deployment — 25 October 2026

- Pushed implementation commit `f9bc4be` to `Zhang-Haobin/privacylens` on `main`; Vercel's Git integration deployed it to `https://privacylens-seven.vercel.app/`.
- Configured `OPENAI_API_KEY` as a Vercel Production Secret and `OPENAI_BASE_URL` as a Production Config, then redeployed to apply them. The local `.env` is ignored; the configured key was checked absent from the staged implementation before pushing.
- Production HTTP checks: requests without transfer consent returned 400; requests selecting another model returned 400 with the fixed-model restriction. Both checks stopped before calling the model.
- Production browser check: no model selector, model-ID input or model-list button. Manual sample recommendations rendered normally.
- One live detection on the built-in fictional order completed successfully through novacode using the fixed `gpt-6-luna` request, including the output cap and disabled reasoning. The UI received six suggestions: order number, personal name, phone, address, email and payment details. This verifies the deployed integration and response rendering for that sample; it does not establish localization accuracy on arbitrary images.

## Optional AI integration — 25 October 2026

- Fixed-model update: 10 tests passed, including rejection of other model IDs before provider access, ignoring legacy `OPENAI_MODEL` overrides, and returning 404 for the removed model-list action. The UI has no model selector, model-ID input or model-list button. Earlier entries below describe previous versions.

- Economy-default update: `npm test` now passes 9 tests. The additional check verifies fallback to `gpt-6-luna`, `reasoning_effort: none`, a 2048-token completion cap and category/box-only results. The browser preselects this model before fetching a list. Real provider support for the cost-control parameters remains unverified.
- `npm test`: 8 tests passed using mocked provider responses, covering model listing, bearer-key forwarding, Chat Completions image payloads, configured model fallback, missing key/consent/model, invalid image/dimensions, oversized requests, wrong methods, cross-origin submissions, invalid/out-of-range boxes, truncated/invalid completions, provider authentication/quota failures and timeouts. No live provider requests were made by these tests.
- `node --check dist/app.js` and `git diff --check`: passed.
- Local Node server HTTP check: model-list endpoint returned HTTP 503 with an actionable `OPENAI_API_KEY` configuration message and `Cache-Control: no-store` when no key was set.
- Browser check: AI detection initially disabled without the transfer checkbox; loading models without a key showed the server configuration message.
- Browser check: support context retained the sample order number and covered the five other fields. After an explicitly initiated detection failed for missing key, those existing masks remained and the detection button recovered.
- Browser check: export dialog still opened with five solid masks and order number retained, with download disabled until the review checkbox is selected.

Not yet verified: live novacode `/models` or image calls, availability of any particular model, provider-specific compatibility, model localization accuracy, a successful AI-result browser flow, image-switch race behavior in a browser, Vercel deployment, or responsive layout regression. A real server key and an image-capable provider model are needed for end-to-end service verification. Earlier layout/export checks below describe the previous version.

## Original manual prototype

Verified 19 October 2026 against the local browser preview.

- JavaScript syntax: `node --check dist/app.js` passed.
- HTTP preview returned 200.
- Public scenario: all six sample switches selected; exported PNG inspected with Pillow. Every pixel in all six specified redaction rectangles was opaque RGBA `(32, 43, 36, 255)`.
- Support scenario: order number remained visible; the other five rectangles were fully opaque in the downloaded PNG.
- Export from Original view: public output still contained all six solid masks.
- Export confirmation: download button initially disabled; enabled only after review checkbox selected.
- Downloaded sample image dimensions: 760 × 1030; no PNG metadata keys detected in the public export.
- Field override via keyboard: name became visible; explanation changed to identify the user's choice.
- Imported synthetic 1000 × 700 PNG: zero automatic/sample masks and explicit manual-only notice.
- Pointer drag on imported PNG: one manual mask added. It survived a context change, appeared in downloaded PNG, and Undo returned the count to zero.
- Uploaded-image PNG export inspected separately: original dimensions retained; its pixels consisted only of the original background and an opaque mask color.
- Mobile viewport 390 × 844: stacked editor, no horizontal document overflow.
- Desktop viewport 1440 × 1050: three-column editor; full-page screenshot visually inspected.
- Browser console: no errors or warnings during tested interactions.

Not evaluated: actual OCR/detection (not implemented), real-world detection accuracy, accessibility with a screen reader, and participant study outcomes. These checks establish prototype behavior, not privacy effectiveness across arbitrary images.
