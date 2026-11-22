# PrivacyLens — CCST9003 prototype

A screenshot editor with correctable local document classification, document-specific sharing purposes, optional AI field classification and purpose-based sharing suggestions, independent user choices and flattened PNG export.

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

The first visit opens a lightweight Intro with a clearly labelled fictional order demonstration. Its Public / Friends / Official support choices reuse the local delivery policy and never call AI. Get started and Skip intro are available immediately. Leaving the Intro records only `privacylens.intro-seen.v1=1` in local storage so subsequent visits open Upload; storage failure does not block access. `#intro` and `#upload` are direct entries. `#workspace` resumes only an image already in this tab's memory and falls back to Upload after reloading. Upload provides View the introduction and, when applicable, Return to your current image. Navigation preserves image edits in memory; a reload clears them. The short scanning animation runs once per page load, stops when leaving the Intro or choosing a demo context, and respects reduced motion.

1. The landing page shows an upload/drop area and four fictional examples. Choose a PNG/JPEG/WebP (up to 20 MB / 20 megapixels) or a delivery, transcript, chat or technical example. Entering an image automatically starts on-device text recognition; no remote AI call is made. Real uploads start as General with no recipient or purpose assumed. Examples retain their clearly disclosed pre-labelled regions, but no sharing audience is selected for the user.
2. **Sharing Settings** opens while OCR runs on the device in a Web Worker. Choose an audience or select **Custom** and enter a privacy instruction. **Review image** applies the selected local protection and waits if a scan is in progress. **Review manually** opens the editor immediately. **Retry reading** is available after a failed or empty scan. **Change type** locks a manual correction until **Use local suggestion** or image replacement. If a suggested type makes the selected option incompatible, choose an alternative or confirm conservative protection. The worker, WASM and language files come from this site. Recognized text, images and instruction drafts are held in memory.
3. Local rules identify some contacts, labelled names/IDs/birth dates, credentials and academic fields. They also recognize some sender and recipient names and address lines near explicit delivery labels, when nearby address evidence is present. They select token spans, including nearby label/value columns on the same baseline. Detection is incomplete: unlabelled names, addresses, payment identifiers, private messages and visual details may still need AI or manual review. Review every image before sharing.
4. Open **Find more private details** in Privacy Review. **What data will be sent?** contains the provider, screening and retry disclosures, the text preview and the exact request with word layout. Explicitly select the unchecked transfer checkbox and click **Analyze text with AI** to classify text. Before the request leaves the browser, locally detected credentials are replaced with typed placeholders in a separate OCR text copy. The site server screens the text again before forwarding it and the word layout to the configured provider. Other personal text and missed credentials may remain. The image, original OCR data, sharing purpose and recipient notes stay on the device during this detection request.
5. AI returns only categories, roles and existing word IDs. Server and browser reject unknown IDs and invalid output as a whole; a valid OCR word can appear in more than one category. When the provider invents an ID, the server may send the same screened text once more to request a complete corrected result, as disclosed in the consent notice. Actual mask positions come from local OCR. Local candidates are retained even if AI omits them; overlapping suggestions of the same category are combined. Different overlapping regions can still require separate switches. AI returns no Hide/Keep action: local policy decides the recommendation.
6. Review the complete image. Click a recognized line in the image or in **Recognized text** to cover the whole line. **Reapply suggested masks** opens a local confirmation to cover fields you chose to show that are recommended for hiding or review. In **Protected** view, click/tap a mask to reveal that detail, then click the same area again to restore its mask. Both suggested and hand-drawn regions remain clickable while visible. Suggested field switches stay in sync; manual rows also offer **Restore**. At overlaps, visible masks are removed one at a time in paint order before an inactive region can be restored. Click a field label to locate its mask, use **Fit**, **Inspect**, **Pan**, **− / +** or **100%**, and add hand-drawn masks for misses. While **Add a mask** is active, drag to draw; click it again or press Escape to return to toggling masks. Undo permanently removes the last hand-drawn region; reset and changing images clear manual regions. **QR codes, barcodes and faces are not automatically detected by OCR.**
   Use **Adjust box** beside a detected or added mask to move or resize its rectangle directly on the image. Drag a corner or the center; focused handles also accept arrow keys (Shift + arrow moves 10 pixels). Adjustments stay within the original image and persist through a matched same-image rescan. On phones, choosing Adjust box returns to the image and **Finish adjusting** ends the mode.
