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

  function migrate(d) {
    const b = blank();
    const out = Object.assign(b, d);
    out.profile = Object.assign(blank().profile, d.profile || {});
    out.triggers = Object.assign(blank().triggers, d.triggers || {});
    out.triggers.analysis = Object.assign(blank().triggers.analysis, (d.triggers || {}).analysis || {});
    return out;
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
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.log)) throw new Error('Not a valid backup file');
      data = migrate(parsed);
      save();
    },
    reset() { data = blank(); save(); },
  };
})(typeof self !== 'undefined' ? self : this);
