# Claude Code Blog Builder

이 프로젝트는 Claude Code에서 직접 실행하는 블로그 콘텐츠 자동화 도구입니다.
사용자가 "이 키워드로 블로그 글 만들어줘"라고 요청하면 키워드 리서치 → 초안 생성 → 이미지 생성 → 품질 검증 → 발행 어시스턴트까지 수행합니다.

> ⚠️ **이 시스템은 1개 블로그를 직접 운영하는 경우에 최적화되어 있습니다.**
> 멀티 카테고리 운영, 저품질 복구, 발행 스케줄링, 외주팀 워크플로우 등은 상위 솔루션이 필요합니다.

---

## 🚀 처음 사용한다면 — `/setup` 부터

이 레포는 **누구나 자기 회사에 맞게 사용**할 수 있도록 템플릿화되어 있습니다.
처음 clone 받았다면 가장 먼저 다음 명령을 실행하세요:

```
/setup
```

5분 인터뷰를 통해 `knowledge/brand-facts.md`가 자동으로 채워지며, 이후 `/blog-new "키워드"` 한 줄로 글 한 편이 나옵니다.

**Phase 1 (5분, 필수)** → `/setup`
**Phase 2 (10분, 권장)** → `/setup-tone` (여러분 회사 블로그 URL에서 톤 자동 학습)
**Phase 3 (15분, 선택)** → `/setup-domain` (카테고리별 키워드 뱅크 + 산업별 금칙어)

---

## 프로젝트 구조

```
claude-code-blog-builder/
├── CLAUDE.md              # 이 파일 (Claude Code 지시서)
├── README.md
├── INSTALL.md             # 30초 설치 가이드
├── package.json           # 외부 의존성 0
│
├── knowledge/             # ⭐ Single Source of Truth
│   ├── README.md
│   ├── brand-facts.template.md          # 공개 템플릿
│   ├── brand-facts.md                   # /setup이 생성 (gitignored)
│   ├── conversion-benchmarks.template.md
│   ├── conversion-benchmarks.md
│   ├── banned-words.template.json
│   ├── banned-words.json
│   ├── tone-samples/                    # /setup-tone이 채움
│   └── patterns/
│
├── scripts/
│   ├── research.js              # 네이버 API 키워드 리서치
│   ├── generate-images.js       # HTML→PNG headless Chrome 캡처기
│   ├── quality-check.js         # 7항목 결정론 채점
│   ├── duplicate-check.js       # 6-gram Jaccard 유사도
│   ├── hook-post-write.js       # PostToolUse 훅 라우터
│   ├── preview.js               # 발행 어시스턴트 (HTML)
│   ├── setup-tone-fetch.js      # 블로그 URL 본문 수집
│   └── sanitize-check.sh        # push 전 게이트
│
├── templates/                   # (deprecated — README.md 참조)
│
├── .claude/
│   ├── settings.json            # PostToolUse 훅 등록
│   ├── commands/
│   │   ├── setup.md             # /setup
│   │   ├── setup-tone.md
│   │   ├── setup-domain.md
│   │   ├── blog-new.md          # /blog-new
│   │   ├── blog-research.md
│   │   ├── blog-quality.md
│   │   ├── blog-publish-ready.md
│   │   └── blog-preview.md
│   └── agents/
│       ├── setup-interviewer.md
│       ├── blog-researcher.md
│       ├── blog-writer.md
│       ├── image-designer.md       # 글마다 4종 인포그래픽 HTML 직접 디자인
│       ├── blog-quality-reviewer.md
│       └── medical-law-checker.md
│
├── keyword-bank/                # 카테고리별 시드 키워드
│   ├── README.md
│   ├── detail-page.yml          # 예시
│   ├── hospital-marketing.yml   # 예시
│   ├── beauty-brand.yml         # 예시
│   └── ai-marketing.yml         # 예시
│
├── output/                      # 생성된 결과물 (gitignored)
│   └── .gitkeep
│
└── docs/
    ├── how-it-works.md
    ├── setup-guide.md
    └── troubleshooting.md
```

---

## 사용법

`/setup` 완료 후:

```
/blog-new "병원 마케팅"
/blog-new "AI 마케팅 트렌드"
/blog-new "상세페이지 제작 비용"
```

---

## 실행 파이프라인

### STEP 1: 키워드 리서치

`scripts/research.js`를 사용합니다 (네이버 Search API 자동 호출 + 분석).

```bash
node scripts/research.js --keyword "<키워드>" --output "output/<날짜>_<키워드>"
```