7. **Review & download** opens the exact protected PNG. Confirm review before downloading. The original resolution is retained; preview highlights are not included in the export.

Mask changes use a 600 ms frame-driven wipe in the preview: covering expands from left to right, and removing retracts from right to left. Rapid reversals continue from the current position. The **Animation on/off** toolbar button controls motion; reduced-motion preferences initially disable it, and users can explicitly enable it. Exports always use the final mask selection, even while a preview animation is running.

OCR uses two segmentation passes to recover some missed text, unions overlapping token bounds, expands adjacent words on address baselines, and maps coordinates back to the original image. Small images are upscaled, subject to a 2600px side / 6-megapixel processing cap. There is no auto-rotation or perspective correction. OCR can still miss whole lines, misread digits or produce incomplete boxes. Low-confidence words are not silently discarded.

The local rule engine now isolates identifier, phone and payment values when labels or unrelated words share a line. Academic course and university suggestions require academic context, reducing shipping-label false positives. See `accuracy-lab/` for the nine-image local test set and selected word-box checks; it does not measure overall detection accuracy.

New OCR and AI fields are reconciled within the same image using exact normalized value text, category and strong overlap or bounded containment with unique matching in both directions. Reliable matches retain user choices and preserve covered pixels or manually adjusted boxes. The review list includes unmatched regions with earlier masks or explicit choices. **Find more private details** covers newly found risk fields and flags AI findings that conflict with a choice to show a field. **Reapply suggested masks** restores suggested coverage after explicit confirmation, using the same added masks and edited geometry. Switching images clears the previous image session. Cancel stops local work or aborts the browser request. An already-sent request may still be processed. Export uses a single snapshot of the image, masks and confirmation details.

## Context-aware suggestions

This iteration supports Delivery / order, Academic transcript, Chat conversation, Technical screenshot and General / other. The initial type detection is a deterministic local keyword-group suggestion, not a trained or calibrated classifier. It does not read filenames or contact AI. After optional consent-based AI classification, independent classified fields can suggest a more specific type; applying it always requires the user’s explicit choice. Sparse, unsupported or equally mixed signals fall back to General. Bank, flight, medical and employment types do not have specialized policies yet. The user can select any supported type manually; a later scan does not overwrite that correction.

`dist/document-context.js` declares document types and their compatible audiences. Sharing Settings offers four audience choices and Custom. Built-in defaults select local policies for standard audiences. A type change preserves the selection and instruction draft. Choosing Official support for a delivery uses conservative protection until the user reviews details such as the order number.

`dist/privacy-types.js` is the shared browser/server field contract. It includes the prior identifiers plus student ID, birth date, university, course, grade, GPA, private message, access credential, personal file path and internal network detail. The optional AI uses these categories with existing word IDs. Document category, purpose and recipient details stay out of the AI Detection request. Screened OCR text/layout go to the configured provider only after consent; this workflow does not anonymize that text or send images. Secret screening is independent of image mask choices.

`dist/sharing-context.js` separates a recommendation (`redact`, `keep`, `review`) from `userOverride` (`redact`, `keep`, or null). Review defaults to masked. Academic purposes keep relevant academic content; names for non-public job/submission requests and student IDs for organization academic submissions need review. Public personal identifiers stay masked by default. Verified-channel delivery lookup can retain order/tracking numbers; a return request asks for review. Private chat messages need review; access credentials always recommend Hide, including custom contexts and retained regions. All choices can be overridden explicitly.

### Custom privacy instructions

Quick examples fill an editable instruction draft. Select **Review image** to apply it. The local parser supports selected English and Chinese phrasings for covering recognized text, recognized words containing numbers, detected personal details, supported field categories, an image half or the whole image. Multiline instructions can list field categories to hide. OCR-based masks are limited to the regions the scan recognizes.

**Hide a specific area** leads to the existing draw and adjust tools. **Keep only the delivery status** asks the user to select and confirm the visible region. PrivacyLens covers the area outside that selection and keeps other masks in place. Ambiguous requests receive conservative protection and an explanation. Instruction masks, field masks and manual masks use the same preview and PNG export. **Undo instruction** removes the instruction’s added protection. Switching audience mode preserves the draft and applies the audience’s own local policy.

