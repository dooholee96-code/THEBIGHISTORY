/* ------------------------------------------------------------------
   데이터 로딩 계층
   화면 코드와 완전히 분리되어 있습니다. 이 파일은 "어디서 어떻게 읽어올지"만
   담당하고, 무엇을 그릴지는 timeline.js / app.js 가 결정합니다.

   읽는 순서
     1) data/index.json (매니페스트) → 어떤 파일이 있는지 확인
     2) 매니페스트에 등록된 data/*.json 을 병렬로 읽음
     3) file:// 로 열어 fetch 가 막히면 data/bundle.js 로 자동 전환
        (bundle.js 는 `npm run build` 로 JSON 에서 생성되는 사본입니다)
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var DATA_DIR = 'data/';
  var BUNDLE_SRC = DATA_DIR + 'bundle.js';

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' — HTTP ' + res.status);
      return res.json();
    });
  }

  function loadBundleScript() {
    if (global.BIG_HISTORY_BUNDLE) return Promise.resolve(global.BIG_HISTORY_BUNDLE);
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = BUNDLE_SRC;
      script.onload = function () {
        if (global.BIG_HISTORY_BUNDLE) resolve(global.BIG_HISTORY_BUNDLE);
        else reject(new Error('data/bundle.js 를 읽었지만 BIG_HISTORY_BUNDLE 이 없습니다.'));
      };
      script.onerror = function () {
        reject(new Error('data/bundle.js 를 불러오지 못했습니다. `npm run build` 를 실행하세요.'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * 연표 막대에 함께 보여줄 "한 줄 요약".
   * 항목에 summary 가 있으면 그대로 쓰고, 없으면 description 의 첫 문장을
   * 한 줄 길이로 줄여서 만든다. (원본 JSON 은 건드리지 않는다)
   */
  function oneLineSummary(entry) {
    if (entry.summary) return entry.summary;

    var text = String(entry.description || '').trim();
    var stop = text.indexOf('. ');
    if (stop > 0) text = text.slice(0, stop + 1);

    var LIMIT = 44;
    if (text.length <= LIMIT) return text;

    // 쉼표 → 띄어쓰기 순으로 자연스러운 끊는 지점을 찾는다.
    var cut = text.slice(0, LIMIT);
    var comma = cut.lastIndexOf(', ');
    var space = cut.lastIndexOf(' ');
    if (comma > LIMIT * 0.4) cut = cut.slice(0, comma);
    else if (space > LIMIT * 0.6) cut = cut.slice(0, space);
    return cut + '…';
  }

  /** 매니페스트 + 파일 내용을 앱이 쓰기 좋은 형태로 정리한다. */
  function normalize(manifest, fileContents, source) {
    var datasets = (manifest.datasets || [])
      .slice()
      .sort(function (a, b) {
        return (a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order);
      })
      .map(function (ds) {
        var doc = fileContents[ds.file];
        var entries = (doc && doc.entries ? doc.entries : []).map(function (entry) {
          // 원본은 건드리지 않고 화면용 파생 필드만 덧붙인다.
          var copy = Object.assign({}, entry);
          copy._dataset = ds.id;
          copy._label = ds.label;
          copy._color = ds.color;
          copy._track = ds.track;
          copy._file = ds.file;
          copy._summary = oneLineSummary(entry);
          copy._isPoint = entry.start_year === entry.end_year;
          copy._search = [
            entry.title,
            entry.description,
            entry.category,
            entry.subcategory,
            entry.region,
            entry.era_note,
            entry.summary,
            (entry.tags || []).join(' ')
          ].join(' ').toLowerCase();
          return copy;
        });
        entries.sort(function (a, b) { return a.start_year - b.start_year; });
        return Object.assign({}, ds, { entries: entries });
      });

    var all = [];
    datasets.forEach(function (ds) { all = all.concat(ds.entries); });

    var tracks = (manifest.tracks || [])
      .slice()
      .sort(function (a, b) {
        return (a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order);
      })
      .map(function (track) {
        return Object.assign({}, track, {
          datasets: datasets.filter(function (ds) { return ds.track === track.id; })
        });
      })
      // 매니페스트에 tracks 로 등록되지 않은 데이터셋이 있어도 화면에서 사라지지 않게 한다.
      .filter(function (track) { return track.datasets.length > 0; });

    var knownTrackIds = {};
    tracks.forEach(function (t) { knownTrackIds[t.id] = true; });
    var orphans = datasets.filter(function (ds) { return !knownTrackIds[ds.track]; });
    if (orphans.length) {
      tracks.push({
        id: '_other',
        label: '기타',
        datasets: orphans
      });
    }

    var years = all.reduce(function (acc, e) {
      return {
        min: Math.min(acc.min, e.start_year),
        max: Math.max(acc.max, e.end_year)
      };
    }, { min: Infinity, max: -Infinity });

    return {
      manifest: manifest,
      datasets: datasets,
      tracks: tracks,
      entries: all,
      range: all.length ? years : { min: -3000, max: 2030 },
      eraPresets: manifest.era_presets || [],
      defaultWindow: manifest.default_window || null,
      source: source
    };
  }

  function loadFromBundle() {
    return loadBundleScript().then(function (bundle) {
      return normalize(bundle.manifest, bundle.files || {}, 'bundle');
    });
  }

  function loadFromFetch() {
    return fetchJson(DATA_DIR + 'index.json').then(function (manifest) {
      var files = (manifest.datasets || []).map(function (ds) { return ds.file; });
      return Promise.all(files.map(function (file) {
        return fetchJson(DATA_DIR + file);
      })).then(function (docs) {
        var contents = {};
        files.forEach(function (file, i) { contents[file] = docs[i]; });
        return normalize(manifest, contents, 'fetch');
      });
    });
  }

  function load() {
    // file:// 에서는 fetch 가 CORS 로 막히므로 곧바로 번들을 쓴다.
    if (global.location && global.location.protocol === 'file:') {
      return loadFromBundle();
    }
    return loadFromFetch().catch(function (err) {
      console.warn('[data] fetch 실패 — data/bundle.js 로 대체합니다.', err);
      return loadFromBundle();
    });
  }

  global.BigHistoryData = { load: load };
})(window);
