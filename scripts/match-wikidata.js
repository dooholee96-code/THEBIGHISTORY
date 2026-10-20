#!/usr/bin/env node
'use strict';

/**
 * 우리 항목 ↔ Wikidata(·Cliopatria) 대조 리포트.
 *
 *   node scripts/match-wikidata.js          # 받아 둔 응답(.cache/sources)이 있으면 그대로 쓴다
 *   node scripts/match-wikidata.js --fresh  # 모두 새로 받기
 *
 * 항목마다 제목으로 Wikidata 를 찾고(이름·별칭), 후보의 시작·끝 연도를 우리 연도와 견준다.
 * 결과는 data/review/ 에 남긴다 — 데이터 파일은 고치지 않는다(사람이 보고 정한다).
 *   · wikidata-match.json  항목별 후보·연도·판정(기계용)
 *   · wikidata-report.md   카테고리별 표(사람용)
 *
 * 판정
 *   일치       시작·끝 모두 허용 오차 안(오차는 Wikidata 정밀도에 따라 1년·10년·100년…)
 *   부분 일치  둘 중 하나만 맞음 — 기간을 다르게 잡았거나 한쪽 연도가 다를 수 있다
 *   어긋남     이름은 같은데 연도가 다름 — 우선 확인할 것
 *   날짜 없음  찾았지만 Wikidata 에 연도가 없음
 *   못 찾음    한국어 이름으로 찾지 못함(복합 주제·우리만의 묶음 이름 등)
 */

const fs = require('fs');
const path = require('path');
const wd = require('./sources/wikidata');
const clio = require('./sources/cliopatria');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'review');

// ------------------------------------------------------------ 항목 읽기

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const entries = [];
manifest.datasets.forEach((ds) => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', ds.file), 'utf8'));
  doc.entries.forEach((e) => entries.push(Object.assign({ _ds: ds.id, _dsLabel: ds.label, _track: ds.track }, e)));
});

// ------------------------------------------------------------ 검색어

