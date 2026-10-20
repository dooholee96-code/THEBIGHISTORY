#!/usr/bin/env node
'use strict';

/**
 * 데이터 검증 스크립트.
 *
 *   node scripts/validate.js          # 검증만
 *   node scripts/validate.js --fix    # era_note 자동 채움/교정 후 다시 검증
 *   node scripts/validate.js --quiet  # 요약만 출력
 *
 * 검사 내용
 *  1) data/index.json 이 schema/index.schema.json 을 만족하는가
 *  2) 매니페스트에 등록된 파일이 모두 존재하고 schema/entries.schema.json 을 만족하는가
 *  3) data/ 안에 있는데 매니페스트에 등록되지 않은 JSON 파일이 있는가
 *  4) id 가 전체에서 유일한가
 *  5) start_year <= end_year, 연도 0 사용 금지
 *  6) 각 항목의 category/subcategory 가 매니페스트 등록값과 일치하는가
 *  7) era_note 가 연도와 어긋나지 않는가
 *  8) 갈림길 시나리오(data/alt/) — 스키마, 노드 연결, 확률 합, 실제 항목 연결
 */

const fs = require('fs');
const path = require('path');
const { validate } = require('./lib/jsonschema.js');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SCHEMA_DIR = path.join(ROOT, 'schema');
const MANIFEST = path.join(DATA_DIR, 'index.json');

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const QUIET = args.includes('--quiet');

const errors = [];
const warnings = [];
const DESC_MAX = 100;   // 설명 길이 한도(글자)
const fixes = [];

const rel = (p) => path.relative(ROOT, p);
const fail = (file, message) => errors.push(`${rel(file)}: ${message}`);
const warn = (file, message) => warnings.push(`${rel(file)}: ${message}`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(file, `JSON 을 읽을 수 없습니다 — ${err.message}`);
    return null;
  }
}

function yearLabel(year) {
  return year < 0 ? `기원전 ${Math.abs(year)}년` : `${year}년`;
}

function expectedEraNote(entry) {
  return entry.start_year === entry.end_year
    ? yearLabel(entry.start_year)
    : `${yearLabel(entry.start_year)} ~ ${yearLabel(entry.end_year)}`;
}

// ---------------------------------------------------------------- 매니페스트
const indexSchema = readJson(path.join(SCHEMA_DIR, 'index.schema.json'));
const entriesSchema = readJson(path.join(SCHEMA_DIR, 'entries.schema.json'));
const manifest = readJson(MANIFEST);

if (!indexSchema || !entriesSchema || !manifest) {
  report();
}

for (const e of validate(indexSchema, manifest)) {
  fail(MANIFEST, `${e.path} — ${e.message}`);
}

const trackIds = new Set((manifest.tracks || []).map((t) => t.id));
const seenDatasetIds = new Map();
const seenFiles = new Map();
const seenLabels = new Map();

for (const ds of manifest.datasets || []) {
  if (seenDatasetIds.has(ds.id)) fail(MANIFEST, `dataset id 가 중복됩니다: "${ds.id}"`);
  seenDatasetIds.set(ds.id, ds);

  if (seenFiles.has(ds.file)) fail(MANIFEST, `같은 파일이 두 번 등록되었습니다: "${ds.file}"`);
  seenFiles.set(ds.file, ds);

  if (seenLabels.has(ds.label)) warn(MANIFEST, `표시 이름(label)이 중복됩니다: "${ds.label}"`);
  seenLabels.set(ds.label, ds);

  if (!trackIds.has(ds.track)) {
    fail(MANIFEST, `dataset "${ds.id}" 의 track "${ds.track}" 이 tracks 에 없습니다.`);
  }
}

