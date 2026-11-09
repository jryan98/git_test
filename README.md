# GutFuel

**Gain weight steadily and healthily — while keeping IBS in check.**
A private food and gut diary with no account, no ads and no server. Everything stays on your phone.

Putting on weight with IBS is hard: the foods that make it easy (big portions, rich meals, lots of dairy,
onion and garlic) are often the ones that set your gut off, and a bad gut day kills your appetite.
GutFuel is built around that problem:

1. **Fuel up steadily** — set a goal weight and a gentle weekly rate (0.25 kg/week by default). Calories are a
   daily *aim to reach*, not a limit. A weekly check-in compares your real gain with the plan and suggests
   how much to eat more (or less) — one tap to apply.
2. **Learn your gut** — log what you eat and tap how your gut feels each day. GutFuel scans every food for
   common IBS triggers and works out *your* likely triggers and *your* gut-safe foods.
3. **Close the gap gently** — when you're short on calories it suggests energy-dense, gut-friendly top-ups
   (peanut butter, macadamias, lactose-free milk, oats, olive oil…) that avoid your suspected triggers.

## Features

**Daily diary**
- Six eating slots — breakfast, mid-morning, lunch, afternoon snack, dinner, supper — because smaller,
  more frequent meals are easier on both appetite and an IBS gut; the diary counts your eating occasions
- **Gut check-in** at the top: one tap from 😀 calm to 😫 severe (calm days matter as much as bad ones);
  anything worse than calm opens the full symptom log (types, 0–10 severity, Bristol stool scale, notes)
- Calories and protein to go, with carbs, fat, fibre (25–30 g — enough for gut health without overfilling),
  sugars, saturates and salt; ✓ when you reach your aim
- **Top-up ideas** when you're short: energy-dense foods at portions generally considered low-FODMAP,
  favouring protein when protein is behind, never containing your suspected triggers; tap to add
