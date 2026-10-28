"""Measure local OCR and candidate masks against independent original-image labels.

The PNGs here are an offline reproduction of the application's solid rectangle
painting, not browser downloads. Browser-export verification is recorded separately.
"""
from collections import Counter
import argparse
from difflib import SequenceMatcher
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
import hashlib, json, math, unicodedata
import numpy as np

root = Path(__file__).parent
runs = root / 'runs'
parser = argparse.ArgumentParser()
parser.add_argument('--pipeline', default='ocr-pipeline.json')
parser.add_argument('--output', default='evaluation.json')
parser.add_argument('--subdir', default='')
parser.add_argument('--modes', nargs='+', default=['before', 'current'])
parser.add_argument('--annotations', default='annotations.json')
parser.add_argument('--omit-stress', action='store_true')
args = parser.parse_args()
annotations = json.loads((root / args.annotations).read_text())['images']
if not args.omit_stress: annotations.append(json.loads((root / 'stress-annotation.json').read_text()))
annotations = {sample['id']: sample for sample in annotations}
pipeline = json.loads((runs / args.pipeline).read_text())
targets = {'name', 'phone', 'address', 'tracking', 'order', 'student_id', 'payment', 'email', 'reference', 'transaction'}
color = np.array([32, 43, 36, 255], dtype=np.uint8)

def normalize(text):
    return ''.join(ch.lower() for ch in unicodedata.normalize('NFKC', text) if ch.isalnum())

def intersect(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))

def word_read(part, words):
    x0, y0, x1, y1, expected = part
    selected = []
    for word in words:
        b = word['bbox']; box = [b['x0'], b['y0'], b['x1'], b['y1']]
        if intersect(part, box) / max(1, (box[2] - box[0]) * (box[3] - box[1])) >= .5:
            selected.append(word)
    # Every annotated part is a single visual line; word baselines can differ.
    selected.sort(key=lambda word: word['bbox']['x0'])
    actual = normalize(''.join(w['text'] for w in selected))
    target = normalize(expected)
    # The comparison is deliberately based on the human transcription, not OCR boxes.
    similarity = SequenceMatcher(None, target, actual).ratio() if actual else 0
    return {'words': len(selected), 'word_ids': [w['id'] for w in selected], 'text': ''.join(w['text'] + ' ' for w in selected).strip(), 'similarity': round(similarity, 3), 'read': similarity >= .8}

def paint_mask(shape, rects):
    h, w = shape; mask = np.zeros((h, w), dtype=bool)
    for x, y, width, height in rects:
        # Canvas fillRect paints the full integer pixel range for these integer masks.
        x0, y0 = max(0, math.floor(x)), max(0, math.floor(y))
        x1, y1 = min(w, math.ceil(x + width)), min(h, math.ceil(y + height))
        mask[y0:y1, x0:x1] = True
    return mask

def part_fraction(mask, part):
    x0, y0, x1, y1 = part[:4]
    return float(mask[y0:y1, x0:x1].mean())

