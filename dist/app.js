import { recognizeLocal } from './ocr.js';
import { createMaskAnimator } from './mask-motion.js';
import { localSuggestions, suggestionsToFields, textPayload, validateClassifications, shouldHide } from './ocr-core.js';
const $ = (id) => document.getElementById(id);
const canvas = $('previewCanvas');
const ctx = canvas.getContext('2d');
const maskLayer = document.createElement('div');
maskLayer.className = 'mask-layer'; maskLayer.setAttribute('aria-hidden', 'true'); canvas.after(maskLayer);
const previewMasks = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const maskAnimator = createMaskAnimator();
let motionOverride = null;
function motionEnabled() { return motionOverride ?? !reducedMotion.matches; }
let previewLoadId = -1;
const base = document.createElement('canvas');
const b = base.getContext('2d');
const state = { context: 'public', source: 'sample', view: 'protected', drawing: false, fields: [], manual: [], drag: null, filename: 'fictional-order.png', nextId: 1, loadId: 0, aiDetected: false, detecting: false, detectedModel: '', ocrDocument: null, phase: '', zoom: false, highlighted: null };
let detectionController = null;
let detectionId = 0;
const sampleFields = [
  { id: 'order', name: 'Order number', rect: [492, 149, 216, 35], publicReason: 'Not needed to ask a public audience about a delay.', supportReason: 'Helps official support find this specific order.' },
  { id: 'name', name: 'Full name', rect: [60, 621, 250, 37], publicReason: 'Identifies you without explaining the delivery issue.', supportReason: 'Not needed for this initial delivery-status enquiry.' },
  { id: 'phone', name: 'Phone number', rect: [417, 621, 290, 37], publicReason: 'A public audience does not need to contact you.', supportReason: 'Keep private unless verified support asks for it.' },
  { id: 'address', name: 'Delivery address', rect: [60, 694, 647, 65], publicReason: 'Reveals where you live; unrelated to the delay.', supportReason: 'Order number is enough for the initial lookup.' },
  { id: 'email', name: 'Email address', rect: [60, 794, 510, 37], publicReason: 'Personal contact details are not needed in a public post.', supportReason: 'No need to disclose it in this initial screenshot.' },
  { id: 'payment', name: 'Payment details', rect: [398, 891, 309, 37], publicReason: 'Payment information does not explain a shipping delay.', supportReason: 'A delivery enquiry does not require card details.' }
];

