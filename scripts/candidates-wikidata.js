#!/usr/bin/env node
'use strict';

/**
 * 새 항목 후보 — 카테고리마다 Wikidata(CC0)에서 한국어 이름과 연도가 있는 것을 뽑는다.
 *
 *   node scripts/candidates-wikidata.js
 *
 * 우리 데이터에 이미 번호가 붙은 것은 뺀다. 많이 알려진 것(위키백과 언어판 수)부터 늘어놓는다.
 * 결과는 data/review/candidates.md · candidates.json — 데이터 파일은 바꾸지 않는다.
 * 고른 것을 들일 때는 연도를 공인 자료로 확인하고, 설명은 직접 한 문장으로 쓴다(문장을 옮기지 않는다).
 */

const fs = require('fs');
const path = require('path');
const wd = require('./sources/wikidata');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'review');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const have = new Set();
const linkedBy = {};
manifest.datasets.forEach((ds) => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', ds.file), 'utf8'));
  linkedBy[ds.id] = [];
  doc.entries.forEach((e) => { if (e.wikidata) { have.add(e.wikidata); linkedBy[ds.id].push(e.wikidata); } });
});

// 시작·끝으로 읽을 속성
const TIME = `
  OPTIONAL { ?item wdt:P580 ?s1 } OPTIONAL { ?item wdt:P571 ?s2 } OPTIONAL { ?item wdt:P585 ?s3 }
  OPTIONAL { ?item wdt:P577 ?s4 } OPTIONAL { ?item wdt:P575 ?s5 } OPTIONAL { ?item wdt:P1191 ?s6 }
  OPTIONAL { ?item wdt:P569 ?s7 }
  OPTIONAL { ?item wdt:P582 ?e1 } OPTIONAL { ?item wdt:P576 ?e2 } OPTIONAL { ?item wdt:P570 ?e3 }
  BIND(COALESCE(?s1, ?s2, ?s3, ?s4, ?s5, ?s6, ?s7) AS ?start)
  BIND(COALESCE(?e1, ?e2, ?e3) AS ?end)
  FILTER(BOUND(?start))`;

function q(body, minLinks, limit) {
  return `SELECT ?item ?ko ?desc ?typeLabel ?n (SAMPLE(?start) AS ?st) (SAMPLE(?end) AS ?en) WHERE {
    ${body}
    ?item wikibase:sitelinks ?n . FILTER(?n >= ${minLinks})
    ?item rdfs:label ?ko FILTER(lang(?ko) = "ko")
    OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc) = "ko") }
    OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeLabel FILTER(lang(?typeLabel) = "ko") }
    ${TIME}
  } GROUP BY ?item ?ko ?desc ?typeLabel ?n ORDER BY DESC(?n) LIMIT ${limit || 150}`;
}

function regionEvents(regions, minLinks) {
  const classes = ['Q198', 'Q178561', 'Q124734', 'Q10931', 'Q131569', 'Q45382', 'Q273120', 'Q1323212', 'Q467011', 'Q3024240', 'Q11514315'];
  // 참전국(P710)으로만 이어진 남의 나라 전쟁(예: 이라크 전쟁)은 빼려고 나라(P17)·관할(P1001)·장소(P276)로만 잇는다.
  // 나라가 많으면 한 질의가 시간 제한(60초)을 넘으므로 10개씩 나눠 묻는다
  const out = [];
  for (let i = 0; i < regions.length; i += 10) {
    out.push(q(`VALUES ?region { ${regions.slice(i, i + 10).map((r) => 'wd:' + r).join(' ')} }
    VALUES ?cls { ${classes.map((c) => 'wd:' + c).join(' ')} }
    ?item wdt:P31 ?cls . ?item (wdt:P17|wdt:P1001|wdt:P276) ?region .`, minLinks));
  }
  return out;
}

// 직업으로 사람을 고를 때, 이름난 다른 직업(배우·축구 선수·화가·정치인·물리학자·성직자)이 붙은 사람은 뺀다
function notAlso(occupations) {
  return `FILTER NOT EXISTS { ?item wdt:P106 ?other . VALUES ?other { ${occupations.map((o) => 'wd:' + o).join(' ')} } }`;
}

// 종류 이름으로 거르는 것 — 과학사는 '발견'된 나라·섬·천체·스포츠·상표, 음악사는 국가(國歌)·캐럴, 문학사는 경전·법령·간행물
const NOT_TYPE = {
  science: /나라|국가|주권국|대륙|섬|제도|지역|지방|호수|해외 영토|스포츠|종목|취미|상표|브랜드|음료|분류군|유적|도시|비석|지리극|작업 분야|교통수단|재료|위성|소행성|왜행성|왜성|항성|카이퍼|사형/,
  music: /^국가$|캐럴/,
  literature: /경전|서신서|서간|법령|헌법|헌장|연속간행물|백과사전/
};

