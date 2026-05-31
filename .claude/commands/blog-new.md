---
description: 키워드 하나로 블로그 글 패키지 풀 파이프라인 실행 (리서치→작성→이미지→검증)
argument-hint: <키워드>
---

사용자가 "$ARGUMENTS" 키워드로 블로그 글을 만들어달라고 요청했습니다.

> ⚠️ **사전 체크**: `knowledge/brand-facts.md`가 placeholder 상태(`[PLACEHOLDER]`로 시작)면 먼저 사용자에게 `/setup` 실행을 안내하고 중단하세요. /setup 없이 글을 쓰면 회사 정보가 빠진 일반 글이 나옵니다.

CLAUDE.md의 실행 파이프라인에 따라 아래 순서를 **반드시 전부** 수행하세요:

## 0. 사전 로드 (생략 금지)
다음 파일을 먼저 Read로 읽습니다:
1. `knowledge/brand-facts.md` — 회사 수치·인증·자사 제품 정보 (Single Source of Truth)
2. `knowledge/tone-samples/real-blog-posts.txt` — 실제 회사 블로그 문체 (있을 경우)
3. `knowledge/patterns/writing-playbook.txt` — 글쓰기 패턴 가이드 (있을 경우)
4. `knowledge/banned-words.json` — 금칙어 (도메인 단어 포함)
5. `output/_index.json` — 최근 사용한 패턴/도입부 확인 (있을 경우 — 의도적으로 다른 조합 선택)

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

## 3. 이미지 프롬프트 작성 (STEP 3) — API 호출 금지

> ⚠️ **이미지 API(`generate-images.js`)를 호출하지 마세요.** 사용자가 Nano Banana 2 / gpt-image-2 에 직접 붙여넣어 생성합니다. 대신 본문의 각 `[IMAGE: ...]` 마커 위치마다 **영문 이미지 프롬프트**를 작성해 `output/<폴더>/image-prompts.json` 파일로 저장하세요.

작성 절차:

1. `post.md` 에서 모든 `[IMAGE: 한글설명]` 마커를 순서대로 찾습니다.
2. 마커마다 **그 위치의 문맥과 바로 앞/뒤 문단 내용**을 읽고, 그 대목에 가장 잘 맞는 이미지를 정합니다.
3. 각 이미지에 대해 **서로 다른 스타일의 옵션 2~3개**를 영문 프롬프트로 작성합니다. 위치별 내용 성격에 맞춰 스타일을 고를 것:
   - 데이터·비교·단계·목록 성격 → **infographic / diagram / flat vector**
   - 상황·감정·장면 묘사 → **photorealistic editorial photo / cinematic photo**
   - 개념·비유·스토리 → **editorial illustration / 4-panel comic(4컷 만화) / isometric illustration**
4. 프롬프트는 **구체적이고 묘사적인 영어**로: 주제(subject)·구도(composition)·조명/분위기(lighting/mood)·색감(color)·렌더링 스타일·종횡비를 명시. 텍스트가 들어가야 하면 정확한 한글 문구를 따옴표로 지정하고 "legible Korean typography"를 덧붙입니다.
5. 인포그래픽/다이어그램 계열 프롬프트에는 브랜드 팔레트를 녹여 통일감을 줄 것 (`.env`의 값 사용 — `BRAND_NAME`, 배경 `BRAND_BG_COLOR`, 본문색 `BRAND_FG_COLOR`, 포인트색 `BRAND_ACCENT`). 실사 사진 옵션에는 강제하지 않습니다.
6. 사람·실제 로고·워터마크가 불필요하게 들어가지 않도록 하고, 광고처럼 보이지 않는 자연스러운 분위기를 지향합니다.

`image-prompts.json` 스키마 (반드시 **유효한 JSON**, UTF-8):

```json
{
  "keyword": "$ARGUMENTS",
  "title": "<글 제목>",
  "note": "각 prompt를 Nano Banana 2 또는 gpt-image-2에 그대로 붙여넣어 이미지를 생성하세요.",
  "images": [
    {
      "id": 1,
      "marker": "<post.md의 [IMAGE:] 안 원문 설명 그대로>",
      "placement": "<글 내 위치, 예: 도입부 첫 문단 직후 / '큐레이션의 두 얼굴' 섹션>",
      "context": "<이 자리에 왜 이 이미지가 필요한지 한 줄 한국어 설명>",
      "altText": "<발행 시 넣을 한글 대체텍스트>",
      "options": [
        { "style": "Photorealistic editorial photo", "aspectRatio": "16:9", "prompt": "<detailed English prompt>" },
        { "style": "Flat vector infographic", "aspectRatio": "16:9", "prompt": "<detailed English prompt>" }
      ]
    }
  ]
}
```

`images` 배열 길이는 `[IMAGE:]` 마커 수와 같아야 합니다 (최소 4개). `output/<폴더>/images/` 디렉터리는 만들지 않아도 됩니다.

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
- 이미지 프롬프트 개수 (`image-prompts.json`) — 각 위치/스타일 옵션 요약
- 발행 전 사람이 확인해야 할 항목 (수치·레퍼런스)
- 다음 단계: `/blog-preview <폴더>` 로 발행 어시스턴트 실행
