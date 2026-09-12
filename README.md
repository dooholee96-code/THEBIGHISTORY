# 빅 히스토리 연표 (Big History Timeline)

왕조·국가사와 주제사를 **하나의 시간축 위에서 나란히 비교**하는 통합 연표 웹앱입니다.
서버도 데이터베이스도 없는 순수 정적 웹앱이라 인터넷 없이도 동작하고,
나중에 PWA(홈 화면에 추가)나 Capacitor(iOS/Android 앱스토어)로 그대로 확장할 수 있습니다.

연표 막대에는 **한 줄 요약**이 함께 나오고, 한 시기에 사건이 몰리면 **묶음(N건)** 으로 접힌 뒤
누르면 **세부 연표 팝업**이 열립니다. 확대(휠·핀치)해도 같은 묶음이 자연스럽게 쪼개집니다.
휠 동작은 **확대·축소 / 가로 스크롤 / 세로 스크롤** 중에서 골라 쓸 수 있습니다.

현재 데이터: **11개 트랙 / 395개 항목** (모두 `status: draft` — 검토 전 초안입니다)

```
왕조·국가사   세계사(제국·문명) · 한국사 · 중국사 · 일본사
주제사        과학사 · 음악사 · 미술사 · 종교사 · 철학사 · 문학사 · 기술사
```

---

## 1. 실행하기

### 가장 간단한 방법 — 파일로 바로 열기

`index.html` 을 브라우저로 열면 끝입니다. (`data/bundle.js` 를 대신 읽습니다. 아래 참고)

### 로컬 서버로 열기 (권장)

```bash
npm run serve          # npx serve -l 5173 .  → http://localhost:5173
# 또는 Node 없이
python3 -m http.server 5173
```

> **왜 두 가지인가요?**
> 브라우저는 `file://` 로 연 페이지가 `fetch()` 로 옆의 JSON 파일을 읽는 것을 막습니다.
> 그래서 JSON 원본을 그대로 담은 사본 `data/bundle.js` 를 함께 두고, `file://` 일 때는
> 자동으로 그쪽을 읽습니다. **JSON 을 고쳤다면 `npm run build` 를 한 번 실행**해서
> 사본을 갱신해 주세요. (로컬 서버로만 쓸 거라면 없어도 됩니다.)

### 데이터 검증

```bash
npm run validate       # 스키마 + 교차 검사 (오류가 있으면 종료 코드 1)
npm run fix            # era_note 같은 자동 채움 가능한 항목을 채운 뒤 재검증
npm run build          # validate + data/bundle.js 재생성
```

의존성 설치(`npm install`)는 필요 없습니다. 검증기는 Node 기본 기능만 씁니다.

---

## 2. 폴더 구조

```
index.html                  화면 뼈대
css/styles.css              스타일 (색상 토큰은 :root 에 모여 있음)
js/data.js                  데이터 로딩 (fetch ↔ bundle 자동 전환)
js/timeline.js              vis-timeline 래퍼 (연도↔Date 변환, 레인, 아이템/묶음, 휠 모드)
js/app.js                   툴바·필터·검색·상세 패널·세부 연표 팝업 조립

data/index.json             ★ 매니페스트 — 어떤 데이터 파일이 있는지 등록
data/<이름>.json            ★ 실제 항목들 (국가별·주제별로 파일 분리)
data/bundle.js              위 JSON 들의 자동 생성 사본 (file:// 전용, 직접 수정 금지)

schema/index.schema.json    매니페스트 JSON Schema
schema/entries.schema.json  항목 JSON Schema
scripts/validate.js         검증 스크립트
scripts/bundle.js           bundle.js 생성기
scripts/lib/jsonschema.js   의존성 없는 초소형 스키마 검증기

vendor/vis-timeline/        vis-timeline 7.7.3 (오프라인 동작을 위해 동봉)
manifest.webmanifest, sw.js, icons/   PWA 관련 파일
```

**화면 코드는 데이터 구조를 하드코딩하지 않습니다.** 카테고리 목록, 레인 이름, 색상,
시대 프리셋까지 전부 `data/index.json` 에서 흘러나옵니다.

