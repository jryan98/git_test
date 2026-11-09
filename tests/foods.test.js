const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/foods.js');

test('fromOFF reads per-100g nutrition, serving and whole-pack weight', () => {
  const f = F.fromOFF({ code: '1', product_name: 'Pizza', brands: 'A, B', serving_quantity: 200, product_quantity: 400, product_quantity_unit: 'g',
    nutriments: { energy_100g: 1004, proteins_100g: 10, sodium_100g: 0.4 } });
  assert.equal(f.per100.kcal, 240); // kJ converted
  assert.equal(f.per100.salt, 1);   // sodium × 2.5
  assert.equal(f.servingSize, 200);
  assert.equal(f.packSize, 400);
  assert.equal(f.brand, 'A');
  assert.equal(f.hasNutrition, true);
});

test('fromOFF ignores pack sizes in non-weight units and flags missing nutrition', () => {
  const f = F.fromOFF({ code: '2', product_name: 'Eggs', product_quantity: 6, product_quantity_unit: 'pieces', nutriments: {} });
  assert.equal(f.packSize, 0);
  assert.equal(f.hasNutrition, false);
});

test('home-cooked dishes carry whole weight and slice count', () => {
  const pizza = F.GENERIC.find(g => g.name.startsWith('Margherita'));
  assert.equal(pizza.packSize, 560);
  assert.equal(pizza.pieces, 8);
  assert.ok(F.searchLocal('pizza', F.GENERIC).length >= 2);
});

test('built-in food ids are stable and unique', () => {
  const ids = F.GENERIC.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(F.GENERIC.find(g => g.name === 'Lager').id, 'gen:lager');
});

test('top-up ideas all exist and none trip the IBS trigger detector', () => {
  const I = require('../js/ibs.js');
  assert.ok(F.BOOSTERS.length >= 12);
  for (const b of F.BOOSTERS) {
    const n = { fat: b.food.per100.fat * b.amount / 100 };
    const t = I.detect(b.food, n).filter(x => x.id !== 'highfat');
    assert.deepEqual(t.map(x => x.id), [], b.food.name);
  }
});
