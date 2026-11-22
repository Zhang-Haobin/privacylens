import { AI_BUDGET } from './ai-policy.js';
import { readAPI } from './api-client.js';
import { recognizeLocal } from './ocr.js';
import { createMaskAnimator } from './mask-motion.js';
import { maskTargetAtPoint, textLineTargets } from './mask-targets.js';
import { localSuggestions, suggestionsToFields, textPayload, validateClassifications } from './ocr-core.js';
import { audiences, applyRecommendations, recommendField, sharingPlan, contextDifference, guardSuggestedReveals } from './sharing-context.js';
import { documentTypes, purposeRegistry, classifyDocument, suggestTypeFromAI } from './document-context.js';
import { reconcileFields, preserveEditedRegions, aiInsights, activeMasks, coverageSummary } from './field-state.js';
import { drawExtraSample } from './samples.js';
import { fitImageScale, workspaceLayout } from './editor-geometry.js';
import { editorSharingChoice } from './workflow.js';
import { createProtectionInput, protectionLimits, protectionMaskChange, safeProtectionRecommendation, sameProtectionVersion, validateProtectionDecisions } from './protection.js';
import { createInstructionRequest, instructionFieldCategories, instructionLimit, instructionOperationLabel, instructionRectangles, parsePrivacyInstruction, validKeepArea, validateInstructionOperations } from './privacy-instruction.js';
import { categoryNames } from './privacy-types.js';
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
const audienceIcons = { public: 'globe', circle: 'people', team: 'cap', support: 'support' };
const state = {
  flow: 'landing', hasImage: false, reviewExpanded: false, expandedField: null,
  context: '', documentType: 'delivery', typeSource: 'sample', typeReason: '',
  customInstruction: '', instruction: null, acceptedConflict: false, recipientDetail: '',
  source: 'sample', sampleKind: 'delivery', filename: 'fictional-order.png', loadId: 0,
  fields: [], manual: [], nextId: 1, nextFieldId: 1, view: 'protected', drawing: false, drag: null, adjusting: null,
  detecting: false, phase: '', ocrStatus: 'idle', ocrDocument: null, waitingForOCR: false,
  aiDetected: false, detectedModel: '', aiStatus: 'idle', aiInsights: [], aiTypeSuggestion: null,
  exporting: false, zoom: null, fitMode: 'auto', panning: false, reviewWidth: 380, highlighted: null
};
let hoveredField = null;
let contextUndo = null;
let contextFeedback = '';
let sharingVersion = 0;
let fieldsVersion = 0;
let loadingImageId = null;
let aiPreview = null;
let instructionRects = [];
let keepAreaDraft = null;
const sharingAI = { preview: null, request: null, result: null, interpretation: null, change: null, message: '' };
// Only the intro preference is persisted. Images and editing choices stay in memory.
let entryStorage;
try { entryStorage = window.localStorage; } catch { /* Private browsing can deny access. */ }
state.flow = initialEntry(window.location.hash, entryStorage);
const introDemo = createIntroDemo($('introDemo'), reducedMotion);
const routeForFlow = () => state.flow === 'intro' ? '#intro' : state.flow === 'landing' ? '#upload' : '#workspace';
history.replaceState(null, '', routeForFlow());
function navigateEntry(flow) {
  if (state.flow === 'intro' && flow !== 'intro') rememberIntro(entryStorage);
  if (state.phase === 'ai') cancelDetection();
  cancelProtectionRequest('Sharing analysis cancelled.');
  state.waitingForOCR = false;
  closeWorkDialogs();
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
  state.fields = applyRecommendations(state.fields, protectionContext());
  if (clearOverrides) state.fields = guardSuggestedReveals(previous, state.fields);
}
function protectionContext() {
  const choice = editorSharingChoice(state.documentType, state.context);
  const instruction = currentInstruction();
  return { ...choice, maskCategories: instruction?.enabled ? instructionFieldCategories(instruction.operation) : null };
}
function currentPlan() {
  const choice = protectionContext();
  const plan = sharingPlan(choice.context, choice.purpose, state.documentType);
  if (!choice.compatible) plan.keep = 'Review the details needed for this copy. This combination uses conservative protection.';
  if (choice.custom) {
    plan.keep = 'Check your custom instruction against the protected preview.';
  }
  plan.note = audiences[choice.context]?.note || '';
  plan.label = `${documentTypes[state.documentType].label} · ${choice.custom ? 'Custom' : audiences[choice.context]?.label || 'Audience not selected'}`;
  return plan;
}
function currentInstruction() {
  return state.context === 'custom' && state.instruction?.loadId === state.loadId ? state.instruction : null;
}
function applyInstruction(instruction) {
  const previous = state.fields;
  state.instruction = instruction;
  state.view = 'protected';
  sharingVersion++;
  invalidateProtection();
  resetFields();
  state.fields = guardSuggestedReveals(previous, state.fields);
}
function commitInstruction() {
  const text = state.customInstruction.trim();
  if (state.context !== 'custom' || !text) return;
  const previous = currentInstruction();
  if (previous?.text === text) {
    if (!previous.enabled) applyInstruction({ ...previous, enabled: true });
    return;
  }
  applyInstruction({ text, loadId: state.loadId, operation: parsePrivacyInstruction(text), enabled: true, source: 'local' });
}
function updateInstructionRectangles() {
  const instruction = currentInstruction();
  const operation = instruction?.enabled ? instruction.operation : null;
  const document = state.ocrDocument;
  const input = { width: base.width, height: base.height, document, keepArea: instruction?.keepArea };
  if (operation && ['mask_text', 'mask_numbers'].includes(operation.type)) {
    // Keep same-image coverage through later scans, including failed ones.
    instruction.textCoverage ??= new Map();
    if (instruction.ocrDocument !== document) {
      for (const rect of instructionRectangles(operation, input)) instruction.textCoverage.set(rect.join(','), rect);
      instruction.ocrDocument = document;
    }
    instructionRects = [...instruction.textCoverage.values()];
  } else {
    instructionRects = instructionRectangles(operation, input);
  }
}
function setFieldChoice(field, hidden) {
  clearContextChange(); field.userOverride = hidden ? 'redact' : 'keep'; field.pendingReveal = false; field.hidden = hidden;
}
function cancelDetection() {
  if (state.phase === 'ai' && state.aiStatus === 'processing') state.aiStatus = 'cancelled';
  if (state.phase === 'ocr') state.ocrStatus = 'cancelled';
  state.waitingForOCR = false;
  detectionId++; detectionController?.abort(); detectionController = null; state.detecting = false; state.phase = '';
}
function clearDetection() {
  textLines = [];
  state.adjusting = null;
  invalidateProtection();
  cancelDetection(); state.aiDetected = false; state.detectedModel = ''; state.aiStatus = 'idle'; state.aiInsights = []; state.aiTypeSuggestion = null; state.ocrDocument = null; state.highlighted = null; state.zoom = null; state.fitMode = 'auto'; clearContextChange(); $('aiConsent').checked = false;
  state.ocrStatus = 'idle'; aiPreview = null;
  setAIStatus('Ready for local text recognition. AI assistance is optional.');
}
function clearSharingChoices() {
  state.context = ''; state.customInstruction = ''; state.instruction = null;
  state.acceptedConflict = false; state.recipientDetail = ''; sharingVersion++;
}
function setSample(kind = state.sampleKind) {
  if (!['delivery', 'transcript', 'chat', 'technical_screenshot'].includes(kind)) return;
  state.loadId++; clearDetection(); hoveredField = null;
  state.sampleKind = kind; state.documentType = kind; state.typeSource = 'sample';
  state.typeReason = 'Fictional sample type supplied. Scan locally to test recognition, or correct it yourself.';
  clearSharingChoices();
  state.source = 'sample'; state.filename = `fictional-${kind}.png`; state.manual = []; state.nextId = 1; state.nextFieldId = 1; state.view = 'protected'; state.drag = null;
  setDrawing(false);
  if (kind === 'delivery') { drawSample(); state.fields = sampleFields.map(field => ({ ...field, category: field.id, anchor: ({order: '#PL-2048-7612', name: 'Alex Chan', phone: '+852 5550 0136', address: 'Flat 8B, 12 Example Lane, Demo District, Hong Kong', email: 'alex.chan@example.com', payment: 'Visa ···· 4821'})[field.id], source: 'sample', userOverride: null })); }
  else state.fields = drawExtraSample(base, kind);
  resetFields(); render(); setAIStatus('Fictional example with pre-labelled regions. Scan locally to test OCR; AI is optional.');
}
function clearContextChange() { contextUndo = null; contextFeedback = ''; }
const sharingKeys = ['context', 'instruction', 'acceptedConflict', 'documentType', 'typeSource', 'typeReason'];

