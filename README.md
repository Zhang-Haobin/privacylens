# PrivacyLens — CCST9003 prototype

A screenshot editor with correctable local document classification, document-specific sharing purposes, optional AI field classification, independent user choices and flattened PNG export.

## Run

Requires Node.js 22.9+.

```sh
cp .env.example .env
npm run dev
```

Open http://localhost:4173. The checked-in `dist/vendor/ocr` contains the OCR runtime and English, Traditional Chinese and Simplified Chinese models; no installation or build is needed to run this checkout. OCR, manual editing and export work without an API key.

To reproduce the self-hosted OCR assets after changing dependency versions:

```sh
npm ci --ignore-scripts
npm run prepare:ocr
```

Dev dependencies are version-locked. Keep generated vendor assets and their licenses in Git: static/Vercel deployments publish `dist` without running an install or build command.

## Detection workflow

1. The landing page shows an upload/drop area and three fictional examples. Choose a PNG/JPEG/WebP (up to 20 MB / 20 megapixels) or a delivery, transcript or chat example. Entering an image automatically starts on-device text recognition; no remote AI call is made. Real uploads start as General with no recipient or purpose assumed. Examples retain their clearly disclosed pre-labelled regions, but no sharing audience is selected for the user.
2. After reading, a sharing dialog shows the suggested type and a small set of recipient/task choices. Public, Friends and University choices state their task directly. Employer and Official support ask a follow-up purpose instead of silently assuming job application or order lookup. Custom opens fine-tuning controls. Type correction is behind **Change type** and locks the manual choice until **Use local suggestion** or image replacement. **Skip for now** keeps conservative defaults and allows manual editing. Once OCR finishes, hover over any recognized text line in **Protected** view to see its bounds, then click it to mask the whole line. Click its mask again to reveal it. The expandable **Recognized text** list also supports clicking each line to toggle a full-line mask. This works without AI classification or drawing a rectangle. OCR runs in a Web Worker on the user's device. The worker, WASM and language files are served by this site; language assets may be cached in the browser. The app does not persist recognized text or images.
3. Local rules identify some contacts, labelled names/IDs/birth dates, credentials and academic fields. They select token spans, including nearby label/value columns on the same baseline. Unlabelled names, private messages, addresses and visual details may still need AI or manual review.
4. Open **AI Privacy Assistant** at the top of Privacy Review to see the transfer notice. To classify text, explicitly select the transfer checkbox and click **Analyze text with AI**. Recognized text and normalized word layout travel through the app server to the configured provider. **The current editor workflow does not send the image. Sending OCR text still discloses the personal information in that text.**
5. AI returns only categories, roles and existing word IDs. Server and browser reject unknown IDs and invalid output as a whole; a valid OCR word can appear in more than one category. When the provider invents an ID, the server may send the same text once more to request a complete corrected result, as disclosed in the consent notice. Actual mask positions come from local OCR. Local candidates are retained even if AI omits them; overlapping suggestions of the same category are combined. Different overlapping regions can still require separate switches. AI returns no Hide/Keep action: local policy decides the recommendation.
6. Review the complete image. In **Protected** view, click/tap a mask to reveal that detail, then click the same area again to restore its mask. Both suggested and hand-drawn regions remain clickable while visible. Suggested field switches stay in sync; manual rows also offer **Restore**. At overlaps, visible masks are removed one at a time in paint order before an inactive region can be restored. Click a field label to locate its mask, use **Fit**, **Inspect**, **Pan**, **− / +** or **100%**, and add hand-drawn masks for misses. While **Add a mask** is active, drag to draw; click it again or press Escape to return to toggling masks. Undo permanently removes the last hand-drawn region; reset and changing images clear manual regions. **QR codes, barcodes and faces are not automatically detected by OCR.**
7. **Review & download** opens the exact protected PNG. Confirm review before downloading. The original resolution is retained; preview highlights are not included in the export.

