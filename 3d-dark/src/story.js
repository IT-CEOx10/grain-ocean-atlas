/* ===================================================================
   «Путь зерна» — сквозная презентация, каркас всех экранов.

   Одно приложение, экраны переключаются без перезагрузки страницы.
   Тексты и данные лежат отдельно, в src/story-content.js: чтобы
   поправить формулировку, сюда лезть не нужно.

   Что здесь:
     - движок: реестр экранов, переход с затуханием, история для «назад»;
     - раскладки — новый экран добавляется описанием в справочнике,
       а не вёрсткой:
         scene   основная по макетам «Design concept 17.09»: сцена во весь
                 экран, поверх неё плавающие панели, метки и навигация;
         intro   заставка: коллаж, заголовок, касание в любом месте;
         station, wide, hero — прежние раскладки. Они остались у экранов,
                 которые ещё не переверстаны под новый дизайн, и уйдут
                 по мере перевода экранов на scene;
     - интерактивы экранов (виджеты) — словарь WIDGETS;
     - заглушки изображений: пока путь к файлу пуст, рисуется рамка
       с подписью, что за кадр тут будет;
     - аттрактор: возврат на первый экран по таймауту из config.json;
     - адрес ?screen=<id> открывает нужный экран сразу.

   Раздел единого приложения app.html (обёртка #sec-story); та же логика
   работает и отдельной страницей story.html.

   Экраны глобуса (index.html) и Блока 3 (path.html) этот файл не трогает.
   =================================================================== */