Changing sharing settings recalculates suggestions while preserving visibility overrides and edited geometry. **Undo settings change** restores the prior sharing choice where available. **Use suggestion** clears one override, and **Reapply suggested masks** can restore the recommended field coverage after confirmation.

### Consent-based sharing suggestions

**Suggest what to share** returns field-level advice from the selected sharing context, using a screened instruction for Custom. Request-scoped aliases identify the fields. **Interpret instruction with AI** is available for Custom instructions the local parser cannot apply. It sends a screened instruction, document type and detected categories and can suggest one additive operation. The user must accept that operation in Review before it changes masks.

Both actions show the exact browser request and configured receiver before asking for consent. The screenshot, OCR output, mask geometry and recipient notes stay on the device. Screening checks known detected values and recognizable identifiers or credentials. Free-form instructions can still contain personal information. The AI Detection checkbox remains independent of each sharing-analysis action.

AI suggestions appear alongside the existing field controls. The local safety policy keeps high-risk details protected and limits release suggestions for public audiences and unverified recipients. A direction to show or hide a specific field always opens a separate confirmation. Manual masks and box geometry remain independent of those decisions. Missing recommendations fall back to the local advice. Changing the image, recognized fields, audience or purpose invalidates the previous suggestions and cancels any pending sharing analysis.

## Technical screenshot support and credential screening

`technical_screenshot` uses the same local classification, purpose selection, field review and PNG export pipeline. It needs multiple independent technical evidence groups; a lone generic error/token mention does not establish the type. Public forum → technical help, Official support → software support, and Teammates → debugging are shortcuts; Custom remains conservative. Credentials recommend Hide in all contexts, personal user paths recommend Hide, and potentially internal hosts/private network addresses require Review and default to masked. Localhost, public documentation URLs and independent diagnostic details remain useful controls. Masks cover complete OCR words, without promising character-level path editing.

`dist/technical-detection.js` recognizes labelled credentials, auth headers, credential-bearing connection strings, some common key prefixes, PEM private-key blocks, split values and repeats. `textPayload` screens a whitelist-only derived request, preserving IDs and normalized layout. The server screens again and reuses that copy on its one invalid-ID retry. Neither layer logs detected values. Screening can miss unknown formats or OCR errors; other private text may still be sent. Masking does not revoke a disclosed credential.

See [Phase 1 implementation and evaluation](accuracy-lab/technical/REPORT.md) and [reproduction instructions](accuracy-lab/technical/README.md). The technical corpus is small, clean synthetic English data, not a general accuracy claim.

## Guided interface

The Intro introduces contextual sharing; the Upload page keeps upload/drop and examples prominent. Once an image loads, local reading starts automatically with honest progress and a Cancel action. The sharing dialog opens while local reading runs. The main workspace has two panes: image preview and a compact Hidden / Visible review list. The header opens sharing context, type correction and More options; optional AI is integrated at the top of Privacy Review. Going home keeps the in-memory image and provides a Resume action; reloading the page still clears it.

Field reasons, recommended Hide / Keep / Review, and Use suggestion are behind the information button on each field. Unconfirmed Review fields remain masked and have a small Check marker. Mask editing, original/protected switching, Fit / 100% / zoom, overrides and flattened export retain their previous behavior. Review-before-download confirmation is still required. On phones, the review region is a collapsible bottom panel; its toggle and download action stay available. Selecting a field collapses it and locates that image region. Add a mask is directly available beside the mobile preview.

**More options** contains re-reading, recognition language, recipient notes, reset, motion and another example. The default reads English, Traditional Chinese and Simplified Chinese together. English fictional examples use English when the default setting is selected. Explicit English and Chinese combinations remain selectable. Rescanning preserves same-image overrides and masks. On-device reading can be cancelled or fail without blocking manual editing. Each optional AI action shows its own data preview and requires separate consent.

## API configuration

In local `.env` or Vercel environment variables:

```dotenv
OPENAI_API_KEY=your-real-server-key
OPENAI_BASE_URL=https://ai.novacode.top/v1
```

This default is a third-party provider, not an OpenAI-hosted endpoint. Only the backend reads the key. Never put credentials in `dist`, browser storage or Git. Restart/redeploy after configuration changes.

