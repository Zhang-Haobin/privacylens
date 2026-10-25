const $ = (id) => document.getElementById(id);
const canvas = $('previewCanvas');
const ctx = canvas.getContext('2d');
const base = document.createElement('canvas');
const b = base.getContext('2d');
const state = { context: 'public', source: 'sample', view: 'protected', drawing: false, fields: [], manual: [], drag: null, filename: 'fictional-order.png', nextId: 1, loadId: 0, aiDetected: false, detecting: false, detectedModel: '' };
let detectionController = null;
let detectionId = 0;
const categoryNames = { order: 'Order / tracking number', name: 'Personal name', phone: 'Phone number', address: 'Address', email: 'Email address', payment: 'Payment details', id: 'Identity document', account: 'Account identifier', code: 'QR code / barcode', face: 'Identifiable face', other: 'Sensitive detail' };
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

function recommendedHidden(field) { return state.context === 'public' || (field.category || field.id) !== 'order'; }
function resetFields() {
  if (state.aiDetected) { state.fields.forEach(field => { field.hidden = recommendedHidden(field); }); return; }
  state.fields = state.source === 'sample' ? sampleFields.map(f => ({ ...f, hidden: recommendedHidden(f) })) : [];
}
function cancelDetection() {
  detectionId++; detectionController?.abort(); detectionController = null; state.detecting = false;
}
function clearDetection() {
  cancelDetection(); state.aiDetected = false; state.detectedModel = ''; $('aiConsent').checked = false;
  setAIStatus('Your image stays local until you choose AI detection.');
}
function setSample() {
  state.loadId++;
  clearDetection();
  state.source = 'sample'; state.filename = 'fictional-order.png'; state.manual = []; state.nextId = 1; state.view = 'protected'; state.drag = null;
  setDrawing(false); drawSample(); resetFields(); render();
}
function setContext(context) {
  if (state.context === context) return;
  state.context = context; state.drag = null;
  resetFields(); render();
  announce(state.aiDetected ? 'Sharing recommendations reapplied to detected fields. Manual masks retained. Review every suggestion.' : state.source === 'sample' ? (context === 'support' ? 'Support recommendations applied. Order number stays visible. Other sample fields stay masked.' : 'Public recommendations applied. All six sample fields are masked.') : 'Context changed. Your manual masks are retained. Run AI detection or add masks manually.');
}
function drawImage(target, includeMasks = true) {
  target.width = base.width; target.height = base.height;
  const c = target.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, target.width, target.height); c.drawImage(base, 0, 0);
  if (includeMasks) {
    c.fillStyle = '#202b24';
    [...state.fields.filter(f => f.hidden).map(f => f.rect), ...state.manual.map(m => m.rect)].forEach(r => c.fillRect(...r));
  }
}
function renderCanvas() {
  drawImage(canvas, state.view === 'protected');
  $('canvasWrap').style.width = `min(100%, ${Math.min(395, 640 * base.width / base.height)}px)`;
  if (state.drag) {
    const r = dragRect(); ctx.fillStyle = '#202b24'; ctx.fillRect(...r); ctx.strokeStyle = '#c6db7a'; ctx.lineWidth = Math.max(2, base.width / 350); ctx.strokeRect(...r);
  }
}
function countMasks() { return state.fields.filter(f => f.hidden).length + state.manual.length; }
function renderFields() {
  const list = $('fieldList'); list.replaceChildren();
  if (state.fields.length === 0) {
    const p = document.createElement('p'); p.className = 'empty-fields'; p.textContent = state.aiDetected ? 'The model returned no sensitive regions. This does not mean the image is safe. Review the whole image and add masks for anything it missed.' : 'No detection has been run on this image. Use optional AI detection or select “Add a mask” and cover details manually.'; list.append(p);
  }
  state.fields.forEach(field => {
    const row = document.createElement('div'); row.className = 'field-row'; row.id = `field-${field.id}`;
    const top = document.createElement('div'); top.className = 'field-top';
    const title = document.createElement('span'); title.className = 'field-name';
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
  renderCanvas(); renderFields();
  const isPublic = state.context === 'public'; const isSample = state.source === 'sample'; const count = countMasks();
  $('publicContext').classList.toggle('selected', isPublic); $('publicContext').setAttribute('aria-pressed', String(isPublic));
  $('supportContext').classList.toggle('selected', !isPublic); $('supportContext').setAttribute('aria-pressed', String(!isPublic));
  $('sampleButton').classList.toggle('selected', isSample);
  $('contextExplanation').querySelector('p').textContent = isPublic ? 'A public post needs the delivery status, but not the details that identify you or your order.' : 'For this initial delivery enquiry, official support needs the order number. Other personal details stay masked unless you choose otherwise.';
  $('reviewIntro').textContent = state.aiDetected ? `AI suggestions for ${isPublic ? 'a public post' : 'official support'}. Review the positions, add missed masks and toggle any field.` : isSample ? `Suggested masks for ${isPublic ? 'a public post' : 'official support'}. Toggle any field to change it.` : 'Your image, your choices. Run optional AI detection or add masks manually.';
  $('demoNotice').textContent = state.detecting ? 'Detection is running. Existing masks are retained until a valid result arrives.' : state.aiDetected ? `AI detection: ${state.detectedModel}. Suggested boxes may be inaccurate or incomplete.` : isSample ? 'Sample fields are pre-labelled. AI detection is optional.' : 'No AI detection has been run on this image.';
  $('maskCount').textContent = String(count);
  $('summaryText').textContent = `${count} ${count === 1 ? 'mask' : 'masks'} applied`;
  $('fileLabel').textContent = state.filename;
  $('originalView').classList.toggle('active', state.view === 'original'); $('originalView').setAttribute('aria-pressed', String(state.view === 'original'));
  $('protectedView').classList.toggle('active', state.view === 'protected'); $('protectedView').setAttribute('aria-pressed', String(state.view === 'protected'));
  $('previewNote').textContent = state.view === 'original' ? 'Original preview — selected masks are still applied to export.' : (state.aiDetected ? 'Check all suggested boxes and add masks for missed details.' : isSample ? 'Delivery status, item and timeline stay readable.' : 'Check every part of the image. Use AI or add masks manually.');
  $('preserveNote').querySelector('strong').textContent = isSample ? 'The useful part stays.' : 'Review the whole image.';
  $('preserveNote').querySelector('p').textContent = isSample ? 'Delivery status, product and dates help explain the delay.' : 'Sensitive details outside your masks will remain visible in the export.';
  $('undoButton').disabled = state.manual.length === 0;
  $('detectButton').disabled = state.detecting || !$('aiConsent').checked;
  $('detectButton').textContent = state.detecting ? 'Detecting…' : 'Detect sensitive details';
  $('exportButton').disabled = state.detecting;
  $('aiConsent').disabled = state.detecting;
  canvas.setAttribute('aria-label', `${isSample ? 'Fictional order screenshot' : 'Your uploaded screenshot'}, ${state.view === 'original' ? 'original view' : `${count} masks applied`}`);
}
let toastTimer;
function announce(message) { const toast = $('toast'); toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5800); }
function setDrawing(enabled) { state.drawing = enabled; state.drag = null; $('canvasWrap').classList.toggle('drawing', enabled); $('drawButton').setAttribute('aria-pressed', String(enabled)); $('drawHint').hidden = !enabled; if (enabled) state.view = 'protected'; }
function point(event) { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(base.width, (event.clientX - r.left) * base.width / r.width)), Math.max(0, Math.min(base.height, (event.clientY - r.top) * base.height / r.height))]; }
function dragRect() { const { start, end } = state.drag; return [Math.floor(Math.min(start[0], end[0])), Math.floor(Math.min(start[1], end[1])), Math.ceil(Math.abs(end[0] - start[0])), Math.ceil(Math.abs(end[1] - start[1]))]; }
canvas.addEventListener('pointerdown', event => {
  if (!state.drawing) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId); const p = point(event); state.drag = { start: p, end: p }; $('drawHint').hidden = true;
});
canvas.addEventListener('pointermove', event => { if (!state.drag) return; state.drag.end = point(event); renderCanvas(); });
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
    announce('Image opened locally. Choose AI detection to send it for analysis, or add masks manually.');
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
function detectionImage() {
  const output = document.createElement('canvas');
  let scale = Math.min(1, 2400 / Math.max(base.width, base.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    output.width = Math.max(1, Math.round(base.width * scale)); output.height = Math.max(1, Math.round(base.height * scale));
    output.getContext('2d').drawImage(base, 0, 0, output.width, output.height);
    const image = output.toDataURL('image/jpeg', 0.9);
    if (image.length < 3_700_000) return { image, width: output.width, height: output.height };
    scale *= 0.75;
  }
  throw new Error('Could not shrink the image enough for detection. Choose a smaller screenshot.');
}
$('detectButton').addEventListener('click', async () => {
  if (state.detecting || !$('aiConsent').checked) return;
  const currentId = ++detectionId; const loadId = state.loadId;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 55_000);
  state.detecting = true; setDrawing(false); render(); setAIStatus('Sending an unmasked, resized copy to the configured AI provider…');
  try {
    const payload = { ...detectionImage(), consent: true };
    const result = await readAPI(await fetch('/api/ai?action=detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
    }));
    if (currentId !== detectionId || loadId !== state.loadId) return;
    state.fields = result.fields.map(field => {
      const [x, y, w, h] = field.box;
      // Add a small margin and scale normalized boxes back to the original canvas.
      const left = Math.max(0, Math.floor(x * base.width) - 5); const top = Math.max(0, Math.floor(y * base.height) - 5);
      const right = Math.min(base.width, Math.ceil((x + w) * base.width) + 5); const bottom = Math.min(base.height, Math.ceil((y + h) * base.height) + 5);
      return { id: field.id, category: field.category, name: categoryNames[field.category] || 'Sensitive detail', rect: [left, top, right - left, bottom - top],
        publicReason: 'AI marked this as personal or identifying information. Check the box covers it fully.',
        supportReason: field.category === 'order' ? 'Can help verified official support locate this order. Check the recipient and value before keeping it visible.' : 'Not needed for an initial delivery-status enquiry. Check the suggested box.',
        hidden: recommendedHidden(field) };
    });
    state.aiDetected = true; state.detectedModel = result.model; state.view = 'protected';
    setAIStatus(`${result.fields.length} suggested regions from ${result.provider}. Check every box and add masks for missed details.`);
    announce('AI suggestions ready. Review the entire image; detection can miss details.');
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) setAIStatus(error.name === 'AbortError' ? 'Detection timed out. Existing masks retained; retry or add masks manually.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (currentId === detectionId) { state.detecting = false; detectionController = null; render(); }
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
    $('exportDetails').textContent = `${countMasks()} solid ${countMasks() === 1 ? 'mask' : 'masks'} applied. ${state.aiDetected ? `AI suggestions from ${state.detectedModel} may miss details or place boxes incorrectly. ${kept.length ? `Kept visible: ${kept.join(', ')}.` : ''}` : state.source === 'sample' ? (kept.length ? `Visible personal fields: ${kept.join(', ')}.` : 'All six labelled personal fields are covered.') : 'Uploaded image: no AI detection was performed.'} ${countMasks() === 0 ? 'There are no redactions on this copy.' : ''}`;
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
