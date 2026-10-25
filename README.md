# PrivacyLens — CCST9003 prototype

A screenshot editor with local text recognition, optional AI text classification, recipient-dependent suggestions and flattened PNG export.

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

1. Import a PNG/JPEG/WebP (up to 20 MB / 20 megapixels), or choose the fictional sample.
2. Choose the text language and click **Read text locally**. OCR runs in a Web Worker on the user's device. The worker, WASM and language files are served by this site; language assets may be cached in the browser. The app does not persist recognized text or images.
3. Local rules suggest masks for telephone numbers, emails, labelled identifiers and payment suffixes. These are incomplete: names and addresses need manual review or optional classification.
4. To classify text, explicitly select the transfer checkbox and click **Classify text with AI**. Recognized text and normalized word layout travel through the app server to the configured provider. **The current editor workflow does not send the image. Sending OCR text still discloses the personal information in that text.**
5. AI returns only categories, roles and existing word IDs. Server and browser reject unknown/conflicting IDs and invalid output as a whole. Actual mask positions come from local OCR. Local candidates are retained even if AI omits them; overlapping suggestions for the same field are combined into one switch.
6. Review the complete image. In **Protected** view, click/tap a mask directly to remove it and reveal that detail; suggested fields switch to **Keep**, and hand-drawn masks are removed from the list. Overlapping masks are removed one at a time, starting with the topmost. Field switches can restore suggested masks. Click a field label to locate its mask, use **Zoom to 100%**, and add hand-drawn masks for misses. While **Add a mask** is active, drag to draw; click it again or press Escape to return to removing masks. **QR codes, barcodes and faces are not automatically detected by OCR.**
7. Review & export opens the exact protected PNG. Confirm review before downloading. The original resolution is retained; preview highlights are not included in the export.

Mask changes use a 380 ms eased wipe in the preview: covering expands from left to right, and removing retracts from right to left. Rapid reversals continue from the current position. Reduced-motion preferences skip the animation. Exports always use the final mask selection, even while a preview animation is running.

OCR uses two segmentation passes to recover some missed text, unions overlapping token bounds, expands adjacent words on address baselines, and maps coordinates back to the original image. Small images are upscaled, subject to a 2600px side / 6-megapixel processing cap. There is no auto-rotation or perspective correction. OCR can still miss whole lines, misread digits or produce incomplete boxes. Low-confidence words are not silently discarded.

Earlier masks remain during recognition, on cancellation and on failures. A successful OCR run adds its local suggestions to earlier masks; a successful AI classification replaces generated suggestions with the new classification plus local rule candidates. Hand-drawn masks survive both operations. Switching images invalidates stale results, clears transfer consent and clears the previous image's suggestions. Cancel terminates active OCR work or aborts the client request; a request already sent to the provider may still be processed. Export is disabled during recognition/classification.

Changing sharing context reapplies field-switch recommendations. Public hides all suggestions. Verified official support for an initial delivery lookup suggests retaining order/tracking numbers; transaction IDs, references, payment and contact details remain masked. The recipient still needs to be verified by the user. Changing context does not rerun OCR/AI or remove hand-drawn masks.

## API configuration

In local `.env` or Vercel environment variables:

```dotenv
OPENAI_API_KEY=your-real-server-key
OPENAI_BASE_URL=https://ai.novacode.top/v1
```

This default is a third-party provider, not an OpenAI-hosted endpoint. Only the backend reads the key. Never put credentials in `dist`, browser storage or Git. Restart/redeploy after configuration changes.

The model remains fixed to **gpt-6-luna**. There is no model selector, fallback or automatic retry. Legacy `OPENAI_MODEL` environment variables are ignored; attempts to request another model are rejected before contacting the provider.

`POST /api/ai?action=classify-text` accepts explicit consent, original dimensions and bounded OCR lines/words. It rejects images, duplicate IDs, invalid boxes and excessive text. The upstream request uses Chat Completions with strict JSON schema, `reasoning_effort: none` and `max_completion_tokens: 2048`. Compatible Markdown-wrapped complete JSON is accepted; malformed, conflicting, refused or truncated output does not partially replace masks. Provider calls time out after 45 seconds. The provider must support these parameters; actual cost/retention depend on the provider.

The earlier image endpoint `POST /api/ai?action=detect` remains for compatibility and existing tests. It requires its own explicit consent and sends an unmasked JPEG. **The current webpage does not call this endpoint.** The former model-list action remains disabled.

The API has same-origin browser checks and request limits, but no user authentication or distributed rate limiter. Configure platform access/rate controls as appropriate for a public deployment. Same-origin checks do not authenticate arbitrary clients.

## Deploy

Use this directory as the GitHub/Vercel repository root. `vercel.json` publishes `dist` and `api/ai.js`, with no install/build command and a 60-second function duration. Keep `lib`, `api`, `package.json` and OCR assets in the deployment. The existing Git integration deploys pushes to `main` to Vercel production. The earlier Sites static-hosting manifest remains historical; that static-only host cannot run the Node API and is not updated by this deployment.

## Verification

```sh
npm test
node --check dist/app.js
node --check dist/ocr.js
```

Tests cover provider contracts/errors, fixed-model restriction, OCR coordinate mapping, repeated identifiers, merging local/AI candidates, support rules, text-ID validation, input limits and rejection of image transfer on the text endpoint. Tests with mocked model results do not establish detection accuracy.

See `QA.md` for the verification record. Detailed sample results remain in local `qa/ocr-integration/` and are excluded from the published source. Previous QA entries describe earlier versions. No general accuracy or privacy guarantee is claimed. English sample performance does not establish Chinese-language, mobile or real-world accuracy.
