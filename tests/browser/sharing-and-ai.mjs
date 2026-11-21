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
const evidence = fileURLToPath(new URL('../../qa/sharing-ai-redesign/', import.meta.url));
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
  const fixture = { provider: 'qa-provider.example', workerGate: null, detection: [], protection: [] };
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
        if (url.searchParams.get('action') === 'recommend-protection') {
          fixture.protection.push(body);
          const order = body.fields.find(field => field.category === 'order');
          return send(200, { decisions: order ? [{ field_id: order.id, action: 'review', reason_code: 'task_relevant' }] : [] });
        }
        assert.equal(url.searchParams.get('action'), 'classify-text');
        await new Promise(release => fixture.detection.push({ body, reply: (status, result) => { send(status, result); release(); } }));
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
const lookupPurpose = 'Help me locate my delayed package.';
const dialog = selector => '#aiDialog[open] ' + selector + ':not([hidden])';

test('Sharing Settings and all AI Detection states in a real browser', { timeout: 120_000 }, async t => {
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

  await t.test('purpose states, distinct audiences, OCR wait and persistent undo', async () => {
    let releaseWorker;
    fixture.workerGate = new Promise(resolve => { releaseWorker = resolve; });
    try {
      await startDelivery();
      assert.equal(await visible('.context-brand .brand-mark'), true);
      assert.equal(await run(() => document.querySelectorAll('#sharingAudiences button').length), 4);
      assert.equal(await run(() => document.querySelectorAll('#sharingAudiences .sharing-profile-icon use').length), 4);
      assert.equal(await visible('[data-audience="support"]'), true);
      assert.equal(await visible('[data-audience="organization"]'), false);
      assert.equal(await text('#reviewImageStatus'), 'Choose an audience and a purpose to continue.');
      await click('[data-audience="support"]');
      assert.equal(await disabled('#continueContext'), true);
      assert.match(await text('#reviewImageStatus'), /describe your own/);
      await change('#sharingPurpose', 'return');
      assert.match(await text('#purposeMode'), /Local rules use this purpose/);
      await change('#customPurpose', lookupPurpose);
      assert.match(await text('#purposeMode'), /Delivery lookup/);
      assert.equal(await text('#commonPurposeLabel'), 'Purpose if custom is cleared');
      assert.equal(await disabled('#continueContext'), false);
      await click('#continueContext');
      assert.equal(await disabled('#continueContext'), true);
      assert.equal(await text('#reviewImageStatus'), 'Finishing screenshot analysis…');
    } finally {
      fixture.workerGate = null;
      releaseWorker();
    }
    await until(async () => !await visible('#contextDialog[open]'), 'Review should open automatically after OCR');
    await click('#contextButton');
    await click('#confirmPurpose');
    assert.match(await text('#purposeMode'), /Custom purpose confirmed/);
    assert.match(await text('#contextFeedback'), /Sharing settings updated/);
    await screenshot('sharing-settings');
    await click('#contextExplanation summary');
    assert.equal(await text('#contextOrder'), 'Useful for delivery lookup');
    await click('#continueContext');
    await click('#toast button[aria-label="Dismiss notification"]');
    await click('#workspaceUndoContext');
    await click('#typeButton');
    assert.equal(await visible('#confirmPurpose'), true);
    await change('#documentType', 'general');
    await click('[data-audience="organization"]');
    assert.match(await text('#purposeMode'), /Conservative|conservative/);
    assert.equal(await visible('#organizationHint'), true);
    assert.equal(await visible('#confirmPurpose'), false);
    assert.equal(await disabled('#continueContext'), false);
  });

  await t.test('consent, actual progress, masks, new findings and repeat detection', async () => {
    await startDelivery();
    await until(async () => (await text('#detectedType')).startsWith('Suggested'), 'Sharing Settings OCR did not finish');
    const focus = await run(() => {
      const field = document.querySelector('#customPurpose');
      field.focus();
      const style = getComputedStyle(field);
      return { active: document.activeElement.id, focused: field.matches(':focus'), outline: style.outlineWidth, offset: style.outlineOffset };
    });
    await screenshot('sharing-settings-empty');
    assert.deepEqual(focus, { active: 'customPurpose', focused: true, outline: '2px', offset: '0px' });
    await click('[data-audience="support"]');
    await change('#customPurpose', lookupPurpose);
    await click('#skipContext');
    await until(async () => !await disabled('#aiButton'), 'OCR did not finish');
    const order = '#fieldList input[aria-label^="Hide order number"]';
    const phone = '#fieldList input[aria-label^="Hide phone number"]';
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
    await screenshot('01-consent');
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
    await screenshot('02-in-progress');
    request.reply(200, { model: 'fixture', fields: resultFields });
    await waitVisible(dialog('#aiResult'));
    assert.equal(await run(() => window.qaValidationStage), 'validating');
    assert.equal(await run(() => document.querySelector('#aiStages [aria-current="step"]').dataset.stage), 'applying');
    assert.equal(await text('#aiResultBadge'), '1 additional private detail found');
    assert.match(await text('#aiResultMessage'), /A mask covers the new detail/);
    await screenshot('03-new-findings');
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
    await screenshot('04-no-new-findings');
    await click('#aiResultContinue');
  });

  await t.test('safe failure, fresh retry, cancel, stale response, and independent AI Protection', async () => {
    const fieldCount = await text('#maskCount');
    await openDetection();
    (await sendDetection()).reply(503, { error: 'Private gateway error detail' });
    await waitVisible(dialog('#aiFailure'));
    assert.doesNotMatch(await text('#aiFailure'), /Private gateway error detail/);
    assert.equal(await text('#maskCount'), fieldCount);
    await screenshot('05-failure');
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
    await change('#customPurpose', 'Is delivery available on weekends?');
    stale.reply(200, { model: 'fixture', fields: [] });
    await until(async () => !await visible('#aiDialog[open]'), 'Stale response should return to Review');
    assert.equal(await text('#maskCount'), fieldCount);
    assert.match(await text('#toast'), /Sharing settings changed/);
    await click('#protectionButton');
    assert.equal(await disabled('#requestProtection'), true);
    assert.equal(fixture.protection.length, 0);
    await click('#protectionConsent');
    await click('#requestProtection');
    await until(() => fixture.protection.length, 'AI Protection request did not arrive');
    await until(async () => (await text('#protectionStatus')).includes('Review 1 AI suggestion'), 'AI Protection suggestions did not appear');
    assert.equal(fixture.protection[0].purpose, 'Is delivery available on weekends?');
    assert.ok(fixture.protection[0].fields.every(field => Object.keys(field).sort().join(',') === 'category,id'));
  });

  await t.test('mobile layout, keyboard close and reduced-motion progress', async () => {
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await click('#contextButton');
    const fits = selector => run(s => {
      const element = document.querySelector(s);
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
    }, selector);
    assert.equal(await fits('#contextDialog'), true);
    assert.equal(await fits('#continueContext'), true);
    assert.equal(await run(() =>
      document.querySelector('#contextExplanation summary').getBoundingClientRect().bottom <=
      document.querySelector('.context-body').getBoundingClientRect().bottom), true);
    await screenshot('sharing-settings-mobile');
    await click('#continueContext');
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
    await click('#skipContext');
    await until(async () => !await disabled('#aiButton'), 'Replacement image OCR did not finish');
    assert.equal(await text('#fileLabel'), 'synthetic-replacement.png');
    assert.equal(await text('#maskCount'), '0');
    assert.match(await text('#aiAssistantStatus'), /Optional review/);
  });
});
