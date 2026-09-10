/* Мелкие помощники: форматирование чисел, загрузка JSON, easing. */
(function (global) {
  'use strict';

  // Разделитель разрядов: неразрывный пробел.
  // U+2009 (тонкий) в системных шрифтах macOS/Linux рисуется шириной ~2 px
  // и на большом экране читается как отсутствие пробела.
  var THIN = '\u00A0';

  /** Число с тонким пробелом между разрядами. */
  function groupDigits(str) {
    var parts = String(str).split(',');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
    return parts.join(',');
  }

  /**
   * Объём в тыс. тонн: большие числа без дробной части,
   * маленькие — с одной десятичной.
   */
  function fmtVolume(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 100) return groupDigits(Math.round(v));
    if (v >= 0.05) return groupDigits(v.toFixed(1).replace('.', ','));
    return '<0,1';
  }

  function fmtInt(v) {
    return groupDigits(Math.round(v));
  }

  /** Первая буква заглавная (названия продуктов в исходнике со строчной). */
  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /**
   * Загрузка JSON: сперва ищем инлайн-блок <script type="application/json" id="...">
   * (так работает собранный dist/index.html), иначе — обычный fetch.
   *
   * Результат запоминается: в едином приложении (app.html) один и тот же
   * config.json спрашивают четыре модуля, и незачем читать его четыре раза.
   */
  var jsonCache = {};

  function loadJSON(inlineId, url) {
    var key = inlineId + '|' + url;
    if (jsonCache[key]) return jsonCache[key];
    var p;
    var node = document.getElementById(inlineId);
    if (node && node.textContent.trim()) {
      try {
        p = Promise.resolve(JSON.parse(node.textContent));
      } catch (e) {
        p = Promise.reject(new Error('Не разобрать инлайн-данные #' + inlineId + ': ' + e.message));
      }
    } else {
      p = fetch(url).then(function (r) {
        if (!r.ok) throw new Error('Не загрузить ' + url + ' (' + r.status + ')');
        return r.json();
      });
    }
    jsonCache[key] = p;
    return p;
  }

  /**
   * Путь к файлу из assets/. В собранном dist файлы вшиты как data:URI
   * и лежат в window.INLINE_ASSETS — тогда возвращаем их.
   */
  function asset(path) {
    var map = global.INLINE_ASSETS;
    return (map && map[path]) || path;
  }

  /** Расстояние по дуге большого круга, км. */
  function greatCircleKm(lat1, lon1, lat2, lon2) {
    var D = Math.PI / 180;
    var a = Math.sin(lat1 * D) * Math.sin(lat2 * D) +
            Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.cos((lon2 - lon1) * D);
    return 6371 * Math.acos(Math.max(-1, Math.min(1, a)));
  }

  /** Правильная форма слова по числу: 1 день, 2 дня, 5 дней. */
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ==================== разделы: обёртка и параметры ====================

     На стенде все разделы живут в одном документе app.html, каждый —
     внутри своей обёртки #sec-story / #sec-globe / #sec-monitoring.
     Отдельные страницы (story.html, index.html, monitoring.html) остались
     для отладки и содержат ту же обёртку, только одну. Поэтому модуль
     ищет свои элементы не по всему документу, а внутри своей обёртки:
     идентификаторы у разделов местами совпадают (#stage, #search, #years).

     U.scope('globe') отдаёт эту обёртку, U.byId — функцию поиска в ней. */

  function scope(name) {
    return document.getElementById('sec-' + name) || document.body;
  }

  /** Функция поиска элемента внутри обёртки раздела: var $ = U.byId('globe'). */
  function byId(name) {
    var root = scope(name);
    return function (id) { return root.querySelector('[id="' + id + '"]'); };
  }

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
   * Параметры адреса для раздела. В едином приложении их раздаёт Shell:
   * ?year=2021 достаётся тому разделу, который назван в ?section=,
   * иначе глобус и мониторинг разобрали бы один и тот же параметр.
   */
  function query(name) {
    if (global.Shell && global.Shell.paramsFor) return global.Shell.paramsFor(name);
    return parseQuery();
  }

  /* ================= переходы между разделами стенда =================

     В app.html переход между разделами — показ соседней обёртки, адрес
     не меняется (см. src/shell.js). На отдельных страницах — обычная
     смена страницы, а стык прикрыт шторой в цвет фона (#page-fade ниже).

     Адрес соседнего раздела зависит от того, как открыт проект:

       localhost и папка dist   файлы лежат рядом: story.html, index.html
       сайт GitHub Pages        у каждого раздела своя папка: /story/, /green/

     Что перед нами, видно по адресу текущей страницы: у сайта он
     кончается на /story/, /green/, /monitoring/ или /path/. */

  var SECTIONS = {
    story: { file: 'story.html', dir: 'story' },
    globe: { file: 'index.html', dir: 'green' },
    monitoring: { file: 'monitoring.html', dir: 'monitoring' },
    path: { file: 'path.html', dir: 'path' }
  };

  var SITE_PATH = /\/(?:story|green|monitoring|path)\/(?:index\.html)?$/;

  /** Адрес раздела: sectionUrl('globe', {theme: 'green'}). */
  function sectionUrl(name, params) {
    var s = SECTIONS[name];
    if (!s) return '';
    var url = SITE_PATH.test(global.location.pathname || '')
      ? '../' + s.dir + '/'
      : s.file;
    var q = [];
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    return q.length ? url + '?' + q.join('&') : url;
  }

  var FADE_MS = 340;                   // столько же стоит в CSS у #page-fade

  function curtain() { return document.getElementById('page-fade'); }

  /** Страница готова — убрать штору. В app.html шторой заведует Shell. */
  function revealPage() {
    if (global.Shell) return;
    var n = curtain();
    if (!n) return;
    // следующим тиком: иначе браузер не успевает заметить смену класса
    // и вместо плавного проявления получается скачок
    setTimeout(function () { n.classList.remove('is-on'); }, 30);
  }

  /** Уйти в другой раздел: сперва затемнение, потом смена страницы. */
  function goSection(name, params) {
    if (global.Shell) { global.Shell.go(name, params); return; }
    var url = sectionUrl(name, params);
    if (!url) return;
    var n = curtain();
    if (!n) { global.location.href = url; return; }
    n.classList.add('is-on');
    setTimeout(function () { global.location.href = url; }, FADE_MS);
  }

  // возврат кнопкой «назад» отдаёт страницу из кеша вместе с опущенной
  // шторой — поднимаем её обратно
  global.addEventListener('pageshow', function (e) {
    if (e && e.persisted) revealPage();
  });

  global.U = {
    sectionUrl: sectionUrl,
    goSection: goSection,
    revealPage: revealPage,
    scope: scope,
    byId: byId,
    parseQuery: parseQuery,
    query: query,
    FADE_MS: FADE_MS,
    fmtVolume: fmtVolume,
    fmtInt: fmtInt,
    capitalize: capitalize,
    loadJSON: loadJSON,
    asset: asset,
    greatCircleKm: greatCircleKm,
    plural: plural,
    easeInOutCubic: easeInOutCubic,
    clamp: clamp,
    el: el
  };
})(window);
