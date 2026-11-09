/*
 * store.js — all data lives in this browser's localStorage. Nothing is sent
 * anywhere except food searches to Open Food Facts.
 */
(function (root) {
  'use strict';
  const KEY = 'gutfuel.v1';

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function blank() {
    return {
      version: 1,
      profile: {
        sex: 'male', birthDate: '', heightCm: 175, activity: 'light',
        goalWeightKg: null, rateKgPerWeek: 0.5,
        proteinPerKg: 0, fatPct: 0, calorieOverride: 0, tdeeOverride: 0,
        unit: 'kg', country: 'world',
      },
      foods: {},        // saved foods library: id → food
      log: [],          // diary entries
      weights: [],      // { id, date, kg, bodyFat?, waistCm?, note? }
      symptoms: [],     // { id, date, time, types[], severity, bristol?, notes? }
      triggers: { custom: [], analysis: { windowHours: 24, minHours: 0, threshold: 4 } },
    };
  }

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  /** Fill in anything missing and drop malformed records, so a damaged backup can't break the app. */
  function migrate(d) {
    if (!isObj(d)) d = {};
    const b = blank();
    const t = isObj(d.triggers) ? d.triggers : {};
    return {
      version: 1,
      profile: Object.assign(b.profile, isObj(d.profile) ? d.profile : {}),
      foods: isObj(d.foods) ? d.foods : {},
      log: (Array.isArray(d.log) ? d.log : []).filter(e => isObj(e) && isDate(e.date) && isObj(e.food) && (isObj(e.quick) || e.grams >= 0)),
      weights: (Array.isArray(d.weights) ? d.weights : []).filter(w => isObj(w) && isDate(w.date) && w.kg > 0),
      symptoms: (Array.isArray(d.symptoms) ? d.symptoms : []).filter(x => isObj(x) && isDate(x.date))
        .map(x => Object.assign({ time: '12:00', types: [], severity: 0 }, x, { types: Array.isArray(x.types) ? x.types : [] })),
      triggers: {
        custom: (Array.isArray(t.custom) ? t.custom : []).filter(c => isObj(c) && c.name && Array.isArray(c.keywords)),
        analysis: Object.assign(b.triggers.analysis, isObj(t.analysis) ? t.analysis : {}),
      },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : blank();
    } catch (e) {
      console.error('Could not load data', e);
      return blank();
    }
  }

  let data = load();
  const listeners = [];

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { alert('Could not save — storage may be full. Export a backup from Settings.'); }
    listeners.forEach(fn => fn(data));
  }

  root.Store = {
    uid,
    get data() { return data; },
    save,
    onChange(fn) { listeners.push(fn); },
    exportJSON() { return JSON.stringify(data, null, 2); },
    importJSON(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { throw new Error('That file isn\'t a GutFuel backup (not valid JSON).'); }
      if (!isObj(parsed) || !Array.isArray(parsed.log)) throw new Error('That file isn\'t a GutFuel backup.');
      data = migrate(parsed);
      save();
    },
    reset() { data = blank(); save(); },
  };
})(typeof self !== 'undefined' ? self : this);