function round(context, x, y, w, h, r, color) { context.fillStyle = color; context.beginPath(); context.roundRect(x, y, w, h, r); context.fill(); }
function txt(text, x, y, size = 22, color = '#273b32', weight = 400) { b.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; b.fillStyle = color; b.fillText(text, x, y); }
function line(x1, y1, x2, y2, color = '#e8ece5', width = 1) { b.strokeStyle = color; b.lineWidth = width; b.beginPath(); b.moveTo(x1, y1); b.lineTo(x2, y2); b.stroke(); }
function drawSample() {
  base.width = 760; base.height = 1030;
  b.fillStyle = '#fff'; b.fillRect(0, 0, 760, 1030);
  txt('parcel.', 48, 67, 38, '#285b48', 700);
  txt('YOUR EVERYDAY STORE', 446, 63, 15, '#98a08f', 500);
  line(0, 101, 760, 101);
  txt('Order details', 52, 174, 28, '#293b31', 600);
  txt('#PL-2048-7612', 503, 174, 24, '#6a7765', 500);
  round(b, 48, 211, 664, 270, 13, '#f3f6ee');
  round(b, 71, 235, 152, 33, 16, '#eae4c8');
  txt('DELIVERY UPDATE', 84, 257, 13, '#9a7d36', 600);
  txt('Delayed in transit', 72, 313, 37, '#364a33', 600);
  txt('Your parcel is taking a little longer than expected.', 73, 352, 19, '#929a84');
  line(89, 396, 652, 396, '#dde4d4', 4);
  line(89, 396, 370, 396, '#688c62', 4);
  [89, 370, 652].forEach((x, i) => { b.beginPath(); b.arc(x, 396, 7, 0, Math.PI * 2); b.fillStyle = i < 2 ? '#688c62' : '#d2dbca'; b.fill(); });
  txt('Ordered', 71, 433, 17, '#526d49', 500); txt('12 Oct', 71, 458, 15, '#9aa38d');
  txt('In transit', 334, 433, 17, '#526d49', 500); txt('15 Oct · last update', 297, 458, 15, '#9aa38d');
  txt('Delivery', 595, 433, 17, '#909b84', 500); txt('Expected 16 Oct', 552, 458, 15, '#9aa38d');
  round(b, 49, 511, 78, 67, 9, '#ecefe7');
  b.strokeStyle = '#819477'; b.lineWidth = 5; b.beginPath(); b.arc(88, 541, 19, Math.PI, 0); b.stroke();
  round(b, 66, 539, 11, 22, 5, '#91a186'); round(b, 99, 539, 11, 22, 5, '#91a186');
  txt('Everyday wireless headphones', 148, 539, 20, '#475a40', 500);
  txt('Sage green  /  Qty 1', 148, 569, 17, '#98a08e');
  txt('HK$ 299', 601, 551, 20, '#52624a', 500);
  line(49, 596, 711, 596);
  txt('RECIPIENT', 64, 618, 13, '#a0a893', 500); txt('Alex Chan', 66, 648, 24, '#506047');
  txt('PHONE', 425, 618, 13, '#a0a893', 500); txt('+852 5550 0136', 425, 648, 24, '#506047');
  txt('DELIVERY ADDRESS', 64, 685, 13, '#a0a893', 500);
  txt('Flat 8B, 12 Example Lane,', 66, 719, 23, '#506047'); txt('Demo District, Hong Kong', 66, 749, 23, '#506047');
  txt('EMAIL', 64, 784, 13, '#a0a893', 500); txt('alex.chan@example.com', 66, 822, 23, '#506047');
  line(49, 856, 711, 856);
  txt('TOTAL PAID', 64, 884, 13, '#a0a893', 500); txt('HK$ 299.00', 66, 922, 25, '#506047', 500);
  txt('PAYMENT METHOD', 406, 884, 13, '#a0a893', 500); txt('Visa ···· 4821', 406, 919, 23, '#506047');
  line(49, 955, 711, 955);
  txt('FICTIONAL SAMPLE  /  FOR DEMONSTRATION ONLY', 155, 994, 13, '#b1b7a9', 500);
}

