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

- **Three.js r170** — 탐험 그림판을 GPU(WebGL2)로 그리는 데 씁니다.
  저작권 © 2010-2024 three.js authors, **MIT License**(상업적 이용 가능). 전문은 `vendor/three.LICENSE`.
  필요한 부분만 묶은 `vendor/three.min.js` 를 저장소에 담아 함께 배포합니다(외부 요청 없음).
- 그 밖의 화면(계기판·팝업·탭·갈림길)은 라이브러리 없이 직접 구현했습니다.
- **npm 의존성 없음** — `package.json` 에 dependencies / devDependencies 가 없습니다
  (Three.js 는 위처럼 묶은 파일로 들어 있습니다. `npx serve` 는 로컬에서 띄울 때만 쓰는 편의 명령입니다)
- **분석 도구·추적 스크립트 없음**, 쿠키 사용 없음.
- **아이콘·이미지** — `icons/` 의 SVG·PNG 는 이 저장소에서 직접 만든 것입니다.
  시대 삽화는 아직 CSS 그라데이션 자리표시자이며, 실제 그림을 넣을 때는
  그 그림의 라이선스를 여기에 추가해야 합니다.
