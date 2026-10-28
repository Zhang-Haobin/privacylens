import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, localSuggestions, suggestionsToFields } from '../dist/ocr-core.js';
import { reconcileFields } from '../dist/field-state.js';

const word = (text, x, y, width = Math.max(15, text.length * 9), height = 20) => ({ text, confidence:95, bbox:{ x0:x, y0:y, x1:x+width, y1:y+height } });
const doc = words => makeDocument([{ blocks:[{ paragraphs:[{ lines:[{ words }] }] }] }], 900, 650, 900, 650);
const fields = words => { const image = doc(words); return suggestionsToFields(localSuggestions(image), image); };

test('a labelled delivery block creates separate name and address masks and stops before the product', () => {
  const result = fields([
    word('Order details',20,10,150), word('Ship to',20,60,75),
    word('Maya',20,90,45), word('Brooks',70,90,58),
    word('21',20,120,20), word('Garden',45,120,55), word('Avenue',105,120,60),
    word('Apt',20,150,28), word('7C',53,150,24),
    word('Denver',20,180,58), word('CO',83,180,22), word('80201',110,180,50),
    word('Phone:',20,210,58), word('+852',83,210,40), word('9123',128,210,40), word('4567',173,210,40),
    word('Ceramic',20,240,70), word('mug',95,240,32)
  ]);
  assert.ok(result.some(f=>f.category==='name' && f.anchor==='Maya Brooks' && f.role==='recipient'));
  assert.equal(result.filter(f=>f.category==='address').length, 3);
  assert.ok(result.filter(f=>f.category==='address').every(f=>f.rect[1]+f.rect[3] < 210));
  assert.ok(result.some(f=>f.category==='phone'));
});

test('sender and recipient labels stop the preceding block and retain separate roles', () => {
  const result = fields([
    word('Tracking',20,10,80), word('From:',20,60,55), word('Grace',160,60,55), word('Wilson',220,60,60),
    word('24',160,90,20), word('River',185,90,45), word('Road',235,90,40),
    word('Toronto,',160,120,72), word('ON',237,120,20), word('M5V',262,120,35), word('3A8',302,120,35),
    word('To:',20,155,30), word('Jordan',160,155,60), word('Lee',225,155,30),
    word('93',160,185,20), word('Lake',185,185,42), word('Street',232,185,55)
  ]);
  assert.ok(result.some(f=>f.category==='name' && f.role==='sender' && f.anchor==='Grace Wilson'));
  assert.ok(result.some(f=>f.category==='name' && f.role==='recipient' && f.anchor==='Jordan Lee'));
  assert.ok(result.some(f=>f.category==='address' && f.role==='sender' && f.anchor.includes('Toronto')));
  assert.ok(!result.some(f=>f.category==='address' && f.role==='sender' && f.anchor.includes('Jordan')));
});

test('unlabelled discussion or a recipient without address evidence does not become a delivery block', () => {
  for (const words of [
    [word('Meeting notes',20,10,140), word('To:',20,60,30), word('Morgan',75,60,60), word('Taylor',140,60,60), word('Room',20,100,40), word('123',65,100,30)],
    [word('Order status',20,10,140), word('Ship to',20,60,70), word('Processing',20,90,100), word('Item details',20,120,100), word('Ceramic mug',20,150,110)]
  ]) assert.ok(!fields(words).some(f=>['name','address'].includes(f.category)));
});

test('contextual address masks do not expand into a nearby tall OCR artifact or distant column', () => {
  const image = doc([word('Shipping address',20,40,155), word('Maya',20,70,45), word('Brooks',70,70,58), word('21',20,100,20), word('Garden',45,100,55), word('Road',105,100,45), word('BRAND',400,85,120,100)]);
  const result = suggestionsToFields(localSuggestions(image), image);
  const address = result.find(f=>f.category==='address');
  assert.ok(address && address.rect[0]+address.rect[2]<300 && address.rect[1]+address.rect[3]<150);
});

test('matching a contextual line on rescan keeps an edited box and visibility choice', () => {
  const image = doc([word('Ship to',20,40,75), word('Maya',20,70,45), word('Brooks',70,70,58), word('21',20,100,20), word('Garden',45,100,55), word('Road',105,100,45)]);
  const detected = suggestionsToFields(localSuggestions(image), image).find(f=>f.category==='address');
  assert.ok(detected);
  const previous = { ...detected, id:'kept', rect:[15,95,150,32], matchingRect:[...detected.rect], geometryOverride:true, userOverride:'keep', hidden:false };
  const reconciled = reconcileFields([previous], [detected]);
  assert.deepEqual(reconciled.fields[0].rect, previous.rect);
  assert.equal(reconciled.fields[0].userOverride, 'keep');
});
