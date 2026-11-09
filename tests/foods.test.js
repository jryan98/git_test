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
  global.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push(String(url) + (body ? ' ' + JSON.stringify(body) : ''));
    return handler(String(url), body, init || {});
  };
  try { return await fn(calls); } finally { global.fetch = real; }
};
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const offProduct = { code: '5000', product_name: 'Greek yoghurt', brands: 'Fage', nutriments: { 'energy-kcal_100g': 97, proteins_100g: 9 } };

const offline = () => { throw new TypeError('Failed to fetch'); };   // what a CORS-less 503 looks like to a browser

test('Open Food Facts: never calls the browser-blocked search service; classic search with the region', () => withFetch(
  url => json({ products: [offProduct], count: 1 }),
  async calls => {
    const r = await F.searchOFF('greek yoghurt', { country: 'uk' });
    assert.equal(r.via, 'search');
    assert.equal(r.foods[0].name, 'Greek yoghurt');
    assert.ok(calls.every(c => !c.includes('search.openfoodfacts.org')));
    assert.ok(calls[0].startsWith('https://uk.openfoodfacts.org/cgi/search.pl'));
  }));

test('Open Food Facts: retries "can\'t connect" failures (overloaded server) before giving up', () => withFetch(
  (() => { let n = 0; return url => (++n < 3 ? offline() : json({ products: [offProduct], count: 1 })); })(),
  async calls => {
    const r = await F.searchOFF('weetabix', { country: 'world' });
    assert.equal(r.foods.length, 1);
    assert.equal(calls.length, 3);
  }));

test('Open Food Facts: falls back to the brand page when search keeps failing', () => withFetch(
  url => url.includes('/cgi/search.pl') ? offline()
    : url.includes('/brand/weetabix.json') ? json({ count: 2, products: [{ code: '1', product_name: 'Weetabix Original', nutriments: { 'energy-kcal_100g': 362 } },
      { code: '2', product_name: 'Weetabix Protein', nutriments: { 'energy-kcal_100g': 370 } }] }) : json({}, 404),
  async calls => {
    const r = await F.searchOFF('weetabix original', { country: 'world' });
    assert.equal(r.via, 'brand');
    assert.deepEqual(r.foods.map(f => f.name), ['Weetabix Original']); // narrowed by the other words
    assert.equal(calls.filter(c => c.includes('/cgi/search.pl')).length, 3);
  }));

