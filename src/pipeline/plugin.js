import { createMatrix, validateMatrix, applyCommand } from './model.mjs';
import { renderSvg, sizeOf } from './render.js';
import { createEditor } from './editor.js';

const attribute = 'pipelineData';
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('pipeline.css', document.currentScript.src).href;
document.head.append(stylesheet);

Draw.loadPlugin(ui => {
  const graph = ui.editor.graph;
  const model = graph.getModel();
  const container = graph.container;
  const recent = new WeakMap();
  let editor, mount, cell, matrix, anchor, previousFocus;
  let writing = false;

  const stored = target => target && graph.getAttributeForCell(target, attribute);
  const matrices = () => model.filterDescendants(target => stored(target) != null &&
    graph.view.getState(target) != null);

  function read(target) {
    if (!target) return createMatrix();
    let record;
    try {
      record = JSON.parse(stored(target));
    } catch {
      throw new Error('无法读取流水矩阵数据。');
    }
    validateMatrix(record);
    return record;
  }

  function checkWritable(target) {
    const file = ui.getCurrentFile();
    if (!graph.isEnabled() || (file && !file.isEditable()) ||
        graph.isCellLocked(target || graph.getDefaultParent())) {
      throw new Error('当前文件只读或流水矩阵已锁定。');
    }
  }

  function history(actionName) {
    const action = ui.actions.get(actionName);
    if (graph.isEnabled() && action.isEnabled()) action.funct();
    // Restoring a selection can move focus back to draw.io's canvas.
    editor?.focus();
  }

  function position() {
    if (!mount) return;
    const state = cell && graph.view.getState(cell);
    const view = graph.view;
    const x = state ? state.x : (anchor.x + view.translate.x) * view.scale;
    const y = state ? state.y : (anchor.y + view.translate.y) * view.scale;
    const size = sizeOf(matrix);
    const sx = state ? state.width / size.width : view.scale;
    const sy = state ? state.height / size.height : view.scale;
    Object.assign(mount.style, { left: (x + graph.panDx) + 'px', top: (y + graph.panDy) + 'px',
      width: size.width + 'px', height: size.height + 'px', transform: 'scale(' + sx + ',' + sy + ')' });
  }

  function ensureVisible(x, y) {
    if (!mount) return;
    const bounds = mount.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    const size = sizeOf(matrix);
    const px = bounds.left + x * bounds.width / size.width;
    const py = bounds.top + y * bounds.height / size.height;
    const delta = (value, low, high) => value < low ? value - low : Math.max(0, value - high);
    container.scrollLeft += delta(px, viewport.left + 24, viewport.right - 24);
    container.scrollTop += delta(py, viewport.top + 24, viewport.bottom - 78);
  }

  function commit(command) {
    checkWritable(cell);
    const next = applyCommand(matrix, command);
    if (next === matrix) return matrix;
    const data = JSON.stringify(next);
    const svg = new XMLSerializer().serializeToString(renderSvg(next));
    const uri = ui.convertDataUri(Editor.createSvgDataUri(svg));
    const size = sizeOf(next);
    writing = true;
    model.beginUpdate();
    try {
      if (cell && model.contains(cell)) {
        const geometry = model.getGeometry(cell).clone();
        const before = sizeOf(matrix);
        geometry.width *= size.width / before.width;
        geometry.height *= size.height / before.height;
        model.setGeometry(cell, geometry);
        graph.setCellStyles(mxConstants.STYLE_IMAGE, uri, [cell]);
      } else {
        cell = graph.insertVertex(graph.getDefaultParent(), null, '', anchor.x, anchor.y,
          size.width, size.height, 'shape=image;noLabel=1;aspect=fixed;imageAspect=0;image=' + uri + ';');
      }
      graph.setAttributeForCell(cell, attribute, data);
      matrix = next;
      recent.set(model.getRoot(), cell);
    } finally {
      try { model.endUpdate(); } finally { writing = false; }
    }
    position();
    editor.refresh();
    return matrix;
  }

  function leave(restoreFocus = true) {
    if (!mount) return;
    editor?.destroy();
    mount.remove();
    editor = mount = cell = matrix = null;
    if (restoreFocus) {
      const target = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : container;
      target.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  function select(target) {
    checkWritable(target);
    const next = read(target);
    cell = target;
    matrix = next;
    if (cell) recent.set(model.getRoot(), cell);
    position();
  }

  function switchMatrix(id) {
    const target = model.getCell(id);
    if (!target || stored(target) == null) throw new Error('找不到流水矩阵。');
    select(target);
    // Recreate the controller so drafts and cursors never leak between independent diagrams.
    editor.destroy();
    attachEditor();
  }

  function attachEditor() {
    editor = createEditor({ mount, getMatrix: () => matrix, commit, exit: leave, ensureVisible,
      undo: () => history('undo'), redo: () => history('redo'),
      listMatrices: () => matrices().map((target, i) => ({ id: target.id,
        label: '矩阵 ' + (i + 1), selected: target === cell })), selectMatrix: switchMatrix });
    editor.focus();
  }

  function enter() {
    previousFocus = document.activeElement;
    const selected = graph.getSelectionCell();
    const list = matrices();
    const remembered = recent.get(model.getRoot());
    const target = list.includes(selected) ? selected : list.includes(remembered) ? remembered : list[0];
    anchor = graph.getFreeInsertPoint(true);
    select(target || null);
    mount = document.createElement('div');
    Object.assign(mount.style, { position: 'absolute', zIndex: '3', transformOrigin: 'top left' });
    container.append(mount);
    position();
    attachEditor();
  }

  function toggle() {
    try {
      if (mount) leave();
      else enter();
    } catch (error) {
      leave();
      ui.handleError(error);
    }
  }

  mxResources.resources.pipelineMode = '流水模式';
  const action = ui.actions.addAction('pipelineMode', toggle, null, null, 'F8');
  action.setToggleAction(true);
  action.setSelectedCallback(() => !!mount);
  const menu = ui.menus.get(urlParams.sketch === '1' ? 'extras' : 'view');
  const original = menu.funct;
  menu.funct = function(popup, parent) {
    original.apply(this, arguments);
    ui.menus.addMenuItems(popup, ['-', 'pipelineMode'], parent);
  };
  window.addEventListener('keydown', event => {
    if (event.key !== 'F8' || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.isComposing || ui.dialog || graph.isEditing() ||
        event.target.closest?.('input, textarea:not(.mxTypingShim), select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle();
  }, true);

  // Undo/redo and external edits restore the source stored in the graph's model.
  model.addListener(mxEvent.CHANGE, () => {
    if (!editor || writing) return;
    if (cell && (!model.contains(cell) || !graph.view.getState(cell))) {
      leave();
      return;
    }
    try {
      if (cell) matrix = read(cell);
      position();
      editor.refresh();
    } catch (error) {
      leave();
      ui.handleError(error);
    }
  });
  graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
    const target = graph.getSelectionCell();
    if (!editor || writing || !target || target === cell || stored(target) == null) return;
    try { switchMatrix(target.id); } catch (error) { ui.handleError(error); }
  });
  for (const event of [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE]) {
    graph.view.addListener(event, position);
  }
  graph.addListener(mxEvent.PAN, position);
  // Selection changes (including undo) schedule a second, deferred focus of
  // the host's hidden typing field. Preserve focus owned by the inline editor.
  const showTypingShim = ui.showTypingShim;
  ui.showTypingShim = function() {
    if (!mount?.contains(document.activeElement)) return showTypingShim.apply(this, arguments);
  };
  ui.editor.addListener('pageSelected', () => leave(false));
  ui.editor.addListener('fileLoaded', () => leave(false));
});
