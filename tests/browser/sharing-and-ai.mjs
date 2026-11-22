// Run with node --test tests/browser/sharing-and-ai.mjs and CHROME_PATH set if needed.
// This uses the real editor and OCR with a loopback-only stand-in for the AI service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const evidence = fileURLToPath(new URL('../../qa/custom-privacy-instructions/', import.meta.url));
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

async function until(read, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await delay(60);
  } while (Date.now() < deadline);
  throw new Error(message);
}

function fixtureServer() {
  const fixture = { provider: 'qa-provider.example', workerGate: null, detection: [], protection: [], interpretation: [] };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const send = (status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === '/api/ai-provider') return send(200, { provider: fixture.provider });
      if (url.pathname === '/api/ai') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        const action = url.searchParams.get('action');
        if (action === 'recommend-protection') {
          fixture.protection.push(body);
          const order = body.fields.find(field => field.category === 'order');
          return send(200, { decisions: order ? [{ field_id: order.id, action: 'review', reason_code: 'task_relevant' }] : [] });
        }
        assert.ok(['interpret-instruction', 'classify-text'].includes(action));
        const requests = action === 'interpret-instruction' ? fixture.interpretation : fixture.detection;
        await new Promise(release => requests.push({ body, reply: (status, result) => { send(status, result); release(); } }));
        return;
      }
      if (url.pathname === '/vendor/ocr/worker.min.js' && fixture.workerGate) await fixture.workerGate;
      const file = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      assert.ok(file.startsWith(dist + sep));
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return { fixture, server };
}

async function openChrome(t) {
  const profile = await mkdtemp(join(tmpdir(), 'privacylens-ui-test-'));
  const process = spawn(chromePath, [
    '--headless', '--remote-debugging-port=0', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--no-first-run', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });
  let launchError;
  process.on('error', error => { launchError = error; });
  t.after(async () => {
    if (process.exitCode === null && process.pid) {
      const exited = once(process, 'exit');
      process.kill();
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  });
  const portFile = await until(async () => {
    if (launchError) throw launchError;
    if (process.exitCode !== null) throw new Error('Chrome exited before opening a local debugging port.');
    return readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
  }, 'Chrome did not start');
  const tabs = await (await fetch('http://127.0.0.1:' + portFile.split('\n')[0] + '/json/list')).json();
  const socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  t.after(() => socket.close());
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id, result, error } = JSON.parse(data);
    const callbacks = pending.get(id);
    if (!callbacks) return;
    pending.delete(id);
    if (error) callbacks.reject(new Error(error.message));
    else callbacks.resolve(result);
  });
  function command(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function run(fn, ...args) {
    const expression = '(' + fn + ')(...' + JSON.stringify(args) + ')';
    const { result, exceptionDetails } = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }
  const visible = selector => run(s => Boolean(document.querySelector(s)?.getClientRects().length), selector);
  const text = selector => run(s => document.querySelector(s).textContent.trim(), selector);
  const disabled = selector => run(s => document.querySelector(s).disabled, selector);
  const waitVisible = selector => until(() => visible(selector), 'Expected visible element ' + selector);
  async function click(selector) {
    await waitVisible(selector);
    await run(s => {
      const element = document.querySelector(s);
      if (element.disabled) throw new Error('Cannot click disabled control: ' + s);
      element.focus({ preventScroll: true });
      element.click();
    }, selector);
  }
  const change = (selector, value) => run((s, v) => {
    const element = document.querySelector(s);
    element.value = v;
    element.dispatchEvent(new Event(element.matches('textarea') ? 'input' : 'change', { bubbles: true }));
  }, selector, value);
  const screenshot = async name => {
    await delay(200); // Capture the completed entrance transition.
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(evidence, name + '.png'), Buffer.from(data, 'base64'));
  };
  return { command, run, visible, text, disabled, waitVisible, click, change, screenshot };
}

const delivery = '[data-start-sample="delivery"]';
const dialog = selector => '#aiDialog[open] ' + selector + ':not([hidden])';
const custom = '[data-audience="custom"]';
const instructionField = '#customInstruction';
const instructionLayers = '.preview-mask[data-mask-kind="instruction"]';
const orderField = '#fieldList input[aria-label^="Hide order number"]';
const phoneField = '#fieldList input[aria-label^="Hide phone number"]';

