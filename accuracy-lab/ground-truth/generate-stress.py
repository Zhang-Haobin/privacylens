"""Generate a fictional long screenshot and independent text-ink annotations."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

root = Path(__file__).parent
img = Image.new('RGB', (760, 4000), 'white')
draw = ImageDraw.Draw(img)
regular = '/System/Library/Fonts/Supplemental/Arial.ttf'
chinese = '/System/Library/Fonts/STHeiti Medium.ttc'
fields, controls = [], []
draw.text((35, 60), 'ACADEMIC TRANSCRIPT / EXAMPLE', font=ImageFont.truetype(regular, 25), fill='#202b24')
rows = [
    (150, 24, 'Student ID: ', '3030123456', 'student_id', '#222222', regular),
    (820, 15, 'Name: ', 'Example Person', 'name', '#222222', regular),
    (1600, 12, 'Phone: ', '+852 9123 4567', 'phone', '#999999', regular),
    (2400, 16, '訂單號: ', 'HK20261025002', 'order', '#222222', chinese),
    (3200, 12, 'Tracking No: ', 'SF0987654321098', 'tracking', '#222222', regular),
    (3850, 11, 'Address: ', '12 Example Lane', 'address', '#999999', regular),
]
for y, size, label, value, category, color, fontpath in rows:
    font = ImageFont.truetype(fontpath, size)
    x = 35
    draw.text((x, y), label, font=font, fill=color)
    value_x = x + draw.textlength(label, font=font)
    draw.text((value_x, y), value, font=font, fill=color)
    left, top, right, bottom = draw.textbbox((value_x, y), value, font=font)
    fields.append({'category': category, 'parts': [[int(left), int(top), int(right + 1), int(bottom + 1), value]], 'conditions': ['long image', f'{size}px', 'low contrast' if color == '#999999' else 'normal contrast']})
    lx, ly, lr, lb = draw.textbbox((x, y), label, font=font)
    controls.append([int(lx), int(ly), int(lr), int(lb), 'label'])
img.save(root / 'originals' / 'LongMixed.png')
(root / 'stress-annotation.json').write_text(json.dumps({'id': 'LongMixed', 'width': 760, 'height': 4000, 'language': 'eng+chi_tra+chi_sim', 'fields': fields, 'public': controls}, ensure_ascii=False, indent=2) + '\n')