The model remains fixed to **gpt-6-luna**. There is no model selector or model fallback. An unknown OCR word ID can trigger one complete regeneration with a corrective prompt and identical screened text, only when at least 5 seconds remain in the provider budget. Schema, transport, refusal and truncation failures are not automatically retried. Legacy `OPENAI_MODEL` environment variables are ignored; attempts to request another model are rejected before contacting the provider.

`POST /api/ai?action=classify-text` accepts explicit consent, original dimensions and bounded OCR lines/words. It rejects images, duplicate IDs, invalid boxes and excessive text. The upstream request uses Chat Completions with strict JSON schema, `reasoning_effort: none` and `max_completion_tokens: 2048`. Compatible Markdown-wrapped complete JSON is accepted; malformed, conflicting, refused or truncated output does not partially replace masks. A single 50-second backend deadline includes body reading, provider calls and parsing, below the unchanged 60-second function limit. Provider work reserves 2 seconds for final validation/response; the first attempt permits at most 35 seconds and a retry receives only the remaining budget. The browser permits 55 seconds. These shared values live in `dist/ai-policy.js`. The provider must support these parameters; actual cost/retention depend on the provider.

`POST /api/ai?action=recommend-protection` accepts a separately consented screened purpose of up to 500 characters, a supported audience and document type, and up to 100 field categories with request-scoped IDs. Only these purpose and field metadata reach the configured model. The server and browser validate actions, reason codes, allowed IDs and duplicates. Invalid results fail as a unit. The purpose action uses the shared deadlines and a bounded response body. It makes one provider attempt per submission.

`POST /api/ai?action=interpret-instruction` accepts a separately consented screened instruction, document type and known field categories. The server and browser accept zero or one additive operation from the supplied schema. The browser uses local OCR and image sizes to calculate the masks. The user’s separate Apply action changes the image preview.

The earlier image endpoint `POST /api/ai?action=detect` is **disabled by default (HTTP 410)** before reading the image or contacting a provider. Compatibility code is retained behind the server-only `PRIVACYLENS_ENABLE_LEGACY_IMAGE_AI=true` flag; keep it unset for Phase 1. If deliberately enabled, it still requires independent image consent and sends an unmasked JPEG. **The current webpage does not call this endpoint.** The former model-list action remains disabled.

The API has same-origin browser checks and request limits, but no user authentication or distributed rate limiter. Configure platform access/rate controls as appropriate for a public deployment. Same-origin checks do not authenticate arbitrary clients.

## Deploy

Use this directory as the GitHub/Vercel repository root. `vercel.json` publishes `dist` and `api/ai.js`, with no install/build command and a 60-second function duration. Keep `lib`, `api`, `package.json`, the shared `dist/privacy-types.js`, `dist/technical-detection.js`, `dist/ai-policy.js` modules and OCR assets in the deployment. The existing Git integration deploys pushes to `main` to Vercel production. The earlier Sites static-hosting manifest remains historical; that static-only host cannot run the Node API and is not updated by this deployment.

## Verification

```sh
npm test
node --test tests/browser/sharing-and-ai.mjs
node --check dist/app.js
node --check dist/ocr.js
node accuracy-lab/technical/predeploy-audit.mjs
```

Tests cover local type/fallback and purpose registries, contextual actions, override persistence/reconciliation, label/value column and academic spans, provider contracts/errors, fixed-model restriction, OCR coordinate mapping, repeated identifiers, merging local/AI candidates, support rules, text-ID validation, input limits and rejection of image transfer on the text endpoint. Tests with mocked model results do not establish detection accuracy.

The same-image purpose comparison uses six fictional English and Chinese cases. The regular test suite uses simulated responses. For an authorized live evaluation with the configured provider, run `node --env-file-if-exists=.env accuracy-lab/protection/evaluate-live.mjs`. It sends only synthetic purposes and field categories and reports actions, reason codes and latency.

See `QA.md` for the verification record. Detailed sample results remain in local `qa/ocr-integration/` and are excluded from the published source. Previous QA entries describe earlier versions. No general accuracy or privacy guarantee is claimed. English sample performance does not establish Chinese-language, mobile or real-world accuracy.

See `SECURITY_HARDENING_REPORT.md` for the local blocker remediation and deployment recommendation. The AI dialog includes a text-only preview of the screened payload. Detection normalizes a separate view and preserves original OCR IDs/geometry; uncertain recognised credential regions are screened conservatively. Unlabelled unknown formats and severely corrupted OCR remain possible leaks; preview and cancellation supplement automatic screening.
