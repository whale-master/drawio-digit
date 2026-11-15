import JSON5 from 'json5';
import renderSignal from '../../vendor/wavedrom/lib/render-signal.js';
import standard from '../../vendor/wavedrom/skins/default.js';
import narrow from '../../vendor/wavedrom/skins/narrow.js';
import lowkey from '../../vendor/wavedrom/skins/lowkey.js';
import dark from '../../vendor/wavedrom/skins/dark.js';
import narrower from '../../vendor/wavedrom/skins/narrower.js';
import narrowerer from '../../vendor/wavedrom/skins/narrowerer.js';

// Render off the UI thread. Each preview gets its own skin/diagram state,
// including all SVG definitions needed by a standalone image.
self.onmessage = ({ data: source }) => {
  try {
    const diagram = JSON5.parse(source, (key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('数值必须是有限数。');
      }
      return value;
    });
    if (!Array.isArray(diagram?.signal) || !diagram.signal.length) {
      throw new Error('signal 必须是包含信号的数组。');
    }
    const skins = { ...standard, ...narrow, ...lowkey, ...dark, ...narrower, ...narrowerer };
    const svg = renderSignal(0, diagram, skins, false);
    if (!(svg[1].height > 0 && svg[1].width > 0)) {
      throw new Error('未生成有效的波形，请检查信号行。');
    }
    self.postMessage({ svg });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
