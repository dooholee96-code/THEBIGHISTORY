/* ------------------------------------------------------------------
   갈림길 — 대체역사 게임

   실제 역사의 한 장면에서 다른 길을 골라, 가상의 역사를 끝까지 밀고 가 보는 짧은 게임.
     · 목록   — 시나리오 카드(스테이지). 찾은 결말 수 n/m, 이어 하던 것은 '이어서'
     · 진행   — 장면 카드 한 장씩. 위에는 해(크게)와 게이지(국력·민심 등)
                갈림길에서 고르면 게이지가 오르내리고, 확률로 갈리는 선택지는 룰렛이 돈다
                게이지가 바닥나면(0) 그 자리에서 정해 둔 결말로 떨어진다(scenario.zero)
     · 결말   — 등급(최고·좋은·씁쓸한·파국), '실제로는 ~' 과 견주기, 결말 도감, 결과 나누기
     · 아래 '실제 역사와 나란히 보기'를 펼치면 지나온 가상 사건과 같은 때의 실제 연표가 나란히

   진행 상황·찾은 결말은 이 기기의 브라우저에만 저장한다(어디로도 보내지 않는다).
   가상의 내용은 data/alt/ 에만 있고 실제 연표 데이터와 섞이지 않는다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var STORE = 'bighistory.branch.';
  var REAL_LIMIT = 60;
  var GAUGE_MAX = 10;
  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var STATUS_LABEL = { sample: '예시 · 내용은 자리표시', draft: '초안' };
  var TONE = {
    best: { label: '최고의 결말', mark: '★' },
    good: { label: '좋은 결말', mark: '◎' },
    mixed: { label: '씁쓸한 결말', mark: '△' },
    bad: { label: '파국', mark: '✕' }
  };
  var KIND_TAG = { event: '가상 사건', choice: '갈림길', ending: '결말' };

  function el(tag, cls, parent, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  function button(cls, parent, text, onClick) {
    var b = el('button', cls, parent, text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function yearText(year) {
    return year < 0 ? '기원전 ' + Math.abs(year) + '년' : year + '년';
  }

  /** 받침이 있으면 a(이·은·을), 없으면 b(가·는·를) */
  function josa(word, a, b) {
    var c = word.charCodeAt(word.length - 1) - 0xAC00;
    return c >= 0 && c <= 11171 && c % 28 ? a : b;
  }

  var LOG_MAX = Math.log(1 + 30000);

  /** 실제 역사 카드 — 카테고리 · 이름 · 기간 막대(10년과 1000년이 둘 다 보이게 로그 비율) */
  function realCard(entry, openEntry, parent) {
    var card = button('tl-card is-real', parent, null, function () { openEntry(entry); });
    card.style.setProperty('--c', entry._color);
    card.title = entry.title;
    var cat = el('span', 'tl-card__cat', card);
    el('i', 'dot', cat).style.backgroundColor = entry._color;
    cat.appendChild(document.createTextNode(entry._label));
    el('span', 'tl-card__title', card, entry.title);
    var years = entry.end_year - entry.start_year;
    if (years > 0) {
      var span = el('span', 'tl-card__span', card);
      var bar = el('i', 'tl-card__bar', span);
      var w = Math.max(6, Math.min(100, Math.log(1 + years) / LOG_MAX * 100));
      bar.style.width = (w * 0.5).toFixed(1) + '%';
      el('span', 'tl-card__len', span, '~' + yearText(entry.end_year) + ' · ' + years + '년');
    }
    return card;
  }

  // ---------------------------------------------------------- 저장

  function load(key, fallback) {
    try {
      var raw = global.localStorage.getItem(STORE + key);
      var v = raw ? JSON.parse(raw) : fallback;
      return Array.isArray(v) ? v : fallback;
    } catch (err) { return fallback; }
  }

  function save(key, v) {
    try { global.localStorage.setItem(STORE + key, JSON.stringify(v)); } catch (err) { /* 저장 못 해도 진행은 됨 */ }
  }

  // ---------------------------------------------------------- 진행

  function startStats(sc) {
    var s = {};
    (sc.stats || []).forEach(function (st) { s[st.id] = st.init == null ? 5 : st.init; });
    return s;
  }

  /** 게이지에 효과를 더한다(0..GAUGE_MAX) */
  function apply(stats, effects) {
    Object.keys(effects || {}).forEach(function (id) {
      if (id in stats) stats[id] = Math.max(0, Math.min(GAUGE_MAX, stats[id] + effects[id]));
    });
  }

  /** 바닥난 게이지가 있으면 그 게이지의 결말 id */
  function zeroEnding(sc, stats) {
    var z = sc.zero || {};
    for (var id in z) {
      if (Object.prototype.hasOwnProperty.call(z, id) && stats[id] != null && stats[id] <= 0 && sc._nodes[z[id]]) return { stat: id, to: z[id] };
    }
    return null;
  }

  /**
   * 시작 노드부터 고른 것(picks)을 따라 걸어 지금까지의 길을 만든다.
   * picks: [{ node, option, outcome }]  — outcome 은 확률 선택지에서 나온 결과 번호
   * 걸으며 게이지를 셈한다 — 단계마다 그 장면을 볼 때의 게이지(stats: 장면의 효과는 더하고, 고른 선택지의 효과는
   * 아직 — 그건 다음 장면에서 오르내리는 게 보인다).
   * 데이터가 바뀌어 저장된 선택이 맞지 않으면 그 자리에서 멈춘다.
   */
  function walk(sc, picks) {
    var steps = [];
    var stats = startStats(sc);
    var id = sc.start;
    var p = 0;
    var guard = 0;
    var fell = null;
    while (id && guard < 500) {
      guard += 1;
      var node = sc._nodes[id];
      if (!node) break;
      var step = { node: node, fell: fell };
      fell = null;
      steps.push(step);
      apply(stats, node.effects);
      step.stats = Object.assign({}, stats);
      var next = null;
      if (node.kind === 'ending') break;
      if (node.kind === 'event') {
        next = node.next;
      } else {
        var pick = picks[p];
        var opt = pick && pick.node === node.id ? node.options[pick.option] : null;
        if (!opt) break;                       // 여기서 고르기를 기다린다
        p += 1;
        step.pick = pick;
        step.option = opt;
        apply(stats, opt.effects);
        if (opt.to) {
          next = opt.to;
        } else {
          var oc = opt.outcomes[pick.outcome];
          if (!oc) break;
          step.outcome = oc;
          apply(stats, oc.effects);
          next = oc.to;
        }
      }
      var z = zeroEnding(sc, stats);
      if (z) { fell = z.stat; next = z.to; }
      id = next;
    }
    return { steps: steps, used: p };
  }

  /** 확률 선택지의 결과를 정한다 */
  function roll(outcomes) {
    var r = Math.random();
    var acc = 0;
    for (var i = 0; i < outcomes.length; i += 1) {
      acc += outcomes[i].chance;
      if (r < acc) return i;
    }
    return outcomes.length - 1;
  }

  function lastStep(path) {
    return path.steps[path.steps.length - 1];
  }

  function endingsOf(sc) {
    return Object.keys(sc._nodes).map(function (k) { return sc._nodes[k]; }).filter(function (n) { return n.kind === 'ending'; });
  }

  // ---------------------------------------------------------- 화면

  /**
   * @param root      #branch-root
   * @param ctx       { data, openEntry(entry), scrollBox, shareTitle }
   */
  function create(root, ctx) {
    var data = ctx.data;
    var current = null;     // 진행 중인 시나리오
    var picks = [];
    var cursor = 0;         // 지금 보여 주는 단계(사건은 '계속'을 눌러 하나씩 넘긴다)
    var busy = false;       // 룰렛이 도는 동안 다른 입력을 막는다

    var byId = {};
    data.entries.forEach(function (e) { byId[e.id] = e; });

    function statLabel(sc, id) {
      var st = (sc.stats || []).filter(function (s) { return s.id === id; })[0];
      return st ? st.label : id;
    }

    function found(sc) { return load('endings.' + sc.id, []); }

    function remember(sc, endingId) {
      var list = found(sc);
      if (list.indexOf(endingId) < 0) { list.push(endingId); save('endings.' + sc.id, list); return true; }
      return false;
    }

    // ------------------------------------------------------ 목록(스테이지 고르기)

    function renderList() {
      current = null;
      root.textContent = '';

      var hero = el('div', 'bg-hero', root);
      el('p', 'bg-hero__kicker', hero, '대체역사 게임');
      el('h2', 'bg-hero__title', hero, '갈림길');
      el('p', 'bg-hero__lead', hero,
        '역사의 한 장면에서 다른 길을 골라 보세요. 고를 때마다 게이지가 오르내리고, 운에 맡기는 선택은 룰렛이 정해요. ' +
        '끝에서는 실제 역사와 견주고, 숨은 결말을 모아 보세요.');
      el('p', 'branch-fiction', root, '가상의 역사입니다 — 실제 연표와 섞이지 않습니다.');

      if (!data.scenarios.length) {
        el('p', 'card__text', root, '아직 시나리오가 없습니다. data/alt/ 에 추가하면 여기에 나타납니다.');
        return;
      }

      var list = el('div', 'branch-list', root);
      data.scenarios.forEach(function (sc, i) {
        var saved = load(sc.id, []);
        var ends = endingsOf(sc);
        var got = found(sc);
        var item = button('bg-stage', list, null, function () { open(sc); });

        var top = el('span', 'bg-stage__top', item);
        el('span', 'bg-stage__no', top, 'STAGE ' + (i + 1));
        el('span', 'bg-stage__year', top, yearText(sc.anchor.year));
        if (STATUS_LABEL[sc.status]) el('span', 'branch-badge', top, STATUS_LABEL[sc.status]);

        el('span', 'bg-stage__title', item, sc.title);
        el('span', 'bg-stage__q', item, sc.question);

        var foot = el('span', 'bg-stage__foot', item);
        var dex = el('span', 'bg-stage__dex', foot);
        ends.forEach(function (n) {
          var on = got.indexOf(n.id) >= 0;
          var pip = el('i', 'bg-stage__pip' + (on ? ' is-on tone-' + (n.tone || 'mixed') : ''), dex);
          pip.title = on ? n.title : '???';
        });
        el('span', 'bg-stage__count', foot, '결말 ' + got.length + '/' + ends.length);
        var path = walk(sc, saved);
        var last = lastStep(path);
        var label = saved.length ? (last && last.node.kind === 'ending' ? '다시 하기' : '이어서') : '시작';
        el('span', 'bg-stage__go', foot, label + ' →');
      });
    }

    // ------------------------------------------------------ 진행

    function open(sc) {
      current = sc;
      picks = load(sc.id, []);
      // 저장된 선택이 지금 데이터와 어긋나면 맞는 데까지만 남긴다
      var path = walk(sc, picks);
      if (path.used < picks.length) { picks = picks.slice(0, path.used); save(sc.id, picks); }
      cursor = path.steps.length - 1;
      render({});
      if (ctx.scrollBox) ctx.scrollBox.scrollTop = 0;
    }

    function choose(node, optionIndex, card) {
      if (busy) return;
      var opt = node.options[optionIndex];
      var pick = { node: node.id, option: optionIndex };
      if (opt.outcomes) pick.outcome = roll(opt.outcomes);
      var before = walk(current, picks).steps.length;
      picks.push(pick);
      save(current.id, picks);
      var go = function () {
        busy = false;
        cursor = Math.min(before, walk(current, picks).steps.length - 1);   // 고른 뒤 첫 장면
        render({ fresh: true });
      };
      if (opt.outcomes && !reduced) {
        busy = true;
        spin(card, opt.outcomes, pick.outcome, go);
      } else {
        go();
      }
    }

    function advance() {
      var path = walk(current, picks);
      if (cursor < path.steps.length - 1) {
        cursor += 1;
        render({ fresh: true });
      }
    }

    function undo() {
      if (!picks.length || busy) return;
      picks.pop();
      save(current.id, picks);
      cursor = walk(current, picks).steps.length - 1;
      render({});
    }

    function restart() {
      if (busy) return;
      picks = [];
      save(current.id, picks);
      cursor = 0;
      render({});
      if (ctx.scrollBox) ctx.scrollBox.scrollTop = 0;
    }

    /**
     * 룰렛 — 확률만큼 나눈 띠 위를 바늘이 몇 바퀴 돌다가 정해진 칸에 멈춘다.
     * 결과는 이미 정해져 있고(roll), 이건 보여 주기다.
     */
    function spin(card, outcomes, hit, done) {
      var box = el('div', 'roulette', card);
      var band = el('div', 'roulette__band', box);
      var acc = 0;
      var at = 0;
      outcomes.forEach(function (oc, i) {
        var seg = el('span', 'roulette__seg roulette__seg--' + (i % 4), band);
        seg.style.width = (oc.chance * 100) + '%';
        el('span', 'roulette__pct', seg, Math.round(oc.chance * 100) + '%');
        if (i === hit) at = acc + oc.chance * (0.25 + Math.random() * 0.5);
        acc += oc.chance;
      });
      var needle = el('i', 'roulette__needle', band);
      var label = el('p', 'roulette__label', box, '운명의 룰렛…');
      var turns = 3;
      var total = turns + at;
      var t0 = global.performance ? performance.now() : Date.now();
      var dur = 1500;
      function frame(t) {
        var k = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - k, 3);
        var x = (e * total) % 1;
        needle.style.left = (x * 100) + '%';
        if (k < 1) { global.requestAnimationFrame(frame); return; }
        needle.style.left = (at * 100) + '%';
        band.children[hit].classList.add('is-hit');
        var oc = outcomes[hit];
        label.textContent = (oc.label || '결과') + ' — ' + Math.round(oc.chance * 100) + '% 쪽!';
        label.classList.add('is-done');
        setTimeout(done, 750);
      }
      global.requestAnimationFrame(frame);
    }

    // ------------------------------------------------------ 진행 화면

    function render(o) {
      var sc = current;
      var path = walk(sc, picks);
      var steps = path.steps;
      cursor = Math.max(0, Math.min(cursor, steps.length - 1));
      var step = steps[cursor];
      var prev = cursor > 0 ? steps[cursor - 1] : null;
      root.textContent = '';

      var head = el('div', 'branch-head', root);
      button('pill-btn', head, '← 목록', renderList);
      if (STATUS_LABEL[sc.status]) el('span', 'branch-badge', head, STATUS_LABEL[sc.status]);

      // 계기판 — 해와 게이지
      var hud = el('div', 'bg-hud', root);
      var hy = el('div', 'bg-hud__top', hud);
      el('span', 'bg-hud__title', hy, sc.title);
      el('span', 'bg-hud__year', hy, yearText(step.node.year));
      if ((sc.stats || []).length) {
        var gs = el('div', 'bg-gauges', hud);
        sc.stats.forEach(function (st) {
          var v = step.stats[st.id];
          var was = prev ? prev.stats[st.id] : (st.init == null ? 5 : st.init);
          var d = o.fresh ? v - was : 0;
          var g = el('div', 'bg-gauge' + (v <= 2 ? ' is-low' : ''), gs);
          var lab = el('span', 'bg-gauge__label', g);
          if (st.icon) el('span', 'bg-gauge__icon', lab, st.icon);
          lab.appendChild(document.createTextNode(st.label));
          var pips = el('span', 'bg-gauge__pips', g);
          for (var i = 0; i < GAUGE_MAX; i += 1) {
            var pip = el('i', null, pips);
            if (i < v) pip.className = 'is-on';
            if (d > 0 && i >= was && i < v) pip.className = 'is-on is-up';
            if (d < 0 && i >= v && i < was) pip.className = 'is-down';
          }
          if (d) el('span', 'bg-gauge__delta ' + (d > 0 ? 'is-up' : 'is-down'), g, (d > 0 ? '+' : '−') + Math.abs(d));
        });
      }

      // 장면 카드
      var node = step.node;
      var card = el('div', 'scene scene--' + node.kind + (node.kind === 'ending' ? ' tone-' + (node.tone || 'mixed') : '') + (o.fresh && !reduced ? ' is-in' : ''), root);
      if (step.fell) {
        var name = statLabel(sc, step.fell);
        el('p', 'scene__fell', card, name + josa(name, '이', '가') + ' 바닥났습니다!');
      }
      if (node.kind === 'ending') {
        var tone = TONE[node.tone] || TONE.mixed;
        var badge = el('div', 'scene__badge', card);
        el('span', 'scene__badge-mark', badge, tone.mark);
        el('span', 'scene__badge-label', badge, tone.label);
      }
      var tag = el('p', 'scene__tag', card, KIND_TAG[node.kind] + ' · ' + yearText(node.year));
      if (node.end_year && node.end_year !== node.year) tag.appendChild(document.createTextNode(' ~ ' + yearText(node.end_year)));
      el('h3', 'scene__title', card, node.title);
      if (node.text) el('p', 'scene__text', card, node.text);
      if (cursor === 0 && sc.anchor.note) {
        var an = el('p', 'scene__anchor', card);
        el('strong', null, an, '실제로는 ' + yearText(sc.anchor.year) + ' — ');
        an.appendChild(document.createTextNode(sc.anchor.note));
        if (sc._anchorEntry) {
          button('scene__link', an, sc._anchorEntry.title + ' 연표에서 보기', function () { ctx.openEntry(sc._anchorEntry); });
        }
      }

      if (node.kind === 'choice' && !step.pick) {
        var opts = el('div', 'scene__opts', card);
        node.options.forEach(function (opt, i) {
          var b = button('scene__opt', opts, null, function () { choose(node, i, card); });
          el('span', 'scene__opt-key', b, String.fromCharCode(65 + i));
          el('span', 'scene__opt-label', b, opt.label);
          if (opt.outcomes) el('span', 'scene__opt-hint', b, '운에 맡김 · ' + opt.outcomes.map(function (x) { return Math.round(x.chance * 100); }).join(' : '));
        });
      } else if (node.kind !== 'ending') {
        var nb = el('div', 'scene__next', card);
        button('pill-btn pill-btn--strong', nb, '계속 →', advance);
      }

      if (node.kind === 'ending') {
        var isNew = remember(sc, node.id);
        if (node.reality) {
          var real = el('p', 'scene__reality', card);
          el('strong', null, real, '실제로는 ');
          real.appendChild(document.createTextNode(node.reality));
        }
        var ends = endingsOf(sc);
        var got = found(sc);
        var dex = el('div', 'scene__dex', card);
        el('p', 'scene__dex-title', dex, '결말 도감 ' + got.length + '/' + ends.length + (isNew ? ' · 새 결말!' : ''));
        var row = el('div', 'scene__dex-row', dex);
        ends.forEach(function (n) {
          var on = got.indexOf(n.id) >= 0;
          var chip = el('span', 'scene__dex-chip' + (on ? ' is-on tone-' + (n.tone || 'mixed') : '') + (n.id === node.id ? ' is-now' : ''), row);
          chip.textContent = on ? (TONE[n.tone] || TONE.mixed).mark + ' ' + n.title : '???';
        });
        var acts = el('div', 'scene__acts', card);
        button('pill-btn pill-btn--strong', acts, '처음부터 다시', restart);
        button('pill-btn', acts, '↶ 한 수 무르기', undo).disabled = !picks.length;
        button('pill-btn', acts, '결과 나누기', function () { share(sc, node, got.length, ends.length); });
      }

      // 지나온 길 — 장면을 하나씩 넘긴 자취
      var trail = el('ol', 'bg-trail', root);
      steps.slice(0, cursor + 1).forEach(function (s, i) {
        var li = el('li', 'bg-trail__item bg-trail__item--' + s.node.kind + (i === cursor ? ' is-now' : ''), trail);
        el('span', 'bg-trail__year', li, s.node.year < 0 ? '기원전 ' + Math.abs(s.node.year) : String(s.node.year));
        el('span', 'bg-trail__title', li, s.option ? s.node.title + ' → ' + s.option.label : s.node.title);
      });

      // 실제 역사와 나란히
      var more = el('details', 'bg-compare', root);
      if (node.kind === 'ending') more.open = true;
      el('summary', null, more, '실제 역사와 나란히 보기');
      renderCompare(more, steps.slice(0, cursor + 1));

      var bar = el('div', 'branch-bar', root);
      button('pill-btn', bar, '↶ 한 수 무르기', undo).disabled = !picks.length;
      button('pill-btn', bar, '처음부터', restart).disabled = !picks.length && cursor === 0;

      if (o.fresh && !reduced) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function share(sc, node, got, total) {
      var tone = TONE[node.tone] || TONE.mixed;
      var text = (ctx.shareTitle || '갈림길') + ' — 「' + sc.title + '」\n' + tone.mark + ' ' + tone.label + ' 「' + node.title + '」\n결말 ' + got + '/' + total + ' 발견\n' + location.href.split('#')[0];
      if (navigator.share) navigator.share({ text: text }).catch(function () { /* 사용자가 닫음 */ });
      else if (navigator.clipboard) navigator.clipboard.writeText(text);
    }

    /** 실제 역사 칸 — 비교할 카테고리에서 갈림길 이후 ~ 지금까지 간 해 사이의 항목 */
    function realEntries(sc, steps) {
      var from = sc.anchor.year;
      var to = steps.reduce(function (m, s) { return Math.max(m, s.node.end_year || s.node.year); }, from);
      var compare = {};
      (sc.compare || []).forEach(function (id) { compare[id] = true; });
      var picked = {};
      var list = data.entries.filter(function (e) {
        var ok = compare[e._dataset] && e.start_year >= from && e.start_year <= to;
        if (ok) picked[e.id] = true;
        return ok;
      }).slice(0, REAL_LIMIT);
      // 노드에 직접 연결해 둔 실제 항목과 갈림길 항목은 범위 밖이어도 넣는다
      steps.forEach(function (s) {
        (s.node.real || []).forEach(function (id) {
          if (byId[id] && !picked[id]) { list.push(byId[id]); picked[id] = true; }
        });
      });
      if (sc._anchorEntry && !picked[sc._anchorEntry.id]) list.push(sc._anchorEntry);
      return list;
    }

    /** 같은 시간축에 실제 | 가상 */
    function renderCompare(parent, steps) {
      var tl = el('div', 'tl branch-tl', parent);
      var cols = el('div', 'branch-cols', tl);
      el('span', 'branch-cols__real', cols, '실제 역사');
      el('span', 'branch-cols__alt', cols, '가상 역사');
      var rows = {};
      function row(year) {
        if (!rows[year]) rows[year] = { year: year, real: [], alt: [] };
        return rows[year];
      }
      realEntries(current, steps).forEach(function (e) { row(e.start_year).real.push(e); });
      steps.forEach(function (s) { row(s.node.year).alt.push(s); });

      Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (year) {
        var r = rows[year];
        var line = el('div', 'tl-year is-in' + (r.alt.length ? ' has-alt' : ''), tl);
        if (r.alt.some(function (s) { return s.node.kind === 'choice'; })) line.classList.add('has-choice');
        var mark = el('div', 'tl-mark', line);
        if (year < 0) el('span', 'tl-mark__pre', mark, '기원전');
        el('span', 'tl-mark__num', mark, String(Math.abs(year)));
        el('span', 'tl-dot', mark);
        var real = el('div', 'tl-side tl-side--nation', line);
        var alt = el('div', 'tl-side tl-side--theme', line);
        r.real.forEach(function (e) { realCard(e, ctx.openEntry, real); });
        r.alt.forEach(function (s) {
          var c = el('div', 'alt-card alt-card--' + s.node.kind, alt);
          el('span', 'alt-card__tag', c, KIND_TAG[s.node.kind]);
          el('span', 'alt-card__title', c, s.node.title);
          if (s.option) el('p', 'alt-card__text', c, '→ ' + s.option.label + (s.outcome && s.outcome.label ? ' (' + s.outcome.label + ')' : ''));
          if (s.node.reality) {
            var rp = el('p', 'alt-reality', c);
            el('strong', null, rp, '실제로는 ');
            rp.appendChild(document.createTextNode(s.node.reality));
          }
        });
        if (!real.childNodes.length) real.classList.add('is-empty');
        if (!alt.childNodes.length) alt.classList.add('is-empty');
      });
    }

    /** 실제 연표의 항목에서 그 항목에서 갈라지는 시나리오로 바로 들어갈 때 */
    function scenariosFor(entryId) {
      return data.scenarios.filter(function (sc) { return sc.anchor.entry === entryId; });
    }

    function openById(id) {
      var sc = data.scenarios.filter(function (s) { return s.id === id; })[0];
      if (sc) open(sc); else renderList();
    }

    renderList();

    return {
      renderList: renderList,
      open: openById,
      scenariosFor: scenariosFor,
      get playing() { return !!current; }
    };
  }

  global.BigHistoryBranch = { create: create, walk: walk };
})(window);