test('Open Food Facts: a clear message when nothing works', () => withFetch(offline, async () => {
  await assert.rejects(F.searchOFF('weetabix', { country: 'world' }), /isn't responding right now[\s\S]*Barcode/);
}));

test('USDA: brand names with no generic match also search US branded products', () => withFetch(
  (url, body) => body && body.dataType.includes('Branded') ? json({ totalPages: 1, foods: [{ fdcId: 9, dataType: 'Branded', description: 'WEETABIX, ORIGINAL',
    brandName: 'WEETABIX', ingredients: 'WHOLE GRAIN WHEAT, MALTED BARLEY EXTRACT, SUGAR, SALT', servingSize: 37.5, servingSizeUnit: 'g',
    householdServingFullText: '2 biscuits', foodNutrients: [{ nutrientNumber: '208', value: 362 }, { nutrientNumber: '203', value: 12 }] }] })
    : json({ totalPages: 0, foods: [] }),
  async () => {
    const r = await F.searchUSDA('weetabix');
    assert.equal(r.foods.length, 1);
    const f = r.foods[0];
    assert.equal(f.name, 'Weetabix, original');
    assert.equal(f.brand, 'Weetabix (US)');
    assert.deepEqual(f.servings[0], { label: '2 biscuits', amount: 37.5 });
    const I = require('../js/ibs.js');
    assert.ok(I.detect(f).some(t => t.id === 'fructans'));   // wheat from the ingredient list
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

test('USDA: searches with the documented POST + dataType array', () => withFetch(
  (url, body, init) => json({ totalPages: 1, foods: [{ fdcId: 1, dataType: 'SR Legacy', description: 'Oats', foodNutrients: [{ nutrientNumber: '208', value: 379 }] },
    { fdcId: 2, dataType: 'SR Legacy', description: 'Oat bran', foodNutrients: [{ nutrientNumber: '208', value: 246 }] },
    { fdcId: 3, dataType: 'Foundation', description: 'Oats, whole grain', foodNutrients: [{ nutrientNumber: '208', value: 380 }] }] }),
  async calls => {
    const r = await F.searchUSDA('oats', { apiKey: 'K1' });
    assert.equal(r.foods.length, 3);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://api.nal.usda.gov/fdc/v1/foods/search?api_key=K1 '));
    assert.ok(calls[0].includes('"dataType":["Foundation","SR Legacy","Survey (FNDDS)"]'));
    assert.ok(!calls[0].includes('dataType=')); // never in the URL — that form gives 400s
  }));

test('USDA: if the POST is rejected (400), a plain unfiltered search is sorted here', () => withFetch(
  (url, body) => body ? json({}, 400) : json({ totalPages: 1, foods: [
    { fdcId: 1, dataType: 'Branded', description: 'WEETABIX', brandName: 'WEETABIX', foodNutrients: [{ nutrientNumber: '208', value: 359 }] },
    { fdcId: 2, dataType: 'SR Legacy', description: 'Cereals, whole wheat biscuits', foodNutrients: [{ nutrientNumber: '208', value: 352 }] }] }),
  async calls => {
    const r = await F.searchUSDA('weetabix');
    assert.deepEqual(r.foods.map(f => f.brand), ['USDA', 'Weetabix (US)']); // generic first, branded after
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes('&query=weetabix') && !calls[1].includes('dataType'));
  }));

test('ingredients come from wherever Open Food Facts has them', () => {
  const I = require('../js/ibs.js');
  const ing = p => F.fromOFF(Object.assign({ code: '1', product_name: 'X', nutriments: { 'energy-kcal_100g': 100 } }, p)).ingredients;
  // English text first
  assert.equal(ing({ ingredients_text_en: 'Wholegrain wheat, sugar', ingredients_text: 'Blé complet' , lang: 'fr' }), 'Wholegrain wheat, sugar');
  // formatted text (allergen markup) is cleaned
  assert.equal(ing({ ingredients_text_with_allergens_en: 'Oats, <span class="allergen">milk</span> powder' }), 'Oats, milk powder');
  // only taxonomy tags (e.g. an imported product) → English names
  const tagged = ing({ lang: 'de', ingredients_text: 'Weizen, Zwiebeln', ingredients_tags: ['en:wheat', 'en:onion', 'de:gewurz'] });
  assert.equal(tagged, 'wheat, onion');
  assert.deepEqual(I.detect({ name: 'X', ingredients: tagged }).map(t => t.id), ['fructans']);
  // structured list only
  assert.equal(ing({ ingredients: [{ text: 'rice' }, { text: 'garlic' }] }), 'rice, garlic');
  // allergens not mentioned in the text are added so lactose etc. are still caught
  const withAllergen = ing({ ingredients_text_en: 'Cocoa, sugar, emulsifier', allergens_tags: ['en:milk', 'en:soybeans'] });
  assert.equal(withAllergen, 'Cocoa, sugar, emulsifier. Contains: milk, soya');
  assert.ok(!I.detect({ name: 'Bar', ingredients: withAllergen }).some(t => t.id === 'gos'));
  assert.ok(I.detect({ name: 'Bar', ingredients: withAllergen }).some(t => t.id === 'lactose'));
  assert.equal(ing({ ingredients_text_en: 'Wheat flour, milk', allergens_tags: ['en:milk', 'en:gluten'] }), 'Wheat flour, milk. Contains: gluten');
  // nothing anywhere
  assert.equal(ing({}), '');
});
