const assert = require('node:assert/strict');
const { before, test } = require('node:test');

let createMatrix, applyCommand, visibleBlocks, validateMatrix;
before(async () => {
  ({ createMatrix, applyCommand, visibleBlocks, validateMatrix } = await import('../src/pipeline/model.mjs'));
});

function add(matrix, row, start, name, duration = 1) {
  return applyCommand(matrix, { type: 'add', row, start, name, duration });
}

function derive(matrix, row, delay) {
  return applyCommand(matrix, { type: 'derive', row, delay });
}

function stages(matrix) {
  return matrix.rows.map(row => visibleBlocks(row).map(block => [
    block.name, row.origin + block.start + 1, block.duration,
  ]));
}

test('three-stage rename, append and explicit sync survive reopening and moving a row', () => {
  let matrix = add(createMatrix(), 0, 0, '读取');
  matrix = add(matrix, 0, 1, '计算');
  matrix = derive(derive(matrix, 0, 2), 1, 1);
  const secondBlock = visibleBlocks(matrix.rows[1])[1].id;
  matrix = applyCommand(matrix, { type: 'edit', row: 1, id: secondBlock, patch: { name: '计算（备用）' } });
  matrix = add(matrix, 0, 2, '写回 & <OK>');
  matrix = JSON.parse(JSON.stringify(matrix));
  assert.equal(validateMatrix(matrix), matrix);
  assert.deepEqual(stages(matrix)[2], [['读取', 4, 1], ['计算', 5, 1]]);
  const synced = applyCommand(matrix, { type: 'sync', row: 0 });
  assert.deepEqual(stages(synced), [
    [['读取', 1, 1], ['计算', 2, 1], ['写回 & <OK>', 3, 1]],
    [['读取', 3, 1], ['计算（备用）', 4, 1], ['写回 & <OK>', 5, 1]],
    [['读取', 4, 1], ['计算（备用）', 5, 1], ['写回 & <OK>', 6, 1]],
  ]);
  assert.equal(applyCommand(synced, { type: 'sync', row: 0 }), synced);
  const moved = applyCommand(synced, { type: 'moveRow', row: 1, origin: 3 });
  assert.deepEqual(moved.rows.map(row => row.origin), [0, 3, 3]);
  assert.deepEqual(applyCommand(moved, { type: 'sync', row: 1 }).rows.map(row => row.origin), [0, 3, 4]);
  assert.deepEqual(moved.rows.map(row => row.origin), [0, 3, 3]);
});

test('preserve edited fields and inherit remaining fields, matching by ID for duplicate or empty names', () => {
  let matrix = add(add(createMatrix(), 0, 0, ''), 0, 2, '');
  matrix = derive(matrix, 0, 0);
  const [first, second] = visibleBlocks(matrix.rows[0]);
  const edit = (row, id, patch) => { matrix = applyCommand(matrix, { type: 'edit', row, id, patch }); };
  const sync = () => { matrix = applyCommand(matrix, { type: 'sync', row: 0 }); };
  edit(1, first.id, { name: '本地' });
  edit(0, first.id, { name: '本地', duration: 2 });
  sync();
  edit(0, first.id, { name: '新上游' });
  edit(0, second.id, { start: 4 });
  sync();
  assert.deepEqual(stages(matrix)[1], [['本地', 1, 2], ['', 5, 1]]);
  edit(1, first.id, { name: '新上游' }); // explicit return to the current baseline
  edit(0, first.id, { name: '新名称' });
  sync();
  assert.equal(stages(matrix)[1][0][0], '新名称');
});

