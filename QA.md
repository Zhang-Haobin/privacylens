## Intro, Upload and Workspace navigation — 28 October 2026

- Added a buildless Intro using HTML/CSS and a small JS module, with no new dependencies or media downloads. The fictional demo uses the existing `recommendField` delivery policy; Public and Friends conceal the same personal fields, while an official-support order lookup can reveal only the order number. The text reminds users to verify the channel and review the result. The demo does not perform recognition or make API requests.
- Browser-checked Get started, Skip intro, View the introduction, browser Back, returning-visit Upload entry and in-memory Resume. A real local OCR pass on the fictional delivery sample completed and opened the existing sharing dialog. Changing full-name visibility and moving the order mask with Shift + ArrowRight survived Workspace → Upload → Intro → Resume; the adjustment layer geometry was identical. The existing flattened PNG preview opened and retained its review-before-download gate. No live AI calls were made in this check.
- Visually inspected desktop (1440 × 1000) and phone (390 × 844) Intro layouts. Intro and Upload had no horizontal document overflow at 320 px; the Intro also had none at 390 px. Browser console reported no warnings/errors during tested interactions. Local screenshots: `qa/intro/intro-desktop.png` and `qa/intro/intro-mobile.png` (ignored).
- `npm test`: 93 passed, including new tests for explicit entry links, optional/denied intro storage, conservative demo outcomes, animation cleanup and reduced-motion changes. `node --check` passed for app, intro and server; `git diff --check` passed. Reduced motion was tested in the lifecycle unit test and supported in CSS; OS-level reduced-motion emulation and screen-reader usability were not manually tested.
- Existing image/mask state remains in memory only. Only the intro-seen flag is persisted; reload still clears editing progress. This update has not been deployed or tested on Vercel.

## Contextual delivery trial — 28 October 2026

- Kept the existing on-device OCR and optional AI flow. Added conservative local suggestions for names and address lines near explicit delivery labels, with boundaries to limit expansion into unrelated content.
- On the same ten independently annotated fictional images, local-only fully covered fields increased from 30 to 51 of 67; partial fell from 8 to 7, and entirely missed fell from 29 to 9. Three of 25 annotated public controls remained overmasked. OCR was unchanged. Five pre-generated holdout images contained 12 sensitive fields: complete coverage rose from 0/12 to 12/12 and 0/8 public controls were overmasked; this is a small synthetic sample, not a general accuracy estimate.
- An actual Amazon browser export fully covered name and address as well as order and phone; payment suffix was still missed. The source SHA-256 was unchanged. An additional local browser rescan retained seven suggestions and read the same 94 words; preservation of adjusted geometry is covered by the reconciliation test and the earlier browser test below. AI was not re-tested for this trial.
- `npm test`: 89 passed. Details, evaluation limitations, remaining failure patterns and reproduction commands are in `accuracy-lab/context-trial/REPORT.md`.

## Independent privacy evaluation — 28 October 2026

- Manually annotated nine existing fictional source screenshots, plus a generated long mixed-language stress image. The 67-field ground truth is independent of Tesseract. Public controls and reproducible scripts are in `accuracy-lab/ground-truth/`; source images, OCR output and PNG results stay in ignored local subdirectories.
- The current local public-sharing pipeline detected OCR regions for 64/67 fields, correctly classified 32/67 fields, fully covered 30, partially covered 8 and missed 29. Three of 25 marked public controls were overmasked. See `accuracy-lab/ground-truth/REPORT.md` for precise definitions, conditional word-level classification precision/recall and dataset limitations.
- One live AI run on all ten fictional OCR inputs succeeded 10/10. With local and AI suggestions combined, 58/67 fields were correctly classified, 55 completely covered, 9 partly covered and 3 missed; 4/25 public controls were overmasked. These aggregate PNGs were rendered offline, and the provider received OCR text/layout only.
- Downloaded a current browser-generated PNG for Amazon: order and phone were fully covered; name, address and payment suffix were entirely missed. The source file's SHA-256 was unchanged. After source-profile conversion to sRGB, unmasked pixels differed by at most one channel level; the browser and offline masks for this sample matched exactly. Another actual browser PNG after real AI reanalysis fully covered the adjusted order box and five preset boxes.
- Browser verified adjusted-box preservation through OCR rescan, real AI reanalysis, sharing context, document type, zoom and pan; loading another image cleared the previous masks. Undoing an added manual mask left an adjusted box intact. Adjustment undo/redo is not implemented, so it cannot be verified.
- Fixed a regression where a repeated tracking number split into OCR words could be missed, and retained unmatched user-edited geometry for review even when its previous field was visible. Tests cover both. This is not a new OCR engine or backend.