---

## 3. 데이터 다루기

### 3-1. 항목 하나 추가/수정/삭제

해당 파일(`data/korea-dynasty.json` 등)의 `entries` 배열만 고치면 됩니다.

```json
{
  "id": "korea-gojoseon",
  "category": "왕조사",
  "subcategory": "한국",
  "title": "고조선",
  "region": "동아시아",
  "start_year": -2333,
  "end_year": -108,
  "era_note": "기원전 2333년 ~ 기원전 108년",
  "description": "단군왕검 건국 전승에서 비롯된 한반도 최초의 국가로, 기원전 108년 한 무제의 침공으로 멸망했다.",
  "tags": ["고대", "국가형성"],
  "sources": ["국사편찬위원회 한국사 개설"],
  "status": "draft"
}
```

| 필드 | 규칙 |
|---|---|
| `id` | 전체 데이터에서 유일. 소문자·숫자·하이픈. 관례: `<데이터셋id>-<식별자>` |
| `category` / `subcategory` | 매니페스트에 등록한 값과 **정확히** 같아야 함 (검증됨) |
| `start_year` / `end_year` | **기원전은 음수** (기원전 2333년 → `-2333`). 연도 0은 쓰지 않음 |
| | 단일 사건은 `start_year` 와 `end_year` 를 같게 → 연표에 점(point)으로 표시 |
| `era_note` | 비워두면 `npm run fix` 가 `"기원전 2333년 ~ 기원전 108년"` 형식으로 채움 |
| `summary` | (선택) 연표 막대에 함께 찍히는 한 줄 요약, 60자 이내. 없으면 `description` 첫 문장을 줄여서 자동 생성 |
| `status` | `draft`(검토 전) 또는 `reviewed`(검토 완료). draft 는 점선 테두리로 표시 |

수정 후:

```bash
npm run build     # 검증 + bundle.js 갱신
```

> **Claude Code 에게 부탁할 때**
> "조선 왕조 추가해줘, 1392~1897" 처럼 한 문장이면 됩니다.
> 해당 JSON 편집 → (필요하면) 매니페스트 갱신 → `npm run build` 까지 한 번에 처리됩니다.
> 별도 관리자 화면은 없습니다. 변경 이력은 git 로그가 검토 로그 역할을 합니다.

### 3-2. 새 국가 추가하기 (예: 베트남사)

**① 파일 만들기** — `data/vietnam-dynasty.json`

```json
{
  "$schema": "../schema/entries.schema.json",
  "dataset": "vietnam",
  "entries": [
    {
      "id": "vietnam-ly",
      "category": "왕조사",
      "subcategory": "베트남",
      "title": "리 왕조",
      "region": "동남아시아",
      "start_year": 1009,
      "end_year": 1225,
      "description": "탕롱(하노이)을 수도로 삼아 베트남의 독립 왕조 체제를 다졌다.",
      "tags": ["중세", "왕조"],
      "sources": ["위키백과 베트남사 개괄"],
      "status": "draft"
    }
  ]
}
```

**② 매니페스트에 한 줄 등록** — `data/index.json` 의 `datasets` 배열에 추가

```json
{
  "id": "vietnam",
  "file": "vietnam-dynasty.json",
  "track": "nation",
  "category": "왕조사",
  "subcategory": "베트남",
  "label": "베트남사",
  "color": "#c0392b",
  "region": "동남아시아",
  "order": 33
}
```

끝입니다. **화면 코드는 한 줄도 건드리지 않습니다.** 레인·필터 칩·색상이 자동으로 생깁니다.

### 3-3. 새 카테고리(주제) 추가하기 (예: 의학사)

국가 추가와 똑같습니다. `category` 를 `"의학사"`, `track` 을 `"theme"` 로 두면 주제사 그룹에 붙습니다.
아예 새로운 트랙(예: `"경제사 묶음"`)을 만들고 싶다면 `data/index.json` 의 `tracks` 에
`{"id": "economy", "label": "경제·사회사", "order": 3}` 을 추가하고 데이터셋의 `track` 에 그 id를 쓰면 됩니다.

