'use strict';

/**
 * Wikidata(CC0) — 데이터 조회(SPARQL) 한 곳으로 검색과 속성 읽기를 모두 한다.
 *
 * 일반 API(www.wikidata.org/w/api.php)는 공용 IP 에서 쉽게 요청 제한(429)에 걸려서,
 * 검색도 조회 서비스 안에서(mwapi EntitySearch) 여러 낱말을 한 번에 돌린다.
 *
 * 연도 주의: 조회 결과의 날짜는 국제표준(XSD/ISO 8601)이라 0년이 있다(−0036 = 기원전 37년).
 * 우리 데이터는 0년이 없는 역사학 방식이므로 histYear() 로 바꿔 쓴다.
 */

const { request } = require('./http');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const LICENSE = 'CC0-1.0';

// 시작·끝으로 볼 수 있는 시간 속성
const START_PROPS = {
  P571: '설립·시작(inception)',
  P580: '시작 시점(start time)',
  P585: '시점(point in time)',
  P577: '발표·출판(publication date)',
  P575: '발견·발명(time of discovery or invention)',
  P1191: '초연(date of first performance)',
  P569: '출생(date of birth)',
  P1319: '가장 이른 시점(earliest date)'
};
const END_PROPS = {
  P576: '해체·멸망(dissolved)',
  P582: '끝 시점(end time)',
  P570: '사망(date of death)',
  P1326: '가장 늦은 시점(latest date)'
};

function sparql(query) {
  const body = request(ENDPOINT, { form: { query: query }, accept: 'application/sparql-results+json', minGapMs: 1500 });
  return JSON.parse(body).results.bindings;
}

function lit(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function qidOf(uri) { return uri.slice(uri.lastIndexOf('/') + 1); }

/**
 * 국제표준 날짜 → 우리 연도(0년 없음). precision: 9=해, 8=10년, 7=100년, 6=1000년
 * "-0036-01-01T00:00:00Z" → −37
 */
function histYear(time) {
  const m = /^([+-]?)(\d+)-/.exec(time);
  if (!m) return null;
  const y = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  return y <= 0 ? y - 1 : y;
}

/** 정밀도에 맞는 허용 오차(년) */
function tolerance(precision) {
  if (precision >= 9) return 1;
  if (precision === 8) return 10;
  if (precision === 7) return 100;
  if (precision === 6) return 1000;
  return 5000;
}

/**
 * 여러 낱말을 한 번에 검색 — 이름·별칭 앞부분 일치(wbsearchentities 와 같다)
 * @returns { 낱말: [{ qid, rank }] }
 */
function searchMany(terms, lang, limit) {
  lang = lang || 'ko';
  limit = limit || 5;
  const out = {};
  const uniq = Array.from(new Set(terms.filter(Boolean)));
  for (let i = 0; i < uniq.length; i += 20) {
    const batch = uniq.slice(i, i + 20);
    const q = `SELECT ?term ?item ?ord WHERE {
      VALUES ?term { ${batch.map(lit).join(' ')} }
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
                        mwapi:search ?term; mwapi:language "${lang}"; mwapi:limit "${limit}".
        ?item wikibase:apiOutputItem mwapi:item. ?ord wikibase:apiOrdinal true.
      }
    }`;
    sparql(q).forEach((b) => {
      const t = b.term.value;
      (out[t] = out[t] || []).push({ qid: qidOf(b.item.value), rank: Number(b.ord.value) });
    });
    process.stdout.write(`  검색 ${Math.min(i + 20, uniq.length)}/${uniq.length}\r`);
  }
  Object.keys(out).forEach((t) => out[t].sort((a, b) => a.rank - b.rank));
  return out;
}

/**
 * 항목들의 이름·설명·종류·시간 속성(정밀도 포함)·사이트링크 수
 * @returns { qid: { ko, en, desc, types:[], sitelinks, start:[{prop,year,precision}], end:[...] } }
 */
function describe(qids) {
  const out = {};
  const uniq = Array.from(new Set(qids));
  const props = Object.keys(START_PROPS).concat(Object.keys(END_PROPS));
  for (let i = 0; i < uniq.length; i += 60) {
    const batch = uniq.slice(i, i + 60);
    const values = batch.map((q) => 'wd:' + q).join(' ');
    const base = `SELECT ?item ?ko ?en ?desc ?links WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item rdfs:label ?ko FILTER(lang(?ko) = "ko") }
      OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
      OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc) = "ko") }
      OPTIONAL { ?item wikibase:sitelinks ?links }
    }`;
    sparql(base).forEach((b) => {
      const q = qidOf(b.item.value);
      out[q] = out[q] || { qid: q, types: [], start: [], end: [] };
      if (b.ko) out[q].ko = b.ko.value;
      if (b.en) out[q].en = b.en.value;
      if (b.desc) out[q].desc = b.desc.value;
      if (b.links) out[q].sitelinks = Number(b.links.value);
    });
    const types = `SELECT ?item ?typeLabel WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P31 ?type .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en". }
    }`;
    sparql(types).forEach((b) => {
      const q = qidOf(b.item.value);
      if (out[q] && b.typeLabel && out[q].types.length < 4) out[q].types.push(b.typeLabel.value);
    });
    const times = `SELECT ?item ?prop ?t ?prec WHERE {
      VALUES ?item { ${values} }
      VALUES ?prop { ${props.map((p) => '"' + p + '"').join(' ')} }
      BIND(IRI(CONCAT("http://www.wikidata.org/prop/", ?prop)) AS ?p)
      BIND(IRI(CONCAT("http://www.wikidata.org/prop/statement/value/", ?prop)) AS ?psv)
      ?item ?p ?st . ?st ?psv ?v . ?st wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank)
      ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec .
    }`;
    sparql(times).forEach((b) => {
      const q = qidOf(b.item.value);
      if (!out[q]) return;
      const prop = b.prop.value;
      const year = histYear(b.t.value);
      if (year == null) return;
      const rec = { prop: prop, year: year, precision: Number(b.prec.value) };
      (START_PROPS[prop] ? out[q].start : out[q].end).push(rec);
    });
    process.stdout.write(`  속성 ${Math.min(i + 60, uniq.length)}/${uniq.length}\r`);
  }
  return out;
}

module.exports = { sparql, searchMany, describe, histYear, tolerance, START_PROPS, END_PROPS, LICENSE };
