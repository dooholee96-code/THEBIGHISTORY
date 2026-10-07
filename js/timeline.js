/* ------------------------------------------------------------------
   타임라인 렌더러 — 세로 시간축 + 사건 카드

   표(js/chapters.js)와 같은 데이터를 '타임라인'으로 그립니다.
     · 가운데(모바일은 왼쪽) 세로선이 시간축, 사건이 있는 해마다 눈금과 점
     · 넓은 화면: 왼쪽 = 왕조·국가사 카드, 오른쪽 = 주제사 카드 (나란히 비교)
     · 좁은 화면: 축 오른쪽에 한 줄로, 국가사 → 주제사 순서
     · 해와 해 사이가 많이 벌어지면 '⋯ 350년' 틈 표시를 두어 시간의 흐름을 느끼게
     · 기간이 있는 사건은 카드 아래 가는 막대로 길이를 보여 준다(로그 비율)

   나라별 왕조·시대가 이어진 기간(색 띠)은 줄 위치를 재야 그릴 수 있어서
   app.js 의 buildLanes() 가 따로 그립니다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var LOG_MAX = Math.log(1 + 30000);

  function el(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  function yearText(year) {
    return year < 0 ? '기원전 ' + Math.abs(year) : String(year);
  }

  /** 기간 막대의 너비(0~100%) — 10년과 1000년이 둘 다 보이도록 로그 비율 */
  function spanWidth(years) {
    return Math.max(6, Math.min(100, Math.log(1 + years) / LOG_MAX * 100));
  }

  function renderCard(entry, handlers, parent) {
    var card = el('button', 'tl-card', parent);
    card.type = 'button';
    card.style.setProperty('--c', entry._color);
    card.title = entry.title;

    var cat = el('span', 'tl-card__cat', card);
    el('i', 'dot', cat).style.backgroundColor = entry._color;
    cat.appendChild(document.createTextNode(entry._label));
    if (entry.start_md) {
      var md = el('span', 'tl-card__md', cat);
      var p = entry.start_md.split('-');
      md.textContent = Number(p[0]) + '.' + Number(p[1]);
    }

    el('span', 'tl-card__title', card).textContent = entry.title;

    var years = entry.end_year - entry.start_year;
    if (years > 0) {
      var span = el('span', 'tl-card__span', card);
      var bar = el('i', 'tl-card__bar', span);
      bar.style.width = (spanWidth(years) * 0.5).toFixed(1) + '%';   // 막대는 최대 줄의 절반까지
      el('span', 'tl-card__len', span).textContent = '~' + yearText(entry.end_year) + ' · ' + years + '년';
    }

    card.addEventListener('click', function () { handlers.openEntry(entry); });
    return card;
  }

  /** 앞 해와의 간격을 눈에 보이는 틈으로 */
  function renderGap(years, parent) {
    var gap = el('div', 'tl-gap', parent);
    var h = Math.round(Math.min(46, Math.max(6, Math.log(years) / Math.LN10 * 13)));
    gap.style.height = h + 'px';
    if (years >= 80) {
      var label = el('span', 'tl-gap__label', gap);
      label.textContent = '⋯ ' + years + '년';
    }
  }

  /**
   * 시대 섹션 하나를 타임라인으로 그린다.
   * @param era       매니페스트 시대 정의
   * @param entries   이 시대에 시작하는(필터를 통과한) 항목들
   * @param columns   켜져 있는 카테고리(순서 = 매니페스트 순서)
   */
  function renderChapter(era, entries, columns, handlers, night) {
    var section = el('section', 'chapter chapter--tl');
    section.id = 'era-' + era.id;
    section.setAttribute('data-era', era.id);

    var art = el('div', 'chapter__art', section);
    var blob = night ? (era.night_blob || []) : (era.day_blob || []);
    // 디오라마(era.diorama)가 맨 위, 그 아래 색 블롭
    art.style.backgroundImage = (era.diorama ? ['url("' + era.diorama + '")'] : []).concat([
      'radial-gradient(38% 46% at 8% 34%, ' + (blob[0] || 'transparent') + ', transparent 72%)',
      'radial-gradient(34% 40% at 92% 62%, ' + (blob[1] || 'transparent') + ', transparent 74%)',
      'repeating-linear-gradient(118deg, ' +
        (night ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.16)') + ' 0 14px, transparent 14px 34px)'
    ]).join(', ');

    var head = el('div', 'chapter__head tl-head', section);
    el('span', 'tl-head__mark', head);
    el('h2', 'chapter__title', head).textContent = era.label;
    if (era.range) el('span', 'chapter__range', head).textContent = era.range;

    var body = el('div', 'tl', section);

    var order = {};
    columns.forEach(function (col, i) { order[col.id] = i; });

    var byYear = {};
    entries.forEach(function (e) { (byYear[e.start_year] = byYear[e.start_year] || []).push(e); });
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });

    if (!years.length) {
      var empty = el('p', 'tl-empty empty-row', body);
      empty.textContent = columns.length
        ? '선택한 카테고리에 이 시대의 사건이 없습니다.'
        : '카테고리를 하나도 선택하지 않았습니다.';
      return section;
    }

    years.forEach(function (year, i) {
      if (i > 0) renderGap(year - years[i - 1], body);

      var list = byYear[year].slice().sort(function (a, b) {
        return (order[a._dataset] - order[b._dataset]) || (a.start_md || '').localeCompare(b.start_md || '');
      });

      var row = el('div', 'tl-year', body);
      row.setAttribute('data-year', String(year));
      row.setAttribute('data-count', String(list.length));

      var mark = el('div', 'tl-mark', row);
      if (year < 0) el('span', 'tl-mark__pre', mark).textContent = '기원전';
      el('span', 'tl-mark__num', mark).textContent = String(Math.abs(year));
      el('span', 'tl-dot', mark);

      var nation = el('div', 'tl-side tl-side--nation', row);
      var theme = el('div', 'tl-side tl-side--theme', row);
      list.forEach(function (entry) {
        renderCard(entry, handlers, entry._track === 'nation' ? nation : theme);
      });
      if (!nation.childNodes.length) nation.classList.add('is-empty');
      if (!theme.childNodes.length) theme.classList.add('is-empty');
    });

    return section;
  }

  global.BigHistoryTimeline = {
    render: renderChapter,
    spanWidth: spanWidth
  };
})(window);
