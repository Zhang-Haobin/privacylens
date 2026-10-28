# Independent privacy evaluation — 28 October 2026

## Scope and ground truth

Nine existing fictional screenshots were visually annotated on their original PNGs before inspecting OCR results. Rectangles and transcriptions are in `annotations.json`; multi-line addresses are one field with a separate rectangle for each line. Eight are English shipping/payment images and one is a mixed Chinese/English image. `LongMixed.png` is an additional generated long screenshot, with its annotations obtained from the drawing coordinates and font measurements, independently of OCR. It includes a student ID, small text and low-contrast text. In total there are 67 annotated text fields: 14 names, 14 phone numbers, 14 addresses, 8 tracking numbers, 6 order IDs, 3 payment identifiers, 3 references, 3 emails, 1 transaction ID and 1 student ID. Repeated values at different locations count separately.

The annotations are approximate rectangles drawn by one reviewer, not pixel-level text-ink masks or double-reviewed labels. Twenty-five separately annotated public controls provide a limited overmask check. Barcodes, QR codes, faces and unlabelled sensitive information are outside this text evaluation. Source images and generated output remain local under ignored `originals/` and `runs/`.

## Results: public sharing, local automatic rules only

| Measure | Result | Definition |
| --- | ---: | --- |
| OCR spatial detection recall | 64/67 (95.5%) | Each part has an OCR word associated with it and at least 50% of the part rectangle intersects OCR boxes. A detected box can still contain the wrong text. |
| OCR approximate text recall | 60/67 (89.6%) | Every part's spatially associated OCR text reaches 0.8 normalized sequence similarity against the independent transcription. Simplified/traditional substitutions and OCR duplicate words can lower this score. |
| Correctly classified fields | 32/67 (47.8%) | Every part passes the text check and at least 80% of its associated OCR word IDs have the correct category. |
| Classification precision, word/category pairs | 64/67 (95.5%) | Correct predicted pairs divided by predicted pairs. Only the annotated categories are scored. |
| Classification recall, word/category pairs | 64/281 (22.8%) | Correct predicted pairs divided by annotated-region OCR word/category pairs. This is conditional on OCR emitting the words, and includes any OCR duplicates. |
| Fully covered fields | 30/67 (44.8%) | Every pixel in every annotated rectangle is the solid opaque mask color. |
| Partially covered fields | 8/67 (11.9%) | At least one annotated pixel is covered but the entire field is not. |
| Completely missed fields | 29/67 (43.3%) | No annotated pixel is covered. |
| Overmasked public controls | 3/25 (12.0%) | More than 5% of an independently marked public region is covered. |

The 37 fields that were not completely covered are assigned a first observable failure in this order: 3 had no OCR word associated with any part; 4 had associated OCR text below the transcription threshold; 28 passed the OCR text check but lacked the correct classification for all parts; 2 passed classification but were only partially covered by the final geometry or policy. This ordering is diagnostic, not proof that each failure has a single cause. An OCR word was detected in the long tracking region but its text was only a dash; it is counted in the text-failure group.

| Image | Fields | OCR detected | Correctly classified | Complete | Partial | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SF | 10 | 10 | 6 | 5 | 2 | 3 |
| Amazon | 5 | 5 | 2 | 2 | 0 | 3 |
| DHL | 8 | 7 | 3 | 3 | 0 | 5 |
| FedEx | 10 | 10 | 6 | 6 | 1 | 3 |
| UPS | 9 | 9 | 4 | 3 | 4 | 2 |
| eBay | 5 | 5 | 3 | 3 | 0 | 2 |
| SHEIN | 4 | 4 | 2 | 2 | 1 | 1 |
| PayPal | 6 | 6 | 3 | 3 | 0 | 3 |
| Chinese | 4 | 4 | 1 | 1 | 0 | 3 |
| LongMixed | 6 | 4 | 2 | 2 | 0 | 4 |

The aggregate PNGs in `runs/current/exports/` are offline reproductions using the actual local OCR, local field suggestions, public policy and mask rectangles. Pillow bilinear preprocessing approximates the browser canvas scaling; it is not a browser execution. They are evaluated by reopening the generated PNG pixels. The actual browser export below is a separate check. The earlier 21/21 word-box checks were narrow regression cases and must not be interpreted as overall OCR or privacy accuracy.

## Optional AI on the same fictional inputs

The existing server classifier was called once per image with the fictional OCR text and layout, using `gpt-6-luna` and the configured provider; no image was sent. All 10 requests succeeded. Validated AI word IDs were merged with local candidates and reconciled with the previous local masks using the same field and policy helpers as the app. Results are from one provider run and may vary on a repeat. The resulting masks were rendered and checked in offline PNGs, not downloaded from the browser.

| Measure | Local only | Local + AI |
| --- | ---: | ---: |
| Correctly classified fields | 32/67 | 58/67 |
| Word/category precision | 64/67 (95.5%) | 273/303 (90.1%) |
| Word/category recall, conditional on OCR words | 64/281 (22.8%) | 273/281 (97.2%) |
| Fully covered fields | 30/67 | 55/67 |
| Partially covered fields | 8/67 | 9/67 |
| Completely missed fields | 29/67 | 3/67 |
| Overmasked public controls | 3/25 | 4/25 |

