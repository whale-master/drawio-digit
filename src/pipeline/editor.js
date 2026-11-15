import { visibleBlocks } from './model.mjs';
import { layout, renderSvg } from './render.js';

const { label, header, cycle, row: rowHeight } = layout;

function element(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

function button(parent, text, shortcut, action) {
  const node = element('button', '', parent);
  node.type = 'button';
  node.textContent = text;
  if (shortcut) node.title = text + ' (' + shortcut + ')';
  node.addEventListener('click', action);
  return node;
}

function cellBox(row, start, length = 1) {
  return { x: label + start * cycle, y: header + row * rowHeight,
    width: length * cycle, height: rowHeight };
}

function place(node, box) {
  node.style.left = box.x + 'px';
  node.style.top = box.y + 'px';
  node.style.width = box.width + 'px';
  node.style.height = box.height + 'px';
}

export function createEditor({ mount, getMatrix, commit, exit, undo, redo,
  listMatrices, selectMatrix, ensureVisible }) {
  const grid = element('div', 'pipeline-grid', mount);
  grid.tabIndex = 0;
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', '流水网格');
  const picture = element('div', 'pipeline-picture', grid);
  picture.setAttribute('aria-hidden', 'true');
  const outline = element('div', 'pipeline-cursor', grid);
  outline.setAttribute('aria-hidden', 'true');

  const panel = element('section', 'pipeline-panel', document.body);
  panel.setAttribute('aria-label', '流水模式');
  const tools = element('div', 'pipeline-tools', panel);
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', '流水模式工具栏');
  const mode = element('strong', 'pipeline-mode', tools);
  mode.textContent = '流水模式';
  const matrices = element('select', '', tools);
  matrices.setAttribute('aria-label', '选择流水矩阵');
  const cyclesLabel = element('label', 'pipeline-cycles', tools);
  cyclesLabel.append('周期 ');
  const cycles = element('input', '', cyclesLabel);
  cycles.type = 'number';
  cycles.min = '1';
  cycles.setAttribute('aria-label', '周期数');
  const drawButton = button(tools, '矩形', 'R', () => {
    drawing = !drawing;
    clearSelection();
    refresh();
    focus();
  });
  button(tools, '＋ 下一级', 'Enter', () => beginEntry('derive'));
  button(tools, '同步后续行', 'Shift+Enter', () => { sync(); focus(); });
  const deleteButton = button(tools, '删除方块', 'Delete', () => { removeBlock(); focus(); });
  const returnButton = button(tools, '返回网格', '', focus);
  button(tools, '退出', 'F8', exit);
  const feedback = element('div', 'pipeline-feedback', panel);
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  let rowIndex = 0;
  let column = getMatrix().rows[0].origin;
  let anchor = null;
  let selection = null; // 'row' or a stable block ID
  let drawing = false;
  let entry = null;
  let gesture = null;
  let lastMatrix = null;
  let error = '';
  let destroyed = false;

  function row() { return getMatrix().rows[rowIndex]; }
  function blocks() { return visibleBlocks(row()); }
  function blockAt(col) {
    const local = col - row().origin;
    return blocks().find(block => block.start <= local && local < block.start + block.duration);
  }
  function selectedBlock() { return selection && blocks().find(b => b.id === selection); }
  function range() {
    const end = anchor ?? column;
    return { start: Math.min(column, end), duration: Math.abs(column - end) + 1 };
  }
  function clearSelection() { selection = null; anchor = null; }

  function focus() {
    if (destroyed) return;
    grid.focus({ preventScroll: true });
    reveal();
  }

  function reveal() {
    const box = cellBox(rowIndex, column);
    ensureVisible(box.x + cycle / 2, box.y + rowHeight / 2);
  }

  function report(message) {
    error = message;
    feedback.textContent = message;
    feedback.classList.add('pipeline-error');
  }

  function apply(command) {
    try {
      commit({ row: rowIndex, ...command });
      error = '';
      return true;
    } catch (err) {
      report(err.message);
      return false;
    }
  }

  function refresh() {
    if (destroyed) return;
    const matrix = getMatrix();
    rowIndex = Math.min(rowIndex, matrix.rows.length - 1);
    column = Math.max(column, row().origin);
    if (selection && selection !== 'row' && !selectedBlock()) selection = null;
    if (matrix !== lastMatrix) {
      lastMatrix = matrix;
      picture.replaceChildren(renderSvg(matrix));
      grid.style.width = (label + matrix.cycles * cycle) + 'px';
      grid.style.height = (header + matrix.rows.length * rowHeight) + 'px';
      grid.setAttribute('aria-rowcount', String(matrix.rows.length));
      grid.setAttribute('aria-colcount', String(matrix.cycles));
    }
    if (document.activeElement !== cycles) cycles.value = String(matrix.cycles);
    const options = listMatrices();
    const listed = [...matrices.options];
    if (options.length !== listed.length || options.some((m, i) =>
      m.id !== listed[i].value || m.label !== listed[i].text)) {
      matrices.replaceChildren(...options.map(m => new Option(m.label, m.id)));
    }
    const activeMatrix = options.find(m => m.selected);
    if (activeMatrix && matrices.value !== activeMatrix.id) matrices.value = activeMatrix.id;
    matrices.hidden = options.length < 2;
    const containing = mount.closest('.geDiagramContainer')?.getBoundingClientRect();
    if (containing) {
      panel.style.left = Math.max(4, containing.left + 8) + 'px';
      panel.style.bottom = Math.max(4, window.innerHeight - containing.bottom + 8) + 'px';
      panel.style.maxWidth = Math.max(220, containing.width - 16) + 'px';
    }
    const selected = selectedBlock();
    const span = range();
    let box = cellBox(rowIndex, span.start, span.duration);
    if (selection === 'row') box = { ...box, x: 0, width: label };
    if (selected) box = cellBox(rowIndex, row().origin + selected.start, selected.duration);
    if (gesture?.box) box = gesture.box;
    place(outline, box);
    outline.classList.toggle('pipeline-selected', !!selection);
    drawButton.setAttribute('aria-pressed', String(drawing));
    deleteButton.disabled = !selected;
    grid.classList.toggle('pipeline-drawing', drawing);
    const beat = anchor != null && span.duration > 1
      ? (span.start + 1) + '–' + (span.start + span.duration) : String(column + 1);
    const position = '第 ' + (rowIndex + 1) + ' 级 · 第 ' + beat + ' 拍';
    const hint = entry?.kind === 'derive' ? '输入延迟拍数，Enter 确认'
      : entry?.kind === 'add' ? 'Enter 完成 · Tab 继续绘制'
      : entry ? 'Enter 保存名称 · Esc 取消'
      : selection === 'row' ? '← → 调整整行延迟'
      : selected ? '← → 移动 · Shift+← → 改时长 · F2 改名'
      : drawing ? '单击或拖动绘制方块'
      : 'R 绘制 · F2 改名 · Enter 下一级';
    grid.setAttribute('aria-description', position + '。' + hint);
    feedback.textContent = error || position + '　' + hint;
    feedback.classList.toggle('pipeline-error', !!error);
  }

  function dismiss() {
    if (!entry) return;
    const old = entry;
    entry = null;
    old.form.remove();
  }

  function beginEntry(kind, span = range()) {
    error = '';
    const existing = kind === 'rename' && (selectedBlock() || blockAt(column));
    if (kind === 'rename' && !existing) return;
    if (kind === 'add') {
      const start = span.start - row().origin;
      const occupied = blocks().find(b => b.start < start + span.duration && start < b.start + b.duration);
      if (occupied || start < 0) {
        report(occupied ? '第 ' + (row().origin + occupied.start + 1) + ' 拍已有方块。' : '不能在本级起点之前绘制。');
        return;
      }
    }
    dismiss();
    const box = kind === 'rename' ? cellBox(rowIndex, row().origin + existing.start, existing.duration)
      : cellBox(rowIndex, kind === 'derive' ? column : span.start, span.duration);
    const form = element('div', 'pipeline-entry', grid);
    form.style.left = box.x + 'px';
    form.style.top = (box.y + 3) + 'px';
    const input = element('input', '', form);
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const caption = kind === 'derive' ? '延迟拍数' : '方块名称';
    input.setAttribute('aria-label', caption);
    input.placeholder = caption;
    if (kind === 'derive') input.inputMode = 'numeric';
    input.value = kind === 'derive' ? '1' : existing?.name || '';
    const confirm = button(form, '确定', 'Enter', () => finishEntry(false));
    const cancel = button(form, '取消', 'Esc', () => { dismiss(); focus(); refresh(); });
    for (const control of [confirm, cancel]) {
      control.tabIndex = -1;
      control.addEventListener('mousedown', e => e.preventDefault());
    }
    entry = { kind, form, input, span, id: existing?.id };
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss(); error = ''; focus(); refresh();
      } else if (event.key === 'Enter' || (event.key === 'Tab' && kind === 'add' && !event.shiftKey)) {
        event.preventDefault();
        finishEntry(event.key === 'Tab');
      }
    });
    input.addEventListener('blur', () => {
      if (entry?.input === input) { dismiss(); refresh(); }
    });
    input.focus({ preventScroll: true });
    input.select();
    refresh();
  }

  function finishEntry(advance) {
    if (!entry) return;
    const { kind, input, span, id } = entry;
    const value = input.value;
    if (kind === 'derive') {
      if (!/^\d+$/.test(value.trim())) { report('请输入非负整数拍数。'); return; }
      if (!apply({ type: 'derive', delay: Number(value) })) return;
      rowIndex++;
      column = row().origin;
    } else if (kind === 'rename') {
      if (!apply({ type: 'edit', id, patch: { name: value } })) return;
    } else {
      if (!apply({ type: 'add', name: value, start: span.start - row().origin, duration: span.duration })) return;
      column = span.start + span.duration;
    }
    dismiss();
    clearSelection();
    focus(); refresh(); reveal();
    if (advance && !blockAt(column)) beginEntry('add');
  }

  function sync() { apply({ type: 'sync' }); refresh(); }
  function removeBlock() {
    const b = selectedBlock();
    if (b && apply({ type: 'delete', id: b.id })) clearSelection();
    refresh();
  }

  function horizontal(direction, shifted) {
    const b = selectedBlock();
    if (selection === 'row') {
      const origin = row().origin + direction;
      if (apply({ type: 'moveRow', origin })) column = origin;
    } else if (b) {
      const patch = shifted ? { duration: b.duration + direction } : { start: b.start + direction };
      if (apply({ type: 'edit', id: b.id, patch })) column = row().origin + (patch.start ?? b.start);
    } else {
      anchor = shifted ? (anchor ?? column) : null;
      column = Math.max(row().origin, column + direction);
      if (!shifted) column = Math.min(column, getMatrix().cycles);
    }
  }

  grid.addEventListener('keydown', event => {
    if (event.target !== grid || event.isComposing || event.altKey) return;
    const { key, shiftKey } = event;
    // draw.io focuses an offscreen clipboard target on the modifier keydown,
    // before the subsequent Z/Y can reach this grid.
    if (key === 'Control' || key === 'Meta') {
      event.stopPropagation();
      return;
    }
    const lower = key.toLowerCase();
    error = '';
    if (event.ctrlKey || event.metaKey) {
      if (lower === 'z') (shiftKey ? redo : undo)();
      else if (lower === 'y') redo();
      else return;
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      horizontal(key === 'ArrowLeft' ? -1 : 1, shiftKey);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      rowIndex = Math.max(0, Math.min(getMatrix().rows.length - 1, rowIndex + (key === 'ArrowUp' ? -1 : 1)));
      clearSelection();
      column = Math.max(column, row().origin);
    } else if (key === 'Home') {
      selection = 'row'; anchor = null; column = row().origin;
    } else if (key === ' ') {
      selection = blockAt(column)?.id ?? null; anchor = null;
    } else if (key === 'Escape') {
      cancelGesture(); clearSelection(); drawing = false;
    } else if (key === 'Enter') {
      if (shiftKey) sync();
      else beginEntry('derive');
    } else if (lower === 'r') {
      beginEntry('add');
    } else if (key === 'F2') {
      beginEntry('rename');
    } else if (key === 'Delete') {
      removeBlock();
    } else if (key === 'Tab') {
      (shiftKey ? returnButton : (matrices.hidden ? cycles : matrices)).focus();
    } else if (key === 'F8') {
      exit();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!destroyed) { refresh(); reveal(); }
  });

  matrices.addEventListener('change', () => {
    try {
      selectMatrix(matrices.value);
      if (destroyed) return;
      rowIndex = 0; column = row().origin;
      clearSelection();
      error = ''; focus(); refresh(); reveal();
    } catch (err) { report(err.message); }
  });
  function setCycles() {
    if (apply({ type: 'cycles', cycles: cycles.valueAsNumber })) {
      column = Math.min(column, getMatrix().cycles);
      refresh(); return true;
    }
    return false;
  }
  cycles.addEventListener('change', setCycles);
  cycles.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cycles.value = String(getMatrix().cycles);
      focus(); refresh();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (setCycles()) { focus(); refresh(); }
    }
  });
  tools.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); focus(); }
    event.stopPropagation();
  });

  function hit(event) {
    const rect = grid.getBoundingClientRect();
    const x = (event.clientX - rect.left) * grid.offsetWidth / rect.width;
    const y = (event.clientY - rect.top) * grid.offsetHeight / rect.height;
    return { x, y, row: Math.floor((y - header) / rowHeight),
      column: Math.floor((x - label) / cycle) };
  }

  function releaseGesture() {
    if (!gesture) return;
    const pointer = gesture.pointer;
    gesture = null;
    if (grid.hasPointerCapture(pointer)) grid.releasePointerCapture(pointer);
  }
  function cancelGesture() { releaseGesture(); refresh(); }

  grid.addEventListener('pointerdown', event => {
    // The name input is part of the overlay and needs the browser's text selection.
    if (event.target.closest('.pipeline-entry') || event.button !== 0) return;
    const pos = hit(event);
    if (pos.row < 0 || pos.row >= getMatrix().rows.length) return;
    event.preventDefault(); event.stopPropagation();
    dismiss(); focus();
    clearSelection(); error = '';
    rowIndex = pos.row;
    column = Math.max(pos.column, row().origin);
    const b = blockAt(pos.column);
    let type;
    if (pos.x < label) {
      selection = 'row'; type = 'moveRow'; column = row().origin;
    } else if (drawing) {
      if (pos.column < row().origin) { report('不能在本级起点之前绘制。'); return; }
      type = 'draw';
    } else if (b) {
      selection = b.id;
      const left = label + (row().origin + b.start) * cycle;
      const right = left + b.duration * cycle;
      type = pos.x - left < 7 ? 'left' : right - pos.x < 7 ? 'right' : 'move';
    }
    if (type) {
      const startBoundary = Math.round((pos.x - label) / cycle);
      gesture = { type, pointer: event.pointerId, x: pos.x, original: b, first: column,
        startBoundary };
      grid.setPointerCapture(event.pointerId);
    }
    refresh();
  });

  function proposal(pos) {
    const { type, x, original: b, first } = gesture;
    const delta = Math.round((pos.x - x) / cycle);
    if (type === 'moveRow') {
      const origin = row().origin + delta;
      return { command: { type: 'moveRow', origin }, box: cellBox(rowIndex, origin) };
    }
    if (type === 'draw') {
      // A click selects its cell. A drag ends at the nearest boundary.
      const point = (pos.x - label) / cycle;
      const boundary = Math.round(point);
      const moved = Math.abs(pos.x - x) >= 4 && boundary !== gesture.startBoundary;
      const start = moved ? Math.min(gesture.startBoundary, boundary) : first;
      const end = moved ? Math.max(gesture.startBoundary, boundary) : first + 1;
      const span = { start, duration: end - start };
      return { span, box: cellBox(rowIndex, start, span.duration) };
    }
    const start = b.start + (type === 'right' ? 0 : delta);
    const duration = b.duration + (type === 'move' ? 0 : type === 'left' ? -delta : delta);
    return { command: { type: 'edit', id: b.id, patch: { start, duration } },
      box: cellBox(rowIndex, start + row().origin, Math.max(1, duration)) };
  }
  grid.addEventListener('pointermove', event => {
    if (gesture?.pointer !== event.pointerId) return;
    const pos = hit(event);
    gesture.box = proposal(pos).box;
    refresh();
  });
  grid.addEventListener('pointerup', event => {
    if (gesture?.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const pos = hit(event);
    const { type, x } = gesture;
    const { command, span } = proposal(pos);
    releaseGesture();
    if (type === 'draw') {
      column = span.start;
      anchor = span.start + span.duration - 1;
      beginEntry('add', span);
    } else if (Math.abs(pos.x - x) >= cycle / 2 && apply(command)) {
      const b = selectedBlock();
      column = b ? row().origin + b.start : row().origin;
    }
    refresh();
  });
  grid.addEventListener('pointercancel', cancelGesture);
  grid.addEventListener('lostpointercapture', event => {
    if (gesture?.pointer === event.pointerId) cancelGesture();
  });
  grid.addEventListener('dblclick', event => {
    if (event.target.closest('.pipeline-entry')) return;
    const pos = hit(event);
    if (pos.row < 0 || pos.row >= getMatrix().rows.length || pos.column < 0) return;
    event.preventDefault(); event.stopPropagation();
    rowIndex = pos.row; column = pos.column;
    clearSelection();
    beginEntry('rename');
  });
  for (const name of ['mousedown', 'mouseup', 'click', 'pointerdown']) {
    grid.addEventListener(name, event => event.stopPropagation());
  }

  refresh();
  return { refresh, focus, destroy() {
    destroyed = true;
    releaseGesture();
    dismiss();
    panel.remove();
    grid.remove();
  } };
}
