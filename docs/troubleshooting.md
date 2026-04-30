# 트러블슈팅

자주 발생하는 문제와 해결법.

---

## 설치 단계

### 1. `claude command not found`
**원인**: Claude Code 미설치
**해결**: https://docs.claude.com/en/docs/claude-code 참조하여 설치 후 터미널 재시작.

### 2. `Node version too old` 또는 `fetch is not defined`
**원인**: Node 20 미만 버전
**해결**: https://nodejs.org 에서 LTS(20+) 설치. 확인:
```bash
node --version  # v20.0.0 이상이어야 함
```

### 3. `Cannot find module 'X'`
**원인**: 외부 패키지를 깐 적이 있음
**해결**: 이 레포는 외부 의존성 0입니다. `node_modules/` 삭제 후 그냥 `node scripts/...` 실행.
```bash
rm -rf node_modules package-lock.json
node scripts/research.js --keyword "테스트"
```

---

## 셋업 단계

### 4. `/setup`이 작동 안 함
**원인**: `.claude/agents/setup-interviewer.md` 또는 `.claude/commands/setup.md` 누락
**해결**:
```bash
ls .claude/agents/setup-interviewer.md
ls .claude/commands/setup.md
```
없으면 git pull로 최신 버전 받기.

### 5. `setup-interviewer` 서브에이전트가 특정 회사 정보를 예시로 듬
**원인**: 절대 그러면 안 됨. 버그.
**해결**: GitHub Issue로 신고. 즉시 패치합니다.

### 6. `/setup-tone` URL 수집 실패
**원인**: 네이버 블로그 모바일 변환 실패 또는 본문 영역 추출 실패
**해결**:
1. URL이 모바일 형식인지 확인 (`m.blog.naver.com/...`)
2. 본문이 200자 미만이면 스크립트가 거부함 → 다른 글 URL 시도
3. 모두 실패 시 수동 모드 사용 (글 직접 복사 → `knowledge/tone-samples/real-blog-posts.txt`에 붙여넣기)

---

## 글 생성 단계

### 7. `Chrome 또는 Edge 를 찾지 못했습니다`
**원인**: 시스템에 Chrome / Edge 가 설치돼 있지 않거나 자동 탐지 경로에 없음
**해결**:
1. Google Chrome 또는 Microsoft Edge 를 설치 (대부분 OS 에 기본 설치)
2. 그래도 안 잡히면 `.env` 에 직접 경로 지정:
   ```
   CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
   ```
3. Linux: `apt install chromium-browser` 또는 `apt install google-chrome-stable`

### 8. 네이버 API `code: '024'` 인증 실패
**원인**: NAVER_CLIENT_ID/SECRET 잘못됨 또는 일일 호출 한도 초과
**해결**:
1. https://developers.naver.com → 내 애플리케이션 → 키 재확인
2. 일일 25,000회 한도 확인
3. 일시적이면 시스템이 자동으로 WebSearch 대체 모드로 전환합니다 (키 없어도 동작)

### 9. 글에 회사 정보가 안 들어감
**원인**: `knowledge/brand-facts.md`가 없거나 placeholder 상태
**동작**: 이 경우 시스템이 회사 고유 수치를 박지 않는 **일반 가이드 모드**로 글을 씁니다(중단되지 않음).
**원하면**: `/setup` 5분 인터뷰로 회사 정보를 등록하면 그때부터 자사 수치를 본문에 사용합니다.
```bash
cat knowledge/brand-facts.md | head -3
# 파일이 없거나 [PLACEHOLDER]로 시작하면 일반 모드로 동작
```

### 10. 글에 데모/예시 회사명이나 수치가 들어감
**원인**: 절대 그러면 안 됨. 외부 공개판은 특정 회사 정보 0건이어야 함.
**해결**: GitHub Issue 즉시 신고.
```bash
bash scripts/sanitize-check.sh
```
실행해서 결과 첨부.

