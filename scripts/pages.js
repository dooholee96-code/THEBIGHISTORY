#!/usr/bin/env node
'use strict';

/**
 * 검색 엔진(구글·네이버)이 읽을 수 있는 글 페이지를 만든다.
 *
 * 연표 화면은 캔버스에 그려서 검색 엔진이 내용을 거의 읽지 못한다. 그래서 출처를 확인한 항목마다
 * 정적인 HTML 페이지(p/<id>.html)를 따로 만들어 둔다 — 이름·연도·설명·출처, 그리고 이 연표의 핵심인
 * '같은 시기 다른 나라·주제에서는' 목록. 맨 아래 버튼은 연표 화면의 그 항목으로 바로 데려간다(#e=<id>).
 *
 * 만드는 것
 *   p/<id>.html     항목 페이지(출처가 붙은 항목만 — 확인하지 않은 초안은 검색에 내보내지 않는다)
 *   p/index.html    항목 목록(카테고리별)
 *   sitemap.xml     위 페이지들과 첫 화면의 주소 목록(Search Console·서치어드바이저에 제출)
 *   robots.txt
 *   index.html      <!-- seo:start --> ~ <!-- seo:end --> 사이의 검색용 머리말(설명·대표 이미지·구조화 데이터)
 *
 * 이름·주소는 site.json 한 곳에서 읽는다.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'p');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'));
const BASE = site.url.replace(/\/?$/, '/');

const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
const datasets = (manifest.datasets || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
const all = [];
for (const ds of datasets) {
  const doc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, ds.file), 'utf8'));
  for (const e of doc.entries || []) all.push(Object.assign({ _ds: ds }, e));
}
const paged = all.filter((e) => e.sources && e.sources.length);
const hasPage = new Set(paged.map((e) => e.id));

// ------------------------------------------------------------ 도우미

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function yearText(y) { return y < 0 ? '기원전 ' + Math.abs(y) + '년' : y + '년'; }

function period(e) {
  if (e.era_note) return e.era_note;
  return e.end_year !== e.start_year ? yearText(e.start_year) + ' ~ ' + yearText(e.end_year) : yearText(e.start_year);
}

function shortPeriod(e) {
  const y = (v) => (v < 0 ? '기원전 ' + Math.abs(v) : String(v));
  return e.end_year !== e.start_year ? y(e.start_year) + '–' + y(e.end_year) : y(e.start_year);
}

/** "이름 https://…" → { name, url } */
function source(raw) {
  const m = /^(.*?)\s*(https?:\/\/\S+)$/.exec(raw);
  return m ? { name: m[1] || m[2], url: m[2] } : { name: raw, url: null };
}

function overlaps(a, b) {
  const a1 = Math.max(a.end_year, a.start_year + 1);
  const b1 = Math.max(b.end_year, b.start_year + 1);
  return a.start_year < b1 && b.start_year < a1;
}