## OCR placement and editable masks — 28 October 2026

- Created `accuracy-lab/` inside this project. Nine fictional images are copied to ignored `fixtures/`; OCR outputs and browser screenshots stay in ignored `results/`. The reproducible runner makes no provider or network calls.
- Diagnosed line-wide masks on order/tracking/reference/payment labels, UPS punctuation artifacts, split Traditional Chinese order labels, and academic false positives on shipping dates/postcodes. Local value-span parsing and academic context checks address these cases.
- First six annotated English images: 8/15 targeted checks before and 15/15 after. Expanded final set: 21/21 checks across eight English shipping/payment images and one Chinese text image. Each check compares selected mask area with the OCR word box (≥95% required coverage for value words, ≤5% for excluded neighbors); this is not image-ink ground truth or a recall estimate.
- Detected and manual masks can be moved or resized in original-image pixels. Matched rescans retain user-edited geometry; preview and export use the same rectangles. Browser: dragged an order box corner, observed width/height change, rescanned, and observed the same dimensions; export dialog retained seven active masks. Phone-sized view exposed the edit and Finish adjusting controls. The fictional academic transcript still produced 12 review fields including courses, university and GPA.
- `npm test`: 80 passed. The tests cover split labels, side-by-side tracking text, duplicated punctuation, shipping/academic disambiguation, original-image bounds and edited-box reconciliation. AI provider accuracy and arbitrary uploaded images were not evaluated in this pass.

## Guided flow and two-pane workspace — 27 October 2026

- Replaced the default three-column view with a landing upload/drop page, an after-reading sharing dialog, and a two-pane image/review workspace. Initial image entry invokes local reading automatically. Existing detection, policy, override and export engines are retained.
- Recipient/task presets are declared in `dist/workflow.js`. Employer and Official support ask a purpose; unselected or Custom contexts do not invent an audience. Type correction and full audience/purpose controls remain available under secondary disclosures. Recipient notes, language, rescan, reset and motion moved to More options. Optional AI has its own consent dialog and is never called by the automatic local path.
- Default real-image recognition resolves to English + Traditional + Simplified Chinese; this is a model combination, not a claimed language-detection accuracy score. Fictional English examples use English under the default setting. Existing English/Traditional Chinese mode also completed a real scan in the browser.
- Browser: initial landing exposed upload and examples without document/audience/language controls. Selecting the transcript example automatically showed local reading and disabled export. Completion opened Suggested: Academic transcript with sharing choices. Employer required a purpose before Continue was enabled. Review entered the two-pane workspace with all per-field reasons initially collapsed.
- Browser: cancelled initial reading still opened context and allowed manual review. More options re-read completed with 48 words, 12 local fields and zero unmatched earlier regions; the public academic view kept four masks. Merged label/value GPA tokens were canonicalized after observing an actual OCR variation, with a regression test for choice preservation.
- Browser: at 390×844, the collapsed review panel was 135px high and anchored at the bottom (bottom=844); expanded height was 692px and remained bottom anchored. Field selection collapsed the panel, highlighted the region and selected 100%. Fit returned to the full image. The AI consent notice was visible on demand and Analyze stayed disabled without consent.
- Browser: added a manual mask, went home, resumed, switched sharing context, and observed the same added mask retained (five masks including one manual). Undo last mask returned the count to four. The final export dialog still included academic context, four masks and two default-masked review fields for University submission; download stayed disabled before final confirmation.
- Automated checks: 65 tests passed, including the existing regression suite and new preset validity, purpose follow-up, conservative policy mapping, recognition-language resolution and merged-token GPA reconciliation tests. Split delivery heading/identifier columns are also linked so an order lookup can keep its number after automatic reading. JavaScript syntax, unique/matching element IDs and whitespace checks passed. No new framework or production build step was introduced.
- Final fresh-entry check: type correction and fine-tuning disclosures were closed, and Continue was disabled before a sharing choice. Delivery auto-reading linked the split order heading and number; Official support required a purpose and lookup kept the order visible. Unmatched earlier name/address/payment regions remained explicitly reviewable.
- Screenshots: `qa/guided-landing.png`, `qa/guided-context.png`, `qa/guided-workspace.png`, `qa/guided-mobile.png`, `qa/guided-mobile-review.png`. Browser console had no warnings or errors in the final flow.
- Local preview remains at localhost:4173. Production deployment was not performed. No new provider call or native file download was needed for this UI change; the prior PNG pixel verification remains in the entries below. Automatic real-upload scanning uses the same tested start routine as examples after existing file decoding/validation; a new native file-picker run was not repeated in this pass.

## Context-aware document upgrade — 27 October 2026

