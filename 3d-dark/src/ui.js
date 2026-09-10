/* ===================================================================
   Отрисовка панелей: список стран, сводка за год, карточка страны,
   таймлайн, три факта о пути и заглушка вместо видео.
   =================================================================== */
(function (global) {
  'use strict';

  // элементы ищем внутри обёртки раздела глобуса: в едином приложении
  // рядом лежат презентация и мониторинг, а часть идентификаторов совпадает
  var ROOT = U.scope('globe');
  var $ = U.byId('globe');
  var els = {};
  var handlers = {};
  var listState = { items: [], filter: '', expanded: null };

  // Зелёная тема иначе собирает экран «Карта»: карточка видео стоит
  // в правой колонке уже на карте, а не только на экране «Путь».
  // Класс на <html> вешает src/app.js (applyTheme) до вызова UI.init.
  var isGreen = false;

  function init(h) {
    handlers = h;
    isGreen = document.documentElement.classList.contains('theme-green');
    els = {
      search: $('search'),
      list: $('country-list'),
      years: $('years'),
      leftEyebrow: $('left-eyebrow'),
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
      facts: $('facts'),
      factDist: $('fact-dist'),
      factDays: $('fact-days'),
      factPort: $('fact-port'),
      video: $('panel-video'),
      videoEl: $('ship-video'),
      videoCanvas: $('video-canvas'),
      videoRoute: $('video-route'),
      videoTime: $('video-time'),
      timeline: $('timeline'),
      bottomB: $('bottom-b'),
      stars: $('stars'),
      loading: $('loading')
    };

    drawStars();

    els.search.addEventListener('input', function () {
      listState.filter = els.search.value.trim().toLowerCase();
      listState.expanded = null;
      renderList();
    });

    els.summaryHead.addEventListener('click', function () {
      els.summary.classList.toggle('is-collapsed');
      handlers.onInteract();
    });

    // На карте в зелёной теме карточка видео работает как кнопка:
    // открывает «Путь» в страну №1 за выбранный год.
    els.video.addEventListener('click', function () {
      if (ROOT.classList.contains('state-b')) return;
      var top = listState.items[0];
      if (top) handlers.onStart(top.name);
    });

    $('reset-view').addEventListener('click', function () { handlers.onResetView(); });
    $('reset-view-b').addEventListener('click', function () { handlers.onResetView(); });
    $('back-map').addEventListener('click', function () { handlers.onBackToMap(); });
  }

  /* --------------------------- звёздное зерно --------------------------- */

  /*
   * Мелкое зерно по фону и десяток мягких светлых пятен. Цвета берутся
   * из темы (colors.stars и colors.starGlow — тройки «r,g,b»), поэтому
   * в синей теме зерно холодное, в зелёной — бирюзовое.
   */
  function drawStars() {
    var c = els.stars;
    if (!c) return;
    var dot = (handlers.colors && handlers.colors.stars) || '190,208,240';
    var glow = (handlers.colors && handlers.colors.starGlow) || '180,205,255';
    c.width = 1920; c.height = 1080;
    var g = c.getContext('2d');
    for (var i = 0; i < 620; i++) {
      var x = Math.random() * 1920, y = Math.random() * 1080;
      var r = Math.random() * 1.1 + 0.2, a = Math.random() * 0.38 + 0.04;
      g.fillStyle = 'rgba(' + dot + ',' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    for (var j = 0; j < 22; j++) {
      var x2 = Math.random() * 1920, y2 = Math.random() * 1080;
      var gr = g.createRadialGradient(x2, y2, 0, x2, y2, 26);
      gr.addColorStop(0, 'rgba(' + glow + ',.16)');
      gr.addColorStop(1, 'rgba(' + glow + ',0)');
      g.fillStyle = gr;
      g.fillRect(x2 - 26, y2 - 26, 52, 52);
    }
  }

  /* ------------------------------ таймлайн ------------------------------ */

  /** summary: {год: {total}} — по нему рисуются мини-столбики объёма. */
  function renderYears(years, active, summary) {
    var max = 1;
    years.forEach(function (y) {
      var s = summary && summary[String(y)];
      if (s && s.total > max) max = s.total;
    });

    els.years.innerHTML = '';
    years.forEach(function (y) {
      var s = summary && summary[String(y)];
      var h = 8 + 34 * ((s ? s.total : 0) / max);
      var b = U.el('button', 'year-pill' + (y === active ? ' is-active' : ''));
      b.type = 'button';
      var bar = U.el('span', 'mb');
      bar.style.height = h.toFixed(1) + 'px';
      b.appendChild(bar);
      b.appendChild(U.el('span', 'dot'));
      b.appendChild(U.el('span', 'yr', String(y)));
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
      els.list.appendChild(U.el('div', 'list-hint', 'Ничего не найдено'));
      return;
    }

    items.forEach(function (it) {
      if (listState.expanded === it.name) {
        els.list.appendChild(buildExpanded(it));
        return;
      }
      var row = U.el('div', 'country-row');
      row.appendChild(U.el('span', 'nm', it.name));
      row.appendChild(U.el('span', 'vl', U.fmtVolume(it.value)));
      row.addEventListener('click', function () {
        listState.expanded = it.name;
        renderList();
        handlers.onListSelect(it.name);
      });
      els.list.appendChild(row);
    });
  }

  function buildExpanded(it) {
    var rank = listState.items.findIndex(function (i) { return i.name === it.name; }) + 1;
    var card = U.el('div', 'country-card');
    var head = U.el('div', 'cc-head');
    var left = U.el('div');
    left.appendChild(U.el('div', 'cc-name', it.name));
    left.appendChild(U.el('div', 'cc-value',
      U.fmtVolume(it.value) + ' тыс. т' + (rank ? ' · ' + rank + ' место' : '')));
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

    var go = U.el('button', 'btn-primary');
    go.type = 'button';
    go.appendChild(U.el('span', null, 'Начать путь'));
    go.insertAdjacentHTML('beforeend',
      '<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M1 6h13M9.5 1.5L14 6l-4.5 4.5"/></svg>');
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
    els.leftEyebrow.textContent = 'Российское зерно · ' + year;
    els.sumTotal.textContent = U.fmtVolume(s.total);
    els.sumCountries.textContent = U.fmtInt(s.countries);
    els.sumGroups.textContent = U.fmtInt(s.groups);

    var max = s.top.length ? s.top[0].value : 1;
    els.sumTop.innerHTML = '';
    s.top.forEach(function (t, i) {
      var row = U.el('div', 'top-row');
      // номер направления: виден только в зелёной теме (в синей скрыт стилями)
      row.appendChild(U.el('i', 'rk', String(i + 1)));
      var body = U.el('div', 'tr-body');
      var ln = U.el('div', 'ln');
      ln.appendChild(U.el('b', 'nm', t.name));
      ln.appendChild(U.el('span', 'vl', U.fmtVolume(t.value)));
      body.appendChild(ln);
      var bar = U.el('div', 'bar');
      var fill = U.el('i');
      fill.style.width = (100 * t.value / max).toFixed(1) + '%';
      bar.appendChild(fill);
      body.appendChild(bar);
      row.appendChild(body);
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
      item.appendChild(U.el('span', 'pv', U.fmtVolume(p.value)));
      els.countryProducts.appendChild(item);
    });
    var rest = info.products.length - shown.length;
    els.countryMore.textContent = rest > 0
      ? ('и ещё ' + rest + ' ' + U.plural(rest, 'позиция', 'позиции', 'позиций'))
      : '';

    // три факта о пути: расстояние по дуге, время в пути, порт назначения
    var km = Math.round(info.distanceKm / 50) * 50;
    var days = Math.max(1, Math.round(info.distanceKm / 1070));   // ~24 узла
    els.factDist.textContent = '~' + U.fmtInt(km) + ' км';
    els.factDays.textContent = '~' + days + ' ' + U.plural(days, 'день', 'дня', 'дней');
    els.factPort.textContent = info.port;
    els.videoRoute.textContent = info.origin + ' → ' + info.port;
  }

  /* ------------------------------ видео ------------------------------ */

  var waveRAF = null;

  function setupVideo(src) {
    if (!src) return;                     // видео не задано — остаётся заглушка
    var v = els.videoEl;
    v.addEventListener('error', function () { els.video.classList.remove('has-video'); });
    v.addEventListener('canplay', function () { els.video.classList.add('has-video'); });
    v.addEventListener('loadedmetadata', function () {
      if (!isFinite(v.duration)) return;
      var m = Math.floor(v.duration / 60), s = Math.round(v.duration % 60);
      els.videoTime.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    });
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

  /* Палитра заглушки. Синяя тема — ночное море под луной, зелёная — то же,
     но в цветах экрана: тёмно-бирюзовая вода и золотая лунная дорожка. */
  var SEA = {
    navy: {
      sky: ['#050912', '#0B1526', '#16233A'],
      moon: '255,236,200', disc: 'rgba(255,244,222,.95)',
      sea: ['#0B1526', '#03060C'],
      wave: '120,160,220', path: '255,228,180',
      hull: '#0A1019', hullLine: 'rgba(150,180,230,.14)', deck: '#1A2333'
    },
    green: {
      sky: ['#04100E', '#072019', '#0D3129'],
      moon: '255,226,166', disc: 'rgba(255,240,206,.95)',
      sea: ['#0B2A26', '#03100E'],
      wave: '110,205,182', path: '255,206,120',
      hull: '#05201C', hullLine: 'rgba(140,215,195,.16)', deck: '#123830'
    }
  };

  /** Один кадр процедурной заглушки: ночное море, лунная дорожка, судно. */
  function drawWave(t) {
    var cv = els.videoCanvas;
    if (!cv) return;
    var W = cv.width, H = cv.height;
    var ctx = cv.getContext('2d');
    var P = isGreen ? SEA.green : SEA.navy;

    var sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    sky.addColorStop(0, P.sky[0]);
    sky.addColorStop(0.65, P.sky[1]);
    sky.addColorStop(1, P.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.56);

    var moon = ctx.createRadialGradient(W * 0.72, H * 0.18, 0, W * 0.72, H * 0.18, 180);
    moon.addColorStop(0, 'rgba(' + P.moon + ',.55)');
    moon.addColorStop(1, 'rgba(' + P.moon + ',0)');
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, W, H * 0.56);
    ctx.fillStyle = P.disc;
    ctx.beginPath(); ctx.arc(W * 0.72, H * 0.18, 17, 0, 6.283); ctx.fill();

    var sea = ctx.createLinearGradient(0, H * 0.5, 0, H);
    sea.addColorStop(0, P.sea[0]);
    sea.addColorStop(1, P.sea[1]);
    ctx.fillStyle = sea;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);

    for (var i = 0; i < 38; i++) {
      var yy = H * 0.575 + i * 8.8;
      var amp = 1 + i * 0.7, sp = 0.5 + i * 0.05;
      ctx.strokeStyle = 'rgba(' + P.wave + ',' + (0.012 + i * 0.0021).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 8) {
        var yv = yy + Math.sin(x * 0.012 + t * sp + i) * amp;
        if (x === 0) ctx.moveTo(x, yv); else ctx.lineTo(x, yv);
      }
      ctx.stroke();
    }

    // лунная дорожка
    for (var j = 0; j < 84; j++) {
      var yy2 = H * 0.575 + j * 3.9;
      var w = (16 + j * 3.4) * (0.55 + 0.45 * Math.abs(Math.sin(t * 0.7 + j * 0.9)));
      var xx = W * 0.72 + Math.sin(t * 0.8 + j * 0.5) * (3 + j * 0.35);
      ctx.fillStyle = 'rgba(' + P.path + ',' + (0.10 * (1 - j / 84)).toFixed(3) + ')';
      ctx.fillRect(xx - w / 2, yy2, w, 1.8);
    }

    // судно
    ctx.save();
    ctx.translate(W * 0.42, H * 0.72 + Math.sin(t * 0.9) * 5);
    ctx.scale(1.9, 1.9);
    ctx.fillStyle = P.hull;
    ctx.strokeStyle = P.hullLine;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-150, 0); ctx.lineTo(150, 0); ctx.lineTo(126, 34); ctx.lineTo(-124, 34);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillRect(-150, -16, 210, 16); ctx.strokeRect(-150, -16, 210, 16);
    ctx.fillRect(56, -62, 62, 62); ctx.strokeRect(56, -62, 62, 62);
    ctx.fillStyle = P.deck;
    for (var k = 0; k < 6; k++) ctx.fillRect(-140 + k * 34, -13, 24, 10);
    ctx.fillStyle = 'rgba(255,206,140,.85)';
    ctx.fillRect(66, -52, 9, 7); ctx.fillRect(84, -52, 9, 7); ctx.fillRect(102, -52, 9, 7);
    ctx.fillRect(66, -36, 9, 7); ctx.fillRect(84, -36, 9, 7);
    ctx.fillStyle = 'rgba(255,220,170,.9)';
    ctx.fillRect(112, -74, 4, 14);
    ctx.restore();
  }

  function sizeCanvas() {
    var cv = els.videoCanvas;
    if (cv && cv.width !== 1200) { cv.width = 1200; cv.height = 784; }
  }

  /** Анимация заглушки — только на экране «Путь». */
  function startWaves() {
    if (!els.videoCanvas) return;
    sizeCanvas();
    stopWaves();
    waveRAF = requestAnimationFrame(function frame(now) {
      waveRAF = requestAnimationFrame(frame);
      drawWave(now / 1000);
    });
  }

  function stopWaves() {
    if (waveRAF) cancelAnimationFrame(waveRAF);
    waveRAF = null;
  }

  /** Неподвижное превью для карточки видео на «Карте» (зелёная тема). */
  function stillWave() {
    if (!els.videoCanvas) return;
    sizeCanvas();
    drawWave(0);
  }

  /* ------------------------------ состояния ------------------------------ */

  function setState(state) {
    var b = state === 'B';
    // класс состояния — на обёртке раздела, а не на body: в едином
    // приложении body общий на все три раздела
    ROOT.classList.toggle('state-b', b);
    els.countryPanel.classList.toggle('hidden', !b);
    // в зелёной теме карточка видео есть и на «Карте» — там она стоит
    // третьей в правой колонке и показывает неподвижное превью
    els.video.classList.toggle('hidden', !b && !isGreen);
    els.facts.classList.toggle('hidden', !b);
    els.bottomB.classList.toggle('hidden', !b);
    playVideo(b);
    if (!b && isGreen) stillWave();
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
