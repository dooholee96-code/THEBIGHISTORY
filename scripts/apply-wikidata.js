#!/usr/bin/env node
'use strict';

/**
 * 대조 리포트의 Wikidata 번호를 항목에 붙인다 — 사람이 정한 대로만.
 *
 *   node scripts/apply-wikidata.js [리포트 json]
 *
 * 리포트(wikidata-match.json)는 인자로 주거나, 없으면 data/review/ 또는 data-review 브랜치에서 읽는다.
 * data/review/wikidata-decisions.json 의
 *   · accept  — 리포트가 고른 후보(best)를 그대로 붙인다
 *   · reject  — 붙이지 않는다(이미 붙어 있으면 뗀다)
 *   · manual  — { 항목 id: "Q번호" } 직접 지정(리포트보다 우선)
 * 연도·설명 같은 내용은 건드리지 않는다. 번호는 kind(없으면 title) 바로 뒤에 둔다.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DECISIONS = path.join(ROOT, 'data', 'review', 'wikidata-decisions.json');

function readReport() {
  const arg = process.argv[2];
  if (arg) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  const local = path.join(ROOT, 'data', 'review', 'wikidata-match.json');
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
  return JSON.parse(execFileSync('git', ['show', 'origin/data-review:data/review/wikidata-match.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

const report = readReport();
const dec = JSON.parse(fs.readFileSync(DECISIONS, 'utf8'));
const best = {};
report.results.forEach((r) => { if (r.best) best[r.id] = r.best.qid; });

const want = {};
dec.accept.forEach((id) => { if (best[id]) want[id] = best[id]; });
Object.keys(dec.manual || {}).forEach((id) => { want[id] = dec.manual[id]; });
Object.keys(dec.reject || {}).forEach((id) => { if (!(dec.manual || {})[id]) want[id] = null; });

function place(entry, qid) {
  const out = {};
  const after = entry.kind != null ? 'kind' : 'title';
  Object.keys(entry).forEach((k) => {
    if (k === 'wikidata') return;
    out[k] = entry[k];
    if (k === after && qid) out.wikidata = qid;
  });
  return out;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
let added = 0, changed = 0, removed = 0;
manifest.datasets.forEach((ds) => {
  const file = path.join(ROOT, 'data', ds.file);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let dirty = false;
  doc.entries = doc.entries.map((e) => {
    if (!(e.id in want)) return e;
    const q = want[e.id];
    if ((e.wikidata || null) === q) return e;
    if (!q) removed += 1; else if (e.wikidata) changed += 1; else added += 1;
    dirty = true;
    return place(e, q);
  });
  if (dirty) fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
});
console.log(`[wikidata] 붙임 ${added} · 바꿈 ${changed} · 뗌 ${removed}`);
