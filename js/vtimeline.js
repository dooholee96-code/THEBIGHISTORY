/* ------------------------------------------------------------------
   세로 연표 렌더러 (y축 = 연도)

   vis-timeline 은 가로 시간축만 지원하므로, 세로 보기는 같은 데이터와 같은
   조작 방식을 쓰는 별도 컴포넌트로 직접 그립니다.
   js/timeline.js(가로 보기)와 똑같은 API 를 내보내므로 app.js 는 두 보기를
   구분하지 않고 씁니다.

     setStructure · setEntries · windowYears · yearsPerPixel
     focusYears · setLimits · fit · select · redraw · setScrollMode · destroy

   좌표 약속
     · y = (연도 - 화면 시작연도) × 픽셀/년      (위 = 과거, 아래 = 현재)
     · x = 레인(데이터셋) 열. 한 레인 안에서 시기가 겹치는 항목은 옆으로 쌓는다.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var AXIS_W = 74;        // 왼쪽 연도 눈금 폭
  var TRACK_H = 18;       // 위쪽 트랙 띠 높이
  var LANE_H = 28;        // 위쪽 레인 이름 높이
  var HEAD_H = TRACK_H + LANE_H;
  var COL_W = 86;         // 레인 안에서 겹친 항목 한 칸의 폭
  var LANE_MIN_W = 120;
  var LANE_GAP = 8;
  var ITEM_MIN_H = 4;
  var TICK_MIN_PX = 52;   // 눈금 라벨 최소 간격

  var TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000, 50000];

  function div(cls, parent) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  function yearLabel(year) {
    if (year < 0) return '기원전 ' + Math.abs(year) + '년';
    return year + '년';
  }

  function shortYearLabel(year) {
    if (year < 0) return 'BC ' + Math.abs(year);
    if (year === 0) return '0';
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function create(container, options) {
    options = options || {};

    // ------------------------------------------------------------ DOM
    container.classList.add('vt-host');
    var root = div('vt', container);
    var corner = div('vt__corner', root);
    var head = div('vt__head', root);
    var headInner = div('vt__head-inner', head);
    var axis = div('vt__axis', root);
    var axisInner = div('vt__axis-inner', axis);
    var body = div('vt__body', root);
    var grid = div('vt__grid', body);
    var lanesEl = div('vt__lanes', body);

    corner.textContent = '연도';

    var state = {
      tracks: [],
      lanes: [],            // {id, label, color, track, x, width, cols}
      entries: [],
      clusters: [],
      summaryMode: 'auto',        // 'auto' = 확대했을 때만, 'always' = 되도록 항상
      startYear: options.window ? options.window.start_year : -3000,
      endYear: options.window ? options.window.end_year : 2040,
      minYear: -50000,
      maxYear: 2200,
      scrollX: 0,
      totalW: 0,
      selectedId: null,
      scrollMode: 'zoom'
    };

    var pools = { items: [], ticks: [], grid: [], heads: [], tracks: [] };
    var frame = null;
    var destroyed = false;

    // ------------------------------------------------------- 좌표 계산

    function viewHeight() { return Math.max(80, body.clientHeight); }
    function viewWidth() { return Math.max(120, body.clientWidth); }
    function span() { return state.endYear - state.startYear; }
    function pxPerYear() { return viewHeight() / span(); }
    function yearToY(year) { return (year - state.startYear) * pxPerYear(); }
    function yToYear(y) { return state.startYear + y / pxPerYear(); }

    function schedule() {
      if (destroyed || frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        draw();
      });
    }

    /** 창을 데이터 한계 안으로 넣는다. */
    function clampWindow() {
      var length = Math.max(3, span());
      if (state.startYear < state.minYear) {
        state.startYear = state.minYear;
        state.endYear = state.startYear + length;
      }
      if (state.endYear > state.maxYear) {
        state.endYear = state.maxYear;
        state.startYear = state.endYear - length;
      }
      if (state.startYear < state.minYear) state.startYear = state.minYear;
    }

    // --------------------------------------------------- 레인 폭 계산

    /** 한 레인 안에서 시기가 겹치는 항목을 옆 칸으로 밀어낸다. */
    function packLane(list) {
      var columns = [];   // 각 칸의 마지막 끝 y
      var perPx = pxPerYear();
      list.sort(function (a, b) { return a._start - b._start; });

      list.forEach(function (item) {
        var top = (item._start - state.startYear) * perPx;
        var bottom = top + Math.max(ITEM_MIN_H, (item._end - item._start) * perPx);
        var placed = false;
        for (var i = 0; i < columns.length; i += 1) {
          if (columns[i] <= top - 2) {
            columns[i] = bottom;
            item._col = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          columns.push(bottom);
          item._col = columns.length - 1;
        }
      });
      return columns.length;
    }

    /** 화면에 그릴 항목들을 레인별로 모으고 배치까지 끝낸다. */
    function layout() {
      var perPx = pxPerYear();
      var padYears = 40 / perPx;
      var from = state.startYear - padYears;
      var to = state.endYear + padYears;

      var byLane = {};
      state.lanes.forEach(function (lane) { byLane[lane.id] = []; });

      function push(id, laneId, start, end, payload) {
        var bucket = byLane[laneId];
        if (!bucket) return;
        if (end < from || start > to) return;    // 화면 밖은 그리지 않는다
        payload._start = start;
        payload._end = end;
        payload._id = id;
        bucket.push(payload);
      }

      state.entries.forEach(function (entry) {
        push(entry.id, entry._dataset, entry.start_year, entry.end_year, {
          kind: 'entry',
          entry: entry
        });
      });
      state.clusters.forEach(function (cluster) {
        push(cluster.id, cluster.dataset, cluster.startYear, cluster.endYear, {
          kind: 'cluster',
          cluster: cluster
        });
      });

      var x = 0;
      state.lanes.forEach(function (lane) {
        var list = byLane[lane.id];
        var cols = list.length ? packLane(list) : 1;
        lane.items = list;
        lane.cols = cols;
        lane.width = Math.max(LANE_MIN_W, cols * COL_W + LANE_GAP);
        lane.x = x;
        x += lane.width;
      });
      state.totalW = x;
    }

    // ------------------------------------------------------------ 그리기

    function takeNode(pool, index, cls, parent) {
      var node = pool[index];
      if (!node) {
        node = document.createElement('div');
        pool[index] = node;
        parent.appendChild(node);
      }
      node.className = cls;
      node.hidden = false;
      return node;
    }

    function hideRest(pool, from) {
      for (var i = from; i < pool.length; i += 1) pool[i].hidden = true;
    }

    function drawAxis() {
      var perPx = pxPerYear();
      var step = TICK_STEPS[TICK_STEPS.length - 1];
      for (var i = 0; i < TICK_STEPS.length; i += 1) {
        if (TICK_STEPS[i] * perPx >= TICK_MIN_PX) { step = TICK_STEPS[i]; break; }
      }

      var first = Math.ceil(state.startYear / step) * step;
      var n = 0;
      for (var year = first; year <= state.endYear; year += step) {
        var y = yearToY(year);
        var tick = takeNode(pools.ticks, n, 'vt__tick', axisInner);
        tick.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
        tick.textContent = shortYearLabel(year);

        var line = takeNode(pools.grid, n, 'vt__gridline', grid);
        line.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
        n += 1;
        if (n > 400) break;
      }
      hideRest(pools.ticks, n);
      hideRest(pools.grid, n);
    }

    function drawHead() {
      var n = 0;
      var t = 0;
      var trackRuns = [];

      state.lanes.forEach(function (lane) {
        var run = trackRuns[trackRuns.length - 1];
        if (!run || run.track !== lane.track) {
          trackRuns.push({ track: lane.track, label: lane.trackLabel, x: lane.x, width: lane.width });
        } else {
          run.width += lane.width;
        }

        var cell = takeNode(pools.heads, n, 'vt__lane-head', headInner);
        cell.style.transform = 'translateX(' + (lane.x - state.scrollX).toFixed(1) + 'px)';
        cell.style.width = lane.width + 'px';
        cell.textContent = '';

        var dot = document.createElement('span');
        dot.className = 'vt__lane-dot';
        dot.style.backgroundColor = lane.color;
        cell.appendChild(dot);

        var name = document.createElement('span');
        name.className = 'vt__lane-name';
        name.textContent = lane.label;
        cell.appendChild(name);

        if (lane.count != null) {
          var count = document.createElement('span');
          count.className = 'vt__lane-count';
          count.textContent = lane.count;
          cell.appendChild(count);
        }
        n += 1;
      });
      hideRest(pools.heads, n);

      trackRuns.forEach(function (run) {
        var band = takeNode(pools.tracks, t, 'vt__track-band', headInner);
        band.style.transform = 'translateX(' + (run.x - state.scrollX).toFixed(1) + 'px)';
        band.style.width = run.width + 'px';
        band.textContent = run.label || '';
        t += 1;
      });
      hideRest(pools.tracks, t);
    }

    function drawItems() {
      var perPx = pxPerYear();
      var height = viewHeight();
      var n = 0;

      state.lanes.forEach(function (lane) {
        var colW = (lane.width - LANE_GAP) / lane.cols;

        (lane.items || []).forEach(function (item) {
          var top = (item._start - state.startYear) * perPx;
          var boxH = Math.max(ITEM_MIN_H, (item._end - item._start) * perPx);
          if (top > height + 40 || top + boxH < -40) return;

          var left = lane.x - state.scrollX + item._col * colW;
          var isCluster = item.kind === 'cluster';
          var source = isCluster ? item.cluster : item.entry;
          var color = isCluster ? item.cluster.color : item.entry._color;

          var cls = 'vt__item' + (isCluster ? ' is-cluster' : '') +
            (!isCluster && item.entry.status === 'draft' ? ' is-draft' : '') +
            (state.selectedId === item._id ? ' is-selected' : '');

          var node = takeNode(pools.items, n, cls, lanesEl);
          node.style.transform = 'translate(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px)';
          node.style.width = Math.max(18, colW - 6) + 'px';
          node.style.height = boxH.toFixed(1) + 'px';
          // 화면 위로 넘어간 긴 항목은 글자를 아래로 내려 이름이 보이게 한다.
          node.style.paddingTop = (top < 0 ? clamp(-top, 0, boxH - 20) + 2 : 2) + 'px';
          node.style.backgroundColor = hexToRgba(color, isCluster ? 0.10 : 0.16);
          node.style.borderColor = isCluster ? color : hexToRgba(color, 0.45);
          node.style.borderLeftColor = color;
          node.setAttribute('data-id', item._id);

          if (isCluster) {
            node.title = periodLabel(item._start, item._end) + ' · 주요 사건 ' +
              item.cluster.entries.length + '건 — 누르면 세부 연표가 열립니다';
          } else {
            node.title = item.entry.title + ' · ' + periodLabel(item._start, item._end) +
              (item.entry.description ? ' — ' + item.entry.description : '');
          }

          // 같은 항목·같은 표시 단계면 내부 DOM 을 다시 만들지 않는다.
          // 기본은 사건명만, 확대해서 막대가 충분히 길어지면 요약까지 보여준다.
          var summaryAt = state.summaryMode === 'always'
            ? 34
            : Math.max(90, viewHeight() / 6);   // 화면의 1/6 이상 차지할 때만
          var level = boxH >= summaryAt ? 2 : (boxH >= 15 ? 1 : 0);
          var sig = item._id + '|' + level;
          if (node._sig !== sig) {
            node._sig = sig;
            node.textContent = '';
            if (level >= 1) {
              var label = document.createElement('span');
              label.className = 'vt__item-title';
              label.textContent = isCluster ? item.cluster.entries.length + '건' : item.entry.title;
              node.appendChild(label);
            }
            if (level >= 2) {
              var subText = isCluster
                ? periodLabel(item._start, item._end)
                : item.entry._summary;
              if (subText) {
                var sub = document.createElement('span');
                sub.className = 'vt__item-sub';
                sub.textContent = subText;
                node.appendChild(sub);
              }
            }
          }
          n += 1;
        });
      });
      hideRest(pools.items, n);
    }

    function draw() {
      if (destroyed) return;
      clampWindow();
      layout();

      var maxScroll = Math.max(0, state.totalW - viewWidth());
      state.scrollX = clamp(state.scrollX, 0, maxScroll);

      drawAxis();
      drawHead();
      drawItems();
      root.classList.toggle('has-overflow', maxScroll > 0);
    }

    // ------------------------------------------------------------ 조작

    function zoomAt(factor, anchorY) {
      var anchorYear = yToYear(anchorY);
      var newSpan = clamp(span() * factor, 3, 60000);
      var ratio = (anchorYear - state.startYear) / span();
      state.startYear = anchorYear - newSpan * ratio;
      state.endYear = state.startYear + newSpan;
      schedule();
    }

    function panYears(deltaYears) {
      state.startYear += deltaYears;
      state.endYear += deltaYears;
      schedule();
    }

    body.addEventListener('wheel', function (e) {
      var dy = e.deltaY;
      var dx = e.deltaX;
      if (e.deltaMode === 1) { dy *= 16; dx *= 16; }

      // 확대·축소 모드에서는 휠이 곧 확대, 나머지 모드에서는 Ctrl(⌘)+휠이 확대.
      var wantZoom = state.scrollMode === 'zoom' || e.ctrlKey || e.metaKey;

      if (wantZoom) {
        var rect = body.getBoundingClientRect();
        zoomAt(Math.pow(1.0015, dy), e.clientY - rect.top);
      } else if (state.scrollMode === 'horizontal') {
        state.scrollX += (Math.abs(dx) > Math.abs(dy) ? dx : dy);
        schedule();
      } else {
        panYears(dy / viewHeight() * span() * 0.9);
      }
      e.preventDefault();
    }, { passive: false });

    // 드래그 이동 + 두 손가락 핀치 확대
    var pointers = {};
    var dragged = false;
    var pinch = null;

    function pointerList() {
      return Object.keys(pointers).map(function (k) { return pointers[k]; });
    }

    var downItem = null;

    body.addEventListener('pointerdown', function (e) {
      // 포인터 캡처를 걸면 이후 click 이벤트의 target 이 컨테이너로 바뀌므로,
      // 어떤 항목을 눌렀는지는 여기서 미리 기억해 둔다.
      downItem = e.target && e.target.closest ? e.target.closest('.vt__item') : null;
      body.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
      dragged = false;
      if (pointerList().length === 2) {
        var p = pointerList();
        pinch = {
          dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
          span: span(),
          anchorYear: yToYear((p[0].y + p[1].y) / 2 - body.getBoundingClientRect().top),
          anchorRatio: 0.5
        };
      }
    });

    body.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var prevX = p.x, prevY = p.y;
      p.x = e.clientX;
      p.y = e.clientY;

      var list = pointerList();
      if (list.length >= 2 && pinch) {
        var dist = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) || 1;
        var newSpan = clamp(pinch.span * (pinch.dist / dist), 3, 60000);
        var rect = body.getBoundingClientRect();
        var anchorY = (list[0].y + list[1].y) / 2 - rect.top;
        var ratio = anchorY / viewHeight();
        state.startYear = pinch.anchorYear - newSpan * ratio;
        state.endYear = state.startYear + newSpan;
        dragged = true;
        schedule();
        return;
      }

      var dx = e.clientX - prevX;
      var dy = e.clientY - prevY;
      if (Math.abs(e.clientX - p.startX) > 4 || Math.abs(e.clientY - p.startY) > 4) dragged = true;

      state.scrollX -= dx;
      panYears(-dy / pxPerYear());
    });

    function endPointer(e) {
      var wasDragged = dragged;
      delete pointers[e.pointerId];
      if (pointerList().length < 2) pinch = null;

      // 끌지 않고 뗐으면 선택으로 본다. (빈 곳이면 id 가 null → 선택 해제)
      if (e.type === 'pointerup' && !wasDragged && pointerList().length === 0) {
        var id = downItem ? downItem.getAttribute('data-id') : null;
        if (options.onSelect) options.onSelect(id);
        api.select(id);
      }
      downItem = null;
    }
    body.addEventListener('pointerup', endPointer);
    body.addEventListener('pointercancel', endPointer);

    var onResize = function () { schedule(); };
    window.addEventListener('resize', onResize);

    // ------------------------------------------------------------ API

    var api = {
      isVertical: true,

      setStructure: function (tracks, visibleDatasetIds, counts) {
        state.tracks = tracks;
        var lanes = [];
        tracks.forEach(function (track) {
          track.datasets.forEach(function (ds) {
            if (visibleDatasetIds.indexOf(ds.id) === -1) return;
            lanes.push({
              id: ds.id,
              label: ds.label,
              color: ds.color,
              track: track.id,
              trackLabel: track.label,
              count: counts ? counts[ds.id] : null,
              x: 0, width: LANE_MIN_W, cols: 1, items: []
            });
          });
        });
        state.lanes = lanes;
        schedule();
      },

      setEntries: function (entries, clusters, opts) {
        state.entries = entries || [];
        state.clusters = clusters || [];
        state.summaryMode = (opts && opts.summaryMode) || 'auto';
        schedule();
      },

      windowYears: function () {
        return { start: Math.round(state.startYear), end: Math.round(state.endYear) };
      },

      yearsPerPixel: function () {
        return span() / viewHeight();
      },

      focusYears: function (startYear, endYear) {
        state.startYear = startYear;
        state.endYear = Math.max(startYear + 3, endYear);
        schedule();
      },

      setLimits: function (minYear, maxYear) {
        state.minYear = minYear;
        state.maxYear = maxYear;
        schedule();
      },

      fit: function () {
        state.startYear = state.minYear;
        state.endYear = state.maxYear;
        schedule();
      },

      select: function (id) {
        state.selectedId = id || null;
        schedule();
      },

      setScrollMode: function (mode) {
        state.scrollMode = mode || 'zoom';
      },

      redraw: function () { schedule(); },

      destroy: function () {
        destroyed = true;
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener('resize', onResize);
        container.classList.remove('vt-host');
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };

    schedule();
    return api;
  }

  global.BigHistoryVTimeline = {
    create: create,
    yearLabel: yearLabel,
    periodLabel: periodLabel
  };
})(window);
