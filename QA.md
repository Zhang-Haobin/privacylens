# Verification record

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
