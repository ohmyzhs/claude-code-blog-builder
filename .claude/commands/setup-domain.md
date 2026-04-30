---
description: 카테고리별 키워드뱅크/벤치마크/금칙어/이미지 시스템 설정 (Phase 3, 15분)
argument-hint: (인자 없음)
---

# /setup-domain — 도메인 특화 설정 (Phase 3)

여러분의 주력 카테고리에 맞는 키워드뱅크, 업계 벤치마크, 산업별 금칙어, 이미지 디자인 시스템을 설정합니다.

## 사전 조건

- `/setup` 완료
- 가급적 `/setup-tone`도 완료 (필수는 아님)

## 실행 절차

1. `setup-interviewer` 서브에이전트 호출 (Phase 3 모드).
2. `knowledge/brand-facts.md`에서 주력 카테고리 1~3개 읽기.
3. **카테고리별로 순회** (각 카테고리당 3질문, 약 5분):
   - **Q1**: "이 카테고리의 주요 키워드 5~10개?" → `keyword-bank/{slug}.yml` 생성
   - **Q2**: "이 카테고리에 적용되는 법령/규제 단어가 있나요?" → `knowledge/banned-words.json` `domain_specific.words` 추가
   - **Q3**: "이 카테고리의 업계 벤치마크 수치 아시는 것?" → `knowledge/conversion-benchmarks.md` 업데이트
4. **이미지 디자인 시스템** — 자동화되어 별도 설정 불필요:
   - `image-designer` 서브에이전트가 글마다 6개 컬러 팔레트 중 무드에 맞는 것을 자동 선택
   - 이미지에 브랜드명·로고를 박지 않으므로 BRAND_NAME 등의 변수 설정이 필요하지 않음
   - 디자인 가이드는 [.claude/agents/image-designer.md](../agents/image-designer.md) 참조
5. **medical-law-checker 활성화 여부**: 의료/뷰티/제약 카테고리 있으면 활성화 권장

## 출력물

- `keyword-bank/<카테고리1>.yml`
- `keyword-bank/<카테고리2>.yml`
- `keyword-bank/<카테고리3>.yml`
- `knowledge/banned-words.json` (도메인 단어 추가됨)
- `knowledge/conversion-benchmarks.md` (벤치마크 채워짐)

## 완료 후 안내

```
✅ Phase 3 완료 — 도메인 특화 설정 끝났습니다.

이제 다음 명령으로 첫 글을 쓸 수 있어요:
  /blog-new "키워드"

추천 시작 키워드: keyword-bank/<카테고리>.yml의 시드 키워드 중 하나
```
