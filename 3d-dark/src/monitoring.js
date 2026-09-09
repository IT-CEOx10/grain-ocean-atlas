/* ===================================================================
   Раздел 09 — «Мониторинг зерна РФ», экраны 23 и 24.

   Отдельная страница monitoring.html. С глобусом и презентацией кода
   не делит: общие только util.js, переменные зелёной темы из
   styles/app.css и настройки из config.json.

   Что здесь:
     - плоская карта России: 85 субъектов на холсте, заливка по объёму
       обследования, касание открывает регион, зум кнопками, перетаскивание;
     - экран 23: селектор года, поиск по регионам, «Всего по России»,
       «Топ-10 регионов»;
     - экран 24: фильтр вида пшеницы, «Объемы обследования», образец
       зерна с точками показателей, «Классы зерна»;
     - аттрактор: возврат на карту по таймауту из config.json.

   Данные — два файла, кода они не касаются:
     assets/geo/russia-regions.json  контуры субъектов (tools/make_regions.py)
     data/monitoring.json            цифры мониторинга (tools/make_monitoring.py)

   ЦИФРЫ ДЕМОНСТРАЦИОННЫЕ. Об этом написано внизу обоих экранов, и это
   не должно потеряться при правках.
   =================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = function (t, c, x) { return U.el(t, c, x); };

  /* ------------------------------ настройки ------------------------------ */

  var CFG = { attractorTimeoutSec: 90 };

  var MAP_W = 1300, MAP_H = 706;       // размер холста карты в координатах 1920x1080
  var ZOOM_MIN = 1, ZOOM_MAX = 3.6, ZOOM_STEP = 1.45;
  var TAP_SLOP = 7;                    // сколько пикселей можно проехать, чтобы это был тап

  /* Тёплая шкала заливки: от приглушённого к золотому.
     Ключи — доля от максимума за год после сжатия (см. tone). */
  var SCALE = [
    [0.00, [34, 66, 59]],
    [0.28, [74, 92, 66]],
    [0.58, [143, 128, 70]],
    [0.82, [202, 165, 86]],
    [1.00, [246, 206, 120]]
  ];
  var NO_DATA = 'rgba(255,255,255,.045)';   // где пшеницу не возделывают
  var BORDER = 'rgba(217,179,106,.30)';
  var BORDER_HOT = '#F0D79B';

  /* Показатели на образце зерна. x, y — доли кадра 640x640;
     кадр квадратный и картинка тоже, так что доли совпадают с самой
     фотографией: точки стоят на зерне, а не на краю чашки. */
  var DOTS = [
    { key: 'moisture', x: 0.28, y: 0.47, dec: 1, name: 'Влажность', unit: '%',
      text: 'Сколько в зерне воды. Выше 14 % партию нужно сушить, иначе она согреется при хранении.' },
    { key: 'gluten', x: 0.44, y: 0.66, dec: 1, name: 'Клейковина', unit: '%',
      text: 'Белковый каркас теста. Чем её больше, тем выше класс зерна и лучше хлеб.' },
    { key: 'nature', x: 0.63, y: 0.45, dec: 0, name: 'Натура', unit: 'г/л',
      text: 'Масса зерна в мерном литре. Полновесное зерно тяжелее, и муки из него выходит больше.' },
    { key: 'vitreous', x: 0.68, y: 0.68, dec: 0, name: 'Стекловидность', unit: '%',
      text: 'Доля стекловидных зёрен на срезе. Такое зерно твёрже и даёт крупку при помоле.' }
  ];

  var KINDS = [
    { key: 'soft', label: 'Мягкая пшеница' },
    { key: 'durum', label: 'Твёрдая пшеница' }
  ];

  var SAMPLE_IMG = 'assets/photos/lab-sample.webp';
  var SAMPLE_BOX = 700;                // сторона кадра с образцом, px макета
  var POP_W = 246, POP_H = 150;        // карточка показателя

  /* ------------------------------ состояние ------------------------------ */

  var geo = null, mon = null;
  var byId = {};                       // код региона -> запись данных
  var shapes = [];                     // {id, name, path, bbox, c}
  var year = null;
  var kind = 'soft';
  var regionId = null;                 // открытый регион (экран 24)
  var query = '';
  var hits = null;                     // результат поиска: код региона -> true
  var hoverId = null;
  var screen = 'map';

  var view = { z: 1, cx: 0, cy: 0, k0: 1 };
  var anim = null;                     // плавный переход зума
  var need = false;                    // карту нужно перерисовать
  var ctx = null, dpr = 1, stageScale = 1;
  var openDot = null;
  var idleTimer = null, idleOff = false;
  var frames = 0, fps = 0, fpsT = 0;

  /* --------------------------- масштаб под окно --------------------------- */

  function fitStage() {
    stageScale = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + stageScale + ')';
    sizeCanvas();
  }

  /** Холст под настоящее число пикселей: сцена ужимается под окно,
      а на ретине к этому добавляется devicePixelRatio. */
  function sizeCanvas() {
    var c = $('map');
    if (!c) return;
    var r = Math.max(1, Math.min(3, (global.devicePixelRatio || 1) * stageScale));
    var w = Math.round(MAP_W * r), h = Math.round(MAP_H * r);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      dpr = r;
      need = true;
    }
  }

  /* ------------------------------ числа ------------------------------ */

  function fmt1(v) {
    if (v == null || isNaN(v)) return '—';
    return U.fmtVolume(v >= 100 ? v : Math.round(v * 10) / 10);
  }

  /** Запись региона за выбранный год и вид пшеницы. */
  function rec(id, k, y) {
    var r = byId[id];
    if (!r) return null;
    var ys = r.years[String(y == null ? year : y)];
    return ys ? (ys[k || kind] || null) : null;
  }

  function volume(id) {
    var b = rec(id, 'soft');
    return b ? b.surveyed : 0;
  }

  /* ------------------------------ шкала цвета ------------------------------ */

  var maxVol = 1;

  function tone(v) {
    // корень сжимает разрыв между Ростовской областью и остальными:
    // без него вся страна была бы одного тусклого тона
    return Math.pow(Math.min(1, v / maxVol), 0.38);
  }

  function scaleColor(t) {
    for (var i = 1; i < SCALE.length; i++) {
      if (t <= SCALE[i][0] || i === SCALE.length - 1) {
        var a = SCALE[i - 1], b = SCALE[i];
        var f = (t - a[0]) / (b[0] - a[0] || 1);
        f = f < 0 ? 0 : (f > 1 ? 1 : f);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * f)
        ];
      }
    }
    return SCALE[0][1];
  }

  function fillFor(id, hot) {
    var v = volume(id);
    if (v <= 0) return NO_DATA;
    var c = scaleColor(tone(v));
    if (hot) {                                     // под пальцем — светлее
      c = [c[0] + (255 - c[0]) * 0.30,
           c[1] + (255 - c[1]) * 0.28,
           c[2] + (255 - c[2]) * 0.22];
    }
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  /* ------------------------------ контуры ------------------------------ */

  /** Path2D по одному разу на регион: координаты мировые, на экран
      их переводит матрица холста — так и рисование, и попадание
      пальцем считает сам браузер. */
  function buildShapes() {
    shapes = [];
    geo.regions.forEach(function (r) {
      var p = new Path2D();
      r.polys.forEach(function (poly) {
        poly.forEach(function (ring) {
          var x = ring[0], y = ring[1];
          p.moveTo(x, y);
          for (var i = 2; i < ring.length; i += 2) {
            x += ring[i];
            y += ring[i + 1];
            p.lineTo(x, y);
          }
          p.closePath();
        });
      });
      shapes.push({ id: r.id, name: r.name, path: p, bbox: r.bbox, c: r.c });
    });
  }

  /* ------------------------------ вид карты ------------------------------ */

  function clampView() {
    var k = view.k0 * view.z;
    var halfW = MAP_W / 2 / k, halfH = MAP_H / 2 / k;
    var W = geo.box[0], H = geo.box[1];
    view.cx = W * k <= MAP_W ? W / 2 : U.clamp(view.cx, halfW, W - halfW);
    view.cy = H * k <= MAP_H ? H / 2 : U.clamp(view.cy, halfH, H - halfH);
  }

  function resetView() {
    view.k0 = Math.min(MAP_W / geo.box[0], MAP_H / geo.box[1]) * 0.98;
    view.z = 1;
    view.cx = geo.box[0] / 2;
    view.cy = geo.box[1] / 2;
    anim = null;
    need = true;
  }

  /** Матрица холста: мир -> пиксели картинки. */
  function applyTransform() {
    var k = view.k0 * view.z * dpr;
    ctx.setTransform(k, 0, 0, k,
      MAP_W * dpr / 2 - view.cx * k,
      MAP_H * dpr / 2 - view.cy * k);
  }

  function toCanvas(wx, wy) {
    var k = view.k0 * view.z;
    return [MAP_W / 2 + (wx - view.cx) * k, MAP_H / 2 + (wy - view.cy) * k];
  }

  function zoomTo(z, cx, cy) {
    var from = { z: view.z, cx: view.cx, cy: view.cy };
    var to = { z: U.clamp(z, ZOOM_MIN, ZOOM_MAX) };
    view.z = to.z;
    if (cx != null) { view.cx = cx; view.cy = cy; }
    clampView();
    to.cx = view.cx; to.cy = view.cy;
    view.z = from.z; view.cx = from.cx; view.cy = from.cy;
    anim = { from: from, to: to, t0: performance.now(), ms: 320 };
    need = true;
  }

  /* ------------------------------ отрисовка ------------------------------ */

  function draw() {
    if (!ctx || !geo) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, MAP_W * dpr, MAP_H * dpr);
    applyTransform();

    var k = view.k0 * view.z;
    ctx.lineJoin = 'round';

    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var dim = hits && !hits[s.id];
      var hot = s.id === hoverId || s.id === regionId;
      ctx.globalAlpha = dim ? 0.28 : 1;
      ctx.fillStyle = fillFor(s.id, hot);
      ctx.fill(s.path, 'evenodd');
      ctx.lineWidth = (hot ? 2.0 : 0.9) / k;
      ctx.strokeStyle = hot ? BORDER_HOT : BORDER;
      ctx.stroke(s.path);
    }

    // выбранный и найденные обводятся поверх всех, чтобы соседи их не перекрыли
    ctx.globalAlpha = 1;
    for (var j = 0; j < shapes.length; j++) {
      var t = shapes[j];
      if (t.id !== hoverId && t.id !== regionId && !(hits && hits[t.id])) continue;
      ctx.lineWidth = 2.0 / k;
      ctx.strokeStyle = BORDER_HOT;
      ctx.stroke(t.path);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function frame(now) {
    if (anim) {
      var t = U.clamp((now - anim.t0) / anim.ms, 0, 1);
      var e = U.easeInOutCubic(t);
      view.z = anim.from.z + (anim.to.z - anim.from.z) * e;
      view.cx = anim.from.cx + (anim.to.cx - anim.from.cx) * e;
      view.cy = anim.from.cy + (anim.to.cy - anim.from.cy) * e;
      need = true;
      if (t >= 1) anim = null;
    }
    if (need) { need = false; draw(); }
    frames++;
    if (now - fpsT > 1000) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
    requestAnimationFrame(frame);
  }

  /* ------------------------------ попадание ------------------------------ */

  /** Какой регион под точкой холста (координаты в пикселях макета).
      Сперва грубый отсев по рамке региона, потом точная проверка
      попадания в контур силами самого браузера. */
  function pick(px, py) {
    var k = view.k0 * view.z;
    var wx = view.cx + (px - MAP_W / 2) / k;
    var wy = view.cy + (py - MAP_H / 2) / k;
    var pad = 2 / k;
    applyTransform();
    var x = px * dpr, y = py * dpr;
    for (var i = shapes.length - 1; i >= 0; i--) {
      var b = shapes[i].bbox;
      if (wx < b[0] - pad || wx > b[2] + pad || wy < b[1] - pad || wy > b[3] + pad) continue;
      if (ctx.isPointInPath(shapes[i].path, x, y, 'evenodd')) return shapes[i].id;
    }
    return null;
  }

  /* ------------------------------ левая колонка ------------------------------ */

  function drawYears() {
    var box = $('years');
    box.textContent = '';
    mon.years.forEach(function (y) {
      var b = el('button', 'mon-year' + (y === year ? ' is-active' : ''), String(y));
      b.type = 'button';
      b.addEventListener('click', function () {
        resetIdle();
        if (y === year) return;
        year = y;
        recalcMax();
        drawYears();
        drawTotal();
        drawTop();
        if (regionId) drawRegion();
        need = true;
      });
      box.appendChild(b);
    });
  }

  function drawTotal() {
    var r = mon.russia[String(year)] || {};
    var box = $('total-body');
    box.textContent = '';
    [
      ['Обследовано зерна', fmt1(r.surveyed), 'тыс. т'],
      ['Соответствует требованиям', (r.compliance != null ? String(r.compliance).replace('.', ',') : '—'), '%'],
      ['Исследовано проб', fmt1(r.samples), 'тыс.']
    ].forEach(function (row) {
      var n = el('div', 'm-item');
      n.appendChild(el('div', 'cap', row[0]));
      var v = el('div', 'val', row[1]);
      v.appendChild(el('i', null, row[2]));
      n.appendChild(v);
      box.appendChild(n);
    });
  }

  function norm(s) {
    return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }

  /** Пересчёт совпадений поиска: делается один раз на ввод, не на кадр. */
  function setQuery(q) {
    query = q;
    var n = norm(query);
    if (!n) { hits = null; return; }
    hits = {};
    shapes.forEach(function (s) {
      if (norm(s.name).indexOf(n) >= 0) hits[s.id] = true;
    });
  }

  /** Список: без поиска — топ-10 за год, с поиском — все совпадения. */
  function listed() {
    var arr = shapes.filter(function (s) {
      return hits ? hits[s.id] : volume(s.id) > 0;
    });
    arr.sort(function (a, b) { return volume(b.id) - volume(a.id); });
    return hits ? arr : arr.slice(0, 10);
  }

  function drawTop() {
    var arr = listed();
    $('top-head').textContent = query
      ? 'Найдено регионов: ' + arr.length
      : 'Топ-10 регионов';
    var box = $('top-body');
    box.textContent = '';
    if (!arr.length) {
      box.appendChild(el('div', 't-empty', 'Ничего не нашлось. Проверьте название региона.'));
      return;
    }
    arr.forEach(function (s, i) {
      var row = el('div', 't-row' + (s.id === hoverId ? ' is-hot' : ''));
      row.appendChild(el('span', 'rk', String(i + 1)));
      row.appendChild(el('span', 'nm', s.name));
      row.appendChild(el('span', 'vl', fmt1(volume(s.id))));
      row.addEventListener('click', function () { resetIdle(); openRegion(s.id); });
      row.addEventListener('pointerenter', function () { setHover(s.id); });
      row.addEventListener('pointerleave', function () { setHover(null); });
      box.appendChild(row);
    });
    var top = mon.russia[String(year)];
    $('legend-hi').textContent = top && top.surveyed ? fmt1(maxVol) + ' тыс. т' : 'много';
  }

  function setHover(id) {
    if (hoverId === id) return;
    hoverId = id;
    need = true;
    var tip = $('map-tip');
    var s = id && shapes.filter(function (x) { return x.id === id; })[0];
    if (!s) { tip.classList.remove('is-on'); }
    else {
      var v = volume(id);
      tip.textContent = s.name;
      if (v > 0) {
        var b = el('b', null, fmt1(v) + ' тыс. т');
        tip.appendChild(b);
      } else {
        tip.appendChild(el('b', null, 'нет данных'));
      }
      var p = toCanvas(s.c[0], s.c[1]);
      tip.style.left = U.clamp(p[0], 90, MAP_W - 90) + 'px';
      tip.style.top = U.clamp(p[1], 44, MAP_H) + 'px';
      tip.classList.add('is-on');
    }
    // подсветить строку списка
    var rows = $('top-body').children;
    var arr = listed();
    for (var i = 0; i < rows.length && i < arr.length; i++) {
      rows[i].classList.toggle('is-hot', arr[i].id === id);
    }
  }

  /* ------------------------------ экран региона ------------------------------ */

  function kindsAvailable(id) {
    var out = {};
    KINDS.forEach(function (k) { out[k.key] = !!rec(id, k.key); });
    return out;
  }

  function drawKinds() {
    var have = kindsAvailable(regionId);
    var box = $('kinds');
    box.textContent = '';
    KINDS.forEach(function (k) {
      var cls = 'mon-kind' + (k.key === kind ? ' is-active' : '') + (have[k.key] ? '' : ' is-off');
      var b = el('button', cls, k.label);
      b.type = 'button';
      b.title = have[k.key] ? '' : 'В этом регионе не возделывается';
      b.addEventListener('click', function () {
        resetIdle();
        if (kind === k.key) return;
        kind = k.key;
        drawKinds();
        drawRegion();
      });
      box.appendChild(b);
    });
  }

  function drawRegion() {
    var s = shapes.filter(function (x) { return x.id === regionId; })[0];
    if (!s) return;
    $('reg-title').textContent = s.name;
    $('reg-eyebrow').textContent = 'Госмониторинг пшеницы РФ · ' + year;

    var b = rec(regionId, kind);
    var alt = b ? null : rec(regionId, 'soft');
    if (!b) b = alt;                       // выбранный вид не сеют — показываем мягкую
    if (!b) { drawEmptyRegion(s); return; }

    // объёмы
    var vol = $('vol-body');
    vol.textContent = '';
    [['Валовой сбор', fmt1(b.gross), 'тыс. т'],
     ['Обследовано', fmt1(b.surveyed), 'тыс. т']].forEach(function (row) {
      var n = el('div', 'm-item');
      n.appendChild(el('div', 'cap', row[0]));
      var v = el('div', 'val', row[1]);
      v.appendChild(el('i', null, row[2]));
      n.appendChild(v);
      vol.appendChild(n);
    });
    var share = b.gross > 0 ? Math.round(b.surveyed / b.gross * 100) : 0;
    var cap = el('div', 'm-item');
    cap.appendChild(el('div', 'cap', 'Охват обследованием — ' + share + ' % валового сбора'));
    var bar = el('div', 'v-bar');
    var fill = el('i');
    bar.appendChild(fill);
    cap.appendChild(bar);
    vol.appendChild(cap);
    setTimeout(function () { fill.style.width = share + '%'; }, 30);

    // классы
    var cls = $('cls-body');
    cls.textContent = '';
    var bars = [];
    b.classes.forEach(function (p, i) {
      var row = el('div', 'c-row');
      var top = el('div', 'c-top');
      top.appendChild(el('span', null, (i + 2) + ' класс'));
      top.appendChild(el('b', null, p.toFixed(1).replace('.', ',') + ' %'));
      row.appendChild(top);
      var cb = el('div', 'c-bar');
      var ci = el('i');
      cb.appendChild(ci);
      row.appendChild(cb);
      cls.appendChild(row);
      bars.push([ci, p]);
    });
    cls.appendChild(el('div', 'c-date', 'Актуально на ' + (b.updated || '—')));
    // полоска меряется от самого большого класса, а не от 100 %:
    // иначе при долях 2 / 36 / 51 / 10 три из четырёх строк —
    // еле заметные обрубки
    var top = Math.max.apply(null, b.classes) || 1;
    setTimeout(function () {
      bars.forEach(function (x) {
        x[0].style.width = Math.max(2, x[1] / top * 100) + '%';
      });
    }, 30);

    drawYearChart();
    drawQual(b);
    drawDots(b);
  }

  /** Столбики «обследовано по годам» — заодно второй способ сменить год. */
  function drawYearChart() {
    var box = $('hist-body');
    box.textContent = '';
    var vals = mon.years.map(function (y) {
      var b = rec(regionId, kind, y) || rec(regionId, 'soft', y);
      return b ? b.surveyed : 0;
    });
    var top = Math.max.apply(null, vals) || 1;
    var chart = el('div', 'y-chart');
    mon.years.forEach(function (y, i) {
      var col = el('div', 'y-col' + (y === year ? ' is-active' : ''));
      var bar = el('i', 'b');
      bar.style.height = Math.max(3, Math.round(vals[i] / top * 92)) + 'px';
      col.appendChild(bar);
      col.appendChild(el('span', 'l', String(y)));
      col.addEventListener('click', function () {
        resetIdle();
        if (y === year) return;
        year = y;
        recalcMax();
        drawYears();
        drawTotal();
        drawTop();
        drawRegion();
        setUrl();
        need = true;
      });
      chart.appendChild(col);
    });
    box.appendChild(chart);
  }

  function drawEmptyRegion(s) {
    $('vol-body').textContent = '';
    var n = el('div', 'm-item');
    n.appendChild(el('div', 'cap', 'В ' + year + ' году пшеница в этом регионе ' +
      'не возделывалась в объёмах, попадающих в госмониторинг.'));
    $('vol-body').appendChild(n);
    $('cls-body').textContent = '';
    $('cls-body').appendChild(el('div', 'c-date', 'Данных за ' + year + ' год нет'));
    $('qual-body').textContent = '';
    $('hist-body').textContent = '';
    $('dots').textContent = '';
    openDot = null;
  }

  function drawQual(b) {
    var q = $('qual-body');
    q.textContent = '';
    var n = el('div', 'm-item');
    n.appendChild(el('div', 'cap', 'Соответствует требованиям'));
    var v = el('div', 'val', b.compliance.toFixed(1).replace('.', ','));
    v.appendChild(el('i', null, '% обследованного зерна'));
    n.appendChild(v);
    q.appendChild(n);
    var s = el('div', 'c-date', 'Исследовано проб: ' + fmt1(b.samples) + ' тыс.');
    s.style.marginTop = '10px';
    q.appendChild(s);
  }

  function drawDots(b) {
    var box = $('dots');
    box.textContent = '';
    openDot = null;
    DOTS.forEach(function (d) {
      var n = el('button', 'm-dot');
      n.type = 'button';
      n.style.left = (d.x * 100) + '%';
      n.style.top = (d.y * 100) + '%';
      n.title = d.name;
      n.appendChild(el('i', 'lab', d.name));
      n.addEventListener('click', function (e) {
        e.stopPropagation();
        resetIdle();
        toggleDot(d, b, n);
      });
      box.appendChild(n);
    });
  }

  function toggleDot(d, b, node) {
    var old = $('dots').querySelector('.m-pop');
    if (old) old.remove();
    Array.prototype.forEach.call($('dots').children, function (n) {
      n.classList.remove('is-on');
      n.classList.remove('is-quiet');
    });
    if (openDot === d.key) { openDot = null; return; }
    openDot = d.key;
    node.classList.add('is-on');
    // остальные точки гасим: карточка показателя всё равно ложится поверх них
    Array.prototype.forEach.call($('dots').children, function (n) {
      if (n !== node) n.classList.add('is-quiet');
    });

    var pop = el('div', 'm-pop');
    pop.appendChild(el('div', 'pk', d.name));
    var v = el('div', 'pv', b[d.key].toFixed(d.dec).replace('.', ','));
    v.appendChild(el('i', null, d.unit));
    pop.appendChild(v);
    pop.appendChild(el('div', 'pt', d.text));
    // карточка встаёт со свободной стороны точки и не вылезает за кадр
    var right = d.x < 0.55;
    var cx = d.x * SAMPLE_BOX, cy = d.y * SAMPLE_BOX;
    pop.style.left = U.clamp(right ? cx + 64 : cx - 64 - POP_W, 0, SAMPLE_BOX - POP_W) + 'px';
    pop.style.top = U.clamp(cy - 56, 0, SAMPLE_BOX - POP_H) + 'px';
    $('dots').appendChild(pop);
  }

  /* ------------------------------ переходы ------------------------------ */

  function show(name) {
    screen = name;
    $('scr-map').classList.toggle('is-on', name === 'map');
    $('scr-region').classList.toggle('is-on', name === 'region');
    document.body.classList.toggle('on-region', name === 'region');
    $('back-map').style.display = name === 'region' ? '' : 'none';
    setUrl();
  }

  function openRegion(id) {
    if (!byId[id]) return;
    regionId = id;
    if (!rec(id, kind)) kind = 'soft';
    drawKinds();
    drawRegion();
    show('region');
    need = true;
  }

  function backToMap() {
    regionId = null;
    show('map');
    setHover(null);
    need = true;
  }

  function setUrl() {
    if (!global.history || !history.replaceState) return;
    var q = ['year=' + year];
    if (screen === 'region' && regionId) {
      q.push('region=' + encodeURIComponent(regionId));
      if (kind !== 'soft') q.push('kind=' + kind);
    }
    if (idleOff) q.push('idle=0');
    history.replaceState(null, '', '?' + q.join('&'));
  }

  /* ------------------------------ аттрактор ------------------------------ */

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    idleTimer = setTimeout(toAttractor, (CFG.attractorTimeoutSec || 90) * 1000);
  }

  function toAttractor() {
    $('search').value = '';
    setQuery('');
    kind = 'soft';
    year = mon.years[mon.years.length - 1];
    recalcMax();
    drawYears();
    drawTotal();
    drawTop();
    backToMap();
    resetView();
    resetIdle();
  }

  /* ------------------------------ жесты карты ------------------------------ */

  var drag = null;

  function bindMap() {
    var c = $('map');

    function local(e) {
      var r = c.getBoundingClientRect();
      return [(e.clientX - r.left) / (r.width / MAP_W),
              (e.clientY - r.top) / (r.height / MAP_H)];
    }

    c.addEventListener('pointerdown', function (e) {
      resetIdle();
      var p = local(e);
      drag = { x: p[0], y: p[1], cx: view.cx, cy: view.cy, moved: 0, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', function (e) {
      var p = local(e);
      if (drag && drag.id === e.pointerId) {
        var k = view.k0 * view.z;
        var dx = p[0] - drag.x, dy = p[1] - drag.y;
        drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
        if (drag.moved > TAP_SLOP) {
          anim = null;
          view.cx = drag.cx - dx / k;
          view.cy = drag.cy - dy / k;
          clampView();
          need = true;
          setHover(null);
        }
        return;
      }
      setHover(pick(p[0], p[1]));
    });

    c.addEventListener('pointerleave', function () { setHover(null); });

    c.addEventListener('pointerup', function (e) {
      var p = local(e);
      if (drag && drag.moved <= TAP_SLOP) {
        var id = pick(p[0], p[1]);
        if (id) openRegion(id);
      }
      drag = null;
    });

    c.addEventListener('pointercancel', function () { drag = null; });

    $('zoom-in').addEventListener('click', function () {
      resetIdle();
      zoomTo(view.z * ZOOM_STEP);
    });
    $('zoom-out').addEventListener('click', function () {
      resetIdle();
      zoomTo(view.z / ZOOM_STEP);
    });
  }

  /* ------------------------------ старт ------------------------------ */

  function recalcMax() {
    maxVol = 1;
    shapes.forEach(function (s) { maxVol = Math.max(maxVol, volume(s.id)); });
  }

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

  function applyColors(c) {
    if (!c) return;
    var root = document.documentElement.style;
    if (c.pageBg) root.setProperty('--page-bg', c.pageBg);
    if (c.cardBg) root.setProperty('--card-bg', c.cardBg);
    if (c.panelBg) root.setProperty('--panel', c.panelBg);
    if (c.accent) root.setProperty('--accent', c.accent);
    if (c.text) root.setProperty('--text', c.text);
    if (c.textMuted) root.setProperty('--muted', c.textMuted);
  }

  /* Зерно на фоне — тот же приём, что на остальных экранах стенда. */
  function drawStars(colors) {
    var c = $('stars');
    if (!c) return;
    var dot = (colors && colors.stars) || '150,205,190';
    var glow = (colors && colors.starGlow) || '130,215,195';
    c.width = 1920; c.height = 1080;
    var g = c.getContext('2d');
    for (var i = 0; i < 620; i++) {
      var x = Math.random() * 1920, y = Math.random() * 1080;
      var r = Math.random() * 1.1 + 0.2, a = Math.random() * 0.36 + 0.04;
      g.fillStyle = 'rgba(' + dot + ',' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    for (var j = 0; j < 20; j++) {
      var gx = Math.random() * 1920, gy = Math.random() * 1080;
      var gr = Math.random() * 190 + 90;
      var rad = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
      rad.addColorStop(0, 'rgba(' + glow + ',.05)');
      rad.addColorStop(1, 'rgba(' + glow + ',0)');
      g.fillStyle = rad;
      g.beginPath(); g.arc(gx, gy, gr, 0, 6.283); g.fill();
    }
  }

  function fail(msg) {
    $('loading').textContent = msg;
    $('loading').classList.remove('hidden');
    U.revealPage();
  }

  function boot() {
    ctx = $('map').getContext('2d');
    $('sample-img').src = U.asset(SAMPLE_IMG);

    U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      CFG = cfg || CFG;
      var green = (CFG.themes && CFG.themes.green) || {};
      applyColors(green.colors);
      drawStars(green.colors);
    }).catch(function () {
      drawStars(null);
    }).then(function () {
      return Promise.all([
        U.loadJSON('inline-regions', 'assets/geo/russia-regions.json'),
        U.loadJSON('inline-monitoring', 'data/monitoring.json')
      ]);
    }).then(function (res) {
      geo = res[0];
      mon = res[1];
      mon.regions.forEach(function (r) { byId[r.id] = r; });

      buildShapes();
      fitStage();
      resetView();

      var q = parseQuery();
      if (q.idle === '0') idleOff = true;
      year = mon.years.indexOf(parseInt(q.year, 10)) >= 0
        ? parseInt(q.year, 10)
        : mon.years[mon.years.length - 1];
      if (q.kind === 'durum') kind = 'durum';
      recalcMax();

      drawYears();
      drawTotal();
      if (q.q) { setQuery(q.q); $('search').value = q.q; }
      drawTop();
      bindMap();

      $('search').addEventListener('input', function () {
        resetIdle();
        setQuery(this.value.trim());
        drawTop();
        need = true;
      });
      $('search').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var arr = listed();
        if (arr.length) openRegion(arr[0].id);
      });
      $('back-map').addEventListener('click', function () { resetIdle(); backToMap(); });
      $('home-btn').addEventListener('click', function () {
        U.goSection('story', { screen: 'start' });
      });
      $('sample').addEventListener('click', function () {
        var open = $('dots').querySelector('.m-pop');
        if (open) {
          open.remove();
          openDot = null;
          Array.prototype.forEach.call($('dots').children, function (n) {
            n.classList.remove('is-on');
            n.classList.remove('is-quiet');
          });
        }
      });

      global.addEventListener('resize', fitStage);
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });

      if (q.region && byId[q.region]) openRegion(q.region);
      else show('map');
      if (q.zoom) zoomTo(parseFloat(q.zoom));

      resetIdle();
      $('loading').classList.add('hidden');
      fpsT = performance.now();
      requestAnimationFrame(frame);
      U.revealPage();
    }).catch(function (e) {
      fail('Не загрузить данные мониторинга: ' + (e && e.message ? e.message : e));
    });
  }

  /* Для показа и отладки: MonScreen.open('RU-ROS'), MonScreen.stats() */
  global.MonScreen = {
    open: openRegion,
    back: backToMap,
    /** Точка региона в координатах страницы — для скриптов и автотестов. */
    point: function (id) {
      var s = shapes.filter(function (x) { return x.id === id; })[0];
      if (!s) return null;
      var p = toCanvas(s.c[0], s.c[1]);
      var r = $('map').getBoundingClientRect();
      return [r.left + p[0] * (r.width / MAP_W), r.top + p[1] * (r.height / MAP_H)];
    },
    list: function () {
      return shapes.map(function (s) { return s.id + ' — ' + s.name; });
    },
    stats: function () {
      return { fps: Math.round(fps), dpr: dpr, regions: shapes.length,
               year: year, zoom: Math.round(view.z * 100) / 100,
               screen: screen, region: regionId };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