Implemented scope: delivery/order, academic transcript, chat conversation and General fallback. The older entries below describe prior behavior.

- Added deterministic local keyword-group classification with manual correction, a manual-choice lock, and an explicit return to the local suggestion. Unknown/unsupported or tied types fall back to General; there is no claimed classification probability.
- Added type-specific recipient/purpose registries, local-only custom purpose and recipient notes, and explicit Redact / Keep / Review recommendations. Review defaults to masked; user overrides are separate and persist across context changes.
- Added shared browser/server field categories for student ID, birth date, academic content, private messages and credentials. Local token spans keep identifiers separate from GPA; nearby same-baseline label/value columns are linked conservatively.
- Added same-image reconciliation using exact normalized text, category and unique strong geometric overlap/containment. Reliable matches inherit choices and retain the union of covered pixels; unmatched covered regions or explicit choices remain flagged for review. Numbered field IDs alone never determine a match.
- Three fictional canvas examples are available. New example text regions use canvas font measurements and padding. Pre-labelled examples are explicitly distinguished from actual recognition.
- Browser: transcript showcase displayed 12 fields with 4 masks and useful academic content visible. Non-public job application marked the name Review; organization submission additionally marked the student ID Review. Both stayed masked by default. A user-revealed ID survived a switch back to public showcase with a visible user-choice notice. Use suggestion restored the mask.
- Browser: manual General correction survived actual OCR on the transcript; Use local suggestion then selected Transcript and replaced the purpose options. Custom purpose masked academic content for review and retained its local description.
- Actual English transcript OCR: 50 words, 12 local field suggestions, zero unmatched previous regions on the final example. An earlier repeat-scan check retained a user-selected GPA mask and restored its override. Split label/value handling was added after inspecting real OCR results and has regression coverage.
- Actual AI classification on the fictional transcript succeeded through the configured provider: 12 OCR-positioned fields, zero unmatched previous regions. This is one functional integration check, not an accuracy benchmark. No real user document was sent.
- Final chat OCR read 52 words and found three local fields; the pre-labelled private message remained as one unmatched protected region, for four fields total and one default-masked Review. Browser: chat classification used chat heading/status/timestamp signals and replaced delivery purposes with conversation/reporting purposes. Credentials remained recommended Hide and private messages required review. Non-text details still require manual masks.
- Browser export: showcase used 4 masks; custom used 12, with 8 unconfirmed Review fields still masked. The downloaded custom PNG was copied into `qa/transcript-custom.png` and inspected: all 12 declared rectangles were fully opaque RGBA (32,43,36,255), dimensions were 760×1030, and PNG metadata was empty. Showcase download path could not be read from the OS Downloads folder, so exact pixel inspection is claimed only for the custom file; the showcase preview and selection count were checked in the browser.
- Browser: importing that fictional exported image cleared fields, added masks, overrides, recipient/purpose, custom notes, manual type and AI consent. It started as General with no audience selected and no assumed purpose.
- Provider credentials stay server-side; context classification/policy and custom notes stay local. AI only receives consented OCR text/layout. Local preprocessing is not claimed to anonymize that text.
- Final responsive checks at 390×844, 768×1024, 1024×768 and 1440×600 showed no horizontal document overflow. Review fields appear before Hide fields and useful Keep fields; this display sorting does not change mask identity.
- Automated verification: 59 tests passed, including existing regressions and new classification/fallback, purpose isolation, contextual policy, default Review, credentials, override/reconciliation and local span cases. No framework/build migration; Vercel remains buildless with the existing API route. Production deployment was not performed.

## Editor layout and context undo — 27 October 2026

- Moved sharing context before local recognition; collapsed context rationale, scanning explanations and optional AI controls. The transfer notice stays beside AI consent inside the expanded controls.
- Desktop preview and review panels follow document scrolling. Results alone scroll internally, with export outside that region. Tablet and phone layouts return to normal flow as appropriate.
- Added dimension-based Fit, continuous zoom, explicit 100%, selected-result highlighting and Suggested / Your choice labels.
- All 46 Node tests passed. New coverage checks portrait/landscape/long-image fitting, unmeasured stages and changes in mask visibility. JavaScript syntax and whitespace checks passed.
- Browser exercised all 16 audience/purpose combinations. Undo restored a user-overridden full-name switch and the previous audience. A manually drawn mask survived context change and undo (mask counts 6 → 7 → 6).
- Browser checked 390×844, 768×1024, 1024×768, 1440×600 and 1440×1000 layouts; no horizontal document overflow. At the 600px desktop height, the export button stayed inside the viewport after locating a field.
- At Fit, 100%, 125% and back to 100%, the phone mask's DOM position and dimensions matched its image coordinates to within 0.01 CSS pixels. Selected field card and image highlight were visible together on desktop.
- Local OCR completed on the fictional sample: 84 words and three local suggestions. Optional AI controls showed the transfer notice, required consent to enable classification, and made no provider call. Browser console contained no warnings/errors during the checked flow.
- Downloaded a 760×1030 PNG with no metadata. Pixel inspection confirmed all five support-private rectangles were fully opaque, the order number stayed visible, and the extra manual rectangle occupied (126,510)–(564,570). Copy saved to `qa/editor-redesign-export.png`.
- Source changes remain local. Live AI accuracy and production deployment were not evaluated in this pass.

