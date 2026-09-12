/* ------------------------------------------------------------------
   앱 조립부 — 툴바 / 필터 / 검색 / 상세 패널 / 세부 연표 팝업을 연표와 연결합니다.
   데이터 구조를 모르는 코드가 없도록, 화면에 필요한 정보는 모두
   data/index.json(매니페스트)에서 흘러나옵니다.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var T = window.BigHistoryTimeline;

  /** 이 픽셀 폭 안에 몰린 단일 연도 사건들을 하나로 묶는다. */
  var CLUSTER_PX = 76;

  var el = {
    search: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    eras: document.getElementById('era-presets'),
    filters: document.getElementById('filters'),
    filtersToggle: document.getElementById('filters-toggle'),
    filterGroups: document.getElementById('filter-groups'),
    draftOnly: document.getElementById('draft-only'),
    showSummary: document.getElementById('show-summary'),
    scrollMode: document.getElementById('scroll-mode'),
    orientation: document.getElementById('orientation'),
    modeHint: document.getElementById('mode-hint'),
    statusText: document.getElementById('status-text'),
    reset: document.getElementById('reset-all'),
    timeline: document.getElementById('timeline'),
    loading: document.getElementById('loading'),
    emptyState: document.getElementById('empty-state'),
    stage: document.querySelector('.stage'),
    panel: document.getElementById('detail-panel'),
    panelBackdrop: document.getElementById('panel-backdrop'),
    panelEyebrow: document.getElementById('panel-eyebrow'),
    panelTitle: document.getElementById('panel-title'),
    panelBody: document.getElementById('panel-body'),
    panelClose: document.getElementById('panel-close'),
    copyJson: document.getElementById('copy-json'),
    copyHint: document.getElementById('copy-hint'),
    popup: document.getElementById('cluster-popup'),
    popupEyebrow: document.getElementById('cluster-eyebrow'),
    popupTitle: document.getElementById('cluster-title'),
    popupBody: document.getElementById('cluster-body'),
    popupClose: document.getElementById('cluster-close'),
    popupZoom: document.getElementById('cluster-zoom')
  };

  var MODE_HINTS = {
    horizontal: {   // 가로 축(시간이 좌우)
      zoom: '휠·핀치: 확대·축소 · 드래그: 이동',
      horizontal: '휠: 좌우(시간) 이동 · Ctrl+휠·핀치: 확대',
      vertical: '휠: 위아래(레인) 이동 · Ctrl+휠·핀치: 확대'
    },
    vertical: {     // 세로 축(시간이 위아래)
      zoom: '휠·핀치: 확대·축소 · 드래그: 이동',
      horizontal: '휠: 좌우(레인) 이동 · Ctrl+휠·핀치: 확대',
      vertical: '휠: 위아래(시간) 이동 · Ctrl+휠·핀치: 확대'
    }
  };

  var state = {
    data: null,
    active: {},        // datasetId -> boolean
    query: '',
    draftOnly: false,
    showSummary: true,
    scrollMode: 'zoom',
    axis: 'horizontal',       // 'horizontal' = 시간이 좌우, 'vertical' = 시간이 위아래
    era: null,
    selected: null,
    clusters: {},      // clusterId -> 묶음 정보
    lastBucket: null,
    visible: []
  };

  var chart = null;
  var chipNodes = {};
  var eraNodes = {};

  // ------------------------------------------------------------ 유틸

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function activeIds() {
    return Object.keys(state.active).filter(function (id) { return state.active[id]; });
  }

  function matches(entry) {
    if (!state.active[entry._dataset]) return false;
    if (state.draftOnly && entry.status !== 'draft') return false;
    if (state.query && entry._search.indexOf(state.query) === -1) return false;
    return true;
  }

  // ------------------------------------------------------- 툴바 만들기

  function buildEraPresets(presets) {
    el.eras.textContent = '';
    eraNodes = {};
    (presets.length ? presets : [{ id: 'all', label: '전체' }]).forEach(function (preset) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'era-btn';
      btn.textContent = preset.label;
      btn.addEventListener('click', function () { applyEra(preset); });
      eraNodes[preset.id] = btn;
      el.eras.appendChild(btn);
    });
    markActiveEra(state.era);
  }

  function markActiveEra(id) {
    Object.keys(eraNodes).forEach(function (key) {
      eraNodes[key].classList.toggle('is-active', key === id);
    });
  }

  function buildFilters(tracks) {
    el.filterGroups.textContent = '';
    chipNodes = {};

    tracks.forEach(function (track) {
      var group = document.createElement('div');
      group.className = 'filter-group';

      var label = document.createElement('button');
      label.type = 'button';
      label.className = 'filter-group__label';
      label.textContent = track.label;
      label.title = track.label + ' 전체 켜기/끄기';
      label.addEventListener('click', function () { toggleTrack(track); });
      group.appendChild(label);

      track.datasets.forEach(function (ds) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.style.setProperty('--chip-color', ds.color);
        chip.setAttribute('aria-pressed', 'true');

        var dot = document.createElement('span');
        dot.className = 'chip__dot';
        chip.appendChild(dot);

        var name = document.createElement('span');
        name.textContent = ds.label;
        chip.appendChild(name);

        var count = document.createElement('span');
        count.className = 'chip__count';
        chip.appendChild(count);

        chip.addEventListener('click', function () {
          state.active[ds.id] = !state.active[ds.id];
          render();
        });

        chipNodes[ds.id] = { chip: chip, count: count };
        group.appendChild(chip);
      });

      el.filterGroups.appendChild(group);
    });
  }

  function toggleTrack(track) {
    var ids = track.datasets.map(function (ds) { return ds.id; });
    var allOn = ids.every(function (id) { return state.active[id]; });
    ids.forEach(function (id) { state.active[id] = !allOn; });
    render();
  }

  // -------------------------------------------------- 묶음(클러스터) 계산

  /**
   * 지금 확대 수준에서 몇 년을 한 덩어리로 볼지.
   * 화면에서 약 CLUSTER_PX 픽셀 안에 들어오는 기간이며, 최소 1년입니다.
   * 확대할수록 값이 작아지므로 묶음이 자연스럽게 쪼개집니다.
   */
  function bucketYears() {
    if (!chart) return 1;
    return Math.max(1, Math.round(chart.yearsPerPixel() * CLUSTER_PX));
  }

  /**
   * 지금 확대 수준에서 사실상 점으로 보이는 항목인지.
   * 단일 연도 사건과, 묶음 단위에 비해 아주 짧은 사건(전쟁·혁명 등)이 해당한다.
   * 왕조처럼 긴 항목은 연표의 뼈대이므로 절대 묶이지 않는다.
   */
  function isDotLike(entry, bucket) {
    if (entry._isPoint) return true;
    return (entry.end_year - entry.start_year) <= bucket * 0.25;
  }

  /** 같은 레인에서 같은 구간에 몰린 사건들을 하나로 묶는다. */
  function clusterize(entries, bucket) {
    var loose = [];
    var buckets = {};

    entries.forEach(function (entry) {
      if (!isDotLike(entry, bucket)) { loose.push(entry); return; }
      var key = entry._dataset + '@' + Math.floor(entry.start_year / bucket);
      (buckets[key] || (buckets[key] = [])).push(entry);
    });

    var clusters = [];
    Object.keys(buckets).forEach(function (key) {
      var list = buckets[key];
      if (list.length < 2) { loose.push(list[0]); return; }

      list.sort(function (a, b) { return a.start_year - b.start_year; });
      var last = list.reduce(function (max, e) { return Math.max(max, e.end_year); }, list[0].end_year);

      clusters.push({
        id: 'cluster:' + key,
        dataset: list[0]._dataset,
        label: list[0]._label,
        color: list[0]._color,
        startYear: list[0].start_year,
        endYear: last,
        entries: list
      });
    });

    return { entries: loose, clusters: clusters };
  }

  // ------------------------------------------------------------ 렌더

  /** 필터 결과를 연표에 올린다. (묶음 계산 포함) */
  function renderItems() {
    var bucket = bucketYears();
    var grouped = clusterize(state.visible, bucket);

    state.lastBucket = bucket;
    state.clusters = {};
    grouped.clusters.forEach(function (cluster) { state.clusters[cluster.id] = cluster; });

    chart.setEntries(grouped.entries, grouped.clusters, { showSummary: state.showSummary });
  }

  function render() {
    var data = state.data;
    if (!data) return;

    state.visible = data.entries.filter(matches);

    var counts = {};
    data.datasets.forEach(function (ds) { counts[ds.id] = 0; });
    state.visible.forEach(function (e) { counts[e._dataset] += 1; });

    data.datasets.forEach(function (ds) {
      var node = chipNodes[ds.id];
      if (!node) return;
      var on = !!state.active[ds.id];
      node.chip.classList.toggle('is-on', on);
      node.chip.setAttribute('aria-pressed', String(on));
      node.count.textContent = on ? String(counts[ds.id]) : '';
    });

    chart.setStructure(data.tracks, activeIds(), counts);
    renderItems();

    var draftCount = state.visible.filter(function (e) { return e.status === 'draft'; }).length;
    el.statusText.textContent =
      '총 ' + data.entries.length + '개 중 ' + state.visible.length + '개 표시' +
      ' · 검토 전 ' + draftCount + '개';

    el.emptyState.hidden = state.visible.length > 0;
    el.searchClear.hidden = !state.query;

    if (state.selected && !state.visible.some(function (e) { return e.id === state.selected.id; })) {
      closePanel();
    }
  }

  /** 확대/이동으로 묶음 단위가 바뀌었을 때만 다시 그린다. */
  var onRangeChanged = debounce(function () {
    if (!chart || !state.data) return;
    if (bucketYears() !== state.lastBucket) renderItems();
  }, 170);

  /** 처음 열었을 때 / 전체 초기화 시 보여줄 범위. */
  function applyDefaultWindow(animate) {
    var win = state.data.defaultWindow;
    state.era = null;
    markActiveEra(null);
    if (win) chart.focusYears(win.start_year, win.end_year, animate === true);
    else chart.fit();
  }

  function applyEra(preset) {
    state.era = preset.id;
    markActiveEra(preset.id);
    if (preset.start_year == null || preset.end_year == null) {
      chart.fit();
    } else {
      chart.focusYears(preset.start_year, preset.end_year, true);
    }
  }

  function setScrollMode(mode) {
    state.scrollMode = mode;
    chart.setScrollMode(mode);
    Array.prototype.forEach.call(el.scrollMode.querySelectorAll('.seg-btn'), function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-mode') === mode));
    });
    el.modeHint.textContent = (MODE_HINTS[state.axis] || {})[mode] || '';
  }

  /** 가로 보기(vis-timeline)와 세로 보기(직접 그린 렌더러)를 같은 API 로 만든다. */
  function createView(axis, win) {
    var factory = axis === 'vertical' ? window.BigHistoryVTimeline : T;
    return factory.create(el.timeline, {
      window: win,
      onSelect: handleSelect,
      onRangeChanged: onRangeChanged
    });
  }

  /** 시간축 방향 전환 — 보고 있던 연도 구간과 필터 상태를 그대로 옮긴다. */
  function setAxis(axis, force) {
    if (!force && axis === state.axis) return;

    var win = chart ? chart.windowYears() : null;
    if (chart) chart.destroy();

    state.axis = axis;
    chart = createView(axis, win
      ? { start_year: win.start, end_year: win.end }
      : state.data.defaultWindow);

    var pad = Math.max(50, Math.round((state.data.range.max - state.data.range.min) * 0.03));
    chart.setLimits(state.data.range.min - pad, state.data.range.max + pad);
    chart.setScrollMode(state.scrollMode);

    Array.prototype.forEach.call(el.orientation.querySelectorAll('.seg-btn'), function (btn) {
      var on = btn.getAttribute('data-axis') === axis;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    el.modeHint.textContent = (MODE_HINTS[axis] || {})[state.scrollMode] || '';

    render();
    if (win) chart.focusYears(win.start, win.end, false);
  }

  function resetAll() {
    state.query = '';
    state.draftOnly = false;
    state.showSummary = true;
    el.search.value = '';
    el.draftOnly.checked = false;
    el.showSummary.checked = true;
    state.data.datasets.forEach(function (ds) {
      state.active[ds.id] = !ds.hidden_by_default;
    });
    closePanel();
    closePopup();
    setAxis('horizontal');
    setScrollMode('zoom');
    render();
    applyDefaultWindow(false);
  }

  // ------------------------------------------------------- 상세 패널

  function field(labelText, node) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var label = document.createElement('p');
    label.className = 'field__label';
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(node);
    return wrap;
  }

  function listOf(values) {
    var ul = document.createElement('ul');
    ul.className = 'field__list';
    values.forEach(function (v) {
      var li = document.createElement('li');
      li.textContent = v;
      ul.appendChild(li);
    });
    return ul;
  }

  function openPanel(entry) {
    state.selected = entry;
    el.panelEyebrow.textContent = entry.category + ' · ' + entry.subcategory;
    el.panelTitle.textContent = entry.title;

    var body = el.panelBody;
    body.textContent = '';

    var badges = document.createElement('div');
    badges.className = 'badges';
    [entry._label, entry.region].forEach(function (text) {
      if (!text) return;
      var b = document.createElement('span');
      b.className = 'badge';
      b.textContent = text;
      badges.appendChild(b);
    });
    var status = document.createElement('span');
    status.className = 'badge badge--status-' + entry.status;
    status.textContent = entry.status === 'draft' ? '검토 전 (draft)' : '검토 완료 (reviewed)';
    badges.appendChild(status);
    body.appendChild(badges);

    var period = document.createElement('p');
    period.className = 'period';
    period.textContent = T.periodLabel(entry.start_year, entry.end_year);
    body.appendChild(period);

    var sub = document.createElement('p');
    sub.className = 'period__sub';
    var span = entry.end_year - entry.start_year;
    var subParts = [];
    // era_note 가 자동 생성 문구와 같으면 위 줄과 중복이므로 생략한다.
    if (entry.era_note && entry.era_note !== period.textContent) subParts.push(entry.era_note);
    if (span > 0) subParts.push('약 ' + span + '년간');
    sub.textContent = subParts.join('  ·  ');
    body.appendChild(sub);

    // 항목에 summary 를 직접 적어 둔 경우에만 한 줄 요약을 따로 보여준다.
    if (entry.summary) {
      var lead = document.createElement('p');
      lead.className = 'panel__lead';
      lead.textContent = entry.summary;
      body.appendChild(lead);
    }

    var desc = document.createElement('p');
    desc.className = 'panel__desc';
    desc.textContent = entry.description;
    body.appendChild(desc);

    if (entry.tags && entry.tags.length) {
      var tags = document.createElement('div');
      tags.className = 'tag-list';
      entry.tags.forEach(function (tag) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag';
        btn.textContent = '#' + tag;
        btn.title = '"' + tag + '" 로 검색';
        btn.addEventListener('click', function () {
          el.search.value = tag;
          state.query = tag.toLowerCase();
          render();
        });
        tags.appendChild(btn);
      });
      body.appendChild(field('태그', tags));
    }

    if (entry.sources && entry.sources.length) {
      body.appendChild(field('참고 자료', listOf(entry.sources)));
    }

    var meta = document.createElement('p');
    meta.className = 'meta-id';
    meta.textContent = 'id: ' + entry.id + '  ·  파일: data/' + entry._file;
    body.appendChild(meta);

    el.panel.classList.add('is-open');
    el.panel.setAttribute('aria-hidden', 'false');
    el.panelBackdrop.hidden = false;
    el.copyHint.textContent = '';
  }

  function closePanel() {
    state.selected = null;
    el.panel.classList.remove('is-open');
    el.panel.setAttribute('aria-hidden', 'true');
    if (!isPopupOpen()) el.panelBackdrop.hidden = true;
    if (chart) chart.select(null);
  }

  function copySelectedJson() {
    if (!state.selected) return;
    var clean = {};
    Object.keys(state.selected).forEach(function (key) {
      if (key.charAt(0) !== '_') clean[key] = state.selected[key];
    });
    var text = JSON.stringify(clean, null, 2);

    var done = function (ok) {
      el.copyHint.textContent = ok ? '복사했습니다.' : '복사에 실패했습니다.';
      setTimeout(function () { el.copyHint.textContent = ''; }, 2500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      // 클립보드 API 가 없는 환경(오래된 웹뷰 등)을 위한 대비책
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
  }

  // -------------------------------------------------- 세부 연표 팝업

  function isPopupOpen() {
    return el.popup.classList.contains('is-open');
  }

  /** 세부 연표 한 줄 */
  function miniRow(entry, showLane) {
    var row = document.createElement('li');
    row.className = 'minitl__row';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'minitl__btn';
    btn.addEventListener('click', function () {
      closePopup();
      openPanel(entry);
      chart.select(entry.id);
    });

    var year = document.createElement('span');
    year.className = 'minitl__year';
    year.textContent = entry._isPoint
      ? T.yearLabel(entry.start_year)
      : T.yearLabel(entry.start_year) + ' ~';
    if (!entry._isPoint) year.title = T.periodLabel(entry.start_year, entry.end_year);
    btn.appendChild(year);

    var dot = document.createElement('span');
    dot.className = 'minitl__dot';
    dot.style.backgroundColor = entry._color;
    btn.appendChild(dot);

    var text = document.createElement('span');
    text.className = 'minitl__text';

    var title = document.createElement('b');
    title.textContent = entry.title;
    text.appendChild(title);

    if (showLane) {
      var lane = document.createElement('span');
      lane.className = 'minitl__lane';
      lane.textContent = entry._label;
      title.appendChild(lane);
    }

    var summary = document.createElement('em');
    summary.textContent = entry._summary;
    text.appendChild(summary);

    btn.appendChild(text);
    row.appendChild(btn);
    return row;
  }

  function openPopup(cluster) {
    var period = T.periodLabel(cluster.startYear, cluster.endYear);

    el.popupEyebrow.textContent = cluster.label + ' · 세부 연표';
    el.popupTitle.textContent = period + ' · ' + cluster.entries.length + '건';

    var body = el.popupBody;
    body.textContent = '';

    var list = document.createElement('ol');
    list.className = 'minitl';
    cluster.entries.forEach(function (entry) { list.appendChild(miniRow(entry, false)); });
    body.appendChild(list);

    // 같은 기간에 다른 트랙에서 무슨 일이 있었는지 — 빅 히스토리의 핵심 비교.
    // 이 구간에서 "시작한" 사건을 먼저 보여주고, 걸쳐 있기만 한 긴 항목은 뒤로 민다.
    var others = state.visible.filter(function (entry) {
      if (entry._dataset === cluster.dataset) return false;
      return entry.start_year <= cluster.endYear && entry.end_year >= cluster.startYear;
    }).sort(function (a, b) {
      var aIn = a.start_year >= cluster.startYear ? 0 : 1;
      var bIn = b.start_year >= cluster.startYear ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return a.start_year - b.start_year;
    });

    if (others.length) {
      var shown = others.slice(0, 14);
      var otherList = document.createElement('ol');
      otherList.className = 'minitl minitl--muted';
      shown.forEach(function (entry) { otherList.appendChild(miniRow(entry, true)); });

      var wrap = document.createElement('div');
      wrap.className = 'field';
      var label = document.createElement('p');
      label.className = 'field__label';
      label.textContent = '같은 기간 다른 트랙 (' + others.length + '건 중 ' + shown.length + '건)';
      wrap.appendChild(label);
      wrap.appendChild(otherList);
      if (others.length > shown.length) {
        var more = document.createElement('p');
        more.className = 'minitl__more';
        more.textContent = '나머지 ' + (others.length - shown.length) + '건은 연표에서 확인하세요.';
        wrap.appendChild(more);
      }
      body.appendChild(wrap);
    }

    el.popupZoom.onclick = function () {
      var pad = Math.max(2, Math.round((cluster.endYear - cluster.startYear) * 0.2));
      closePopup();
      chart.focusYears(cluster.startYear - pad, cluster.endYear + pad, true);
    };

    el.popup.classList.add('is-open');
    el.popup.setAttribute('aria-hidden', 'false');
    el.panelBackdrop.hidden = false;
  }

  function closePopup() {
    el.popup.classList.remove('is-open');
    el.popup.setAttribute('aria-hidden', 'true');
    if (!state.selected) el.panelBackdrop.hidden = true;
    if (chart) chart.select(null);
  }

  // ------------------------------------------------------------ 이벤트

  /** 좁은 화면에서는 필터 줄을 접어 연표에 화면을 내준다. */
  function setFiltersOpen(open) {
    el.filters.hidden = !open;
    el.filtersToggle.setAttribute('aria-expanded', String(open));
    if (chart) setTimeout(function () { chart.redraw(); }, 0);
  }

  function bindEvents() {
    el.search.addEventListener('input', debounce(function () {
      state.query = el.search.value.trim().toLowerCase();
      render();
    }, 120));

    el.searchClear.addEventListener('click', function () {
      el.search.value = '';
      state.query = '';
      el.search.focus();
      render();
    });

    el.draftOnly.addEventListener('change', function () {
      state.draftOnly = el.draftOnly.checked;
      render();
    });

    el.showSummary.addEventListener('change', function () {
      state.showSummary = el.showSummary.checked;
      renderItems();
    });

    el.orientation.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.seg-btn') : null;
      if (btn) setAxis(btn.getAttribute('data-axis'));
    });

    el.scrollMode.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.seg-btn') : null;
      if (btn) setScrollMode(btn.getAttribute('data-mode'));
    });

    el.reset.addEventListener('click', resetAll);
    el.emptyState.querySelector('[data-action="reset"]').addEventListener('click', resetAll);

    el.filtersToggle.addEventListener('click', function () {
      setFiltersOpen(el.filters.hidden);
    });

    el.panelClose.addEventListener('click', closePanel);
    el.popupClose.addEventListener('click', closePopup);
    el.panelBackdrop.addEventListener('click', function () {
      closePopup();
      closePanel();
    });
    el.copyJson.addEventListener('click', copySelectedJson);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (isPopupOpen()) closePopup();
        else if (state.selected) closePanel();
        else if (state.query) { el.search.value = ''; state.query = ''; render(); }
        return;
      }
      var typingTarget = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === '/' && !typingTarget) {
        e.preventDefault();
        el.search.focus();
        el.search.select();
      }
    });

    window.addEventListener('resize', debounce(function () {
      if (!chart) return;
      chart.redraw();
      if (bucketYears() !== state.lastBucket) renderItems();
    }, 200));
  }

  function showError(err) {
    el.loading.hidden = true;
    el.timeline.hidden = true;
    var box = document.createElement('div');
    box.className = 'error-box';
    var h = document.createElement('h2');
    h.textContent = '데이터를 불러오지 못했습니다';
    var p = document.createElement('p');
    p.textContent = String(err && err.message ? err.message : err);
    var hint = document.createElement('p');
    hint.innerHTML =
      'index.html 을 파일로 바로 열었다면 <code>npm run build</code> 로 ' +
      '<code>data/bundle.js</code> 를 만들어 주세요. ' +
      '또는 <code>npx serve</code> 로 간단한 로컬 서버를 띄우면 바로 동작합니다.';
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(hint);
    el.stage.appendChild(box);
  }

  // ------------------------------------------------------------ 시작

  function handleSelect(id) {
    if (!id) {
      if (!isPopupOpen()) closePanel();
      return;
    }
    if (state.clusters[id]) {          // 묶음 → 세부 연표 팝업
      closePanel();
      openPopup(state.clusters[id]);
      return;
    }
    var entry = state.data.entries.filter(function (e) { return e.id === id; })[0];
    if (entry) {
      closePopup();
      openPanel(entry);
    }
  }

  function start(data) {
    state.data = data;
    data.datasets.forEach(function (ds) {
      state.active[ds.id] = !ds.hidden_by_default;
    });

    buildEraPresets(data.eraPresets);
    buildFilters(data.tracks);
    bindEvents();
    setAxis('horizontal', true);
    setScrollMode('zoom');
    setFiltersOpen(window.innerWidth > 860);

    // 첫 페인트 직후 한 번 더 그려 레인 라벨 폭이 반영된 시간축을 얻는다.
    setTimeout(function () {
      chart.redraw();
      if (bucketYears() !== state.lastBucket) renderItems();
    }, 120);

    el.loading.hidden = true;
    if (data.source === 'bundle') {
      console.info('[app] data/bundle.js 에서 데이터를 읽었습니다 (file:// 모드).');
    }
  }

  window.BigHistoryData.load().then(start).catch(function (err) {
    console.error(err);
    showError(err);
  });

  // 오프라인 캐시(PWA). file:// 이나 서비스워커 미지원 환경에서는 조용히 건너뜁니다.
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.info('[pwa] 서비스워커 등록을 건너뜁니다.', err && err.message);
      });
    });
  }
})();
