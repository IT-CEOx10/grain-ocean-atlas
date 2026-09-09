/* ===================================================================
   «Путь зерна» — сквозная презентация, каркас всех экранов.

   Одно приложение, экраны переключаются без перезагрузки страницы.
   Тексты и данные лежат отдельно, в src/story-content.js: чтобы
   поправить формулировку, сюда лезть не нужно.

   Что здесь:
     - движок: реестр экранов, переход с затуханием, история для «назад»;
     - четыре раскладки (hero, hub, station, wide) — новый экран
       добавляется описанием в справочнике, а не вёрсткой;
     - интерактивы экранов (виджеты) — словарь WIDGETS;
     - заглушки изображений: пока путь к файлу пуст, рисуется рамка
       с подписью, что за кадр тут будет;
     - аттрактор: возврат на первый экран по таймауту из config.json;
     - адрес ?screen=<id> открывает нужный экран сразу.

   Экраны глобуса (index.html) и Блока 3 (path.html) этот файл не трогает.
   =================================================================== */
(function (global) {
  'use strict';

  var C = global.StoryContent;
  var $ = function (id) { return document.getElementById(id); };
  var el = function (t, c, x) { return U.el(t, c, x); };

  var byId = {};
  C.screens.forEach(function (s) { byId[s.id] = s; });

  var CFG = { attractorTimeoutSec: 90 };
  var HOME = 'intro';                    // куда возвращает аттрактор
  var FADE = 250;                        // мс затухания при переходе

  var cur = null;                        // текущий экран
  var st = {};                           // состояние экрана (сбрасывается при переходе)
  var hist = [];                         // история переходов для «назад»
  var idleTimer = null, idleOff = false;
  var busy = false;

  /* =================================================================
     Заглушка изображения

     Единый компонент на все экраны. Если у кадра задан путь (img),
     показывается сам файл; пока путь пуст — опрятная рамка с иконкой
     и подписью, что за кадр тут будет.

     Поле fit кадра говорит, как снимок ложится в отведённое место:
     пусто — широкая сцена обрезается по месту (object-fit: cover),
     'contain' — предметный снимок с прозрачным фоном виден целиком
     и лежит на подложке в цвете темы.
     ================================================================= */

  function stub(p, cls) {
    var box = el('div', 'stub ' + (cls || ''));
    if (!p) return box;
    if (p.img) {
      box.classList.add('has-img');
      if (p.fit) box.classList.add('is-' + p.fit);
      var im = new Image();
      im.src = U.asset(p.img);
      im.alt = p.cap || '';
      box.appendChild(im);
      return box;
    }
    box.appendChild(el('span', 'stub-tag', p.tag || 'фото'));
    var ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ic.setAttribute('viewBox', '0 0 24 24');
    ic.innerHTML = p.tag === 'видео'
      ? '<rect x="2.5" y="5" width="19" height="14" rx="3"></rect>' +
        '<path d="M10.2 9.4l5 2.6-5 2.6z"></path>'
      : '<rect x="2.5" y="4.5" width="19" height="15" rx="3"></rect>' +
        '<circle cx="8.4" cy="9.6" r="1.7"></circle>' +
        '<path d="M3.4 17.4l4.9-4.6 3.6 3.3 3.5-3.9 5.2 5.2"></path>';
    box.appendChild(ic);
    box.appendChild(el('div', 'stub-cap', p.cap || ''));
    return box;
  }

  /* =================================================================
     Карточки правой колонки
     ================================================================= */

  function cardEl(c) {
    var n = el('section', 'st-card' + (c.small ? ' is-small' : '') +
      (c.active ? ' is-active' : ''));
    if (c.title) n.appendChild(el('h3', 'st-card-t', c.title));
    if (c.pic) {
      var ph = stub(c.pic, 'stub-in-card');
      n.appendChild(ph);
    }
    if (c.text) n.appendChild(el('p', 'st-card-p', c.text));
    if (c.items) {
      var ul = el('ul', 'st-list');
      c.items.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      n.appendChild(ul);
    }
    if (c.rows) {
      var rt = el('div', 'st-rows');
      c.rows.forEach(function (r) {
        var row = el('div', 'st-row');
        row.appendChild(el('span', 'k', r[0]));
        row.appendChild(el('span', 'v', r[1]));
        rt.appendChild(row);
      });
      n.appendChild(rt);
    }
    if (c.chips) {
      var ch = el('div', 'st-chips');
      c.chips.forEach(function (t) { ch.appendChild(el('span', 'st-chip', t)); });
      n.appendChild(ch);
    }
    if (c.note) n.appendChild(el('div', 'st-note', c.note));
    if (c.button) n.appendChild(button(c.button, 'st-btn is-primary st-card-btn'));
    if (c.slot) n.setAttribute('data-slot', c.slot);
    return n;
  }

  /** Кнопка: to — переход на экран (или 'back'), action — поведение экрана. */
  function button(b, cls) {
    var n = el('button', cls || 'st-btn', b.label);
    n.type = 'button';
    n.addEventListener('click', function () {
      resetIdle();
      if (b.to === 'back') back();
      else if (b.to) go(b.to);
      else if (b.action && ACTIONS[b.action]) ACTIONS[b.action]();
    });
    return n;
  }

  /* =================================================================
     Сборка карточек экрана: постоянные + зависящие от выбора/вкладки
     ================================================================= */

  function tabKey() { return st.tab || cur.defaultTab; }
  function selKey() { return st.sel != null ? st.sel : cur.defaultSel; }

  function find(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0];
  }

  /* Карточки, которые собираются из справочников по выбору на экране.
     Тексты всё равно живут в story-content.js — здесь только сборка. */
  var DYNAMIC = {
    'quality-1': function () {
      var i = find(C.grainIndicators, selKey());
      return [{ title: i.name, text: i.text }];
    },
    product: function () {
      var p = find(C.products, selKey());
      return [
        { title: p.name, text: p.text },
        { title: 'Показатели безопасности', items: p.safety }
      ];
    }
  };

  function cardsFor(scr) {
    var out = [];
    if (DYNAMIC[scr.id]) out = out.concat(DYNAMIC[scr.id]());
    if (scr.cardsBySel) out = out.concat(scr.cardsBySel[selKey()] || []);
    if (scr.cardsByTab) out = out.concat(scr.cardsByTab[tabKey()] || []);
    if (scr.cards) out = out.concat(scr.cards);
    // на экране 8 подсвечивается карточка выбранной зоны поля
    return out.map(function (c) {
      if (!c.key) return c;
      var copy = {}; for (var k in c) copy[k] = c[k];
      copy.active = c.key === selKey();
      return copy;
    });
  }

  function sceneFor(scr) {
    if (scr.sceneByTab) return scr.sceneByTab[tabKey()] || {};
    return scr.scene || {};
  }

  /* =================================================================
     Раскладки
     ================================================================= */

  function head(scr) {
    var h = el('header', 'st-head');
    if (scr.eyebrow) h.appendChild(el('div', 'st-eyebrow', scr.eyebrow));
    h.appendChild(el('h1', 'st-title', scr.title));
    if (scr.sub) h.appendChild(el('div', 'st-sub', scr.sub));
    return h;
  }

  function tabsEl(scr) {
    if (!scr.tabs) return null;
    var box = el('nav', 'st-tabs');
    scr.tabs.forEach(function (t) {
      var on = t.to ? t.to === scr.id : (t.tab === tabKey());
      var b = el('button', 'st-tab' + (on ? ' is-on' : ''), t.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        resetIdle();
        if (t.to && t.to !== scr.id) go(t.to);
        else if (t.tab) { st.tab = t.tab; rerender(); }
      });
      box.appendChild(b);
    });
    return box;
  }

  function navEl(scr) {
    var n = scr.nav;
    var box = el('nav', 'st-nav');
    ['back', 'center', 'next'].forEach(function (slot) {
      var cell = el('div', 'st-nav-' + slot);
      var b = n && n[slot];
      if (b) {
        if (b.text) cell.appendChild(el('div', 'st-nav-text', b.text));
        else cell.appendChild(button(b, 'st-btn' + (b.primary ? ' is-primary' : '')));
      }
      box.appendChild(cell);
    });
    return box;
  }

  /** Типовая станция: шапка, табы, сцена слева, карточки справа, навигация. */
  function renderStation(scr, root) {
    root.appendChild(head(scr));
    var tabs = tabsEl(scr);
    if (tabs) root.appendChild(tabs);

    var body = el('div', 'st-body' + (tabs ? '' : ' no-tabs') +
      (scr.layout === 'wide' ? ' is-wide' : ''));
    var scene = el('section', 'st-scene');
    renderScene(scr, scene);
    body.appendChild(scene);

    if (scr.layout !== 'wide') {
      var col = el('aside', 'st-cards');
      cardsFor(scr).forEach(function (c) { col.appendChild(cardEl(c)); });
      body.appendChild(col);
    }
    root.appendChild(body);
    root.appendChild(navEl(scr));
  }

  function renderScene(scr, box) {
    var sc = sceneFor(scr);
    if (sc.widget && WIDGETS[sc.widget]) { WIDGETS[sc.widget](box, sc, scr); return; }
    if (sc.cards) {
      box.classList.add('is-panels');
      sc.cards.forEach(function (c) { box.appendChild(cardEl(c)); });
      return;
    }
    if (sc.pic) {
      box.appendChild(stub(sc.pic, 'stub-fill'));
      if (sc.hint) box.appendChild(el('div', 'st-hint', sc.hint));
    }
  }

  /** Первый, финальный и служебные экраны: крупный кадр и кнопки. */
  function renderHero(scr, root) {
    if (scr.hero) {                       // экран 1: кадр во весь экран
      root.classList.add('is-cover');
      root.appendChild(stub(scr.scene.pic, 'stub-cover'));
      var wrap = el('div', 'hero-cover');
      wrap.appendChild(el('h1', 'hero-title', scr.title));
      wrap.appendChild(el('div', 'hero-hint', scr.sub));
      root.appendChild(wrap);
      // касание в любом месте ведёт дальше; слушатель висит на своём слое,
      // а не на #view — иначе он пережил бы смену экрана
      var tap = el('button', 'hero-tap');
      tap.type = 'button';
      tap.setAttribute('aria-label', scr.sub || 'Дальше');
      tap.addEventListener('click', function () { resetIdle(); go(scr.tapTo); });
      root.appendChild(tap);
      return;
    }

    root.appendChild(head(scr));
    var body = el('div', 'st-body hero-body');
    if (scr.scene && scr.scene.pic) {
      var scene = el('section', 'st-scene');
      scene.appendChild(stub(scr.scene.pic, 'stub-fill'));
      body.appendChild(scene);
    } else {
      body.classList.add('is-center');
    }
    var col = el('aside', 'st-cards');
    (scr.cards || []).forEach(function (c) { col.appendChild(cardEl(c)); });
    if (scr.actions) {
      var acts = el('div', 'hero-actions');
      scr.actions.forEach(function (a) {
        acts.appendChild(button(a, 'st-btn is-wide' + (a.primary ? ' is-primary' : '')));
      });
      col.appendChild(acts);
    }
    body.appendChild(col);
    root.appendChild(body);
  }

  /** Центр управления: цепочка из семи станций (экраны 3 и 4). */
  function renderHub(scr, root) {
    root.appendChild(head(scr));

    var chain = el('div', 'hub-chain');
    C.stations.forEach(function (s, i) {
      if (i) chain.appendChild(el('div', 'hub-arrow', '→'));
      var t = el('button', 'hub-tile' + (selKey() === s.key ? ' is-on' : ''));
      t.type = 'button';
      t.appendChild(el('span', 'hub-n', s.n < 10 ? '0' + s.n : String(s.n)));
      t.appendChild(el('span', 'hub-t', s.title));
      t.addEventListener('click', function () {
        resetIdle();
        // первое касание — подсветка и карточка «О станции»,
        // повторное касание той же станции открывает её
        if (selKey() === s.key) go(s.to);
        else { st.sel = s.key; rerender(); }
      });
      chain.appendChild(t);
    });
    root.appendChild(chain);

    var foot = el('div', 'hub-foot');

    var ways = el('section', 'st-card hub-ways');
    ways.appendChild(el('h3', 'st-card-t', scr.waysTitle));
    var chips = el('div', 'st-chips');
    scr.ways.forEach(function (w) { chips.appendChild(el('span', 'st-chip', w)); });
    ways.appendChild(chips);
    foot.appendChild(ways);

    var about = el('section', 'st-card hub-about');
    if (st.sel) {
      var s = find(C.stations, st.sel);
      about.appendChild(el('h3', 'st-card-t', 'О станции'));
      about.appendChild(el('div', 'hub-about-n', 'Станция ' + s.n + ' · ' + s.title));
      about.appendChild(el('p', 'st-card-p', s.hint));
      about.appendChild(button({ label: 'Открыть станцию', to: s.to },
        'st-btn is-primary st-card-btn'));
    } else {
      about.classList.add('is-empty');
      about.appendChild(el('h3', 'st-card-t', 'О станции'));
      about.appendChild(el('p', 'st-card-p',
        'Коснитесь станции на схеме — здесь появится подсказка и кнопка «Открыть станцию».'));
    }
    foot.appendChild(about);
    root.appendChild(foot);
    root.appendChild(navEl(scr));
  }

  /* =================================================================
     Интерактивы экранов
     ================================================================= */

  var WIDGETS = {

    /* --- экран 5: карта полей, ползунок показателя, расчёт удобрений --- */
    soilFields: function (box, sc) {
      box.classList.add('is-widget');
      if (st.plot == null) st.plot = C.plots[0].key;
      var plot = find(C.plots, st.plot);
      if (st.level == null) st.level = plot.value;

      box.appendChild(el('div', 'st-scene-t', 'Лабораторная карта полей'));

      var grid = el('div', 'sf-grid');
      C.plots.forEach(function (p) {
        var on = p.key === st.plot;
        var b = el('button', 'sf-plot' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.appendChild(el('span', 'sf-name', p.name));
        b.appendChild(el('span', 'sf-cap', 'Продуктивность'));
        b.appendChild(el('span', 'sf-val', (on ? st.level : p.value) + ' %'));
        var bar = el('span', 'sf-bar');
        var fill = el('i');
        fill.style.width = (on ? st.level : p.value) + '%';
        bar.appendChild(fill);
        b.appendChild(bar);
        b.addEventListener('click', function () {
          resetIdle();
          st.plot = p.key; st.level = p.value; rerender();
        });
        grid.appendChild(b);
      });
      box.appendChild(grid);

      var sl = el('div', 'sf-slider');
      sl.appendChild(el('div', 'sf-slider-t', 'Измените показатель почвы'));
      var row = el('div', 'sf-slider-row');
      row.appendChild(el('span', 'sf-end', 'Ниже'));
      var input = el('input', 'st-range');
      input.type = 'range'; input.min = 5; input.max = 100; input.value = st.level;
      row.appendChild(input);
      row.appendChild(el('span', 'sf-end', 'Выше'));
      sl.appendChild(row);
      box.appendChild(sl);

      var valEl = grid.querySelector('.sf-plot.is-on .sf-val');
      var barEl = grid.querySelector('.sf-plot.is-on .sf-bar i');
      input.addEventListener('input', function () {
        resetIdle();
        st.level = +input.value;
        if (valEl) valEl.textContent = st.level + ' %';
        if (barEl) barEl.style.width = st.level + '%';
        if (st.fertEl) fillFert(st.fertEl);
      });
    },

    /* --- экран 6: шторка сравнения до/после --- */
    beforeAfter: function (box, sc) {
      box.classList.add('is-widget');
      if (st.split == null) st.split = 50;

      // Кадры сняты с разных ракурсов, поэтому подписи развёрнутые:
      // это две отдельные фотографии, а не один кадр под шторкой.
      var wrap = el('div', 'ba');
      var a = stub(sc.before, 'ba-layer ba-before');
      a.appendChild(el('span', 'ba-badge', 'До восстановления'));
      var b = stub(sc.after, 'ba-layer ba-after');
      b.appendChild(el('span', 'ba-badge is-right', 'После восстановления'));
      var line = el('div', 'ba-line');
      line.appendChild(el('span', 'ba-knob', '⟷'));
      wrap.appendChild(a); wrap.appendChild(b); wrap.appendChild(line);

      function put(clientX) {
        var r = wrap.getBoundingClientRect();
        var p = U.clamp((clientX - r.left) / r.width * 100, 4, 96);
        st.split = p;
        b.style.clipPath = 'inset(0 0 0 ' + p + '%)';
        b.style.webkitClipPath = 'inset(0 0 0 ' + p + '%)';
        line.style.left = p + '%';
      }
      b.style.clipPath = 'inset(0 0 0 ' + st.split + '%)';
      b.style.webkitClipPath = 'inset(0 0 0 ' + st.split + '%)';
      line.style.left = st.split + '%';

      var down = false;
      wrap.addEventListener('pointerdown', function (e) {
        down = true; wrap.setPointerCapture(e.pointerId); put(e.clientX); resetIdle();
      });
      wrap.addEventListener('pointermove', function (e) { if (down) put(e.clientX); });
      wrap.addEventListener('pointerup', function () { down = false; });
      wrap.addEventListener('pointercancel', function () { down = false; });

      box.appendChild(wrap);
      box.appendChild(el('div', 'st-hint', sc.hint));
    },

    /* --- экран 7: выбор образца семени --- */
    seedSamples: function (box, sc) {
      box.classList.add('is-widget');
      var row = el('div', 'seed-row');
      sc.samples.forEach(function (s) {
        var b = el('button', 'seed-item' + (selKey() === s.key ? ' is-on' : ''));
        b.type = 'button';
        b.appendChild(stub(s.pic, 'stub-fill'));
        b.appendChild(el('div', 'seed-name', s.name));
        b.addEventListener('click', function () { resetIdle(); st.sel = s.key; rerender(); });
        row.appendChild(b);
      });
      box.appendChild(row);
      box.appendChild(el('div', 'st-hint', sc.hint));
    },

    /* --- экран 8: две зоны на поле --- */
    fieldZones: function (box, sc) {
      box.classList.add('is-widget');
      var frame = el('div', 'zone-frame');
      frame.appendChild(stub(sc.pic, 'stub-fill'));
      sc.zones.forEach(function (z) {
        var b = el('button', 'zone' + (selKey() === z.key ? ' is-on' : ''));
        b.type = 'button';
        b.style.left = z.x + '%';
        b.style.top = z.y + '%';
        b.appendChild(el('span', 'zone-dot'));
        b.appendChild(el('span', 'zone-name', z.name));
        b.addEventListener('click', function () { resetIdle(); st.sel = z.key; rerender(); });
        frame.appendChild(b);
      });
      box.appendChild(frame);
      box.appendChild(el('div', 'st-hint', sc.hint));
    },

    /* --- экран 9: найти три сорняка на поле ---
       Сорняков на снимке нет, метки-цели рисуются поверх кадра.
       Кадр с беспилотником лежит вторым слоем и проявляется по кнопке
       «Запустить обзор с БПЛА» (см. ACTIONS.droneScan). */
    weeds: function (box, sc) {
      box.classList.add('is-widget');
      if (!st.found) st.found = {};
      var frame = el('div', 'zone-frame');
      frame.appendChild(stub(sc.pic, 'stub-fill'));
      if (sc.picDrone) {
        st.droneEl = stub(sc.picDrone, 'stub-fill zone-drone');
        frame.appendChild(st.droneEl);
        st.droneTag = el('div', 'zone-drone-tag', 'Съёмка с беспилотника');
        frame.appendChild(st.droneTag);
      }

      var counter = el('div', 'weed-count');
      function updCount() {
        var n = 0;
        for (var k in st.found) if (st.found[k]) n++;
        counter.textContent = 'Найдено ' + n + ' из ' + sc.marks.length;
        counter.classList.toggle('is-done', n === sc.marks.length);
      }

      st.weedEls = [];
      sc.marks.forEach(function (m, i) {
        var b = el('button', 'weed' + (st.found[i] ? ' is-found' : ''));
        b.type = 'button';
        b.style.left = m.x + '%';
        b.style.top = m.y + '%';
        b.appendChild(el('span', 'weed-ring'));
        b.appendChild(el('span', 'weed-tag', 'Сорняк'));
        b.addEventListener('click', function () {
          resetIdle();
          st.found[i] = true;
          b.classList.add('is-found');
          updCount();
        });
        st.weedEls.push(b);
        frame.appendChild(b);
      });

      box.appendChild(frame);
      var foot = el('div', 'weed-foot');
      foot.appendChild(el('div', 'st-hint', sc.hint));
      foot.appendChild(counter);
      box.appendChild(foot);
      updCount();
      st.weedCount = updCount;
    },

    /* --- экран 10: рост → уборка → собранное зерно --- */
    chain: function (box, sc) {
      box.classList.add('is-widget');
      var row = el('div', 'chain-row');
      sc.pics.forEach(function (p, i) {
        if (i) row.appendChild(el('div', 'chain-arrow', '→'));
        var cell = el('div', 'chain-cell');
        cell.appendChild(stub(p, 'stub-fill'));
        // подпись нужна только под настоящим кадром: на заглушке
        // она и так написана внутри рамки
        if (p.img && p.cap) cell.appendChild(el('div', 'chain-cap', p.cap));
        row.appendChild(cell);
      });
      box.appendChild(row);
      if (sc.note) box.appendChild(el('div', 'chain-note', sc.note));
    },

    /* --- экран 11: четыре показателя качества зерна --- */
    grainIndicators: function (box, sc) {
      box.classList.add('is-widget');
      box.appendChild(stub(sc.pic, 'stub-fill'));
      box.appendChild(el('div', 'st-hint', sc.hint));
      var row = el('div', 'ind-row');
      C.grainIndicators.forEach(function (i) {
        var b = el('button', 'ind' + (selKey() === i.key ? ' is-on' : ''), i.name);
        b.type = 'button';
        b.addEventListener('click', function () { resetIdle(); st.sel = i.key; rerender(); });
        row.appendChild(b);
      });
      box.appendChild(row);
    },

    /* --- экраны 13 и 20: кадр и три шага --- */
    steps: function (box, sc) {
      box.classList.add('is-widget');
      box.appendChild(stub(sc.pic, 'stub-fill'));
      var row = el('div', 'steps-row');
      st.stepEls = [];
      sc.steps.forEach(function (t, i) {
        var s = el('div', 'step');
        s.appendChild(el('span', 'step-n', '0' + (i + 1)));
        s.appendChild(el('span', 'step-t', t));
        st.stepEls.push(s);
        row.appendChild(s);
        if (i < sc.steps.length - 1) row.appendChild(el('div', 'step-arrow', '→'));
      });
      box.appendChild(row);
    },

    /* --- экран 14: несоответствия за сезон --- */
    mismatchChart: function (box, sc) {
      box.classList.add('is-widget');
      box.appendChild(el('div', 'st-scene-t', sc.hint));
      var max = 0;
      C.mismatch.forEach(function (m) { max = Math.max(max, m.value); });
      var wrap = el('div', 'chart');
      C.mismatch.forEach(function (m) {
        var r = el('div', 'chart-row');
        r.appendChild(el('span', 'chart-k', m.name));
        var track = el('span', 'chart-track');
        var fill = el('i');
        fill.style.width = Math.round(m.value / max * 100) + '%';
        track.appendChild(fill);
        r.appendChild(track);
        r.appendChild(el('span', 'chart-v',
          String(m.value).replace('.', ',') + ' %'));
        wrap.appendChild(r);
      });
      box.appendChild(wrap);
      box.appendChild(el('div', 'st-note', 'Демонстрационные значения'));
      box.appendChild(el('div', 'chart-total', 'Доля несоответствующих партий: … %'));
    },

    /* --- экран 15: три маршрута переработки --- */
    routes: function (box, sc) {
      box.classList.add('is-widget', 'is-routes');
      var row = el('div', 'routes-row');
      sc.routes.forEach(function (r) {
        var col = el('div', 'route-col');
        col.appendChild(stub(r.pic, 'stub-fill'));
        var card = el('div', 'st-card');
        card.appendChild(el('h3', 'st-card-t', r.title));
        card.appendChild(el('p', 'st-card-p', r.text));
        card.appendChild(button({ label: 'Открыть маршрут', to: r.to },
          'st-btn is-primary st-card-btn'));
        col.appendChild(card);
        row.appendChild(col);
      });
      box.appendChild(row);
    },

    /* --- экран 16: ползунок качества муки ---
       Пять кадров пробной выпечки лежат стопкой друг на друге.
       Ползунок ходит непрерывно (0…1000), а не по пяти делениям:
       положение между делениями плавно переводит один кадр в другой.
       Верхние кадры проявляются поверх нижних, поэтому в середине
       перехода сквозь стопку ничего не просвечивает. */
    flourSlider: function (box, sc) {
      box.classList.add('is-widget');
      var lv = C.flourLevels;
      var last = lv.length - 1;
      var STEPS = 1000;                    // делений у ползунка
      if (st.flour == null) st.flour = Math.round(STEPS * 2 / last);

      var stage = el('div', 'flour-stage');
      var layers = lv.map(function (l, i) {
        var im = new Image();
        im.className = 'flour-frame';
        im.src = U.asset(l.img);
        im.alt = l.name;
        if (i) im.style.opacity = 0;
        stage.appendChild(im);
        return im;
      });
      box.appendChild(stage);

      var sl = el('div', 'sf-slider');
      sl.appendChild(el('div', 'sf-slider-t', sc.hint));
      var row = el('div', 'sf-slider-row');
      row.appendChild(el('span', 'sf-end', 'Хуже'));
      var input = el('input', 'st-range');
      input.type = 'range'; input.min = 0; input.max = STEPS;
      input.step = 1; input.value = st.flour;
      row.appendChild(input);
      row.appendChild(el('span', 'sf-end', 'Лучше'));
      sl.appendChild(row);

      var scale = el('div', 'flour-scale');
      var bar = el('div', 'flour-bar');
      var fill = el('i');
      bar.appendChild(fill);
      scale.appendChild(bar);
      var lab = el('div', 'flour-label');
      var note = el('div', 'flour-sub');
      scale.appendChild(lab);
      scale.appendChild(note);
      sl.appendChild(scale);

      function upd() {
        var pos = st.flour / STEPS * last;          // 0…4 с дробной частью
        layers.forEach(function (im, i) {
          if (!i) return;
          im.style.opacity = U.clamp(pos - (i - 1), 0, 1);
        });
        fill.style.width = (st.flour / STEPS * 100) + '%';
        var cur3 = lv[Math.round(pos)];
        lab.textContent = cur3.name;
        note.textContent = cur3.hint;
      }
      input.addEventListener('input', function () {
        resetIdle(); st.flour = +input.value; upd();
      });
      upd();
      box.appendChild(sl);
      if (sc.note) box.appendChild(el('div', 'st-note', sc.note));
    },

    /* --- экран 17: цепочка «Корм → Животное → Молоко / мясо» --- */
    feedChain: function (box, sc) {
      box.classList.add('is-widget');
      var row = el('div', 'chain-row');
      C.feedChain.forEach(function (l, i) {
        if (i) row.appendChild(el('div', 'chain-arrow', '→'));
        var b = el('button', 'chain-cell is-pick' + (selKey() === l.key ? ' is-on' : ''));
        b.type = 'button';
        b.appendChild(stub(C.pic(l.cap, l.img, 'фото', 'contain'), 'stub-fill'));
        b.appendChild(el('div', 'seed-name', l.name));
        b.addEventListener('click', function () { resetIdle(); st.sel = l.key; rerender(); });
        row.appendChild(b);
      });
      box.appendChild(row);
      box.appendChild(el('div', 'st-hint', sc.hint));
    },

    /* --- экран 19: шесть продуктов --- */
    products: function (box) {
      box.classList.add('is-widget');
      var grid = el('div', 'prod-grid');
      C.products.forEach(function (p) {
        var b = el('button', 'prod' + (selKey() === p.key ? ' is-on' : ''));
        b.type = 'button';
        b.appendChild(stub(C.pic(p.cap, p.img, 'фото', 'contain'), 'stub-fill'));
        b.appendChild(el('div', 'prod-name', p.name));
        b.addEventListener('click', function () { resetIdle(); st.sel = p.key; rerender(); });
        grid.appendChild(b);
      });
      box.appendChild(grid);
    },

    /* --- экран 21: выбор страны и требования --- */
    countries: function (box, sc) {
      box.classList.add('is-widget');
      var row = el('div', 'ind-row');
      C.countries.forEach(function (c) {
        var b = el('button', 'ind' + (selKey() === c.key ? ' is-on' : ''), c.name);
        b.type = 'button';
        b.addEventListener('click', function () { resetIdle(); st.sel = c.key; rerender(); });
        row.appendChild(b);
      });
      box.appendChild(row);

      var cur2 = find(C.countries, selKey());
      var split = el('div', 'ctry-split');
      var card = el('div', 'st-card');
      card.appendChild(el('h3', 'st-card-t', 'Требования страны'));
      card.appendChild(el('div', 'hub-about-n', cur2.name));
      card.appendChild(el('p', 'st-card-p', cur2.text));
      card.appendChild(el('div', 'st-note', 'Точный перечень требований предоставит заказчик'));
      split.appendChild(card);
      var ph = el('div', 'ctry-pic');
      ph.appendChild(stub(sc.pic, 'stub-fill'));
      split.appendChild(ph);
      box.appendChild(split);
    }
  };

  /* =================================================================
     Действия кнопок (кнопка задаётся полем action в справочнике)
     ================================================================= */

  /** Демонстрационный расчёт дозы удобрений (экран 5). */
  function fillFert(node) {
    var plot = find(C.plots, st.plot || C.plots[0].key);
    var lv = st.level == null ? plot.value : st.level;
    var n = Math.round(120 - lv * 0.6);
    var p = Math.round(70 - lv * 0.35);
    var k = Math.round(90 - lv * 0.45);
    node.innerHTML = '';
    node.appendChild(el('div', 'fert-t', plot.name + ' · показатель ' + lv + ' %'));
    var rows = el('div', 'st-rows');
    [['Азот (N)', n + ' кг/га'], ['Фосфор (P)', p + ' кг/га'],
     ['Калий (K)', k + ' кг/га']].forEach(function (r) {
      var row = el('div', 'st-row');
      row.appendChild(el('span', 'k', r[0]));
      row.appendChild(el('span', 'v', r[1]));
      rows.appendChild(row);
    });
    node.appendChild(rows);
    node.appendChild(el('div', 'st-note',
      'Пример расчёта. Формулу и коэффициенты предоставит заказчик.'));
  }

  var ACTIONS = {
    calcFert: function () {
      var card = document.querySelector('[data-slot="fert"]');
      if (!card) return;
      var node = card.querySelector('.fert');
      if (!node) { node = el('div', 'fert'); card.appendChild(node); }
      st.fertEl = node;
      fillFert(node);
    },

    /** Экран 9: обзор с БПЛА подменяет кадр и подсвечивает все три сорняка. */
    droneScan: function () {
      if (st.droneEl) st.droneEl.classList.add('is-on');
      if (st.droneTag) st.droneTag.classList.add('is-on');
      if (!st.weedEls) return;
      st.weedEls.forEach(function (b, i) {
        st.found[i] = true;
        setTimeout(function () { b.classList.add('is-found'); }, i * 260);
      });
      setTimeout(function () { if (st.weedCount) st.weedCount(); }, 3 * 260);
    },

    /** Экраны 13 и 20: подсветить шаги по очереди. */
    playSteps: function () {
      if (!st.stepEls) return;
      st.stepEls.forEach(function (s) { s.classList.remove('is-on'); });
      st.stepEls.forEach(function (s, i) {
        setTimeout(function () {
          st.stepEls.forEach(function (x) { x.classList.remove('is-on'); });
          s.classList.add('is-on');
        }, i * 900);
      });
    },

    /** Экран 21: пакет сопроводительных документов. */
    showDocs: function () {
      var over = el('div', 'st-over');
      var panel = el('div', 'st-over-panel');
      panel.appendChild(el('h3', 'st-card-t', 'Пакет документов'));
      var grid = el('div', 'docs-grid');
      C.exportDocs.forEach(function (d, i) {
        var c = el('div', 'doc');
        // на первую карточку кладём снимок протоколов, остальные образцы
        // документов предоставит заказчик — там пока заглушки
        var img = i === 0 ? 'assets/photos/lab-reports.webp' : '';
        c.appendChild(stub(C.pic(d, img, 'документ', img ? 'contain' : ''), 'stub-fill'));
        c.appendChild(el('div', 'doc-name', d));
        grid.appendChild(c);
      });
      panel.appendChild(grid);
      panel.appendChild(el('div', 'st-note',
        'Образцы документов предоставит заказчик.'));
      panel.appendChild(button({ label: 'Закрыть', action: 'closeOver' },
        'st-btn is-primary st-card-btn'));
      over.appendChild(panel);
      over.addEventListener('click', function (e) { if (e.target === over) over.remove(); });
      $('view').appendChild(over);
      st.over = over;
    },

    closeOver: function () { if (st.over) { st.over.remove(); st.over = null; } }
  };

  /* Что доигрывает ?demo=1 на каждом экране — для снимков и показа. */
  var DEMOS = {
    'soil-1': function () { ACTIONS.calcFert(); },
    'seed-3': function () { ACTIONS.droneScan(); },
    'store-1': function () { ACTIONS.playSteps(); },
    'export-1': function () { ACTIONS.playSteps(); }
  };

  /* =================================================================
     Движок: переходы, история, адресная строка, аттрактор
     ================================================================= */

  function draw() {
    var view = $('view');
    view.className = '';
    view.innerHTML = '';
    view.setAttribute('data-screen', cur.id);
    var layout = cur.layout || 'station';
    if (layout === 'hero') renderHero(cur, view);
    else if (layout === 'hub') renderHub(cur, view);
    else renderStation(cur, view);
  }

  /** Перерисовать текущий экран без затухания (смена вкладки или выбора). */
  function rerender() { draw(); }

  function go(id, opts) {
    opts = opts || {};
    var scr = byId[id];
    if (!scr || busy) return;
    if (cur && cur.id === id && !opts.force) return;
    if (cur && !opts.reset) hist.push(cur.id);
    if (opts.reset) hist = [];
    swap(scr);
  }

  function back() {
    var id = hist.pop();
    if (!id || !byId[id]) { swap(byId[HOME]); return; }
    swap(byId[id]);
  }

  function swap(scr) {
    if (busy) return;
    busy = true;
    var view = $('view');
    view.classList.add('is-out');
    setTimeout(function () {
      cur = scr;
      st = {};
      draw();
      view.classList.add('is-out');      // draw() чистит классы, вернём затухание
      setUrl(scr.id);
      // проявление следующим тиком. Специально не requestAnimationFrame:
      // в свёрнутой вкладке кадры не идут, и экран завис бы в busy.
      setTimeout(function () {
        view.classList.remove('is-out');
        busy = false;
      }, 20);
    }, FADE);
  }

  function setUrl(id) {
    if (!global.history || !global.history.replaceState) return;
    try {
      global.history.replaceState(null, '', '?screen=' + encodeURIComponent(id));
    } catch (e) { /* file:// не разрешает replaceState — не беда */ }
  }

  /* --------------------------- аттрактор --------------------------- */

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    idleTimer = setTimeout(toAttractor, (CFG.attractorTimeoutSec || 90) * 1000);
  }

  function toAttractor() {
    resetIdle();
    if (cur && cur.id === HOME) return;
    hist = [];
    swap(byId[HOME]);
  }

  /* --------------------------- масштаб --------------------------- */

  function fitStage() {
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + s + ')';
  }

  /* ---------------------- зерно на фоне ---------------------- */

  function drawStars(colors) {
    var c = $('stars');
    if (!c) return;
    var dot = (colors && colors.stars) || '150,205,190';
    var glow = (colors && colors.starGlow) || '130,215,195';
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

  /* ------------------------------ старт ------------------------------ */

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

  function boot() {
    U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      CFG = cfg || CFG;
      var green = (CFG.themes && CFG.themes.green) || {};
      applyColors(green.colors);
      drawStars(green.colors);
    }).catch(function () {
      drawStars(null);
    }).then(function () {
      fitStage();
      global.addEventListener('resize', fitStage);
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });

      var q = parseQuery();
      if (q.idle === '0') idleOff = true;
      cur = byId[q.screen] || byId[HOME];
      st = {};
      // ?sel= и ?tab= открывают экран сразу в нужном состоянии,
      // ?demo=1 доигрывает интерактив (нашлись сорняки, посчиталась доза) —
      // это для снимков экрана и показа заказчику
      if (q.sel) st.sel = q.sel;
      if (q.tab) st.tab = q.tab;
      draw();
      if (q.demo === '1' && DEMOS[cur.id]) DEMOS[cur.id]();
      setUrl(cur.id);
      resetIdle();
      $('loading').classList.add('hidden');
    });
  }

  /* Для показа и отладки: StoryApp.go('product'), StoryApp.list() */
  global.StoryApp = {
    go: function (id) { go(id, { force: true }); },
    back: back,
    list: function () { return C.screens.map(function (s) { return s.id; }); },
    state: function () { return { screen: cur && cur.id, st: st, hist: hist.slice() }; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
