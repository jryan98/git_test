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

// ---- online sources, with a simulated network ----
const withFetch = async (handler, fn) => {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return handler(String(url)); };
  try { return await fn(calls); } finally { global.fetch = real; }
};
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const offProduct = { code: '5000', product_name: 'Greek yoghurt', brands: 'Fage', nutriments: { 'energy-kcal_100g': 97, proteins_100g: 9 } };

test('Open Food Facts: uses the fast search service, with the country as a filter', () => withFetch(
  url => json({ hits: [offProduct], count: 1, page_count: 1 }),
  async calls => {
    const r = await F.searchOFF('greek yoghurt', { country: 'uk' });
    assert.equal(r.via, 'search');
    assert.equal(r.foods[0].name, 'Greek yoghurt');
    assert.ok(calls[0].startsWith('https://search.openfoodfacts.org/search?q='));
    assert.ok(decodeURIComponent(calls[0]).includes('countries_tags:"en:united-kingdom"'));
  }));

test('Open Food Facts: falls back to the classic search when the fast one fails', () => withFetch(
  url => url.includes('search.openfoodfacts.org') ? json({}, 503) : json({ products: [offProduct], count: 1 }),
  async calls => {
    const r = await F.searchOFF('greek yoghurt', { country: 'world' });
    assert.equal(r.via, 'classic');
    assert.equal(r.foods.length, 1);
    assert.ok(calls.some(c => c.includes('/cgi/search.pl')));
  }));

test('USDA: converts nutrients per 100 g, UK-style carbs and household measures', () => {
  const f = F.fromUSDA({
    fdcId: 171688, description: 'Apples, raw, with skin', dataType: 'SR Legacy',
    foodNutrients: [
      { nutrientNumber: '208', value: 52 }, { nutrientNumber: '203', value: 0.26 }, { nutrientNumber: '204', value: 0.17 },
      { nutrientNumber: '205', value: 13.8 }, { nutrientNumber: '291', value: 2.4 }, { nutrientNumber: '269', value: 10.4 },
      { nutrientNumber: '307', value: 1 },
    ],
    foodMeasures: [{ disseminationText: '1 medium (3" dia)', gramWeight: 182 }, { disseminationText: 'Quantity not specified', gramWeight: 182 }],
  });
  assert.equal(f.id, 'usda:171688');
  assert.equal(f.per100.kcal, 52);
  assert.equal(f.per100.carbs, 11.4);          // 13.8 by difference − 2.4 fibre
  assert.equal(f.per100.salt, 0);              // 1 mg sodium → 0.0025 g salt
  assert.deepEqual(f.servings, [{ label: '1 medium (3" dia)', amount: 182 }]);
  const I = require('../js/ibs.js');
  assert.ok(I.detect(f).some(t => t.id === 'fructose')); // "apple" in the name still drives trigger checks
});

test('USDA: energy from Atwater values when 208 is missing; uppercase names tidied', () => {
  const f = F.fromUSDA({ fdcId: 1, description: 'CHICKEN BREAST, ROASTED', foodNutrients: [{ nutrientNumber: '958', value: 165 }, { nutrientNumber: '203', value: 31 }] });
  assert.equal(f.per100.kcal, 165);
  assert.equal(f.name, 'Chicken breast, roasted');
});

test('USDA: clear messages for the shared-key limit and bad keys', () => withFetch(
  url => json({}, url.includes('DEMO_KEY') ? 429 : 403),
  async () => {
    await assert.rejects(F.searchUSDA('rice'), /Add your own free key/);
    await assert.rejects(F.searchUSDA('rice', { apiKey: 'bad' }), /rejected the API key/);
  }));
