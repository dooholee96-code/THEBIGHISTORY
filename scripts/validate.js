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

// ----------------------------------------------------------- 데이터 파일 검사
const globalIds = new Map();
let entryCount = 0;
let draftCount = 0;

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

    if (globalIds.has(entry.id)) {
      fail(file, `${where} — id 가 ${globalIds.get(entry.id)} 와 중복됩니다.`);
    } else {
      globalIds.set(entry.id, `data/${ds.file}`);
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

    if (!entry.sources || entry.sources.length === 0) {
      warn(file, `${where} — sources 가 비어 있습니다.`);
    }
  });

  if (dirty) {
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
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
    `(draft ${draftCount}개 / reviewed ${entryCount - draftCount}개), 경고 ${warnings.length}건`
  );
  process.exit(0);
}