- ⚠ marks on foods and triggers that are on *your* watch list
- Food search runs two free sources side by side, so one being slow or down never blocks the other:
  - **Packaged foods** — [Open Food Facts](https://world.openfoodfacts.org). Its search is often overloaded, so
    failed requests are retried, and if search stays down the app tries the brand's page (e.g. "weetabix");
    filtered to your region, falling back to worldwide. (Its newer search service can't be used from a browser
    app — it doesn't send the CORS header.) Barcode lookups use a separate, much more reliable API.
  - **Generic foods** (fruit, veg, meat, grains…) — [USDA FoodData Central](https://fdc.nal.usda.gov);
    when a search has hardly any generic matches (often a brand name) it adds US branded products too.
    Works straight away with the shared demo key (~30 searches/hour); paste a free personal key
    ([sign up](https://fdc.nal.usda.gov/api-key-signup)) into Settings → Food sources for 1,000/hour
- Barcode lookup/scan, built-in basics and home-cooked dishes, your own foods, and quick add for meals out
- Ingredients for packaged foods are pulled in automatically for the IBS checks — from wherever Open Food Facts
  has them (English text, the standard ingredient tags, the structured list, plus allergens such as milk).
  Products saved without ingredients are re-checked when you scan or log them, and quietly in the background,
  which also fixes the trigger checks on past diary entries
- **Gut-safe for you** shown first when adding food, then recent foods and your own foods
- Log portions however you measured them: serving sizes (slice, bar, glass…), "3 of 8 slices", ¼–½ of the
  whole, weight (g, kg, oz, lb) or volume (ml, litres, tsp, tbsp, cups, fl oz, pints)
- Create foods or drinks per 100 g/ml or per serving, with as many named serving sizes as you like
- **Recipes** (Create food → Recipe): add ingredients from any food source — or by hand with your own
  macros — in whatever unit you measured (g, cups, tbsp, servings…); set how many servings it makes and,
  optionally, the cooked weight. Shows totals for the whole dish and per serving, plus IBS triggers with the
  ingredient responsible. Saved under My recipes; log it as servings, "2 of 6 portions", part of the dish or
  by weight; edit it any time
- "Copy yesterday's" for repeat meals

**Gut / IBS**
- **Your gut profile**: a *watch list* of likely triggers and suspect foods, and *gut-safe foods* —
  ones you eat often that are no more likely than anything else to be followed by symptoms
- **Gut & appetite**: how many calories you lose on rough gut days, with tips to keep intake up
- Automatic flags for Fructans, GOS, Lactose, Excess fructose, Polyols, Caffeine, Alcohol, Chilli,
  Artificial sweeteners, Gums & emulsifiers, Fizzy drinks and High-fat meals (≥ 20 g fat), handling common
  false positives (lactose-free, coconut/oat milk, garlic-infused oil, buckwheat, decaf, wine vinegar,
  cherry tomatoes, beer & malt extract…); add your own personal triggers
- Trigger analysis: for every meal, the worst symptom in the next 24 h (adjustable), comparing meals with and
  without each trigger and each food → Likely / Possible / No clear link / Seems fine, with sample sizes.
  It's careful about what it can't know: meals with nothing logged afterwards are skipped, foods you have
  every day aren't blamed for symptoms that only come on some days, and foods always eaten together
  (rice with curry) are flagged as inseparable rather than both blamed

**Healthy gain**
- Mifflin-St Jeor maintenance × activity + a surplus from your weekly rate (7,700 kcal/kg)
- Rates from 0.1 to 0.75 kg/week, 0.25 recommended; warns above ~½% of body weight a week, which tends to
  add more fat than muscle — and suggests strength training 2–3× a week
- Protein 1.8 g/kg, fat 30% (easier to eat enough), carbs fill the rest — all overridable
- **Weekly check-in**: once you have 2–3 weeks of weigh-ins it compares your 3-week trend with the plan and
  suggests a calorie change (± up to 300 kcal/day at a time); Goals shows and can reset the adjustments
- **Adaptive maintenance**: estimates your real maintenance from intake vs. weight change
- Smoothed weight trend, goal ETA, timeline with projected plan, body composition (body-fat %, lean and
  fat mass), waist, daily calories & protein vs. aim; kg, lb or stone & pounds
- Losing or maintaining weight still works — set a goal below or equal to your current weight

**Your data**
- Stored only in your browser (localStorage); only search words go to Open Food Facts / USDA.
  Export/import a JSON backup, or export your diary as CSV.
  A reminder appears after two weeks of logging without a backup; Settings shows when you last backed up.
- Installable as an app (PWA) — Settings shows an **Install app** button where supported — and works offline
  (food search needs internet).
- New users get a short welcome checklist.
- **Version number** in Settings → About (e.g. `v2026.11.09.1432`). GitHub Pages stamps it automatically on
  every push to `main` via `version.json`, so it always changes when the code does; after an update the app
  shows a one-time "GutFuel was updated" notice with a link to what changed. Running from the source files
  (`npm start`) it reads "development copy".

## Running it

It's plain HTML/CSS/JS — no build step, no dependencies.

```bash
npm start          # or: python3 -m http.server 8080
# open http://localhost:8080
```

To use it on your phone, host the folder anywhere static — e.g. enable **GitHub Pages** for this repo
(Settings → Pages → deploy from branch), open the URL on your phone and choose "Add to Home Screen".
Your data still stays on your phone; only the code is hosted. (If the repo is public the *code* is public,
but none of your data is ever in the repo.)

**Back up regularly** (Settings → Export backup): clearing browser data or uninstalling the browser deletes it.

## Tests

```bash
npm test   # node --test — covers the energy/macro maths, weight trend, trigger detection and correlation
```

## Project layout

```
index.html            app shell
css/styles.css        styles (light + dark)
js/calc.js            BMR/TDEE/macros, weight trend, adaptive TDEE, units   (pure, tested)
js/ibs.js             trigger keyword database, detection, symptom correlation (pure, tested)
js/units.js           weights, kitchen volumes and serving-size conversions (pure, tested)
js/foods.js           Open Food Facts + USDA clients, built-in foods, top-up ideas
js/store.js           localStorage persistence, backup/restore
js/charts.js          small SVG chart with hover tooltips
js/app.js             UI
sw.js, manifest.webmanifest, icons/   PWA / offline
```

## Caveats

This is a personal tool, not medical advice. Keyword matching can't know portion-dependent FODMAP levels
(a pinch of garlic powder ≠ a whole bulb), and correlations need a few weeks of consistent logging —
including symptom-free days — to mean anything. For a structured approach, the low-FODMAP
elimination/reintroduction diet is best done with a dietitian, and the Monash University FODMAP app has
lab-tested serving sizes. The top-up suggestions use portions generally considered low-FODMAP, but tolerance is
personal. If you're underweight or losing weight without trying, see your GP.
