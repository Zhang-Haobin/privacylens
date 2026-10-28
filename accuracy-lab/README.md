# Local accuracy lab

The independent source-image annotation and actual export investigation is in [ground-truth/REPORT.md](ground-truth/REPORT.md). The earlier checks below target selected OCR word boxes and do not measure overall privacy accuracy.

This folder keeps OCR test inputs and results inside the project. `fixtures/` contains eight fictional shipping/payment screenshots and one locally generated Chinese text image, copied from the existing local QA inputs. Both `fixtures/` and `results/` are ignored by Git so images and recognized text cannot enter a deployment by accident.

From the project root, run `node accuracy-lab/run.mjs`. It uses the same English or English + Traditional Chinese OCR models and two page segmentation passes as the browser and writes `results/latest.json`. The manifest records specific value words that should be covered and nearby public words that should stay uncovered. A covered word must have at least 95% of its OCR box covered; an excluded word must have at most 5%. These checks measure box placement relative to OCR boxes for selected examples, not actual text-ink coverage or general detection accuracy. No network or AI provider call is made.

Run `npm test` for deterministic geometry and policy checks. Inspect every exported image before sharing: OCR cannot locate text that it misses altogether, nor can it detect QR codes or faces.
