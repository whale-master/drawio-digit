const workerUrl = new URL('wavedrom-render.js', document.currentScript.src);
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('wavedrom.css', workerUrl).href;
document.head.appendChild(stylesheet);
const attribute = 'wavedromData';
const example = `{
  signal: [
    { name: 'clk',   wave: 'P...' },
    { name: 'valid', wave: '01..' },
    { name: 'ready', wave: '01..' },
    { name: 'data',  wave: 'x=..', data: ['D0'] },
  ]
}`;

// Create XML in a detached document so labels containing '<', '&', or
// quotation marks are escaped as text, including in an exported diagram.
function svgElement(doc, [tag, ...children]) {
  const el = doc.createElementNS(mxConstants.NS_SVG, tag);
  for (const item of children) {
    if (Array.isArray(item)) {
      el.appendChild(svgElement(doc, item));
    } else if (item != null && typeof item === 'object') {
      for (const [name, value] of Object.entries(item)) {
        if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
        const ns = name.startsWith('xlink:') ? 'http://www.w3.org/1999/xlink'
          : name.startsWith('xml:') ? 'http://www.w3.org/XML/1998/namespace' : null;
        el.setAttributeNS(ns, name, value);
      }
    } else if (item != null) {
      // WaveDrom's tspan formatter already escapes these four XML entities.
      const text = String(item).replace(/&(amp|lt|gt|quot);/g,
        (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"' })[entity]);
      el.appendChild(doc.createTextNode(text));
    }
  }
  return el;
}

function applyWave(ui, cell, source, image) {
  const graph = ui.editor.graph;
  const model = graph.getModel();
  const uri = ui.convertDataUri(image.uri);
  model.beginUpdate();
  try {
    if (cell) {
      graph.setCellStyles(mxConstants.STYLE_IMAGE, uri, [cell]);
    } else {
      const point = graph.getFreeInsertPoint();
      cell = graph.insertVertex(graph.getDefaultParent(), null, '', point.x, point.y,
        image.width, image.height, 'shape=image;noLabel=1;imageAspect=1;aspect=fixed;image=' + uri + ';');
    }
    graph.setAttributeForCell(cell, attribute, JSON.stringify({ version: 1, source }));
  } finally {
    model.endUpdate();
  }
  graph.setSelectionCell(cell);
  graph.scrollCellToVisible(cell);
}

function showEditor(ui, cell, source) {
  const panel = document.createElement('div');
  panel.className = 'wd-editor';
  panel.innerHTML = `
    <h2>WaveDrom 波形图</h2>
    <div class="wd-columns">
      <label>WaveJSON<textarea spellcheck="false" autocomplete="off"></textarea></label>
      <section aria-label="实时预览"><h3>实时预览</h3><div class="wd-preview"><img alt="波形预览"></div></section>
    </div>
    <footer><span role="status"></span><button type="button" class="geBtn">取消</button>
    <button type="button" class="geBtn gePrimaryBtn" disabled>应用</button></footer>`;
  const input = panel.querySelector('textarea');
  const preview = panel.querySelector('img');
  const status = panel.querySelector('[role=status]');
  const [cancel, apply] = panel.querySelectorAll('button');
  let worker, debounce, deadline, image;
  input.value = source;

  function stop() {
    clearTimeout(debounce);
    clearTimeout(deadline);
    worker?.terminate();
    worker = null;
  }
  function render() {
    const job = new Worker(workerUrl);
    worker = job;
    function fail(message) {
      if (worker !== job) return;
      stop();
      status.textContent = message;
      status.className = 'wd-error';
    }
    job.onerror = (event) => fail(event.message || '无法加载波形渲染器。');
    deadline = setTimeout(() => fail('渲染超时，请检查周期、相位和波形长度。'), 8000);
    job.onmessage = ({ data }) => {
      if (worker !== job) return;
      if (data.error) return fail(data.error);
      try {
        const svg = svgElement(document.implementation.createDocument(null, null), data.svg);
        if (!EditorUi.isSelfContainedSvg(svg)) throw new Error('波形包含外部引用或不支持的 SVG 内容。');
        const uri = Editor.createSvgDataUri(new XMLSerializer().serializeToString(svg));
        image = { uri, width: Number(svg.getAttribute('width')), height: Number(svg.getAttribute('height')) };
        preview.src = uri;
        apply.disabled = false;
        status.textContent = '';
        stop();
      } catch (error) {
        fail(error.message);
      }
    };
    job.postMessage(input.value);
  }
  function refresh() {
    stop();
    image = null;
    apply.disabled = true;
    status.className = '';
    status.textContent = '正在预览…';
    debounce = setTimeout(render, 140);
  }
  input.addEventListener('input', refresh);
  cancel.onclick = () => ui.hideDialog();
  apply.onclick = () => {
    if (!image) return;
    applyWave(ui, cell, input.value, image);
    ui.hideDialog();
  };
  ui.showDialog(panel, Math.min(900, window.innerWidth - 60),
    Math.min(425, window.innerHeight - 80), true, true, stop);
  input.focus();
  refresh();
}

Draw.loadPlugin((ui) => {
  const graph = ui.editor.graph;
  mxResources.resources.wavedrom = 'WaveDrom 波形图';
  ui.actions.addAction('wavedrom...', () => showEditor(ui, null, example));
  // The toolbar captures its menu callback before plugins are initialized.
  // Both toolbar and Arrange > Insert build their items through this method.
  const addMenuItems = ui.menus.addMenuItems;
  ui.menus.addMenuItems = function (popup, items, ...args) {
    const index = items.indexOf('insertPolygon');
    if (index >= 0) items = [...items.slice(0, index + 1), 'wavedrom', ...items.slice(index + 1)];
    return addMenuItems.call(this, popup, items, ...args);
  };
  const originalDblClick = graph.dblClick;
  graph.dblClick = function (event, cell) {
    const stored = cell && graph.getAttributeForCell(cell, attribute);
    if (stored == null || !graph.isEnabled() || graph.isCellLocked(cell)) {
      return originalDblClick.apply(this, arguments);
    }
    mxEvent.consume(event);
    try {
      const record = JSON.parse(stored);
      if (record?.version !== 1 || typeof record.source !== 'string') {
        throw new Error('无法读取此波形的源码版本。');
      }
      showEditor(ui, cell, record.source);
    } catch (error) {
      ui.handleError(error);
    }
  };
});
