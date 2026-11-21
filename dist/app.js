import { AI_BUDGET } from './ai-policy.js';
import { readAPI } from './api-client.js';
import { recognizeLocal } from './ocr.js';
import { createMaskAnimator } from './mask-motion.js';
import { maskTargetAtPoint, textLineTargets } from './mask-targets.js';
import { localSuggestions, suggestionsToFields, textPayload, validateClassifications } from './ocr-core.js';
import { audiences, applyRecommendations, sharingPlan, contextDifference, guardSuggestedReveals } from './sharing-context.js';
import { documentTypes, purposesFor, purposeRegistry, classifyDocument, suggestTypeFromAI } from './document-context.js';
import { reconcileFields, preserveEditedRegions, aiInsights, activeMasks, coverageSummary } from './field-state.js';
import { drawExtraSample } from './samples.js';
import { fitImageScale, workspaceLayout } from './editor-geometry.js';
import { resolveSharingChoice } from './workflow.js';
import { createProtectionInput, protectionLimits, protectionMaskChange, safeProtectionRecommendation, sameProtectionVersion, validateProtectionDecisions } from './protection.js';
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
const state = {
  flow: 'landing', hasImage: false, reviewExpanded: false, expandedField: null,
  context: '', purpose: '', documentType: 'delivery', typeSource: 'sample', typeReason: '',
  customPurpose: '', confirmedPurpose: '', acceptedConflict: false, recipientDetail: '',
  source: 'sample', sampleKind: 'delivery', filename: 'fictional-order.png', loadId: 0,
  fields: [], manual: [], nextId: 1, nextFieldId: 1, view: 'protected', drawing: false, drag: null, adjusting: null,
  detecting: false, phase: '', ocrStatus: 'idle', ocrDocument: null, waitingForOCR: false,
  aiDetected: false, detectedModel: '', aiStatus: 'idle', aiInsights: [], aiTypeSuggestion: null,
  exporting: false, zoom: null, fitMode: 'auto', panning: false, reviewWidth: 380, highlighted: null
};
let hoveredField = null;
let audienceOptions = '';
let purposeOptions = '';
let contextUndo = null;
let contextFeedback = '';
let sharingVersion = 0;
let fieldsVersion = 0;
let loadingImageId = null;
let aiPreview = null;
const purposeReview = { preview: null, request: null, result: null, change: null, message: '' };
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
  return { documentType: state.documentType, context: state.context, purpose: resolveSharingChoice(state).purpose };
}
function currentPlan() {
  const choice = resolveSharingChoice(state);
  const plan = sharingPlan(state.context, choice.purpose, state.documentType);
  if (!choice.compatible) plan.keep = 'Review the details needed for this copy. This combination uses conservative protection.';
  if (choice.custom && choice.purpose !== 'custom') plan.label += ' · confirmed from custom purpose';
  plan.label = `${documentTypes[state.documentType].label} · ${plan.label}`;
  return plan;
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
  state.context = ''; state.purpose = ''; state.customPurpose = ''; state.confirmedPurpose = '';
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
const sharingKeys = ['context', 'purpose', 'customPurpose', 'confirmedPurpose', 'acceptedConflict', 'documentType', 'typeSource', 'typeReason'];

function setContext(changes, { typing = false } = {}) {
  if (Object.entries(changes).every(([key, value]) => state[key] === value)) return;
  const before = protectionContext();
  const previousFields = state.fields;
  const previous = Object.fromEntries(sharingKeys.map(key => [key, state[key]]));
  Object.assign(state, changes);
  if (previous.context !== state.context || previous.documentType !== state.documentType || previous.customPurpose !== state.customPurpose) {
    state.confirmedPurpose = '';
  }
  state.acceptedConflict = false;
  state.waitingForOCR = false;
  sharingVersion++;
  invalidateProtection();

  const after = protectionContext();
  if (typing && before.purpose === after.purpose) {
    clearContextChange();
    $('contextFeedback').hidden = true;
    renderContextOptions();
    return;
  }

  state.drag = null; state.view = 'protected';
  resetFields();
  state.fields = guardSuggestedReveals(previousFields, state.fields);
  if (typing) {
    clearContextChange();
  } else {
    const changes = contextDifference(previousFields, state.fields);
    const names = values => values.length > 3 ? `${values.slice(0, 3).join(', ')} and ${values.length - 3} more` : values.join(', ');
    contextFeedback = [changes.hidden.length ? `Newly masked: ${names(changes.hidden)}.` : '', changes.visible.length ? `Now visible: ${names(changes.visible)}.` : ''].filter(Boolean).join(' ') || 'Sharing settings updated. Review your field choices.';
    const pending = state.fields.filter(field => field.pendingReveal).length;
    if (pending) contextFeedback += ` ${pending} suggested ${pending === 1 ? 'detail remains' : 'details remain'} hidden until you review them.`;
    const overrides = state.fields.filter(field => field.userOverride).length;
    if (overrides) contextFeedback += ` ${overrides} ${overrides === 1 ? 'field follows your choice' : 'fields follow your choices'}.`;
    contextUndo = {
      choices: previous, loadId: state.loadId,
      fields: previousFields.map(({ id, userOverride, pendingReveal }) => ({ id, userOverride, pendingReveal }))
    };
  }
  render();
}
$('undoContext').addEventListener('click', () => {
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
  $('sharingPurpose').focus({ preventScroll: true });
  announce('Previous sharing settings and field choices restored.');
});
function updateTypeFromText(document) {
  if (state.typeSource === 'manual') return;
  const result = classifyDocument(document);
  if (state.documentType !== result.type) {
    state.confirmedPurpose = ''; state.acceptedConflict = false; sharingVersion++;
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
function canContinueContext(choice = resolveSharingChoice(state)) {
  return Boolean(state.context && choice.purpose && (choice.compatible || state.acceptedConflict || typePending()));
}
function renderContextOptions() {
  const config = documentTypes[state.documentType];
  const choice = resolveSharingChoice(state);
  const audienceKeys = [...new Set([...(state.typeSource === 'pending' ? Object.keys(audiences) : config.audiences), state.context].filter(Boolean))];
  const audienceKey = audienceKeys.join(',');
  if (audienceOptions !== audienceKey) {
    audienceOptions = audienceKey;
    $('sharingAudiences').replaceChildren(...audienceKeys.map(key => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'sharing-profile'; button.dataset.audience = key;
      const content = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small'), dot = document.createElement('span');
      title.textContent = audiences[key].label; detail.textContent = audiences[key].detail;
      dot.className = 'radio-dot'; dot.setAttribute('aria-hidden', 'true'); content.append(title, detail); button.append(content, dot);
      return button;
    }));
  }
  for (const button of $('sharingAudiences').children) {
    const selected = button.dataset.audience === state.context;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }

  const presetKeys = state.typeSource === 'pending' ? Object.keys(purposeRegistry) : purposesFor(state.documentType);
  const options = ['', ...new Set([...presetKeys, state.purpose].filter(key => key && key !== 'custom'))];
  const purposeKey = options.join(',');
  if (purposeOptions !== purposeKey) {
    purposeOptions = purposeKey;
    $('sharingPurpose').replaceChildren(...options.map(key => new Option(key ? purposeRegistry[key].label : 'Choose a purpose…', key)));
  }
  $('sharingPurpose').value = state.purpose;
  $('documentType').value = state.documentType;
  $('typeEvidence').textContent = state.typeReason;
  $('useLocalType').hidden = state.typeSource !== 'manual'; $('useLocalType').disabled = !state.ocrDocument;
  const typePrefix = { manual: 'Selected', local: 'Suggested', sample: 'Example', pending: 'Current type' }[state.typeSource];
  $('detectedType').textContent = `${typePrefix}: ${config.label}`;
  if ($('customPurpose').value !== state.customPurpose) $('customPurpose').value = state.customPurpose;
  $('recipientDetail').value = state.recipientDetail;

  const suggested = choice.match?.purpose;
  const confirmed = choice.custom && choice.purpose !== 'custom';
  let message = 'Local suggestions use the selected purpose.';
  if (choice.custom) {
    if (confirmed) message = `Custom purpose · Using ${purposeRegistry[suggested].label}.`;
    else if (suggested) message = `Custom purpose · Suggested match: ${purposeRegistry[suggested].label}. Confirm to use this purpose.`;
    else if (choice.match.status === 'ambiguous') message = 'Custom purpose · The description could fit several tasks. Clarify what you need or review the conservative masks.';
    else message = 'Custom purpose · Conservative local suggestions. Review which details the recipient needs.';
  }
  if ($('purposeMode').textContent !== message) $('purposeMode').textContent = message;
  $('confirmPurpose').hidden = !suggested || confirmed;
  $('confirmPurpose').textContent = suggested === 'lookup' ? 'Use delivery lookup' : 'Use return or refund';

  const conflict = !choice.compatible && !typePending();
  $('contextConflict').hidden = !conflict;
  $('acceptContextConflict').hidden = state.acceptedConflict;
  $('contextConflictMessage').textContent = state.acceptedConflict
    ? 'Your choices are saved. This combination uses conservative protection.'
    : 'This document type does not support the selected audience or purpose. Choose a compatible option, correct the type, or keep your choices with conservative masks.';
  $('continueContext').disabled = !canContinueContext(choice) || state.waitingForOCR;
  $('skipContext').textContent = conflict && !state.acceptedConflict ? 'Keep choices and review manually' : 'Review manually';

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
  const message = running ? (state.waitingForOCR ? 'Finishing screenshot analysis…' : $('scanProgress').textContent) : messages[state.ocrStatus];
  $('chooseProgress').hidden = !message;
  $('chooseProgressDot').hidden = !running;
  $('retryChooseOCR').hidden = running || !message;
  if (message && $('chooseProgressMessage').textContent !== message) $('chooseProgressMessage').textContent = message;
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
function reapplyCandidates() {
  return state.fields.filter(field => field.userOverride === 'keep' && field.recommendation.action !== 'keep');
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
function render() {
  showMaskTarget(null);
  renderCanvas(); renderFields();
  const isSample = state.source === 'sample'; const count = countMasks();
  const plan = currentPlan(); renderContextOptions();
  $('contextFeedback').hidden = !contextUndo; $('contextChanges').textContent = contextFeedback; $('undoContext').disabled = state.detecting;
  $('aiPrerequisite').hidden = Boolean(state.ocrDocument?.words.length);
  $('sampleButton').classList.toggle('selected', isSample);
  $('contextKeep').textContent = plan.keep; $('contextHide').textContent = plan.hide; $('contextNote').textContent = plan.note;
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
  $('detectButton').disabled = state.detecting || !$('aiConsent').checked || !aiPreview || aiPreview.document !== state.ocrDocument || aiPreview.version !== sharingVersion;
  $('detectButton').textContent = state.phase === 'ai' ? 'Analyzing…' : 'Analyze text with AI';
  $('cancelDetectionButton').hidden = !state.detecting; $('cancelAI').hidden = state.phase !== 'ai';
  $('exportButton').disabled = state.detecting || state.exporting;
  $('aiConsent').disabled = state.detecting;
  renderProtectionControls();
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
$('sharingPurpose').addEventListener('change', event => setContext({ purpose: event.target.value }));
$('documentType').addEventListener('change', event => setContext({
  documentType: event.target.value, typeSource: 'manual', typeReason: 'Type selected by you.'
}));
$('useLocalType').addEventListener('click', () => {
  if (!state.ocrDocument) return;
  const result = classifyDocument(state.ocrDocument);
  setContext({ documentType: result.type, typeSource: 'local', typeReason: result.reason });
});
$('customPurpose').addEventListener('input', event => setContext({ customPurpose: event.target.value }, { typing: true }));
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
  cancelDetection(); render();
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
  $('aiDialogStatus').textContent = message; $('aiDialogStatus').dataset.error = String(error);
  if (state.flow === 'context') renderChooseProgress();
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
      const proceed = state.waitingForOCR && state.ocrStatus === 'complete' && $('contextDialog').open && canContinueContext();
      state.detecting = false; state.phase = ''; detectionController = null; state.waitingForOCR = false;
      if (proceed) showReview();
      else render();
    }
  }
}
$('ocrButton').addEventListener('click', () => { $('moreDialog').close(); void scanLocally(); });
$('detectButton').addEventListener('click', async () => {
  const preview = aiPreview;
  if (state.detecting || !$('aiConsent').checked || !preview || preview.document !== state.ocrDocument || preview.version !== sharingVersion) return;
  invalidateProtection();
  const currentId = ++detectionId; const loadId = state.loadId;
  const { document, payload, version } = preview;
  const controller = new AbortController(); detectionController = controller;
  const timeout = setTimeout(() => controller.abort(), AI_BUDGET.browserMs);
  state.detecting = true; state.phase = 'ai'; state.aiStatus = 'processing'; setDrawing(false); render(); setAIStatus('Screening likely credentials locally, then sending the screened text and layout to the configured AI provider. Other personal text may remain. The image stays on this device…');
  try {
    const result = await readAPI(await fetch('/api/ai?action=classify-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
    }));
    if (currentId !== detectionId || loadId !== state.loadId) return;
    controller.signal.throwIfAborted();
    if (!$('aiDialog').open) { stopScanning(); return; }
    if (version !== sharingVersion || document !== state.ocrDocument) {
      state.aiStatus = 'idle'; setAIStatus('Sharing settings changed. Start a new analysis to review this copy.'); return;
    }
    const classified = validateClassifications(result.fields, document);
    const aiFields = suggestionsToFields(classified, document);
    const fields = suggestionsToFields([...classified, ...localSuggestions(document)], document);
    const previousFields = state.fields;
    // Build everything first: an invalid result cannot partially replace existing masks.
    clearContextChange();
    const reconciled = receiveFields(fields);
    state.aiInsights = aiInsights(previousFields, aiFields, state.fields); state.aiTypeSuggestion = suggestTypeFromAI(classified); state.aiStatus = 'complete';
    state.aiDetected = true; state.detectedModel = result.model; state.view = 'protected'; state.highlighted = null;
    const { hidden, detected } = coverageSummary(state.fields, state.manual);
    setAIStatus(`${hidden} of ${detected} detected details hidden after classification. ${reconciled.retained} earlier regions available for review.`);
    $('aiDialog').close();
    announce('AI detection complete. Review the suggested masks and visible details.');
  } catch (error) {
    if (currentId === detectionId && loadId === state.loadId) { state.aiStatus = 'failed'; setAIStatus(error.name === 'AbortError' ? 'Detection timed out. Existing masks retained; retry or add masks manually.' : error.message, true); }
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
    const choice = resolveSharingChoice(state);
    const description = state.customPurpose.trim();
    const kept = state.fields.filter(field => !field.hidden).map(field => field.name.toLowerCase());
    const coverage = coverageSummary(state.fields, state.manual);
    const textSource = state.ocrDocument
      ? (state.aiDetected ? `Text classification: ${state.detectedModel}.` : 'Local text detection.')
      : 'No current OCR results. Review every part of the image.';
    const snapshot = {
      loadId: state.loadId,
      filename: `privacylens-${state.documentType}-${state.context || 'unspecified'}-${choice.purpose || 'unspecified'}-${state.source === 'sample' ? 'sample' : 'image'}.png`,
      context: [
        `${plan.label}.`,
        choice.custom ? `Your purpose: ${description}${/[.!?。！？]$/u.test(description) ? '' : '.'}` : '',
        state.recipientDetail ? `Recipient note: ${state.recipientDetail}.` : '',
        plan.note, 'Check that every visible detail is needed for this purpose.'
      ].filter(Boolean).join(' '),
      details: [
        `${coverage.detected} detected details: ${coverage.hidden} hidden, ${coverage.markedVisible} marked visible.`,
        `${coverage.manual} added ${coverage.manual === 1 ? 'mask' : 'masks'}. ${coverage.masks} solid ${coverage.masks === 1 ? 'mask' : 'masks'} applied.`,
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
  const choice = resolveSharingChoice(state);
  $('typeButton').textContent = documentTypes[state.documentType].label;
  $('contextButton').replaceChildren();
  const label = document.createElement('span'); label.className = 'current-context';
  const purpose = choice.custom && choice.purpose !== 'custom' ? `Custom · ${purposeRegistry[choice.purpose].label}` : purposeRegistry[choice.purpose]?.label;
  label.textContent = state.context ? [audiences[state.context].label, purpose].filter(Boolean).join(' · ') : 'Who are you sharing with?';
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
function closeWorkDialogs() {
  for (const id of ['contextDialog', 'moreDialog', 'aiDialog', 'protectionDialog', 'protectionChoiceDialog', 'reapplyDialog', 'exportDialog', 'aboutDialog']) {
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
function showReview() {
  state.waitingForOCR = false;
  state.flow = 'review';
  if ($('contextDialog').open) $('contextDialog').close();
  render();
  if (contextUndo) announce(contextFeedback, { undo: true });
  $('previewHeading').focus({ preventScroll: true });
}
$('sharingAudiences').addEventListener('click', event => {
  const button = event.target.closest('[data-audience]');
  if (button) setContext({ context: button.dataset.audience });
});
$('confirmPurpose').addEventListener('click', () => {
  const { match } = resolveSharingChoice(state);
  if (match?.status !== 'matched') return;
  setContext({ confirmedPurpose: match.purpose });
  $('customPurpose').focus({ preventScroll: true });
});
$('acceptContextConflict').addEventListener('click', () => {
  state.acceptedConflict = true; renderContextOptions();
  $('continueContext').focus({ preventScroll: true });
});
$('continueContext').addEventListener('click', () => {
  if (!canContinueContext()) return;
  if (state.phase === 'ocr') {
    state.waitingForOCR = true; renderContextOptions();
  } else {
    showReview();
  }
});
$('retryChooseOCR').addEventListener('click', () => { void scanLocally(); });
$('skipContext').addEventListener('click', () => {
  if (!resolveSharingChoice(state).compatible && !typePending()) state.acceptedConflict = true;
  showReview();
});
$('contextDialog').addEventListener('close', () => {
  if (!$('contextDialog').open && state.flow === 'context') showReview();
});
$('contextButton').addEventListener('click', openContextDialog);
$('typeButton').addEventListener('click', () => { $('typeSettings').open = true; openContextDialog(); });
$('editTypeButton').addEventListener('click', () => { $('typeSettings').open = !$('typeSettings').open; });
$('moreButton').addEventListener('click', () => $('moreDialog').showModal());
$('aiButton').addEventListener('click', () => {
  $('aiDialogStatus').textContent = ''; $('aiConsent').checked = false;
  for (const id of ['aiDataDetails', 'aiTextDetails', 'aiPayloadDetails', 'aiTechnicalDetails']) $(id).open = false;
  const document = state.ocrDocument;
  aiPreview = document?.words.length ? { document, payload: textPayload(document), version: sharingVersion } : null;
  // Render the snapshot submitted by the analysis button.
  $('aiSendPreview').textContent = aiPreview ? aiPreview.payload.lines.map(line => line.words.map(word => word.text).join(' ')).join('\n') : 'Read text locally first.';
  $('aiPayloadPreview').textContent = aiPreview ? JSON.stringify(aiPreview.payload, null, 2) : 'Read text locally first.';
  render(); $('aiDialog').showModal();
});

function protectionVersion() {
  return { loadId: state.loadId, ocrDocument: state.ocrDocument, sharingVersion, fieldsVersion };
}

function currentProtectionResult() {
  const result = purposeReview.result;
  return result && sameProtectionVersion(result.version, protectionVersion()) ? result : null;
}

function cancelProtectionRequest(message) {
  if (!purposeReview.request) return;
  purposeReview.request.controller.abort();
  purposeReview.request = null;
  purposeReview.message = message;
}

function invalidateProtection() {
  const active = purposeReview.request || purposeReview.result;
  const message = active ? 'Sharing settings or detected details changed. Get new suggestions for this copy.' : '';
  cancelProtectionRequest(message);
  purposeReview.preview = null;
  purposeReview.result = null;
  purposeReview.change = null;
  purposeReview.message = message;
  for (const id of ['protectionDialog', 'protectionChoiceDialog']) {
    if ($(id).open) $(id).close();
  }
}

function protectionBlocker() {
  if (state.detecting || loadingImageId === state.loadId) return 'Wait for the current image or text analysis.';
  if (!documentTypes[state.documentType].audiences.includes(state.context)) return 'Choose a supported audience for this document type.';
  if (!state.fields.length) return 'Read the image for detected details first.';
  if (state.fields.length > protectionLimits.fields) return 'Use a copy with up to 100 detected details for AI sharing suggestions.';
  return '';
}

function renderProtectionControls() {
  const show = state.hasImage && Boolean(state.customPurpose.trim());
  $('protectionPanel').hidden = !show;
  const blocker = show ? protectionBlocker() : '';
  $('protectionButton').disabled = !show || Boolean(blocker || purposeReview.request);
  $('cancelProtection').hidden = !purposeReview.request;
  const message = purposeReview.request ? 'Analyzing your sharing purpose. You can keep reviewing this image.' : blocker || purposeReview.message;
  if ($('protectionStatus').textContent !== message) $('protectionStatus').textContent = message;
  const preview = purposeReview.preview;
  $('requestProtection').disabled = !show || Boolean(blocker || purposeReview.request) || !$('protectionConsent').checked
    || !preview || !sameProtectionVersion(preview.version, protectionVersion());
}

function renderProtectionSuggestion(field, suggestion) {
  const item = document.createElement('div');
  item.className = 'protection-suggestion';
  item.dataset.protectionAction = suggestion.action;
  const label = document.createElement('strong');
  const actionLabels = { hide: 'Hide', keep: 'Keep', review: 'Review' };
  label.textContent = `AI purpose suggestion · ${actionLabels[suggestion.action]}`;
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

$('protectionButton').addEventListener('click', () => {
  if (!state.customPurpose.trim() || protectionBlocker() || purposeReview.request) return;
  $('protectionConsent').checked = false;
  $('protectionDataDetails').open = false;
  try {
    purposeReview.preview = { ...createProtectionInput(state, state.fields), version: protectionVersion() };
  } catch (error) {
    purposeReview.message = error.message;
    renderProtectionControls();
    return;
  }
  const { body } = purposeReview.preview;
  $('protectionPurposePreview').textContent = body.purpose;
  $('protectionContextPreview').textContent = `${audiences[body.audience].label} · ${documentTypes[body.documentType].label}`;
  const counts = new Map();
  for (const field of body.fields) counts.set(field.category, (counts.get(field.category) || 0) + 1);
  $('protectionFieldsPreview').textContent = [...counts].map(([category, count]) => `${categoryNames[category]} × ${count}`).join(' · ');
  $('protectionPayloadPreview').textContent = JSON.stringify(body, null, 2);
  renderProtectionControls();
  $('protectionDialog').showModal();
});
$('protectionConsent').addEventListener('change', renderProtectionControls);
$('protectionDialog').addEventListener('close', () => {
  if (!$('protectionDialog').open) {
    purposeReview.preview = null;
    $('protectionConsent').checked = false;
    renderProtectionControls();
  }
});
$('cancelProtection').addEventListener('click', () => {
  cancelProtectionRequest('Sharing analysis cancelled. Continue reviewing the image.');
  renderProtectionControls();
  $('protectionButton').focus({ preventScroll: true });
});

$('requestProtection').addEventListener('click', async () => {
  const preview = purposeReview.preview;
  if (!$('protectionDialog').open || !$('protectionConsent').checked || protectionBlocker() || purposeReview.request
      || !preview || !sameProtectionVersion(preview.version, protectionVersion())) return;
  const controller = new AbortController();
  const request = { controller };
  purposeReview.request = request;
  purposeReview.result = null;
  purposeReview.message = '';
  $('protectionDialog').close();
  render();
  const timeout = setTimeout(() => controller.abort(), AI_BUDGET.browserMs);
  try {
    const response = await readAPI(await fetch('/api/ai?action=recommend-protection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview.body), signal: controller.signal
    }));
    if (purposeReview.request !== request || !sameProtectionVersion(preview.version, protectionVersion())) return;
    controller.signal.throwIfAborted();
    const decisions = validateProtectionDecisions(response, preview.body.fields);
    const fields = new Map(state.fields.map(field => [field.id, field]));
    const suggestions = new Map(decisions.map(decision => {
      const field = fields.get(preview.fieldIds.get(decision.field_id));
      if (!field) throw new Error('A detected detail changed. Get new suggestions for this copy.');
      return [field.id, safeProtectionRecommendation(field, preview.body, decision)];
    }));
    purposeReview.result = { version: preview.version, suggestions };
    const remaining = preview.body.fields.length - suggestions.size;
    purposeReview.message = suggestions.size
      ? `Review ${suggestions.size} AI ${suggestions.size === 1 ? 'suggestion' : 'suggestions'} in the field list.${remaining ? ' Other details use local recommendations.' : ''}`
      : 'AI returned no suggestions. Review the local recommendations.';
  } catch (error) {
    if (purposeReview.request === request && sameProtectionVersion(preview.version, protectionVersion())) {
      purposeReview.message = controller.signal.aborted ? 'Sharing analysis timed out. Continue reviewing the local recommendations.' : error.message;
    }
  } finally {
    clearTimeout(timeout);
    if (purposeReview.request === request) { purposeReview.request = null; render(); }
  }
});

function openProtectionChoice(id) {
  const result = currentProtectionResult();
  const field = state.fields.find(item => item.id === id);
  const suggestion = result?.suggestions.get(id);
  if (!field || !suggestion) return;
  const hidden = protectionMaskChange(field, suggestion);
  if (hidden === null) return;
  purposeReview.change = { id, hidden, result };
  $('protectionChoiceHeading').textContent = `${hidden ? 'Hide' : 'Show'} ${field.name.toLowerCase()}?`;
  $('protectionChoiceDetail').textContent = hidden ? suggestion.reason
    : `${suggestion.reason} Check who will receive the image and what they need before showing this detail. Overlapping masks can still cover it.`;
  $('confirmProtectionChoice').textContent = hidden ? 'Hide detail' : 'Show detail';
  $('protectionChoiceDialog').showModal();
}

$('protectionChoiceDialog').addEventListener('close', () => {
  if (!$('protectionChoiceDialog').open) purposeReview.change = null;
});
$('confirmProtectionChoice').addEventListener('click', () => {
  const change = purposeReview.change;
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

$('reapplyMasks').addEventListener('click', () => {
  const count = reapplyCandidates().length;
  if (!count || state.detecting) return;
  $('reapplyMessage').textContent = `This will cover ${count} ${count === 1 ? 'detail you chose' : 'details you chose'} to show. Your added masks and adjusted boxes are preserved.`;
  $('reapplyDialog').showModal();
});
$('confirmReapply').addEventListener('click', () => {
  if (!$('reapplyDialog').open || state.detecting) return;
  const count = reapplyCandidates().length;
  clearContextChange();
  state.fields = guardSuggestedReveals(state.fields, applyRecommendations(state.fields, protectionContext(), { applySuggestedMasks: true }));
  state.view = 'protected';
  $('reapplyDialog').close(); render();
  announce(`${count} recommended ${count === 1 ? 'mask restored' : 'masks restored'}. Review the updated image.`);
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
async function loadProviderDisclosure() {
  try {
    const response = await fetch('/api/ai-provider', { cache: 'no-store' });
    if (!response.ok) return;
    const { provider } = await response.json();
    if (typeof provider !== 'string' || !provider) return;
    for (const label of document.querySelectorAll('[data-ai-provider]')) label.textContent = provider;
    if ($('aiDialog').open && !state.detecting) {
      $('aiConsent').checked = false;
      render();
    }
    if ($('protectionDialog').open) {
      $('protectionConsent').checked = false;
      renderProtectionControls();
    }
  } catch { /* The static editor can still describe the configured destination. */ }
}
setSample();
void loadProviderDisclosure();
