const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const { chromium } = require('playwright-core');

const base = process.env.DRAWIO_URL || 'http://127.0.0.1:8765/';
const editorUrl = base + '?lang=en&ui=kennedy&splash=0';
const graphImage = '.geDiagramContainer svg image';
const grid = page => page.getByLabel('流水网格', { exact: true });
const nameInput = page => page.getByLabel('方块名称', { exact: true });
const delayInput = page => page.getByLabel('延迟拍数', { exact: true });

async function openEditor(t) {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return /^https?:$/.test(url.protocol) && url.origin !== new URL(base).origin
      ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(editorUrl);
  await waitForPipeline(page);
  return page;
}

async function waitForPipeline(page) {
  await page.locator('a[title^="Insert ("]').waitFor();
  await page.evaluate(() => Draw.loadPlugin(ui => { window.pipelineTestUi = ui; }));
  await page.waitForFunction(() => window.pipelineTestUi?.actions.get('pipelineMode'));
}

async function checkFocus(locator) {
  await locator.waitFor();
  assert.ok(await locator.evaluate(el => el === document.activeElement),
    'Keyboard focus should be on ' + await locator.getAttribute('aria-label'));
}

async function press(page, ...keys) {
  for (const key of keys) await page.keyboard.press(key);
}

async function nameBlock(page, name, finish = 'Enter') {
  await checkFocus(nameInput(page));
  if (name) await page.keyboard.insertText(name);
  await press(page, finish);
}

// Read the actual, independently displayable image saved in the graph. Its
// block coordinates let us check layout and names after undo and file reload.
async function readBlocks(page) {
  return page.locator(graphImage).first().evaluate(async image => {
    const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const svg = new DOMParser().parseFromString(await (await fetch(href)).text(), 'image/svg+xml');
    return Array.from(svg.querySelectorAll('[data-block-id]'), block => ({
      row: Number(block.getAttribute('data-row')),
      start: Number(block.getAttribute('data-start')),
      duration: Number(block.getAttribute('data-duration')),
      name: block.getAttribute('data-name'),
    })).sort((a, b) => a.row - b.row || a.start - b.start);
  });
}

const block = (row, start, name, duration = 1) => ({ row, start, name, duration });