function setContext(changes) {
  if (Object.entries(changes).every(([key, value]) => state[key] === value)) return;
  const previousFields = state.fields;
  const previous = Object.fromEntries(sharingKeys.map(key => [key, state[key]]));
  Object.assign(state, changes);
  if (state.context !== 'custom') state.instruction = null;
  state.acceptedConflict = false;
  state.waitingForOCR = false;
  sharingVersion++;
  invalidateProtection();

  state.drag = null; state.view = 'protected';
  resetFields();
  state.fields = guardSuggestedReveals(previousFields, state.fields);
  const difference = contextDifference(previousFields, state.fields);
  const names = values => values.length > 3 ? `${values.slice(0, 3).join(', ')} and ${values.length - 3} more` : values.join(', ');
  contextFeedback = [difference.hidden.length ? `Newly masked: ${names(difference.hidden)}.` : '', difference.visible.length ? `Now visible: ${names(difference.visible)}.` : ''].filter(Boolean).join(' ') || 'Sharing settings updated. Review your field choices.';
  const pending = state.fields.filter(field => field.pendingReveal).length;
  if (pending) contextFeedback += ` ${pending} suggested ${pending === 1 ? 'detail remains' : 'details remain'} hidden until you review them.`;
  const overrides = state.fields.filter(field => field.userOverride).length;
  if (overrides) contextFeedback += ` ${overrides} ${overrides === 1 ? 'field follows your choice' : 'fields follow your choices'}.`;
  contextUndo = {
    choices: previous, loadId: state.loadId,
    fields: previousFields.map(({ id, userOverride, pendingReveal }) => ({ id, userOverride, pendingReveal }))
  };
  render();
}
function undoSharingSettings() {
  if (!contextUndo || contextUndo.loadId !== state.loadId || state.detecting) return;
  const fields = new Map(contextUndo.fields.map(field => [field.id, field]));
  Object.assign(state, contextUndo.choices);
  sharingVersion++;
  invalidateProtection();
  state.fields.forEach(field => {
    const prior = fields.get(field.id);
    if (prior) { field.userOverride = prior.userOverride; field.pendingReveal = prior.pendingReveal; }
  });
  state.view = 'protected'; resetFields(); clearContextChange(); render();
  $($('contextDialog').open ? 'contextHeading' : 'contextButton').focus({ preventScroll: true });
  announce('Previous sharing settings and field choices restored.');
}
$('undoContext').addEventListener('click', undoSharingSettings);
$('workspaceUndoContext').addEventListener('click', undoSharingSettings);
function updateTypeFromText(document) {
  if (state.typeSource === 'manual') return;
  const result = classifyDocument(document);
  if (state.documentType !== result.type) {
    state.acceptedConflict = false; sharingVersion++;
  }
  state.documentType = result.type; state.typeSource = 'local'; state.typeReason = result.reason;
}
function receiveFields(incoming) {
  fieldsVersion++;
  invalidateProtection();
  const candidates = incoming.map(field => ({ ...field, id: `scan-${state.nextFieldId++}` }));
  const previous = state.fields;
  const result = reconcileFields(previous, candidates);
  const fields = preserveEditedRegions(previous, result.fields);
  state.fields = guardSuggestedReveals(previous, applyRecommendations(fields, protectionContext()));
  if (state.adjusting && !adjustedMask()) state.adjusting = null;
  return result;
}
function typePending() {
  return state.typeSource === 'pending' && ['idle', 'running'].includes(state.ocrStatus);
}
function contextReviewBlocker(choice = protectionContext()) {
  if (!state.context) return 'Choose a sharing option to continue.';
  if (choice.custom && !state.customInstruction.trim()) return 'Enter a privacy instruction to continue.';
  if (!choice.compatible && !state.acceptedConflict && !typePending()) return 'Resolve the sharing choices above to continue.';
  return '';
}
function buildSharingCards() {
  for (const [key, symbol] of Object.entries(audienceIcons)) {
    const label = document.createElement('label');
    label.className = 'sharing-profile';
    label.dataset.audience = key;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sharing-mode';
    radio.value = key;
    radio.setAttribute('aria-labelledby', `audience-${key}-title`);
    radio.setAttribute('aria-describedby', `audience-${key}-detail`);

    const icon = document.createElement('span');
    icon.className = 'sharing-profile-icon';
    icon.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#i-${symbol}`);
    svg.append(use);
    icon.append(svg);

    const content = document.createElement('span');
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    title.id = `audience-${key}-title`;
    detail.id = `audience-${key}-detail`;
    title.textContent = audiences[key].label;
    detail.textContent = audiences[key].detail;
    content.append(title, detail);
    const dot = document.createElement('span');
    dot.className = 'radio-dot';
    dot.setAttribute('aria-hidden', 'true');
    label.append(radio, icon, content, dot);
    $('customSharing').before(label);
  }
}
function renderContextOptions() {
  const config = documentTypes[state.documentType];
  const choice = protectionContext();
  for (const radio of $('sharingAudiences').querySelectorAll('input')) radio.checked = radio.value === state.context;
  $('customInstructionPanel').hidden = !choice.custom;
  const description = $('customInstruction');
  if (description.value !== state.customInstruction) description.value = state.customInstruction;
  $('instructionCount').textContent = `${state.customInstruction.length} / ${description.maxLength}`;
  const type = choice.custom ? parsePrivacyInstruction(state.customInstruction)?.type : null;
  const exampleHint = type === 'draw_area' ? 'In Review, draw a mask around the area you want to hide.'
    : type === 'keep_area' ? 'In Review, select and confirm the area you want to keep.' : '';
  $('instructionExampleHint').hidden = !exampleHint;
  if ($('instructionExampleHint').textContent !== exampleHint) $('instructionExampleHint').textContent = exampleHint;
  $('contextExplanation').hidden = !state.context || choice.custom;

  $('documentType').value = state.documentType;
  $('typeEvidence').textContent = state.typeReason;
  $('useLocalType').hidden = state.typeSource !== 'manual'; $('useLocalType').disabled = !state.ocrDocument;
  const typePrefix = { manual: 'Selected', local: 'Suggested', sample: 'Example', pending: 'Current type' }[state.typeSource];
  $('detectedType').textContent = typePending() ? 'Checking document type…' : `${typePrefix}: ${config.label}`;
  $('recipientDetail').value = state.recipientDetail;

  const conflict = !choice.compatible && !typePending();
  const unresolvedConflict = conflict && !state.acceptedConflict;
  $('contextConflict').hidden = !unresolvedConflict;
  $('contextConflictMessage').textContent = 'Choose another sharing option, correct the document type, or continue with conservative protection.';
  const blocker = contextReviewBlocker(choice);
  $('continueContext').disabled = Boolean(blocker || state.waitingForOCR);
  const reviewStatus = state.waitingForOCR ? 'Finishing screenshot analysis…' : blocker;
  if ($('reviewImageStatus').textContent !== reviewStatus) $('reviewImageStatus').textContent = reviewStatus;
  $('manualReviewHint').textContent = unresolvedConflict ? 'Keep these choices and review conservative masks.' : 'Open the editor and check masks yourself.';
  $('contextFeedback').hidden = !contextUndo;
  $('workspaceUndoContext').hidden = !contextUndo;
  $('undoContext').disabled = state.detecting;
  $('workspaceUndoContext').disabled = state.detecting;

  $('sampleSelect').value = state.sampleKind;
  $('sampleTitle').textContent = documentTypes[state.sampleKind].label;
  $('sampleMeta').textContent = 'Fictional sample · pre-labelled';
  renderChooseProgress();
}
function renderChooseProgress() {
  const messages = {
    failed: 'Text reading failed. Retry or review the image manually.',
    empty: 'No text was found. You can add masks manually.',
    cancelled: 'Text reading cancelled. You can retry or review manually.'
  };
  const running = state.ocrStatus === 'running';
  const message = running ? (state.waitingForOCR ? '' : 'Analyzing the screenshot on your device…') : messages[state.ocrStatus];
  $('chooseProgress').hidden = !message;
  $('chooseProgressDot').hidden = !running;
  $('retryChooseOCR').hidden = running || !message;
  if (message && $('chooseProgressMessage').textContent !== message) $('chooseProgressMessage').textContent = message;
}
function drawImage(target, includeMasks = true, rectangles = instructionRects, previewSize = Infinity) {
  const scale = Math.min(1, previewSize / Math.max(base.width, base.height));
  target.width = Math.max(1, Math.round(base.width * scale)); target.height = Math.max(1, Math.round(base.height * scale));
  const c = target.getContext('2d');
  c.scale(target.width / base.width, target.height / base.height);
  c.fillStyle = '#fff'; c.fillRect(0, 0, base.width, base.height); c.drawImage(base, 0, 0);
  if (includeMasks) {
    c.fillStyle = '#202b24';
    activeMasks(state.fields, state.manual, rectangles).forEach(({ rect }) => c.fillRect(...rect));
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
  const masks = activeMasks(state.fields, state.manual, instructionRects);
  const active = new Set(masks.map(mask => mask.key));
  masks.forEach(({ key, rect: [x, y, width, height] }, index) => {
    let record = previewMasks.get(key);
    if (!record) {
      const element = document.createElement('div'); element.className = 'preview-mask';
      if (key.startsWith('instruction-')) element.dataset.maskKind = 'instruction';
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
    const rect = dragRect();
    if (state.drawing !== 'keep') { ctx.fillStyle = '#202b24'; ctx.fillRect(...rect); }
    ctx.strokeStyle = '#c6db7a'; ctx.lineWidth = Math.max(2, base.width / 350); ctx.strokeRect(...rect);
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
function countMasks() { return activeMasks(state.fields, state.manual, instructionRects).length; }
function reapplyCandidates() {
  return state.fields.filter(field => field.userOverride === 'keep' && field.recommendation.action !== 'keep');
}
function restoreSuggestedMasks() {
  const count = reapplyCandidates().length;
  if (!count) return 0;
  clearContextChange();
  state.fields = guardSuggestedReveals(state.fields, applyRecommendations(state.fields, protectionContext(), { applySuggestedMasks: true }));
  state.view = 'protected';
  return count;
}
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
  const suggestions = currentProtectionResult()?.suggestions;
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
    row.append(top, details);
    const suggestion = suggestions?.get(field.id);
    if (suggestion) row.append(renderProtectionSuggestion(field, suggestion));
    list.append(row);
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
function instructionFeedback(instruction) {
  if (!instruction) return ['Custom privacy instruction', 'Open Sharing Settings and choose Review image to apply your instruction.'];
  if (!instruction.enabled) return ['Instruction masks removed', 'Review the protected preview or restore the instruction.'];
  const operation = instruction.operation;
  if (!operation) return ['Additional review needed', 'Conservative protection is active. Edit the instruction, use a manual mask, or request optional AI help.'];
  if (operation.type === 'draw_area') return ['Draw a mask for the area', 'Draw directly on the image. Then use Adjust box to move or resize the mask.'];
  if (operation.type === 'keep_area') return instruction.keepArea
    ? ['Selected area applied', 'Pixels outside your selection are covered. Other masks can still cover details inside it.']
    : ['Select the area to keep', 'Review the image and draw around the area you want to keep, then confirm it.'];

  const heading = instruction.source === 'ai' ? 'AI operation applied' : 'Instruction applied locally';
  if (operation.type === 'mask_image') return [heading, 'An opaque mask covers the whole image. Undo the instruction to inspect the copy with your other masks.'];
  if (operation.type === 'mask_half') return [heading, `An opaque mask covers the ${operation.side} half of the image.`];
  if (['mask_text', 'mask_numbers'].includes(operation.type)) {
    const subject = operation.type === 'mask_text' ? 'recognized text' : 'recognized words containing numbers';
    return instructionRects.length
      ? [heading, `Masks cover the ${subject}. Check the image for any missed text.`]
      : ['Additional review needed', `There is no ${operation.type === 'mask_text' ? 'recognized text' : 'recognized numeric text'} to mask. Read the image again or add masks manually.`];
  }
  const categories = instructionFieldCategories(operation);
  const matching = state.fields.filter(field => categories?.has(field.category));
  const visible = matching.filter(field => !field.hidden).length;
  if (!matching.length) return ['Additional review needed', 'No detected details match this instruction. Review the image for anything you need to cover.'];
  if (visible) return [heading, `${matching.length - visible} of ${matching.length} matching details are marked hidden. Check the fields you chose to show.`];
  return [heading, operation.type === 'mask_personal' ? 'Detected personal details are covered. Check the image for anything the scan may have missed.' : 'The matching detected fields are covered. Check the image for anything the scan may have missed.'];
}
function renderInstructionReview() {
  const instruction = currentInstruction();
  const type = instruction?.operation?.type;
  const enabled = Boolean(instruction?.enabled);
  $('instructionReview').hidden = state.context !== 'custom';
  const [heading, feedback] = instructionFeedback(instruction);
  const message = instruction && instruction.text !== state.customInstruction.trim()
    ? feedback + ' Your draft has changed. Choose Review image to update this copy.' : feedback;
  $('instructionReviewHeading').textContent = heading;
  const status = $('instructionReviewMessage');
  if (status.textContent !== message) status.textContent = message;
  const draw = $('drawInstructionArea');
  draw.hidden = !enabled || !['draw_area', 'keep_area'].includes(type);
  draw.textContent = type === 'keep_area' ? 'Select visible area' : 'Draw a mask';
  const toggle = $('toggleInstruction');
  toggle.hidden = !type || type === 'draw_area' || type === 'keep_area' && !instruction.keepArea;
  toggle.textContent = enabled ? 'Undo instruction' : 'Restore instruction';
}
function render() {
  updateInstructionRectangles();
  showMaskTarget(null);
  renderCanvas(); renderFields();
  const isSample = state.source === 'sample'; const count = countMasks();
  const plan = currentPlan(); renderContextOptions();
  $('sampleButton').classList.toggle('selected', isSample);
  const delivery = state.documentType === 'delivery';
  $('contextHideLabel').textContent = delivery ? 'Personal and payment details' : 'What to hide';
  $('contextHide').textContent = delivery ? 'Suggest hiding' : plan.hide;
  $('contextKeepLabel').textContent = delivery ? 'Delivery status' : 'What to keep';
  $('contextKeep').textContent = delivery ? 'Keep visible' : plan.keep;
  $('contextOrderPlan').hidden = !delivery;
  if (delivery) {
    const choice = protectionContext();
    const orderAdvice = { redact: 'Suggest hiding', review: 'Review before showing', keep: 'Useful for delivery lookup' };
    $('contextOrder').textContent = choice.context && choice.purpose
      ? orderAdvice[recommendField({ category: 'order' }, choice).action] : 'Depends on sharing settings';
  }
  $('contextNote').hidden = !state.context;
  $('contextNote').textContent = audiences[state.context]?.note || '';
  renderInstructionReview();
  const pending = state.fields.filter(field => field.pendingReveal);
  $('pendingRevealPanel').hidden = !pending.length;
  $('pendingRevealSummary').textContent = `${pending.length} suggested ${pending.length === 1 ? 'detail is' : 'details are'} still hidden`;
  $('pendingRevealList').replaceChildren(...pending.map(field => { const li = document.createElement('li'); li.textContent = field.name; return li; }));
  $('applySuggestedReveals').textContent = `Show these ${pending.length} suggested ${pending.length === 1 ? 'detail' : 'details'}`;
  const assistantText = {
    idle: 'Optional review of recognized text.', processing: 'Analyzing recognized text…',
    complete: 'Analysis complete. Review the detected details.',
    failed: 'Analysis failed. You can continue reviewing the image.',
    cancelled: 'Analysis cancelled. You can continue reviewing the image.'
  };
  $('aiAssistantStatus').textContent = assistantText[state.aiStatus];
  $('aiAssistant').dataset.status = state.aiStatus;
  const choicesToReapply = reapplyCandidates();
  $('reapplyMasks').hidden = !choicesToReapply.length;
  $('reapplyMasks').disabled = state.detecting;
  const flaggedVisible = choicesToReapply.some(field => field.source === 'ai' || state.aiInsights.some(item => item.id === field.id));
  $('aiVisibilityNotice').hidden = !flaggedVisible;
  $('aiVisibilityNotice').textContent = 'AI flagged details you chose to show. Check the visible details in the review list.';
  const showTypeSuggestion = state.aiStatus === 'complete' && state.documentType === 'general' && state.typeSource !== 'manual' && state.aiTypeSuggestion;
  $('aiTypeSuggestion').hidden = !showTypeSuggestion;
  $('aiTypeMessage').textContent = showTypeSuggestion ? `AI classifications suggest this may be ${documentTypes[state.aiTypeSuggestion].label}. Apply this type?` : '';
  $('aiInsightsPanel').hidden = state.aiStatus !== 'complete';
  const newCount = state.aiInsights.filter(item => item.kind === 'new').length;
  const reclassifiedCount = state.aiInsights.filter(item => item.kind === 'reclassified').length;
  $('aiInsightsSummary').textContent = newCount ? `AI found ${newCount} additional ${newCount === 1 ? 'area' : 'areas'} to review` : state.aiInsights.length ? `AI reviewed ${state.aiInsights.length} detected ${state.aiInsights.length === 1 ? 'detail' : 'details'}` : 'AI analysis complete';
  if (reclassifiedCount) $('aiInsightsSummary').textContent += ` · ${reclassifiedCount} reclassified`;
  const insights = state.aiInsights.map(item => {
    const button = document.createElement('button');
    const label = { new: 'New', existing: 'Already detected', reclassified: 'Reclassified' }[item.kind];
    const field = state.fields.find(value => value.id === item.id);
    button.type = 'button';
    button.dataset.finding = item.kind;
    button.textContent = `${item.name} · ${label} · ${field?.hidden ? 'Hidden' : 'Marked visible'}`;
    button.addEventListener('click', () => {
      const currentField = state.fields.find(value => value.id === item.id);
      if (currentField) locateField(currentField);
    });
    return button;
  });
  if (!insights.length) { const p = document.createElement('p'); p.textContent = 'No AI regions could be linked to a review item. Check the whole image.'; insights.push(p); }
  $('aiInsightsList').replaceChildren(...insights);
  $('reviewIntro').textContent = 'Choose what stays visible. Select a detail to find it in the image.';
  $('demoNotice').textContent = state.detecting ? (state.phase === 'ai' ? 'Analyzing recognized text. Earlier masks stay in place.' : 'Reading your image. Earlier masks stay in place.') : state.ocrDocument ? 'Suggestions may miss details. Check the whole image; overlapping masks may still cover a visible detail.' : isSample ? 'Fictional example with pre-labelled details. Review the whole image.' : 'No text results are available. Add masks for details you want to hide.';
  const coverage = coverageSummary(state.fields, state.manual, instructionRects);
  $('maskCount').textContent = String(coverage.detected);
  $('maskCount').setAttribute('aria-label', `${coverage.detected} detected details`);
  $('maskCount').title = `${coverage.detected} detected details`;
  $('reviewStates').textContent = `${coverage.detected} detected · ${coverage.hidden} hidden · ${coverage.markedVisible} marked visible${coverage.needsReview ? ` · ${coverage.needsReview} to check` : ''}`;
  const changedByAI = state.aiInsights.filter(item => item.kind === 'new' || item.kind === 'reclassified').length;
  $('summaryText').textContent = `${coverage.hidden} hidden · ${coverage.manual} added ${coverage.manual === 1 ? 'mask' : 'masks'}${instructionRects.length ? ` · ${instructionRects.length} instruction ${instructionRects.length === 1 ? 'mask' : 'masks'}` : ''}${changedByAI ? ` · ${changedByAI} AI ${changedByAI === 1 ? 'finding' : 'findings'}` : ''}`;
  $('fileLabel').textContent = state.filename;
  $('originalView').classList.toggle('active', state.view === 'original'); $('originalView').setAttribute('aria-pressed', String(state.view === 'original'));
  $('protectedView').classList.toggle('active', state.view === 'protected'); $('protectedView').setAttribute('aria-pressed', String(state.view === 'protected'));
  $('canvasHint').textContent = state.drawing === 'keep' ? 'Drag a rectangle around the area to keep' : state.adjusting ? 'Drag the corners or center to correct the box · Arrow keys move one pixel' : state.drawing ? 'Drag to add a mask · Click “Add a mask” to stop' : state.view === 'original' ? 'Original preview · Switch to Protected to change masks' : textLines.length ? 'Click any text line to mask it · Click a mask to reveal' : 'Click to remove · Click the same area to restore';
  $('previewNote').textContent = state.drawing === 'keep' ? 'Drag around the area to keep, then confirm your selection.' : state.adjusting ? 'Adjust the selected box on the original image. Press Escape or Finish adjusting when done.' : state.drawing ? 'Drag over a detail, then choose Finish masking.' : state.view === 'original' ? 'Original preview — selected masks are still applied to export.' : instructionRects.length ? 'Use Undo instruction in Review to remove the instruction’s masks.' : textLines.length ? 'Hover over recognized text to see its line. Click to cover it; click again to reveal it.' : 'Click a mask to reveal the detail; click the same area again to cover it. Review the whole image.';
  $('finishAdjustButton').hidden = !state.adjusting;
  $('mobileDrawButton').textContent = state.adjusting ? 'Finish adjusting' : state.drawing === 'keep' ? 'Cancel selection' : state.drawing ? 'Finish masking' : 'Add a mask';
  $('mobileDrawButton').setAttribute('aria-pressed', String(Boolean(state.adjusting || state.drawing)));
  $('preserveNote').querySelector('strong').textContent = isSample ? 'The useful part stays.' : 'Review the whole image.';
  $('preserveNote').querySelector('p').textContent = isSample ? plan.keep : 'Sensitive details outside your masks will remain visible in the export.';
  $('undoButton').disabled = state.manual.length === 0;
  $('ocrButton').disabled = state.detecting;
  $('ocrButton').textContent = state.phase === 'ocr' ? 'Reading text…' : 'Read text again on this device';
  $('ocrLanguage').disabled = state.detecting;
  $('cancelDetectionButton').hidden = !state.detecting;
  $('exportButton').disabled = state.detecting || state.exporting;
  renderAIDetectionConsent();
  renderProtectionControls();
  renderFlow();
  canvas.setAttribute('aria-label', `${isSample ? `Fictional ${documentTypes[state.sampleKind].label} screenshot` : 'Your uploaded screenshot'}, ${state.view === 'original' ? 'original view' : `${count} masks applied`}`);
}
let toastTimer;
function announce(message, { undo = false } = {}) {
  const toast = $('toast'); toast.replaceChildren();
  const text = document.createElement('span'); text.textContent = message; toast.append(text);
  if (undo && contextUndo) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Undo'; button.addEventListener('click', undoSharingSettings); toast.append(button); }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss notification'); close.addEventListener('click', () => { toast.hidden = true; }); toast.append(close);
  toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
}
function setDrawing(enabled, { keep = false } = {}) {
  state.drawing = enabled && (keep ? 'keep' : 'mask');
  if (enabled) { state.adjusting = null; state.reviewExpanded = false; setPanning(false); }
  state.drag = null;
  $('canvasWrap').classList.toggle('drawing', enabled);
  $('drawButton').setAttribute('aria-pressed', String(enabled));
  $('drawButton').lastChild.textContent = enabled ? (keep ? ' Cancel selection' : ' Finish masking') : ' Add a mask';
  $('mobileDrawButton').setAttribute('aria-pressed', String(enabled));
  $('drawHint').textContent = keep ? 'Drag around the area to keep' : 'Drag to cover a detail';
  $('drawHint').hidden = !enabled;
  if (enabled) state.view = 'protected';
}
function point(event) { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(base.width, (event.clientX - r.left) * base.width / r.width)), Math.max(0, Math.min(base.height, (event.clientY - r.top) * base.height / r.height))]; }
function maskAtPoint(position) {
  if (state.drawing || state.adjusting || state.view !== 'protected') return null;
  const [x, y] = position;
  if (instructionRects.some(([left, top, w, h]) => x >= left && x < left + w && y >= top && y < top + h)) return null;
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
function dragRect() {
  const { start, end } = state.drag;
  const x = Math.floor(Math.min(start[0], end[0])), y = Math.floor(Math.min(start[1], end[1]));
  return [x, y, Math.ceil(Math.max(start[0], end[0])) - x, Math.ceil(Math.max(start[1], end[1])) - y];
}
canvas.addEventListener('click', event => {
  // A completed drag can dispatch a click after opening the keep-area dialog.
  if (document.querySelector('dialog[open]')) return;
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
  if (rect[2] >= 5 && rect[3] >= 5) {
    if (state.drawing === 'keep') {
      previewKeepArea(rect);
      return;
    }
    state.manual.push({ id: state.nextId++, rect, hidden: true }); announce('Manual mask added. Stop drawing to click it off or back on.');
  }
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
$('documentType').addEventListener('change', event => setContext({
  documentType: event.target.value, typeSource: 'manual', typeReason: 'Type selected by you.'
}));
$('useLocalType').addEventListener('click', () => {
  if (!state.ocrDocument) return;
  const result = classifyDocument(state.ocrDocument);
  setContext({ documentType: result.type, typeSource: 'local', typeReason: result.reason });
});
$('customInstruction').addEventListener('input', event => updateInstructionDraft(event.target.value));
$('customInstructionPanel').addEventListener('click', event => {
  const example = event.target.closest('[data-example]');
  if (!example) return;
  updateInstructionDraft(example.dataset.example);
  const field = $('customInstruction');
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
});
function updateInstructionDraft(value) {
  const text = value.slice(0, instructionLimit);
  if (text === state.customInstruction) return;
  state.customInstruction = text;
  state.waitingForOCR = false;
  sharingVersion++;
  invalidateProtection();
  renderContextOptions();
}
$('editInstruction').addEventListener('click', () => {
  openContextDialog();
  $('customInstruction').focus();
});
$('drawInstructionArea').addEventListener('click', () => {
  const instruction = currentInstruction();
  if (!instruction?.enabled) return;
  const keep = instruction.operation.type === 'keep_area';
  setDrawing(true, { keep });
  render();
  $('previewHeading').scrollIntoView({ block: 'nearest' });
  $('previewHeading').focus({ preventScroll: true });
  announce(keep ? 'Drag a rectangle around the area to keep.' : 'Drag a mask over the area you want to hide.');
});
$('toggleInstruction').addEventListener('click', () => {
  const instruction = currentInstruction();
  if (!instruction?.operation) return;
  applyInstruction({ ...instruction, enabled: !instruction.enabled });
  render();
});
function previewKeepArea(rect) {
  const instruction = currentInstruction();
  state.drag = null;
  if (instruction?.operation?.type !== 'keep_area' || !validKeepArea(rect, base.width, base.height)) {
    renderCanvas();
    announce('Choose a smaller area within the screenshot.');
    return;
  }
  keepAreaDraft = { instruction, rect };
  setDrawing(false);
  render();
  const rectangles = instructionRectangles(instruction.operation, { width: base.width, height: base.height, keepArea: rect });
  drawImage($('keepAreaPreview'), true, rectangles, 650);
  $('keepAreaDialog').showModal();
}
$('confirmKeepArea').addEventListener('click', () => {
  const draft = keepAreaDraft;
  if (!$('keepAreaDialog').open || !draft || draft.instruction !== currentInstruction() || !validKeepArea(draft.rect, base.width, base.height)) return;
  applyInstruction({ ...draft.instruction, keepArea: draft.rect });
  $('keepAreaDialog').close();
  render();
  $('previewHeading').focus({ preventScroll: true });
});
$('keepAreaDialog').addEventListener('close', () => {
  keepAreaDraft = null;
  $('keepAreaPreview').width = 0;
});
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
  loadingImageId = loadId;
  invalidateProtection();
  clearContextChange();
  cancelDetection();
  if ($('aiDialog').open) $('aiDialog').close();
  render();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (loadId !== state.loadId) return;
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 20000000) throw new Error('size');
    base.width = image.naturalWidth; base.height = image.naturalHeight; b.fillStyle = '#fff'; b.fillRect(0, 0, base.width, base.height); b.drawImage(image, 0, 0);
    clearDetection(); clearSharingChoices(); hoveredField = null;
    state.documentType = 'general'; state.typeSource = 'pending'; state.typeReason = 'Local reading can suggest a type. You can also select one.';
    state.nextFieldId = 1; state.source = 'upload'; state.filename = file.name; state.fields = []; state.manual = []; state.nextId = 1; state.view = 'protected'; setDrawing(false);
    loadingImageId = null;
    startImageFlow();
  } catch(error) { if (loadId === state.loadId) announce(error.message === 'size' ? 'Image is too large to edit here (20 megapixels maximum).' : 'This image could not be opened. Please try another PNG, JPEG or WebP.'); }
  finally {
    if (loadingImageId === loadId) { loadingImageId = null; renderProtectionControls(); }
    URL.revokeObjectURL(url); $('fileInput').value = '';
  }
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
  if (state.flow === 'context') renderChooseProgress();
}
$('aiConsent').addEventListener('change', renderAIDetectionConsent);
$('aiRestoreMasks').addEventListener('change', renderAIDetectionConsent);
$('zoomButton').addEventListener('click', () => setZoom(1));
$('fitButton').addEventListener('click', () => setZoom(null, 'fit'));
$('widthButton').addEventListener('click', () => setZoom(null, 'width'));
$('reviewWidth').addEventListener('input', event => { state.reviewWidth = Number(event.target.value); $('reviewWidthValue').textContent = `${state.reviewWidth} px`; scheduleWorkspaceLayout(); });
$('zoomInButton').addEventListener('click', () => setZoom((state.zoom ?? currentFitScale()) * 1.25));
$('zoomOutButton').addEventListener('click', () => setZoom((state.zoom ?? currentFitScale()) / 1.25));
$('cancelDetectionButton').addEventListener('click', stopScanning);
$('cancelScan').addEventListener('click', stopScanning);
function dismissAIDetection() {
  if (state.phase === 'ai' && state.aiStatus === 'processing') stopScanning();
  $('aiDialog').close();
  $('aiButton').focus({ preventScroll: true });
}
$('cancelAI').addEventListener('click', dismissAIDetection);
$('aiClose').addEventListener('click', dismissAIDetection);
$('continueWithoutAI').addEventListener('click', dismissAIDetection);
$('aiDialog').addEventListener('cancel', event => {
  event.preventDefault();
  dismissAIDetection();
});
$('aiDialog').addEventListener('close', () => {
  if ($('aiDialog').open) return;
  aiPreview = null;
  if (state.phase === 'ai' && state.aiStatus === 'processing') stopScanning();
});
$('ocrLanguage').addEventListener('change', () => {
  clearContextChange();
  invalidateProtection();
  textLines = [];
  state.ocrStatus = 'idle'; state.ocrDocument = null; aiPreview = null; state.aiDetected = false; state.detectedModel = ''; state.aiStatus = 'idle'; state.aiInsights = []; state.aiTypeSuggestion = null; $('aiConsent').checked = false;
  render(); setAIStatus('Language changed. Earlier masks retained. Read the text again before AI classification.');
});
async function scanLocally() {
  if (state.detecting) return;
  invalidateProtection();
  const currentId = ++detectionId; const loadId = state.loadId;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 90_000);
  state.detecting = true; state.phase = 'ocr'; state.ocrStatus = 'running'; setDrawing(false); render();
  setAIStatus('Loading local text recognition. Models are loaded from this site; your image stays on this device.');
  try {
    const language = state.source === 'sample' && $('ocrLanguage').value === 'auto' ? 'eng' : $('ocrLanguage').value;
    const document = await recognizeLocal(base, { language, signal: controller.signal, onProgress: message => {
      if (currentId === detectionId && loadId === state.loadId) setAIStatus(`Local OCR · ${message.status}${Number.isFinite(message.progress) ? ` · ${Math.round(message.progress * 100)}%` : ''}`);
    } });
    if (currentId !== detectionId || loadId !== state.loadId) return;
    controller.signal.throwIfAborted();
    const suggestions = suggestionsToFields(localSuggestions(document), document);
    textLines = textLineTargets(document);
    clearContextChange();
    updateTypeFromText(document);
    const reconciled = receiveFields(suggestions);
    state.ocrStatus = document.words.length ? 'complete' : 'empty';
    state.ocrDocument = document; state.aiDetected = false; state.detectedModel = ''; state.aiStatus = 'idle'; state.aiInsights = []; state.aiTypeSuggestion = null; state.highlighted = null;
    setAIStatus(`${document.words.length} text words read locally. ${suggestions.length} local field suggestions; ${reconciled.restored} user choices matched, ${reconciled.retained} earlier regions retained for review. ${document.words.length ? 'Click any recognized text line in the image or the text list to mask it. AI classification is optional.' : 'No text found: add masks manually. This does not mean the image is safe.'}`);
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) {
      state.ocrStatus = 'failed';
      setAIStatus(error.name === 'AbortError' ? 'Local OCR timed out. Earlier masks retained; try a smaller image.' : error.message, true);
    }
  } finally {
    clearTimeout(timeout);
    if (currentId === detectionId) {
      const proceed = state.waitingForOCR && state.ocrStatus === 'complete' && $('contextDialog').open && !contextReviewBlocker();
      state.detecting = false; state.phase = ''; detectionController = null; state.waitingForOCR = false;
      if (proceed) showReview({ applyCustom: true });
      else render();
    }
  }
}
$('ocrButton').addEventListener('click', () => { $('moreDialog').close(); void scanLocally(); });

