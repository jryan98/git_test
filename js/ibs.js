/*
 * ibs.js — IBS trigger detection from ingredients/nutrients, and
 * symptom ↔ trigger correlation analysis.
 *
 * Detection is a keyword heuristic based on common FODMAP & non-FODMAP
 * IBS triggers. It cannot know portion-dependent FODMAP thresholds
 * (e.g. a little garlic powder vs a whole bulb), so treat flags as
 * "worth watching", not a diagnosis.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IBS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Each category: keywords (whole-word, optional plural s/es),
   * excludes (phrases removed from the text before matching that category) and
   * skipIf (a product-level claim such as "lactose-free" that rules the category out).
   */
  const CATEGORIES = [
    {
      id: 'fructans', name: 'Fructans', group: 'FODMAP',
      info: 'Wheat, rye, barley, onion, garlic, inulin. One of the most common IBS triggers.',
      keywords: ['wheat', 'wheat flour', 'rye', 'barley', 'spelt', 'durum', 'semolina', 'couscous', 'bulgur',
        // recipes rarely say "wheat": plain flour, pasta, noodles and bread are wheat unless stated otherwise
        'flour', 'plain flour', 'self-raising flour', 'self raising flour', 'bread flour', 'pasta', 'spaghetti', 'penne', 'macaroni',
        'lasagne', 'lasagna', 'tagliatelle', 'linguine', 'fusilli', 'noodles', 'bread', 'breadcrumbs', 'pitta', 'pita', 'naan', 'tortilla',
        'baguette', 'ciabatta', 'puff pastry', 'shortcrust pastry', 'pastry',
        'onion', 'onion powder', 'garlic', 'garlic powder', 'shallot', 'leek', 'spring onion', 'scallion',
        'inulin', 'chicory', 'chicory root', 'fructooligosaccharide', 'fructo-oligosaccharide', 'oligofructose', 'fos',
        'artichoke', 'pistachio', 'cashew', 'date', 'beetroot'],
      excludes: ['garlic[- ]infused oil', 'onion[- ]infused oil', 'garlic[- ]infused', 'wheat[- ]free',
        'gluten[- ]free( [a-z]+)?', 'best before date', 'use by date', 'date of',
        // flours, noodles and breads that aren't wheat
        '(rice|corn|gram|chickpea|buckwheat|coconut|almond|oat|potato|tapioca|maize|soya|soy|teff|sorghum|millet|quinoa|banana) ?(flour|noodles|pasta|bread|tortillas?|wraps?)',
        'cornflour', 'glass noodles', 'konjac noodles', 'shirataki noodles', 'mung bean noodles', 'soba noodles', 'rice paper',
        'corn tortillas?',
        'barley malt( extract)?', 'malted barley', 'malt extract \\(barley\\)'], // beer & malt extract test low-FODMAP
    },
    {
      id: 'gos', name: 'GOS (pulses)', group: 'FODMAP',
      info: 'Galacto-oligosaccharides: beans, lentils, chickpeas, some soy products.',
      keywords: ['bean', 'kidney bean', 'baked bean', 'black bean', 'haricot', 'borlotti', 'butter bean', 'broad bean',
        'pinto bean', 'cannellini', 'chickpea', 'gram flour', 'hummus', 'houmous', 'falafel', 'lentil', 'dhal', 'dal',
        'split pea', 'soybean', 'soya bean', 'soy bean', 'soya flour', 'soy flour', 'soy milk', 'soya milk', 'pulse',
        'legume', 'galactooligosaccharide', 'galacto-oligosaccharide'],
      excludes: ['green beans?', 'coffee beans?', 'cocoa beans?', 'vanilla beans?', 'jelly beans?', 'runner beans?',
        'french beans?', 'string beans?', 'mung bean sprouts?', 'bean sprouts?'],
    },
    {
      id: 'lactose', name: 'Lactose', group: 'FODMAP',
      info: 'Milk, cream, soft cheese, yoghurt, ice cream, whey. Hard cheese & butter are naturally low.',
      keywords: ['milk', 'lactose', 'cream', 'whey', 'buttermilk', 'milk powder', 'milk solids', 'skimmed milk',
        'condensed milk', 'evaporated milk', 'yogurt', 'yoghurt', 'ice cream', 'custard', 'ricotta', 'cottage cheese',
        'cream cheese', 'mascarpone', 'quark', 'kefir', 'paneer', 'fromage frais', 'creme fraiche'],
      skipIf: '(lactose|dairy|milk)[- ]free|vegan',
      excludes: ['lactose[- ]free', 'dairy[- ]free', '(coconut|almond|oat|soy|soya|rice|cashew|hazelnut|hemp|pea|macadamia) ?(milk|cream|drink|yogh?urt)s?',
        'cream of tartar', 'creamed coconut', 'cocoa butter', 'whey (protein )?isolate', 'milk thistle', 'free from milk',
        'may contain milk', 'may contain traces of milk', 'made in a factory that handles milk', 'salad cream',
        'cream crackers?', 'cream soda', 'sun ?cream'],
    },
    {
      id: 'fructose', name: 'Excess fructose', group: 'FODMAP',
      info: 'Honey, apples, pears, mango, high-fructose syrups, agave.',
      keywords: ['honey', 'fructose', 'high fructose corn syrup', 'hfcs', 'glucose-fructose syrup', 'fructose-glucose syrup',
        'glucose fructose syrup', 'agave', 'apple', 'apple juice', 'pear', 'mango', 'watermelon', 'fig', 'asparagus',
        'sugar snap pea', 'fruit juice concentrate', 'apple juice concentrate'],
      excludes: ['apple cider vinegar', 'cider vinegar', 'pineapple', 'prickly pear', 'honeydew', 'honey melon'],
    },
    {
      id: 'polyols', name: 'Polyols', group: 'FODMAP',
      info: 'Sugar alcohols (sorbitol, mannitol, xylitol…) plus mushrooms, cauliflower, stone fruit, avocado.',
      keywords: ['sorbitol', 'mannitol', 'xylitol', 'maltitol', 'isomalt', 'lactitol', 'erythritol', 'polyol',
        'sugar alcohol', 'e420', 'e421', 'e953', 'e965', 'e966', 'e967', 'e968', 'mushroom', 'cauliflower',
        'apricot', 'cherry', 'cherries', 'plum', 'prune', 'peach', 'peaches', 'nectarine', 'avocado', 'blackberry',
        'blackberries', 'lychee'],
      excludes: ['cherry tomato(es)?', 'plum tomato(es)?', 'avocado oil', 'cherry flavou?r(ing)?'],
    },
    {
      id: 'caffeine', name: 'Caffeine', group: 'Other',
      info: 'Stimulates gut motility — a common trigger for IBS-D.',
      keywords: ['coffee', 'caffeine', 'espresso', 'latte', 'cappuccino', 'americano', 'guarana', 'cola', 'matcha',
        'energy drink', 'mate'],
      skipIf: 'decaf(feinated)?|caffeine[- ]free',
      excludes: [],
    },
    {
      id: 'alcohol', name: 'Alcohol', group: 'Other',
      info: 'Irritates the gut lining and alters motility.',
      keywords: ['alcohol', 'beer', 'lager', 'ale', 'stout', 'wine', 'cider', 'vodka', 'gin', 'rum', 'whisky', 'whiskey',
        'brandy', 'tequila', 'prosecco', 'champagne', 'liqueur', 'spirit', 'sake', 'cocktail'],
      skipIf: 'alcohol[- ]free|non[- ]alcoholic|0\\.0 ?%',
      excludes: ['sugar alcohols?', 'alcohol[- ]free', 'non[- ]alcoholic', '0\\.0%?', '(wine|cider|spirit|malt) vinegar',
        'ginger ale', 'ginger beer', 'root beer', 'rum flavou?r(ing)?', 'cooking wine'],
    },
    {
      id: 'spicy', name: 'Chilli / capsaicin', group: 'Other',
      info: 'Capsaicin can trigger pain and urgency in sensitive guts.',
      keywords: ['chilli', 'chili', 'chile', 'cayenne', 'jalapeno', 'habanero', 'scotch bonnet', 'chipotle', 'sriracha',
        'tabasco', 'hot sauce', 'capsaicin', 'peri peri', 'piri piri', 'harissa', 'gochujang', 'hot pepper',
        'red pepper flakes', 'chilli flakes', 'chili flakes', 'buffalo sauce', 'vindaloo', 'madras'],
      excludes: ['chile (con carne )?mild'],
    },
    {
      id: 'sweeteners', name: 'Artificial sweeteners', group: 'Other',
      info: 'Non-polyol sweeteners; some people with IBS react to them.',
      keywords: ['sucralose', 'aspartame', 'acesulfame', 'acesulfame k', 'acesulfame potassium', 'saccharin', 'cyclamate',
        'e950', 'e951', 'e952', 'e954', 'e955'],
      excludes: [],
    },
    {
      id: 'additives', name: 'Gums & emulsifiers', group: 'Other',
      info: 'Lower-evidence: carrageenan, polysorbate 80, CMC and some gums bother some people.',
      keywords: ['carrageenan', 'e407', 'polysorbate', 'polysorbate 80', 'e433', 'carboxymethylcellulose',
        'carboxymethyl cellulose', 'cellulose gum', 'e466', 'guar gum', 'e412'],
      excludes: [],
    },
    {
      id: 'carbonation', name: 'Fizzy drinks', group: 'Other',
      info: 'Carbonation adds gas and can worsen bloating.',
      keywords: ['carbonated', 'carbonated water', 'sparkling', 'carbon dioxide', 'soda water', 'e290'],
      excludes: [],
    },
    {
      id: 'highfat', name: 'High-fat meal', group: 'Other', nutrientBased: true,
      info: 'Large fat loads (≥20 g in one item) strengthen the gastrocolic reflex.',
      keywords: [], excludes: [],
    },
  ];

  const HIGH_FAT_GRAMS = 20;

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/_/g, ' ')                 // Open Food Facts marks allergens like _milk_
      .replace(/\be[\s-]+(\d{3})\b/g, 'e$1') // "E 420" / "E-420" → "e420"
      .replace(/\s+/g, ' ');
  }

  const compiled = new Map();
  function compile(cat) {
    const key = cat.keywords.join('|') + '#' + cat.excludes.join('|') + '#' + (cat.skipIf || '');
    if (compiled.has(key)) return compiled.get(key);
    const kws = cat.keywords.slice().sort((a, b) => b.length - a.length).map(k => escapeRegex(normalise(k)));
    const c = {
      re: kws.length ? new RegExp('(?<![a-z0-9])(' + kws.join('|') + ')(?:s|es)?(?![a-z0-9])', 'g') : null,
      ex: cat.excludes.length ? new RegExp('(?<![a-z0-9])(?:' + cat.excludes.join('|') + ')(?![a-z0-9])', 'g') : null,
      skip: cat.skipIf ? new RegExp('(?<![a-z0-9])(?:' + cat.skipIf + ')(?![a-z0-9])') : null,
    };
    compiled.set(key, c);
    return c;
  }

  /** Build the active category list: built-ins plus user-defined custom triggers. */
  function allCategories(customTriggers) {
    const custom = (customTriggers || []).filter(t => t && t.name && t.keywords && t.keywords.length).map(t => ({
      id: 'custom:' + t.id, name: t.name, group: 'Personal', info: 'Your own trigger list.',
      keywords: t.keywords.map(k => k.trim()).filter(Boolean), excludes: [],
    }));
    return CATEGORIES.concat(custom);
  }

  /**
   * Detect triggers in a food.
   * food: { name, ingredients }, nutrients (for this portion, optional): { fat }
   * Returns [{ id, name, group, matches: [string] }]
   */
  function detect(food, nutrients, categories) {
    categories = categories || CATEGORIES;
    const text = ' ' + normalise((food.name || '') + ' . ' + (food.ingredients || '')) + ' ';
    const out = [];
    for (const cat of categories) {
      if (cat.nutrientBased) {
        if (cat.id === 'highfat' && nutrients && nutrients.fat >= HIGH_FAT_GRAMS) {
          out.push({ id: cat.id, name: cat.name, group: cat.group, matches: [Math.round(nutrients.fat) + ' g fat'] });
        }
        continue;
      }
      const c = compile(cat);
      if (!c.re || (c.skip && c.skip.test(text))) continue;
      const t = c.ex ? text.replace(c.ex, ' ') : text;
      const found = new Set();
      let m;
      c.re.lastIndex = 0;
      while ((m = c.re.exec(t)) !== null) found.add(m[1]);
      if (found.size) out.push({ id: cat.id, name: cat.name, group: cat.group, matches: Array.from(found) });
    }
    return out;
  }

  // ---------- correlation ----------
  const MEAL_DEFAULT_TIME = { breakfast: '08:00', morning: '10:30', lunch: '13:00', snacks: '16:00', dinner: '19:00', supper: '21:30' };

  function toTs(date, time) {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = (time || '12:00').split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi).getTime();
  }

  /**
   * Group diary entries into eating occasions (same date + meal).
   * entries: [{date, time, meal, triggers:[{id}]}]
   */
  function occasions(entries) {
    const map = new Map();
    for (const e of entries) {
      const key = e.date + '|' + e.meal;
      const ts = toTs(e.date, e.time || MEAL_DEFAULT_TIME[e.meal]);
      let o = map.get(key);
      if (!o) { o = { key, date: e.date, meal: e.meal, ts, triggers: new Set() }; map.set(key, o); }
      o.ts = Math.min(o.ts, ts);
      (e.triggers || []).forEach(t => o.triggers.add(t.id));
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }

  /**
   * Compare symptom outcomes after occasions that contained each trigger vs those that didn't.
   * symptoms: [{date, time, severity (0-10)}]
   * opts: { windowHours: 24, minHours: 0, threshold: 4, categories }
   */
  function analyse(entries, symptoms, opts) {
    opts = Object.assign({ windowHours: 24, minHours: 0, threshold: 4 }, opts || {});
    const occ = occasions(entries);
    const sym = symptoms.map(s => ({ ts: toTs(s.date, s.time), severity: Number(s.severity) || 0 })).sort((a, b) => a.ts - b.ts);
    const lo = opts.minHours * 3600000, hi = opts.windowHours * 3600000;
    const lastSymptomTs = sym.length ? sym[sym.length - 1].ts : 0;

    // Only score occasions whose full window has elapsed, so the latest meals don't count as "no symptoms".
    const now = opts.now || Date.now();
    // Meals with no symptom log of any kind (not even "felt fine") in their window are skipped:
    // an unlogged day is unknown, not symptom-free.
    let unlogged = 0;
    const scored = [];
    for (const o of occ) {
      if (o.ts + hi > now) continue;
      let max = 0, logged = false;
      for (const s of sym) {
        if (s.ts > o.ts && s.ts <= o.ts + hi) logged = true;
        if (s.ts > o.ts + lo && s.ts <= o.ts + hi) max = Math.max(max, s.severity);
      }
      if (!logged) { unlogged++; continue; }
      scored.push(Object.assign({}, o, { outcome: max, bad: max >= opts.threshold }));
    }

    const cats = opts.categories || CATEGORIES;
    const results = [];
    // A food/trigger you have on (nearly) every day can't explain symptoms that only come on some days.
    const allDays = new Set(scored.map(o => o.date));
    for (const cat of cats) {
      const exp = scored.filter(o => o.triggers.has(cat.id));
      const unexp = scored.filter(o => !o.triggers.has(cat.id));
      if (!exp.length) continue;
      const rate = arr => arr.length ? arr.filter(o => o.bad).length / arr.length : 0;
      const mean = arr => arr.length ? arr.reduce((s, o) => s + o.outcome, 0) / arr.length : 0;
      // Haldane-smoothed relative risk so zero counts don't explode.
      const a = exp.filter(o => o.bad).length, b = exp.length;
      const c = unexp.filter(o => o.bad).length, d = unexp.length;
      const rr = ((a + 0.5) / (b + 1)) / ((c + 0.5) / (d + 1));
      const n = Math.min(b, d);
      const dailyShare = new Set(exp.map(o => o.date)).size / Math.max(1, allDays.size);
      const daily = allDays.size >= 7 && dailyShare >= 0.9;
      results.push({
        daily,
        id: cat.id, name: cat.name, group: cat.group,
        exposures: b, exposedBad: a, unexposed: d, unexposedBad: c,
        rateExposed: rate(exp), rateUnexposed: rate(unexp),
        meanExposed: mean(exp), meanUnexposed: mean(unexp),
        relativeRisk: rr,
        confidence: n < 5 ? 'low' : n < 15 ? 'medium' : 'high',
        verdict: daily ? 'Eaten nearly every day' : verdict(rr, n),
      });
    }
    results.sort((x, y) => y.relativeRisk - x.relativeRisk);

    // Things eaten together can't be told apart (rice always with curry). For each result, note another
    // suspect that was present in ≥90% of the same meals and looks at least as bad.
    const byId = new Map(results.map(r => [r.id, r]));
    for (const r of results) {
      if (r.daily || r.relativeRisk < 1.4 || r.confidence === 'low') continue; // only explain actual suspects
      const exp = scored.filter(o => o.triggers.has(r.id));
      let best = null;
      for (const other of results) {
        if (other.id === r.id || other.daily || other.relativeRisk < r.relativeRisk * 0.95 || other.relativeRisk < 1.2) continue;
        const share = exp.filter(o => o.triggers.has(other.id)).length / exp.length;
        if (share >= 0.9 && (!best || share > best.share || (share === best.share && other.relativeRisk > best.rr))) {
          best = { id: other.id, share, rr: other.relativeRisk };
        }
      }
      if (best) r.togetherWith = { id: best.id, name: byId.get(best.id).name, always: best.share === 1 };
    }
    return { occasions: scored.length, unlogged, symptomCount: sym.length, lastSymptomTs, results };
  }

  function verdict(rr, n) {
    if (n < 5) return 'Not enough data';
    if (rr >= 2) return 'Likely trigger';
    if (rr >= 1.4) return 'Possible trigger';
    if (rr <= 0.8) return 'Seems fine';
    return 'No clear link';
  }

  const SYMPTOMS = ['Bloating', 'Abdominal pain', 'Cramping', 'Gas', 'Diarrhoea', 'Constipation', 'Urgency',
    'Nausea', 'Reflux / heartburn', 'Fatigue'];

  const BRISTOL = {
    1: 'Separate hard lumps', 2: 'Lumpy, sausage-shaped', 3: 'Sausage with cracks', 4: 'Smooth, soft sausage',
    5: 'Soft blobs, clear edges', 6: 'Mushy, ragged edges', 7: 'Entirely liquid',
  };

  return { CATEGORIES, SYMPTOMS, BRISTOL, MEAL_DEFAULT_TIME, HIGH_FAT_GRAMS, normalise, allCategories, detect, occasions, analyse };
});
