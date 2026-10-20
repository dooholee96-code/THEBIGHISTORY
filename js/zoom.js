/* ------------------------------------------------------------------
   탐험 — 역사 전체를 한 장의 거대한 그림(캔버스)으로 (ChronoZoom · Prezi 에서 얻은 생각)

   세로 = 시간(위가 옛날), 가로 = 카테고리마다 한 열(국가사 → 주제사).
   그림은 화면보다 크고, 상하좌우 어디로든 끌고 던질 수 있다.
     · 핀치·휠로 줌 — 시간축과 열 너비가 함께 커지고 작아진다.
       멀리서 보면 모든 열이 시대 띠를 가로지르는 포스터, 다가가면 열이 넓어져 카드가 펼쳐진다
     · 시간 눈금은 줌에 맞춰 1만 년 → 1천 년 → 100년 → 10년 → 1년
     · 열마다 사건이 자리를 잡는다: 넉넉하면 카드, 빠듯하면 이름표, 더 빠듯하면 점, 그래도 안 되면 '+N'
       (중요한 것부터 — 나라·왕조 > 시대 > 나머지)
     · 국가사 열 왼쪽 가는 띠 = 그 나라의 왕조·시대가 이어진 기간(겹치면 나란히)
     · 열 이름은 화면 위에, 시대 이름은 화면 왼쪽에 붙어 따라온다
     · 먼 곳으로 갈 때는 잠깐 물러났다 다가가는 비행(Prezi 의 장면 전환)
     · 끝에 닿아도 벽처럼 멈추지 않는다 — 손가락을 따라 고무줄처럼 늘어났다가 놓으면 튕겨 돌아온다
     · 눕히기(스타워즈 오프닝처럼) — 두 손가락을 나란히 위아래로 밀거나 Alt(Option)+휠, Alt+끌기, T 키.
       과거가 저 멀리, 지금이 코앞에 오도록 그림판이 뒤로 눕는다

   캔버스가 두 장이다.
     · 판(plane)  — 열·사건·왕조 띠·연도 눈금. 눕히면 CSS 3D 로 기울어진다(판 좌표계는 그대로).
     · 덮개(#zoom) — 화면에 납작하게 붙은 열 이름·시대 이름. 손가락 입력도 여기서 받아
                     원근을 거꾸로 풀어 판 좌표로 바꾼다. 그래서 눕혀도 손가락 밑의 점이 그대로 따라온다.

   선형 시간이라 선사(3만 년)가 길고 문명사는 아래쪽에 모여 있다 — 그것이 빅 히스토리의 실제 비율.
   그리기는 <canvas> 하나. 화면이 움직일 때만 다시 그린다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var S_MAX = 260;           // 최대 줌(1년당 px)
  var FRICTION = 2.3;        // 던진 뒤 감속(작을수록 멀리 미끄러진다)
  var RUBBER = 0.55;         // 끝을 넘겨 끌 때 따라오는 비율(iOS 의 고무줄)
  var SPRING = 13;           // 넘친 만큼 되돌아오는 빠르기
  var TILT_MAX = 60 * Math.PI / 180;   // 가장 많이 눕혔을 때
  var TILT_SNAP = 5 * Math.PI / 180;   // 이보다 덜 눕힌 채 손을 떼면 납작하게 돌아온다
  var TILT_ON = 40 * Math.PI / 180;    // T 키로 눕힐 때
  var CARD_H = 56;
  var LABEL_H = 24;
  var DOT = 12;
  var UNIT = 8;              // 자리 잡기 격자(px)
  var HEAD_H = 34;           // 위에 붙는 열 이름 줄
  var COL_MAX = 270;         // 열 너비(가장 가까이)
  var COL_MIN = 46;          // 열 너비(가장 멀리)
  var STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  var KIND_RANK = { polity: 0, era: 1 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function yearText(y) { return y < 0 ? '기원전 ' + Math.abs(y) : String(y); }
  function now() { return global.performance ? performance.now() : Date.now(); }

  /** 시간 줌(1년당 px)에 따라 열 너비가 함께 변한다 — 한 장의 그림을 줌하는 느낌 */
  function colWidth(s) { return clamp(COL_MAX * Math.pow(s / 2, 0.35), COL_MIN, COL_MAX); }

  /** 겹치는 기간을 나란한 줄로 나눈다(시작 순서대로 빈 줄에) */
  function packLanes(list) {
    var lanes = [];
    list.slice().sort(function (a, b) { return a.start_year - b.start_year || (b.end_year - a.end_year); })
      .forEach(function (e) {
        for (var i = 0; i < lanes.length; i += 1) {
          if (lanes[i] <= e.start_year) { lanes[i] = e.end_year; e.lane = i; return; }
        }
        lanes.push(e.end_year);
        e.lane = lanes.length - 1;
      });
    return lanes.length;
  }

  /**
   * @param canvas  <canvas id="zoom">
   * @param opts    { eras, present, focusY(): px, onCamera(info), openEntry(entry) }
   */
  function create(canvas, opts) {
    var plane = opts.plane;                 // 눕는 판
    var octx = canvas.getContext('2d');     // 납작한 덮개
    var pctx = plane.getContext('2d');
    var ctx = pctx;                         // 지금 그리는 쪽(그리기 도우미들이 함께 쓴다)
    var dpr = 1;
    var pdpr = 1;
    var W = 0;
    var H = 0;      // 판 높이 — 눕히면 화면보다 길어진다(먼 곳까지)
    var Hv = 0;     // 화면(덮개) 높이
    // 원근 — on 이면 판이 커져 있다. th 는 눕힌 각도(0 이어도 on 일 수 있다)
    var geo = { on: false, th: 0, c: 1, s: 0, P: 1000, yP: 0, Dtop: 0, B: 0 };
    var tilt = { cur: 0, target: 0, snapTimer: 0 };
    var active = false;
    var raf = 0;
    var lastT = 0;

    var eras = opts.eras;
    var T_MIN = eras[0].start_year;
    var T_MAX = eras[eras.length - 1].end_year;
    var PRESENT = opts.present || T_MAX;

    var cols = [];   // { ds, events(우선순위 순), spans, laneN }
    var cam = { t0: -4200, s: 0.1, u0: 0 };   // 맨 위의 해, 1년당 px, 화면 왼쪽 끝의 열 위치(열 단위)
    var motion = { mode: 'idle', vt: 0, vu: 0, fly: null, zoomTo: null };
    var pointers = {};
    var gesture = null;
    var hits = [];
    var colors = {};
    var labelWidth = {};
    var lastTap = null;

    // ----------------------------------------------------------- 좌표

    function narrow() { return W < 640; }
    function axisW() { return narrow() ? 58 : 84; }
    function originX() { return axisW() + 8; }
    function viewW() { return Math.max(1, W - originX() - 8); }
    function cw() { return colWidth(cam.s); }
    function focusY() { return unproj(W / 2, opts.focusY ? opts.focusY() : Hv * 0.36).y; }
    function yOf(year) { return (year - cam.t0) * cam.s; }
    function yearAt(y) { return cam.t0 + y / cam.s; }
    function xOfCol(u) { return originX() + (u - cam.u0) * cw(); }
    function colAt(x) { return cam.u0 + (x - originX()) / cw(); }
    function sMin() { return (Hv * 0.92) / (T_MAX - T_MIN); }

    // ----------------------------------------------------------- 원근

    /** 판 위의 점 → 화면. f 는 그 깊이에서의 축소 비율 */
    function proj(x, y) {
      if (!geo.on) return { x: x, y: y, f: 1 };
      var d = geo.Dtop - y;                       // 회전축(yP)에서 판을 따라 위로 잰 거리
      var f = geo.P / Math.max(geo.P * 0.05, geo.P + d * geo.s);
      return { x: W / 2 + (x - W / 2) * f, y: geo.yP - d * geo.c * f, f: f };
    }

    /** 화면의 점 → 판 위의 점(지평선 너머는 판 끝 너머로 본다) */
    function unproj(x, y) {
      if (!geo.on) return { x: x, y: y, f: 1 };
      var q = geo.yP - y;
      var den = geo.c * geo.P - q * geo.s;
      var dMax = geo.Dtop + Hv;
      var d = den > 1e-3 ? Math.min(dMax, (q * geo.P) / den) : dMax;
      var f = geo.P / (geo.P + d * geo.s);
      return { x: W / 2 + (x - W / 2) / f, y: geo.Dtop - d, f: f };
    }


    /** 카메라가 머물 수 있는 범위 — 초점선의 해는 역사 안, 화면은 열들 안 */
    function limits() {
      var fy = focusY();
      var n = cols.length;
      var vis = viewW() / cw();
      var mid = -(vis - n) / 2;                            // 그림이 화면보다 좁으면 가운데
      return {
        tA: T_MIN - fy / cam.s, tB: T_MAX - fy / cam.s,
        uA: n <= vis ? mid : -0.25, uB: n <= vis ? mid : n - vis + 0.25
      };
    }

    /** 손가락이 끌고 있거나, 던졌거나, 튕겨 돌아오는 중엔 범위를 잠깐 넘어도 된다 */
    function loose() {
      return (gesture && gesture.kind === 'pan') || motion.mode === 'fling' || motion.mode === 'spring';
    }

    function clampCam() {
      cam.s = clamp(cam.s, sMin(), S_MAX);
      if (loose()) return;
      var L = limits();
      cam.t0 = clamp(cam.t0, L.tA, L.tB);
      cam.u0 = clamp(cam.u0, L.uA, L.uB);
    }

    // 넘친 거리 o(px) → 화면에서 실제로 넘어가 보이는 거리. 멀리 끌수록 덜 따라온다
    function band(o, dim) { return (o * RUBBER * dim) / (o * RUBBER + dim); }
    function unband(y, dim) { y = Math.min(y, dim * 0.98); return (y * dim) / (RUBBER * (dim - y)); }

    /** 손가락이 가리키는 자리(raw) → 화면에 보일 자리. 값은 각 축의 단위, k 는 단위당 px */
    function rubber(v, a, b, k, dim) {
      if (v < a) return a - band((a - v) * k, dim) / k;
      if (v > b) return b + band((v - b) * k, dim) / k;
      return v;
    }

    function unrubber(v, a, b, k, dim) {
      if (v < a) return a - unband((a - v) * k, dim) / k;
      if (v > b) return b + unband((v - b) * k, dim) / k;
      return v;
    }

    // ----------------------------------------------------------- 색

    function readColors() {
      var cs = getComputedStyle(document.documentElement);
      var v = function (name, fb) { return (cs.getPropertyValue(name) || '').trim() || fb; };
      colors = {
        ink: v('--ink', '#3a2a24'),
        ink2: v('--ink-2', '#7a6058'),
        inkBg: v('--ink-bg', '#3a2a24'),
        inkBg2: v('--ink-bg-2', '#7a6058'),
        foam: v('--foam', '#fff8ef'),
        sky: v('--sky', '#f3e7d8'),
        line: v('--line-bg', 'rgba(92,61,46,.2)'),
        star: v('--star', '#b57a3e'),
        display: v('--display', 'sans-serif'),
        sans: v('--sans', 'sans-serif')
      };
      labelWidth = {};
    }

    // ----------------------------------------------------------- 데이터

    /**
     * @param entries  지금 켜진 카테고리의 항목들(_dataset, _color, _label, _track)
     * @param columns  켜진 카테고리(열 순서 = 매니페스트 순서)
     */
    function setData(entries, columns) {
      var keepU = cols.length ? cam.u0 : null;
      cols = columns.map(function (ds) {
        var mine = entries.filter(function (e) { return e._dataset === ds.id; });
        var events = mine.slice().sort(function (a, b) {
          var ra = KIND_RANK[a.kind] != null ? KIND_RANK[a.kind] : 2;
          var rb = KIND_RANK[b.kind] != null ? KIND_RANK[b.kind] : 2;
          if (ra !== rb) return ra - rb;
          return (b.end_year - b.start_year) - (a.end_year - a.start_year);
        });
        var spans = ds.track === 'nation'
          ? mine.filter(function (e) { return (e.kind === 'polity' || e.kind === 'era') && e.end_year > e.start_year; })
              .map(function (e) { return { entry: e, start_year: e.start_year, end_year: e.end_year }; })
          : [];
        var laneN = packLanes(spans);
        spans.forEach(function (sp) { sp.lane = Math.min(sp.lane, 2); });   // 3줄을 넘으면 마지막 줄에 겹쳐 그린다
        return { ds: ds, events: events, spans: spans, laneN: Math.min(3, laneN) };
      });
      if (keepU != null) cam.u0 = keepU;
      clampCam();
      invalidate();
    }

    // ----------------------------------------------------------- 그리기

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var wasOn = geo.on;
      if (wasOn) setPlane(false);
      dpr = Math.min(2.5, global.devicePixelRatio || 1);
      W = r.width;
      Hv = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(Hv * dpr);
      if (wasOn) setPlane(true);
      else sizePlane(Hv);
      clampCam();
      invalidate();
    }

    function sizePlane(h) {
      H = h;
      // 판이 길어지면 해상도를 조금 낮춰 메모리를 지킨다(멀리 있는 쪽은 어차피 작게 보인다)
      pdpr = Math.min(dpr, Math.sqrt(14e6 / Math.max(1, W * h)));
      plane.width = Math.round(W * pdpr);
      plane.height = Math.round(h * pdpr);
      plane.style.height = h + 'px';
    }

    /**
     * 판 키우기/되돌리기. 키우면 판이 회전축 위쪽으로 길어지므로(먼 과거까지 보이게)
     * 같은 그림이 같은 자리에 있도록 맨 위의 해(t0)를 그만큼 당겨 둔다.
     */
    function setPlane(on) {
      if (on === geo.on || !W) return;
      motion.mode = 'idle';
      if (on) {
        geo.B = clamp(Hv * 0.16, 80, 150);          // 회전축 아래(계기판·탭에 가리는 쪽)
        geo.yP = Hv - geo.B;
        geo.P = Math.max(Hv * 1.1, 600);
        var h = Math.round(Math.min(Hv * 2.6, Hv + 2400));
        geo.Dtop = h - geo.B;
        cam.t0 -= (h - Hv) / cam.s;
        geo.on = true;
        sizePlane(h);
      } else {
        cam.t0 += (H - Hv) / cam.s;
        geo.on = false;
        geo.th = 0; geo.c = 1; geo.s = 0;
        sizePlane(Hv);
      }
      applyTilt();
    }

    function applyTilt() {
      var st = plane.style;
      if (!geo.on) {
        st.top = '0px';
        st.transform = '';
        st.webkitMaskImage = st.maskImage = '';
        canvas.classList.remove('is-tilted');
        return;
      }
      // 눕히는 동안에도 초점 고리에 걸린 해는 그대로 — 보던 것이 제자리에 있게
      var keep = yearAt(focusY());
      geo.th = tilt.cur;
      geo.c = Math.cos(geo.th);
      geo.s = Math.sin(geo.th);
      cam.t0 = keep - focusY() / cam.s;
      st.top = (geo.yP - geo.Dtop) + 'px';
      st.transformOrigin = '50% ' + geo.Dtop + 'px';
      st.transform = 'perspective(' + geo.P.toFixed(0) + 'px) rotateX(' + (geo.th * 180 / Math.PI).toFixed(2) + 'deg)';
      // 먼 끝은 별빛 속으로 사라지듯
      var fade = 'linear-gradient(to bottom, transparent 0, #000 ' + (geo.th > 0.02 ? 22 : 0) + '%)';
      st.webkitMaskImage = st.maskImage = fade;
      canvas.classList.toggle('is-tilted', geo.th > 0.02);
    }

    /** 각도를 정한다. instant 가 아니면 스르륵 */
    function setTilt(th, instant) {
      th = clamp(th, 0, TILT_MAX);
      tilt.target = th;
      if (th > 0 && !geo.on) setPlane(true);
      if (instant || reduced) {
        tilt.cur = th;
        applyTilt();
        if (th === 0) setPlane(false);
      }
      lastT = 0;
      invalidate();
    }

    /** 손을 뗐을 때 조금만 눕혀져 있으면 납작하게 */
    function settleTilt() {
      if (tilt.target < TILT_SNAP) setTilt(0);
    }

    function stepTilt(dt) {
      if (tilt.cur === tilt.target) return false;
      tilt.cur += (tilt.target - tilt.cur) * (1 - Math.exp(-dt * 9));
      if (Math.abs(tilt.target - tilt.cur) < 0.002) tilt.cur = tilt.target;
      applyTilt();
      if (tilt.cur === 0 && tilt.target === 0) setPlane(false);
      return tilt.cur !== tilt.target;
    }

    function invalidate() {
      if (!active) return;
      if (!raf) raf = global.requestAnimationFrame(frame);
    }

    function roundRect(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function fitText(text, maxW) {
      if (maxW <= 8) return '';
      if (ctx.measureText(text).width <= maxW) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    }

    function draw() {
      ctx = pctx;
      ctx.setTransform(pdpr, 0, 0, pdpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      hits = [];
      var yTop = yearAt(-40);
      var yBot = yearAt(H + 40);
      var c = cw();
      var ax = axisW();
      var focusYear = yearAt(focusY());

      // 1) 시대 띠(아주 옅은 면 + 경계선)와 장면 경계
      eras.forEach(function (era) {
        var a = yOf(era.start_year);
        var b = yOf(era.end_year);
        if (b < -10 || a > H + 10) return;
        ctx.fillStyle = era.strip || '#8c6a4f';
        ctx.globalAlpha = 0.06;
        ctx.fillRect(0, Math.max(a, 0), W, Math.min(b, H) - Math.max(a, 0));
        ctx.globalAlpha = 0.5;
        ctx.fillRect(0, a, W, 1.5);
        ctx.globalAlpha = 1;
        (era.scenes || []).forEach(function (sc, i) {
          if (i === 0) return;
          var y = yOf(sc.start_year);
          if (y < HEAD_H || y > H) return;
          ctx.strokeStyle = colors.line;
          ctx.setLineDash([4, 6]);
          ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(W, y); ctx.stroke();
          ctx.setLineDash([]);
        });
      });

      // 2) 열 — 경계선, 그리고 열마다 왕조 띠와 사건
      var firstCol = Math.max(0, Math.floor(cam.u0) - 1);
      var lastCol = Math.min(cols.length - 1, Math.ceil(cam.u0 + viewW() / c) + 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(ax, 0, W - ax, H); ctx.clip();
      for (var i = firstCol; i <= lastCol; i += 1) {
        var x = xOfCol(i);
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.globalAlpha = 1;
        drawColumn(cols[i], x, c, yTop, yBot, focusYear);
      }
      if (cols.length) {
        var xr = xOfCol(cols.length);
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(xr, 0); ctx.lineTo(xr, H); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // 3) 시간 눈금 — 왼쪽에 붙어 있다
      drawAxis(ax, yTop, yBot);

      // 여기부터는 납작한 덮개 — 눕혀도 똑바로 읽히게
      ctx = octx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hv);

      // 4) 시대 이름·장면 이름 — 화면 왼쪽 위에 붙어 따라온다
      drawEraTitles(ax);

      // 5) 열 이름 — 화면 위에 붙어 있다
      drawHeads(firstCol, lastCol, c);
    }

    function drawColumn(col, x, c, yTop, yBot, focusYear) {
      if (!col) return;
      var laneW = narrow() ? 5 : 6;
      var lanesW = col.laneN ? col.laneN * (laneW + 2) + 4 : 0;

      // 나라별 왕조·시대 띠(겹치면 나란히)
      col.spans.forEach(function (sp) {
        var a = yOf(sp.start_year);
        var b = Math.max(a + 4, yOf(sp.end_year));
        if (b < 0 || a > H) return;
        var e = sp.entry;
        var live = e.start_year <= focusYear && focusYear < e.end_year;
        var lx = x + 4 + sp.lane * (laneW + 2);
        ctx.fillStyle = e._color;
        ctx.globalAlpha = live ? 1 : (e.kind === 'era' ? 0.35 : 0.55);
        roundRect(lx, a, laneW, b - a, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        hits.push({ x: lx - 3, y: a, w: laneW + 6, h: b - a, entry: e });
      });

      // 사건 — 이 열 안에서만 자리를 잡는다
      var ex = x + 6 + lanesW;
      var ew = Math.max(0, c - 12 - lanesW);
      if (ew < DOT + 2) return;
      var grid = [];
      var unitsN = Math.max(1, Math.floor(ew / UNIT));
      for (var u = 0; u < unitsN; u += 1) grid.push([]);
      var hidden = {};
      for (var k = 0; k < col.events.length; k += 1) {
        var ev = col.events[k];
        if (ev.start_year < yTop || ev.start_year > yBot) continue;
        var y = yOf(ev.start_year);
        if (!tryPlace(grid, ex, ew, ev, y)) {
          var bucket = Math.floor(y / 44);
          hidden[bucket] = hidden[bucket] || { n: 0, sum: 0 };
          hidden[bucket].n += 1;
          hidden[bucket].sum += ev.start_year;
        }
      }
      // 자리가 없어 숨은 사건 묶음 — 누르면 그쪽으로 다가간다
      Object.keys(hidden).forEach(function (key) {
        var g = hidden[key];
        var cy = Number(key) * 44 + 22;
        var label = '+' + g.n;
        ctx.font = '700 11px ' + colors.sans;
        var w = ctx.measureText(label).width + 12;
        var bx = x + c - w - 4;
        ctx.fillStyle = colors.inkBg;
        ctx.globalAlpha = 0.78;
        roundRect(bx, cy - 9, w, 18, 9);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.foam;
        ctx.fillText(label, bx + 6, cy + 4);
        hits.push({ x: bx - 4, y: cy - 13, w: w + 8, h: 26, cluster: g.sum / g.n, col: col });
      });
    }

    function drawAxis(ax, yTop, yBot) {
      // 눈금 칸 바탕(열이 옆으로 지나가도 읽히게)
      ctx.fillStyle = colors.sky;
      ctx.globalAlpha = geo.th > 0.02 ? 0.5 : 0.86;   // 눕히면 비스듬한 띠가 무거워 보여 옅게
      ctx.fillRect(0, 0, ax, H);
      ctx.globalAlpha = 1;

      var step = STEPS[STEPS.length - 1];
      for (var k = 0; k < STEPS.length; k += 1) { if (STEPS[k] * cam.s >= 56) { step = STEPS[k]; break; } }
      var first = Math.ceil(yTop / step) * step;
      var lastTick = Math.min(yBot, PRESENT);   // 지금 뒤(아직 오지 않은 해)에는 눈금을 긋지 않는다
      ctx.textAlign = 'right';
      for (var yr = first; yr <= lastTick; yr += step) {
        var y = yOf(yr);
        var major = (yr / step) % 5 === 0;
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = major ? 0.9 : 0.45;
        ctx.beginPath(); ctx.moveTo(ax - (major ? 10 : 6), y); ctx.lineTo(ax, y); ctx.stroke();
        ctx.globalAlpha = 1;
        if (yr === 0) continue;
        ctx.fillStyle = major ? colors.inkBg : colors.inkBg2;
        if (yr < 0) {
          ctx.font = '10px ' + colors.sans;
          ctx.fillText('기원전', ax - 12, y - 6);
          ctx.font = (major ? '700 ' : '') + '12px ' + colors.sans;
          ctx.fillText(String(-yr), ax - 12, y + 8);
        } else {
          ctx.font = (major ? '700 ' : '') + '12px ' + colors.sans;
          ctx.fillText(String(yr), ax - 12, y + 4);
        }
      }
      ctx.textAlign = 'left';
      var yNow = Math.min(H, yOf(PRESENT));
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, Math.max(0, yOf(T_MIN))); ctx.lineTo(ax, yNow); ctx.stroke();
      ctx.lineWidth = 1;

      // '지금' — 시간축의 끝
      if (yNow > 0 && yNow < H) {
        ctx.strokeStyle = colors.star;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ax - 12, yNow); ctx.lineTo(W, yNow); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = colors.star;
        ctx.beginPath(); ctx.arc(ax, yNow, 5, 0, 6.2832); ctx.fill();
        ctx.font = '700 15px ' + colors.display;
        ctx.fillText('지금', ax + 10, yNow + 24);
        ctx.font = '12px ' + colors.sans;
        ctx.fillStyle = colors.inkBg2;
        ctx.fillText('이야기는 여기서부터 아직 쓰이는 중', ax + 50, yNow + 24);
      }
    }

    /** 시대 이름(띠 안에서 화면 위쪽에 붙어 따라옴) + 장면 이름 */
    function drawEraTitles(ax) {
      // 판 위 시대 경계를 화면으로 옮겨 놓고, 그 사이에서 위쪽에 붙인다
      var top = geo.on ? Math.max(HEAD_H, proj(ax, 0).y) : HEAD_H;
      var axAt = function (sy) { return proj(ax, unproj(W / 2, sy).y).x; };
      eras.forEach(function (era) {
        var a = proj(ax, yOf(era.start_year)).y;
        var b = proj(ax, yOf(era.end_year)).y;
        if (b - a < 40 || b < top || a > Hv) return;
        var y = clamp(top + 30, a + 30, b - 10);
        var bx0 = axAt(y);
        ctx.font = '700 24px ' + colors.display;
        var tw = ctx.measureText(era.label).width;
        ctx.font = '12px ' + colors.sans;
        var rw = ctx.measureText(era.range || '').width;
        var bx = bx0 + 8;
        ctx.fillStyle = colors.sky;
        ctx.globalAlpha = 0.82;
        roundRect(bx - 6, y - 25, tw + rw + 28, 34, 12);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = '700 24px ' + colors.display;
        ctx.fillStyle = colors.inkBg;
        ctx.fillText(era.label, bx + 2, y);
        ctx.font = '12px ' + colors.sans;
        ctx.fillStyle = colors.inkBg2;
        ctx.fillText(era.range || '', bx + tw + 12, y);
        hits.push({ x: bx - 6, y: y - 25, w: tw + rw + 28, h: 34, era: era, scr: true });

        (era.scenes || []).forEach(function (sc, i) {
          if (i === 0) return;
          var sp = proj(ax, yOf(sc.start_year));
          var sy = sp.y;
          if (sy < y + 14 || sy > Hv - 10 || sp.f < 0.4) return;   // 너무 먼 장면 이름은 생략
          var sx = sp.x + 8;
          ctx.font = '12px ' + colors.sans;
          var lw = ctx.measureText('· ' + sc.label).width;
          ctx.globalAlpha = Math.min(1, (sp.f - 0.4) * 4);
          ctx.fillStyle = colors.sky;
          ctx.globalAlpha *= 0.8;
          roundRect(sx - 4, sy - 17, lw + 12, 20, 8);
          ctx.fill();
          ctx.globalAlpha = Math.min(1, (sp.f - 0.4) * 4);
          ctx.fillStyle = colors.inkBg2;
          ctx.fillText('· ' + sc.label, sx + 2, sy - 3);
          ctx.globalAlpha = 1;
        });
      });
    }

    /** 열 이름 줄 — 화면 맨 위에 붙어 있다. 좁으면 색 점만 */
    function drawHeads(firstCol, lastCol, c0) {
      // 눕혀 있으면 머리글 줄 높이(화면)에 닿는 판의 깊이에서 열이 어디 있는지로 줄 세운다
      var py = Math.max(0, unproj(W / 2, HEAD_H / 2).y);
      var f = proj(W / 2, py).f;
      var c = c0 * f;
      var ax = proj(axisW(), py).x;
      var right = proj(W, py).x;
      var bg0 = geo.th > 0.02 ? 0 : ax;   // 눕혔을 땐 줄 바탕을 화면 폭 그대로
      ctx.fillStyle = colors.sky;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(bg0, 0, W - bg0, HEAD_H);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath(); ctx.rect(ax, 0, right - ax, HEAD_H); ctx.clip();
      for (var i = firstCol; i <= lastCol; i += 1) {
        var col = cols[i];
        if (!col) continue;
        var x = W / 2 + (xOfCol(i) - W / 2) * f;
        ctx.fillStyle = colors.foam;
        roundRect(x + 3, 4, c - 6, HEAD_H - 8, 10);
        ctx.fill();
        ctx.fillStyle = col.ds.color;
        ctx.beginPath(); ctx.arc(x + 14, HEAD_H / 2, 4.5, 0, 6.2832); ctx.fill();
        if (c > 64) {
          ctx.font = '700 12px ' + colors.sans;
          ctx.fillStyle = colors.ink;
          ctx.fillText(fitText(col.ds.label, c - 34), x + 24, HEAD_H / 2 + 4);
        }
        hits.push({ x: x, y: 0, w: c, h: HEAD_H, head: i, scr: true });
      }
      ctx.restore();
      ctx.strokeStyle = colors.line;
      ctx.beginPath(); ctx.moveTo(bg0, HEAD_H); ctx.lineTo(W, HEAD_H); ctx.stroke();
    }

    // ------------------------------------------------- 자리 잡기(겹치지 않게)

    function free(grid, c0, span, top, bottom) {
      if (c0 + span > grid.length) return false;
      for (var c = c0; c < c0 + span; c += 1) {
        var list = grid[c];
        for (var k = 0; k < list.length; k += 1) {
          if (list[k][0] < bottom && list[k][1] > top) return false;
        }
      }
      return true;
    }

    function mark(grid, c0, span, top, bottom) {
      var end = Math.min(grid.length, c0 + span);   // 여백까지 잡을 때 격자 끝을 넘지 않게
      for (var c = Math.max(0, c0); c < end; c += 1) grid[c].push([top, bottom]);
    }

    function findSlot(grid, wPx, top, bottom, stride) {
      var span = Math.ceil(wPx / UNIT);
      for (var c = 0; c + span <= grid.length; c += stride) {
        if (free(grid, c, span, top - 3, bottom + 3)) return c;
      }
      return -1;
    }

    function tryPlace(grid, ex, ew, ev, y) {
      if (y < HEAD_H - 20) return true;   // 열 이름 줄 밑으로 들어간 것은 그리지 않고 묶음으로도 세지 않는다
      // 카드 — 열이 충분히 넓을 때
      if (ew >= 150) {
        var cardW = Math.min(ew, 260);
        var cardSpan = Math.ceil((cardW + 8) / UNIT);
        var c = findSlot(grid, cardW, y - 12, y - 12 + CARD_H, cardSpan);
        if (c >= 0) {
          mark(grid, c, cardSpan, y - 15, y - 12 + CARD_H + 3);
          drawCard(ev, ex + c * UNIT, y - 12, cardW);
          return true;
        }
      }
      // 이름표
      if (ew >= 70) {
        var lw = Math.min(measureLabel(ev), ew);
        var c2 = findSlot(grid, lw, y - LABEL_H / 2, y + LABEL_H / 2, 2);
        if (c2 >= 0) {
          mark(grid, c2, Math.ceil(lw / UNIT), y - LABEL_H / 2 - 2, y + LABEL_H / 2 + 2);
          drawLabel(ev, ex + c2 * UNIT, y - LABEL_H / 2, lw);
          return true;
        }
      }
      // 점
      var c3 = findSlot(grid, DOT, y - DOT / 2, y + DOT / 2, 2);
      if (c3 >= 0) {
        mark(grid, c3, 2, y - DOT / 2 - 1, y + DOT / 2 + 1);
        drawDot(ev, ex + c3 * UNIT + DOT / 2, y);
        return true;
      }
      return false;
    }

    function measureLabel(ev) {
      if (labelWidth[ev.id]) return labelWidth[ev.id];
      ctx.font = '13px ' + colors.sans;
      var w = Math.min(190, ctx.measureText(ev.title).width) + 30;
      labelWidth[ev.id] = w;
      return w;
    }

    function drawCard(ev, x, y, w) {
      ctx.save();
      ctx.shadowColor = 'rgba(58, 42, 36, .14)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = colors.foam;
      roundRect(x, y, w, CARD_H, 14);
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(x, y, w, CARD_H, 14);
      ctx.clip();
      ctx.fillStyle = ev._color;
      ctx.fillRect(x, y, 6, CARD_H);
      ctx.restore();

      ctx.font = '11px ' + colors.sans;
      ctx.fillStyle = colors.ink2;
      var years = ev.end_year !== ev.start_year ? yearText(ev.start_year) + '–' + yearText(ev.end_year) : yearText(ev.start_year);
      ctx.fillText(fitText(years, w - 26), x + 16, y + 20);
      ctx.font = '700 14px ' + colors.sans;
      ctx.fillStyle = colors.ink;
      ctx.fillText(fitText(ev.title, w - 26), x + 16, y + 42);
      hits.push({ x: x, y: y, w: w, h: CARD_H, entry: ev });
    }

    function drawLabel(ev, x, y, w) {
      ctx.fillStyle = colors.foam;
      ctx.globalAlpha = 0.92;
      roundRect(x, y, w, LABEL_H, 12);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = ev._color;
      ctx.beginPath(); ctx.arc(x + 12, y + LABEL_H / 2, 4.5, 0, 6.2832); ctx.fill();
      ctx.font = '13px ' + colors.sans;
      ctx.fillStyle = colors.ink;
      ctx.fillText(fitText(ev.title, w - 30), x + 22, y + LABEL_H / 2 + 4.5);
      hits.push({ x: x, y: y, w: w, h: LABEL_H, entry: ev });
    }

    function drawDot(ev, x, y) {
      ctx.fillStyle = ev._color;
      ctx.strokeStyle = colors.foam;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, DOT / 2 - 1, 0, 6.2832); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
      hits.push({ x: x - 9, y: y - 9, w: 18, h: 18, entry: ev });
    }

    // ----------------------------------------------------------- 움직임

    function frame(t) {
      raf = 0;
      var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
      lastT = t;
      var moving = step(dt, t);
      if (stepTilt(dt)) moving = true;
      clampCam();
      draw();
      if (opts.onCamera) {
        opts.onCamera({
          year: clamp(yearAt(focusY()), T_MIN, T_MAX),   // 고무줄로 넘친 동안에도 역사 밖 해는 안 보이게
          s: cam.s,
          moving: moving,
          dragging: !!(gesture && gesture.active),
          ringX: proj(axisW(), focusY()).x,
          tilt: tilt.cur
        });
      }
      if (moving) raf = global.requestAnimationFrame(frame);
      else lastT = 0;
    }

    function step(dt, t) {
      if (motion.mode === 'fling') {
        cam.t0 += motion.vt * dt;
        cam.u0 += motion.vu * dt;
        var k = Math.exp(-FRICTION * dt);
        var L = limits();
        // 끝을 넘어서면 확 붙잡혀 느려진다 — 그다음엔 튕겨 돌아오기
        var outT = cam.t0 < L.tA || cam.t0 > L.tB;
        var outU = cam.u0 < L.uA || cam.u0 > L.uB;
        var hard = Math.exp(-26 * dt);
        motion.vt *= outT ? hard : k;
        motion.vu *= outU ? hard : k;
        var slowT = Math.abs(motion.vt * cam.s) < (outT ? 60 : 8);
        var slowU = Math.abs(motion.vu * cw()) < (outU ? 60 : 8);
        if (slowT && slowU) motion.mode = outT || outU ? 'spring' : 'idle';
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'spring') {
        var B = limits();
        var pull = 1 - Math.exp(-SPRING * dt);
        var gt = clamp(cam.t0, B.tA, B.tB);
        var gu = clamp(cam.u0, B.uA, B.uB);
        cam.t0 += (gt - cam.t0) * pull;
        cam.u0 += (gu - cam.u0) * pull;
        if (Math.abs(gt - cam.t0) * cam.s < 0.4 && Math.abs(gu - cam.u0) * cw() < 0.4) {
          cam.t0 = gt;
          cam.u0 = gu;
          motion.mode = 'idle';
        }
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'fly') {
        var f = motion.fly;
        var p = clamp((t - f.t0) / f.dur, 0, 1);
        var e = easeInOutCubic(p);
        var logS = f.logS0 + (f.logS1 - f.logS0) * e - f.bump * 4 * e * (1 - e);
        cam.s = Math.exp(logS);
        cam.t0 = (f.y0 + (f.y1 - f.y0) * e) - f.fy / cam.s;
        if (f.u1 != null) cam.u0 = f.u0 + (f.u1 - f.u0) * e;
        if (p >= 1) motion.mode = 'idle';
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'zoom') {
        var z = motion.zoomTo;
        var cur = Math.log(cam.s);
        var nxt = cur + (z.logS - cur) * (1 - Math.exp(-dt * 16));
        if (Math.abs(z.logS - nxt) < 0.002) nxt = z.logS;
        cam.s = clamp(Math.exp(nxt), sMin(), S_MAX);
        cam.t0 = z.year - z.y / cam.s;
        cam.u0 = z.u - (z.x - originX()) / cw();
        if (nxt === z.logS) motion.mode = 'idle';
        return motion.mode !== 'idle';
      }
      return false;
    }

    /**
     * 초점선에 year 가 오도록 s 배율로 날아간다. 멀면 잠깐 물러났다 다가간다.
     * o.col 을 주면 그 열이 화면 가운데로 오게 가로로도 움직인다.
     */
    function flyTo(year, s, o) {
      o = o || {};
      s = clamp(s || cam.s, sMin(), S_MAX);
      var fy = focusY();
      var y0 = yearAt(fy);
      year = clamp(year, T_MIN, T_MAX);
      var u1 = null;
      if (o.col != null && o.col >= 0) u1 = o.col + 0.5 - (viewW() / colWidth(s)) / 2;
      if (reduced || o.instant) {
        cam.s = s;
        cam.t0 = year - fy / s;
        if (u1 != null) cam.u0 = u1;
        motion.mode = 'idle';
        invalidate();
        return;
      }
      var distPx = Math.abs(year - y0) * Math.min(cam.s, s);
      var bump = distPx > H * 1.5 ? Math.min(3, Math.log(distPx / H)) * 0.6 : 0;
      motion.fly = {
        t0: now(), dur: clamp(520 + 170 * Math.log(1 + distPx / H) / Math.LN2, 520, 1700),
        y0: y0, y1: year, logS0: Math.log(cam.s), logS1: Math.log(s), bump: bump, fy: fy,
        u0: cam.u0, u1: u1
      };
      motion.mode = 'fly';
      lastT = 0;
      invalidate();
    }

    /** 연도 구간 [a, b] 가 화면에 들어오게 */
    function flyToRange(a, b, o) {
      var span = Math.max(1, b - a);
      var s = ((Hv - HEAD_H) * 0.84) / span;
      flyTo(a + (focusY() - HEAD_H) / s - (Hv * 0.05) / s, s, o);
    }

    function zoomAround(x, y, factor) {
      var cur = motion.mode === 'zoom' ? motion.zoomTo.logS : Math.log(cam.s);
      var target = clamp(cur + Math.log(factor), Math.log(sMin()), Math.log(S_MAX));
      var same = motion.mode === 'zoom' && Math.abs(motion.zoomTo.y - y) < 2 && Math.abs(motion.zoomTo.x - x) < 2;
      motion.zoomTo = {
        logS: target, x: x, y: y,
        year: same ? motion.zoomTo.year : yearAt(y),
        u: same ? motion.zoomTo.u : colAt(x)
      };
      motion.mode = 'zoom';
      lastT = 0;
      invalidate();
    }

    function panBy(dy, dx) {
      motion.mode = 'idle';
      if (dx) { cam.u0 += dx / cw(); clampCam(); }
      flyTo(yearAt(focusY() + (dy || 0)), cam.s);
    }

    // ----------------------------------------------------------- 입력

    /** 화면 좌표(sx, sy)와, 원근을 풀어 낸 판 좌표(x, y) */
    function local(e) {
      var r = canvas.getBoundingClientRect();
      var sx = e.clientX - r.left;
      var sy = e.clientY - r.top;
      var q = unproj(sx, sy);
      return { x: q.x, y: q.y, sx: sx, sy: sy };
    }

    function hitAt(p) {
      for (var i = hits.length - 1; i >= 0; i -= 1) {
        var h = hits[i];
        var x = h.scr ? p.sx : p.x;   // 덮개에 그린 것(열·시대 이름)은 화면 좌표로
        var y = h.scr ? p.sy : p.y;
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
      }
      return null;
    }

    var TILT_PER_PX = function () { return TILT_MAX / Math.max(240, Hv * 0.5); };   // 화면 반 높이를 밀면 끝까지

    /**
     * 두 손가락 — 처음 조금 움직인 모양으로 가른다.
     * 나란히 놓인 두 손가락이 같이 위아래로 움직이면 눕히기(구글 지도처럼), 아니면 핀치 줌.
     */
    function classifyTwo(g) {
      var a = pointers[g.ids[0]];
      var b = pointers[g.ids[1]];
      if (!a || !b) return null;
      var dax = a.sx - g.a0.sx, day = a.sy - g.a0.sy;
      var dbx = b.sx - g.b0.sx, dby = b.sy - g.b0.sy;
      // 손가락 이벤트는 하나씩 번갈아 오니, 둘 다 움직인 뒤에 가른다(한쪽만 크게 움직였으면 핀치)
      var ma = Math.hypot(dax, day);
      var mb = Math.hypot(dbx, dby);
      if (Math.max(ma, mb) < 10 || (Math.min(ma, mb) < 5 && Math.max(ma, mb) < 32)) return null;
      var sideBySide = Math.abs(g.a0.sx - g.b0.sx) > Math.abs(g.a0.sy - g.b0.sy) * 0.9;
      var together = day * dby > 0 && Math.abs(day) > Math.abs(dax) * 1.2 && Math.abs(dby) > Math.abs(dbx) * 1.2;
      var d0 = Math.hypot(g.a0.sx - g.b0.sx, g.a0.sy - g.b0.sy);
      var d1 = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      var steady = Math.abs(d1 - d0) < 0.45 * (Math.abs(day) + Math.abs(dby)) / 2;
      return sideBySide && together && steady ? 'tilt' : 'pinch';
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (!active) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var p = local(e);
      pointers[e.pointerId] = p;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      var ids = Object.keys(pointers);
      motion.mode = 'idle';
      if (ids.length === 1 && e.altKey) {
        // Alt(Option)+끌기 — 위로 밀면 눕고 아래로 당기면 선다
        gesture = { kind: 'tilt1', id: e.pointerId, sy0: p.sy, th0: tilt.target, active: true };
        canvas.classList.add('is-dragging');
      } else if (ids.length === 1) {
        // 튕겨 돌아오던 중에 잡아도 튀지 않게, 지금 보이는 자리를 손가락 기준 자리로 되돌려 둔다
        var L = limits();
        gesture = {
          kind: 'pan', id: e.pointerId, x0: p.x, y0: p.y, sx0: p.sx, sy0: p.sy, at: e.timeStamp, active: false, samples: [],
          t0: unrubber(cam.t0, L.tA, L.tB, cam.s, Hv), u0: unrubber(cam.u0, L.uA, L.uB, cw(), W)
        };
      } else if (ids.length === 2) {
        // 어느 쪽인지 정해질 때까지 그대로 — 정해지면 처음 자리 기준으로 이어 간다
        gesture = { kind: 'two', ids: ids, a0: pointers[ids[0]], b0: pointers[ids[1]], th0: tilt.target, active: true };
      }
    });

    function startPinch(a, b) {
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      gesture = { kind: 'pinch', d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), s0: cam.s, year: yearAt(my), u: colAt(mx), active: true };
    }

    canvas.addEventListener('pointermove', function (e) {
      if (!active) return;
      var p = local(e);
      if (!pointers[e.pointerId]) {
        var h = hitAt(p);   // 마우스를 올렸을 때 누를 수 있는 것 위면 손가락 모양
        canvas.style.cursor = h ? 'pointer' : 'grab';
        return;
      }
      pointers[e.pointerId] = p;
      if (!gesture) return;
      if (gesture.kind === 'two') {
        var kind = classifyTwo(gesture);
        if (!kind) return;
        if (kind === 'pinch') startPinch(gesture.a0, gesture.b0);
        else gesture.kind = 'tilt';
      }
      if (gesture.kind === 'tilt') {
        var pa = pointers[gesture.ids[0]];
        var pb = pointers[gesture.ids[1]];
        if (!pa || !pb) return;
        var my2 = ((pa.sy - gesture.a0.sy) + (pb.sy - gesture.b0.sy)) / 2;
        setTilt(gesture.th0 - my2 * TILT_PER_PX(), true);
        return;
      }
      if (gesture.kind === 'tilt1' && e.pointerId === gesture.id) {
        setTilt(gesture.th0 - (p.sy - gesture.sy0) * TILT_PER_PX(), true);
        return;
      }
      if (gesture.kind === 'pan' && e.pointerId === gesture.id) {
        var dx = p.x - gesture.x0;
        var dy = p.y - gesture.y0;
        if (!gesture.active && Math.abs(p.sy - gesture.sy0) + Math.abs(p.sx - gesture.sx0) < 6) return;
        gesture.active = true;
        canvas.classList.add('is-dragging');
        // 상하좌우 어디로든 — 그림 한 장을 손으로 미는 것처럼. 끝 너머로는 고무줄처럼
        var L = limits();
        cam.t0 = rubber(gesture.t0 - dy / cam.s, L.tA, L.tB, cam.s, Hv);
        cam.u0 = rubber(gesture.u0 - dx / cw(), L.uA, L.uB, cw(), W);
        gesture.samples.push({ t: e.timeStamp, t0: cam.t0, u0: cam.u0 });
        while (gesture.samples.length > 2 && e.timeStamp - gesture.samples[0].t > 100) gesture.samples.shift();
        invalidate();
      } else if (gesture.kind === 'pinch') {
        var ids = Object.keys(pointers);
        if (ids.length < 2) return;
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
        var mx = (a.x + b.x) / 2;
        var my = (a.y + b.y) / 2;
        cam.s = clamp(gesture.s0 * d / gesture.d0, sMin(), S_MAX);
        cam.t0 = gesture.year - my / cam.s;
        cam.u0 = gesture.u - (mx - originX()) / cw();
        invalidate();
      }
    });

    function release(e) {
      if (!pointers[e.pointerId]) return;
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      var g = gesture;
      if (!g) return;
      if (g.kind === 'tilt' || g.kind === 'tilt1' || g.kind === 'two') {
        // 눕히기가 끝나면 남은 손가락은 다시 놓을 때까지 쉰다
        gesture = null;
        canvas.classList.remove('is-dragging');
        settleTilt();
        return;
      }
      if (g.kind === 'pinch') {
        // 손가락 하나가 남으면 그 손가락으로 이어서 끌 수 있게
        var rest = Object.keys(pointers);
        gesture = rest.length === 1
          ? { kind: 'pan', id: Number(rest[0]), x0: pointers[rest[0]].x, y0: pointers[rest[0]].y, sx0: pointers[rest[0]].sx, sy0: pointers[rest[0]].sy, t0: cam.t0, u0: cam.u0, at: e.timeStamp, active: true, samples: [] }
          : null;
        return;
      }
      gesture = null;
      canvas.classList.remove('is-dragging');
      var L = limits();
      var out = cam.t0 < L.tA || cam.t0 > L.tB || cam.u0 < L.uA || cam.u0 > L.uB;
      if (g.active) {
        var s = g.samples;
        if (s.length > 1 && e.timeStamp - s[s.length - 1].t < 90) {
          var span = Math.max(8, s[s.length - 1].t - s[0].t) / 1000;
          motion.vt = (s[s.length - 1].t0 - s[0].t0) / span;
          motion.vu = (s[s.length - 1].u0 - s[0].u0) / span;
          motion.mode = 'fling';
        } else {
          motion.mode = out ? 'spring' : 'idle';
        }
        lastT = 0;
        invalidate();
        return;
      }
      if (out) {   // 튕겨 돌아오던 걸 톡 잡았다 놓았으면 마저 돌아간다
        motion.mode = 'spring';
        lastT = 0;
        invalidate();
      }
      // 톡 — 사건이면 상세, 시대 이름이면 그 시대로, 열 이름이면 그 열로, 묶음이면 다가가기. 두 번 톡이면 줌인
      if (e.timeStamp - g.at > 450) return;
      var tapAt = e.timeStamp;
      if (lastTap && tapAt - lastTap.t < 320 && Math.abs(lastTap.y - p.sy) < 30 && Math.abs(lastTap.x - p.sx) < 30) {
        lastTap = null;
        zoomAround(p.x, p.y, 2.6);
        return;
      }
      lastTap = { t: tapAt, x: p.sx, y: p.sy };
      var h = hitAt(p);
      if (!h) return;
      if (h.entry && opts.openEntry) opts.openEntry(h.entry);
      else if (h.era) flyToRange(h.era.start_year, h.era.end_year);
      else if (h.head != null) flyTo(yearAt(focusY()), Math.max(cam.s, 1.2), { col: h.head });
      else if (h.cluster != null) flyTo(h.cluster, cam.s * 3.2, { col: cols.indexOf(h.col) });
    }

    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('wheel', function (e) {
      if (!active) return;
      e.preventDefault();
      var p = local(e);
      var unit = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? H : 1);
      var dy = e.deltaY * unit;
      var dx = e.deltaX * unit;
      if (e.altKey) {
        // Alt(Option)+휠 — 굴려 올리면 눕고 내리면 선다. (Ctrl+휠은 트랙패드 핀치라 줌으로 둔다)
        // 맥에서 Option+휠은 가로로 올 때가 있어 큰 쪽을 쓴다
        var dd = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        setTilt(tilt.target - dd * 0.0035, true);
        clearTimeout(tilt.snapTimer);
        tilt.snapTimer = setTimeout(settleTilt, 260);
        return;
      }
      if (e.shiftKey && !dx) {
        // Shift+휠은 가로 이동
        motion.mode = 'idle';
        cam.u0 += dy / cw();
        invalidate();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) * 0.5 && !e.ctrlKey) {
        // 트랙패드를 옆·대각선으로 밀면 그쪽으로 그대로 이동
        motion.mode = 'idle';
        cam.u0 += dx / cw();
        cam.t0 += dy / cam.s;
        invalidate();
        return;
      }
      zoomAround(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });

    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });

    if (global.ResizeObserver) new ResizeObserver(function () { if (active) resize(); }).observe(canvas);

    readColors();

    return {
      setData: setData,
      setActive: function (on) {
        active = !!on;
        if (active) { readColors(); resize(); }
      },
      resize: resize,
      refreshTheme: function () { readColors(); invalidate(); },
      redraw: invalidate,
      flyTo: flyTo,
      flyToRange: flyToRange,
      zoomBy: function (f) { zoomAround(originX() + viewW() / 2, focusY(), f); },
      panBy: panBy,
      axisX: function () { return proj(axisW(), focusY()).x; },
      /** 눕히기 — 0(납작) ~ TILT_MAX 라디안 */
      setTilt: function (th, instant) { setTilt(th, instant); if (!instant) settleTilt(); },
      toggleTilt: function () { setTilt(tilt.target > TILT_SNAP ? 0 : TILT_ON); },
      get tilt() { return tilt.cur; },
      /** 처음 열 때 — 문명사(기원전 4200년~지금)가 화면에 들어오게 */
      home: function () {
        setTilt(0, true);
        cam.s = clamp(((Hv - HEAD_H) * 0.86) / (T_MAX + 4200), sMin(), S_MAX);
        cam.t0 = -4200 - (Hv * 0.04 + HEAD_H) / cam.s;
        cam.u0 = 0;
        clampCam();
        invalidate();
      },
      /** 그려진 사건들(개발·테스트 확인용) */
      items: function () {
        return hits.filter(function (h) { return h.entry; }).map(function (h) {
          var q = proj(h.x + Math.min(h.w, 40) / 2, h.y + h.h / 2);   // 화면 좌표로
          return { title: h.entry.title, x: q.x, y: q.y };
        });
      },
      get year() { return clamp(yearAt(focusY()), T_MIN, T_MAX); },
      get scale() { return cam.s; },
      get column() { return cam.u0; }
    };
  }

  global.BigHistoryZoom = { create: create };
})(window);