스크립트가 자동으로 수행:
- 블로그 전체 포스팅 수 → 경쟁도 판정 (10만+: 높음 / 3만+: 보통 / 미만: 낮음)
- 최근 30일 포스팅 비율 → 트렌드 활성도
- 상위 글 제목에서 연관 키워드 TOP 15 추출
- 롱테일 키워드 8개 자동 제안
- `research.json` 파일 저장

API 인증 실패 시 웹 검색 기반으로 대체 리서치.

### STEP 2: 콘텐츠 생성

**사전 로드 — 아래 파일이 존재하면 Read로 읽고, 없으면 그 항목은 건너뛸 것:**

1. `knowledge/brand-facts.md` *(선택)* — 회사 수치·인증. **있으면** 이 파일의 숫자만 사용. **없거나 placeholder면** 회사 고유 수치를 본문에 박지 말고 일반 가이드 모드로 작성.
2. `knowledge/tone-samples/real-blog-posts.txt` *(선택)* — 회사 블로그 문체 학습. 없으면 보편적 한국어 블로그 문체로.
3. `knowledge/patterns/writing-playbook.txt` *(선택)* — 글쓰기 패턴 가이드.
4. `knowledge/banned-words.json` — 금칙어 + 도메인 단어 (이 파일은 항상 존재)
5. `output/_index.json` *(선택)* — 최근 사용한 패턴/도입부 확인 → **의도적으로 다른 조합 선택**
6. `knowledge/conversion-benchmarks.md` *(선택, 수치 인용 시)*

> `brand-facts.md`가 없거나 placeholder 상태여도 **중단하지 말고 진행**합니다. 이 경우 회사 고유 수치(자사 매출/고객 수/업력 등)를 만들어내지 말고, 검증 가능한 일반 시장 통계와 일반론 위주로 작성하세요.

#### 글쓰기 원칙

- 검증 불가능한 회사 고유 수치를 만들어내지 말 것 (픽션 금지). `brand-facts.md`가 있으면 그 안의 숫자만 사용. 없으면 회사 자랑 수치 자체를 회피하고 일반 시장 데이터·검증 가능한 출처 기반으로만 작성.
- `tone-samples`가 있으면 시그니처 표현 2개 이상 자연 삽입. 없으면 보편적 한국어 블로그 문체.
- 도입부 4줄 공식: 문제 → 손실 → 자격 → 끝까지 읽으면 얻을 것
- A.E.A 구조: 권위(Authority) → 근거(Evidence) → 행동(Action)
- 본문 1,500~3,000자, 메인 키워드 5~12회 자연 삽입
- `[IMAGE: 설명]` 마커 최소 4개
- 외부 링크 0건 (네이버 저품질 트리거)
- 최상급/금칙어 0건 (`banned-words.json` 참조)
- 표 1개 이상 삽입

#### 출력 형식

`output/{날짜}_{키워드}/` 폴더에:

1. `post.md` — 블로그 본문 (마크다운)
2. `post.html` — 스마트에디터 붙여넣기용 HTML
3. `metadata.json` — 제목, 태그, 메타설명, 키워드 리포트
4. `guide.md` — 편집 가이드 (이미지 위치, 수정 포인트)

### STEP 3: 이미지 디자인 + 캡처 (2단계, 외부 API 0)

#### 3a. 디자인 — `image-designer` 서브에이전트
글이 작성된 직후 `image-designer` 를 호출. 이 에이전트는 `post.md` 와 `metadata.json` 을 직접 읽고, 글의 무드·정보 구조에 맞춰 **매번 다른 컬러 팔레트(6종 중 1) + 다른 레이아웃 패턴(썸네일 8 × 인포그래픽 12 × 인용 6 × 프로세스 8 조합)**을 선택해 4개 HTML 을 처음부터 디자인합니다. 같은 골격에 데이터만 갈아끼우는 방식은 사용하지 않습니다.

출력:
```
output/<폴더>/images/_html/thumbnail.html      (16:9, 1200×675)
output/<폴더>/images/_html/infographic.html    (2:3,  1080×1620)
output/<폴더>/images/_html/quote-card.html     (1:1,  1080×1080)
output/<폴더>/images/_html/process.html        (4:3,  1200×900)
```

각 HTML 은 self-contained (인라인 CSS, Google Fonts CDN 만 외부 자원). 디자인 가이드·패턴 라이브러리는 [.claude/agents/image-designer.md](.claude/agents/image-designer.md) 참조.

