import test from 'node:test';
import assert from 'node:assert/strict';
import { fitImageScale } from '../dist/editor-geometry.js';

test('portrait, landscape and long screenshots fit both available dimensions without changing aspect ratio', () => {
  for (const [width, height] of [[760, 1030], [1800, 900], [900, 8000]]) {
    for (const [availableWidth, availableHeight] of [[700, 600], [310, 480], [450, 200]]) {
      const scale = fitImageScale(width, height, availableWidth, availableHeight);
      assert.ok(width * scale <= availableWidth + 1e-8);
      assert.ok(height * scale <= availableHeight + 1e-8);
      assert.ok(Math.abs(width * scale - availableWidth) < 1e-8 || Math.abs(height * scale - availableHeight) < 1e-8);
    }
  }
});

test('fit mode avoids upscaling small images and tolerates a not-yet-measured stage', () => {
  assert.equal(fitImageScale(100, 200, 600, 800), 1);
  for (const width of [0, -1, NaN, Infinity]) assert.equal(fitImageScale(760, 1030, width, 600), 1);
});

test('desktop group follows image proportions and keeps review column bounded', async () => {
  const { workspaceLayout } = await import('../dist/editor-geometry.js');
  const portrait = workspaceLayout(760, 1030, 1400, 620, 380);
  const landscape = workspaceLayout(1920, 1080, 1400, 620, 380);
  const square = workspaceLayout(1000, 1000, 1400, 620, 380);
  const long = workspaceLayout(500, 6000, 1400, 620, 380);
  assert.equal(portrait.reviewWidth, 380);
  assert.ok(portrait.workspaceWidth < square.workspaceWidth);
  assert.ok(square.workspaceWidth < landscape.workspaceWidth);
  assert.ok(landscape.workspaceWidth <= 1400);
  assert.equal(long.longImage, true);
  assert.ok(long.previewWidth >= 480);
  assert.equal(workspaceLayout(1000, 1000, 1400, 620, 900).reviewWidth, 460);
  assert.equal(workspaceLayout(0, 100, 1000, 600), null);
});
