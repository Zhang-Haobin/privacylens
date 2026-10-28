# Accuracy investigation — 28 October 2026

**Superseded as an accuracy assessment:** the 21/21 checks below target selected OCR word boxes. Independent source-image annotations and exported-PNG evaluation found substantial misses. See [ground-truth/REPORT.md](ground-truth/REPORT.md) for the current results.

The first eight shipping/payment screenshots exposed two concrete local-rule problems: category keywords masked whole lines, and OCR punctuation after `TRACKING #` could cause the number to be missed. On six annotated English samples, the initial quick check passed 8/15 targeted value/neighbor checks. Tightening identifier, phone and payment spans raised the same six to 15/15. Two more English samples plus one Chinese sample now bring the checked total to 21/21 (`results/latest.json`).

The FedEx tracking box previously included `INTL PRIORITY`; the SF order label previously had its own mask. Both now leave those adjacent words uncovered while keeping the actual values covered. Chinese OCR split `訂單 號` into words and sometimes attached `:` to `+852`; the label parser now handles those shapes. The UPS `TRACKING #: #:` case is also covered.

An independent error appeared in those same OCR results: `CA 94108` and `OCT 2026` were misclassified as course codes, and destination universities as academic records. Academic course/university suggestions now require other academic wording. The fictional transcript still yielded its course, university and GPA results in a browser OCR run.

The targeted checks use the OCR engine's word boxes as their reference. They cannot prove that the OCR boxes cover every visible glyph, that missed text is detected, or that the nine examples represent real-world accuracy. For those cases the editor now allows manual box adjustment. A browser run confirmed dragging a corner changed the preview dimensions, a same-image rescan kept the edited dimensions, and the export review opened with the same active masks. Desktop and 390px mobile controls were exercised; screenshots are in `results/`.
