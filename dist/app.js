import { AI_BUDGET } from './ai-policy.js';
import { readAPI } from './api-client.js';
import { recognizeLocal } from './ocr.js';
import { createMaskAnimator } from './mask-motion.js';
import { maskTargetAtPoint, textLineTargets } from './mask-targets.js';
import { localSuggestions, suggestionsToFields, textPayload, validateClassifications } from './ocr-core.js';
import { audiences, applyRecommendations, sharingPlan, contextDifference, guardSuggestedReveals } from './sharing-context.js';
import { documentTypes, purposesFor, purposeRegistry, classifyDocument, suggestTypeFromAI } from './document-context.js';
import { reconcileFields, aiInsights, activeMasks, coverageSummary } from './field-state.js';
import { drawExtraSample } from './samples.js';
import { fitImageScale, workspaceLayout } from './editor-geometry.js';
import { sharingProfiles, profileForContext } from './workflow.js';
import { adjustMaskRect } from './mask-geometry.js';
import { createIntroDemo, initialEntry, rememberIntro } from './intro.js';
const $ = (id) => document.getElementById(id);
const canvas = $('previewCanvas');
const ctx = canvas.getContext('2d');
const maskLayer = document.createElement('div');
maskLayer.className = 'mask-layer'; maskLayer.setAttribute('aria-hidden', 'true'); canvas.after(maskLayer);
const previewMasks = new Map();
const lineHighlight = document.createElement('div');
lineHighlight.className = 'text-line-highlight'; lineHighlight.hidden = true;
lineHighlight.setAttribute('aria-hidden', 'true'); maskLayer.after(lineHighlight);
const adjustLayer = document.createElement('div'); adjustLayer.className = 'mask-adjust'; adjustLayer.hidden = true;
lineHighlight.after(adjustLayer);
for (const handle of ['nw', 'ne', 'sw', 'se', 'move']) {
  const button = document.createElement('button'); button.type = 'button'; button.className = `mask-handle-${handle}`;
  button.dataset.handle = handle;
  button.setAttribute('aria-label', handle === 'move' ? 'Move mask with arrow keys or drag' : `Resize ${handle} corner with arrow keys or drag`);
  button.textContent = handle === 'move' ? '↔' : '';
  adjustLayer.append(button);
}
let textLines = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const maskAnimator = createMaskAnimator();
let motionOverride = null;
function motionEnabled() { return motionOverride ?? !reducedMotion.matches; }
let previewLoadId = -1;
const base = document.createElement('canvas');
const b = base.getContext('2d');
const state = { flow: 'landing', hasImage: false, sharingProfile: '', reviewExpanded: false, expandedField: null, context: 'public', purpose: 'advice', documentType: 'delivery', typeSource: 'sample', typeReason: '', sampleKind: 'delivery', customPurpose: '', recipientDetail: '', nextFieldId: 1, source: 'sample', view: 'protected', drawing: false, fields: [], manual: [], drag: null, adjusting: null, filename: 'fictional-order.png', nextId: 1, loadId: 0, aiDetected: false, detecting: false, detectedModel: '', ocrDocument: null, phase: '', zoom: null, fitMode: 'auto', panning: false, reviewWidth: 380, aiStatus: 'idle', aiInsights: [], aiTypeSuggestion: null, highlighted: null };
let hoveredField = null;
let contextOptionsType = null;
let contextUndo = null;
let contextFeedback = '';
// Only the intro preference is persisted. Images and editing choices stay in memory.
let entryStorage;
try { entryStorage = window.localStorage; } catch { /* Private browsing can deny access. */ }
state.flow = initialEntry(window.location.hash, entryStorage);
const introDemo = createIntroDemo($('introDemo'), reducedMotion);
const routeForFlow = () => state.flow === 'intro' ? '#intro' : state.flow === 'landing' ? '#upload' : '#workspace';
history.replaceState(null, '', routeForFlow());
function navigateEntry(flow) {
  if (state.flow === 'intro' && flow !== 'intro') rememberIntro(entryStorage);
  cancelDetection(); closeWorkDialogs();
  state.flow = flow === 'review' && !state.hasImage ? 'landing' : flow;
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
  $(state.flow === 'intro' ? 'introHeading' : state.flow === 'landing' ? 'uploadHeading' : 'previewHeading').focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => {
  const requested = window.location.hash;
  const flow = requested === '#intro' ? 'intro' : requested === '#workspace' && state.hasImage ? 'review' : 'landing';
  // A workspace link cannot restore an image after a page reload.
  if (requested !== (flow === 'intro' ? '#intro' : flow === 'landing' ? '#upload' : '#workspace')) history.replaceState(null, '', flow === 'intro' ? '#intro' : '#upload');
  navigateEntry(flow);
});
let detectionController = null;
let detectionId = 0;
const sampleFields = [
  { id: 'order', name: 'Order number', rect: [492, 149, 216, 35] },
  { id: 'name', name: 'Full name', rect: [60, 621, 250, 37] },
  { id: 'phone', name: 'Phone number', rect: [417, 621, 290, 37] },
  { id: 'address', name: 'Delivery address', rect: [60, 694, 647, 65] },
  { id: 'email', name: 'Email address', rect: [60, 794, 510, 37] },
  { id: 'payment', name: 'Payment details', rect: [398, 891, 309, 37] }
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

function resetFields(clearOverrides = false) {
  const previous = state.fields.map(field => ({ ...field }));
  if (clearOverrides) state.fields.forEach(field => { field.userOverride = null; });
  state.fields = applyRecommendations(state.fields, state);
  if (clearOverrides) state.fields = guardSuggestedReveals(previous, state.fields);
}
function currentPlan() {
  const plan = sharingPlan(state.context, state.purpose, state.documentType);
  plan.label = `${documentTypes[state.documentType].label} · ${plan.label}`;
  return plan;
}
function setFieldChoice(field, hidden) {
  clearContextChange(); field.userOverride = hidden ? 'redact' : 'keep'; field.pendingReveal = false; field.hidden = hidden;
}
function cancelDetection() {
  if (state.phase === 'ai' && state.aiStatus === 'processing') state.aiStatus = 'failed';
  detectionId++; detectionController?.abort(); detectionController = null; state.detecting = false; state.phase = '';
}
function clearDetection() {
  textLines = [];
  state.adjusting = null;
  cancelDetection(); state.aiDetected = false; state.detectedModel = ''; state.aiStatus = 'idle'; state.aiInsights = []; state.aiTypeSuggestion = null; state.ocrDocument = null; state.highlighted = null; state.zoom = null; state.fitMode = 'auto'; clearContextChange(); $('aiConsent').checked = false;
  setAIStatus('Ready for local text recognition. AI assistance is optional.');
}
function normalizeContext() {
  const config = documentTypes[state.documentType];
  if (!config.audiences.includes(state.context)) state.context = '';
  if (!config.purposes.includes(state.purpose)) state.purpose = '';
}
function setSample(kind = state.sampleKind) {
  if (!['delivery', 'transcript', 'chat', 'technical_screenshot'].includes(kind)) return;
  state.loadId++; clearDetection(); hoveredField = null;
  state.sampleKind = kind; state.documentType = kind; state.typeSource = 'sample';
  state.typeReason = 'Fictional sample type supplied. Scan locally to test recognition, or correct it yourself.';
  state.context = ''; state.purpose = ''; state.sharingProfile = '';
  state.customPurpose = ''; state.recipientDetail = '';
  state.source = 'sample'; state.filename = `fictional-${kind}.png`; state.manual = []; state.nextId = 1; state.nextFieldId = 1; state.view = 'protected'; state.drag = null;
  setDrawing(false);
  if (kind === 'delivery') { drawSample(); state.fields = sampleFields.map(field => ({ ...field, category: field.id, anchor: ({order: '#PL-2048-7612', name: 'Alex Chan', phone: '+852 5550 0136', address: 'Flat 8B, 12 Example Lane, Demo District, Hong Kong', email: 'alex.chan@example.com', payment: 'Visa ···· 4821'})[field.id], source: 'sample', userOverride: null })); }
  else state.fields = drawExtraSample(base, kind);
  resetFields(); render(); setAIStatus('Fictional example with pre-labelled regions. Scan locally to test OCR; AI is optional.');
}
function clearContextChange() { contextUndo = null; contextFeedback = ''; }
function setContext(context, purpose = state.purpose, type = state.documentType, manualType = false) {
  if (!Object.hasOwn(documentTypes, type) || (context && !Object.hasOwn(audiences, context))) return;
  if (state.context === context && state.purpose === purpose && state.documentType === type && !manualType) return;
  const previous = { context: state.context, purpose: state.purpose, documentType: state.documentType, typeSource: state.typeSource, typeReason: state.typeReason, sharingProfile: state.sharingProfile, loadId: state.loadId, fields: state.fields.map(({ id, hidden, userOverride, pendingReveal }) => ({ id, hidden, userOverride, pendingReveal })) };
  state.context = context; state.purpose = purpose; state.documentType = type; state.sharingProfile = '';
  if (manualType) { state.typeSource = 'manual'; state.typeReason = 'Type selected by you. Local scans will not replace your choice.'; }
  normalizeContext(); state.drag = null; state.view = 'protected'; resetFields();
  state.fields = guardSuggestedReveals(previous.fields, state.fields);
  const changes = contextDifference(previous.fields, state.fields);
  const names = values => values.length > 3 ? `${values.slice(0, 3).join(', ')} and ${values.length - 3} more` : values.join(', ');
  contextFeedback = [changes.hidden.length ? `Newly masked: ${names(changes.hidden)}.` : '', changes.visible.length ? `Now visible: ${names(changes.visible)}.` : ''].filter(Boolean).join(' ') || 'Context updated. Actual mask selection unchanged.';
  const pending = state.fields.filter(field => field.pendingReveal).length;
  if (pending) contextFeedback += ` ${pending} suggested ${pending === 1 ? 'detail remains' : 'details remain'} hidden until you review them.`;
  const overrides = state.fields.filter(field => field.userOverride).length;
  if (overrides) contextFeedback += ` ${overrides} user ${overrides === 1 ? 'choice kept' : 'choices kept'}; review them for this audience.`;
  if (!state.purpose || !state.context) contextFeedback += ' Choose a recipient and purpose for this type.';
  contextUndo = previous; render();
  announce(contextFeedback, { undo: true });
}
$('undoContext').addEventListener('click', () => {
  if (!contextUndo || contextUndo.loadId !== state.loadId || state.detecting) return;
  const previous = contextUndo, fields = new Map(previous.fields.map(field => [field.id, field]));
  for (const key of ['context', 'purpose', 'documentType', 'typeSource', 'typeReason', 'sharingProfile']) state[key] = previous[key];
  state.fields.forEach(field => { if (fields.has(field.id)) { field.userOverride = fields.get(field.id).userOverride; field.pendingReveal = fields.get(field.id).pendingReveal; } });
  state.view = 'protected'; resetFields(); clearContextChange(); render(); $('sharingPurpose').focus({ preventScroll: true });
  announce('Previous type, recipient, purpose and field choices restored. Added masks stay in place.');
});
function updateTypeFromText(document) {
  if (state.typeSource === 'manual') return;
  const result = classifyDocument(document);
  if (state.documentType !== result.type) state.sharingProfile = '';
  state.documentType = result.type; state.typeSource = 'local'; state.typeReason = result.reason;
  normalizeContext();
}
function receiveFields(incoming) {
  state.adjusting = null;
  const candidates = incoming.map(field => ({ ...field, id: `scan-${state.nextFieldId++}` }));
  const previous = state.fields;
  const result = reconcileFields(previous, candidates);
  state.fields = guardSuggestedReveals(previous, applyRecommendations(result.fields, state));
  return result;
}
function renderContextOptions() {
  const config = documentTypes[state.documentType];
  if (contextOptionsType !== state.documentType) {
    contextOptionsType = state.documentType;
    $('customAudience').replaceChildren();
    for (const key of ['', ...config.audiences]) {
      const option = document.createElement('option'); option.value = key; option.textContent = key ? audiences[key].label : 'Choose an audience…'; $('customAudience').append(option);
    }
    for (const id of ['sharingPurpose', 'customSharingPurpose']) {
      $(id).replaceChildren();
      for (const key of ['', ...purposesFor(state.documentType)]) {
        const option = document.createElement('option'); option.value = key; option.textContent = key ? purposeRegistry[key].label : 'Choose a purpose…'; $(id).append(option);
      }
    }
  }
  $('documentType').value = state.documentType; $('sharingPurpose').value = state.purpose; $('customAudience').value = state.context; $('customSharingPurpose').value = state.purpose;
  $('typeEvidence').textContent = state.typeReason;
  $('useLocalType').hidden = state.typeSource !== 'manual'; $('useLocalType').disabled = !state.ocrDocument;
  $('customContext').hidden = state.purpose !== 'custom';
  $('customPurpose').value = state.customPurpose; $('recipientDetail').value = state.recipientDetail;
  renderProfiles();
  $('sampleSelect').value = state.sampleKind;
  $('sampleTitle').textContent = documentTypes[state.sampleKind].label;
  $('sampleMeta').textContent = 'Fictional sample · pre-labelled';
}
function drawImage(target, includeMasks = true) {
  target.width = base.width; target.height = base.height;
  const c = target.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, target.width, target.height); c.drawImage(base, 0, 0);
  if (includeMasks) {
    c.fillStyle = '#202b24';
    activeMasks(state.fields, state.manual).forEach(({ rect }) => c.fillRect(...rect));
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
  const masks = activeMasks(state.fields, state.manual);
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
function isLongImage() { return base.height / base.width >= 3; }
function currentFitScale() {
  const stage = $('canvasStage'), style = getComputedStyle(stage);
  const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (state.fitMode === 'width' || (state.fitMode === 'auto' && isLongImage())) return width > 0 ? Math.min(1, width / base.width) : 1;
  return fitImageScale(base.width, base.height, width, height);
}
let layoutFrame = 0;
function scheduleWorkspaceLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    const workspace = $('editorWorkspace');
    if (!state.hasImage || window.matchMedia('(max-width: 900px)').matches) {
      workspace.style.removeProperty('--workspace-width');
      return;
    }
    const height = workspace.clientHeight - document.querySelector('.preview-header').offsetHeight - document.querySelector('.preview-toolbar').offsetHeight - document.querySelector('.preview-footnote').offsetHeight - 40;
    const layout = workspaceLayout(base.width, base.height, $('workspacePage').clientWidth, Math.max(1, height), state.reviewWidth);
    if (!layout) return;
    workspace.style.setProperty('--workspace-width', `${layout.workspaceWidth}px`);
    workspace.style.setProperty('--review-width', `${layout.reviewWidth}px`);
  });
}
new ResizeObserver(scheduleWorkspaceLayout).observe($('workspacePage'));
window.addEventListener('resize', scheduleWorkspaceLayout);
function updateCanvasSize() {
  const scale = state.zoom ?? currentFitScale();
  $('canvasWrap').style.width = `${base.width * scale}px`;
  $('canvasStage').classList.toggle('zoomed', state.zoom !== null);
  $('zoomLevel').textContent = `${Math.round(scale * 100)}%`;
  const widthFit = state.zoom === null && (state.fitMode === 'width' || (state.fitMode === 'auto' && isLongImage()));
  $('fitButton').setAttribute('aria-pressed', String(state.zoom === null && !widthFit));
  $('widthButton').setAttribute('aria-pressed', String(widthFit));
  $('zoomButton').setAttribute('aria-pressed', String(state.zoom === 1));
  $('zoomOutButton').disabled = scale <= 0.01;
  $('zoomInButton').disabled = scale >= 4;
}
new ResizeObserver(() => { updateCanvasSize(); scheduleWorkspaceLayout(); }).observe($('canvasStage'));
function setZoom(scale, fitMode = state.fitMode) {
  keepPreviewVisible();
  const stage = $('canvasStage');
  const oldScale = state.zoom ?? currentFitScale();
  const stageRect = stage.getBoundingClientRect(), imageRect = canvas.getBoundingClientRect();
  const centerX = (stageRect.left + stage.clientWidth / 2 - imageRect.left) / oldScale;
  const centerY = (stageRect.top + stage.clientHeight / 2 - imageRect.top) / oldScale;
  state.fitMode = fitMode; state.zoom = scale === null ? null : Math.max(0.01, Math.min(4, scale));
  updateCanvasSize();
  const nextScale = state.zoom ?? currentFitScale();
  const nextRect = canvas.getBoundingClientRect();
  stage.scrollLeft += nextRect.left + centerX * nextScale - stageRect.left - stage.clientWidth / 2;
  stage.scrollTop += nextRect.top + centerY * nextScale - stageRect.top - stage.clientHeight / 2;
}
function keepPreviewVisible() {
  const panel = document.querySelector('.preview-panel');
  if (getComputedStyle(panel).position !== 'sticky') return;
  const bounds = panel.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
    window.scrollBy({ top: bounds.top - parseFloat(getComputedStyle(panel).top), behavior: 'auto' });
  }
}
function renderCanvas() {
  drawImage(canvas, false);
  renderMaskLayer(); updateCanvasSize();
  renderAdjustLayer();
  if ((state.highlighted || hoveredField) && state.view === 'protected') {
    const field = state.fields.find(f => f.id === (hoveredField || state.highlighted));
    if (field) { ctx.strokeStyle = '#e7b71e'; ctx.lineWidth = Math.max(3, base.width / 220); ctx.strokeRect(...field.rect); }
  }
  if (state.drag) {
    const r = dragRect(); ctx.fillStyle = '#202b24'; ctx.fillRect(...r); ctx.strokeStyle = '#c6db7a'; ctx.lineWidth = Math.max(2, base.width / 350); ctx.strokeRect(...r);
  }
}
function adjustedMask() {
  if (!state.adjusting) return null;
  const list = state.adjusting.type === 'field' ? state.fields : state.manual;
  return list.find(mask => mask.id === state.adjusting.id) || null;
}
function renderAdjustLayer() {
  const mask = adjustedMask();
  adjustLayer.hidden = !mask || state.view !== 'protected';
  if (!mask || adjustLayer.hidden) return;
  const [x, y, width, height] = mask.rect;
  Object.assign(adjustLayer.style, { left: `${x / base.width * 100}%`, top: `${y / base.height * 100}%`, width: `${width / base.width * 100}%`, height: `${height / base.height * 100}%` });
}
function setAdjusting(type, id) {
  if (state.adjusting?.type === type && state.adjusting.id === id) state.adjusting = null;
  else {
    setDrawing(false); setPanning(false); state.view = 'protected'; state.zoom = 1;
    state.adjusting = { type, id };
    if (window.matchMedia('(max-width: 900px)').matches) state.reviewExpanded = false;
    if (type === 'field') state.highlighted = id;
  }
  render();
  if (state.adjusting) {
    const [x, y, width, height] = adjustedMask().rect;
    const stage = $('canvasStage');
    stage.scrollLeft = Math.max(0, x + width / 2 - stage.clientWidth / 2);
    stage.scrollTop = Math.max(0, y + height / 2 - stage.clientHeight / 2);
    adjustLayer.querySelector('.mask-handle-move')?.focus({ preventScroll: true });
  }
}
function countMasks() { return activeMasks(state.fields, state.manual).length; }
function locateField(field) {
      state.highlighted = field.id; state.expandedField = field.id; state.view = 'protected'; state.zoom = 1;
      if (window.matchMedia('(max-width: 900px)').matches) state.reviewExpanded = false;
      render();
      if (window.matchMedia('(max-width: 900px)').matches) $('previewHeading').focus({ preventScroll: true });
      else document.querySelector(`#field-${field.id} .field-locate`)?.focus({ preventScroll: true });
      const panel = document.querySelector('.preview-panel');
      if (getComputedStyle(panel).position === 'sticky') keepPreviewVisible();
      else panel.scrollIntoView({ block: 'start', behavior: 'auto' });
      const [x, y, w, h] = field.rect; $('canvasStage').scrollLeft = Math.max(0, x + w / 2 - $('canvasStage').clientWidth / 2); $('canvasStage').scrollTop = Math.max(0, y + h / 2 - $('canvasStage').clientHeight / 2);
}
function renderFields() {
  const list = $('fieldList'); list.replaceChildren();
  if (state.fields.length === 0) {
    const p = document.createElement('p'); p.className = 'empty-fields'; p.textContent = state.detecting ? 'Reading your image on this device…' : 'No details are suggested here. Check the whole image and add masks for anything private.'; list.append(p);
  }
  const priority = { review: 0, redact: 1, keep: 2 };
  const orderedFields = [...state.fields].sort((a, b) => priority[a.recommendation.action] - priority[b.recommendation.action]);
  orderedFields.forEach(field => {
    const row = document.createElement('div'); row.className = `field-row${state.highlighted === field.id ? ' active' : ''}`; row.id = `field-${field.id}`;
    const top = document.createElement('div'); top.className = 'field-top';
    const title = document.createElement('button'); title.type = 'button'; title.className = 'field-name field-locate'; title.setAttribute('aria-label', `Locate ${field.name.toLowerCase()}`); title.title = 'Locate and highlight in the image';
    title.addEventListener('mouseenter', () => { hoveredField = field.id; renderCanvas(); });
    title.addEventListener('mouseleave', () => { hoveredField = null; renderCanvas(); });
    title.addEventListener('click', () => locateField(field));
    const dot = document.createElement('span'); dot.className = `field-dot ${field.hidden ? '' : 'keep'}`;
    title.append(dot, document.createTextNode(field.name));
    const label = document.createElement('label'); label.className = 'field-switch';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = field.hidden; input.setAttribute('aria-label', `Hide ${field.name.toLowerCase()}`);
    const track = document.createElement('span'); track.className = 'switch-track'; track.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span'); status.textContent = field.hidden ? 'Hidden' : 'Visible';
    label.append(input, track, status);
    const info = document.createElement('button'); info.type = 'button'; info.className = 'field-info'; info.textContent = 'ⓘ'; info.setAttribute('aria-label', `Details for ${field.name}`); info.setAttribute('aria-expanded', String(state.expandedField === field.id));
    info.addEventListener('click', () => { state.expandedField = state.expandedField === field.id ? null : field.id; render(); document.querySelector(`#field-${field.id} .field-info`)?.focus({ preventScroll: true }); });
    const adjust = document.createElement('button'); adjust.type = 'button'; adjust.className = 'field-adjust'; adjust.textContent = state.adjusting?.id === field.id ? 'Done' : 'Adjust box';
    adjust.setAttribute('aria-label', `Adjust box for ${field.name}`);
    adjust.setAttribute('aria-pressed', String(state.adjusting?.type === 'field' && state.adjusting.id === field.id));
    adjust.addEventListener('click', () => setAdjusting('field', field.id));
    top.append(title, info, adjust, label);
    const reason = document.createElement('p'); reason.className = `field-reason ${field.hidden ? '' : 'keep'}`;
    const recommendation = field.recommendation;
    const source = field.retained ? 'Earlier protected region' : field.source === 'ai' ? 'AI text classification' : field.source === 'local' ? 'Local text recognition' : 'Fictional example';
    reason.textContent = `${recommendation.reason} Source: ${source}.${field.userOverride ? ' Your choice is preserved; check that it is still needed for this audience.' : ''}`;
    input.addEventListener('change', () => { setFieldChoice(field, input.checked); state.view = 'protected'; render(); document.querySelector(`#field-${field.id} input`)?.focus({ preventScroll: true }); });
    const choice = document.createElement('span'); choice.className = `field-choice${field.userOverride ? ' custom' : ''}`;
    const statusLabel = { redact: 'Hide', keep: 'Keep', review: 'Needs review · masked by default' }[recommendation.action];
    choice.textContent = `${field.userOverride ? 'Your choice · ' : ''}Recommended: ${statusLabel}`;
    row.dataset.recommendation = recommendation.action;
    if (field.userOverride || field.pendingReveal) {
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'inline-action'; restore.textContent = 'Use suggestion'; restore.setAttribute('aria-label', `Use suggestion for ${field.name.toLowerCase()}`);
      restore.addEventListener('click', () => { clearContextChange(); field.userOverride = null; field.pendingReveal = false; resetFields(); render(); document.querySelector(`#field-${field.id} .field-locate`)?.focus({ preventScroll: true }); });
      choice.append(document.createTextNode(' · '), restore);
    }
    const details = document.createElement('div'); details.className = 'field-explanation'; details.hidden = state.expandedField !== field.id;
    details.append(reason, choice);
    if ((recommendation.action === 'review' || field.pendingReveal) && !field.userOverride) { const badge = document.createElement('span'); badge.className = 'field-attention'; badge.textContent = 'Check'; title.append(badge); }
    row.append(top, details); list.append(row);
  });
  const manualList = $('manualList'); manualList.replaceChildren();
  state.manual.forEach(mask => {
    const row = document.createElement('div'); row.className = 'manual-row';
    const hidden = mask.hidden !== false;
    const maskName = mask.name || `Manual mask ${mask.id}`;
    const name = document.createElement('span'); name.textContent = `${maskName}${hidden ? '' : ' · visible'}`;
    const toggle = document.createElement('button'); toggle.setAttribute('aria-label', `${hidden ? 'Remove' : 'Restore'} ${maskName.toLowerCase()}`);
    if (hidden) toggle.innerHTML = '<svg><use href="#i-x"/></svg>';
    else toggle.textContent = 'Restore';
    toggle.addEventListener('click', () => { mask.hidden = !hidden; render(); });
    const adjust = document.createElement('button'); adjust.type = 'button'; adjust.textContent = 'Adjust box'; adjust.setAttribute('aria-label', `Adjust box for ${maskName.toLowerCase()}`);
    adjust.addEventListener('click', () => setAdjusting('manual', mask.id));
    row.append(name, adjust, toggle); manualList.append(row);
  });
  const lineList = $('ocrLineList'); const lineScroll = lineList.scrollTop; lineList.replaceChildren();
  $('ocrLinesPanel').hidden = !textLines.length;
  $('ocrLinesSummary').textContent = `Recognized text · ${textLines.length} lines`;
  textLines.forEach(line => {
    const mask = lineMask(line);
    const hidden = Boolean(mask && mask.hidden !== false);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ocr-line-button';
    button.setAttribute('aria-pressed', String(hidden)); button.title = line.text;
    const label = document.createElement('span'); label.textContent = line.text;
    const action = document.createElement('small'); action.textContent = hidden ? 'Reveal' : 'Mask';
    button.append(label, action);
    button.addEventListener('click', () => {
      toggleTextLine(line); setDrawing(false); state.view = 'protected'; render();
      const index = textLines.indexOf(line); $('ocrLineList').children[index]?.focus({ preventScroll: true });
    });
    lineList.append(button);
  });
  lineList.scrollTop = lineScroll;
}
function lineMask(line) { return state.manual.find(mask => mask.source === 'ocr-line' && mask.lineKey === line.key); }
function toggleTextLine(line) {
  let mask = lineMask(line);
  if (!mask) {
    mask = { id: state.nextId++, name: line.name, source: 'ocr-line', lineKey: line.key, rect: [...line.rect], hidden: false };
    state.manual.push(mask);
  }
  mask.hidden = !mask.hidden;
  return mask;
}
function render() {
  showMaskTarget(null);
  renderCanvas(); renderFields();
  const isSample = state.source === 'sample'; const count = countMasks();
  const plan = currentPlan(); renderContextOptions();
  $('contextFeedback').hidden = !contextUndo; $('contextChanges').textContent = contextFeedback; $('undoContext').disabled = state.detecting;
  $('aiPrerequisite').textContent = state.ocrDocument?.words.length ? 'Classify names, addresses and other private text from the local scan.' : 'Read text locally first to enable AI classification.';
  $('sampleButton').classList.toggle('selected', isSample);
  $('contextKeep').textContent = plan.keep; $('contextHide').textContent = plan.hide; $('contextNote').textContent = plan.note;
  $('contextSummary').hidden = !state.context || !state.purpose;
  $('contextSummary').textContent = 'We suggest hiding private details while keeping useful context. Review each suggestion before sharing.';
  const pending = state.fields.filter(field => field.pendingReveal);
  $('pendingRevealPanel').hidden = !pending.length;
  $('pendingRevealSummary').textContent = `${pending.length} suggested ${pending.length === 1 ? 'detail is' : 'details are'} still hidden`;
  $('pendingRevealList').replaceChildren(...pending.map(field => { const li = document.createElement('li'); li.textContent = field.name; return li; }));
  $('applySuggestedReveals').textContent = `Show these ${pending.length} suggested ${pending.length === 1 ? 'detail' : 'details'}`;
  const assistantText = { idle: 'Find sensitive details that local scanning may miss.', processing: 'Analyzing recognized text…', complete: 'Analysis complete. Review the results below.', failed: 'Analysis failed. Your masks are unchanged.' };
  $('aiAssistantStatus').textContent = assistantText[state.aiStatus];
  $('aiAssistant').dataset.status = state.aiStatus;
  $('aiButton').textContent = state.aiStatus === 'failed' ? 'Try again' : state.aiStatus === 'complete' ? 'Run again' : '✦ Enhance detection with AI';
  const showTypeSuggestion = state.aiStatus === 'complete' && state.documentType === 'general' && state.typeSource !== 'manual' && state.aiTypeSuggestion;
  $('aiTypeSuggestion').hidden = !showTypeSuggestion;
  $('aiTypeMessage').textContent = showTypeSuggestion ? `AI classifications suggest this may be ${documentTypes[state.aiTypeSuggestion].label}. Apply this type?` : '';
  $('aiInsightsPanel').hidden = state.aiStatus !== 'complete';
  const newCount = state.aiInsights.filter(item => item.kind === 'new').length;
  const reclassifiedCount = state.aiInsights.filter(item => item.kind === 'reclassified').length;
  $('aiInsightsSummary').textContent = newCount ? `AI found ${newCount} additional ${newCount === 1 ? 'area' : 'areas'} to review` : state.aiInsights.length ? `AI reviewed ${state.aiInsights.length} detected ${state.aiInsights.length === 1 ? 'detail' : 'details'}` : 'AI analysis complete';
  if (reclassifiedCount) $('aiInsightsSummary').textContent += ` · ${reclassifiedCount} reclassified`;
  const insights = state.aiInsights.map(item => { const button = document.createElement('button'); button.type = 'button'; const field = state.fields.find(value => value.id === item.id); button.textContent = `${item.name} — ${{new:'New', existing:'Already detected', reclassified:'Reclassified'}[item.kind]} · ${field?.hidden ? 'Hidden' : 'Marked visible'}`; button.addEventListener('click', () => { const field = state.fields.find(value => value.id === item.id); if (field) locateField(field); }); return button; });
  if (!insights.length) { const p = document.createElement('p'); p.textContent = 'No AI regions could be linked to a review item. Check the whole image.'; insights.push(p); }
  $('aiInsightsList').replaceChildren(...insights);
  $('reviewIntro').textContent = 'Choose what stays visible. Select a detail to find it in the image.';
  $('demoNotice').textContent = state.detecting ? (state.phase === 'ai' ? 'Analyzing recognized text. Earlier masks stay in place.' : 'Reading your image. Earlier masks stay in place.') : state.ocrDocument ? 'Suggestions may miss details. Check the whole image; overlapping masks may still cover a visible detail.' : isSample ? 'Fictional example with pre-labelled details. Review the whole image.' : 'No text results are available. Add masks for details you want to hide.';
  const coverage = coverageSummary(state.fields, state.manual);
  $('maskCount').textContent = String(coverage.detected);
  $('maskCount').setAttribute('aria-label', `${coverage.detected} detected details`);
  $('maskCount').title = `${coverage.detected} detected details`;
  $('reviewStates').textContent = `${coverage.detected} detected · ${coverage.hidden} hidden · ${coverage.markedVisible} marked visible${coverage.needsReview ? ` · ${coverage.needsReview} to check` : ''}`;
  const changedByAI = state.aiInsights.filter(item => item.kind === 'new' || item.kind === 'reclassified').length;
  $('summaryText').textContent = `${coverage.hidden} hidden · ${coverage.manual} added ${coverage.manual === 1 ? 'mask' : 'masks'}${changedByAI ? ` · ${changedByAI} AI ${changedByAI === 1 ? 'finding' : 'findings'}` : ''}`;
  $('fileLabel').textContent = state.filename;
  $('originalView').classList.toggle('active', state.view === 'original'); $('originalView').setAttribute('aria-pressed', String(state.view === 'original'));
  $('protectedView').classList.toggle('active', state.view === 'protected'); $('protectedView').setAttribute('aria-pressed', String(state.view === 'protected'));
  $('canvasHint').textContent = state.adjusting ? 'Drag the corners or center to correct the box · Arrow keys move one pixel' : state.drawing ? 'Drag to add a mask · Click “Add a mask” to stop' : state.view === 'original' ? 'Original preview · Switch to Protected to change masks' : textLines.length ? 'Click any text line to mask it · Click a mask to reveal' : 'Click to remove · Click the same area to restore';
  $('previewNote').textContent = state.adjusting ? 'Adjust the selected box on the original image. Press Escape or Finish adjusting when done.' : state.drawing ? 'Drag over a detail, then choose Finish masking.' : state.view === 'original' ? 'Original preview — selected masks are still applied to export.' : textLines.length ? 'Hover over recognized text to see its line. Click to cover it; click again to reveal it.' : 'Click a mask to reveal the detail; click the same area again to cover it. Review the whole image.';
  $('finishAdjustButton').hidden = !state.adjusting;
  $('mobileDrawButton').textContent = state.adjusting ? 'Finish adjusting' : state.drawing ? 'Finish masking' : 'Add a mask';
  $('mobileDrawButton').setAttribute('aria-pressed', String(Boolean(state.adjusting || state.drawing)));
  $('preserveNote').querySelector('strong').textContent = isSample ? 'The useful part stays.' : 'Review the whole image.';
  $('preserveNote').querySelector('p').textContent = isSample ? plan.keep : 'Sensitive details outside your masks will remain visible in the export.';
  $('undoButton').disabled = state.manual.length === 0;
  $('ocrButton').disabled = state.detecting;
  $('ocrButton').textContent = state.phase === 'ocr' ? 'Reading text…' : 'Read text again on this device';
  $('ocrLanguage').disabled = state.detecting;
  $('detectButton').disabled = state.detecting || !$('aiConsent').checked || !state.ocrDocument?.words.length;
  $('detectButton').textContent = state.phase === 'ai' ? 'Analyzing…' : 'Analyze text with AI';
  $('cancelDetectionButton').hidden = !state.detecting; $('cancelAI').hidden = state.phase !== 'ai';
  $('exportButton').disabled = state.detecting;
  $('aiConsent').disabled = state.detecting;
  renderFlow();
  canvas.setAttribute('aria-label', `${isSample ? `Fictional ${documentTypes[state.sampleKind].label} screenshot` : 'Your uploaded screenshot'}, ${state.view === 'original' ? 'original view' : `${count} masks applied`}`);
}
let toastTimer;
function announce(message, { undo = false } = {}) {
  const toast = $('toast'); toast.replaceChildren();
  const text = document.createElement('span'); text.textContent = message; toast.append(text);
  if (undo && contextUndo) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Undo'; button.addEventListener('click', () => { $('undoContext').click(); toast.hidden = true; }); toast.append(button); }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss notification'); close.addEventListener('click', () => { toast.hidden = true; }); toast.append(close);
  toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
}
function setDrawing(enabled) { state.drawing = enabled; if (enabled) { state.adjusting = null; state.reviewExpanded = false; setPanning(false); } state.drag = null; $('canvasWrap').classList.toggle('drawing', enabled); $('drawButton').setAttribute('aria-pressed', String(enabled)); $('drawButton').lastChild.textContent = enabled ? ' Finish masking' : ' Add a mask'; $('mobileDrawButton').setAttribute('aria-pressed', String(enabled)); $('mobileDrawButton').textContent = enabled ? 'Finish masking' : 'Add a mask'; $('drawHint').hidden = !enabled; if (enabled) state.view = 'protected'; }
function point(event) { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(base.width, (event.clientX - r.left) * base.width / r.width)), Math.max(0, Math.min(base.height, (event.clientY - r.top) * base.height / r.height))]; }
function maskAtPoint(position) {
  if (state.drawing || state.adjusting || state.view !== 'protected') return null;
  return maskTargetAtPoint(position, state.fields, state.manual, textLines);
}
function showMaskTarget(target) {
  canvas.classList.toggle('mask-target', Boolean(target));
  if (target) canvas.title = `Click to ${target.hidden ? 'reveal' : 'mask'}: ${target.name}`;
  else canvas.removeAttribute('title');
  const rect = target?.line?.rect || (target?.mask?.source === 'ocr-line' ? target.mask.rect : null);
  lineHighlight.hidden = !rect;
  if (rect) {
    const [x, y, width, height] = rect;
    Object.assign(lineHighlight.style, { left: `${x / base.width * 100}%`, top: `${y / base.height * 100}%`, width: `${width / base.width * 100}%`, height: `${height / base.height * 100}%` });
  }
}
function dragRect() { const { start, end } = state.drag; return [Math.floor(Math.min(start[0], end[0])), Math.floor(Math.min(start[1], end[1])), Math.ceil(Math.abs(end[0] - start[0])), Math.ceil(Math.abs(end[1] - start[1]))]; }
canvas.addEventListener('click', event => {
  const target = maskAtPoint(point(event));
  if (state.panning || !target) return;
  const mask = target.line ? toggleTextLine(target.line) : target.mask;
  if (state.fields.includes(mask)) setFieldChoice(mask, !target.hidden);
  else if (!target.line) mask.hidden = !target.hidden;
  if (!mask.hidden && state.highlighted === mask.id) state.highlighted = null;
  render();
  announce(`${mask.hidden ? 'Masked' : 'Revealed'}: ${target.name}. Review the preview before exporting.`);
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
  if (rect[2] >= 5 && rect[3] >= 5) { state.manual.push({ id: state.nextId++, rect, hidden: true }); announce('Manual mask added. Stop drawing to click it off or back on.'); }
  state.drag = null; render();
});
canvas.addEventListener('pointercancel', () => { state.drag = null; renderCanvas(); });
let adjustmentDrag = null;
adjustLayer.addEventListener('click', event => event.stopPropagation());
for (const handle of adjustLayer.querySelectorAll('button')) {
  handle.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const mask = adjustedMask(); if (!mask) return;
    event.preventDefault(); event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    adjustmentDrag = { id: mask.id, handle: handle.dataset.handle, rect: [...mask.rect], start: point(event) };
  });
  handle.addEventListener('pointermove', event => {
    if (!adjustmentDrag || adjustmentDrag.id !== adjustedMask()?.id) return;
    const mask = adjustedMask(), current = point(event);
    if (state.adjusting.type === 'field' && !mask.matchingRect) mask.matchingRect = [...adjustmentDrag.rect];
    mask.rect = adjustMaskRect(adjustmentDrag.rect, adjustmentDrag.handle, current[0] - adjustmentDrag.start[0], current[1] - adjustmentDrag.start[1], base.width, base.height);
    if (state.adjusting.type === 'field') mask.geometryOverride = true;
    renderCanvas();
  });
  for (const type of ['pointerup', 'pointercancel']) handle.addEventListener(type, () => {
    if (!adjustmentDrag) return;
    adjustmentDrag = null; clearContextChange(); render();
  });
  handle.addEventListener('keydown', event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[event.key]) return;
    const mask = adjustedMask(); if (!mask) return;
    event.preventDefault();
    const [dx, dy] = directions[event.key], step = event.shiftKey ? 10 : 1;
    if (state.adjusting.type === 'field' && !mask.matchingRect) mask.matchingRect = [...mask.rect];
    mask.rect = adjustMaskRect(mask.rect, handle.dataset.handle, dx * step, dy * step, base.width, base.height);
    if (state.adjusting.type === 'field') mask.geometryOverride = true;
    clearContextChange(); renderCanvas();
  });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && (state.drawing || state.adjusting)) { setDrawing(false); state.adjusting = null; render(); } });
