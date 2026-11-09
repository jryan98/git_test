# GutFuel

A private, personal food diary — like MyFitnessPal, but with no account, no ads and no server.
Built around three things:

1. **Log what you eat** — search millions of packaged foods (via [Open Food Facts](https://world.openfoodfacts.org)),
   look up / scan barcodes, use built-in basics (fruit, veg, meat, rice…), create your own foods from a label,
   or quick-add a restaurant meal.
2. **Spot IBS triggers** — every food's name and ingredient list is scanned for common triggers, and your symptom
   log is compared against what you ate to show which triggers (and which specific foods) are most often
   followed by symptoms.
3. **Hit weight goals** — set a goal weight and weekly rate; it calculates calories and macros, then tracks your
   weight trend on a timeline with a projection to your goal.

## Features

**Diary**
- Breakfast / lunch / dinner / snacks, with time of eating (used by the IBS analysis)
- Calories, protein, carbs, fat, fibre, sugars, saturates and salt vs. your targets
- Log portions however you measured them: the food's own serving sizes (slice, bar, glass…), slices of a whole
  ("3 of 8"), part of the whole (¼, ½…), weight (g, kg, oz, lb) or volume (ml, litres, tsp, tbsp, cups, fl oz, pints)
- Create foods as solids (per 100 g) or drinks (per 100 ml), enter label values per 100 or per serving, and add
  as many named serving sizes as you like; a cup/tbsp/tsp size makes volume logging accurate for that food
- "Copy yesterday's" for repeat meals; recent foods & "My foods" for fast re-logging
- Barcode lookup (type the number, or scan with the camera on browsers that support it — e.g. Chrome on Android)

**Gut / IBS**
- Automatic flags for: Fructans (wheat, onion, garlic, inulin…), GOS (beans, lentils, chickpeas), Lactose,
  Excess fructose (honey, apple, HFCS…), Polyols (sorbitol, mushrooms, stone fruit…), Caffeine, Alcohol,
  Chilli, Artificial sweeteners, Gums & emulsifiers, Fizzy drinks, High-fat meals (≥ 20 g fat)
- Handles common false positives (coconut/oat milk, lactose-free, buckwheat, garlic-infused oil, decaf,
  wine vinegar, ginger ale, pineapple…)
- Add your own personal triggers with keywords
- Symptom log: symptom types, 0–10 severity, Bristol stool scale, notes; a one-tap "felt fine today"
- Trigger analysis: for every meal, finds the worst symptom in the next N hours (default 24, adjustable) and
  compares meals with vs. without each trigger → "Likely trigger / Possible / No clear link / Seems fine",
  with sample sizes. The same is done per individual food. Meals with nothing logged afterwards (not even
  "felt fine") are skipped rather than counted as symptom-free.

**Goals & progress**
- Mifflin-St Jeor BMR × activity level → maintenance; deficit/surplus from your weekly rate (7,700 kcal/kg)
- Protein 2.0 g/kg when cutting, 1.8 when gaining, 1.6 to maintain; fat 25%; carbs fill the rest
  (all overridable), plus fibre, saturated fat, salt and free-sugar guidance; safety warnings for aggressive rates
- Smoothed weight trend (ignores day-to-day water swings), 4-week rate, goal ETA
- Timeline chart with goal line & projected plan; body composition (lean vs. fat mass) if you log body-fat %;
  waist; daily calories & protein vs. target
- **Adaptive maintenance**: after ~2 weeks of logging, estimates your *real* maintenance calories from
  intake vs. weight change — one tap to use it
- kg, lb or stone & pounds

**Your data**
- Stored only in your browser (localStorage). Export/import a JSON backup, or export your diary as CSV.
- Installable as an app (PWA) and the app itself works offline (food search needs internet).

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
js/foods.js           Open Food Facts client + built-in basic foods
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
lab-tested serving sizes.
