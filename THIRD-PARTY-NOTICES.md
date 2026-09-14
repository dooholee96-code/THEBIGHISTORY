# 제3자 구성요소 고지

**상업적 이용(광고 게재 포함)에 제약이 없는 구성만 씁니다.**

## 글꼴 — Gowun Batang · Gowun Dodum

- 출처: Google Fonts (<https://fonts.google.com/specimen/Gowun+Batang>)
- 라이선스: **SIL Open Font License 1.1** — 상업적 이용·재배포 가능
- 불러오는 방식: `index.html` 의 `<link href="https://fonts.googleapis.com/css2?...">`
  글꼴 파일을 저장소에 담아 재배포하지는 않습니다.

> **이 링크가 이 앱의 유일한 외부 요청입니다.**
> 링크를 지우면 외부 요청이 완전히 사라지고, 화면은 시스템 글꼴로 대체됩니다
> (`css/styles.css` 의 `--serif` / `--sans` 에 폴백이 지정되어 있습니다).
> 오프라인·홈 화면 실행에서도 자동으로 폴백됩니다.

## 그 밖에

- **자바스크립트 라이브러리 없음** — 화면(표·시대 배경·시트·팝업)을 직접 구현했습니다.
  이전 버전에서 쓰던 vis-timeline 은 표 기반 화면으로 바뀌면서 제거했습니다.
- **런타임 의존성 없음** — `package.json` 에 dependencies / devDependencies 가 없습니다.
  (`npx serve` 는 로컬에서 띄울 때만 쓰는 편의 명령입니다)
- **분석 도구·추적 스크립트 없음**, 쿠키 사용 없음.
- **아이콘·이미지** — `icons/` 의 SVG·PNG 는 이 저장소에서 직접 만든 것입니다.
  시대 삽화는 아직 CSS 그라데이션 자리표시자이며, 실제 그림을 넣을 때는
  그 그림의 라이선스를 여기에 추가해야 합니다.
