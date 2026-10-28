from pathlib import Path
from PIL import Image
import hashlib, json, math

root = Path(__file__).parent
out = root / 'runs' / 'input'
out.mkdir(parents=True, exist_ok=True)
samples = json.loads((root / 'annotations.json').read_text())['images']
samples.append(json.loads((root / 'stress-annotation.json').read_text()))
manifest = []
for sample in samples:
    path = root / 'originals' / (sample['id'] + '.png')
    img = Image.open(path).convert('RGB')
    assert img.size == (sample['width'], sample['height'])
    scale = min(2, 2600 / max(img.size), math.sqrt(6_000_000 / (img.width * img.height)))
    # Match the browser's Math.round for these positive dimensions.
    width, height = max(1, math.floor(img.width * scale + .5)), max(1, math.floor(img.height * scale + .5))
    img.resize((width, height), Image.Resampling.BILINEAR).save(out / (sample['id'] + '.png'))
    manifest.append({'id': sample['id'], 'width': img.width, 'height': img.height, 'inputWidth': width, 'inputHeight': height, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(root / 'runs' / 'inputs.json').write_text(json.dumps(manifest, indent=2) + '\n')
