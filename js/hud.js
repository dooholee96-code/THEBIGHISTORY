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
   * @param handlers  { scrub(ratio, phase), step(dir), pick(entry) }  phase: 'move' | 'end' | 'tap'
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
    var now = $('.hud__now');

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
      xTimer: 0,
      lastX: 0,
      lastT: 0,
      sparks: 0,
      hopTimer: 0
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

    // ------------------------------------------------------ 지금 이때

    /**
     * 초점선의 해에 나라마다 이어지던 왕조·시대. Histomap 의 한 단면처럼
     * '같은 때 다른 곳에서는'을 한눈에 보여 주고, 누르면 그 항목을 연다.
     */
    function setOngoing(list) {
      if (!now) return;
      var key = list.map(function (e) { return e.id; }).join('|');
      if (key === now._key) return;
      now._key = key;
      now.textContent = '';
      list.forEach(function (entry, i) {
        var chip = document.createElement('button');
        chip.type = 'button';
        // 나라·왕조가 없어 시대 구분으로 대신한 칩은 테두리만 — 구분이 보이게
        chip.className = 'hud__chip' + (entry.kind === 'era' ? ' is-era' : '');
        chip.title = entry._label + ' · ' + entry.title;
        var dot = document.createElement('i');
        dot.style.backgroundColor = entry._color;
        chip.appendChild(dot);
        var name = document.createElement('span');
        name.textContent = entry.title;
        chip.appendChild(name);
        chip.addEventListener('click', function () { if (handlers.pick) handlers.pick(entry); });
        now.appendChild(chip);
        if (!reduced && chip.animate) {
          chip.animate([{ opacity: 0, transform: 'translateY(6px) scale(.9)' }, { opacity: 1, transform: 'none' }],
            { duration: 360, delay: i * 40, easing: SPRING, fill: 'backwards' });
        }
      });
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
      s.grab = { id: e.pointerId, x0: e.clientX, moved: false, ratio: ratioAt(e.clientX), type: e.pointerType, speed: 0 };
      s.lastX = e.clientX;
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

      // 끄는 쪽으로 시로가 기울고, 빠르면 뒤로 흙먼지가 흩어진다
      var dx = e.clientX - s.lastX;
      s.lastX = e.clientX;
      g.speed = dx;
      root.style.setProperty('--tilt', clamp(dx * 1.4, -24, 24).toFixed(1) + 'deg');
      if (!reduced && Math.abs(dx) > 5 && s.sparks < 10) spark(g.ratio, dx);
    });

    function spark(ratio, dx) {
      var node = document.createElement('i');
      node.className = 'scrub__spark';
      node.style.left = (clamp(ratio, 0, 1) * s.trackW).toFixed(1) + 'px';
      node.style.setProperty('--dx', (-dx * 2.2).toFixed(0) + 'px');
      node.style.setProperty('--dy', (-8 - Math.random() * 20).toFixed(0) + 'px');
      s.sparks += 1;
      node.addEventListener('animationend', function () { node.remove(); s.sparks -= 1; });
      scrub.appendChild(node);
    }

    /** 던지듯 놓으면 시로가 한 번 깡총 */
    function hop() {
      root.classList.remove('is-hop');
      void root.offsetWidth;
      root.classList.add('is-hop');
      clearTimeout(s.hopTimer);
      s.hopTimer = setTimeout(function () { root.classList.remove('is-hop'); }, 520);
    }

    function end(e) {
      var g = s.grab;
      if (!g || e.pointerId !== g.id) return;
      s.grab = null;
      root.classList.remove('is-grabbed');
      root.style.setProperty('--tilt', '0deg');
      handlers.scrub(g.ratio, g.moved ? 'end' : 'tap', g.type);
      placeKnob(s.ratio);
      if (!reduced && (g.moved ? Math.abs(g.speed) > 9 : true)) hop();
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
        btn.classList.remove('is-pressed');
        void btn.offsetWidth;
        btn.classList.add('is-pressed');
        hop();
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
      setOngoing: setOngoing,
      get grabbing() { return !!s.grab; }
    };
  }

  global.BigHistoryHud = { create: create };
})(window);