function norm(s) {
  return String(s || '').replace(/[\s·・,.'"『』「」《》()（）\-–]/g, '').toLowerCase();
}

const HAN = /[\u3400-\u9fff]/;

/**
 * 제목에서 찾아볼 이름들. full = 제목 그대로(또는 괄호만 뺀 것) — 이름이 같으면 같은 것으로 본다.
 * part = 괄호 속·'와/과/·'로 나눈 조각·뒤쪽 낱말 — 조각만 같은 엉뚱한 것(영화 '탄생', 정당 '당')이
 * 많아서, 연도까지 맞을 때만 인정한다.
 * 중국 왕조처럼 한 글자 이름은 'X나라'로, 한자가 있으면 중국어로도 찾는다.
 */
function termsOf(entry) {
  const title = entry.title;
  const clean = title.replace(/[『』「」《》]/g, '').trim();
  const out = [{ t: clean, full: true, lang: 'ko' }];
  const base = clean.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (base && base !== clean) out.push({ t: base, full: true, lang: 'ko' });
  if (entry._ds === 'china' && base.length <= 2) {
    out.push({ t: base + '나라', full: true, lang: 'ko' }, { t: base + ' 왕조', full: true, lang: 'ko' });
  }
  (clean.match(/[(（]([^)）]+)[)）]/g) || []).forEach((p) => {
    p.slice(1, -1).split(/[·,]/).forEach((x) => {
      x = x.replace(/\s*중심$/, '').trim();
      if (HAN.test(x)) out.push({ t: x, full: true, lang: 'zh' }, { t: x + '朝', full: true, lang: 'zh' });
      else if (x.length >= 2) out.push({ t: x, full: false, lang: 'ko' });
    });
  });
  base.split(/\s*(?:와|과|및|·)\s+|·/).forEach((x) => { x = x.trim(); if (x.length >= 2 && x !== base) out.push({ t: x, full: false, lang: 'ko' }); });
  // '뉴턴 프린키피아' 처럼 사람 + 작품이면 뒤쪽(작품)도
  const words = base.split(' ');
  if (words.length >= 2) out.push({ t: words.slice(1).join(' '), full: false, lang: 'ko' });
  const seen = {};
  return out.filter((x) => { const k = x.lang + ':' + x.t; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 8);
}

// ------------------------------------------------------------ 점수

function slack(year) {
  if (year < -1000) return 25;   // 아주 먼 옛날은 문헌·학설마다 수십 년씩 다르다
  if (year < 500) return 5;
  return 1;
}

function closest(list, year) {
  let best = null;
  list.forEach((d) => { if (!best || Math.abs(d.year - year) < Math.abs(best.year - year)) best = d; });
  return best;
}

function judge(entry, cand, term, full) {
  const s = closest(cand.start, entry.start_year);
  const e = closest(cand.end, entry.end_year);
  const single = entry.start_year === entry.end_year;
  const tolS = s ? Math.max(wd.tolerance(s.precision), slack(entry.start_year)) : 0;
  const tolE = e ? Math.max(wd.tolerance(e.precision), slack(entry.end_year)) : 0;
  const startOk = !!s && Math.abs(s.year - entry.start_year) <= tolS;
  // 한 해짜리 사건은 끝이 없거나, 시작 연도가 맞으면 끝도 맞은 것으로
  const endOk = e ? Math.abs(e.year - entry.end_year) <= tolE : (single && startOk);
  const exact = full && (norm(cand.ko) === norm(term) || norm(cand.ko) === norm(entry.title) || !!cand.zhExact);
  let score = 0;
  if (exact) score += 3;
  if (!full && !startOk && !endOk) score -= 4;   // 조각 이름만 같고 연도도 안 맞으면 남의 것
  if (startOk) score += 2.2;
  if (endOk) score += 2;
  if (s || e) score += 0.5;
  score += Math.log(1 + (cand.sitelinks || 0)) * 0.25;
  return { s: s, e: e, startOk: startOk, endOk: endOk, exact: exact, score: score };
}

function verdict(entry, best) {
  if (!best) return '못 찾음';
  const j = best.j;
  if (!j.exact && !j.startOk && !j.endOk) return '못 찾음';   // 이름도 연도도 확실하지 않으면 후보일 뿐
  if (!j.s && !j.e) return j.exact ? '날짜 없음' : '못 찾음';
  if (j.startOk && j.endOk) return '일치';
  if (j.startOk || j.endOk) return '부분 일치';
  return j.exact ? '어긋남' : '못 찾음';
}

// ------------------------------------------------------------ 실행

console.log(`[대조] 항목 ${entries.length}개 — Wikidata 에서 찾는 중`);
const termsBy = entries.map((e) => termsOf(e));
const all = [].concat.apply([], termsBy);
const found = {};
['ko', 'zh'].forEach((lang) => {
  const got = wd.searchMany(all.filter((x) => x.lang === lang).map((x) => x.t), lang, 8);
  Object.keys(got).forEach((t) => { found[lang + ':' + t] = got[t]; });
});
console.log('');

const qids = new Set();
Object.keys(found).forEach((t) => found[t].forEach((r) => qids.add(r.qid)));
console.log(`[대조] 후보 ${qids.size}개의 이름·연도 읽는 중`);
const info = wd.describe(Array.from(qids));
console.log('');

console.log('[대조] Cliopatria 읽는 중');
let C = null;
try { C = clio.load(); } catch (err) { console.warn('  Cliopatria 를 건너뜁니다: ' + err.message); }

const results = entries.map((entry, i) => {
  const cands = [];
  termsBy[i].forEach((term) => {
    (found[term.lang + ':' + term.t] || []).forEach((r) => {
      const c = info[r.qid];
      if (!c || cands.some((x) => x.c.qid === r.qid)) return;
      // 중국어로 찾은 것은 검색 1위면 이름이 같은 것으로 본다(한국어 이름이 없을 수 있어서)
      const j = judge(entry, Object.assign({}, c, { zhExact: term.lang === 'zh' && r.rank === 0 }), term.t, term.full);
      j.score += (8 - r.rank) * 0.1;   // 검색 순위가 높을수록 조금 더
      cands.push({ c: c, j: j, term: term.t });
    });
  });
  cands.sort((a, b) => b.j.score - a.j.score);
  const best = cands[0] || null;
  const v = verdict(entry, best);
  const pick = (x) => x && {
    qid: x.c.qid, ko: x.c.ko || null, en: x.c.en || null, desc: x.c.desc || null, types: x.c.types,
    start: x.j.s, end: x.j.e, term: x.term
  };
  const out = {
    id: entry.id, dataset: entry._ds, title: entry.title, kind: entry.kind || null,
    start_year: entry.start_year, end_year: entry.end_year,
    verdict: v, best: v === '못 찾음' ? null : pick(best),
    others: cands.slice(v === '못 찾음' ? 0 : 1, 4).map(pick)
  };
  if (C && out.best && C.byQid[out.best.qid]) {
    const a = C.byQid[out.best.qid];
    out.cliopatria = { names: a.names.slice(0, 3), from: a.from, to: a.to };
  }
  return out;
});

// ------------------------------------------------------------ 저장

fs.mkdirSync(OUT_DIR, { recursive: true });
const now = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT_DIR, 'wikidata-match.json'), JSON.stringify({
  generated: now,
  sources: [
    { name: 'Wikidata', license: wd.LICENSE, url: 'https://www.wikidata.org' },
    C ? { name: 'Cliopatria', license: clio.LICENSE, url: clio.URL, credit: clio.CREDIT } : null
  ].filter(Boolean),
  results: results
}, null, 1) + '\n');