## Audience and purpose selection — 27 October 2026

- Replaced the two delivery-specific choices with four audiences and four independent purposes. Default: public audience + advice. Only official support + order/delivery lookup retains suggested order/tracking numbers.
- `npm test`: all 43 tests passed, including all 16 policy combinations, unknown/missing choices, sample/OCR consistency and explanation/summary agreement. JavaScript syntax and `git diff --check` passed.
- Local browser: exercised all 16 audience/purpose combinations on the fictional sample. Official support + lookup showed five masks and a visible order number; every other combination showed six masks. Exactly one audience stayed selected.
- Export review showed the selected audience and purpose, five masks, and the order number as visible for official support + lookup. The image renderer itself is unchanged.
- Responsive browser checks at 390 × 844 and 1440 × 1000: no horizontal document overflow. Phone screenshot saved locally at `qa/sharing-context-mobile.png`.
- Optional AI prompt now describes chats, bookings, study and work materials using the existing category schema. No live AI call was made; accuracy on these screenshot types remains unverified. Private message content and internal information still require manual review.
- Changes are local; no production deployment was performed.

# Verification record

## Click recognized text lines to mask — 26 October 2026

- Every OCR line is now a click target with locally derived, padded original-image bounds. Hovering outlines a line; clicking visible text creates a full-line mask, and clicking its mask reveals it. The expandable Recognized text list provides the same toggle with keyboard-accessible buttons. These custom masks use the existing preview animation/export pipeline and survive optional AI classification.
- Actual local OCR on the fictional sample produced 84 words / 31 lines. Toggling “Delayed in transit” in the list changed the count 9 → 10 → 9. Clicking that text directly restored the same mask. Clicking the previously unsuggested product-name line added Text line 14 and synchronized the list's pressed state; clicking it again removed/restored the same mask without duplicates. Export showed the product-name mask and retained the separate price column. No AI request was needed. Local proof: `qa/ocr-click-line-export.png`.
- Added regression checks for multi-word coverage, padding, image boundaries, separated columns, stable line identities, empty OCR and existing-mask priority. All 39 tests passed, with syntax and diff checks. This entry records local verification; no deployment performed.

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

### Adaptive image workspace and review (October 2026)

- The desktop editor calculates a centered workspace width from the image proportions and available height; the review panel defaults to 380 px and can be adjusted in More options → Advanced settings. Long images initially fit to width; Fit shows the whole image. Narrow screens use the collapsible review sheet.
- On the fictional transcript, switching to public academic sharing left the eight suggested visible regions masked until they were explicitly reviewed and confirmed. Existing manual choices and other masks stayed in place. A test AI request using this fictional image classified existing regions, and its insight links located the corresponding review item.
- Automated checks cover portrait, square, landscape and long-image layout calculations, safe context updates, rescan mask preservation, and unambiguous AI insight attribution. Local OCR, AI, overlays and export still require users to check the entire image; overlapping masks can cover a field set to visible.

### Workspace, context and OCR ID handling — 27 October 2026

- At a 1440 × 900 desktop viewport, the fictional order workspace measured 1122 px with a 380 px review panel. Inspect enlarged the image to 90%; Pan moved the preview without changing the nine active masks. Mobile context keeps its close button and actions visible while the body scrolls.
- The same active-mask selection feeds preview layers, count summaries and flattened export. In the fictional order, changing one of nine detected details to visible produced eight hidden fields and eight export masks, with the export confirmation explaining possible overlaps.
- The order classifier now requires independent retail signals and recognizes singular “Order Detail”, order date, shipping address and order total. Optional AI classifications may offer a type suggestion only when two independent classified word groups support it; the user must apply it.
- AI responses may reuse a valid OCR ID across different classifications; duplicate IDs within a field are deduplicated. An unknown ID triggers one complete provider retry with the same consented OCR text; a second invalid result fails atomically and preserves prior masks. Malformed responses do not retry. A real call on the fictional delivery sample completed successfully; mocked tests verify overlapping IDs, invalid-ID retry and atomic failure. These checks do not reproduce the user's specific screenshot or prove detection completeness.
