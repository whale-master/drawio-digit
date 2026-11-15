import { visibleBlocks } from './model.mjs';

export const layout = Object.freeze({ label: 100, cycle: 72, header: 32, row: 42 });

export function sizeOf(matrix) {
  return {
    width: layout.label + matrix.cycles * layout.cycle,
    height: layout.header + matrix.rows.length * layout.row,
  };
}

function svg(tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text != null) element.textContent = text;
  return element;
}

function caption(x, y, text, attributes = {}) {
  return svg('text', { x, y, fill: '#25384a', 'font-size': 13,
    'text-anchor': 'middle', ...attributes }, text);
}

export function renderSvg(matrix) {
  const { width, height } = sizeOf(matrix);
  const { header, label, cycle, row: rowHeight } = layout;
  const root = svg('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height,
    'font-family': 'Arial, sans-serif' });
  root.append(svg('rect', { width, height, fill: '#fff' }),
    svg('rect', { width, height: header, fill: '#eaf0f5' }),
    svg('rect', { y: header, width: label, height: height - header, fill: '#f3f6f9' }),
    caption(label / 2, 21, '流水级 / 周期', { 'font-size': 12 }));

  // A repeated background keeps the number of grid elements independent of the cycle count.
  const defs = svg('defs', {});
  const pattern = svg('pattern', { id: 'pipeline-ticks', x: label, width: cycle,
    height: 8, patternUnits: 'userSpaceOnUse' });
  pattern.append(svg('path', { d: 'M .5 0 V 4', stroke: '#9baebb', fill: 'none' }));
  defs.append(pattern);
  root.append(defs, svg('rect', { x: label, width: width - label, height, fill: 'url(#pipeline-ticks)' }),
    svg('path', { d: 'M ' + (width - .5) + ' 0 V ' + height,
      fill: 'none', stroke: '#9baebb', 'stroke-dasharray': '4 4' }));
  const step = Math.max(1, Math.ceil(matrix.cycles / 512));
  for (let col = 0; col < matrix.cycles; col += step) {
    root.append(caption(label + (col + .5) * cycle, 21, col + 1));
  }
  matrix.rows.forEach((row, index) => {
    const y = header + index * rowHeight;
    root.append(svg('path', { d: 'M 0 ' + y + ' H ' + width, stroke: '#dae2e8' }),
      caption(label / 2, y + 26, row.title || '第 ' + (index + 1) + ' 级'));
    for (const block of visibleBlocks(row)) {
      const start = row.origin + block.start;
      const blockWidth = block.duration * cycle;
      const group = svg('g', { 'data-row': index, 'data-block-id': block.id,
        'data-name': block.name, 'data-start': start, 'data-duration': block.duration,
        transform: 'translate(' + (label + start * cycle) + ' ' + y + ')' });
      group.append(svg('title', {}, block.name), svg('rect', { width: blockWidth,
        height: rowHeight, fill: '#d9edf3', stroke: '#487b8c' }));
      const textArea = svg('svg', { x: 3, width: blockWidth - 6, height: rowHeight,
        overflow: 'hidden' });
      textArea.append(caption((blockWidth - 6) / 2, rowHeight / 2 + 5, block.name));
      group.append(textArea);
      root.append(group);
    }
  });
  return root;
}
