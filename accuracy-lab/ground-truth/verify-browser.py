from pathlib import Path
from io import BytesIO
from PIL import Image, ImageCms, ImageDraw
import hashlib, json
import numpy as np

root = Path(__file__).parent
source = root / 'originals' / 'Amazon.png'
export = root / 'runs' / 'browser-export-amazon.png'
sample = next(x for x in json.loads((root / 'annotations.json').read_text())['images'] if x['id'] == 'Amazon')
manifest = next(x for x in json.loads((root / 'runs' / 'inputs.json').read_text()) if x['id'] == 'Amazon')
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash == manifest['sha256'], 'The input file changed during the test'
original = Image.open(source)
saved = Image.open(export).convert('RGBA')
assert original.size == saved.size == (sample['width'], sample['height'])
pixels = np.asarray(saved)
opaque_mask = np.all(pixels == [32, 43, 36, 255], axis=2)
srgb = ImageCms.profileToProfile(original, ImageCms.ImageCmsProfile(BytesIO(original.info['icc_profile'])), ImageCms.createProfile('sRGB'), outputMode='RGBA')
original_pixels = np.asarray(srgb)
delta = np.max(np.abs(original_pixels.astype(np.int16) - pixels.astype(np.int16)), axis=2)
outside_max_delta = int(delta[~opaque_mask].max())
assert outside_max_delta <= 1, 'Non-mask pixels differ by more than one color level after sRGB conversion'
results = []
view = original.convert('RGB'); d = ImageDraw.Draw(view)
for i, field in enumerate(sample['fields'], 1):
    fractions = [float(opaque_mask[y0:y1, x0:x1].mean()) for x0, y0, x1, y1, _ in field['parts']]
    status = 'complete' if min(fractions) == 1 else 'partial' if max(fractions) > 0 else 'missed'
    for x0, y0, x1, y1, _ in field['parts']: d.rectangle((x0, y0, x1-1, y1-1), outline={'complete':'#00a464','partial':'#ef9700','missed':'#e72727'}[status], width=2)
    results.append({'id': f'Amazon-{i}', 'category': field['category'], 'status': status, 'coverage_by_part': fractions})
sheet = Image.new('RGB', (1060, max(view.height, saved.height) + 40), 'white'); draw = ImageDraw.Draw(sheet)
draw.text((8, 8), 'Original ground truth: green covered, red missed', fill='black')
draw.text((536, 8), 'Actual browser-downloaded PNG', fill='black')
sheet.paste(view, (8, 32)); sheet.paste(saved.convert('RGB'), (536, 32))
sheet.save(root / 'runs' / 'browser-amazon-comparison.png')
offline = np.asarray(Image.open(root / 'runs' / 'current' / 'exports' / 'Amazon.png').convert('RGBA'))
offline_mask = np.all(offline == [32, 43, 36, 255], axis=2)
union = int((opaque_mask | offline_mask).sum())
mask_iou = float((opaque_mask & offline_mask).sum()) / union if union else 1
result = {'source_sha256_before_and_after': source_hash, 'dimensions': list(saved.size), 'source_profile': ImageCms.getProfileName(ImageCms.ImageCmsProfile(BytesIO(original.info['icc_profile']))).strip(), 'outside_mask_max_srgb_channel_difference': outside_max_delta, 'export_metadata': list(saved.info.keys()), 'offline_mask_iou': mask_iou, 'fields': results}
(root / 'runs' / 'browser-amazon-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))

# This second PNG is the built-in pre-labelled example after actual AI analysis
# and a user expansion of the order box. These are export checks against known
# preset rectangles, not independent detection-accuracy ground truth.
ai_image = Image.open(root / 'runs' / 'browser-export-ai.png').convert('RGBA')
assert ai_image.size == (760, 1030)
ai_mask = np.all(np.asarray(ai_image) == [32, 43, 36, 255], axis=2)
preset = {'adjusted_order': [492,149,226,45], 'name': [60,621,250,37], 'phone': [417,621,290,37], 'address': [60,694,647,65], 'email': [60,794,510,37], 'payment': [398,891,309,37]}
coverage = {name: float(ai_mask[y:y+h, x:x+w].mean()) for name, (x,y,w,h) in preset.items()}
assert all(value == 1 for value in coverage.values())
(root / 'runs' / 'browser-ai-verification.json').write_text(json.dumps({'dimensions': list(ai_image.size), 'preset_and_adjusted_box_coverage': coverage}, indent=2) + '\n')
