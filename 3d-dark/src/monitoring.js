/* ===================================================================
   Раздел 09 — «Мониторинг зерна РФ».

   Раздел единого приложения app.html (обёртка #sec-monitoring); та же
   логика работает и отдельной страницей monitoring.html. С глобусом
   и презентацией кода не делит: общие только util.js, переменные темы
   и настройки из config.json.

   Три экрана на одной подложке:

     scr-map        карта госмониторинга (экран 23): год, поиск,
                    «Всего по России», «Топ-10 регионов», легенда;
     scr-region     карточка выбранного региона (экран 24): валовой
                    сбор, обследовано, классы зерна;
     scr-presence   «Регионы присутствия ЦОК АПК» — второй таб: та же
                    карта, подсвечены регионы с филиалами и точки
                    лабораторий, справа карточка филиала.

   Карта одна на два экрана: холст во весь кадр 1920x1080, панели лежат
   поверх и размывают её под собой. Страна вписывается не в весь холст,
   а в прямоугольник FIT — свой на каждом экране, чтобы её не закрывала
   колонка панелей.

   Данные — три файла, кода они не касаются:
     assets/geo/russia-regions.json  контуры субъектов (tools/make_regions.py)
     data/monitoring.json            цифры мониторинга (tools/make_monitoring.py)
     data/presence.json              филиалы и лаборатории ЦОК АПК

   ЦИФРЫ НАСТОЯЩИЕ: data/monitoring.json собирается из таблиц заказчика
   (tools/make_monitoring.py, исходники в data/monitoring-src). Где
   в таблице пусто — на экране пишется «нет данных», ничего не
   достраиваем.
   =================================================================== */
