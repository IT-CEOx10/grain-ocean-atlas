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

  // текстуры из снимков NASA, готовит tools/make_earth_textures.py
  var TEX_LIGHTS = 'assets/textures/earth_night_4096.jpg';   // огни городов
  var TEX_ATMOS = 'assets/textures/earth_land_2048.jpg';     // подложка суши

  var cfg, colors, gcfg;
  var renderer, scene, camera, canvas;
  var pivotTilt, pivotSpin, world;      // tilt(rot.x) > spin(rot.y) > world
  var earth, borders, highlight, atmo, halo;
  var arcGroup, hitGroup, shipDot, originDot;
  var endPointsBig = null, endPointsSmall = null, particles = null;

  var topoFeatures = null;              // контуры стран для подсветки
  var highlightCtx = null, highlightTex = null, highlightIso = null;

  var routes = [];                      // [{name, curve, mesh, hit, value, norm}]
  var routeByName = {};
  var selected = null;

  // домашний ракурс: Россия, Чёрное море, Ближний Восток, Африка, Индия
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

  /* --------------------------- контуры стран --------------------------- */

  /**
   * Рисует контур страны на холсте текстуры (равнопрямоугольная проекция).
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

  /** Едва заметная сетка границ поверх ночной Земли. */
  function buildBordersTexture(topo) {
    var W = 4096, H = 2048;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    topoFeatures = topojson.feature(topo, topo.objects.countries).features;

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colors.border;
    for (var i = 0; i < topoFeatures.length; i++) {
      tracePath(ctx, topoFeatures[i], W, H);
      ctx.stroke();
    }

    var tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  /** Отдельный слой: тёплый контур выбранной страны. */
  function buildHighlightTexture() {
    var W = 2048, H = 1024;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    highlightCtx = cv.getContext('2d');
    highlightCtx.lineJoin = 'round';
    highlightTex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) highlightTex.colorSpace = THREE.SRGBColorSpace;
    highlightTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return highlightTex;
  }

  function drawHighlight(iso) {
    if (!highlightCtx || highlightIso === iso) return;
    highlightIso = iso;
    var W = 2048, H = 1024;
    highlightCtx.clearRect(0, 0, W, H);
    if (iso && topoFeatures) {
      for (var i = 0; i < topoFeatures.length; i++) {
        if (String(topoFeatures[i].id) !== String(iso)) continue;
        tracePath(highlightCtx, topoFeatures[i], W, H);
        highlightCtx.fillStyle = colors.highlightFill;
        highlightCtx.fill('evenodd');
        highlightCtx.lineWidth = 2.2;
        highlightCtx.strokeStyle = colors.highlight;
        highlightCtx.stroke();
        break;
      }
    }
    highlightTex.needsUpdate = true;
    highlight.visible = !!iso;
  }

  /** Круглое мягкое свечение — общая текстура точек и спрайтов. */
  function glowTexture(rgb) {
    var s = 64;
    var cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var ctx = cv.getContext('2d');
    var gr = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)');
    gr.addColorStop(0.25, 'rgba(' + rgb + ',.55)');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, s, s);
    var t = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  var TEX_GOLD = null, TEX_WHITE = null;

  /* ----------------------- ободок и свечение ----------------------- */

  var RIM_VERT =
    'varying vec3 vN; varying vec3 vP;' +
    'void main(){ vN = normalize(normalMatrix * normal);' +
    'vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;' +
    'gl_Position = projectionMatrix * mv; }';

  function rimMaterial(color, power, strength) {
    return new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.BackSide, depthWrite: false,
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

  /* ------------------------------ сцена ------------------------------ */

  function init(opts) {
    canvas = opts.canvas;
    cfg = opts.config;
    colors = cfg.colors;
    gcfg = cfg.globe;
    onPick = opts.onPick || onPick;
    onInteract = opts.onInteract || onInteract;
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    var dir = new THREE.DirectionalLight(0x9fc0ff, 0.45);
    dir.position.set(-2, 1.4, 2.2);
    scene.add(dir);

    TEX_GOLD = glowTexture('255,205,120');
    TEX_WHITE = glowTexture('255,240,214');

    // ночная Земля: очень тёмная суша (карта) + тёплые огни городов (emissive)
    var earthMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(colors.land),
      specular: new THREE.Color(colors.ocean),
      shininess: 6,
      emissive: new THREE.Color(colors.cityLights),
      emissiveIntensity: 2.0
    });
    var loader = new THREE.TextureLoader();
    loader.load(U.asset(TEX_ATMOS), function (t) {
      if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthMat.map = t; earthMat.needsUpdate = true;
    });
    loader.load(U.asset(TEX_LIGHTS), function (t) {
      if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthMat.emissiveMap = t; earthMat.needsUpdate = true;
    });
    earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), earthMat);
    world.add(earth);

    // едва заметные границы стран
    borders = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.0012, 96, 64),
      new THREE.MeshBasicMaterial({
        map: buildBordersTexture(opts.topo),
        transparent: true, opacity: 0.28, depthWrite: false
      })
    );
    borders.renderOrder = 1;
    world.add(borders);

    // тёплый контур выбранной страны
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

    // синий ободок атмосферы и мягкое внешнее свечение
    atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 64, 48),
      rimMaterial(colors.atmosphere, 6.5, 0.50));
    world.add(atmo);
    halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.13, 48, 32),
      rimMaterial(colors.halo, 4.5, 0.15));
    world.add(halo);

    arcGroup = new THREE.Group();
    hitGroup = new THREE.Group();
    hitGroup.visible = false;           // не рисуем, но лучами проверяем
    world.add(arcGroup);
    world.add(hitGroup);

    // точка отправления
    var o = cfg.origin;
    originDot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_WHITE, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    originDot.position.copy(toVec3(o.lat, o.lon, R * 1.004));
    originDot.scale.setScalar(0.062);
    world.add(originDot);

    // «корабль» — светящаяся точка, бегущая по выбранному маршруту
    shipDot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX_WHITE, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    shipDot.scale.setScalar(0.06);
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
    applyViewOffset();
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
      hitGroup.remove(r.hit);
      r.hit.geometry.dispose();
      if (r.hitDot) { hitGroup.remove(r.hitDot); r.hitDot.geometry.dispose(); }
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

  var hitMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

  function endPoints(list, size, opacity) {
    if (!list.length) return null;
    var pos = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i].dest.clone().multiplyScalar(1.004);
      pos.push(d.x, d.y, d.z);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var p = new THREE.Points(g, new THREE.PointsMaterial({
      size: size, sizeAttenuation: true, map: TEX_GOLD,
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

      var radius = 0.0019 + 0.0072 * norm * norm;   // толщина по лог-шкале объёма
      var opacity = 0.26 + 0.42 * norm;
      var geo = new THREE.TubeGeometry(curve, N, radius, 6, false);
      var mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.route),
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 3;
      arcGroup.add(mesh);

      // невидимая «толстая» геометрия под палец
      var hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.022, 4, false), hitMat);
      hit.userData.name = it.name;
      hitGroup.add(hit);

      var hitDot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), hitMat);
      hitDot.position.copy(dest.clone().multiplyScalar(1.005));
      hitDot.userData.name = it.name;
      hitDot.userData.dot = true;
      hitGroup.add(hitDot);

      var route = {
        name: it.name, value: it.value, norm: norm, iso: it.iso, port: it.port,
        curve: curve, pts: pts, mesh: mesh, hit: hit, hitDot: hitDot,
        baseOpacity: opacity, dest: dest, phase: Math.random()
      };
      routes.push(route);
      routeByName[it.name] = route;
    });

    // светящиеся точки на концах: два размера — крупные направления заметнее
    var big = routes.slice(0, 8), small = routes.slice(8);
    endPointsBig = endPoints(big, 0.085, 0.95);
    endPointsSmall = endPoints(small, 0.05, 0.75);

    // бегущие частицы: один Points-объект на все дуги
    if (routes.length) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position',
        new THREE.Float32BufferAttribute(new Float32Array(routes.length * PPA * 3), 3));
      particles = new THREE.Points(g, new THREE.PointsMaterial({
        size: 0.022, sizeAttenuation: true, map: TEX_GOLD,
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

  function setSelected(name) {
    selected = name && routeByName[name] ? name : null;
    routes.forEach(function (r) {
      var isSel = r.name === selected;
      if (!selected) {
        r.mesh.material.color.set(colors.route);
        r.mesh.material.opacity = r.baseOpacity;
      } else if (isSel) {
        r.mesh.material.color.set(colors.routeActive);
        r.mesh.material.opacity = Math.min(1, r.baseOpacity + 0.35);
      } else {
        r.mesh.material.color.set(colors.route);
        r.mesh.material.opacity = r.baseOpacity * 0.15;   // остальные приглушены
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
    // чем длиннее маршрут, тем дальше камера — чтобы дуга влезла целиком
    var zoom = U.clamp(gcfg.focusZoom + angle * 0.55, gcfg.focusZoom, gcfg.defaultZoom);
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

  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    if (!routes.length) return null;
    var rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    scene.updateMatrixWorld(true);
    var hits = raycaster.intersectObjects(hitGroup.children, false);
    if (!hits.length) return null;

    // отсекаем попадания на обратной стороне планеты
    var globeHit = raycaster.intersectObject(earth, false);
    var limit = globeHit.length ? globeHit[0].distance + 0.06 : Infinity;
    // сперва маркеры стран (по ним целиться проще), потом дуги
    var arc = null;
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].distance > limit) continue;
      if (hits[i].object.userData.dot) return hits[i].object.userData.name;
      if (!arc) arc = hits[i].object.userData.name;
    }
    return arc;
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
    _showHits: function (on) { hitGroup.visible = !!on; },
    _stats: function () {
      return { routes: routes.length, hits: hitGroup.children.length, calls: renderer.info.render.calls };
    }
  };
})(window);