// ----------------------------------------------------------- 시대 장면 검사
for (const era of manifest.eras || []) {
  const where = `eras "${era.id}"`;
  const art = [era.diorama].concat((era.scenes || []).map((sc) => sc.diorama)).filter(Boolean);
  for (const file of art) {
    if (!fs.existsSync(path.join(ROOT, file))) fail(MANIFEST, `${where} — 그림 파일이 없습니다: ${file}`);
  }
  const scenes = era.scenes || [];
  const ids = new Set();
  scenes.forEach((sc, i) => {
    if (ids.has(sc.id)) fail(MANIFEST, `${where} — 장면 id 가 중복됩니다: "${sc.id}"`);
    ids.add(sc.id);
    if (sc.start_year < era.start_year || sc.start_year >= era.end_year) {
      fail(MANIFEST, `${where} 장면 "${sc.id}" — 시작 연도(${sc.start_year})가 시대 범위 밖입니다.`);
    }
    if (i > 0 && sc.start_year <= scenes[i - 1].start_year) {
      fail(MANIFEST, `${where} 장면 "${sc.id}" — 장면은 시작 연도 순으로 적습니다.`);
    }
  });
  if (scenes.length && scenes[0].start_year !== era.start_year) {
    warn(MANIFEST, `${where} — 첫 장면은 시대 시작(${era.start_year})부터 잡는 것이 자연스럽습니다.`);
  }
}

// ----------------------------------------------------------- 데이터 파일 검사
const globalIds = new Map();
const wikidataIds = new Map();   // Q번호 → 처음 쓴 항목 id
let wikidataCount = 0;
let entryCount = 0;
let draftCount = 0;
let sourcedCount = 0;