(function (global) {
  'use strict';

  var C = global.StoryContent;
  // элементы ищем внутри обёртки раздела: в едином приложении рядом
  // лежат ещё глобус и мониторинг, а часть идентификаторов совпадает
  var ROOT = U.scope('story');
  var $ = U.byId('story');
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

  /**
   * Кнопка:
   *   to     — переход на экран презентации (или 'back');
   *   link   — уход в другой раздел стенда: 'globe' — экран глобуса
   *            «Маршруты экспорта». Адрес и затемнение — U.goSection;
   *   action — поведение самого экрана из словаря ACTIONS.
   */
  function button(b, cls) {
    var n = el('button', cls || 'st-btn', b.label);
    n.type = 'button';
    n.addEventListener('click', function () {
      resetIdle();
      if (b.to === 'back') back();
      else if (b.link) U.goSection(b.link, b.params);
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

  /* =================================================================
     Раскладка «scene» — макеты «Design concept 17.09»

     Экран описывается объектом в справочнике, здесь только сборка:

       scene:    { pic }                  картинка во весь экран
       shade:    'top' | 'bottom' | 'soft'  затемнение под текст
       eyebrow / title / sub              шапка слева сверху
       topRight: { label, to|link }       кнопка «В Центр» справа сверху
       left / right: { at, width, items } колонки плавающих панелей
       markers:  [{ key, n, label, x, y, to }]  метки на объектах сцены
       links:    ['M … L …']              линии между метками (SVG)
       tiles:    [{ name, sub, img, … }]  плитки переходов (экран меню)
       nav:      { back, next }           навигация снизу

     Элемент колонки — панель ({ title, text, rows, note }), кнопка
     ({ label, to|link|action, gold: true }) или блок, который движок
     собирает сам по выбору на экране ({ dyn: 'station' }).
     ================================================================= */

  /** Картинка-сцена во весь экран. */
  function sceneLayer(scr) {
    var p = sceneFor(scr).pic || null;
    var box = el('div', 'sc-scene' + (p && p.fit === 'contain' ? ' is-contain' : ''));
    if (p && p.img) {
      var im = new Image();
      im.src = U.asset(p.img);
      im.alt = p.cap || '';
      box.appendChild(im);
    }
    return box;
  }

  /** Шапка экрана: надзаголовок, заголовок, подзаголовок. */
  function headEl(scr) {
    var h = el('header', 'sc-head');
    if (scr.eyebrow) h.appendChild(el('div', 'sc-eyebrow', scr.eyebrow));
    if (scr.title) h.appendChild(el('h1', 'sc-title', scr.title));
    if (scr.sub) h.appendChild(el('div', 'sc-sub', scr.sub));
    return h;
  }

  /** Стеклянная панель: надпись, заголовок, текст, строки, пометка. */
  function panelEl(p) {
    var n = el('section', 'sc-panel' + (p.cls ? ' ' + p.cls : ''));
    if (p.cap) n.appendChild(el('div', 'sc-panel-cap', p.cap));
    if (p.title) n.appendChild(el('h3', 'sc-panel-t', p.title));
    if (p.sub) n.appendChild(el('div', 'sc-panel-sub', p.sub));
    if (p.text) n.appendChild(el('p', 'sc-panel-p', p.text));
    if (p.big) n.appendChild(el('div', 'sc-big', p.big));
    if (p.defs) {
      var df = el('div', 'sc-defs');
      p.defs.forEach(function (d) {
        var row = el('div', 'sc-def');
        row.appendChild(el('div', 'sc-def-k', d[0]));
        row.appendChild(el('div', 'sc-def-v', d[1]));
        df.appendChild(row);
      });
      n.appendChild(df);
    }
    if (p.leads) {
      p.leads.forEach(function (d) {
        var line = el('p', 'sc-lead');
        line.appendChild(el('b', null, d[0]));
        line.appendChild(document.createTextNode(' ' + d[1]));
        n.appendChild(line);
      });
    }
    if (p.grid) n.appendChild(gridEl(p.grid));
    if (p.slider) n.appendChild(sliderEl(SLIDERS[p.slider]()));
    if (p.gauge) n.appendChild(gaugeEl(GAUGES[p.gauge]()));
    if (p.rows) {
      var rt = el('div', 'sc-rows');
      p.rows.forEach(function (r, i) {
        var row = el('div', 'sc-row');
        row.appendChild(el('span', 'sc-row-n', String(i + 1)));
        row.appendChild(el('span', 'sc-row-k', r[0]));
        row.appendChild(el('span', 'sc-row-v', r[1]));
        rt.appendChild(row);
      });
      n.appendChild(rt);
    }
    if (p.note) n.appendChild(el('div', 'sc-note', p.note));
    return n;
  }

  /* =================================================================
     Общие детали новой раскладки

     Плитка-кнопка, ползунок, шкала показателя, плашка-статус,
     карточки-картинки, радио-метка. Все они собираются из описания
     в справочнике; ручной разметки в HTML нет нигде.
     ================================================================= */

  /* Иконки плиток — тонкие контуры, как в UI KIT. Рисуем сами:
     картинок под них дизайнеры не давали. */
  var ICONS = {
    flask: '<path d="M9.4 3h5.2"/><path d="M10.6 3v6.3l-5 9a2 2 0 0 0 1.8 3h9.2a2 2 0 0 0 1.8-3l-5-9V3"/>' +
           '<path d="M8.3 15.2h7.4"/>',
    fungus: '<path d="M3.8 11a8.2 8.2 0 0 1 16.4 0z"/><path d="M10.2 11v6.9a1.8 1.8 0 0 0 3.6 0V11"/>',
    drop: '<path d="M12 3.4c3.3 3.7 5.3 6.5 5.3 9.2a5.3 5.3 0 1 1-10.6 0c0-2.7 2-5.5 5.3-9.2z"/>',
    gene: '<circle cx="12" cy="12" r="8.4"/><path d="M9.2 7.4c0 4.6 5.6 4.6 5.6 9.2"/>' +
          '<path d="M14.8 7.4c0 4.6-5.6 4.6-5.6 9.2"/><path d="M9.7 10.2h4.6"/><path d="M9.7 13.8h4.6"/>',
    bug: '<path d="M8.1 9a3.9 3.9 0 0 1 7.8 0v3.3a3.9 3.9 0 0 1-7.8 0z"/><path d="M9.7 6.5 8.5 4.8"/>' +
         '<path d="M14.3 6.5 15.5 4.8"/><path d="M8.1 10.4H4.7"/><path d="M15.9 10.4h3.4"/>' +
         '<path d="M8.4 13.6 5.6 15.4"/><path d="M15.6 13.6l2.8 1.8"/><path d="M12 12.4v4.4"/>'
  };

  function iconEl(name) {
    var box = el('span', 'sc-pick-ico');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = ICONS[name] || '';
    box.appendChild(svg);
    return box;
  }

  /**
   * Сетка плиток-кнопок.
   *   src   имя списка в справочнике (C[src]);
   *   cols  сколько столбцов; gap — зазор, если он не 16;
   *   mid   подпись по центру, ico — с иконкой, tall — высокая плитка.
   * Плитка выбирается касанием, выбор живёт в st.sel.
   */
  function gridEl(g) {
    var box = el('div', 'sc-grid' + (g.mid ? ' is-mid' : '') +
      (g.ico ? ' is-ico' : '') + (g.tall ? ' is-tall' : ''));
    box.style.gridTemplateColumns = 'repeat(' + (g.cols || 3) + ', 1fr)';
    if (g.gap != null) box.style.gap = g.gap + 'px';
    (C[g.src] || []).forEach(function (it) {
      var b = el('button', 'sc-pick' + (selKey() === it.key ? ' is-on' : ''));
      b.type = 'button';
      if (it.span) b.style.gridColumn = '1 / -1';
      if (it.icon) b.appendChild(iconEl(it.icon));
      b.appendChild(el('span', null, it.name));
      b.addEventListener('click', function () {
        resetIdle();
        st.sel = it.key;
        if (PICKED[cur.id]) PICKED[cur.id]();
        rerender();
      });
      box.appendChild(b);
    });
    return box;
  }

  /**
   * Ползунок кита: подпись слева, единица справа, тонкая дорожка
   * с круглой ручкой, подписи «Минимум/Максимум» под ней.
   * Значение — доля 0…1; тянут за прозрачный системный ползунок.
   */
  var STEPS = 1000;

  function sliderEl(s) {
    var box = el('div', 'sc-slider');
    var top = el('div', 'sc-slider-top');
    top.appendChild(el('span', null, s.label));
    var unit = el('span', 'sc-slider-unit', s.unit);
    top.appendChild(unit);
    box.appendChild(top);

    var track = el('div', 'sc-track');
    track.appendChild(el('div', 'sc-rail'));
    var fill = el('div', 'sc-fill');
    var knob = el('div', 'sc-knob');
    track.appendChild(fill);
    track.appendChild(knob);
    var input = el('input', 'sc-range');
    input.type = 'range';
    input.min = 0;
    input.max = STEPS;
    input.step = 1;
    input.value = Math.round(s.value * STEPS);
    track.appendChild(input);
    box.appendChild(track);

    var ends = el('div', 'sc-ends');
    ends.appendChild(el('span', null, s.left || 'Минимум'));
    ends.appendChild(el('span', null, s.right || 'Максимум'));
    box.appendChild(ends);

    function put() {
      var p = input.value / STEPS * 100;
      fill.style.width = p + '%';
      knob.style.left = p + '%';
    }
    input.addEventListener('input', function () {
      resetIdle();
      put();
      var t = s.on && s.on(input.value / STEPS);
      if (t) unit.textContent = t;
    });
    put();
    return box;
  }

  /**
   * Шкала показателя: символ элемента крупно, рядом формула, под ними
   * дорожка — зелёная зона до норматива, красная за ним, ручка на
   * текущем значении.
   */
  function gaugeEl(g) {
    var box = el('div', 'sc-gauge' + (g.bad ? ' is-bad' : ''));
    var head = el('div', 'sc-gauge-head');
    head.appendChild(el('span', 'sc-gauge-sym', g.sym));
    head.appendChild(el('span', 'sc-gauge-f', g.formula));
    box.appendChild(head);

    var track = el('div', 'sc-track');
    var rail = el('div', 'sc-rail');
    var m = Math.round(g.mark * 100);
    rail.style.background = 'linear-gradient(90deg, var(--sc-ok) 0 ' + m +
      '%, var(--sc-bad) ' + m + '% 100%)';
    track.appendChild(rail);
    var knob = el('div', 'sc-knob');
    knob.style.left = Math.round(g.at * 100) + '%';
    track.appendChild(knob);
    box.appendChild(track);

    var ends = el('div', 'sc-ends');
    ends.appendChild(el('span', null, g.left));
    ends.appendChild(el('span', null, g.right));
    box.appendChild(ends);

    st.gauge = box;
    st.gaugeKnob = knob;
    return box;
  }

  /** Плашка-статус: зелёная — всё в норме, красноватая — превышение. */
  function statusEl(s) {
    var n = el('div', 'sc-status' + (s.bad ? ' is-bad' : ''));
    n.appendChild(el('span', 'sc-status-m', s.bad ? '!' : '✓'));
    n.appendChild(el('span', null, s.text));
    st.status = n;
    return n;
  }

  /** Карточки-картинки с галочкой у выбранной. */
  function picksEl(p) {
    var box = el('div', 'sc-cards2');
    (C[p.src] || []).forEach(function (it) {
      var on = selKey() === it.key;
      var b = el('button', 'sc-card2' + (on ? ' is-on' : ''));
      b.type = 'button';
      var ph = el('div', 'sc-card2-pic');
      var im = new Image();
      im.src = U.asset(it.img);
      im.alt = it.name;
      ph.appendChild(im);
      b.appendChild(ph);
      b.appendChild(el('div', 'sc-card2-name', it.label || it.name));
      if (on) b.appendChild(el('span', 'sc-card2-ok', '✓'));
      b.addEventListener('click', function () {
        resetIdle();
        st.sel = it.key;
        if (PICKED[cur.id]) PICKED[cur.id]();
        rerender();
      });
      box.appendChild(b);
    });
    return box;
  }

  /** Радио-метки прямо на объектах сцены (экран 8). */
  function radiosEl(scr, root) {
    scr.radios.forEach(function (r) {
      var b = el('button', 'sc-radio' + (selKey() === r.key ? ' is-on' : ''));
      b.type = 'button';
      b.style.left = r.x + 'px';
      b.style.top = r.y + 'px';
      b.appendChild(el('span', 'sc-radio-d'));
      b.appendChild(el('span', null, r.label));
      b.addEventListener('click', function () {
        resetIdle();
        st.sel = r.key;
        rerender();
      });
      root.appendChild(b);
    });
  }

  /** Картинка сцены, поставленная по координатам кадра. */
  function figsEl(scr, root) {
    scr.figs.forEach(function (f) {
      var n = el('div', 'sc-fig');
      n.style.left = f.at[0] + 'px';
      n.style.top = f.at[1] + 'px';
      n.style.width = f.at[2] + 'px';
      n.style.height = f.at[3] + 'px';
      var im = new Image();
      im.src = U.asset(f.img);
      im.alt = f.cap || '';
      n.appendChild(im);
      root.appendChild(n);
    });
  }

  /** Мелкие подписи прямо на сцене; count — счётчик найденных сорняков. */
  function capsEl(scr, root) {
    scr.caps.forEach(function (c) {
      var n = el('div', 'sc-cap' + (c.count ? ' sc-count' : ''), c.text || '');
      n.style.left = c.x + 'px';
      n.style.top = c.y + 'px';
      if (c.count) st.countEl = n;
      root.appendChild(n);
    });
  }

  /** Делитель на предметном снимке (две половины зерна). */
  function splitEl(scr, root) {
    var s = scr.split;
    var n = el('div', 'sc-split');
    n.style.left = s.x + 'px';
    n.style.top = s.y + 'px';
    n.style.height = s.h + 'px';
    n.appendChild(el('i', null, '◄ ►'));
    n.firstChild.style.top = s.knob + 'px';
    root.appendChild(n);
  }

  /**
   * Цели-сорняки поверх сцены. Пока не нашли — прозрачные, по касанию
   * появляется кольцо и подпись. Обзор с БПЛА подсвечивает все сразу.
   */
  function weedsEl(marks, root) {
    if (!st.found) st.found = {};
    st.weedEls = [];
    marks.forEach(function (m, i) {
      var b = el('button', 'sc-weed' + (st.found[i] ? ' is-found' : ''));
      b.type = 'button';
      b.style.left = m.x + 'px';
      b.style.top = m.y + 'px';
      b.appendChild(el('i'));
      b.appendChild(el('b', null, 'Сорняк'));
      b.addEventListener('click', function () {
        resetIdle();
        st.found[i] = true;
        b.classList.add('is-found');
        if (st.countEl) countWeeds(marks.length);
      });
      st.weedEls.push(b);
      root.appendChild(b);
    });
    if (st.countEl) countWeeds(marks.length);
  }

  function countWeeds(total) {
    var n = 0;
    for (var k in st.found) if (st.found[k]) n++;
    st.countEl.textContent = 'Найдено ' + n + ' из ' + total;
    st.countEl.classList.toggle('is-done', n === total);
  }

  /** Плавающие блоки по координатам кадра: панель, кнопки, сетка. */
  function boxesEl(scr, root) {
    scr.boxes.forEach(function (b) {
      var n = el('div', 'sc-box' + (b.row ? ' is-row' : ''));
      n.style.left = b.at[0] + 'px';
      n.style.top = b.at[1] + 'px';
      n.style.width = b.at[2] + 'px';
      if (b.at[3]) n.style.height = b.at[3] + 'px';
      if (b.gap != null) n.style.gap = b.gap + 'px';
      (b.items || []).forEach(function (item) { n.appendChild(slotEl(item)); });
      root.appendChild(n);
    });
  }

  /* Блоки, которые зависят от выбора на экране: тексты всё равно лежат
     в справочнике, здесь только сборка (как DYNAMIC для карточек). */
  var SLOTS = {
    /** Центр: панель «О станции» — про выбранную метку. */
    station: function () {
      var s = find(C.stations, selKey());
      return panelEl({ title: 'О станции', text: s.hint });
    },
    /** Центр: золотая кнопка «Начать с почвы →» / «Открыть станцию →». */
    stationBtn: function () {
      var s = find(C.stations, selKey());
      var first = C.stations[0];
      return button({ label: s.key === first.key ? 'Начать с почвы →' : 'Открыть станцию →',
        to: s.to }, 'sc-btn is-gold');
    },

    /* --- экран 5: плашка «превышения нет» / «превышение порога» --- */
    soilStatus: function () {
      var over = soilLevel() > C.soilMark;
      return statusEl({ bad: over, text: over ? C.soilStatus.bad : C.soilStatus.ok });
    },

    /* --- экран 6: доза удобрения --- */
    doseValue: function () {
      var f = find(C.fertilizers, selKey());
      return panelEl({ title: 'Доза удобрения', text: f.name,
        big: st.dose ? f.dose : 'формула' });
    },
    doseNote: function () {
      return panelEl({ text: st.dose ? f2(find(C.fertilizers, selKey())) : C.doseNote });
    },

    /* --- экран 7: панель слева с пояснением выбранного направления.
           В макете пояснений нет, но плитки должны на что-то отвечать:
           текст встаёт в ту же панель «Лабораторная проверка». --- */
    seedCheck: function () {
      var c = find(C.seedChecks, selKey());
      return panelEl({
        title: 'Лабораторная проверка',
        sub: 'Помогает убедиться в качестве\nпосевного материала',
        text: c.name + '. ' + c.text
      });
    },

    /* --- экран 8: карточка выбранной области поля --- */
    seedZone: function () {
      var z = find(C.seedZones, selKey());
      return panelEl({ title: z.title, text: z.text });
    },

    /* --- экран 11: карточка выбранного показателя --- */
    grainIndicator: function () {
      var i = find(C.grainIndicators, selKey());
      return panelEl({ title: i.name, text: i.text });
    },

    /* --- экран 9: две кнопки под подсказкой. Золотая — та, которой
           стоит воспользоваться дальше; вторая стеклянная. --- */
    weedBtnSelf: function () {
      var on = tabKey() === 'photo';
      return button({ label: on ? 'Смотрим' : 'Посмотреть самостоятельно',
        action: 'weedSelf' }, 'sc-btn' + (on ? '' : ' is-gold'));
    },
    weedBtnDrone: function () {
      var on = tabKey() === 'drone';
      return button({ label: on ? 'Дрон запущен' : 'Запустить обзор с БПЛА',
        action: 'weedDrone' }, 'sc-btn' + (tabKey() === 'photo' ? ' is-gold' : ''));
    }
  };

  function slotEl(item) {
    if (item.dyn) return SLOTS[item.dyn] ? SLOTS[item.dyn]() : el('div');
    if (item.label) return button(item, 'sc-btn' + (item.gold ? ' is-gold' : ''));
    if (item.picks) return picksEl(item.picks);
    if (item.grid && !item.title) return gridEl(item.grid);
    return panelEl(item);
  }

  /** Колонка панелей слева или справа; at: 'top' (по умолчанию) или 'bottom'. */
  function colEl(spec, side) {
    var box = el('div', 'sc-col is-' + side + ' is-' + (spec.at || 'top') +
      (spec.hasNav ? ' has-nav' : ''));
    if (spec.width) box.style.width = spec.width + 'px';
    if (spec.top) box.style.top = spec.top + 'px';
    if (spec.gap != null) box.style.gap = spec.gap + 'px';
    (spec.items || []).forEach(function (item) { box.appendChild(slotEl(item)); });
    return box;
  }

  /* ---------------- почва: элемент, концентрация, статус ----------------
     Концентрация хранится долей 0…1 от шкалы. Норматив стоит на отметке
     C.soilMark (0,7), поэтому «превышение» — это просто доля выше неё,
     а подпись в мг/кг считается из норматива элемента. Сами нормативы
     демонстрационные, см. справочник. */

  function soilLevel() {
    if (st.level == null) st.level = find(C.soilElements, selKey()).start;
    return st.level;
  }

  /** Значение в мг/кг для текущей доли шкалы. */
  function soilMg(e, part) {
    var v = part * e.limit / C.soilMark;
    return (e.limit < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + ' мг/кг';
  }

  /** Перерисовать только то, что зависит от ползунка: ручку и плашку. */
  function soilRefresh() {
    var over = st.level > C.soilMark;
    if (st.gaugeKnob) st.gaugeKnob.style.left = Math.round(st.level * 100) + '%';
    if (st.gauge) st.gauge.classList.toggle('is-bad', over);
    if (st.status) {
      st.status.className = 'sc-status' + (over ? ' is-bad' : '');
      st.status.innerHTML = '';
      st.status.appendChild(el('span', 'sc-status-m', over ? '!' : '✓'));
      st.status.appendChild(el('span', null, over ? C.soilStatus.bad : C.soilStatus.ok));
    }
  }

  /** Демонстрационный расчёт дозы: текст под крупным значением. */
  function f2(f) {
    return 'Демонстрационный расчёт: ' + f.dose + ' — ' + f.hint +
      '\nФормулу и коэффициенты предоставит заказчик.';
  }

  /* Ползунки экранов: имя из справочника → описание для sliderEl. */
  var SLIDERS = {
    soil: function () {
      var e = find(C.soilElements, selKey());
      var part = soilLevel();
      return {
        label: 'Содержание ' + e.gen,
        unit: soilMg(e, part),
        value: part,
        on: function (v) { st.level = v; soilRefresh(); return soilMg(e, v); }
      };
    }
  };

  /* Шкалы показателей. */
  var GAUGES = {
    soil: function () {
      var e = find(C.soilElements, selKey());
      var part = soilLevel();
      return { sym: e.sym, formula: 'C < T', at: part, mark: C.soilMark,
        bad: part > C.soilMark, left: 'Концентрация C', right: 'Норматив T' };
    }
  };

  /* Что сделать, когда на экране сменили выбор. */
  var PICKED = {
    // другой элемент — своя привычная концентрация
    'soil-1': function () { st.level = find(C.soilElements, st.sel).start; },
    // другое удобрение — расчёт нужно запустить заново
    'soil-2': function () { st.dose = null; }
  };

  /** Метки-чипы на объектах сцены. Координаты — в пикселях кадра 1920x1080. */
  function markersEl(scr, root) {
    scr.markers.forEach(function (m) {
      var b = el('button', 'sc-marker' + (selKey() === m.key ? ' is-on' : ''));
      b.type = 'button';
      b.style.left = m.x + 'px';
      b.style.top = m.y + 'px';
      if (m.n) b.appendChild(el('span', 'sc-marker-n', String(m.n)));
      b.appendChild(el('span', 'sc-marker-t', m.label));
      b.addEventListener('click', function () {
        resetIdle();
        // первое касание выбирает объект, повторное открывает станцию
        if (selKey() === m.key && m.to) go(m.to);
        else { st.sel = m.key; rerender(); }
      });
      root.appendChild(b);
    });
  }

  /** Линии между метками: готовые пути SVG в координатах кадра. */
  function linksEl(scr) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'sc-links');
    svg.setAttribute('viewBox', '0 0 1920 1080');
    scr.links.forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /** Плитки переходов в другие разделы стенда (экран меню). */
  function tilesEl(scr) {
    var box = el('div', 'sc-tiles');
    scr.tiles.forEach(function (t) {
      var b = el('button', 'sc-tile');
      b.type = 'button';
      var ph = el('div', 'sc-tile-pic');
      if (t.img) {
        var im = new Image();
        im.src = U.asset(t.img);
        im.alt = t.name;
        ph.appendChild(im);
      }
      b.appendChild(ph);
      var body = el('div', 'sc-tile-body');
      var txt = el('div', 'sc-tile-text');
      txt.appendChild(el('div', 'sc-tile-name', t.name));
      txt.appendChild(el('div', 'sc-tile-sub', t.sub || 'Узнайте больше'));
      body.appendChild(txt);
      body.appendChild(el('span', 'sc-tile-go', '→'));
      b.appendChild(body);
      b.addEventListener('click', function () {
        resetIdle();
        if (t.link) U.goSection(t.link, t.params);
        else if (t.to) go(t.to);
      });
      box.appendChild(b);
    });
    return box;
  }

  /** Навигация новой раскладки: «← Назад» слева, «Вперёд →» справа. */
  function navSceneEl(scr, root) {
    ['back', 'next'].forEach(function (slot) {
      var b = scr.nav && scr.nav[slot];
      if (!b) return;
      var cell = el('div', 'sc-nav-' + slot);
      cell.appendChild(button(b, 'sc-btn' + (b.gold ? ' is-gold' : '')));
      root.appendChild(cell);
    });
  }

  /** Экран по макетам: сцена во весь экран и плавающие панели поверх. */
  function renderSceneLayout(scr, root) {
    root.appendChild(sceneLayer(scr));
    if (scr.shade) {
      // затемнений может быть несколько: 'top bottom'
      root.appendChild(el('div', 'sc-shade is-' + scr.shade.split(' ').join(' is-')));
    }
    if (scr.figs) figsEl(scr, root);
    if (scr.split) splitEl(scr, root);
    if (scr.caps) capsEl(scr, root);
    if (scr.links) root.appendChild(linksEl(scr));
    if (scr.markers) markersEl(scr, root);
    if (scr.radios) radiosEl(scr, root);
    if (scr.weedsByTab && scr.weedsByTab[tabKey()]) weedsEl(scr.weedsByTab[tabKey()], root);
    if (scr.title || scr.eyebrow) root.appendChild(headEl(scr));
    if (scr.topRight) {
      var top = el('div', 'sc-top');
      top.appendChild(button(scr.topRight, 'sc-btn'));
      root.appendChild(top);
    }
    if (scr.left) root.appendChild(colEl(scr.left, 'left'));
    if (scr.right) root.appendChild(colEl(scr.right, 'right'));
    if (scr.boxes) boxesEl(scr, root);
    if (scr.tiles) root.appendChild(tilesEl(scr));
    if (scr.nav) navSceneEl(scr, root);
  }

  /** Заставка: коллаж, заголовок, подпись, касание в любом месте. */
  function renderIntro(scr, root) {
    var cover = el('div', 'sc-cover');
    if (scr.collage && scr.collage.img) {
      var box = el('div', 'sc-collage');
      var im = new Image();
      im.src = U.asset(scr.collage.img);
      im.alt = scr.collage.cap || '';
      box.appendChild(im);
      cover.appendChild(box);
    }
    cover.appendChild(el('h1', 'sc-cover-title', scr.title));
    if (scr.sub) cover.appendChild(el('div', 'sc-cover-hint', scr.sub));
    root.appendChild(cover);

    // слушатель висит на своём слое, а не на #view — иначе он пережил бы
    // смену экрана
    var tap = el('button', 'sc-tap');
    tap.type = 'button';
    tap.setAttribute('aria-label', scr.sub || 'Дальше');
    tap.addEventListener('click', function () { resetIdle(); go(scr.tapTo); });
    root.appendChild(tap);
  }

  /* =================================================================
     Интерактивы экранов
     ================================================================= */

  var WIDGETS = {

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

  var ACTIONS = {

    /** Экран 6: показать демонстрационный расчёт дозы удобрений. */
    calcDose: function () { st.dose = true; rerender(); },

    /** Экран 9: переключение «поле сверху → фотография поля». */
    weedSelf: function () {
      st.tab = tabKey() === 'photo' ? 'iso' : 'photo';
      rerender();
    },

    /** Экран 9: обзор с БПЛА — свой кадр, все сорняки подсвечены. */
    weedDrone: function () {
      if (tabKey() === 'drone') { st.tab = 'iso'; rerender(); return; }
      st.tab = 'drone';
      st.found = { 0: true, 1: true, 2: true };
      rerender();
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
    'soil-2': function () { ACTIONS.calcDose(); },
    'seed-3': function () { ACTIONS.weedDrone(); },
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
    view.setAttribute('data-layout', layout);
    if (layout === 'scene') renderSceneLayout(cur, view);
    else if (layout === 'intro') renderIntro(cur, view);
    else if (layout === 'hero') renderHero(cur, view);
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
    if (global.Shell) { global.Shell.url('story', { screen: id }); return; }
    if (!global.history || !global.history.replaceState) return;
    try {
      global.history.replaceState(null, '', '?screen=' + encodeURIComponent(id));
    } catch (e) { /* file:// не разрешает replaceState — не беда */ }
  }

  /* --------------------------- аттрактор --------------------------- */

  /* В едином приложении таймер бездействия один на все разделы и живёт
     в src/shell.js — здесь мы только сообщаем ему, что был отклик. */

  function resetIdle() {
    if (global.Shell) { global.Shell.ping(); return; }
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

  /** Аттрактор оболочки: вернуться на заставку без затухания раздела. */
  function reset() {
    hist = [];
    if (cur && cur.id === HOME) return;
    openScreen(HOME);
  }

  /** Показать экран сразу, без затухания: так входят в раздел из меню. */
  function openScreen(id) {
    var scr = byId[id];
    if (!scr || (cur && cur.id === id)) return;
    hist = [];
    cur = scr;
    st = {};
    draw();
    setUrl(scr.id);
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

  function boot() {
    return U.loadJSON('inline-config', 'config.json').then(function (cfg) {
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

      var q = U.query('story');
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
      U.revealPage();
      if (global.Shell) global.Shell.ready('story');
    });
  }

  /* Для показа и отладки: StoryApp.go('product'), StoryApp.list() */
  global.StoryApp = {
    go: function (id) { go(id, { force: true }); },
    back: back,
    list: function () { return C.screens.map(function (s) { return s.id; }); },
    state: function () { return { screen: cur && cur.id, st: st, hist: hist.slice() }; }
  };

  /* Раздел единого приложения (app.html) или отдельная страница story.html */
  if (global.Shell) {
    global.Shell.register('story', {
      boot: boot,
      show: function (p) {
        fitStage();
        if (p && p.screen) openScreen(p.screen);
        else setUrl(cur ? cur.id : HOME);
      },
      hide: function () { ACTIONS.closeOver(); },
      reset: reset
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