test('keyboard-only creation, names, relative delays, synchronization and file round trip', async t => {
  const page = await openEditor(t);
  await press(page, 'F8');
  await checkFocus(grid(page));
  assert.equal(await page.locator(graphImage).count(), 0, 'Entering mode must keep a blank file pristine');
  await press(page, 'r');
  await nameBlock(page, '读取', 'Tab');
  await nameBlock(page, '计算');
  await checkFocus(grid(page));
  assert.deepEqual(await readBlocks(page), [block(0, 0, '读取'), block(0, 1, '计算')]);

  await press(page, 'Enter');
  await checkFocus(delayInput(page));
  await page.keyboard.insertText('2');
  await press(page, 'Enter', 'Enter');
  await checkFocus(delayInput(page));
  assert.equal(await delayInput(page).inputValue(), '1');
  await press(page, 'Enter', 'ArrowUp', 'F2');
  await checkFocus(nameInput(page));
  assert.equal(await nameInput(page).inputValue(), '计算');
  const localName = '计算（备用）&B';
  await nameBlock(page, localName);
  await checkFocus(grid(page));
  await press(page, 'ArrowUp', 'ArrowLeft', 'r');
  await nameBlock(page, '写回');
  const expected = (middle, last) => [
    block(0, 0, '读取'), block(0, 1, '计算'), block(0, 2, '写回'),
    block(1, middle, '读取'), block(1, middle + 1, localName), block(1, middle + 2, '写回'),
    block(2, last, '读取'), block(2, last + 1, localName), block(2, last + 2, '写回'),
  ];
  const beforeSync = await readBlocks(page);
  assert.equal(beforeSync.length, 7);
  assert.ok(beforeSync.some(b => b.row === 2 && b.name === '计算'), 'Downstream names only change on sync');
  await press(page, 'Shift+Enter');
  assert.deepEqual(await readBlocks(page), expected(2, 3));

  await press(page, 'ArrowDown', 'Home', 'ArrowRight');
  assert.deepEqual(await readBlocks(page), expected(3, 3));
  await press(page, 'Shift+Enter');
  assert.deepEqual(await readBlocks(page), expected(3, 4));
  await press(page, 'Control+z');
  assert.deepEqual(await readBlocks(page), expected(3, 3));
  await press(page, 'Control+Shift+z');
  assert.deepEqual(await readBlocks(page), expected(3, 4));
  await press(page, 'F8');
  await grid(page).waitFor({ state: 'hidden' });

  // Exercise the same file writer and exporters as draw.io's menus.
  const download = page.waitForEvent('download');
  await page.evaluate(() => pipelineTestUi.doSaveLocalFile(pipelineTestUi.getFileData(true), 'pipeline.drawio', 'text/xml'));
  const saved = await readFile(await (await download).path(), 'utf8');
  assert.match(saved, /<mxfile/);
  const plain = await page.context().newPage();
  await plain.goto(editorUrl + '&plugins=0#R' + encodeURIComponent(saved));
  assert.deepEqual(await readBlocks(plain), expected(3, 4));
  assert.equal(await plain.locator('script[src*="plugins/pipeline.js"]').count(), 0);
  await plain.close();

  const exportResult = await page.evaluate(async () => {
    const svg = pipelineTestUi.editor.graph.getSvg();
    const image = svg.querySelector('image');
    const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const inner = new DOMParser().parseFromString(await (await fetch(href)).text(), 'image/svg+xml');
    const labels = Array.from(inner.querySelectorAll('text'), label => label.textContent);
    const visible = await new Promise((resolve, reject) => {
      pipelineTestUi.editor.exportToCanvas(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        resolve(canvas.toDataURL().startsWith('data:image/png;') &&
          data.some((value, i) => i % 4 === 0 && value < 128 && data[i + 3] > 128));
      }, null, null, null, reject);
    });
    return { labels, visible };
  });
  assert.ok(exportResult.labels.includes(localName));
  assert.ok(exportResult.visible, 'PNG export must include visible artwork');

  await page.goto('about:blank');
  await page.goto(editorUrl + '#R' + encodeURIComponent(saved));
  await waitForPipeline(page);
  assert.deepEqual(await readBlocks(page), expected(3, 4));
  await press(page, 'F8', 'F2');
  await checkFocus(nameInput(page));
  assert.equal(await nameInput(page).inputValue(), '读取');
  await nameBlock(page, '重新读取');
  await press(page, 'Shift+Enter');
  assert.deepEqual(await readBlocks(page), expected(3, 4).map(b =>
    b.name === '读取' ? { ...b, name: '重新读取' } : b));
});

test('keyboard ranges, duplicate names, canceling overflow drafts and standalone rename undo', async t => {
  const page = await openEditor(t);
  await press(page, 'F8', 'Shift+ArrowRight', 'Shift+ArrowRight', 'r');
  await checkFocus(nameInput(page));
  // Start a real Chromium composition on the focused input. The first Enter
  // carries isComposing and must be handled by the IME, not the drawing tool.
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: '同名', selectionStart: 2, selectionEnd: 2 });
  await press(page, 'Enter');
  await checkFocus(nameInput(page));
  assert.equal(await page.locator(graphImage).count(), 0, 'IME candidate selection must not commit a block');
  await session.send('Input.insertText', { text: '同名' });
  await session.detach();
  await press(page, 'Tab');
  await nameBlock(page, '同名');
  const initial = [block(0, 0, '同名', 3), block(0, 3, '同名')];
  assert.deepEqual(await readBlocks(page), initial);
  await press(page, 'ArrowLeft', 'F2');
  await nameBlock(page, '暂名');
  await press(page, 'Control+z');
  assert.deepEqual(await readBlocks(page), initial);
  await press(page, 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'r');
  await nameBlock(page, '', 'Tab');
  await checkFocus(nameInput(page));
  await page.keyboard.insertText('取消');
  await press(page, 'Escape');
  await checkFocus(grid(page));
  assert.deepEqual(await readBlocks(page), [...initial, block(0, 7, '')]);
  const cycles = await page.evaluate(() => {
    let matrix;
    Draw.loadPlugin(ui => {
      const graph = ui.editor.graph;
      const [cell] = graph.getChildVertices(graph.getDefaultParent());
      matrix = JSON.parse(graph.getAttributeForCell(cell, 'pipelineData'));
    });
    return matrix.cycles;
  });
  assert.equal(cycles, 8, 'Canceling the draft at cycle 9 must not extend the saved grid');

  // The ruler is keyboard accessible and rejects a range that would hide a
  // block. Correcting the same input should return focus to the grid.
  await press(page, 'Tab');
  const ruler = page.getByRole('spinbutton', { name: '周期数' });
  await checkFocus(ruler);
  await press(page, 'Control+a', '7', 'Enter');
  await checkFocus(ruler);
  assert.equal(await grid(page).getAttribute('aria-colcount'), '8');
  await press(page, 'Control+a', '1', '0', 'Enter');
  await checkFocus(grid(page));
  assert.equal(await grid(page).getAttribute('aria-colcount'), '10');
  await press(page, 'ArrowLeft', 'ArrowLeft', 'r');
  await nameBlock(page, '相邻', 'Tab');
  await checkFocus(grid(page));
  assert.deepEqual(await readBlocks(page), [...initial, block(0, 6, '相邻'), block(0, 7, '')],
    'Continuous drawing stops before the existing empty-name block at cycle 8');
});

