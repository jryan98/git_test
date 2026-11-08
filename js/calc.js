/*
 * calc.js — energy, macro and weight-trend maths.
 * Pure functions, no DOM. Works in the browser (window.Calc) and Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KCAL_PER_KG = 7700; // approx energy in 1 kg of body fat
  const DAY_MS = 86400000;

  const ACTIVITY = {
    sedentary: { factor: 1.2, label: 'Sedentary — desk job, little exercise' },
    light: { factor: 1.375, label: 'Lightly active — exercise 1–3 days/week' },
    moderate: { factor: 1.55, label: 'Moderately active — exercise 3–5 days/week' },
    very: { factor: 1.725, label: 'Very active — hard exercise 6–7 days/week' },
    extra: { factor: 1.9, label: 'Extremely active — physical job + training' },
  };

  const NUTRIENTS = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt'];

  // ---------- dates ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY_MS); }

  function ageFromBirthDate(birthDate, today) {
    if (!birthDate) return null;
    const b = parseDate(birthDate);
    const t = today ? parseDate(today) : new Date();
    let age = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
    return age;
  }

  // ---------- energy ----------
  /** Mifflin–St Jeor basal metabolic rate (kcal/day). */
  function bmr({ sex, weightKg, heightCm, age }) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === 'female' ? base - 161 : base + 5;
  }

  function tdee(p) {
    const a = ACTIVITY[p.activity] || ACTIVITY.sedentary;
    return bmr(p) * a.factor;
  }

  function bmi(weightKg, heightCm) {
    const m = heightCm / 100;
    return weightKg / (m * m);
  }

  function goalDirection(currentKg, goalKg) {
    if (goalKg == null || isNaN(goalKg)) return 'maintain';
    if (goalKg < currentKg - 0.25) return 'lose';
    if (goalKg > currentKg + 0.25) return 'gain';
    return 'maintain';
  }

  /**
   * Daily targets from a profile and current weight.
   * profile: { sex, heightCm, age, activity, goalWeightKg, rateKgPerWeek,
   *            proteinPerKg?, fatPct?, calorieOverride?, tdeeOverride? }
   */
  function targets(profile, weightKg) {
    const warnings = [];
    const p = Object.assign({}, profile, { weightKg });
    const b = bmr(p);
    const formulaTdee = tdee(p);
    const maintenance = profile.tdeeOverride > 0 ? profile.tdeeOverride : formulaTdee;
    const dir = goalDirection(weightKg, profile.goalWeightKg);
    const rate = Math.abs(Number(profile.rateKgPerWeek) || 0);
    const sign = dir === 'lose' ? -1 : dir === 'gain' ? 1 : 0;
    const dailyDelta = sign * rate * KCAL_PER_KG / 7;

    let calories = maintenance + dailyDelta;
    const floor = profile.sex === 'female' ? 1200 : 1500;
    if (calories < floor) {
      warnings.push(`That rate puts you under ${floor} kcal/day — target raised to ${floor}. Consider a slower rate.`);
      calories = floor;
    }
    if (dir === 'lose' && rate > weightKg * 0.01) {
      warnings.push('Losing more than ~1% of body weight per week risks muscle loss.');
    }
    if (dir === 'gain' && rate > 0.5) {
      warnings.push('Gaining faster than ~0.5 kg/week usually adds mostly fat.');
    }
    if (profile.calorieOverride > 0) calories = profile.calorieOverride;

    // Protein reference weight: for higher BMI use a weight at BMI 27 to avoid silly numbers.
    const h = profile.heightCm / 100;
    const refWeight = bmi(weightKg, profile.heightCm) > 30 ? 27 * h * h : weightKg;
    const defaultProtein = { lose: 2.0, maintain: 1.6, gain: 1.8 }[dir];
    const proteinPerKg = profile.proteinPerKg > 0 ? profile.proteinPerKg : defaultProtein;
    const protein = proteinPerKg * refWeight;

    const fatPct = profile.fatPct > 0 ? profile.fatPct : 25;
    let fat = (calories * fatPct / 100) / 9;
    fat = Math.max(fat, 0.6 * refWeight);

    let carbs = (calories - protein * 4 - fat * 9) / 4;
    if (carbs < 50) {
      warnings.push('Protein + fat leave very little room for carbs at this calorie level.');
      carbs = Math.max(carbs, 0);
    }
    const fiber = Math.max(25, Math.round(calories / 1000 * 14));

    let weeksToGoal = null, goalDate = null;
    if (sign !== 0 && rate > 0) {
      weeksToGoal = Math.abs(profile.goalWeightKg - weightKg) / rate;
      const d = new Date();
      d.setDate(d.getDate() + Math.round(weeksToGoal * 7));
      goalDate = isoDate(d);
    }

    return {
      bmr: Math.round(b),
      tdee: Math.round(maintenance),
      formulaTdee: Math.round(formulaTdee),
      direction: dir,
      dailyDelta: Math.round(dailyDelta),
      calories: Math.round(calories),
      protein: Math.round(protein),
      fat: Math.round(fat),
      carbs: Math.round(carbs),
      fiber,
      sugarMax: Math.round(calories * 0.05 / 4), // free sugars ≤5% energy (UK guidance)
      satFatMax: Math.round(calories * 0.10 / 9),
      saltMax: 6,
      bmi: Math.round(bmi(weightKg, profile.heightCm) * 10) / 10,
      weeksToGoal: weeksToGoal == null ? null : Math.round(weeksToGoal * 10) / 10,
      goalDate,
      warnings,
    };
  }

  // ---------- nutrients ----------
  function emptyNutrients() { const o = {}; NUTRIENTS.forEach(k => { o[k] = 0; }); return o; }

  function nutrientsFor(per100, grams) {
    const o = emptyNutrients();
    const f = (Number(grams) || 0) / 100;
    NUTRIENTS.forEach(k => { o[k] = (Number(per100 && per100[k]) || 0) * f; });
    return o;
  }

  function sumNutrients(list) {
    const o = emptyNutrients();
    list.forEach(n => NUTRIENTS.forEach(k => { o[k] += Number(n[k]) || 0; }));
    return o;
  }

  function entryNutrients(entry) {
    if (entry.quick) return Object.assign(emptyNutrients(), entry.quick);
    return nutrientsFor(entry.food && entry.food.per100, entry.grams);
  }

  // ---------- weight trend ----------
  /**
   * Exponentially smoothed trend that copes with irregular weigh-ins.
   * weights: [{date, kg}] any order. Returns sorted [{date, kg, trend}].
   */
  function weightTrend(weights, alpha) {
    alpha = alpha || 0.1;
    const sorted = weights.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let prev = null, prevDate = null;
    return sorted.map(w => {
      let t;
      if (prev == null) t = w.kg;
      else {
        const gap = Math.max(1, daysBetween(prevDate, w.date));
        const a = 1 - Math.pow(1 - alpha, gap);
        t = prev + a * (w.kg - prev);
      }
      prev = t; prevDate = w.date;
      return { date: w.date, kg: w.kg, trend: t };
    });
  }

  /** Least-squares slope of points [{date, y}] in units per week. */
  function slopePerWeek(points) {
    if (points.length < 2) return null;
    const x0 = points[0].date;
    const xs = points.map(p => daysBetween(x0, p.date));
    const ys = points.map(p => p.y);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    if (den === 0) return null;
    return num / den * 7;
  }

  /** Rate of change of the trend over the last `days` days (kg/week). */
  function recentRate(trendSeries, days, today) {
    days = days || 28;
    if (!trendSeries.length) return null;
    const end = today || trendSeries[trendSeries.length - 1].date;
    const start = addDays(end, -days);
    const pts = trendSeries.filter(p => p.date >= start && p.date <= end).map(p => ({ date: p.date, y: p.trend }));
    if (pts.length < 3 || daysBetween(pts[0].date, pts[pts.length - 1].date) < 7) return null;
    return slopePerWeek(pts);
  }

  /**
   * Estimate real-world maintenance calories from intake vs trend change.
   * dailyKcal: { 'YYYY-MM-DD': kcal } — only days you actually logged.
   * Requires ≥14 logged days and weigh-ins spanning ≥14 days in the window.
   */
  function adaptiveTdee(dailyKcal, trendSeries, days, today) {
    days = days || 28;
    if (trendSeries.length < 2) return null;
    const end = today || isoDate(new Date());
    const start = addDays(end, -days);
    const logged = Object.keys(dailyKcal).filter(d => d >= start && d <= end && dailyKcal[d] > 0);
    if (logged.length < 14) return null;
    const pts = trendSeries.filter(p => p.date >= start && p.date <= end);
    if (pts.length < 2) return null;
    const span = daysBetween(pts[0].date, pts[pts.length - 1].date);
    if (span < 14) return null;
    const slope = slopePerWeek(pts.map(p => ({ date: p.date, y: p.trend }))); // kg/week
    const avgIntake = logged.reduce((s, d) => s + dailyKcal[d], 0) / logged.length;
    return {
      tdee: Math.round(avgIntake - slope * KCAL_PER_KG / 7),
      avgIntake: Math.round(avgIntake),
      kgPerWeek: Math.round(slope * 100) / 100,
      loggedDays: logged.length,
    };
  }

  // ---------- units ----------
  const KG_PER_LB = 0.45359237;
  function formatWeight(kg, unit) {
    if (kg == null || isNaN(kg)) return '—';
    if (unit === 'lb') return (kg / KG_PER_LB).toFixed(1) + ' lb';
    if (unit === 'st') {
      const lb = kg / KG_PER_LB;
      let st = Math.floor(lb / 14), rem = Math.round((lb - st * 14) * 10) / 10;
      if (rem >= 14) { st += 1; rem = 0; }
      return st + ' st ' + rem.toFixed(1).replace(/\.0$/, '') + ' lb';
    }
    return kg.toFixed(1) + ' kg';
  }
  function toDisplayNumber(kg, unit) { return unit === 'kg' ? kg : kg / KG_PER_LB; }
  function fromDisplayNumber(v, unit) { return unit === 'kg' ? v : v * KG_PER_LB; }

  return {
    KCAL_PER_KG, ACTIVITY, NUTRIENTS, KG_PER_LB,
    isoDate, parseDate, addDays, daysBetween, ageFromBirthDate,
    bmr, tdee, bmi, goalDirection, targets,
    emptyNutrients, nutrientsFor, sumNutrients, entryNutrients,
    weightTrend, slopePerWeek, recentRate, adaptiveTdee,
    formatWeight, toDisplayNumber, fromDisplayNumber,
  };
});