for (const ds of manifest.datasets || []) {
  const file = path.join(DATA_DIR, ds.file);
  if (!fs.existsSync(file)) {
    fail(MANIFEST, `dataset "${ds.id}" 이 가리키는 파일이 없습니다: data/${ds.file}`);
    continue;
  }

  const doc = readJson(file);
  if (!doc) continue;

  const schemaErrors = validate(entriesSchema, doc);
  for (const e of schemaErrors) fail(file, `${e.path} — ${e.message}`);
  if (schemaErrors.length) continue;

  if (doc.dataset && doc.dataset !== ds.id) {
    fail(file, `dataset 값 "${doc.dataset}" 이 매니페스트의 id "${ds.id}" 와 다릅니다.`);
  }

  let dirty = false;

  doc.entries.forEach((entry, i) => {
    const where = `entries[${i}] "${entry.id}"`;
    entryCount += 1;
    if (entry.status === 'draft') draftCount += 1;
    if (entry.sources && entry.sources.length) sourcedCount += 1;

    if (globalIds.has(entry.id)) {
      fail(file, `${where} — id 가 ${globalIds.get(entry.id)} 와 중복됩니다.`);
    } else {
      globalIds.set(entry.id, `data/${ds.file}`);
    }

    // Wikidata 번호 — 형식, 그리고 두 항목이 같은 번호를 쓰면(같은 것을 두 번 넣었을 수 있음) 알린다
    if (entry.wikidata != null) {
      if (!/^Q[1-9][0-9]*$/.test(entry.wikidata)) {
        fail(file, `${where} — wikidata 는 Q 로 시작하는 번호여야 합니다: "${entry.wikidata}"`);
      } else if (wikidataIds.has(entry.wikidata)) {
        warn(file, `${where} — wikidata ${entry.wikidata} 를 ${wikidataIds.get(entry.wikidata)} 도 씁니다.`);
      } else {
        wikidataIds.set(entry.wikidata, entry.id);
      }
      wikidataCount += 1;
    }

    if (entry.start_year > entry.end_year) {
      fail(file, `${where} — start_year(${entry.start_year}) 가 end_year(${entry.end_year}) 보다 큽니다.`);
    }
    if (entry.start_year === 0 || entry.end_year === 0) {
      fail(file, `${where} — 연도 0 은 사용하지 않습니다. 기원전 1년은 -1, 서기 1년은 1 입니다.`);
    }
    if (entry.category !== ds.category) {
      fail(file, `${where} — category "${entry.category}" 가 매니페스트의 "${ds.category}" 와 다릅니다.`);
    }
    if (entry.subcategory !== ds.subcategory) {
      fail(file, `${where} — subcategory "${entry.subcategory}" 가 매니페스트의 "${ds.subcategory}" 와 다릅니다.`);
    }

    const wanted = expectedEraNote(entry);
    if (!entry.era_note) {
      if (FIX) {
        entry.era_note = wanted;
        dirty = true;
        fixes.push(`data/${ds.file}: ${entry.id} — era_note 를 "${wanted}" 로 채웠습니다.`);
      } else {
        warn(file, `${where} — era_note 가 비어 있습니다. (--fix 로 자동 생성: "${wanted}")`);
      }
    } else if (entry.era_note !== wanted) {
      // 연도가 들어간 era_note 인데 실제 연도와 다르면 알려준다(자유 서술은 그대로 둔다).
      const digitsInNote = (entry.era_note.match(/\d+/g) || []).map(Number);
      const digitsInYears = [Math.abs(entry.start_year), Math.abs(entry.end_year)];
      const mismatched = digitsInNote.length > 0 && !digitsInNote.some((n) => digitsInYears.includes(n));
      if (mismatched) {
        warn(file, `${where} — era_note("${entry.era_note}") 가 연도(${entry.start_year}~${entry.end_year})와 어긋나 보입니다.`);
      }
    }

    // 라이선스 주의: 위키 계열은 CC BY-SA 라 문장을 옮기면 데이터 전체가 묶인다.
    // 링크를 '확인용 자료'로 적는 것은 문제가 없으므로 경고로만 알린다.
    (entry.sources || []).forEach(function (src) {
      if (/wikipedia\.org|namu\.wiki|wikiwand/i.test(src)) {
        warn(file, `${where} — 위키 계열 자료(${src}) 는 확인용으로만 쓰고 문장을 옮기지 마세요. (data/LICENSE.md 참고)`);
      }
    });

    // 설명은 한 문장짜리 간략 해설만 — 팝업에도 연도·사건·설명·출처만 나온다.
    const desc = String(entry.description || '').trim();
    const sentences = desc.split(/(?<=[.!?。])\s+/).filter(Boolean).length;
    if (sentences > 1 || desc.length > DESC_MAX) {
      warn(file, `${where} — 설명은 한 문장, ${DESC_MAX}자 이내로 적어 주세요(지금 ${sentences}문장 ${desc.length}자).`);
    }

    // 왕조·국가사는 kind 가 있어야 색 띠와 '지금 이때'에 들어간다(없으면 빠진다).
    if (ds.track === 'nation' && !entry.kind) {
      warn(file, `${where} — kind 가 없습니다. 왕조·국가사 항목은 polity / era / trend / event 중 하나를 적어 주세요.`);
    }

    // 출처 정책: draft 는 출처가 없어도 되지만, reviewed 로 올리려면 반드시 있어야 한다.
    if (entry.status === 'reviewed' && (!entry.sources || entry.sources.length === 0)) {
      fail(file, `${where} — status 가 reviewed 인데 sources 가 비어 있습니다. 확인한 자료를 적거나 draft 로 되돌리세요.`);
    }
  });

  if (dirty) {
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
}

// ------------------------------------------------ 갈림길(대체역사) 시나리오
// 가상의 역사는 data/alt/ 에만 두고 실제 연표 매니페스트와 섞지 않는다.
const ALT_DIR = path.join(DATA_DIR, 'alt');
const ALT_INDEX = path.join(ALT_DIR, 'index.json');
let scenarioCount = 0;

if (fs.existsSync(ALT_INDEX)) {
  const altIndexSchema = readJson(path.join(SCHEMA_DIR, 'alt-index.schema.json'));
  const scenarioSchema = readJson(path.join(SCHEMA_DIR, 'scenario.schema.json'));
  const altIndex = readJson(ALT_INDEX);

  if (altIndexSchema && scenarioSchema && altIndex) {
    for (const e of validate(altIndexSchema, altIndex)) fail(ALT_INDEX, `${e.path} — ${e.message}`);

    const altFiles = new Set();
    const altIds = new Set();
    for (const item of altIndex.scenarios || []) {
      if (altIds.has(item.id)) fail(ALT_INDEX, `시나리오 id 가 중복됩니다: "${item.id}"`);
      altIds.add(item.id);
      altFiles.add(item.file);

      const file = path.join(ALT_DIR, item.file);
      if (!fs.existsSync(file)) {
        fail(ALT_INDEX, `시나리오 "${item.id}" 의 파일이 없습니다: data/alt/${item.file}`);
        continue;
      }
      const doc = readJson(file);
      if (!doc) continue;
      const schemaErrors = validate(scenarioSchema, doc);
      for (const e of schemaErrors) fail(file, `${e.path} — ${e.message}`);
      if (schemaErrors.length) continue;

      scenarioCount += 1;
      checkScenario(file, doc, item.id);
    }

    for (const name of fs.readdirSync(ALT_DIR)) {
      if (name.endsWith('.json') && name !== 'index.json' && !altFiles.has(name)) {
        warn(ALT_INDEX, `data/alt/${name} 이 목록에 등록되어 있지 않아 화면에 나오지 않습니다.`);
      }
    }
  }
}

/** 노드가 끊김 없이 이어지고, 모든 길이 결말에 닿는지 */
function checkScenario(file, doc, listedId) {
  if (doc.id !== listedId) fail(file, `id "${doc.id}" 가 data/alt/index.json 의 "${listedId}" 와 다릅니다.`);

  const nodes = new Map();
  for (const node of doc.nodes) {
    if (nodes.has(node.id)) fail(file, `노드 id 가 중복됩니다: "${node.id}"`);
    nodes.set(node.id, node);
  }

  if (!globalIds.has(doc.anchor.entry)) {
    fail(file, `anchor.entry "${doc.anchor.entry}" 가 실제 연표에 없습니다.`);
  }
  for (const id of doc.compare || []) {
    if (!seenDatasetIds.has(id)) fail(file, `compare 의 "${id}" 가 data/index.json 의 카테고리에 없습니다.`);
  }
  if (!nodes.has(doc.start)) {
    fail(file, `start "${doc.start}" 노드가 없습니다.`);
    return;
  }

  const edges = new Map();   // id → [다음 노드 id]
  for (const node of doc.nodes) {
    const where = `노드 "${node.id}"`;
    const out = [];
    if (node.end_year != null && node.end_year < node.year) fail(file, `${where} — end_year 가 year 보다 이릅니다.`);
    if (node.year === 0 || node.end_year === 0) fail(file, `${where} — 연도 0 은 사용하지 않습니다.`);
    for (const id of node.real || []) {
      if (!globalIds.has(id)) fail(file, `${where} — real 의 "${id}" 가 실제 연표에 없습니다.`);
    }

    if (node.kind === 'event') {
      if (!node.next) fail(file, `${where} — 사건(event)에는 next 가 있어야 합니다.`);
      else out.push(node.next);
      if (node.options) fail(file, `${where} — 사건(event)에는 options 를 쓰지 않습니다(갈림길이면 kind 를 choice 로).`);
    } else if (node.kind === 'choice') {
      if (!node.options) fail(file, `${where} — 갈림길(choice)에는 options 가 있어야 합니다.`);
      if (node.next) fail(file, `${where} — 갈림길(choice)에는 next 를 쓰지 않습니다.`);
      (node.options || []).forEach((opt, i) => {
        const has = (opt.to ? 1 : 0) + (opt.outcomes ? 1 : 0);
        if (has !== 1) fail(file, `${where} options[${i}] — to 와 outcomes 중 정확히 하나만 적습니다.`);
        if (opt.to) out.push(opt.to);
        if (opt.outcomes) {
          const sum = opt.outcomes.reduce((n, o) => n + o.chance, 0);
          if (Math.abs(sum - 1) > 0.001) fail(file, `${where} options[${i}] — outcomes 의 chance 합이 1 이 아닙니다(${sum}).`);
          opt.outcomes.forEach((o) => out.push(o.to));
        }
      });
    } else if (node.kind === 'ending') {
      if (node.next || node.options) fail(file, `${where} — 결말(ending)에는 next·options 를 쓰지 않습니다.`);
      if (!node.reality) warn(file, `${where} — 결말에는 '실제로는 ~'(reality)을 적어 두면 좋습니다.`);
    }

    for (const to of out) {
      if (!nodes.has(to)) { fail(file, `${where} — 이어지는 노드 "${to}" 가 없습니다.`); continue; }
      const next = nodes.get(to);
      if (next.year < node.year) warn(file, `${where} → "${to}" — 연도가 거꾸로 갑니다(${node.year} → ${next.year}).`);
    }
    edges.set(node.id, out.filter((to) => nodes.has(to)));
  }

  // 되돌아오는 고리가 없고(끝나지 않는 이야기 방지), 시작에서 모든 노드에 닿는지
  const state = new Map();   // 1 = 방문 중, 2 = 끝
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { fail(file, `노드 "${id}" 에서 고리가 생깁니다 — 이야기가 끝나지 않습니다.`); return; }
    state.set(id, 1);
    for (const to of edges.get(id) || []) visit(to);
    state.set(id, 2);
  };
  visit(doc.start);
  for (const id of nodes.keys()) {
    if (!state.has(id)) warn(file, `노드 "${id}" 는 시작에서 닿지 않습니다(쓰이지 않음).`);
  }

  if (nodes.get(doc.start).year < doc.anchor.year) {
    warn(file, `첫 노드의 연도(${nodes.get(doc.start).year})가 갈림길 연도(${doc.anchor.year})보다 이릅니다.`);
  }
}