summaries = {}
per_image = {}
for mode in args.modes:
    totals = Counter()
    for item in pipeline:
        sid = item['id']; label = annotations[sid]
        original = root / 'originals' / (sid + '.png')
        assert hashlib.sha256(original.read_bytes()).hexdigest() == item['sha256']
        im = Image.open(original).convert('RGBA'); pixels = np.array(im)
        fields = item[mode]['fields']; masks = item[mode]['masks']
        mask = paint_mask((im.height, im.width), [m['rect'] for m in masks])
        pixels[mask] = color
        dest = runs / args.subdir / mode / 'exports'; dest.mkdir(parents=True, exist_ok=True)
        exported = dest / (sid + '.png')
        Image.fromarray(pixels).save(exported)
        reread = np.array(Image.open(exported).convert('RGBA'))
        actual_mask = np.all(reread == color, axis=2) & mask
        assert np.all(reread[mask] == color) and hashlib.sha256(original.read_bytes()).hexdigest() == item['sha256']
        gt_mask = np.zeros(mask.shape, dtype=bool)
        ocr_boxes = []
        for word in item['document']['words']:
            b = word['bbox']; ocr_boxes.append([b['x0'], b['y0'], b['x1'] - b['x0'], b['y1'] - b['y0']])
        ocr_mask = paint_mask(mask.shape, ocr_boxes)
        predicted_pairs = {(word_id, f['category']) for f in fields if f['category'] in targets for word_id in f['wordIds']}
        reference_pairs = set()
        outcomes = []
        for number, field in enumerate(label['fields'], 1):
            for x0, y0, x1, y1, _ in field['parts']: gt_mask[y0:y1, x0:x1] = True
            reads = [word_read(part, item['document']['words']) for part in field['parts']]
            for part in reads: reference_pairs.update((word_id, field['category']) for word_id in part['word_ids'])
            detected = all(read['words'] > 0 and part_fraction(ocr_mask, part) >= .5 for read, part in zip(reads, field['parts']))
            ocr_read = all(part['read'] for part in reads)
            ocr_absent = all(part['words'] == 0 for part in reads)
            classified = ocr_read and all(part['word_ids'] and sum((word_id, field['category']) in predicted_pairs for word_id in part['word_ids']) / len(part['word_ids']) >= .8 for part in reads)
            fractions = [part_fraction(actual_mask, part) for part in field['parts']]
            coverage = min(fractions)
            status = 'complete' if coverage >= 1 else 'partial' if max(fractions) > 0 else 'missed'
            cause = 'covered' if status == 'complete' else 'ocr_absent' if ocr_absent else 'ocr_text_or_part_missing' if not ocr_read else 'classification' if not classified else 'mask_geometry_or_policy'
            outcomes.append({'id': f'{sid}-{number}', 'category': field['category'], 'parts': field['parts'], 'ocr': reads, 'ocr_detected': detected, 'ocr_read': ocr_read, 'ocr_absent': ocr_absent, 'classified': classified, 'coverage_by_part': [round(x, 4) for x in fractions], 'status': status, 'cause': cause})
            totals['ground_truth_fields'] += 1; totals['ocr_detected_fields'] += int(detected); totals['ocr_read_fields'] += int(ocr_read); totals['ocr_absent_fields'] += int(ocr_absent)
            totals['classified_fields'] += int(classified); totals[status] += 1; totals['cause_' + cause] += 1
        predictions = [f for f in fields if f['category'] in targets]
        correct = 0
        for pred in predictions:
            p = pred['rect']; pred_box = [p[0], p[1], p[0] + p[2], p[1] + p[3]]
            best = max((intersect(pred_box, part) / max(1, min(p[2] * p[3], (part[2] - part[0]) * (part[3] - part[1]))) for f in label['fields'] if f['category'] == pred['category'] for part in f['parts']), default=0)
            correct += int(best >= .5)
        totals['classification_predictions'] += len(predictions); totals['classification_correct_predictions'] += correct
        totals['classification_word_predictions'] += len(predicted_pairs)
        totals['classification_word_ground_truth'] += len(reference_pairs)
        totals['classification_word_correct'] += len(predicted_pairs & reference_pairs)
        controls = [{'label': p[4], 'rect': p[:4], 'coverage': round(part_fraction(actual_mask, p), 4)} for p in label['public']]
        totals['public_controls'] += len(controls); totals['overmasked_controls'] += sum(c['coverage'] > .05 for c in controls)
        totals['mask_pixels'] += int(mask.sum()); totals['mask_pixels_outside_annotations'] += int((mask & ~gt_mask).sum())
        key = sid + ':' + mode
        per_image[key] = {'type': item['type'], 'ocr_words': len(item['document']['words']), 'fields': outcomes, 'controls': controls, 'predictions': len(predictions), 'correct_predictions': correct, 'export': str(exported.relative_to(root))}
        if mode in ('current', 'ai'):
            annotated = im.convert('RGB'); draw = ImageDraw.Draw(annotated)
            colors = {'complete': '#00a464', 'partial': '#ef9700', 'missed': '#e72727'}
            for result in outcomes:
                for x0, y0, x1, y1, _ in result['parts']: draw.rectangle((x0, y0, x1-1, y1-1), outline=colors[result['status']], width=2)
            annotated.thumbnail((520, 900)); shown = Image.open(exported).convert('RGB'); shown.thumbnail((520, 900))
            sheet = Image.new('RGB', (1060, max(annotated.height, shown.height) + 40), 'white'); d = ImageDraw.Draw(sheet)
            d.text((8, 8), sid + ' ground truth: green complete, amber partial, red missed', fill='black')
            d.text((536, 8), ('AI + local' if mode == 'ai' else 'Local automatic') + ' output (offline PNG)', fill='black')
            sheet.paste(annotated, (8, 32)); sheet.paste(shown, (536, 32))
            dest = runs / args.subdir / mode / 'comparisons'; dest.mkdir(parents=True, exist_ok=True); sheet.save(dest / (sid + '.png'))
    summaries[mode] = dict(totals)
report = {'method': {'ocr_detection_recall': 'Every annotated part has at least 50% area overlapped by OCR word boxes. This is spatial detection, not transcription accuracy.', 'ocr_text_recall': 'All field parts: human transcription versus spatially overlapping OCR text, normalized sequence similarity >= 0.8.', 'classification_word_precision_recall': 'Category/word-ID pairs: precision is correct predicted pairs / all predicted pairs; recall is correct pairs / all spatially associated ground-truth OCR word pairs. Recall is conditional on OCR emitting those words.', 'classification_field_recall': 'All parts read at >=0.8 transcription similarity and >=80% of each part’s OCR word IDs selected by the correct category; denominator is all annotated fields.', 'classification_candidate_precision': 'A candidate is correct when same-category annotation overlaps at least 50% of the smaller rectangle; secondary geometry-based check.', 'coverage': 'PNG pixels equal opaque #202b24 throughout every annotated rectangle. A single uncovered pixel is partial.', 'overmask': 'Public controls with >5% covered; area outside sensitive rectangles also includes blank space and unannotated information.', 'context': ('Public sharing, local rules plus AI classifications; no manual masks.' if args.modes == ['ai'] else 'Public sharing, local automatic rules; no AI or manual masks.') + ' Rendering is an offline reproduction, browser export tested separately.', 'scope': 'Text only; barcodes, QR codes, faces and unannotated information are excluded.'}, 'summary': summaries, 'images': per_image}
(runs / args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summaries, indent=2))
