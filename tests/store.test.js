const test = require('node:test');
const assert = require('node:assert/strict');

// minimal localStorage for store.js
const mem = {};
global.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
global.alert = () => {};
global.self = global;
require('../js/store.js');
const S = global.Store;

test('importing a damaged backup cleans it instead of breaking the app', () => {
  S.importJSON(JSON.stringify({
    log: [{ date: '2026-01-01', grams: 100, food: { name: 'ok' } }, { nope: 1 }, null],
    weights: null, symptoms: [{ date: 'bad' }, { date: '2026-01-02', types: 'x' }], foods: null, profile: null, triggers: { custom: 'x' },
  }));
  const d = S.data;
  assert.equal(d.log.length, 1);
  assert.deepEqual(d.weights, []);
  assert.equal(d.symptoms.length, 1);
  assert.deepEqual(d.symptoms[0].types, []);
  assert.deepEqual(d.foods, {});
  assert.equal(d.profile.unit, 'kg');
  assert.deepEqual(d.triggers.custom, []);
});

test('importing a non-backup file is refused and keeps existing data', () => {
  const before = S.exportJSON();
  assert.throws(() => S.importJSON('not json'), /isn't a GutFuel backup/);
  assert.throws(() => S.importJSON('{"hello":1}'), /isn't a GutFuel backup/);
  assert.equal(S.exportJSON(), before);
});