test('deleting an inherited block hides it; detached edits keep their identity through later stages', () => {
  let matrix = add(add(add(createMatrix(), 0, 0, 'A'), 0, 1, 'B'), 0, 2, 'C');
  matrix = derive(derive(matrix, 0, 2), 1, 1);
  const [a, b, c] = visibleBlocks(matrix.rows[0]);
  matrix = applyCommand(matrix, { type: 'edit', row: 1, id: b.id, patch: { name: '本地 B' } });
  matrix = applyCommand(matrix, { type: 'delete', row: 1, id: c.id });
  matrix = applyCommand(matrix, { type: 'delete', row: 0, id: b.id });
  matrix = applyCommand(matrix, { type: 'delete', row: 0, id: a.id });
  matrix = add(matrix, 1, 3, 'D');
  matrix = applyCommand(matrix, { type: 'sync', row: 0 });
  assert.deepEqual(stages(matrix), [
    [['C', 3, 1]], [['本地 B', 4, 1], ['D', 6, 1]], [['本地 B', 5, 1], ['D', 7, 1]],
  ]);
  assert.equal(visibleBlocks(matrix.rows[2])[0].id, b.id);
  assert.equal(applyCommand(matrix, { type: 'sync', row: 0 }), matrix);
});

test('failure in the last stage rolls back all rows and reports the conflicting cycles', () => {
  let matrix = derive(derive(add(createMatrix(), 0, 0, 'A'), 0, 2), 1, 1);
  matrix = add(matrix, 2, 3, '局部', 2);
  matrix = add(matrix, 0, 3, '新块', 3);
  const original = JSON.stringify(matrix);
  assert.throws(() => applyCommand(matrix, { type: 'sync', row: 0 }), /第 3 级.*第 7 至 8 拍重叠/);
  assert.equal(JSON.stringify(matrix), original);
  assert.deepEqual(stages(matrix)[1], [['A', 3, 1]]);
});

test('insert a middle stage without moving its successor; reject a negative delay atomically', () => {
  let matrix = derive(add(createMatrix(), 0, 0, 'A'), 0, 4);
  const originalNextId = matrix.rows[1].id;
  assert.throws(() => derive(matrix, 0, 5), /减小延迟/);
  matrix = derive(matrix, 0, 1);
  assert.equal(matrix.rows[2].id, originalNextId);
  assert.deepEqual(matrix.rows.map(row => [row.origin, row.delay]), [[0, 0], [1, 1], [4, 3]]);
  assert.equal(applyCommand(matrix, { type: 'sync', row: 0 }), matrix);
});

test('whole-cycle limits, touching intervals, automatic expansion and explicit shrinking', () => {
  const empty = createMatrix();
  assert.equal(empty.cycles, 8);
  let matrix = add(add(empty, 0, 1, 'ABC', 3), 0, 4, 'D');
  assert.throws(() => add(matrix, 0, 3, 'X'), /第 4 至 4 拍重叠/);
  matrix = derive(matrix, 0, 5);
  assert.equal(matrix.cycles, 10);
  assert.throws(() => applyCommand(matrix, { type: 'cycles', cycles: 9 }), /至少需要 10 拍/);
  assert.throws(() => derive(matrix, 1, -1), /延迟/);
  assert.throws(() => derive(matrix, 1, 0.5), /整数/);
  assert.throws(() => add(empty, 0, 0, '无时长', 0), /时长/);
  assert.throws(() => add(empty, 0, -1, '越界'), /起点/);
  assert.throws(() => add(empty, 0, 0, 'a\nb'), /单行/);
  matrix = applyCommand(matrix, { type: 'cycles', cycles: 12 });
  matrix = applyCommand(matrix, { type: 'cycles', cycles: 10 });
  assert.equal(matrix.cycles, 10);
});

test('reject invalid version, duplicate identities, stale overrides and unsupported coordinates', () => {
  assert.throws(() => validateMatrix({ version: 2 }), /版本/);
  const matrix = derive(add(createMatrix(), 0, 0, 'A'), 0, 1);
  const check = (mutate, message) => {
    const copy = structuredClone(matrix);
    mutate(copy);
    assert.throws(() => validateMatrix(copy), message);
  };
  check(m => { m.rows[1].id = m.rows[0].id; }, /标识重复/);
  check(m => { m.rows[1].overrides.push({ id: 'b999', name: 'Z' }); }, /修改记录/);
  check(m => { m.rows[1].local.push(m.rows[1].base[0]); }, /标识重复/);
  check(m => { m.rows[1].origin = Number.MAX_SAFE_INTEGER; }, /矩阵宽度/);
});
