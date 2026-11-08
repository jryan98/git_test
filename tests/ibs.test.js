const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../js/ibs.js');

const ids = (food, n) => I.detect(food, n).map(t => t.id).sort();

test('detects FODMAP categories from ingredients', () => {
  assert.deepEqual(ids({ name: 'Tomato soup', ingredients: 'Tomatoes, Onion, Garlic Purée, Cream (_Milk_), Salt' }), ['fructans', 'lactose']);
  assert.deepEqual(ids({ name: 'Sugar free mints', ingredients: 'Sweeteners: Sorbitol, E-951' }), ['polyols', 'sweeteners']);
  assert.deepEqual(ids({ name: 'Baked beans', ingredients: 'Haricot beans, tomatoes, glucose-fructose syrup' }), ['fructose', 'gos']);
});

test('avoids common false positives', () => {
  assert.deepEqual(ids({ name: 'Oat drink', ingredients: 'water, oat (10%), rapeseed oil' }), []);
  assert.deepEqual(ids({ name: 'Coconut milk', ingredients: 'coconut milk, water' }), []);
  assert.deepEqual(ids({ name: 'Lactose free milk', ingredients: 'lactose-free semi-skimmed milk, lactase enzyme' }), []);
  assert.deepEqual(ids({ name: 'Buckwheat noodles', ingredients: 'buckwheat flour, water' }), []);
  assert.deepEqual(ids({ name: 'Chocolate', ingredients: 'cocoa mass, cocoa butter, sugar' }), []);
  assert.deepEqual(ids({ name: 'Ginger biscuits', ingredients: 'ginger, oats' }), []);
  assert.deepEqual(ids({ name: 'Green beans', ingredients: '' }), []);
  assert.deepEqual(ids({ name: 'Garlic-infused olive oil', ingredients: 'olive oil, garlic-infused oil' }), []);
  assert.deepEqual(ids({ name: 'Pineapple chunks', ingredients: 'pineapple, juice' }), []);
  assert.deepEqual(ids({ name: 'Salad', ingredients: 'lettuce, red wine vinegar, sugar alcohols?' }).filter(x => x === 'alcohol'), []);
  assert.deepEqual(ids({ name: 'Ginger ale', ingredients: 'carbonated water, sugar, ginger' }), ['carbonation']);
  assert.deepEqual(ids({ name: 'Decaf coffee', ingredients: 'decaffeinated coffee' }), []);
});

test('high-fat flag uses portion nutrients', () => {
  assert.ok(ids({ name: 'Pizza' }, { fat: 30 }).includes('highfat'));
  assert.ok(!ids({ name: 'Pizza' }, { fat: 10 }).includes('highfat'));
});

test('custom triggers', () => {
  const cats = I.allCategories([{ id: 'p', name: 'Pork', keywords: ['pork', 'bacon'] }]);
  const t = I.detect({ name: 'Smoked bacon rashers', ingredients: 'pork, salt' }, null, cats);
  assert.ok(t.some(x => x.id === 'custom:p' && x.matches.includes('bacon')));
});

test('correlation analysis finds the culprit', () => {
  const entries = [], symptoms = [];
  for (let i = 1; i <= 20; i++) {
    const date = `2026-02-${String(i).padStart(2, '0')}`;
    const onion = i % 2 === 0;
    entries.push({ date, time: '19:00', meal: 'dinner', triggers: onion ? [{ id: 'fructans' }] : [] });
    entries.push({ date, time: '08:00', meal: 'breakfast', triggers: [{ id: 'caffeine' }] });
    if (onion) symptoms.push({ date, time: '22:00', severity: 7 });
  }
  const res = I.analyse(entries, symptoms, { now: new Date(2026, 3, 1).getTime(), windowHours: 6 });
  const fr = res.results.find(r => r.id === 'fructans');
  const caf = res.results.find(r => r.id === 'caffeine');
  assert.equal(fr.rateExposed, 1);
  assert.equal(fr.rateUnexposed, 0);
  assert.equal(fr.verdict, 'Likely trigger');
  assert.ok(caf.relativeRisk < fr.relativeRisk);
  assert.equal(res.results[0].id, 'fructans');
});

test('meals whose window has not elapsed are not scored', () => {
  const now = new Date(2026, 1, 1, 20, 0).getTime();
  const res = I.analyse([{ date: '2026-02-01', time: '19:00', meal: 'dinner', triggers: [] }], [], { now });
  assert.equal(res.occasions, 0);
});
