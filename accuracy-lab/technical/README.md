# Technical screenshots: local Phase 1 evaluation

All source text and credentials in `fixtures.mjs` are fictional. Generated source PNGs, OCR documents, sanitized request captures, downloaded PNG copies and screenshots stay in ignored `generated/` and `results/`. No real user data belongs in this corpus. This adds no runtime dependency to PrivacyLens and introduces no Python or alternate backend.

The application still uses its installed Tesseract dependency. Raster QA additionally uses `sharp` from an existing Node modules directory; set `PRIVACYLENS_RUNTIME_MODULES` if it is not resolvable locally. Do not install it into production merely for these scripts.

```sh
# Optional: recreate the explicit pre-Phase-1 comparison snapshot.
node accuracy-lab/technical/snapshot-baseline.mjs 36dee8d66166ecdaff6091b3cef4b4e7c3f79f58
node accuracy-lab/technical/generate.mjs
node accuracy-lab/technical/evaluate.mjs
```

Generation specifies sensitive substrings and public controls on a fixed character grid before OCR. The evaluator never uses OCR boxes as ground truth. It performs the same two segmentation passes and processing-size cap as the browser, with English recognition for this English corpus, then uses the normal classification, local suggestions, policy and mask geometry. Offline composited PNGs are reference renderings, **not browser exports**. `--replay` reuses saved OCR for detector-only comparison.

For actual browser requests and retry validation, start this separate QA-only preview:

```sh
node accuracy-lab/technical/browser-check-server.mjs
```

Open the printed localhost URL. The harness serves the real editor and calls the real `handleAI`, but its provider transport is a local stub: the first result contains an unknown ID; the second returns only placeholder word IDs. It never loads `.env`, never contacts a provider and has no effect on production. Captures record the actual browser POST, both serialized provider requests, known-fixture leakage checks and equality of retry text. Unsafe captures are recorded only as failure flags. Consent remains required in the editor.

In the browser: try the technical sample; upload `generated/terminal.png` and `generated/configuration.png` using English OCR; select a sharing purpose; optionally run the stubbed AI after consent. Download through the normal review gate. Check real saved output with:

```sh
node accuracy-lab/technical/verify-browser.mjs terminal /absolute/path/to/download.png
# Optional separate output name for the adjusted post-AI export:
node accuracy-lab/technical/verify-browser.mjs terminal /absolute/path/to/download.png after-ai
```

The verifier checks dimensions, opaque coverage over each independent sensitive ink bounding rectangle (including blank interior pixels), unchanged public regions, unexpected pixel modifications, and PNG text/EXIF chunks. Checking original dark glyphs alone would be insufficient because their color matches the mask color.

Existing regressions:

```sh
npm test
node accuracy-lab/run.mjs
# Requires the earlier local ground-truth OCR artifacts and baseline snapshot:
node accuracy-lab/technical/regression.mjs
```

See [REPORT.md](REPORT.md) for measured results and limitations. This small, clean synthetic English corpus is a development test set, not a general accuracy benchmark or proof that unknown credentials cannot leak.

## Security hardening checks

```sh
node accuracy-lab/technical/predeploy-audit.mjs
node accuracy-lab/technical/predeploy-image-audit.mjs
node accuracy-lab/technical/predeploy-browser-server.mjs
```

The first check asserts screening of credential fragments by original word ID at the browser serializer, server, and both mock provider attempts; it also tests direct unscreened clients and records observed remaining attempt budgets. It fails independently on any supported client/provider leak, mutation, lost diagnostic control, retry mismatch or insufficient budget. Unknown unlabelled formats are recorded as a limitation, not certified as safe.

The image audit reruns English OCR on four synthetic Java/Python/JavaScript/control screenshots, including a real OCR substitution of a hyphen with an em dash. It inspects credential-shaped OCR fragments and both serialized mock provider bodies, rather than relying only on exact source strings. Reports go to ignored `qa/predeployment/`.

The browser server listens only on localhost:4177, never reads `.env` and never calls a remote provider. `/qa-audit.html` exercises all supported formats through actual browser POSTs and the production handler. The editor includes QA-only image loading, gateway error injection and an observer that saves the exact production PNG blob in ignored `qa/hardening-browser/`. The preview assets are outside `dist`; production does not expose these controls or request captures.
