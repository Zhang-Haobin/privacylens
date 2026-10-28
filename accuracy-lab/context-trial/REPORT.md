# Contextual delivery detection trial — 28 October 2026

## Scope

The local rules now suggest sender/recipient names and individual address lines near explicit delivery labels, using nearby address evidence and layout boundaries. The OCR engine, AI integration and manual editing are unchanged. A multiline address currently appears as separate review items. This trial does not claim that all names, addresses or payment identifiers are detected.

The existing set comprises nine fictional screenshots manually annotated in original image coordinates, plus one generated long mixed-language image annotated using its drawing coordinates: 67 sensitive fields and 25 separately marked public controls. See `../ground-truth/REPORT.md` for data, definitions and previous AI and browser tests. A new set of five synthetic layouts was generated and annotated from font/drawing coordinates before these rules were implemented. It contains 12 sensitive fields and eight public controls. The held-out layouts are simple, synthetic and too few to support a generalized accuracy claim. Annotations are rectangle approximations, not pixel-level ink masks.

## Results

Both versions use the same saved Tesseract results, local rules and public-sharing policy. The PNGs in these aggregate tests are offline renderings of the computed masks, not browser downloads. No AI or manual masks are used here.

| Measure | Existing before | Existing after | New set before | New set after |
| --- | ---: | ---: | ---: | ---: |
| Sensitive fields | 67 | 67 | 12 | 12 |
| OCR spatially detected | 64 | 64 | 12 | 12 |
| Correctly classified fields | 32 | 52 | 0 | 12 |
| Fully covered | 30 | 51 | 0 | 12 |
| Partially covered | 8 | 7 | 0 | 0 |
| Completely missed | 29 | 9 | 12 | 0 |
| Marked public controls overmasked | 3/25 | 3/25 | 0/8 | 0/8 |

Spatial OCR detection is defined as at least 50% of every annotated part overlapped by OCR words; it does not mean the text was transcribed correctly. Correct field classification additionally requires approximate text match and the correct classification for at least 80% of associated word IDs in each part. Complete coverage requires every pixel of every annotated rectangle to have the opaque mask color; any uncovered pixel makes it partial, even if that pixel is blank background. The public-control count measures only those marked regions. Area covered outside annotated rectangles increased from 49,729 to 122,144 pixels, which includes padding, background and unannotated content; it is not a standalone false-positive count. Comparison of generated masks found no loss of previously covered pixels.

Nine existing fields remain completely uncovered: Amazon and PayPal payment identifiers; a UPS reference; a Chinese order and address; and a name, low-contrast phone, tracking number and address in the long mixed-language image. The low-contrast phone and address had no associated OCR word; the long tracking and Chinese address had missing or poorly read text; other misses include classification failures. Seven more fields are partially covered (two phone numbers, a name and four addresses). Small residual areas can be annotation padding rather than visible characters; they still need inspection and cannot be presumed safe.

## Actual browser PNG

For the fictional Amazon sample, the actual previously downloaded PNG covered 2 of 5 annotated fields (order and phone). The actual downloaded PNG after this change covered 4 of 5 (also name and multiline address); the payment suffix remained completely exposed. Source SHA-256 was unchanged across the test. Output dimensions were unchanged; after converting the original's color profile to sRGB, the maximum channel difference outside opaque masks was one. See `../ground-truth/runs/context-amazon-browser-before-after.png` and `../ground-truth/runs/context-browser-verification.json`. Other aggregate images were not validated as browser downloads in this trial.

The browser rescan after entering adjustment mode again returned the same 94 recognized words and seven suggestions. This does not by itself establish that the adjustment was applied or preserved. Geometry reconciliation has an automated regression test, and the prior browser verification in `../ground-truth/REPORT.md` covers adjustment through rescan, AI, context and type changes on the earlier implementation. Undo/redo for adjustments is not implemented.

## Reproduce

From the project directory, with the local test dependencies and existing generated inputs present:

```sh
node accuracy-lab/context-trial/run.mjs
python3 accuracy-lab/ground-truth/evaluate.py --pipeline context-existing.json --output context-existing-evaluation.json --subdir context-existing
python3 accuracy-lab/context-trial/generate-holdout.py
node accuracy-lab/context-trial/run.mjs --holdout
python3 accuracy-lab/ground-truth/evaluate.py --pipeline context-holdout.json --output context-holdout-evaluation.json --subdir context-holdout --annotations holdout-annotations.json --omit-stress
npm test
```

The frozen pre-change rules are in `baseline-ocr-core.js`; both versions consume identical OCR output. `run.mjs --holdout --replay` reuses saved holdout OCR output. Original fixtures and run artifacts are in ignored directories within `accuracy-lab/ground-truth/`; generation depends on the local fonts and Python image libraries used by this machine. The saved JSON files contain field-level results and definitions. Do not interpret the former 21/21 targeted checks, or these limited synthetic results, as general OCR accuracy.
