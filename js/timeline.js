/* ------------------------------------------------------------------
   vis-timeline 래퍼
   연도(정수) ↔ Date 변환, 그룹(레인) 구성, 아이템 변환을 담당합니다.

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

  /** 시간축 라벨을 한국어 연도 표기로 바꾼다. */
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

  function entryToItem(entry) {
    var isPoint = entry.start_year === entry.end_year;
    var item = {
      id: entry.id,
      group: entry._dataset,
      content: entry.title,
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

      setEntries: function (entries) {
        itemsDs.clear();
        itemsDs.add(entries.map(entryToItem));
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