test('Sharing Settings, Custom instructions and optional AI in a real browser', { timeout: 120_000 }, async t => {
  await mkdir(evidence, { recursive: true });
  const { fixture, server } = fixtureServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const home = 'http://127.0.0.1:' + server.address().port + '/#upload';
  const page = await openChrome(t);
  const { command, run, visible, text, disabled, waitVisible, click, change, screenshot } = page;
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  async function startDelivery() {
    await command('Page.navigate', { url: home });
    await click(delivery);
    await waitVisible('#contextDialog[open]');
    assert.equal(await run(() => document.activeElement.id), 'contextHeading');
  }
  async function openDetection() {
    await click('#aiButton');
    await waitVisible(dialog('#aiReady'));
    await until(async () => !await disabled('#aiConsent'), 'Detection consent did not load');
    assert.equal(await run(() => document.activeElement.id), 'aiHeading');
    assert.equal(await run(() => document.querySelector('#aiConsent').checked), false);
    assert.equal(await disabled('#detectButton'), true);
  }
  async function sendDetection() {
    const requestIndex = fixture.detection.length;
    await click('#aiConsent');
    assert.equal(await disabled('#detectButton'), false);
    await click('#detectButton');
    await waitVisible(dialog('#aiAnalysis'));
    const entry = await until(() => fixture.detection[requestIndex], 'Detection request did not arrive');
    assert.equal(entry.body.consent, true);
    assert.deepEqual(Object.keys(entry.body).sort(), ['consent', 'height', 'lines', 'width']);
    return entry;
  }
  async function readyToReview() {
    await click('#continueContext');
    await until(async () => !await visible('#contextDialog[open]'), 'Review did not open after OCR');
  }
  async function chooseInstruction(text) {
    assert.equal(await visible('#contextDialog[open]'), true);
    await click(custom);
    await change(instructionField, text);
    await readyToReview();
  }
  async function shareWithAI(trigger) {
    await click(trigger);
    await waitVisible('#protectionDialog[open]');
    await until(async () => !await disabled('#protectionConsent'), 'The AI destination was not disclosed');
    assert.equal(await run(() => document.querySelector('#protectionConsent').checked), false);
    assert.equal(await disabled('#requestProtection'), true);
    const payload = JSON.parse(await text('#protectionPayloadPreview'));
    await click('#protectionConsent');
    await click('#requestProtection');
    return payload;
  }
  async function inspectPNG(boxes = [], points = []) {
    await click('#exportButton');
    await waitVisible('#exportDialog[open]');
    return run(async (boxes, points) => {
      const image = document.querySelector('#exportPreview');
      await image.decode();
      const canvas = document.createElement('canvas');
      const { naturalWidth: width, naturalHeight: height } = image;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, width, height);
      const color = (x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
      const opaqueMask = (x, y) => {
        const offset = (y * width + x) * 4;
        return data[offset] === 32 && data[offset + 1] === 43 && data[offset + 2] === 36 && data[offset + 3] === 255;
      };
      let covered = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) covered += opaqueMask(x, y);
      const coveredWords = boxes.filter(([left, top, w, h]) => {
        for (let y = Math.floor(top * height); y < Math.min(height, Math.ceil((top + h) * height)); y++) {
          for (let x = Math.floor(left * width); x < Math.min(width, Math.ceil((left + w) * width)); x++) if (!opaqueMask(x, y)) return false;
        }
        return true;
      }).length;
      return { width, height, covered, coveredWords, samples: points.map(([x, y]) => color(x, y)) };
    }, boxes, points);
  }
  async function dragCanvas(from, to) {
    const positions = await run(points => {
      const { left, top, width, height } = document.querySelector('#previewCanvas').getBoundingClientRect();
      return points.map(([x, y]) => ({ x: Math.round(left + width * x), y: Math.round(top + height * y) }));
    }, [from, to]);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...positions[0] });
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, ...positions[1] });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...positions[1] });
  }
  async function waitForInstructionMasks() {
    await until(() => run(selector => {
      const masks = [...document.querySelectorAll(selector)];
      return masks.length && masks.every(mask => mask.style.clipPath.match(/-?[\d.]+/g)?.every(value => Number(value) === 0));
    }, instructionLayers), 'Instruction mask animation did not finish');
    if (await visible('#toast')) await click('#toast button[aria-label="Dismiss notification"]');
  }

  await t.test('five radio cards, draft preservation, validation and OCR wait', async () => {
    let releaseWorker;
    fixture.workerGate = new Promise(resolve => { releaseWorker = resolve; });
    try {
      await startDelivery();
      assert.equal(await visible('.context-brand .brand-mark'), true);
      assert.equal(await run(() => document.querySelectorAll('#sharingAudiences input[type="radio"]').length), 5);
      assert.equal(await run(() => document.querySelectorAll('#sharingAudiences .sharing-profile-icon use').length), 5);
      assert.equal(await visible('[data-audience="support"]'), true);
      assert.equal(await visible('[data-audience="organization"]'), false);
      assert.equal(await text('#reviewImageStatus'), 'Choose a sharing option to continue.');
      assert.equal(await visible('#customInstructionPanel'), false);
      await click(custom);
      assert.equal(await visible('#customInstructionPanel'), true);
      assert.equal(await disabled('#continueContext'), true);
      await change(instructionField, ' \n ');
      assert.equal(await disabled('#continueContext'), true);
      await click('[data-example="Hide all text."]');
      assert.equal(await run(() => document.querySelector('#customInstruction').value), 'Hide all text.');
      assert.equal(await text('#instructionCount'), '14 / 500');
      assert.equal(fixture.interpretation.length, 0);
      const draft = '遮挡电话号码。\nHide addresses.';
      await change(instructionField, draft);
      await click('[data-audience="support"]');
      assert.equal(await visible('#customInstructionPanel'), false);
      assert.equal(await disabled('#continueContext'), false);
      await run(() => document.querySelector('[data-audience="support"] input').focus());
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      assert.deepEqual(await run(() => [...document.querySelectorAll('[name="sharing-mode"]:checked')].map(radio => radio.value)), ['custom']);
      assert.equal(await run(() => document.querySelector('#customInstruction').value), draft);
      await change(instructionField, '字'.repeat(510));
      assert.equal(await text('#instructionCount'), '500 / 500');
      await change(instructionField, draft);
      await click('[data-audience="support"]');
      assert.equal(await disabled('#continueContext'), false);
      await click('#continueContext');
      assert.equal(await disabled('#continueContext'), true);
      assert.equal(await text('#reviewImageStatus'), 'Finishing screenshot analysis…');
    } finally {
      fixture.workerGate = null;
      releaseWorker();
    }
    await until(async () => !await visible('#contextDialog[open]'), 'Review should open automatically after OCR');
    assert.equal(await run(selector => document.querySelector(selector).checked, orderField), true);
    await click('#contextButton');
    await click('[data-audience="public"]');
    await readyToReview();
    await click('#toast button[aria-label="Dismiss notification"]');
    await click('#workspaceUndoContext');
    await click('#typeButton');
    assert.equal(await run(() => document.querySelector('[data-audience="support"] input').checked), true);
    await change('#documentType', 'general');
    assert.equal(await visible('#contextConflict'), true);
    assert.equal(await disabled('#continueContext'), true);
    await click('#acceptContextConflict');
    assert.equal(await disabled('#continueContext'), false);
    assert.equal(await run(() => document.querySelector('#customInstruction').value), '遮挡电话号码。\nHide addresses.');
  });

  await t.test('consent, actual progress, masks, new findings and repeat detection', async () => {
    await startDelivery();
    await until(async () => (await text('#detectedType')).startsWith('Suggested'), 'Sharing Settings OCR did not finish');
    await screenshot('01-sharing-settings');
    await click(custom);
    const focus = await run(() => {
      const field = document.querySelector('#customInstruction');
      field.focus();
      const style = getComputedStyle(field);
      return { active: document.activeElement.id, focused: field.matches(':focus'), outline: style.outlineWidth, offset: style.outlineOffset };
    });
    await screenshot('02-custom-selected');
    assert.deepEqual(focus, { active: 'customInstruction', focused: true, outline: '2px', offset: '0px' });
    await click('[data-audience="support"]');
    await readyToReview();
    const order = orderField;
    const phone = phoneField;
    const box = '#fieldList button[aria-label^="Adjust box for order number" i]';
    await click(phone);
    await click(box);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    const adjusted = await run(() => document.querySelector('.mask-adjust').style.left);
    await click('#finishAdjustButton');
    await click('#fitButton');
    await click('#drawButton');
    const point = await run(() => {
      const { left, top } = document.querySelector('#previewCanvas').getBoundingClientRect();
      return { x: Math.round(left + 12), y: Math.round(top + 18) };
    });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, x: point.x + 34, y: point.y + 16 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x + 34, y: point.y + 16 });
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 1);
    await openDetection();
    assert.equal(fixture.detection.length, 0);
    assert.equal(await run(() => document.querySelector('#aiDataDetails').open || document.querySelector('#aiTechnicalDetails').open), false);
    await screenshot('detection-consent');
    await click('#aiDataDetails summary');
    await click('#aiPayloadDetails summary');
    const preview = JSON.parse(await text('#aiPayloadPreview'));
    await run(() => {
      const originalFetch = window.fetch;
      const stage = () => document.querySelector('#aiStages [aria-current="step"]')?.dataset.stage;
      window.fetch = function (path, options) {
        if (!path.endsWith('classify-text')) return originalFetch(path, options);
        window.qaDispatchStage = stage();
        return originalFetch(path, options).then(response => {
          const read = response.json.bind(response);
          response.json = () => { window.qaValidationStage = stage(); return read(); };
          return response;
        });
      };
    });
    const request = await sendDetection();
    assert.deepEqual(request.body, preview);
    assert.equal(await run(() => window.qaDispatchStage), 'sending');
    const steps = await run(() => [...document.querySelector('#aiStages').children].map(step => step.dataset.state));
    assert.deepEqual(steps, ['complete', 'complete', 'active', 'pending', 'pending']);
    assert.equal(await run(() => document.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')), false);
    assert.doesNotMatch(await text('#aiAnalysis'), /[0-9]+\s*%/);
    const resultFields = request.body.lines.flatMap(line => line.words.filter(word => /^Everyday$/i.test(word.text))).slice(0, 1)
      .map(word => ({ category: 'reference', role: 'unknown', wordIds: [word.id] }));
    assert.equal(resultFields.length, 1, 'The synthetic OCR fixture should have the target word');
    await screenshot('detection-in-progress');
    request.reply(200, { model: 'fixture', fields: resultFields });
    await waitVisible(dialog('#aiResult'));
    assert.equal(await run(() => window.qaValidationStage), 'validating');
    assert.equal(await run(() => document.querySelector('#aiStages [aria-current="step"]').dataset.stage), 'applying');
    assert.equal(await text('#aiResultBadge'), '1 additional private detail found');
    assert.match(await text('#aiResultMessage'), /A mask covers the new detail/);
    await screenshot('detection-new-findings');
    await click('#aiResultContinue');
    assert.equal(await run(() => document.activeElement.dataset.finding), 'new');
    assert.equal(await run(s => document.querySelector(s).checked, phone), false);
    assert.equal(await run(s => document.querySelector(s).checked, order), true);
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 1);
    await click(box);
    assert.equal(await run(() => document.querySelector('.mask-adjust').style.left), adjusted);
    await click('#finishAdjustButton');
    const fieldCount = await text('#maskCount');
    await openDetection();
    (await sendDetection()).reply(200, { model: 'fixture', fields: resultFields });
    await waitVisible(dialog('#aiResult'));
    assert.equal(await text('#aiResultBadge'), 'No additional private details found');
    assert.equal(await text('#maskCount'), fieldCount);
    await screenshot('detection-no-new-findings');
    await click('#aiResultContinue');
  });

  await t.test('safe failure, fresh retry, cancel, stale response, and independent AI Protection', async () => {
    const fieldCount = await text('#maskCount');
    await openDetection();
    (await sendDetection()).reply(503, { error: 'Private gateway error detail' });
    await waitVisible(dialog('#aiFailure'));
    assert.doesNotMatch(await text('#aiFailure'), /Private gateway error detail/);
    assert.equal(await text('#maskCount'), fieldCount);
    await screenshot('detection-failure');
    fixture.provider = 'retry.qa-provider.example';
    const previousRequests = fixture.detection.length;
    await click('#retryAI');
    await until(async () => !await disabled('#aiConsent'), 'Retry consent did not load');
    assert.match(await text('#aiReady .ai-consent'), /retry\.qa-provider\.example/);
    assert.equal(await disabled('#detectButton'), true);
    assert.equal(fixture.detection.length, previousRequests);
    (await sendDetection()).reply(504, {});
    await waitVisible(dialog('#aiFailure'));
    assert.match(await text('#aiFailureMessage'), /too long/);
    await click('#continueWithoutAI');
    await openDetection();
    (await sendDetection()).reply(200, { fields: [{ category: 'phone', role: 'unknown', wordIds: ['unknown-id'] }] });
    await waitVisible(dialog('#aiFailure'));
    assert.equal(await text('#maskCount'), fieldCount);
    await click('#continueWithoutAI');
    await openDetection();
    const cancelled = await sendDetection();
    await click('#cancelAI');
    cancelled.reply(200, { model: 'fixture', fields: [] });
    assert.equal(await visible('#aiDialog[open]'), false);
    assert.match(await text('#aiAssistantStatus'), /cancelled/i);
    assert.equal(await text('#maskCount'), fieldCount);

    await openDetection();
    const stale = await sendDetection();
    await change('#documentType', 'general');
    stale.reply(200, { model: 'fixture', fields: [] });
    await until(async () => !await visible('#aiDialog[open]'), 'Stale response should return to Review');
    assert.equal(await text('#maskCount'), fieldCount);
    assert.match(await text('#toast'), /Sharing settings changed/);
    await click('#typeButton');
    await change('#documentType', 'delivery');
    await readyToReview();
    assert.equal(fixture.protection.length, 0);
    const protectedBefore = await run(selector => document.querySelector(selector).checked, orderField);
    await shareWithAI('#protectionButton');
    await until(() => fixture.protection.length, 'AI Protection request did not arrive');
    await until(async () => (await text('#protectionStatus')).includes('Review 1 AI suggestion'), 'AI Protection suggestions did not appear');
    assert.equal(fixture.protection[0].audience, 'support');
    assert.equal(await run(selector => document.querySelector(selector).checked, orderField), protectedBefore);
    assert.ok(fixture.protection[0].fields.every(field => Object.keys(field).sort().join(',') === 'category,id'));
    await click('#fieldList button[aria-label^="Review showing order number" i]');
    await waitVisible('#protectionChoiceDialog[open]');
    assert.equal(await run(selector => document.querySelector(selector).checked, orderField), true);
    await click('#protectionChoiceDialog [data-close="protectionChoiceDialog"][autofocus]');
  });

  await t.test('recognized text, full-image PNG exports, undo and manual adjustments', async () => {
    await click('#contextButton');
    await click(custom);
    await click('[data-example="Hide all text."]');
    assert.equal(await run(selector => document.querySelectorAll(selector).length, instructionLayers), 0);
    await screenshot('03-hide-all-text');
    await readyToReview();
    assert.match(await text('#instructionReviewMessage'), /recognized text/);
    await openDetection();
    const ocr = JSON.parse(await text('#aiPayloadPreview'));
    await click('#aiClose');
    const words = ocr.lines.flatMap(line => line.words.map(word => word.box));
    assert.ok(words.length > 25);
    const manual = await run(() => {
      const element = document.querySelector('.preview-mask');
      return document.querySelector('#manualList').children.length && Boolean(element);
    });
    assert.ok(manual);
    await click('#fitButton');
    await waitForInstructionMasks();
    await screenshot('04-ocr-text-covered');
    const textPNG = await inspectPNG(words);
    assert.equal(textPNG.coveredWords, words.length);
    assert.equal(textPNG.width, ocr.width);
    assert.equal(textPNG.height, ocr.height);
    assert.ok(textPNG.covered < textPNG.width * textPNG.height);
    await click('[data-close="exportDialog"]');

    await click('#contextButton');
    await click('[data-audience="public"]');
    await readyToReview();
    await until(async () => !await visible(instructionLayers), 'The former instruction masks are still active');
    await click('#contextButton');
    await click(custom);
    assert.equal(await run(() => document.querySelector('#customInstruction').value), 'Hide all text.');
    await change(instructionField, 'Hide everything.');
    await screenshot('05-hide-everything');
    await readyToReview();
    assert.match(await text('#instructionReviewMessage'), /opaque mask covers the whole image/);
    await waitForInstructionMasks();
    await screenshot('06-full-image-covered');
    const full = await inspectPNG();
    assert.equal(full.covered, ocr.width * ocr.height);
    assert.equal(await run(selector => document.querySelector(selector).checked, phoneField), false);
    const exactPNG = await run(async () => {
      const blob = await (await fetch(document.querySelector('#exportPreview').src)).blob();
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    });
    const downloadDir = await mkdtemp(join(tmpdir(), 'privacylens-export-test-'));
    t.after(() => rm(downloadDir, { recursive: true, force: true }));
    await command('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    await click('#reviewConfirmation');
    await click('#downloadButton');
    const downloaded = await until(() => readFile(join(downloadDir, 'privacylens-delivery-custom-sample.png')).catch(() => null), 'The protected PNG did not download');
    assert.deepEqual(downloaded, Buffer.from(exactPNG, 'base64'));
    await writeFile(join(evidence, 'opaque-png-export.png'), downloaded);
    await click('#toggleInstruction');
    await until(async () => !await visible(instructionLayers), 'Undo did not remove the custom mask');
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 1);
    assert.equal(await run(selector => document.querySelector(selector).checked, phoneField), false);
    await click('#toggleInstruction');
    assert.equal(await run(selector => document.querySelectorAll(selector).length, instructionLayers), 1);
  });

  await t.test('specific area uses the existing manual editor and keep-only requires a reviewed region', async () => {
    await click('#contextButton');
    await click('[data-example="Hide a specific area."]');
    assert.match(await text('#instructionExampleHint'), /draw a mask/);
    await readyToReview();
    await click('#fitButton');
    await click('#drawInstructionArea');
    await dragCanvas([.13, .22], [.30, .26]);
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 2);
    await click('#drawButton');
    const adjust = '#manualList button[aria-label="Adjust box for manual mask 2"]';
    await click(adjust);
    const left = await run(() => document.querySelector('.mask-adjust').style.left);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.notEqual(await run(() => document.querySelector('.mask-adjust').style.left), left);
    await click('#finishAdjustButton');
    await click('#manualList button[aria-label="Remove manual mask 2"]');
    await waitVisible('#manualList button[aria-label="Restore manual mask 2"]');

    await click('#contextButton');
    await chooseInstruction('Keep only the delivery status.');
    assert.match(await text('#instructionReviewHeading'), /Select the area/);
    assert.equal(await run(selector => document.querySelectorAll(selector).length, instructionLayers), 0);
    await click('#fitButton');
    await click('#drawInstructionArea');
    assert.equal(await run(selector => document.querySelector(selector).checked, orderField), true);
    // The release is over the default order-number box. It must not toggle the field.
    await dragCanvas([.35, .08], [.68, .15]);
    await waitVisible('#keepAreaDialog[open]');
    assert.equal(await run(selector => document.querySelector(selector).checked, orderField), true);
    assert.equal(await run(selector => document.querySelectorAll(selector).length, instructionLayers), 0);
    await click('#confirmKeepArea');
    assert.equal(await run(selector => document.querySelector(selector).checked, orderField), true);
    assert.equal(await run(selector => document.querySelectorAll(selector).length, instructionLayers), 4);
    const kept = await inspectPNG([], [[0, 0], [340, 110], [759, 1029]]);
    assert.deepEqual(kept.samples[0], [32, 43, 36, 255]);
    assert.notDeepEqual(kept.samples[1], [32, 43, 36, 255]);
    assert.deepEqual(kept.samples[2], [32, 43, 36, 255]);
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 2);
    await click('[data-close="exportDialog"]');
  });

  await t.test('interpretation is independently consented, screened, stale-safe and applied only by choice', async () => {
    await click('#contextButton');
    await chooseInstruction('Please cover the fields that could identify the customer.');
    assert.equal(await text('#instructionReviewHeading'), 'Additional review needed');
    assert.equal(fixture.interpretation.length, 0);
    await click('#interpretInstruction');
    await until(async () => !await disabled('#protectionConsent'), 'The AI destination was not disclosed');
    assert.equal(await disabled('#requestProtection'), true);
    await screenshot('08-interpretation-consent');
    await click('[data-close="protectionDialog"]');
    assert.equal(fixture.interpretation.length, 0);

    const preview = await shareWithAI('#interpretInstruction');
    const obsolete = await until(() => fixture.interpretation[0], 'Interpretation request not received');
    assert.deepEqual(obsolete.body, preview);
    assert.deepEqual(Object.keys(preview).sort(), ['categories', 'consent', 'documentType', 'instruction']);
    assert.ok(preview.categories.every(category => typeof category === 'string'));
    await click('#contextButton');
    await chooseInstruction('I want every word in this picture covered.');
    obsolete.reply(200, { operations: [{ type: 'mask_image' }] });
    assert.equal(await visible('#instructionAIResult'), false);

    await shareWithAI('#interpretInstruction');
    (await until(() => fixture.interpretation[1], 'Second interpretation not received'))
      .reply(200, { operations: [{ type: 'keep_area', rect: [0, 0, 100, 100] }] });
    await until(async () => (await text('#protectionStatus')).includes('unavailable'), 'The invalid response was not rejected');
    assert.equal(await visible('#instructionAIResult'), false);
    const previous = await run(selector => document.querySelector(selector).checked, phoneField);
    await shareWithAI('#interpretInstruction');
    (await until(() => fixture.interpretation[2], 'Third interpretation not received'))
      .reply(200, { operations: [{ type: 'mask_text' }] });
    await waitVisible('#instructionAIResult');
    assert.equal(await run(selector => document.querySelectorAll(selector).length, instructionLayers), 0);
    await run(() => {
      const result = document.querySelector('#instructionAIResult');
      result.scrollIntoView({ block: 'nearest' });
    });
    await screenshot('09-interpretation-result');
    await click('#applyAIInstruction');
    assert.equal(await text('#instructionReviewHeading'), 'AI operation applied');
    assert.ok(await run(selector => document.querySelectorAll(selector).length, instructionLayers));
    assert.equal(await run(selector => document.querySelector(selector).checked, phoneField), previous);
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 2);
    await click('#reapplyMasks');
    await click('#confirmReapply');
    assert.equal(await run(selector => document.querySelector(selector).checked, phoneField), true);
    assert.equal(await run(() => document.querySelector('#manualList').children.length), 2);
  });

  await t.test('mobile layout, keyboard close and reduced-motion progress', async () => {
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await click('#contextButton');
    await click(custom);
    await click('[data-example="Hide all text."]');
    const fits = selector => run(s => {
      const element = document.querySelector(s);
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
    }, selector);
    assert.equal(await fits('#contextDialog'), true);
    assert.equal(await fits('#continueContext'), true);
    assert.equal(await run(() => document.querySelector('.context-body').scrollWidth === document.querySelector('.context-body').clientWidth), true);
    await screenshot('07-custom-mobile');
    await run(() => document.querySelector('.context-body').scrollTop = document.querySelector('.context-body').scrollHeight);
    await screenshot('07b-custom-mobile-panel');
    await readyToReview();
    if (!await run(() => document.querySelector('#reviewToggle').getAttribute('aria-expanded') === 'true')) await click('#reviewToggle');
    await openDetection();
    assert.equal(await fits('#aiDialog'), true);
    assert.equal(await fits('#detectButton'), true);
    const request = await sendDetection();
    assert.equal(await fits('#cancelAI'), true);
    assert.equal(await run(() => getComputedStyle(document.querySelector('.ai-analysis-progress span')).animationName), 'none');
    assert.equal(await run(() => getComputedStyle(document.querySelector('#aiStages [aria-current] .ai-stage-marker'), '::before').animationName), 'none');
    await screenshot('02-in-progress-mobile');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    request.reply(200, { fields: [] });
    await until(async () => !await visible('#aiDialog[open]'), 'Escape should close the analysis dialog');
    assert.equal(await run(() => document.activeElement.id), 'aiButton');
  });

  await t.test('a new image invalidates a pending detection result', async () => {
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await openDetection();
    const request = await sendDetection();
    await run(async () => {
      const image = document.createElement('canvas');
      image.width = 520;
      image.height = 160;
      const context = image.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, image.width, image.height);
      context.fillStyle = 'black';
      context.font = '26px sans-serif';
      context.fillText('Synthetic replacement image', 40, 75);
      const blob = await new Promise(resolve => image.toBlob(resolve));
      const files = new DataTransfer();
      files.items.add(new File([blob], 'synthetic-replacement.png', { type: 'image/png' }));
      const input = document.querySelector('#fileInput');
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitVisible('#contextDialog[open]');
    request.reply(200, { fields: [] });
    assert.equal(await visible('#aiDialog[open]'), false);
    await click('[data-audience="support"]');
    await waitVisible('#contextConflict');
    assert.equal(await run(() => document.querySelector('[data-audience="support"] input').checked), true);
    assert.match(await text('#detectedType'), /General \/ other/);
    await click('#acceptContextConflict');
    await readyToReview();
    await until(async () => !await disabled('#aiButton'), 'Replacement image OCR did not finish');
    assert.equal(await text('#fileLabel'), 'synthetic-replacement.png');
    assert.equal(await text('#maskCount'), '0');
    assert.match(await text('#aiAssistantStatus'), /Optional review/);
  });
});