Mask changes use a 600 ms frame-driven wipe in the preview: covering expands from left to right, and removing retracts from right to left. Rapid reversals continue from the current position. The **Animation on/off** toolbar button controls motion; reduced-motion preferences initially disable it, and users can explicitly enable it. Exports always use the final mask selection, even while a preview animation is running.

OCR uses two segmentation passes to recover some missed text, unions overlapping token bounds, expands adjacent words on address baselines, and maps coordinates back to the original image. Small images are upscaled, subject to a 2600px side / 6-megapixel processing cap. There is no auto-rotation or perspective correction. OCR can still miss whole lines, misread digits or produce incomplete boxes. Low-confidence words are not silently discarded.

Earlier masks remain during recognition, cancellation and failures. New successful OCR/AI fields are reconciled within the same image using exact normalized value text, category and strong overlap or bounded containment, with unique matching in both directions. Field numbering is not evidence of identity. Reliable matches retain the user override and the union of covered pixels. Unmatched earlier masks and explicit field choices stay as previous regions marked for review. Hand-drawn and OCR-line masks survive. Switching images clears all fields, choices, manual regions, type corrections, custom notes and AI consent. Cancel stops local work or aborts the client request; an already-sent request may still be processed. Export is disabled during recognition/classification.

## Context-aware suggestions

This iteration supports Delivery / order, Academic transcript, Chat conversation and General / other. The initial type detection is a deterministic local keyword-group suggestion, not a trained or calibrated classifier. It does not read filenames or contact AI. After optional consent-based AI classification, independent classified fields can suggest a more specific type; applying it always requires the user’s explicit choice. Sparse, unsupported or equally mixed signals fall back to General. Bank, flight, medical and employment types do not have specialized policies yet. The user can select any supported type manually; a later scan does not overwrite that correction.

`dist/document-context.js` declares types, relevant audiences and purposes. Transcript purposes are showcase, job/internship application, academic submission and custom. Chat purposes are public conversation sharing, advice, reporting and custom. Delivery retains update/advice/lookup and adds return/refund and custom. General purposes provide update/advice/organization submission and custom. A type change preserves compatible selections and clears incompatible ones; it does not invent a new recipient or purpose.

`dist/privacy-types.js` is the shared browser/server field contract. It includes the prior identifiers plus student ID, birth date, university, course, grade, GPA, private message and access credential. The optional AI uses these categories with existing word IDs. Document category, purpose, recipient details and custom text remain local and are not added to the AI request. Full OCR text/layout still go to the configured provider only after consent; this workflow does not anonymize that text or send images.

`dist/sharing-context.js` separates a recommendation (`redact`, `keep`, `review`) from `userOverride` (`redact`, `keep`, or null). Review defaults to masked. Academic purposes keep relevant academic content; names for non-public job/submission requests and student IDs for organization academic submissions need review. Public personal identifiers stay masked by default. Verified-channel delivery lookup can retain order/tracking numbers; a return request asks for review. Private chat messages need review; access credentials always recommend Hide, including custom contexts and retained regions. All choices can be overridden explicitly.

Custom purposes and optional recipient notes are bounded local inputs. All custom purposes currently use conservative generic rules; no semantic intent matching or remote purpose analysis is claimed. The export review includes these notes so users can assess the final audience and purpose.

Changing type, recipient or purpose recomputes recommendations while preserving user overrides and manual masks. A persistent notice lists actual visibility changes and reminds users to review kept choices. **Undo context change** restores the prior type/source, recipient, purpose and field overrides. **Use suggestion** clears one override; Reset explicitly clears overrides and manual masks. A change to public sharing can therefore retain a previously revealed field: its user-choice label and review notice remain visible. OCR/AI success or another field edit invalidates context undo.

## Guided interface

The landing page contains only upload/drop and examples. Once an image loads, local reading starts automatically with honest progress and a Cancel action. Completion or cancellation opens the sharing dialog. The main workspace has two panes: image preview and a compact Hidden / Visible review list. The header opens sharing context, type correction and More options; optional AI is integrated at the top of Privacy Review. Going home keeps the in-memory image and provides a Resume action; reloading the page still clears it.

