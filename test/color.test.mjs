import test from 'node:test';
import assert from 'node:assert/strict';
import { readable, luminance, MIN_LUMINANCE } from '../js/color.js';

test('feed colours are never too dark to read on the dark page', () => {
  assert.equal(readable('#000000', '#d2ff00'), '#d2ff00', 'black has no colour to keep: the fallback');
  assert.equal(readable('#1a1a1a', '#4fd1ff'), '#4fd1ff', 'near-black grey: the fallback');
  const navy = readable('#0b1f4a');
  assert.ok(luminance(navy) >= MIN_LUMINANCE, `dark navy is lightened (${navy})`);
  assert.ok(/^#[0-9a-f]{6}$/.test(navy) && navy !== '#0b1f4a');
  assert.equal(readable('#ff3d6e'), '#ff3d6e', 'bright colours stay as they are');
  assert.equal(readable('#D2FF00'), '#d2ff00');
  assert.equal(readable('not a colour', '#abcdef'), '#abcdef');
  for (const c of ['#00205b', '#7a0019', '#003300', '#2d0f4d', '#000080']) assert.ok(luminance(readable(c)) >= MIN_LUMINANCE, c);
});