function clip(text, n) {
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

function write(rel, text) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function head(o) {
  const verify = [
    site.verify && site.verify.google ? `<meta name="google-site-verification" content="${esc(site.verify.google)}" />` : '',
    site.verify && site.verify.naver ? `<meta name="naver-site-verification" content="${esc(site.verify.naver)}" />` : ''
  ].filter(Boolean).join('\n  ');
  return `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(o.title)}</title>
  <meta name="description" content="${esc(o.description)}" />
  <link rel="canonical" href="${esc(o.url)}" />
  <meta property="og:type" content="${o.type || 'article'}" />
  <meta property="og:site_name" content="${esc(site.name)}" />
  <meta property="og:title" content="${esc(o.ogTitle || o.title)}" />
  <meta property="og:description" content="${esc(o.description)}" />
  <meta property="og:url" content="${esc(o.url)}" />
  <meta property="og:image" content="${esc(BASE + site.image)}" />
  <meta property="og:locale" content="ko_KR" />
  <meta name="twitter:card" content="summary_large_image" />${verify ? '\n  ' + verify : ''}
  <script type="application/ld+json">${JSON.stringify(o.ld)}</script>`;
}

function page(o) {
  return `<!doctype html>
<html lang="ko">
<head>
  ${head(o)}
  <link rel="icon" href="../icons/icon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="../fonts/fonts.css" />
  <link rel="stylesheet" href="page.css" />
</head>
<body>
  <header class="top"><a class="brand" href="../index.html"><img src="../icons/icon.svg" alt="" width="28" height="28" />${esc(site.name)}</a></header>
  <main class="wrap">
${o.body}
  </main>
  <footer class="foot">
    <p>${esc(site.name)} — ${esc(site.tagline)}. 설명문은 이 프로젝트에서 직접 쓴 한 문장 요약이며, 연도와 사실은 출처에 적은 공공 자료로 확인했습니다. 데이터 CC BY 4.0.</p>
  </footer>
</body>
</html>
`;
}

// ------------------------------------------------------------ 항목 페이지

const NATION_FIRST = (a, b) => (a.track === 'nation' ? 0 : 1) - (b.track === 'nation' ? 0 : 1) || (a.order || 0) - (b.order || 0);

for (const e of paged) {
  const ds = e._ds;
  // 같은 시기 — 다른 카테고리에서 기간이 겹치는(사건이면 그 해를 품은) 항목, 페이지가 있는 것만
  const groups = datasets.slice().sort(NATION_FIRST)
    .filter((d) => d.id !== ds.id)
    .map((d) => ({ ds: d, list: paged.filter((x) => x._ds.id === d.id && overlaps(x, e)).sort((p, q) => p.start_year - q.start_year).slice(0, 12) }))
    .filter((g) => g.list.length);
  // 같은 카테고리의 앞뒤
  const line = paged.filter((x) => x._ds.id === ds.id).sort((p, q) => p.start_year - q.start_year || p.end_year - q.end_year);
  const at = line.findIndex((x) => x.id === e.id);
  const prev = line[at - 1];
  const next = line[at + 1];

  const others = groups.slice(0, 3).map((g) => g.ds.label.replace(/사$/, '') + '의 ' + g.list.slice(0, 2).map((x) => x.title).join('·')).join(', ');
  const description = clip(e.description + (others ? ' 같은 시기 ' + others + '.' : ''), 155);
  const url = BASE + 'p/' + e.id + '.html';
  const srcs = e.sources.map(source);

  const body = `    <nav class="crumbs" aria-label="위치"><a href="index.html">항목 목록</a> › <a href="index.html#${esc(ds.id)}">${esc(ds.label)}</a></nav>
    <article>
      <p class="eyebrow"><span class="dot" style="background:${esc(ds.color)}"></span>${esc(ds.label)} · ${esc(period(e))}</p>
      <h1>${esc(e.title)}</h1>
      <p class="desc">${esc(e.description)}</p>
      <p class="src">출처 · ${srcs.map((s) => (s.url ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a>` : esc(s.name))).join(' · ')}${e.status !== 'reviewed' ? ' <span class="draft">(검토 전 초안)</span>' : ''}</p>
      <p><a class="cta" href="../index.html#e=${esc(e.id)}">연표에서 펼쳐 보기 →</a></p>
    </article>
