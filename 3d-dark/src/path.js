/* ===================================================================
   Блок 3, экран 1 — «Центр управления производства зерна».

   Отдельный экран (path.html), с экраном глобуса кода не делит:
   общие у них только util.js, переменные темы из styles/app.css
   и настройки из config.json.

   Что здесь есть:
     - шесть изометрических плиток (assets/tiles/web/*.webp) в кресте
       вокруг центральной «Зерно»;
     - светящиеся связи с искрами — рисуются на холсте, а не вшиты
       в картинки, поэтому их можно подсвечивать и двигать;
     - карточка направления, поиск по продуктам, обход направлений
       кнопкой «Пройти путь»;
     - псевдо-объём: сцена слегка наклоняется за пальцем;
     - аттрактор: возврат в исходный вид по таймауту из config.json.
   =================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------- геометрия сцены -------------------------
     Координаты в системе 1920x1080; x, y — центр плитки, s — сторона.
     depth — насколько сильно плитка реагирует на псевдо-объём
     (центр почти неподвижен, крайние плитки ходят заметнее). */

  var CENTER = {
    key: 'wheat', title: 'Зерно',
    img: 'assets/tiles/web/01-wheat.webp',
    x: 960, y: 455, s: 380, depth: 0.30
  };

  var LAB = {
    key: 'lab', title: 'ЦОК АПК',
    img: 'assets/tiles/web/06-laboratory.webp',
    x: 960, y: 838, s: 216, depth: 0.65
  };

  /* Четыре направления. words — слова, по которым срабатывает поиск. */
  var WAYS = [
    {
      key: 'bread', side: 'left',
      img: 'assets/tiles/web/02-bread.webp',
      x: 570, y: 320, s: 280, depth: 1.0, markY: 320,
      title: 'Хлеб и мука', sub: 'продовольствие',
      text: 'Самый массовый путь зерна: помол в муку и выпечка. ЦОК АПК ' +
            'проверяет партии по зольности, белизне и клейковине, а качество ' +
            'муки подтверждает пробной выпечкой. Так на прилавок попадает ' +
            'предсказуемый по свойствам продукт.',
      words: 'хлеб мука выпечка помол булка пекарня продовольствие еда'
    },
    {
      key: 'feed', side: 'right',
      img: 'assets/tiles/web/03-silo-feed.webp',
      x: 1350, y: 320, s: 280, depth: 1.0, markY: 320,
      title: 'Корма', sub: 'животноводство',
      text: 'Фуражное зерно и комбикорма кормят птицу, свиней и молочный скот. ' +
            'Лаборатории ЦОК АПК считают протеин и клетчатку, ищут микотоксины ' +
            'и следы вредителей. Безопасный корм — это привесы на ферме ' +
            'и чистое молоко на столе.',
      words: 'корм комбикорм фураж животные животноводство скот птица силос'
    },
    {
      key: 'starch', side: 'left',
      img: 'assets/tiles/web/04-starch.webp',
      x: 570, y: 690, s: 280, depth: 1.0, markY: 660,
      title: 'Крахмал и химия', sub: 'промышленность',
      text: 'Глубокая переработка превращает зерно в крахмал, патоку, глютен ' +
            'и спирты для пищевой и химической промышленности. ЦОК АПК ' +
            'контролирует чистоту и влажность сырья, проверяет его на ГМО ' +
            'и остатки пестицидов — от этого зависит выход продукта на заводе.',
      words: 'крахмал химия патока глютен промышленность переработка сырьё'
    },
    {
      key: 'biofuel', side: 'right',
      img: 'assets/tiles/web/05-biofuel.webp',
      x: 1350, y: 690, s: 280, depth: 1.0, markY: 660,
      title: 'Биотопливо', sub: 'энергетика',
      text: 'Зерно с высоким содержанием крахмала идёт на биоэтанол и другие ' +
            'виды биотоплива. ЦОК АПК измеряет крахмал, влажность и зольность: ' +
            'от них напрямую зависит выход спирта с тонны. Партии ' +
            'с отклонениями отсекаются ещё до отгрузки на завод.',
      words: 'биотопливо этанол биоэтанол энергия энергетика топливо спирт'
    }
  ];

  var NODES = [CENTER].concat(WAYS, [LAB]);
  var byKey = {};

  /* Связи: все идут из центра. Точка привязки лежит не в центре
     картинки, а на постаменте — он нарисован ниже середины кадра. */
  var ANCHOR_DY = 0.18;      // доля стороны: насколько ниже центра
  var GAP_FROM = 0.33;       // отступ линии от центра плитки-источника
  var GAP_TO = 0.34;         // и от плитки-получателя

  var LINKS = [
    { from: 'wheat', to: 'bread' },
    { from: 'wheat', to: 'feed' },
    { from: 'wheat', to: 'starch' },
    { from: 'wheat', to: 'biofuel' },
    // Вниз к ЦОК АПК расстояние меньше, и стрелка по общим отступам
    // упиралась бы в само здание. Поэтому связь обрывается над плиткой.
    { from: 'wheat', to: 'lab', gapFrom: 0.30, gapTo: 0.73 }
  ];

  var GOLD = '226,196,128';

  /* ------------------------------ состояние ------------------------------ */

  var CFG = { attractorTimeoutSec: 90 };
  var openKey = null;                  // какая карточка раскрыта
  var idleTimer = null;
  var idleOff = false;                 // ?idle=0 — для снимков и отладки
  var reduced = false;                 // prefers-reduced-motion
  var ctx = null, dpr = 1;
  var pointer = { tx: 0, ty: 0, x: 0, y: 0 };   // цель и текущее сглаженное

  /* --------------------------- масштаб под окно --------------------------- */

  function fitStage() {
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + s + ')';
  }

  /* ------------------------------ сборка ------------------------------ */

  function buildScene() {
    var scene = $('scene');
    var marks = $('marks');

    NODES.forEach(function (n) {
      byKey[n.key] = n;
      n.lift = 0;                      // текущий подъём плитки, 0..1
      n.liftTo = 0;

      var el = U.el('div', 'tile');
      el.style.setProperty('--x', n.x + 'px');
      el.style.setProperty('--y', n.y + 'px');
      el.style.setProperty('--s', n.s + 'px');
      var img = new Image();
      img.src = U.asset(n.img);
      img.alt = n.title;
      el.appendChild(img);

      if (n === CENTER) {
        el.appendChild(U.el('div', 'tile-cap', n.title));
      }
      if (n.sub) {
        el.addEventListener('click', function () { toggleCard(n.key); });
      }
      n.el = el;
      scene.appendChild(el);
    });

    WAYS.forEach(function (n) {
      var mark = U.el('div', 'mark mark-' + n.side);
      mark.style.top = (n.markY - 36) + 'px';

      var pill = U.el('button', 'mark-pill');
      pill.type = 'button';
      var txt = U.el('div', 'txt');
      txt.appendChild(U.el('span', 't', n.title));
      txt.appendChild(U.el('span', 's', n.sub));
      pill.appendChild(txt);
      pill.appendChild(U.el('span', 'go', '›'));
      pill.addEventListener('click', function () { toggleCard(n.key); });
      mark.appendChild(pill);

      var card = U.el('div', 'mark-card');
      card.appendChild(U.el('div', 'mc-t', n.title));
      card.appendChild(U.el('div', 'mc-s', n.sub));
      card.appendChild(U.el('div', 'mc-x'));
      card.appendChild(U.el('div', 'mc-p', n.text));
      var x = U.el('button', 'mc-close', '✕');
      x.type = 'button';
      x.addEventListener('click', function (e) { e.stopPropagation(); closeCard(); });
      card.appendChild(x);
      mark.appendChild(card);

      n.mark = mark;
      marks.appendChild(mark);
    });
  }

  /* --------------------------- карточка направления --------------------------- */

  function openCard(key) {
    openKey = key;
    NODES.forEach(function (n) {
      var on = n.key === key;
      n.liftTo = on ? 1 : 0;
      n.el.classList.toggle('is-active', on);
      if (n.mark) n.mark.classList.toggle('is-open', on);
    });
  }

  function closeCard() {
    openKey = null;
    NODES.forEach(function (n) {
      n.liftTo = 0;
      n.el.classList.remove('is-active');
      if (n.mark) n.mark.classList.remove('is-open');
    });
  }

  function toggleCard(key) {
    resetIdle();
    stopTour();                        // ручное касание прерывает обход
    if (openKey === key) closeCard(); else openCard(key);
  }

  /* ------------------------------ поиск ------------------------------ */

  function applySearch() {
    var q = $('search').value.trim().toLowerCase();
    var hits = q ? WAYS.filter(function (n) {
      return (n.title + ' ' + n.sub + ' ' + n.words).toLowerCase().indexOf(q) >= 0;
    }) : [];

    NODES.forEach(function (n) {
      var hit = q && hits.indexOf(n) >= 0;
      var dim = q && !hit && n !== CENTER;
      n.el.classList.toggle('is-hit', !!hit);
      n.el.classList.toggle('is-dim', !!dim);
      if (n.mark) {
        n.mark.classList.toggle('is-hit', !!hit);
        n.mark.classList.toggle('is-dim', !!dim);
      }
    });
    return hits;
  }

  function searchGo() {
    resetIdle();
    var hits = applySearch();
    if (hits.length) { stopTour(); openCard(hits[0].key); }
  }

  function clearSearch() {
    $('search').value = '';
    applySearch();
  }

  /* --------------------------- обход направлений ---------------------------
     ВРЕМЕННОЕ ПОВЕДЕНИЕ. По сценарию кнопка «Пройти путь» должна уводить
     на следующий экран блока 3 — схему станций. Экрана ещё нет, поэтому
     кнопка запускает обход четырёх направлений прямо здесь: по очереди
     подсвечивает плитку и открывает её карточку. Когда схема станций
     появится, здесь останется переход на неё, а обход можно удалить.  */

  var TOUR_STEP_MS = 4000;
  var tour = { on: false, i: 0, timer: null };

  function tourShow() {
    var n = WAYS[(tour.i % WAYS.length + WAYS.length) % WAYS.length];
    openCard(n.key);
  }

  function tourSchedule() {
    if (tour.timer) clearTimeout(tour.timer);
    tour.timer = setTimeout(function () {
      tour.i += 1;
      tourShow();
      tourSchedule();
    }, TOUR_STEP_MS);
  }

  function startTour() {
    tour.on = true;
    tour.i = 0;
    document.body.classList.add('is-tour');
    $('tour-prev').classList.remove('hidden');
    $('tour-next').classList.remove('hidden');
    var b = $('tour-btn');
    b.classList.add('is-stop');
    b.firstChild.textContent = 'Стоп';
    clearSearch();
    tourShow();
    tourSchedule();
  }

  function stopTour(keepCard) {
    if (!tour.on) return;
    tour.on = false;
    if (tour.timer) clearTimeout(tour.timer);
    tour.timer = null;
    document.body.classList.remove('is-tour');
    $('tour-prev').classList.add('hidden');
    $('tour-next').classList.add('hidden');
    var b = $('tour-btn');
    b.classList.remove('is-stop');
    b.firstChild.textContent = 'Пройти путь';
    if (!keepCard) closeCard();
  }

  function tourStep(d) {
    resetIdle();
    if (!tour.on) return;
    tour.i += d;
    tourShow();
    tourSchedule();
  }

  /* ------------------------------ аттрактор ------------------------------ */

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    idleTimer = setTimeout(toAttractor, (CFG.attractorTimeoutSec || 90) * 1000);
  }

  /** Возврат в исходный вид: карточки закрыты, поиск пуст, обход остановлен. */
  function toAttractor() {
    stopTour();
    closeCard();
    clearSearch();
    resetIdle();
  }

  /* --------------------------- псевдо-объём --------------------------- */

  function onPointer(e) {
    if (reduced) return;
    var w = global.innerWidth || 1920, h = global.innerHeight || 1080;
    pointer.tx = U.clamp((e.clientX / w - 0.5) * 2, -1, 1);
    pointer.ty = U.clamp((e.clientY / h - 0.5) * 2, -1, 1);
  }

  var TILT = 2.2;        // градусы наклона сцены
  var SHIFT = 16;        // пиксели сдвига крайней плитки
  var LIFT_PX = 18;      // на сколько поднимается выбранная плитка

  /* ------------------------------ связи ------------------------------ */

  function sizeCanvas() {
    var c = $('links');
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    c.width = Math.round(1920 * dpr);
    c.height = Math.round(1080 * dpr);
    ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Текущая точка привязки плитки с учётом сдвига и подъёма. */
  function anchor(n) {
    return {
      x: n.x + n.dx,
      y: n.y + n.dy + n.s * ANCHOR_DY - n.lift * LIFT_PX
    };
  }

  function drawArrow(x, y, ux, uy, size, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, size * 0.46);
    ctx.lineTo(-size * 0.72, 0);
    ctx.lineTo(-size, -size * 0.46);
    ctx.closePath();
    ctx.fillStyle = 'rgba(' + GOLD + ',' + alpha.toFixed(3) + ')';
    ctx.fill();
    ctx.restore();
  }

  function drawLinks(t) {
    ctx.clearRect(0, 0, 1920, 1080);
    ctx.lineCap = 'round';

    LINKS.forEach(function (L, i) {
      var a = byKey[L.from], b = byKey[L.to];
      var p = anchor(a), q = anchor(b);
      var vx = q.x - p.x, vy = q.y - p.y;
      var len = Math.sqrt(vx * vx + vy * vy) || 1;
      var ux = vx / len, uy = vy / len;

      var gf = L.gapFrom != null ? L.gapFrom : GAP_FROM;
      var gt = L.gapTo != null ? L.gapTo : GAP_TO;
      var x1 = p.x + ux * a.s * gf, y1 = p.y + uy * a.s * gf;
      var x2 = q.x - ux * b.s * gt, y2 = q.y - uy * b.s * gt;

      var hot = openKey === b.key || b.el.classList.contains('is-hit');
      var dim = b.el.classList.contains('is-dim');
      var k = hot ? 1 : (dim ? 0.30 : 0.80);      // общая яркость связи

      // ореол
      ctx.strokeStyle = 'rgba(' + GOLD + ',' + (0.14 * k).toFixed(3) + ')';
      ctx.lineWidth = hot ? 16 : 11;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      // сердцевина: от центра к плитке разгорается
      var g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, 'rgba(' + GOLD + ',' + (0.45 * k).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + GOLD + ',' + (1.00 * k).toFixed(3) + ')');
      ctx.strokeStyle = g;
      ctx.shadowColor = 'rgba(' + GOLD + ',' + (0.55 * k).toFixed(3) + ')';
      ctx.shadowBlur = hot ? 14 : 9;
      ctx.lineWidth = hot ? 3.6 : 2.6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.shadowBlur = 0;

      drawArrow(x2, y2, ux, uy, hot ? 17 : 14, 1.0 * k);

      // искры бегут от центра наружу, как по маршрутам на глобусе
      var n = hot ? 3 : 2;
      var speed = hot ? 0.34 : 0.22;
      for (var s = 0; s < n; s++) {
        var f = ((t * speed + i * 0.37 + s / n) % 1);
        var sx = x1 + (x2 - x1) * f, sy = y1 + (y2 - y1) * f;
        var fade = Math.sin(Math.PI * f);
        var rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, hot ? 11 : 8);
        rg.addColorStop(0, 'rgba(255,240,205,' + (0.95 * fade * k).toFixed(3) + ')');
        rg.addColorStop(0.35, 'rgba(' + GOLD + ',' + (0.45 * fade * k).toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(' + GOLD + ',0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(sx, sy, hot ? 11 : 8, 0, 6.283); ctx.fill();
      }
    });
  }

  /* ------------------------------ кадр ------------------------------ */

  var frames = 0, fpsAt = 0, fps = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    step(now);
    frames++;
    if (now - fpsAt > 1000) { fps = frames * 1000 / (now - fpsAt); frames = 0; fpsAt = now; }
  }

  function step(now) {
    var t = now / 1000;

    // сглаживание движения пальца
    pointer.x += (pointer.tx - pointer.x) * 0.08;
    pointer.y += (pointer.ty - pointer.y) * 0.08;

    if (!reduced) {
      $('scene').style.transform = 'perspective(1600px) rotateX(' +
        (-pointer.y * 1.4).toFixed(3) + 'deg) rotateY(' +
        (pointer.x * TILT).toFixed(3) + 'deg)';
    }

    NODES.forEach(function (n) {
      n.lift += (n.liftTo - n.lift) * 0.14;
      n.dx = reduced ? 0 : -pointer.x * SHIFT * n.depth;
      n.dy = reduced ? 0 : -pointer.y * SHIFT * 0.7 * n.depth;
      var y = n.dy - n.lift * LIFT_PX;
      n.el.style.transform = 'translate3d(' + n.dx.toFixed(2) + 'px,' +
        y.toFixed(2) + 'px,0)';
    });

    drawLinks(t);
  }

  /* ------------------------- зерно на фоне -------------------------
     Тот же приём, что на экране глобуса (src/ui.js, drawStars):
     мелкая крупа и десяток мягких пятен цветами темы. */

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

  /** Параметры адреса — для снимков экрана и показа: ?open=bread, ?q=мука, ?idle=0 */
  function applyUrlParams() {
    var q = parseQuery();
    if (q.idle === '0') idleOff = true;
    if (q.q) { $('search').value = q.q; applySearch(); }
    if (q.open && byKey[q.open]) openCard(q.open);
    if (q.tour === '1') startTour();
  }

  function boot() {
    reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

    U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      CFG = cfg || CFG;
      var green = (CFG.themes && CFG.themes.green) || {};
      applyColors(green.colors);
      drawStars(green.colors);
    }).catch(function () {
      drawStars(null);                 // без конфига экран всё равно работает
    }).then(function () {
      buildScene();
      sizeCanvas();
      fitStage();

      $('search').addEventListener('input', function () { resetIdle(); stopTour(); applySearch(); });
      $('search').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') searchGo();
      });
      $('search-go').addEventListener('click', searchGo);
      $('globe-btn').addEventListener('click', function () { resetIdle(); toAttractor(); });

      $('tour-btn').addEventListener('click', function () {
        resetIdle();
        if (tour.on) stopTour(); else startTour();
      });
      $('tour-prev').addEventListener('click', function () { tourStep(-1); });
      $('tour-next').addEventListener('click', function () { tourStep(1); });

      document.addEventListener('pointermove', onPointer, { passive: true });
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
      });
      global.addEventListener('resize', function () { fitStage(); sizeCanvas(); });

      applyUrlParams();
      resetIdle();
      $('loading').classList.add('hidden');
      requestAnimationFrame(frame);
    });
  }

  /** Цвета темы из config.json — те же переменные, что и на экране глобуса. */
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

  // для отладки: PathScreen.stats() покажет кадры в секунду
  global.PathScreen = {
    stats: function () { return { fps: Math.round(fps), dpr: dpr, open: openKey, tour: tour.on }; },
    // сколько миллисекунд занимает подготовка кадра (связи, искры, сдвиги
    // плиток). На кадр при 60 fps есть 16,7 мс, из них это — доля скрипта.
    bench: function (n) {
      n = n || 200;
      var t0 = performance.now();
      for (var i = 0; i < n; i++) step(t0 + i * 16.7);
      return { ms: +((performance.now() - t0) / n).toFixed(3), frames: n, dpr: dpr };
    },
    open: openCard,
    close: closeCard
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
