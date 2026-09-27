/* ------------------------------------------------------------------
   시간 계기판(HUD) — Scale of the Universe 2 의 아래 막대를 본떴습니다.

     · 큰 숫자   — 지금 초점선에 걸린 해. 값이 바뀌면 굴러가듯 세어 올라간다.
     · 스크러버 — 전체 역사를 시대별 구간으로 나눈 막대. 끌면 연표가 쫀득하게 따라오고,
                  톡 치면 그 자리로 날아간다. 가는 눈금 하나가 연표의 한 줄이다.
     · ‹ ›      — 앞뒤 시대로 한 번에 건너뛰기.

   이 모듈은 화면만 맡고, 위치 계산(비율 ↔ 연표 좌표)은 app.js 가 한다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var SPRING = 'cubic-bezier(.34,1.56,.64,1)';
  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pop(node, from) {
    if (reduced || !node.animate) return;
    node.animate(
      [{ transform: from }, { transform: 'none' }],
      { duration: 420, easing: SPRING }
    );
  }

  /**
   * @param root      #hud
   * @param handlers  { scrub(ratio, phase), step(dir) }  phase: 'move' | 'tap'
   */
  function create(root, handlers) {
    var $ = function (sel) { return root.querySelector(sel); };
    var pre = $('.hud__pre');
    var num = $('.hud__num');
    var era = $('.hud__era');
    var count = $('.hud__count');
    var scrub = $('.scrub');
    var track = $('.scrub__track');
    var knob = $('.scrub__knob');
    var xbar = $('.hud__x');
    var xthumb = $('.hud__x i');

    var s = {
      target: 0,
      shown: 0,
      shownText: '',
      raf: 0,
      last: 0,
      ratio: 0,
      trackW: 0,
      grab: null,
      eraText: '',
      xTimer: 0
    };

    // ------------------------------------------------------- 굴러가는 숫자

    function write(value) {
      var n = Math.round(value);
      var text = (n < 0 ? '기원전|' : '|') + Math.abs(n);
      if (text === s.shownText) return;
      s.shownText = text;
      pre.textContent = n < 0 ? '기원전' : '';
      num.textContent = String(Math.abs(n));
    }

    function roll(t) {
      s.raf = 0;
      var dt = s.last ? Math.min(0.05, (t - s.last) / 1000) : 1 / 60;
      s.last = t;
      var gap = s.target - s.shown;
      s.shown += gap * (1 - Math.exp(-dt * 13));
      if (Math.abs(s.target - s.shown) < 0.5) s.shown = s.target;
      write(s.shown);
      if (s.shown !== s.target) s.raf = requestAnimationFrame(roll);
      else s.last = 0;
    }

    function setYear(year, immediate) {
      if (year === s.target && !immediate) return;
      var jumped = s.target !== year;
      s.target = year;
      if (immediate || reduced) {
        s.shown = year;
        write(year);
        return;
      }
      if (jumped) pop(num, 'scale(1.1)');
      if (!s.raf) s.raf = requestAnimationFrame(roll);
    }

    function setMeta(eraLabel, n) {
      if (eraLabel !== s.eraText) {
        s.eraText = eraLabel;
        era.textContent = eraLabel;
        pop(era, 'translateY(-7px) scale(1.15)');
      }
      count.textContent = n ? '사건 ' + n + '건' : '';
    }

    // ------------------------------------------------------------- 막대

    function build(segments, ticks) {
      track.textContent = '';
      var frag = document.createDocumentFragment();
      segments.forEach(function (seg) {
        var node = document.createElement('div');
        node.className = 'scrub__seg';
        node.style.left = (seg.start * 100).toFixed(3) + '%';
        node.style.width = (seg.width * 100).toFixed(3) + '%';
        node.style.setProperty('--seg', seg.color);
        var label = document.createElement('span');
        label.textContent = seg.label;
        node.appendChild(label);
        frag.appendChild(node);
      });
      var tickLayer = document.createElement('div');
      tickLayer.className = 'scrub__ticks';
      ticks.forEach(function (r) {
        var tick = document.createElement('i');
        tick.style.left = (r * 100).toFixed(3) + '%';
        tickLayer.appendChild(tick);
      });
      frag.appendChild(tickLayer);
      track.appendChild(frag);
      measure();
    }

    function measure() {
      s.trackW = track.clientWidth;
      placeKnob(s.grab ? s.grab.ratio : s.ratio);
    }

    function placeKnob(r) {
      knob.style.transform = 'translate3d(' + (clamp(r, 0, 1) * s.trackW).toFixed(1) + 'px,0,0)';
    }

    function setRatio(r) {
      s.ratio = r;
      if (!s.grab) placeKnob(r);
      scrub.setAttribute('aria-valuenow', String(Math.round(r * 100)));
    }

    function ratioAt(clientX) {
      var rect = track.getBoundingClientRect();
      return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    }

    scrub.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      s.grab = { id: e.pointerId, x0: e.clientX, moved: false, ratio: ratioAt(e.clientX), type: e.pointerType };
      try { scrub.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      root.classList.add('is-grabbed');
    });

    scrub.addEventListener('pointermove', function (e) {
      var g = s.grab;
      if (!g || e.pointerId !== g.id) return;
      if (!g.moved && Math.abs(e.clientX - g.x0) < 4) return;
      g.moved = true;
      g.ratio = ratioAt(e.clientX);
      placeKnob(g.ratio);
      handlers.scrub(g.ratio, 'move', g.type);
    });

    function end(e) {
      var g = s.grab;
      if (!g || e.pointerId !== g.id) return;
      s.grab = null;
      root.classList.remove('is-grabbed');
      if (!g.moved) handlers.scrub(g.ratio, 'tap', g.type);
      placeKnob(s.ratio);
    }

    scrub.addEventListener('pointerup', end);
    scrub.addEventListener('pointercancel', end);

    scrub.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: -0.02, ArrowRight: 0.02, PageDown: 0.1, PageUp: -0.1 }[e.key];
      if (e.key === 'Home') d = -1;
      if (e.key === 'End') d = 1;
      if (d == null) return;
      e.preventDefault();
      e.stopPropagation();
      handlers.scrub(clamp(s.ratio + d, 0, 1), 'tap', 'keyboard');
    });

    root.querySelectorAll('[data-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handlers.step(Number(btn.getAttribute('data-step')));
      });
    });

    // --------------------------------------------------- 가로 위치 표시

    /** 가로로 넘길 열이 있으면 얇은 막대로 지금 보는 폭을 보여준다. */
    function setX(left, max, view, active) {
      if (!xbar) return;
      if (max <= 1) { xbar.hidden = true; return; }
      xbar.hidden = false;
      var frac = clamp(view / (view + max), 0.12, 1);
      var pos = (left / max) * (1 - frac);
      xthumb.style.width = (frac * 100).toFixed(2) + '%';
      xthumb.style.transform = 'translate3d(' + (pos / frac * 100).toFixed(2) + '%,0,0)';
      if (active) {
        xbar.classList.add('is-active');
        clearTimeout(s.xTimer);
        s.xTimer = setTimeout(function () { xbar.classList.remove('is-active'); }, 700);
      }
    }

    return {
      build: build,
      measure: measure,
      setRatio: setRatio,
      setYear: setYear,
      setMeta: setMeta,
      setX: setX,
      get grabbing() { return !!s.grab; }
    };
  }

  global.BigHistoryHud = { create: create };
})(window);
