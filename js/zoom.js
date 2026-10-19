/* ------------------------------------------------------------------
   탐험 — 시간 자체를 줌하는 캔버스 (ChronoZoom · Prezi 에서 얻은 생각)

   역사 전체가 하나의 거대한 세로 그림입니다. 위가 옛날, 아래가 지금.
     · 핀치·휠로 줌, 끌어서 이동, 던지면 미끄러짐, 두 번 톡 치면 다가감
     · 시간 눈금은 줌에 맞춰 1만 년 → 1천 년 → 100년 → 10년 → 1년으로 바뀐다
     · 사건은 자리가 넉넉하면 카드, 빠듯하면 이름표, 더 빠듯하면 점, 그래도 안 되면 '+N' 묶음
       (중요한 것부터 자리를 잡는다 — 나라·왕조 > 시대 > 나머지)
     · 왼쪽 세로 띠 = 나라별 왕조·시대가 이어진 기간(타임라인 보기의 색 띠와 같은 뜻)
     · 먼 곳으로 갈 때는 잠깐 물러났다가 다가가는 비행(Prezi 의 장면 전환)

   선형 시간이라 선사(3만 년)가 길고 문명사는 아래쪽에 모여 있다 — 그것이 빅 히스토리의 실제 비율.
   그리기는 <canvas> 하나. 화면이 움직일 때만 다시 그린다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var S_MAX = 260;           // 최대 줌(1년당 px)
  var FRICTION = 2.9;        // 던진 뒤 감속
  var CARD_H = 56;
  var LABEL_H = 24;
  var DOT = 12;
  var UNIT = 8;              // 자리 잡기 격자(px)
  var STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  var KIND_RANK = { polity: 0, era: 1 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function yearText(y) { return y < 0 ? '기원전 ' + Math.abs(y) : String(y); }
  function now() { return global.performance ? performance.now() : Date.now(); }

  /**
   * @param canvas  <canvas id="zoom">
   * @param opts    { eras, focusY(): px, onCamera(info), openEntry(entry), spanKinds }
   */
  function create(canvas, opts) {
    var ctx = canvas.getContext('2d');
    var dpr = 1;
    var W = 0;
    var H = 0;
    var active = false;
    var raf = 0;
    var lastT = 0;

    var eras = opts.eras;
    var T_MIN = eras[0].start_year;
    var T_MAX = eras[eras.length - 1].end_year;

    var data = { events: [], spans: [], lanes: 0 };
    var cam = { t0: -4200, s: 0.1 };                 // 맨 위의 해, 1년당 px
    var motion = { mode: 'idle', vt: 0, fly: null, zoomTo: null };
    var pointers = {};
    var gesture = null;
    var hits = [];
    var colors = {};
    var labelWidth = {};
    var lastTap = null;

    // ----------------------------------------------------------- 좌표

    function focusY() { return opts.focusY ? opts.focusY() : H * 0.36; }
    function yOf(year) { return (year - cam.t0) * cam.s; }
    function yearAt(y) { return cam.t0 + y / cam.s; }
    function sMin() { return (H * 0.92) / (T_MAX - T_MIN); }

    /** 초점선의 해가 역사 범위를 벗어나지 않게 */
    function clampCam() {
      cam.s = clamp(cam.s, sMin(), S_MAX);
      var fy = focusY();
      cam.t0 = clamp(cam.t0, T_MIN - fy / cam.s, T_MAX - fy / cam.s);
    }

    function layoutX() {
      var narrow = W < 640;
      var axis = narrow ? 58 : 84;
      var laneW = narrow ? 6 : 8;
      var laneGap = narrow ? 2 : 3;
      var lanesX = axis + 10;
      var evX = lanesX + data.lanes * (laneW + laneGap) + (narrow ? 10 : 18);
      var maxW = 1100;
      var evR = Math.min(W - (narrow ? 10 : 24), evX + maxW);
      return { axis: axis, laneW: laneW, laneGap: laneGap, lanesX: lanesX, evX: evX, evR: evR,
               cardW: Math.min(narrow ? 270 : 250, evR - evX) };
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
        line: v('--line-bg', 'rgba(92,61,46,.2)'),
        star: v('--star', '#b57a3e'),
        display: v('--display', 'sans-serif'),
        sans: v('--sans', 'sans-serif')
      };
      labelWidth = {};
    }

    // ----------------------------------------------------------- 데이터

    /**
     * @param entries  지금 켜진 카테고리의 항목들(_color, _label, _track 포함)
     * @param spans    왼쪽 띠에 그릴 나라별 기간 [{ lane, entry }]
     * @param lanes    띠 줄 수
     */
    function setData(entries, spans, lanes) {
      var events = entries.slice().sort(function (a, b) {
        var ra = KIND_RANK[a.kind] != null ? KIND_RANK[a.kind] : 2;
        var rb = KIND_RANK[b.kind] != null ? KIND_RANK[b.kind] : 2;
        if (ra !== rb) return ra - rb;
        if (a._track !== b._track) return a._track === 'nation' ? -1 : 1;
        return (b.end_year - b.start_year) - (a.end_year - a.start_year);
      });
      data = { events: events, spans: spans || [], lanes: lanes || 0 };
      invalidate();
    }

    // ----------------------------------------------------------- 그리기

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(2.5, global.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      clampCam();
      invalidate();
    }

    function invalidate() {
      if (!active) return;
      if (!raf) raf = global.requestAnimationFrame(frame);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function fitText(text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      hits = [];
      var L = layoutX();
      var yTop = yearAt(-40);
      var yBot = yearAt(H + 40);

      // 1) 시대 띠 — 아주 옅은 색 면 + 경계선 + 이름(띠 안에서 화면 위에 붙어 따라온다)
      var occupied = makeGrid(L);
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

        // 장면 경계(그 시대 안의 장면 이름)
        (era.scenes || []).forEach(function (sc, i) {
          if (i === 0) return;
          var y = yOf(sc.start_year);
          var next = era.scenes[i + 1] ? era.scenes[i + 1].start_year : era.end_year;
          if (y < 0 || y > H || (yOf(next) - y) < 70) return;
          ctx.strokeStyle = colors.line;
          ctx.setLineDash([4, 6]);
          ctx.beginPath(); ctx.moveTo(L.evX, y); ctx.lineTo(L.evR, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '12px ' + colors.sans;
          ctx.fillStyle = colors.inkBg2;
          ctx.fillText('· ' + sc.label, L.evX, y - 6);
          occupy(occupied, L, L.evX, y - 20, ctx.measureText('· ' + sc.label).width + 6, 22);
        });

        // 시대 이름
        var titleY = clamp(28, a + 30, b - 10);
        if (b - a > 34) {
          ctx.font = '700 26px ' + colors.display;
          ctx.fillStyle = colors.inkBg;
          ctx.fillText(era.label, L.evX, titleY);
          var tw = ctx.measureText(era.label).width;
          ctx.font = '12px ' + colors.sans;
          ctx.fillStyle = colors.inkBg2;
          ctx.fillText(era.range || '', L.evX + tw + 10, titleY);
          occupy(occupied, L, L.evX, titleY - 26, tw + 160, 36);
          hits.push({ x: L.evX, y: titleY - 26, w: tw, h: 32, era: era });
        }
      });

      // 2) 시간 눈금 — 줌에 맞춰 간격이 바뀐다
      var step = STEPS[STEPS.length - 1];
      for (var k = 0; k < STEPS.length; k += 1) { if (STEPS[k] * cam.s >= 56) { step = STEPS[k]; break; } }
      var first = Math.ceil(yTop / step) * step;
      var lastTick = Math.min(yBot, opts.present || T_MAX);   // 지금 뒤(아직 오지 않은 해)에는 눈금을 긋지 않는다
      ctx.font = '12px ' + colors.sans;
      ctx.textAlign = 'right';
      for (var yr = first; yr <= lastTick; yr += step) {
        var y = yOf(yr);
        var major = (yr / step) % 5 === 0;
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = major ? 0.9 : 0.45;
        ctx.beginPath(); ctx.moveTo(L.axis - (major ? 10 : 6), y); ctx.lineTo(L.axis, y); ctx.stroke();
        ctx.globalAlpha = major ? 0.35 : 0.15;
        ctx.beginPath(); ctx.moveTo(L.axis, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.globalAlpha = 1;
        if (yr !== 0) {
          ctx.fillStyle = major ? colors.inkBg : colors.inkBg2;
          if (yr < 0) {
            ctx.font = '10px ' + colors.sans;
            ctx.fillText('기원전', L.axis - 12, y - 6);
            ctx.font = (major ? '700 ' : '') + '12px ' + colors.sans;
            ctx.fillText(String(-yr), L.axis - 12, y + 8);
          } else {
            ctx.font = (major ? '700 ' : '') + '12px ' + colors.sans;
            ctx.fillText(String(yr), L.axis - 12, y + 4);
          }
        }
      }
      ctx.textAlign = 'left';
      var present = opts.present || T_MAX;
      var yNow = Math.min(H, yOf(present));
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(L.axis, Math.max(0, yOf(T_MIN))); ctx.lineTo(L.axis, yNow); ctx.stroke();
      ctx.lineWidth = 1;

      // '지금' — 시간축의 끝
      if (yNow > 0 && yNow < H) {
        ctx.strokeStyle = colors.star;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(L.axis - 12, yNow); ctx.lineTo(W, yNow); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = colors.star;
        ctx.beginPath(); ctx.arc(L.axis, yNow, 5, 0, 6.2832); ctx.fill();
        ctx.font = '700 15px ' + colors.display;
        ctx.fillText('지금', L.evX, yNow + 24);
        ctx.font = '12px ' + colors.sans;
        ctx.fillStyle = colors.inkBg2;
        ctx.fillText('이야기는 여기서부터 아직 쓰이는 중', L.evX + 40, yNow + 24);
      }

      // 3) 나라별 왕조·시대 띠
      var focusYear = yearAt(focusY());
      data.spans.forEach(function (sp) {
        var e = sp.entry;
        var a = yOf(e.start_year);
        var b = Math.max(a + 4, yOf(e.end_year));
        if (b < 0 || a > H) return;
        var live = e.start_year <= focusYear && focusYear < e.end_year;
        var x = L.lanesX + sp.lane * (L.laneW + L.laneGap);
        ctx.fillStyle = e._color;
        ctx.globalAlpha = live ? 1 : 0.5;
        roundRect(x - (live ? 1 : 0), a, L.laneW + (live ? 2 : 0), b - a, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        hits.push({ x: x - 3, y: a, w: L.laneW + 6, h: b - a, entry: e });
      });

      // 4) 사건 — 중요한 것부터 자리를 잡는다(카드 → 이름표 → 점 → 묶음)
      var hidden = {};
      for (var i = 0; i < data.events.length; i += 1) {
        var ev = data.events[i];
        if (ev.start_year < yTop || ev.start_year > yBot) continue;
        var ey = yOf(ev.start_year);
        var placed = tryPlace(occupied, L, ev, ey);
        if (!placed) {
          var bucket = Math.floor(ey / 44);
          hidden[bucket] = hidden[bucket] || { n: 0, sum: 0 };
          hidden[bucket].n += 1;
          hidden[bucket].sum += ev.start_year;
        }
      }

      // 5) 자리가 없어 숨은 사건 묶음 — 누르면 그쪽으로 다가간다
      Object.keys(hidden).forEach(function (key) {
        var g = hidden[key];
        var y = Number(key) * 44 + 22;
        var label = '+' + g.n;
        ctx.font = '700 12px ' + colors.sans;
        var w = ctx.measureText(label).width + 16;
        var x = L.evR - w;
        ctx.fillStyle = colors.inkBg;
        ctx.globalAlpha = 0.82;
        roundRect(x, y - 10, w, 20, 10);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.foam;
        ctx.fillText(label, x + 8, y + 4);
        hits.push({ x: x - 4, y: y - 14, w: w + 8, h: 28, cluster: g.sum / g.n });
      });
    }

    // ------------------------------------------------- 자리 잡기(겹치지 않게)

    function makeGrid(L) {
      var cols = Math.max(1, Math.floor((L.evR - L.evX) / UNIT));
      var grid = [];
      for (var c = 0; c < cols; c += 1) grid.push([]);
      return grid;
    }

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

    function occupy(grid, L, x, y, w, h) {
      var c0 = Math.max(0, Math.floor((x - L.evX) / UNIT));
      var span = Math.min(grid.length - c0, Math.ceil(w / UNIT));
      if (span > 0) mark(grid, c0, span, y, y + h);
    }

    function findSlot(grid, wPx, top, bottom, stride) {
      var span = Math.ceil(wPx / UNIT);
      for (var c = 0; c + span <= grid.length; c += stride) {
        if (free(grid, c, span, top - 3, bottom + 3)) return c;
      }
      return -1;
    }

    function tryPlace(grid, L, ev, y) {
      // 카드
      var cardSpan = Math.ceil((L.cardW + 10) / UNIT);
      var c = findSlot(grid, L.cardW, y - 12, y - 12 + CARD_H, cardSpan);
      if (c >= 0) {
        mark(grid, c, cardSpan, y - 15, y - 12 + CARD_H + 3);
        drawCard(ev, L.evX + c * UNIT, y - 12, L.cardW);
        return true;
      }
      // 이름표
      var lw = measureLabel(ev);
      c = findSlot(grid, lw, y - LABEL_H / 2, y + LABEL_H / 2, 2);
      if (c >= 0) {
        var span = Math.ceil(lw / UNIT);
        mark(grid, c, span, y - LABEL_H / 2 - 2, y + LABEL_H / 2 + 2);
        drawLabel(ev, L.evX + c * UNIT, y - LABEL_H / 2, lw);
        return true;
      }
      // 점
      c = findSlot(grid, DOT, y - DOT / 2, y + DOT / 2, 2);
      if (c >= 0) {
        mark(grid, c, 2, y - DOT / 2 - 1, y + DOT / 2 + 1);
        drawDot(ev, L.evX + c * UNIT + DOT / 2, y);
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

      ctx.fillStyle = ev._color;
      ctx.beginPath(); ctx.arc(x + 18, y + 16, 3.5, 0, 6.2832); ctx.fill();
      ctx.font = '11px ' + colors.sans;
      ctx.fillStyle = colors.ink2;
      var years = ev.end_year !== ev.start_year ? yearText(ev.start_year) + '–' + yearText(ev.end_year) : yearText(ev.start_year);
      ctx.fillText(fitText(ev._label + ' · ' + years, w - 36), x + 26, y + 20);
      ctx.font = '700 14px ' + colors.sans;
      ctx.fillStyle = colors.ink;
      ctx.fillText(fitText(ev.title, w - 30), x + 16, y + 42);
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
      clampCam();
      draw();
      if (opts.onCamera) {
        opts.onCamera({
          year: yearAt(focusY()),
          s: cam.s,
          moving: moving,
          dragging: !!(gesture && gesture.active),
          top: cam.t0,
          bottom: yearAt(H)
        });
      }
      if (moving) raf = global.requestAnimationFrame(frame);
      else lastT = 0;
    }

    function step(dt, t) {
      if (motion.mode === 'fling') {
        cam.t0 += motion.vt * dt;
        motion.vt *= Math.exp(-FRICTION * dt);
        if (Math.abs(motion.vt * cam.s) < 8) motion.mode = 'idle';
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'fly') {
        var f = motion.fly;
        var k = clamp((t - f.t0) / f.dur, 0, 1);
        var e = easeInOutCubic(k);
        var logS = f.logS0 + (f.logS1 - f.logS0) * e - f.bump * 4 * e * (1 - e);
        cam.s = Math.exp(logS);
        var year = f.y0 + (f.y1 - f.y0) * e;
        cam.t0 = year - f.fy / cam.s;
        if (k >= 1) motion.mode = 'idle';
        return motion.mode !== 'idle';
      }
      if (motion.mode === 'zoom') {
        var z = motion.zoomTo;
        var cur = Math.log(cam.s);
        var nxt = cur + (z.logS - cur) * (1 - Math.exp(-dt * 16));
        if (Math.abs(z.logS - nxt) < 0.002) nxt = z.logS;
        cam.s = clamp(Math.exp(nxt), sMin(), S_MAX);
        cam.t0 = z.year - z.y / cam.s;
        if (nxt === z.logS) motion.mode = 'idle';
        return motion.mode !== 'idle';
      }
      return false;
    }

    /** 초점선에 year 가 오도록 s 배율로 날아간다. 멀면 잠깐 물러났다 다가간다. */
    function flyTo(year, s, o) {
      o = o || {};
      s = clamp(s || cam.s, sMin(), S_MAX);
      var fy = focusY();
      var y0 = yearAt(fy);
      year = clamp(year, T_MIN, T_MAX);
      if (reduced || o.instant) {
        cam.s = s;
        cam.t0 = year - fy / s;
        motion.mode = 'idle';
        invalidate();
        return;
      }
      var distPx = Math.abs(year - y0) * Math.min(cam.s, s);
      var bump = distPx > H * 1.5 ? Math.min(3, Math.log(distPx / H)) * 0.6 : 0;
      motion.fly = {
        t0: now(), dur: clamp(520 + 170 * Math.log(1 + distPx / H) / Math.LN2, 520, 1700),
        y0: y0, y1: year, logS0: Math.log(cam.s), logS1: Math.log(s), bump: bump, fy: fy
      };
      motion.mode = 'fly';
      lastT = 0;
      invalidate();
    }

    /** 연도 구간 [a, b] 가 화면(초점선 위아래)에 들어오게 */
    function flyToRange(a, b) {
      var fy = focusY();
      var span = Math.max(1, b - a);
      var s = (H * 0.86) / span;
      flyTo(a + (fy / s) - H * 0.06 / s, s);
    }

    function zoomAround(y, factor) {
      var cur = motion.mode === 'zoom' ? motion.zoomTo.logS : Math.log(cam.s);
      var target = clamp(cur + Math.log(factor), Math.log(sMin()), Math.log(S_MAX));
      var year = motion.mode === 'zoom' && Math.abs(motion.zoomTo.y - y) < 2 ? motion.zoomTo.year : yearAt(y);
      motion.zoomTo = { logS: target, y: y, year: year };
      motion.mode = 'zoom';
      lastT = 0;
      invalidate();
    }

    function panBy(px) {
      motion.mode = 'idle';
      flyTo(yearAt(focusY() + px), cam.s);
    }

    // ----------------------------------------------------------- 입력

    function local(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function hitAt(p) {
      for (var i = hits.length - 1; i >= 0; i -= 1) {
        var h = hits[i];
        if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h;
      }
      return null;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (!active) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var p = local(e);
      pointers[e.pointerId] = p;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      var ids = Object.keys(pointers);
      motion.mode = 'idle';
      if (ids.length === 1) {
        gesture = { kind: 'pan', id: e.pointerId, x0: p.x, y0: p.y, t0: cam.t0, at: e.timeStamp, active: false, samples: [], type: e.pointerType };
      } else if (ids.length === 2) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var mid = (a.y + b.y) / 2;
        gesture = { kind: 'pinch', d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), s0: cam.s, year: yearAt(mid), active: true };
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!active) return;
      var p = local(e);
      if (!pointers[e.pointerId]) {
        // 마우스를 올렸을 때 누를 수 있는 것 위면 손가락 모양
        var h = hitAt(p);
        canvas.style.cursor = h ? 'pointer' : 'grab';
        return;
      }
      pointers[e.pointerId] = p;
      if (!gesture) return;
      if (gesture.kind === 'pan' && e.pointerId === gesture.id) {
        var dy = p.y - gesture.y0;
        if (!gesture.active && Math.abs(dy) + Math.abs(p.x - gesture.x0) < 6) return;
        gesture.active = true;
        canvas.classList.add('is-dragging');
        cam.t0 = gesture.t0 - dy / cam.s;
        gesture.samples.push({ t: e.timeStamp, t0: cam.t0 });
        while (gesture.samples.length > 2 && e.timeStamp - gesture.samples[0].t > 100) gesture.samples.shift();
        invalidate();
      } else if (gesture.kind === 'pinch') {
        var ids = Object.keys(pointers);
        if (ids.length < 2) return;
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
        var mid = (a.y + b.y) / 2;
        cam.s = clamp(gesture.s0 * d / gesture.d0, sMin(), S_MAX);
        cam.t0 = gesture.year - mid / cam.s;
        invalidate();
      }
    });

    function release(e) {
      if (!pointers[e.pointerId]) return;
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      var g = gesture;
      if (!g) return;
      if (g.kind === 'pinch') {
        // 손가락 하나가 남으면 그 손가락으로 이어서 끌 수 있게
        var rest = Object.keys(pointers);
        gesture = rest.length === 1
          ? { kind: 'pan', id: Number(rest[0]), x0: pointers[rest[0]].x, y0: pointers[rest[0]].y, t0: cam.t0, at: e.timeStamp, active: true, samples: [] }
          : null;
        return;
      }
      gesture = null;
      canvas.classList.remove('is-dragging');
      if (g.active) {
        var s = g.samples;
        if (s.length > 1 && e.timeStamp - s[s.length - 1].t < 70) {
          var span = Math.max(8, s[s.length - 1].t - s[0].t) / 1000;
          motion.vt = (s[s.length - 1].t0 - s[0].t0) / span;
          motion.mode = 'fling';
          lastT = 0;
          invalidate();
        }
        return;
      }
      // 톡 — 사건이면 상세, 시대 이름이면 그 시대로, 묶음이면 다가가기. 두 번 톡이면 줌인
      if (e.timeStamp - g.at > 450) return;
      var tapAt = e.timeStamp;
      if (lastTap && tapAt - lastTap.t < 320 && Math.abs(lastTap.y - p.y) < 30) {
        lastTap = null;
        zoomAround(p.y, 2.6);
        return;
      }
      lastTap = { t: tapAt, y: p.y };
      var h = hitAt(p);
      if (!h) return;
      if (h.entry && opts.openEntry) opts.openEntry(h.entry);
      else if (h.era) flyToRange(h.era.start_year, h.era.end_year);
      else if (h.cluster != null) flyTo(h.cluster, cam.s * 3.2);
    }

    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('wheel', function (e) {
      if (!active) return;
      e.preventDefault();
      var p = local(e);
      var unit = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? H : 1);
      var dy = e.deltaY * unit;
      if (e.shiftKey) {
        // Shift + 휠은 이동
        motion.mode = 'idle';
        cam.t0 += dy / cam.s;
        invalidate();
        return;
      }
      zoomAround(p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
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
      zoomBy: function (f) { zoomAround(focusY(), f); },
      panBy: panBy,
      axisX: function () { return layoutX().axis; },
      /** (x, y) 에 그려진 것 — 사건 제목·시대 이름·묶음(테스트와 접근성 보조용) */
      itemAt: function (x, y) {
        var h = hitAt({ x: x, y: y });
        if (!h) return null;
        return h.entry ? h.entry.title : (h.era ? h.era.label : '+묶음');
      },
      items: function () {
        return hits.filter(function (h) { return h.entry; }).map(function (h) {
          return { title: h.entry.title, x: h.x + Math.min(h.w, 40) / 2, y: h.y + h.h / 2 };
        });
      },
      get year() { return yearAt(focusY()); },
      get scale() { return cam.s; },
      /** 처음 열 때 — 문명사(기원전 4200년~지금)가 화면에 들어오게 */
      home: function () {
        cam.s = clamp((H * 0.86) / (T_MAX + 4200), sMin(), S_MAX);
        cam.t0 = -4200 - (H * 0.04) / cam.s;
        clampCam();
        invalidate();
      }
    };
  }

  global.BigHistoryZoom = { create: create };
})(window);