Field reasons, recommended Hide / Keep / Review, and Use suggestion are behind the information button on each field. Unconfirmed Review fields remain masked and have a small Check marker. Mask editing, original/protected switching, Fit / 100% / zoom, overrides and flattened export retain their previous behavior. Review-before-download confirmation is still required. On phones, the review region is a collapsible bottom panel; its toggle and download action stay available. Selecting a field collapses it and locates that image region. Add a mask is directly available beside the mobile preview.

**More options** contains re-reading, recognition language, recipient notes, reset, motion and another example. The default real-image setting reads English, Traditional Chinese and Simplified Chinese together; it is not presented as a calibrated automatic language detector. Known English fictional examples use English when the default setting is selected. Explicit English / Chinese combinations remain selectable. Rescanning preserves same-image overrides and masks and does not force the sharing dialog to reopen. On-device reading can be cancelled or fail without blocking manual editing. Optional AI still requires consent for OCR text/layout before any provider request.

## API configuration

In local `.env` or Vercel environment variables:

```dotenv
OPENAI_API_KEY=your-real-server-key
OPENAI_BASE_URL=https://ai.novacode.top/v1
```

This default is a third-party provider, not an OpenAI-hosted endpoint. Only the backend reads the key. Never put credentials in `dist`, browser storage or Git. Restart/redeploy after configuration changes.

The model remains fixed to **gpt-6-luna**. There is no model selector or model fallback. An unknown OCR word ID triggers at most one full retry, with the same recognized text, after the user’s consent. Legacy `OPENAI_MODEL` environment variables are ignored; attempts to request another model are rejected before contacting the provider.

`POST /api/ai?action=classify-text` accepts explicit consent, original dimensions and bounded OCR lines/words. It rejects images, duplicate IDs, invalid boxes and excessive text. The upstream request uses Chat Completions with strict JSON schema, `reasoning_effort: none` and `max_completion_tokens: 2048`. Compatible Markdown-wrapped complete JSON is accepted; malformed, conflicting, refused or truncated output does not partially replace masks. Each provider call times out after 45 seconds; the browser permits up to 100 seconds for the complete request and its possible retry. The provider must support these parameters; actual cost/retention depend on the provider.

The earlier image endpoint `POST /api/ai?action=detect` remains for compatibility and existing tests. It requires its own explicit consent and sends an unmasked JPEG. **The current webpage does not call this endpoint.** The former model-list action remains disabled.

The API has same-origin browser checks and request limits, but no user authentication or distributed rate limiter. Configure platform access/rate controls as appropriate for a public deployment. Same-origin checks do not authenticate arbitrary clients.

## Deploy

Use this directory as the GitHub/Vercel repository root. `vercel.json` publishes `dist` and `api/ai.js`, with no install/build command and a 60-second function duration. Keep `lib`, `api`, `package.json`, the shared `dist/privacy-types.js` module and OCR assets in the deployment. The existing Git integration deploys pushes to `main` to Vercel production. The earlier Sites static-hosting manifest remains historical; that static-only host cannot run the Node API and is not updated by this deployment.

## Verification

```sh
npm test
node --check dist/app.js
node --check dist/ocr.js
```

Tests cover local type/fallback and purpose registries, contextual actions, override persistence/reconciliation, label/value column and academic spans, provider contracts/errors, fixed-model restriction, OCR coordinate mapping, repeated identifiers, merging local/AI candidates, support rules, text-ID validation, input limits and rejection of image transfer on the text endpoint. Tests with mocked model results do not establish detection accuracy.

See `QA.md` for the verification record. Detailed sample results remain in local `qa/ocr-integration/` and are excluded from the published source. Previous QA entries describe earlier versions. No general accuracy or privacy guarantee is claimed. English sample performance does not establish Chinese-language, mobile or real-world accuracy.
