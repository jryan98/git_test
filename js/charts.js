/*
 * charts.js — tiny dependency-free SVG time-series chart with a hover crosshair.
 * Charts.time(el, {
 *   series: [{ name, type: 'line'|'dots'|'bars', color, points: [{x:'YYYY-MM-DD', y}] , fmt? }],
 *   refs:   [{ y, label }],      // horizontal reference lines (e.g. goal)
 *   yFormat: v => string, height: 220, yMin?: number, xMin?/xMax?: 'YYYY-MM-DD'
 * })
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 86400000;

  function dayNum(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; }
  function fromDay(n) { return new Date(n * DAY); }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(n, withYear) {
    const d = fromDay(n);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + (withYear ? ' ' + String(d.getUTCFullYear()).slice(2) : '');
  }

  function time(container, opts) {
    const render = () => draw(container, opts);
    render();
    if (container._ro) container._ro.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      let w = container.clientWidth;
      container._ro = new ResizeObserver(() => {
        if (!container.isConnected) { container._ro.disconnect(); return; } // chart's page was replaced
        if (container.clientWidth !== w) { w = container.clientWidth; render(); }
      });
      container._ro.observe(container);
    }
  }

  function draw(container, opts) {
    container.innerHTML = '';
    container.classList.add('chart');
    const series = opts.series.filter(s => s.points && s.points.length);
    if (!series.length) {
      container.innerHTML = '<p class="chart-empty">' + (opts.empty || 'No data yet.') + '</p>';
      return;
    }
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 220;
    const m = { t: 12, r: 14, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const yFormat = opts.yFormat || (v => String(Math.round(v)));

    let xs = [], ys = [];
    series.forEach(s => s.points.forEach(p => { xs.push(dayNum(p.x)); ys.push(p.y); }));
    (opts.refs || []).forEach(r => ys.push(r.y));
    let x0 = opts.xMin ? dayNum(opts.xMin) : Math.min(...xs);
    let x1 = opts.xMax ? dayNum(opts.xMax) : Math.max(...xs);
    const hasBars = series.some(s => s.type === 'bars');
    if (hasBars) { x0 -= 0.5; x1 += 0.5; }
    if (x1 - x0 < 1) { x0 -= 3; x1 += 3; }
    let y0 = opts.yMin != null ? opts.yMin : Math.min(...ys);
    let y1 = opts.yMax != null ? Math.max(opts.yMax, ...ys) : Math.max(...ys);
    if (hasBars) y0 = Math.min(0, y0);
    const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.05 || 1;
    if (!hasBars && opts.yMin == null) y0 -= pad;
    y1 += pad;
    const step = niceStep(y1 - y0, 4);
    y0 = Math.floor(y0 / step) * step;
    y1 = Math.ceil(y1 / step) * step;

    const X = v => m.l + (v - x0) / (x1 - x0) * iw;
    const Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': opts.label || 'chart' }, container);

    // grid + y labels
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    for (let i = 0, v = y0; v <= y1 + step / 2; i++, v = +(y0 + i * step).toFixed(decimals)) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
      const t = el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg);
      t.textContent = yFormat(v);
    }
    // x labels
    const span = x1 - x0;
    const nTicks = Math.max(2, Math.min(6, Math.floor(iw / 80)));
    const withYear = span > 300;
    for (let i = 0; i <= nTicks; i++) {
      const v = Math.min(Math.floor(x1), Math.max(Math.ceil(x0), Math.round(x0 + span * i / nTicks)));
      const t = el('text', { x: X(v), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nTicks ? 'end' : 'middle', class: 'axis' }, svg);
      t.textContent = fmtDate(v, withYear);
    }

    // refs
    (opts.refs || []).forEach(r => {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(r.y), y2: Y(r.y), class: 'ref' }, svg);
      if (r.label) {
        const t = el('text', { x: W - m.r - 2, y: Y(r.y) - 4, 'text-anchor': 'end', class: 'ref-label' }, svg);
        t.textContent = r.label;
      }
    });

    // series
    const barSeries = series.filter(s => s.type === 'bars');
    const barSlot = iw / Math.max(1, span);
    const barW = Math.max(2, Math.min(24, barSlot - 2) / Math.max(1, barSeries.length));
    series.forEach(s => {
      const pts = s.points.slice().sort((a, b) => dayNum(a.x) - dayNum(b.x));
      if (s.type === 'line') {
        const d = pts.map((p, i) => (i ? 'L' : 'M') + X(dayNum(p.x)).toFixed(1) + ',' + Y(p.y).toFixed(1)).join('');
        el('path', { d, class: 'line', style: `stroke:${s.color}` + (s.dashed ? ';stroke-dasharray:5 4' : '') }, svg);
        if (s.endDot !== false && !s.dashed) {
          const last = pts[pts.length - 1];
          el('circle', { cx: X(dayNum(last.x)), cy: Y(last.y), r: 4, class: 'dot', style: `fill:${s.color}` }, svg);
        }
      } else if (s.type === 'dots') {
        pts.forEach(p => el('circle', { cx: X(dayNum(p.x)), cy: Y(p.y), r: s.r || 3, class: 'dot soft', style: `fill:${s.color}` }, svg));
      } else if (s.type === 'bars') {
        const bi = barSeries.indexOf(s);
        pts.forEach(p => {
          const cx = X(dayNum(p.x)) - (barW * barSeries.length) / 2 + bi * barW;
          const top = Y(Math.max(0, p.y)), base = Y(Math.max(0, y0));
          const h = Math.max(0, base - top);
          const r = Math.min(4, h, (barW - 1) / 2);
          const x = cx + 0.5, w = barW - 1;
          // rounded top, square base
          const d = `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
          el('path', { d, class: 'bar', style: `fill:${(s.colorFn && s.colorFn(p)) || s.color}` }, svg);
        });
      }
    });

    // legend for ≥2 named series
    const named = series.filter(s => s.name && !s.hideLegend);
    if (named.length >= 2) {
      const lg = document.createElement('div');
      lg.className = 'legend';
      named.forEach(s => {
        const i = document.createElement('span');
        i.innerHTML = `<i class="key ${s.type}" style="background:${s.color}"></i>${s.name}`;
        lg.appendChild(i);
      });
      container.insertBefore(lg, svg);
    }

    // hover crosshair + tooltip
    const byDay = new Map();
    series.forEach(s => s.points.forEach(p => {
      const k = dayNum(p.x);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push({ s, p });
    }));
    const days = Array.from(byDay.keys()).sort((a, b) => a - b);
    const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'cross', visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    container.appendChild(tip);
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);

    function move(clientX) {
      const rect = svg.getBoundingClientRect();
      const px = (clientX - rect.left) * (W / rect.width);
      const v = x0 + (px - m.l) / iw * (x1 - x0);
      let best = days[0];
      for (const d of days) if (Math.abs(d - v) < Math.abs(best - v)) best = d;
      const cx = X(best);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      const rows = byDay.get(best).filter(r => r.s.name);
      tip.innerHTML = `<b>${fmtDate(best, true)}</b>` + rows.map(r =>
        `<div><i class="key ${r.s.type}" style="background:${r.s.color}"></i>${r.s.name}: <b>${(r.s.fmt || yFormat)(r.p.y)}</b></div>`).join('');
      tip.hidden = false;
      const left = cx / W * rect.width;
      tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 10)) + 'px';
      if (left + 10 + tip.offsetWidth > rect.width) tip.style.left = Math.max(4, left - tip.offsetWidth - 10) + 'px';
    }
    hit.addEventListener('pointermove', e => move(e.clientX));
    hit.addEventListener('pointerdown', e => move(e.clientX));
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  root.Charts = { time };
})(typeof self !== 'undefined' ? self : this);