### 3-4. 매니페스트 필드 요약

| 필드 | 설명 |
|---|---|
| `tracks[]` | 화면 위쪽 필터의 큰 묶음 (`nation`=왕조·국가사, `theme`=주제사) |
| `datasets[]` | 데이터 파일 목록. `id·file·track·category·subcategory·label·color` 필수 |
| `datasets[].order` | 레인 정렬 순서 (작을수록 위) |
| `datasets[].hidden_by_default` | `true` 면 처음에 꺼진 상태로 시작 |
| `default_window` | 앱을 열었을 때 보여줄 연도 범위 (현재 기원전 3000 ~ 서기 2040) |
| `era_presets[]` | 툴바의 시대 이동 버튼. `start_year`/`end_year` 가 `null` 이면 "전체 맞춤" |

---

## 4. 화면 사용법

| 동작 | 방법 |
|---|---|
| 검색 | 툴바 검색창 (이름·설명·태그·지역). 단축키 `/` |
| 트랙/국가 필터 | 색상 칩 클릭 = 해당 레인 on/off · 왼쪽 회색 라벨 클릭 = 그 묶음 전체 on/off |
| 시대 이동 | `전체 / 고대 / 중세 / 근세 / 근현대` 버튼 한 번 |
| **휠 동작 전환** | 툴바의 `휠: 확대·축소 / 가로 스크롤 / 세로 스크롤` 중 선택 (아래 표 참고) |
| **확대·축소** | 휠(확대·축소 모드) · 두 손가락 **핀치**(모든 모드) · 가로/세로 모드에서는 `Ctrl`(⌘)+휠 |
| 시간 이동 | 드래그, 또는 가로 스크롤 모드에서 휠 |
| 레인 이동 | 레인 목록 옆 세로 스크롤바(항상 사용 가능), 또는 세로 스크롤 모드에서 휠 |
| **한 줄 요약** | 막대 안에 제목과 함께 표시. `한 줄 요약` 체크를 풀면 제목만 남음 |
| **세부 연표** | 묶음(`N건`) 클릭/터치 → 팝업에 그 구간의 사건이 시간순으로 뜨고, 같은 기간 다른 트랙 사건도 함께 보임 |
| 상세 보기 | 항목 클릭 → 오른쪽 패널(모바일은 하단 시트). 페이지 이동 없음 |
| 검토 대상만 보기 | `검토 전(draft)만` 체크 |
| 되돌리기 | `전체 초기화` 버튼 하나로 필터·검색·줌·휠 모드까지 복구 (`Esc` 는 팝업/패널/검색 닫기) |
| 항목 JSON 복사 | 상세 패널 하단 버튼 — 그대로 붙여넣어 편집 |

### 휠 동작 3가지

| 모드 | 휠 | Ctrl(⌘)+휠 | 핀치 |
|---|---|---|---|
| 확대·축소(기본) | 확대·축소 | — | 확대·축소 |
| 가로 스크롤 | 시간축 좌우 이동 | 확대·축소 | 확대·축소 |
| 세로 스크롤 | 레인 위아래 이동 | 확대·축소 | 확대·축소 |

어느 모드에서나 드래그로 시간 이동, 레인 목록 옆 스크롤바로 위아래 이동이 됩니다.

### 사건 묶음과 세부 연표

한 화면에 사건이 겹쳐 보일 만큼 몰려 있으면(대략 76픽셀 안) 그 구간의 사건들이
`4건` 같은 **점선 묶음** 하나로 접힙니다.

- 묶음을 **클릭/터치**하면 세부 연표 팝업이 열립니다. 그 구간의 사건이 시간순으로 나오고,
  **같은 기간 다른 트랙**에서 무슨 일이 있었는지도 함께 보여줍니다. 항목을 누르면 상세로 이어집니다.
- 팝업의 `이 구간 확대` 또는 **핀치/휠 확대**로 들어가면 묶음이 저절로 쪼개져 개별 항목이 됩니다.
  확대 수준에 따라 묶는 폭이 달라지므로, 충분히 확대하면 **같은 해 사건만** 묶입니다.
