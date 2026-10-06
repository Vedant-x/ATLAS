import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildEmblem, EMBLEM_FOR_MODE } from '../js/emblems.js';

test('every page emblem builds, animates, tints and fits the same footprint', () => {
  const cases = [['balls'], ['digits', '2×'], ['digits', '7.5×'], ['digits', '1000×'], ['target'], ['coins'], ['bars'], ['trophy'], ['radar'], ['star'], ['scale'], ['duel', { pHome: 0.67, pAway: 0.33 }]];
  for (const [kind, value] of cases) {
    const g = buildEmblem(THREE, kind, value);
    g.userData.tick(2.5, 0.016);
    g.userData.tint(new THREE.Color('#ff0000'), new THREE.Color('#0000ff'));
    g.userData.setOpacity(0.5);
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    assert.ok(Math.max(size.x, size.y) > 2.5 && Math.max(size.x, size.y) < 5.5, `${kind} size ${size.x.toFixed(2)}×${size.y.toFixed(2)}`);
    g.userData.dispose();
  }
  assert.equal(EMBLEM_FOR_MODE.home, 'balls');
  assert.equal(EMBLEM_FOR_MODE.x, 'digits');
});

test('the multiplier emblem draws exactly the number asked for', () => {
  const chars = (v) => buildEmblem(THREE, 'digits', v).children[0].children[0].children.length;
  assert.equal(chars('2×'), 2);
  assert.equal(chars('7.5×'), 4);
  assert.equal(chars('1000×'), 5);
});
