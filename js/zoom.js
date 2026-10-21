/* ------------------------------------------------------------------
   탐험 — 역사 전체를 한 장의 거대한 그림(캔버스)으로 (ChronoZoom · Prezi 에서 얻은 생각)

   세로 = 시간(위가 옛날), 가로 = 카테고리마다 한 열(국가사 → 주제사).
   그림은 화면보다 크고, 상하좌우 어디로든 끌고 던질 수 있다.
     · 핀치(트랙패드·손가락)·⌘/Ctrl+휠로 줌 — 시간축과 열 너비가 함께 커지고 작아진다.
       두 손가락 스크롤·마우스 휠은 이동(무한 캔버스 앱의 표준 — Figma·Miro·tldraw)
       멀리서 보면 모든 열이 시대 띠를 가로지르는 포스터, 다가가면 열이 넓어져 카드가 펼쳐진다
     · 시간 눈금은 줌에 맞춰 1만 년 → 1천 년 → 100년 → 10년 → 1년
     · 열마다 사건이 자리를 잡는다: 넉넉하면 카드, 빠듯하면 이름표, 더 빠듯하면 점, 그래도 안 되면 '+N'
       (중요한 것부터 — 나라·왕조 > 시대 > 나머지)
     · 국가사 열 = 왕조·시대 칸(나무위키 왕조 표처럼). 같은 때의 나라는 폭을 나눠 나란히,
       하위 시기(parent)는 상위 칸 안에, 주변 지역(area)은 오른쪽 가장자리 줄에.
       열 왼쪽 띠는 시대 묶음(매니페스트 periods — 삼국 시대·송원 시대 …)
     · 연도 축은 국가사 열과 주제사 열 사이에 끼어 그림과 함께 옆으로 움직이고,
       화면 밖으로 나가려 하면 왼쪽·오른쪽 가장자리에 붙어 따라온다
     · 열 이름은 화면 위에, 시대 이름은 연도 축 옆에 붙어 따라온다
     · 먼 곳으로 갈 때는 잠깐 물러났다 다가가는 비행(Prezi 의 장면 전환)
     · 끝에 닿아도 벽처럼 멈추지 않는다 — 손가락을 따라 고무줄처럼 늘어났다가 놓으면 튕겨 돌아온다
     · 눕히기(스타워즈 오프닝처럼) — 두 손가락을 나란히 위아래로 밀거나 Alt(Option)+휠, Alt+끌기, T 키.
       과거가 저 멀리, 지금이 코앞에 오도록 그림판이 뒤로 눕는다

   캔버스가 두 장이다.
     · 판(plane)  — 열·사건·왕조 띠·연도 눈금. js/plane.js 의 붓이 칠한다 —
                     Three.js(WebGL2)가 되면 GPU 로, 눕히기는 원근 카메라를 기울여서.
                     안 되면 Canvas 2D 로 칠하고 눕히기는 CSS 3D 로(판 좌표계는 어느 쪽이든 그대로).
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
  /**
   * 줌하며 날아가는 경로 — van Wijk & Nuij(2003) 'Smooth and efficient zooming and panning'.
   * ChronoZoom 같은 확대형 화면과 d3.interpolateZoom 이 쓰는 그 곡선. 화면에서 느끼는 속도가 고르게,
   * 먼 곳이면 알맞게 물러났다가 다가간다. 1차원(시간 축): c = 초점선의 해, w = 화면에 보이는 햇수
   * @returns { S: 경로 길이(시간 배분용), at(t): { c, w, k(이동 진행 0..1) } }
   */
  function zoomPath(c0, w0, c1, w1) {
    var rho = Math.SQRT2;
    var rho2 = 2;
    var rho4 = 4;
    var dx = c1 - c0;
    var d2 = dx * dx;
    if (d2 < 1e-12) {
      var S0 = Math.log(w1 / w0) / rho;
      return {
        S: Math.abs(S0),
        at: function (t) { return { c: c0 + dx * t, w: w0 * Math.exp(rho * t * S0), k: t }; }
      };
    }
    var d1 = Math.sqrt(d2);
    var b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
    var b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    var r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    var S = (r1 - r0) / rho;
    var cosh = function (x) { return (Math.exp(x) + Math.exp(-x)) / 2; };
    var sinh = function (x) { return (Math.exp(x) - Math.exp(-x)) / 2; };
    var tanh = function (x) { var e2 = Math.exp(2 * x); return (e2 - 1) / (e2 + 1); };
    var coshr0 = cosh(r0);
    return {
      S: Math.abs(S),
      at: function (t) {
        var sx = t * S;
        var u = w0 / (rho2 * d1) * (coshr0 * tanh(rho * sx + r0) - sinh(r0));
        return { c: c0 + u * dx, w: w0 * coshr0 / cosh(rho * sx + r0), k: clamp(u, 0, 1) };
      }
    };
  }

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

  var AREA_F = 0.16;   // 가장자리 지역 줄(탐라·류큐 등) 하나가 차지하는 폭 비율

  /**
   * 국가사 열의 왕조 칸 — 나무위키 왕조 표처럼.
   * 시간을 시작·끝 해마다 잘라, 그 조각에 살아 있는 나라끼리 폭을 똑같이 나눈다(혼자면 꽉 차게).
   * parent 가 있는 항목은 상위 칸 안에서 같은 방식으로, area 가 있는 항목은 오른쪽 가장자리 줄에.
   * @returns [{ entry, y0, y1, fx0, fx1, depth, shade }]  — fx 는 칸 영역 폭에 대한 비율(0..1), y 는 해
   */
  function layoutBlocks(list) {
    var byId = {};
    list.forEach(function (e) { byId[e.id] = e; });
    var kids = {};
    var top = [];
    list.forEach(function (e) {
      if (e.parent && byId[e.parent] && e.parent !== e.id) (kids[e.parent] = kids[e.parent] || []).push(e);
      else top.push(e);
    });
    // 이웃한 칸이 같은 색으로 붙어 보이지 않게 시작 순서대로 진하기를 번갈아
    var shade = {};
    list.slice().sort(function (a, b) { return a.start_year - b.start_year; })
      .forEach(function (e, i) { shade[e.id] = i % 2; });
    var pieces = [];

    function place(spans, fx0, fx1, y0, y1, depth) {
      spans = spans.filter(function (e) { return e.end_year > y0 && e.start_year < y1; });
      if (!spans.length || depth > 3) return;
      var main = spans.filter(function (e) { return !e.area; });
      var side = spans.filter(function (e) { return e.area; });
      var lanes = main.map(function (e) {
        return { entry: e, start_year: Math.max(e.start_year, y0), end_year: Math.min(e.end_year, y1) };
      });
      packLanes(lanes);
      var laneOf = {};
      lanes.forEach(function (l) { laneOf[l.entry.id] = l.lane; });
      var areas = [];
      side.slice().sort(function (a, b) { return a.start_year - b.start_year; })
        .forEach(function (e) { if (areas.indexOf(e.area) < 0) areas.push(e.area); });

      var cuts = [y0, y1];
      spans.forEach(function (e) {
        if (e.start_year > y0 && e.start_year < y1) cuts.push(e.start_year);
        if (e.end_year > y0 && e.end_year < y1) cuts.push(e.end_year);
      });
      cuts.sort(function (a, b) { return a - b; });
      var open = {};   // 항목 id → 지금 늘이고 있는 조각
      var mine = [];
      function put(e, a, b, l, r) {
        var p = open[e.id];
        if (p && p.y1 === a && p.fx0 === l && p.fx1 === r) { p.y1 = b; return; }
        p = { entry: e, y0: a, y1: b, fx0: l, fx1: r, depth: depth, shade: shade[e.id] };
        open[e.id] = p;
        mine.push(p);
      }
      for (var k = 0; k + 1 < cuts.length; k += 1) {
        var a = cuts[k];
        var b = cuts[k + 1];
        if (b <= a) continue;
        var live = function (e) { return e.start_year <= a && e.end_year >= b; };
        var act = main.filter(live).sort(function (p, q) { return laneOf[p.id] - laneOf[q.id]; });
        var actAreas = areas.filter(function (ar) { return side.some(function (e) { return e.area === ar && live(e); }); });
        var span = fx1 - fx0;
        var sideW = actAreas.length ? Math.min(0.45, actAreas.length * AREA_F) * span : 0;
        var mainR = act.length ? fx1 - sideW : fx1;
        var slot = act.length ? (mainR - fx0) / act.length : 0;
        act.forEach(function (e, i) { put(e, a, b, fx0 + slot * i, fx0 + slot * (i + 1)); });
        var aw = actAreas.length ? (fx1 - (act.length ? mainR : fx0)) / actAreas.length : 0;
        side.filter(live).forEach(function (e) {
          var j = actAreas.indexOf(e.area);
          var l = (act.length ? mainR : fx0) + aw * j;
          put(e, a, b, l, l + aw);
        });
      }
      mine.forEach(function (p) {
        pieces.push(p);
        if (kids[p.entry.id]) place(kids[p.entry.id], p.fx0, p.fx1, p.y0, p.y1, depth + 1);
      });
    }

    place(top, 0, 1, -Infinity, Infinity, 0);
    return pieces;
  }

  /** 칸 안 이름 — 괄호 속 덧말은 좁을 때 뺀다: '삼한(마한·진한·변한)' → '삼한' */
  function shortTitle(t) { return t.replace(/\s*\([^)]*\)\s*$/, '').trim() || t; }

  /**
   * @param canvas  <canvas id="zoom">
   * @param opts    { eras, present, focusY(): px, onCamera(info), openEntry(entry) }
   */
  function create(canvas, opts) {
    var plane = opts.plane;                 // 눕는 판
    var octx = canvas.getContext('2d');     // 납작한 덮개
    var ctx = octx;                         // 덮개에 그리는 도우미들이 쓴다
    var pp = global.BigHistoryPlane.create(plane, { force2d: opts.force2d });   // 판을 칠하는 붓
    var dpr = 1;
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

    var cols = [];   // { ds, events(우선순위 순), blocks(왕조 칸 조각), periods(시대 묶음) }
    // 맨 위의 해, 1년당 px, 화면 왼쪽(여백 다음)에 오는 그림의 가로 위치(px)
    var cam = { t0: -4200, s: 0.1, x0: 0 };
    var motion = { mode: 'idle', vt: 0, vx: 0, fly: null, zoomTo: null };
    var axisAt = 0;   // 연도 축이 끼는 자리 — 이 번호의 열 앞(국가사 열 수)
    var pointers = {};
    var gesture = null;
    var hits = [];
    var colors = {};
    var labelWidth = {};
    var stats = { draw: 0 };   // 마지막 프레임을 그리는 데 든 시간(ms, 확인용)
    var fonts = {};
    var lastTap = null;
    var pendingOpen = 0;   // 왕조 칸 톡 — 두 번 톡인지 보려고 잠깐 미룬 열기
    var focus = null;      // 펼쳐 둔 항목 { id } — 테두리를 두르고, 화면 위 자리를 앱에 알려 상세 카드를 붙인다
    var focusBox = null;   // 이번 프레임에 그 항목이 그려진 판 위 자리 { x0, y0, x1, y1 }

    // ----------------------------------------------------------- 좌표

    function narrow() { return W < 640; }
    var MARGIN = 8;
    function axisW() { return narrow() ? 58 : 84; }
    function viewW() { return Math.max(1, W - MARGIN * 2); }
    function cw() { return colWidth(cam.s); }
    function focusY() { return unproj(W / 2, opts.focusY ? opts.focusY() : Hv * 0.36).y; }
    function yOf(year) { return (year - cam.t0) * cam.s; }
    function yearAt(y) { return cam.t0 + y / cam.s; }

    // 가로 — 그림(world) px. 열들 사이 axisAt 자리에 연도 축 칸(axisW)이 끼어 있다
    function colWX(i) { return i * cw() + (i >= axisAt ? axisW() : 0); }
    function worldW() { return cols.length * cw() + axisW(); }
    function sxOf(wx) { return MARGIN + wx - cam.x0; }          // 그림 px → 화면 x
    function xOfCol(i) { return sxOf(colWX(i)); }
    /** 연도 축 칸의 화면 왼쪽 — 화면 밖으로 나가려 하면 가장자리에 붙는다 */
    function axisLeft() { return clamp(sxOf(axisAt * cw()), 0, W - axisW()); }
    /** 오른쪽 가장자리에 붙었으면 눈금을 뒤집어 그림 쪽(왼쪽)을 보게 */
    function axisFlip() { return sxOf(axisAt * cw()) > W - axisW(); }
    /** 연도 축 선(눈금·초점 고리가 붙는 쪽)의 x */
    function axisLine() { return axisFlip() ? axisLeft() : axisLeft() + axisW(); }

    // 줌하면 열 너비가 바뀌므로, 가리키던 자리를 '열 좌표 u'로 기억했다가 다시 px 로 푼다.
    // u: 축 앞 열은 0..axisAt, 축 칸은 axisAt..axisAt+1, 그 뒤 열은 axisAt+1.. (끊김 없이 이어진다)
    function uOfWX(wx) {
      var c = cw(), a = axisAt * c, aw = axisW();
      if (wx < a) return wx / c;
      if (wx < a + aw) return axisAt + (wx - a) / aw;
      return axisAt + 1 + (wx - a - aw) / c;
    }
    function wxOfU(u) {
      var c = cw();
      if (u < axisAt) return u * c;
      if (u < axisAt + 1) return axisAt * c + (u - axisAt) * axisW();
      return axisAt * c + axisW() + (u - axisAt - 1) * c;
    }
    function uAtScreen(x) { return uOfWX(cam.x0 + x - MARGIN); }
    /** 화면 x 에 u 가 오도록 */
    function pinU(u, x) { cam.x0 = wxOfU(u) - (x - MARGIN); }
    function colU(i) { return i < axisAt ? i : i + 1; }   // 진짜 열 번호 → u
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
      var ww = worldW();
      var vis = viewW();
      var mid = -(vis - ww) / 2;                           // 그림이 화면보다 좁으면 가운데
      var pad = cw() * 0.25;
      return {
        tA: T_MIN - fy / cam.s, tB: T_MAX - fy / cam.s,
        xA: ww <= vis ? mid : -pad, xB: ww <= vis ? mid : ww - vis + pad
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
      cam.x0 = clamp(cam.x0, L.xA, L.xB);
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
      fonts = {};
    }

    // ----------------------------------------------------------- 데이터

    /**
     * @param entries  지금 켜진 카테고리의 항목들(_dataset, _color, _label, _track)
     * @param columns  켜진 카테고리(열 순서 = 매니페스트 순서)
     */
    function setData(entries, columns) {
      var keepU = cols.length && W ? uAtScreen(W / 2) : null;   // 가운데 보던 자리
      cols = columns.map(function (ds) {
        var mine = entries.filter(function (e) { return e._dataset === ds.id; });
        var events = mine.slice().sort(function (a, b) {
          var ra = KIND_RANK[a.kind] != null ? KIND_RANK[a.kind] : 2;
          var rb = KIND_RANK[b.kind] != null ? KIND_RANK[b.kind] : 2;
          if (ra !== rb) return ra - rb;
          return (b.end_year - b.start_year) - (a.end_year - a.start_year);
        });
        var blocks = ds.track === 'nation'
          ? layoutBlocks(mine.filter(function (e) { return (e.kind === 'polity' || e.kind === 'era') && e.end_year > e.start_year; }))
          : [];
        blocks.sort(function (a, b) { return a.depth - b.depth; });   // 상위 칸을 먼저 칠한다
        return { ds: ds, events: events, blocks: blocks, periods: ds.track === 'nation' ? (ds.periods || []) : [] };
      });
      // 연도 축은 앞쪽 국가사 열들 뒤에. 국가사만·주제사만 켜져 있으면 맨 앞에
      var nations = 0;
      while (nations < cols.length && cols[nations].ds.track === 'nation') nations += 1;
      axisAt = nations > 0 && nations < cols.length ? nations : 0;
      if (keepU != null) pinU(keepU, W / 2);
      clampCam();
      invalidate();
    }

    // ----------------------------------------------------------- 그리기

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // 크기를 다시 재도(탭 전환·회전) 초점 고리의 해는 그대로
      var keep = W ? yearAt(focusY()) : null;
      var wasOn = geo.on;
      if (wasOn) setPlane(false);
      dpr = Math.min(2.5, global.devicePixelRatio || 1);
      W = r.width;
      Hv = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(Hv * dpr);
      geo.B = clamp(Hv * 0.16, 80, 150);          // 회전축 아래(계기판·탭에 가리는 쪽)
      geo.yP = Hv - geo.B;
      geo.P = Math.max(Hv * 1.1, 600);
      if (wasOn) setPlane(true);
      else sizePlane(Hv);
      if (keep != null) cam.t0 = keep - focusY() / cam.s;
      clampCam();
      invalidate();
    }

    function sizePlane(h) {
      H = h;
      pp.resize(W, h, Hv, dpr);
    }

    /**
     * 판 키우기/되돌리기. 키우면 판이 회전축 위쪽으로 길어지므로(먼 과거까지 보이게)
     * 같은 그림이 같은 자리에 있도록 맨 위의 해(t0)를 그만큼 당겨 둔다.
     */
    function setPlane(on) {
      if (on === geo.on || !W) return;
      motion.mode = 'idle';
      if (on) {
        // GL 은 판이 길어도 메모리가 들지 않아 지평선 가까이까지, 2D 는 캔버스 크기 때문에 덜 길게
        var h = pp.kind === 'gl' ? Math.round(Hv * 4) : Math.round(Math.min(Hv * 2.6, Hv + 2400));
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
      canvas.classList.toggle('is-tilted', geo.th > 0.02);
      if (pp.kind === 'gl') return;   // GL 은 그릴 때 카메라를 기울인다
      st.top = (geo.yP - geo.Dtop) + 'px';
      st.transformOrigin = '50% ' + geo.Dtop + 'px';
      st.transform = 'perspective(' + geo.P.toFixed(0) + 'px) rotateX(' + (geo.th * 180 / Math.PI).toFixed(2) + 'deg)';
      // 먼 끝은 별빛 속으로 사라지듯
      var fade = 'linear-gradient(to bottom, transparent 0, #000 ' + (geo.th > 0.02 ? 22 : 0) + '%)';
      st.webkitMaskImage = st.maskImage = fade;
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

    // 판에 쓰는 글꼴 — 붓에 넘기는 { px, weight, family }
    function font(px, weight, display) {
      var key = px + '|' + (weight || '') + '|' + (display ? 'd' : 's');
      var f = fonts[key];
      if (!f) f = fonts[key] = { px: px, weight: weight || '', family: display ? colors.display : colors.sans };
      return f;
    }

    /** 판 글자를 폭에 맞게 줄임(붓으로 잰다) */
    function pfit(text, maxW, f) {
      if (maxW <= 8) return '';
      if (pp.measure(text, f) <= maxW) return text;
      var t = text;
      while (t.length > 1 && pp.measure(t + '…', f) > maxW) t = t.slice(0, -1);
      return t + '…';
    }

    function fitText(text, maxW) {
      if (maxW <= 8) return '';
      if (ctx.measureText(text).width <= maxW) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    }

    function draw() {
      pp.begin();
      hits = [];
      focusBox = null;
      var yTop = yearAt(-40);
      var yBot = yearAt(H + 40);
      var c = cw();
      var axL = axisLeft();
      var ax = axL + axisW();      // 연도 축 칸의 오른쪽
      var focusYear = yearAt(focusY());

      // 1) 시대 띠(아주 옅은 면 + 경계선)와 장면 경계
      eras.forEach(function (era) {
        var a = yOf(era.start_year);
        var b = yOf(era.end_year);
        if (b < -10 || a > H + 10) return;
        var strip = era.strip || '#8c6a4f';
        pp.rect(0, Math.max(a, 0), W, Math.min(b, H) - Math.max(a, 0), strip, 0.06);
        pp.rect(0, a, W, 1.5, strip, 0.5);
        (era.scenes || []).forEach(function (sc, i) {
          if (i === 0) return;
          var y = yOf(sc.start_year);
          if (y < HEAD_H || y > H) return;
          pp.line(0, y, W, y, colors.line, 1, 1, [4, 6]);
        });
      });

      // 2) 열 — 경계선, 그리고 열마다 왕조 띠와 사건
      for (var i = 0; i < cols.length; i += 1) {
        var x = xOfCol(i);
        if (x > W || x + c < 0) continue;
        pp.line(x, 0, x, H, colors.line, 0.5, 1);
        // 축 바로 앞 열과 마지막 열은 오른쪽 경계도
        if (i === cols.length - 1 || i === axisAt - 1) pp.line(x + c, 0, x + c, H, colors.line, 0.5, 1);
        drawColumn(cols[i], x, c, yTop, yBot, focusYear);
      }

      // 3) 시간 눈금 — 열들 사이에 끼어 함께 움직이고, 화면 밖으로 나가려 하면 가장자리에 붙는다
      drawAxis(axL, yTop, yBot);
      pp.end({
        th: geo.on ? geo.th : 0, P: geo.P, yP: geo.yP,
        pivot: geo.on ? geo.Dtop : geo.yP,          // 납작할 땐 판 좌표 = 화면 좌표
        fade: geo.th > 0.02 ? [0, H * 0.22] : null  // 먼 끝은 별빛 속으로 사라지듯
      });

      // 여기부터는 납작한 덮개 — 눕혀도 똑바로 읽히게
      ctx = octx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hv);

      // 4) 시대 이름·장면 이름 — 연도 축 옆 위쪽에 붙어 따라온다
      drawEraTitles(axL, ax);

      // 5) 열 이름 — 화면 위에 붙어 있다
      drawHeads(c);

      // 6) 펼친 항목의 화면 위 자리 — 앱이 상세 카드를 그 옆에 붙인다(눕혔으면 원근을 씌운 자리)
      if (focus && opts.onFocus) {
        var r = null;
        if (focusBox) {
          var a = proj(focusBox.x0, focusBox.y0);
          var b = proj(focusBox.x1, focusBox.y1);
          r = { x: Math.min(a.x, b.x), y: Math.max(HEAD_H, Math.min(a.y, b.y)), w: Math.abs(b.x - a.x), h: 0 };
          r.h = Math.max(0, Math.min(Hv, Math.max(a.y, b.y)) - r.y);
          if (r.h < 4 || r.x > W || r.x + r.w < 0) r = null;
        }
        opts.onFocus(r, motion.mode === 'idle' && !gesture);
      }
    }

    /** 시대 묶음 띠 폭 — 열이 넓을 때만 글자가 들어갈 만큼 */
    function periodW(col, c) {
      if (!col.periods.length) return 0;
      return c >= 110 ? 20 : (c >= 60 ? 6 : 0);
    }

    /** 세로쓰기(한 글자씩 아래로) — 좁은 칸·띠의 이름 */
    function drawVertical(text, cx, y, f, color, alpha, lineH) {
      var chars = text.replace(/\s+/g, '').split('');
      chars.forEach(function (ch, i) { pp.text(ch, cx, y + i * lineH, f, color, alpha, 'center'); });
      return chars.length * lineH;
    }

    function stickyTop() { return geo.on ? 0 : HEAD_H + 6; }

    /** 시대 묶음(삼국 시대·송원 시대…) — 열 왼쪽 띠. 누르면 그 시대로 */
    function drawPeriods(col, x, pw) {
      var top = stickyTop();
      col.periods.forEach(function (pd, i) {
        var a = yOf(pd.start_year);
        var b = yOf(pd.end_year);
        if (b < 0 || a > H) return;
        pp.rect(x + 2, a + 1, pw - 3, Math.max(2, b - a - 2), col.ds.color, i % 2 ? 0.34 : 0.2, 4);
        hits.push({ x: x, y: a, w: pw, h: b - a, era: pd });
        if (pw < 16) return;
        var f = font(11, '700');
        var y = Math.max(a, top) + 15;
        var label = (b - y - 6 >= pd.label.replace(/\s+/g, '').length * 13) ? pd.label : pd.label.replace(/\s*시대$/, '');
        if (b - y - 6 < label.replace(/\s+/g, '').length * 13) return;
        drawVertical(label, x + 2 + (pw - 3) / 2, y, f, colors.inkBg, 0.9, 13);
      });
    }

    /**
     * 왕조 칸 — 옅은 색 칸 + 이름(보이는 부분 위쪽에 붙어 따라온다).
     * @returns { labeled: {항목 id: true}, rects: [이름이 차지한 자리] } — 사건 이름표가 피해 가게
     */
    function drawBlocks(col, bx, bw, focusYear) {
      var top = stickyTop();
      var cand = {};   // 항목마다 이름을 쓸 수 있는 조각들 — 그중 가장 이른(위쪽) 것에 쓴다
      var mine = [];   // 펼친 항목의 조각들 — 다 모아 바깥 윤곽 하나로 두른다
      col.blocks.forEach(function (p) {
        var a = yOf(p.y0);
        var b = yOf(p.y1);
        if (b < 0 || a > H) return;
        var e = p.entry;
        var inset = p.depth * 3;
        var px = bx + p.fx0 * bw + inset + 1;
        var w = (p.fx1 - p.fx0) * bw - inset * 2 - 2;
        if (w < 1.5) return;
        var live = e.start_year <= focusYear && focusYear < e.end_year;
        var alpha = (p.depth ? 0.16 : (e.kind === 'era' ? 0.14 : 0.2)) + p.shade * 0.07 + (live ? 0.1 : 0);
        // 한 나라가 여러 조각으로 나뉘어도(이웃 나라가 생기고 사라질 때마다 폭이 바뀐다) 한 덩어리로 보이게,
        // 틈과 둥근 모서리는 그 나라가 시작·끝나는 곳에만
        var first = p.y0 <= e.start_year;
        var last = p.y1 >= e.end_year;
        var ga = first ? 1 : 0;
        var gb = last ? 1 : 0;
        pp.rect(px, a + ga, w, Math.max(2, b - a - ga - gb), e._color, alpha, first && last ? Math.min(6, w / 2) : 0);
        if (focus && focus.id === e.id) mine.push({ x: px, y: a + ga, w: w, h: Math.max(2, b - a - ga - gb) });
        hits.push({ x: px, y: a, w: w, h: b - a, entry: e, block: true });
        var vis = b - Math.max(a, top);
        if (vis >= 20) (cand[e.id] = cand[e.id] || []).push({ p: p, x: px, w: w, a: a, b: b });
      });

      if (mine.length) contour(mine);

      // 이름 자리: 화면에 보이는 조각 중 가장 위의 것부터, 가로(줄여서라도) 또는 세로로 들어가는 첫 조각
      function fits(k) {
        var e = k.p.entry;
        var y = labelY(k);
        if (y + 4 > k.b) return false;
        var f = font(k.p.depth ? 12 : 13, '700');
        if (pp.measure(shortTitle(e.title), f) <= k.w - 10 || k.w >= 44) return true;
        var n = shortTitle(e.title).replace(/\s+/g, '').length;
        return k.w >= 13 && k.b - (y - 4) >= n * 12 + 6;
      }
      function labelY(k) { return Math.max(k.a, top) + 17; }
      var best = {};
      Object.keys(cand).forEach(function (id) {
        var list = cand[id].sort(function (p, q) { return p.a - q.a; });
        for (var i = 0; i < list.length; i += 1) { if (fits(list[i])) { best[id] = list[i]; return; } }
      });

      var labeled = {};
      var rects = [];
      function hitsLabel(r) {
        return rects.some(function (q) { return r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h; });
      }
      // 상위 칸 이름부터 — 하위 칸 이름이 같은 자리에 오면(같은 해에 시작) 한 줄씩 아래로 비킨다
      Object.keys(best).map(function (id) { return best[id]; })
        .sort(function (p, q) { return p.p.depth - q.p.depth || p.a - q.a; })
        .forEach(function (k) {
          var e = k.p.entry;
          var id = e.id;
          var y = labelY(k);
          var f = font(k.p.depth ? 12 : 13, '700');
          var title = e.title;
          var tw = pp.measure(title, f);
          if (tw > k.w - 10) { title = shortTitle(e.title); tw = pp.measure(title, f); }
          var vt = shortTitle(e.title).replace(/\s+/g, '');
          var vertOk = k.w >= 13 && k.b - (y - 4) >= vt.length * 12 + 6;
          // 안 들어가면: 넉넉히 넓으면 줄여 쓰고, 좁으면(줄이면 '아바…'처럼 되니) 세로로
          if (tw <= k.w - 10 || (k.w >= 44 && y + 4 < k.b && !(vertOk && k.w < 90))) {
            var t = pfit(title, k.w - 10, f);
            if (!t) return;
            tw = pp.measure(t, f);
            var r = { x: k.x + 2, y: y - 15, w: tw + 10, h: 21 };
            while (hitsLabel(r) && r.y + 40 < k.b) r.y += 18;
            if (hitsLabel(r) || r.y + 19 > k.b) return;
            pp.text(t, k.x + 6, r.y + 15, f, colors.ink, 0.88);
            labeled[id] = true;
            rects.push(r);
            return;
          }
          // 좁은 칸은 세로로
          if (!vertOk) return;
          var rv = { x: k.x, y: y - 15, w: k.w, h: vt.length * 12 + 6 };
          if (hitsLabel(rv)) return;
          drawVertical(vt, k.x + k.w / 2, y - 2, font(11, '700'), colors.ink, 0.88, 12);
          labeled[id] = true;
          rects.push(rv);
        });
      return { labeled: labeled, rects: rects };
    }

    function drawColumn(col, x, c, yTop, yBot, focusYear) {
      if (!col) return;
      var pw = periodW(col, c);
      if (pw) drawPeriods(col, x, pw);

      // 나라별 왕조·시대 칸(겹치면 나란히, 하위 시기는 안쪽에)
      var lab = col.blocks.length ? drawBlocks(col, x + 3 + pw, c - 6 - pw, focusYear) : { labeled: {}, rects: [] };

      // 사건 — 이 열 안에서만 자리를 잡는다. 이름이 이미 칸에 쓰인 왕조는 다시 쓰지 않는다
      var ex = x + 6 + pw;
      var ew = Math.max(0, c - 12 - pw);
      if (ew < DOT + 2) return;
      var grid = [];
      var unitsN = Math.max(1, Math.floor(ew / UNIT));
      for (var u = 0; u < unitsN; u += 1) grid.push([]);
      lab.rects.forEach(function (r) {
        var c0 = Math.floor((r.x - ex) / UNIT);
        mark(grid, c0, Math.ceil((r.x + r.w - ex) / UNIT) - c0, r.y, r.y + r.h);
      });
      var hidden = {};
      for (var k = 0; k < col.events.length; k += 1) {
        var ev = col.events[k];
        if (lab.labeled[ev.id]) continue;
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
        var f = font(11, '700');
        var w = pp.measure(label, f) + 12;
        var bx = x + c - w - 4;
        pp.rect(bx, cy - 9, w, 18, colors.inkBg, 0.78, 9);
        pp.text(label, bx + 6, cy + 4, f, colors.foam);
        hits.push({ x: bx - 4, y: cy - 13, w: w + 8, h: 26, cluster: g.sum / g.n, col: col });
      });
    }

    /** axL = 연도 축 칸의 왼쪽(화면 x). 눈금·글자는 칸 오른쪽 선(ax)에 붙는다 */
    function drawAxis(axL, yTop, yBot) {
      var flip = axisFlip();
      var ax = axisLine();
      var dir = flip ? -1 : 1;                 // 눈금이 그림 쪽으로 뻗는 방향의 반대
      var tx = flip ? axL + 12 : ax - 12;      // 연도 글자 자리
      var align = flip ? 'left' : 'right';
      // 눈금 칸 바탕(가장자리에 붙어 열 위에 얹혀도 읽히게). 눕히면 비스듬한 띠가 무거워 보여 옅게
      pp.rect(axL, 0, axisW(), H, colors.sky, geo.th > 0.02 ? 0.5 : 0.86);

      var step = STEPS[STEPS.length - 1];
      for (var k = 0; k < STEPS.length; k += 1) { if (STEPS[k] * cam.s >= 56) { step = STEPS[k]; break; } }
      var first = Math.ceil(yTop / step) * step;
      var lastTick = Math.min(yBot, PRESENT);   // 지금 뒤(아직 오지 않은 해)에는 눈금을 긋지 않는다
      for (var yr = first; yr <= lastTick; yr += step) {
        var y = yOf(yr);
        var major = (yr / step) % 5 === 0;
        pp.line(ax - dir * (major ? 10 : 6), y, ax, y, colors.line, major ? 0.9 : 0.45, 1);
        if (yr === 0) continue;
        var ink = major ? colors.inkBg : colors.inkBg2;
        var fNum = font(12, major ? '700' : '');
        if (yr < 0) {
          pp.text('기원전', tx, y - 6, font(10), ink, 1, align);
          pp.text(String(-yr), tx, y + 8, fNum, ink, 1, align);
        } else {
          pp.text(String(yr), tx, y + 4, fNum, ink, 1, align);
        }
      }
      var yNow = Math.min(H, yOf(PRESENT));
      pp.line(ax, Math.max(0, yOf(T_MIN)), ax, yNow, colors.line, 1, 2);

      // '지금' — 시간축의 끝
      if (yNow > 0 && yNow < H) {
        pp.line(0, yNow, W, yNow, colors.star, 1, 2);
        pp.circle(ax, yNow, 5, colors.star);
        // 축이 오른쪽 가장자리에 붙어 있으면 글은 축 왼쪽에
        var right = ax + 260 < W;
        pp.text('지금', right ? ax + 10 : axL - 10, yNow + 24, font(15, '700', true), colors.star, 1, right ? 'left' : 'right');
        pp.text('이야기는 여기서부터 아직 쓰이는 중', right ? ax + 50 : axL - 50, yNow + 24, font(12), colors.inkBg2, 1, right ? 'left' : 'right');
      }
    }

    /** 시대 이름(띠 안에서 화면 위쪽에 붙어 따라옴) + 장면 이름 — 연도 축 오른쪽(자리가 없으면 왼쪽) */
    function drawEraTitles(axL, ax) {
      // 판 위 시대 경계를 화면으로 옮겨 놓고, 그 사이에서 위쪽에 붙인다
      var top = geo.on ? Math.max(HEAD_H, proj(ax, 0).y) : HEAD_H;
      var axAt = function (sy) { return proj(ax, unproj(W / 2, sy).y).x; };
      eras.forEach(function (era) {
        var a = proj(ax, yOf(era.start_year)).y;
        var b = proj(ax, yOf(era.end_year)).y;
        if (b - a < 40 || b < top || a > Hv) return;
        var y = clamp(top + 30, a + 30, b - 10);
        ctx.font = '700 24px ' + colors.display;
        var tw = ctx.measureText(era.label).width;
        ctx.font = '12px ' + colors.sans;
        var rw = ctx.measureText(era.range || '').width;
        var bx = axAt(y) + 8;
        if (bx + tw + rw + 24 > W) bx = proj(axL, unproj(W / 2, y).y).x - tw - rw - 28;
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
          if (sx + lw + 10 > W) sx = proj(axL, yOf(sc.start_year)).x - lw - 14;
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
    function drawHeads(c0) {
      // 눕혀 있으면 머리글 줄 높이(화면)에 닿는 판의 깊이에서 열이 어디 있는지로 줄 세운다
      var py = Math.max(0, unproj(W / 2, HEAD_H / 2).y);
      var f = proj(W / 2, py).f;
      var c = c0 * f;
      var left = proj(0, py).x;
      var right = proj(W, py).x;
      ctx.fillStyle = colors.sky;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(0, 0, W, HEAD_H);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath(); ctx.rect(left, 0, right - left, HEAD_H); ctx.clip();
      for (var i = 0; i < cols.length; i += 1) {
        var col = cols[i];
        var x = W / 2 + (xOfCol(i) - W / 2) * f;
        if (x > W || x + c < 0) continue;
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
      ctx.beginPath(); ctx.moveTo(0, HEAD_H); ctx.lineTo(W, HEAD_H); ctx.stroke();
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
      var w = Math.min(190, pp.measure(ev.title, font(13))) + 30;
      labelWidth[ev.id] = w;
      return w;
    }

    /** 펼친 항목 테두리 */
    function outline(x, y, w, h) {
      contour([{ x: x, y: y, w: w, h: h }]);
    }

    /**
     * 위아래로 이어진 조각들(이웃 나라가 생기고 사라질 때마다 폭이 바뀐다)의 바깥 윤곽 하나.
     * 옆선은 조각마다, 가로선은 맨 위·맨 아래와, 이음매에서 폭이 어긋난 부분에만 긋는다.
     */
    function contour(list) {
      var t = 2.5;
      var col = colors.star;
      var GAP = 3;   // 이음매 틈(1px 씩)과 반올림
      list.sort(function (p, q) { return p.y - q.y; });
      function hline(x0, x1, y) { if (x1 - x0 > 0.5 && y >= -10 && y <= H + 10) pp.rect(x0 - t, y, x1 - x0 + t * 2, t, col, 0.95); }
      list.forEach(function (r, i) {
        var top = Math.max(r.y, -10);
        var bot = Math.min(r.y + r.h, H + 10);
        if (bot > top) {
          pp.rect(r.x - t, top, t, bot - top, col, 0.95);
          pp.rect(r.x + r.w, top, t, bot - top, col, 0.95);
          box(r.x, top, r.x + r.w, bot);
        }
        var prev = list[i - 1];
        var joined = prev && r.y - (prev.y + prev.h) <= GAP;
        if (!joined) hline(r.x, r.x + r.w, r.y - t);
        else {
          // 이음매 — 위 조각과 겹치지 않는 가로 구간만, 이음매 틈도 옆선으로 메운다
          var y = prev.y + prev.h;
          pp.rect(r.x - t, y, t, r.y - y, col, 0.95);
          pp.rect(r.x + r.w, y, t, r.y - y, col, 0.95);
          hline(Math.min(prev.x, r.x), Math.max(prev.x, r.x), y);
          hline(Math.min(prev.x + prev.w, r.x + r.w), Math.max(prev.x + prev.w, r.x + r.w), y);
        }
        var next = list[i + 1];
        if (!next || next.y - (r.y + r.h) > GAP) hline(r.x, r.x + r.w, r.y + r.h);
      });
    }

    /** 펼친 항목이 그려진 자리를 하나로 합친다(카드를 붙일 곳) */
    function box(x0, y0, x1, y1) {
      if (!focusBox) { focusBox = { x0: x0, y0: y0, x1: x1, y1: y1 }; return; }
      focusBox.x0 = Math.min(focusBox.x0, x0); focusBox.y0 = Math.min(focusBox.y0, y0);
      focusBox.x1 = Math.max(focusBox.x1, x1); focusBox.y1 = Math.max(focusBox.y1, y1);
    }

    function drawCard(ev, x, y, w) {
      if (focus && focus.id === ev.id) outline(x, y, w, CARD_H);
      pp.card(x, y, w, CARD_H, 14, colors.foam, 'rgba(58, 42, 36, .14)', 12, 4);
      pp.strip(x, y, w, CARD_H, 14, 6, ev._color);
      var years = ev.end_year !== ev.start_year ? yearText(ev.start_year) + '–' + yearText(ev.end_year) : yearText(ev.start_year);
      var fy = font(11);
      var ft = font(14, '700');
      pp.text(pfit(years, w - 26, fy), x + 16, y + 20, fy, colors.ink2);
      pp.text(pfit(ev.title, w - 26, ft), x + 16, y + 42, ft, colors.ink);
      hits.push({ x: x, y: y, w: w, h: CARD_H, entry: ev });
    }

    function drawLabel(ev, x, y, w) {
      if (focus && focus.id === ev.id) outline(x, y, w, LABEL_H);
      var f = font(13);
      pp.rect(x, y, w, LABEL_H, colors.foam, 0.92, 12);
      pp.circle(x + 12, y + LABEL_H / 2, 4.5, ev._color);
      pp.text(pfit(ev.title, w - 30, f), x + 22, y + LABEL_H / 2 + 4.5, f, colors.ink);
      hits.push({ x: x, y: y, w: w, h: LABEL_H, entry: ev });
    }

    function drawDot(ev, x, y) {
      if (focus && focus.id === ev.id) outline(x - DOT / 2, y - DOT / 2, DOT, DOT);
      pp.circle(x, y, DOT / 2 - 1 + 0.75, colors.foam);
      pp.circle(x, y, DOT / 2 - 1 - 0.75, ev._color);
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
      var td = now();
      draw();
      stats.draw = now() - td;
      if (opts.onCamera) {
        opts.onCamera({
          year: clamp(yearAt(focusY()), T_MIN, T_MAX),   // 고무줄로 넘친 동안에도 역사 밖 해는 안 보이게
          s: cam.s,
          moving: moving,
          dragging: !!(gesture && gesture.active),
          ringX: proj(axisLine(), focusY()).x,
          tilt: tilt.cur
        });
      }
      if (moving) raf = global.requestAnimationFrame(frame);
      else lastT = 0;
    }

    function step(dt, t) {
      if (motion.mode === 'fling') {
        cam.t0 += motion.vt * dt;
        cam.x0 += motion.vx * dt;
        var k = Math.exp(-FRICTION * dt);
        var L = limits();
        // 끝을 넘어서면 확 붙잡혀 느려진다 — 그다음엔 튕겨 돌아오기
        var outT = cam.t0 < L.tA || cam.t0 > L.tB;
        var outU = cam.x0 < L.xA || cam.x0 > L.xB;
        var hard = Math.exp(-26 * dt);
        motion.vt *= outT ? hard : k;
        motion.vx *= outU ? hard : k;
        var slowT = Math.abs(motion.vt * cam.s) < (outT ? 60 : 8);
        var slowU = Math.abs(motion.vx) < (outU ? 60 : 8);
        if (slowT && slowU) motion.mode = outT || outU ? 'spring' : 'idle';
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'spring') {
        var B = limits();
        var pull = 1 - Math.exp(-SPRING * dt);
        var gt = clamp(cam.t0, B.tA, B.tB);
        var gx = clamp(cam.x0, B.xA, B.xB);
        cam.t0 += (gt - cam.t0) * pull;
        cam.x0 += (gx - cam.x0) * pull;
        if (Math.abs(gt - cam.t0) * cam.s < 0.4 && Math.abs(gx - cam.x0) < 0.4) {
          cam.t0 = gt;
          cam.x0 = gx;
          motion.mode = 'idle';
        }
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'fly') {
        var f = motion.fly;
        var p = clamp((t - f.t0) / f.dur, 0, 1);
        var v = f.path.at(easeInOutCubic(p));
        cam.s = clamp(Hv / v.w, sMin() * 0.5, S_MAX);
        cam.t0 = v.c - f.fy / cam.s;
        pinU(f.u0 + (f.u1 - f.u0) * v.k, W / 2);   // 가운데 보던 자리(또는 고른 열)를 가운데에 — 이동이 진행된 만큼
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
        pinU(z.u, z.x);
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
      var u0 = uAtScreen(W / 2);
      var u1 = o.col != null && o.col >= 0 ? colU(o.col) + 0.5 : u0;
      if (reduced || o.instant) {
        cam.s = s;
        cam.t0 = year - fy / s;
        pinU(u1, W / 2);
        motion.mode = 'idle';
        invalidate();
        return;
      }
      // 시간 축의 '보이는 구간' 기준으로 줌·이동 경로를 짠다 — 멀리 갈수록 잠깐 물러났다가 다가간다
      var path = zoomPath(y0, Hv / cam.s, year, Hv / s);
      motion.fly = {
        t0: now(), dur: clamp(path.S * 620, 420, 1900),
        path: path, fy: fy, u0: u0, u1: u1
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
        u: same ? motion.zoomTo.u : uAtScreen(x)
      };
      motion.mode = 'zoom';
      lastT = 0;
      invalidate();
    }

    /** 손가락을 그대로 따라가는 줌(트랙패드 핀치) — 부드럽게 늦추지 않고 바로 */
    function zoomNow(x, y, factor) {
      motion.mode = 'idle';
      var year = yearAt(y);
      var u = uAtScreen(x);
      cam.s = clamp(cam.s * factor, sMin(), S_MAX);
      cam.t0 = year - y / cam.s;
      pinU(u, x);
      invalidate();
    }

    /**
     * 항목 펼치기 — 그 왕조·시대가 화면을 채우도록 날아가고 테두리를 두른다(ChronoZoom 처럼).
     * 기간이 있으면 그 기간이 화면 높이에 맞게, 한 해짜리 사건이면 앞뒤 수십 년이 보이게.
     * @param col 그 항목의 열 번호(켜진 열 기준). 없으면 가로는 그대로
     */
    function focusEntry(entry, col) {
      focus = { id: entry.id };
      var o = { col: col };
      var span = entry.end_year - entry.start_year;
      if (span >= 1) {
        // 위아래로 숨 쉴 틈을 두고 기간을 화면에 맞춘다(아래쪽 계기판·카드 자리도 남겨 둔다)
        var room = Math.max(120, Hv - HEAD_H - (opts.bottomCover ? opts.bottomCover() : 0));
        var s = clamp((room * 0.62) / span, sMin(), S_MAX);
        var top = HEAD_H + room * 0.12;
        flyTo(entry.start_year + (focusY() - top) / s, s, o);
      } else {
        flyTo(entry.start_year, clamp(Math.max(cam.s, Hv / 70), sMin(), S_MAX), o);
      }
      invalidate();
    }

    function blur() {
      if (!focus) return;
      focus = null;
      if (opts.onFocus) opts.onFocus(null, true);
      invalidate();
    }

    function panBy(dy, dx) {
      motion.mode = 'idle';
      if (dx) { cam.x0 += dx; clampCam(); }
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
          t0: unrubber(cam.t0, L.tA, L.tB, cam.s, Hv), cx0: unrubber(cam.x0, L.xA, L.xB, 1, W)
        };
      } else if (ids.length === 2) {
        // 어느 쪽인지 정해질 때까지 그대로 — 정해지면 처음 자리 기준으로 이어 간다
        gesture = { kind: 'two', ids: ids, a0: pointers[ids[0]], b0: pointers[ids[1]], th0: tilt.target, active: true };
      }
    });

    function startPinch(a, b) {
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      gesture = { kind: 'pinch', d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), s0: cam.s, year: yearAt(my), u: uAtScreen(mx), active: true };
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
        cam.x0 = rubber(gesture.cx0 - dx, L.xA, L.xB, 1, W);
        gesture.samples.push({ t: e.timeStamp, t0: cam.t0, x0: cam.x0 });
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
        pinU(gesture.u, mx);
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
          ? { kind: 'pan', id: Number(rest[0]), x0: pointers[rest[0]].x, y0: pointers[rest[0]].y, sx0: pointers[rest[0]].sx, sy0: pointers[rest[0]].sy, t0: cam.t0, cx0: cam.x0, at: e.timeStamp, active: true, samples: [] }
          : null;
        return;
      }
      gesture = null;
      canvas.classList.remove('is-dragging');
      var L = limits();
      var out = cam.t0 < L.tA || cam.t0 > L.tB || cam.x0 < L.xA || cam.x0 > L.xB;
      if (g.active) {
        var s = g.samples;
        if (s.length > 1 && e.timeStamp - s[s.length - 1].t < 90) {
          var span = Math.max(8, s[s.length - 1].t - s[0].t) / 1000;
          motion.vt = (s[s.length - 1].t0 - s[0].t0) / span;
          motion.vx = (s[s.length - 1].x0 - s[0].x0) / span;
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
        clearTimeout(pendingOpen);   // 두 번 톡이면 열기·닫기를 미룬 것은 취소
        zoomAround(p.x, p.y, 2.6);
        return;
      }
      lastTap = { t: tapAt, x: p.sx, y: p.sy };
      var h = hitAt(p);
      if (!h) {
        if (focus) {
          clearTimeout(pendingOpen);
          pendingOpen = setTimeout(function () { blur(); }, 300);   // 두 번 톡(줌)이면 닫지 않는다
        }
        return;
      }
      // 왕조 칸은 열 바탕을 거의 다 덮으므로, 두 번 톡(줌)일 수 있게 잠깐 기다렸다 연다(지도 앱과 같은 방식)
      if (h.block && opts.openEntry) {
        clearTimeout(pendingOpen);
        pendingOpen = setTimeout(function () { opts.openEntry(h.entry); }, 300);
        return;
      }
      if (h.entry && opts.openEntry) opts.openEntry(h.entry);
      else if (h.era) flyToRange(h.era.start_year, h.era.end_year);
      else if (h.head != null) flyTo(yearAt(focusY()), Math.max(cam.s, 1.2), { col: h.head });
      else if (h.cluster != null) flyTo(h.cluster, cam.s * 3.2, { col: cols.indexOf(h.col) });
    }

    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    // 마우스·트랙패드 — 무한 캔버스 앱(Figma·Miro·tldraw)의 표준을 따른다.
    //   두 손가락 스크롤·마우스 휠 = 이동(위아래 = 시간, 옆 = 열). 맥은 손을 떼도 OS 가 관성 스크롤을 이어 보낸다
    //   트랙패드 핀치 = 커서 자리에서 줌(크롬·파이어폭스·엣지는 ctrlKey 가 붙은 휠, 사파리는 gesture 이벤트)
    //   ⌘/Ctrl + 휠 = 줌(마우스), Alt(Option) + 휠 = 눕히기, Shift + 휠 = 가로 이동(윈도 마우스)
    var safariPinch = null;
    canvas.addEventListener('wheel', function (e) {
      if (!active) return;
      e.preventDefault();
      var p = local(e);
      var unit = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? H : 1);
      var dy = e.deltaY * unit;
      var dx = e.deltaX * unit;
      if (e.altKey) {
        // Alt(Option)+휠 — 굴려 올리면 눕고 내리면 선다. 맥에서 Option+휠은 가로로 올 때가 있어 큰 쪽을 쓴다
        var dd = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        setTilt(tilt.target - dd * 0.0035, true);
        clearTimeout(tilt.snapTimer);
        tilt.snapTimer = setTimeout(settleTilt, 260);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (safariPinch) return;   // 사파리가 핀치를 gesture 와 휠로 겹쳐 보내도 한 번만
        // 마우스 휠 한 칸(줄 단위이거나 큰 값)은 부드럽게, 트랙패드 핀치(작은 값이 잇달아)는 손가락 그대로
        var notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
        if (notch) zoomAround(p.x, p.y, Math.exp(-clamp(dy, -100, 100) * 0.0035));
        else zoomNow(p.x, p.y, Math.exp(-clamp(dy, -30, 30) * 0.012));
        return;
      }
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }   // 윈도 마우스: Shift+휠은 가로(맥은 OS 가 이미 가로로 바꿔 보낸다)
      motion.mode = 'idle';
      cam.x0 += dx;
      cam.t0 += dy / cam.s;
      invalidate();
    }, { passive: false });

    // 사파리(맥) 트랙패드 핀치 — 휠 대신 gesture 이벤트로 온다. 막지 않으면 페이지 전체가 확대된다.
    // 아이폰·아이패드의 손가락 핀치도 gesture 를 보내지만 그건 포인터 이벤트가 이미 처리하므로 건너뛴다
    function touchActive() { return Object.keys(pointers).length > 0; }
    canvas.addEventListener('gesturestart', function (e) {
      e.preventDefault();
      if (!active || touchActive()) return;
      safariPinch = { scale: 1 };
    });
    canvas.addEventListener('gesturechange', function (e) {
      e.preventDefault();
      if (!safariPinch || touchActive()) return;
      var p = local(e);
      zoomNow(p.x, p.y, e.scale / safariPinch.scale);
      safariPinch.scale = e.scale;
    });
    canvas.addEventListener('gestureend', function (e) {
      e.preventDefault();
      safariPinch = null;
    });

    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });

    if (global.ResizeObserver) new ResizeObserver(function () { if (active) resize(); }).observe(canvas);

    // 웹 글꼴이 늦게 도착하면 대체 글꼴로 재 둔 폭·써 둔 글자를 버리고 다시
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', function () {
        labelWidth = {};
        pp.resetText();
        invalidate();
      });
    }

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
      focusEntry: focusEntry,
      blur: blur,
      focused: function () { return focus ? focus.id : null; },
      zoomBy: function (f) { zoomAround(W / 2, focusY(), f); },
      panBy: panBy,
      axisX: function () { return proj(axisLine(), focusY()).x; },
      /** 눕히기 — 0(납작) ~ TILT_MAX 라디안 */
      setTilt: function (th, instant) { setTilt(th, instant); if (!instant) settleTilt(); },
      toggleTilt: function () { setTilt(tilt.target > TILT_SNAP ? 0 : TILT_ON); },
      get tilt() { return tilt.cur; },
      get painter() { return pp.kind; },
      get stats() { return stats; },   // 'gl'(Three.js) | '2d'(대체)
      /** 처음 열 때 — 문명사(기원전 4200년~지금)가 화면에 들어오게 */
      home: function () {
        setTilt(0, true);
        cam.s = clamp(((Hv - HEAD_H) * 0.86) / (T_MAX + 4200), sMin(), S_MAX);
        cam.t0 = -4200 - (Hv * 0.04 + HEAD_H) / cam.s;
        pinU(axisAt + 0.5, W / 2);   // 연도 축이 화면 가운데에(국가사는 왼쪽, 주제사는 오른쪽)
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
      /** 화면 가운데의 열 좌표(축 칸 포함, 확인용) */
      get column() { return uAtScreen(W / 2); }
    };
  }

  global.BigHistoryZoom = { create: create };
})(window);
