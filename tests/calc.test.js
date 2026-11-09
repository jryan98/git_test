const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

test('Mifflin-St Jeor BMR', () => {
  assert.equal(Math.round(C.bmr({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 })), 1780);
  assert.equal(Math.round(C.bmr({ sex: 'female', weightKg: 60, heightCm: 165, age: 30 })), 1320);
});

test('targets: deficit, macros add up, goal date', () => {
  const t = C.targets({ sex: 'male', heightCm: 180, age: 30, activity: 'moderate', goalWeightKg: 75, rateKgPerWeek: 0.5 }, 80);
  assert.equal(t.direction, 'lose');
  assert.equal(t.tdee, Math.round(1780 * 1.55));
  assert.equal(t.calories, Math.round(1780 * 1.55 - 550));
  assert.equal(t.protein, 160); // 2.0 g/kg when cutting
  const kcalFromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  assert.ok(Math.abs(kcalFromMacros - t.calories) < 15);
  assert.equal(t.weeksToGoal, 10);
});

test('targets: calorie floor and warnings', () => {
  const t = C.targets({ sex: 'female', heightCm: 155, age: 50, activity: 'sedentary', goalWeightKg: 50, rateKgPerWeek: 1 }, 60);
  assert.equal(t.calories, 1200);
  assert.ok(t.warnings.length >= 1);
});

test('targets: gain and maintain', () => {
  const g = C.targets({ sex: 'male', heightCm: 175, age: 25, activity: 'light', goalWeightKg: 80, rateKgPerWeek: 0.25 }, 70);
  assert.equal(g.direction, 'gain');
  assert.ok(g.calories > g.tdee);
  const m = C.targets({ sex: 'male', heightCm: 175, age: 25, activity: 'light', goalWeightKg: 70, rateKgPerWeek: 0.5 }, 70);
  assert.equal(m.direction, 'maintain');
  assert.equal(m.calories, m.tdee);
});

test('nutrientsFor scales per-100g values', () => {
  const n = C.nutrientsFor({ kcal: 200, protein: 10 }, 150);
  assert.equal(n.kcal, 300);
  assert.equal(n.protein, 15);
  assert.equal(n.fat, 0);
});

test('weight trend smooths noise and handles gaps', () => {
  const w = [{ date: '2026-01-01', kg: 80 }, { date: '2026-01-02', kg: 82 }, { date: '2026-01-12', kg: 78 }];
  const t = C.weightTrend(w);
  assert.equal(t[0].trend, 80);
  assert.ok(Math.abs(t[1].trend - 80.2) < 1e-9);
  assert.ok(t[2].trend < t[1].trend && t[2].trend > 78); // bigger step after a 10-day gap
});

test('recentRate & adaptive TDEE', () => {
  const weights = [], kcal = {};
  for (let i = 0; i <= 28; i++) {
    const d = C.addDays('2026-03-01', i);
    weights.push({ date: d, kg: 90 - i * (0.5 / 7) }); // −0.5 kg/week
    kcal[d] = 2000;
  }
  const tr = C.weightTrend(weights, 1); // alpha 1 = raw
  const rate = C.recentRate(tr, 28, '2026-03-29');
  assert.ok(Math.abs(rate + 0.5) < 1e-6);
  const a = C.adaptiveTdee(kcal, tr, 28, '2026-03-29');
  assert.equal(a.tdee, 2550);
});

test('weight formatting', () => {
  assert.equal(C.formatWeight(80, 'kg'), '80.0 kg');
  assert.equal(C.formatWeight(63.5029, 'st'), '10 st 0 lb');
  assert.equal(C.formatWeight(45.359237, 'lb'), '100.0 lb');
  assert.equal(C.formatWeight(0.5, 'st'), '1.1 lb'); // small amounts in stone mode read as pounds
});

test('age from birth date', () => {
  assert.equal(C.ageFromBirthDate('1998-06-15', '2026-06-14'), 27);
  assert.equal(C.ageFromBirthDate('1998-06-15', '2026-06-15'), 28);
});

test('adaptive TDEE ignores the unfinished current day', () => {
  const w = [], k = {};
  for (let i = 28; i >= 0; i--) { const d = C.addDays('2026-05-29', -i); w.push({ date: d, kg: 80 }); k[d] = 2500; }
  k['2026-05-29'] = 300; // only breakfast logged so far today
  assert.equal(C.adaptiveTdee(k, C.weightTrend(w), 28, '2026-05-29').tdee, 2500);
});

test('gaining: fat 30%, fibre 25–30 g, coach adjustment and healthy-rate warning', () => {
  const base = { sex: 'male', heightCm: 180, age: 25, activity: 'moderate', goalWeightKg: 70, rateKgPerWeek: 0.25 };
  const t = C.targets(base, 62);
  assert.equal(t.direction, 'gain');
  assert.ok(Math.abs(t.fat * 9 / t.calories - 0.30) < 0.02);
  assert.ok(t.fiber >= 25 && t.fiber <= 30);
  assert.equal(t.warnings.length, 0);
  const adj = C.targets(Object.assign({}, base, { calorieAdjust: 150 }), 62);
  assert.equal(adj.calories, t.calories + 150);
  const fast = C.targets(Object.assign({}, base, { rateKgPerWeek: 0.75 }), 62);
  assert.ok(fast.warnings.some(w => /fat than muscle/.test(w)));
});

test('coach compares the 3-week trend with the plan', () => {
  const mk = perWeek => C.weightTrend(Array.from({ length: 22 }, (_, i) => ({ date: C.addDays('2026-06-01', i), kg: 60 + i * perWeek / 7 })), 1);
  const plan = { goalWeightKg: 70, rateKgPerWeek: 0.25 };
  assert.equal(C.coach(mk(0.25), plan, '2026-06-22').status, 'on-track');
  const slow = C.coach(mk(0.05), plan, '2026-06-22');
  assert.equal(slow.status, 'too-slow');
  assert.ok(slow.kcalChange > 150 && slow.kcalChange <= 300);
  assert.equal(C.coach(mk(-0.2), plan, '2026-06-22').status, 'losing');
  const fast = C.coach(mk(0.7), plan, '2026-06-22');
  assert.equal(fast.status, 'too-fast');
  assert.ok(fast.kcalChange < 0);
  assert.equal(C.coach(mk(0.25).slice(0, 8), plan, '2026-06-08'), null); // not enough data yet
});

test('weekly rates keep two decimals in kg', () => {
  assert.equal(C.formatRate(0.25, 'kg'), '0.25 kg');
  assert.equal(C.formatRate(0.35, 'kg'), '0.35 kg');
  assert.equal(C.formatRate(0.05, 'kg'), '0.05 kg');
  assert.equal(C.formatRate(0.25, 'st'), '0.6 lb');
});
