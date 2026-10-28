from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).parent
runs = root / 'runs'
cases = [
    ('DHL: phone under original selection overlay', 'DHL', (105, 219, 287, 246)),
    ('Long image: small, low-contrast phone', 'LongMixed', (30, 1595, 185, 1620)),
    ('Long image: small tracking number', 'LongMixed', (30, 3195, 230, 3220)),
    ('Long image: small, low-contrast address', 'LongMixed', (30, 3844, 180, 3870))
]
sheet = Image.new('RGB', (1100, 460), 'white'); d = ImageDraw.Draw(sheet)
for i, (label, sid, box) in enumerate(cases):
    y = i * 112
    d.text((10, y + 3), label, fill='black'); d.text((560, y + 3), 'Local automatic output (offline PNG)', fill='black')
    source = Image.open(root / 'originals' / (sid + '.png')).convert('RGB')
    output = Image.open(runs / 'current' / 'exports' / (sid + '.png')).convert('RGB')
    for x, image in [(10, source), (560, output)]:
        crop = image.crop(box); crop.thumbnail((520, 80)); crop = crop.resize((crop.width * 2, crop.height * 2))
        crop.thumbnail((520, 80)); sheet.paste(crop, (x, y + 24))
sheet.save(runs / 'ocr-failures.png')
