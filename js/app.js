/* ------------------------------------------------------------------
   앱 조립부 — 탭 전환, 시대 배경, 카테고리/검색, 상세 시트, 월·일 팝업

   배경은 스크롤할 때마다 다시 그려야 하므로 상태가 아니라 DOM 스타일을
   직접 씁니다(프레임마다 전체를 다시 만들지 않기 위함).
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var C = window.BigHistoryChapters;

  var el = {
    app: document.getElementById('app'),
    bgGradient: document.getElementById('bg-gradient'),
    bgBlob: document.getElementById('bg-blob'),
    eraTag: document.getElementById('era-tag'),
    eraChips: document.getElementById('era-chips'),
    nightToggle: document.getElementById('night-toggle'),
    scroll: document.getElementById('scroll'),
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

  var chipNodes = [];
  var pickNodes = {};
  var tabNodes = {};

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

    el.bgGradient.style.backgroundImage = 'linear-gradient(180deg,' + top + ',' + bottom + ')';
    el.bgBlob.style.backgroundImage = [
      'radial-gradient(60% 42% at 18% ' + (16 + t * 20).toFixed(0) + '%,' + c1 + ',transparent 70%)',
      'radial-gradient(52% 38% at 84% ' + (62 - t * 18).toFixed(0) + '%,' + c2 + ',transparent 72%)',
      'radial-gradient(40% 30% at 52% ' + (88 - t * 30).toFixed(0) + '%,' + c1 + ',transparent 74%)'
    ].join(',');

    el.eraTag.textContent = a.label;
  }

  function markEraChip(index) {
    chipNodes.forEach(function (chip, i) {
      chip.classList.toggle('is-active', i === index);
      chip.setAttribute('aria-selected', String(i === index));
    });
  }

  var onScroll = function () {
    var sections = el.chapters.querySelectorAll('.chapter');
    if (!sections.length) return;

    var y = el.scroll.scrollTop + el.scroll.clientHeight * 0.32;
    var index = 0;
    var t = 0;

    for (var i = 0; i < sections.length; i += 1) {
      var s = sections[i];
      if (s.offsetTop <= y) {
        index = i;
        t = clamp((y - s.offsetTop) / Math.max(1, s.offsetHeight), 0, 1);
      }
    }

    state.progress = t;
    paint(index, t);
    if (index !== state.eraIndex) {
      state.eraIndex = index;
      markEraChip(index);
    }
  };

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
    if (id === 'timeline') onScroll();
    if (id === 'search') el.search.focus();
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
  }

  function buildEraChips() {
    el.eraChips.textContent = '';
    chipNodes = state.data.eras.map(function (era, i) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'era-chip';
      chip.setAttribute('role', 'tab');
      chip.textContent = era.label;
      chip.addEventListener('click', function () {
        setTab('timeline');
        var section = document.getElementById('era-' + era.id);
        if (section) el.scroll.scrollTo({ top: section.offsetTop - 6, behavior: 'smooth' });
      });
      el.eraChips.appendChild(chip);
      return chip;
    });
    markEraChip(state.eraIndex);
  }

  /**
   * 시대마다 표가 따로 있으면 가로 스크롤도 따로 논다.
   * 한 표를 옆으로 밀면 나머지도 같은 위치로 맞춰 하나의 표처럼 읽히게 한다.
   */
  var syncingScroll = false;

  function linkHorizontalScroll() {
    var wraps = Array.prototype.slice.call(el.chapters.querySelectorAll('.table-wrap'));
    wraps.forEach(function (wrap) {
      wrap.addEventListener('scroll', function () {
        if (syncingScroll) return;
        syncingScroll = true;
        var left = wrap.scrollLeft;
        wraps.forEach(function (other) {
          if (other !== wrap && other.scrollLeft !== left) other.scrollLeft = left;
        });
        requestAnimationFrame(function () { syncingScroll = false; });
      }, { passive: true });
    });
  }

  /** 연표(시대 섹션 + 표)를 다시 그린다. */
  function renderTimeline() {
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
    linkHorizontalScroll();
    onScroll();
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

    el.sheet.hidden = false;
    el.sheetScrim.hidden = false;
  }

  function closeSheet() {
    el.sheet.hidden = true;
    el.sheetScrim.hidden = true;
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
    el.day.hidden = false;
    el.dayScrim.hidden = false;
  }

  function closeDay() {
    el.day.hidden = true;
    el.dayScrim.hidden = true;
  }

  // ------------------------------------------------------------ 낮/야경

  function setNight(night) {
    state.night = night;
    el.app.classList.toggle('is-night', night);
    el.nightToggle.textContent = night ? '☾ 야경' : '☀ 낮';
    el.nightToggle.setAttribute('aria-pressed', String(night));
    renderTimeline();
    paint(state.eraIndex, state.progress);
  }

  // ------------------------------------------------------------ 이벤트

  function bindEvents() {
    el.scroll.addEventListener('scroll', onScroll, { passive: true });
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

    el.sheetClose.addEventListener('click', closeSheet);
    el.sheetScrim.addEventListener('click', closeSheet);
    el.dayClose.addEventListener('click', closeDay);
    el.dayScrim.addEventListener('click', closeDay);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.day.hidden) closeDay();
        else if (!el.sheet.hidden) closeSheet();
        return;
      }
      var typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setTab('search');
      }
    });

    window.addEventListener('resize', debounce(onScroll, 150));
  }

  // ------------------------------------------------------------ 시작

  function start(data) {
    state.data = data;

    buildTabs();
    buildEraChips();
    buildCategories();
    buildSuggestions();
    bindEvents();

    syncCategories();
    renderTimeline();
    renderSearch();
    setTab('timeline');
    paint(0, 0);

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