$('finishAdjustButton').addEventListener('click', () => { state.adjusting = null; render(); });
let panDrag = null;
function setPanning(enabled) {
  state.panning = enabled; panDrag = null; if (enabled) state.adjusting = null;
  $('canvasStage').classList.toggle('panning', enabled);
  $('panButton').setAttribute('aria-pressed', String(enabled));
  if (enabled && state.drawing) setDrawing(false);
}
$('panButton').addEventListener('click', () => setPanning(!state.panning));
$('canvasStage').addEventListener('pointerdown', event => {
  if (!state.panning || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); const stage = $('canvasStage');
  panDrag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
  stage.setPointerCapture(event.pointerId);
});
$('canvasStage').addEventListener('pointermove', event => {
  if (!panDrag) return;
  const stage = $('canvasStage'); stage.scrollLeft = panDrag.left - (event.clientX - panDrag.x); stage.scrollTop = panDrag.top - (event.clientY - panDrag.y);
});
for (const kind of ['pointerup', 'pointercancel']) $('canvasStage').addEventListener(kind, () => { panDrag = null; });
$('canvasStage').addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault(); setZoom((state.zoom ?? currentFitScale()) * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
}, { passive: false });
$('drawButton').addEventListener('click', () => { setDrawing(!state.drawing); render(); if (state.drawing) announce('Drag over a detail on the image to cover it. Press Escape to stop drawing.'); });
$('undoButton').addEventListener('click', () => { const removed = state.manual.pop(); if (state.adjusting?.type === 'manual' && state.adjusting.id === removed?.id) state.adjusting = null; render(); });
$('resetButton').addEventListener('click', () => { clearContextChange(); cancelDetection(); state.manual = []; state.nextId = 1; resetFields(true); state.view = 'protected'; setDrawing(false); render(); setAIStatus('Recommendations reset. Review the whole image before sharing.'); announce(state.aiDetected ? 'AI recommendations reset for this audience; manual masks removed.' : state.source === 'sample' ? 'Sample recommendations reset for the selected audience.' : 'Manual masks removed. Run AI detection or add masks manually.'); });
$('customAudience').addEventListener('change', event => { setContext(event.target.value, state.purpose); state.sharingProfile = 'custom'; render(); });
for (const id of ['sharingPurpose', 'customSharingPurpose']) $(id).addEventListener('change', event => { const profile = state.sharingProfile || profileForContext(state.documentType, state.context, state.purpose); setContext(state.context, event.target.value); state.sharingProfile = profile; render(); });
$('documentType').addEventListener('change', event => setContext(state.context, state.purpose, event.target.value, true));
$('useLocalType').addEventListener('click', () => { const previous = state.fields.map(field => ({ ...field })); state.typeSource = 'local'; updateTypeFromText(state.ocrDocument); resetFields(); state.fields = guardSuggestedReveals(previous, state.fields); clearContextChange(); render(); });
$('customPurpose').addEventListener('input', event => { state.customPurpose = event.target.value; });
$('recipientDetail').addEventListener('input', event => { state.recipientDetail = event.target.value; });
$('sampleSelect').addEventListener('change', event => { loadExample(event.target.value); });
$('sampleButton').addEventListener('click', () => loadExample(state.sampleKind));
$('originalView').addEventListener('click', () => { state.view = 'original'; setDrawing(false); render(); });
$('protectedView').addEventListener('click', () => { state.view = 'protected'; render(); });
$('uploadButton').addEventListener('click', () => $('fileInput').click());
async function openImageFile(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { announce('Please choose a PNG, JPEG or WebP image.'); $('fileInput').value = ''; return; }
  if (file.size > 20 * 1024 * 1024) { announce('This image exceeds 20 MB. Please choose a smaller file.'); $('fileInput').value = ''; return; }
  const loadId = ++state.loadId;
  clearContextChange();
  cancelDetection(); render();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (loadId !== state.loadId) return;
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 20000000) throw new Error('size');
    base.width = image.naturalWidth; base.height = image.naturalHeight; b.fillStyle = '#fff'; b.fillRect(0, 0, base.width, base.height); b.drawImage(image, 0, 0);
    clearDetection(); hoveredField = null; state.documentType = 'general'; state.typeSource = 'pending'; state.typeReason = 'Scan locally to suggest a type, or select one yourself.'; state.context = ''; state.purpose = ''; state.customPurpose = ''; state.recipientDetail = ''; state.nextFieldId = 1; state.source = 'upload'; state.filename = file.name; state.fields = []; state.manual = []; state.nextId = 1; state.view = 'protected'; setDrawing(false); render();
    startImageFlow();
  } catch(error) { if (loadId === state.loadId) announce(error.message === 'size' ? 'Image is too large to edit here (20 megapixels maximum).' : 'This image could not be opened. Please try another PNG, JPEG or WebP.'); }
  finally { URL.revokeObjectURL(url); $('fileInput').value = ''; }
}
$('fileInput').addEventListener('change', event => { void openImageFile(event.target.files?.[0]); });
function setAIStatus(message, error = false) {
  $('aiStatus').textContent = message; $('aiStatus').dataset.error = String(error);
  let progress = message;
  if (state.phase === 'ocr' && !error) {
    const percent = message.match(/\d+%/)?.[0];
    progress = /checking missed/i.test(message) ? 'Checking for missed text…' : /reading text|recognizing text/i.test(message) ? 'Reading text on your device…' : 'Preparing on-device text reading…';
    if (percent) progress += ` ${percent}`;
  } else if (state.phase === 'ai' && !error) progress = 'Analyzing the text you agreed to send…';
  $('scanProgress').textContent = progress;
  $('aiDialogStatus').textContent = message; $('aiDialogStatus').dataset.error = String(error);
}
$('aiConsent').addEventListener('change', render);
$('zoomButton').addEventListener('click', () => setZoom(1));
$('fitButton').addEventListener('click', () => setZoom(null, 'fit'));
$('widthButton').addEventListener('click', () => setZoom(null, 'width'));
$('reviewWidth').addEventListener('input', event => { state.reviewWidth = Number(event.target.value); $('reviewWidthValue').textContent = `${state.reviewWidth} px`; scheduleWorkspaceLayout(); });
$('zoomInButton').addEventListener('click', () => setZoom((state.zoom ?? currentFitScale()) * 1.25));
$('zoomOutButton').addEventListener('click', () => setZoom((state.zoom ?? currentFitScale()) / 1.25));
$('cancelDetectionButton').addEventListener('click', stopScanning);
$('cancelScan').addEventListener('click', stopScanning);
$('cancelAI').addEventListener('click', () => { stopScanning(); $('aiDialog').close(); });
$('ocrLanguage').addEventListener('change', () => {
  clearContextChange();
  textLines = [];
  state.ocrDocument = null; state.aiDetected = false; state.detectedModel = ''; state.aiStatus = 'idle'; state.aiInsights = []; state.aiTypeSuggestion = null; $('aiConsent').checked = false;
  render(); setAIStatus('Language changed. Earlier masks retained. Read the text again before AI classification.');
});
async function scanLocally({ initial = false } = {}) {
  if (state.detecting) return;
  const currentId = ++detectionId; const loadId = state.loadId;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 90_000);
  state.detecting = true; state.phase = 'ocr'; setDrawing(false); render();
  setAIStatus('Loading local text recognition. Models are loaded from this site; your image stays on this device.');
  try {
    const language = state.source === 'sample' && $('ocrLanguage').value === 'auto' ? 'eng' : $('ocrLanguage').value;
    const document = await recognizeLocal(base, { language, signal: controller.signal, onProgress: message => {
      if (currentId === detectionId && loadId === state.loadId) setAIStatus(`Local OCR · ${message.status}${Number.isFinite(message.progress) ? ` · ${Math.round(message.progress * 100)}%` : ''}`);
    } });
    if (currentId !== detectionId || loadId !== state.loadId || controller.signal.aborted) return;
    const suggestions = suggestionsToFields(localSuggestions(document), document);
    textLines = textLineTargets(document);
    clearContextChange();
    updateTypeFromText(document);
    const reconciled = receiveFields(suggestions); state.ocrDocument = document; state.aiDetected = false; state.detectedModel = ''; state.aiStatus = 'idle'; state.aiInsights = []; state.aiTypeSuggestion = null; state.view = 'protected'; state.highlighted = null;
    setAIStatus(`${document.words.length} text words read locally. ${suggestions.length} local field suggestions; ${reconciled.restored} user choices matched, ${reconciled.retained} earlier regions retained for review. ${document.words.length ? 'Click any recognized text line in the image or the text list to mask it. AI classification is optional.' : 'No text found: add masks manually. This does not mean the image is safe.'}`);
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) { setAIStatus(error.name === 'AbortError' ? 'Local OCR timed out. Earlier masks retained; try a smaller image.' : error.message, true); }
  } finally {
    clearTimeout(timeout);
    if (currentId === detectionId) { state.detecting = false; state.phase = ''; detectionController = null; if (initial) state.flow = 'context'; render(); if (initial) openContextDialog(); }
  }
}
$('ocrButton').addEventListener('click', () => { $('moreDialog').close(); void scanLocally(); });
$('detectButton').addEventListener('click', async () => {
  if (state.detecting || !$('aiConsent').checked || !state.ocrDocument?.words.length) return;
  const currentId = ++detectionId; const loadId = state.loadId;
  const document = state.ocrDocument;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), AI_BUDGET.browserMs);
  state.detecting = true; state.phase = 'ai'; state.aiStatus = 'processing'; setDrawing(false); render(); setAIStatus('Screening likely credentials locally, then sending the screened text and layout to the configured AI provider. Other personal text may remain. The image stays on this device…');
  try {
    const payload = textPayload(document);
    const result = await readAPI(await fetch('/api/ai?action=classify-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
    }));
    if (currentId !== detectionId || loadId !== state.loadId || controller.signal.aborted) return;
    const classified = validateClassifications(result.fields, document);
    const aiFields = suggestionsToFields(classified, document);
    const fields = suggestionsToFields([...classified, ...localSuggestions(document)], document);
    const previousFields = state.fields;
    // Build everything first: an invalid result cannot partially replace existing masks.
    clearContextChange();
    const reconciled = receiveFields(fields);
    state.aiInsights = aiInsights(previousFields, aiFields, state.fields); state.aiTypeSuggestion = suggestTypeFromAI(classified); state.aiStatus = 'complete';
    state.aiDetected = true; state.detectedModel = result.model; state.view = 'protected'; state.highlighted = null;
    setAIStatus(`${fields.length} OCR-positioned mask suggestions, with text classification from ${result.provider}. ${reconciled.restored} user choices matched; ${reconciled.retained} earlier regions retained for review. Check missed text, QR codes and barcodes.`);
    $('aiDialog').close();
    announce('AI suggestions ready. Review the whole image.');
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) { state.aiStatus = 'failed'; setAIStatus(error.name === 'AbortError' ? 'Detection timed out. Existing masks retained; retry or add masks manually.' : error.message, true); }
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
    const plan = currentPlan();
    $('exportContext').textContent = `${plan.label}. ${state.purpose === 'custom' ? `Your purpose: ${state.customPurpose || 'not described'}. ` : ''}${state.recipientDetail ? `Recipient note: ${state.recipientDetail}. ` : ''}${plan.note} Check that every visible detail is needed for this purpose.`;
    const kept = state.fields.filter(f => !f.hidden).map(f => f.name.toLowerCase());
    const coverage = coverageSummary(state.fields, state.manual);
    $('exportDetails').textContent = `${coverage.detected} detected details: ${coverage.hidden} hidden, ${coverage.markedVisible} marked visible. ${coverage.manual} added ${coverage.manual === 1 ? 'mask' : 'masks'}. ${countMasks()} solid ${countMasks() === 1 ? 'mask' : 'masks'} applied. ${state.ocrDocument ? `${state.aiDetected ? `Text classification: ${state.detectedModel}.` : 'Local OCR rules only: names and addresses may still be visible.'} OCR can miss text. Check all edges, QR codes, barcodes and faces. ${kept.length ? `Set to visible: ${kept.join(', ')}; overlapping masks may still cover them.` : ''}` : state.source === 'sample' ? (kept.length ? `Visible fields: ${kept.join(', ')}.` : 'All labelled fields in this example are covered.') : 'No current OCR classification is available. Review every part of the image.'} ${state.fields.filter(field => (field.recommendation.action === 'review' || field.pendingReveal) && !field.userOverride).length} fields still need review and remain masked by default. ${countMasks() === 0 ? 'There are no redactions on this copy.' : ''}`;
    $('reviewConfirmation').checked = false; $('downloadButton').disabled = true; $('exportDialog').showModal();
  } catch { announce('Could not prepare the image. Please try again with a smaller image.'); }
  finally { button.disabled = false; }
});
$('reviewConfirmation').addEventListener('change', event => { $('downloadButton').disabled = !event.target.checked; });
$('downloadButton').addEventListener('click', () => {
  if (!$('reviewConfirmation').checked || !exportBlob || !exportUrl) return;
  const link = document.createElement('a'); link.href = exportUrl; link.download = `privacylens-${state.documentType}-${state.context || 'unspecified'}-${state.purpose || 'unspecified'}-${state.source === 'sample' ? 'sample' : 'image'}.png`; document.body.append(link); link.click(); link.remove();
  $('exportDialog').close(); announce('PNG download started. Review the saved image before sharing.');
});
$('exportDialog').addEventListener('close', () => { if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; exportBlob = null; } $('exportPreview').removeAttribute('src'); });
function renderProfiles() {
  const profiles = sharingProfiles(state.documentType);
  const selected = state.sharingProfile || profileForContext(state.documentType, state.context, state.purpose);
  const key = `${state.documentType}/${selected}`;
  if ($('sharingProfiles').dataset.key !== key) {
    $('sharingProfiles').dataset.key = key; $('sharingProfiles').replaceChildren();
    for (const profile of profiles) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `sharing-profile${selected === profile.id ? ' selected' : ''}`; button.dataset.profile = profile.id; button.setAttribute('aria-pressed', String(selected === profile.id));
      const content = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small'), dot = document.createElement('span');
      title.textContent = profile.label; detail.textContent = profile.detail; dot.className = 'radio-dot'; dot.setAttribute('aria-hidden', 'true'); content.append(title, detail); button.append(content, dot); $('sharingProfiles').append(button);
    }
  }
  const profile = profiles.find(profile => profile.id === selected);
  $('purposeFollowup').hidden = !profile?.followup;
  if (profile?.followup) {
    if ($('profilePurpose').dataset.profile !== `${state.documentType}/${profile.id}`) {
      $('profilePurpose').dataset.profile = `${state.documentType}/${profile.id}`; $('profilePurpose').replaceChildren();
      const options = [{ value: '', label: 'Choose a purpose…' }, ...profile.followup];
      for (const [value, entry] of Object.entries(purposeRegistry)) if (purposesFor(state.documentType).includes(value) && !options.some(option => option.value === value)) options.push({ value, label: entry.label });
      for (const option of options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; $('profilePurpose').append(node); }
    }
    $('profilePurpose').value = state.purpose;
  }
  $('fineTuneContext').hidden = !selected || selected === 'custom';
  $('customSettings').hidden = selected !== 'custom';
  $('detectedType').textContent = `${state.typeSource === 'manual' ? 'Selected' : state.source === 'sample' && !state.ocrDocument ? 'Fictional example' : 'Suggested'}: ${documentTypes[state.documentType].label}`;
  $('continueContext').disabled = state.detecting || !state.context || !state.purpose;
}
function renderFlow() {
  const intro = state.flow === 'intro';
  const landing = state.flow === 'landing';
  document.body.classList.toggle('editing', !intro && !landing);
  document.body.classList.toggle('welcoming', intro);
  $('introPage').hidden = !intro; $('skipIntro').hidden = !intro;
  $('landingPage').hidden = !landing; $('workspacePage').hidden = intro || landing;
  $('resumeButton').hidden = !state.hasImage; $('introResume').hidden = !state.hasImage;
  introDemo.setActive(intro);
  if (window.location.hash !== routeForFlow()) history.pushState(null, '', routeForFlow());
  $('analysisBanner').hidden = !state.detecting;
  const selected = state.sharingProfile || profileForContext(state.documentType, state.context, state.purpose);
  const profile = sharingProfiles(state.documentType).find(profile => profile.id === selected);
  $('typeButton').textContent = documentTypes[state.documentType].label;
  $('contextButton').replaceChildren();
  const label = document.createElement('span'); label.className = 'current-context'; label.textContent = state.context && state.purpose ? `${profile?.id === 'custom' ? audiences[state.context].label : profile?.label || audiences[state.context].label} · ${purposeRegistry[state.purpose].label}` : 'Who are you sharing with?';
  const change = document.createElement('span'); change.textContent = 'Change ↗'; $('contextButton').append(label, change);
  $('editorWorkspace').classList.toggle('sheet-open', state.reviewExpanded);
  $('reviewToggle').setAttribute('aria-expanded', String(state.reviewExpanded)); $('sheetLabel').textContent = state.reviewExpanded ? 'Back to image' : 'Review details'; $('sheetArrow').textContent = state.reviewExpanded ? '↓' : '↑';
  $('aiButton').disabled = state.detecting;
}
function openContextDialog() {
  if (!state.hasImage) return;
  state.flow = 'context'; render();
  if (!$('contextDialog').open) $('contextDialog').showModal();
}
function closeWorkDialogs() { for (const id of ['contextDialog', 'moreDialog', 'aiDialog', 'exportDialog', 'aboutDialog']) if ($(id).open) $(id).close(); }
function startImageFlow() {
  closeWorkDialogs(); state.hasImage = true; state.flow = 'scanning'; state.fitMode = 'auto'; state.zoom = null; setPanning(false); state.sharingProfile = ''; state.reviewExpanded = false; state.expandedField = null;
  $('fineTuneContext').open = false; $('typeSettings').open = false;
  render(); scheduleWorkspaceLayout(); $('canvasStage').scrollTop = 0; window.scrollTo({ top: 0, behavior: 'auto' }); void scanLocally({ initial: true });
}
function loadExample(kind) {
  setSample(kind); state.context = ''; state.purpose = ''; state.sharingProfile = ''; $('fileInput').value = ''; resetFields(); startImageFlow();
}
function stopScanning() {
  const initial = state.flow === 'scanning'; if (state.phase === 'ai') state.aiStatus = 'failed'; cancelDetection(); state.flow = 'review'; render();
  setAIStatus('Reading cancelled. Earlier masks stay in place. A sent AI request may still finish at the provider.');
  if (initial) openContextDialog();
}
$('sharingProfiles').addEventListener('click', event => {
  const button = event.target.closest('[data-profile]'); if (!button) return;
  const profile = sharingProfiles(state.documentType).find(profile => profile.id === button.dataset.profile);
  setContext(profile.audience, profile.purpose); state.sharingProfile = profile.id;
  $('fineTuneContext').open = false;
  render(); document.querySelector(`[data-profile="${profile.id}"]`)?.focus({ preventScroll: true });
});
$('profilePurpose').addEventListener('change', event => { const profile = state.sharingProfile; setContext(state.context, event.target.value); state.sharingProfile = profile; render(); });
$('continueContext').addEventListener('click', () => { state.flow = 'review'; $('contextDialog').close(); render(); if (contextUndo) announce(contextFeedback, { undo: true }); $('previewHeading').focus({ preventScroll: true }); });
$('skipContext').addEventListener('click', () => { state.flow = 'review'; $('contextDialog').close(); render(); });
$('contextDialog').addEventListener('close', () => { if (state.flow === 'context') { state.flow = 'review'; render(); } });
$('contextButton').addEventListener('click', openContextDialog);
$('typeButton').addEventListener('click', () => { $('typeSettings').open = true; openContextDialog(); });
$('editTypeButton').addEventListener('click', () => { $('typeSettings').open = !$('typeSettings').open; });
$('moreButton').addEventListener('click', () => $('moreDialog').showModal());
$('aiButton').addEventListener('click', () => {
  $('aiDialogStatus').textContent = ''; $('aiConsent').checked = false;
  // textContent prevents OCR instructions/markup from becoming executable UI.
  $('aiSendPreview').textContent = state.ocrDocument?.words.length
    ? textPayload(state.ocrDocument).lines.map(line => line.words.map(word => word.text).join(' ')).join('\n')
    : 'Read text locally first.';
  render(); $('aiDialog').showModal();
});
$('applyAIType').addEventListener('click', () => { const type = state.aiTypeSuggestion; if (!type || state.typeSource === 'manual' || state.documentType !== 'general') return; state.aiTypeSuggestion = null; setContext(state.context, state.purpose, type, true); openContextDialog(); });
$('dismissAIType').addEventListener('click', () => { state.aiTypeSuggestion = null; render(); });
$('applySuggestedReveals').addEventListener('click', () => { clearContextChange(); state.fields.forEach(field => { if (field.pendingReveal) { field.pendingReveal = false; field.userOverride = 'keep'; } }); resetFields(); state.view = 'protected'; render(); announce('Reviewed suggested details are now visible. Check the image before sharing.'); });
$('newImageButton').addEventListener('click', () => $('fileInput').click());
$('mobileDrawButton').addEventListener('click', () => { if (state.adjusting) { state.adjusting = null; render(); } else $('drawButton').click(); });
$('reviewToggle').addEventListener('click', () => { state.reviewExpanded = !state.reviewExpanded; renderFlow(); });
$('homeButton').addEventListener('click', () => navigateEntry('landing'));
$('resumeButton').addEventListener('click', () => navigateEntry('review'));
$('introResume').addEventListener('click', () => navigateEntry('review'));
$('introStart').addEventListener('click', () => navigateEntry('landing'));
$('skipIntro').addEventListener('click', () => navigateEntry('landing'));
$('showIntro').addEventListener('click', () => navigateEntry('intro'));
document.querySelectorAll('[data-start-sample]').forEach(button => button.addEventListener('click', () => loadExample(button.dataset.startSample)));
$('uploadZone').addEventListener('dragover', event => { event.preventDefault(); $('uploadZone').classList.add('dragging'); });
$('uploadZone').addEventListener('dragleave', () => $('uploadZone').classList.remove('dragging'));
$('uploadZone').addEventListener('drop', event => { event.preventDefault(); $('uploadZone').classList.remove('dragging'); void openImageFile(event.dataTransfer.files?.[0]); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.reviewExpanded && !document.querySelector('dialog[open]')) { state.reviewExpanded = false; renderFlow(); $('reviewToggle').focus(); } });
setSample();