function currentDetectionPreview(preview) {
  return preview && preview.document === state.ocrDocument && preview.loadId === state.loadId && preview.version === sharingVersion;
}

function renderAIDetectionConsent() {
  const available = !state.detecting && currentDetectionPreview(aiPreview) && Boolean(aiPreview.provider);
  const restorable = reapplyCandidates().length > 0;
  const restore = $('aiRestoreMasks');
  $('aiRestoreOption').hidden = !restorable;
  restore.disabled = !available || !restorable;
  $('aiConsent').disabled = !available;
  const button = $('detectButton');
  button.disabled = !available || !$('aiConsent').checked;
  button.textContent = restorable && restore.checked ? 'Analyze and restore masks' : 'Analyze text with AI';
}

function showAIDetectionView(id) {
  const dialog = $('aiDialog');
  for (const section of dialog.querySelectorAll('.ai-detection-view')) section.hidden = section.id !== id;
  const heading = $(id).querySelector('h2');
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.scrollTop = 0;
  if (dialog.open) heading.focus({ preventScroll: true });
}

function setAIDetectionStage(stage) {
  const steps = [...$('aiStages').children];
  const active = steps.findIndex(item => item.dataset.stage === stage);
  steps.forEach((item, index) => {
    item.dataset.state = index < active ? 'complete' : index === active ? 'active' : 'pending';
    item.querySelector('.ai-stage-status').textContent = { complete: 'Completed', active: 'In progress', pending: 'Pending' }[item.dataset.state];
    if (index === active) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  $('aiStageAnnouncement').textContent = steps[active].children[1].textContent;
}

function showAIDetectionResult(restored) {
  const findings = state.aiInsights.filter(item => item.kind === 'new');
  const count = findings.length;
  const masked = state.fields.filter(field => field.hidden && findings.some(item => item.id === field.id)).length;
  const details = count === 1 ? 'detail' : 'details';
  const restoredLabel = `${restored} suggested ${restored === 1 ? 'mask' : 'masks'} restored`;
  const restorable = reapplyCandidates().length;
  $('aiResultHeading').textContent = count ? 'AI check complete' : 'Analysis complete';
  $('aiResultBadge').textContent = count ? `${count} additional private ${details} found`
    : restored ? restoredLabel : 'No additional private details found';
  let message = 'AI did not identify any additional fields in this analysis. Check the entire image before sharing.';
  if (count > 0) {
    if (count === 1) {
      message = masked ? 'A mask covers the new detail. Review it alongside your edits.' : 'The new detail is marked visible. Review it before sharing.';
    } else {
      message = masked === count ? 'Masks cover the new details. Review them alongside your edits.'
        : `${masked} of ${count} new details are masked. Review what’s visible before sharing.`;
    }
  }
  if (restored) {
    message = count ? `${message} ${restoredLabel}.` : 'Check the restored masks and the rest of the image before sharing.';
  }
  if (restorable) message += ` ${restorable} ${restorable === 1 ? 'detail remains' : 'details remain'} marked visible and can be covered again.`;
  $('aiResultMessage').textContent = message;
  $('aiResultReapply').hidden = !restorable;
  const next = $('aiResultContinue');
  next.querySelector('span').textContent = count ? 'Review findings' : 'Continue reviewing';
  next.querySelector('svg').toggleAttribute('hidden', !count);
  next.classList.toggle('ai-detection-secondary', !count || Boolean(restorable));
  showAIDetectionView('aiResult');
}

$('aiResultContinue').addEventListener('click', () => {
  dismissAIDetection();
  const first = $('aiInsightsList').querySelector('[data-finding="new"]');
  if (!first) return;
  state.reviewExpanded = true;
  renderFlow();
  $('aiInsightsPanel').open = true;
  first.focus();
});
$('aiResultReapply').addEventListener('click', () => {
  dismissAIDetection();
  openReapplyDialog();
});

$('detectButton').addEventListener('click', async () => {
  const preview = aiPreview;
  if (state.detecting || !$('aiDialog').open || $('aiReady').hidden || !$('aiConsent').checked
      || !currentDetectionPreview(preview) || !preview.provider) return;
  const restore = !$('aiRestoreMasks').disabled && $('aiRestoreMasks').checked;
  invalidateProtection();
  const currentId = ++detectionId; const loadId = state.loadId;
  const { document, payload } = preview;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), AI_BUDGET.browserMs);
  const requestIsCurrent = () => {
    if (currentId !== detectionId || loadId !== state.loadId) return false;
    if (!$('aiDialog').open) { stopScanning(); return false; }
    if (!currentDetectionPreview(preview)) {
      dismissAIDetection();
      announce('Sharing settings changed. Start a new analysis for this copy.');
      return false;
    }
    return true;
  };
  state.detecting = true; state.phase = 'ai'; state.aiStatus = 'processing'; setDrawing(false); render();
  setAIStatus('Analyzing the screened text you agreed to send.');
  setAIDetectionStage('preparing');
  showAIDetectionView('aiAnalysis');
  let response;
  try {
    const body = JSON.stringify(payload);
    setAIDetectionStage('sending');
    const pending = fetch('/api/ai?action=classify-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal
    });
    setAIDetectionStage('waiting');
    response = await pending;
    if (!requestIsCurrent()) return;
    setAIDetectionStage('validating');
    const result = await readAPI(response);
    if (!requestIsCurrent()) return;
    controller.signal.throwIfAborted();
    const classified = validateClassifications(result.fields, document);
    const aiFields = suggestionsToFields(classified, document);
    const fields = suggestionsToFields([...classified, ...localSuggestions(document)], document);
    const previousFields = state.fields;
    // Build everything first: an invalid result cannot partially replace existing masks.
    setAIDetectionStage('applying');
    clearContextChange();
    const reconciled = receiveFields(fields);
    state.aiInsights = aiInsights(previousFields, aiFields, state.fields); state.aiTypeSuggestion = suggestTypeFromAI(classified); state.aiStatus = 'complete';
    state.aiDetected = true; state.detectedModel = result.model; state.view = 'protected'; state.highlighted = null;
    const restored = restore ? restoreSuggestedMasks() : 0;
    const { hidden, detected } = coverageSummary(state.fields, state.manual);
    setAIStatus(`${hidden} of ${detected} detected details hidden after classification. ${reconciled.retained} earlier regions available for review.`);
    showAIDetectionResult(restored);
  } catch {
    if (requestIsCurrent()) {
      state.aiStatus = 'failed';
      const timedOut = controller.signal.aborted || response?.status === 504;
      const message = timedOut ? 'The AI service took too long. Your masks are ready to review.' : 'Your masks and edits are ready to review.';
      $('aiFailureMessage').textContent = message;
      setAIStatus(timedOut ? message : 'AI detection could not be completed. Review your masks or try again.', true);
      showAIDetectionView('aiFailure');
    }
  } finally {
    clearTimeout(timeout);
    if (currentId === detectionId) { state.detecting = false; state.phase = ''; detectionController = null; render(); }
  }
});
$('aboutButton').addEventListener('click', () => $('aboutDialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
let exportCopy = null;
$('exportButton').addEventListener('click', async () => {
  if (state.detecting || state.exporting) return;
  state.exporting = true;
  try {
    setDrawing(false); render();
    const output = document.createElement('canvas');
    drawImage(output, true);

    // Capture the review information in the same turn as the pixels.
    const plan = currentPlan();
    const choice = protectionContext();
    const description = state.instruction?.text;
    const kept = state.fields.filter(field => !field.hidden).map(field => field.name.toLowerCase());
    const coverage = coverageSummary(state.fields, state.manual, instructionRects);
    const textSource = state.ocrDocument
      ? (state.aiDetected ? `Text classification: ${state.detectedModel}.` : 'Local text detection.')
      : 'No current OCR results. Review every part of the image.';
    const snapshot = {
      loadId: state.loadId,
      filename: `privacylens-${state.documentType}-${state.context || 'unspecified'}-${state.source === 'sample' ? 'sample' : 'image'}.png`,
      context: [
        `${plan.label}.`,
        choice.custom && description ? `Privacy instruction: ${description}${/[.!?。！？]$/u.test(description) ? '' : '.'}` : '',
        state.recipientDetail ? `Recipient note: ${state.recipientDetail}.` : '',
        plan.note, 'Check that every visible detail is needed for this copy.'
      ].filter(Boolean).join(' '),
      details: [
        `${coverage.detected} detected details: ${coverage.hidden} hidden, ${coverage.markedVisible} marked visible.`,
        `${coverage.manual} added ${coverage.manual === 1 ? 'mask' : 'masks'}. ${coverage.masks} solid ${coverage.masks === 1 ? 'mask' : 'masks'} applied.`,
        instructionRects.length ? `${instructionRects.length} ${instructionRects.length === 1 ? 'mask comes' : 'masks come'} from your privacy instruction.` : '',
        textSource, 'Check missed text, edges, QR codes, barcodes and faces.',
        kept.length ? `Set to visible: ${kept.join(', ')}. Overlapping masks may still cover these details.` : '',
        coverage.needsReview ? `${coverage.needsReview} ${coverage.needsReview === 1 ? 'detail needs' : 'details need'} review and stay masked by default.` : '',
        coverage.masks === 0 ? 'All image details are visible on this copy.' : ''
      ].filter(Boolean).join(' ')
    };

    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (snapshot.loadId !== state.loadId || state.flow !== 'review') return;
    if (!blob) throw new Error('encoding');
    if (exportCopy) URL.revokeObjectURL(exportCopy.url);
    exportCopy = { ...snapshot, url: URL.createObjectURL(blob) };
    $('exportPreview').src = exportCopy.url;
    $('exportContext').textContent = exportCopy.context;
    $('exportDetails').textContent = exportCopy.details;
    $('reviewConfirmation').checked = false; $('downloadButton').disabled = true; $('exportDialog').showModal();
  } catch {
    announce('Could not prepare the image. Please try again with a smaller image.');
  } finally {
    state.exporting = false;
    $('exportButton').disabled = state.detecting;
  }
});
$('reviewConfirmation').addEventListener('change', event => { $('downloadButton').disabled = !event.target.checked; });
$('downloadButton').addEventListener('click', () => {
  if (!$('reviewConfirmation').checked || exportCopy?.loadId !== state.loadId) return;
  const link = document.createElement('a');
  link.href = exportCopy.url; link.download = exportCopy.filename;
  document.body.append(link); link.click(); link.remove();
  $('exportDialog').close(); announce('PNG download started. Review the saved image before sharing.');
});
$('exportDialog').addEventListener('close', () => {
  if ($('exportDialog').open || !exportCopy) return;
  URL.revokeObjectURL(exportCopy.url); exportCopy = null; $('exportPreview').removeAttribute('src');
});
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
  $('typeButton').textContent = documentTypes[state.documentType].label;
  $('contextButton').replaceChildren();
  const label = document.createElement('span'); label.className = 'current-context';
  label.textContent = state.context === 'custom' ? 'Custom' : audiences[state.context]?.label || 'Sharing settings';
  const change = document.createElement('span'); change.textContent = 'Change ↗'; $('contextButton').append(label, change);
  $('editorWorkspace').classList.toggle('sheet-open', state.reviewExpanded);
  $('reviewToggle').setAttribute('aria-expanded', String(state.reviewExpanded)); $('sheetLabel').textContent = state.reviewExpanded ? 'Back to image' : 'Review details'; $('sheetArrow').textContent = state.reviewExpanded ? '↓' : '↑';
  $('aiButton').disabled = state.detecting;
}
function openContextDialog({ showType = false } = {}) {
  if (!state.hasImage) return;
  setDrawing(false);
  if (!$('contextDialog').open) {
    $('typeSettings').open = showType;
    $('toast').hidden = true;
  }
  state.flow = 'context'; render();
  if (!$('contextDialog').open) {
    $('contextDialog').showModal();
    $('contextHeading').focus({ preventScroll: true });
  }
}
function closeWorkDialogs() {
  for (const id of ['contextDialog', 'moreDialog', 'aiDialog', 'protectionDialog', 'protectionChoiceDialog', 'keepAreaDialog', 'reapplyDialog', 'exportDialog', 'aboutDialog']) {
    if ($(id).open) $(id).close();
  }
}
function startImageFlow() {
  closeWorkDialogs();
  state.hasImage = true; state.fitMode = 'auto'; state.zoom = null; setPanning(false);
  state.reviewExpanded = false; state.expandedField = null;
  $('typeSettings').open = false; $('contextExplanation').open = false;
  openContextDialog();
  scheduleWorkspaceLayout(); $('canvasStage').scrollTop = 0; window.scrollTo({ top: 0, behavior: 'auto' });
  void scanLocally();
}
function loadExample(kind) {
  setSample(kind); $('fileInput').value = ''; startImageFlow();
}
function stopScanning() {
  if (!state.detecting) return;
  const ai = state.phase === 'ai';
  cancelDetection(); render();
  setAIStatus(ai ? 'Analysis cancelled. A sent request may still finish at the provider.' : 'Text reading cancelled. Review the image or retry reading.');
}
function showReview({ applyCustom = false } = {}) {
  state.waitingForOCR = false;
  if (applyCustom) commitInstruction();
  state.flow = 'review';
  if ($('contextDialog').open) $('contextDialog').close();
  render();
  if (applyCustom && state.context === 'custom') $('reviewScroll').scrollTop = 0;
  if (contextUndo) announce(contextFeedback, { undo: true });
  $('previewHeading').focus({ preventScroll: true });
}
$('sharingAudiences').addEventListener('change', event => {
  if (event.target.name === 'sharing-mode' && event.target.checked) setContext({ context: event.target.value });
});
$('acceptContextConflict').addEventListener('click', () => {
  state.acceptedConflict = true; renderContextOptions();
  $('continueContext').focus({ preventScroll: true });
});
$('continueContext').addEventListener('click', () => {
  if (state.waitingForOCR || contextReviewBlocker()) return;
  if (state.phase === 'ocr') {
    state.waitingForOCR = true; renderContextOptions();
  } else {
    showReview({ applyCustom: true });
  }
});
$('retryChooseOCR').addEventListener('click', () => { void scanLocally(); });
$('skipContext').addEventListener('click', () => {
  if (!protectionContext().compatible && !typePending()) state.acceptedConflict = true;
  showReview();
});
$('contextDialog').addEventListener('close', () => {
  if (!$('contextDialog').open && state.flow === 'context') showReview();
});
$('contextButton').addEventListener('click', () => openContextDialog());
$('typeButton').addEventListener('click', () => openContextDialog({ showType: true }));
$('editTypeButton').addEventListener('click', () => { $('typeSettings').open = !$('typeSettings').open; });
$('moreButton').addEventListener('click', () => $('moreDialog').showModal());
async function openAIDetectionConsent() {
  if (state.detecting) return;
  const dialog = $('aiDialog');
  $('aiConsent').checked = false;
  $('aiRestoreMasks').checked = false;
  $('retryAIProvider').hidden = true;
  for (const id of ['aiDataDetails', 'aiTextDetails', 'aiPayloadDetails', 'aiTechnicalDetails']) $(id).open = false;
  const recognized = state.ocrDocument;
  const preview = recognized?.words.length
    ? { document: recognized, payload: textPayload(recognized), loadId: state.loadId, version: sharingVersion, provider: null }
    : null;
  aiPreview = preview;
  // Render the snapshot submitted by the analysis button.
  $('aiSendPreview').textContent = preview ? preview.payload.lines.map(line => line.words.map(word => word.text).join(' ')).join('\n') : 'Read text locally first.';
  $('aiPayloadPreview').textContent = preview ? JSON.stringify(preview.payload, null, 2) : 'Read text locally first.';
  $('aiReadyStatus').textContent = preview ? 'Checking the configured AI provider…' : 'Read text locally first to enable AI detection.';
  renderAIDetectionConsent();
  showAIDetectionView('aiReady');
  if (!dialog.open) {
    $('toast').hidden = true;
    dialog.showModal();
    $('aiHeading').focus({ preventScroll: true });
  }
  if (!preview) return;
  const provider = await readConfiguredProvider();
  if (!dialog.open || aiPreview !== preview || !currentDetectionPreview(preview)) return;
  preview.provider = provider;
  if (provider) {
    for (const label of dialog.querySelectorAll('[data-ai-provider]')) label.textContent = provider;
    $('aiReadyStatus').textContent = '';
  } else {
    $('aiReadyStatus').textContent = 'The AI provider is unavailable. Try the provider check again or continue reviewing.';
    $('retryAIProvider').hidden = false;
  }
  renderAIDetectionConsent();
}
$('aiButton').addEventListener('click', openAIDetectionConsent);
$('retryAI').addEventListener('click', openAIDetectionConsent);
$('retryAIProvider').addEventListener('click', openAIDetectionConsent);

function protectionVersion() {
  return { loadId: state.loadId, ocrDocument: state.ocrDocument, sharingVersion, fieldsVersion };
}

function currentProtectionResult() {
  const result = sharingAI.result;
  return result && sameProtectionVersion(result.version, protectionVersion()) ? result : null;
}

function cancelProtectionRequest(message) {
  if (!sharingAI.request) return;
  sharingAI.request.controller.abort();
  sharingAI.request = null;
  sharingAI.message = message;
}

function invalidateProtection() {
  const active = sharingAI.request || sharingAI.result || sharingAI.interpretation;
  const message = active ? 'Sharing settings or detected details changed. Get new suggestions for this copy.' : '';
  cancelProtectionRequest(message);
  sharingAI.preview = null;
  sharingAI.result = null;
  sharingAI.interpretation = null;
  sharingAI.change = null;
  sharingAI.message = message;
  for (const id of ['protectionDialog', 'protectionChoiceDialog']) {
    if ($(id).open) $(id).close();
  }
}

function protectionBlocker(kind) {
  if (state.detecting || loadingImageId === state.loadId) return 'Wait for the current image or text analysis.';
  const choice = protectionContext();
  if (!choice.compatible) return 'Choose a supported audience for this document type.';
  if (choice.custom && currentInstruction()?.text !== state.customInstruction.trim()) {
    return 'Choose Review image in Sharing Settings to use this instruction.';
  }
  if (kind === 'instruction') return '';
  if (!state.fields.length) return 'Read the image for detected details first.';
  if (state.fields.length > protectionLimits.fields) return 'Use a copy with up to 100 detected details for AI sharing suggestions.';
  return '';
}

function canInterpretInstruction() {
  const instruction = currentInstruction();
  return Boolean(instruction?.enabled && !instruction.operation);
}
function currentInterpretation() {
  const interpretation = sharingAI.interpretation;
  return interpretation && sameProtectionVersion(interpretation.version, protectionVersion()) ? interpretation : null;
}
function renderProtectionControls() {
  const show = state.hasImage && Boolean(state.context);
  const interpret = show && canInterpretInstruction();
  const fieldBlocker = show ? protectionBlocker('fields') : '';
  const instructionBlocker = interpret ? protectionBlocker('instruction') : '';
  $('protectionPanel').hidden = !show;
  $('protectionButton').disabled = !show || Boolean(fieldBlocker || sharingAI.request);
  $('interpretInstruction').hidden = !interpret;
  $('interpretInstruction').disabled = Boolean(instructionBlocker || sharingAI.request);
  $('cancelProtection').hidden = !sharingAI.request;
  const message = sharingAI.request
    ? (sharingAI.request.kind === 'instruction' ? 'Interpreting your privacy instruction…' : 'Getting AI suggestions for the detected fields…')
    : sharingAI.message || (interpret ? instructionBlocker : fieldBlocker);
  if ($('protectionStatus').textContent !== message) $('protectionStatus').textContent = message;
  const interpretation = currentInterpretation();
  $('instructionAIResult').hidden = !interpretation;
  $('applyAIInstruction').disabled = Boolean(sharingAI.request || state.detecting);
  if (interpretation) $('instructionAIProposal').textContent = instructionOperationLabel(interpretation.operation) + '. Review this suggestion before applying it.';
  const preview = sharingAI.preview;
  const canConsent = show && preview?.provider && !sharingAI.request && !protectionBlocker(preview.kind)
    && sameProtectionVersion(preview.version, protectionVersion());
  $('protectionConsent').disabled = !canConsent;
  $('requestProtection').disabled = !canConsent || !$('protectionConsent').checked;
}

function renderProtectionSuggestion(field, suggestion) {
  const item = document.createElement('div');
  item.className = 'protection-suggestion';
  item.dataset.protectionAction = suggestion.action;
  const label = document.createElement('strong');
  const actionLabels = { hide: 'Hide', keep: 'Keep', review: 'Review' };
  label.textContent = `AI field suggestion · ${actionLabels[suggestion.action]}`;
  const reason = document.createElement('p');
  reason.textContent = suggestion.reason;
  item.append(label, reason);
  const hidden = protectionMaskChange(field, suggestion);
  if (hidden !== null) {
    const button = document.createElement('button');
    const action = hidden ? 'Review hiding' : 'Review showing';
    button.type = 'button'; button.className = 'inline-action'; button.textContent = action;
    button.setAttribute('aria-label', `${action} ${field.name.toLowerCase()}`);
    button.addEventListener('click', () => openProtectionChoice(field.id));
    item.append(button);
  }
  return item;
}

async function openSharingAI(kind) {
  if (!state.context || protectionBlocker(kind) || sharingAI.request) return;
  const interpret = kind === 'instruction';
  if (interpret && !canInterpretInstruction()) return;
  const instruction = currentInstruction();
  $('protectionConsent').checked = false;
  $('protectionDataDetails').open = false;
  let preview;
  try {
    let input;
    if (interpret) {
      input = { body: createInstructionRequest(state.documentType, instruction.text, state.fields) };
    } else {
      const choice = protectionContext();
      const context = choice.custom ? 'unspecified' : choice.context;
      const task = choice.purpose !== 'custom' ? purposeRegistry[choice.purpose]?.label : '';
      const customPurpose = instruction?.text || task || 'Share for general assistance. A need for specific personal identifiers has not been established.';
      input = createProtectionInput({ documentType: state.documentType, context, customPurpose }, state.fields);
    }
    preview = { ...input, kind, version: protectionVersion(), provider: null };
  } catch (error) {
    sharingAI.message = error.message;
    renderProtectionControls();
    return;
  }
  sharingAI.preview = preview;
  const { body } = preview;
  $('protectionTypeLabel').textContent = interpret ? 'OPTIONAL AI INTERPRETATION' : 'OPTIONAL AI PROTECTION';
  $('protectionHeading').textContent = interpret ? 'Interpret my instruction' : 'Suggest what to share';
  $('protectionDisclosure').textContent = interpret
    ? 'This sends the screened instruction, document type and field categories through this site’s server to'
    : 'This sends the screened sharing context, audience, document type and field metadata through this site’s server to';
  $('protectionTextLabel').textContent = instruction ? 'Instruction to be sent' : 'Sharing context to be sent';
  $('protectionPurposePreview').textContent = interpret ? body.instruction : body.purpose;
  $('protectionContextLabel').textContent = interpret ? 'Document type' : 'Audience and document';
  const documentLabel = documentTypes[body.documentType].label;
  $('protectionContextPreview').textContent = interpret ? documentLabel : `${audiences[body.audience]?.label || 'Audience unspecified'} · ${documentLabel}`;
  const categories = interpret ? body.categories : [...new Set(body.fields.map(field => field.category))];
  $('protectionFieldsPreview').textContent = categories.map(category => categoryNames[category]).join(' · ') || 'None detected';
  $('protectionPrivacyHelp').textContent = interpret
    ? 'The instruction can still contain personal information. Check the preview. AI can suggest a masking operation for you to review.'
    : 'The sharing context can still contain personal information. Check the preview. Review the suggestions before changing visibility.';
  $('protectionConsentLabel').textContent = interpret
    ? 'I agree to send this screened instruction and listed metadata for AI interpretation.'
    : 'I agree to send this screened context and listed metadata for AI field suggestions.';
  $('requestProtection').textContent = interpret ? 'Interpret instruction' : 'Get sharing suggestions';
  $('protectionProvider').textContent = 'the configured AI provider';
  $('protectionProviderStatus').textContent = 'Checking the configured AI provider…';
  $('protectionPayloadPreview').textContent = JSON.stringify(body, null, 2);
  renderProtectionControls();
  $('toast').hidden = true;
  $('protectionDialog').showModal();
  $('protectionHeading').focus({ preventScroll: true });
  const provider = await readConfiguredProvider();
  if (!$('protectionDialog').open || sharingAI.preview !== preview || !sameProtectionVersion(preview.version, protectionVersion())) return;
  preview.provider = provider;
  $('protectionProviderStatus').textContent = provider ? '' : 'The AI provider is unavailable. Close this dialog to continue reviewing.';
  if (provider) $('protectionProvider').textContent = provider;
  renderProtectionControls();
}
$('protectionButton').addEventListener('click', () => void openSharingAI('fields'));
$('interpretInstruction').addEventListener('click', () => void openSharingAI('instruction'));
$('protectionConsent').addEventListener('change', renderProtectionControls);
$('protectionDialog').addEventListener('close', () => {
  if (!$('protectionDialog').open) {
    sharingAI.preview = null;
    $('protectionConsent').checked = false;
    renderProtectionControls();
  }
});
$('cancelProtection').addEventListener('click', () => {
  const kind = sharingAI.request?.kind;
  cancelProtectionRequest('Sharing analysis cancelled. Continue reviewing the image.');
  renderProtectionControls();
  $(kind === 'instruction' ? 'interpretInstruction' : 'protectionButton').focus({ preventScroll: true });
});

$('requestProtection').addEventListener('click', async () => {
  const preview = sharingAI.preview;
  if (!$('protectionDialog').open || $('requestProtection').disabled || !$('protectionConsent').checked || sharingAI.request
      || !preview?.provider || protectionBlocker(preview.kind) || !sameProtectionVersion(preview.version, protectionVersion())) return;
  const interpret = preview.kind === 'instruction';
  const controller = new AbortController();
  const request = { controller, kind: preview.kind };
  sharingAI.request = request;
  if (interpret) sharingAI.interpretation = null;
  else sharingAI.result = null;
  sharingAI.message = '';
  $('protectionDialog').close();
  render();
  const timeout = setTimeout(() => controller.abort(), AI_BUDGET.browserMs);
  try {
    const action = interpret ? 'interpret-instruction' : 'recommend-protection';
    const response = await readAPI(await fetch(`/api/ai?action=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview.body), signal: controller.signal
    }));
    if (sharingAI.request !== request || !sameProtectionVersion(preview.version, protectionVersion())) return;
    controller.signal.throwIfAborted();
    if (interpret) {
      const [operation] = validateInstructionOperations(response, preview.body.categories);
      sharingAI.interpretation = operation ? { version: preview.version, operation } : null;
      sharingAI.message = operation ? 'AI interpretation ready' : 'AI found no supported masking operation. Review the image or use manual masks.';
      return;
    }
    const decisions = validateProtectionDecisions(response, preview.body.fields);
    const fields = new Map(state.fields.map(field => [field.id, field]));
    const suggestions = new Map(decisions.map(decision => {
      const field = fields.get(preview.fieldIds.get(decision.field_id));
      if (!field) throw new Error('A detected detail changed. Get new suggestions for this copy.');
      return [field.id, safeProtectionRecommendation(field, preview.body, decision)];
    }));
    sharingAI.result = { version: preview.version, suggestions };
    const remaining = preview.body.fields.length - suggestions.size;
    sharingAI.message = suggestions.size
      ? `Review ${suggestions.size} AI ${suggestions.size === 1 ? 'suggestion' : 'suggestions'} in the field list.${remaining ? ' Other details use local recommendations.' : ''}`
      : 'AI returned no suggestions. Review the local recommendations.';
  } catch (error) {
    if (sharingAI.request === request && sameProtectionVersion(preview.version, protectionVersion())) {
      sharingAI.message = controller.signal.aborted ? 'Sharing analysis timed out. Continue reviewing the local recommendations.'
        : interpret ? 'AI interpretation is unavailable. Continue reviewing the current protection.' : error.message;
    }
  } finally {
    clearTimeout(timeout);
    if (sharingAI.request === request) { sharingAI.request = null; render(); }
  }
});
$('applyAIInstruction').addEventListener('click', () => {
  const interpretation = currentInterpretation();
  if (!interpretation || !canInterpretInstruction() || state.detecting || sharingAI.request || protectionBlocker('instruction')) return;
  applyInstruction({ ...currentInstruction(), operation: interpretation.operation, source: 'ai' });
  render();
  $('editInstruction').focus({ preventScroll: true });
});

function openProtectionChoice(id) {
  const result = currentProtectionResult();
  const field = state.fields.find(item => item.id === id);
  const suggestion = result?.suggestions.get(id);
  if (!field || !suggestion) return;
  const hidden = protectionMaskChange(field, suggestion);
  if (hidden === null) return;
  sharingAI.change = { id, hidden, result };
  $('protectionChoiceHeading').textContent = `${hidden ? 'Hide' : 'Show'} ${field.name.toLowerCase()}?`;
  $('protectionChoiceDetail').textContent = hidden ? suggestion.reason
    : `${suggestion.reason} Check who will receive the image and what they need before showing this detail. Overlapping masks can still cover it.`;
  $('confirmProtectionChoice').textContent = hidden ? 'Hide detail' : 'Show detail';
  $('protectionChoiceDialog').showModal();
}

$('protectionChoiceDialog').addEventListener('close', () => {
  if (!$('protectionChoiceDialog').open) sharingAI.change = null;
});
$('confirmProtectionChoice').addEventListener('click', () => {
  const change = sharingAI.change;
  const result = currentProtectionResult();
  if (!$('protectionChoiceDialog').open || !change || change.result !== result) return;
  const field = state.fields.find(item => item.id === change.id);
  if (!field || protectionMaskChange(field, result.suggestions.get(field.id)) !== change.hidden) return;
  setFieldChoice(field, change.hidden);
  state.view = 'protected';
  $('protectionChoiceDialog').close();
  render();
  document.querySelector(`#field-${field.id} input`)?.focus({ preventScroll: true });
  announce(`${field.name} marked ${change.hidden ? 'hidden' : 'visible'}. Review the image before sharing.`);
});

function openReapplyDialog() {
  const count = reapplyCandidates().length;
  if (!count || state.detecting) return;
  $('reapplyMessage').textContent = `This will cover ${count} ${count === 1 ? 'detail you chose' : 'details you chose'} to show. Your added masks and adjusted boxes are preserved.`;
  $('reapplyDialog').showModal();
}
$('reapplyMasks').addEventListener('click', openReapplyDialog);
$('confirmReapply').addEventListener('click', () => {
  if (!$('reapplyDialog').open || state.detecting) return;
  const count = restoreSuggestedMasks();
  $('reapplyDialog').close(); render();
  if (count) announce(`${count} recommended ${count === 1 ? 'mask restored' : 'masks restored'}. Review the updated image.`);
  $('previewHeading').focus({ preventScroll: true });
});
$('applyAIType').addEventListener('click', () => {
  const type = state.aiTypeSuggestion;
  if (!type || state.typeSource === 'manual' || state.documentType !== 'general') return;
  state.aiTypeSuggestion = null;
  setContext({ documentType: type, typeSource: 'manual', typeReason: 'Type confirmed by you.' });
  openContextDialog();
});
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
async function readConfiguredProvider() {
  try {
    const response = await fetch('/api/ai-provider', { cache: 'no-store' });
    if (response.ok) {
      const { provider } = await response.json();
      if (typeof provider === 'string' && provider.trim()) return provider;
    }
  } catch { /* Local review is available if the provider cannot be reached. */ }
  return null;
}
async function loadProviderDisclosure() {
  const provider = await readConfiguredProvider();
  if (!provider) return;
  for (const label of document.querySelectorAll('[data-ai-provider]')) {
    if (!label.closest('dialog[open]')) label.textContent = provider;
  }
}
buildSharingCards();
setSample();
void loadProviderDisclosure();
