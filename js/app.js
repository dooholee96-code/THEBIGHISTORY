/* ------------------------------------------------------------------
   앱 조립부 — 툴바 / 필터 / 검색 / 상세 패널과 연표를 연결합니다.
   데이터 구조를 모르는 코드가 없도록, 화면에 필요한 정보는 모두
   data/index.json(매니페스트)에서 흘러나옵니다.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var T = window.BigHistoryTimeline;

  var el = {
    toolbar: document.getElementById('toolbar'),
    search: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    eras: document.getElementById('era-presets'),
    filters: document.getElementById('filters'),
    filtersToggle: document.getElementById('filters-toggle'),
    filterGroups: document.getElementById('filter-groups'),
    draftOnly: document.getElementById('draft-only'),
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
    copyHint: document.getElementById('copy-hint')
  };

  var state = {
    data: null,
    active: {},        // datasetId -> boolean
    query: '',
    draftOnly: false,
    era: null,
    selected: null
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

  // ------------------------------------------------------------ 렌더

  function render() {
    var data = state.data;
    if (!data) return;

    var visible = data.entries.filter(matches);

    var counts = {};
    data.datasets.forEach(function (ds) { counts[ds.id] = 0; });
    visible.forEach(function (e) { counts[e._dataset] += 1; });

    // 칩 상태 갱신
    data.datasets.forEach(function (ds) {
      var node = chipNodes[ds.id];
      if (!node) return;
      var on = !!state.active[ds.id];
      node.chip.classList.toggle('is-on', on);
      node.chip.setAttribute('aria-pressed', String(on));
      node.count.textContent = on ? String(counts[ds.id]) : '';
    });

    chart.setStructure(data.tracks, activeIds(), counts);
    chart.setEntries(visible);

    var draftCount = visible.filter(function (e) { return e.status === 'draft'; }).length;
    el.statusText.textContent =
      '총 ' + data.entries.length + '개 중 ' + visible.length + '개 표시' +
      ' · 검토 전 ' + draftCount + '개';

    el.emptyState.hidden = visible.length > 0;
    el.searchClear.hidden = !state.query;

    if (state.selected && !visible.some(function (e) { return e.id === state.selected.id; })) {
      closePanel();
    }
  }

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

  function resetAll() {
    state.query = '';
    state.draftOnly = false;
    el.search.value = '';
    el.draftOnly.checked = false;
    state.data.datasets.forEach(function (ds) {
      state.active[ds.id] = !ds.hidden_by_default;
    });
    closePanel();
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
    el.panelBackdrop.hidden = true;
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

  /** 좁은 화면에서는 필터 줄을 접어 연표에 화면을 내준다. */
  function setFiltersOpen(open) {
    el.filters.hidden = !open;
    el.filtersToggle.setAttribute('aria-expanded', String(open));
    if (chart) setTimeout(function () { chart.redraw(); }, 0);
  }

  // ------------------------------------------------------------ 이벤트

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

    el.reset.addEventListener('click', resetAll);
    el.emptyState.querySelector('[data-action="reset"]').addEventListener('click', resetAll);

    el.filtersToggle.addEventListener('click', function () {
      setFiltersOpen(el.filters.hidden);
    });

    el.panelClose.addEventListener('click', closePanel);
    el.panelBackdrop.addEventListener('click', closePanel);
    el.copyJson.addEventListener('click', copySelectedJson);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.selected) closePanel();
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
      if (chart) chart.redraw();
    }, 150));
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

  function start(data) {
    state.data = data;
    data.datasets.forEach(function (ds) {
      state.active[ds.id] = !ds.hidden_by_default;
    });

    chart = T.create(el.timeline, {
      window: data.defaultWindow,
      onSelect: function (id) {
        if (!id) { closePanel(); return; }
        var entry = data.entries.filter(function (e) { return e.id === id; })[0];
        if (entry) openPanel(entry);
      }
    });

    var pad = Math.max(50, Math.round((data.range.max - data.range.min) * 0.03));
    chart.setLimits(data.range.min - pad, data.range.max + pad);

    buildEraPresets(data.eraPresets);
    buildFilters(data.tracks);
    bindEvents();
    render();
    setFiltersOpen(window.innerWidth > 860);

    // 첫 페인트 직후 한 번 더 그려 레인 라벨 폭이 반영된 시간축을 얻는다.
    setTimeout(function () { chart.redraw(); }, 120);

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
