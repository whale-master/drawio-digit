const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const { chromium } = require('playwright-core');

const base = process.env.DRAWIO_URL || 'http://127.0.0.1:8765/';
const editorUrl = base + '?lang=en&ui=kennedy&splash=0';
const picture = '.geDiagramContainer svg image';

test('WaveJSON preview, undo, export and .drawio round trip', async () => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return /^https?:$/.test(url.protocol) && url.origin !== new URL(base).origin
        ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(editorUrl);
    await page.locator('a[title^="Insert ("]').click();
    await page.getByText('WaveDrom 波形图...', { exact: true }).click();
    const source = page.getByRole('textbox', { name: 'WaveJSON' });
    const apply = page.getByRole('button', { name: '应用' });
    const first = await source.inputValue();
    await apply.click();
    await page.locator(picture).first().dblclick();
    assert.equal(await source.inputValue(), first);
    await page.waitForFunction(() => document.querySelector('.wd-preview img')?.naturalWidth > 0);
    const preview = page.locator('.wd-preview img');
    const before = await preview.getAttribute('src');
    await source.fill('{ signal: [');
    await page.locator('.wd-error').waitFor();
    assert.equal(await apply.isDisabled(), true);
    assert.equal(await preview.getAttribute('src'), before);
    const edited = first.replace("'ready', wave: '01..'", "'ready', wave: '0.1.'")
      .replace("'D0'", "'数据 A&B'").replace('signal:', '// handshake\n  signal:');
    assert.notEqual(edited, first);
    await source.fill(edited);
    await page.waitForFunction((old) => {
      const image = document.querySelector('.wd-preview img');
      return image.src !== old && image.complete && image.naturalWidth > 0;
    }, before);
    await apply.click();
    await page.evaluate(() => Draw.loadPlugin(ui => { window.testUi = ui; }));
    const history = await page.evaluate(() => {
      const graph = testUi.editor.graph;
      const cell = graph.getSelectionCell();
      const read = () => JSON.parse(graph.getAttributeForCell(cell, 'wavedromData')).source;
      testUi.actions.get('undo').funct();
      const previous = read();
      testUi.actions.get('redo').funct();
      return [previous, read()];
    });
    assert.deepEqual(history, [first, edited]);
    const fileDownload = page.waitForEvent('download');
    await page.evaluate(() => testUi.doSaveLocalFile(testUi.getFileData(true), 'handshake.drawio', 'text/xml'));
    const download = await fileDownload;
    assert.equal(download.suggestedFilename(), 'handshake.drawio');
    const saved = await readFile(await download.path(), 'utf8');
    assert.match(saved, /<mxfile/);
    const fragment = '#R' + encodeURIComponent(saved);
    const plain = await context.newPage();
    await plain.goto(editorUrl + '&plugins=0' + fragment);
    await plain.locator(picture).first().waitFor();
    assert.equal(await plain.locator('script[src*="plugins/wavedrom.js"]').count(), 0);
    await plain.close();
    await page.goto('about:blank');
    await page.goto(editorUrl);
    await page.locator('a[title^="Insert ("]').waitFor();
    await page.evaluate(xml => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([xml], 'handshake.drawio', { type: 'text/xml' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
    }, saved);
    await page.locator(picture).first().dblclick();
    assert.equal(await source.inputValue(), edited);
    await page.getByRole('button', { name: '取消' }).click();
    // Exercise the same SVG and canvas export paths used by the editor.
    const exported = await page.evaluate(async () => {
      Draw.loadPlugin(ui => { window.testUi = ui; });
      const svg = testUi.editor.graph.getSvg();
      const image = svg.querySelector('image');
      const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      const inner = await (await fetch(href)).text();
      const doc = new DOMParser().parseFromString(inner, 'image/svg+xml');
      const pixels = await new Promise((resolve, reject) => {
        testUi.editor.exportToCanvas(canvas => {
          const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          resolve(rgba.some((value, i) => i % 4 === 0 && value < 80 && rgba[i + 3] > 128));
        }, null, null, null, reject);
      });
      return { label: doc.documentElement.textContent.includes('数据 A&B'), pixels };
    });
    assert.deepEqual(exported, { label: true, pixels: true });

    // A second cell must carry its own SVG definitions and independent source.
    await page.locator('a[title^="Insert ("]').click();
    await page.getByText('WaveDrom 波形图...', { exact: true }).click();
    const clocks = "{ signal: [{name:'clk',wave:'N...'}, {}, {name:'bus',wave:'x3..',data:['总线']}] }";
    await source.fill(clocks);
    await apply.click();
    const copies = await page.evaluate(() => {
      const graph = testUi.editor.graph;
      const cell = graph.getSelectionCell();
      mxClipboard.copy(graph, [cell]);
      const copy = mxClipboard.paste(graph)[0];
      const read = c => JSON.parse(graph.getAttributeForCell(c, 'wavedromData')).source;
      const cells = graph.getChildVertices(graph.getDefaultParent());
      return { sources: cells.map(read), distinct: cell.id !== copy.id, samePreview: cell.style === copy.style };
    });
    assert.deepEqual(copies, { sources: [edited, clocks, clocks], distinct: true, samePreview: true });
  } finally {
    await browser.close();
  }
});
