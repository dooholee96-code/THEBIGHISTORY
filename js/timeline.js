/* ------------------------------------------------------------------
   vis-timeline 래퍼
   연도(정수) ↔ Date 변환, 그룹(레인) 구성, 아이템/클러스터 변환,
   휠 스크롤 모드 전환을 담당합니다.

   연도 표기 약속
     · 기원전은 음수 (예: 기원전 2333년 => -2333), 연도 0 은 쓰지 않습니다.
     · vis-timeline 은 내부적으로 JS Date 를 쓰므로 대략 ±27만 년까지 다룰 수
       있습니다. 문명사 범위는 충분하지만, 우주·지질 규모(수십억 년)를 넣으려면
       그 트랙만 별도의 로그 스케일 컴포넌트로 분리해야 합니다. (README 참고)
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

  /** 연도(정수) → Date. isEnd 면 그 해의 마지막 날. */
  function yearToDate(year, isEnd) {
    var d = new Date(2000, isEnd ? 11 : 0, isEnd ? 31 : 1, isEnd ? 23 : 0, 0, 0, 0);
    d.setFullYear(year); // 0~99년이 1900년대로 해석되는 문제를 피한다.
    return d;
  }

  function dateToYear(date) {
    return date.getFullYear();
  }

  function yearLabel(year) {
    if (year < 0) return '기원전 ' + Math.abs(year) + '년';
    return year + '년';
  }

  /**
   * 시간축 눈금용 짧은 연도 표기.
   * "기원전 3000년"(약 110px)은 좁은 화면에서 눈금 간격보다 넓어 겹칩니다.
   * vis-timeline 의 눈금 간격은 최대 1000년까지만 커질 수 있어서(그 이상을
   * 요구하면 내부적으로 일(day) 단위로 되돌아가 버립니다) 라벨 쪽을 줄입니다.
   */
  function shortYearLabel(year) {
    if (year < 0) return 'BC ' + Math.abs(year);
    if (year === 0) return '0';   // 서기 0년은 존재하지 않으므로 중립 표기
    return 'AD ' + year;
  }

  function periodLabel(start, end) {
    if (start === end) return yearLabel(start);
    return yearLabel(start) + ' ~ ' + yearLabel(end);
  }

  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(120,130,140,' + alpha + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /** vis 의 내장 필터가 class 속성을 지워버리므로, 부가 텍스트는 민무늬 <span> 으로 넣고
      CSS 에서 .vis-item-content span 으로 스타일을 준다. */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** 시간축 라벨을 연도 표기로 바꾼다. */
  var axisFormat = {
    minorLabels: function (date, scale) {
      var d = new Date(date);
      switch (scale) {
        case 'millisecond':
        case 'second':
        case 'minute':
        case 'hour':
          return '';
        case 'weekday':
        case 'day':
          return d.getDate() + '일';
        case 'month':
          return (d.getMonth() + 1) + '월';
        default:
          return shortYearLabel(d.getFullYear());
      }
    },
    majorLabels: function (date, scale) {
      var d = new Date(date);
      switch (scale) {
        case 'millisecond':
        case 'second':
        case 'minute':
        case 'hour':
        case 'weekday':
        case 'day':
          return yearLabel(d.getFullYear()) + ' ' + (d.getMonth() + 1) + '월';
        case 'month':
          return yearLabel(d.getFullYear());
        default:
          return '';
      }
    }
  };

  function groupLabelElement(text, color, count) {
    var wrap = document.createElement('div');
    wrap.className = 'group-label';
    if (color) {
      var dot = document.createElement('span');
      dot.className = 'group-label__dot';
      dot.style.backgroundColor = color;
      wrap.appendChild(dot);
    }
    var name = document.createElement('span');
    name.textContent = text;
    wrap.appendChild(name);
    if (count != null) {
      var badge = document.createElement('span');
      badge.className = 'group-label__count';
      badge.textContent = count;
      wrap.appendChild(badge);
    }
    return wrap;
  }

  /**
   * 막대에는 기본적으로 사건명만 적는다.
   * 확대해서 막대가 충분히 길어졌을 때만 한 줄 요약이 따라 나온다.
   * (opts.summaryMode === 'always' 면 기준을 낮춰 웬만하면 보여준다)
   */
  function wantsSummary(entry, opts) {
    if (!entry._summary || entry.start_year === entry.end_year) return false;
    var widthPx = (entry.end_year - entry.start_year) / (opts.yearsPerPixel || 1);
    var need = opts.summaryMode === 'always'
      ? 150
      : Math.max(300, (opts.viewWidth || 1200) / 4.5);   // 화면의 1/4.5 이상
    return widthPx >= need;
  }

  function entryToItem(entry, opts) {
    var isPoint = entry.start_year === entry.end_year;
    var content = escapeHtml(entry.title);
    if (wantsSummary(entry, opts)) {
      content += ' <span>' + escapeHtml(entry._summary) + '</span>';
    }

    var item = {
      id: entry.id,
      group: entry._dataset,
      content: content,
      start: yearToDate(entry.start_year, false),
      className: 'entry-item' + (entry.status === 'draft' ? ' is-draft' : ''),
      title: entry.title + ' · ' + periodLabel(entry.start_year, entry.end_year) +
        (entry.description ? ' — ' + entry.description : '')
    };
    if (isPoint) {
      item.type = 'point';
      item.style = 'color: ' + entry._color + ';';
    } else {
      item.type = 'range';
      item.end = yearToDate(entry.end_year, true);
      item.style = [
        'background-color: ' + hexToRgba(entry._color, 0.16),
        'border-color: ' + hexToRgba(entry._color, 0.45),
        'border-left-color: ' + entry._color
      ].join('; ') + ';';
    }
    return item;
  }

  /** 같은 시기에 몰린 점(단일 연도) 사건 묶음 → 하나의 아이템 */
  function clusterToItem(cluster) {
    var isSameYear = cluster.startYear === cluster.endYear;
    var content = escapeHtml(cluster.entries.length + '건') +
      ' <span>' + escapeHtml(periodLabel(cluster.startYear, cluster.endYear)) + '</span>';

    var item = {
      id: cluster.id,
      group: cluster.dataset,
      content: content,
      start: yearToDate(cluster.startYear, false),
      className: 'cluster-item',
      title: periodLabel(cluster.startYear, cluster.endYear) + ' · 주요 사건 ' +
        cluster.entries.length + '건 — 누르면 세부 연표가 열립니다'
    };
    if (isSameYear) {
      item.type = 'point';
      item.style = 'color: ' + cluster.color + ';';
    } else {
      item.type = 'range';
      item.end = yearToDate(cluster.endYear, true);
      item.style = [
        'background-color: ' + hexToRgba(cluster.color, 0.10),
        'border-color: ' + cluster.color
      ].join('; ') + ';';
    }
    return item;
  }

  /**
   * 휠 동작 모드별 vis 옵션.
   *
   * verticalScroll 은 어느 모드에서나 켜 둔다. vis 는 이 옵션이 켜져 있을 때만
   * 레인 목록에 세로 스크롤바를 달고 스크롤 이벤트를 연결하기 때문에, 꺼두면
   * 레인이 화면보다 길어졌을 때 아래쪽 레인에 아예 닿을 수 없다.
   *
   *  · zoom       preferZoom 이 켜져 있으면 vis 는 세로 스크롤 분기 전에 빠져나가
   *               휠을 항상 확대·축소로 넘긴다.
   *  · vertical   휠 = 레인 세로 이동, Ctrl(⌘)+휠 = 확대·축소
   *  · horizontal 휠 = 시간축 좌우 이동. vis 의 horizontalScroll 은 세로 델타가
   *               크면 세로 스크롤에 우선권을 주기 때문에, 아래 onWheel 에서
   *               직접 처리한다.
   */
  var SCROLL_MODES = {
    zoom:       { preferZoom: true,  zoomKey: '',        horizontalScroll: false, verticalScroll: true },
    horizontal: { preferZoom: false, zoomKey: 'ctrlKey', horizontalScroll: false, verticalScroll: true },
    vertical:   { preferZoom: false, zoomKey: 'ctrlKey', horizontalScroll: false, verticalScroll: true }
  };

  function create(container, options) {
    options = options || {};

    var itemsDs = new vis.DataSet([]);
    var groupsDs = new vis.DataSet([]);

    // 처음 창 범위를 생성 시점에 못 박아 둔다. 그러지 않으면 vis 가 첫 렌더에서
    // 자동으로 전체 범위에 맞춰버려(prehistory 포함) 문명사 구간이 뭉개진다.
    var initialWindow = options.window || null;

    var timeline = new vis.Timeline(container, itemsDs, groupsDs, {
      start: initialWindow ? yearToDate(initialWindow.start_year, false) : undefined,
      end: initialWindow ? yearToDate(initialWindow.end_year, true) : undefined,
      stack: true,
      stackSubgroups: false,
      orientation: { axis: 'both', item: 'top' },
      align: 'left',
      margin: { item: { horizontal: 2, vertical: 4 }, axis: 6 },
      height: '100%',   // 컨테이너 높이에 맞춰 내부 스크롤이 생기게 한다
      zoomMin: 1000 * 60 * 60 * 24 * 365 * 3,       // 3년
      zoomMax: YEAR_MS * 60000,                     // 6만 년
      selectable: true,
      multiselect: false,
      showCurrentTime: false,
      showTooltips: true,
      tooltip: { followMouse: true, overflowMethod: 'flip' },
      groupOrder: 'order',
      format: axisFormat,
      xss: { disabled: false }
    });

    var scrollMode = 'zoom';

    // 가로 스크롤 모드에서는 휠을 우리가 가로채 시간축을 좌우로 민다.
    // (캡처 단계에서 먼저 처리하고 전파를 끊어 vis 의 세로 스크롤을 막는다)
    container.addEventListener('wheel', function (e) {
      if (scrollMode !== 'horizontal') return;
      if (e.ctrlKey || e.metaKey) return;      // 확대·축소는 vis 에 맡긴다

      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      if (e.deltaMode === 1) delta *= 16;      // 줄 단위 스크롤 보정

      var win = timeline.getWindow();
      var span = win.end.getTime() - win.start.getTime();
      var shift = span * (delta / 900) * 0.35;

      timeline.setWindow(
        new Date(win.start.getTime() + shift),
        new Date(win.end.getTime() + shift),
        { animation: false }
      );
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true, passive: false });

    if (options.onSelect) {
      timeline.on('select', function (props) {
        options.onSelect(props.items && props.items.length ? props.items[0] : null);
      });
    }
    if (options.onRangeChanged) {
      timeline.on('rangechanged', function (props) {
        options.onRangeChanged(dateToYear(props.start), dateToYear(props.end));
      });
    }

    var api = {
      timeline: timeline,

      /** 트랙(부모) + 데이터셋(레인) 구조를 그룹으로 만든다. */
      setStructure: function (tracks, visibleDatasetIds, counts) {
        var groups = [];
        var order = 0;

        tracks.forEach(function (track) {
          var children = track.datasets.filter(function (ds) {
            return visibleDatasetIds.indexOf(ds.id) !== -1;
          });
          if (!children.length) return;

          groups.push({
            id: 'track:' + track.id,
            content: groupLabelElement(track.label, null, null),
            nestedGroups: children.map(function (ds) { return ds.id; }),
            showNested: true,
            order: order++,
            className: 'track-group'
          });

          children.forEach(function (ds) {
            groups.push({
              id: ds.id,
              content: groupLabelElement(ds.label, ds.color, counts ? counts[ds.id] : null),
              order: order++
            });
          });
        });

        groupsDs.clear();
        groupsDs.add(groups);
      },

      /** 개별 항목 + 묶음(클러스터)을 한 번에 올린다. */
      setEntries: function (entries, clusters, opts) {
        opts = Object.assign({}, opts, {
          yearsPerPixel: api.yearsPerPixel(),
          viewWidth: container.clientWidth || 1200
        });
        var items = entries.map(function (entry) {
          return entryToItem(entry, opts);
        });
        (clusters || []).forEach(function (cluster) {
          items.push(clusterToItem(cluster));
        });
        itemsDs.clear();
        itemsDs.add(items);
      },

      /** 현재 화면에 보이는 연도 구간 */
      windowYears: function () {
        var win = timeline.getWindow();
        return { start: dateToYear(win.start), end: dateToYear(win.end) };
      },

      /** 1픽셀이 몇 년에 해당하는지 — 묶음 단위 계산에 쓴다. */
      yearsPerPixel: function () {
        var win = timeline.getWindow();
        var px = container.clientWidth || 1000;
        return (win.end.getTime() - win.start.getTime()) / YEAR_MS / px;
      },

      focusYears: function (startYear, endYear, animate) {
        timeline.setWindow(
          yearToDate(startYear, false),
          yearToDate(endYear, true),
          { animation: animate !== false }
        );
      },

      setLimits: function (minYear, maxYear) {
        timeline.setOptions({
          min: yearToDate(minYear, false),
          max: yearToDate(maxYear, true)
        });
      },

      /**
       * 휠 동작 전환: 'zoom' | 'horizontal' | 'vertical'
       * 가로/세로 모드에서는 Ctrl(⌘)+휠이 확대·축소를 맡습니다.
       * 터치 기기의 핀치 줌은 어느 모드에서나 그대로 동작합니다.
       */
      setScrollMode: function (mode) {
        scrollMode = SCROLL_MODES[mode] ? mode : 'zoom';
        timeline.setOptions(SCROLL_MODES[scrollMode]);
        timeline.redraw();
      },

      fit: function () {
        timeline.fit({ animation: false });
      },

      select: function (id) {
        if (id) timeline.setSelection([id], { focus: false });
        else timeline.setSelection([]);
      },

      redraw: function () {
        timeline.redraw();
      },

      destroy: function () {
        timeline.destroy();
      }
    };

    return api;
  }

  global.BigHistoryTimeline = {
    create: create,
    yearToDate: yearToDate,
    yearLabel: yearLabel,
    shortYearLabel: shortYearLabel,
    periodLabel: periodLabel,
    hexToRgba: hexToRgba
  };
})(window);