test('draw and rename with the mouse on a zoomed canvas', async t => {
  const page = await openEditor(t);
  await press(page, 'F8', 'r');
  await nameBlock(page, '起点');

  // Derive pointer positions from the visible ruler, as a user would. Using
  // model coordinates here would mask double-snapping or a missed transform.
  for (const [zoom, start, duration] of [[0.5, 1, 3], [1, 4, 1], [2, 5, 2]]) {
    await page.evaluate(z => pipelineTestUi.editor.graph.zoomTo(z), zoom);
    const draw = page.getByRole('button', { name: '矩形', exact: true });
    if (await draw.getAttribute('aria-pressed') !== 'true') await draw.click();
    const ticks = grid(page).locator('svg').first().locator('text');
    const tick = n => ticks.filter({ hasText: new RegExp('^' + n + '$') }).first();
    await tick(start + duration).scrollIntoViewIfNeeded();
    const firstTick = await tick(start + 1).boundingBox();
    const nextTick = await tick(start + 2).boundingBox();
    const row = await ticks.filter({ hasText: /第\s*1\s*级/ }).first().boundingBox();
    const center = firstTick.x + firstTick.width / 2;
    const pitch = nextTick.x + nextTick.width / 2 - center;
    const y = row.y + row.height / 2;
    await page.mouse.move(center - pitch / 2 + 1, y);
    await page.mouse.down();
    await page.mouse.move(center + (duration - 0.5) * pitch - 1, y, { steps: 6 });
    await page.mouse.up();
    const name = '鼠标 ' + zoom;
    await nameBlock(page, name);
    const blocks = await readBlocks(page);
    assert.deepEqual(blocks[blocks.length - 1], block(0, start, name, duration));
  }

  await press(page, 'Escape');
  const last = await grid(page).locator('[data-name="鼠标 2"]').boundingBox();
  await page.mouse.dblclick(last.x + last.width / 2, last.y + last.height / 2);
  await nameBlock(page, '改名');
  assert.deepEqual((await readBlocks(page)).at(-1), block(0, 5, '改名', 2));
});

test('hiding a layer closes its editor and file permissions are rechecked at commit', async t => {
  const page = await openEditor(t);
  await press(page, 'F8', 'r');
  await nameBlock(page, '保留名称');
  await page.evaluate(() => {
    const graph = pipelineTestUi.editor.graph;
    window.pipelineTestLayer = graph.getDefaultParent();
    graph.getModel().setVisible(pipelineTestLayer, false);
  });
  await grid(page).waitFor({ state: 'hidden' });
  await page.evaluate(() => pipelineTestUi.editor.graph.getModel().setVisible(pipelineTestLayer, true));
  await press(page, 'F8', 'F2');
  await checkFocus(nameInput(page));
  await page.keyboard.insertText('未授权修改');
  await page.evaluate(() => pipelineTestUi.getCurrentFile().setEditable(false));
  await press(page, 'Enter');
  assert.deepEqual(await readBlocks(page), [block(0, 0, '保留名称')]);
});
