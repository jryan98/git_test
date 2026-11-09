/* app.js — UI. Plain DOM, no framework. */
(function () {
  'use strict';
  const C = window.Calc, S = window.Store, I = window.IBS, F = window.Foods, Units = window.Units;

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const today = () => C.isoDate(new Date());
  const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const r0 = n => Math.round(n || 0);
  const r1 = n => Math.round((n || 0) * 10) / 10;
  const fmtInt = n => r0(n).toLocaleString('en-GB');
  // Six eating slots: smaller, more frequent meals help both weight gain and an IBS gut.
  const MEALS = [['breakfast', 'Breakfast'], ['morning', 'Mid-morning'], ['lunch', 'Lunch'], ['snacks', 'Afternoon snack'],
    ['dinner', 'Dinner'], ['supper', 'Supper']];
  const MEAL_NAME = Object.fromEntries(MEALS);
  const NUT_LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', sugar: 'of which sugars', fat: 'Fat', satFat: 'of which saturates', fiber: 'Fibre', salt: 'Salt' };
  const NUT_UNIT = { kcal: 'kcal' };
  const unitOf = k => NUT_UNIT[k] || 'g';

  function prettyDate(iso) {
    const t = today();
    if (iso === t) return 'Today';
    if (iso === C.addDays(t, -1)) return 'Yesterday';
    if (iso === C.addDays(t, 1)) return 'Tomorrow';
    return C.parseDate(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: C.parseDate(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  const state = { date: today(), range: 90, addTab: 'search' };
  const searchCache = new Map(), searchTimes = [];
  const D = () => S.data;
  const unit = () => D().profile.unit || 'kg';
  const fmtW = kg => C.formatWeight(kg, unit());

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const sizeText = chars => chars < 1048576 ? Math.max(1, Math.round(chars / 1024)) + ' KB' : (chars / 1048576).toFixed(1) + ' MB';
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (currentView() === 'settings') render(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; render(); });
  const isStandalone = () => window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (_) { /* dismissed */ }
    installPrompt = null; render();
  }

  function categories() { return I.allCategories(D().triggers.custom); }
  // Ingredient lists are stored once per food in the library (not copied into every diary entry) to save space.
  function fullFood(entry) {
    const f = entry.food || { name: entry.name };
    if (f.ingredients || !f.id || !D().foods[f.id]) return f;
    return Object.assign({}, f, { ingredients: D().foods[f.id].ingredients || '' });
  }
  function triggersFor(entry) { return I.detect(fullFood(entry), C.entryNutrients(entry), categories()); }
  function trend() { return C.weightTrend(D().weights); }
  function currentWeight() { const t = trend(); return t.length ? t[t.length - 1].trend : null; }
  function profileProblem() {
    const p = D().profile;
    const missing = [!p.birthDate && 'date of birth', !p.heightCm && 'height'].filter(Boolean);
    if (missing.length) return 'Enter your ' + missing.join(' and ') + '.';
    const age = C.ageFromBirthDate(p.birthDate);
    if (!(age >= 13 && age <= 110)) return 'Check your date of birth — the calculations are for ages 13 to 110.';
    if (!(p.heightCm >= 100 && p.heightCm <= 250)) return 'Check your height — it should be between 100 and 250 cm (3 ft 3 in – 8 ft 2 in).';
    return '';
  }
  function profileComplete() { return !profileProblem(); }
  function profileWithAge() { const p = D().profile; return Object.assign({}, p, { age: C.ageFromBirthDate(p.birthDate) || 30 }); }
  function currentTargets() {
    const w = currentWeight();
    if (w == null || !profileComplete()) return null;
    return C.targets(profileWithAge(), w);
  }
  function dailyKcal() {
    const out = {};
    D().log.forEach(e => { out[e.date] = (out[e.date] || 0) + C.entryNutrients(e).kcal; });
    return out;
  }
  function chips(trigs, small) {
    const sus = trigs.length ? analysisAll().suspectCats : new Map();
    return trigs.map(t => {
      const mine = t.id && sus.has(t.id);
      const cls = mine ? 'suspect' : t.group === 'FODMAP' ? 'fodmap' : t.group === 'Personal' ? 'personal' : '';
      const title = (mine ? 'Your ' + sus.get(t.id).toLowerCase() + '. ' : '') + (t.matches || []).join(', ');
      return `<span class="chip ${small ? 'sm' : ''} ${cls}" title="${esc(title)}">${mine ? '⚠ ' : ''}${esc(t.name)}</span>`;
    }).join('');
  }
  S.onChange(() => { analysisCache.key = ''; });
  function meter(value, target, kind) {
    if (!target) return '';
    const pct = Math.min(100, value / target * 100);
    const over = value > target;
    const cls = kind === 'limit' ? (over ? 'warn' : '') : kind === 'min' ? (value >= target ? 'good' : '') : (over && value > target * 1.1 ? 'warn' : '');
    return `<div class="meter ${cls}"><span style="width:${pct}%"></span></div>`;
  }

  // ---------- weight input in the user's unit ----------
  function weightInput(name, kg) {
    const u = unit();
    if (u === 'st') {
      const lb = kg != null ? kg / C.KG_PER_LB : null;
      const st = lb != null ? Math.floor(lb / 14) : '';
      const rem = lb != null ? r1(lb - st * 14) : '';
      return `<span class="inline"><input type="number" name="${name}_st" min="0" step="1" value="${st}" inputmode="numeric" aria-label="stone"> st
        <input type="number" name="${name}_lb" min="0" max="13.9" step="0.1" value="${rem}" inputmode="decimal" aria-label="pounds"> lb</span>`;
    }
    const v = kg != null ? r1(C.toDisplayNumber(kg, u)) : '';
    return `<span class="inline"><input type="number" name="${name}" min="0" step="0.1" value="${v}" inputmode="decimal"> ${u}</span>`;
  }
  function readWeight(form, name) {
    const u = unit();
    if (u === 'st') {
      const st = parseFloat(form[name + '_st'].value), lb = parseFloat(form[name + '_lb'].value) || 0;
      if (isNaN(st) && !lb) return null;
      return ((st || 0) * 14 + lb) * C.KG_PER_LB;
    }
    const v = parseFloat(form[name].value);
    return isNaN(v) ? null : C.fromDisplayNumber(v, u);
  }

  // ---------- modal ----------
  const modal = $('#modal'), modalBody = $('#modal-body');
  let modalCleanup = null;
  function openModal(html, onMount) {
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    // fresh container each time so listeners from the previous screen don't pile up
    const inner = document.createElement('div');
    inner.innerHTML = `<button class="close" data-close aria-label="Close">×</button>` + html;
    modalBody.replaceChildren(inner);
    if (!modal.open) modal.showModal();
    if (onMount) modalCleanup = onMount(inner) || null;
  }
  function closeModal() {
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    if (modal.open) modal.close();
  }
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target === modal) { // the backdrop and the dialog's own padding both report the dialog as target
      const r = modal.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal();
    }
  });
  modal.addEventListener('close', () => { if (modalCleanup) { modalCleanup(); modalCleanup = null; } });

  // ---------- routing ----------
  const VIEWS = { diary: renderDiary, progress: renderProgress, gut: renderGut, goals: renderGoals, settings: renderSettings };
  function currentView() { const h = location.hash.slice(1); return VIEWS[h] ? h : 'diary'; }
  function render() {
    const v = currentView();
    $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === v));
    $('#topbar-extra').innerHTML = '';
    VIEWS[v]($('#view'));
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  // ---------- personal gut profile (from the trigger analysis) ----------
  let analysisCache = { key: '', value: null };
  /** Trigger + per-food analysis, cached until the diary, symptoms or settings change. */
  function analysisAll() {
    const opts = D().triggers.analysis;
    const key = [D().log.length, D().symptoms.length, JSON.stringify(D().triggers), D().log.length && D().log[D().log.length - 1].id,
      D().symptoms.length && D().symptoms[D().symptoms.length - 1].id, today()].join('|');
    if (analysisCache.key === key) return analysisCache.value;
    const cats = categories();
    const enriched = D().log.map(e => ({ date: e.date, time: e.time, meal: e.meal, triggers: triggersFor(e), name: e.food ? e.food.name : '', entry: e }));
    const res = I.analyse(enriched, D().symptoms, Object.assign({ categories: cats }, opts));
    const counts = {};
    enriched.forEach(e => { if (e.name) counts[e.name] = (counts[e.name] || 0) + 1; });
    const foodCats = Object.keys(counts).filter(n => counts[n] >= 3).map(n => ({ id: 'food:' + n, name: n }));
    const foodAll = I.analyse(enriched.map(e => Object.assign({}, e, { triggers: e.name ? [{ id: 'food:' + e.name }] : [] })), D().symptoms,
      Object.assign({}, opts, { categories: foodCats })).results;
    const isSuspect = r => (r.verdict === 'Likely trigger' || r.verdict === 'Possible trigger');
    const suspectCats = new Map(res.results.filter(isSuspect).map(r => [r.id, r.verdict]));
    const suspectFoods = new Map(foodAll.filter(r => isSuspect(r) && r.exposedBad > 0).map(r => [r.name.toLowerCase(), r]));
    // gut-safe: eaten often, followed by symptoms no more than other meals, and free of your suspect triggers
    const lastEntry = {};
    enriched.forEach(e => { if (e.name && !e.entry.quick) lastEntry[e.name] = e.entry; });
    const safe = foodAll
      .filter(r => r.exposures >= 4 && r.unexposed >= 4 && r.rateExposed <= r.rateUnexposed && lastEntry[r.name])
      .map(r => ({ r, food: fullFood(lastEntry[r.name]) }))
      .filter(x => !triggersFor(lastEntry[x.r.name]).some(t => suspectCats.has(t.id)))
      .sort((a, b) => b.r.exposures - a.r.exposures)
      .slice(0, 10);
    const value = { res, foodAll, foodRes: foodAll.filter(r => r.exposures >= 3 && r.relativeRisk >= 1.4 && r.exposedBad > 0).slice(0, 8), suspectCats, suspectFoods, safe };
    analysisCache = { key, value };
    return value;
  }

  // ---------- top-up ideas ----------
  /** A few energy-dense, gut-friendly ideas that fit the calories still to go and avoid your suspects. */
  function topUpIdeas(remaining, proteinShort) {
    const prof = analysisAll();
    const ok = F.BOOSTERS.filter(b => {
      const n = C.nutrientsFor(b.food.per100, b.amount);
      if (prof.suspectFoods.has(b.food.name.toLowerCase())) return false;
      return !I.detect(b.food, n, categories()).some(t => prof.suspectCats.has(t.id));
    }).map(b => Object.assign({}, b, { n: C.nutrientsFor(b.food.per100, b.amount) }))
      .filter(b => b.n.kcal <= remaining + 120);
    if (proteinShort > 20) ok.sort((a, b) => b.n.protein / b.n.kcal - a.n.protein / a.n.kcal);
    // rotate through the list day by day so the ideas don't go stale
    const start = (C.daysBetween('2026-01-01', state.date) % Math.max(1, ok.length) + ok.length) % Math.max(1, ok.length);
    const rotated = proteinShort > 20 ? ok : ok.slice(start).concat(ok.slice(0, start));
    return rotated.slice(0, 3);
  }
  function mealForNow() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    return h < 10 ? 'breakfast' : h < 11.75 ? 'morning' : h < 14.5 ? 'lunch' : h < 17.5 ? 'snacks' : h < 20.5 ? 'dinner' : 'supper';
  }

  // ---------- weekly coach ----------
  function coachAdvice() {
    const t = currentTargets();
    if (!t) return null;
    const c = C.coach(trend(), D().profile, today());
    if (!c) return null;
    const rate = v => (v > 0 ? '+' : v < 0 ? '−' : '') + C.formatRate(Math.abs(v), unit()) + '/wk';
    const msg = {
      'on-track': `You're gaining ${rate(c.actualRate)} — right on plan. Keep doing what you're doing.`,
      'too-slow': `You're gaining ${rate(c.actualRate)} against a plan of ${rate(c.plannedRate)}.`,
      'losing': `You've been losing weight (${rate(c.actualRate)}) while aiming to gain ${rate(c.plannedRate)}.`,
      'too-fast': `You're gaining ${rate(c.actualRate)} — faster than the ${rate(c.plannedRate)} plan, which tends to add more fat than muscle.`,
      'gaining': `You've been gaining (${rate(c.actualRate)}) while aiming to lose.`,
    }[c.status];
    if (c.direction === 'maintain') return null;
    if (c.direction === 'lose' && c.status === 'on-track') return Object.assign(c, { msg: `You're losing ${rate(c.actualRate)} — on plan.` });
    return Object.assign(c, { msg });
  }
  function coachCard(compact) {
    const c = coachAdvice();
    if (!c) return '';
    const applied = D().meta.coachAppliedOn && C.daysBetween(D().meta.coachAppliedOn, today()) < 7;
    if (compact && (c.status === 'on-track' || applied)) return '';
    const sign = c.kcalChange > 0 ? '+' : '−';
    return `<section class="card coach ${c.status}">
      <h2>${c.status === 'on-track' ? '✅ Weekly check-in' : '📈 Weekly check-in'}</h2>
      <p>${esc(c.msg)}</p>
      ${c.kcalChange ? `<p>Suggested: <b>${sign}${Math.abs(c.kcalChange)} kcal a day</b>${c.kcalChange > 0 ? ' — an extra snack or a top-up idea below covers it.' : '.'}</p>
        ${applied ? `<p class="muted small">You adjusted your target ${(n => n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago')(C.daysBetween(D().meta.coachAppliedOn, today()))} — give it a week to show on the scales.</p>`
          : `<div class="row-actions"><button class="btn" data-act="apply-coach" data-kcal="${c.kcalChange}">Update my target</button></div>`}` : ''}
      <p class="muted small">Based on your weight trend over the last ${c.days} days. Weigh in most mornings for the best read.</p>
    </section>`;
  }

  // =====================================================================
  // DIARY
  // =====================================================================
  const GUT_FACES = [[0, '😀', 'Calm'], [2, '🙂', 'Mild'], [4, '😐', 'Uneasy'], [6, '😣', 'Bad'], [8, '😫', 'Severe']];

  function renderDiary(root) {
    const d = state.date;
    const entries = D().log.filter(e => e.date === d);
    const tot = C.sumNutrients(entries.map(C.entryNutrients));
    const t = currentTargets();
    const gaining = t && t.direction === 'gain';
    const symptoms = D().symptoms.filter(s => s.date === d).sort((a, b) => a.time < b.time ? -1 : 1);
    const weighIn = D().weights.find(w => w.date === d);
    const isToday = d === today();

    $('#topbar-extra').innerHTML = `
      <div class="datenav">
        <button class="icon" data-act="prev-day" aria-label="Previous day">‹</button>
        <label class="datepick"><span>${esc(prettyDate(d))}</span><input type="date" id="pick-date" value="${d}"></label>
        <button class="icon" data-act="next-day" aria-label="Next day">›</button>
      </div>`;

    // aggregate triggers for the day
    const dayTrig = new Map();
    entries.forEach(e => triggersFor(e).forEach(tr => {
      if (!dayTrig.has(tr.id)) dayTrig.set(tr.id, Object.assign({}, tr, { foods: [] }));
      dayTrig.get(tr.id).foods.push(e.food ? e.food.name : 'Quick add');
    }));

    // ---- gut check-in ----
    const worst = symptoms.reduce((m, s) => Math.max(m, s.severity), 0);
    const gutHTML = `
      <section class="card gut-today">
        <header><h2>Gut ${isToday ? 'today' : 'this day'}</h2>${symptoms.length ? `<span class="sev sev-${sevBand(worst)}">worst ${worst}/10</span>` : ''}</header>
        ${symptoms.length ? `<ul class="entries">${symptoms.map(s => `
          <li><button class="entry" data-act="edit-symptom" data-id="${s.id}">
            <span class="e-main"><span class="e-name">${esc(s.types.length ? s.types.join(', ') : 'Felt fine')}</span>
            <span class="muted small">${s.time}${s.bristol ? ' · Bristol ' + s.bristol : ''}${s.notes ? ' · ' + esc(s.notes) : ''}</span></span>
            <span class="sev sev-${sevBand(s.severity)}">${s.severity}/10</span>
          </button></li>`).join('')}</ul>
          <div class="row-actions"><button class="btn ghost" data-act="add-symptom">+ Log another</button></div>`
        : `<p class="muted small">How's your gut ${isToday ? 'feeling' : 'been'}? One tap — logging calm days matters as much as bad ones.</p>
          <div class="faces">${GUT_FACES.map(([sev, face, label]) => `<button class="face" data-act="checkin" data-sev="${sev}"><span>${face}</span>${label}</button>`).join('')}</div>`}
      </section>`;

    // ---- fuel summary ----
    let summary;
    if (t) {
      const remaining = t.calories - tot.kcal;
      const reached = remaining <= 0;
      const right = gaining
        ? `<div class="rem ${reached ? 'done' : ''}"><div class="big">${reached ? '✓' : fmtInt(remaining)}</div><div class="muted">${reached ? (remaining < -50 ? fmtInt(-remaining) + ' over — great' : 'target reached') : 'to go'}</div></div>`
        : `<div class="rem ${remaining < 0 ? 'over' : ''}"><div class="big">${fmtInt(Math.abs(remaining))}</div><div class="muted">${remaining < 0 ? 'over' : 'left'}</div></div>`;
      summary = `
        <section class="card summary">
          <div class="kcal">
            <div><div class="big">${fmtInt(tot.kcal)}</div><div class="muted">eaten</div></div>
            <div class="op">/</div>
            <div><div class="big soft">${fmtInt(t.calories)}</div><div class="muted">${gaining ? 'aim' : 'target'}</div></div>
            ${right}
          </div>
          ${meter(tot.kcal, t.calories, gaining ? 'min' : undefined)}
          <div class="macros">
            ${macroRow('Protein', tot.protein, t.protein, 'min')}
            ${macroRow('Carbs', tot.carbs, t.carbs, gaining ? 'min' : undefined)}
            ${macroRow('Fat', tot.fat, t.fat, gaining ? 'min' : undefined)}
            ${macroRow('Fibre', tot.fiber, t.fiber, 'min')}
          </div>
          <details class="more"><summary>Sugar, saturates, salt</summary>
            <div class="macros">
              ${macroRow('Sugars', tot.sugar, null)}
              ${macroRow('Saturates', tot.satFat, t.satFatMax, 'limit', 'max')}
              ${macroRow('Salt', tot.salt, t.saltMax, 'limit', 'max')}
            </div>
            <p class="muted small">Sugar figure is total sugars from labels; the UK limit (≈${t.sugarMax} g/day for you) applies to added/free sugars only.</p>
          </details>
          ${gaining ? `<p class="muted small eat-often">${eatingNote(entries)}</p>` : ''}
        </section>`;
    } else {
      summary = `
        <section class="card summary">
          <div class="kcal"><div><div class="big">${fmtInt(tot.kcal)}</div><div class="muted">kcal eaten</div></div>
          <div class="macro-mini">P ${r0(tot.protein)} g · C ${r0(tot.carbs)} g · F ${r0(tot.fat)} g · Fibre ${r0(tot.fiber)} g</div></div>
          <p class="hint">Set up <a href="#goals">your goal</a> and log a weigh-in to get your daily calorie & protein aims.</p>
        </section>`;
    }

    // ---- top-up ideas (today, gaining, still short) ----
    let topUpHTML = '';
    if (t && gaining && isToday && t.calories - tot.kcal > 150) {
      const ideas = topUpIdeas(t.calories - tot.kcal, t.protein - tot.protein);
      if (ideas.length) topUpHTML = `
        <section class="card topup">
          <h2>Top-up ideas</h2>
          <p class="muted small">${fmtInt(t.calories - tot.kcal)} kcal to go. Energy-dense and gentle on the gut at these portions${analysisAll().suspectCats.size ? ' — anything with your suspected triggers is left out' : ''}.</p>
          <ul class="ideas">${ideas.map((b, i) => `<li><button class="idea" data-act="topup" data-i="${F.BOOSTERS.indexOf(F.BOOSTERS.find(x => x.food === b.food))}">
            <span class="e-main"><b>${esc(b.food.name)}</b><span class="muted small">${esc(b.how)}</span></span>
            <span class="e-kcal">+${fmtInt(b.n.kcal)}<small> kcal</small><br><small class="muted">P${r0(b.n.protein)}</small></span></button></li>`).join('')}</ul>
        </section>`;
    }

    const trigHTML = dayTrig.size ? `
      <section class="card">
        <h2>Possible IBS triggers ${isToday ? 'today' : 'this day'}</h2>
        <ul class="trig-list">
          ${Array.from(dayTrig.values()).map(tr => `<li>${chips([tr])}<span class="muted small">${esc(Array.from(new Set(tr.foods)).join(', '))}</span></li>`).join('')}
        </ul>
      </section>` : '';

    const MINOR = new Set(['morning', 'snacks', 'supper']);
    const mealsHTML = MEALS.map(([id, name]) => {
      const list = entries.filter(e => e.meal === id).sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1);
      const kcal = list.reduce((s, e) => s + C.entryNutrients(e).kcal, 0);
      const prevHas = D().log.some(e => e.date === C.addDays(d, -1) && e.meal === id);
      if (!list.length && MINOR.has(id)) {
        return `<section class="card meal compact"><header><h2>${name}</h2>
          <span class="row-actions">${prevHas ? `<button class="btn ghost subtle" data-act="copy-meal" data-meal="${id}" title="Copy yesterday's ${name.toLowerCase()}">↺ Yesterday</button>` : ''}
          <button class="btn ghost" data-act="add-food" data-meal="${id}">+ Add</button></span></header></section>`;
      }
      return `
        <section class="card meal">
          <header><h2>${name}</h2><span class="muted">${list.length ? fmtInt(kcal) + ' kcal' : ''}</span></header>
          <ul class="entries">
            ${list.map(e => {
              const n = C.entryNutrients(e);
              const tr = triggersFor(e);
              const pt = e.portion && !e.quick ? portionText(e.portion, e.food) : null;
              const amount = e.quick ? 'Quick add' : (pt ? pt + ' · ' : '') + r0(e.grams) + ' ' + Units.base(e.food);
              return `<li><button class="entry" data-act="edit-entry" data-id="${e.id}">
                <span class="e-main"><span class="e-name">${esc(e.food ? e.food.name : e.name)}</span>
                <span class="muted small">${esc(e.food && e.food.brand && e.food.brand !== 'Generic' ? e.food.brand + ' · ' : '')}${amount}${e.time ? ' · ' + e.time : ''}</span>
                ${tr.length || suspectFood(e.food) ? `<span class="e-chips">${suspectFood(e.food) ? '<span class="chip sm suspect">⚠ your suspect food</span>' : ''}${chips(tr, true)}</span>` : ''}</span>
                <span class="e-kcal">${fmtInt(n.kcal)}<small> kcal</small><br><small class="muted">${e.quick && !(n.protein || n.carbs || n.fat) ? 'kcal only' : `P${r0(n.protein)} C${r0(n.carbs)} F${r0(n.fat)}`}</small></span>
              </button></li>`;
            }).join('')}
          </ul>
          <div class="row-actions">
            <button class="btn ghost" data-act="add-food" data-meal="${id}">+ Add food</button>
            ${!list.length && prevHas ? `<button class="btn ghost subtle" data-act="copy-meal" data-meal="${id}">Copy yesterday's</button>` : ''}
          </div>
        </section>`;
    }).join('');

    const weightHTML = `
      <section class="card weigh">
        <header><h2>Weigh-in</h2>
        ${weighIn ? `<button class="link" data-act="edit-weight" data-id="${weighIn.id}">${fmtW(weighIn.kg)}${weighIn.bodyFat ? ' · ' + weighIn.bodyFat + '% fat' : ''}</button>`
          : `<button class="btn ghost" data-act="add-weight">+ Log weight</button>`}</header>
      </section>`;

    root.innerHTML = updateNotice() + backupNag() + (isToday ? coachCard(true) : '') + gutHTML + summary + topUpHTML + trigHTML + mealsHTML + weightHTML;
    $('#pick-date').addEventListener('change', e => { if (e.target.value) { state.date = e.target.value; render(); } });
  }

  /** Gaining with IBS: several smaller meals beat three big ones. */
  function eatingNote(entries) {
    const times = new Set(entries.map(e => e.meal));
    const n = times.size;
    if (n >= 5) return `🍽 ${n} eating occasions — great. Smaller, frequent meals are easier on the gut and on appetite.`;
    return `🍽 ${n} eating occasion${n === 1 ? '' : 's'} so far. Aim for 5–6 smaller ones — easier on the gut than a few big meals.`;
  }
  function suspectFood(food) {
    return !!(food && food.name && analysisAll().suspectFoods.has(food.name.toLowerCase()));
  }

  /** Gentle reminder once there's a couple of weeks of data and no backup in the last 14 days. */
  function backupNag() {
    const days = new Set(D().log.map(e => e.date)).size;
    if (days < 14) return '';
    const last = D().meta.lastBackup;
    if (last && C.daysBetween(last, today()) < 14) return '';
    return `<section class="card nag"><b>💾 Time for a backup</b>
      <p class="small">${last ? `Your last backup was ${C.daysBetween(last, today())} days ago.` : `You've logged ${days} days and haven't backed up yet.`}
      Your diary only lives on this phone — if it's lost or the browser data is cleared, it's gone.</p>
      <div class="row-actions"><button class="btn" data-act="backup-now">Back up now</button><a class="btn ghost" href="#settings">Settings</a></div></section>`;
  }
  function downloadFile(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function backupNow() {
    downloadFile(`gutfuel-backup-${today()}.json`, S.exportJSON(), 'application/json');
    D().meta.lastBackup = today(); S.save();
  }

  function macroRow(label, value, target, kind, word) {
    return `<div class="mrow"><span>${label}</span><span class="mval">${r0(value)}${target ? ` <span class="muted">/ ${word ? word + ' ' : ''}${target}</span>` : ''} g</span>${target ? meter(value, target, kind) : ''}</div>`;
  }
  function sevBand(s) { return s >= 7 ? 'high' : s >= 4 ? 'mid' : s > 0 ? 'low' : 'none'; }

  // ---------- add food ----------
  function openAddFood(meal, date) {
    const ctx = { meal, date: date || state.date };
    state.addTab = 'search'; // always start on Search; other tabs are one tap away
    const tabs = [['search', 'Search'], ['barcode', 'Barcode'], ['custom', 'Create food'], ['quick', 'Quick add']];
    openModal(`
      <h2>Add to ${MEAL_NAME[meal]}</h2>
      <div class="seg" role="tablist">${tabs.map(([id, n]) => `<button role="tab" data-tab="${id}" class="${state.addTab === id ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div id="add-pane"></div>`, body => {
      let cleanup = null;
      const show = id => {
        if (cleanup) { cleanup(); cleanup = null; }
        state.addTab = id;
        $$('.seg [data-tab]', body).forEach(b => b.classList.toggle('on', b.dataset.tab === id));
        const pane = $('#add-pane', body);
        cleanup = ({ search: paneSearch, barcode: paneBarcode, custom: paneCreate, quick: paneQuick })[id](pane, ctx) || null;
      };
      $$('.seg [data-tab]', body).forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
      show(state.addTab);
      return () => { if (cleanup) cleanup(); };
    });
  }

  function foodRow(f) {
    const tr = I.detect(f, C.nutrientsFor(f.per100, f.servingSize || 100), categories());
    return `<li><button class="food" data-food="${esc(f.id)}">
      <span class="e-main"><span class="e-name">${esc(f.name)}</span>
      <span class="muted small">${esc(f.brand || '')}${f.brand ? ' · ' : ''}${f.hasNutrition === false ? (f.source === 'off' && f.barcode ? 'Nutrition not in the search results — tap to load it' : 'No nutrition data yet — tap to add it from the label')
        : `${r0(f.per100.kcal)} kcal/100 ${Units.base(f)} · P${r1(f.per100.protein)} C${r1(f.per100.carbs)} F${r1(f.per100.fat)}`}</span>
      ${tr.length || suspectFood(f) ? `<span class="e-chips">${suspectFood(f) ? '<span class="chip sm suspect">⚠ often followed by symptoms for you</span>' : ''}${chips(tr, true)}</span>` : ''}</span></button></li>`;
  }

  function recentFoods() {
    const seen = new Set(), out = [];
    for (let i = D().log.length - 1; i >= 0 && out.length < 15; i--) {
      const e = D().log[i];
      if (!e.food || !e.food.per100 || seen.has(e.food.id)) continue;
      seen.add(e.food.id);
      out.push(D().foods[e.food.id] || e.food);
    }
    return out;
  }

  function paneSearch(pane, ctx) {
    const pick = food => ctx.onPick ? ctx.onPick(food) : openPortion({ food, meal: ctx.meal, date: ctx.date });
    pane.innerHTML = `
      <form class="search" id="search-form"><input type="search" id="q" placeholder="Search foods, e.g. “greek yoghurt” or a brand" autocomplete="off" enterkeyhint="search"><button class="btn">Search</button></form>
      <div id="results"></div>`;
    const q = $('#q', pane), results = $('#results', pane);
    let pool = new Map(), ctrl = null;

    const remember = list => list.forEach(f => pool.set(f.id, f));
    function showLocal() {
      const query = q.value.trim();
      const myFoods = Object.values(D().foods);
      if (!query) {
        const rec = recentFoods();
        const mine = myFoods.filter(f => f.source === 'custom');
        const recipes = myFoods.filter(f => f.source === 'recipe');
        remember(rec); remember(mine); remember(recipes);
        const safe = analysisAll().safe.map(x => D().foods[x.food.id] || x.food).filter(f => f && f.per100);
        remember(safe);
        results.innerHTML = (safe.length ? `<h3>Gut-safe for you</h3><ul class="foods">${safe.map(foodRow).join('')}</ul>` : '') + (rec.length ? `<h3>Recent</h3><ul class="foods">${rec.map(foodRow).join('')}</ul>` : '') +
          (recipes.length ? `<h3>My recipes</h3><ul class="foods">${recipes.map(foodRow).join('')}</ul>` : '') +
          (mine.length ? `<h3>My foods</h3><ul class="foods">${mine.map(foodRow).join('')}</ul>` : '') +
          (!rec.length && !mine.length ? '<p class="muted">Type a food, then press <b>Search</b> to look through Open Food Facts (packaged foods) and USDA (generic foods). Built-in basics show as you type.</p>' : '');
        return;
      }
      const savedNames = new Set(myFoods.map(f => (f.name || '').toLowerCase()));
      const local = F.searchLocal(query, myFoods.concat(F.GENERIC.filter(g => !savedNames.has(g.name.toLowerCase())))).slice(0, 12);
      remember(local);
      results.innerHTML = `<ul class="foods">${local.map(foodRow).join('')}</ul>${sourceBoxes()}
        <p class="muted small src-hint">Not here? Press <b>Search</b> to look through ${D().profile.usdaSearch !== false ? 'Open Food Facts and USDA' : 'Open Food Facts'}.</p>`;
    }
    // Online search only runs on Enter / Search. Two sources run side by side, each with its own status,
    // so one being slow or down never blocks the other.
    const SOURCES = [
      { id: 'off', name: 'Open Food Facts', title: 'Packaged foods · Open Food Facts', enabled: () => true,
        run: (query, page, signal) => F.searchOFF(query, { country: D().profile.country, page, signal }) },
      { id: 'usda', name: 'USDA', title: 'Generic foods · USDA', enabled: () => D().profile.usdaSearch !== false,
        run: (query, page, signal) => F.searchUSDA(query, { apiKey: D().profile.usdaKey, page, signal }) },
    ];
    function sourceBoxes() {
      return SOURCES.filter(s => s.enabled()).map(s => `<div class="src" id="src-${s.id}"></div>`).join('');
    }
    async function runSource(src, page) {
      const box = $('#src-' + src.id, results);
      if (!box) return;
      const query = q.value.trim();
      const key = src.id + '|' + D().profile.country + '|' + query.toLowerCase() + '|' + page;
      const more = $('.src-more', box);
      const fail = html => {
        if (page === 1) box.innerHTML = `<h3>${src.title}</h3>${html}`;
        else if (more) more.outerHTML = html;
        const r = $('.src-retry', box);
        if (r) r.addEventListener('click', () => runSource(src, page));
      };
      if (page === 1) box.innerHTML = `<h3>${src.title}</h3><p class="muted small">Searching…</p>`;
      else if (more) { more.disabled = true; more.textContent = 'Loading…'; }

      let res = searchCache.get(key);
      if (!res) {
        if (src.id === 'off') { // Open Food Facts asks apps to stay under ~10 searches a minute
          const now = Date.now();
          while (searchTimes.length && now - searchTimes[0] > 60000) searchTimes.shift();
          if (searchTimes.length >= 9) {
            const wait = Math.ceil((60000 - (now - searchTimes[0])) / 1000);
            return fail(`<p class="error small">Open Food Facts limits searches to about 10 a minute — try again in ${wait} s, or use the barcode tab.</p>`);
          }
          searchTimes.push(now);
        }
        try {
          res = await src.run(query, page, ctrl.signal);
          searchCache.set(key, res);
        } catch (err) {
          if (err.name === 'AbortError') return;
          const msg = (err.status === 'network' || err.name === 'TypeError') && src.id !== 'off' ? `Couldn't reach ${src.name} — check your connection` : err.message;
          return fail(`<p class="error small">${esc(msg)}. <button type="button" class="link src-retry">Try again</button></p>`);
        }
      }
      remember(res.foods);
      const rows = res.foods.map(foodRow).join('');
      const moreBtn = res.hasMore ? '<button type="button" class="btn ghost wide src-more">More from ' + src.name + '</button>' : '';
      if (page === 1) {
        const where = src.id === 'off' && res.country === 'world' && D().profile.country !== 'world' ? ' (worldwide)' : '';
        box.innerHTML = res.foods.length
          ? `<h3>${src.title}${where}</h3><ul class="foods src-list">${rows}</ul>${moreBtn}`
          : `<h3>${src.title}</h3><p class="muted small">No matches. Try fewer or different words${src.id === 'off' ? ' (e.g. the brand), or scan the barcode' : ''}.</p>`;
      } else {
        $('.src-list', box).insertAdjacentHTML('beforeend', rows);
        if (more) more.outerHTML = moreBtn;
      }
      const m = $('.src-more', box);
      if (m) m.addEventListener('click', () => runSource(src, page + 1));
    }
    function searchRemote() {
      if (q.value.trim().length < 2) return;
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      if (!$('.src', results)) showLocal();
      const hint = $('.src-hint', results); if (hint) hint.remove();
      SOURCES.filter(s => s.enabled()).forEach(s => runSource(s, 1));
    }
    q.addEventListener('input', showLocal);
    $('#search-form', pane).addEventListener('submit', e => { e.preventDefault(); q.blur(); searchRemote(); });
    results.addEventListener('click', async e => {
      const b = e.target.closest('[data-food]');
      if (!b || !pool.has(b.dataset.food)) return;
      const f = pool.get(b.dataset.food);
      if (f.hasNutrition === false) {
        // Search results can be partial: fetch the full product before asking you to type in the label.
        if (f.source === 'off' && f.barcode && !b.disabled) {
          b.disabled = true; b.classList.add('loading');
          try {
            const full = await F.lookupBarcode(f.barcode, { country: D().profile.country });
            if (full && full.hasNutrition) return pick(full);
          } catch (_) { /* fall through to the label form */ }
          b.disabled = false; b.classList.remove('loading');
        }
        paneCustom(pane, ctx, Object.assign({}, f, { id: null, source: 'custom', per100: {} }));
        return;
      }
      pick(f);
    });
    showLocal();
    setTimeout(() => q.focus(), 50);
    return () => { if (ctrl) ctrl.abort(); };
  }

  function paneBarcode(pane, ctx) {
    const canScan = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    pane.innerHTML = `
      <form class="search" id="bc-form"><input type="text" id="bc" inputmode="numeric" pattern="[0-9]*" placeholder="Barcode number (EAN / UPC)"><button class="btn">Look up</button></form>
      ${canScan ? '<button class="btn ghost wide" id="scan">📷 Scan with camera</button><video id="cam" playsinline muted hidden></video>' :
        '<p class="muted small">Camera scanning needs a browser with the Barcode Detection API (e.g. Chrome on Android). Type the number under the barcode instead.</p>'}
      <div id="bc-result"></div>`;
    const out = $('#bc-result', pane);
    let stream = null, timer = null;
    const stop = () => { clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; const v = $('#cam', pane); if (v) v.hidden = true; };

    async function lookup(code) {
      code = String(code).replace(/\D/g, '');
      if (!code) return;
      $('#bc', pane).value = code;
      const saved = Object.values(D().foods).find(f => f.barcode === code);
      if (saved && saved.ingredients) return openPortion({ food: saved, meal: ctx.meal, date: ctx.date });
      out.innerHTML = '<p class="muted">Looking up…</p>';
      try {
        const f = await F.lookupBarcode(code, { country: D().profile.country });
        if (saved) { // keep your saved version (sizes, edits) but take the ingredients if Open Food Facts has them now
          if (f && f.ingredients) { saved.ingredients = f.ingredients; S.save(); }
          return openPortion({ food: saved, meal: ctx.meal, date: ctx.date });
        }
        if (f && !f.ingredients) f.ingredientsChecked = today();
        if (f && f.hasNutrition) return openPortion({ food: f, meal: ctx.meal, date: ctx.date });
        out.innerHTML = `<p>${f ? 'Found “' + esc(f.name) + '” but it has no nutrition data.' : 'Not in Open Food Facts.'}</p>
          <button class="btn" id="bc-create">Create it from the label</button>`;
        $('#bc-create', out).addEventListener('click', () => paneCustom(pane, ctx, Object.assign({ barcode: code }, f || {}, { per100: {} })));
      } catch (err) {
        if (saved) return openPortion({ food: saved, meal: ctx.meal, date: ctx.date });
        out.innerHTML = `<p class="error">Lookup failed: ${esc(err.message)}</p>`;
      }
    }
    $('#bc-form', pane).addEventListener('submit', e => { e.preventDefault(); lookup($('#bc', pane).value); });
    if (canScan) {
      $('#scan', pane).addEventListener('click', async () => {
        try {
          const video = $('#cam', pane);
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = stream; video.hidden = false; await video.play();
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          timer = setInterval(async () => {
            try {
              const codes = await det.detect(video);
              if (codes.length) { const c = codes[0].rawValue; stop(); lookup(c); }
            } catch (_) { /* frame not ready */ }
          }, 300);
        } catch (err) {
          out.innerHTML = `<p class="error">Camera unavailable: ${esc(err.message)}</p>`;
        }
      });
    }
    return stop;
  }

  const SERVING_SUGGESTIONS = ['slice', 'piece', 'biscuit', 'bar', 'pot', 'pack', 'can', 'bottle', 'glass', 'mug', 'bowl',
    'portion', 'handful', 'scoop', 'sachet', 'sandwich', 'wrap', '1 tsp', '1 tbsp', '1 cup'];

  function paneCustom(pane, ctx, preset) {
    preset = preset || {};
    const p = preset.per100 || {};
    const fields = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt'];
    let rows = Units.servings(preset).map(x => ({ label: x.label, amount: x.amount }));
    if (!rows.length) rows = [{ label: '', amount: '' }];
    pane.innerHTML = `
      <form id="custom-form" class="form">
        <label>Name<input name="name" required value="${esc(preset.name || '')}"></label>
        <label>Brand <span class="muted">(optional)</span><input name="brand" value="${esc(preset.brand && preset.brand !== 'Generic' ? preset.brand : '')}"></label>
        <label>Ingredients <span class="muted">(copy from the pack — used for IBS trigger detection)</span><textarea name="ingredients" rows="3">${esc(preset.ingredients || '')}</textarea></label>
        <div class="grid2">
          <label>Is it a…<select name="unit"><option value="g">Food (weighed in grams)</option><option value="ml">Drink / liquid (measured in ml)</option></select></label>
          <label>Label values are<select name="basis"><option value="100">per 100 g</option><option value="serving">per serving (first size below)</option></select></label>
        </div>
        <fieldset class="servings-box"><legend>Serving sizes <span class="muted">— how you usually measure it</span></legend>
          <div id="srv-rows"></div>
          <button type="button" class="btn ghost" id="srv-add">+ Add another size</button>
          <p class="muted small">e.g. slice = 36 g, 1 tbsp = 21 g, glass = 250 ml. Adding a cup, tbsp or tsp size also makes logging by volume accurate for this food.</p>
        </fieldset>
        <div class="grid2">
          <label>Whole pack / dish (<span class="bu">g</span>) <span class="muted">(optional)</span><input name="packSize" type="number" step="any" min="0" value="${preset.packSize || ''}" placeholder="e.g. 400"></label>
          <label>Slices / portions in it <span class="muted">(optional)</span><input name="pieces" type="number" step="1" min="0" value="${preset.pieces || ''}" placeholder="e.g. 8"></label>
        </div>
        <h3 id="nut-head">Nutrition per 100 g</h3>
        <div class="grid2">
          ${fields.map(k => `<label>${NUT_LABEL[k]} (${unitOf(k)})<input name="${k}" type="number" step="any" min="0" inputmode="decimal" value="${p[k] != null ? p[k] : ''}" ${k === 'kcal' ? 'required' : ''}></label>`).join('')}
        </div>
        <button class="btn wide">Save food & continue</button>
      </form>
      <datalist id="srv-suggest">${SERVING_SUGGESTIONS.map(x => `<option value="${x}">`).join('')}</datalist>`;

    const form = $('#custom-form', pane);
    form.unit.value = Units.base(preset);
    const srvBox = $('#srv-rows', pane);
    const bu = () => form.unit.value;
    function readRows() {
      rows = $$('.srv-row', srvBox).map(r => ({ label: $('[name=srvLabel]', r).value, amount: $('[name=srvAmount]', r).value }));
    }
    function renderRows() {
      srvBox.innerHTML = rows.map((r, i) => `<div class="srv-row">
          <input name="srvLabel" list="srv-suggest" placeholder="${i ? 'e.g. 1 tbsp' : 'e.g. slice'}" value="${esc(r.label)}" aria-label="serving name">
          <span>=</span>
          <input name="srvAmount" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.amount)}" aria-label="amount">
          <span class="bu">${bu()}</span>
          <button type="button" class="icon srv-del" data-i="${i}" aria-label="Remove this size">×</button>
        </div>`).join('');
    }
    function refreshUnitText() {
      $$('.bu', pane).forEach(x => { x.textContent = bu(); });
      form.basis.options[0].textContent = 'per 100 ' + bu();
      $('#nut-head', pane).textContent = form.basis.value === 'serving'
        ? 'Nutrition per serving' + (rows[0] && rows[0].label ? ' (' + rows[0].label + ')' : '')
        : 'Nutrition per 100 ' + bu();
    }
    srvBox.addEventListener('click', e => {
      const b = e.target.closest('.srv-del');
      if (!b) return;
      readRows(); rows.splice(+b.dataset.i, 1);
      if (!rows.length) rows = [{ label: '', amount: '' }];
      renderRows(); refreshUnitText();
    });
    $('#srv-add', pane).addEventListener('click', () => {
      readRows(); rows.push({ label: '', amount: '' }); renderRows(); refreshUnitText();
      const inputs = $$('[name=srvLabel]', srvBox); inputs[inputs.length - 1].focus();
    });
    form.unit.addEventListener('change', refreshUnitText);
    form.basis.addEventListener('change', () => { readRows(); refreshUnitText(); });
    srvBox.addEventListener('input', () => { readRows(); refreshUnitText(); });
    renderRows(); refreshUnitText();

    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      readRows();
      const half = rows.find(r => (r.label.trim() && !(parseFloat(r.amount) > 0)) || (!r.label.trim() && parseFloat(r.amount) > 0));
      if (half) { alert('Each serving size needs both a name and an amount (or remove the empty one).'); return; }
      const servings = rows.filter(r => r.label.trim() && parseFloat(r.amount) > 0).map(r => ({ label: r.label.trim(), amount: parseFloat(r.amount) }));
      if (f.basis.value === 'serving' && !servings.length) { alert('Add the serving size the label refers to (e.g. “bar” = 45 g).'); return; }
      const factor = f.basis.value === 'serving' ? 100 / servings[0].amount : 1;
      const per100 = {};
      fields.forEach(k => { per100[k] = r1((parseFloat(f[k].value) || 0) * factor); });
      const keepId = preset.id && preset.source === 'custom';
      const food = {
        id: keepId ? preset.id : 'cust:' + S.uid(), source: 'custom', barcode: preset.barcode || '',
        name: f.name.value.trim(), brand: f.brand.value.trim(), ingredients: f.ingredients.value.trim(),
        unit: f.unit.value, servings,
        servingSize: servings.length ? servings[0].amount : 100, servingLabel: servings.length ? servings[0].label : '',
        per100, packSize: parseFloat(f.packSize.value) || 0, pieces: parseInt(f.pieces.value, 10) || 0,
      };
      if (preset.density) food.density = preset.density;
      if (keepId && preset.lastPortion) food.lastPortion = preset.lastPortion;
      D().foods[food.id] = food;
      S.save();
      if (ctx.onPick) return ctx.onPick(food);
      openPortion({ food, meal: ctx.meal, date: ctx.date, entry: ctx.entry });
    });
  }

  function paneQuick(pane, ctx, entry) {
    const q = entry ? entry.quick : {};
    const v = k => (q[k] != null && q[k] !== 0 ? r1(q[k]) : '');
    pane.innerHTML = `
      <form id="quick-form" class="form">
        <label>Description<input name="name" placeholder="e.g. Pub lunch, curry takeaway" required value="${esc(entry ? entry.food.name : '')}"></label>
        <label>What was in it? <span class="muted">(optional — helps IBS tracking)</span><input name="ingredients" placeholder="e.g. onion, garlic, cream, chilli" value="${esc(entry ? entry.food.ingredients : '')}"></label>
        <div class="grid2">
          <label>Calories (kcal)<input name="kcal" type="number" min="0" step="any" required inputmode="decimal" value="${entry ? r0(q.kcal) : ''}"></label>
          <label>Protein (g)<input name="protein" type="number" min="0" step="any" inputmode="decimal" value="${v('protein')}"></label>
          <label>Carbs (g)<input name="carbs" type="number" min="0" step="any" inputmode="decimal" value="${v('carbs')}"></label>
          <label>Fat (g)<input name="fat" type="number" min="0" step="any" inputmode="decimal" value="${v('fat')}"></label>
        </div>
        <details class="more" ${['fiber', 'sugar', 'satFat', 'salt'].some(k => q[k]) ? 'open' : ''}><summary>Fibre, sugars, saturates, salt (optional)</summary>
          <div class="grid2">
            <label>Fibre (g)<input name="fiber" type="number" min="0" step="any" inputmode="decimal" value="${v('fiber')}"></label>
            <label>Sugars (g)<input name="sugar" type="number" min="0" step="any" inputmode="decimal" value="${v('sugar')}"></label>
            <label>Saturates (g)<input name="satFat" type="number" min="0" step="any" inputmode="decimal" value="${v('satFat')}"></label>
            <label>Salt (g)<input name="salt" type="number" min="0" step="any" inputmode="decimal" value="${v('salt')}"></label>
          </div>
        </details>
        <div class="grid2">
          ${entry ? `<label>Meal<select name="meal">${MEALS.map(([id, n]) => `<option value="${id}" ${id === entry.meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Date<input name="date" type="date" value="${entry.date}" required></label>` : ''}
          <label>Time<input name="time" type="time" value="${entry ? entry.time : ctx.date === today() ? nowTime() : I.MEAL_DEFAULT_TIME[ctx.meal]}"></label>
        </div>
        <div class="row-actions">
          <button class="btn">${entry ? 'Save' : 'Add'}</button>
          ${entry ? '<button type="button" class="btn danger ghost" id="quick-del">Delete</button>' : ''}
        </div>
      </form>`;
    const form = $('#quick-form', pane);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const quick = Object.assign(C.emptyNutrients(), {
        kcal: +f.kcal.value || 0, protein: +f.protein.value || 0, carbs: +f.carbs.value || 0, fat: +f.fat.value || 0,
        fiber: +f.fiber.value || 0, sugar: +f.sugar.value || 0, satFat: +f.satFat.value || 0, salt: +f.salt.value || 0,
      });
      const food = { id: entry ? entry.food.id : 'quick:' + S.uid(), name: f.name.value.trim(), brand: '', ingredients: f.ingredients.value.trim(), per100: null };
      if (entry) Object.assign(entry, { quick, food, time: f.time.value, meal: f.meal.value, date: f.date.value });
      else D().log.push({ id: S.uid(), date: ctx.date, time: f.time.value, meal: ctx.meal, grams: 0, quick, food });
      S.save(); closeModal(); render();
    });
    if (entry) $('#quick-del', pane).addEventListener('click', () => { D().log = D().log.filter(x => x !== entry); S.save(); closeModal(); render(); });
  }

  // =====================================================================
  // RECIPES — build a dish from ingredients; saved as a food you can log by serving, slice or weight
  // =====================================================================
  const scaleN = (n, f) => { const o = C.emptyNutrients(); C.NUTRIENTS.forEach(k => { o[k] = (n[k] || 0) * f; }); return o; };

  function recipeTotals(draft) {
    const rows = draft.items.map(it => ({ it, n: C.nutrientsFor(it.food.per100, it.grams) }));
    const total = C.sumNutrients(rows.map(x => x.n));
    const rawWeight = draft.items.reduce((s, it) => s + (Number(it.grams) || 0), 0);
    const weight = draft.cookedWeight > 0 ? Number(draft.cookedWeight) : rawWeight;
    const servings = Math.max(1, Math.round(Number(draft.servings) || 1));
    return { rows, total, rawWeight, weight, servings, perServing: scaleN(total, 1 / servings), per100: weight > 0 ? scaleN(total, 100 / weight) : C.emptyNutrients() };
  }

  /** Triggers across the ingredients, each with the ingredient(s) responsible. */
  function recipeTriggers(draft) {
    const map = new Map();
    draft.items.forEach(it => {
      const n = C.nutrientsFor(it.food.per100, it.grams);
      I.detect(it.food, n, categories()).forEach(t => {
        if (!map.has(t.id)) map.set(t.id, Object.assign({}, t, { from: [] }));
        map.get(t.id).from.push(it.food.name);
      });
    });
    return Array.from(map.values());
  }

  /** Turn a recipe draft into a loggable food (per 100 g of the finished dish). */
  function recipeFood(draft, id) {
    const T = recipeTotals(draft);
    const per100 = {};
    C.NUTRIENTS.forEach(k => { per100[k] = k === 'kcal' ? Math.round(T.per100[k]) : r1(T.per100[k]); });
    const portion = T.weight / T.servings;
    return {
      id: id || 'recipe:' + S.uid(), source: 'recipe', name: draft.name.trim(), brand: 'My recipe', unit: 'g',
      per100,
      servings: [{ label: `serving (1/${T.servings} of the recipe)`, amount: Math.round(portion * 10) / 10 }],
      servingSize: Math.round(portion * 10) / 10, servingLabel: `serving (1/${T.servings} of the recipe)`,
      packSize: Math.round(T.weight), pieces: T.servings,
      // ingredient names (and their own ingredient lists) drive the IBS trigger checks for the dish
      ingredients: draft.items.map(it => it.food.name + (it.food.ingredients && it.food.ingredients !== it.food.name ? ' (' + it.food.ingredients + ')' : '')).join(', '),
      recipe: {
        servings: T.servings, cookedWeight: Number(draft.cookedWeight) || 0, notes: draft.notes || '',
        items: draft.items.map(it => ({ grams: it.grams, portion: it.portion, food: {
          id: it.food.id, source: it.food.source, name: it.food.name, brand: it.food.brand || '', unit: it.food.unit || 'g',
          per100: it.food.per100, ingredients: it.food.ingredients || '', servings: Units.servings(it.food),
          servingSize: it.food.servingSize || 100, servingLabel: it.food.servingLabel || '', density: it.food.density || undefined } })),
      },
    };
  }

  /**
   * The recipe builder. ctx: { meal, date, entry? } for logging afterwards. existing: a saved recipe food to edit.
   * The draft lives in this closure while you hop between the builder, the ingredient search and amounts.
   */
  function openRecipe(ctx, existing) {
    const draft = existing && existing.recipe
      ? { id: existing.id, name: existing.name, servings: existing.recipe.servings, cookedWeight: existing.recipe.cookedWeight || '',
        notes: existing.recipe.notes || '', items: existing.recipe.items.map(x => Object.assign({}, x)) }
      : { id: null, name: '', servings: 4, cookedWeight: '', notes: '', items: [] };

    const readForm = body => {
      const f = $('#recipe-form', body);
      if (!f) return;
      draft.name = f.name.value; draft.servings = f.servings.value; draft.cookedWeight = f.cookedWeight.value; draft.notes = f.notes.value;
    };

    function builder() {
      openModal(`
        <h2>${draft.id ? 'Edit recipe' : 'New recipe'}</h2>
        <form id="recipe-form" class="form">
          <label>Recipe name<input name="name" required value="${esc(draft.name)}" placeholder="e.g. Mum's lasagne"></label>
          <div class="grid2">
            <label>Makes (servings)<input name="servings" type="number" min="1" step="1" inputmode="numeric" value="${esc(draft.servings)}"></label>
            <label>Cooked weight (g) <span class="muted">(optional)</span><input name="cookedWeight" type="number" min="0" step="any" inputmode="decimal" value="${esc(draft.cookedWeight)}" placeholder="weigh the finished dish"></label>
          </div>
          <h3>Ingredients</h3>
          <div id="rc-items"></div>
          <div class="row-actions"><button type="button" class="btn ghost" data-rc="add">+ Add ingredient</button></div>
          <div id="rc-totals"></div>
          <label>Notes <span class="muted">(optional)</span><textarea name="notes" rows="2" placeholder="Method, swaps, how it sat with your gut…">${esc(draft.notes)}</textarea></label>
          <div class="row-actions">
            <button class="btn">${draft.id ? 'Save recipe' : 'Save & log a serving'}</button>
            ${draft.id ? '<button type="button" class="btn ghost" data-rc="save-only">Save without logging</button>' : ''}
          </div>
          <p class="muted small">Cooking changes weight (water evaporates, pasta absorbs it). Weighing the finished dish makes logging by grams accurate; otherwise the raw ingredient total is used.</p>
        </form>`, body => {
        const f = $('#recipe-form', body);
        const refresh = () => {
          readForm(body);
          const T = recipeTotals(draft);
          $('#rc-items', body).innerHTML = draft.items.length ? `<ul class="entries">${T.rows.map((x, i) => `
            <li><button type="button" class="entry" data-rc="edit" data-i="${i}">
              <span class="e-main"><span class="e-name">${esc(x.it.food.name)}</span>
              <span class="muted small">${esc(x.it.portion && !['w:g', 'v:ml'].includes(Units.normaliseUnit(x.it.portion.unit, x.it.food)) ? Units.describe(x.it.portion.qty, x.it.portion.unit, x.it.food) + ' · ' : '')}${r0(x.it.grams)} ${Units.base(x.it.food)}</span></span>
              <span class="e-kcal">${fmtInt(x.n.kcal)}<small> kcal</small><br><small class="muted">P${r0(x.n.protein)} C${r0(x.n.carbs)} F${r0(x.n.fat)}</small></span>
            </button></li>`).join('')}</ul>` : '<p class="muted small">No ingredients yet — add them one by one with the amounts you used.</p>';
          const trig = recipeTriggers(draft);
          $('#rc-totals', body).innerHTML = draft.items.length ? `
            <table class="nut rc-table"><thead><tr><th></th><th>Whole recipe</th><th>Per serving</th></tr></thead><tbody>
              ${C.NUTRIENTS.map(k => `<tr class="${k === 'sugar' || k === 'satFat' ? 'sub' : ''}"><td>${NUT_LABEL[k]}</td>
                <td>${k === 'kcal' ? fmtInt(T.total[k]) : r1(T.total[k])} ${unitOf(k)}</td><td><b>${k === 'kcal' ? fmtInt(T.perServing[k]) : r1(T.perServing[k])} ${unitOf(k)}</b></td></tr>`).join('')}
            </tbody></table>
            <p class="muted small">${T.servings} serving${T.servings === 1 ? '' : 's'} of about ${r0(T.weight / T.servings)} g · ${draft.cookedWeight > 0 ? `cooked weight ${r0(T.weight)} g (raw ingredients ${r0(T.rawWeight)} g)` : `${r0(T.weight)} g in total`}</p>
            ${trig.length ? `<div class="trig-box"><h3>Possible IBS triggers</h3><ul class="trig-list">${trig.map(t => `<li>${chips([t])}<span class="small">${esc(Array.from(new Set(t.from)).join(', '))}</span></li>`).join('')}</ul>
              <p class="muted small">Swap or reduce the ingredient shown to make the dish gentler.</p></div>` : '<p class="ok small">No common IBS triggers in these ingredients.</p>'}` : '';
        };
        f.addEventListener('input', e => { if (['servings', 'cookedWeight'].includes(e.target.name)) refresh(); else readForm(body); });
        body.addEventListener('click', e => {
          const b = e.target.closest('[data-rc]');
          if (!b) return;
          readForm(body);
          if (b.dataset.rc === 'add') picker();
          else if (b.dataset.rc === 'edit') amount(draft.items[+b.dataset.i].food, +b.dataset.i);
          else if (b.dataset.rc === 'save-only') save(false);
        });
        f.addEventListener('submit', e => { e.preventDefault(); readForm(body); save(true); });
        refresh();
      });
    }

    function save(andLog) {
      if (!draft.name.trim()) { alert('Give the recipe a name.'); return; }
      if (!draft.items.length) { alert('Add at least one ingredient.'); return; }
      const food = recipeFood(draft, draft.id);
      const prev = D().foods[food.id];
      if (prev && prev.lastPortion) food.lastPortion = prev.lastPortion;
      D().foods[food.id] = food;
      S.save();
      if (andLog || ctx.entry) openPortion({ food, meal: ctx.meal || mealForNow(), date: ctx.date || state.date, entry: ctx.entry, portion: ctx.entry ? undefined : { unit: 'serving:0', qty: 1 } });
      else { closeModal(); render(); }
    }

    // ---- choose an ingredient: the normal food search, or type one in by hand ----
    function picker() {
      openModal(`<h2>Add ingredient</h2>
        <div id="add-pane"></div>
        <p class="small"><button type="button" class="link" data-rc="manual">Can't find it? Enter it by hand</button> · <button type="button" class="link" data-rc="back">Back to recipe</button></p>`, body => {
        const cleanup = paneSearch($('#add-pane', body), { onPick: food => amount(food, null) });
        body.addEventListener('click', e => {
          const b = e.target.closest('[data-rc]');
          if (!b) return;
          if (b.dataset.rc === 'manual') manual();
          if (b.dataset.rc === 'back') builder();
        });
        return cleanup;
      });
    }

    function manual() {
      openModal(`<h2>Ingredient by hand</h2>
        <form id="manual-form" class="form">
          <label>Name<input name="name" required placeholder="e.g. Mum's stock"></label>
          <label>Amount used (g or ml)<input name="grams" type="number" min="0" step="any" required inputmode="decimal"></label>
          <p class="muted small">Nutrition for that amount (leave blank if unknown):</p>
          <div class="grid2">
            ${['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'satFat', 'salt'].map(k => `<label>${NUT_LABEL[k]} (${unitOf(k)})<input name="${k}" type="number" min="0" step="any" inputmode="decimal" ${k === 'kcal' ? 'required' : ''}></label>`).join('')}
          </div>
          <label>What's in it? <span class="muted">(optional — for IBS checks)</span><input name="ingredients" placeholder="e.g. onion, garlic, celery"></label>
          <div class="row-actions"><button class="btn">Add to recipe</button><button type="button" class="btn ghost subtle" data-rc="back">Back</button></div>
        </form>`, body => {
        $('#manual-form', body).addEventListener('submit', e => {
          e.preventDefault();
          const f = e.target, g = parseFloat(f.grams.value) || 0;
          if (!(g > 0)) return;
          const per100 = {};
          C.NUTRIENTS.forEach(k => { per100[k] = r1((parseFloat(f[k].value) || 0) * 100 / g); });
          draft.items.push({ grams: g, portion: { unit: 'w:g', qty: g },
            food: { id: 'manual:' + S.uid(), source: 'manual', name: f.name.value.trim(), unit: 'g', per100, ingredients: f.ingredients.value.trim() } });
          builder();
        });
        body.addEventListener('click', e => { if (e.target.closest('[data-rc=back]')) picker(); });
      });
    }

    // ---- how much of an ingredient (new, or editing item i) ----
    function amount(food, i) {
      const editing = i != null;
      const srv = Units.servings(food);
      const B = Units.base(food);
      const startUnit = editing && draft.items[i].portion ? Units.normaliseUnit(draft.items[i].portion.unit, food) : srv.length ? 'serving:0' : (B === 'ml' ? 'v:ml' : 'w:g');
      const startQty = editing ? (draft.items[i].portion ? draft.items[i].portion.qty : draft.items[i].grams) : srv.length ? 1 : 100;
      const weight = Object.entries(Units.WEIGHT).map(([k, u]) => `<option value="w:${k}">${u.name}</option>`).join('');
      const volume = Object.entries(Units.VOLUME).map(([k, u]) => `<option value="v:${k}">${u.name}</option>`).join('');
      openModal(`<h2>${esc(food.name)}</h2>
        ${food.brand && food.brand !== 'Generic' ? `<p class="muted">${esc(food.brand)}</p>` : ''}
        <form id="amount-form" class="form">
          <div class="grid2">
            <label>Amount<input name="qty" type="number" min="0" step="any" inputmode="decimal" required value="${startQty}"></label>
            <label>Unit<select name="unit">
              ${srv.length ? `<optgroup label="Servings">${srv.map((x, j) => `<option value="serving:${j}">${esc(servingOptionText(x, B))}</option>`).join('')}</optgroup>` : ''}
              <optgroup label="Weight">${weight}</optgroup><optgroup label="Volume">${volume}</optgroup>
            </select></label>
          </div>
          <p class="portion-total" id="amt-total"></p>
          <div class="row-actions">
            <button class="btn">${editing ? 'Update' : 'Add to recipe'}</button>
            ${editing ? '<button type="button" class="btn danger ghost" data-rc="remove">Remove</button>' : ''}
            <button type="button" class="btn ghost subtle" data-rc="back">Back</button>
          </div>
        </form>`, body => {
        const f = $('#amount-form', body);
        f.unit.value = startUnit;
        const grams = () => Units.toBase(parseFloat(f.qty.value) || 0, f.unit.value, food);
        const show = () => {
          const g = grams(), n = C.nutrientsFor(food.per100, g);
          $('#amt-total', body).innerHTML = g > 0 ? `= <b>${r0(g)} ${B}</b> · <b>${fmtInt(n.kcal)} kcal</b> · P${r0(n.protein)} C${r0(n.carbs)} F${r0(n.fat)}` : '';
        };
        f.addEventListener('input', show);
        f.unit.addEventListener('change', show);
        show();
        f.addEventListener('submit', e => {
          e.preventDefault();
          const g = grams();
          if (!(g > 0)) return;
          const item = { food, grams: Math.round(g * 10) / 10, portion: { unit: f.unit.value, qty: parseFloat(f.qty.value) || 0 } };
          if (editing) draft.items[i] = item; else draft.items.push(item);
          builder();
        });
        body.addEventListener('click', e => {
          const b = e.target.closest('[data-rc]');
          if (!b) return;
          if (b.dataset.rc === 'remove') { draft.items.splice(i, 1); builder(); }
          if (b.dataset.rc === 'back') editing ? builder() : picker();
        });
      });
    }

    builder();
  }

  /** "Create food" tab: a single food from a label, or a recipe from ingredients. */
  function paneCreate(pane, ctx) {
    pane.innerHTML = `
      <div class="create-choice">
        <button type="button" class="btn ghost" id="mk-food"><b>Single food</b><span class="small muted">from a label</span></button>
        <button type="button" class="btn ghost" id="mk-recipe"><b>Recipe</b><span class="small muted">from ingredients</span></button>
      </div>
      <div id="create-pane"></div>`;
    const sub = $('#create-pane', pane);
    const myRecipes = Object.values(D().foods).filter(f => f.source === 'recipe');
    const showFood = () => { $('#mk-food', pane).classList.add('on'); $('#mk-recipe', pane).classList.remove('on'); paneCustom(sub, ctx); };
    $('#mk-food', pane).addEventListener('click', showFood);
    $('#mk-recipe', pane).addEventListener('click', () => openRecipe(ctx));
    if (myRecipes.length) {
      sub.innerHTML = `<h3>My recipes</h3><ul class="foods">${myRecipes.map(r => `<li><button type="button" class="food" data-recipe="${esc(r.id)}">
        <span class="e-main"><span class="e-name">${esc(r.name)}</span><span class="muted small">${r.recipe ? r.recipe.items.length + ' ingredients · ' + r.recipe.servings + ' servings · ' : ''}${r0(r.per100.kcal * (r.servingSize || 100) / 100)} kcal a serving</span></span></button></li>`).join('')}</ul>
        <p class="small"><button type="button" class="link" id="show-food-form">Or create a single food from a label</button></p>`;
      sub.addEventListener('click', e => {
        const b = e.target.closest('[data-recipe]');
        if (b) openPortion({ food: D().foods[b.dataset.recipe], meal: ctx.meal, date: ctx.date });
        if (e.target.closest('#show-food-form')) showFood();
      });
    } else showFood();
  }

  // ---------- portion / edit entry ----------
  // How much did you eat? Units: servings, slices/pieces of a whole, fraction of the whole, grams.
  const FRACTIONS = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '1'], [1.5, '1½'], [2, '2']];
  const fmtAmt = n => String(Math.round(n * 10) / 10);
  function portionGrams(por, food) {
    const q = parseFloat(por.qty) || 0;
    if (por.unit === 'whole') return q * (parseFloat(por.packSize) || 0);
    if (por.unit === 'pieces') return (parseFloat(por.pieces) > 0 ? q / parseFloat(por.pieces) : 0) * (parseFloat(por.packSize) || 0);
    return Units.toBase(q, por.unit, food);
  }
  /** Plain-words description for the diary, or null when the base amount already says it all. */
  function portionText(por, food) {
    const unit = Units.normaliseUnit(por.unit, food);
    const q = r1(parseFloat(por.qty) || 0);
    if (unit === 'whole') { const fr = FRACTIONS.find(([v]) => Math.abs(v - por.qty) < 0.01); return (fr ? fr[1] : q) + ' of the whole'; }
    if (unit === 'pieces') return q + ' of ' + por.pieces + (food && food.source === 'recipe' ? ' portions' : ' slices');
    if (unit === 'w:g' || unit === 'v:ml') return null;
    return Units.describe(por.qty, unit, food);
  }
  /** "slice (36 g)", but not "1 bottle (330 ml) (330 ml)" when the name already says it. */
  function servingOptionText(x, B) {
    const amount = fmtAmt(x.amount);
    return new RegExp('\\b' + amount.replace('.', '\\.') + '\\s*' + B + '\\b', 'i').test(x.label) ? x.label : `${x.label} (${amount} ${B})`;
  }
  /** Is `unit` usable for this food? */
  function validUnit(unit, food) {
    if (unit === 'whole' || unit === 'pieces') return true;
    const [kind, key] = unit.split(':');
    if (kind === 'serving') return +key < Units.servings(food).length;
    return (kind === 'w' && !!Units.WEIGHT[key]) || (kind === 'v' && !!Units.VOLUME[key]);
  }

  function ingredientsBlock(food, checked) {
    if (food.ingredients) return `<details class="more"><summary>Ingredients</summary><p class="small">${esc(food.ingredients)}</p></details>`;
    if (food.ingredientsChecked === today()) checked = checked || true;
    const why = checked === 'failed' ? "Couldn't reach Open Food Facts to fetch the ingredients"
      : checked ? "Open Food Facts doesn't have the ingredients for this product yet" : 'No ingredient list';
    return `<p class="muted small">${why} — IBS checks use the name only.
      <button type="button" class="link" data-act="edit-food">Add them from the pack</button></p>`;
  }

  function openPortion({ food, meal, date, entry, portion }) {
    const saved = D().foods[food.id] || {};
    food = Object.assign({}, food, { packSize: food.packSize || saved.packSize || 0, pieces: food.pieces || saved.pieces || 0 });
    const B = Units.base(food);
    const srv = Units.servings(food);
    const time = entry ? entry.time : (date === today() ? nowTime() : I.MEAL_DEFAULT_TIME[meal]);
    const baseUnit = B === 'ml' ? 'v:ml' : 'w:g';

    // starting point: how this entry was logged → how you last had this food → first serving → 100 g/ml
    const por = Object.assign({ unit: baseUnit, qty: 100, pieces: food.pieces || '', packSize: food.packSize || '' },
      entry ? (entry.portion || { unit: baseUnit, qty: r1(entry.grams) })
        : portion ? portion
        : saved.lastPortion ? saved.lastPortion
        : srv.length ? { unit: 'serving:0', qty: 1 } : {});
    por.unit = Units.normaliseUnit(por.unit, food);
    if (!validUnit(por.unit, food)) Object.assign(por, { unit: baseUnit, qty: entry ? r1(entry.grams) : 100 });
    if (!por.pieces) por.pieces = food.pieces || 8;
    if (!por.packSize) por.packSize = food.packSize || '';

    const weightGroup = `<optgroup label="Weight">${Object.entries(Units.WEIGHT).map(([k, u]) => `<option value="w:${k}">${u.name}</option>`).join('')}</optgroup>`;
    const volumeGroup = `<optgroup label="Volume">${Object.entries(Units.VOLUME).map(([k, u]) => `<option value="v:${k}">${u.name}</option>`).join('')}</optgroup>`;

    openModal(`
      <h2>${esc(food.name)}</h2>
      ${food.brand && food.brand !== 'Generic' ? `<p class="muted">${esc(food.brand)}</p>` : ''}
      <form id="portion" class="form">
        <label>How did you measure it?<select name="unit">
          ${srv.length ? `<optgroup label="Servings">${srv.map((x, i) => `<option value="serving:${i}">${esc(servingOptionText(x, B))}</option>`).join('')}</optgroup>` : ''}
          <optgroup label="Part of a whole">
            <option value="pieces">Slices / pieces of a whole (e.g. 3 of 8 slices)</option>
            <option value="whole">Part of the whole thing (e.g. half)</option>
          </optgroup>
          ${B === 'ml' ? volumeGroup + weightGroup : weightGroup + volumeGroup}
        </select></label>
        <div id="amt"></div>
        <div class="grid2">
          <label>Meal<select name="meal">${MEALS.map(([id, n]) => `<option value="${id}" ${id === meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Time<input name="time" type="time" value="${time}"></label>
          ${entry ? `<label>Date<input name="date" type="date" value="${entry.date}" required></label>` : ''}
        </div>
        <div id="portion-nut"></div>
        <div id="portion-trig"></div>
        <div id="portion-ingr">${ingredientsBlock(food)}</div>
        <div class="row-actions">
          <button class="btn">${entry ? 'Save' : 'Add to diary'}</button>
          ${entry ? '<button type="button" class="btn danger ghost" data-act="del-entry">Delete</button>' : ''}
          <button type="button" class="btn ghost subtle" data-act="edit-food">${food.source === 'recipe' ? 'Edit recipe' : 'Edit food / serving sizes'}</button>
        </div>
      </form>`, body => {
      const f = $('#portion', body);
      f.unit.value = por.unit;
      const amt = $('#amt', body);
      const packWord = B === 'ml' ? 'holds' : 'weighs';
      const packHint = B === 'ml' ? '<p class="muted small">The amount is on the bottle or carton (e.g. “500 ml”).</p>'
        : '<p class="muted small">The whole weight is on the pack (e.g. “400 g”). Home-made? A 12-inch pizza is roughly 550 g, a 10-inch about 400 g.</p>';
      const qtyInput = label => `<input name="qty" type="number" min="0" step="any" inputmode="decimal" value="${por.qty}" aria-label="${label}" required>`;
      const packInput = `<input name="packSize" type="number" min="1" step="any" inputmode="decimal" value="${por.packSize}" placeholder="?" aria-label="size of the whole" required>`;
      const fracRow = `<div class="frac">${FRACTIONS.map(([v, l]) => `<button type="button" data-q="${v}">${l}</button>`).join('')}</div>`;

      function renderAmount() {
        const u = por.unit;
        const [kind, key] = u.split(':');
        if (u === 'pieces') amt.innerHTML = `<div class="amount-line">I had ${qtyInput('slices eaten')} of
            <input name="pieces" type="number" min="1" step="1" inputmode="numeric" value="${por.pieces}" aria-label="slices in the whole"> ${food.source === 'recipe' ? 'portions' : 'slices'}</div>
          <div class="amount-line">The whole thing ${packWord} ${packInput} ${B}</div>${!por.packSize ? packHint : ''}`;
        else if (u === 'whole') amt.innerHTML = `${fracRow}
          <div class="amount-line">${qtyInput('fraction of the whole')}<span>× the whole thing, which ${packWord}</span> ${packInput} ${B}</div>${!por.packSize ? packHint : ''}`;
        else if (kind === 'serving') amt.innerHTML = `<div class="amount-line">${qtyInput('servings')}<span>× ${esc(srv[+key].label)} (${fmtAmt(srv[+key].amount)} ${B} each)</span></div>${fracRow}`;
        else {
          const unitInfo = kind === 'w' ? Units.WEIGHT[key] : Units.VOLUME[key];
          const small = u === 'w:g' || u === 'v:ml';
          amt.innerHTML = `<div class="amount-line">${qtyInput(unitInfo.name)}<span>${unitInfo.label}</span></div>
            ${small ? '' : fracRow}
            ${Units.isAssumed(u, food) ? `<p class="muted small">Assumes 1 ml weighs about 1 g. For a more accurate figure, add a size like “1 cup = 120 g” with <button type="button" class="link" data-act="edit-food">Edit food</button>.</p>` : ''}`;
        }
        markFraction();
      }
      function markFraction() {
        $$('.frac button', amt).forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.q - (parseFloat(por.qty) || 0)) < 0.01));
      }
      function readAmount() {
        ['qty', 'pieces', 'packSize'].forEach(k => { if (f[k]) por[k] = f[k].value; });
      }
      const update = () => {
        readAmount();
        markFraction();
        const grams = portionGrams(por, food);
        const n = C.nutrientsFor(food.per100, grams);
        const known = grams > 0;
        const showTotal = por.unit !== baseUnit;
        $('#portion-nut', body).innerHTML = `
          ${showTotal ? `<p class="portion-total">${known ? `= <b>${r0(grams)} ${B}</b> · <b>${fmtInt(n.kcal)} kcal</b>` : `<span class="muted">Enter how much the whole thing ${packWord} to work it out.</span>`}</p>` : ''}
          <table class="nut"><thead><tr><th></th><th>You had</th><th>Per 100 ${B}</th></tr></thead><tbody>
          ${C.NUTRIENTS.map(k => `<tr class="${k === 'sugar' || k === 'satFat' ? 'sub' : ''}"><td>${NUT_LABEL[k]}</td><td>${k === 'kcal' ? r0(n[k]) : r1(n[k])} ${unitOf(k)}</td><td class="muted">${food.per100[k]} ${unitOf(k)}</td></tr>`).join('')}
          </tbody></table>`;
        const tr = I.detect(food, n, categories());
        $('#portion-trig', body).innerHTML = tr.length ? `<div class="trig-box"><h3>Possible IBS triggers</h3><ul class="trig-list">${tr.map(t => `<li>${chips([t])}<span class="small">${esc(t.matches.join(', '))}</span></li>`).join('')}</ul>
          <p class="muted small">FODMAP effects depend on portion size — a small amount may be fine.</p></div>` : '<p class="ok small">No common IBS triggers detected.</p>';
      };
      amt.addEventListener('click', e => {
        const b = e.target.closest('[data-q]');
        if (!b) return;
        f.qty.value = r1(+b.dataset.q * 1000) / 1000;
        update();
      });
      f.unit.addEventListener('change', () => {
        readAmount();
        const grams = portionGrams(por, food);
        const pack = parseFloat(por.packSize) || 0;
        const fromUnit = por.unit;
        por.unit = f.unit.value;
        // keep the same amount where it can be converted, otherwise pick a sensible default
        if (por.unit === 'whole') por.qty = grams && pack ? Math.round(grams / pack * 100) / 100 : 0.5;
        else if (por.unit === 'pieces') por.qty = grams && pack ? Math.max(1, Math.round(grams / pack * por.pieces)) : 2;
        else {
          const per = Units.toBase(1, por.unit, food);
          if (!grams || !per) por.qty = por.unit === baseUnit ? 100 : 1;
          else if (por.unit.startsWith('serving:')) {
            // switching between serving sizes (pint → can) means "1 of those"; from a weight/volume, convert
            const fromWhole = fromUnit.startsWith('serving:') || fromUnit === 'pieces' || fromUnit === 'whole';
            por.qty = fromWhole ? 1 : Math.max(0.25, Math.round(grams / per * 4) / 4);
          }
          else if (per <= 1.5) por.qty = r0(grams / per);
          else por.qty = Math.round(grams / per * 100) / 100;
        }
        renderAmount();
        update();
      });
      f.addEventListener('input', e => { if (e.target.name !== 'unit') update(); });
      renderAmount();
      update();
      // Packaged food without ingredients (e.g. saved before, or a partial search result): fetch them now.
      if (!food.ingredients && food.barcode && (food.source === 'off' || food.source === 'custom') && food.ingredientsChecked !== today()) {
        $('#portion-ingr', body).innerHTML = '<p class="muted small">Looking up the ingredients on Open Food Facts…</p>';
        let status = true;
        F.lookupBarcode(food.barcode, { country: D().profile.country }).then(full => {
          if (full && full.ingredients) {
            food.ingredients = full.ingredients;
            if (D().foods[food.id]) { D().foods[food.id].ingredients = full.ingredients; S.save(); }
          }
        }).catch(() => { status = 'failed'; }).then(() => {
          if (!body.isConnected) return;
          $('#portion-ingr', body).innerHTML = ingredientsBlock(food, status);
          update();
        });
      }

      f.addEventListener('submit', e => {
        e.preventDefault();
        readAmount();
        const grams = portionGrams(por, food);
        if (!(grams > 0)) { alert('Please fill in how much you had.'); return; }
        const portion = { unit: por.unit, qty: parseFloat(por.qty) || 0 };
        if (por.unit === 'pieces' || por.unit === 'whole') { portion.packSize = parseFloat(por.packSize) || 0; portion.pieces = parseInt(por.pieces, 10) || 0; }
        const snapshot = {
          id: food.id, source: food.source, barcode: food.barcode || '', name: food.name, brand: food.brand || '',
          per100: food.per100, ingredients: food.ingredients || '', unit: B, servings: srv,
          servingSize: food.servingSize || 100, servingLabel: food.servingLabel || '',
          packSize: portion.packSize || food.packSize || 0, pieces: portion.pieces || food.pieces || 0,
        };
        if (food.density) snapshot.density = food.density;
        D().foods[food.id] = Object.assign({}, saved, snapshot, { lastPortion: portion });
        const fields = { grams, portion, meal: f.meal.value, time: f.time.value, food: Object.assign({}, snapshot, { ingredients: '' }) };
        if (entry) Object.assign(entry, fields, { date: f.date.value || entry.date });
        else D().log.push(Object.assign({ id: S.uid(), date }, fields));
        S.save(); closeModal(); render();
      });
      body.addEventListener('click', e => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'del-entry') {
          D().log = D().log.filter(x => x !== entry); S.save(); closeModal(); render();
        } else if (a.dataset.act === 'edit-food' && food.source === 'recipe') {
          openRecipe({ meal: f.meal.value, date, entry }, D().foods[food.id] || food);
        } else if (a.dataset.act === 'edit-food') {
          openModal('<h2>Edit food</h2><div id="add-pane"></div>', b2 => {
            const preset = food.source === 'custom' ? food : Object.assign({}, food, { id: null, source: 'custom' });
            paneCustom($('#add-pane', b2), { meal: f.meal.value, date, entry }, preset);
          });
        }
      });
    });
  }

  function openEditEntry(id) {
    const entry = D().log.find(e => e.id === id);
    if (!entry) return;
    if (entry.quick) {
      openModal('<h2>Edit quick add</h2><div id="add-pane"></div>', b => paneQuick($('#add-pane', b), {}, entry));
      return;
    }
    openPortion({ food: fullFood(entry), meal: entry.meal, date: entry.date, entry });
  }

  // ---------- symptoms ----------
  function openSymptom(existing, severity) {
    const s = existing || { date: state.date, time: state.date === today() ? nowTime() : '20:00', types: [], severity: severity != null ? severity : 3, bristol: '', notes: '' };
    openModal(`
      <h2>${existing ? 'Edit' : 'Log'} symptoms</h2>
      <form id="sym" class="form">
        <div class="grid2"><label>Date<input type="date" name="date" value="${s.date}" required></label><label>Time<input type="time" name="time" value="${s.time}" required></label></div>
        <fieldset><legend>What are you feeling?</legend><div class="chip-picker">
          ${I.SYMPTOMS.map(t => `<label class="pick"><input type="checkbox" name="types" value="${esc(t)}" ${s.types.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}
        </div></fieldset>
        <label>Overall severity: <b id="sev-val">${s.severity}</b>/10<input type="range" name="severity" min="0" max="10" step="1" value="${s.severity}"></label>
        <label>Bowel movement (Bristol stool scale) <span class="muted">(optional)</span>
          <select name="bristol"><option value="">—</option>${Object.entries(I.BRISTOL).map(([k, v]) => `<option value="${k}" ${String(s.bristol) === k ? 'selected' : ''}>Type ${k}: ${v}</option>`).join('')}</select></label>
        <label>Notes<input name="notes" value="${esc(s.notes || '')}" placeholder="Stress, sleep, period, medication…"></label>
        <div class="row-actions"><button class="btn">Save</button>${existing ? '<button type="button" class="btn danger ghost" id="del">Delete</button>' : ''}</div>
      </form>`, b => {
      const f = $('#sym', b);
      f.severity.addEventListener('input', () => { $('#sev-val', b).textContent = f.severity.value; });
      f.addEventListener('submit', e => {
        e.preventDefault();
        const rec = {
          id: s.id || S.uid(), date: f.date.value, time: f.time.value,
          types: $$('input[name=types]:checked', f).map(x => x.value), severity: +f.severity.value,
          bristol: f.bristol.value ? +f.bristol.value : '', notes: f.notes.value.trim(),
        };
        if (existing) Object.assign(existing, rec); else D().symptoms.push(rec);
        S.save(); closeModal(); render();
      });
      if (existing) $('#del', b).addEventListener('click', () => { D().symptoms = D().symptoms.filter(x => x !== existing); S.save(); closeModal(); render(); });
    });
  }

  // ---------- weight ----------
  function openWeight(existing) {
    const w = existing || { date: state.date, kg: currentWeight(), bodyFat: '', waistCm: '', note: '' };
    openModal(`
      <h2>${existing ? 'Edit' : 'Log'} weigh-in</h2>
      <form id="wf" class="form">
        <label>Date<input type="date" name="date" value="${w.date}" required></label>
        <label>Weight ${weightInput('kg', w.kg)}</label>
        <div class="grid2">
          <label>Body fat % <span class="muted">(optional)</span><input type="number" name="bodyFat" step="0.1" min="2" max="70" value="${w.bodyFat || ''}" inputmode="decimal"></label>
          <label>Waist cm <span class="muted">(optional)</span><input type="number" name="waistCm" step="0.1" min="30" max="250" value="${w.waistCm || ''}" inputmode="decimal"></label>
        </div>
        <label>Note<input name="note" value="${esc(w.note || '')}"></label>
        <p class="muted small">Tip: weigh first thing in the morning after the loo, before eating. Daily ups and downs are smoothed into a trend.</p>
        <div class="row-actions"><button class="btn">Save</button>${existing ? '<button type="button" class="btn danger ghost" id="del">Delete</button>' : ''}</div>
      </form>`, b => {
      const f = $('#wf', b);
      f.addEventListener('submit', e => {
        e.preventDefault();
        const kg = readWeight(f, 'kg');
        if (!kg || kg < 20 || kg > 400) { alert('Please enter a valid weight.'); return; }
        const rec = { id: w.id || S.uid(), date: f.date.value, kg: Math.round(kg * 100) / 100,
          bodyFat: f.bodyFat.value ? +f.bodyFat.value : '', waistCm: f.waistCm.value ? +f.waistCm.value : '', note: f.note.value.trim() };
        // one weigh-in per day
        const clash = D().weights.find(x => x !== existing && x.date === rec.date);
        if (clash && !confirm(`There's already a weigh-in of ${fmtW(clash.kg)} on that date. Replace it?`)) return;
        D().weights = D().weights.filter(x => x !== existing && x !== clash);
        D().weights.push(rec);
        S.save(); closeModal(); render();
      });
      if (existing) $('#del', b).addEventListener('click', () => { D().weights = D().weights.filter(x => x !== existing); S.save(); closeModal(); render(); });
    });
  }

  // =====================================================================
  // PROGRESS
  // =====================================================================
  function renderProgress(root) {
    const tr = trend();
    const t = currentTargets();
    const p = D().profile;
    const end = today();
    const start = state.range ? C.addDays(end, -state.range) : (tr[0] ? tr[0].date : end);
    const inRange = tr.filter(x => x.date >= start);
    const rate = C.recentRate(tr, 21); // same 3-week window as the weekly check-in
    const adapt = C.adaptiveTdee(dailyKcal(), tr, 28);
    const first = tr[0], last = tr[tr.length - 1];

    function compCard() {
      const comp = D().weights.filter(w => w.bodyFat > 0).sort((a, b) => a.date < b.date ? -1 : 1);
      if (!comp.length) return '';
      const mass = w => ({ lean: w.kg * (1 - w.bodyFat / 100), fat: w.kg * w.bodyFat / 100 });
      const a = mass(comp[0]), z = mass(comp[comp.length - 1]);
      const change = (now, then) => comp.length > 1 ? ` <span class="muted small">(${signed(now - then)})</span>` : '';
      return `<section class="card"><h2>Body composition</h2>
        <div class="stats three">
          ${stat('Body fat', r1(comp[comp.length - 1].bodyFat) + '%', comp.length > 1 ? `${(comp[comp.length - 1].bodyFat - comp[0].bodyFat > 0 ? '+' : '−') + r1(Math.abs(comp[comp.length - 1].bodyFat - comp[0].bodyFat))} pts` : '')}
          ${stat('Lean mass', fmtW(z.lean) + change(z.lean, a.lean), '')}
          ${stat('Fat mass', fmtW(z.fat) + change(z.fat, a.fat), '')}
        </div>
        <p class="muted small">${comp.length > 1 ? 'Change since ' + C.parseDate(comp[0].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '. ' : ''}Estimated from body-fat % readings — when losing weight, the aim is for fat mass to fall while lean mass holds steady.</p>
        <div id="ch-comp"></div></section>`;
    }
    const stat = (label, value, sub) => `<div class="stat"><div class="muted small">${label}</div><div class="stat-v">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    const signed = kg => (kg > 0 ? '+' : kg < 0 ? '−' : '±') + C.formatWeight(Math.abs(kg), unit());
    const rateStr = rate == null ? '—' : (rate > 0 ? '+' : rate < 0 ? '−' : '') + C.formatRate(Math.abs(rate), unit()) + '/wk';

    let goalStr = '—', goalSub = '';
    if (p.goalWeightKg && last) {
      const left = p.goalWeightKg - last.trend;
      goalStr = fmtW(p.goalWeightKg);
      if (Math.abs(left) < 0.25) goalSub = 'Reached 🎉';
      else {
        goalSub = signed(left) + ' to go';
        if (rate && Math.sign(rate) === Math.sign(left)) {
          const wk = left / rate;
          const d = C.parseDate(end); d.setDate(d.getDate() + Math.round(wk * 7));
          goalSub += ` · at current pace ~${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        }
      }
    }

    root.innerHTML = coachCard(false) + `
      <section class="card">
        <div class="stats">
          ${stat('Trend weight', last ? fmtW(last.trend) : '—', last ? 'last weigh-in ' + fmtW(last.kg) : 'no weigh-ins yet')}
          ${stat('Total change', first && last ? signed(last.trend - first.kg) : '—', first ? 'since ' + C.parseDate(first.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')}
          ${stat('Last 3 weeks', rateStr, t ? 'planned ' + (t.direction === 'maintain' ? 'maintain' : (t.direction === 'lose' ? '−' : '+') + C.formatRate(Math.abs(p.rateKgPerWeek), unit()) + '/wk') : '')}
          ${stat('Goal', goalStr, goalSub)}
        </div>
        <div class="row-actions"><button class="btn" data-act="add-weight">+ Log weight</button></div>
      </section>

      <div class="seg range">${[[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], [0, 'All']].map(([v, l]) => `<button data-range="${v}" class="${state.range === v ? 'on' : ''}">${l}</button>`).join('')}</div>

      <section class="card"><h2>Weight timeline</h2><p class="muted small">Dots are daily weigh-ins; the line is your smoothed trend (ignores water-weight noise).${unit() === 'kg' ? '' : ' Chart scale in pounds.'}</p><div id="ch-weight"></div></section>
      ${compCard()}
      ${D().weights.some(w => w.waistCm) ? '<section class="card"><h2>Waist</h2><div id="ch-waist"></div></section>' : ''}
      <section class="card"><h2>Calories per day</h2><div id="ch-kcal"></div></section>
      <section class="card"><h2>Protein per day</h2><div id="ch-protein"></div></section>
      ${adapt ? `<section class="card"><h2>Your real-world maintenance</h2>
        <p>Based on ${adapt.loggedDays} logged days averaging <b>${fmtInt(adapt.avgIntake)} kcal</b> while your trend moved <b>${(adapt.kgPerWeek > 0 ? '+' : adapt.kgPerWeek < 0 ? '−' : '') + C.formatRate(Math.abs(adapt.kgPerWeek), unit())}/wk</b>,
        your maintenance is about <b>${fmtInt(adapt.tdee)} kcal/day</b>${t ? ` (formula estimate: ${fmtInt(t.formulaTdee)})` : ''}.</p>
        <p class="muted small">Only accurate if you log everything you eat. You can use this number in Goals → Advanced.</p></section>` : ''}
      <section class="card"><h2>Weigh-ins</h2>
        ${tr.length ? `<table class="list"><thead><tr><th>Date</th><th>Weight</th><th>Trend</th><th>Body fat</th><th></th></tr></thead><tbody>
          ${tr.slice().reverse().slice(0, state.allWeighIns ? tr.length : 10).map(x => { const w = D().weights.find(y => y.date === x.date); return `<tr>
            <td>${C.parseDate(x.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</td><td>${fmtW(x.kg)}</td><td class="muted">${fmtW(x.trend)}</td>
            <td>${w.bodyFat ? r1(w.bodyFat) + '%' : ''}</td><td><button class="link" data-act="edit-weight" data-id="${w.id}">Edit</button></td></tr>`; }).join('')}
          </tbody></table>${tr.length > 10 ? `<button class="btn ghost wide" id="toggle-weighins">${state.allWeighIns ? 'Show fewer' : `Show all ${tr.length} weigh-ins`}</button>` : ''}` : '<p class="muted">No weigh-ins yet.</p>'}
      </section>`;
    const tw = $('#toggle-weighins', root);
    if (tw) tw.addEventListener('click', () => { state.allWeighIns = !state.allWeighIns; render(); });

    $$('[data-range]', root).forEach(b => b.addEventListener('click', () => { state.range = +b.dataset.range; render(); }));

    const disp = kg => C.toDisplayNumber(kg, unit() === 'kg' ? 'kg' : 'lb');
    const wUnit = unit() === 'kg' ? 'kg' : 'lb';
    const wFmt = v => (Math.round(v * 10) / 10) + '';
    const series = [
      { name: 'Weigh-in', type: 'dots', color: 'var(--muted-mark)', points: inRange.map(x => ({ x: x.date, y: disp(x.kg) })), fmt: v => wFmt(v) + ' ' + wUnit },
      { name: 'Trend', type: 'line', color: 'var(--series-1)', points: inRange.map(x => ({ x: x.date, y: disp(x.trend) })), fmt: v => wFmt(v) + ' ' + wUnit },
    ];
    const refs = [];
    if (p.goalWeightKg) refs.push({ y: disp(p.goalWeightKg), label: 'Goal ' + fmtW(p.goalWeightKg) });
    // projection to goal at planned rate
    if (t && last && p.goalWeightKg && t.direction !== 'maintain' && p.rateKgPerWeek > 0) {
      const weeks = Math.min(Math.abs(p.goalWeightKg - last.trend) / p.rateKgPerWeek, 104);
      const endDate = C.addDays(last.date, Math.round(weeks * 7));
      const goalAt = last.trend + Math.sign(p.goalWeightKg - last.trend) * p.rateKgPerWeek * weeks;
      series.push({ name: 'Plan', type: 'line', dashed: true, color: 'var(--series-2)', points: [{ x: last.date, y: disp(last.trend) }, { x: endDate, y: disp(goalAt) }], fmt: v => wFmt(v) + ' ' + wUnit });
    }
    Charts.time($('#ch-weight', root), { series, refs, yFormat: wFmt, height: 240, empty: 'Log a weigh-in to start your timeline.', label: 'Weight over time' });

    if ($('#ch-comp', root)) {
      const compPts = D().weights.filter(w => w.bodyFat > 0 && w.date >= start).sort((a, b) => a.date < b.date ? -1 : 1);
      Charts.time($('#ch-comp', root), {
        series: [{ name: 'Body fat', type: 'line', color: 'var(--series-2)', points: compPts.map(w => ({ x: w.date, y: +w.bodyFat })), fmt: v => r1(v) + '%' }],
        yFormat: v => v + '%', label: 'Body fat percentage', empty: 'No body-fat readings in this period.',
      });
    }
    if ($('#ch-waist', root)) {
      const ws = D().weights.filter(w => w.waistCm && w.date >= start).sort((a, b) => a.date < b.date ? -1 : 1);
      Charts.time($('#ch-waist', root), { series: [{ name: 'Waist', type: 'line', color: 'var(--series-1)', points: ws.map(w => ({ x: w.date, y: w.waistCm })), fmt: v => r1(v) + ' cm' }], yFormat: v => r1(v) + '', label: 'Waist (cm)' });
    }

    const byDay = {};
    D().log.forEach(e => {
      if (e.date < start || e.date > end) return;
      const n = C.entryNutrients(e);
      byDay[e.date] = byDay[e.date] || C.emptyNutrients();
      C.NUTRIENTS.forEach(k => { byDay[e.date][k] += n[k]; });
    });
    const days = Object.keys(byDay).sort();
    // start at the first logged day (no empty months before you started), but never before the chosen range
    const barRange = { xMin: days.length ? (days[0] > start ? days[0] : start) : undefined, xMax: end };
    Charts.time($('#ch-kcal', root), Object.assign({
      series: [{ name: 'Calories', type: 'bars', color: 'var(--series-1)', points: days.map(d => ({ x: d, y: byDay[d].kcal })), fmt: v => fmtInt(v) + ' kcal',
        colorFn: pt => t && pt.y > t.calories * 1.1 ? 'var(--warn)' : null }],
      refs: t ? [{ y: t.calories, label: 'Target ' + fmtInt(t.calories) }] : [], yFormat: v => v >= 1000 ? (v / 1000) + 'k' : String(v),
      empty: 'Log some food to see daily calories.', label: 'Calories per day',
    }, barRange));
    Charts.time($('#ch-protein', root), Object.assign({
      series: [{ name: 'Protein', type: 'bars', color: 'var(--series-3)', points: days.map(d => ({ x: d, y: byDay[d].protein })), fmt: v => r0(v) + ' g' }],
      refs: t ? [{ y: t.protein, label: 'Target ' + t.protein + ' g' }] : [], yFormat: v => String(v),
      empty: 'Log some food to see daily protein.', label: 'Protein per day',
    }, barRange));
  }

  // =====================================================================
  // GUT
  // =====================================================================
  function renderGut(root) {
    const cats = categories();
    const opts = D().triggers.analysis;
    const A = analysisAll();
    const res = A.res, foodRes = A.foodRes;
    const enriched = D().log.map(e => ({ date: e.date, time: e.time, meal: e.meal, triggers: triggersFor(e), name: e.food ? e.food.name : '' }));
    const app = appetiteLink();

    // exposure in last 30 days
    const since = C.addDays(today(), -30);
    const occ30 = I.occasions(enriched.filter(e => e.date >= since));
    const exposure = cats.map(c => ({ c, n: occ30.filter(o => o.triggers.has(c.id)).length })).filter(x => x.n).sort((a, b) => b.n - a.n);

    const pct = v => Math.round(v * 100) + '%';
    const badge = v => `<span class="badge b-${v.replace(/\s+/g, '-').toLowerCase()}">${v}</span>`;

    const symDays = {};
    D().symptoms.forEach(s => { if (s.date >= C.addDays(today(), -60)) symDays[s.date] = Math.max(symDays[s.date] || 0, s.severity); });

    const watch = res.results.filter(r => A.suspectCats.has(r.id));
    root.innerHTML = `
      <section class="card profile">
        <h2>Your gut profile</h2>
        ${!watch.length && !A.suspectFoods.size && !A.safe.length ? `<p class="muted small">Builds up as you log meals and how your gut feels — usually after 2–3 weeks. It will show
          your <b>watch list</b> (likely triggers) and your <b>gut-safe foods</b>: foods you eat often without problems, so you can lean on them to gain weight.</p>` : ''}
        ${watch.length || A.suspectFoods.size ? `<h3>⚠ Watch list</h3><ul class="trig-list">
          ${watch.map(r => `<li>${chips([{ id: r.id, name: r.name, group: r.group, matches: [] }], true)}<span class="small muted">${r.verdict.toLowerCase()} · symptoms after ${pct(r.rateExposed)} of meals with it</span></li>`).join('')}
          ${Array.from(A.suspectFoods.values()).slice(0, 6).map(r => `<li><b class="small">${esc(r.name)}</b><span class="small muted">${r.exposedBad}/${r.exposures} times followed by symptoms</span></li>`).join('')}
        </ul><p class="muted small">Flagged with ⚠ in your diary and food search. To be sure, cut one out for 2–4 weeks, then reintroduce it.</p>` : ''}
        ${A.safe.length ? `<h3>✅ Gut-safe foods</h3><ul class="safe-list">${A.safe.map(x => `<li>${esc(x.r.name)} <span class="muted small">· ${x.r.exposures}×</span></li>`).join('')}</ul>
          <p class="muted small">Eaten often and no more likely to be followed by symptoms than anything else. Shown first when you add food — great for building up calories.</p>` : ''}
      </section>

      ${app ? `<section class="card"><h2>Gut & appetite</h2>
        <p>${app.diff > 50 ? `On rough gut days you eat about <b>${fmtInt(app.diff)} kcal less</b> (${fmtInt(app.bad)} vs ${fmtInt(app.calm)} kcal).`
          : `Your intake holds up on rough gut days (${fmtInt(app.bad)} vs ${fmtInt(app.calm)} kcal on calm days) — nice.`}</p>
        ${app.diff > 50 ? '<p class="muted small">On bad days, smaller and more frequent meals, liquid calories (a lactose-free milkshake) and your gut-safe foods help keep you on track.</p>' : ''}
        <p class="muted small">From ${app.badDays} rough and ${app.calmDays} calm days you logged.</p></section>` : ''}

      <section class="card">
        <h2>Trigger analysis</h2>
        <p class="muted small">For every meal, GutFuel checks the worst symptom you logged in the following ${opts.windowHours} h and compares meals that contained each trigger with meals that didn't.
        A “bad” meal is one followed by severity ≥ ${opts.threshold}. Based on ${res.occasions} meals and ${res.symptomCount} symptom logs.
        ${res.unlogged ? `${res.unlogged} meal${res.unlogged === 1 ? ' was' : 's were'} skipped because nothing (not even “felt fine”) was logged afterwards.` : ''}</p>
        ${res.symptomCount < 5 ? '<p class="hint">Log symptoms (including “felt fine”) for a couple of weeks to get meaningful results.</p>' : ''}
        ${res.results.length ? `<ul class="result-list">
          ${res.results.map(r => `<li>
            <div class="rl-head">${chips([{ name: r.name, group: r.group, matches: [] }], true)}${badge(r.verdict)}</div>
            <div class="small muted">Symptoms after <b>${pct(r.rateExposed)}</b> of ${r.exposures} meal${r.exposures === 1 ? '' : 's'} with it · ${pct(r.rateUnexposed)} of meals without</div>
            ${togetherNote(r)}
          </li>`).join('')}
          </ul>` : '<p class="muted">No triggers found in your diary yet.</p>'}
        <details class="more"><summary>Analysis settings</summary>
          <form id="an-form" class="form grid2">
            <label>Symptom window after eating (hours)<input type="number" name="windowHours" min="2" max="72" value="${opts.windowHours}"></label>
            <label>Ignore the first (hours)<input type="number" name="minHours" min="0" max="12" value="${opts.minHours}"></label>
            <label>Count as “bad” at severity ≥<input type="number" name="threshold" min="1" max="10" value="${opts.threshold}"></label>
          </form>
        </details>
      </section>

      <section class="card"><h2>Foods most often followed by symptoms</h2>
        ${foodRes.length ? `<ul class="trig-list">
        ${foodRes.map(r => `<li class="food-res"><div class="rl-head"><b>${esc(r.name)}</b>${badge(r.verdict)}</div>
          <div class="small muted">Symptoms after ${r.exposedBad} of ${r.exposures} times · ${pct(r.rateUnexposed)} of other meals</div>${togetherNote(r)}</li>`).join('')}
        </ul>` : `<p class="muted small">No individual food stands out yet. A food appears here once you've eaten it at least 3 times and it's
          followed by symptoms noticeably more often than other meals.</p>`}
      </section>

      <section class="card"><h2>Symptom severity (last 60 days)</h2><div id="ch-sym"></div>
        <div class="row-actions"><button class="btn ghost" data-act="add-symptom">+ Log symptoms</button></div></section>

      <section class="card"><h2>Trigger exposure (last 30 days)</h2>
        ${exposure.length ? `<ul class="bars">${exposure.map(x => `<li><span>${esc(x.c.name)}</span><span class="hbar"><i style="width:${x.n / exposure[0].n * 100}%"></i></span><b>${x.n}</b></li>`).join('')}</ul>
          <p class="muted small">Number of meals containing each trigger.</p>` : '<p class="muted">No triggers logged in the last 30 days.</p>'}
      </section>

      <section class="card"><h2>Your personal triggers</h2>
        <p class="muted small">Add anything you suspect that isn't covered — e.g. “Pork” or “Sesame”. Comma-separated keywords are matched in food names and ingredients.</p>
        <ul class="trig-list">${D().triggers.custom.map(c => `<li><span class="chip personal">${esc(c.name)}</span><span class="small">${esc(c.keywords.join(', '))}</span><button class="link" data-del-custom="${c.id}">Remove</button></li>`).join('')}</ul>
        <form id="custom-trig" class="form grid2">
          <label>Name<input name="name" required placeholder="e.g. Pork"></label>
          <label>Keywords<input name="keywords" required placeholder="pork, bacon, ham, sausage"></label>
          <button class="btn">Add trigger</button>
        </form>
      </section>

      <section class="card"><h2>What's checked automatically</h2>
        <ul class="ref-list">${I.CATEGORIES.map(c => `<li>${chips([{ name: c.name, group: c.group, matches: [] }], true)} <span class="small muted">${esc(c.info)}</span></li>`).join('')}</ul>
        <p class="muted small">Keyword matching can't know portion-dependent FODMAP levels. For a structured approach, the low-FODMAP diet (elimination → reintroduction) is best done with a dietitian; the Monash University FODMAP app has tested serving sizes.</p>
      </section>`;

    const symPts = Object.keys(symDays).sort().map(d => ({ x: d, y: symDays[d] }));
    Charts.time($('#ch-sym', root), {
      series: [{ name: 'Worst severity', type: 'bars', color: 'var(--series-2)', points: symPts, fmt: v => v + '/10' }],
      yMin: 0, yMax: 10, xMin: C.addDays(today(), -60), xMax: today(), yFormat: v => String(v), empty: 'No symptoms logged yet.', label: 'Symptom severity per day',
    });

    $('#an-form', root).addEventListener('change', e => {
      const f = e.currentTarget;
      D().triggers.analysis = { windowHours: +f.windowHours.value || 24, minHours: +f.minHours.value || 0, threshold: +f.threshold.value || 4 };
      S.save(); render();
    });
    $('#custom-trig', root).addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const keywords = f.keywords.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!f.name.value.trim() || !keywords.length) { alert('Add a name and at least one keyword.'); return; }
      D().triggers.custom.push({ id: S.uid(), name: f.name.value.trim(), keywords });
      S.save(); render();
    });
    $$('[data-del-custom]', root).forEach(b => b.addEventListener('click', () => {
      D().triggers.custom = D().triggers.custom.filter(c => c.id !== b.dataset.delCustom); S.save(); render();
    }));
  }

  /** Average calories on rough vs calm gut days (needs 3+ of each). */
  function appetiteLink() {
    const kcal = dailyKcal(), worst = {};
    D().symptoms.forEach(x => { worst[x.date] = Math.max(worst[x.date] || 0, x.severity); });
    const t = today();
    const days = Object.keys(worst).filter(d => d < t && kcal[d] > 0);
    const bad = days.filter(d => worst[d] >= D().triggers.analysis.threshold), calm = days.filter(d => worst[d] <= 2);
    if (bad.length < 3 || calm.length < 3) return null;
    const avg = arr => arr.reduce((a, d) => a + kcal[d], 0) / arr.length;
    return { bad: avg(bad), calm: avg(calm), diff: avg(calm) - avg(bad), badDays: bad.length, calmDays: calm.length };
  }

  /** "Always eaten with Chicken curry — can't tell which is the problem." */
  function togetherNote(r) {
    if (!r.togetherWith) return '';
    return `<div class="small together">↔ ${r.togetherWith.always ? 'Always' : 'Nearly always'} eaten with <b>${esc(r.togetherWith.name)}</b> —
      can't tell which is the problem yet. Try having one without the other.</div>`;
  }

  // =====================================================================
  // GOALS
  // =====================================================================
  function renderGoals(root) {
    const p = D().profile;
    const w = currentWeight();
    const u = unit();
    const imperial = u !== 'kg';
    const ft = Math.floor(p.heightCm / 30.48), inch = r1((p.heightCm - ft * 30.48) / 2.54);
    const rates = [0.1, 0.2, 0.25, 0.35, 0.5, 0.75];

    const welcome = !D().meta.welcomeDismissed && (!profileComplete() || w == null || !D().log.length) ? `
      <section class="card welcome">
        <h2>Welcome to GutFuel 👋</h2>
        <p>Helps you <b>gain weight steadily and healthily</b> while keeping your <b>IBS</b> in check. No account, no ads — everything stays on this phone.</p>
        <ol>
          <li class="${profileComplete() ? 'done' : ''}">Fill in <b>about you</b> and your <b>goal</b> below</li>
          <li class="${w != null ? 'done' : ''}">Log today's <b>weigh-in</b></li>
          <li class="${D().log.length ? 'done' : ''}">Log what you eat in the <a href="#diary">Diary</a> and tap how your gut feels each day</li>
        </ol>
        <p class="small muted">After 2–3 weeks, GutFuel learns your likely triggers and your gut-safe foods, and the weekly check-in fine-tunes your calories so you gain at a steady pace. Back up from Settings now and then.</p>
        ${profileComplete() && w != null ? '<button class="btn ghost" data-act="dismiss-welcome">Got it</button>' : ''}
      </section>` : '';
    root.innerHTML = welcome + `
      <section class="card">
        <h2>About you</h2>
        <form id="goal-form" class="form">
          <div class="grid2">
            <label>Sex (for BMR formula)<select name="sex"><option value="male">Male</option><option value="female">Female</option></select></label>
            <label>Date of birth<input type="date" name="birthDate" value="${p.birthDate || ''}"></label>
            ${imperial ? `<label>Height<span class="inline"><input type="number" name="ft" min="3" max="8" value="${ft}"> ft <input type="number" name="in" min="0" max="11.9" step="0.1" value="${inch}"> in</span></label>`
              : `<label>Height (cm)<input type="number" name="heightCm" min="100" max="250" step="0.5" value="${p.heightCm || ''}" placeholder="e.g. 175"></label>`}
            <label>Current weight<span class="inline"><b>${w != null ? fmtW(w) : '—'}</b> <button type="button" class="link" data-act="add-weight">${w != null ? 'update' : 'log weigh-in'}</button></span></label>
          </div>
          <label>Activity level<select name="activity">${Object.entries(C.ACTIVITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
          <h2>Goal</h2>
          <div class="grid2">
            <label>Goal weight ${weightInput('goal', p.goalWeightKg)}</label>
            <label>Rate per week<select name="rate">${rates.map(r => `<option value="${r}">${C.formatRate(r, u)}${r === 0.25 ? ' — steady (recommended)' : r <= 0.1 ? ' — very gentle' : r >= 0.5 ? ' — fast' : ''}</option>`).join('')}</select><span class="muted small" id="rate-note"></span></label>
          </div>
          <details class="more"><summary>Advanced</summary>
            <div class="grid2">
              <label>Protein (g per kg body weight)<input type="number" name="proteinPerKg" step="0.1" min="0" max="4" placeholder="auto" value="${p.proteinPerKg || ''}"></label>
              <label>Fat (% of calories)<input type="number" name="fatPct" step="1" min="10" max="60" placeholder="25" value="${p.fatPct || ''}"></label>
              <label>Maintenance override (kcal)<input type="number" name="tdeeOverride" min="0" placeholder="formula" value="${p.tdeeOverride || ''}"></label>
              <label>Calorie target override (kcal)<input type="number" name="calorieOverride" min="0" placeholder="auto" value="${p.calorieOverride || ''}"></label>
            </div>
            <p class="muted small">Leave blank to use sensible defaults: protein 2.0 g/kg when cutting, 1.8 when gaining, 1.6 to maintain; fat 25%; carbs fill the rest.</p>
          </details>
        </form>
      </section>
      <section class="card" id="goal-results"></section>`;

    const f = $('#goal-form', root);
    f.sex.value = p.sex;
    f.activity.value = p.activity;
    f.rate.value = String(rates.reduce((a, b) => Math.abs(b - p.rateKgPerWeek) < Math.abs(a - p.rateKgPerWeek) ? b : a));

    const syncRate = () => {
      const dir = currentWeight() != null ? C.goalDirection(currentWeight(), p.goalWeightKg) : 'maintain';
      f.rate.disabled = dir === 'maintain';
      $('#rate-note', root).textContent = dir === 'maintain' ? 'Only used when your goal differs from your current weight.' : '';
    };
    const showResults = () => {
      syncRate();
      const box = $('#goal-results', root);
      const t = currentTargets();
      if (!t) {
        box.innerHTML = `<h2>Your daily targets</h2><p class="hint">${esc(profileProblem())} ${w == null ? 'Log your current weight.' : ''}</p>`;
        return;
      }
      const pctOf = g => Math.round(g / t.calories * 100);
      const adapt = C.adaptiveTdee(dailyKcal(), trend(), 28);
      box.innerHTML = `
        <h2>Your daily targets</h2>
        <div class="target-big"><span class="big">${fmtInt(t.calories)}</span> kcal/day</div>
        <p class="muted">${t.direction === 'maintain' ? 'Maintenance' : (t.direction === 'lose' ? 'Deficit ' : 'Surplus ') + fmtInt(Math.abs(t.dailyDelta)) + ' kcal/day'}
          · BMR ${fmtInt(t.bmr)} · maintenance ${fmtInt(t.tdee)}${p.tdeeOverride ? ' (your override)' : ''}</p>
        ${t.calorieAdjust ? `<p class="small">Includes weekly check-in adjustments of <b>${t.calorieAdjust > 0 ? '+' : '−'}${Math.abs(t.calorieAdjust)} kcal</b>. <button class="link" id="reset-adjust">Reset</button></p>` : ''}
        ${t.direction === 'gain' ? `<p class="muted small">Healthy gain is about ${C.formatRate(t.healthyMaxGain, unit())} a week at most for you. Pair it with strength training 2–3× a week so the gain is mostly muscle.</p>` : ''}
        <div class="macro-split">
          <div><span class="key-dot" style="background:var(--series-1)"></span><b>${t.protein} g</b> protein<br><span class="muted small">${pctOf(t.protein * 4)}% of calories</span></div>
          <div><span class="key-dot" style="background:var(--series-3)"></span><b>${t.carbs} g</b> carbs<br><span class="muted small">${pctOf(t.carbs * 4)}%</span></div>
          <div><span class="key-dot" style="background:var(--series-2)"></span><b>${t.fat} g</b> fat<br><span class="muted small">${pctOf(t.fat * 9)}%</span></div>
        </div>
        <div class="seg-bar" aria-hidden="true"><i style="flex:${t.protein * 4};background:var(--series-1)"></i><i style="flex:${Math.max(0, t.carbs * 4)};background:var(--series-3)"></i><i style="flex:${t.fat * 9};background:var(--series-2)"></i></div>
        <ul class="facts">
          <li>Fibre: about <b>${t.fiber} g</b> — raise it slowly; much more can fill you up and flare IBS</li>
          <li>Saturated fat: under <b>${t.satFatMax} g</b> · Salt: under <b>6 g</b> · Free sugars: under <b>${t.sugarMax} g</b></li>
          <li>BMI ${t.bmi}${t.goalDate ? ` · goal reached around <b>${C.parseDate(t.goalDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b> (${t.weeksToGoal} weeks)` : ''}</li>
        </ul>
        ${t.warnings.map(x => `<p class="warn-box">⚠️ ${esc(x)}</p>`).join('')}
        ${adapt && !p.tdeeOverride ? `<p class="hint">From your logs, your real maintenance looks like <b>${fmtInt(adapt.tdee)} kcal</b>. <button class="link" id="use-adapt">Use this</button></p>` : ''}
        <p class="muted small">Estimates use the Mifflin-St Jeor equation and ~7,700 kcal per kg of body weight. Revisit every few weeks as your weight changes — targets update automatically from your trend weight.</p>`;
      const ua = $('#use-adapt', box);
      if (ua) ua.addEventListener('click', () => { p.tdeeOverride = adapt.tdee; p.calorieAdjust = 0; S.save(); render(); });
      const ra = $('#reset-adjust', box);
      if (ra) ra.addEventListener('click', () => { p.calorieAdjust = 0; S.save(); render(); });
    };

    f.addEventListener('input', () => {
      p.sex = f.sex.value;
      p.birthDate = f.birthDate.value;
      if (imperial) p.heightCm = r1(((+f.ft.value || 0) * 12 + (+f.in.value || 0)) * 2.54);
      else p.heightCm = +f.heightCm.value || 0;
      p.activity = f.activity.value;
      p.goalWeightKg = readWeight(f, 'goal');
      p.rateKgPerWeek = +f.rate.value;
      p.proteinPerKg = +f.proteinPerKg.value || 0;
      p.fatPct = +f.fatPct.value || 0;
      p.tdeeOverride = +f.tdeeOverride.value || 0;
      p.calorieOverride = +f.calorieOverride.value || 0;
      S.save();
      showResults();
    });
    showResults();
  }

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function renderSettings(root) {
    const p = D().profile;
    const countries = [['world', 'Worldwide'], ['uk', 'United Kingdom'], ['ie', 'Ireland'], ['us', 'United States'], ['ca', 'Canada'], ['au', 'Australia'], ['fr', 'France'], ['de', 'Germany']];
    root.innerHTML = `
      ${installPrompt && !isStandalone() ? `<section class="card"><h2>Install GutFuel</h2>
        <p class="small">Add GutFuel to your home screen so it opens like a normal app, full-screen and offline.</p>
        <button class="btn" data-act="install">Install app</button></section>` : ''}
      <p class="version-line muted small">GutFuel <b>${esc(versionLabel())}</b> · <a href="${REPO_URL}/commits/main" target="_blank" rel="noopener">What's changed</a></p>
      <section class="card"><h2>Preferences</h2>
        <form id="prefs" class="form grid2">
          <label>Weight unit<select name="unit"><option value="kg">Kilograms</option><option value="st">Stone & pounds</option><option value="lb">Pounds</option></select></label>
          <label>Food database region<select name="country">${countries.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
        </form>
      </section>
      <section class="card"><h2>Food sources</h2>
        <form id="sources" class="form">
          <label class="check"><input type="checkbox" name="usdaSearch" ${p.usdaSearch !== false ? 'checked' : ''}> Also search USDA for generic foods (fruit, veg, meat, grains…)</label>
          <label>USDA API key <span class="muted">(optional)</span><input name="usdaKey" autocomplete="off" spellcheck="false" value="${esc(p.usdaKey || '')}" placeholder="Using the shared demo key"></label>
        </form>
        <p class="muted small">Packaged foods come from Open Food Facts; generic foods from USDA FoodData Central. The shared USDA key allows about 30 searches an hour —
          a free personal key (instant, by email) allows 1,000: <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">get one here</a>, then paste it above. It's kept only on this phone.</p>
      </section>
      <section class="card"><h2>Your data</h2>
        <p>Everything is stored only in this browser on this device — no account, no server, no tracking. Food searches are sent to <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> and, if switched on, USDA FoodData Central (just the search words).</p>
        <p class="muted small">${sizeText(JSON.stringify(D()).length)} used · ${plural(D().log.length, 'diary entry', 'diary entries')} · ${plural(D().weights.length, 'weigh-in')} · ${plural(D().symptoms.length, 'symptom log')} · ${plural(Object.keys(D().foods).length, 'saved food')}</p>
        <p class="small"><b>Last backup:</b> ${D().meta.lastBackup ? C.parseDate(D().meta.lastBackup).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'never'}</p>
        <p class="hint">Export a backup regularly — clearing browser data deletes everything. Import the file on another device to move your data.</p>
        <div class="row-actions">
          <button class="btn" id="export">Export backup</button>
          <label class="btn ghost">Import backup<input type="file" id="import" accept="application/json,.json" hidden></label>
          <button class="btn ghost" id="export-csv">Export diary CSV</button>
        </div>
      </section>
      <section class="card about"><h2>About</h2>
        <p>GutFuel <b>${esc(versionLabel())}</b></p>
        ${appVersion && appVersion.version ? `<p class="muted small">Released ${new Date(appVersion.built).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${appVersion.commit ? ' · build ' + esc(appVersion.commit.slice(0, 7)) : ''}</p>`
          : appVersion && appVersion.dev ? '<p class="muted small">Running from the source files, not the published site, so there\'s no release number.</p>' : ''}
        <p class="small"><a href="${REPO_URL}/commits/main" target="_blank" rel="noopener">See what changed</a></p>
        <p class="muted small">The version updates automatically every time a change reaches the main code.</p>
      </section>
      <section class="card"><h2>Danger zone</h2><button class="btn danger" id="reset">Delete all data</button></section>
      <p class="muted small center">GutFuel — a private, personal tool. Not medical advice.</p>`;
    const f = $('#prefs', root);
    f.unit.value = p.unit; f.country.value = p.country;
    f.addEventListener('change', () => { p.unit = f.unit.value; p.country = f.country.value; S.save(); });
    const src = $('#sources', root);
    src.addEventListener('change', () => { p.usdaSearch = src.usdaSearch.checked; p.usdaKey = src.usdaKey.value.trim(); searchCache.clear(); S.save(); });

    const download = (name, text, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#export', root).addEventListener('click', () => { backupNow(); render(); });
    $('#export-csv', root).addEventListener('click', () => {
      const q = v => {
        let t = String(v == null ? '' : v);
        if (/^[=+@\t\r-]/.test(t) && !/^-?\d/.test(t)) t = "'" + t; // e.g. a food called "=SUM(...)" stays text in Excel
        return '"' + t.replace(/"/g, '""') + '"';
      };
      const rows = [['date', 'time', 'meal', 'food', 'brand', 'portion', 'amount', 'unit', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fibre', 'salt', 'triggers']];
      D().log.slice().sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1).forEach(e => {
        const n = C.entryNutrients(e);
        rows.push([e.date, e.time, e.meal, e.food ? e.food.name : '', e.food ? e.food.brand : '',
          e.quick ? 'quick add' : (e.portion && portionText(e.portion, e.food)) || '', r0(e.grams), e.quick ? '' : Units.base(e.food), r0(n.kcal), r1(n.protein), r1(n.carbs), r1(n.sugar), r1(n.fat), r1(n.satFat), r1(n.fiber), r1(n.salt),
          triggersFor(e).map(t => t.name).join('; ')]);
      });
      download(`gutfuel-diary-${today()}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
    });
    $('#import', root).addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = ''; // so choosing the same file again still triggers
      if (!file) return;
      if (!confirm('Replace all current data with this backup?')) return;
      try { S.importJSON(await file.text()); alert('Backup restored.'); render(); }
      catch (err) { alert('Import failed — your current data has not been changed.\n\n' + err.message); }
    });
    $('#reset', root).addEventListener('click', () => {
      if (confirm('Delete ALL diary entries, weigh-ins, symptoms and settings? Export a backup first if unsure.') && confirm('Really delete everything?')) { S.reset(); render(); }
    });
  }

  // ---------- global actions ----------
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a || a.closest('#modal')) return;
    const act = a.dataset.act;
    if (act === 'prev-day') { state.date = C.addDays(state.date, -1); render(); }
    else if (act === 'next-day') { state.date = C.addDays(state.date, 1); render(); }
    else if (act === 'add-food') openAddFood(a.dataset.meal);
    else if (act === 'edit-entry') openEditEntry(a.dataset.id);
    else if (act === 'copy-meal') {
      const prev = C.addDays(state.date, -1);
      D().log.filter(x => x.date === prev && x.meal === a.dataset.meal).forEach(x => D().log.push(Object.assign(JSON.parse(JSON.stringify(x)), { id: S.uid(), date: state.date })));
      S.save(); render();
    }
    else if (act === 'add-symptom') openSymptom();
    else if (act === 'checkin') {
      const sev = +a.dataset.sev;
      if (sev === 0) {
        D().symptoms.push({ id: S.uid(), date: state.date, time: state.date === today() ? nowTime() : '21:00', types: [], severity: 0, bristol: '', notes: '' });
        S.save(); render();
      } else openSymptom(null, sev);
    }
    else if (act === 'topup') {
      const b = F.BOOSTERS[+a.dataset.i];
      if (b) openPortion({ food: D().foods[b.food.id] ? Object.assign({}, b.food, D().foods[b.food.id]) : b.food, meal: mealForNow(), date: state.date,
        portion: { unit: Units.base(b.food) === 'ml' ? 'v:ml' : 'w:g', qty: b.amount } });
    }
    else if (act === 'apply-coach') {
      D().profile.calorieAdjust = (Number(D().profile.calorieAdjust) || 0) + (+a.dataset.kcal || 0);
      D().meta.coachAppliedOn = today();
      S.save(); render();
    }
    else if (act === 'no-symptoms') {
      D().symptoms.push({ id: S.uid(), date: state.date, time: '21:00', types: [], severity: 0, bristol: '', notes: '' });
      S.save(); render();
    }
    else if (act === 'edit-symptom') openSymptom(D().symptoms.find(s => s.id === a.dataset.id));
    else if (act === 'add-weight') openWeight();
    else if (act === 'backup-now') { backupNow(); render(); }
    else if (act === 'dismiss-update') { state.justUpdated = null; render(); }
    else if (act === 'dismiss-welcome') { D().meta.welcomeDismissed = true; S.save(); render(); }
    else if (act === 'install') installApp();
    else if (act === 'edit-weight') openWeight(D().weights.find(w => w.id === a.dataset.id));
  });

  async function backfillIngredients() {
    if (navigator.onLine === false) return;
    const t = today();
    const todo = Object.values(D().foods)
      .filter(f => f.barcode && !f.ingredients && (f.source === 'off' || f.source === 'custom') && f.ingredientsChecked !== t)
      .slice(0, 8);
    let changed = false;
    for (const f of todo) {
      try {
        const full = await F.lookupBarcode(f.barcode, { country: D().profile.country });
        if (full && full.ingredients) { f.ingredients = full.ingredients; changed = true; }
        else { f.ingredientsChecked = t; changed = true; } // not on Open Food Facts yet — try again another day
      } catch (_) { break; }                               // offline or overloaded: try next launch
      await new Promise(r => setTimeout(r, 1500));         // be gentle with the free service
    }
    if (changed) { S.save(); if (['diary', 'gut'].includes(currentView()) && !modal.open) render(); }
  }

  // One-off space saving for data logged before ingredient lists were stored once per food.
  (function compact() {
    let changed = false;
    D().log.forEach(e => {
      const lib = e.food && e.food.id && D().foods[e.food.id];
      if (e.food && e.food.ingredients && !e.quick) {
        if (!lib) D().foods[e.food.id] = Object.assign({}, e.food);
        else if (!lib.ingredients) lib.ingredients = e.food.ingredients;
        if (D().foods[e.food.id].ingredients === e.food.ingredients) { e.food.ingredients = ''; changed = true; }
      }
    });
    if (changed) S.save();
  })();

  // Ask the browser not to clear this app's storage when the phone is low on space.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- version ----------
  // version.json is stamped by GitHub Pages (Jekyll) on every push to main.
  const REPO_URL = 'https://github.com/jryan98/git_test';
  let appVersion = null;
  async function loadVersion() {
    try {
      const res = await fetch('version.json', { cache: 'no-store' });
      const text = await res.text();
      appVersion = /\{\{|^\s*---/.test(text) ? { dev: true } : JSON.parse(text);
    } catch (_) {
      appVersion = { unknown: true };
    }
    if (appVersion.version) {
      const seen = D().meta.seenVersion;
      if (seen && seen !== appVersion.version) state.justUpdated = { from: seen, to: appVersion.version };
      if (seen !== appVersion.version) { D().meta.seenVersion = appVersion.version; S.save(); }
    }
    if (currentView() === 'settings' || (state.justUpdated && currentView() === 'diary')) render();
  }
  function versionLabel() {
    if (!appVersion) return 'checking…';
    if (appVersion.dev) return 'development copy';
    if (appVersion.unknown) return 'unknown (offline)';
    return 'v' + appVersion.version;
  }
  function updateNotice() {
    if (!state.justUpdated) return '';
    return `<section class="card updated"><b>✨ GutFuel was updated</b>
      <p class="small">Now on <b>v${esc(state.justUpdated.to)}</b> (you had v${esc(state.justUpdated.from)}).</p>
      <div class="row-actions"><a class="btn ghost" href="${REPO_URL}/commits/main" target="_blank" rel="noopener">See what changed</a>
      <button class="btn ghost subtle" data-act="dismiss-update">OK</button></div></section>`;
  }

  // first run → goals
  if (!location.hash && !profileComplete() && !D().log.length) location.hash = '#goals';
  render();
  loadVersion();
  setTimeout(backfillIngredients, 4000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // An installed app is often resumed rather than reopened, so look for a new release whenever it comes
      // back to the foreground too. A new release reloads the app once (see sw.js).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { reg.update().catch(() => {}); loadVersion(); }
      });
    }).catch(() => {});
  }
})();
