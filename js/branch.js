/* ------------------------------------------------------------------
   갈림길 — 대체역사 시나리오 화면

   실제 연표의 한 항목(anchor)에서 갈라져 나가는 가상의 역사를 따라간다.
     · 목록   — 시나리오 카드. 이어 하던 것은 '이어서'
     · 진행   — 왼쪽(모바일은 위) '실제 역사', 오른쪽 '가상 역사'를 같은 시간축에
                갈림길(choice)에서 고르면 다음 가상 사건이 이어지고,
                확률로 갈리는 선택지는 고른 뒤에 결과가 정해진다
     · 결말   — '실제로는 ~' 과 견주어 보고, 한 단계 되돌리거나 처음부터

   진행 상황은 이 기기의 브라우저에만 저장한다(어디로도 보내지 않는다).
   가상의 내용은 data/alt/ 에만 있고 실제 연표 데이터와 섞이지 않는다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var STORE = 'bighistory.branch.';
  var REAL_LIMIT = 60;
  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var STATUS_LABEL = { sample: '예시 · 내용은 자리표시', draft: '초안' };

  function el(tag, cls, parent, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  var LOG_MAX = Math.log(1 + 30000);

  function yearText(year) {
    return year < 0 ? '기원전 ' + Math.abs(year) : String(year);
  }

  /** 실제 역사 카드 — 카테고리 · 이름 · 기간 막대(10년과 1000년이 둘 다 보이게 로그 비율) */
  function realCard(entry, openEntry, parent) {
    var card = el('button', 'tl-card', parent);
    card.type = 'button';
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
      bar.style.width = (w * 0.5).toFixed(1) + '%';   // 막대는 최대 줄의 절반까지
      el('span', 'tl-card__len', span, '~' + yearText(entry.end_year) + ' · ' + years + '년');
    }

    card.addEventListener('click', function () { openEntry(entry); });
    return card;
  }

  function yearText(year) {
    return year < 0 ? '기원전 ' + Math.abs(year) + '년' : year + '년';
  }

  // ---------------------------------------------------------- 저장

  function loadPicks(id) {
    try {
      var raw = global.localStorage.getItem(STORE + id);
      var picks = raw ? JSON.parse(raw) : [];
      return Array.isArray(picks) ? picks : [];
    } catch (err) { return []; }
  }

  function savePicks(id, picks) {
    try { global.localStorage.setItem(STORE + id, JSON.stringify(picks)); } catch (err) { /* 저장 못 해도 진행은 됨 */ }
  }

  // ---------------------------------------------------------- 진행

  /**
   * 시작 노드부터 고른 것(picks)을 따라 걸어 지금까지의 길을 만든다.
   * picks: [{ node, option, outcome }]  — outcome 은 확률 선택지에서 나온 결과 번호
   * 데이터가 바뀌어 저장된 선택이 맞지 않으면 그 자리에서 멈춘다.
   */
  function walk(sc, picks) {
    var steps = [];
    var id = sc.start;
    var p = 0;
    var guard = 0;
    while (id && guard < 500) {
      guard += 1;
      var node = sc._nodes[id];
      if (!node) break;
      var step = { node: node };
      steps.push(step);
      if (node.kind === 'event') { id = node.next; continue; }
      if (node.kind === 'ending') break;

      var pick = picks[p];
      var opt = pick && pick.node === node.id ? node.options[pick.option] : null;
      if (!opt) break;                       // 여기서 고르기를 기다린다
      p += 1;
      step.pick = pick;
      step.option = opt;
      if (opt.to) {
        id = opt.to;
      } else {
        var oc = opt.outcomes[pick.outcome];
        if (!oc) break;
        step.outcome = oc;
        id = oc.to;
      }
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

  function isFinished(sc, picks) {
    var last = lastStep(walk(sc, picks));
    return !!last && last.node.kind === 'ending';
  }

  // ---------------------------------------------------------- 화면

  /**
   * @param root      #branch-root
   * @param ctx       { data, openEntry(entry), scrollBox }
   */
  function create(root, ctx) {
    var data = ctx.data;
    var current = null;     // 진행 중인 시나리오
    var picks = [];
    var shownSteps = 0;     // 새로 나타난 단계만 등장 효과를 주려고 센다

    var byId = {};
    data.entries.forEach(function (e) { byId[e.id] = e; });

    // ------------------------------------------------------ 목록

    function renderList() {
      current = null;
      root.textContent = '';

      el('p', 'pane__lead', root,
        '실제 역사의 한 장면에서 다른 길을 골라 봅니다. 고를 때마다 가상의 역사가 이어지고, ' +
        '끝에서는 실제로 어떻게 되었는지와 견주어 봅니다.');
      el('p', 'branch-fiction', root, '가상의 역사입니다 — 실제 연표와 섞이지 않습니다.');

      if (!data.scenarios.length) {
        el('p', 'card__text', root, '아직 시나리오가 없습니다. data/alt/ 에 추가하면 여기에 나타납니다.');
        return;
      }

      var list = el('div', 'branch-list', root);
      data.scenarios.forEach(function (sc) {
        var saved = loadPicks(sc.id);
        var item = el('button', 'branch-item', list);
        item.type = 'button';

        var meta = el('span', 'branch-item__meta', item);
        el('span', 'branch-item__year', meta, yearText(sc.anchor.year) + '에서 갈라짐');
        if (sc._anchorEntry) el('span', 'branch-item__anchor', meta, sc._anchorEntry.title);
        if (STATUS_LABEL[sc.status]) el('span', 'branch-badge', meta, STATUS_LABEL[sc.status]);

        el('span', 'branch-item__title', item, sc.title);
        el('span', 'branch-item__q', item, sc.question);

        var state = saved.length ? (isFinished(sc, saved) ? '결말에 닿음 · 다시 보기' : '이어서 하기') : '시작하기';
        el('span', 'branch-item__go', item, state + ' →');

        item.addEventListener('click', function () { open(sc); });
      });
    }

    // ------------------------------------------------------ 진행 화면

    function open(sc) {
      current = sc;
      picks = loadPicks(sc.id);
      // 저장된 선택이 지금 데이터와 어긋나면 맞는 데까지만 남긴다
      var path = walk(sc, picks);
      if (path.used < picks.length) { picks = picks.slice(0, path.used); savePicks(sc.id, picks); }
      shownSteps = path.steps.length;
      renderPlay(false);
      if (ctx.scrollBox) ctx.scrollBox.scrollTop = 0;
    }

    function choose(stepNode, optionIndex) {
      var opt = stepNode.options[optionIndex];
      var pick = { node: stepNode.id, option: optionIndex };
      if (opt.outcomes) pick.outcome = roll(opt.outcomes);
      picks.push(pick);
      savePicks(current.id, picks);
      renderPlay(true, !!opt.outcomes);
    }

    function undo() {
      if (!picks.length) return;
      picks.pop();
      savePicks(current.id, picks);
      shownSteps = walk(current, picks).steps.length;
      renderPlay(false);
    }

    function restart() {
      picks = [];
      savePicks(current.id, picks);
      shownSteps = walk(current, picks).steps.length;
      renderPlay(false);
      if (ctx.scrollBox) ctx.scrollBox.scrollTop = 0;
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

    function renderPlay(animateNew, rolled) {
      var sc = current;
      var path = walk(sc, picks);
      var steps = path.steps;
      var last = lastStep(path);
      root.textContent = '';

      // 머리
      var head = el('div', 'branch-head', root);
      var back = el('button', 'pill-btn', head, '← 목록');
      back.type = 'button';
      back.addEventListener('click', renderList);
      if (STATUS_LABEL[sc.status]) el('span', 'branch-badge', head, STATUS_LABEL[sc.status]);

      el('h2', 'branch-title', root, sc.title);
      el('p', 'branch-q', root, sc.question);

      var anchor = el('div', 'branch-anchor', root);
      el('span', 'branch-anchor__mark', anchor, '갈림길 · ' + yearText(sc.anchor.year));
      if (sc._anchorEntry) {
        var link = el('button', 'branch-anchor__entry', anchor, sc._anchorEntry.title + ' (실제 연표)');
        link.type = 'button';
        link.addEventListener('click', function () { ctx.openEntry(sc._anchorEntry); });
      }
      if (sc.anchor.note) el('p', 'branch-anchor__note', anchor, sc.anchor.note);
      if (sc.summary) el('p', 'branch-anchor__summary', anchor, sc.summary);

      el('p', 'branch-fiction', root, '오른쪽(모바일은 점선 카드)은 가상의 역사입니다 — 실제 연표와 섞이지 않습니다.');

      // 같은 시간축에 실제 | 가상
      var tl = el('div', 'tl branch-tl', root);
      var cols = el('div', 'branch-cols', tl);
      el('span', 'branch-cols__real', cols, '실제 역사');
      el('span', 'branch-cols__alt', cols, '가상 역사');

      var rows = {};
      function row(year) {
        if (!rows[year]) rows[year] = { year: year, real: [], alt: [] };
        return rows[year];
      }
      realEntries(sc, steps).forEach(function (e) { row(e.start_year).real.push(e); });
      steps.forEach(function (s, i) { row(s.node.year).alt.push({ step: s, index: i }); });

      var newNodes = [];
      Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (year) {
        var r = rows[year];
        var line = el('div', 'tl-year is-in' + (r.alt.length ? ' has-alt' : ''), tl);
        if (r.alt.some(function (a) { return a.step.node.kind === 'choice'; })) line.classList.add('has-choice');

        var mark = el('div', 'tl-mark', line);
        if (year < 0) el('span', 'tl-mark__pre', mark, '기원전');
        el('span', 'tl-mark__num', mark, String(Math.abs(year)));
        el('span', 'tl-dot', mark);

        var real = el('div', 'tl-side tl-side--nation', line);
        var alt = el('div', 'tl-side tl-side--theme', line);
        r.real.forEach(function (e) {
          var card = realCard(e, ctx.openEntry, real);
          card.classList.add('is-real');
        });
        r.alt.forEach(function (a) {
          var card = renderStep(a.step, a.step === last, alt);
          if (animateNew && a.index >= shownSteps) newNodes.push(card);
        });
        if (!real.childNodes.length) real.classList.add('is-empty');
        if (!alt.childNodes.length) alt.classList.add('is-empty');
      });

      // 아래 조작
      var bar = el('div', 'branch-bar', root);
      var undoBtn = el('button', 'pill-btn', bar, '↶ 한 단계 되돌리기');
      undoBtn.type = 'button';
      undoBtn.disabled = !picks.length;
      undoBtn.addEventListener('click', undo);
      var resetBtn = el('button', 'pill-btn', bar, '처음부터');
      resetBtn.type = 'button';
      resetBtn.disabled = !picks.length;
      resetBtn.addEventListener('click', restart);

      // 새로 이어진 가상 사건은 차례로 톡 나타나고, 그쪽으로 화면을 데려간다
      if (newNodes.length) {
        newNodes.forEach(function (node, i) {
          node.classList.add('is-new');
          node.style.setProperty('--d', (rolled ? 520 : 0) + i * 120 + 'ms');
        });
        var target = newNodes[newNodes.length - 1];
        setTimeout(function () {
          target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        }, reduced ? 0 : 160);
      }
      shownSteps = steps.length;
    }

    /** 가상 노드 카드 — 사건·갈림길·결말 */
    function renderStep(step, isLast, parent) {
      var node = step.node;
      var card = el('div', 'alt-card alt-card--' + node.kind, parent);
      var tag = { event: '가상 사건', choice: '갈림길', ending: '결말' }[node.kind];
      var top = el('span', 'alt-card__tag', card, tag);
      if (node.end_year && node.end_year !== node.year) {
        el('span', 'alt-card__span', top, ' · ~' + yearText(node.end_year));
      }
      el('span', 'alt-card__title', card, node.title);
      if (node.text) el('p', 'alt-card__text', card, node.text);

      if (node.kind === 'choice') {
        var opts = el('div', 'alt-opts' + (step.pick ? ' is-done' : ''), card);
        node.options.forEach(function (opt, i) {
          var btn = el('button', 'alt-opt', opts);
          btn.type = 'button';
          el('span', 'alt-opt__label', btn, opt.label);
          if (opt.outcomes) el('span', 'alt-opt__hint', btn, '결과는 확률로 갈림');
          if (step.pick) {
            btn.disabled = true;
            if (step.pick.option === i) btn.classList.add('is-picked');
          } else {
            btn.addEventListener('click', function () { choose(node, i); });
          }
        });
        if (step.outcome) {
          var chance = Math.round(step.outcome.chance * 100);
          var rollLine = el('p', 'alt-roll', card);
          el('span', 'alt-roll__die', rollLine, chance + '%');
          rollLine.appendChild(document.createTextNode(
            (step.outcome.label ? step.outcome.label + ' — ' : '') + chance + '% 쪽 결과가 나왔습니다'));
        }
      }

      if (node.reality) {
        var real = el('p', 'alt-reality', card);
        el('strong', null, real, '실제로는 ');
        real.appendChild(document.createTextNode(node.reality));
      }

      if (node.kind === 'ending' && isLast) {
        var done = el('div', 'alt-actions', card);
        var again = el('button', 'pill-btn', done, '처음부터 다시');
        again.type = 'button';
        again.addEventListener('click', restart);
        var other = el('button', 'pill-btn', done, '다른 길 보기 (되돌리기)');
        other.type = 'button';
        other.addEventListener('click', undo);
      }
      return card;
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
