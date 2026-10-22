/* ------------------------------------------------------------------
   처음 온 사람을 위한 안내(튜토리얼)

   연표 위에 작은 안내 카드를 띄워 몇 단계로 조작법을 보여 준다.
     · 단계마다 가리킬 곳(계기판·탭 등)이 있으면 그 둘레만 밝게 남기고 나머지를 어둡게
     · 그림판을 다루는 단계는 어둡게 하지 않고 손을 그대로 둔다(안내를 보며 바로 해 볼 수 있게)
     · 단계에 들어갈 때·나올 때 할 일(enter/leave) — 예: 왕조 하나를 직접 펼쳐 보이기
     · '다시 보지 않기'를 고르고 닫거나, 끝까지 보면 다음부터 저절로 뜨지 않는다
     · 설정 탭의 '사용법 다시 보기'로 언제든 다시 연다
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function store(key, val) {
    try {
      if (val === undefined) return global.localStorage.getItem(key);
      global.localStorage.setItem(key, val);
    } catch (err) { /* 저장이 막혀 있으면 매번 보여 줄 뿐 */ }
    return null;
  }

  /**
   * @param opts {
   *   steps: [{ title, text, target(): Element|null, place: 'top'|'bottom', enter(), leave() }],
   *   key: 저장 키
   * }
   */
  function create(opts) {
    var steps = opts.steps;
    var at = -1;
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var root = el('div', 'tour');
    root.hidden = true;
    var spot = el('div', 'tour__spot');
    var card = el('div', 'tour__card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'tour-title');
    card.setAttribute('aria-describedby', 'tour-text');
    var count = el('p', 'tour__count');
    var title = el('h2', 'tour__title');
    title.id = 'tour-title';
    var text = el('p', 'tour__text');
    text.id = 'tour-text';
    var dots = el('div', 'tour__dots');
    dots.setAttribute('aria-hidden', 'true');
    var foot = el('div', 'tour__foot');
    var never = el('label', 'tour__never');
    var box = el('input');
    box.type = 'checkbox';
    never.appendChild(box);
    never.appendChild(document.createTextNode(' 다시 보지 않기'));
    var btns = el('div', 'tour__btns');
    var back = el('button', 'pill-btn', '이전');
    back.type = 'button';
    var next = el('button', 'pill-btn pill-btn--strong', '다음');
    next.type = 'button';
    var skip = el('button', 'tour__skip', '건너뛰기');
    skip.type = 'button';
    btns.appendChild(back);
    btns.appendChild(next);
    foot.appendChild(never);
    foot.appendChild(btns);
    card.appendChild(skip);
    card.appendChild(count);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(dots);
    card.appendChild(foot);
    root.appendChild(spot);
    root.appendChild(card);
    document.body.appendChild(root);

    steps.forEach(function () { dots.appendChild(el('span')); });

    back.addEventListener('click', function () { go(at - 1); });
    next.addEventListener('click', function () {
      if (at >= steps.length - 1) close(true);
      else go(at + 1);
    });
    skip.addEventListener('click', function () { close(false); });
    // Esc 는 안내만 닫는다(펼친 항목 접기 등 앱의 Esc 보다 먼저)
    document.addEventListener('keydown', function (e) {
      if (root.hidden || e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close(false);
    }, true);
    global.addEventListener('resize', function () { if (!root.hidden) aim(); });

    function go(i) {
      i = Math.max(0, Math.min(steps.length - 1, i));
      if (at >= 0 && at !== i && steps[at].leave) steps[at].leave();
      at = i;
      var s = steps[i];
      count.textContent = (i + 1) + ' / ' + steps.length;
      title.textContent = s.title;
      text.textContent = typeof s.text === 'function' ? s.text() : s.text;
      Array.prototype.forEach.call(dots.children, function (d, k) { d.classList.toggle('is-on', k === i); });
      back.hidden = i === 0;
      next.textContent = i === steps.length - 1 ? '시작하기' : '다음';
      skip.hidden = i === steps.length - 1;
      if (s.enter) s.enter();
      aim();
      // 단계가 바뀔 때마다 카드가 톡 다시 떠오르게
      if (!reduced) {
        card.classList.remove('is-in');
        void card.offsetWidth;
        card.classList.add('is-in');
      }
    }

    /** 가리킬 곳 둘레만 밝게, 카드는 그곳을 가리지 않는 쪽(위·아래)에 */
    function aim() {
      var s = steps[at];
      var t = s.target ? s.target() : null;
      var r = t && !t.hidden ? t.getBoundingClientRect() : null;
      if (r && r.width && r.height) {
        var pad = 6;
        spot.hidden = false;
        spot.style.left = (r.left - pad) + 'px';
        spot.style.top = (r.top - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px';
        spot.style.height = (r.height + pad * 2) + 'px';
      } else {
        spot.hidden = true;
      }
      var place = s.place || (r && r.top + r.height / 2 > global.innerHeight / 2 ? 'top' : 'bottom');
      card.classList.toggle('tour__card--top', place === 'top');
      card.classList.toggle('tour__card--bottom', place !== 'top');
    }

    function close(finished) {
      if (root.hidden) return;
      if (at >= 0 && steps[at].leave) steps[at].leave();
      if (finished || box.checked) store(opts.key, 'done');
      at = -1;
      root.hidden = true;
      if (opts.onClose) opts.onClose(finished);
    }

    return {
      /** 처음 온 사람이면(또는 force) 연다 */
      start: function (force) {
        if (!force && store(opts.key) === 'done') return false;
        box.checked = false;
        never.hidden = !!force;   // 스스로 다시 연 것이면 물을 필요가 없다
        root.hidden = false;
        go(0);
        try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); }
        return true;
      },
      close: function () { close(false); },
      get open() { return !root.hidden; }
    };
  }

  global.BigHistoryTour = { create: create };
})(window);