function recommendedHidden(field) { return shouldHide(field, state.context); }
function resetFields() {
  if (state.ocrDocument || state.fields.some(field => field.id.startsWith('ocr-'))) { state.fields.forEach(field => { field.hidden = recommendedHidden(field); }); return; }
  state.fields = state.source === 'sample' ? sampleFields.map(f => ({ ...f, hidden: recommendedHidden(f) })) : [];
}
function cancelDetection() {
  detectionId++; detectionController?.abort(); detectionController = null; state.detecting = false; state.phase = '';
}
function clearDetection() {
  cancelDetection(); state.aiDetected = false; state.detectedModel = ''; state.ocrDocument = null; state.highlighted = null; state.zoom = false; $('aiConsent').checked = false;
  setAIStatus('Start with local text recognition. Nothing is sent to AI until you choose classification.');
}
function setSample() {
  state.loadId++;
  clearDetection();
  state.source = 'sample'; state.filename = 'fictional-order.png'; state.fields = []; state.manual = []; state.nextId = 1; state.view = 'protected'; state.drag = null;
  setDrawing(false); drawSample(); resetFields(); render();
}
function setContext(context) {
  if (state.context === context) return;
  state.context = context; state.drag = null;
  resetFields(); render();
  announce(state.ocrDocument ? 'Sharing recommendations reapplied. Field switches reset; hand-drawn masks retained. Review every suggestion.' : state.source === 'sample' ? (context === 'support' ? 'Support recommendations applied. Order number stays visible. Other sample fields stay masked.' : 'Public recommendations applied. All six sample fields are masked.') : 'Context changed. Your manual masks are retained. Read text locally or add masks manually.');
}
function drawImage(target, includeMasks = true) {
  target.width = base.width; target.height = base.height;
  const c = target.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, target.width, target.height); c.drawImage(base, 0, 0);
  if (includeMasks) {
    c.fillStyle = '#202b24';
    [...state.fields.filter(f => f.hidden).map(f => f.rect), ...state.manual.map(m => m.rect)].forEach(r => c.fillRect(...r));
  }
}
function transitionMask(record, visible, animate) {
  if (record.visible === visible && animate) return;
  maskAnimator.set(record, visible, animate, () => {
    if (!record.visible) { record.element.remove(); previewMasks.delete(record.key); }
  });
}
function renderMaskLayer() {
  // Animate only the preview. Export always paints the complete final masks.
  const newImage = previewLoadId !== state.loadId;
  if (newImage) {
    previewMasks.forEach(record => maskAnimator.cancel(record));
    previewMasks.clear(); maskLayer.replaceChildren(); previewLoadId = state.loadId;
  }
  maskLayer.hidden = state.view !== 'protected';
  const animate = !newImage && !maskLayer.hidden && motionEnabled();
  $('motionButton').textContent = motionEnabled() ? 'Animation on' : 'Animation off';
  $('motionButton').setAttribute('aria-pressed', String(motionEnabled()));
  const masks = [
    ...state.fields.filter(field => field.hidden).map(field => ({ key: `field-${field.id}`, rect: field.rect })),
    ...state.manual.map(mask => ({ key: `manual-${mask.id}`, rect: mask.rect }))
  ];
  const active = new Set(masks.map(mask => mask.key));
  masks.forEach(({ key, rect: [x, y, width, height] }, index) => {
    let record = previewMasks.get(key);
    if (!record) {
      const element = document.createElement('div'); element.className = 'preview-mask';
      element.style.clipPath = 'inset(0 100% 0 0)'; maskLayer.append(element);
      record = { key, element, visible: false, progress: 0, motion: null }; previewMasks.set(key, record);
    }
    Object.assign(record.element.style, {
      left: `${x / base.width * 100}%`, top: `${y / base.height * 100}%`,
      width: `${width / base.width * 100}%`, height: `${height / base.height * 100}%`, zIndex: String(index)
    });
    transitionMask(record, true, animate);
  });
  previewMasks.forEach(record => { if (!active.has(record.key)) transitionMask(record, false, animate); });
}
reducedMotion.addEventListener('change', renderMaskLayer);
$('motionButton').addEventListener('click', () => { motionOverride = !motionEnabled(); render(); });
function renderCanvas() {
  drawImage(canvas, false);
  renderMaskLayer();
  $('canvasWrap').style.width = state.zoom ? `${base.width}px` : `min(100%, ${Math.min(395, 640 * base.width / base.height)}px)`;
  $('canvasStage').classList.toggle('zoomed', state.zoom);
  $('zoomButton').textContent = state.zoom ? 'Fit image' : 'Zoom to 100%';
  $('zoomButton').setAttribute('aria-pressed', String(state.zoom));
  if (state.highlighted && state.view === 'protected') {
    const field = state.fields.find(f => f.id === state.highlighted);
    if (field) { ctx.strokeStyle = '#e7b71e'; ctx.lineWidth = Math.max(3, base.width / 220); ctx.strokeRect(...field.rect); }
  }
  if (state.drag) {
    const r = dragRect(); ctx.fillStyle = '#202b24'; ctx.fillRect(...r); ctx.strokeStyle = '#c6db7a'; ctx.lineWidth = Math.max(2, base.width / 350); ctx.strokeRect(...r);
  }
}
function countMasks() { return state.fields.filter(f => f.hidden).length + state.manual.length; }
function renderFields() {
  const list = $('fieldList'); list.replaceChildren();
  if (state.fields.length === 0) {
    const p = document.createElement('p'); p.className = 'empty-fields'; p.textContent = state.ocrDocument ? 'No suggestions are available. This does not mean the image is safe. Classify the text with AI or add masks for anything missed.' : 'Read text locally, or select “Add a mask” and cover details manually.'; list.append(p);
  }
  state.fields.forEach(field => {
    const row = document.createElement('div'); row.className = 'field-row'; row.id = `field-${field.id}`;
    const top = document.createElement('div'); top.className = 'field-top';
    const title = document.createElement('button'); title.type = 'button'; title.className = 'field-name field-locate'; title.setAttribute('aria-label', `Locate ${field.name.toLowerCase()}`);
    title.addEventListener('click', () => {
      state.highlighted = field.id; state.view = 'protected'; state.zoom = true; renderCanvas();
      $('canvasStage').scrollIntoView({ block: 'center', behavior: 'smooth' });
      const [x, y, w, h] = field.rect; $('canvasStage').scrollLeft = Math.max(0, x + w / 2 - $('canvasStage').clientWidth / 2); $('canvasStage').scrollTop = Math.max(0, y + h / 2 - $('canvasStage').clientHeight / 2);
    });
    const dot = document.createElement('span'); dot.className = `field-dot ${field.hidden ? '' : 'keep'}`;
    title.append(dot, document.createTextNode(field.name));
    const label = document.createElement('label'); label.className = 'field-switch';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = field.hidden; input.setAttribute('aria-label', `Hide ${field.name.toLowerCase()}`);
    const track = document.createElement('span'); track.className = 'switch-track'; track.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span'); status.textContent = field.hidden ? 'Hide' : 'Keep';
    label.append(input, track, status); top.append(title, label);
    const reason = document.createElement('p'); reason.className = `field-reason ${field.hidden ? '' : 'keep'}`;
    const recommended = recommendedHidden(field);
    reason.textContent = field.hidden !== recommended ? (field.hidden ? 'Your choice: hide this detail for this screenshot.' : 'Your choice: keep visible. Check it is needed for this audience.') : (state.context === 'public' ? field.publicReason : field.supportReason);
    input.addEventListener('change', () => { field.hidden = input.checked; state.view = 'protected'; render(); document.querySelector(`#field-${field.id} input`)?.focus({ preventScroll: true }); });
    row.append(top, reason); list.append(row);
  });
  const manualList = $('manualList'); manualList.replaceChildren();
  state.manual.forEach(mask => {
    const row = document.createElement('div'); row.className = 'manual-row';
    const name = document.createElement('span'); name.textContent = `Manual mask ${mask.id}`;
    const remove = document.createElement('button'); remove.setAttribute('aria-label', `Remove manual mask ${mask.id}`); remove.innerHTML = '<svg><use href="#i-x"/></svg>';
    remove.addEventListener('click', () => { state.manual = state.manual.filter(m => m.id !== mask.id); render(); });
    row.append(name, remove); manualList.append(row);
  });
}
function render() {
  showMaskTarget(null);
  renderCanvas(); renderFields();
  const isPublic = state.context === 'public'; const isSample = state.source === 'sample'; const count = countMasks();
  $('publicContext').classList.toggle('selected', isPublic); $('publicContext').setAttribute('aria-pressed', String(isPublic));
  $('supportContext').classList.toggle('selected', !isPublic); $('supportContext').setAttribute('aria-pressed', String(!isPublic));
  $('sampleButton').classList.toggle('selected', isSample);
  $('contextExplanation').querySelector('p').textContent = isPublic ? 'A public post needs the delivery status, but not the details that identify you or your order.' : 'For this initial delivery enquiry, official support needs the order number. Other personal details stay masked unless you choose otherwise.';
  $('reviewIntro').textContent = state.ocrDocument ? `${state.aiDetected ? 'OCR + AI' : 'Local OCR'} suggestions for ${isPublic ? 'a public post' : 'official support'}. Click a field to locate it; toggle to change it.` : isSample ? `Suggested masks for ${isPublic ? 'a public post' : 'official support'}. Toggle any field to change it.` : 'Read text locally, optionally classify it with AI, and check every part of the image.';
  $('demoNotice').textContent = state.detecting ? 'Detection is running. Earlier masks stay until new suggestions are ready.' : state.ocrDocument ? (state.aiDetected ? `Text classified by ${state.detectedModel}; positions from local OCR. Check for missed text and codes.` : 'Local rules only: names and addresses still need AI classification or manual masks. Earlier masks retained.') : isSample ? 'Sample fields are pre-labelled. OCR and AI are optional.' : 'No text recognition has been run on this image.';
  $('maskCount').textContent = String(count);
  $('summaryText').textContent = `${count} ${count === 1 ? 'mask' : 'masks'} applied`;
  $('fileLabel').textContent = state.filename;
  $('originalView').classList.toggle('active', state.view === 'original'); $('originalView').setAttribute('aria-pressed', String(state.view === 'original'));
  $('protectedView').classList.toggle('active', state.view === 'protected'); $('protectedView').setAttribute('aria-pressed', String(state.view === 'protected'));
  $('canvasHint').textContent = state.drawing ? 'Drag to add a mask · Click “Add a mask” to stop' : state.view === 'original' ? 'Original preview · Switch to Protected to remove masks' : 'Click a mask to remove it · Solid masks on export';
  $('previewNote').textContent = state.drawing ? 'Drag to cover a detail. Click “Add a mask” again or press Escape to remove masks.' : state.view === 'original' ? 'Original preview — selected masks are still applied to export.' : (state.ocrDocument ? 'Click a mask to reveal that detail. Check for missed text, codes and faces.' : isSample ? 'Click a mask to reveal that detail. Delivery status, item and timeline stay readable.' : 'Click a mask to reveal that detail. Check every part of the image.');
  $('preserveNote').querySelector('strong').textContent = isSample ? 'The useful part stays.' : 'Review the whole image.';
  $('preserveNote').querySelector('p').textContent = isSample ? 'Delivery status, product and dates help explain the delay.' : 'Sensitive details outside your masks will remain visible in the export.';
  $('undoButton').disabled = state.manual.length === 0;
  $('ocrButton').disabled = state.detecting;
  $('ocrButton').textContent = state.phase === 'ocr' ? 'Reading text…' : 'Read text locally';
  $('ocrLanguage').disabled = state.detecting;
  $('detectButton').disabled = state.detecting || !$('aiConsent').checked || !state.ocrDocument?.words.length;
  $('detectButton').textContent = state.phase === 'ai' ? 'Classifying…' : 'Classify text with AI';
  $('cancelDetectionButton').hidden = !state.detecting;
  $('exportButton').disabled = state.detecting;
  $('aiConsent').disabled = state.detecting;
  canvas.setAttribute('aria-label', `${isSample ? 'Fictional order screenshot' : 'Your uploaded screenshot'}, ${state.view === 'original' ? 'original view' : `${count} masks applied`}`);
}
let toastTimer;
function announce(message) { const toast = $('toast'); toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5800); }
function setDrawing(enabled) { state.drawing = enabled; state.drag = null; $('canvasWrap').classList.toggle('drawing', enabled); $('drawButton').setAttribute('aria-pressed', String(enabled)); $('drawHint').hidden = !enabled; if (enabled) state.view = 'protected'; }
function point(event) { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(base.width, (event.clientX - r.left) * base.width / r.width)), Math.max(0, Math.min(base.height, (event.clientY - r.top) * base.height / r.height))]; }
function maskAtPoint([x, y]) {
  if (state.drawing || state.view !== 'protected') return null;
  const contains = ({ rect: [left, top, width, height] }) => x >= left && x < left + width && y >= top && y < top + height;
  // Match paint order: remove only the topmost mask when regions overlap.
  const manual = state.manual.findLast(contains);
  if (manual) return { manual, name: `Manual mask ${manual.id}` };
  const field = state.fields.findLast(field => field.hidden && contains(field));
  return field ? { field, name: field.name } : null;
}
function showMaskTarget(target) {
  canvas.classList.toggle('mask-target', Boolean(target));
  if (target) canvas.title = `Click to remove: ${target.name}`;
  else canvas.removeAttribute('title');
}
function dragRect() { const { start, end } = state.drag; return [Math.floor(Math.min(start[0], end[0])), Math.floor(Math.min(start[1], end[1])), Math.ceil(Math.abs(end[0] - start[0])), Math.ceil(Math.abs(end[1] - start[1]))]; }
canvas.addEventListener('click', event => {
  const target = maskAtPoint(point(event));
  if (!target) return;
  if (target.manual) state.manual = state.manual.filter(mask => mask !== target.manual);
  else { target.field.hidden = false; if (state.highlighted === target.field.id) state.highlighted = null; }
  render();
  announce(`Removed: ${target.name}. Review the preview before exporting.`);
});
canvas.addEventListener('pointerdown', event => {
  if (!state.drawing) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId); const p = point(event); state.drag = { start: p, end: p }; $('drawHint').hidden = true;
});
canvas.addEventListener('pointermove', event => {
  if (!state.drag) { showMaskTarget(maskAtPoint(point(event))); return; }
  state.drag.end = point(event); renderCanvas();
});
canvas.addEventListener('pointerleave', () => showMaskTarget(null));
canvas.addEventListener('pointerup', event => {
  if (!state.drag) return;
  state.drag.end = point(event); const rect = dragRect();
  if (rect[2] >= 5 && rect[3] >= 5) { state.manual.push({ id: state.nextId++, rect }); announce('Manual mask added. You can remove it in the review panel.'); }
  state.drag = null; render();
});
canvas.addEventListener('pointercancel', () => { state.drag = null; renderCanvas(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.drawing) { setDrawing(false); render(); } });
$('drawButton').addEventListener('click', () => { setDrawing(!state.drawing); render(); if (state.drawing) announce('Drag over a detail on the image to cover it. Press Escape to stop drawing.'); });
$('undoButton').addEventListener('click', () => { state.manual.pop(); render(); });
$('resetButton').addEventListener('click', () => { cancelDetection(); state.manual = []; state.nextId = 1; resetFields(); state.view = 'protected'; setDrawing(false); render(); setAIStatus('Recommendations reset. Review the whole image before sharing.'); announce(state.aiDetected ? 'AI recommendations reset for this audience; manual masks removed.' : state.source === 'sample' ? 'Sample recommendations reset for the selected audience.' : 'Manual masks removed. Run AI detection or add masks manually.'); });
$('publicContext').addEventListener('click', () => setContext('public'));
$('supportContext').addEventListener('click', () => setContext('support'));
$('sampleButton').addEventListener('click', () => { setSample(); $('fileInput').value = ''; announce('Fictional sample loaded. Recommendations applied for the current audience.'); });
$('originalView').addEventListener('click', () => { state.view = 'original'; setDrawing(false); render(); });
$('protectedView').addEventListener('click', () => { state.view = 'protected'; render(); });
$('uploadButton').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { announce('Please choose a PNG, JPEG or WebP image.'); event.target.value = ''; return; }
  if (file.size > 20 * 1024 * 1024) { announce('This image exceeds 20 MB. Please choose a smaller file.'); event.target.value = ''; return; }
  const loadId = ++state.loadId;
  cancelDetection(); render();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (loadId !== state.loadId) return;
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 20000000) throw new Error('size');
    base.width = image.naturalWidth; base.height = image.naturalHeight; b.fillStyle = '#fff'; b.fillRect(0, 0, base.width, base.height); b.drawImage(image, 0, 0);
    clearDetection(); state.source = 'upload'; state.filename = file.name; state.fields = []; state.manual = []; state.nextId = 1; state.view = 'protected'; setDrawing(false); render();
    announce('Image opened locally. Read text on this device or add masks manually. AI text classification is optional.');
  } catch(error) { if (loadId === state.loadId) announce(error.message === 'size' ? 'Image is too large to edit here (20 megapixels maximum).' : 'This image could not be opened. Please try another PNG, JPEG or WebP.'); }
  finally { URL.revokeObjectURL(url); event.target.value = ''; }
});
function setAIStatus(message, error = false) { $('aiStatus').textContent = message; $('aiStatus').dataset.error = String(error); }
async function readAPI(response) {
  let result;
  try { result = await response.json(); }
  catch { throw new Error('AI backend is unavailable. Start with npm run dev, or deploy the API functions to Vercel.'); }
  if (!response.ok) throw new Error(result.error || 'The AI request failed. Try again later.');
  return result;
}
$('aiConsent').addEventListener('change', render);
function mergeLocalFields(previous, added) {
  const merged = [...previous.map(f => ({ ...f, category: f.category || f.id })), ...added];
  return merged.filter((field, i) => !merged.slice(0, i).some(f => f.category === field.category && f.rect.every((n, k) => n === field.rect[k])))
    .map((field, i) => ({ ...field, id: `ocr-${i + 1}`, hidden: field.hidden ?? recommendedHidden(field) }));
}
$('zoomButton').addEventListener('click', () => { state.zoom = !state.zoom; renderCanvas(); });
$('cancelDetectionButton').addEventListener('click', () => { cancelDetection(); render(); setAIStatus('Detection cancelled. Earlier masks retained. A sent AI request may still finish at the provider.'); });
$('ocrLanguage').addEventListener('change', () => {
  state.ocrDocument = null; state.aiDetected = false; state.detectedModel = ''; $('aiConsent').checked = false;
  render(); setAIStatus('Language changed. Earlier masks retained. Read the text again before AI classification.');
});
$('ocrButton').addEventListener('click', async () => {
  if (state.detecting) return;
  const currentId = ++detectionId; const loadId = state.loadId;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 90_000);
  state.detecting = true; state.phase = 'ocr'; setDrawing(false); render();
  setAIStatus('Loading local text recognition. Models are loaded from this site; your image stays on this device.');
  try {
    const document = await recognizeLocal(base, { language: $('ocrLanguage').value, signal: controller.signal, onProgress: message => {
      if (currentId === detectionId && loadId === state.loadId) setAIStatus(`Local OCR · ${message.status}${Number.isFinite(message.progress) ? ` · ${Math.round(message.progress * 100)}%` : ''}`);
    } });
    if (currentId !== detectionId || loadId !== state.loadId || controller.signal.aborted) return;
    const suggestions = suggestionsToFields(localSuggestions(document), document);
    state.fields = mergeLocalFields(state.fields, suggestions); state.ocrDocument = document; state.aiDetected = false; state.detectedModel = ''; state.view = 'protected'; state.highlighted = null;
    setAIStatus(`${document.words.length} text words read locally. ${suggestions.length} local mask suggestions added; earlier masks retained. ${document.words.length ? 'Review names and addresses manually or opt in to AI text classification.' : 'No text found: add masks manually. This does not mean the image is safe.'}`);
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) setAIStatus(error.name === 'AbortError' ? 'Local OCR timed out. Earlier masks retained; try a smaller image.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (currentId === detectionId) { state.detecting = false; state.phase = ''; detectionController = null; render(); }
  }
});
$('detectButton').addEventListener('click', async () => {
  if (state.detecting || !$('aiConsent').checked || !state.ocrDocument?.words.length) return;
  const currentId = ++detectionId; const loadId = state.loadId;
  const document = state.ocrDocument;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 55_000);
  state.detecting = true; state.phase = 'ai'; setDrawing(false); render(); setAIStatus('Sending recognized text and its layout to the configured AI provider. The image stays on this device…');
  try {
    const payload = textPayload(document);
    const result = await readAPI(await fetch('/api/ai?action=classify-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
    }));
    if (currentId !== detectionId || loadId !== state.loadId || controller.signal.aborted) return;
    const classified = validateClassifications(result.fields, document);
    const fields = suggestionsToFields([...classified, ...localSuggestions(document)], document);
    // Build everything first: an invalid result cannot partially replace existing masks.
    state.fields = fields.map(field => ({ ...field, hidden: recommendedHidden(field) }));
    state.aiDetected = true; state.detectedModel = result.model; state.view = 'protected'; state.highlighted = null;
    setAIStatus(`${fields.length} OCR-positioned mask suggestions, with text classification from ${result.provider}. Check missed text, QR codes and barcodes.`);
    announce('Text classification ready. Positions come from local OCR. Review the whole image.');
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) setAIStatus(error.name === 'AbortError' ? 'Detection timed out. Existing masks retained; retry or add masks manually.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (currentId === detectionId) { state.detecting = false; state.phase = ''; detectionController = null; render(); }
  }
});
$('aboutButton').addEventListener('click', () => $('aboutDialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
let exportBlob = null; let exportUrl = null;
$('exportButton').addEventListener('click', async () => {
  if (state.detecting) return;
  const button = $('exportButton'); button.disabled = true;
  try {
    setDrawing(false); render();
    const output = document.createElement('canvas'); drawImage(output, true);
    exportBlob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (!exportBlob) throw new Error('encoding');
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(exportBlob); $('exportPreview').src = exportUrl;
    $('exportContext').textContent = state.context === 'public' ? 'For a public post about a delivery delay. Check that no identifying details remain visible.' : 'For verified official support to locate this order. Check the recipient before sharing.';
    const kept = state.fields.filter(f => !f.hidden).map(f => f.name.toLowerCase());
    $('exportDetails').textContent = `${countMasks()} solid ${countMasks() === 1 ? 'mask' : 'masks'} applied. ${state.ocrDocument ? `${state.aiDetected ? `Text classification: ${state.detectedModel}.` : 'Local OCR rules only: names and addresses may still be visible.'} OCR can miss text. Check all edges, QR codes, barcodes and faces. ${kept.length ? `Kept visible: ${kept.join(', ')}.` : ''}` : state.source === 'sample' ? (kept.length ? `Visible personal fields: ${kept.join(', ')}.` : 'All six labelled personal fields are covered.') : 'No current OCR classification is available. Review every part of the image.'} ${countMasks() === 0 ? 'There are no redactions on this copy.' : ''}`;
    $('reviewConfirmation').checked = false; $('downloadButton').disabled = true; $('exportDialog').showModal();
  } catch { announce('Could not prepare the image. Please try again with a smaller image.'); }
  finally { button.disabled = false; }
});
$('reviewConfirmation').addEventListener('change', event => { $('downloadButton').disabled = !event.target.checked; });
$('downloadButton').addEventListener('click', () => {
  if (!$('reviewConfirmation').checked || !exportBlob || !exportUrl) return;
  const link = document.createElement('a'); link.href = exportUrl; link.download = `privacylens-${state.context}-${state.source === 'sample' ? 'sample' : 'image'}.png`; document.body.append(link); link.click(); link.remove();
  $('exportDialog').close(); announce('PNG download started. Review the saved image before sharing.');
});
$('exportDialog').addEventListener('close', () => { if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; exportBlob = null; } $('exportPreview').removeAttribute('src'); });
setSample();
