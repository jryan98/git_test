/*
 * units.js — measuring food: weights, kitchen volumes and a food's own serving sizes.
 * A food's nutrition is stored per 100 of its base unit: grams (solids) or millilitres (drinks).
 * Pure functions; works in the browser (window.Units) and Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Units = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEIGHT = {
    g: { f: 1, label: 'g', name: 'grams' },
    kg: { f: 1000, label: 'kg', name: 'kilograms' },
    oz: { f: 28.3495, label: 'oz', name: 'ounces' },
    lb: { f: 453.592, label: 'lb', name: 'pounds' },
  };
  // UK measures: metric cup 250 ml, imperial fl oz and pint.
  const VOLUME = {
    ml: { f: 1, label: 'ml', name: 'millilitres' },
    l: { f: 1000, label: 'litre', name: 'litres' },
    tsp: { f: 5, label: 'tsp', name: 'teaspoons (5 ml)' },
    tbsp: { f: 15, label: 'tbsp', name: 'tablespoons (15 ml)' },
    cup: { f: 250, label: 'cup', name: 'cups (250 ml)' },
    floz: { f: 28.4131, label: 'fl oz', name: 'fluid ounces' },
    pint: { f: 568.261, label: 'pint', name: 'pints (568 ml)' },
  };
  const VOLUME_WORDS = [
    [/^(tsp|teaspoons?)$/, 'tsp'], [/^(tbsp|tablespoons?)$/, 'tbsp'], [/^cups?$/, 'cup'],
    [/^(ml|millilitres?|milliliters?)$/, 'ml'], [/^(l|litres?|liters?)$/, 'l'], [/^fl ?oz$/, 'floz'], [/^pints?$/, 'pint'],
  ];

  function base(food) { return food && food.unit === 'ml' ? 'ml' : 'g'; }

  /** A food's own serving sizes as [{label, amount}] where amount is in the base unit. */
  function servings(food) {
    if (!food) return [];
    if (Array.isArray(food.servings)) return food.servings.filter(s => s && s.label && s.amount > 0);
    // older foods have a single servingSize / servingLabel
    if (food.servingSize > 0 && (food.servingLabel || food.servingSize !== 100)) {
      return [{ label: food.servingLabel || 'serving', amount: food.servingSize }];
    }
    return [];
  }

  /** If a serving label is a kitchen measure ("1 cup", "2 tbsp"), its volume in ml. */
  function volumeOfLabel(label) {
    const m = String(label || '').toLowerCase().trim().match(/^(\d+(?:[.,]\d+)?)?\s*([a-z ]+?)\.?$/);
    if (!m) return null;
    const word = VOLUME_WORDS.find(([re]) => re.test(m[2].trim()));
    if (!word) return null;
    return (m[1] ? parseFloat(m[1].replace(',', '.')) : 1) * VOLUME[word[1]].f;
  }

  /**
   * Grams per millilitre, for converting between weight and volume.
   * Known from the food itself, or from a serving like "1 cup = 120 g"; otherwise assumed 1 (like water).
   */
  function density(food) {
    if (food && food.density > 0) return { value: food.density, assumed: false };
    if (base(food) === 'g') {
      for (const s of servings(food)) {
        const ml = volumeOfLabel(s.label);
        if (ml) return { value: s.amount / ml, assumed: false };
      }
    }
    return { value: 1, assumed: true };
  }

  /** Normalise older unit codes ('g', 'serving') to the current ones. */
  function normaliseUnit(unit, food) {
    if (!unit || unit === 'g') return base(food) === 'ml' ? 'v:ml' : 'w:g';
    if (unit === 'serving') return 'serving:0';
    return unit;
  }

  /** Amount in the food's base unit (g or ml) for `qty` of `unit`. */
  function toBase(qty, unit, food) {
    qty = Number(qty) || 0;
    unit = normaliseUnit(unit, food);
    const [kind, key] = unit.split(':');
    if (kind === 'serving') { const s = servings(food)[+key]; return s ? qty * s.amount : 0; }
    if (kind === 'w' && WEIGHT[key]) {
      const grams = qty * WEIGHT[key].f;
      return base(food) === 'g' ? grams : grams / density(food).value;
    }
    if (kind === 'v' && VOLUME[key]) {
      const ml = qty * VOLUME[key].f;
      return base(food) === 'ml' ? ml : ml * density(food).value;
    }
    return 0;
  }

  /** Whether this unit needs a weight↔volume conversion that is only an assumption. */
  function isAssumed(unit, food) {
    unit = normaliseUnit(unit, food);
    const crosses = (unit.startsWith('v:') && base(food) === 'g') || (unit.startsWith('w:') && base(food) === 'ml');
    return crosses && density(food).assumed;
  }

  function fmtNum(n) { return String(Math.round(n * 100) / 100); }

  /** Human text such as "2 tbsp", "1 × slice", "250 ml". */
  function describe(qty, unit, food) {
    unit = normaliseUnit(unit, food);
    const [kind, key] = unit.split(':');
    const q = fmtNum(Number(qty) || 0);
    if (kind === 'serving') {
      const s = servings(food)[+key];
      if (!s) return q + ' servings';
      if (Number(qty) === 1) return /^\d/.test(s.label) ? s.label : '1 ' + s.label;
      return q + ' × ' + s.label.replace(/^1\s+(?=[a-z])/i, ''); // "2 × clove", not "2 × 1 clove"
    }
    const u = kind === 'w' ? WEIGHT[key] : VOLUME[key];
    if (!u) return q;
    const plural = Number(qty) !== 1 && (key === 'cup' || key === 'pint' || key === 'l') ? 's' : '';
    return q + ' ' + u.label + plural;
  }

  return { WEIGHT, VOLUME, base, servings, volumeOfLabel, density, normaliseUnit, toBase, isAssumed, describe };
});