(function (global) {
  'use strict';

  // элементы ищем внутри обёртки раздела: в едином приложении рядом
  // лежат презентация и глобус, а часть идентификаторов совпадает
  var ROOT = U.scope('monitoring');
  var $ = U.byId('monitoring');
  var el = function (t, c, x) { return U.el(t, c, x); };

  /* ------------------------------ настройки ------------------------------ */

  var CFG = { attractorTimeoutSec: 90 };

  var MAP_W = 1888, MAP_H = 1048;      // холст во всю карточку кадра (1920x1080 минус 16 по краям)
  var ZOOM_MIN = 1, ZOOM_MAX = 3.6, ZOOM_STEP = 1.45;
  var TAP_SLOP = 7;                    // сколько пикселей можно проехать, чтобы это был тап

  /* Куда вписывается страна: [x0, y0, x1, y1] в координатах кадра.
     На карте госмониторинга слева колонка панелей, на регионах
     присутствия карта занимает почти весь кадр. Числа сняты с кадров
     docs/mockup/concept-18-09. */
  var FIT = {
    map: [530, 200, 1878, 864],
    presence: [44, 184, 1884, 996]
  };

  /* Заливка карты — ровно три цвета из легенды кадра: зелёный там, где
     есть данные по сбору, золотой у регионов с сильной пшеницей, серый
     там, где госмониторинг не проводится. Оттенков по объёму в макете
     нет: объёмы читаются в списке «Топ-10» и в подписи под пальцем. */
  var C_DATA = [36, 79, 40];           // #244f28
  var C_STRONG = [230, 180, 22];       // #e6b416
  var C_NONE = [42, 53, 51];           // #2a3533
  var FILL_ALPHA = 0.92;               // сквозь заливку чуть видно фактуру фона

  /* Новые регионы РФ: цифр по ним пока нет, но на карте они закрашены
     как остальные регионы с данными — зелёным. Вместо объёма везде
     пишется «данные уточняются». Цифры не выдумываем. */
  var PENDING = { 'UA-14': 1, 'UA-09': 1, 'UA-23': 1, 'UA-65': 1 };
  function noDataLabel(id) {
    return PENDING[id] ? 'данные уточняются'
      : (byId[id] ? 'нет данных' : 'нет госмониторинга');
  }

  /* «Сильная пшеница» — признак из таблицы заказчика «Регионы
     с сильной пшеницей» (белок выше 13,5 %, клейковина выше 28 %).
     Такие субъекты на карте золотые. */

  var BORDER = 'rgba(229,199,115,.55)';
  var BORDER_HOT = '#F6E8C8';

  /* Экран «Регионы присутствия»: подсвеченные регионы, остальные тише. */
  var PRES_ON = [31, 111, 82];
  var PRES_OFF = [19, 66, 51];
  var PRES_PICK = [230, 180, 47];
  var LAB_DOT = '#F6E3BB';

  /* Метки-цифры вокруг цилиндра на экране региона: кружок и подпись
     над ним, координаты из кадра 24-region. Первая переключает вид
     пшеницы, остальные подсвечивают панель, о которой говорят. */
  var MARKS = [
    { n: 1, label: 'Культура', x: 614, y: 302, lx: 642, ly: 266, lw: 136, act: 'kind' },
    { n: 2, label: 'Объём', x: 516, y: 572, lx: 544, ly: 534, lw: 136, act: 'vol' },
    { n: 3, label: 'Классы', x: 1180, y: 584, lx: 1208, ly: 548, lw: 100, act: 'cls' }
  ];

  var KINDS = [
    { key: 'soft', label: 'Мягкая пшеница' },
    { key: 'durum', label: 'Твёрдая пшеница' }
  ];

  var TABS = [
    { key: 'grain', label: 'Госмониторинг зерна' },
    { key: 'presence', label: 'Регионы присутствия' }
  ];

  var SCENE_IMG = 'assets/photos/concept/mon-region-scene.webp';

  /* Проекция контуров: Альберса, как в tools/make_regions.py. Точки
     лабораторий лежат в файле в градусах, здесь переводим их в те же
     единицы, в которых лежат контуры (0,4 км на единицу).
     ORIGIN — сдвиг рамки страны в ноль, сделанный при подготовке
     контуров; если контуры пересобрать с другими параметрами,
     эти два числа нужно пересчитать (см. README). */
  var ORIGIN = [-11367, -8675];

  /* ------------------------------ состояние ------------------------------ */

  var geo = null, mon = null, pres = null;
  var byId = {};                       // код региона -> запись данных
  var shapes = [];                     // {id, name, path, bbox, c}
  var year = null;
  var kind = 'soft';
  var regionId = null;                 // открытый регион (экран 24)
  var presId = null;                   // выбранный регион присутствия
  var presOf = {};                     // код субъекта -> код записи о присутствии
  var labs = [];                       // {id, name, x, y} — точки лабораторий
  var query = '';
  var hits = null;                     // результат поиска: код региона -> true
  var hoverId = null;
  var screen = 'map';                  // map | region | presence
  var tab = 'grain';                   // какой таб выбран

  var view = { z: 1, cx: 0, cy: 0, k0: 1, ox: 960, oy: 540 };
  var anim = null;                     // плавный переход зума
  var need = false;                    // карту нужно перерисовать
  var ctx = null, dpr = 1, stageScale = 1;
  var idleTimer = null, idleOff = false;
  var frames = 0, fps = 0, fpsT = 0;
  var live = true;                     // раздел на экране (в app.html — не всегда)
  var litTimer = null;

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

  function dec1(v) {
    return v == null || isNaN(v) ? '—' : v.toFixed(1).replace('.', ',');
  }

  /** Запись региона за выбранный год и вид пшеницы. */
  function rec(id, k, y) {
    var r = byId[id];
    if (!r) return null;
    var ys = r.years[String(y == null ? year : y)];
    return ys ? (ys[k || kind] || null) : null;
  }

  /** Обследовано по выбранному виду пшеницы: этим числом красится
      карта, считается «Топ-10» и полоски в нём. */
  function volume(id) {
    var b = rec(id, kind);
    return b && b.surveyed ? b.surveyed : 0;
  }

  /** Сильная пшеница — признак из таблицы заказчика. */
  function isStrong(id) {
    var b = rec(id, 'soft');
    return !!(b && b.strong);
  }

  /* ------------------------------ цвет региона ------------------------------ */

  var maxVol = 1;                      // нужен полоскам в списке «Топ-10»

  function rgb(c) {
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  function lighten(c, k) {
    return [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
  }

  function fillFor(id, hot) {
    var c;
    if (screen === 'presence' || tab === 'presence') {
      var here = presOf[id];
      c = here ? (here === presId ? PRES_PICK : PRES_ON) : PRES_OFF;
      return rgb(hot && here ? lighten(c, 0.22) : c);
    }
    if (volume(id) <= 0) c = PENDING[id] ? C_DATA : C_NONE;
    else c = isStrong(id) ? C_STRONG : C_DATA;
    return rgb(hot ? lighten(c, 0.26) : c);
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

  /* --------------------------- точки лабораторий ---------------------------
     Равновеликая коническая проекция Альберса — та же, что в
     tools/make_regions.py, параметры берутся из самого файла контуров. */

  function project(lon, lat) {
    var pr = (geo && geo.projection) || {};
    var lon0 = pr.lon0 == null ? 100 : pr.lon0;
    var lat0 = pr.lat0 == null ? 56 : pr.lat0;
    var lat1 = pr.lat1 == null ? 52 : pr.lat1;
    var lat2 = pr.lat2 == null ? 64 : pr.lat2;
    var unit = pr.unitKm || 0.4;
    var D = Math.PI / 180, R = 6371.0;
    var n = (Math.sin(lat1 * D) + Math.sin(lat2 * D)) / 2;
    var C = Math.cos(lat1 * D) * Math.cos(lat1 * D) + 2 * n * Math.sin(lat1 * D);
    var rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * D)) / n;
    var d = lon - lon0;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    var theta = n * d * D;
    var v = C - 2 * n * Math.sin(lat * D);
    var rho = Math.sqrt(v > 0 ? v : 0) / n;
    var x = rho * Math.sin(theta) * R;
    var y = -(rho0 - rho * Math.cos(theta)) * R;
    return [Math.round(x / unit) - ORIGIN[0], Math.round(y / unit) - ORIGIN[1]];
  }

  /** Точки лабораторий и таблица «субъект -> запись о присутствии».
      Поле also нужно городам федерального значения: Москва лежит внутри
      Московской области отдельным субъектом, а филиал у них один. */
  function buildLabs() {
    labs = [];
    presOf = {};
    if (!pres || !pres.regions) return;
    Object.keys(pres.regions).forEach(function (id) {
      var r = pres.regions[id];
      presOf[id] = id;
      (r.also || []).forEach(function (a) { presOf[a] = id; });
      (r.points || []).forEach(function (p) {
        var xy = project(p.lon, p.lat);
        labs.push({ id: id, name: p.name, x: xy[0], y: xy[1] });
      });
    });
  }

  /* ------------------------------ вид карты ------------------------------ */

  function fitRect() {
    return FIT[screen === 'presence' ? 'presence' : 'map'];
  }

  function clampView() {
    var k = view.k0 * view.z, r = fitRect();
    var halfW = (r[2] - r[0]) / 2 / k, halfH = (r[3] - r[1]) / 2 / k;
    var W = geo.box[0], H = geo.box[1];
    view.cx = W * k <= r[2] - r[0] ? W / 2 : U.clamp(view.cx, halfW, W - halfW);
    view.cy = H * k <= r[3] - r[1] ? H / 2 : U.clamp(view.cy, halfH, H - halfH);
  }

  function resetView() {
    var r = fitRect();
    view.k0 = Math.min((r[2] - r[0]) / geo.box[0], (r[3] - r[1]) / geo.box[1]) * 0.98;
    view.ox = (r[0] + r[2]) / 2;
    view.oy = (r[1] + r[3]) / 2;
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
      view.ox * dpr - view.cx * k,
      view.oy * dpr - view.cy * k);
  }

  function toCanvas(wx, wy) {
    var k = view.k0 * view.z;
    return [view.ox + (wx - view.cx) * k, view.oy + (wy - view.cy) * k];
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

  /** Приблизить карту к региону, не открывая карточку: нужно для показа
      и снимков экрана (параметр адреса ?at=UA-43&zoom=3). */
  function focusOn(id, z) {
    var s = shapes.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    zoomTo(z || 2.4, s.c[0], s.c[1]);
  }

  /* ------------------------------ отрисовка ------------------------------ */

  function draw() {
    if (!ctx || !geo) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, MAP_W * dpr, MAP_H * dpr);
    applyTransform();

    var k = view.k0 * view.z;
    var onPres = screen === 'presence';
    ctx.lineJoin = 'round';

    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var dim = !onPres && hits && !hits[s.id];
      var hot = s.id === hoverId || (!onPres && s.id === regionId) ||
        (onPres && presOf[s.id] === presId);
      // заливка чуть прозрачная: сквозь неё видна фактура фона, как в макете
      ctx.globalAlpha = dim ? 0.26 : FILL_ALPHA;
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
      var mark = t.id === hoverId ||
        (onPres ? presOf[t.id] === presId : (t.id === regionId || (hits && hits[t.id])));
      if (!mark) continue;
      ctx.lineWidth = 2.0 / k;
      ctx.strokeStyle = BORDER_HOT;
      ctx.stroke(t.path);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (onPres) drawLabs();
  }

  /** Светящиеся точки лабораторий поверх карты. */
  function drawLabs() {
    for (var i = 0; i < labs.length; i++) {
      var p = toCanvas(labs[i].x, labs[i].y);
      var x = p[0] * dpr, y = p[1] * dpr;
      if (x < -40 || y < -40 || x > MAP_W * dpr + 40 || y > MAP_H * dpr + 40) continue;
      var r = 22 * dpr;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(246,227,187,.55)');
      g.addColorStop(1, 'rgba(246,227,187,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = LAB_DOT;
      ctx.beginPath(); ctx.arc(x, y, 4.2 * dpr, 0, 6.283); ctx.fill();
    }
  }

  var rafId = 0;                       // 0 — цикл не крутится

  /** Запустить цикл отрисовки карты (idempotent). */
  function startLoop() {
    if (rafId) return;
    fpsT = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  /** Остановить цикл: раздел ушёл с экрана, данные и контуры остаются. */
  function stopLoop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (anim) {
      var t = U.clamp((now - anim.t0) / anim.ms, 0, 1);
      var e = U.easeInOutCubic(t);
      view.z = anim.from.z + (anim.to.z - anim.from.z) * e;
      view.cx = anim.from.cx + (anim.to.cx - anim.from.cx) * e;
      view.cy = anim.from.cy + (anim.to.cy - anim.from.cy) * e;
      need = true;
      if (t >= 1) anim = null;
    }
    if (need) { need = false; draw(); placeCall(); }
    frames++;
    if (now - fpsT > 1000) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
  }

  /* ------------------------------ попадание ------------------------------ */

  /** Какой регион под точкой холста (координаты в пикселях макета).
      Сперва грубый отсев по рамке региона, потом точная проверка
      попадания в контур силами самого браузера. */
  function pick(px, py) {
    var k = view.k0 * view.z;
    var wx = view.cx + (px - view.ox) / k;
    var wy = view.cy + (py - view.oy) / k;
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

  /* ------------------------------ табы ------------------------------ */

  function drawTabs() {
    ['tabs-map', 'tabs-presence'].forEach(function (boxId) {
      var box = $(boxId);
      if (!box) return;
      box.textContent = '';
      TABS.forEach(function (t) {
        var b = el('button', 'mn-tab' + (t.key === tab ? ' is-on' : ''), t.label);
        b.type = 'button';
        b.addEventListener('click', function () {
          resetIdle();
          setTab(t.key);
        });
        box.appendChild(b);
      });
    });
  }

  function setTab(key) {
    if (tab === key) {
      // из карточки региона таб «Госмониторинг зерна» возвращает на карту
      if (key === 'grain' && screen !== 'map') backToMap();
      return;
    }
    tab = key;
    drawTabs();
    if (key === 'presence') {
      setHover(null);
      show('presence');
      resetView();
      if (!presId) selectPresence(pres && pres.start);
      drawPresence();
    } else {
      show('map');
      resetView();
    }
    need = true;
  }

  /* ------------------------------ левая колонка ------------------------------ */

  /** Лента годов под картой. Рисуем всю ленту из поля ribbon, но
      нажимаются только годы, по которым есть данные (поле years). */
  function drawYears() {
    var box = $('years');
    box.textContent = '';
    var ribbon = mon.ribbon && mon.ribbon.length ? mon.ribbon : mon.years;
    ribbon.forEach(function (y) {
      var has = mon.years.indexOf(y) >= 0;
      var b = el('button', 'mn-year' + (y === year ? ' is-on' : '') +
        (has ? '' : ' is-off'));
      b.type = 'button';
      b.disabled = !has;
      b.appendChild(el('span', 'yr', String(y)));
      b.appendChild(el('i', 'dot'));
      b.title = has ? String(y) : y + ': данных пока нет';
      b.addEventListener('click', function () {
        resetIdle();
        if (!has || y === year) return;
        year = y;
        recalcMax();
        drawYears();
        drawTotal();
        drawTop();
        drawHead();
        if (regionId) drawRegion();
        setUrl();
        need = true;
      });
      box.appendChild(b);
    });
  }

  function drawHead() {
    // заголовок в две строки, как в кадре: «ГОСМОНИТОРИНГ ЗЕРНА / ПШЕНИЦЫ 2026»
    $('map-title').textContent = 'Госмониторинг зерна\nпшеницы ' + year;
    $('reg-eyebrow').textContent = 'Госмониторинг пшеницы · ' + year;
  }

  /** Крупное число с единицей и подписью под ним. */
  function bigNum(box, value, unit, note) {
    box.textContent = '';
    var n = el('div', 'mn-num', value);
    if (unit) n.appendChild(el('i', null, unit));
    box.appendChild(n);
    if (note) box.appendChild(el('div', 'mn-note', note));
  }

  /** Итог по стране за год и выбранный вид пшеницы. */
  function totalRec() {
    var r = mon.russia[String(year)];
    return (r && (r[kind] || r.soft)) || null;
  }

  function drawTotal() {
    var r = totalRec() || {};
    var what = kind === 'durum' ? 'твёрдой пшеницы' : 'мягкой пшеницы';
    bigNum($('total-body'), fmt1(r.surveyed), 'тыс. т',
      'обследовано ' + what + ' урожая ' + year);
    bigNum($('gost-body'), dec1(r.compliance), '%',
      'соответствует требованиям ГОСТ');
    drawDots();
  }

  /** Две точки справа сверху: слайд «Мягкая» и слайд «Твёрдая». */
  function drawDots() {
    var box = $('total-dots');
    box.textContent = '';
    KINDS.forEach(function (k) {
      var b = el('button', k.key === kind ? 'is-on' : '');
      b.type = 'button';
      b.title = k.label;
      b.setAttribute('aria-label', k.label);
      b.addEventListener('click', function () { resetIdle(); setKind(k.key); });
      box.appendChild(b);
    });
  }

  /** Вид пшеницы общий на весь раздел: карта, список, карточка региона. */
  function setKind(k) {
    if (k !== 'soft' && k !== 'durum') return;
    if (kind === k) return;
    kind = k;
    recalcMax();
    drawTotal();
    drawTop();
    if (regionId) drawRegion();
    setUrl();
    need = true;
  }

  /** Свайп по плашке «Всего по России» листает виды пшеницы. */
  function bindKindSwipe() {
    var box = document.querySelector('#sec-monitoring .mn-total') ||
      document.querySelector('.mn-total');
    if (!box) return;
    var x0 = null;
    box.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    box.addEventListener('pointerup', function (e) {
      if (x0 == null) return;
      var dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 40) return;
      resetIdle();
      setKind(dx < 0 ? 'durum' : 'soft');
    });
    box.addEventListener('pointercancel', function () { x0 = null; });
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
      : 'Топ-10 регионов · ' + kindLabel().toLowerCase();
    var box = $('top-body');
    box.textContent = '';
    if (!arr.length) {
      box.appendChild(el('div', 't-empty', 'Ничего не нашлось. Проверьте название региона.'));
      return;
    }
    var top = volume(arr[0].id) || 1;
    var bars = [];
    arr.forEach(function (s, i) {
      // строка кадра: слева плашка с номером, справа название, объём и полоска
      var row = el('button', 't-row' + (s.id === hoverId ? ' is-hot' : ''));
      row.type = 'button';
      row.appendChild(el('span', 't-rk', String(i + 1)));
      var main = el('div', 't-main');
      var line = el('div', 't-line');
      line.appendChild(el('span', 'nm', s.name));
      var v = volume(s.id);
      line.appendChild(el('span', 'vl', v > 0 ? fmt1(v) + ' тыс. т'
        : noDataLabel(s.id)));
      main.appendChild(line);
      var bar = el('div', 't-bar');
      var fill = el('i');
      bar.appendChild(fill);
      main.appendChild(bar);
      row.appendChild(main);
      bars.push([fill, v / top]);
      row.addEventListener('click', function () { resetIdle(); openRegion(s.id); });
      row.addEventListener('pointerenter', function () { setHover(s.id); });
      row.addEventListener('pointerleave', function () { setHover(null); });
      box.appendChild(row);
    });
    setTimeout(function () {
      bars.forEach(function (b) { b[0].style.width = (b[1] > 0 ? Math.max(3, b[1] * 100) : 0) + '%'; });
    }, 30);
  }

  function setHover(id) {
    if (hoverId === id) return;
    hoverId = id;
    need = true;
    var tip = $('map-tip');
    var s = id && shapes.filter(function (x) { return x.id === id; })[0];
    if (!s) { tip.classList.remove('is-on'); }
    else {
      tip.textContent = s.name;
      if (screen === 'presence') {
        tip.appendChild(el('b', null, presOf[id] ? 'есть филиал' : 'нет данных'));
      } else {
        var v = volume(id);
        tip.appendChild(el('b', null, v > 0 ? fmt1(v) + ' тыс. т'
          : noDataLabel(id)));
      }
      var p2 = toCanvas(s.c[0], s.c[1]);
      // Подсказка лежит под панелями, поэтому целиком держим её в свободном
      // поле карты: правее левой колонки (на присутствии — левее карточки
      // региона) и ниже шапки. Ширину меряем после подстановки текста.
      var half = tip.offsetWidth / 2, th = tip.offsetHeight;
      var box = screen === 'presence'
        ? { l: 24, r: 1346, t: 190 }
        : { l: 602, r: MAP_W - 24, t: 300 };
      tip.style.left = U.clamp(p2[0], box.l + half, Math.max(box.l + half, box.r - half)) + 'px';
      tip.style.top = U.clamp(p2[1], box.t + th * 1.4, MAP_H - 40) + 'px';
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

  function kindLabel() {
    return kind === 'durum' ? 'Твёрдая пшеница' : 'Мягкая пшеница';
  }

  /** Метки-цифры вокруг цилиндра: кружок и подпись над ним. */
  function drawMarks() {
    var box = $('marks');
    box.textContent = '';
    var have = kindsAvailable(regionId);
    MARKS.forEach(function (m) {
      var off = m.act === 'kind' && !(have.soft && have.durum);
      var lab = el('div', 'mn-mark-lab', m.label);
      lab.style.left = m.lx + 'px';
      lab.style.top = m.ly + 'px';
      lab.style.width = m.lw + 'px';
      if (off) lab.style.opacity = '.45';
      box.appendChild(lab);

      var b = el('button', 'mn-mark' + (off ? ' is-off' : ''), String(m.n));
      b.type = 'button';
      b.style.left = m.x + 'px';
      b.style.top = m.y + 'px';
      b.title = m.act === 'kind'
        ? (off ? 'В этом регионе возделывают только мягкую пшеницу' : 'Сменить вид пшеницы')
        : m.label;
      b.addEventListener('click', function () {
        resetIdle();
        if (m.act === 'kind') {
          kind = kind === 'soft' ? 'durum' : 'soft';
          drawRegion();
          setUrl();
          return;
        }
        lit(m.act === 'vol' ? ['card-gross', 'card-surv'] : ['card-cls']);
        Array.prototype.forEach.call(box.children, function (n) { n.classList.remove('is-on'); });
        b.classList.add('is-on');
      });
      box.appendChild(b);
    });
  }

  /** Подсветить панель, о которой говорит метка. */
  function lit(ids) {
    if (litTimer) clearTimeout(litTimer);
    ['card-gross', 'card-surv', 'card-cls'].forEach(function (id) {
      $(id).classList.toggle('is-lit', ids.indexOf(id) >= 0);
    });
    litTimer = setTimeout(function () {
      ['card-gross', 'card-surv', 'card-cls'].forEach(function (id) {
        $(id).classList.remove('is-lit');
      });
    }, 2600);
  }

  function drawRegion() {
    var s = shapes.filter(function (x) { return x.id === regionId; })[0];
    if (!s) return;
    $('reg-title').textContent = s.name;
    drawHead();
    drawMarks();

    var b = rec(regionId, kind);
    if (!b) { kind = 'soft'; b = rec(regionId, 'soft'); }
    if (!b) { drawEmptyRegion(); return; }

    $('reg-sub').textContent = kindLabel() + '  ·  урожай ' + year +
      (b.strong ? '  ·  регион с сильной пшеницей' : '');

    bigNum($('gross-body'), fmt1(b.gross), 'тыс. т', 'Урожай ' + year);
    bigNum($('surv-body'), fmt1(b.surveyed), 'тыс. т',
      b.cover != null ? dec1(b.cover) + ' % валового сбора' : 'нет данных');

    // классы: название, объём в тоннах от обследованного и доля.
    // Полосок в кадре нет — только числа. Классы, которых в регионе
    // не нашли, не показываем: пустых строк в кадре нет.
    $('cls-sub').textContent = 'Доля от обследованного объёма\n' +
      fmt1(b.surveyed) + ' тыс. т';
    $('cls-foot').style.display = '';
    $('cls-foot').textContent = b.bad
      ? 'Не соответствует требованиям ГОСТ — ' + fmt1(b.bad) + ' тыс. т'
      : 'Соответствует требованиям ГОСТ — ' + dec1(b.compliance) + ' %';
    var cls = $('cls-body');
    cls.textContent = '';
    (b.classes || []).forEach(function (p, i) {
      if (!p) return;
      var row = el('div', 'c-row');
      var name = el('div', 'c-name');
      name.appendChild(el('b', null, 'Класс ' + (i + 1)));
      var t = (b.classT && b.classT[i]) || b.surveyed * p / 100;
      name.appendChild(el('span', null, fmt1(t) + ' тыс. т'));
      row.appendChild(name);
      // мелкие доли округляются до десятых, крупные — до целых процентов
      row.appendChild(el('div', 'c-pct',
        (p < 10 ? dec1(p) : String(Math.round(p))) + ' %'));
      cls.appendChild(row);
    });
    drawSpec(b);
  }

  /** Спец. характеристики зерна: белок, клейковина, натура, ЧП,
      стекловидность. Их дают не по всем субъектам — где нет, строки нет. */
  function drawSpec(b) {
    var box = $('cls-spec');
    if (!box) return;
    box.textContent = '';
    var rows = [
      ['Белок', b.protein, ' %'],
      ['Клейковина', b.gluten, ' %'],
      ['Натура', b.nature, ' г/л'],
      ['Число падения', b.falling, ' с'],
      ['Стекловидность', b.vitreous, ' %']
    ].filter(function (r) { return r[1] != null; });
    if (!rows.length) return;
    box.appendChild(el('div', 's-head', 'Средневзвешенные показатели'));
    rows.forEach(function (r) {
      var line = el('div', 's-row');
      line.appendChild(el('span', null, r[0]));
      line.appendChild(el('b', null, dec1(r[1]) + r[2]));
      box.appendChild(line);
    });
  }

  function drawEmptyRegion() {
    // Разные случаи: субъекта вовсе нет в data/monitoring.json —
    // госмониторинг там не проводится; есть, но без записи за год —
    // пшеницу в этом году не возделывали.
    var noMon = !byId[regionId];
    var pending = !!PENDING[regionId];
    var note = pending ? 'Данные уточняются'
      : noMon ? 'Госмониторинг не проводится'
      : kind === 'durum' ? 'Твёрдую пшеницу в регионе не возделывают'
      : 'Данных за ' + year + ' год нет';
    $('reg-sub').textContent = pending
      ? 'Данные по региону уточняются'
      : noMon
      ? 'Госмониторинг в этом регионе не проводится'
      : kindLabel() + '  ·  ' + note;
    bigNum($('gross-body'), '—', '', note);
    bigNum($('surv-body'), '—', '', note);
    $('cls-sub').textContent = note;
    $('cls-body').textContent = '';
    $('cls-foot').style.display = 'none';
    if ($('cls-spec')) $('cls-spec').textContent = '';
  }

  /* --------------------- экран «Регионы присутствия» --------------------- */

  function selectPresence(id) {
    id = id && presOf[id];
    if (!id) return;
    presId = id;
    drawPresence();
    placeCall();
    need = true;
  }

  function drawPresence() {
    var box = $('card-pres');
    box.textContent = '';
    var p = presId && pres && pres.regions[presId];
    if (!p) {
      box.appendChild(el('div', 'mn-pres-body',
        'Выберите подсвеченный регион на карте.'));
      return;
    }
    box.appendChild(el('h2', 'mn-pres-name', p.name));
    // в кадре филиал и направления — один текстовый блок с пустыми строками
    var lines = [];
    if (p.branch) lines.push(p.branch);
    if (p.areas && p.areas.length) {
      lines.push('', 'Основные направления', '');
      p.areas.forEach(function (a) { lines.push('• ' + a); });
    }
    box.appendChild(el('div', 'mn-pres-body', lines.join('\n')));
    if ((!p.areas || !p.areas.length) && p.todo) {
      box.appendChild(el('div', 'mn-pres-todo', p.todo));
    }
    if (pres.note) $('pres-foot').textContent = pres.note;
  }

  /** Выноска с названием у выбранного региона: подпись и линия к контуру. */
  function placeCall() {
    var call = $('map-call');
    if (!call) return;
    var p = screen === 'presence' && presId && pres && pres.regions[presId];
    var s = p && shapes.filter(function (x) { return x.id === presId; })[0];
    if (!s) { call.classList.remove('is-on'); return; }
    var c = toCanvas(s.c[0], s.c[1]);
    var right = c[0] < 360;                 // регион у левого края — подпись справа
    var left = U.clamp(right ? c[0] + 70 : c[0] - 320, 24, MAP_W - 300);
    call.classList.toggle('is-right', right);
    call.style.left = left + 'px';
    call.style.top = U.clamp(c[1] - 60, 80, MAP_H - 140) + 'px';
    // линия от подписи к контуру региона
    var line = call.querySelector('i');
    if (line) line.style.width = Math.max(40, right ? left - c[0] : c[0] - left) + 'px';
    $('call-name').textContent = p.name;
    call.classList.add('is-on');
  }

  /* ------------------------------ переходы ------------------------------ */

  function show(name) {
    screen = name;
    $('scr-map').classList.toggle('is-on', name === 'map');
    $('scr-region').classList.toggle('is-on', name === 'region');
    $('scr-presence').classList.toggle('is-on', name === 'presence');
    // класс состояния — на обёртке раздела, а не на body: в едином
    // приложении body общий на все разделы
    ROOT.classList.toggle('on-map', name === 'map');
    ROOT.classList.toggle('on-region', name === 'region');
    ROOT.classList.toggle('on-presence', name === 'presence');
    if (name !== 'presence') $('map-call').classList.remove('is-on');
    setUrl();
  }

  function openRegion(id) {
    // карточка открывается и у субъекта без данных: в data/monitoring.json
    // его может не быть вовсе (например, там не проводится госмониторинг)
    if (!shapes.some(function (s) { return s.id === id; })) return;
    regionId = id;
    if (!rec(id, kind)) kind = 'soft';
    drawRegion();
    show('region');
    need = true;
  }

  function backToMap() {
    regionId = null;
    tab = 'grain';
    drawTabs();
    show('map');
    setHover(null);
    resetView();
    need = true;
  }

  function setUrl() {
    var p = { year: year };
    if (screen === 'presence') {
      p.view = 'presence';
      if (presId) p.region = presId;
    } else if (screen === 'region' && regionId) {
      p.region = regionId;
      if (kind !== 'soft') p.kind = kind;
    }
    if (global.Shell) { global.Shell.url('monitoring', p); return; }
    if (!global.history || !history.replaceState) return;
    var q = [];
    for (var k in p) q.push(k + '=' + encodeURIComponent(p[k]));
    if (idleOff) q.push('idle=0');
    history.replaceState(null, '', '?' + q.join('&'));
  }

  /* ------------------------------ аттрактор ------------------------------ */

  /* В едином приложении таймер бездействия один на все разделы и живёт
     в src/shell.js — здесь мы только сообщаем ему, что был отклик. */

  function resetIdle() {
    if (global.Shell) { global.Shell.ping(); return; }
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
    drawHead();
    backToMap();
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
        if (id && screen === 'presence') selectPresence(id);
        else if (id && screen === 'map') openRegion(id);
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
    $('zoom-reset').addEventListener('click', function () {
      resetIdle();
      resetView();
    });
  }

  /* ------------------------------ старт ------------------------------ */

  function recalcMax() {
    maxVol = 1;
    shapes.forEach(function (s) { maxVol = Math.max(maxVol, volume(s.id)); });
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

  function fail(msg) {
    $('loading').textContent = msg;
    $('loading').classList.remove('hidden');
    U.revealPage();
  }

  function boot(active) {
    live = active !== false;
    ctx = $('map').getContext('2d');
    $('scene-img').src = U.asset(SCENE_IMG);

    return U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      CFG = cfg || CFG;
      var green = (CFG.themes && CFG.themes.green) || {};
      applyColors(green.colors);
    }).catch(function () { /* без конфига живём со значениями по умолчанию */
    }).then(function () {
      return Promise.all([
        U.loadJSON('inline-regions', 'assets/geo/russia-regions.json'),
        U.loadJSON('inline-monitoring', 'data/monitoring.json'),
        // без файла филиалов второй таб просто пустой — раздел работает
        U.loadJSON('inline-presence', 'data/presence.json').catch(function (e) {
          if (global.console) {
            console.warn('Не загрузить data/presence.json — вкладка ' +
              '«Регионы присутствия» будет пустой:', e);
          }
          return { regions: {} };
        })
      ]);
    }).then(function (res) {
      geo = res[0];
      mon = res[1];
      pres = res[2];
      mon.regions.forEach(function (r) { byId[r.id] = r; });

      buildShapes();
      buildLabs();
      fitStage();

      var q = U.query('monitoring');
      if (q.idle === '0') idleOff = true;
      year = mon.years.indexOf(parseInt(q.year, 10)) >= 0
        ? parseInt(q.year, 10)
        : mon.years[mon.years.length - 1];
      if (q.kind === 'durum') kind = 'durum';
      recalcMax();

      drawTabs();
      drawYears();
      drawHead();
      drawTotal();
      bindKindSwipe();
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
        openFirst();
      });
      $('back-map').addEventListener('click', function () { resetIdle(); backToMap(); });
      $('hub-btn').addEventListener('click', function () {
        U.goSection('story', { screen: 'hub' });
      });
      ['home-btn', 'home-btn-reg'].forEach(function (id) {
        $(id).addEventListener('click', function () {
          U.goSection('story', { screen: 'start' });
        });
      });

      global.addEventListener('resize', fitStage);
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });

      // что открыть при старте: карта, карточка региона или регионы присутствия
      if (q.view === 'presence') {
        tab = 'presence';
        drawTabs();
        show('presence');
        selectPresence(q.region || pres.start);
        if (!presId) drawPresence();
      } else if (q.region) {
        // openRegion сам проверит, есть ли такой контур: субъекта может
        // не быть в цифрах мониторинга, но карточка всё равно открывается
        show('map');
        openRegion(q.region);
      } else {
        show('map');
      }
      resetView();
      if (q.at) focusOn(q.at, parseFloat(q.zoom));
      else if (q.zoom) zoomTo(parseFloat(q.zoom));

      resetIdle();
      $('loading').classList.add('hidden');
      // раздел, поднятый в фоне, один раз рисуется и замирает до показа
      draw();
      placeCall();
      need = false;
      if (live) startLoop();
      U.revealPage();
      if (global.Shell) global.Shell.ready('monitoring');
    }).catch(function (e) {
      fail('Не загрузить данные мониторинга: ' + (e && e.message ? e.message : e));
    });
  }

  /** Enter или кнопка «Искать»: открыть первое совпадение. */
  function openFirst() {
    var arr = listed();
    if (arr.length) openRegion(arr[0].id);
  }

  /* Для показа и отладки: MonScreen.open('RU-ROS'), MonScreen.stats() */
  global.MonScreen = {
    open: openRegion,
    back: backToMap,
    focus: focusOn,
    tab: setTab,
    kind: setKind,
    presence: selectPresence,
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
               screen: screen, tab: tab, kind: kind,
               region: regionId, presence: presId,
               labs: labs.length, running: !!rafId };
    }
  };

  /* Раздел единого приложения (app.html) или отдельная страница
     monitoring.html. Контуры субъектов строятся один раз; при уходе
     с раздела останавливается только цикл отрисовки. */

  if (global.Shell) {
    global.Shell.register('monitoring', {
      boot: boot,
      show: function () {
        live = true;
        fitStage();
        need = true;
        startLoop();
      },
      hide: function () {
        live = false;
        stopLoop();
      },
      reset: function () {
        if (!mon) return;
        toAttractor();
      }
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
