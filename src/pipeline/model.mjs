// All positions are zero-based. A block occupies [start, start + duration)
// relative to its row. A row's origin is its last displayed absolute position.
const blockFields = ['name', 'start', 'duration'];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function whole(value, minimum, label) {
  requireValue(Number.isSafeInteger(value) && value >= minimum,
    label + '必须为大于或等于 ' + minimum + ' 的整数。');
}

function makeRow(id, origin, delay, base = []) {
  return { id, title: '', origin, delay, base, local: [], overrides: [], hidden: [] };
}

export function createMatrix() {
  return { version: 1, cycles: 8, nextId: 2, rows: [makeRow('r1', 0, 0)] };
}

export function visibleBlocks(row) {
  const hidden = new Set(row.hidden);
  const overrides = new Map(row.overrides.map(patch => [patch.id, patch]));
  return row.base.filter(block => !hidden.has(block.id))
    .map(block => ({ ...block, ...overrides.get(block.id) }))
    .concat(row.local.map(block => ({ ...block })))
    .sort((a, b) => a.start - b.start);
}

function checkId(id, prefix, nextId) {
  requireValue(typeof id === 'string' && id[0] === prefix && /^[1-9]\d*$/.test(id.slice(1)) &&
    Number(id.slice(1)) < nextId, '流水数据含无效标识。');
}

function checkFields(record, partial) {
  if (!partial || Object.hasOwn(record, 'name')) {
    requireValue(typeof record.name === 'string' && !/[\r\n]/.test(record.name), '方块名称必须是单行文本。');
  }
  if (!partial || Object.hasOwn(record, 'start')) whole(record.start, 0, '方块起点');
  if (!partial || Object.hasOwn(record, 'duration')) whole(record.duration, 1, '方块时长');
}

function checkRow(row, nextId) {
  requireValue(row && typeof row.title === 'string' &&
    [row.base, row.local, row.overrides, row.hidden].every(Array.isArray), '流水行记录无效。');
  checkId(row.id, 'r', nextId);
  whole(row.origin, 0, '流水行起点');
  whole(row.delay, 0, '流水延迟');
  const ids = new Set();
  for (const block of [...row.base, ...row.local]) {
    requireValue(block && !ids.has(block.id), '行内方块标识重复或无效。');
    checkId(block.id, 'b', nextId);
    checkFields(block, false);
    ids.add(block.id);
  }
  const baseIds = new Set(row.base.map(block => block.id));
  const touched = new Set();
  for (const id of row.hidden) {
    requireValue(baseIds.has(id) && !touched.has(id), '无效的隐藏方块记录。');
    touched.add(id);
  }
  for (const patch of row.overrides) {
    requireValue(patch && baseIds.has(patch.id) && !touched.has(patch.id) &&
      Object.keys(patch).every(key => key === 'id' || blockFields.includes(key)),
    '无效的方块修改记录。');
    checkFields(patch, true);
    touched.add(patch.id);
  }
}

function requiredCycles(matrix) {
  whole(matrix.nextId, 2, '下一个标识');
  let minimum = 1;
  const rowIds = new Set();
  for (const [index, row] of matrix.rows.entries()) {
    checkRow(row, matrix.nextId);
    requireValue(!rowIds.has(row.id), '流水级标识重复。');
    rowIds.add(row.id);
    if (index === 0) requireValue(!row.base.length && row.delay === 0, '第一级不应有继承来源。');
    // Even an empty derived row needs a visible first cell for keyboard entry.
    minimum = Math.max(minimum, row.origin + 1);
    let previous;
    for (const block of visibleBlocks(row)) {
      if (previous && block.start < previous.start + previous.duration) {
        const from = row.origin + block.start + 1;
        const to = row.origin + Math.min(previous.start + previous.duration, block.start + block.duration);
        throw new Error(`第 ${index + 1} 级的“${previous.name || '未命名'}”与“${block.name || '未命名'}”在第 ${from} 至 ${to} 拍重叠。`);
      }
      minimum = Math.max(minimum, row.origin + block.start + block.duration);
      previous = block;
    }
  }
  whole(minimum, 1, '矩阵宽度');
  return minimum;
}

export function validateMatrix(matrix) {
  requireValue(matrix?.version === 1, '无法读取此流水图的数据版本。');
  requireValue(Array.isArray(matrix.rows) && matrix.rows.length > 0, '流水图至少需要一级。');
  whole(matrix.cycles, 1, '周期数');
  const minimum = requiredCycles(matrix);
  requireValue(matrix.cycles >= minimum, `当前内容至少需要 ${minimum} 拍。`);
  return matrix;
}

