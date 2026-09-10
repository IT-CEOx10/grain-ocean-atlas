/* ===================================================================
   Оболочка единого приложения (app.html).

   На стенде все разделы живут в одном документе: презентация «Путь
   зерна», глобус «Страны назначения» и карта «Госмониторинг пшеницы РФ».
   Раньше это были три страницы, и каждый переход заново читал файл на
   5–7 МБ и заново поднимал сцену three.js. Теперь документ один, а
   разделы — три обёртки в нём:

     #sec-story        презентация
     #sec-globe        глобус
     #sec-monitoring   мониторинг

   Что делает эта оболочка:

     - создаёт разделы по одному разу. Тот, с которого начинается показ,
       готовится первым; остальные — в фоне, после первой отрисовки,
       чтобы заставка появлялась сразу, а первый переход был уже быстрым;
     - переключает разделы шторой #page-fade, без смены адреса;
     - останавливает отрисовку у скрытого раздела (глобус перестаёт
       крутить сцену, карта — свой цикл) и возобновляет при возврате;
     - ведёт один общий аттрактор: по таймауту из config.json стенд
       возвращается на заставку презентации, а разделы сбрасывают
       состояние — но не пересоздаются;
     - держит адрес в порядке для отладки и показа:
       ?section=story|globe|monitoring, плюс параметры самого раздела.

   Раздел подключается вызовом Shell.register — см. README, раздел
   «Единое приложение».
   =================================================================== */