// --------------------------------------------------- 등록되지 않은 파일 찾기
for (const name of fs.readdirSync(DATA_DIR)) {
  if (!name.endsWith('.json') || name === 'index.json') continue;
  if (!seenFiles.has(name)) {
    warn(MANIFEST, `data/${name} 이 매니페스트에 등록되어 있지 않아 화면에 나오지 않습니다.`);
  }
}

report();

// ------------------------------------------------------------------- 출력
function report() {
  if (fixes.length && !QUIET) {
    console.log('\n[수정됨]');
    for (const f of fixes) console.log('  ✎ ' + f);
  }
  if (warnings.length && !QUIET) {
    console.log('\n[경고] ' + warnings.length + '건');
    for (const w of warnings) console.log('  ! ' + w);
  }
  if (errors.length) {
    console.error('\n[오류] ' + errors.length + '건');
    for (const e of errors) console.error('  ✗ ' + e);
    console.error(`\n검증 실패: 오류 ${errors.length}건, 경고 ${warnings.length}건`);
    process.exit(1);
  }
  console.log(
    `\n검증 통과 — 데이터셋 ${seenDatasetIds.size}개, 항목 ${entryCount}개 ` +
    `(draft ${draftCount}개 / reviewed ${entryCount - draftCount}개), 갈림길 시나리오 ${scenarioCount}개, ` +
    `경고 ${warnings.length}건`
  );
  console.log(`Wikidata 연결: ${wikidataCount}/${entryCount}개 항목`);
  if (sourcedCount < entryCount) {
    console.log(
      `출처 표기: ${sourcedCount}/${entryCount}개 항목에 확인한 자료가 적혀 있습니다. ` +
      `나머지 ${entryCount - sourcedCount}개는 '출처 미확인' 상태입니다.`
    );
  }
  process.exit(0);
}
