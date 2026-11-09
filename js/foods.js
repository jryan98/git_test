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
      unit: unit === 'ml' ? 'ml' : 'g',   // drinks are labelled per 100 ml
      servingSize: serving > 0 ? serving : 100,
      servingLabel: p.serving_size || '',
      servings: serving > 0 ? [{ label: p.serving_size || 'serving', amount: serving }] : [],
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
  async function getJSON(url, signal, timeoutMs) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs || TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) { const e = new Error('The server returned an error (' + res.status + ')'); e.status = res.status; throw e; }
      return await res.json();
    } catch (err) {
      if (signal && signal.aborted) throw err; // caller cancelled — pass through as AbortError
      if (ctrl.signal.aborted) { const e = new Error('The server took too long to respond'); e.status = 'timeout'; throw e; }
      if (err instanceof TypeError) { const e = new Error("Couldn't connect"); e.status = 'network'; throw e; } // offline, blocked or CORS
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

  // Why not search.openfoodfacts.org? It's faster, but it doesn't send the CORS header browsers need,
  // so a web app can't read its replies. The classic search allows browsers but is often overloaded:
  // it returns 503s — sometimes without the CORS header, which the browser reports as a network
  // error ("Failed to fetch"). So network errors, timeouts and 5xx are all retried.
  const retryable = err => err.status === 'timeout' || err.status === 'network' || (err.status >= 500 && err.status < 600);
  async function withRetries(fn, signal, attempts) {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (err) {
        if ((signal && signal.aborted) || !retryable(err) || i >= attempts - 1) throw err;
        await sleep(800 * (i + 1));
      }
    }
  }
  async function searchClassic(query, country, page, pageSize, signal) {
    const data = await withRetries(() => getJSON(searchUrl(query, country, page, pageSize), signal, 12000), signal, 3);
    return { products: data.products || [], hasMore: page * pageSize < (Number(data.count) || 0), via: 'search' };
  }
  /** Brand pages (e.g. /brand/weetabix.json) are served separately from the overloaded search. */
  const slugify = q => q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  async function searchBrand(query, country, page, pageSize, signal) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    // try the whole query as a brand, then just its first word ("weetabix original" → weetabix)
    const tries = Array.from(new Set([slugify(query), slugify(words[0] || '')])).filter(Boolean);
    for (const slug of tries) {
      const url = base(country) + '/brand/' + slug + '.json?page=' + page + '&page_size=' + pageSize + '&fields=' + FIELDS;
      let data;
      try { data = await withRetries(() => getJSON(url, signal, 12000), signal, 2); }
      catch (err) { if (signal && signal.aborted) throw err; continue; } // e.g. 404: no brand by that name — try the next
      let products = data.products || [];
      const rest = words.filter(w => w !== slug);
      if (rest.length && slug === tries[tries.length - 1] && tries.length > 1) {
        const narrowed = products.filter(p => rest.every(w => (p.product_name || '').toLowerCase().includes(w)));
        if (narrowed.length) products = narrowed;
      }
      if (products.length) return { products, hasMore: page * pageSize < (Number(data.count) || 0), via: 'brand' };
    }
    return { products: [], hasMore: false, via: 'brand' };
  }

  /**
   * Search Open Food Facts. Returns { foods, hasMore, country, via }.
   * Classic search (with retries) → brand page fallback → worldwide if your region has nothing.
   * Products without nutrition data are kept (hasNutrition=false): tapping one fetches the full product.
   */
  async function searchOFF(query, opts) {
    opts = opts || {};
    const page = opts.page || 1, pageSize = opts.pageSize || 24;
    let country = opts.country || 'world';
    const run = async c => {
      try { return await searchClassic(query, c, page, pageSize, opts.signal); }
      catch (err) {
        if (opts.signal && opts.signal.aborted) throw err;
        let brand = null;
        try { brand = await searchBrand(query, c, page, pageSize, opts.signal); } catch (_) { /* report the search error */ }
        if (brand && brand.products.length) return brand;
        throw Object.assign(new Error("Open Food Facts' search isn't responding right now — it's often overloaded. Try again in a minute, or use the Barcode tab, which is much more reliable"), { status: err.status });
      }
    };
    let res = await run(country);
    if (!res.products.length && country !== 'world' && page === 1) { country = 'world'; res = await run(country); }
    const foods = res.products.filter(p => p && p.code).map(fromOFF);
    foods.sort((a, b) => (b.hasNutrition ? 1 : 0) - (a.hasNutrition ? 1 : 0)); // stable: keeps popularity order
    return { foods, hasMore: res.hasMore, country, via: res.via };
  }

  // ---------- USDA FoodData Central: reliable generic & whole foods ----------
  // Free. DEMO_KEY works straight away (about 30 searches an hour); a personal key (free, instant sign-up)
  // allows 1,000 an hour. Only generic food types are searched — US branded products aren't useful in the UK.
  const USDA_HOST = 'https://api.nal.usda.gov/fdc/v1';
  const USDA_TYPES = 'Foundation,SR Legacy,Survey (FNDDS)';
  const USDA_BRANDED = 'Branded';
  const tidy = s => {
    s = String(s || '').trim();
    if (s && s === s.toUpperCase()) s = s.toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  /** Convert a USDA search hit into our food shape (nutrients per 100 g). */
  function fromUSDA(f) {
    const n = {};
    (f.foodNutrients || []).forEach(x => {
      const num = String(x.nutrientNumber || x.number || '');
      const v = Number(x.value != null ? x.value : x.amount);
      if (num && isFinite(v) && n[num] == null) n[num] = v;
    });
    let kcal = n['208'] != null ? n['208'] : n['958'] != null ? n['958'] : n['957'] != null ? n['957'] : n['268'] != null ? n['268'] / 4.184 : 0;
    const fiber = n['291'] || 0;
    // USDA carbohydrate is "by difference" and includes fibre; UK labels list carbs without fibre.
    const carbs = Math.max(0, (n['205'] || 0) - fiber);
    const branded = f.dataType === 'Branded' && f.servingSize > 0 && /^(g|ml|grm|mlt)$/i.test(f.servingSizeUnit || '')
      ? [{ label: tidy(f.householdServingFullText || 'serving'), amount: Math.round(f.servingSize * 10) / 10 }] : [];
    const servings = branded.concat(f.foodMeasures || [])
      .map(m => m.label ? m : (m && m.gramWeight > 0 && (m.disseminationText || m.measureUnitName) && !/quantity not specified/i.test(m.disseminationText || '')
        ? { label: tidy(m.disseminationText || m.measureUnitName), amount: Math.round(m.gramWeight * 10) / 10 } : null))
      .filter(Boolean)
      .slice(0, 5);
    const name = tidy(f.description);
    return {
      id: 'usda:' + f.fdcId,
      source: 'usda',
      name,
      brand: f.dataType === 'Branded' ? tidy(f.brandName || f.brandOwner || 'USDA') + ' (US)' : 'USDA',
      ingredients: f.ingredients ? tidy(f.ingredients) : name,   // generic foods have no ingredient list; the name still drives trigger checks
      unit: 'g',
      servings,
      servingSize: servings.length ? servings[0].amount : 100,
      servingLabel: servings.length ? servings[0].label : '',
      per100: {
        kcal: round(kcal, 0), protein: round(n['203'] || 0), carbs: round(carbs), sugar: round(n['269'] || 0),
        fat: round(n['204'] || 0), satFat: round(n['606'] || 0), fiber: round(fiber), salt: round((n['307'] || 0) * 2.5 / 1000, 2),
      },
      hasNutrition: kcal > 0 || (n['203'] || 0) > 0 || (n['204'] || 0) > 0,
    };
  }

  async function searchUSDA(query, opts) {
    opts = opts || {};
    const page = opts.page || 1, pageSize = opts.pageSize || 20;
    const url = types => USDA_HOST + '/foods/search?api_key=' + encodeURIComponent(opts.apiKey || 'DEMO_KEY') +
      '&query=' + encodeURIComponent(query) + '&dataType=' + encodeURIComponent(types) +
      '&pageSize=' + pageSize + '&pageNumber=' + page;
    let data;
    try { data = await getJSON(url(USDA_TYPES), opts.signal); }
    catch (err) {
      if (err.status === 429) throw Object.assign(new Error(opts.apiKey ? 'USDA search limit reached for your key — try again later'
        : 'The shared USDA key has hit its hourly limit. Add your own free key in Settings → Food sources'), { status: 429 });
      if (err.status === 403) throw Object.assign(new Error('USDA rejected the API key — check it in Settings → Food sources'), { status: 403 });
      throw err;
    }
    let foods = (data.foods || []).map(fromUSDA).filter(f => f.hasNutrition);
    let hasMore = page < (Number(data.totalPages) || 0);
    // Hardly any generic matches (often a brand name, e.g. Weetabix): add US branded products too.
    if (page === 1 && foods.length < 3) {
      try {
        const b = await getJSON(url(USDA_BRANDED).replace('pageSize=' + pageSize, 'pageSize=10'), opts.signal);
        foods = foods.concat((b.foods || []).map(fromUSDA).filter(f => f.hasNutrition));
        hasMore = false;
      } catch (_) { /* generic results (if any) are still useful */ }
    }
    return { foods, hasMore };
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
    // Energy-dense foods that are low-FODMAP at sensible portions — handy for gaining with IBS.
    ['Macadamia nuts', 718, 7.9, 13.8, 4.6, 75.8, 12, 8.6, 0, 30, '1 handful (30 g)', 'macadamia nuts'],
    ['Walnuts', 654, 15.2, 13.7, 2.6, 65.2, 6.1, 6.7, 0, 30, '1 handful (30 g)', 'walnuts'],
    ['Peanuts (roasted, unsalted)', 585, 24, 21, 4, 50, 7, 8, 0.02, 28, '1 small handful (28 g)', 'peanuts'],
    ['Pumpkin seeds', 559, 30, 10.7, 1.4, 49, 8.7, 6, 0.02, 23, '2 tbsp', 'pumpkin seeds'],
    ['Lactose-free whole milk', 64, 3.3, 4.7, 4.7, 3.6, 2.3, 0, 0.1, 250, '1 glass (250 ml)', 'lactose-free whole milk'],
    ['Lactose-free Greek-style yoghurt', 115, 6, 4, 4, 9, 6, 0, 0.1, 150, '1 pot', 'lactose-free yoghurt, live cultures'],
    ['Maple syrup', 260, 0, 67, 60, 0.1, 0, 0, 0.02, 20, '1 tbsp', 'maple syrup'],
    ['Rice cakes', 387, 8, 81, 0.9, 2.8, 0.6, 4.2, 0.02, 9, '1 rice cake', 'wholegrain brown rice'],
    ['Whey protein isolate', 370, 88, 3, 2, 1.5, 1, 0, 0.5, 30, '1 scoop', 'whey protein isolate, sunflower lecithin'],
    ['Lager', 43, 0.5, 3.6, 0, 0, 0, 0, 0, 568, '1 pint', 'beer (water, barley malt, hops)'],
    ['Red wine', 85, 0.1, 2.6, 0.6, 0, 0, 0, 0, 175, '1 medium glass', 'red wine'],
  ];

  // IDs come from the name so adding foods to the list never re-labels existing ones.
  const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const DRINKS = new Set(['Lactose-free whole milk', 'Semi-skimmed milk', 'Lactose-free semi-skimmed milk', 'Coffee (black)', 'Tea (black, no milk)', 'Lager', 'Red wine']);
  // Extra handy measures for some basics (amount in g, or ml for drinks).
  const EXTRA_SERVINGS = {
    'Porridge oats (dry)': [['1 cup', 90]], 'White rice (cooked)': [['1 tbsp', 15]], 'Olive oil': [['1 tsp', 4.5]],
    'Butter': [['1 tbsp', 14], ['1 knob', 15]], 'Peanut butter': [['1 tsp', 5]], 'Honey': [['1 tsp', 7]],
    'Semi-skimmed milk': [['splash in tea/coffee', 30], ['1 pint', 568]], 'Lactose-free semi-skimmed milk': [['splash in tea/coffee', 30]],
    'Lager': [['1 bottle (330 ml)', 330], ['1 can (440 ml)', 440]], 'Red wine': [['1 large glass', 250], ['1 bottle', 750]],
    'Greek yoghurt (full fat)': [['1 tbsp', 20]], 'Whey protein powder': [['1 tbsp', 8]], 'Cheddar cheese': [['1 tbsp grated', 7]],
  };
  const GENERIC = GENERIC_ROWS.map(r => ({
    id: 'gen:' + slug(r[0]),
    unit: DRINKS.has(r[0]) ? 'ml' : 'g',
    servings: [{ label: r[10], amount: r[9] }].concat((EXTRA_SERVINGS[r[0]] || []).map(([label, amount]) => ({ label, amount }))), source: 'generic', name: r[0], brand: 'Generic',
    per100: { kcal: r[1], protein: r[2], carbs: r[3], sugar: r[4], fat: r[5], satFat: r[6], fiber: r[7], salt: r[8] },
    servingSize: r[9], servingLabel: r[10], ingredients: r[11], packSize: r[12] || 0, pieces: r[13] || 0,
  }));

  /**
   * Top-up ideas for gaining with IBS: energy-dense foods at portions generally considered
   * low-FODMAP (Monash University guidance). [food name, grams/ml, how to have it]
   */
  const BOOSTERS = [
    ['Peanut butter', 32, '2 tbsp — on rice cakes, toast or in porridge'],
    ['Macadamia nuts', 30, 'a handful (30 g)'],
    ['Walnuts', 30, 'a handful (30 g)'],
    ['Peanuts (roasted, unsalted)', 28, 'a small handful'],
    ['Lactose-free whole milk', 250, 'a glass, or blended into a shake'],
    ['Cheddar cheese', 40, '40 g — with crackers or melted on potatoes'],
    ['Olive oil', 14, '1 tbsp drizzled over rice, potatoes or veg'],
    ['Porridge oats (dry)', 50, '50 g, cooked with lactose-free milk'],
    ['Dark chocolate 70%', 30, '30 g'],
    ['Whey protein isolate', 30, 'a scoop shaken with lactose-free milk'],
    ['Egg', 100, '2 eggs, any style'],
    ['Lactose-free Greek-style yoghurt', 150, 'a pot, with maple syrup or nuts'],
    ['Pumpkin seeds', 23, '2 tbsp on yoghurt or porridge'],
    ['Banana', 118, 'a firm (not spotty) banana'],
  ].map(([name, amount, how]) => ({ food: GENERIC.find(g => g.name === name), amount, how })).filter(b => b.food);

  function searchLocal(query, foods) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return foods.filter(f => {
      const hay = (f.name + ' ' + (f.brand || '')).toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }

  return { fromOFF, searchOFF, lookupBarcode, fromUSDA, searchUSDA, GENERIC, BOOSTERS, searchLocal };
});
