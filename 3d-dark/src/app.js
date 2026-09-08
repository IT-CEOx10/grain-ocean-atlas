/* ===================================================================
   Точка входа: загрузка данных, состояния экрана A/B,
   аттрактор-режим, масштабирование макета под окно.
   =================================================================== */
(function (global) {
  'use strict';

  var CFG = null;
  var THEME = 'navy';
  var DATA = null;
  var byName = {};
  var year = null;
  var yearIdx = 0;
  var state = 'A';
  var selected = null;
  var idleTimer = null;

  /* --------------------- масштабирование макета --------------------- */

  function fitStage() {
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    document.getElementById('stage').style.transform = 'scale(' + s + ')';
    if (global.Globe) Globe.resize();
  }

  /* ---------------------------- данные ---------------------------- */

  function countriesForYear(y) {
    var i = DATA.years.indexOf(y);
    var out = [];
    DATA.countries.forEach(function (c) {
      var v = c.totals[i];
      if (v > 0) {
        out.push({
          name: c.name, value: v, lat: c.lat, lon: c.lon,
          iso: c.iso, port: c.port || c.name
        });
      }
    });
    out.sort(function (a, b) { return b.value - a.value; });
    return out;
  }

  function productsFor(name, y) {
    var c = byName[name];
    var raw = (c && c.years[String(y)]) || [];
    return raw.map(function (p) {
      return { name: DATA.products[p[0]].n, value: p[1] };
    });
  }

  /* ---------------------------- состояния ---------------------------- */

  var listCache = [];

  function setYear(y, animate) {
    year = y;
    yearIdx = DATA.years.indexOf(y);
    listCache = countriesForYear(y);

    UI.renderYears(DATA.years, y, DATA.summary);
    UI.setList(listCache);
    UI.renderSummary(y, DATA.summary[String(y)]);
    Globe.setRoutes(listCache, animate !== false);
    Globe.setSelected(null);
    selected = null;
  }

  function goToCountry(name) {
    if (!byName[name]) return;
    var i = listCache.findIndex(function (it) { return it.name === name; });
    if (i < 0) return;               // в этом году поставок не было

    selected = name;
    state = 'B';
    UI.setState('B');
    var c = listCache[i];
    UI.renderCountry({
      name: name,
      value: c.value,
      year: year,
      rank: i + 1,
      products: productsFor(name, year),
      origin: CFG.origin.name,
      port: c.port,
      distanceKm: U.greatCircleKm(CFG.origin.lat, CFG.origin.lon, c.lat, c.lon)
    });
    Globe.setSelected(name);
    Globe.focus(name);
  }

  function backToMap() {
    state = 'A';
    selected = null;
    UI.setState('A');
    UI.collapse();
    Globe.setSelected(null);
    Globe.resetView();
  }

  /* --------------------------- аттрактор --------------------------- */

  var idleOff = false;                 // отключается параметром ?idle=0

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    var sec = (CFG.attractorTimeoutSec || 90) * 1000;
    idleTimer = setTimeout(toAttractor, sec);
  }

  function toAttractor() {
    var start = CFG.startYear || DATA.years[DATA.years.length - 1];
    state = 'A';
    selected = null;
    UI.setState('A');
    UI.clearSearch();
    document.getElementById('panel-summary').classList.remove('is-collapsed');
    setYear(start, true);
    Globe.resetView();
    resetIdle();
  }

  /* ------------------------------ старт ------------------------------ */

  function boot() {
    Promise.all([
      U.loadJSON('inline-config', 'config.json'),
      U.loadJSON('inline-export', 'data/export.json'),
      U.loadJSON('inline-topo', 'data/geo/countries-110m.json')
    ]).then(function (res) {
      CFG = res[0];
      DATA = res[1];
      var topo = res[2];

      DATA.countries.forEach(function (c) { byName[c.name] = c; });

      applyTheme();
      applyColors(CFG.colors);

      UI.init({
        colors: CFG.colors,
        onYear: function (y) { resetIdle(); if (y !== year) setYear(y, true); },
        onListSelect: function (name) { resetIdle(); Globe.setSelected(name); },
        onListCancel: function () { resetIdle(); Globe.setSelected(null); },
        onStart: function (name) { resetIdle(); goToCountry(name); },
        onBackToMap: function () { resetIdle(); backToMap(); },
        onResetView: function () { resetIdle(); Globe.resetView(); },
        onInteract: resetIdle
      });
      UI.setupVideo(CFG.shipVideo);

      Globe.init({
        canvas: document.getElementById('globe'),
        config: CFG,
        topo: topo,
        onInteract: resetIdle,
        // тап по дуге или по маркеру страны сразу открывает «Путь»
        onPick: function (name) {
          resetIdle();
          if (state === 'A') goToCountry(name);
        }
      });

      fitStage();
      var start = CFG.startYear || DATA.years[DATA.years.length - 1];
      setYear(start, true);
      UI.setState('A');
      UI.hideLoading();
      resetIdle();
      applyUrlParams();

      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });
      global.addEventListener('resize', fitStage);
    }).catch(function (err) {
      var box = document.getElementById('loading');
      box.textContent = 'Ошибка загрузки: ' + err.message;
      box.style.color = '#c0392b';
      global.console && console.error(err);
    });
  }

  /* ---------------- параметры адресной строки (отладка) ---------------- */

  /** Разбор ?a=1&b=2 в обычный объект. */
  function parseQuery() {
    var q = {};
    (global.location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      q[k] = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' '));
    });
    return q;
  }

  /**
   * Позволяет открыть приложение сразу в нужном состоянии — для снимков
   * экрана, показа заказчику и автотестов. Все параметры необязательные,
   * список — в README, раздел «Параметры адресной строки».
   */
  function applyUrlParams() {
    var q = parseQuery();
    if (!Object.keys(q).length) return;

    if (q.year && DATA.years.indexOf(+q.year) >= 0 && +q.year !== year) setYear(+q.year, false);
    if (q.country) goToCountry(q.country);
    if (q.select) Globe.setSelected(q.select);

    var v = {};
    if (q.lat && q.lon) { v.lat = +q.lat; v.lon = +q.lon; }
    if (q.zoom) v.zoom = +q.zoom;
    if (q.rotate === '0') v.rotate = false;
    if (Object.keys(v).length) Globe.setDebugView(v);

    if (q.idle === '0') { idleOff = true; resetIdle(); }
  }

  /**
   * Выбор темы: поле `theme` в config.json, поверх — параметр ?theme=green.
   * Тема добавляет классу <html> имя `theme-<ключ>` (по нему работает CSS)
   * и подменяет CFG.colors и часть CFG.globe, откуда их берёт globe.js.
   * Темы описаны в config.json в блоке `themes`, см. README, раздел «Темы».
   */
  function applyTheme() {
    var themes = CFG.themes || {};
    var want = parseQuery().theme || CFG.theme;
    var name = themes[want] ? want : (themes[CFG.theme] ? CFG.theme : Object.keys(themes)[0]);
    if (!name) return;                 // конфиг без тем — всё как в CSS по умолчанию

    THEME = name;
    CFG.theme = name;
    var th = themes[name];
    if (th.colors) CFG.colors = th.colors;
    if (th.globe) {
      Object.keys(th.globe).forEach(function (k) { CFG.globe[k] = th.globe[k]; });
    }
    document.documentElement.classList.add('theme-' + name);
  }

  function applyColors(c) {
    if (!c) return;
    var root = document.documentElement.style;
    if (c.pageBg) root.setProperty('--page-bg', c.pageBg);
    if (c.cardBg) root.setProperty('--card-bg', c.cardBg);
    if (c.panelBg) root.setProperty('--panel', c.panelBg);
    if (c.accent) root.setProperty('--accent', c.accent);
    if (c.text) root.setProperty('--text', c.text);
    if (c.textMuted) root.setProperty('--muted', c.textMuted);
    if (c.route) root.setProperty('--route', c.route);
    if (c.routeActive) root.setProperty('--gold2', c.routeActive);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
