---
description: 키워드 하나로 블로그 글 패키지 풀 파이프라인 실행 (리서치→작성→이미지→검증)
argument-hint: <키워드>
---

사용자가 "$ARGUMENTS" 키워드로 블로그 글을 만들어달라고 요청했습니다.

> `knowledge/brand-facts.md`가 없거나 placeholder 상태여도 **중단하지 말고 진행**합니다. 이 경우 회사 고유 수치를 박지 않는 일반 가이드 모드로 작성하세요.

CLAUDE.md의 실행 파이프라인에 따라 아래 순서를 수행하세요:

## 0. 사전 로드 (존재하는 파일만 Read — 없으면 스킵)
1. `knowledge/brand-facts.md` *(선택)* — 있으면 회사 수치 출처로 사용. 없거나 placeholder면 일반 가이드 모드.
2. `knowledge/tone-samples/real-blog-posts.txt` *(선택)* — 회사 톤 학습.
3. `knowledge/patterns/writing-playbook.txt` *(선택)* — 글쓰기 패턴 가이드.
4. `knowledge/banned-words.json` — 금칙어 (항상 로드).
5. `output/_index.json` *(선택)* — 최근 사용한 패턴/도입부 확인 (있으면 의도적으로 다른 조합 선택).

## 1. 키워드 리서치 (STEP 1)
```bash
set -a && . ./.env && set +a && node scripts/research.js --keyword "$ARGUMENTS" --output "output/$(date +%Y-%m-%d)_$(echo $ARGUMENTS | tr -d ' ')"
```
API 인증 실패 시 웹 검색 기반으로 대체 리서치.

## 2. 콘텐츠 생성 (STEP 2)
- `blog-writer` 서브에이전트에 위임 또는 직접 작성
- 12패턴 중 가장 적합한 것 1~2개 선택 (최근 글과 다른 것)
- A.E.A 구조 + 도입부 4줄 공식 + 문체 변주 규칙 준수
- `post.md` 와 `post.html` 작성
- `output/<폴더>/` 에 저장 → 훅이 자동으로 품질검사·유사도검사 실행

## 3. 이미지 디자인 + 캡처 (STEP 3) — 2단계

### 3a. 디자인 (image-designer 서브에이전트)
- `image-designer` 서브에이전트를 호출.
- 글 폴더(`output/<폴더>/`)와 메인 키워드를 전달.
- 에이전트가 `post.md` / `metadata.json` 을 읽고 이 글만의 4종 HTML 을 작성:
  - `output/<폴더>/images/_html/thumbnail.html`   (16:9, 1200×675)
  - `output/<폴더>/images/_html/infographic.html` (2:3,  1080×1620)
  - `output/<폴더>/images/_html/quote-card.html`  (1:1,  1080×1080)
  - `output/<폴더>/images/_html/process.html`     (4:3,  1200×900)
- 매번 글 무드·구조에 맞춰 다른 컬러 팔레트 + 레이아웃 패턴 선택. 같은 골격에 데이터만 갈아끼우는 방식 금지.

### 3b. 캡처 (headless Chrome)
```bash
node scripts/generate-images.js \
  --input  "output/<폴더>/images/_html" \
  --output "output/<폴더>/images"
```
- 시스템에 설치된 Chrome 또는 Edge 를 자동 탐지하여 PNG 로 캡처. 외부 API 호출 없음.
- 결과: `output/<폴더>/images/{thumbnail,infographic,quote-card,process}.png`
- Chrome 미설치 또는 캡처 실패 시 명확한 에러 메시지 출력.

## 4. 품질 검증 (STEP 4)
훅이 자동 실행하지만, 경고가 나오면 본문을 수정하고 재검사.

의료/뷰티 키워드인 경우 `medical-law-checker` 서브에이전트도 호출.

## 5. 최종 패키지 (STEP 5)
- `metadata.json` (패턴 번호·톤 변주·품질 리포트)
- `guide.md` (편집 가이드 · 사실 확인 체크리스트 · 이미지 삽입 위치)
- `output/_index.json` 에 새 글 항목 추가 + `recent_rotation` 갱신

## 완료 후 사용자에게 보고할 것
- 제목 / 글자수 / 패턴 / 톤 변주 조합
- 품질검사 결과, 유사도 검사 결과
- 이미지 4장 생성 여부
- 발행 전 사람이 확인해야 할 항목 (수치·레퍼런스)
- 다음 단계: `/blog-preview <폴더>` 로 발행 어시스턴트 실행