These are selected-field measurements, not a benchmark of arbitrary screenshots. OCR output was the same in both columns. The three entirely missed AI-assisted fields are the small phone, tracking number and address in LongMixed. Six partial cases were attributed to mask geometry or policy after the text and category checks, including one phone number. A one-pixel gap anywhere inside a manually drawn rectangle counts as partial, even when the uncovered pixel is background; inspect the images before interpreting it as a visible character. A DHL phone with no associated OCR words was incidentally covered by a neighboring AI address mask, which cannot be relied upon.

The 4/25 overmasked controls include a public merchant email and phone plus two label overlaps in the long test. `runs/ai-run/ai/comparisons/` and `runs/evaluation-ai.json` contain the per-image results. These files are retained locally. `runs/ai-status.json` records failures; it reports 10/10 successful requests for this run.

## Verified browser exports

- Imported `originals/Amazon.png`, selected public sharing, ran the browser's local OCR and downloaded `runs/browser-export-amazon.png`. Its independent annotations show the order and phone fully covered; the name, four-line address and payment suffix are entirely visible. The original source SHA-256 was unchanged. The PNG is 526 × 732 with no retained metadata; after converting the source image's embedded display profile to sRGB, pixels outside the painted mask differ by at most one color level. The mask pixels in this browser export exactly match the offline run on this image (mask IoU 1.0). `runs/browser-amazon-comparison.png` shows original annotations and the actual downloaded PNG.
- Downloaded the actual generated `runs/browser-export-ai.png` from the built-in fictional order after a real AI reanalysis. Its adjusted order rectangle and five known sample preset rectangles are completely opaque in the PNG. These preset checks verify export rendering; they are not independent detection ground truth. The AI aggregate above is a separate offline replay.

## Before and after

The first ground-truth run on the immediately preceding implementation missed the repeated UPS tracking number, because the second occurrence was split into multiple OCR words. A small local-rule change now joins adjacent OCR words when matching a previously identified full number. On the same 67 fields and OCR output, complete coverage changed from 29 to 30 and completely missed fields from 30 to 29; the 3/25 overmasked public controls were unchanged. `runs/ups-before-after.png` shows the change; those two images are offline renderings. The current and pre-fix measurements are stored in `runs/evaluation.json` and `runs/evaluation-pre-fix.json`.

For additional context, replaying frozen pre-refinement rules from commit `7f22a57` on the same OCR results gave 31 complete, 11 partial, 25 missed and 5/25 overmasked controls. The current rules give 30, 8, 29 and 3/25. Some old partial address coverage came from treating a university in a delivery address as an academic field; reducing that false classification removed incidental address coverage. This comparison is a replay of the old rule module with the current OCR and policy, not a historical browser run. There is no basis to claim overall improvement in privacy protection.

## Failure patterns and adjustment regression

- OCR completely missed the DHL sender phone obscured by an existing selection overlay, and the low-contrast small phone and address in LongMixed. The long screenshot was processed at 494 × 2600; its small 11–12 px original text became roughly 7–8 px. Its tracking number produced a dash instead of usable text. See `runs/ocr-failures.png`.
- Most names and multi-line addresses were read by OCR but did not receive a complete local privacy classification. In the separate Chinese image the order value was read, but duplicated/noisy label words prevented local classification. OCR returned a simplified character for one traditional name, which the strict transcription comparison also flags.
- SF's sender phone and UPS's recipient phone were correctly categorized but their masks failed to cover the entire independent rectangle. The SF case has OCR boxes shifted by an existing selection overlay. The output should be checked and adjusted manually.
- The PayPal merchant phone and email were marked private even though they are public controls; another small overlap affected a label in LongMixed. Public controls are a small selected set, so 3/25 is not a complete overmasking rate.
- On a fictional order in the browser, an edited box retained its coordinates after same-image OCR, actual AI reanalysis, sharing-context and document-type changes, zoom and pan. Loading the Amazon image cleared the prior nine masks before starting its own scan. Adding then undoing an unrelated manual mask left an adjusted Amazon box unchanged.
- The existing Undo button only removes the last added manual mask; there is no adjustment undo/redo history or redo control. Adjust-box undo/redo could therefore not be verified. Unit tests cover matched and unmatched AI reanalysis, user geometry, image bounds and context changes; unmatched user-edited geometry is now retained for review.

## Reproduce

From `sites/privacylens`, with Node dependencies and Python Pillow/NumPy already installed:

```sh
python3 accuracy-lab/ground-truth/generate-stress.py
python3 accuracy-lab/ground-truth/prepare.py
node accuracy-lab/ground-truth/run-ocr.mjs
python3 accuracy-lab/ground-truth/evaluate.py
python3 accuracy-lab/ground-truth/verify-browser.py
npm test
```

The eight original fictional screenshots and the Chinese image must be present in `originals/`; this directory is intentionally ignored by Git. The stress generator uses macOS system fonts. Browser PNGs are created by separate manual UI actions and are not reproduced by the OCR command. The local-only run does not call an AI provider. To repeat the optional AI evaluation, `node --env-file-if-exists=.env accuracy-lab/ground-truth/run-ai.mjs` sends all recognized fictional test text to the configured provider and may incur charges; then run `python3 accuracy-lab/ground-truth/evaluate.py --pipeline ocr-ai-pipeline.json --output evaluation-ai.json --subdir ai-run --modes ai`. Results apply to these few synthetic images and chosen thresholds only.
