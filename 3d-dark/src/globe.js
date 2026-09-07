/* ===================================================================
   Глобус: земля с текстурой-картой, дуги маршрутов, маркеры,
   управление касанием (одним пальцем — вращение, двумя — зум).
   Наружу отдаёт объект window.Globe.
   =================================================================== */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var R = 1;

  var cfg, colors, gcfg;
  var renderer, scene, camera, canvas;
  var pivotTilt, pivotSpin, world;      // tilt(rot.x) > spin(rot.y) > world
  var earth, atmo;
  var arcGroup, hitGroup, shipDot;
  var markerPoints = null, originPoints = null;

  var routes = [];                      // [{name, curve, mesh, hit, value, norm}]
  var routeByName = {};
  var selected = null;

  var view = { phi: 0.28, theta: -1.9, zoom: 4.6, fx: 0.57, fy: 0.48 };
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

  /* --------------------------- текстура карты --------------------------- */

  function buildEarthTexture(topo) {
    var W = 4096, H = 2048;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    ctx.fillStyle = colors.ocean;
    ctx.fillRect(0, 0, W, H);

    var fc = topojson.feature(topo, topo.objects.countries);

    // Некоторые страны (Россия, Фиджи) заданы одним кольцом, пересекающим
    // 180-й меридиан. Если рисовать «в лоб», долгота прыгает с 180 на -180 и
    // через всю текстуру протягивается ложная линия. Поэтому долготы
    // разворачиваются в непрерывную последовательность, а кольцо рисуется
    // трижды — со сдвигом на -W, 0 и +W; лишнее обрезает холст.
    var SHIFTS = [-W, 0, W];

    function path(feature) {
      var g = feature.geometry;
      if (!g) return;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
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

    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;

    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i];
      var isRu = String(f.id) === '643';
      ctx.fillStyle = isRu ? colors.russia : colors.land;
      ctx.strokeStyle = isRu ? colors.russiaBorder : colors.landBorder;
      path(f);
      ctx.fill('evenodd');
      ctx.stroke();
    }

    var tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  function dotTexture(hex) {
    var s = 64;
    var cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var ctx = cv.getContext('2d');
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    var t = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ------------------------------ сцена ------------------------------ */

  function init(opts) {
    canvas = opts.canvas;
    cfg = opts.config;
    colors = cfg.colors;
    gcfg = cfg.globe;
    onPick = opts.onPick || onPick;
    onInteract = opts.onInteract || onInteract;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, view.zoom);

    pivotTilt = new THREE.Group();
    pivotSpin = new THREE.Group();
    world = new THREE.Group();
    pivotTilt.add(pivotSpin);
    pivotSpin.add(world);
    scene.add(pivotTilt);

    earth = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 64),
      new THREE.MeshBasicMaterial({ map: buildEarthTexture(opts.topo) })
    );
    world.add(earth);

    // мягкий ободок вокруг планеты
    atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.018, 64, 40),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.accent),
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
        depthWrite: false
      })
    );
    scene.add(atmo);
    atmo.visible = true;

    arcGroup = new THREE.Group();
    hitGroup = new THREE.Group();
    hitGroup.visible = false;           // не рисуем, но лучами проверяем
    world.add(arcGroup);
    world.add(hitGroup);

    // точка отправления
    var o = cfg.origin;
    originPoints = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position',
        new THREE.Float32BufferAttribute(toVec3(o.lat, o.lon, R * 1.006).toArray(), 3)),
      new THREE.PointsMaterial({
        size: 15, sizeAttenuation: false, map: dotTexture(colors.origin),
        transparent: true, alphaTest: 0.4, depthWrite: false
      })
    );
    world.add(originPoints);

    shipDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.routeActive) })
    );
    shipDot.visible = false;
    world.add(shipDot);

    bindPointer();
    resize();
    global.addEventListener('resize', resize);
    requestAnimationFrame(loop);
  }

  function resize() {
    var w = canvas.clientWidth || 1868;
    var h = canvas.clientHeight || 1028;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyViewOffset();
  }

  function applyViewOffset() {
    var w = canvas.clientWidth || 1868;
    var h = canvas.clientHeight || 1028;
    camera.setViewOffset(w, h, -(view.fx - 0.5) * w, -(view.fy - 0.5) * h, w, h);
    camera.updateProjectionMatrix();
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
    if (markerPoints) {
      world.remove(markerPoints);
      markerPoints.geometry.dispose();
      markerPoints.material.dispose();
      markerPoints = null;
    }
  }

  var hitMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

  /**
   * items: [{name, lat, lon, value}] — только страны с объёмом > 0.
   * animate: рисовать дуги «от РФ к стране».
   */
  function setRoutes(items, animate) {
    disposeRoutes();
    selected = null;
    shipDot.visible = false;

    var origin = toVec3(cfg.origin.lat, cfg.origin.lon, R);
    var maxV = 0, minV = Infinity;
    items.forEach(function (it) {
      if (it.value > maxV) maxV = it.value;
      if (it.value < minV) minV = it.value;
    });
    var lgMin = Math.log10(Math.max(minV, 1e-4));
    var lgMax = Math.log10(Math.max(maxV, 1e-3));
    var span = Math.max(lgMax - lgMin, 0.001);

    var positions = [];

    items.forEach(function (it) {
      var norm = (Math.log10(Math.max(it.value, 1e-4)) - lgMin) / span;
      norm = Math.max(0, Math.min(1, norm));

      var dest = toVec3(it.lat, it.lon, R);
      var angle = Math.acos(Math.max(-1, Math.min(1, origin.dot(dest))));
      var alt = 0.06 + 0.22 * (angle / Math.PI);

      var pts = [];
      var N = gcfg.arcSegments;
      for (var i = 0; i <= N; i++) {
        var t = i / N;
        var p = slerp(origin, dest, t);
        p.multiplyScalar(1 + alt * Math.sin(Math.PI * t));
        pts.push(p);
      }
      var curve = new THREE.CatmullRomCurve3(pts);

      var radius = 0.0013 + 0.0050 * Math.pow(norm, 1.15);
      var geo = new THREE.TubeGeometry(curve, N, radius, 7, false);
      var mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.route),
        transparent: true,
        opacity: 0.30 + 0.55 * norm,
        depthWrite: false
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
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

      var d = dest.clone().multiplyScalar(1.006);
      positions.push(d.x, d.y, d.z);

      var route = {
        name: it.name, value: it.value, norm: norm,
        curve: curve, mesh: mesh, hit: hit, hitDot: hitDot,
        baseOpacity: 0.30 + 0.55 * norm, dest: dest
      };
      routes.push(route);
      routeByName[it.name] = route;
    });

    if (positions.length) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      markerPoints = new THREE.Points(g, new THREE.PointsMaterial({
        size: 9, sizeAttenuation: false, map: dotTexture(colors.marker),
        transparent: true, alphaTest: 0.4, depthWrite: false
      }));
      markerPoints.renderOrder = 3;
      world.add(markerPoints);
    }

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
        r.mesh.material.opacity = 1;
      } else {
        r.mesh.material.color.set(colors.route);
        r.mesh.material.opacity = 0.05;
      }
    });
    if (markerPoints) markerPoints.material.opacity = selected ? 0.25 : 1;
    shipDot.visible = !!selected;
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
    animateTo({ phi: U.clamp(a.phi, -1.2, 1.2), theta: a.theta, zoom: zoom, fx: 0.58, fy: 0.47 }, 1000);
    autoRotate = false;
  }

  function resetView() {
    animateTo({ phi: 0.28, theta: -1.9, zoom: gcfg.defaultZoom, fx: 0.57, fy: 0.48 }, 800);
    autoRotate = true;
  }

  function setLayout(mode) {
    if (mode === 'A') {
      animateTo({ fx: 0.57, fy: 0.48 }, 700);
    } else {
      animateTo({ fx: 0.58, fy: 0.47 }, 700);
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

    if (selected && routeByName[selected]) {
      var t = (now * 0.00016) % 1;
      shipDot.position.copy(routeByName[selected].curve.getPoint(t));
    }

    renderer.render(scene, camera);
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
    _stats: function () { return { routes: routes.length, hits: hitGroup.children.length }; }
  };
})(window);