${groups.length ? `    <section>
      <h2>같은 시기 다른 곳에서는</h2>
${groups.map((g) => `      <h3><span class="dot" style="background:${esc(g.ds.color)}"></span>${esc(g.ds.label)}</h3>
      <ul class="list">
${g.list.map((x) => `        <li><a href="${esc(x.id)}.html">${esc(x.title)}</a> <span class="yr">${esc(shortPeriod(x))}</span></li>`).join('\n')}
      </ul>`).join('\n')}
    </section>` : ''}
    <nav class="pager" aria-label="${esc(ds.label)} 앞뒤">
      ${prev ? `<a href="${esc(prev.id)}.html">← ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a href="${esc(next.id)}.html">${esc(next.title)} →</a>` : '<span></span>'}
    </nav>`;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: e.title + ' (' + period(e) + ')',
        description: e.description,
        inLanguage: 'ko',
        url,
        image: BASE + site.image,
        isPartOf: { '@type': 'WebSite', name: site.name, url: BASE },
        citation: srcs.filter((s) => s.url).map((s) => ({ '@type': 'CreativeWork', name: s.name, url: s.url })),
        about: { '@type': 'Thing', name: e.title }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '항목 목록', item: BASE + 'p/index.html' },
          { '@type': 'ListItem', position: 2, name: ds.label, item: BASE + 'p/index.html#' + ds.id },
          { '@type': 'ListItem', position: 3, name: e.title, item: url }
        ]
      }
    ]
  };

  write('p/' + e.id + '.html', page({
    title: `${e.title} (${period(e)}) — 같은 시기 세계는 | ${site.name}`,
    ogTitle: `${e.title} (${period(e)})`,
    description, url, ld, body
  }));
}

// 지난번에 만들었지만 이제 페이지가 없는 항목(출처를 지웠거나 항목을 뺀 경우)의 파일은 지운다
for (const name of fs.readdirSync(OUT_DIR)) {
  const m = /^(.+)\.html$/.exec(name);
  if (m && m[1] !== 'index' && !hasPage.has(m[1])) fs.unlinkSync(path.join(OUT_DIR, name));
}

// ------------------------------------------------------------ 목록 페이지

const listBody = `    <h1>항목 목록</h1>
    <p class="desc">${esc(site.description)}</p>
    <p><a class="cta" href="../index.html">연표 열기 →</a></p>
${datasets.slice().sort(NATION_FIRST).map((d) => {
  const list = paged.filter((x) => x._ds.id === d.id).sort((p, q) => p.start_year - q.start_year);
  if (!list.length) return '';
  return `    <section id="${esc(d.id)}">
      <h2><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.label)} <span class="count">${list.length}</span></h2>
      <ul class="list">
${list.map((x) => `        <li><a href="${esc(x.id)}.html">${esc(x.title)}</a> <span class="yr">${esc(shortPeriod(x))}</span></li>`).join('\n')}
      </ul>
    </section>`;
}).filter(Boolean).join('\n')}`;

write('p/index.html', page({
  title: `항목 목록 — ${site.name}`,
  description: site.description,
  url: BASE + 'p/index.html',
  type: 'website',
  ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: '항목 목록', url: BASE + 'p/index.html', isPartOf: { '@type': 'WebSite', name: site.name, url: BASE } },
  body: listBody
}));

// ------------------------------------------------------------ sitemap · robots

const urls = [BASE, BASE + 'p/index.html'].concat(paged.map((e) => BASE + 'p/' + e.id + '.html'));
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`);

write('robots.txt', `User-agent: *
Allow: /

Sitemap: ${BASE}sitemap.xml
`);

// ------------------------------------------------------------ 첫 화면 머리말

const indexPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const seo = `<!-- seo:start — scripts/pages.js 가 site.json 으로 만든다. 직접 고치지 말 것 -->
  ${head({
    title: `${site.name} — ${site.tagline}`,
    ogTitle: site.name,
    description: site.description,
    url: BASE,
    type: 'website',
    ld: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: BASE,
      description: site.description,
      inLanguage: 'ko'
    }
  }).replace(/^<meta charset="utf-8" \/>\n\s*<meta name="viewport"[^>]*>\n\s*/, '')}
  <!-- seo:end -->`;
if (!/<!-- seo:start[\s\S]*?<!-- seo:end -->/.test(html)) {
  console.error('✗ index.html 에 <!-- seo:start --> … <!-- seo:end --> 자리가 없습니다.');
  process.exit(1);
}
html = html.replace(/<!-- seo:start[\s\S]*?<!-- seo:end -->/, seo);
fs.writeFileSync(indexPath, html);

console.log(`검색용 페이지 ${paged.length}개 + 목록 · sitemap.xml(${urls.length}개 주소) · robots.txt · index.html 머리말 (${BASE})`);
