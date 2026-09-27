/* ------------------------------------------------------------------
   앱 조립부 — 탭 전환, 시대 배경, 카테고리/검색, 상세 시트, 월·일 팝업

   연표는 js/motion.js 가 움직이고, 움직일 때마다 onFrame 이 불립니다.
   onFrame 은 미리 재 둔 줄 위치(layout)만 읽어서
     배경색 · 초점 줄 · 계기판 숫자 · 붙는 머리행 · 줄 등장 효과
   를 갱신합니다. 프레임마다 DOM 크기를 다시 재지 않는 것이 핵심입니다.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var C = window.BigHistoryChapters;
  var M = window.BigHistoryMotion;
  var H = window.BigHistoryHud;

  var FOCUS_RATIO = 0.36;   // 보이는 높이 중 초점선 위치(위에서부터)

  var el = {
    app: document.getElementById('app'),
    bgGradient: document.getElementById('bg-gradient'),
    bgBlob: document.getElementById('bg-blob'),
    nightToggle: document.getElementById('night-toggle'),
    viewTimeline: document.getElementById('view-timeline'),
    scroll: document.getElementById('scroll'),
    inner: document.getElementById('scroll-inner'),
    intro: document.getElementById('intro'),
    outro: document.getElementById('outro'),
    focusLine: document.getElementById('focus-line'),
    hud: document.getElementById('hud'),
    chapters: document.getElementById('chapters'),
    tabs: document.getElementById('tabs'),
    loading: document.getElementById('loading'),

    categoryGroups: document.getElementById('category-groups'),
    categoryCount: document.getElementById('category-count'),

    search: document.getElementById('search-input'),
    searchSuggest: document.getElementById('search-suggest'),
    searchCount: document.getElementById('search-count'),
    searchResults: document.getElementById('search-results'),

    sheet: document.getElementById('sheet'),
    sheetScrim: document.getElementById('sheet-scrim'),
    sheetEyebrow: document.getElementById('sheet-eyebrow'),
    sheetTitle: document.getElementById('sheet-title'),
    sheetBody: document.getElementById('sheet-body'),
    sheetClose: document.getElementById('sheet-close'),

    day: document.getElementById('day-dialog'),
    dayScrim: document.getElementById('day-scrim'),
    dayDot: document.getElementById('day-dot'),
    dayCat: document.getElementById('day-cat'),
    dayYear: document.getElementById('day-year'),
    dayRows: document.getElementById('day-rows'),
    dayClose: document.getElementById('day-close')
  };

  var TABS = [
    { id: 'timeline', label: '연표', view: document.getElementById('view-timeline') },
    { id: 'category', label: '카테고리', view: document.getElementById('view-category') },
    { id: 'search', label: '검색', view: document.getElementById('view-search') },
    { id: 'info', label: '정보', view: document.getElementById('view-info') }
  ];

  var SUGGESTIONS = ['증기기관', '청자', '피카소', '전쟁', '인쇄'];

  var state = {
    data: null,
    tab: 'timeline',
    night: false,
    eraIndex: 0,
    off: {},          // 꺼진 카테고리 id
    query: '',
    progress: 0       // 현재 시대 안에서의 스크롤 진행도 (상태가 아니라 값만 보관)
  };

  // 연표에서 잰 위치들. measure() 가 채우고 onFrame() 이 읽기만 한다.
  var layout = {
    dirty: true,
    focus: 200,       // 창 위에서 초점선까지(px)
    cover: 0,         // 계기판·탭바가 가리는 아래쪽 높이
    rows: [],         // { node, top, h, mid, year, count, era }
    reveal: [],       // 등장 효과를 줄 것들(시대 제목 + 줄), top 순
    chapters: [],     // { node, top, bottom, head, headTop, headH, tableBottom, stuck }
    segs: [],         // 스크러버 구간 { a, b, start, width }
    anchorYear: null  // 다시 그린 뒤 초점선에 다시 맞출 해
  };

  var live = { row: -1, year: null, x: 0, introOpacity: '', pointer: 'mouse' };

  var pickNodes = {};
  var tabNodes = {};
  var tabPill = null;
  var scroller = null;
  var hud = null;

  // ------------------------------------------------------------ 유틸

  function debounce(fn, ms) {
    var timer;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function activeColumns() {
    return state.data.datasets.filter(function (ds) { return !state.off[ds.id]; });
  }

  function visibleEntries() {
    return state.data.entries.filter(function (e) { return !state.off[e._dataset]; });
  }

  function eraOf(entry) {
    var eras = state.data.eras;
    for (var i = 0; i < eras.length; i += 1) {
      if (entry.start_year >= eras[i].start_year && entry.start_year < eras[i].end_year) return i;
    }
    return entry.start_year < eras[0].start_year ? 0 : eras.length - 1;
  }

  // --------------------------------------------------------- 배경 칠하기

  /**
   * 시대 i 의 팔레트로 배경을 칠한다.
   * t 는 그 시대 안에서의 진행도(0~1)로, 블롭 위치를 움직이고
   * 0.55 를 넘으면 다음 시대 색으로 서서히 넘긴다.
   */
  function paint(index, t) {
    var eras = state.data.eras;
    var a = eras[index];
    var b = eras[Math.min(eras.length - 1, index + 1)];
    if (!a) return;

    var night = state.night;
    var A = night ? a.night : a.day;
    var B = night ? b.night : b.day;
    var blobA = night ? a.night_blob : a.day_blob;
    var blobB = night ? b.night_blob : b.day_blob;

    var f = clamp((t - 0.55) / 0.35, 0, 1);
    var top = f > 0.5 ? B[0] : A[0];
    var bottom = f > 0.5 ? B[1] : A[1];
    var c1 = (f > 0.5 ? blobB : blobA)[0];
    var c2 = (f > 0.5 ? blobB : blobA)[1];

    var gradient = 'linear-gradient(180deg,' + top + ',' + bottom + ')';
    var blobs = [
      'radial-gradient(60% 42% at 18% ' + (16 + t * 20).toFixed(0) + '%,' + c1 + ',transparent 70%)',
      'radial-gradient(52% 38% at 84% ' + (62 - t * 18).toFixed(0) + '%,' + c2 + ',transparent 72%)',
      'radial-gradient(40% 30% at 52% ' + (88 - t * 30).toFixed(0) + '%,' + c1 + ',transparent 74%)'
    ].join(',');
    // 같은 값을 다시 쓰면 배경 전체를 또 칠하므로 바뀔 때만 쓴다
    if (gradient !== paint.gradient) { paint.gradient = gradient; el.bgGradient.style.backgroundImage = gradient; }
    if (blobs !== paint.blobs) { paint.blobs = blobs; el.bgBlob.style.backgroundImage = blobs; }
  }

  // ------------------------------------------------------ 연표 위치 재기

  function offsetIn(node, ancestor) {
    var top = 0;
    while (node && node !== ancestor) {
      top += node.offsetTop;
      node = node.offsetParent;
    }
    return top;
  }

  function setHeight(node, px) {
    var value = Math.round(px) + 'px';
    if (node.style.height !== value) node.style.height = value;
  }

  /** 줄·시대 위치를 한 번에 재 둔다(창 크기·내용이 바뀔 때만). */
  function measure() {
    if (el.viewTimeline.hidden || !el.scroll.clientHeight || !state.data) {
      layout.dirty = true;
      return;
    }
    layout.dirty = false;

    var viewH = el.scroll.clientHeight;
    var viewRect = el.scroll.getBoundingClientRect();
    layout.cover = Math.max(0, viewRect.bottom - el.hud.getBoundingClientRect().top);
    layout.focus = Math.round(Math.max(110, (viewH - layout.cover) * FOCUS_RATIO));
    el.focusLine.style.top = layout.focus + 'px';

    // 처음엔 첫 시대 제목이 초점선에, 끝에선 마지막 줄이 초점선까지 올라오도록 여백을 둔다
    setHeight(el.intro, Math.max(130, layout.focus - 40));
    setHeight(el.outro, Math.max(180, viewH - layout.focus - 10));

    var inner = el.inner;
    var chapters = [];
    var rows = [];
    var reveal = [];

    Array.prototype.forEach.call(el.chapters.querySelectorAll('.chapter'), function (sec, index) {
      var head = sec.querySelector('.row--head');
      var table = sec.querySelector('.table');
      var top = offsetIn(sec, inner);
      var old = layout.chapters[index];
      chapters.push({
        node: sec,
        top: top,
        bottom: top + sec.offsetHeight,
        head: head,
        headTop: offsetIn(head, inner),
        headH: head.offsetHeight,
        tableBottom: offsetIn(table, inner) + table.offsetHeight,
        stuck: old && old.head === head ? old.stuck : 0
      });

      var title = sec.querySelector('.chapter__head');
      reveal.push({ node: title, top: offsetIn(title, inner), h: title.offsetHeight });

      Array.prototype.forEach.call(sec.querySelectorAll('.row--body, .empty-row'), function (node) {
        var item = { node: node, top: offsetIn(node, inner), h: node.offsetHeight };
        reveal.push(item);
        if (!node.hasAttribute('data-year')) return;
        item.mid = item.top + item.h / 2;
        item.year = Number(node.getAttribute('data-year'));
        item.count = Number(node.getAttribute('data-count'));
        item.era = index;
        rows.push(item);
      });
    });

    reveal.forEach(function (item) { item.shown = item.node.classList.contains('is-in'); });
    reveal.sort(function (a, b) { return a.top - b.top; });

    layout.chapters = chapters;
    layout.rows = rows;
    layout.reveal = reveal;
    if (live.row >= rows.length) live.row = -1;

    scroller.refresh();
    buildScrubber();

    if (layout.anchorYear != null) {
      var year = layout.anchorYear;
      layout.anchorYear = null;
      var target = null;
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].year >= year) { target = rows[i]; break; }
      }
      if (target) scroller.scrollTo(target.mid - layout.focus, { instant: true });
    }
    onFrame(scroller.info());
  }

  // ---------------------------------------------------- 스크러버 좌표

  /**
   * 스크러버의 0~1 은 '초점선이 가리키는 연표 좌표'와 구간별로 대응한다.
   * 시대마다 한 구간이고 너비는 그 시대의 줄 양에 비례하되, 너무 좁아지지 않게 최소폭을 둔다.
   */
  function buildScrubber() {
    var ch = layout.chapters;
    var info = scroller.info();
    var dMin = layout.focus;
    var dMax = info.maxY + layout.focus;
    var segs = ch.map(function (c, i) {
      var a = i === 0 ? dMin : clamp(c.top, dMin, dMax);
      var b = i === ch.length - 1 ? dMax : clamp(ch[i + 1].top, dMin, dMax);
      return { a: a, b: Math.max(a, b), len: Math.max(0, b - a) };
    });
    var total = segs.reduce(function (n, g) { return n + g.len; }, 0) || 1;
    var MIN = 0.075;
    var sum = 0;
    segs.forEach(function (g) { g.width = Math.max(MIN, g.len / total); sum += g.width; });
    var start = 0;
    segs.forEach(function (g) {
      g.width /= sum;
      g.start = start;
      start += g.width;
    });
    layout.segs = segs;

    var eras = state.data.eras;
    hud.build(segs.map(function (g, i) {
      var era = eras[i];
      // 계기판은 늘 밝은 유리 위라서 낮 팔레트를 쓴다
      return { start: g.start, width: g.width, label: era.label, color: (era.day_blob && era.day_blob[0]) || '#ddd' };
    }), layout.rows.map(function (row) { return ratioOf(row.mid); }));
  }

  function ratioOf(fy) {
    var segs = layout.segs;
    for (var i = 0; i < segs.length; i += 1) {
      var g = segs[i];
      if (fy < g.b || i === segs.length - 1) {
        return clamp(g.start + clamp((fy - g.a) / Math.max(1, g.b - g.a), 0, 1) * g.width, 0, 1);
      }
    }
    return 0;
  }

  function focusOf(ratio) {
    var segs = layout.segs;
    for (var i = 0; i < segs.length; i += 1) {
      var g = segs[i];
      if (ratio < g.start + g.width || i === segs.length - 1) {
        return g.a + clamp((ratio - g.start) / Math.max(1e-6, g.width), 0, 1) * (g.b - g.a);
      }
    }
    return layout.focus;
  }

  // ----------------------------------------------------- 프레임마다

  /** 초점선(fy)에 가장 가까운 줄 */
  function nearestRow(fy) {
    var rows = layout.rows;
    if (!rows.length) return -1;
    var lo = 0;
    var hi = rows.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (rows[mid].mid <= fy) lo = mid; else hi = mid - 1;
    }
    var next = Math.min(rows.length - 1, lo + 1);
    return Math.abs(rows[next].mid - fy) < Math.abs(rows[lo].mid - fy) ? next : lo;
  }

  function buzz() {
    if (live.pointer === 'touch' && navigator.vibrate) {
      try { navigator.vibrate(8); } catch (err) { /* 무시 */ }
    }
  }

  function onFrame(info) {
    var chapters = layout.chapters;
    if (!chapters.length || layout.dirty) return;
    var fy = info.y + layout.focus;

    // 1) 배경 — 초점선이 있는 시대의 색
    var index = 0;
    for (var i = 0; i < chapters.length; i += 1) if (chapters[i].top <= fy) index = i;
    var ch = chapters[index];
    var t = clamp((fy - ch.top) / Math.max(1, ch.bottom - ch.top), 0, 1);
    state.progress = t;
    paint(index, t);
    if (index !== state.eraIndex) {
      state.eraIndex = index;
      if (info.dragging || hud.grabbing) buzz();
    }

    // 2) 초점 줄 + 계기판
    var r = nearestRow(fy);
    if (r !== live.row) {
      if (live.row >= 0 && layout.rows[live.row]) layout.rows[live.row].node.classList.remove('is-focus');
      if (r >= 0) layout.rows[r].node.classList.add('is-focus');
      live.row = r;
    }
    var row = layout.rows[r];
    var eraIndex = row ? row.era : index;
    live.year = row ? row.year : state.data.eras[index].start_year;
    hud.setYear(live.year);
    hud.setMeta(state.data.eras[eraIndex].label, row ? row.count : 0);
    hud.setRatio(ratioOf(fy));
    hud.setX(info.x, info.maxX, info.viewW, Math.abs(info.x - live.x) > 0.5);
    live.x = info.x;

    // 3) 시대 머리행이 창 위에 붙어 따라온다
    for (var c = 0; c < chapters.length; c += 1) {
      var cc = chapters[c];
      var room = Math.max(0, cc.tableBottom - cc.headTop - cc.headH);
      var off = Math.round(clamp(info.y - cc.headTop, 0, room) * 2) / 2;
      if (off !== cc.stuck) {
        cc.stuck = off;
        cc.head.style.transform = off ? 'translate3d(0,' + off + 'px,0)' : '';
        cc.head.classList.toggle('is-stuck', off > 0);
      }
    }

    // 4) 창 안으로 들어오는 줄은 톡 튀어나오듯 등장
    var items = layout.reveal;
    var top = info.y - 40;
    var bottom = info.y + info.viewH + 10;
    var lo = 0;
    var hi = items.length;
    while (lo < hi) {
      var m = (lo + hi) >> 1;
      if (items[m].top + items[m].h < top) lo = m + 1; else hi = m;
    }
    var k = 0;
    for (var j = lo; j < items.length && items[j].top <= bottom; j += 1) {
      var item = items[j];
      if (item.shown) continue;
      item.shown = true;
      item.node.style.setProperty('--d', Math.min(k, 12) * 34 + 'ms');
      item.node.classList.add('is-in');
      k += 1;
    }

    // 5) 첫 화면 안내는 내려갈수록 옅어진다
    var fade = clamp(1 - info.y / Math.max(1, layout.focus * 0.7), 0, 1).toFixed(2);
    if (fade !== live.introOpacity) {
      live.introOpacity = fade;
      el.intro.style.opacity = fade;
    }
  }

  // ------------------------------------------------------- 시대 이동

  /** 시대로 건너뛸 때 초점선에 올 자리 — 그 시대의 첫 줄(없으면 제목) */
  function eraAnchor(i) {
    var ch = layout.chapters[i];
    if (!ch) return layout.focus;
    for (var r = 0; r < layout.rows.length; r += 1) {
      if (layout.rows[r].era === i) return layout.rows[r].mid;
    }
    return ch.top + 44;
  }

  function jumpEra(i) {
    if (!layout.chapters.length) return;
    scroller.scrollTo(eraAnchor(clamp(i, 0, layout.chapters.length - 1)) - layout.focus);
  }

  function stepEra(dir) {
    var n = layout.chapters.length;
    if (!n) return;
    var fy = scroller.y + layout.focus;
    var index = 0;
    for (var i = 0; i < n; i += 1) if (layout.chapters[i].top <= fy) index = i;
    var target = index + dir;
    // 시대 한가운데서 '이전'을 누르면 먼저 그 시대의 처음으로 간다
    if (dir < 0 && fy - eraAnchor(index) > 60) target = index;
    if (target < 0 || target >= n) {
      bumpHud(dir);
      return;
    }
    jumpEra(target);
  }

  /** 더 갈 곳이 없을 때 계기판이 살짝 튕긴다. */
  function bumpHud(dir) {
    if (M.reduced || !el.hud.animate) return;
    el.hud.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(' + (dir * 9) + 'px)' },
      { transform: 'translateX(' + (-dir * 4) + 'px)' },
      { transform: 'translateX(0)' }
    ], { duration: 360, easing: 'ease-out' });
  }

  function onScrub(ratio, phase, type) {
    live.pointer = type || live.pointer;
    var y = focusOf(ratio) - layout.focus;
    if (phase === 'tap') scroller.scrollTo(y);
    else scroller.follow(y, 15);
  }

  // ------------------------------------------------------------ 화면

  function setTab(id) {
    state.tab = id;
    TABS.forEach(function (tab) {
      var on = tab.id === id;
      tab.view.hidden = !on;
      if (tabNodes[tab.id]) {
        tabNodes[tab.id].classList.toggle('is-active', on);
        tabNodes[tab.id].setAttribute('aria-selected', String(on));
      }
    });
    placeTabPill();
    if (id === 'timeline') measure();
    if (id === 'search') el.search.focus();
  }

  /** 탭 아래 알약이 통통 튀며 따라간다. */
  function placeTabPill() {
    var node = tabNodes[state.tab];
    if (!node || !tabPill || !node.offsetWidth) return;
    tabPill.style.width = node.offsetWidth + 'px';
    tabPill.style.transform = 'translate3d(' + node.offsetLeft + 'px,0,0)';
  }

  function buildTabs() {
    TABS.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-tab', tab.id);
      var icon = document.createElement('span');
      icon.className = 'tab__icon';
      btn.appendChild(icon);
      var label = document.createElement('span');
      label.textContent = tab.label;
      btn.appendChild(label);
      btn.addEventListener('click', function () { setTab(tab.id); });
      tabNodes[tab.id] = btn;
      el.tabs.appendChild(btn);
    });
    tabPill = document.createElement('span');
    tabPill.className = 'tabbar__pill';
    tabPill.setAttribute('aria-hidden', 'true');
    el.tabs.insertBefore(tabPill, el.tabs.firstChild);
  }

  /**
   * 연표(시대 섹션 + 표)를 다시 그린다.
   * 시대마다 표가 따로 있어도 가로 위치는 motion.js 가 모든 표에 똑같이 맞춘다.
   */
  function renderTimeline() {
    // 다시 그린 뒤에도 보던 해가 초점선에 오도록 기억해 둔다
    if (live.year != null && layout.anchorYear == null && scroller.y > 1) layout.anchorYear = live.year;

    var columns = activeColumns();
    var entries = visibleEntries();
    var handlers = { openEntry: openSheet, openDay: openDay };

    var frag = document.createDocumentFragment();
    state.data.eras.forEach(function (era) {
      var inEra = entries.filter(function (e) {
        return e.start_year >= era.start_year && e.start_year < era.end_year;
      });
      // 빈 연도로 행을 만들지 않는 것과 같은 이유로, 이 시대에 사건이 하나도 없는
      // 카테고리는 열도 세우지 않는다. (좁은 화면에서 빈 열부터 보이는 것을 막는다)
      var eraColumns = columns.filter(function (col) {
        return inEra.some(function (e) { return e._dataset === col.id; });
      });
      frag.appendChild(C.render(era, inEra, eraColumns, handlers, state.night));
    });

    el.chapters.textContent = '';
    el.chapters.appendChild(frag);
    layout.chapters = [];
    layout.rows = [];
    layout.reveal = [];
    live.row = -1;
    measure();
  }

  // -------------------------------------------------------- 카테고리 탭

  function buildCategories() {
    el.categoryGroups.textContent = '';
    pickNodes = {};

    state.data.tracks.forEach(function (track) {
      var group = document.createElement('div');
      group.className = 'pick-track';

      var label = document.createElement('p');
      label.className = 'pick-track__label';
      label.textContent = track.label;
      group.appendChild(label);

      var grid = document.createElement('div');
      grid.className = 'pick-grid';

      track.datasets.forEach(function (ds) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pick';
        btn.setAttribute('aria-pressed', 'true');

        var dot = document.createElement('span');
        dot.className = 'pick__dot';
        dot.style.backgroundColor = ds.color;
        btn.appendChild(dot);

        var name = document.createElement('span');
        name.className = 'pick__name';
        name.textContent = ds.label;
        btn.appendChild(name);

        var count = document.createElement('span');
        count.className = 'pick__count';
        count.textContent = ds.entries.length + '건';
        btn.appendChild(count);

        btn.addEventListener('click', function () {
          state.off[ds.id] = !state.off[ds.id];
          syncCategories();
          renderTimeline();
        });

        pickNodes[ds.id] = btn;
        grid.appendChild(btn);
      });

      group.appendChild(grid);
      el.categoryGroups.appendChild(group);
    });
  }

  function syncCategories() {
    var total = state.data.datasets.length;
    var on = 0;
    state.data.datasets.forEach(function (ds) {
      var active = !state.off[ds.id];
      if (active) on += 1;
      var node = pickNodes[ds.id];
      if (node) {
        node.classList.toggle('is-on', active);
        node.setAttribute('aria-pressed', String(active));
      }
    });
    el.categoryCount.textContent = on + '/' + total + '개 표시 중';
  }

  function setAllCategories(value) {
    state.data.datasets.forEach(function (ds) { state.off[ds.id] = value; });
    syncCategories();
    renderTimeline();
  }

  // ------------------------------------------------------------ 검색 탭

  function buildSuggestions() {
    SUGGESTIONS.forEach(function (word) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = word;
      btn.addEventListener('click', function () {
        el.search.value = word;
        state.query = word;
        renderSearch();
      });
      el.searchSuggest.appendChild(btn);
    });
  }

  function renderSearch() {
    var query = state.query.trim().toLowerCase();
    var pool = state.data.entries;
    var results = query
      ? pool.filter(function (e) { return e._search.indexOf(query) !== -1; })
      : pool.slice(0, 6);

    el.searchCount.textContent = query
      ? '검색 결과 ' + results.length + '건' + (results.length > 20 ? ' (20건까지 표시)' : '')
      : '먼저 둘러보기';

    var frag = document.createDocumentFragment();
    results.slice(0, 20).forEach(function (entry) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'result';

      var meta = document.createElement('div');
      meta.className = 'result__meta';
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = entry._color;
      meta.appendChild(dot);
      var years = document.createElement('span');
      years.className = 'result__years';
      years.textContent = C.yearLabel(entry.start_year) +
        (entry.end_year !== entry.start_year ? ' – ' + C.yearLabel(entry.end_year) : '');
      meta.appendChild(years);
      var cat = document.createElement('span');
      cat.className = 'result__cat';
      cat.textContent = entry._label;
      meta.appendChild(cat);
      card.appendChild(meta);

      var title = document.createElement('h3');
      title.className = 'result__title';
      title.textContent = entry.title;
      card.appendChild(title);

      var summary = document.createElement('p');
      summary.className = 'result__summary';
      summary.textContent = entry._summary;
      card.appendChild(summary);

      card.addEventListener('click', function () { openSheet(entry); });
      frag.appendChild(card);
    });

    el.searchResults.textContent = '';
    el.searchResults.appendChild(frag);
  }

  // -------------------------------------------------------- 상세 시트

  function openSheet(entry) {
    closeDay();
    el.sheetEyebrow.textContent = entry._label + ' · ' + entry.region;
    el.sheetTitle.textContent = entry.title;

    var body = el.sheetBody;
    body.textContent = '';

    var era = document.createElement('p');
    era.className = 'sheet__era';
    era.textContent = entry.era_note || C.periodLabel(entry.start_year, entry.end_year);
    body.appendChild(era);

    var length = entry.end_year - entry.start_year;
    var period = C.periodLabel(entry.start_year, entry.end_year);
    var spanParts = [];
    if (era.textContent !== period) spanParts.push(period);
    if (length > 0) spanParts.push('약 ' + length + '년간');
    if (spanParts.length) {
      var span = document.createElement('p');
      span.className = 'sheet__span';
      span.textContent = spanParts.join(' · ');
      body.appendChild(span);
    }

    if (entry.art) {
      var art = document.createElement('div');
      art.className = 'sheet__art';
      art.textContent = entry.art;
      body.appendChild(art);
    }

    var desc = document.createElement('p');
    desc.className = 'sheet__desc';
    desc.textContent = entry.description;
    body.appendChild(desc);

    if (entry.dating_note) {
      var dating = document.createElement('p');
      dating.className = 'note note--dating';
      var strong = document.createElement('strong');
      strong.textContent = '연대 주석';
      dating.appendChild(strong);
      dating.appendChild(document.createTextNode(' — ' + entry.dating_note));
      body.appendChild(dating);
    }

    var source = document.createElement('p');
    if (entry.sources && entry.sources.length) {
      source.className = 'note note--dating';
      source.textContent = '확인한 자료 — ' + entry.sources.join(' · ');
    } else {
      source.className = 'note note--source';
      source.textContent = '출처 미확인 — 검토 전 초안입니다.';
    }
    body.appendChild(source);

    if (entry.tags && entry.tags.length) {
      var tags = document.createElement('div');
      tags.className = 'tags';
      entry.tags.forEach(function (tag) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag';
        chip.textContent = '#' + tag;
        chip.addEventListener('click', function () {
          closeSheet();
          el.search.value = tag;
          state.query = tag;
          renderSearch();
          setTab('search');
        });
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    body.scrollTop = 0;
    el.sheet.style.transform = '';
    el.sheet.style.transition = '';
    reveal(el.sheet);
    reveal(el.sheetScrim);
  }

  function closeSheet(flung) {
    conceal(el.sheet, flung ? 'is-flung' : 'is-leaving', flung ? 260 : 230);
    conceal(el.sheetScrim, 'is-leaving', 230);
  }

  // ------------------------------------------------- 나타나기 · 사라지기

  // 닫힐 때도 짧은 퇴장 동작을 보여 준 뒤 hidden 으로 바꾼다.
  function reveal(node) {
    clearTimeout(node._leave);
    node.classList.remove('is-leaving', 'is-flung');
    node.hidden = false;
  }

  function conceal(node, cls, ms) {
    if (node.hidden || node.classList.contains('is-leaving') || node.classList.contains('is-flung')) return;
    if (M.reduced) { node.hidden = true; return; }
    node.classList.add(cls);
    clearTimeout(node._leave);
    node._leave = setTimeout(function () {
      node.hidden = true;
      node.classList.remove('is-leaving', 'is-flung');
      node.style.transform = '';
      node.style.transition = '';
    }, ms);
  }

  function isOpen(node) {
    return !node.hidden && !node.classList.contains('is-leaving') && !node.classList.contains('is-flung');
  }

  /** 시트를 손잡이로 끌어내려 닫는다. 조금만 끌면 스프링처럼 제자리로. */
  function bindSheetDrag() {
    var g = null;

    function down(e) {
      if (e.target.closest('button')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      g = { id: e.pointerId, y0: e.clientY, dy: 0, active: false, samples: [] };
    }

    function move(e) {
      if (!g || e.pointerId !== g.id) return;
      var dy = e.clientY - g.y0;
      if (!g.active) {
        if (Math.abs(dy) < 5) return;
        g.active = true;
        g.y0 = e.clientY;
        dy = 0;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        el.sheet.classList.add('is-dragging');
        el.sheet.style.transition = 'none';
      }
      g.dy = dy > 0 ? dy : M.rubber(dy, 140);
      el.sheet.style.transform = 'translate3d(0,' + g.dy.toFixed(1) + 'px,0)';
      g.samples.push({ t: e.timeStamp, y: e.clientY });
      while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();
    }

    function up(e) {
      if (!g || e.pointerId !== g.id) return;
      var d = g;
      g = null;
      if (!d.active) return;
      el.sheet.classList.remove('is-dragging');
      var s0 = d.samples[0];
      var s1 = d.samples[d.samples.length - 1];
      var v = s0 && s1 && s1.t > s0.t ? (s1.y - s0.y) / (s1.t - s0.t) * 1000 : 0;
      if (d.dy > 110 || (v > 650 && d.dy > 20)) {
        el.sheet.style.transition = 'transform .26s cubic-bezier(.4,0,1,1)';
        el.sheet.style.transform = 'translate3d(0,110%,0)';
        closeSheet(true);
      } else {
        el.sheet.style.transition = 'transform .5s cubic-bezier(.34,1.56,.64,1)';
        el.sheet.style.transform = '';
      }
    }

    [el.sheet.querySelector('.sheet__grab'), el.sheet.querySelector('.sheet__head')].forEach(function (zone) {
      zone.addEventListener('pointerdown', down);
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
    });
  }

  // ------------------------------------------------------- 월·일 팝업

  function openDay(group) {
    closeSheet();
    el.dayDot.style.backgroundColor = group.column.color;
    el.dayCat.textContent = group.column.label;
    el.dayYear.textContent = C.yearLabel(group.year) + '년';

    var rows = document.createDocumentFragment();
    group.entries.slice().sort(C.sortByMd).forEach(function (entry) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'dayrow';

      var md = document.createElement('span');
      md.className = 'dayrow__md';
      md.textContent = entry.start_md ? C.mdLabel(entry.start_md) + '.' : '연중';
      row.appendChild(md);

      var text = document.createElement('span');
      text.className = 'dayrow__text';
      var title = document.createElement('span');
      title.className = 'dayrow__title';
      title.textContent = entry.title;
      text.appendChild(title);
      var summary = document.createElement('span');
      summary.className = 'dayrow__summary';
      summary.textContent = entry._summary;
      text.appendChild(summary);
      row.appendChild(text);

      row.addEventListener('click', function () {
        closeDay();
        openSheet(entry);
      });
      rows.appendChild(row);
    });

    el.dayRows.textContent = '';
    el.dayRows.appendChild(rows);
    el.dayRows.scrollTop = 0;
    reveal(el.day);
    reveal(el.dayScrim);
  }

  function closeDay() {
    conceal(el.day, 'is-leaving', 200);
    conceal(el.dayScrim, 'is-leaving', 200);
  }

  // ------------------------------------------------------------ 낮/야경

  function setNight(night) {
    state.night = night;
    el.app.classList.toggle('is-night', night);
    el.nightToggle.textContent = night ? '☾ 야경' : '☀ 낮';
    el.nightToggle.setAttribute('aria-pressed', String(night));
    paint.gradient = paint.blobs = null;
    renderTimeline();
    paint(state.eraIndex, state.progress);
  }

  // ------------------------------------------------------------ 이벤트

  function bindEvents() {
    el.nightToggle.addEventListener('click', function () { setNight(!state.night); });

    document.querySelectorAll('[data-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAllCategories(btn.getAttribute('data-pick') === 'none');
      });
    });

    el.search.addEventListener('input', debounce(function () {
      state.query = el.search.value;
      renderSearch();
    }, 120));

    el.sheetClose.addEventListener('click', function () { closeSheet(); });
    el.sheetScrim.addEventListener('click', function () { closeSheet(); });
    el.dayClose.addEventListener('click', closeDay);
    el.dayScrim.addEventListener('click', closeDay);
    bindSheetDrag();

    document.addEventListener('keydown', onKey);

    var remeasure = debounce(function () {
      if (live.year != null && scroller.y > 1 && !scroller.info().dragging) layout.anchorYear = live.year;
      measure();
      placeTabPill();
      hud.measure();
    }, 120);
    window.addEventListener('resize', remeasure);
    if (window.ResizeObserver) {
      // 글꼴이 늦게 도착해 줄 높이가 바뀌는 경우까지 잡는다
      new ResizeObserver(function () { if (!layout.dirty) remeasure(); }).observe(el.chapters);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  }

  /** 키보드: ↑↓ 조금, PageUp/Down·Space 한 화면, ←→ 옆 열, 1~6 시대, / 검색 */
  function onKey(e) {
    if (e.key === 'Escape') {
      if (isOpen(el.day)) closeDay();
      else if (isOpen(el.sheet)) closeSheet();
      return;
    }
    var target = e.target || {};
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '');
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === '/') {
      e.preventDefault();
      setTab('search');
      return;
    }
    if (state.tab !== 'timeline' || isOpen(el.day) || isOpen(el.sheet)) return;
    if ((e.key === ' ' || e.key === 'Enter') && target.tagName === 'BUTTON') return;

    var page = Math.max(120, (el.scroll.clientHeight - layout.cover) * 0.8);
    switch (e.key) {
      case 'ArrowDown': scroller.nudge(96, 0); break;
      case 'ArrowUp': scroller.nudge(-96, 0); break;
      case 'ArrowRight': scroller.nudge(0, 230); break;
      case 'ArrowLeft': scroller.nudge(0, -230); break;
      case 'PageDown': scroller.scrollTo(scroller.y + page); break;
      case 'PageUp': scroller.scrollTo(scroller.y - page); break;
      case ' ': scroller.scrollTo(scroller.y + (e.shiftKey ? -page : page)); break;
      case 'Home': scroller.scrollTo(0); break;
      case 'End': scroller.scrollTo(Infinity); break;
      default:
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= layout.chapters.length) jumpEra(Number(e.key) - 1);
        else return;
    }
    e.preventDefault();
  }

  // ------------------------------------------------------------ 시작

  function start(data) {
    state.data = data;

    scroller = M.create(el.scroll, el.inner, {
      wraps: '.table-wrap',
      onFrame: onFrame,
      onDrag: function (phase, type) { if (type) live.pointer = type; },
      bottomInset: function () { return layout.cover; }
    });
    hud = H.create(el.hud, { scrub: onScrub, step: stepEra });

    buildTabs();
    buildCategories();
    buildSuggestions();
    bindEvents();

    syncCategories();
    renderTimeline();
    renderSearch();
    setTab('timeline');
    paint(0, 0);
    requestAnimationFrame(function () { el.tabs.classList.add('is-ready'); });

    el.loading.hidden = true;
    console.info('[app] 빅 히스토리 연표 · 항목 ' + data.entries.length + '개 · 시대 ' + data.eras.length + '구간');
  }

  function showError(err) {
    el.loading.hidden = true;
    el.chapters.textContent = '';
    var box = document.createElement('div');
    box.className = 'card';
    var title = document.createElement('p');
    title.className = 'card__label';
    title.textContent = '데이터를 불러오지 못했습니다';
    var message = document.createElement('p');
    message.className = 'card__text';
    message.textContent = String(err && err.message ? err.message : err);
    var hint = document.createElement('p');
    hint.className = 'card__text';
    hint.textContent = 'index.html 을 파일로 바로 열었다면 npm run build 로 data/bundle.js 를 만들거나, ' +
      'npx serve 로 로컬 서버를 띄워 주세요.';
    box.appendChild(title);
    box.appendChild(message);
    box.appendChild(hint);
    el.chapters.appendChild(box);
  }

  window.BigHistoryData.load().then(start).catch(function (err) {
    console.error(err);
    showError(err);
  });

  // 오프라인 캐시(PWA)
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) { reg.update(); })
        .catch(function (err) { console.info('[pwa] 서비스워커 등록을 건너뜁니다.', err && err.message); });
    });
  }
})();
