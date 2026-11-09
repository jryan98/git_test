const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/units.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test('weights and volumes convert to the food base unit', () => {
  const solid = { unit: 'g' }, drink = { unit: 'ml' };
  near(U.toBase(2, 'w:oz', solid), 56.7);
  near(U.toBase(1, 'w:kg', solid), 1000);
  near(U.toBase(1, 'v:pint', drink), 568.26);
  near(U.toBase(2, 'v:tbsp', drink), 30);
  near(U.toBase(0.5, 'v:cup', drink), 125);
});

test('own serving sizes, including older single-serving foods', () => {
  const f = { unit: 'g', servings: [{ label: 'slice', amount: 36 }, { label: 'loaf', amount: 800 }] };
  assert.equal(U.toBase(3, 'serving:0', f), 108);
  assert.equal(U.toBase(1, 'serving:1', f), 800);
  const old = { servingSize: 118, servingLabel: '1 medium' };
  assert.equal(U.toBase(2, 'serving', old), 236); // legacy unit code
  assert.deepEqual(U.servings({ servingSize: 100 }), []); // plain 100 g isn't a real serving
});

test('volume of a solid uses a known cup/tbsp serving, else assumes water', () => {
  const honey = { unit: 'g', servings: [{ label: '1 tbsp', amount: 21 }] };
  near(U.toBase(1, 'v:tsp', honey), 7); // 21 g per 15 ml → 1.4 g/ml × 5 ml
  assert.equal(U.isAssumed('v:tsp', honey), false);
  const flour = { unit: 'g' };
  assert.equal(U.toBase(1, 'v:cup', flour), 250);
  assert.equal(U.isAssumed('v:cup', flour), true);
  assert.equal(U.isAssumed('w:g', flour), false);
});

test('labels recognise kitchen measures', () => {
  assert.equal(U.volumeOfLabel('2 cups'), 500);
  assert.equal(U.volumeOfLabel('tbsp'), 15);
  assert.equal(U.volumeOfLabel('1 Tablespoon'), 15);
  assert.equal(U.volumeOfLabel('slice'), null);
});

test('describe gives readable amounts', () => {
  const f = { unit: 'g', servings: [{ label: 'slice', amount: 36 }] };
  assert.equal(U.describe(2, 'v:tbsp', f), '2 tbsp');
  assert.equal(U.describe(2, 'v:cup', f), '2 cups');
  assert.equal(U.describe(1.5, 'serving:0', f), '1.5 × slice');
  assert.equal(U.describe(1, 'serving:0', f), '1 slice');
  assert.equal(U.describe(2, 'serving:0', { servings: [{ label: '1 clove', amount: 3 }] }), '2 × clove');
  assert.equal(U.describe(2, 'serving:0', { servings: [{ label: '1 bottle (330 ml)', amount: 330 }] }), '2 × bottle (330 ml)');
  assert.equal(U.describe(1, 'serving:0', { servings: [{ label: '1 pint', amount: 568 }] }), '1 pint');
  assert.equal(U.describe(100, 'g', f), '100 g');
});
