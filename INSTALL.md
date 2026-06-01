# 설치 가이드 (30초)

## 1. 요구 사항 점검

```bash
node --version    # v20.0.0 이상
claude --version  # Claude Code 설치 확인
```

Node 20 미만이면 https://nodejs.org 에서 LTS 설치.
Claude Code 미설치면 https://docs.claude.com/en/docs/claude-code 참조.

또한 이미지 캡처용으로 **Google Chrome** 또는 **Microsoft Edge** 가 시스템에 설치돼 있어야 합니다 (대부분의 OS 에 기본 설치됨). 외부 이미지 API 는 사용하지 않습니다.

## 2. 레포 clone

```bash
git clone https://github.com/shdsjh123-cpu/claude-code-blog-builder.git
cd claude-code-blog-builder
```

## 3. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 다음을 채웁니다 (모두 선택사항):

| 키 | 필수 | 발급처 |
|:---|:---:|:---|
| `NAVER_CLIENT_ID` | ⚪ | https://developers.naver.com (없으면 웹 검색 대체) |
| `NAVER_CLIENT_SECRET` | ⚪ | 위와 동일 |
| `CHROME_PATH` | ⚪ | Chrome/Edge 자동 탐지 실패 시에만 직접 경로 지정 |

이미지 생성용 외부 API 키는 필요하지 않습니다 (시스템 Chrome 으로 직접 캡처).

## 4. Claude Code 실행

```bash
claude
```

## 5. 셋업

```
/setup
```

5분 인터뷰가 시작됩니다. 7개 질문에 답하면 끝.

## 6. 첫 글 쓰기

```
/blog-new "여러분 키워드"
```

`output/<날짜>_<키워드>/` 폴더에 풀세트가 생성됩니다.

## 7. 발행

```
/blog-preview output/<폴더>
```

브라우저가 열리면 섹션별 복사 버튼으로 네이버 스마트에디터에 옮기세요.

---

## 문제 해결

설치/실행 중 문제가 발생하면 [docs/troubleshooting.md](docs/troubleshooting.md) 참조.

자주 발생하는 5가지 문제:
1. `claude command not found` → Claude Code 설치 안 됨
2. `Node version too old` → Node 20+ 필요
3. `Chrome 또는 Edge 를 찾지 못했습니다` → Chrome/Edge 설치, 또는 `.env` 의 `CHROME_PATH` 지정
4. `훅이 자동 실행 안 됨` → `.claude/settings.json` 권한 확인
5. `preview.html이 안 열림` → `--no-open` 플래그 빼고 재실행
