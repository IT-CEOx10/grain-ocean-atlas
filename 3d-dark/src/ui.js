/* ===================================================================
   Отрисовка панелей: список стран, сводка за год, карточка страны,
   таймлайн и заглушка вместо видео.
   =================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  var handlers = {};
  var listState = { items: [], filter: '', expanded: null };

  function init(h) {
    handlers = h;
    els = {
      search: $('search'),
      list: $('country-list'),
      years: $('years'),
      summary: $('panel-summary'),
      summaryHead: $('summary-head'),
      summaryTitle: $('summary-title'),
      sumTotal: $('sum-total'),
      sumCountries: $('sum-countries'),
      sumGroups: $('sum-groups'),
      sumTop: $('sum-top'),
      countryPanel: $('panel-country'),
      countryName: $('country-name'),
      countryTotal: $('country-total'),
      countryYear: $('country-year'),
      countryRank: $('country-rank'),
      countryProducts: $('country-products'),
      countryMore: $('country-more'),
      video: $('panel-video'),
      videoEl: $('ship-video'),
      videoCanvas: $('video-canvas'),
      timeline: $('timeline'),
      bottomB: $('bottom-b'),
      loading: $('loading')
    };

    els.search.addEventListener('input', function () {
      listState.filter = els.search.value.trim().toLowerCase();
      listState.expanded = null;
      renderList();
    });

    els.summaryHead.addEventListener('click', function () {
      els.summary.classList.toggle('is-collapsed');
      handlers.onInteract();
    });

    $('reset-view').addEventListener('click', function () { handlers.onResetView(); });
    $('reset-view-b').addEventListener('click', function () { handlers.onResetView(); });
    $('back-map').addEventListener('click', function () { handlers.onBackToMap(); });
  }

  /* ------------------------------ таймлайн ------------------------------ */

  function renderYears(years, active) {
    els.years.innerHTML = '';
    years.forEach(function (y) {
      var b = U.el('button', 'year-pill' + (y === active ? ' is-active' : ''), String(y));
      b.type = 'button';
      b.addEventListener('click', function () { handlers.onYear(y); });
      els.years.appendChild(b);
    });
  }

  /* --------------------------- список стран --------------------------- */

  function setList(items) {
    listState.items = items;
    listState.expanded = null;
    renderList();
  }

  function clearSearch() {
    els.search.value = '';
    listState.filter = '';
    listState.expanded = null;
    renderList();
    els.list.scrollTop = 0;
  }

  function renderList() {
    var f = listState.filter;
    var items = f ? listState.items.filter(function (it) {
      return it.name.toLowerCase().indexOf(f) >= 0;
    }) : listState.items;

    els.list.innerHTML = '';
    if (!items.length) {
      var empty = U.el('div', 'list-hint', 'Ничего не найдено');
      els.list.appendChild(empty);
      return;
    }

    items.forEach(function (it) {
      if (listState.expanded === it.name) {
        els.list.appendChild(buildExpanded(it));
        return;
      }
      var row = U.el('div', 'country-row');
      row.appendChild(U.el('span', 'nm', it.name));
      row.appendChild(U.el('span', 'vl', U.fmtVolume(it.value) + ' тыс. т'));
      row.addEventListener('click', function () {
        listState.expanded = it.name;
        renderList();
        handlers.onListSelect(it.name);
      });
      els.list.appendChild(row);
    });
  }

  function buildExpanded(it) {
    var card = U.el('div', 'country-card');
    var head = U.el('div', 'cc-head');
    var left = U.el('div');
    left.appendChild(U.el('div', 'cc-name', it.name));
    left.appendChild(U.el('div', 'cc-value', U.fmtVolume(it.value) + ' тыс. т'));
    head.appendChild(left);

    var close = U.el('button', 'cc-close', '✕');
    close.type = 'button';
    close.addEventListener('click', function (e) {
      e.stopPropagation();
      listState.expanded = null;
      renderList();
      handlers.onListCancel();
    });
    head.appendChild(close);
    card.appendChild(head);

    var go = U.el('button', 'btn-primary', 'Начать путь');
    go.type = 'button';
    go.addEventListener('click', function (e) {
      e.stopPropagation();
      handlers.onStart(it.name);
    });
    card.appendChild(go);
    return card;
  }

  function expand(name) {
    listState.filter = '';
    els.search.value = '';
    listState.expanded = name;
    renderList();
    var idx = listState.items.findIndex(function (i) { return i.name === name; });
    if (idx >= 0) {
      var node = els.list.children[idx];
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
    }
  }

  function collapse() {
    listState.expanded = null;
    renderList();
  }

  /* ------------------------------ сводка ------------------------------ */

  function renderSummary(year, s) {
    els.summaryTitle.textContent = 'Экспорт зерна, ' + year;
    els.sumTotal.textContent = U.fmtVolume(s.total);
    els.sumCountries.textContent = U.fmtInt(s.countries);
    els.sumGroups.textContent = U.fmtInt(s.groups);

    els.sumTop.innerHTML = '';
    s.top.forEach(function (t) {
      var row = U.el('div', 'top-row');
      row.appendChild(U.el('span', 'nm', t.name));
      row.appendChild(U.el('span', 'vl', U.fmtVolume(t.value) + ' тыс. т'));
      row.addEventListener('click', function () { handlers.onStart(t.name); });
      els.sumTop.appendChild(row);
    });
  }

  /* -------------------------- карточка страны -------------------------- */

  var MAX_PRODUCTS = 14;

  function renderCountry(info) {
    els.countryName.textContent = info.name;
    els.countryTotal.textContent = U.fmtVolume(info.value);
    els.countryYear.textContent = info.year;
    els.countryRank.textContent = info.rank + ' место';

    els.countryProducts.innerHTML = '';
    var shown = info.products.slice(0, MAX_PRODUCTS);
    shown.forEach(function (p) {
      var item = U.el('div', 'product-item');
      item.appendChild(U.el('span', 'pn', U.capitalize(p.name)));
      item.appendChild(U.el('span', 'pv', U.fmtVolume(p.value) + ' тыс. т'));
      els.countryProducts.appendChild(item);
    });
    var rest = info.products.length - shown.length;
    els.countryMore.textContent = rest > 0 ? ('и ещё ' + rest + ' ' + plural(rest, 'позиция', 'позиции', 'позиций')) : '';
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  /* ------------------------------ видео ------------------------------ */

  var waveRAF = null;

  function setupVideo(src) {
    if (!src) return;                     // видео не задано — остаётся заглушка
    var v = els.videoEl;
    v.addEventListener('error', function () { els.video.classList.remove('has-video'); });
    v.addEventListener('canplay', function () { els.video.classList.add('has-video'); });
    v.src = src;
    v.load();
  }

  function playVideo(on) {
    var v = els.videoEl;
    if (on) {
      if (els.video.classList.contains('has-video')) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { els.video.classList.remove('has-video'); });
      }
      startWaves();
    } else {
      try { v.pause(); } catch (e) { /* видео может отсутствовать */ }
      stopWaves();
    }
  }

  /** Процедурная заглушка: море, волны и силуэт судна. */
  function startWaves() {
    var cv = els.videoCanvas;
    if (!cv) return;
    var w = cv.width = 616, h = cv.height = 1028;
    var ctx = cv.getContext('2d');
    var t0 = performance.now();

    var HORIZON = 0.60;

    function frame(now) {
      waveRAF = requestAnimationFrame(frame);
      var t = (now - t0) / 1000;

      // небо
      var sky = ctx.createLinearGradient(0, 0, 0, h * HORIZON);
      sky.addColorStop(0, '#cfe0f4');
      sky.addColorStop(0.75, '#e9f0f8');
      sky.addColorStop(1, '#f6f9fc');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h * HORIZON);

      // солнце
      var glow = ctx.createRadialGradient(w * 0.68, h * 0.30, 6, w * 0.68, h * 0.30, 190);
      glow.addColorStop(0, 'rgba(255,246,222,.95)');
      glow.addColorStop(1, 'rgba(255,246,222,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h * HORIZON);

      // море
      var sea = ctx.createLinearGradient(0, h * HORIZON, 0, h);
      sea.addColorStop(0, '#b7d0e9');
      sea.addColorStop(1, '#7ea3ca');
      ctx.fillStyle = sea;
      ctx.fillRect(0, h * HORIZON, w, h * (1 - HORIZON));

      // судно на линии горизонта
      var bob = Math.sin(t * 0.85) * 8;
      ctx.save();
      ctx.translate(w * 0.46, h * HORIZON + 46 + bob);
      ctx.rotate(Math.sin(t * 0.55) * 0.02);
      ctx.fillStyle = '#3c4a63';
      ctx.beginPath();
      ctx.moveTo(-172, -6); ctx.lineTo(178, -6); ctx.lineTo(142, 44); ctx.lineTo(-136, 44);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(52, -58, 68, 52);          // надстройка
      ctx.fillRect(80, -92, 14, 34);          // труба
      ctx.fillStyle = '#66789a';
      for (var b = 0; b < 7; b++) ctx.fillRect(-162 + b * 30, -40, 24, 34);
      ctx.fillStyle = '#93a5c1';
      for (var b2 = 0; b2 < 5; b2++) ctx.fillRect(-152 + b2 * 30, -66, 24, 26);
      ctx.restore();

      // волны поверх корпуса: каждая следующая темнее и ближе к зрителю
      var layers = [
        { a: 10, k: 0.013, s: 0.8, y: HORIZON + 0.06, c: 'rgba(255,255,255,.28)' },
        { a: 16, k: 0.009, s: -0.55, y: HORIZON + 0.16, c: 'rgba(124,163,203,.45)' },
        { a: 26, k: 0.006, s: 0.4, y: HORIZON + 0.29, c: 'rgba(88,127,172,.55)' }
      ];
      layers.forEach(function (L) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x <= w; x += 8) {
          var y = h * L.y + Math.sin(x * L.k + t * L.s * 2) * L.a;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = L.c;
        ctx.fill();
      });
    }
    stopWaves();
    waveRAF = requestAnimationFrame(frame);
  }

  function stopWaves() {
    if (waveRAF) cancelAnimationFrame(waveRAF);
    waveRAF = null;
  }

  /* ------------------------------ состояния ------------------------------ */

  function setState(state) {
    document.body.className = state === 'B' ? 'state-b' : '';
    els.countryPanel.classList.toggle('hidden', state !== 'B');
    els.video.classList.toggle('hidden', state !== 'B');
    els.bottomB.classList.toggle('hidden', state !== 'B');
    playVideo(state === 'B');
  }

  function hideLoading() {
    els.loading.classList.add('hidden');
  }

  global.UI = {
    init: init,
    renderYears: renderYears,
    setList: setList,
    clearSearch: clearSearch,
    expand: expand,
    collapse: collapse,
    renderSummary: renderSummary,
    renderCountry: renderCountry,
    setupVideo: setupVideo,
    setState: setState,
    hideLoading: hideLoading
  };
})(window);