- 왕조·시대처럼 긴 항목은 연표의 뼈대이므로 묶이지 않습니다.
  (현재 확대 수준에서 사실상 점으로 보이는 짧은 항목만 묶습니다)

---

## 5. 배포

### 5-1. GitHub Pages (웹)

빌드 과정이 없으므로 저장소를 그대로 올리면 됩니다.

1. `npm run build` 로 `data/bundle.js` 를 최신화하고 커밋합니다.
2. GitHub 저장소 → **Settings → Pages → Source: Deploy from a branch**
3. 브랜치(예: `main`)와 폴더 `/ (root)` 를 선택하면 `https://<계정>.github.io/<저장소>/` 로 열립니다.

모든 경로가 상대 경로라서 하위 경로 배포에서도 그대로 동작합니다.

### 5-2. PWA (앱스토어 없이 "홈 화면에 추가")

`manifest.webmanifest` 와 `sw.js` 가 이미 들어 있습니다. **https 또는 localhost** 로 열면
서비스워커가 등록되어 오프라인에서도 동작하고, 모바일 브라우저에서 "홈 화면에 추가"를 하면
주소창 없는 앱처럼 실행됩니다. 데이터를 바꾼 뒤 화면이 갱신되지 않으면 `sw.js` 의
`CACHE_VERSION` 값을 올리세요.

### 5-3. Capacitor (iOS / Android 앱스토어)

이 앱은 웹 표준만 쓰고 데이터도 파일 기반이라(브라우저 저장소에 의존하지 않음)
**코드 수정 없이** 네이티브로 감쌀 수 있습니다.

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "빅 히스토리 연표" com.example.bighistory --web-dir=.
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npx cap sync          # 웹 자산을 네이티브 프로젝트로 복사
npx cap open ios      # Xcode  (App Store 제출)
npx cap open android  # Android Studio (Play Store 제출)
```

- `webDir` 를 저장소 루트로 두면 `index.html`·`data/`·`vendor/` 가 그대로 앱 번들에 들어갑니다.
  (`node_modules`, `ios`, `android`, `scripts` 는 `.gitignore`/`.capacitorignore` 로 제외)
- 네이티브 WebView 는 `capacitor://` 스킴이라 `fetch` 가 동작하므로 JSON 을 직접 읽습니다.
  `data/bundle.js` 는 그대로 두어도 무해합니다.
- 데이터가 바뀔 때마다 앱을 다시 심사받고 싶지 않다면, 나중에 `data/` 만 원격에서
  내려받아 갱신하는 식으로 `js/data.js` 한 파일만 고치면 됩니다.

---

## 6. 알려진 한계

- **시간 범위**: vis-timeline 은 내부적으로 JS `Date` 를 쓰므로 약 ±27만 년까지만 다룹니다.
  문명사(현재 데이터의 최고(最古) 항목은 기원전 17000년 동굴벽화)에는 충분하지만,
  우주·지질 시대(수십억 년)를 넣으려면 **그 트랙만 별도의 로그 스케일 컴포넌트로 분리**해야 합니다.
- **눈금 간격**: vis-timeline 의 시간축 눈금은 최대 1000년 단위까지만 커집니다. 그래서 축 라벨은
  `BC 3000` 처럼 짧게 표기합니다(상세 패널·툴팁은 `기원전 3000년` 형식 그대로).
- **연도 0**: 기원전 1년과 서기 1년 사이에 0년은 없습니다. 데이터에 `0` 을 넣으면 검증에서 걸립니다.
- **내용 정확도**: 모든 항목이 `status: draft` 입니다. 연도·설명은 개괄 수준이며,
  검토를 마친 항목은 `status` 를 `reviewed` 로 바꿔 관리하세요.

---

## 7. 라이선스

- 앱 코드: MIT
- `vendor/vis-timeline/`: vis.js (Apache-2.0 / MIT 듀얼 라이선스, `vendor/vis-timeline/LICENSE.md` 참고)
