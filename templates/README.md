# templates/ (deprecated)

> ⚠️ 이 폴더는 더 이상 활성 파이프라인에서 사용되지 않습니다.

## 변경 이력

이 폴더의 `thumbnail.html` / `infographic.html` / `quote-card.html` 은 초기 설계 단계에서
**Nano Banana Pro (Gemini) 이미지 생성의 fallback** 으로 의도된 fixed template 골격이었습니다.
`{{title}}`, `{{keyword}}`, `{{brand}}` 같은 mustache 변수를 채워 쓰는 방식이었습니다.

이후 이미지 생성 방식이 다음과 같이 바뀌었습니다:

1. **Gemini API 호출 제거** — 외부 이미지 모델 의존 없음
2. **`image-designer` 서브에이전트** 가 글마다 4종 HTML 을 **처음부터 직접 디자인** 작성
   ([.claude/agents/image-designer.md](../.claude/agents/image-designer.md) 참고)
3. **`scripts/generate-images.js`** 가 그 HTML들을 headless Chrome 으로 PNG 캡처
4. 같은 골격에 데이터만 갈아끼우는 방식은 폐기 (글마다 컬러 팔레트·레이아웃 패턴이 다름)

## 이 폴더의 파일들

남아있는 HTML 들은 동작하는 시스템에서 더 이상 참조되지 않습니다.

- 어떤 npm install 도, 어떤 스크립트도 이 폴더를 읽지 않습니다.
- `image-designer` 에이전트는 자체 임베드된 디자인 가이드만 사용하며 이 폴더를 참조하지 않습니다.
- 디자인 레퍼런스로 보고 싶으면 그대로 두세요. 정리하고 싶으면 안전하게 삭제 가능합니다.

새 시스템에서 이미지가 어떻게 만들어지는지는 [.claude/agents/image-designer.md](../.claude/agents/image-designer.md) 와
[scripts/generate-images.js](../scripts/generate-images.js) 를 참고하세요.
