"""Create new fictional layouts and annotations without OCR or detector output."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

root = Path(__file__).resolve().parents[1] / 'ground-truth'
out = root / 'originals'; out.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 22)
bold = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 22)
han = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 22)
samples = []

def make(identifier, width=850, height=500):
    image = Image.new('RGB', (width, height), 'white')
    return {'id':identifier, 'width':width, 'height':height, 'fields':[], 'public':[]}, image, ImageDraw.Draw(image)

def line(draw, x, y, text, kind=None, f=font):
    draw.text((x, y), text, fill='#202b24', font=f)
    b = draw.textbbox((x, y), text, font=f)
    rect = [int(b[0]), int(b[1]), int(b[2]+1), int(b[3]+1), text]
    return rect

def save(sample, image):
    image.save(out / (sample['id'] + '.png'))
    image.resize((image.width*2, image.height*2), Image.Resampling.BILINEAR).save(root/'runs'/'input'/(sample['id']+'.png'))
    samples.append(sample)

(root/'runs'/'input').mkdir(parents=True, exist_ok=True)
s, im, d = make('HoldoutDelivery')
line(d,35,24,'ORDER CONFIRMATION',f=bold)
line(d,35,90,'Delivery address',f=bold)
name=line(d,35,125,'Maya Brooks')
addr=[line(d,35,157,'21 Garden Avenue'),line(d,35,189,'Apt 7C'),line(d,35,221,'Denver CO 80201')]
line(d,35,270,'Item details',f=bold); control=line(d,35,304,'Green ceramic mug')
s['fields']=[{'category':'name','parts':[name]},{'category':'address','parts':addr}]; s['public']=[control]; save(s,im)

s, im, d = make('HoldoutColumns')
line(d,35,24,'ORDER SHIPPING',f=bold)
line(d,35,91,'Billing address',f=bold); line(d,455,91,'Ship to',f=bold)
name1=line(d,35,125,'Nora Bell'); name2=line(d,455,125,'Evan Reed')
addr1=[line(d,35,157,'77 Sunset Street'),line(d,35,189,'Portland OR 97201')]
addr2=[line(d,455,157,'31 Oak Road'),line(d,455,189,'Unit 4'),line(d,455,221,'Seattle WA 98101')]
line(d,35,285,'Order total',f=bold); control=line(d,35,317,'USD 27.50')
s['fields']=[{'category':'name','parts':[name1]},{'category':'address','parts':addr1},{'category':'name','parts':[name2]},{'category':'address','parts':addr2}]; s['public']=[control]; save(s,im)

s, im, d = make('HoldoutSender')
line(d,35,24,'PARCEL TRACKING',f=bold)
line(d,35,80,'From:',f=bold); name1=line(d,140,80,'Grace Wilson')
addr1=[line(d,140,112,'24 River Road'),line(d,140,144,'Austin TX 78701')]
line(d,35,210,'To:',f=bold); name2=line(d,140,210,'Jordan Lee')
addr2=[line(d,140,242,'93 Lake Street'),line(d,140,274,'Dallas TX 75201')]
line(d,35,335,'Description:',f=bold); control=line(d,190,335,'Board game')
s['fields']=[{'category':'name','parts':[name1]},{'category':'address','parts':addr1},{'category':'name','parts':[name2]},{'category':'address','parts':addr2}]; s['public']=[control]; save(s,im)

s, im, d = make('HoldoutNegative')
line(d,35,24,'TEAM MEETING NOTES',f=bold)
c1=line(d,35,90,'To: Morgan Taylor'); c2=line(d,35,130,'Room 123 - Design discussion')
c3=line(d,35,170,'Agenda: Product launch'); c4=line(d,35,210,'Budget: USD 250')
s['public']=[c1,c2,c3,c4]; save(s,im)

s, im, d = make('HoldoutChinese')
line(d,35,24,'訂單詳情',f=han); line(d,35,90,'收貨地址',f=han)
name=line(d,35,125,'李小明',f=han)
addr=[line(d,35,157,'香港九龍旺角彌敦道',f=han),line(d,35,189,'12 Example Street',f=font)]
line(d,35,250,'商品',f=han); control=line(d,35,282,'Desk lamp')
s['fields']=[{'category':'name','parts':[name]},{'category':'address','parts':addr}];s['public']=[control]; save(s,im)

(root/'holdout-annotations.json').write_text(json.dumps({'protocol':'Generated holdout layouts, labels from independent font measurements; created before contextual rule implementation.', 'images':samples},ensure_ascii=False,indent=2)+'\n')
import hashlib
manifest=[{'id':s['id'],'width':s['width'],'height':s['height'],'inputWidth':s['width']*2,'inputHeight':s['height']*2,'sha256':hashlib.sha256((out/(s['id']+'.png')).read_bytes()).hexdigest()} for s in samples]
(root/'runs'/'holdout-inputs.json').write_text(json.dumps(manifest,indent=2)+'\n')