function editBlock(row, id, changes) {
  requireValue(changes && typeof changes === 'object' &&
    Object.keys(changes).every(key => blockFields.includes(key)), '方块修改字段无效。');
  checkFields(changes, true);
  const local = row.local.find(block => block.id === id);
  if (local) {
    Object.assign(local, changes);
    return;
  }
  const base = row.base.find(block => block.id === id);
  requireValue(base && !row.hidden.includes(id), '未找到要编辑的方块。');
  const existing = row.overrides.find(patch => patch.id === id);
  const patch = existing || { id };
  for (const [key, value] of Object.entries(changes)) {
    if (value === base[key]) delete patch[key];
    else patch[key] = value;
  }
  if (!existing && Object.keys(patch).length > 1) row.overrides.push(patch);
  if (existing && Object.keys(patch).length === 1) {
    row.overrides = row.overrides.filter(item => item.id !== id);
  }
}

function removeBlock(row, id) {
  const index = row.local.findIndex(block => block.id === id);
  if (index >= 0) {
    row.local.splice(index, 1);
    return;
  }
  requireValue(row.base.some(block => block.id === id) && !row.hidden.includes(id), '未找到要删除的方块。');
  row.hidden.push(id);
  row.overrides = row.overrides.filter(patch => patch.id !== id);
}

function derive(matrix, index, delay) {
  whole(delay, 0, '流水延迟');
  const parent = matrix.rows[index];
  const origin = parent.origin + delay;
  const successor = matrix.rows[index + 1];
  if (successor) {
    requireValue(origin <= successor.origin, '新增级晚于后一级起点，请减小延迟。');
    successor.delay = successor.origin - origin;
  }
  matrix.rows.splice(index + 1, 0, makeRow('r' + matrix.nextId++, origin, delay, visibleBlocks(parent)));
}

function syncRow(row, parent) {
  const base = visibleBlocks(parent);
  const sourceIds = new Set(base.map(block => block.id));
  const oldBase = new Map(row.base.map(block => [block.id, block]));
  // An upstream deletion only drops untouched descendants. A locally edited
  // descendant keeps its old effective values and identity as a local block.
  for (const patch of row.overrides) {
    if (!sourceIds.has(patch.id)) row.local.push({ ...oldBase.get(patch.id), ...patch });
  }
  row.overrides = row.overrides.filter(patch => sourceIds.has(patch.id));
  row.hidden = row.hidden.filter(id => sourceIds.has(id));
  row.base = base;
  row.origin = parent.origin + row.delay;
}

export function applyCommand(matrix, command) {
  // Work on a detached snapshot: errors in late descendants must never leave
  // earlier descendants updated, and the old matrix is also the undo image.
  const next = structuredClone(matrix);
  const index = command.row;
  const row = next.rows[index];
  if (command.type !== 'cycles') requireValue(Number.isInteger(index) && row, '未找到流水级。');
  switch (command.type) {
    case 'cycles':
      whole(command.cycles, 1, '周期数');
      next.cycles = command.cycles;
      break;
    case 'add':
      row.local.push({ id: 'b' + next.nextId++, name: command.name, start: command.start, duration: command.duration });
      break;
    case 'edit':
      editBlock(row, command.id, command.patch);
      break;
    case 'delete':
      removeBlock(row, command.id);
      break;
    case 'moveRow':
      whole(command.origin, 0, '流水行起点');
      row.origin = command.origin;
      if (index > 0) {
        row.delay = row.origin - next.rows[index - 1].origin;
        requireValue(row.delay >= 0, '流水行不能早于上一级起点。');
      }
      break;
    case 'derive':
      derive(next, index, command.delay);
      break;
    case 'sync':
      for (let i = index + 1; i < next.rows.length; i++) syncRow(next.rows[i], next.rows[i - 1]);
      break;
    default:
      throw new Error('未知的流水编辑操作。');
  }
  const minimum = requiredCycles(next);
  if (command.type === 'cycles') requireValue(next.cycles >= minimum, `当前内容至少需要 ${minimum} 拍。`);
  next.cycles = Math.max(minimum, next.cycles);
  return JSON.stringify(matrix) === JSON.stringify(next) ? matrix : next;
}
