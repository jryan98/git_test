/* app.js — UI. Plain DOM, no framework. */
(function () {
  'use strict';
  const C = window.Calc, S = window.Store, I = window.IBS, F = window.Foods;

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
  const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
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
  const D = () => S.data;
  const unit = () => D().profile.unit || 'kg';
  const fmtW = kg => C.formatWeight(kg, unit());

  function categories() { return I.allCategories(D().triggers.custom); }
  function triggersFor(entry) { return I.detect(entry.food || { name: entry.name }, C.entryNutrients(entry), categories()); }
  function trend() { return C.weightTrend(D().weights); }
  function currentWeight() { const t = trend(); return t.length ? t[t.length - 1].trend : null; }
  function profileComplete() { const p = D().profile; return !!(p.birthDate && p.heightCm > 0); }
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
    return trigs.map(t => `<span class="chip ${small ? 'sm' : ''} ${t.group === 'FODMAP' ? 'fodmap' : t.group === 'Personal' ? 'personal' : ''}" title="${esc(t.matches.join(', '))}">${esc(t.name)}</span>`).join('');
  }
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
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
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

  // =====================================================================
  // DIARY
  // =====================================================================
  function renderDiary(root) {
    const d = state.date;
    const entries = D().log.filter(e => e.date === d);
    const tot = C.sumNutrients(entries.map(C.entryNutrients));
    const t = currentTargets();
    const symptoms = D().symptoms.filter(s => s.date === d).sort((a, b) => a.time < b.time ? -1 : 1);
    const weighIn = D().weights.find(w => w.date === d);

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

    let summary;
    if (t) {
      const remaining = t.calories - tot.kcal;
      summary = `
        <section class="card summary">
          <div class="kcal">
            <div><div class="big">${fmtInt(tot.kcal)}</div><div class="muted">eaten</div></div>
            <div class="op">/</div>
            <div><div class="big soft">${fmtInt(t.calories)}</div><div class="muted">target</div></div>
            <div class="rem ${remaining < 0 ? 'over' : ''}"><div class="big">${fmtInt(Math.abs(remaining))}</div><div class="muted">${remaining < 0 ? 'over' : 'left'}</div></div>
          </div>
          ${meter(tot.kcal, t.calories)}
          <div class="macros">
            ${macroRow('Protein', tot.protein, t.protein, 'min')}
            ${macroRow('Carbs', tot.carbs, t.carbs)}
            ${macroRow('Fat', tot.fat, t.fat)}
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
        </section>`;
    } else {
      summary = `
        <section class="card summary">
          <div class="kcal"><div><div class="big">${fmtInt(tot.kcal)}</div><div class="muted">kcal eaten</div></div>
          <div class="macro-mini">P ${r0(tot.protein)} g · C ${r0(tot.carbs)} g · F ${r0(tot.fat)} g · Fibre ${r0(tot.fiber)} g</div></div>
          <p class="hint">Set up <a href="#goals">your goals</a> and log a weigh-in to get calorie & macro targets.</p>
        </section>`;
    }

    const trigHTML = dayTrig.size ? `
      <section class="card">
        <h2>Possible IBS triggers today</h2>
        <ul class="trig-list">
          ${Array.from(dayTrig.values()).map(tr => `<li>${chips([tr])}<span class="muted small">${esc(Array.from(new Set(tr.foods)).join(', '))}</span></li>`).join('')}
        </ul>
      </section>` : '';

    const mealsHTML = MEALS.map(([id, name]) => {
      const list = entries.filter(e => e.meal === id).sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1);
      const kcal = list.reduce((s, e) => s + C.entryNutrients(e).kcal, 0);
      const prevHas = D().log.some(e => e.date === C.addDays(d, -1) && e.meal === id);
      return `
        <section class="card meal">
          <header><h2>${name}</h2><span class="muted">${list.length ? fmtInt(kcal) + ' kcal' : ''}</span></header>
          <ul class="entries">
            ${list.map(e => {
              const n = C.entryNutrients(e);
              const tr = triggersFor(e);
              const amount = e.quick ? 'Quick add' : r0(e.grams) + ' g';
              return `<li><button class="entry" data-act="edit-entry" data-id="${e.id}">
                <span class="e-main"><span class="e-name">${esc(e.food ? e.food.name : e.name)}</span>
                <span class="muted small">${esc(e.food && e.food.brand && e.food.brand !== 'Generic' ? e.food.brand + ' · ' : '')}${amount}${e.time ? ' · ' + e.time : ''}</span>
                ${tr.length ? `<span class="e-chips">${chips(tr, true)}</span>` : ''}</span>
                <span class="e-kcal">${fmtInt(n.kcal)}<small> kcal</small><br><small class="muted">P${r0(n.protein)} C${r0(n.carbs)} F${r0(n.fat)}</small></span>
              </button></li>`;
            }).join('')}
          </ul>
          <div class="row-actions">
            <button class="btn ghost" data-act="add-food" data-meal="${id}">+ Add food</button>
            ${!list.length && prevHas ? `<button class="btn ghost subtle" data-act="copy-meal" data-meal="${id}">Copy yesterday's</button>` : ''}
          </div>
        </section>`;
    }).join('');

    const symHTML = `
      <section class="card">
        <header><h2>Gut symptoms</h2></header>
        ${symptoms.length ? `<ul class="entries">${symptoms.map(s => `
          <li><button class="entry" data-act="edit-symptom" data-id="${s.id}">
            <span class="e-main"><span class="e-name">${esc(s.types.length ? s.types.join(', ') : 'No symptoms')}</span>
            <span class="muted small">${s.time}${s.bristol ? ' · Bristol ' + s.bristol : ''}${s.notes ? ' · ' + esc(s.notes) : ''}</span></span>
            <span class="sev sev-${sevBand(s.severity)}">${s.severity}/10</span>
          </button></li>`).join('')}</ul>` : '<p class="muted">Nothing logged. Logging “no symptoms” days too makes the trigger analysis much more accurate.</p>'}
        <div class="row-actions">
          <button class="btn ghost" data-act="add-symptom">+ Log symptoms</button>
          ${!symptoms.length ? `<button class="btn ghost subtle" data-act="no-symptoms">Felt fine today</button>` : ''}
        </div>
      </section>`;

    const weightHTML = `
      <section class="card weigh">
        <header><h2>Weigh-in</h2>
        ${weighIn ? `<button class="link" data-act="edit-weight" data-id="${weighIn.id}">${fmtW(weighIn.kg)}${weighIn.bodyFat ? ' · ' + weighIn.bodyFat + '% fat' : ''}</button>`
          : `<button class="btn ghost" data-act="add-weight">+ Log weight</button>`}</header>
      </section>`;

    root.innerHTML = summary + trigHTML + mealsHTML + symHTML + weightHTML;
    $('#pick-date').addEventListener('change', e => { if (e.target.value) { state.date = e.target.value; render(); } });
  }

  function macroRow(label, value, target, kind, word) {
    return `<div class="mrow"><span>${label}</span><span class="mval">${r0(value)}${target ? ` <span class="muted">/ ${word ? word + ' ' : ''}${target}</span>` : ''} g</span>${target ? meter(value, target, kind) : ''}</div>`;
  }
  function sevBand(s) { return s >= 7 ? 'high' : s >= 4 ? 'mid' : s > 0 ? 'low' : 'none'; }

  // ---------- add food ----------
  function openAddFood(meal, date) {
    const ctx = { meal, date: date || state.date };
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
        cleanup = ({ search: paneSearch, barcode: paneBarcode, custom: (p, c) => paneCustom(p, c), quick: paneQuick })[id](pane, ctx) || null;
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
      <span class="muted small">${esc(f.brand || '')}${f.brand ? ' · ' : ''}${r0(f.per100.kcal)} kcal/100 g · P${r1(f.per100.protein)} C${r1(f.per100.carbs)} F${r1(f.per100.fat)}</span>
      ${tr.length ? `<span class="e-chips">${chips(tr, true)}</span>` : ''}</span></button></li>`;
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
    pane.innerHTML = `
      <form class="search" id="search-form"><input type="search" id="q" placeholder="Search foods, e.g. “greek yoghurt” or a brand" autocomplete="off" enterkeyhint="search"><button class="btn">Search</button></form>
      <div id="results"></div>`;
    const q = $('#q', pane), results = $('#results', pane);
    let pool = new Map(), ctrl = null, timer = null;

    const remember = list => list.forEach(f => pool.set(f.id, f));
    function showLocal() {
      const query = q.value.trim();
      const myFoods = Object.values(D().foods);
      if (!query) {
        const rec = recentFoods();
        const mine = myFoods.filter(f => f.source === 'custom');
        remember(rec); remember(mine);
        results.innerHTML = (rec.length ? `<h3>Recent</h3><ul class="foods">${rec.map(foodRow).join('')}</ul>` : '') +
          (mine.length ? `<h3>My foods</h3><ul class="foods">${mine.map(foodRow).join('')}</ul>` : '') +
          (!rec.length && !mine.length ? '<p class="muted">Search Open Food Facts (millions of packaged foods) or the built-in list of basics.</p>' : '');
        return;
      }
      const local = F.searchLocal(query, myFoods.concat(F.GENERIC.filter(g => !D().foods[g.id]))).slice(0, 12);
      remember(local);
      results.innerHTML = `<ul class="foods">${local.map(foodRow).join('')}</ul><div id="off"><p class="muted">Press search to look up Open Food Facts…</p></div>`;
    }
    async function searchRemote() {
      const query = q.value.trim();
      if (query.length < 2) return;
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      let off = $('#off', results);
      if (!off) { showLocal(); off = $('#off', results); }
      off.innerHTML = '<p class="muted">Searching Open Food Facts…</p>';
      try {
        const list = await F.searchOFF(query, { country: D().profile.country, signal: ctrl.signal });
        remember(list);
        off.innerHTML = list.length ? `<h3>Open Food Facts</h3><ul class="foods">${list.map(foodRow).join('')}</ul>`
          : '<p class="muted">No matches on Open Food Facts. Try fewer words, or create the food yourself.</p>';
      } catch (err) {
        if (err.name !== 'AbortError') off.innerHTML = `<p class="error">Couldn't reach Open Food Facts (${esc(err.message)}). You can still use built-in foods or create your own.</p>`;
      }
    }
    q.addEventListener('input', () => { showLocal(); clearTimeout(timer); timer = setTimeout(searchRemote, 700); });
    $('#search-form', pane).addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); searchRemote(); });
    results.addEventListener('click', e => {
      const b = e.target.closest('[data-food]');
      if (b && pool.has(b.dataset.food)) openPortion({ food: pool.get(b.dataset.food), meal: ctx.meal, date: ctx.date });
    });
    showLocal();
    setTimeout(() => q.focus(), 50);
    return () => { clearTimeout(timer); if (ctrl) ctrl.abort(); };
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
      if (saved) return openPortion({ food: saved, meal: ctx.meal, date: ctx.date });
      out.innerHTML = '<p class="muted">Looking up…</p>';
      try {
        const f = await F.lookupBarcode(code, { country: D().profile.country });
        if (f && f.hasNutrition) return openPortion({ food: f, meal: ctx.meal, date: ctx.date });
        out.innerHTML = `<p>${f ? 'Found “' + esc(f.name) + '” but it has no nutrition data.' : 'Not in Open Food Facts.'}</p>
          <button class="btn" id="bc-create">Create it from the label</button>`;
        $('#bc-create', out).addEventListener('click', () => paneCustom(pane, ctx, Object.assign({ barcode: code }, f || {})));
      } catch (err) {
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

  function paneCustom(pane, ctx, preset) {
    preset = preset || {};
    const p = preset.per100 || {};
    const fields = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt'];
    pane.innerHTML = `
      <form id="custom-form" class="form">
        <label>Name<input name="name" required value="${esc(preset.name || '')}"></label>
        <label>Brand <span class="muted">(optional)</span><input name="brand" value="${esc(preset.brand && preset.brand !== 'Generic' ? preset.brand : '')}"></label>
        <label>Ingredients <span class="muted">(copy from the pack — used for IBS trigger detection)</span><textarea name="ingredients" rows="3">${esc(preset.ingredients || '')}</textarea></label>
        <div class="grid2">
          <label>Nutrition values are<select name="basis"><option value="100">per 100 g / ml</option><option value="serving">per serving</option></select></label>
          <label>Serving size (g / ml)<input name="servingSize" type="number" step="any" min="0" value="${preset.servingSize || 100}"></label>
        </div>
        <div class="grid2">
          ${fields.map(k => `<label>${NUT_LABEL[k]} (${unitOf(k)})<input name="${k}" type="number" step="any" min="0" inputmode="decimal" value="${p[k] != null ? p[k] : ''}" ${k === 'kcal' ? 'required' : ''}></label>`).join('')}
        </div>
        <button class="btn wide">Save food & continue</button>
      </form>`;
    $('#custom-form', pane).addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const serving = parseFloat(f.servingSize.value) || 100;
      const factor = f.basis.value === 'serving' ? 100 / serving : 1;
      const per100 = {};
      fields.forEach(k => { per100[k] = r1((parseFloat(f[k].value) || 0) * factor); });
      const keepId = preset.id && preset.source === 'custom';
      const food = {
        id: keepId ? preset.id : 'cust:' + S.uid(), source: 'custom', barcode: preset.barcode || '',
        name: f.name.value.trim(), brand: f.brand.value.trim(), ingredients: f.ingredients.value.trim(),
        servingSize: serving, servingLabel: '', per100,
      };
      D().foods[food.id] = food;
      S.save();
      openPortion({ food, meal: ctx.meal, date: ctx.date, entry: ctx.entry });
    });
  }

  function paneQuick(pane, ctx) {
    pane.innerHTML = `
      <form id="quick-form" class="form">
        <label>Description<input name="name" placeholder="e.g. Pub lunch, curry takeaway" required></label>
        <label>What was in it? <span class="muted">(optional — helps IBS tracking)</span><input name="ingredients" placeholder="e.g. onion, garlic, cream, chilli"></label>
        <div class="grid2">
          <label>Calories (kcal)<input name="kcal" type="number" min="0" step="any" required inputmode="decimal"></label>
          <label>Protein (g)<input name="protein" type="number" min="0" step="any" inputmode="decimal"></label>
          <label>Carbs (g)<input name="carbs" type="number" min="0" step="any" inputmode="decimal"></label>
          <label>Fat (g)<input name="fat" type="number" min="0" step="any" inputmode="decimal"></label>
        </div>
        <label>Time<input name="time" type="time" value="${ctx.date === today() ? nowTime() : I.MEAL_DEFAULT_TIME[ctx.meal]}"></label>
        <button class="btn wide">Add</button>
      </form>`;
    $('#quick-form', pane).addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const quick = Object.assign(C.emptyNutrients(), {
        kcal: +f.kcal.value || 0, protein: +f.protein.value || 0, carbs: +f.carbs.value || 0, fat: +f.fat.value || 0,
      });
      D().log.push({
        id: S.uid(), date: ctx.date, time: f.time.value, meal: ctx.meal, grams: 0, quick,
        food: { id: 'quick:' + S.uid(), name: f.name.value.trim(), brand: '', ingredients: f.ingredients.value.trim(), per100: null },
      });
      S.save(); closeModal(); render();
    });
  }

  // ---------- portion / edit entry ----------
  function openPortion({ food, meal, date, entry }) {
    const hasServing = food.servingSize && (food.servingLabel || food.servingSize !== 100);
    let grams = entry ? entry.grams : hasServing ? food.servingSize : 100;
    const time = entry ? entry.time : (date === today() ? nowTime() : I.MEAL_DEFAULT_TIME[meal]);
    const servingText = food.servingLabel ? `${food.servingLabel}${/\d\s*g/.test(food.servingLabel) ? '' : ' (' + r0(food.servingSize) + ' g)'}` : `serving (${r0(food.servingSize)} g)`;
    openModal(`
      <h2>${esc(food.name)}</h2>
      ${food.brand && food.brand !== 'Generic' ? `<p class="muted">${esc(food.brand)}</p>` : ''}
      <form id="portion" class="form">
        <div class="grid2">
          <label>Amount<input name="qty" type="number" min="0" step="any" inputmode="decimal" required></label>
          <label>Unit<select name="unit"><option value="g">grams / ml</option>${hasServing ? `<option value="serving">${esc(servingText)}</option>` : ''}</select></label>
          <label>Meal<select name="meal">${MEALS.map(([id, n]) => `<option value="${id}" ${id === meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Time<input name="time" type="time" value="${time}"></label>
        </div>
        <div id="portion-nut"></div>
        <div id="portion-trig"></div>
        ${food.ingredients ? `<details class="more"><summary>Ingredients</summary><p class="small">${esc(food.ingredients)}</p></details>` :
          '<p class="muted small">No ingredient list — IBS detection uses the food name only. <button type="button" class="link" data-act="edit-food">Add ingredients</button></p>'}
        <div class="row-actions">
          <button class="btn">${entry ? 'Save' : 'Add to diary'}</button>
          ${entry ? '<button type="button" class="btn danger ghost" data-act="del-entry">Delete</button>' : ''}
          <button type="button" class="btn ghost subtle" data-act="edit-food">Edit food</button>
        </div>
      </form>`, body => {
      const f = $('#portion', body);
      if (hasServing && !entry) { f.unit.value = 'serving'; f.qty.value = 1; }
      else if (hasServing && entry && Math.abs(entry.grams / food.servingSize - Math.round(entry.grams / food.servingSize * 4) / 4) < 1e-6) {
        f.unit.value = 'serving'; f.qty.value = entry.grams / food.servingSize;
      } else { f.unit.value = 'g'; f.qty.value = r1(grams); }
      const calcGrams = () => (parseFloat(f.qty.value) || 0) * (f.unit.value === 'serving' ? food.servingSize : 1);
      const update = () => {
        grams = calcGrams();
        const n = C.nutrientsFor(food.per100, grams);
        $('#portion-nut', body).innerHTML = `<table class="nut"><thead><tr><th></th><th>This portion</th><th>Per 100 g</th></tr></thead><tbody>
          ${C.NUTRIENTS.map(k => `<tr class="${k === 'sugar' || k === 'satFat' ? 'sub' : ''}"><td>${NUT_LABEL[k]}</td><td>${k === 'kcal' ? r0(n[k]) : r1(n[k])} ${unitOf(k)}</td><td class="muted">${food.per100[k]} ${unitOf(k)}</td></tr>`).join('')}
          </tbody></table>`;
        const tr = I.detect(food, n, categories());
        $('#portion-trig', body).innerHTML = tr.length ? `<div class="trig-box"><h3>Possible IBS triggers</h3><ul class="trig-list">${tr.map(t => `<li>${chips([t])}<span class="small">${esc(t.matches.join(', '))}</span></li>`).join('')}</ul>
          <p class="muted small">FODMAP effects depend on portion size — a small amount may be fine.</p></div>` : '<p class="ok small">No common IBS triggers detected.</p>';
      };
      f.addEventListener('input', update);
      f.unit.addEventListener('change', () => {
        f.qty.value = f.unit.value === 'serving' ? r1(grams / food.servingSize) : r1(grams);
        update();
      });
      update();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const snapshot = {
          id: food.id, source: food.source, barcode: food.barcode || '', name: food.name, brand: food.brand || '',
          per100: food.per100, ingredients: food.ingredients || '', servingSize: food.servingSize || 100, servingLabel: food.servingLabel || '',
        };
        D().foods[food.id] = Object.assign({}, D().foods[food.id] || {}, snapshot);
        if (entry) Object.assign(entry, { grams: calcGrams(), meal: f.meal.value, time: f.time.value, food: snapshot });
        else D().log.push({ id: S.uid(), date, time: f.time.value, meal: f.meal.value, grams: calcGrams(), food: snapshot });
        S.save(); closeModal(); render();
      });
      body.addEventListener('click', e => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'del-entry') {
          D().log = D().log.filter(x => x !== entry); S.save(); closeModal(); render();
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
      openModal(`<h2>${esc(entry.food.name)}</h2>
        <p>${fmtInt(entry.quick.kcal)} kcal · P${r0(entry.quick.protein)} C${r0(entry.quick.carbs)} F${r0(entry.quick.fat)}</p>
        ${entry.food.ingredients ? `<p class="muted small">Contained: ${esc(entry.food.ingredients)}</p>` : ''}
        <div class="row-actions"><button class="btn danger ghost" id="del">Delete</button></div>`, b => {
        $('#del', b).addEventListener('click', () => { D().log = D().log.filter(x => x !== entry); S.save(); closeModal(); render(); });
      });
      return;
    }
    openPortion({ food: entry.food, meal: entry.meal, date: entry.date, entry });
  }

  // ---------- symptoms ----------
  function openSymptom(existing) {
    const s = existing || { date: state.date, time: state.date === today() ? nowTime() : '20:00', types: [], severity: 3, bristol: '', notes: '' };
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
        D().weights = D().weights.filter(x => x !== existing && x.date !== rec.date);
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
    const rate = C.recentRate(tr, 28);
    const adapt = C.adaptiveTdee(dailyKcal(), tr, 28);
    const first = tr[0], last = tr[tr.length - 1];

    const stat = (label, value, sub) => `<div class="stat"><div class="muted small">${label}</div><div class="stat-v">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    const signed = kg => (kg > 0 ? '+' : kg < 0 ? '−' : '±') + C.formatWeight(Math.abs(kg), unit());
    const rateStr = rate == null ? '—' : (rate > 0 ? '+' : rate < 0 ? '−' : '') + C.formatWeight(Math.abs(rate), unit()) + '/wk';

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

    root.innerHTML = `
      <section class="card">
        <div class="stats">
          ${stat('Trend weight', last ? fmtW(last.trend) : '—', last ? 'last weigh-in ' + fmtW(last.kg) : 'no weigh-ins yet')}
          ${stat('Total change', first && last ? signed(last.trend - first.kg) : '—', first ? 'since ' + C.parseDate(first.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')}
          ${stat('Last 4 weeks', rateStr, t ? 'planned ' + (t.direction === 'maintain' ? 'maintain' : (t.direction === 'lose' ? '−' : '+') + C.formatWeight(Math.abs(p.rateKgPerWeek), unit()) + '/wk') : '')}
          ${stat('Goal', goalStr, goalSub)}
        </div>
        <div class="row-actions"><button class="btn" data-act="add-weight">+ Log weight</button></div>
      </section>

      <div class="seg range">${[[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], [0, 'All']].map(([v, l]) => `<button data-range="${v}" class="${state.range === v ? 'on' : ''}">${l}</button>`).join('')}</div>

      <section class="card"><h2>Weight timeline</h2><p class="muted small">Dots are daily weigh-ins; the line is your smoothed trend (ignores water-weight noise).</p><div id="ch-weight"></div></section>
      ${D().weights.some(w => w.bodyFat) ? '<section class="card"><h2>Body composition</h2><p class="muted small">Estimated from body-fat % readings.</p><div id="ch-comp"></div></section>' : ''}
      ${D().weights.some(w => w.waistCm) ? '<section class="card"><h2>Waist</h2><div id="ch-waist"></div></section>' : ''}
      <section class="card"><h2>Calories per day</h2><div id="ch-kcal"></div></section>
      <section class="card"><h2>Protein per day</h2><div id="ch-protein"></div></section>
      ${adapt ? `<section class="card"><h2>Your real-world maintenance</h2>
        <p>Based on ${adapt.loggedDays} logged days averaging <b>${fmtInt(adapt.avgIntake)} kcal</b> while your trend moved <b>${(adapt.kgPerWeek > 0 ? '+' : adapt.kgPerWeek < 0 ? '−' : '') + C.formatWeight(Math.abs(adapt.kgPerWeek), unit())}/wk</b>,
        your maintenance is about <b>${fmtInt(adapt.tdee)} kcal/day</b>${t ? ` (formula estimate: ${fmtInt(t.formulaTdee)})` : ''}.</p>
        <p class="muted small">Only accurate if you log everything you eat. You can use this number in Goals → Advanced.</p></section>` : ''}
      <section class="card"><h2>Weigh-ins</h2>
        ${tr.length ? `<table class="list"><thead><tr><th>Date</th><th>Weight</th><th>Trend</th><th>Body fat</th><th></th></tr></thead><tbody>
          ${tr.slice().reverse().slice(0, 30).map(x => { const w = D().weights.find(y => y.date === x.date); return `<tr>
            <td>${C.parseDate(x.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</td><td>${fmtW(x.kg)}</td><td class="muted">${fmtW(x.trend)}</td>
            <td>${w.bodyFat ? r1(w.bodyFat) + '%' : ''}</td><td><button class="link" data-act="edit-weight" data-id="${w.id}">Edit</button></td></tr>`; }).join('')}
          </tbody></table>` : '<p class="muted">No weigh-ins yet.</p>'}
      </section>`;

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
      const comp = D().weights.filter(w => w.bodyFat && w.date >= start).sort((a, b) => a.date < b.date ? -1 : 1);
      Charts.time($('#ch-comp', root), {
        series: [
          { name: 'Lean mass', type: 'line', color: 'var(--series-3)', points: comp.map(w => ({ x: w.date, y: disp(w.kg * (1 - w.bodyFat / 100)) })), fmt: v => wFmt(v) + ' ' + wUnit },
          { name: 'Fat mass', type: 'line', color: 'var(--series-2)', points: comp.map(w => ({ x: w.date, y: disp(w.kg * w.bodyFat / 100) })), fmt: v => wFmt(v) + ' ' + wUnit },
        ], yFormat: wFmt, yMin: 0, label: 'Lean and fat mass',
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
    const barRange = { xMin: days.length ? (state.range && state.range <= 90 ? start : days[0]) : undefined, xMax: end };
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
    const enriched = D().log.map(e => ({ date: e.date, time: e.time, meal: e.meal, triggers: triggersFor(e), name: e.food ? e.food.name : '' }));
    const res = I.analyse(enriched, D().symptoms, Object.assign({ categories: cats }, opts));

    // food-level analysis — reuse the same engine with each food name as a "trigger"
    const counts = {};
    enriched.forEach(e => { if (e.name) counts[e.name] = (counts[e.name] || 0) + 1; });
    const foodCats = Object.keys(counts).filter(n => counts[n] >= 3).map(n => ({ id: 'food:' + n, name: n }));
    const foodRes = I.analyse(enriched.map(e => Object.assign({}, e, { triggers: e.name ? [{ id: 'food:' + e.name }] : [] })), D().symptoms,
      Object.assign({}, opts, { categories: foodCats })).results.filter(r => r.exposures >= 3 && r.relativeRisk >= 1.4 && r.exposedBad > 0).slice(0, 8);

    // exposure in last 30 days
    const since = C.addDays(today(), -30);
    const occ30 = I.occasions(enriched.filter(e => e.date >= since));
    const exposure = cats.map(c => ({ c, n: occ30.filter(o => o.triggers.has(c.id)).length })).filter(x => x.n).sort((a, b) => b.n - a.n);

    const pct = v => Math.round(v * 100) + '%';
    const badge = v => `<span class="badge b-${v.replace(/\s+/g, '-').toLowerCase()}">${v}</span>`;

    const symDays = {};
    D().symptoms.forEach(s => { if (s.date >= C.addDays(today(), -60)) symDays[s.date] = Math.max(symDays[s.date] || 0, s.severity); });

    root.innerHTML = `
      <section class="card">
        <h2>Trigger analysis</h2>
        <p class="muted small">For every meal, GutFuel checks the worst symptom you logged in the following ${opts.windowHours} h and compares meals that contained each trigger with meals that didn't.
        A “bad” meal is one followed by severity ≥ ${opts.threshold}. Based on ${res.occasions} meals and ${res.symptomCount} symptom logs.</p>
        ${res.symptomCount < 5 ? '<p class="hint">Log symptoms (including “felt fine”) for a couple of weeks to get meaningful results.</p>' : ''}
        ${res.results.length ? `<div class="table-wrap"><table class="list trig-table"><thead><tr><th>Trigger</th><th>Meals</th><th>Bad after</th><th>Bad otherwise</th><th>Verdict</th></tr></thead><tbody>
          ${res.results.map(r => `<tr><td>${chips([{ name: r.name, group: r.group, matches: [] }], true)}</td><td>${r.exposures}</td><td>${pct(r.rateExposed)}</td><td class="muted">${pct(r.rateUnexposed)}</td><td>${badge(r.verdict)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">No triggers found in your diary yet.</p>'}
        <details class="more"><summary>Analysis settings</summary>
          <form id="an-form" class="form grid2">
            <label>Symptom window after eating (hours)<input type="number" name="windowHours" min="2" max="72" value="${opts.windowHours}"></label>
            <label>Ignore the first (hours)<input type="number" name="minHours" min="0" max="12" value="${opts.minHours}"></label>
            <label>Count as “bad” at severity ≥<input type="number" name="threshold" min="1" max="10" value="${opts.threshold}"></label>
          </form>
        </details>
      </section>

      ${foodRes.length ? `<section class="card"><h2>Foods most often followed by symptoms</h2><ul class="trig-list">
        ${foodRes.map(r => `<li><b>${esc(r.name)}</b><span class="small">${r.exposedBad}/${r.exposures} times · vs ${pct(r.rateUnexposed)} otherwise ${badge(r.verdict)}</span></li>`).join('')}
        </ul></section>` : ''}

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
      yMin: 0, xMin: C.addDays(today(), -60), xMax: today(), yFormat: v => String(v), empty: 'No symptoms logged yet.', label: 'Symptom severity per day',
    });

    $('#an-form', root).addEventListener('change', e => {
      const f = e.currentTarget;
      D().triggers.analysis = { windowHours: +f.windowHours.value || 24, minHours: +f.minHours.value || 0, threshold: +f.threshold.value || 4 };
      S.save(); render();
    });
    $('#custom-trig', root).addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      D().triggers.custom.push({ id: S.uid(), name: f.name.value.trim(), keywords: f.keywords.value.split(',').map(s => s.trim()).filter(Boolean) });
      S.save(); render();
    });
    $$('[data-del-custom]', root).forEach(b => b.addEventListener('click', () => {
      D().triggers.custom = D().triggers.custom.filter(c => c.id !== b.dataset.delCustom); S.save(); render();
    }));
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
    const rates = [0.1, 0.25, 0.5, 0.75, 1];

    root.innerHTML = `
      <section class="card">
        <h2>About you</h2>
        <form id="goal-form" class="form">
          <div class="grid2">
            <label>Sex (for BMR formula)<select name="sex"><option value="male">Male</option><option value="female">Female</option></select></label>
            <label>Date of birth<input type="date" name="birthDate" value="${p.birthDate || ''}"></label>
            ${imperial ? `<label>Height<span class="inline"><input type="number" name="ft" min="3" max="8" value="${ft}"> ft <input type="number" name="in" min="0" max="11.9" step="0.1" value="${inch}"> in</span></label>`
              : `<label>Height (cm)<input type="number" name="heightCm" min="100" max="250" step="0.5" value="${p.heightCm || ''}"></label>`}
            <label>Current weight<span class="inline"><b>${w != null ? fmtW(w) : '—'}</b> <button type="button" class="link" data-act="add-weight">${w != null ? 'update' : 'log weigh-in'}</button></span></label>
          </div>
          <label>Activity level<select name="activity">${Object.entries(C.ACTIVITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
          <h2>Goal</h2>
          <div class="grid2">
            <label>Goal weight ${weightInput('goal', p.goalWeightKg)}</label>
            <label>Rate per week<select name="rate">${rates.map(r => `<option value="${r}">${C.formatWeight(r, u)}</option>`).join('')}</select></label>
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

    const showResults = () => {
      const box = $('#goal-results', root);
      const t = currentTargets();
      if (!t) {
        box.innerHTML = `<h2>Your daily targets</h2><p class="hint">${!profileComplete() ? 'Enter your date of birth and height.' : ''} ${w == null ? 'Log your current weight.' : ''}</p>`;
        return;
      }
      const pctOf = g => Math.round(g / t.calories * 100);
      const adapt = C.adaptiveTdee(dailyKcal(), trend(), 28);
      box.innerHTML = `
        <h2>Your daily targets</h2>
        <div class="target-big"><span class="big">${fmtInt(t.calories)}</span> kcal/day</div>
        <p class="muted">${t.direction === 'maintain' ? 'Maintenance' : (t.direction === 'lose' ? 'Deficit ' : 'Surplus ') + fmtInt(Math.abs(t.dailyDelta)) + ' kcal/day'}
          · BMR ${fmtInt(t.bmr)} · maintenance ${fmtInt(t.tdee)}${p.tdeeOverride ? ' (your override)' : ''}</p>
        <div class="macro-split">
          <div><span class="key-dot" style="background:var(--series-1)"></span><b>${t.protein} g</b> protein<br><span class="muted small">${pctOf(t.protein * 4)}% of calories</span></div>
          <div><span class="key-dot" style="background:var(--series-3)"></span><b>${t.carbs} g</b> carbs<br><span class="muted small">${pctOf(t.carbs * 4)}%</span></div>
          <div><span class="key-dot" style="background:var(--series-2)"></span><b>${t.fat} g</b> fat<br><span class="muted small">${pctOf(t.fat * 9)}%</span></div>
        </div>
        <div class="seg-bar" aria-hidden="true"><i style="flex:${t.protein * 4};background:var(--series-1)"></i><i style="flex:${Math.max(0, t.carbs * 4)};background:var(--series-3)"></i><i style="flex:${t.fat * 9};background:var(--series-2)"></i></div>
        <ul class="facts">
          <li>Fibre: aim for <b>${t.fiber} g</b>+ (increase gradually if you have IBS)</li>
          <li>Saturated fat: under <b>${t.satFatMax} g</b> · Salt: under <b>6 g</b> · Free sugars: under <b>${t.sugarMax} g</b></li>
          <li>BMI ${t.bmi}${t.goalDate ? ` · goal reached around <b>${C.parseDate(t.goalDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b> (${t.weeksToGoal} weeks)` : ''}</li>
        </ul>
        ${t.warnings.map(x => `<p class="warn-box">⚠️ ${esc(x)}</p>`).join('')}
        ${adapt && !p.tdeeOverride ? `<p class="hint">From your logs, your real maintenance looks like <b>${fmtInt(adapt.tdee)} kcal</b>. <button class="link" id="use-adapt">Use this</button></p>` : ''}
        <p class="muted small">Estimates use the Mifflin-St Jeor equation and ~7,700 kcal per kg of body weight. Revisit every few weeks as your weight changes — targets update automatically from your trend weight.</p>`;
      const ua = $('#use-adapt', box);
      if (ua) ua.addEventListener('click', () => { p.tdeeOverride = adapt.tdee; S.save(); render(); });
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
      <section class="card"><h2>Preferences</h2>
        <form id="prefs" class="form grid2">
          <label>Weight unit<select name="unit"><option value="kg">Kilograms</option><option value="st">Stone & pounds</option><option value="lb">Pounds</option></select></label>
          <label>Food database region<select name="country">${countries.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
        </form>
      </section>
      <section class="card"><h2>Your data</h2>
        <p>Everything is stored only in this browser on this device — no account, no server, no tracking. Food searches are sent to <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (just the search words).</p>
        <p class="muted small">${D().log.length} diary entries · ${D().weights.length} weigh-ins · ${D().symptoms.length} symptom logs · ${Object.keys(D().foods).length} saved foods</p>
        <p class="hint">Export a backup regularly — clearing browser data deletes everything. Import the file on another device to move your data.</p>
        <div class="row-actions">
          <button class="btn" id="export">Export backup</button>
          <label class="btn ghost">Import backup<input type="file" id="import" accept="application/json,.json" hidden></label>
          <button class="btn ghost" id="export-csv">Export diary CSV</button>
        </div>
      </section>
      <section class="card"><h2>Danger zone</h2><button class="btn danger" id="reset">Delete all data</button></section>
      <p class="muted small center">GutFuel — a private, personal tool. Not medical advice.</p>`;
    const f = $('#prefs', root);
    f.unit.value = p.unit; f.country.value = p.country;
    f.addEventListener('change', () => { p.unit = f.unit.value; p.country = f.country.value; S.save(); });

    const download = (name, text, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#export', root).addEventListener('click', () => download(`gutfuel-backup-${today()}.json`, S.exportJSON(), 'application/json'));
    $('#export-csv', root).addEventListener('click', () => {
      const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const rows = [['date', 'time', 'meal', 'food', 'brand', 'grams', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fibre', 'salt', 'triggers']];
      D().log.slice().sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1).forEach(e => {
        const n = C.entryNutrients(e);
        rows.push([e.date, e.time, e.meal, e.food ? e.food.name : '', e.food ? e.food.brand : '', r0(e.grams), r0(n.kcal), r1(n.protein), r1(n.carbs), r1(n.sugar), r1(n.fat), r1(n.satFat), r1(n.fiber), r1(n.salt),
          triggersFor(e).map(t => t.name).join('; ')]);
      });
      download(`gutfuel-diary-${today()}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
    });
    $('#import', root).addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Replace all current data with this backup?')) return;
      try { S.importJSON(await file.text()); alert('Backup restored.'); render(); }
      catch (err) { alert('Import failed: ' + err.message); }
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
    else if (act === 'no-symptoms') {
      D().symptoms.push({ id: S.uid(), date: state.date, time: '21:00', types: [], severity: 0, bristol: '', notes: '' });
      S.save(); render();
    }
    else if (act === 'edit-symptom') openSymptom(D().symptoms.find(s => s.id === a.dataset.id));
    else if (act === 'add-weight') openWeight();
    else if (act === 'edit-weight') openWeight(D().weights.find(w => w.id === a.dataset.id));
  });

  // first run → goals
  if (!location.hash && !profileComplete() && !D().log.length) location.hash = '#goals';
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
