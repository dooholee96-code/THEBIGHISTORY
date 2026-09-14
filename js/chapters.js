/* ------------------------------------------------------------------
   시대 섹션 + 표 렌더러

   연표를 "진짜 표"로 그립니다.
     · 왼쪽 세로축 = 연도 (가로 스크롤해도 붙어 있음)
     · 오른쪽 = 카테고리마다 한 열
     · 행 = 그 시대에서 실제로 사건이 있는 연도만 (빈 연도는 만들지 않음)

   같은 연도·같은 카테고리에 사건이 여럿이면 앞의 2건만 보여주고
   나머지는 '월·일로 보기' / 'N건 모두 보기' 칩으로 접어 팝업에서 봅니다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var MAX_IN_CELL = 2;

  function el(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  function yearLabel(year) {
    return year < 0 ? '기원전 ' + Math.abs(year) : String(year);
  }

  function periodLabel(start, end) {
    if (start === end) return yearLabel(start) + '년';
    return yearLabel(start) + '년 ~ ' + yearLabel(end) + '년';
  }

  /** "07-28" → "7.28" */
  function mdLabel(md) {
    if (!md) return '';
    var parts = md.split('-');
    return Number(parts[0]) + '.' + Number(parts[1]);
  }

  function sortByMd(a, b) {
    var x = a.start_md || '';
    var y = b.start_md || '';
    if (x === y) return a.title.localeCompare(b.title);
    if (!x) return 1;      // 월·일이 없는 항목은 뒤로
    if (!y) return -1;
    return x < y ? -1 : 1;
  }

  /** 한 시대에 속한 사건들을 연도별 행으로 정리한다. */
  function buildRows(entries, columns) {
    var byYear = {};
    entries.forEach(function (entry) {
      (byYear[entry.start_year] = byYear[entry.start_year] || []).push(entry);
    });

    return Object.keys(byYear)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (year) {
        var inYear = byYear[year];
        var lastEnd = inYear.reduce(function (max, e) { return Math.max(max, e.end_year); }, year);
        return {
          year: year,
          until: lastEnd !== year ? lastEnd : null,
          cells: columns.map(function (col) {
            return {
              column: col,
              entries: inYear.filter(function (e) { return e._dataset === col.id; }).sort(sortByMd)
            };
          })
        };
      });
  }

  function renderColumnHead(column, count, parent) {
    var head = el('div', 'col-head', parent);
    var dot = el('span', 'dot', head);
    dot.style.backgroundColor = column.color;
    var name = el('span', 'col-head__name', head);
    name.textContent = column.label;
    name.title = column.label;
    var badge = el('span', 'col-head__count', head);
    badge.textContent = count + '건';
  }

  function renderCell(cell, handlers, parent) {
    var node = el('div', 'cell', parent);
    var list = cell.entries;
    if (!list.length) return;

    var shown = list.length > MAX_IN_CELL ? list.slice(0, MAX_IN_CELL) : list;

    shown.forEach(function (entry) {
      var btn = el('button', 'event', node);
      btn.type = 'button';
      btn.title = entry.title;
      if (entry.start_md) {
        var md = el('span', 'event__md', btn);
        md.textContent = mdLabel(entry.start_md);
      }
      var name = el('span', 'event__name', btn);
      name.textContent = entry.title;
      btn.addEventListener('click', function () { handlers.openEntry(entry); });
    });

    // 접힌 항목이 있거나, 같은 해에 둘 이상이면 월·일 목록을 열 수 있게 한다.
    var label = list.length > MAX_IN_CELL
      ? list.length + '건 모두 보기'
      : (list.length > 1 ? '월·일로 보기' : '');

    if (label) {
      var chip = el('button', 'more-chip', node);
      chip.type = 'button';
      chip.textContent = label;
      chip.addEventListener('click', function () {
        handlers.openDay({
          year: cell.entries[0].start_year,
          column: cell.column,
          entries: list
        });
      });
    }
  }

  function renderRow(row, handlers, parent) {
    var node = el('div', 'row', parent);

    var axis = el('div', 'axis', node);
    var year = el('span', 'axis__year', axis);
    year.textContent = yearLabel(row.year);
    if (row.until != null) {
      var until = el('span', 'axis__until', axis);
      until.textContent = '– ' + yearLabel(row.until);
    }
    el('span', 'axis__dot', axis);

    var cells = el('div', 'cells', node);
    row.cells.forEach(function (cell) { renderCell(cell, handlers, cells); });
  }

  /**
   * 시대 섹션 하나를 그린다.
   * @param era      매니페스트의 시대 정의
   * @param entries  이 시대에 시작하는(필터를 통과한) 항목들
   * @param columns  현재 켜져 있는 카테고리
   */
  function renderChapter(era, entries, columns, handlers, night) {
    var section = el('section', 'chapter');
    section.id = 'era-' + era.id;

    // 삽화 자리 — 좌우 레터박스에서 진해지고 표 뒤에서는 흐려진다.
    var art = el('div', 'chapter__art', section);
    var blob = night ? (era.night_blob || []) : (era.day_blob || []);
    art.style.backgroundImage = [
      'radial-gradient(38% 46% at 8% 34%, ' + (blob[0] || 'transparent') + ', transparent 72%)',
      'radial-gradient(34% 40% at 92% 62%, ' + (blob[1] || 'transparent') + ', transparent 74%)',
      'repeating-linear-gradient(118deg, ' +
        (night ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.16)') + ' 0 14px, transparent 14px 34px)'
    ].join(', ');
    if (era.art) {
      var label = el('span', 'chapter__art-label', art);
      label.textContent = era.art;
    }

    el('span', 'chapter__mark', section);

    var head = el('div', 'chapter__head', section);
    var title = el('h2', 'chapter__title', head);
    title.textContent = era.label;
    if (era.range) {
      var range = el('span', 'chapter__range', head);
      range.textContent = era.range;
    }

    var wrap = el('div', 'table-wrap', section);
    var table = el('div', 'table', wrap);

    // 머리 행
    var headRow = el('div', 'row row--head', table);
    el('div', 'axis', headRow);
    var headCells = el('div', 'cells', headRow);
    columns.forEach(function (col) {
      var count = entries.filter(function (e) { return e._dataset === col.id; }).length;
      renderColumnHead(col, count, headCells);
    });

    var rows = buildRows(entries, columns);
    rows.forEach(function (row) { renderRow(row, handlers, table); });

    if (!rows.length) {
      var emptyRow = el('div', 'row empty-row', table);
      el('div', 'axis', emptyRow);
      var emptyCells = el('div', 'cells', emptyRow);
      emptyCells.textContent = columns.length
        ? '선택한 카테고리에 이 시대의 사건이 없습니다.'
        : '카테고리를 하나도 선택하지 않았습니다.';
    }

    return section;
  }

  global.BigHistoryChapters = {
    render: renderChapter,
    yearLabel: yearLabel,
    periodLabel: periodLabel,
    mdLabel: mdLabel,
    sortByMd: sortByMd
  };
})(window);
