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

  global.U = {
    fmtVolume: fmtVolume,
    fmtInt: fmtInt,
    capitalize: capitalize,
    loadJSON: loadJSON,
    easeInOutCubic: easeInOutCubic,
    clamp: clamp,
    el: el
  };
})(window);
