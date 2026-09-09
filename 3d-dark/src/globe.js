/* ===================================================================
   Глобус: ночная Земля (снимки NASA: огни городов + затемнённая суша),
   золотые дуги маршрутов с бегущими частицами, подписи стран поверх
   холста, управление касанием (одним пальцем — вращение, двумя — зум).
   Наружу отдаёт объект window.Globe.
   =================================================================== */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var R = 1;

  /*
   * Текстуры из снимков NASA, их готовит tools/make_earth_textures.py.
   * Наборы разложены по темам, внутри темы — от большего к меньшему:
   * какой вариант грузить, решает pickTexture() по значению
   * renderer.capabilities.maxTextureSize.
   *
   * Огни городов. У синей темы два варианта (8192 и запасной 4096),
   * у зелёной свой файл: там ореол шире и цвет теплее, поэтому 8192
   * не нужен — мягкое свечение и на 4096 выглядит так же, а вес сборки
   * растёт вдвое медленнее (см. NIGHT_THEMES в make_earth_textures.py).
   */
  var TEX_LIGHTS = {
    navy: [
      { size: 8192, path: 'assets/textures/earth_night_8192.jpg' },
      { size: 4096, path: 'assets/textures/earth_night_4096.jpg' }
    ],
    green: [
      { size: 4096, path: 'assets/textures/earth_night_4096_green.jpg' }
    ]
  };
  /*
   * Подложка суши тоже своя у каждой темы: суша и океан покрашены прямо
   * в текстуре (см. LAND_THEMES в make_earth_textures.py).
   * Пути записаны здесь буквально, а не собираются из имени темы, — иначе
   * tools/build_dist.py не найдёт их в коде и не вошьёт в один файл.
   */
  var TEX_LAND = {
    navy: [
      { size: 4096, path: 'assets/textures/earth_land_4096.jpg' },
      { size: 2048, path: 'assets/textures/earth_land_2048.jpg' }
    ],
    green: [
      { size: 4096, path: 'assets/textures/earth_land_4096_green.jpg' },
      { size: 2048, path: 'assets/textures/earth_land_2048_green.jpg' }
    ]
  };

  var cfg, colors, gcfg;
  var renderer, scene, camera, canvas;
  var pivotTilt, pivotSpin, world;      // tilt(rot.x) > spin(rot.y) > world
  var earth, borders, highlight, atmo, halo, edge;
  var arcGroup, shipDot, originDot;
  var endPointsBig = null, endPointsSmall = null, particles = null;

  var topoFeatures = null;              // контуры стран для подсветки
  var highlightCtx = null, highlightTex = null, highlightIso = null;
  var highlightLine = null, highlightGlow = null;

  var routes = [];                      // [{name, curve, pts, mesh, value, norm, baseHalf}]
  var routeByName = {};
  var selected = null;

  // Домашний ракурс: Россия, Чёрное море, Ближний Восток, Африка, Индия.
  // fx/fy — где на экране стоит центр планеты (доли ширины и высоты).
  // Тема может сдвинуть его полями homeX/homeY в config.json (themes.<имя>.globe):
  // в зелёной теме правая колонка шире, поэтому глобус уезжает левее и выше.
  var HOME = { phi: 0.33, theta: -2.36, fx: 0.52, fy: 0.52 };

  var view = { phi: HOME.phi, theta: HOME.theta, zoom: 4.3, fx: HOME.fx, fy: HOME.fy };
  var target = null;                    // анимация камеры
  var autoRotate = true;
  var lastFrame = 0;
  var drawAnim = null;                  // анимация прорисовки дуг
  var onPick = function () {};
  var onInteract = function () {};

  /* ------------------------- геометрия сферы ------------------------- */

  function toVec3(lat, lon, r) {
    var la = lat * DEG, lo = lon * DEG;
    r = r || R;
    return new THREE.Vector3(
      r * Math.cos(la) * Math.cos(lo),
      r * Math.sin(la),
      -r * Math.cos(la) * Math.sin(lo)
    );
  }

  function slerp(a, b, t) {
    var d = Math.max(-1, Math.min(1, a.dot(b)));
    var omega = Math.acos(d);
    if (omega < 1e-6) return a.clone();
    var so = Math.sin(omega);
    return a.clone().multiplyScalar(Math.sin((1 - t) * omega) / so)
      .add(b.clone().multiplyScalar(Math.sin(t * omega) / so));
  }

  /** Углы, при которых точка (lat, lon) оказывается прямо перед камерой. */
  function faceAngles(lat, lon) {
    return { phi: lat * DEG, theta: -Math.PI / 2 - lon * DEG };
  }

  function vecToLatLon(v) {
    var n = v.clone().normalize();
    return {
      lat: Math.asin(n.y) / DEG,
      lon: -Math.atan2(n.z, n.x) / DEG
    };
  }

  /* ---------------- страна на холсте: заливка подсветки ---------------- */

  /**
   * Обводит страну на холсте текстуры (равнопрямоугольная проекция) —
   * нужен только для заливки, сам контур рисуется линиями в 3D.
   * Кольца, пересекающие 180-й меридиан (Россия, Фиджи), разворачиваются
   * в непрерывную последовательность долгот и рисуются трижды — со сдвигом
   * на -W, 0 и +W; лишнее обрезает холст.
   */
  function tracePath(ctx, feature, W, H) {
    var g = feature.geometry;
    if (!g) return;
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    var SHIFTS = [-W, 0, W];
    ctx.beginPath();
    for (var s = 0; s < SHIFTS.length; s++) {
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        for (var r = 0; r < poly.length; r++) {
          var ring = poly[r];
          var lon = ring[0][0];
          for (var i = 0; i < ring.length; i++) {
            if (i > 0) {
              var d = ring[i][0] - ring[i - 1][0];
              if (d > 180) d -= 360; else if (d < -180) d += 360;
              lon += d;
            }
            var x = (lon + 180) / 360 * W + SHIFTS[s];
            var y = (90 - ring[i][1]) / 180 * H;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      }
    }
  }

  /* ------------------ линии на сфере: ширина в пикселях ------------------ */

  /*
   * Контуры стран нарисованы не на текстуре, а геометрией. Каждый отрезок
   * границы превращается в четырёхугольник, который вершинный шейдер
   * растягивает поперёк линии уже в координатах экрана: толщина задана
   * в пикселях и не зависит от приближения. Край гасится по alpha, поэтому
   * линия остаётся тонкой и гладкой даже вплотную к планете — на холсте
   * 2048×1024 она в этот момент разваливалась на ступеньки.
   *
   * Точки колец уплотняются дугами (LINE_STEP): в topojson длинные прямые
   * границы заданы двумя точками, и хорда между ними ушла бы под поверхность.
   */
  var uRes = { value: new THREE.Vector2(1920, 1080) };
  var LINE_STEP = 1.2 * DEG;            // максимальный шаг вдоль границы

  var LINE_VERT =
    'attribute vec3 aEnd; attribute vec2 aSideT;' +
    'uniform vec2 uRes; uniform float uHalf;' +
    'varying float vSide;' +
    'void main(){' +
    '  vec4 ca = projectionMatrix * modelViewMatrix * vec4(position, 1.0);' +
    '  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);' +
    '  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes;' +
    '  float l = length(d);' +
    '  vec2 n = l > 1e-6 ? vec2(-d.y, d.x) / l : vec2(0.0);' +
    '  vec4 c = mix(ca, cb, aSideT.y);' +
    '  c.xy += n * (aSideT.x * uHalf * 2.0 * c.w) / uRes;' +
    '  vSide = aSideT.x;' +
    '  gl_Position = c; }';

  var LINE_FRAG =
    'uniform vec3 uColor; uniform float uOpacity;' +
    'varying float vSide;' +
    'void main(){' +
    '  float a = 1.0 - smoothstep(0.30, 1.0, abs(vSide));' +
    '  gl_FragColor = vec4(uColor, a * uOpacity); }';

  /** 'rgba(r,g,b,a)' -> прозрачность; у других записей цвета — 1. */
  function alphaOf(str) {
    var m = /rgba\(([^)]+)\)/.exec(str || '');
    if (!m) return 1;
    var p = m[1].split(',');
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }

  /*
   * Цвет берётся как есть, без пересчёта в линейное пространство: шейдер
   * пишет его прямо в кадр, поэтому контур выглядит ровно тем цветом,
   * что записан в config.json, — как раньше на холсте.
   */
  function rawColor(str) {
    var c = new THREE.Color();
    if (THREE.LinearSRGBColorSpace) c.setStyle(str, THREE.LinearSRGBColorSpace);
    else c.setStyle(str);
    return c;
  }

  function lineMaterial(color, halfPx, opacity, additive) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uRes: uRes,
        uHalf: { value: halfPx },
        uColor: { value: rawColor(color) },
        uOpacity: { value: opacity }
      },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG
    });
  }

  /** Кольцо [[lon,lat],...] -> точки на сфере радиуса r, уплотнённые дугами. */
  function ringToPoints(ring, r) {
    var pts = [];
    for (var i = 0; i < ring.length; i++) {
      var v = toVec3(ring[i][1], ring[i][0], r);
      if (pts.length) {
        var prev = pts[pts.length - 1];
        var cos = Math.max(-1, Math.min(1, prev.dot(v) / (r * r)));
        var n = Math.ceil(Math.acos(cos) / LINE_STEP);
        for (var k = 1; k < n; k++) pts.push(slerp(prev, v, k / n));
      }
      pts.push(v);
    }
    return pts;
  }

  /** Геометрия GeoJSON (линии или полигоны) -> массив полилиний. */
  function geoToLines(geom, r, out) {
    var t = geom.type, c = geom.coordinates, i, j;
    if (t === 'LineString') {
      out.push(ringToPoints(c, r));
    } else if (t === 'MultiLineString' || t === 'Polygon') {
      for (i = 0; i < c.length; i++) out.push(ringToPoints(c[i], r));
    } else if (t === 'MultiPolygon') {
      for (i = 0; i < c.length; i++)
        for (j = 0; j < c[i].length; j++) out.push(ringToPoints(c[i][j], r));
    }
    return out;
  }

  var LINE_SIDE = [-1, -1, 1, -1, 1, 1];    // два треугольника на отрезок
  var LINE_T = [0, 1, 1, 0, 1, 0];

  function buildLineGeometry(lines) {
    var segs = 0, i, j, k;
    for (i = 0; i < lines.length; i++) segs += Math.max(0, lines[i].length - 1);
    var pa = new Float32Array(segs * 18);
    var pb = new Float32Array(segs * 18);
    var st = new Float32Array(segs * 12);
    var o3 = 0, o2 = 0;
    for (i = 0; i < lines.length; i++) {
      var pts = lines[i];
      for (j = 0; j + 1 < pts.length; j++) {
        var a = pts[j], b = pts[j + 1];
        for (k = 0; k < 6; k++) {
          pa[o3] = a.x; pa[o3 + 1] = a.y; pa[o3 + 2] = a.z;
          pb[o3] = b.x; pb[o3 + 1] = b.y; pb[o3 + 2] = b.z;
          o3 += 3;
          st[o2] = LINE_SIDE[k]; st[o2 + 1] = LINE_T[k];
          o2 += 2;
        }
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(pb, 3));
    g.setAttribute('aSideT', new THREE.BufferAttribute(st, 2));
    // вершины расходятся уже на экране, поэтому сфера отсечения задана вручную
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    return g;
  }

  /* --------------------------- контуры стран --------------------------- */

  /** Едва заметная сетка границ: общие участки topojson рисует один раз. */
  function buildBorders(topo) {
    topoFeatures = topojson.feature(topo, topo.objects.countries).features;
    var net = topojson.mesh(topo, topo.objects.countries);
    var geo = buildLineGeometry(geoToLines(net, R * 1.0018, []));
    // толщина и сила линии — из темы: на светлой зелёной суше золотая
    // сетка при синих настройках почти пропадает
    var mesh = new THREE.Mesh(geo, lineMaterial(colors.border,
      gcfg.borderWidth != null ? gcfg.borderWidth : 0.6,
      alphaOf(colors.border) * (gcfg.borderOpacity != null ? gcfg.borderOpacity : 0.55)));
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Мягкая заливка выбранной страны (сам контур — линиями, см. ниже). */
  function buildHighlightTexture() {
    var W = 2048, H = 1024;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    highlightCtx = cv.getContext('2d');
    highlightTex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) highlightTex.colorSpace = THREE.SRGBColorSpace;
    highlightTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return highlightTex;
  }

  function disposeHighlightLine() {
    if (!highlightLine) return;
    world.remove(highlightLine);
    world.remove(highlightGlow);
    highlightLine.geometry.dispose();
    highlightLine.material.dispose();
    highlightGlow.material.dispose();
    highlightLine = highlightGlow = null;
  }

  function drawHighlight(iso) {
    if (!highlightCtx || highlightIso === iso) return;
    highlightIso = iso;
    var W = 2048, H = 1024;
    highlightCtx.clearRect(0, 0, W, H);
    disposeHighlightLine();

    var feat = null;
    if (iso && topoFeatures) {
      for (var i = 0; i < topoFeatures.length; i++) {
        if (String(topoFeatures[i].id) === String(iso)) { feat = topoFeatures[i]; break; }
      }
    }
    if (feat) {
      // заливка размыта: её край всё равно ступенчатый, а так он читается
      // как мягкое свечение внутри страны, границу держит контур-линия
      highlightCtx.filter = 'blur(4px)';
      tracePath(highlightCtx, feat, W, H);
      highlightCtx.fillStyle = colors.highlightFill;
      highlightCtx.fill('evenodd');
      highlightCtx.filter = 'none';

      // контур: тонкая сердцевина плюс широкая полупрозрачная копия
      var geo = buildLineGeometry(geoToLines(feat.geometry, R * 1.0034, []));
      var a = alphaOf(colors.highlight);
      // сердцевина по обычному смешиванию — иначе поверх светлой суши
      // золото складывается с фоном и выцветает в белое; ореол сложением
      highlightGlow = new THREE.Mesh(geo, lineMaterial(colors.highlight, 3.4, a * 0.22, true));
      highlightLine = new THREE.Mesh(geo, lineMaterial(colors.highlight, 0.95, Math.min(1, a * 1.25)));
      highlightGlow.renderOrder = 6;
      highlightLine.renderOrder = 7;
      world.add(highlightGlow);
      world.add(highlightLine);
    }
    highlightTex.needsUpdate = true;
    highlight.visible = !!feat;
  }

  /*
   * Текстуры точек рисуются в 128 px и показываются без мипмапов: спрайты
   * и точки занимают на ретине 40–80 физических пикселей, то есть текстура
   * идёт с небольшим уменьшением — так она остаётся резкой.
   */
  function pointTexture(rgb, draw) {
    var s = 128;
    var cv = document.createElement('canvas');
    cv.width = cv.height = s;
    draw(cv.getContext('2d'), s, s / 2);
    var t = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** Круглое мягкое свечение — маркеры стран и порт отправления. */
  function glowTexture(rgb) {
    return pointTexture(rgb, function (ctx, s, c) {
      var gr = ctx.createRadialGradient(c, c, 0, c, c, c);
      gr.addColorStop(0, 'rgba(' + rgb + ',1)');
      gr.addColorStop(0.25, 'rgba(' + rgb + ',.55)');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, s, s);
    });
  }

  /**
   * Точка с чёткой сердцевиной и мягким ореолом вокруг — «корабль».
   * core — доля радиуса под ядро: при размере спрайта 20 px и core = 0.35
   * ядро занимает 7 px, остальное уходит в свечение.
   */
  function dotTexture(rgb, core) {
    return pointTexture(rgb, function (ctx, s, c) {
      var halo = ctx.createRadialGradient(c, c, 0, c, c, c);
      halo.addColorStop(0, 'rgba(' + rgb + ',.55)');
      halo.addColorStop(core, 'rgba(' + rgb + ',.34)');
      halo.addColorStop(0.6, 'rgba(' + rgb + ',.10)');
      halo.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, s, s);

      var cr = c * core;
      var dot = ctx.createRadialGradient(c, c, 0, c, c, cr);
      dot.addColorStop(0, 'rgba(255,255,255,1)');
      dot.addColorStop(0.70, 'rgba(255,255,255,1)');
      dot.addColorStop(0.88, 'rgba(' + rgb + ',.92)');
      dot.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = dot;
      ctx.fillRect(0, 0, s, s);
    });
  }

  var TEX_GOLD = null, TEX_WHITE = null, TEX_SHIP = null;

  /** Самый большой вариант текстуры, который тянет видеокарта. */
  function pickTexture(list) {
    var max = renderer.capabilities.maxTextureSize;
    for (var i = 0; i < list.length; i++) {
      if (list[i].size <= max) return list[i].path;
    }
    return list[list.length - 1].path;
  }

  /**
   * Общая подготовка снимков Земли: sRGB (иначе тёмные полутона уезжают),
   * мипмапы и максимальная анизотропия — без них огни на краю диска
   * рассыпаются в зернистую россыпь точек.
   */
  function prepTexture(t) {
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  /* ----------------------- ободок и свечение ----------------------- */

  /** Значение из настроек темы или значение по умолчанию. */
  function num(v, def) {
    return v != null ? v : def;
  }

  var RIM_VERT =
    'varying vec3 vN; varying vec3 vP;' +
    'void main(){ vN = normalize(normalMatrix * normal);' +
    'vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;' +
    'gl_Position = projectionMatrix * mv; }';

  /*
   * Ободок и свечение — сфера чуть больше планеты, у которой видна только
   * изнанка: сама планета непрозрачна, поэтому на экране от такой оболочки
   * остаётся кольцо между краем диска и её силуэтом. Яркость считается
   * по Френелю, степень uPow задаёт ширину полосы.
   *
   * Блик по кромке устроен наоборот — side: FrontSide: оболочка лежит поверх
   * планеты и светится только у самого силуэта, где взгляд идёт по касательной.
   * От этого край выглядит стеклянным, а не обведённым кольцом.
   */
  function rimMaterial(color, power, strength, front) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      side: front ? THREE.FrontSide : THREE.BackSide, depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uPow: { value: power },
        uStr: { value: strength }
      },
      vertexShader: RIM_VERT,
      fragmentShader:
        'uniform vec3 uColor; uniform float uPow; uniform float uStr;' +
        'varying vec3 vN; varying vec3 vP;' +
        'void main(){' +
        '  float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(-vP))), 0.0, 1.0), uPow);' +
        '  gl_FragColor = vec4(uColor, f * uStr); }'
    });
  }

  /*
   * Блик по кромке — «серп». Оболочка чуть больше планеты, side: FrontSide:
   * она лежит поверх диска и светится только у силуэта, где взгляд идёт
   * по касательной. От прежнего ровного колечка отличается двумя вещами.
   *
   * 1. Яркость модулируется светом: считается косинус между нормалью и
   *    направлением на источник (uLight, в системе камеры — поэтому серп
   *    стоит на месте, когда планета вращается). На освещённой стороне
   *    кромка почти белая, к теневой плавно гаснет до доли uBias.
   * 2. Часть оболочки, торчащая наружу за край планеты, гасится отдельно
   *    (uSoft). Без этого свечение обрывалось бы ровным кольцом по силуэту
   *    оболочки — это и есть та самая «сфера в сфере». uInner — отношение
   *    радиусов планеты и оболочки, по нему шейдер знает, где проходит
   *    настоящая кромка диска.
   */
  var EDGE_FRAG =
    'uniform vec3 uColor; uniform vec3 uCore; uniform vec3 uLight;' +
    'uniform float uPow; uniform float uStr; uniform float uBias;' +
    'uniform float uSoft; uniform float uInner;' +
    'varying vec3 vN; varying vec3 vP;' +
    'void main(){' +
    '  vec3 n = normalize(vN);' +
    '  float c = abs(dot(n, normalize(-vP)));' +          // 1 в центре диска, 0 у силуэта
    '  float band = pow(clamp(1.0 - c, 0.0, 1.0), uPow);' +
    '  float lit = smoothstep(-0.55, 0.80, dot(n, normalize(uLight)));' +
    '  float m = clamp(uBias + (1.0 - uBias) * lit, 0.0, 1.0);' +
    '  float fall = 1.0;' +
    '  if (uSoft > 0.0) {' +
    '    float cRim = sqrt(max(1.0 - uInner * uInner, 0.0));' +   // косинус на кромке планеты
    '    if (cRim > 1e-4 && c < cRim) fall = pow(clamp(c / cRim, 0.0, 1.0), uSoft);' +
    '  }' +
    '  float a = band * m * fall * uStr;' +
    '  vec3 col = mix(uColor, uCore, clamp(a, 0.0, 1.0));' +
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)); }';

  function edgeMaterial(color, core, light, o) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.FrontSide, depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uCore: { value: new THREE.Color(core) },
        uLight: { value: light },
        uPow: { value: o.power },
        uStr: { value: o.strength },
        uBias: { value: o.bias },
        uSoft: { value: o.softness },
        uInner: { value: o.inner }
      },
      vertexShader: RIM_VERT,
      fragmentShader: EDGE_FRAG
    });
  }

  /* --------------------- дуги: ширина в пикселях --------------------- */

  /*
   * Трубка дуги строится один раз с фиксированным радиусом ARC_BASE, а её
   * настоящая толщина считается в вершинном шейдере: вершина возвращается
   * на ось (position − normal·ARC_BASE) и отодвигается обратно на радиус,
   * который даёт нужную ширину в пикселях на этой глубине. Поэтому дуга
   * выглядит одинаково и на общем плане, и при сильном приближении —
   * геометрию перестраивать не нужно, меняются только два uniform-а.
   *
   * Фрагментный шейдер гасит яркость к краю трубки: у обращённой к камере
   * стороны dot(нормаль, взгляд) равен единице, у силуэта — нулю. Резкая
   * степень даёт светящуюся сердцевину, пологая — ореол вокруг неё.
   */
  var ARC_BASE = 0.01;                  // радиус, с которым построена трубка
  var ARC_HALO = 3.0;                   // во сколько раз ореол шире сердцевины
  var uPxK = { value: 0.00064 };        // 2·tan(fov/2)/высота холста, общий uniform

  // Гашение дуги у порта отправления и общий множитель толщины дуг.
  // Значения по умолчанию ничего не меняют: 1 — «как было». Тема перебивает
  // их полями globe.arcStart, globe.arcStartLen и globe.arcWidth (см. init).
  var ARC_START = 1;                    // доля яркости в самой точке порта
  var ARC_START_LEN = 0.02;             // на какой доле пути выходит на полную
  var ARC_WIDTH = 1;                    // множитель толщины дуг

  var ARC_VERT =
    'uniform float uBase; uniform float uHalf; uniform float uPxK;' +
    'varying vec3 vN; varying vec3 vP; varying float vT;' +
    'void main(){' +
    '  vec3 n = normalize(normal);' +
    '  vec4 mv = modelViewMatrix * vec4(position - n * uBase, 1.0);' +
    '  vec3 nv = normalize(normalMatrix * n);' +
    '  mv.xyz += nv * (uHalf * max(-mv.z, 0.05) * uPxK);' +
    '  vN = nv; vP = mv.xyz; vT = uv.x;' +      // uv.x трубки — доля пути от порта
    '  gl_Position = projectionMatrix * mv; }';

  /*
   * uStart и uStartLen гасят начало дуги. В порту отправления сходится больше
   * сотни маршрутов, и при аддитивном смешивании их яркости складывались
   * в белое пятно. Теперь у самого порта дуга светит на долю uStart и
   * выходит на полную яркость к uStartLen пути. По умолчанию uStart = 1 —
   * гашения нет, как было раньше.
   */
  var ARC_FRAG =
    'uniform vec3 uColor; uniform float uOpacity;' +
    'uniform float uStart; uniform float uStartLen;' +
    'varying vec3 vN; varying vec3 vP; varying float vT;' +
    'void main(){' +
    '  float d = clamp(dot(normalize(vN), normalize(-vP)), 0.0, 1.0);' +
    '  float core = pow(d, 12.0);' +
    '  float halo = pow(d, 1.3);' +
    '  float g = mix(uStart, 1.0, smoothstep(0.0, max(uStartLen, 1e-4), vT));' +
    '  vec3 c = uColor + vec3(0.28) * core;' +   // сердцевина горячее и белее
    '  gl_FragColor = vec4(c, (core + halo * 0.38) * uOpacity * g); }';

  function arcMaterial(color, half, opacity) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: {
        uBase: { value: ARC_BASE },
        uHalf: { value: half },
        uPxK: uPxK,                     // общий объект: обновляется при resize
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uStart: { value: ARC_START },
        uStartLen: { value: ARC_START_LEN }
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG
    });
  }

  /* ------------------------------ сцена ------------------------------ */

  function init(opts) {
    canvas = opts.canvas;
    cfg = opts.config;
    colors = cfg.colors;
    gcfg = cfg.globe;
    onPick = opts.onPick || onPick;
    onInteract = opts.onInteract || onInteract;
    if (gcfg.homeX != null) HOME.fx = gcfg.homeX;
    if (gcfg.homeY != null) HOME.fy = gcfg.homeY;
    ARC_START = num(gcfg.arcStart, 1);
    ARC_START_LEN = num(gcfg.arcStartLen, 0.02);
    ARC_WIDTH = num(gcfg.arcWidth, 1);
    view.fx = HOME.fx;
    view.fy = HOME.fy;
    view.zoom = gcfg.defaultZoom;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, view.zoom);

    pivotTilt = new THREE.Group();
    pivotSpin = new THREE.Group();
    world = new THREE.Group();
    pivotTilt.add(pivotSpin);
    pivotSpin.add(world);
    scene.add(pivotTilt);

    // общий множитель света: тема может сделать планету ярче, не трогая соседнюю
    var lk = gcfg.lightScale != null ? gcfg.lightScale : 1;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85 * lk));
    var dir = new THREE.DirectionalLight(new THREE.Color(colors.sunLight || '#9FC0FF'), 0.45 * lk);
    dir.position.set(-2, 1.4, 2.2);
    scene.add(dir);

    TEX_GOLD = glowTexture('255,205,120');
    TEX_WHITE = glowTexture('255,240,214');
    TEX_SHIP = dotTexture('255,244,224', 0.35);

    // ночная Земля: холодная серо-голубая суша (карта)
    // + тёпло-белые огни городов с ореолом (emissive)
    var earthMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(colors.land),
      specular: new THREE.Color(colors.ocean),
      shininess: 6,
      emissive: new THREE.Color(colors.cityLights),
      emissiveIntensity: gcfg.lightsIntensity || 1.35
    });
    var loader = new THREE.TextureLoader();
    var landSet = TEX_LAND[cfg.theme] || TEX_LAND.navy;
    loader.load(U.asset(pickTexture(landSet)), function (t) {
      earthMat.map = prepTexture(t); earthMat.needsUpdate = true;
    });
    var lightSet = TEX_LIGHTS[cfg.theme] || TEX_LIGHTS.navy;
    loader.load(U.asset(pickTexture(lightSet)), function (t) {
      earthMat.emissiveMap = prepTexture(t); earthMat.needsUpdate = true;
    });
    // сегментов много: вблизи на гранёном шаре виден многоугольный край диска
    earth = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 96), earthMat);
    world.add(earth);

    // едва заметные границы стран
    borders = buildBorders(opts.topo);
    world.add(borders);

    // мягкая заливка выбранной страны (контур добавляется отдельно, линиями)
    highlight = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.0024, 96, 64),
      new THREE.MeshBasicMaterial({
        map: buildHighlightTexture(),
        transparent: true, depthWrite: false
      })
    );
    highlight.renderOrder = 2;
    highlight.visible = false;
    world.add(highlight);

    // Ободок атмосферы и мягкое внешнее свечение. Цвет, сила, ширина полосы
    // (степень Френеля: меньше — шире) и радиус оболочки берутся из темы.
    // Нулевая сила — оболочки в сцене нет совсем: в зелёной теме заказчик
    // просил убрать и кольцо, и внешнее свечение, остался только блик
    // по кромке. Лишний прозрачный меш в таком случае не создаётся.
    var rimStr = num(gcfg.rimStrength, 0.50);
    if (rimStr > 0) {
      atmo = new THREE.Mesh(new THREE.SphereGeometry(R * num(gcfg.rimRadius, 1.012), 64, 48),
        rimMaterial(colors.atmosphere, num(gcfg.rimPower, 6.5), rimStr));
      world.add(atmo);
    }
    var haloStr = num(gcfg.haloStrength, 0.15);
    if (haloStr > 0) {
      halo = new THREE.Mesh(new THREE.SphereGeometry(R * num(gcfg.haloRadius, 1.13), 48, 32),
        rimMaterial(colors.halo, num(gcfg.haloPower, 4.5), haloStr));
      world.add(halo);
    }
    // Блик по кромке: светится сам край диска, а не кольцо снаружи.
    // Есть только у тем, где задан edgeStrength, — в синей теме
    // этого объекта в сцене нет и картинка не меняется.
    if (gcfg.edgeStrength) {
      var eRad = num(gcfg.edgeRadius, 1.003);
      // направление на свет в системе камеры: по умолчанию — туда же,
      // куда смотрит основной источник сцены (сверху слева)
      var eLight = gcfg.edgeLight
        ? new THREE.Vector3(gcfg.edgeLight[0], gcfg.edgeLight[1], gcfg.edgeLight[2]).normalize()
        : dir.position.clone().normalize();
      edge = new THREE.Mesh(new THREE.SphereGeometry(R * eRad, 160, 96),
        edgeMaterial(colors.edge || colors.atmosphere,
          colors.edgeCore || colors.edge || colors.atmosphere, eLight, {
            power: num(gcfg.edgePower, 6),
            strength: gcfg.edgeStrength,
            bias: num(gcfg.edgeBias, 1),          // 1 — ровное кольцо, как было
            softness: num(gcfg.edgeSoftness, 0),  // 0 — наружу не гасим, как было
            inner: 1 / eRad
          }));
      edge.renderOrder = 8;
      world.add(edge);
    }

    arcGroup = new THREE.Group();
    world.add(arcGroup);

    // Спрайты с sizeAttenuation:false меряют scale не в мировых единицах,
    // а как долю экрана, поэтому размер задаётся в пикселях (см. setPxSizes).
    // точка отправления
    var o = cfg.origin;
    originDot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_WHITE, transparent: true, sizeAttenuation: false,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    originDot.position.copy(toVec3(o.lat, o.lon, R * 1.004));
    world.add(originDot);

    // «корабль» — светящаяся точка, бегущая по выбранному маршруту
    shipDot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_SHIP, transparent: true, sizeAttenuation: false,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    shipDot.visible = false;
    world.add(shipDot);

    initLabels();
    bindPointer();
    resize();
    global.addEventListener('resize', resize);
    requestAnimationFrame(loop);
  }

  function resize() {
    var w = canvas.clientWidth || 1920;
    var h = canvas.clientHeight || 1080;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    uRes.value.set(w, h);
    setPxSizes(h);
    applyViewOffset();
  }

  /** Размеры в пикселях: спрайты и точки — CSS-пиксели, дуги — через uniform. */
  var PX = { origin: 28, ship: 20, endBig: 38, endSmall: 22, particle: 10 };

  function setPxSizes(h) {
    // мировая длина, дающая один пиксель по вертикали на расстоянии 1 от камеры
    uPxK.value = 2 * Math.tan(camera.fov * DEG / 2) / h;
    if (originDot) originDot.scale.setScalar(PX.origin * uPxK.value);
    if (shipDot) shipDot.scale.setScalar(PX.ship * uPxK.value);
  }

  function applyViewOffset() {
    var w = canvas.clientWidth || 1920;
    var h = canvas.clientHeight || 1080;
    camera.setViewOffset(w, h, -(view.fx - 0.5) * w, -(view.fy - 0.5) * h, w, h);
    camera.updateProjectionMatrix();
  }

  /* ----------------------------- подписи ----------------------------- */

  var labelHost = null;
  var labels = [];                      // подписи топ-стран
  var originLabel = null, selLabel = null;

  function makeLabel(cls) {
    var el = document.createElement('div');
    el.className = 'glabel' + (cls ? ' ' + cls : '');
    el.style.opacity = 0;
    labelHost.appendChild(el);
    return { el: el, w: 0, h: 0, x: 0, y: 0, vis: false };
  }

  function setLabelText(L, title, sub) {
    L.el.innerHTML = '<span>' + title + '</span><i>' + sub + '</i>';
    L.w = L.el.offsetWidth;
    L.h = L.el.offsetHeight;
  }

  function initLabels() {
    labelHost = document.getElementById('glabels');
    originLabel = makeLabel('is-port');
    setLabelText(originLabel, cfg.origin.name, 'порт отправления');
    selLabel = makeLabel('is-port');
    // до подгрузки шрифтов ширина подписей меряется неверно — пересчитываем
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        var all = labels.concat([originLabel, selLabel]);
        all.forEach(function (L) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; });
      });
    }
  }

  var pTmp = new THREE.Vector3(), pNrm = new THREE.Vector3();

  /** Экранная позиция точки на глобусе + признак «лицевая сторона». */
  function project(worldPos, out) {
    var w = canvas.clientWidth || 1920;
    var h = canvas.clientHeight || 1080;
    pTmp.copy(worldPos);
    pNrm.copy(pTmp).normalize();
    var toCam = pTmp.clone().sub(camera.position).normalize();
    out.front = -toCam.dot(pNrm) > 0.06;
    pTmp.project(camera);
    out.x = (pTmp.x * 0.5 + 0.5) * w;
    out.y = (-pTmp.y * 0.5 + 0.5) * h;
    out.front = out.front && pTmp.z < 1;
    return out;
  }

  /** Прямоугольник подписи с учётом transform: translate(-50%, -140%). */
  function labelRect(L, dy) {
    return { l: L.x - L.w / 2, r: L.x + L.w / 2, t: L.y - L.h * 1.4 + dy, b: L.y - L.h * 0.4 + dy };
  }

  function overlaps(a, b) {
    return a.l < b.r + 6 && a.r > b.l - 6 && a.t < b.b + 4 && a.b > b.t - 4;
  }

  var placed = [];
  var tmpV = new THREE.Vector3();
  var centre = { x: 960, y: 540, front: true };
  var originPt = { x: 960, y: 540 };
  var zeroV = new THREE.Vector3();

  function placeLabel(L, worldPos, alpha, isOrigin) {
    if (alpha <= 0.01) { L.el.style.opacity = 0; return; }
    project(worldPos, L);
    if (isOrigin) { originPt.x = L.x; originPt.y = L.y; }
    if (!L.front) { L.el.style.opacity = 0; return; }

    // Подпись отодвигается от центра глобуса, а рядом с точкой отправления —
    // от неё самой: иначе подписи ближних стран тонут в узле маршрутов.
    var ax = centre.x, ay = centre.y, push = 18;
    if (!isOrigin) {
      var d = Math.hypot(L.x - originPt.x, L.y - originPt.y);
      if (d > 2 && d < 170) { ax = originPt.x; ay = originPt.y; push = 52; }
    }
    var ox = L.x - ax, oy = L.y - ay;
    var len = Math.hypot(ox, oy) || 1;
    L.x += ox / len * push;
    L.y += oy / len * push;
    // если подпись налезает на уже размещённую — сдвигаем вниз, иначе прячем
    var dy = 0, ok = false;
    for (var step = 0; step < 3 && !ok; step++) {
      var rect = labelRect(L, dy);
      ok = true;
      for (var i = 0; i < placed.length; i++) {
        if (overlaps(rect, placed[i])) { ok = false; break; }
      }
      if (!ok) dy += L.h + 6;
    }
    if (!ok) { L.el.style.opacity = 0; return; }
    placed.push(labelRect(L, dy));
    L.el.style.transform = 'translate(-50%, -140%) translate(' +
      L.x.toFixed(1) + 'px,' + (L.y + dy).toFixed(1) + 'px)';
    L.el.style.opacity = alpha;
  }

  function updateLabels() {
    placed.length = 0;
    world.updateMatrixWorld();
    project(zeroV, centre);

    tmpV.copy(originDot.position).applyMatrix4(world.matrixWorld);
    placeLabel(originLabel, tmpV, 1, true);

    if (selected && routeByName[selected]) {
      var r = routeByName[selected];
      tmpV.copy(r.dest).multiplyScalar(1.004).applyMatrix4(world.matrixWorld);
      placeLabel(selLabel, tmpV, 1);
    } else {
      selLabel.el.style.opacity = 0;
    }

    for (var i = 0; i < labels.length; i++) {
      var L = labels[i];
      if (selected) { L.el.style.opacity = 0; continue; }
      tmpV.copy(L.pos).applyMatrix4(world.matrixWorld);
      placeLabel(L, tmpV, 1);
    }
  }

  function rebuildLabels(items) {
    for (var i = 0; i < labels.length; i++) labelHost.removeChild(labels[i].el);
    labels = [];
    var top = items.slice(0, 8);       // items уже отсортированы по убыванию
    for (var j = 0; j < top.length; j++) {
      var L = makeLabel(null);
      setLabelText(L, top[j].name, U.fmtVolume(top[j].value) + ' тыс. т');
      L.pos = toVec3(top[j].lat, top[j].lon, R * 1.004);
      labels.push(L);
    }
  }

  /* ----------------------------- маршруты ----------------------------- */

  function disposeRoutes() {
    routes.forEach(function (r) {
      arcGroup.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    });
    routes = [];
    routeByName = {};
    [endPointsBig, endPointsSmall, particles].forEach(function (p) {
      if (!p) return;
      world.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    });
    endPointsBig = endPointsSmall = particles = null;
  }

  function endPoints(list, size, opacity) {
    if (!list.length) return null;
    var pos = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i].dest.clone().multiplyScalar(1.004);
      pos.push(d.x, d.y, d.z);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // sizeAttenuation:false — size прямо в CSS-пикселях, зум на него не влияет
    var p = new THREE.Points(g, new THREE.PointsMaterial({
      size: size, sizeAttenuation: false, map: TEX_GOLD,
      color: 0xFFD9A0, transparent: true, opacity: opacity,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    p.renderOrder = 4;
    world.add(p);
    return p;
  }

  var PPA = 3;                          // частиц на одну дугу

  /**
   * items: [{name, lat, lon, value, iso}] — только страны с объёмом > 0,
   * отсортированные по убыванию. animate: рисовать дуги «от РФ к стране».
   */
  function setRoutes(items, animate) {
    disposeRoutes();
    selected = null;
    shipDot.visible = false;
    drawHighlight(null);

    var origin = toVec3(cfg.origin.lat, cfg.origin.lon, R);
    var maxV = 0, minV = Infinity;
    items.forEach(function (it) {
      if (it.value > maxV) maxV = it.value;
      if (it.value < minV) minV = it.value;
    });
    var lgMin = Math.log10(Math.max(minV, 1e-4));
    var lgMax = Math.log10(Math.max(maxV, 1e-3));
    var span = Math.max(lgMax - lgMin, 0.001);

    items.forEach(function (it) {
      var norm = (Math.log10(Math.max(it.value, 1e-4)) - lgMin) / span;
      norm = Math.max(0, Math.min(1, norm));

      var dest = toVec3(it.lat, it.lon, R);
      var angle = Math.acos(Math.max(-1, Math.min(1, origin.dot(dest))));
      var alt = 0.03 + 0.235 * (angle / Math.PI);   // высота дуги по дальности

      var pts = [];
      var N = gcfg.arcSegments;
      for (var i = 0; i <= N; i++) {
        var t = i / N;
        var p = slerp(origin, dest, t);
        p.multiplyScalar(1 + alt * Math.sin(Math.PI * t));
        pts.push(p);
      }
      var curve = new THREE.CatmullRomCurve3(pts);

      // полуширина светящейся сердцевины в пикселях экрана — по лог-шкале объёма
      var half = (0.80 + 1.30 * norm * norm) * ARC_WIDTH;
      var opacity = 0.42 + 0.55 * norm;
      var geo = new THREE.TubeGeometry(curve, N, ARC_BASE, 8, false);
      var mesh = new THREE.Mesh(geo, arcMaterial(colors.route, half * ARC_HALO, opacity));
      mesh.renderOrder = 3;
      arcGroup.add(mesh);

      var route = {
        name: it.name, value: it.value, norm: norm, iso: it.iso, port: it.port,
        curve: curve, pts: pts, mesh: mesh,
        baseHalf: half, baseOpacity: opacity, dest: dest, phase: Math.random()
      };
      routes.push(route);
      routeByName[it.name] = route;
    });

    // светящиеся точки на концах: два размера — крупные направления заметнее
    var big = routes.slice(0, 8), small = routes.slice(8);
    endPointsBig = endPoints(big, PX.endBig, 0.95);
    endPointsSmall = endPoints(small, PX.endSmall, 0.75);

    // бегущие частицы: один Points-объект на все дуги
    if (routes.length) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position',
        new THREE.Float32BufferAttribute(new Float32Array(routes.length * PPA * 3), 3));
      particles = new THREE.Points(g, new THREE.PointsMaterial({
        size: PX.particle, sizeAttenuation: false, map: TEX_GOLD,
        color: 0xFFD9A0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      particles.renderOrder = 5;
      world.add(particles);
    }

    rebuildLabels(items);

    if (animate === false) {
      routes.forEach(function (r) { r.mesh.geometry.setDrawRange(0, Infinity); });
      drawAnim = null;
    } else {
      routes.forEach(function (r) { r.mesh.geometry.setDrawRange(0, 0); });
      drawAnim = { t0: performance.now(), dur: 900 };
    }
  }

  function stepDrawAnim(now) {
    if (!drawAnim) return;
    var p = (now - drawAnim.t0) / drawAnim.dur;
    for (var i = 0; i < routes.length; i++) {
      var stagger = (i % 12) * 0.02;
      var q = Math.max(0, Math.min(1, (p - stagger) / (1 - 0.24)));
      var geo = routes[i].mesh.geometry;
      var total = geo.index ? geo.index.count : geo.attributes.position.count;
      var n = Math.floor(total * U.easeInOutCubic(q) / 3) * 3;
      geo.setDrawRange(0, n);
    }
    if (p >= 1.3) {
      routes.forEach(function (r) { r.mesh.geometry.setDrawRange(0, Infinity); });
      drawAnim = null;
    }
  }

  /** Точка на дуге по доле пути — по заранее посчитанным узлам, без аллокаций. */
  function pointAt(r, f, out) {
    var n = r.pts.length - 1;
    var s = f * n;
    var i = s | 0;
    if (i >= n) i = n - 1;
    var k = s - i;
    var a = r.pts[i], b = r.pts[i + 1];
    out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    return out;
  }

  /* ------------------------ выделение и фокус ------------------------ */

  var SEL_HALF = 3.0;                   // полуширина выбранной дуги, пиксели

  function setSelected(name) {
    selected = name && routeByName[name] ? name : null;
    routes.forEach(function (r) {
      var u = r.mesh.material.uniforms;
      var isSel = r.name === selected;
      // выбранный маршрут светит в полную силу от самого порта: гашение начала
      // нужно только там, где дуги сходятся пучком, а здесь она одна
      u.uStart.value = isSel ? 1 : ARC_START;
      if (!selected) {
        u.uColor.value.set(colors.route);
        u.uOpacity.value = r.baseOpacity;
        u.uHalf.value = r.baseHalf * ARC_HALO;
      } else if (isSel) {
        u.uColor.value.set(colors.routeActive);
        u.uOpacity.value = 1.0;
        u.uHalf.value = SEL_HALF * ARC_HALO;
      } else {
        u.uColor.value.set(colors.route);
        u.uOpacity.value = r.baseOpacity * 0.15;   // остальные приглушены
        u.uHalf.value = r.baseHalf * ARC_HALO;
      }
    });
    var dim = selected ? 0.18 : 1;
    if (endPointsBig) endPointsBig.material.opacity = 0.95 * dim;
    if (endPointsSmall) endPointsSmall.material.opacity = 0.75 * dim;
    if (particles) particles.material.opacity = 0.9 * (selected ? 0.3 : 1);
    shipDot.visible = !!selected;

    var r = selected ? routeByName[selected] : null;
    drawHighlight(r ? r.iso : null);
    if (r) {
      setLabelText(selLabel, r.name,
        (r.port && r.port !== r.name ? r.port + ' · ' : '') +
        U.fmtVolume(r.value) + ' тыс. т');
    }
  }

  function focus(name) {
    var r = routeByName[name];
    if (!r) return;
    var origin = toVec3(cfg.origin.lat, cfg.origin.lon, R);
    var mid = slerp(origin, r.dest, 0.5).normalize();
    var ll = vecToLatLon(mid);
    var a = faceAngles(ll.lat, ll.lon);
    var angle = Math.acos(Math.max(-1, Math.min(1, origin.dot(r.dest.clone().normalize()))));
    // чем длиннее маршрут, тем дальше камера — чтобы дуга влезла целиком.
    // Верхняя граница своя (focusMaxZoom), а не defaultZoom: в зелёной теме
    // глобус на «Карте» крупнее, но экран «Путь» от этого меняться не должен.
    var far = gcfg.focusMaxZoom != null ? gcfg.focusMaxZoom : gcfg.defaultZoom;
    var zoom = U.clamp(gcfg.focusZoom + angle * 0.55, gcfg.focusZoom, far);
    animateTo({ phi: U.clamp(a.phi, -1.2, 1.2), theta: a.theta, zoom: zoom, fx: 0.55, fy: 0.51 }, 1000);
    autoRotate = false;
  }

  function resetView() {
    animateTo({ phi: HOME.phi, theta: HOME.theta, zoom: gcfg.defaultZoom, fx: HOME.fx, fy: HOME.fy }, 800);
    autoRotate = true;
  }

  function setLayout(mode) {
    if (mode === 'A') {
      animateTo({ fx: HOME.fx, fy: HOME.fy }, 700);
    } else {
      animateTo({ fx: 0.55, fy: 0.51 }, 700);
    }
  }

  function animateTo(to, dur) {
    var from = { phi: view.phi, theta: view.theta, zoom: view.zoom, fx: view.fx, fy: view.fy };
    var goal = {
      phi: to.phi != null ? to.phi : from.phi,
      zoom: to.zoom != null ? to.zoom : from.zoom,
      fx: to.fx != null ? to.fx : from.fx,
      fy: to.fy != null ? to.fy : from.fy,
      theta: from.theta
    };
    if (to.theta != null) {
      var d = (to.theta - from.theta) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      goal.theta = from.theta + d;
    }
    target = { from: from, to: goal, t0: performance.now(), dur: dur || 800 };
  }

  /* ---------------------------- управление ---------------------------- */

  var pointers = {};
  var dragging = false, pinchStart = 0, zoomStart = 0;
  var tapInfo = null;

  function bindPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(pointers).length;
      onInteract();
      if (n === 1) {
        dragging = true;
        tapInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
        target = null;
        autoRotate = false;
      } else if (n === 2) {
        dragging = false;
        tapInfo = null;
        pinchStart = pinchDist();
        zoomStart = view.zoom;
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      var n = Object.keys(pointers).length;
      onInteract();

      if (n === 1 && dragging) {
        if (tapInfo) tapInfo.moved += Math.abs(dx) + Math.abs(dy);
        var k = 0.0055 * (view.zoom / 3);
        view.theta -= dx * k;
        view.phi = U.clamp(view.phi + dy * k, -1.35, 1.35);
      } else if (n === 2) {
        var d = pinchDist();
        if (pinchStart > 4 && d > 4) {
          view.zoom = U.clamp(zoomStart * (pinchStart / d), gcfg.minZoom, gcfg.maxZoom);
        }
      }
    });

    function release(e) {
      if (tapInfo && Object.keys(pointers).length === 1 &&
          tapInfo.moved < 12 && performance.now() - tapInfo.t < 500) {
        var name = pick(e.clientX, e.clientY);
        if (name) onPick(name);
      }
      delete pointers[e.pointerId];
      if (!Object.keys(pointers).length) { dragging = false; tapInfo = null; }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', function (e) {
      delete pointers[e.pointerId];
      dragging = false; tapInfo = null;
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      onInteract();
      target = null;
      autoRotate = false;
      view.zoom = U.clamp(view.zoom * (1 + Math.sign(e.deltaY) * 0.10), gcfg.minZoom, gcfg.maxZoom);
    }, { passive: false });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function pinchDist() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return 0;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /*
   * Попадание пальцем считается в экранных координатах: узлы дуг проецируются
   * на холст и сравниваются с точкой касания по расстоянию в пикселях. Допуск
   * не зависит от приближения — на общем плане в тонкую дугу попасть так же
   * легко, как раньше по толстой невидимой трубке, а вблизи соседние маршруты
   * не перехватывают касание. Заодно из сцены ушли 226 служебных объектов.
   */
  var HIT_ARC_PX = 14;                  // допуск по дуге
  var HIT_DOT_PX = 22;                  // допуск по маркеру страны
  var hitM = new THREE.Matrix4();
  var hv = new THREE.Vector3(), hd = new THREE.Vector3(), hc = new THREE.Vector3();
  var hpx = [], hpy = [], hvis = [];

  /** Точка мира видна, если отрезок «камера → точка» не протыкает планету. */
  function frontOf(p) {
    hd.copy(p).sub(camera.position);
    var dd = hd.lengthSq();
    var t = dd > 1e-9 ? -camera.position.dot(hd) / dd : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    hc.copy(camera.position).addScaledVector(hd, t);
    return hc.lengthSq() > 0.995 * 0.995;
  }

  /** Квадрат расстояния от точки до отрезка на экране. */
  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var dd = dx * dx + dy * dy;
    var t = dd > 1e-6 ? ((px - ax) * dx + (py - ay) * dy) / dd : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }

  function pick(clientX, clientY) {
    if (!routes.length) return null;
    var rect = canvas.getBoundingClientRect();
    var W = canvas.clientWidth || 1920;
    var H = canvas.clientHeight || 1080;
    var px = (clientX - rect.left) / rect.width * W;
    var py = (clientY - rect.top) / rect.height * H;

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    hitM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(world.matrixWorld);

    var dotBest = null, dotD2 = HIT_DOT_PX * HIT_DOT_PX;
    var arcBest = null, arcD2 = HIT_ARC_PX * HIT_ARC_PX;

    for (var i = 0; i < routes.length; i++) {
      var r = routes[i], pts = r.pts, n = pts.length;

      // маркер страны — по нему целиться проще, поэтому он в приоритете
      hv.copy(r.dest).multiplyScalar(1.005).applyMatrix4(world.matrixWorld);
      if (frontOf(hv)) {
        hv.copy(r.dest).multiplyScalar(1.005).applyMatrix4(hitM);
        var dx = (hv.x * 0.5 + 0.5) * W - px, dy = (-hv.y * 0.5 + 0.5) * H - py;
        var d2 = dx * dx + dy * dy;
        if (d2 < dotD2) { dotD2 = d2; dotBest = r.name; }
      }

      for (var k = 0; k < n; k++) {
        hv.copy(pts[k]).applyMatrix4(world.matrixWorld);
        hvis[k] = frontOf(hv);
        hv.copy(pts[k]).applyMatrix4(hitM);
        hpx[k] = (hv.x * 0.5 + 0.5) * W;
        hpy[k] = (-hv.y * 0.5 + 0.5) * H;
      }
      for (var s = 0; s < n - 1; s++) {
        if (!hvis[s] && !hvis[s + 1]) continue;
        var sd = segDist2(px, py, hpx[s], hpy[s], hpx[s + 1], hpy[s + 1]);
        if (sd < arcD2) { arcD2 = sd; arcBest = r.name; }
      }
    }
    return dotBest || arcBest;
  }

  /* ------------------------------ цикл ------------------------------ */

  var partVec = new THREE.Vector3();

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0.016;
    lastFrame = now;

    if (target) {
      var p = U.clamp((now - target.t0) / target.dur, 0, 1);
      var e = U.easeInOutCubic(p);
      view.phi = target.from.phi + (target.to.phi - target.from.phi) * e;
      view.theta = target.from.theta + (target.to.theta - target.from.theta) * e;
      view.zoom = target.from.zoom + (target.to.zoom - target.from.zoom) * e;
      view.fx = target.from.fx + (target.to.fx - target.from.fx) * e;
      view.fy = target.from.fy + (target.to.fy - target.from.fy) * e;
      applyViewOffset();
      if (p >= 1) target = null;
    } else if (autoRotate && !Object.keys(pointers).length) {
      view.theta -= gcfg.autoRotateSpeed * dt;
    }

    pivotTilt.rotation.x = view.phi;
    pivotSpin.rotation.y = view.theta;
    camera.position.z = view.zoom;

    stepDrawAnim(now);

    // бегущие частицы вдоль всех дуг — один буфер на кадр
    if (particles) {
      var arr = particles.geometry.attributes.position.array;
      var t = now * 0.001, n = 0;
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        for (var k = 0; k < PPA; k++) {
          var f = (t * (0.10 + 0.05 * r.norm) + r.phase + k / PPA) % 1;
          pointAt(r, f, partVec);
          arr[n++] = partVec.x; arr[n++] = partVec.y; arr[n++] = partVec.z;
        }
      }
      particles.geometry.attributes.position.needsUpdate = true;
    }

    if (selected && routeByName[selected]) {
      shipDot.position.copy(pointAt(routeByName[selected], (now * 0.00016) % 1, partVec));
    }

    renderer.render(scene, camera);
    updateLabels();
  }

  /* ------------------------------ API ------------------------------ */

  global.Globe = {
    init: init,
    setRoutes: setRoutes,
    setSelected: setSelected,
    focus: focus,
    resetView: resetView,
    setLayout: setLayout,
    setAutoRotate: function (v) { autoRotate = v; },
    resize: resize,
    /**
     * Отладочный/демонстрационный вид: точка на глобусе и расстояние камеры.
     * Вызывается из app.js по параметрам адресной строки (см. README).
     * zoom подменяет цель уже запущенного перелёта, поэтому его можно
     * сочетать с focus() — камера долетит до маршрута и остановится ближе.
     */
    setDebugView: function (o) {
      if (o.lat != null && o.lon != null) {
        target = null;
        autoRotate = false;
        var a = faceAngles(o.lat, o.lon);
        view.phi = U.clamp(a.phi, -1.35, 1.35);
        view.theta = a.theta;
      }
      if (o.zoom != null) {
        var z = U.clamp(o.zoom, 1.15, gcfg.maxZoom);   // ближе minZoom — только для отладки
        if (target) target.to.zoom = z; else view.zoom = z;
      }
      if (o.rotate === false) autoRotate = false;
      applyViewOffset();
    },
    // для отладки: попадание по экранным координатам
    _pick: function (x, y) { return pick(x, y); },
    _project: function (lat, lon) {
      scene.updateMatrixWorld(true);
      var v = toVec3(lat, lon, R * 1.006);
      world.localToWorld(v);
      var front = v.z > 0 || v.clone().sub(camera.position).length() < camera.position.length();
      v.project(camera);
      var rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
        front: front
      };
    },
    // для отладки: экранные координаты узлов дуги
    _arcScreen: function (name) {
      var r = routeByName[name];
      if (!r) return null;
      scene.updateMatrixWorld(true);
      var rect = canvas.getBoundingClientRect();
      var out = [];
      for (var i = 0; i < r.pts.length; i++) {
        var v = r.pts[i].clone().applyMatrix4(world.matrixWorld).project(camera);
        out.push([rect.left + (v.x * 0.5 + 0.5) * rect.width,
          rect.top + (-v.y * 0.5 + 0.5) * rect.height]);
      }
      return out;
    },
    _stats: function () {
      return {
        routes: routes.length,
        calls: renderer.info.render.calls,
        tris: renderer.info.render.triangles,
        zoom: +view.zoom.toFixed(3),
        pxK: uPxK.value,
        maxTex: renderer.capabilities.maxTextureSize,
        lights: earth.material.emissiveMap && earth.material.emissiveMap.image
          ? earth.material.emissiveMap.image.width : 0,
        land: earth.material.map && earth.material.map.image
          ? earth.material.map.image.width : 0,
        borderSegs: borders.geometry.attributes.position.count / 6,
        ship: shipDot.visible ? (function () {
          var v = shipDot.position.clone().applyMatrix4(world.matrixWorld).project(camera);
          return [Math.round((v.x * 0.5 + 0.5) * (canvas.clientWidth || 1920)),
            Math.round((-v.y * 0.5 + 0.5) * (canvas.clientHeight || 1080))];
        })() : null
      };
    }
  };
})(window);