const ORDER = ['어긋남', '부분 일치', '날짜 없음', '못 찾음', '일치'];
const yt = (y) => (y < 0 ? '기원전 ' + -y : String(y));
const PREC = { 9: '', 8: ' (10년 단위)', 7: ' (100년 단위)', 6: ' (1000년 단위)' };
const dt = (d) => (d ? yt(d.year) + (PREC[d.precision] || (d.precision < 6 ? ' (대략)' : '')) : '—');
const span = (a, b) => (a === b ? yt(a) : yt(a) + ' ~ ' + yt(b));

let md = `# Wikidata 대조 리포트 (${now})\n\n`;
md += '우리 항목을 Wikidata(CC0)에서 한국어 이름으로 찾아 연도를 견준 결과입니다. **데이터 파일은 바꾸지 않았습니다.**\n';
md += '국가사 항목에는 Cliopatria(CC BY 4.0) 지도에 그 나라가 그려진 기간을 참고로 붙였습니다(건국·멸망 연도와 다를 수 있음).\n\n';
md += '- 허용 오차: Wikidata 정밀도(1년·10년·100년…)와 시대(기원전 1000년 이전 ±25년, 서기 500년 이전 ±5년) 중 큰 쪽\n';
md += '- 기원전 연도는 0년이 없는 우리 방식으로 바꿔 비교했습니다\n';
md += '- Wikidata 는 누구나 고칠 수 있는 자료라 **맞다는 보증이 아닙니다.** 어긋남은 어느 쪽이 맞는지 공인 자료로 확인해야 합니다\n\n';

md += '## 요약\n\n| 카테고리 | ' + ORDER.join(' | ') + ' | 합계 |\n|---|' + ORDER.map(() => '---:').join('|') + '|---:|\n';
const totals = {};
manifest.datasets.forEach((ds) => {
  const rs = results.filter((r) => r.dataset === ds.id);
  const counts = ORDER.map((v) => { const n = rs.filter((r) => r.verdict === v).length; totals[v] = (totals[v] || 0) + n; return n; });
  md += `| ${ds.label} | ${counts.join(' | ')} | ${rs.length} |\n`;
});
md += `| **합계** | ${ORDER.map((v) => '**' + (totals[v] || 0) + '**').join(' | ')} | **${results.length}** |\n\n`;

manifest.datasets.forEach((ds) => {
  const rs = results.filter((r) => r.dataset === ds.id)
    .sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.start_year - b.start_year);
  md += `## ${ds.label}\n\n| 판정 | 우리 항목 | 우리 연도 | Wikidata | Wikidata 시작 | Wikidata 끝 |${ds.track === 'nation' ? ' Cliopatria 지도 |' : ''}\n`;
  md += `|---|---|---|---|---|---|${ds.track === 'nation' ? '---|' : ''}\n`;
  rs.forEach((r) => {
    const b = r.best;
    const name = b ? `[${b.ko || b.en || b.qid}](https://www.wikidata.org/wiki/${b.qid})` + (b.desc ? ` — ${b.desc.slice(0, 40)}` : '') : '—';
    const cl = ds.track === 'nation' ? ` ${r.cliopatria ? span(r.cliopatria.from, r.cliopatria.to) : '—'} |` : '';
    md += `| ${r.verdict} | ${r.title} | ${span(r.start_year, r.end_year)} | ${name.replace(/\|/g, '/')} | ${b ? dt(b.start) : '—'} | ${b ? dt(b.end) : '—'} |${cl}\n`;
  });
  md += '\n';
});

fs.writeFileSync(path.join(OUT_DIR, 'wikidata-report.md'), md);
console.log('[대조] 끝 — ' + ORDER.map((v) => `${v} ${totals[v] || 0}`).join(' · '));
console.log('       data/review/wikidata-report.md, data/review/wikidata-match.json');
