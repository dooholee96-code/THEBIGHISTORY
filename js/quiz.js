/* ------------------------------------------------------------------
   퀴즈(데모) — 연표 끼워 넣기

   카드게임 'Timeline'처럼, 사건 카드를 한 장씩 받아 지금까지 놓인 카드들 사이의
   알맞은 자리에 끼워 넣는다. 다섯 장을 넣으면 끝.
     · 오늘의 퀴즈 — 날짜로 정해지는 난수라 같은 날엔 모두 같은 카드를 받는다(결과를 나눠 비교할 수 있게)
     · 연습 — 아무 카드나
     · 카드는 출처가 확인된 항목에서만 고른다(검토 전 초안이라도 연도를 공인 자료로 맞춰 본 것)
     · 놓인 카드를 누르면 탐험 그림판의 그 자리로 간다
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var C = global.BigHistoryCommon;
  var ROUND = 5;   // 끼워 넣을 카드 수(처음 놓여 있는 한 장은 빼고)

  /** 같은 씨앗이면 같은 수열(mulberry32) */
  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** 시작 해가 서로 다른 카드 n 장 — 같은 해 둘이면 순서를 가릴 수 없다 */
  function deal(pool, rnd, n) {
    var bag = pool.slice();
    var used = {};
    var out = [];
    while (out.length < n && bag.length) {
      var e = bag.splice(Math.floor(rnd() * bag.length), 1)[0];
      if (used[e.start_year]) continue;
      used[e.start_year] = true;
      out.push(e);
    }
    return out;
  }

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
    } catch (err) { /* 저장이 막혀 있어도 퀴즈는 된다 */ }
    return null;
  }

  /**
   * @param root  퀴즈를 그릴 자리
   * @param opts  { entries(): 항목들, onShow(entry): 탐험에서 보여 주기, shareTitle }
   */
  function create(root, opts) {
    var game = null;

    function pool() {
      return opts.entries().filter(function (e) { return e.sources && e.sources.length; });
    }

    function start(mode) {
      var key = todayKey();
      var rnd = mode === 'daily'
        ? seeded(Number(key.replace(/-/g, '')))
        : seeded(Math.floor(Math.random() * 4294967296));
      var cards = deal(pool(), rnd, ROUND + 1);
      game = { mode: mode, day: key, placed: [cards[0]], hand: cards.slice(1), marks: [], last: null, res: {} };
      render();
    }

    function place(slot) {
      var card = game.hand[0];
      var line = game.placed;
      var before = line[slot - 1];
      var after = line[slot];
      var ok = (!before || before.start_year <= card.start_year) && (!after || card.start_year <= after.start_year);
      game.res[card.id] = ok ? 'ok' : 'miss';
      line.push(card);
      line.sort(function (a, b) { return a.start_year - b.start_year; });
      game.hand.shift();
      game.marks.push(ok);
      game.last = card;
      if (!game.hand.length && game.mode === 'daily') store('bighistory.quiz.' + game.day, resultLine());
      render();
    }

    function resultLine() {
      var right = game.marks.filter(Boolean).length;
      return game.marks.map(function (m) { return m ? '🟩' : '🟥'; }).join('') + ' ' + right + '/' + game.marks.length;
    }

    function share() {
      var text = (opts.shareTitle || '연표 퀴즈') + ' ' + (game.mode === 'daily' ? game.day : '연습') + '\n' + resultLine() + '\n' + location.href.split('#')[0];
      if (navigator.share) {
        navigator.share({ text: text }).catch(function () { /* 사용자가 닫음 */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { flash('결과를 복사했어요'); });
      }
    }

    function flash(msg) {
      var f = root.querySelector('.quiz__flash');
      if (f) f.textContent = msg;
    }

    function cardNode(e, opened) {
      var mark = game && game.res[e.id];
      var b = el('button', 'quiz-card' + (mark ? ' is-' + mark : ''));
      b.type = 'button';
      var head = el('span', 'quiz-card__head');
      var dot = el('span', 'dot');
      dot.style.backgroundColor = e._color;
      head.appendChild(dot);
      head.appendChild(document.createTextNode(e._label));
      b.appendChild(head);
      b.appendChild(el('span', 'quiz-card__title', e.title));
      if (opened) {
        b.appendChild(el('span', 'quiz-card__year', e.era_note || C.periodLabel(e.start_year, e.end_year)));
        b.setAttribute('aria-label', e.title + ', ' + (e.era_note || '') + ' — 연표에서 보기');
        b.addEventListener('click', function () { opts.onShow(e); });
      } else {
        b.disabled = true;
      }
      return b;
    }

    function render() {
      root.textContent = '';
      var wrap = el('div', 'quiz');
      var top = el('div', 'quiz__top');
      top.appendChild(el('h2', 'quiz__title', '연표 끼워 넣기'));
      top.appendChild(el('span', 'quiz__badge', '데모'));
      wrap.appendChild(top);

      if (!game) {
        wrap.appendChild(el('p', 'pane__lead', '사건 카드를 한 장씩 받아, 연표의 알맞은 자리에 끼워 넣으세요. 다섯 장이면 끝나요.'));
        var done = store('bighistory.quiz.' + todayKey());
        var acts = el('div', 'pane__actions');
        var daily = el('button', 'pill-btn pill-btn--strong', done ? '오늘의 퀴즈 다시 보기' : '오늘의 퀴즈');
        daily.type = 'button';
        daily.addEventListener('click', function () { start('daily'); });
        var practice = el('button', 'pill-btn', '연습');
        practice.type = 'button';
        practice.addEventListener('click', function () { start('practice'); });
        acts.appendChild(daily);
        acts.appendChild(practice);
        wrap.appendChild(acts);
        if (done) wrap.appendChild(el('p', 'pane__count', '오늘 결과 ' + done));
        wrap.appendChild(el('p', 'pane__count', '카드는 공인 자료로 연도를 확인한 ' + pool().length + '개 항목에서 나와요.'));
        root.appendChild(wrap);
        return;
      }

      var playing = game.hand.length > 0;
      var status = el('p', 'pane__count quiz__status');
      status.textContent = (game.mode === 'daily' ? '오늘의 퀴즈 ' + game.day : '연습') + ' · ' +
        (playing ? (game.marks.length + 1) + ' / ' + ROUND + '번째 카드' : '끝');
      wrap.appendChild(status);

      var flashNode = el('p', 'quiz__flash');
      flashNode.setAttribute('role', 'status');
      if (game.last) {
        var hit = game.res[game.last.id] === 'ok';
        flashNode.textContent = (hit ? '맞았어요 · ' : '아쉬워요 · 정답은 ') + (game.last.era_note || '');
        flashNode.classList.add(hit ? 'is-ok' : 'is-miss');
      }
      wrap.appendChild(flashNode);

      if (playing) {
        var hand = el('div', 'quiz__hand');
        hand.appendChild(el('p', 'quiz__hint', '이 카드는 언제일까요?'));
        hand.appendChild(cardNode(game.hand[0], false));
        wrap.appendChild(hand);
      } else {
        var res = el('div', 'quiz__result');
        res.appendChild(el('p', 'quiz__score', resultLine()));
        var acts2 = el('div', 'pane__actions');
        var sh = el('button', 'pill-btn pill-btn--strong', '결과 나누기');
        sh.type = 'button';
        sh.addEventListener('click', share);
        var again = el('button', 'pill-btn', '연습 한 판 더');
        again.type = 'button';
        again.addEventListener('click', function () { start('practice'); });
        acts2.appendChild(sh);
        acts2.appendChild(again);
        res.appendChild(acts2);
        res.appendChild(el('p', 'pane__count', '카드를 누르면 연표의 그 자리로 가요.'));
        wrap.appendChild(res);
      }

      // 지금까지 놓인 카드 — 사이사이에 '여기' 자리
      var list = el('ol', 'quiz__line');
      var line = game.placed;
      for (var i = 0; i <= line.length; i += 1) {
        if (playing) {
          var li = el('li', 'quiz__slot-row');
          var slot = el('button', 'quiz-slot', '여기');
          slot.type = 'button';
          slot.setAttribute('aria-label', i === 0 ? '맨 앞에 넣기' : (i === line.length ? '맨 뒤에 넣기' : line[i - 1].title + ' 다음에 넣기'));
          (function (n) { slot.addEventListener('click', function () { place(n); }); })(i);
          li.appendChild(slot);
          list.appendChild(li);
        }
        if (i < line.length) {
          var row = el('li', 'quiz__card-row');
          row.appendChild(cardNode(line[i], true));
          list.appendChild(row);
        }
      }
      wrap.appendChild(list);
      root.appendChild(wrap);
    }

    render();
    return {
      reset: function () { game = null; render(); }
    };
  }

  global.BigHistoryQuiz = { create: create, deal: deal, seeded: seeded };
})(window);
