# 제3자 구성요소 고지

이 앱과 함께 배포되는 외부 저작물은 아래 하나뿐입니다.
**상업적 이용(광고 게재 포함)에 제약이 없는 라이선스**이며, 아래 고지를 유지하는 것이
유일한 의무입니다.

## vis-timeline (vis.js)

- 경로: `vendor/vis-timeline/`
- 버전: 7.7.3
- 홈페이지: https://visjs.github.io/vis-timeline/
- 라이선스: **Apache-2.0 OR MIT** (둘 중 하나를 선택해 사용 가능)
- 저작권:
  - Copyright (c) 2014-2017 Almende B.V. and contributors
  - Copyright (c) 2017-2019 vis.js contributors
- 라이선스 전문: `vendor/vis-timeline/LICENSE.Apache-2.0.txt`,
  `vendor/vis-timeline/LICENSE.MIT.txt`, `vendor/vis-timeline/LICENSE.md`

> 의무 사항: 저작권 고지와 라이선스 전문을 배포물에 포함할 것.
> 이 저장소는 `vendor/vis-timeline/` 안에 원본 라이선스 파일을 그대로 두고,
> 앱 화면의 `ⓘ 정보` 팝업에서도 이 고지를 볼 수 있게 했습니다.

## 그 밖에

- **런타임 의존성 없음** — `package.json` 에 dependencies / devDependencies 가 없습니다.
  (`npx serve` 는 로컬에서 띄울 때만 쓰는 편의 명령입니다)
- **웹폰트 없음** — 사용자의 기기에 이미 있는 시스템 글꼴만 지정합니다.
  (`-apple-system`, `Segoe UI`, `Apple SD Gothic Neo`, `Noto Sans KR`, `Malgun Gothic` 등)
  폰트 파일을 내려받거나 재배포하지 않으므로 폰트 라이선스 문제가 없습니다.
- **외부 호출 없음** — CDN, 분석 도구, 폰트 서버 등 바깥으로 나가는 요청이 하나도 없습니다.
  (`grep -rn "https\?://" index.html css js sw.js` 로 확인 가능)
- **아이콘·이미지** — `icons/` 의 SVG·PNG 는 이 저장소에서 직접 만든 것으로 외부 저작물이 아닙니다.
