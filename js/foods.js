/*
 * foods.js — food lookup.
 *  - Open Food Facts (free, open database, no API key) for packaged foods & barcodes
 *  - A small built-in list of common whole foods so basic logging works offline
 * Nutrients are always stored per 100 g (or 100 ml).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Foods = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELDS = 'code,product_name,product_name_en,generic_name,brands,nutriments,ingredients_text,ingredients_text_en,serving_size,serving_quantity,product_quantity,product_quantity_unit,quantity,image_front_small_url,allergens_tags';

  function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round(n, d) { const f = Math.pow(10, d == null ? 1 : d); return Math.round(n * f) / f; }

  /** Convert an Open Food Facts product into our food shape. */
  function fromOFF(p) {
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (!kcal && n['energy_100g']) kcal = num(n['energy_100g']) / 4.184; // kJ → kcal
    let salt = num(n['salt_100g']);
    if (!salt && n['sodium_100g']) salt = num(n['sodium_100g']) * 2.5;
    const serving = num(p.serving_quantity);
    // Whole-pack weight (e.g. a 400 g pizza) — lets you log "3 of 8 slices" or "half the pack".
    const unit = String(p.product_quantity_unit || 'g').toLowerCase();
    const pack = (unit === 'g' || unit === 'ml') ? num(p.product_quantity) : 0;
    return {
      id: 'off:' + p.code,
      source: 'off',
      barcode: p.code,
      name: (p.product_name_en || p.product_name || p.generic_name || 'Unnamed product').trim(),
      brand: (p.brands || '').split(',')[0].trim(),
      image: p.image_front_small_url || '',
      ingredients: (p.ingredients_text_en || p.ingredients_text || '').trim(),
      servingSize: serving > 0 ? serving : 100,
      servingLabel: p.serving_size || '',
      packSize: pack > 0 && pack < 20000 ? pack : 0,
      pieces: 0,
      per100: {
        kcal: round(kcal, 0), protein: round(num(n.proteins_100g)), carbs: round(num(n.carbohydrates_100g)),
        sugar: round(num(n.sugars_100g)), fat: round(num(n.fat_100g)), satFat: round(num(n['saturated-fat_100g'])),
        fiber: round(num(n.fiber_100g)), salt: round(salt, 2),
      },
      hasNutrition: kcal > 0 || num(n.proteins_100g) > 0 || num(n.fat_100g) > 0 || num(n.carbohydrates_100g) > 0,
    };
  }

  function base(country) { return 'https://' + (country || 'world') + '.openfoodfacts.org'; }

  const TIMEOUT_MS = 15000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** fetch JSON with a timeout that also honours the caller's AbortSignal. */
  async function getJSON(url, signal) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) { const e = new Error('Open Food Facts returned ' + res.status); e.status = res.status; throw e; }
      return await res.json();
    } catch (err) {
      if (signal && signal.aborted) throw err; // caller cancelled — pass through as AbortError
      if (ctrl.signal.aborted) { const e = new Error('Open Food Facts took too long to respond'); e.status = 'timeout'; throw e; }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  function searchUrl(query, country, page, pageSize) {
    return base(country) + '/cgi/search.pl?search_simple=1&action=process&json=1' +
      '&sort_by=unique_scans_n' +                       // most-scanned (i.e. popular) products first
      '&page=' + page + '&page_size=' + pageSize +
      '&fields=' + FIELDS + '&search_terms=' + encodeURIComponent(query);
  }

  /**
   * Search Open Food Facts. Returns { foods, hasMore, country }.
   * Products without nutrition data are kept (flagged hasNutrition=false) so the user
   * can still pick them and fill in the label, instead of seeing "no matches".
   * If a regional search finds nothing, falls back to the worldwide database.
   */
  async function searchOFF(query, opts) {
    opts = opts || {};
    const page = opts.page || 1, pageSize = opts.pageSize || 24;
    let country = opts.country || 'world';
    let data;
    for (let attempt = 0; ; attempt++) {
      try { data = await getJSON(searchUrl(query, country, page, pageSize), opts.signal); break; }
      catch (err) {
        const retryable = err.status === 'timeout' || (err.status >= 500 && err.status < 600);
        if (!retryable || attempt >= 1 || (opts.signal && opts.signal.aborted)) throw err;
        await sleep(1500);
      }
    }
    if (!(data.products || []).length && country !== 'world' && page === 1) {
      country = 'world';
      data = await getJSON(searchUrl(query, country, page, pageSize), opts.signal);
    }
    const foods = (data.products || []).map(fromOFF);
    foods.sort((a, b) => (b.hasNutrition ? 1 : 0) - (a.hasNutrition ? 1 : 0)); // stable: keeps popularity order
    const count = Number(data.count) || 0;
    return { foods, hasMore: page * pageSize < count, country };
  }

  async function lookupBarcode(code, opts) {
    opts = opts || {};
    const url = base(opts.country) + '/api/v2/product/' + encodeURIComponent(code) + '.json?fields=' + FIELDS;
    let data;
    try { data = await getJSON(url, opts.signal); }
    catch (err) { if (err.status === 404) return null; throw err; }
    if (data.status !== 1 || !data.product) return null;
    return fromOFF(Object.assign({ code }, data.product));
  }

  // name, kcal, protein, carbs, sugar, fat, satFat, fiber, salt, servingGrams, servingLabel, ingredients[, wholeGrams, slices]
  const GENERIC_ROWS = [
    ['Apple', 52, 0.3, 13.8, 10.4, 0.2, 0, 2.4, 0, 182, '1 medium', 'apple'],
    ['Banana', 89, 1.1, 22.8, 12.2, 0.3, 0.1, 2.6, 0, 118, '1 medium', 'banana'],
    ['Orange', 47, 0.9, 11.8, 9.4, 0.1, 0, 2.4, 0, 131, '1 medium', 'orange'],
    ['Pear', 57, 0.4, 15.2, 9.8, 0.1, 0, 3.1, 0, 178, '1 medium', 'pear'],
    ['Strawberries', 32, 0.7, 7.7, 4.9, 0.3, 0, 2, 0, 150, '1 cup', 'strawberries'],
    ['Blueberries', 57, 0.7, 14.5, 10, 0.3, 0, 2.4, 0, 148, '1 cup', 'blueberries'],
    ['Avocado', 160, 2, 8.5, 0.7, 14.7, 2.1, 6.7, 0, 136, '1 fruit (flesh)', 'avocado'],
    ['Broccoli (raw)', 34, 2.8, 6.6, 1.7, 0.4, 0, 2.6, 0.08, 90, '1 cup', 'broccoli'],
    ['Spinach (raw)', 23, 2.9, 3.6, 0.4, 0.4, 0.1, 2.2, 0.2, 30, '1 cup', 'spinach'],
    ['Carrot (raw)', 41, 0.9, 9.6, 4.7, 0.2, 0, 2.8, 0.17, 61, '1 medium', 'carrot'],
    ['Tomato', 18, 0.9, 3.9, 2.6, 0.2, 0, 1.2, 0.01, 123, '1 medium', 'tomato'],
    ['Cucumber', 15, 0.7, 3.6, 1.7, 0.1, 0, 0.5, 0, 100, '1/3 cucumber', 'cucumber'],
    ['Mushrooms (raw)', 22, 3.1, 3.3, 2, 0.3, 0, 1, 0.01, 70, '1 cup sliced', 'mushrooms'],
    ['Cauliflower (raw)', 25, 1.9, 5, 1.9, 0.3, 0.1, 2, 0.08, 100, '1 cup', 'cauliflower'],
    ['Onion (raw)', 40, 1.1, 9.3, 4.2, 0.1, 0, 1.7, 0.01, 110, '1 medium', 'onion'],
    ['Garlic', 149, 6.4, 33, 1, 0.5, 0.1, 2.1, 0.04, 3, '1 clove', 'garlic'],
    ['Potato (boiled)', 87, 1.9, 20.1, 0.9, 0.1, 0, 1.8, 0.01, 173, '1 medium', 'potato'],
    ['Sweet potato (baked)', 90, 2, 20.7, 6.5, 0.2, 0, 3.3, 0.09, 130, '1 medium', 'sweet potato'],
    ['White rice (cooked)', 130, 2.7, 28.2, 0.1, 0.3, 0.1, 0.4, 0, 158, '1 cup', 'white rice'],
    ['Brown rice (cooked)', 123, 2.7, 25.6, 0.2, 1, 0.3, 1.6, 0, 195, '1 cup', 'brown rice'],
    ['Quinoa (cooked)', 120, 4.4, 21.3, 0.9, 1.9, 0.2, 2.8, 0.01, 185, '1 cup', 'quinoa'],
    ['Pasta (cooked)', 158, 5.8, 30.9, 0.6, 0.9, 0.2, 1.8, 0, 140, '1 cup', 'durum wheat semolina'],
    ['Porridge oats (dry)', 379, 13.2, 67.7, 1, 6.5, 1.1, 10.1, 0, 40, '40 g portion', 'rolled oats'],
    ['White bread', 265, 9, 49, 5, 3.2, 0.7, 2.7, 1.2, 36, '1 slice', 'wheat flour, water, yeast, salt'],
    ['Wholemeal bread', 247, 13, 41, 6, 3.4, 0.7, 7, 1, 36, '1 slice', 'wholemeal wheat flour, water, yeast, salt'],
    ['Egg', 143, 12.6, 0.7, 0.4, 9.5, 3.1, 0, 0.36, 50, '1 large', 'egg'],
    ['Chicken breast (cooked)', 165, 31, 0, 0, 3.6, 1, 0, 0.19, 120, '1 breast', 'chicken'],
    ['Salmon fillet (cooked)', 206, 22, 0, 0, 12.4, 2.5, 0, 0.15, 125, '1 fillet', 'salmon'],
    ['Beef mince 5% fat (raw)', 124, 21, 0, 0, 5, 2.2, 0, 0.17, 125, '1/4 pack', 'beef'],
    ['Tuna in spring water (drained)', 116, 25.5, 0, 0, 0.8, 0.2, 0, 0.8, 100, '1 small can', 'tuna, water, salt'],
    ['Firm tofu', 144, 17.3, 2.8, 0.6, 8.7, 1.3, 2.3, 0.03, 100, '100 g', 'firm tofu'],
    ['Greek yoghurt (full fat)', 97, 9, 4, 4, 5, 3.3, 0, 0.09, 150, '1 pot', 'yoghurt (milk), live cultures'],
    ['Semi-skimmed milk', 47, 3.5, 4.8, 4.8, 1.7, 1.1, 0, 0.11, 200, '1 glass (200 ml)', 'semi-skimmed milk'],
    ['Lactose-free semi-skimmed milk', 47, 3.5, 4.8, 4.8, 1.7, 1.1, 0, 0.11, 200, '1 glass (200 ml)', 'lactose-free semi-skimmed milk'],
    ['Cheddar cheese', 403, 25, 1.3, 0.5, 33, 21, 0, 1.8, 30, '1 slice / matchbox', 'cheddar cheese'],
    ['Butter', 717, 0.9, 0.1, 0.1, 81, 51, 0, 1.5, 10, '1 tsp', 'butter, salt'],
    ['Olive oil', 884, 0, 0, 0, 100, 14, 0, 0, 14, '1 tbsp', 'olive oil'],
    ['Peanut butter', 588, 25, 20, 9, 50, 10, 6, 1.1, 16, '1 tbsp', 'peanuts, salt'],
    ['Almonds', 579, 21, 21.6, 4.4, 49.9, 3.8, 12.5, 0, 28, '1 handful', 'almonds'],
    ['Kidney beans (canned, drained)', 127, 8.7, 22.8, 0.3, 0.5, 0.1, 6.4, 0.3, 130, '1/2 can', 'red kidney beans'],
    ['Chickpeas (canned, drained)', 164, 8.9, 27.4, 4.8, 2.6, 0.3, 7.6, 0.3, 120, '1/2 can', 'chickpeas'],
    ['Lentils (cooked)', 116, 9, 20, 1.8, 0.4, 0.1, 7.9, 0, 198, '1 cup', 'lentils'],
    ['Honey', 304, 0.3, 82.4, 82.1, 0, 0, 0.2, 0, 21, '1 tbsp', 'honey'],
    ['Dark chocolate 70%', 598, 7.8, 45.9, 24, 42.6, 24.5, 10.9, 0.05, 20, '2 squares', 'cocoa mass, sugar, cocoa butter'],
    ['Whey protein powder', 400, 80, 8, 5, 6, 3, 0, 0.5, 30, '1 scoop', 'whey protein concentrate (milk)'],
    ['Coffee (black)', 2, 0.3, 0, 0, 0, 0, 0, 0, 240, '1 mug', 'coffee'],
    ['Tea (black, no milk)', 1, 0, 0.3, 0, 0, 0, 0, 0, 240, '1 mug', 'black tea'],
    // Typical home-cooked / takeaway dishes (estimates — recipes vary a lot).
    // Extra columns: weight of the whole thing (g), number of slices/portions in it.
    ['Margherita pizza (homemade / takeaway)', 250, 11, 30, 3.5, 9.5, 4.5, 2, 1.2, 70, '1 slice (⅛ of a 12-inch)', 'pizza dough (wheat flour, yeast, olive oil), tomato sauce, mozzarella (milk), basil, oregano', 560, 8],
    ['Pepperoni pizza (homemade / takeaway)', 275, 12, 28, 3.5, 12.5, 5.2, 2, 1.6, 75, '1 slice (⅛ of a 12-inch)', 'pizza dough (wheat flour, yeast), tomato sauce, mozzarella (milk), pepperoni (pork, paprika, chilli, garlic)', 600, 8],
    ['Garlic bread', 350, 8, 42, 3, 17, 7, 2.5, 1.2, 30, '1 slice', 'baguette (wheat flour), butter (milk), garlic, parsley', 240, 8],
    ['Lasagne (beef)', 150, 8, 12, 3, 7.5, 3.5, 1, 0.6, 350, '1 portion', 'lasagne pasta (durum wheat), beef mince, tomato, onion, garlic, white sauce (milk, butter, wheat flour), cheese', 2100, 6],
    ['Spaghetti bolognese', 130, 7, 16, 3, 4, 1.5, 1.5, 0.4, 400, '1 plate', 'spaghetti (durum wheat), beef mince, tomato, onion, garlic, carrot, olive oil'],
    ["Shepherd's / cottage pie", 120, 6.5, 11, 2, 5.5, 2.5, 1.3, 0.5, 350, '1 portion', 'lamb or beef mince, potato, onion, carrot, butter (milk), milk, stock', 1750, 5],
    ['Chicken curry (e.g. tikka masala)', 140, 12, 5, 3, 8, 3.5, 1, 0.8, 350, '1 portion', 'chicken, cream (milk), tomato, onion, garlic, ginger, chilli, spices, oil'],
    ['Roast chicken (with skin)', 220, 25, 0, 0, 13, 3.7, 0, 0.2, 140, '1 portion', 'chicken'],
    ['Roast potatoes', 150, 2.5, 23, 1, 5.5, 0.6, 2, 0.1, 70, '1 potato', 'potato, vegetable oil'],
    ['Yorkshire pudding', 250, 8, 28, 3, 12, 3, 1, 0.6, 30, '1 pudding', 'wheat flour, egg, milk, vegetable oil'],
    ['Gravy (from granules)', 35, 1, 5, 0.5, 1.3, 0.5, 0.2, 0.9, 80, '4 tbsp', 'gravy granules (potato starch, wheat flour, onion powder, salt)'],
    ['Oven chips', 160, 2.6, 26, 0.5, 5, 0.5, 2.5, 0.1, 165, '1 portion', 'potato, sunflower oil'],
    ['Battered cod (chip shop)', 230, 15, 15, 0.5, 12, 1.5, 0.7, 0.5, 200, '1 fillet', 'cod, batter (wheat flour, water, raising agent), vegetable oil'],
    ['Victoria sponge cake', 420, 4.5, 52, 35, 21, 10, 1, 0.5, 70, '1 slice', 'wheat flour, sugar, butter (milk), eggs, strawberry jam, cream (milk)', 840, 12],
    ['Lager', 43, 0.5, 3.6, 0, 0, 0, 0, 0, 568, '1 pint', 'beer (water, barley malt, hops)'],
    ['Red wine', 85, 0.1, 2.6, 0.6, 0, 0, 0, 0, 175, '1 medium glass', 'red wine'],
  ];

  const GENERIC = GENERIC_ROWS.map((r, i) => ({
    id: 'gen:' + i, source: 'generic', name: r[0], brand: 'Generic',
    per100: { kcal: r[1], protein: r[2], carbs: r[3], sugar: r[4], fat: r[5], satFat: r[6], fiber: r[7], salt: r[8] },
    servingSize: r[9], servingLabel: r[10], ingredients: r[11], packSize: r[12] || 0, pieces: r[13] || 0,
  }));

  function searchLocal(query, foods) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return foods.filter(f => {
      const hay = (f.name + ' ' + (f.brand || '')).toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }

  return { fromOFF, searchOFF, lookupBarcode, GENERIC, searchLocal };
});