---

## 품질 검사 단계

### 11. 훅이 자동 실행 안 됨
**원인**: `.claude/settings.json` 미인식 또는 권한 문제
**해결**:
```bash
cat .claude/settings.json  # PostToolUse 훅이 있는지 확인
ls -la scripts/hook-post-write.js  # 실행 권한 확인
chmod +x scripts/hook-post-write.js
```

### 12. quality-check.js 실패
**원인**: `--keyword` 인자 누락 또는 파일 경로 오류
**해결**:
```bash
node scripts/quality-check.js --file output/폴더/post.md --keyword "키워드"
```

### 13. duplicate-check.js가 항상 0%
**원인**: `output/` 폴더에 비교 대상 글이 없음 (첫 글이라 정상)
**해결**: 무시. 두 번째 글부터는 정상 작동합니다.

---

## 이미지 생성 단계

### 14. 이미지가 캡처는 됐는데 한글이 □□□ 로 깨져 보임
**원인**: 시스템에 한국어 폰트가 부족하거나 Pretendard 가 Google Fonts CDN 에서 로드되지 않음
**해결**:
1. 시스템 폰트 확인: Windows 는 Malgun Gothic, Mac 은 Apple SD Gothic Neo, Linux 는 `apt install fonts-noto-cjk` 로 Noto Sans KR 설치
2. 인터넷 연결이 차단된 환경이면 Google Fonts CDN 이 안 닿아 Pretendard 가 로드 안 됨 — 그래도 시스템 폰트 fallback 으로 한국어는 정상 렌더돼야 함
3. 로컬에 Pretendard 를 설치하면 가장 깔끔: https://github.com/orioncactus/pretendard

### 15. 이미지 PNG 파일이 비정상적으로 작음 (1KB 미만)
**원인**: headless Chrome 캡처가 빈 페이지를 캡처했거나 HTML 에 오류
**해결**:
1. `output/<폴더>/images/_html/*.html` 을 직접 브라우저에서 열어 시각적 확인
2. `<html>`/`<body>` 의 width/height 가 `<meta name="capture-size">` 와 일치하는지 확인
3. 콘솔에 에러가 있으면 image-designer 에이전트에게 재디자인 요청

---

## 발행 어시스턴트 단계

### 16. `preview.html`이 안 열림
**원인**: `child_process` open 실패 (Windows/Linux 차이)
**해결**:
```bash
node scripts/preview.js --folder output/폴더 --no-open
# 그 후 output/폴더/preview.html을 직접 더블클릭
```

### 17. 네이버 에디터에 복사하면 서식이 사라짐
**원인**: `navigator.clipboard.write` API가 일부 환경에서 미동작
**해결**: 이 시스템은 fallback으로 `contentEditable + execCommand` 방식을 사용합니다. 그래도 안 되면:
1. Chrome/Edge 최신 버전 사용 권장
2. preview.html을 https:// 로 띄우기 (file:// 보다 호환성 ↑)
3. "텍스트만 복사" 버튼 사용

---

## 보안

### 18. 내 회사 데이터가 git에 올라가 있어요
**원인**: `.gitignore` 우회 또는 강제 add
**해결**: 즉시:
```bash
git rm --cached knowledge/brand-facts.md
git rm --cached knowledge/tone-samples/real-blog-posts.txt
git rm -r --cached output/
git commit -m "Remove company data from tracking"
git push
```
이미 push 됐으면 `git filter-branch` 또는 BFG Repo-Cleaner로 히스토리 정리 + 키 재발급 필수.

### 19. push 전 검증 자동화
**해결**:
```bash
npm run sanitize-check
# 또는 직접
bash scripts/sanitize-check.sh
```
0건 통과해야 push 권장.

---

## 그 외

문제가 위 19개에 없으면 https://github.com/shdsjh123-cpu/claude-code-blog-builder/issues 에 신고해주세요.
