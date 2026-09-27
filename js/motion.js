/* ------------------------------------------------------------------
   손맛 스크롤러 — 연표 한 장을 지도처럼 끌고 던지는 움직임

   브라우저 기본 스크롤 대신 직접 움직입니다. 기기마다 다른 관성·튕김을
   한 가지 손맛으로 맞추고, 가로(카테고리)와 세로(연도)를 한 손으로 다루기 위해서입니다.

     · 끌기   — 마우스·손가락 모두 1:1로 따라온다. 처음 움직인 방향으로 축을 고정.
     · 던지기 — 놓는 순간의 속도로 미끄러지다 마찰로 멈춘다.
     · 고무줄 — 끝에서 더 당기면 점점 무거워지고, 놓으면 스프링으로 돌아온다.
     · 휠     — 한 칸씩 끊기지 않고 목표 위치로 부드럽게 따라간다.
     · 이동   — 시대 점프는 가속·감속 곡선으로 날아간다.

   두 가지 모드가 있습니다.
     · 'image'  (기본) — 연도 축까지 표 전체가 한 장의 그림처럼 움직인다.
                         가로·세로 모두 내용물 하나를 transform 으로 옮기고, 끌면 어느 방향으로든 자유롭게.
     · 'pinned'         — 연도 축은 왼쪽에 붙어 있고 칸만 옆으로 넘어간다.
                         세로는 transform, 가로는 표마다 scrollLeft(연도 축이 sticky 라서).
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var FRICTION = 2.9;          // 던진 뒤 감속(초당, 지수). 작을수록 멀리 간다
  var SPRING_K = 190;          // 가장자리 복귀 스프링 강도
  var MAX_SPEED = 9000;        // px/s
  var DRAG_SLOP = 6;           // 이만큼 움직여야 끌기로 본다(그 전엔 탭)
  var WHEEL_OVER = 130;        // 휠로 가장자리를 넘어갈 수 있는 양(원래 좌표)
  var WHEEL_IDLE = 140;        // 휠이 멈춘 뒤 가장자리로 돌아오기까지(ms)

  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /** 넘친 양을 고무줄처럼 줄인다. 조금은 절반쯤, 많이 당길수록 dim 에 수렴. */
  function rubber(over, dim) {
    if (!over) return 0;
    var d = Math.max(1, dim);
    var r = (1 - 1 / (Math.abs(over) * 0.55 / d + 1)) * d;
    return over < 0 ? -r : r;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ---------------------------------------------------------------- 축

  function Axis() {
    this.pos = 0;       // 원래 좌표(가장자리를 넘을 수 있다)
    this.v = 0;         // px/s
    this.min = 0;
    this.max = 0;
    this.dim = 1;
    this.mode = 'idle'; // idle | hold | lerp | tween | free
    this.target = 0;
    this.k = 12;
    this.tween = null;
  }

  Axis.prototype.over = function (p) {
    if (p == null) p = this.pos;
    return p < this.min ? p - this.min : (p > this.max ? p - this.max : 0);
  };

  Axis.prototype.clamped = function () { return clamp(this.pos, this.min, this.max); };

  Axis.prototype.hold = function () { this.mode = 'hold'; this.v = 0; this.tween = null; };

  Axis.prototype.fling = function (v) {
    this.v = clamp(v, -MAX_SPEED, MAX_SPEED);
    this.mode = 'free';
  };

  Axis.prototype.lerpTo = function (target, k) {
    this.target = target;
    this.k = k;
    this.mode = 'lerp';
  };

  Axis.prototype.tweenTo = function (to, dur, now) {
    this.tween = { from: this.pos, to: to, t0: now, dur: dur };
    this.mode = 'tween';
  };

  /** 한 프레임 진행. 계속 움직여야 하면 true. */
  Axis.prototype.step = function (dt, now) {
    var prev = this.pos;

    if (this.mode === 'lerp') {
      this.pos += (this.target - this.pos) * (1 - Math.exp(-this.k * dt));
      if (Math.abs(this.target - this.pos) < 0.2) {
        this.pos = this.target;
        this.mode = this.over() ? 'free' : 'idle';
      }
    } else if (this.mode === 'tween') {
      var tw = this.tween;
      var t = clamp((now - tw.t0) / tw.dur, 0, 1);
      this.pos = tw.from + (tw.to - tw.from) * easeInOutCubic(t);
      if (t >= 1) { this.pos = tw.to; this.mode = 'idle'; this.tween = null; }
    } else if (this.mode === 'free') {
      var over = this.over();
      if (over) {
        // 임계 감쇠 스프링 — 튕겨 나갔다가 출렁임 없이 돌아온다
        var a = -SPRING_K * over - 2 * Math.sqrt(SPRING_K) * this.v;
        this.v += a * dt;
        this.pos += this.v * dt;
        var left = this.over();
        if (Math.abs(left) < 0.4 && Math.abs(this.v) < 24) {
          this.pos = clamp(this.pos, this.min, this.max);
          this.v = 0;
          this.mode = 'idle';
        }
      } else {
        this.v *= Math.exp(-FRICTION * dt);
        this.pos += this.v * dt;
        if (Math.abs(this.v) < 9) { this.v = 0; this.mode = 'idle'; }
      }
      return this.mode !== 'idle';
    } else {
      return false;
    }

    this.v = dt > 0 ? (this.pos - prev) / dt : 0;
    return this.mode !== 'idle';
  };

  // ------------------------------------------------------------ 스크롤러

  /**
   * @param viewport  잘라 보이는 창(.scroll)
   * @param content   움직일 내용물(.scroll__inner)
   * @param opts      { wraps: 선택자, onFrame(info), onDrag(phase), bottomInset() }
   */
  function create(viewport, content, opts) {
    opts = opts || {};
    var y = new Axis();
    var x = new Axis();
    var wraps = [];
    var wrapMax = [];
    var raf = 0;
    var lastT = 0;
    var applied = { top: NaN, oy: NaN, left: NaN, ox: NaN };
    var mode = opts.mode === 'pinned' ? 'pinned' : 'image';
    var snapPending = false;   // 던지기·휠이 멈추면 가까운 눈금에 톡 걸리게
    var drag = null;
    var suppressClick = false;
    var wheelTimer = 0;
    var enabled = true;

    function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

    function moving() {
      return y.mode !== 'idle' || x.mode !== 'idle';
    }

    function info() {
      return {
        y: y.clamped(),
        x: x.clamped(),
        rawY: y.pos,
        vy: y.v,
        maxY: y.max,
        maxX: x.max,
        viewW: x.dim,
        viewH: y.dim,
        dragging: !!(drag && drag.active),
        moving: moving()
      };
    }

    function setWrapLeft(i, sx) {
      wraps[i].scrollLeft = sx;
      if (wraps[i]._sx !== sx) {
        wraps[i]._sx = sx;
        wraps[i].style.setProperty('--sx', sx + 'px');
      }
    }

    function apply(force) {
      var top = y.clamped();
      var oy = rubber(y.pos - top, y.dim);
      var shown = top + oy;
      var left = x.clamped();
      var ox = rubber(x.pos - left, x.dim * 0.6);

      if (mode === 'image') {
        // 한 장의 그림 — 가로·세로를 transform 하나로
        var shownX = left + ox;
        if (force || shown !== applied.top || shownX !== applied.left) {
          applied.top = shown;
          applied.left = shownX;
          content.style.transform = 'translate3d(' + (-shownX).toFixed(2) + 'px,' + (-shown).toFixed(2) + 'px,0)';
        }
        if (force) {
          for (var w = 0; w < wraps.length; w += 1) setWrapLeft(w, 0);
          applied.ox = 0;
          content.style.setProperty('--ox', '0px');
        }
        if (opts.onFrame) opts.onFrame(info());
        return;
      }

      if (force || shown !== applied.top) {
        applied.top = shown;
        content.style.transform = 'translate3d(0,' + (-shown).toFixed(2) + 'px,0)';
      }

      if (force || Math.round(left) !== applied.left) {
        applied.left = Math.round(left);
        for (var i = 0; i < wraps.length; i += 1) {
          // 표마다 옆으로 갈 수 있는 폭이 달라서, 실제로 밀린 만큼을 표에 적어 둔다.
          // (밀린 칸이 붙어 있는 연도 축 밑으로 비치지 않게 CSS 가 그만큼 잘라낸다)
          setWrapLeft(i, Math.min(applied.left, wrapMax[i]));
        }
      }
      if (force || Math.abs(ox - applied.ox) > 0.05 || (ox === 0 && applied.ox !== 0)) {
        applied.ox = ox;
        content.style.setProperty('--ox', (-ox).toFixed(2) + 'px');
      }

      if (opts.onFrame) opts.onFrame(info());
    }

    function frame(t) {
      raf = 0;
      var dt = lastT ? Math.min(1 / 30, Math.max(0.001, (t - lastT) / 1000)) : 1 / 60;
      lastT = t;
      var a = y.step(dt, t);
      var b = x.step(dt, t);
      apply(false);
      if (!moving() && snapPending) {
        // 멈춘 자리에서 가까운 해의 점으로 살짝 끌려간다(톱니처럼 걸리는 손맛)
        snapPending = false;
        var to = opts.snap ? opts.snap(y.clamped()) : null;
        if (to != null && Math.abs(to - y.pos) > 0.5 && !reduced) {
          y.lerpTo(clamp(to, y.min, y.max), 13);
          a = true;
        }
      }
      if (a || b || moving()) raf = global.requestAnimationFrame(frame);
      else lastT = 0;
    }

    function kick() {
      if (!raf) raf = global.requestAnimationFrame(frame);
    }

    function measureX() {
      // 표 자체의 너비로 잰다(그림 모드에서는 표가 틀 밖으로 넘쳐 보이므로 scrollWidth 대신)
      wrapMax = wraps.map(function (w) {
        var table = w.firstElementChild;
        return Math.max(0, (table ? table.offsetWidth : w.scrollWidth) - w.clientWidth);
      });
      return wrapMax.reduce(function (m, v) { return Math.max(m, v); }, 0);
    }

    /** 내용이나 창 크기가 바뀌면 다시 잰다. */
    function refresh() {
      if (!viewport.clientHeight) return;
      wraps = Array.prototype.slice.call(content.querySelectorAll(opts.wraps || '.table-wrap'));
      y.dim = viewport.clientHeight;
      x.dim = viewport.clientWidth;
      y.max = Math.max(0, content.offsetHeight - viewport.clientHeight);
      x.max = Math.max(0, measureX());
      content.style.setProperty('--pan-max', x.max + 'px');
      if (y.mode === 'idle' || y.mode === 'hold') y.pos = clamp(y.pos, y.min, y.max);
      if (x.mode === 'idle' || x.mode === 'hold') x.pos = clamp(x.pos, x.min, x.max);
      if (y.mode === 'tween' && y.tween) y.tween.to = clamp(y.tween.to, y.min, y.max);
      apply(true);
    }

    // ----------------------------------------------------------- 명령

    function scrollTo(to, o) {
      o = o || {};
      to = clamp(to, y.min, y.max);
      var dist = Math.abs(to - y.pos);
      if (reduced || o.instant || dist < 1) {
        y.pos = to;
        y.mode = 'idle';
        y.v = 0;
        apply(false);
        return;
      }
      var dur = o.duration || clamp(360 + Math.sqrt(dist) * 8, 360, 1150);
      y.tweenTo(to, dur, now());
      lastT = 0;
      kick();
    }

    /** 목표를 향해 끈적하게 따라간다(스크러버·키보드용). */
    function follow(to, k) {
      y.lerpTo(clamp(to, y.min, y.max), k || 14);
      kick();
    }

    function nudge(dy, dx) {
      if (dy) {
        var base = y.mode === 'lerp' ? y.target : (y.mode === 'tween' && y.tween ? y.tween.to : y.pos);
        y.lerpTo(clamp(base + dy, y.min, y.max), 11);
      }
      if (dx) {
        var bx = x.mode === 'lerp' ? x.target : x.pos;
        x.lerpTo(clamp(bx + dx, x.min, x.max), 11);
      }
      kick();
    }

    function stop() {
      y.mode = 'idle'; y.v = 0; y.pos = y.clamped();
      x.mode = 'idle'; x.v = 0; x.pos = x.clamped();
      apply(false);
    }

    // ----------------------------------------------------------- 휠

    function wheelAxis(axis, d, k) {
      if (!d) return;
      var base = axis.mode === 'lerp' ? axis.target : axis.pos;
      axis.lerpTo(clamp(base + d, axis.min - WHEEL_OVER, axis.max + WHEEL_OVER), k);
    }

    function settleWheel() {
      snapPending = true;
      [y, x].forEach(function (axis) {
        var p = axis.mode === 'lerp' ? axis.target : axis.pos;
        if (axis.over(p)) axis.lerpTo(clamp(p, axis.min, axis.max), 9);
        else if (axis.mode === 'idle' && axis.over()) axis.mode = 'free';
      });
      kick();
    }

    viewport.addEventListener('wheel', function (e) {
      if (!enabled || e.ctrlKey) return;   // 핀치 확대는 브라우저에 맡긴다
      e.preventDefault();
      var unit = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? y.dim * 0.85 : 1);
      var dx = e.deltaX * unit;
      var dy = e.deltaY * unit;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      // 마우스 휠은 칸 단위로 크게, 트랙패드는 잘게 연속으로 온다.
      var notchy = e.deltaMode !== 0 || (Math.abs(dy) >= 50 && dy % 1 === 0 && !dx);
      wheelAxis(y, dy, notchy ? 9 : 22);
      wheelAxis(x, dx, notchy ? 9 : 22);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(settleWheel, WHEEL_IDLE);
      kick();
    }, { passive: false });

    // ------------------------------------------------------ 끌기 · 던지기

    viewport.addEventListener('pointerdown', function (e) {
      if (!enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (drag) return; // 두 번째 손가락은 무시

      // 미끄러지는 중에 잡으면 그 자리에서 멈추고, 그 탭은 클릭으로 치지 않는다.
      var fast = Math.abs(y.v) > 80 || Math.abs(x.v) > 80 || y.mode === 'tween';
      suppressClick = false;
      drag = {
        id: e.pointerId,
        type: e.pointerType,
        sx: e.clientX,
        sy: e.clientY,
        py: y.pos,
        px: x.pos,
        active: false,
        lock: null,
        caught: fast,
        samples: []
      };
      y.hold();
      x.hold();
      snapPending = false;
      clearTimeout(wheelTimer);
    });

    function sample(t) {
      var s = drag.samples;
      s.push({ t: t, x: x.pos, y: y.pos });
      while (s.length > 2 && t - s[0].t > 100) s.shift();
    }

    viewport.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.sx;
      var dy = e.clientY - drag.sy;

      if (!drag.active) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        drag.active = true;
        var canX = x.max > x.min;
        var ax = Math.abs(dx);
        var ay = Math.abs(dy);
        // 그림 모드는 어느 방향으로든 자유롭게, 고정 모드는 처음 방향으로 축을 고정
        drag.lock = !canX ? 'y' : (mode === 'image' ? 'xy' :
          (ax > ay * 1.2 ? 'x' : (ay > ax * 1.2 ? 'y' : 'xy')));
        // 문턱만큼 튀지 않도록 기준점을 지금 위치로 옮긴다
        drag.sx = e.clientX;
        drag.sy = e.clientY;
        dx = 0;
        dy = 0;
        try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        viewport.classList.add('is-dragging');
        if (opts.onDrag) opts.onDrag('start', drag.type);
      }

      if (drag.lock !== 'x') y.pos = drag.py - dy;
      if (drag.lock !== 'y') x.pos = drag.px - dx;
      sample(e.timeStamp || now());
      kick();
    });

    function release(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var d = drag;
      drag = null;

      if (d.active) {
        suppressClick = true;
        viewport.classList.remove('is-dragging');
        var s = d.samples;
        var vx = 0;
        var vy = 0;
        var t = (e && e.timeStamp) || now();
        if (s.length > 1 && t - s[s.length - 1].t < 70) {
          var first = s[0];
          var last = s[s.length - 1];
          var span = Math.max(8, last.t - first.t) / 1000;
          vx = (last.x - first.x) / span;
          vy = (last.y - first.y) / span;
        }
        y.fling(d.lock === 'x' ? 0 : vy);
        x.fling(d.lock === 'y' ? 0 : vx);
        if (d.lock !== 'x') snapPending = true;
        if (opts.onDrag) opts.onDrag('end', d.type);
      } else {
        if (d.caught) suppressClick = true;
        y.fling(0);
        x.fling(0);
      }
      if (suppressClick) setTimeout(function () { suppressClick = false; }, 60);
      lastT = 0;
      kick();
    }

    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);
    // 터치는 처음 닿은 요소가 포인터를 암묵적으로 잡고 있다가 창으로 넘겨주므로,
    // 그 요소에서 거품처럼 올라온 lostpointercapture 는 무시한다.
    viewport.addEventListener('lostpointercapture', function (e) {
      if (e.target === viewport && drag && drag.active && e.pointerId === drag.id) release(e);
    });

    viewport.addEventListener('click', function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // 끌다가 글자가 선택되거나 이미지가 딸려 오지 않게
    viewport.addEventListener('dragstart', function (e) { e.preventDefault(); });

    // ------------------------------------------- 바깥에서 바뀐 위치 받아들이기

    // 키보드로 표 안의 버튼에 초점이 가면 보이는 곳까지 데려온다.
    content.addEventListener('focusin', function (e) {
      var target = e.target;
      if (!target || !target.matches || !target.matches(':focus-visible')) return;
      var r = target.getBoundingClientRect();
      var v = viewport.getBoundingClientRect();
      var topLimit = v.top + 70;
      var bottomLimit = v.bottom - (opts.bottomInset ? opts.bottomInset() : 0) - 40;
      if (r.top < topLimit) scrollTo(y.pos - (topLimit - r.top));
      else if (r.bottom > bottomLimit) scrollTo(y.pos + (r.bottom - bottomLimit));
      // 그림 모드에서는 표가 스스로 옆으로 넘어가지 않으니 가로도 직접 데려온다
      if (mode === 'image') {
        var leftLimit = v.left + (opts.leftInset ? opts.leftInset() : 0);
        if (r.left < leftLimit) nudge(0, r.left - leftLimit - 12);
        else if (r.right > v.right - 12) nudge(0, r.right - v.right + 24);
      }
    });

    // 표 안으로 초점이 가면 브라우저가 가로 scrollLeft 를 바꾼다 → 그 값을 따른다.
    viewport.addEventListener('scroll', function (e) {
      var node = e.target;
      if (node === viewport) {
        if (viewport.scrollTop || viewport.scrollLeft) {
          viewport.scrollTop = 0;
          viewport.scrollLeft = 0;
        }
        return;
      }
      if (mode === 'image' || drag || x.mode !== 'idle' || wraps.indexOf(node) === -1) return;
      var expected = Math.min(applied.left, wrapMax[wraps.indexOf(node)] || 0);
      if (Math.abs(node.scrollLeft - expected) > 1.5) {
        x.pos = node.scrollLeft;
        applied.left = NaN;
        apply(false);
      }
    }, true);

    return {
      refresh: refresh,
      scrollTo: scrollTo,
      follow: follow,
      nudge: nudge,
      stop: stop,
      info: info,
      setEnabled: function (on) { enabled = !!on; },
      /** 'image' 또는 'pinned'. 가로 위치는 그대로 유지한다. */
      setMode: function (next) {
        mode = next === 'pinned' ? 'pinned' : 'image';
        applied.left = NaN;
        refresh();
      },
      get mode() { return mode; },
      get y() { return y.clamped(); },
      get x() { return x.clamped(); }
    };
  }

  global.BigHistoryMotion = {
    create: create,
    rubber: rubber,
    reduced: reduced
  };
})(window);
