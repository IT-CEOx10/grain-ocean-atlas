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
   */
  function loadJSON(inlineId, url) {
    var node = document.getElementById(inlineId);
    if (node && node.textContent.trim()) {
      try {
        return Promise.resolve(JSON.parse(node.textContent));
      } catch (e) {
        return Promise.reject(new Error('Не разобрать инлайн-данные #' + inlineId + ': ' + e.message));
      }
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Не загрузить ' + url + ' (' + r.status + ')');
      return r.json();
    });
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

  /* ================= переходы между разделами стенда =================

     Разделы — четыре отдельные страницы: презентация «Путь зерна»
     (story.html), глобус «Маршруты экспорта» (index.html), карта
     госмониторинга (monitoring.html) и старый экран схемы (path.html).
     Слить их в один файл нельзя: глобус с текстурами весит около 7 МБ,
     и вместе получилось бы слишком тяжело. Поэтому переход — обычная
     смена страницы, а стык прикрыт шторой в цвет фона
     (см. #page-fade ниже).

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

  /** Страница готова — убрать штору. */
  function revealPage() {
    var n = curtain();
    if (!n) return;
    // следующим тиком: иначе браузер не успевает заметить смену класса
    // и вместо плавного проявления получается скачок
    setTimeout(function () { n.classList.remove('is-on'); }, 30);
  }

  /** Уйти в другой раздел: сперва затемнение, потом смена страницы. */
  function goSection(name, params) {
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