#### 3b. 캡처 — `scripts/generate-images.js` (headless Chrome)
```bash
node scripts/generate-images.js \
  --input  "output/<폴더>/images/_html" \
  --output "output/<폴더>/images"
```
시스템에 설치된 Chrome 또는 Edge 를 자동 탐지하여 PNG 로 캡처. 외부 API 호출 0건, 비용 0원, 워터마크 없음. 자동 탐지 실패 시 환경변수 `CHROME_PATH` 로 직접 지정.

생성 이미지 4종:
1. **썸네일** (16:9, 1200×675) — 글의 가장 강한 메시지 1개
2. **인포그래픽** (2:3, 1080×1620) — 본문 핵심 데이터·논리·비교 시각화
3. **인용 카드** (1:1, 1080×1080) — 글에서 가장 강력한 한 문장
4. **프로세스 다이어그램** (4:3, 1200×900) — 단계·순서·흐름 (없으면 구조 다이어그램)

이미지에는 브랜드명·로고·서명을 박지 않습니다. 글마다 팔레트·레이아웃이 다르므로 픽셀 해시는 매번 다름 → 네이버 유사 문서 판정 회피.

### STEP 4: 품질 검증 + 유사도 검사

**자동 훅으로 실행됨** — `post.md`를 Write/Edit 하면 `.claude/settings.json` 훅이 아래 두 스크립트를 자동 실행합니다:

```bash
node scripts/quality-check.js --file "output/폴더/post.md" --keyword "키워드"
node scripts/duplicate-check.js --file "output/폴더/post.md" [--threshold 25]
```

`duplicate-check.js`는 6-gram Jaccard 유사도 계산. 임계값 25% 초과 시 경고.

검사 항목:
- ✅ 키워드 빈도 (5~12회 권장)
- ✅ 글자수 (≥ 1,500)
- ✅ 어미 반복 (3회 연속 금지)
- ✅ 이미지 마커 수 (≥ 4개)
- ✅ 외부 링크 0건
- ✅ 최상급/금칙어 0건
- ✅ 접속사 비율 ≤ 5%

의료/뷰티 키워드는 추가로 `medical-law-checker` 서브에이전트 호출.

### STEP 4.5: 발행 어시스턴트

`scripts/preview.js`가 작성된 글을 self-contained HTML로 렌더링하고 브라우저로 엽니다.

```bash
node scripts/preview.js --folder "output/폴더"
```

브라우저에서:
- 제목·태그·메타설명 카드 (각각 클립보드 복사)
- 본문 섹션별 "서식 포함 복사" / "텍스트만 복사"
- 이미지 4장 개별/일괄 다운로드
- 발행 체크리스트 10개

네이버 발행 API가 폐쇄돼 있어 자동 발행은 불가하지만, 이 도구로 복붙 마찰을 최소화합니다.

### STEP 5: 최종 패키지

`output/{날짜}_{키워드}/` 폴더 구조:
```
output/2026-04-08_my-keyword/
├── post.md
├── post.html
├── metadata.json
├── guide.md
├── images/
│   ├── thumbnail.png
│   ├── infographic.png
│   ├── quote-card.png
│   └── process.png
└── quality-report.json
```

---

## 환경 설정

`.env` 파일 (`.env.example` 참조 — 모두 선택사항):

```
# 네이버 개발자센터 (선택 — 없으면 웹 검색으로 대체)
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret

# 선택: Chrome / Edge 자동 탐지가 실패할 때만 직접 경로 지정
# CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

이미지 생성용 외부 API 키는 필요하지 않습니다. 별도 `npm install` 불필요 — Node 20+ 내장 기능 + 시스템 Chrome/Edge 만으로 동작합니다.

요구사항:
- Node.js 20 이상
- Google Chrome 또는 Microsoft Edge (대부분의 OS 에 기본 설치됨)

---

## 주의사항

- 생성된 글은 **반드시 사람이 검토 후 발행**합니다
- 자동 발행 기능은 의도적으로 제외 (저품질 리스크)
- 하루 2건 이상 발행 권장하지 않음
- 발행 시간은 불규칙하게 유지 (패턴 탐지 방지)
- 이미지는 반드시 스마트에디터에서 직접 업로드

---

## 라이선스

MIT — 자유롭게 사용/수정/배포 가능. 다만 `knowledge/` 폴더의 회사 데이터는 절대 git에 올리지 마세요 (`.gitignore`에 등록되어 있습니다).