const QUERIES = {
  world: [
    q('VALUES ?cls { wd:Q3024240 wd:Q48349 } ?item wdt:P31 ?cls .', 70),
    q('?item wdt:P31 wd:Q198 .', 90)
  ],
  korea: regionEvents(linkedBy.korea.concat(['Q884', 'Q423', 'Q28179', 'Q28233']), 12),
  china: regionEvents(linkedBy.china.concat(['Q148', 'Q865', 'Q29520']), 25),
  japan: regionEvents(linkedBy.japan.concat(['Q17', 'Q188712']), 25),
  science: [q('?item wdt:P575 ?t ; wdt:P61 ?who . FILTER NOT EXISTS { ?item wdt:P31 wd:Q11344 } FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }', 40, 250)],
  technology: [q('?item wdt:P31/wdt:P279? wd:Q39546 .', 30), q('?item wdt:P31 wd:Q11019 .', 40)],
  music: [q('?item wdt:P31 wd:Q105543609 .', 30), q('?item wdt:P106 wd:Q36834 . ' + notAlso(['Q33999', 'Q937857', 'Q1028181', 'Q82955', 'Q177220', 'Q753110']), 90)],
  art: [q('?item wdt:P31 wd:Q3305213 .', 45), q('?item wdt:P31 wd:Q968159 .', 25)],
  religion: [q('?item wdt:P31 wd:Q9174 .', 35), q('VALUES ?cls { wd:Q51041800 wd:Q2061186 } ?item wdt:P31 ?cls .', 20)],
  philosophy: [q('?item wdt:P106 wd:Q4964182 . ' + notAlso(['Q82955', 'Q169470', 'Q33999', 'Q250867', 'Q11063']), 110), q('?item wdt:P31 wd:Q2198855 .', 25)],
  literature: [q('?item wdt:P31 wd:Q7725634 .', 70), q('?item wdt:P31 wd:Q47461344 .', 70)]
};

const yt = (y) => (y == null ? '—' : y < 0 ? '기원전 ' + -y : String(y));
const out = {};
manifest.datasets.forEach((ds) => {
  const list = [];
  const seen = new Set();
  (QUERIES[ds.id] || []).forEach((query, k) => {
    console.log(`[후보] ${ds.label} ${k + 1}/${QUERIES[ds.id].length}`);
    let rows = [];
    try { rows = wd.sparql(query); } catch (err) { console.warn('  건너뜀: ' + err.message.split('\n')[0]); if (err.retryAfter) throw err; }
    rows.forEach((b) => {
      const qid = b.item.value.slice(b.item.value.lastIndexOf('/') + 1);
      if (have.has(qid) || seen.has(qid)) return;
      if (NOT_TYPE[ds.id] && b.typeLabel && NOT_TYPE[ds.id].test(b.typeLabel.value)) return;
      seen.add(qid);
      list.push({
        qid: qid, ko: b.ko.value, desc: b.desc ? b.desc.value : '', type: b.typeLabel ? b.typeLabel.value : '',
        sitelinks: Number(b.n.value),
        start: b.st ? wd.histYear(b.st.value) : null, end: b.en ? wd.histYear(b.en.value) : null
      });
    });
  });
  list.sort((a, b) => b.sitelinks - a.sitelinks);
  out[ds.id] = list.slice(0, 60);
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const now = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT_DIR, 'candidates.json'), JSON.stringify({ generated: now, source: 'Wikidata (CC0)', candidates: out }, null, 1) + '\n');

let md = `# 새 항목 후보 (${now})\n\n`;
md += 'Wikidata(CC0)에서 카테고리마다 한국어 이름과 연도가 있는 것을 뽑았습니다. 이미 연결된 항목은 뺐고, 위키백과 언어판이 많은(널리 알려진) 순입니다.\n';
md += '연도는 Wikidata 값이라 **들이기 전에 공인 자료로 확인**하고, 설명은 직접 한 문장으로 씁니다.\n\n';
manifest.datasets.forEach((ds) => {
  const list = out[ds.id] || [];
  md += `## ${ds.label} (${list.length})\n\n| 이름 | 시작 | 끝 | 종류 | 언어판 | 설명 |\n|---|---|---|---|---:|---|\n`;
  list.forEach((c) => {
    md += `| [${c.ko}](https://www.wikidata.org/wiki/${c.qid}) | ${yt(c.start)} | ${yt(c.end)} | ${c.type} | ${c.sitelinks} | ${(c.desc || '').slice(0, 50).replace(/\|/g, '/')} |\n`;
  });
  md += '\n';
});
fs.writeFileSync(path.join(OUT_DIR, 'candidates.md'), md);
console.log('[후보] 끝 — data/review/candidates.md');
