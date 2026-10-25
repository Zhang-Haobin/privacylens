# Verification record

## Restore by clicking the same region — 26 October 2026

- Fixed the one-way canvas hit test: inactive suggested regions remain clickable, and manual regions retain their coordinates while disabled. Clicking the same region now toggles its mask in both directions with the existing wipe. Manual review rows offer Restore; only active masks count toward preview and export.
- Browser checks: clicked the sample name at the same coordinates twice, observing 6 → 5 → 6 masks and Keep → Hide. Drew a manual mask in an uncovered area, stopped drawing, then clicked the same coordinates twice: 7 → 6 → 7, with the Restore row appearing while inactive. The restoration animation rendered a partially covered name during its wipe.
- Added hit-test regression coverage for repeated toggling, manual restoration, overlap order, kept suggestions and blank/boundary points. All 36 tests passed, along with JavaScript syntax and diff checks. Changes remain local; no deployment performed.

## Visible wipe correction — 26 October 2026

- Compared production JS/CSS against local SHA-256 hashes: Vercel was already serving commit `26152d2`. Deployment lag was ruled out. The user reported that masks changed without a visible wipe; the precise cause in their browser was not established.
- Replaced the Web Animations transform with a 600 ms requestAnimationFrame clip-path wipe. Added an Animation on/off control so a reduced-motion default is visible and can be explicitly overridden.
- Added five scheduler-controlled tests for intermediate frames in both directions, rapid reversal, immediate animation-off completion, and stale-frame cancellation when changing images. All 32 tests passed, along with syntax and diff checks.
- Browser checks captured an actual partially retracted name mask and consecutive covering/removal frames; the field switch and count reached the correct final selection. Recording: local `qa/mask-wipe-fixed.gif`. The correction is local and has not been pushed/deployed.

## Mask wipe animation — 26 October 2026

- Preview masks now use a separate, non-interactive DOM layer with a 380 ms eased horizontal scale: covering grows from the left, removal shrinks toward the left. Export still draws complete masks directly into a separate canvas from final state. New image loads clear pending animations; reduced-motion preferences apply changes immediately.
- Browser checks: sample masks aligned with the image; direct removal and field-switch changes updated the count; resetting restored the missing mask; rapid on/off/on left exactly six masks and six fully expanded layers. Original view hid the layer while retaining six selections. Export after removing the name showed the name and five solid masks.
- `npm test`: 27 existing tests passed. JavaScript syntax and `git diff --check` passed. Reduced-motion and physical touch-device behavior were not separately exercised. Local export screenshot: `qa/mask-wipe-export.png`. No production deployment performed.

## Click to remove masks — 26 October 2026

- Protected preview now removes the clicked mask, updates suggested-field switches and mask totals, and offers a pointer cursor and hover tooltip. Original preview and drawing mode do not remove masks.
- Local browser checks: clicking the sample name mask restored the name and changed its switch to Keep (6 to 5 masks); drawing a manual mask over the phone increased the count, then clicking removed only that manual mask while the phone stayed covered. Original preview clicks retained all masks. At 100% zoom, clicking the order mask changed its switch to Keep. Export preview showed that order number with the other five masks intact.
- `npm test`: all 27 existing tests passed; `node --check dist/app.js` passed. No live OCR or provider call was needed for this interaction change. Touch input was not separately tested on a physical device.
- Export preview screenshot: local `qa/click-remove-export.png`. Changes verified locally; no production deployment performed.

## Local OCR + AI text classification — 25 October 2026

- Implemented local OCR, optional ID-based AI text classification, same-origin vendored English / Traditional Chinese / Simplified Chinese models, cancellation, original-size zoom and field-location highlighting. The webpage no longer sends images to AI.
- `npm test`: all 27 tests passed. JavaScript syntax and `git diff --check` passed.
- Eight live text-classification calls passed strict ID validation. Targeted checks covered Amazon phone suffixes, three SF tracking-number occurrences, PayPal transaction ID, DHL postal code and FedEx email. QR/barcodes still need manual masks.
- Browser checks verified OCR cancellation/retry, generated masks, hand-drawn mask retention, context changes, backend failure retaining masks, export confirmation and protected export from Original view.
- Detailed methods, measurements and images are retained locally in `qa/ocr-integration/`, outside the published source. This entry records local pre-deployment verification; older records below describe earlier versions.

## Detection output format fix — 25 October 2026

- Added a strict Chat Completions JSON schema for category/box output. The fixed model, disabled reasoning and 2048 completion-token cap are unchanged; there is no automatic retry or model fallback.
- Compatible-response parsing accepts one complete JSON object wrapped in Markdown or explanatory text, including split text content parts. It rejects malformed, truncated or competing objects without attempting to repair or partially apply them. All coordinate validation remains in place.
- Model refusal and output-limit responses now have distinct messages. Provider output is not echoed to the user or logged.
- `npm test`: all 14 tests passed, including wrapper parsing, text content parts, partial/ambiguous JSON rejection, no automatic retries, refusal/output-limit handling and the fixed-model restriction.
- One live call through the local server to novacode with the built-in fictional order accepted the new schema and returned seven valid regions (the address appeared as two regions). No user-uploaded screenshot was used. This validates one service response, not the unknown response that triggered the user's original error or general detection accuracy.

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
