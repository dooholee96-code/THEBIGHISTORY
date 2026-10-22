/* ------------------------------------------------------------------
   앱 조립부 — 탭 전환, 시대 배경, 탐험 그림판, 카테고리/검색, 상세 팝업

   연표는 탐험 그림판(js/zoom.js) 하나다. 그림판의 카메라가 움직일 때마다
   onZoomCamera 가 불려
     배경색 · 계기판 숫자와 띠 · '지금 이때' · 뒤 무대의 디오라마
   를 갱신한다.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var C = window.BigHistoryCommon;
  var H = window.BigHistoryHud;
  var B = window.BigHistoryBranch;
  var Z = window.BigHistoryZoom;
  var Q = window.BigHistoryQuiz;
  var T = window.BigHistoryTour;

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var FOCUS_RATIO = 0.36;   // 보이는 높이 중 초점선 위치(위에서부터)
  var SCENE_FADE = 280;     // 장면 그림이 바뀔 때 교차 페이드 길이(화면 px)
  var SCENE_DRIFT = 70;     // 한 장면을 지나는 동안 그림이 위로 흐르는 양(px)

  var el = {
    app: document.getElementById('app'),
    bgGradient: document.getElementById('bg-gradient'),
    bgBlob: document.getElementById('bg-blob'),
    themeSeg: document.getElementById('theme-seg'),
    toast: document.getElementById('toast'),
    viewTimeline: document.getElementById('view-timeline'),
    stage: document.getElementById('stage'),
    zoom: document.getElementById('zoom'),
    focusLine: document.getElementById('focus-line'),
    hud: document.getElementById('hud'),
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
    focusLive: document.getElementById('focus-live')
  };

  var TABS = [
    { id: 'timeline', label: '연표', view: document.getElementById('view-timeline') },
    { id: 'quiz', label: '퀴즈', view: document.getElementById('view-quiz') },
    { id: 'branch', label: '갈림길', view: document.getElementById('view-branch') },
    { id: 'category', label: '카테고리', view: document.getElementById('view-category') },
    { id: 'search', label: '검색', view: document.getElementById('view-search') },
    { id: 'info', label: '설정', view: document.getElementById('view-info') }
  ];

  // 탭 아이콘 — 발자국(연표) · 카드(퀴즈) · 갈래길(갈림길) · 당근(카테고리) · 돋보기(검색) · 톱니(설정)
  var TAB_ICONS = {
    timeline: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="16" rx="5.5" ry="4.5" fill="currentColor"/><circle cx="5" cy="9" r="2.6" fill="currentColor"/><circle cx="12" cy="6" r="2.6" fill="currentColor"/><circle cx="19" cy="9" r="2.6" fill="currentColor"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="11" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-8 9 12.5)"/><rect x="10" y="4" width="11" height="15" rx="2.5" fill="currentColor" opacity=".85" transform="rotate(8 15.5 11.5)"/></svg>',
    branch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22v-8M12 14C12 9 6 8 6 3M12 14c0-5 6-6 6-11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3.5 5.5L6 3l2.5 2.5M15.5 5.5L18 3l2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    category: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8c2-1.5 6-1.5 8 0l-6.5 13z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 7c-1-3 1-5 3-5M13 7c1-3 4-4 6-3M13 7c-3-2-6-1-7 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  var SUGGESTIONS = ['증기기관', '청자', '피카소', '전쟁', '인쇄'];

  var state = {
    data: null,
    tab: 'timeline',
    night: false,      // 다크 팔레트인지. 테마 설정(system/light/dark)에서 정해진다
    theme: 'light',
    eraIndex: 0,
    off: {},          // 꺼진 카테고리 id
    query: '',
    progress: 0       // 현재 시대 안에서의 진행도
  };

  var layout = {
    focus: 200,       // 그림판 위에서 초점선까지(px)
    cover: 0          // 계기판·탭바가 가리는 아래쪽 높이
  };

  var live = { year: null, ringX: null };

  var pickNodes = {};
  var tabNodes = {};
  var tabPill = null;
  var hud = null;
  var branch = null;
  var zoom = null;
  var quiz = null;
  var tour = null;

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

  /** 끝을 넘겨 끌 때 덜 따라오게(고무줄) */
  function rubber(d, dim) {
    var a = Math.abs(d);
    return (d < 0 ? -1 : 1) * (a * 0.55 * dim) / (a * 0.55 + dim);
  }

  function activeColumns() {
    return state.data.datasets.filter(function (ds) { return !state.off[ds.id]; });
  }

  function visibleEntries() {
    return state.data.entries.filter(function (e) { return !state.off[e._dataset]; });
  }

  function buzz(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (err) { /* 무시 */ }
    }
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
    var Bc = night ? b.night : b.day;
    var blobA = night ? a.night_blob : a.day_blob;
    var blobB = night ? b.night_blob : b.day_blob;

    var f = clamp((t - 0.55) / 0.35, 0, 1);
    var top = f > 0.5 ? Bc[0] : A[0];
    var bottom = f > 0.5 ? Bc[1] : A[1];
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

  // ------------------------------------------------- 디오라마 무대

  var stageScenes = [];   // 장면 그림 — 연도 구간 { node, a, b, label, o, dy }

  /** 무대에 모든 장면 그림을 한 장씩 깔아 둔다(처음엔 모두 투명). */
  function buildStage() {
    el.stage.textContent = '';
    stageScenes = [];
    state.data.eras.forEach(function (era) {
      var scenes = C.scenesOf(era);
      scenes.forEach(function (sc, si) {
        var node = document.createElement('div');
        node.className = 'stage__art';
        node.style.backgroundImage = 'url("' + sc.diorama + '")';
        el.stage.appendChild(node);
        stageScenes.push({
          node: node, label: sc.label || '',
          a: sc.start_year,
          b: scenes[si + 1] ? scenes[si + 1].start_year : era.end_year,
          o: -1, dy: NaN
        });
      });
    });
  }

  /** 초점선의 해가 있는 장면을 보이게 하고, 경계에서는 교차 페이드(화면 px 기준). 장면 이름을 돌려준다 */
  function updateStage(year, s) {
    var label = '';
    var fade = SCENE_FADE / s;   // 연도 단위
    stageScenes.forEach(function (sc) {
      var f = Math.min(fade, sc.b - sc.a);
      var o = clamp(Math.min((year - (sc.a - f / 2)) / f, ((sc.b + f / 2) - year) / f), 0, 1);
      o = Math.round(o * 50) / 50;
      if (year >= sc.a && year < sc.b) label = sc.label;
      if (o !== sc.o) {
        sc.o = o;
        sc.node.style.opacity = o ? String(o) : '';
        sc.node.classList.toggle('is-on', o > 0);
      }
      if (!o) return;
      var dy = Math.round(-clamp((year - sc.a) / Math.max(1, sc.b - sc.a), 0, 1) * SCENE_DRIFT);
      if (dy !== sc.dy) { sc.dy = dy; sc.node.style.transform = 'translate3d(0,' + dy + 'px,0)'; }
    });
    return label;
  }

  // ------------------------------------------------- 탐험 그림판

  var zoomSegs = [];      // 계기판 띠 구간 { era, start, width }

  /** 초점선 위치와 계기판이 가리는 높이를 잰다 */
  function measure() {
    if (el.viewTimeline.hidden || !zoom) return;
    var viewRect = el.viewTimeline.getBoundingClientRect();
    layout.cover = Math.max(0, viewRect.bottom - (hud ? hud.restTop() : el.hud.getBoundingClientRect().top));
    layout.focus = Math.round(Math.max(110, (el.viewTimeline.clientHeight - layout.cover) * FOCUS_RATIO));
    el.focusLine.style.top = layout.focus + 'px';
    zoom.resize();
    el.focusLine.style.setProperty('--ring-x', zoom.axisX() + 'px');
    zoom.redraw();
  }

  /** 카테고리를 바꿨을 때 — 그림판의 열과 계기판 띠를 다시 */
  function refresh() {
    zoom.setData(visibleEntries(), activeColumns());
    buildScrubber();
    live.year = null;   // '지금 이때'도 다시
    zoom.redraw();
  }

  /** 계기판 띠 — 시대마다 한 구간, 너비는 사건 수에 비례(최소폭 보장) */
  function buildScrubber() {
    var eras = state.data.eras;
    var entries = visibleEntries();
    var counts = eras.map(function (era) {
      return entries.filter(function (e) { return e.start_year >= era.start_year && e.start_year < era.end_year; }).length;
    });
    var total = counts.reduce(function (a, b) { return a + b; }, 0) || 1;
    var sum = 0;
    zoomSegs = eras.map(function (era, i) {
      var w = Math.max(0.075, counts[i] / total);
      sum += w;
      return { era: era, width: w };
    });
    var start = 0;
    zoomSegs.forEach(function (g) { g.width /= sum; g.start = start; start += g.width; });
    hud.build(zoomSegs.map(function (g) {
      return { start: g.start, width: g.width, label: g.era.label, color: g.era.strip || '#8c6a4f' };
    }), entries.map(function (e) { return ratioOf(e.start_year); }));
  }

  function ratioOf(year) {
    for (var i = 0; i < zoomSegs.length; i += 1) {
      var g = zoomSegs[i];
      if (year < g.era.end_year || i === zoomSegs.length - 1) {
        var t = clamp((year - g.era.start_year) / Math.max(1, g.era.end_year - g.era.start_year), 0, 1);
        return clamp(g.start + t * g.width, 0, 1);
      }
    }
    return 0;
  }

  function yearOf(ratio) {
    for (var i = 0; i < zoomSegs.length; i += 1) {
      var g = zoomSegs[i];
      if (ratio < g.start + g.width || i === zoomSegs.length - 1) {
        var t = clamp((ratio - g.start) / Math.max(1e-6, g.width), 0, 1);
        return g.era.start_year + t * (g.era.end_year - g.era.start_year);
      }
    }
    return 0;
  }

  function eraIndexAt(year) {
    var eras = state.data.eras;
    var index = 0;
    for (var i = 0; i < eras.length; i += 1) if (eras[i].start_year <= year) index = i;
    return index;
  }

  /** 카메라가 움직일 때마다 — 계기판 숫자·띠, 배경 색, 무대 그림, '지금 이때' */
  function onZoomCamera(info) {
    var year = info.year;
    var index = eraIndexAt(year);
    var era = state.data.eras[index];
    var t = clamp((year - era.start_year) / Math.max(1, era.end_year - era.start_year), 0, 1);
    state.progress = t;
    paint(index, t);
    el.focusLine.classList.toggle('is-reading', !!info.reading);
    if (index !== state.eraIndex) {
      state.eraIndex = index;
      if (info.dragging) buzz([14, 30, 10]);
    }

    // 눕히면 초점 고리가 연도 축을 따라 안쪽으로 들어간다
    if (info.ringX != null && Math.abs(info.ringX - (live.ringX || 0)) > 0.5) {
      live.ringX = info.ringX;
      el.focusLine.style.setProperty('--ring-x', info.ringX + 'px');
    }

    var shown = Math.round(year);
    if (shown === 0) shown = 1;
    hud.setYear(shown);
    if (shown !== live.year) {
      live.year = shown;
      hud.setOngoing(ongoingAt(shown));
    }
    hud.setRatio(ratioOf(year));
    hud.setMeta(era.label, 0, updateStage(year, info.s));
  }

  // ------------------------------------------------------- 시대 이동

  function jumpEra(i) {
    var era = state.data.eras[clamp(i, 0, state.data.eras.length - 1)];
    zoom.flyToRange(era.start_year, era.end_year);
  }

  function stepEra(dir) {
    var target = eraIndexAt(zoom.year) + dir;
    if (target < 0 || target >= state.data.eras.length) { bumpHud(dir); return; }
    jumpEra(target);
  }

  /** 더 갈 곳이 없을 때 계기판이 살짝 튕긴다. */
  function bumpHud(dir) {
    if (reduced || !el.hud.animate) return;
    el.hud.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(' + (dir * 9) + 'px)' },
      { transform: 'translateX(' + (-dir * 4) + 'px)' },
      { transform: 'translateX(0)' }
    ], { duration: 360, easing: 'ease-out' });
  }

  function onScrub(ratio, phase) {
    zoom.flyTo(yearOf(ratio), zoom.scale, { instant: phase === 'move' });
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
    if (zoom) zoom.setActive(id === 'timeline');
    if (id === 'timeline') measure();
    if (id === 'search') el.search.focus();
    if (id === 'info') placeThemePill();
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
      icon.innerHTML = TAB_ICONS[tab.id] || '';
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

  // ------------------------------------------------------ 지금 이때

  /** 그 해에 이어지고 있었나 — 끝나는 해에는 다음 왕조에 자리를 넘긴다.
   *  데이터의 마지막 해(지금, 2025)로 끝나는 항목은 '아직 이어지는 중'이라 그 뒤로도 이어진다고 본다. */
  function covers(e, year) {
    if (e.start_year > year) return false;
    if (year < e.end_year) return true;
    if (e.end_year >= presentYear()) return true;
    return year === e.end_year && e.start_year === e.end_year;
  }

  function presentYear() {
    if (presentYear.v == null) {
      presentYear.v = state.data.entries.reduce(function (m, e) { return Math.max(m, e.end_year); }, -Infinity);
    }
    return presentYear.v;
  }

  /**
   * 계기판의 '지금 이때' — 초점선의 해에 카테고리(나라)마다 이어지던 나라·왕조.
   *  · 나라·왕조(polity)만, 긴 것부터 최대 2개(고구려·백제, 남북한처럼 같은 때 여럿인 경우)
   *    한 나라 안의 시기(통일신라, 위만조선)는 데이터에서 era 로 적어 두어 겹치지 않게 한다
   *  · 그 해에 나라·왕조 항목이 없으면(헤이안 시대, 춘추시대 등) 시대 구분(era) 하나로 대신한다
   */
  function ongoingAt(year) {
    var out = [];
    var len = function (e) { return e.end_year - e.start_year; };
    state.data.datasets.forEach(function (ds) {
      if (ds.track !== 'nation' || state.off[ds.id]) return;
      var polities = ds.entries
        .filter(function (e) { return e.kind === 'polity' && covers(e, year); })
        .sort(function (a, b) { return len(b) - len(a); });
      var picked = polities.slice(0, 2);
      if (!picked.length) {
        var eras = ds.entries
          .filter(function (e) { return e.kind === 'era' && covers(e, year); })
          .sort(function (a, b) { return len(a) - len(b); });
        if (eras.length) picked.push(eras[0]);
      }
      picked.sort(function (a, b) { return a.start_year - b.start_year; });
      out.push.apply(out, picked);
    });
    return out;
  }

  /** 설정 탭의 '명화 오마주' 출처 — 매니페스트 장면의 after 에서 그대로 만든다 */
  function buildCredits() {
    var list = document.getElementById('art-credits');
    if (!list) return;
    list.textContent = '';
    state.data.eras.forEach(function (era) {
      (era.scenes || []).forEach(function (sc) {
        if (!sc.after) return;
        var li = document.createElement('li');
        var what = document.createElement('strong');
        what.textContent = era.label + ' · ' + sc.label;
        li.appendChild(what);
        li.appendChild(document.createTextNode(' — ' + sc.after));
        list.appendChild(li);
      });
    });
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
        btn.style.setProperty('--pc', ds.color);

        var dot = document.createElement('span');
        dot.className = 'pick__dot';
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
          refresh();
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
    refresh();
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

  function yearsOf(entry) {
    return C.yearLabel(entry.start_year) +
      (entry.end_year !== entry.start_year ? ' – ' + C.yearLabel(entry.end_year) : '');
  }

  /**
   * 검색어가 있으면 찾은 것, 없으면 모든 항목을 시대순으로 — 그림판을 볼 수 없는 화면 읽기
   * 프로그램 이용자도 여기서 연표 전체를 글로 차례대로 읽을 수 있다.
   */
  function renderSearch() {
    var query = state.query.trim().toLowerCase();
    var pool = state.data.entries;
    var results = query
      ? pool.filter(function (e) { return e._search.indexOf(query) !== -1; })
      : pool.slice();
    results.sort(function (a, b) { return a.start_year - b.start_year || a.end_year - b.end_year; });

    el.searchCount.textContent = query
      ? '검색 결과 ' + results.length + '건 · 시대순'
      : '전체 ' + results.length + '건 · 시대순';

    var frag = document.createDocumentFragment();
    results.forEach(function (entry) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'result';
      card.style.setProperty('--c', entry._color);

      var meta = document.createElement('div');
      meta.className = 'result__meta';
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = entry._color;
      meta.appendChild(dot);
      var years = document.createElement('span');
      years.className = 'result__years';
      years.textContent = yearsOf(entry);
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
      summary.textContent = entry.description;
      card.appendChild(summary);

      card.addEventListener('click', function () { openEntry(entry); });
      frag.appendChild(card);
    });

    el.searchResults.textContent = '';
    el.searchResults.appendChild(frag);
  }

  // -------------------------------------------------------- 상세 팝업

  /** 연도 · 사건 · 한 줄 설명 · 출처 — 그 이상은 넣지 않는다 */
  /** 상세 내용(연도·사건·한 문장 설명·출처, 갈림길) — 펼친 카드와 아래 팝업이 함께 쓴다 */
  function fillEntry(entry, eyebrow, title, body, leave) {
    eyebrow.textContent = '';
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.backgroundColor = entry._color;
    eyebrow.appendChild(dot);
    eyebrow.appendChild(document.createTextNode(entry.era_note || C.periodLabel(entry.start_year, entry.end_year)));
    eyebrow.title = entry._label;
    title.textContent = entry.title;

    body.textContent = '';

    var desc = document.createElement('p');
    desc.className = 'sheet__desc';
    desc.textContent = entry.description;
    body.appendChild(desc);

    var source = document.createElement('p');
    source.className = 'sheet__source';
    if (entry.sources && entry.sources.length) {
      // "이름 https://…" 꼴이면 이름을 링크로, 아니면 글자 그대로
      source.appendChild(document.createTextNode('출처 · '));
      entry.sources.forEach(function (s, i) {
        if (i) source.appendChild(document.createTextNode(' · '));
        var m = /^(.*?)\s*(https?:\/\/\S+)$/.exec(s);
        if (!m) { source.appendChild(document.createTextNode(s)); return; }
        var a = document.createElement('a');
        a.href = m[2];
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = m[1] || m[2];
        source.appendChild(a);
      });
      if (entry.status !== 'reviewed') source.appendChild(document.createTextNode(' (검토 전 초안)'));
    } else {
      source.classList.add('is-missing');
      source.textContent = '출처 · 아직 확인 전(검토 전 초안)';
    }
    body.appendChild(source);

    // 이 항목에서 갈라지는 가상 역사(갈림길)가 있으면 바로 들어가는 길
    if (branch) {
      branch.scenariosFor(entry.id).forEach(function (sc) {
        var go = document.createElement('button');
        go.type = 'button';
        go.className = 'branch-link';
        go.textContent = '갈림길 · ' + sc.title + ' →';
        go.addEventListener('click', function () {
          leave();
          setTab('branch');
          branch.open(sc.id);
        });
        body.appendChild(go);
      });
    }
    body.scrollTop = 0;
  }

  /** 아래에서 올라오는 상세 팝업 — 그림판을 쓸 수 없을 때의 예비 */
  function openSheet(entry) {
    fillEntry(entry, el.sheetEyebrow, el.sheetTitle, el.sheetBody, closeSheet);
    el.sheet.style.transform = '';
    el.sheet.style.transition = '';
    el.sheet.style.opacity = '';
    reveal(el.sheet);
    reveal(el.sheetScrim);
  }

  // ------------------------------------------------ 펼치기(왕조가 확대되며 상세)

  /**
   * 항목 열기 — 어디서 눌렀든(그림판·검색·퀴즈·계기판·갈림길) 연표로 와서
   * 그 왕조·사건이 화면을 채우도록 날아가고, 도착하면 그림판의 그 옆에 상세가 쓰인다.
   */
  function openEntry(entry) {
    if (!zoom) { openSheet(entry); return; }
    if (state.off[entry._dataset]) {   // 꺼 둔 카테고리면 켠다
      state.off[entry._dataset] = false;
      syncCategories();
      refresh();
    }
    if (state.tab !== 'timeline') setTab('timeline');
    if (isOpen(el.sheet)) closeSheet();
    // 이 항목에서 갈라지는 가상 역사(갈림길)가 있으면 바로 들어가는 길
    var links = branch ? branch.scenariosFor(entry.id).map(function (sc) {
      return {
        label: '갈림길 · ' + sc.title,
        run: function () { zoom.blur(); setTab('branch'); branch.open(sc.id); }
      };
    }) : [];
    var col = activeColumns().map(function (ds) { return ds.id; }).indexOf(entry._dataset);
    zoom.focusEntry(entry, col, links);
    el.focusLive.textContent = entry.title + ', ' + (entry.era_note || C.periodLabel(entry.start_year, entry.end_year)) + '. ' + (entry.description || '');
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
    if (reduced) { node.hidden = true; return; }
    node.classList.add(cls);
    clearTimeout(node._leave);
    node._leave = setTimeout(function () {
      node.hidden = true;
      node.classList.remove('is-leaving', 'is-flung');
      node.style.transform = '';
      node.style.transition = '';
      node.style.opacity = '';
    }, ms);
  }

  function isOpen(node) {
    return !node.hidden && !node.classList.contains('is-leaving') && !node.classList.contains('is-flung');
  }

  /** 팝업을 손잡이로 끌어내려 닫는다. 조금만 끌면 스프링처럼 제자리로. */
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
      g.dy = dy > 0 ? dy : rubber(dy, 140);
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
        el.sheet.style.transition = 'transform .26s cubic-bezier(.4,0,1,1), opacity .26s ease';
        el.sheet.style.transform = 'translate3d(0,' + Math.round(window.innerHeight * 0.6) + 'px,0) scale(.94)';
        el.sheet.style.opacity = '0';
        closeSheet(true);
      } else {
        el.sheet.style.transition = 'transform .5s cubic-bezier(.34,1.56,.64,1)';
        el.sheet.style.transform = '';
      }
    }

    var zone = el.sheet.querySelector('.sheet__head');
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------ 낮/야경

  function setNight(night) {
    state.night = night;
    markNight(night);
    paint.gradient = paint.blobs = null;
    if (zoom) zoom.refreshTheme();
    paint(state.eraIndex, state.progress);
  }

  /** <html> 의 is-night 와 브라우저 상단 색만 맞춘다(그리기는 setNight). */
  function markNight(night) {
    document.documentElement.classList.toggle('is-night', night);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', night ? '#1c1724' : '#f3e7d8');
  }

  // ------------------------------------------------------------ 테마 설정

  /* 설정 탭의 시스템 / 라이트 / 다크. 기본은 라이트. index.html 의 머리 스크립트가
     저장된 값을 스타일보다 먼저 읽어 첫 화면이 깜빡이지 않게 한다. */
  var THEME_KEY = 'bighistory.theme';
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function loadTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      return v === 'system' || v === 'dark' ? v : 'light';
    } catch (err) { return 'light'; }
  }

  function resolveNight(theme) {
    return theme === 'dark' || (theme === 'system' && !!(darkQuery && darkQuery.matches));
  }

  function placeThemePill() {
    var pill = el.themeSeg.querySelector('.seg__pill');
    var on = el.themeSeg.querySelector('.is-active');
    if (!pill || !on || !on.offsetWidth) return;
    pill.style.width = on.offsetWidth + 'px';
    pill.style.transform = 'translate3d(' + on.offsetLeft + 'px,0,0)';
  }

  /**
   * @param silent  처음 켤 때 — 아직 그리기 전이라 상태와 클래스만 맞춘다
   */
  function applyTheme(theme, save, silent) {
    state.theme = theme;
    Array.prototype.forEach.call(el.themeSeg.querySelectorAll('[data-theme]'), function (btn) {
      var on = btn.getAttribute('data-theme') === theme;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    placeThemePill();
    var night = resolveNight(theme);
    if (silent) {
      state.night = night;
      markNight(night);
    } else if (night !== state.night) {
      setNight(night);
    }
    if (save) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* 저장 못 해도 동작엔 지장 없음 */ }
    }
  }

  function showToast(text, ms) {
    var t = el.toast;
    clearTimeout(t._leave);
    clearTimeout(t._hold);
    t.classList.remove('is-leaving');
    t.textContent = text;
    t.hidden = true;
    void t.offsetWidth;   // 같은 안내를 연달아 띄워도 등장 동작이 다시 나오게
    t.hidden = false;
    t._hold = setTimeout(function () { conceal(t, 'is-leaving', 250); }, ms || 1500);
  }

  // ------------------------------------------------------------ 사용법 안내

  /** 안내 단계 — 마우스·트랙패드와 터치에 맞춰 말을 바꾼다 */
  function tourSteps() {
    var fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    var mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
    return [
      {
        title: '역사를 나란히 보는 연표예요',
        text: '세로줄 하나가 나라나 주제 하나, 위에서 아래로 흐르는 게 시간이에요. 같은 높이에 있으면 같은 해예요.',
        place: 'top'
      },
      {
        title: '움직이기',
        text: fine
          ? '스크롤하면 위아래로는 시간을, 옆으로는 다른 나라·주제를 따라 움직여요. 끌어도 돼요.'
          : '한 손가락으로 끌어서 움직여요. 휙 밀면 스르륵 미끄러져요.',
        place: 'top'
      },
      {
        title: '확대하기',
        text: fine
          ? '트랙패드는 두 손가락을 벌리고, 마우스는 ' + mod + '+스크롤로 확대해요. 두 번 클릭해도 확대돼요.'
          : '두 손가락을 벌려 확대해요. 두 번 톡 쳐도 확대돼요.',
        place: 'top'
      },
      {
        title: '눌러서 펼치기',
        text: '왕조나 사건을 누르면 그쪽으로 날아가 커지고, 이름 아래로 설명과 출처가 나와요. 빈 곳을 누르면 다시 접혀요.',
        place: 'bottom',
        enter: function () {
          var e = state.data.entries.filter(function (x) { return x.id === 'korea-goryeo'; })[0];
          if (e) openEntry(e);
        },
        leave: function () { if (zoom) zoom.blur(); }
      },
      {
        title: '지금 이때',
        text: '지금 보고 있는 해와 시대예요. ‹ › 로 시대를 건너뛰고, 숫자를 누르면 시대 띠와 그때 있던 나라들이 펼쳐져요.',
        target: function () { return el.hud; }
      },
      {
        title: '더 둘러보기',
        text: '카테고리에서 보고 싶은 줄을 켜고 끄고, 검색으로 사건을 찾고, 퀴즈도 풀어 보세요.',
        target: function () { return el.tabs; }
      }
    ];
  }

  // ------------------------------------------------------------ 이벤트

  function bindEvents() {
    Array.prototype.forEach.call(el.themeSeg.querySelectorAll('[data-theme]'), function (btn) {
      btn.addEventListener('click', function () { applyTheme(btn.getAttribute('data-theme'), true); });
    });
    if (darkQuery) {
      var onScheme = function () { if (state.theme === 'system') applyTheme('system', false); };
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', onScheme);
      else if (darkQuery.addListener) darkQuery.addListener(onScheme);
    }

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
    bindSheetDrag();

    document.addEventListener('keydown', onKey);

    var remeasure = debounce(function () {
      measure();
      placeTabPill();
      placeThemePill();
      hud.measure();
    }, 120);
    window.addEventListener('resize', remeasure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  }

  /** 키보드: ↑↓ 조금, PageUp/Down·Space 한 화면, ←→ 옆 열, +− 줌, T 눕히기, 1~6 시대, / 검색 */
  function onKey(e) {
    if (e.key === 'Escape') {
      if (isOpen(el.sheet)) closeSheet();
      else if (zoom && zoom.focused()) zoom.blur();
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
    if (state.tab !== 'timeline' || isOpen(el.sheet)) return;
    if ((e.key === ' ' || e.key === 'Enter') && target.tagName === 'BUTTON') return;

    var page = Math.max(120, (el.viewTimeline.clientHeight - layout.cover) * 0.8);
    var eras = state.data.eras;
    switch (e.key) {
      case 'ArrowDown': zoom.panBy(90); break;
      case 'ArrowUp': zoom.panBy(-90); break;
      case 'ArrowRight': zoom.panBy(0, 200); break;
      case 'ArrowLeft': zoom.panBy(0, -200); break;
      case 'PageDown': case ' ': zoom.panBy(e.shiftKey ? -page : page); break;
      case 'PageUp': zoom.panBy(-page); break;
      case '+': case '=': zoom.zoomBy(1.8); break;
      case '-': case '_': zoom.zoomBy(1 / 1.8); break;
      case 't': case 'T': case 'ㅅ': zoom.toggleTilt(); break;   // 눕히기(한글 자판이면 ㅅ)
      case 'Home': zoom.flyToRange(eras[0].start_year, eras[eras.length - 1].end_year); break;
      case 'End': zoom.flyTo(presentYear(), Math.max(zoom.scale, 2)); break;
      default:
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= eras.length) jumpEra(Number(e.key) - 1);
        else return;
    }
    e.preventDefault();
  }

  // ------------------------------------------------------------ 시작

  function start(data) {
    state.data = data;
    applyTheme(loadTheme(), false, true);

    hud = H.create(el.hud, { scrub: onScrub, step: stepEra, pick: openEntry });
    hud.setCompact(true);   // 그림판에 연도 눈금·시대 제목이 있으니 계기판은 알약으로 접어 둔다
    // 펼쳐 둔 계기판은 그림판을 다시 만지면 접힌다
    el.zoom.addEventListener('pointerdown', function () { hud.fold(); }, { passive: true });

    zoom = Z.create(el.zoom, {
      plane: document.getElementById('zoom-plane'),
      force2d: /[?&]2d\b/.test(location.search),   // ?2d — WebGL 없는 기기처럼(확인용)
      eras: data.eras,
      present: presentYear(),
      focusY: function () { return layout.focus; },
      onCamera: onZoomCamera,
      openEntry: openEntry,
      bottomCover: function () { return layout.cover; }   // 아래를 가리는 계기판·탭 높이
    });
    window.__bhZoom = zoom;   // 개발자 도구에서 확인용

    branch = B.create(document.getElementById('branch-root'), {
      data: data,
      openEntry: openEntry,
      scrollBox: document.getElementById('view-branch')
    });

    // 퀴즈(데모) — 놓인 카드를 누르면 탐험 그림판의 그 자리로
    quiz = Q.create(document.getElementById('quiz-root'), {
      entries: function () { return state.data.entries; },
      shareTitle: document.title,
      onShow: openEntry
    });

    buildTabs();
    buildStage();
    buildCredits();
    buildCategories();
    buildSuggestions();
    bindEvents();

    syncCategories();
    renderSearch();
    paint(0, 0);
    setTab('timeline');
    zoom.setData(visibleEntries(), activeColumns());
    buildScrubber();
    measure();
    zoom.home();

    // 처음 온 사람에게 사용법 안내(안내 내용이 크게 바뀌면 키 번호를 올려 다시 보여 준다)
    tour = T.create({ key: 'bighistory.tour1', steps: tourSteps() });
    // 항목 페이지(p/)나 공유 링크로 들어왔으면(#e=<id>) 그 항목을 바로 펼친다 — 안내는 설정 탭에서
    var deep = /^#e=([a-z0-9-]+)$/.exec(location.hash);
    var target = deep && data.entries.filter(function (x) { return x.id === deep[1]; })[0];
    if (target) setTimeout(function () { openEntry(target); }, 400);
    else setTimeout(function () { if (state.tab === 'timeline') tour.start(false); }, 700);
    document.getElementById('tour-again').addEventListener('click', function () {
      setTab('timeline');
      tour.start(true);
    });

    requestAnimationFrame(function () {
      el.tabs.classList.add('is-ready');
      placeThemePill();
      el.themeSeg.classList.add('is-ready');
    });

    el.loading.hidden = true;
    console.info('[app] 빅 히스토리 연표 · 항목 ' + data.entries.length + '개 · 시대 ' + data.eras.length + '구간');
  }

  function showError(err) {
    el.loading.hidden = true;
    var box = document.createElement('div');
    box.className = 'card load-error';
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
    el.viewTimeline.appendChild(box);
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