(function (global) {
  'use strict';

  var FADE = 340;                       // столько же стоит в CSS у #page-fade
  var ORDER = ['story', 'globe', 'monitoring'];
  var DEFAULT = 'story';

  var secs = {};                        // имя -> запись раздела
  var curName = null;
  var busy = false;
  var CFG = { attractorTimeoutSec: 90 };
  var idleTimer = null, idleOff = false;
  var Q = U.parseQuery();
  var marks = [];

  /**
   * Отметка времени, миллисекунды от начала загрузки страницы.
   * Смотреть через Shell.perf() — так меряется время до заставки
   * и до готовности каждого раздела.
   */
  function mark(name) {
    var t = (global.performance && performance.now) ? performance.now() : 0;
    marks.push({ name: name, t: Math.round(t * 10) / 10 });
    return marks[marks.length - 1];
  }

  /* ------------------------------ реестр ------------------------------ */

  /**
   * api = {
   *   boot(active)  создать раздел, вернуть Promise; active — показан ли сразу
   *   show(params)  раздел стал видимым (params — из адреса или из кнопки)
   *   hide()        раздел скрыт: остановить отрисовку
   *   reset()       аттрактор: сбросить состояние, не пересоздавая раздел
   * }
   */
  function register(name, api) {
    secs[name] = {
      name: name,
      api: api,
      root: document.getElementById('sec-' + name),
      booted: false,
      ready: false,
      want: null                        // show(), отложенный до готовности
    };
  }

  function curtain() { return document.getElementById('page-fade'); }

  /* --------------------------- параметры адреса --------------------------- */

  /**
   * Параметры достаются только тому разделу, который открыт из адреса:
   * иначе ?year=2021 разобрали бы и глобус, и мониторинг, а ?zoom=
   * подвинул бы сразу и камеру, и карту России.
   */
  function paramsFor(name) {
    var out = {};
    if (Q.idle != null) out.idle = Q.idle;
    var want = Q.section || DEFAULT;
    if (want !== name) {
      // глобус в едином приложении всегда зелёный: синий прототип —
      // это отдельная страница index.html?theme=navy
      if (name === 'globe') out.theme = 'green';
      return out;
    }
    for (var k in Q) {
      if (Object.prototype.hasOwnProperty.call(Q, k) && k !== 'section') out[k] = Q[k];
    }
    if (name === 'globe' && !out.theme) out.theme = 'green';
    return out;
  }

  /** Адрес: ?section=<раздел> плюс то, что попросил сам раздел. */
  var urlExtra = {};

  function setUrl(name, params) {
    if (name && name !== curName) return;          // фоновый раздел адрес не трогает
    if (params) urlExtra = params;
    if (!global.history || !global.history.replaceState) return;
    var q = ['section=' + encodeURIComponent(curName || DEFAULT)];
    for (var k in urlExtra) {
      if (Object.prototype.hasOwnProperty.call(urlExtra, k) && urlExtra[k] != null) {
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(urlExtra[k]));
      }
    }
    if (idleOff) q.push('idle=0');
    try {
      global.history.replaceState(null, '', '?' + q.join('&'));
    } catch (e) { /* file:// не разрешает replaceState — не беда */ }
  }

  /* --------------------------- переключение --------------------------- */

  function reveal(s, params) {
    s.root.classList.add('is-on');
    if (s.ready) {
      if (s.api.show) s.api.show(params || {});
    } else {
      s.want = params || {};             // раздел ещё готовится: покажем, как будет готов
    }
  }

  function go(name, params) {
    var s = secs[name];
    if (!s) return;
    params = params || {};

    if (name === curName) {              // уже здесь — только довести до нужного экрана
      if (s.ready && s.api.show) s.api.show(params);
      else s.want = params;
      return;
    }
    if (busy) return;
    busy = true;

    var c = curtain();
    if (c) c.classList.add('is-on');
    mark('go:' + name);

    setTimeout(function () {
      var old = curName && secs[curName];
      if (old) {
        old.root.classList.remove('is-on');
        if (old.ready && old.api.hide) old.api.hide();
      }
      curName = name;
      urlExtra = {};
      reveal(s, params);
      setUrl(name);
      // проявление следующим тиком: браузеру нужно заметить смену класса
      setTimeout(function () {
        if (c) c.classList.remove('is-on');
        busy = false;
        mark('shown:' + name);
      }, 30);
    }, FADE);
  }

  /* ------------------------------ аттрактор ------------------------------ */

  function ping() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleOff) { idleTimer = null; return; }
    idleTimer = setTimeout(toAttractor, (CFG.attractorTimeoutSec || 90) * 1000);
  }

  function toAttractor() {
    ping();
    ORDER.forEach(function (n) {
      var s = secs[n];
      if (s && s.ready && s.api.reset) s.api.reset();
    });
    go(DEFAULT, { screen: 'intro', attractor: true });
  }

  /* ------------------------------ запуск ------------------------------ */

  /** Раздел доложил, что готов. */
  function ready(name) {
    var s = secs[name];
    if (!s || s.ready) return;
    s.ready = true;
    mark('ready:' + name);
    if (s.want) {
      var w = s.want;
      s.want = null;
      if (s.api.show) s.api.show(w);
    }
  }

  function bootOne(name, active) {
    var s = secs[name];
    if (!s || s.booted) return Promise.resolve();
    s.booted = true;
    mark('boot:' + name);
    var p;
    try {
      p = s.api.boot(active);
    } catch (e) {
      global.console && console.error('Раздел ' + name + ' не поднялся:', e);
      return Promise.resolve();
    }
    return Promise.resolve(p).catch(function (e) {
      global.console && console.error('Раздел ' + name + ' не поднялся:', e);
    });
  }

  /** Остальные разделы готовятся в фоне, по одному, после первой отрисовки. */
  function bootRest() {
    var rest = ORDER.filter(function (n) { return secs[n] && !secs[n].booted; });
    (function next() {
      // подготовка раздела занимает главный поток на пару сотен миллисекунд;
      // если сейчас идёт переход, подождём — иначе затемнение дёрнется
      if (busy) { setTimeout(next, 100); return; }
      var n = rest.shift();
      if (!n) { mark('all-ready'); return; }
      bootOne(n, false).then(function () { setTimeout(next, 60); });
    })();
  }

  function boot() {
    mark('dom');
    U.loadJSON('inline-config', 'config.json').then(function (cfg) {
      if (cfg) CFG = cfg;
    }).catch(function () { /* без конфига живём с таймаутом по умолчанию */ })
      .then(function () {
        if (Q.idle === '0') idleOff = true;

        var start = secs[Q.section] ? Q.section : DEFAULT;
        curName = start;
        secs[start].root.classList.add('is-on');

        bootOne(start, true).then(function () {
          var c = curtain();
          // если человек уже успел уйти в другой раздел, штору поднимет
          // сам переход — здесь её трогать нельзя
          if (c) setTimeout(function () { if (!busy) c.classList.remove('is-on'); }, 30);
          mark('first-paint');
          // тяжёлые разделы поднимаем после того, как заставка уже на экране
          if (global.requestAnimationFrame) {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () { setTimeout(bootRest, 120); });
            });
          } else {
            setTimeout(bootRest, 200);
          }
        });

        ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
          document.addEventListener(ev, ping, { passive: true });
        });
        ping();
      });
  }

  global.Shell = {
    register: register,
    ready: ready,
    go: go,
    ping: ping,
    /** Для отладки и автотестов: сыграть аттрактор, не выжидая таймаут. */
    attractor: toAttractor,
    paramsFor: paramsFor,
    url: setUrl,
    idleOff: function () { return idleOff; },
    section: function () { return curName; },
    isOn: function (name) { return curName === name; },
    state: function () {
      var out = {};
      ORDER.forEach(function (n) {
        if (secs[n]) out[n] = { booted: secs[n].booted, ready: secs[n].ready };
      });
      return { section: curName, sections: out };
    },
    perf: function () { return marks.slice(); },
    mark: mark
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
