# Live Code Map

Claude Code가 Java/Kotlin + Spring 코드를 고치는 동안, **어느 레이어의 어느 클래스에서 어떤 메서드·프로퍼티가 추가·수정·삭제되고 메서드 호출 관계가 어떻게 바뀌는지** 세션별로 브라우저에 실시간으로 그려 주는 Claude Code 플러그인입니다.

> A Claude Code plugin that draws a live class & call diagram of what Claude is changing in your Java/Kotlin + Spring code — per session, in your browser. [English below](#english)

![Live Code Map 데모](docs/demo.gif)

[MP4로 보기](docs/demo.mp4) · 데모는 예제 주문 서비스에 "결제 기능 추가 + 레거시 결제 정리"를 하는 과정입니다.

## 설치

Claude Code에서:

```text
/plugin marketplace add ktae23/live-code-map
/plugin install live-code-map@ktae23
```

Claude Code 2.1.275 이상이면 한 줄로도 됩니다: `/plugin install live-code-map --marketplace ktae23/live-code-map`

예전 이름 `code-map`(0.3 이하)으로 설치했다면 지우고 새로 설치합니다:

```bash
claude plugin uninstall code-map@ktae23
claude plugin marketplace update ktae23
claude plugin install live-code-map@ktae23
```

플러그인 디렉터리에 있는 다른 `code-map`(코드베이스 구조를 정적 HTML로 한 번 그려 주는 플러그인)과는 별개입니다.

필요한 것은 **Node 20 이상**뿐입니다. `npm install`이 없고 외부 패키지도 쓰지 않습니다.

## 쓰는 법

세션을 연다고 지도가 켜지지 않습니다. **Java/Kotlin 코드를 고치는 일을 시킬 때만** Claude가 고치기 전에 한 번 묻습니다.

```text
> 주문 취소 기능 추가해줘

  Code Map  이 작업의 클래스·메서드 변경을 Live Code Map으로 실시간으로 볼까요?
  ❯ 1. 열기                  지금 브라우저로 열기
    2. 이번엔 안 열기         이 세션에서는 다시 묻지 않음
    3. 이 저장소는 항상 열기   다음부터 묻지 않고, 코드가 처음 바뀔 때 자동으로 열기
    4. 이 저장소는 묻지 않기
```

- **열기**를 고르면 브라우저에 `http://127.0.0.1:4747/s/xxxxxxxx`가 열리고, 그 시점이 비교 기준이 됩니다.
- 코드 작업인지는 Claude가 요청 내용을 보고 판단합니다. 질문·코드 리뷰·설명·git·문서·설정 작업에는 묻지 않습니다.
- Gradle·Maven 빌드 파일(`build.gradle(.kts)`, `settings.gradle(.kts)`, `pom.xml`)이 없는 저장소에서는 아무것도 하지 않습니다.
- 질문 없이 바로 켜려면 `/live-code-map`, 저장소에 저장한 "항상 열기/묻지 않기"를 되돌리려면 `/live-code-map reset`.
- **끄기**: 지도 화면 오른쪽 위 **끄기** 버튼, 또는 `/live-code-map off`. 그 세션의 기록을 버리고 이후로는 묻지 않습니다. 다시 켜려면 `/live-code-map`.

세션마다 주소가 따로 있고, 각 화면에는 **그 세션이 고친 코드만** 나옵니다. 같은 저장소에서 여러 세션을 동시에 돌려도 섞이지 않습니다. 켠 세션 목록은 `http://127.0.0.1:4747`에서 볼 수 있습니다.

## 화면에서 보이는 것

| 표시 | 뜻 |
|---|---|
| 열 | Controller · Service · Repository · Domain · DTO·기타 (애너테이션과 이름 규칙으로 분류) |
| 초록 / 파랑 / 빨간 취소선 | 이번 요청에서 추가 / 수정 / 삭제 (IntelliJ 변경 색과 같은 체계) |
| 보라색 깜빡임 | Claude가 지금 고치려는 파일 |
| 회색 화살표 | 생성자 주입·필드 의존 (`private val repo: OrderRepository`, Lombok `@RequiredArgsConstructor` final 필드) |
| 점선 + 빈 삼각형 | 인터페이스 구현 |
| 멤버 줄을 잇는 주황 선 | 메서드 호출. 초록은 새로 생긴 호출, 빨간 점선은 끊긴 호출 |
| 흐린 카드 | 바뀐 코드와 연결된 클래스(맥락). 호출로 이어진 멤버만 보여 줌 |
| 라우트 태그 | `POST /orders/{id}/pay`처럼 클래스·메서드 매핑을 합친 경로 |

- **영향 범위**: 수정된 메서드를 부르는 쪽도 함께 그려서 "이 수정이 어디에 영향을 주는지"가 보입니다.
- 멤버나 클래스 이름을 누르면 이번 요청 전후의 코드 diff가 열립니다. 멤버에 마우스를 올리면 그 멤버의 호출선만 강조됩니다.
- 오른쪽 타임라인에 변경이 순서대로 쌓이고, **다시보기**로 처음부터 재생할 수 있습니다.
- 상단의 **의존 / 호출** 버튼으로 관계선을 켜고 끕니다. 드래그로 이동, ⌘/Ctrl + 휠로 확대·축소.

## 동작 방식

```text
Claude Code 훅 ──▶ 로컬 서버(127.0.0.1:4747) ──SSE──▶ 브라우저
 UserPromptSubmit         · Java/Kotlin 저장소면 "코드 작업이면 열지 물어보라"는 안내를 Claude에 붙임
                            (켠 세션이면 요청마다 기준 시점 저장)
 PostToolUse(질문 답)     · 답을 읽어 지도를 켜고 브라우저를 엶, 저장소별 선택 저장
 PreToolUse               · "수정 중" 표시
 PostToolUse(파일 수정)   · 고친 파일을 바로 다시 읽고 이 세션 몫으로 기록
 Stop / SessionEnd        · 요청 끝 → 전체 맞춤
                          + 파일 감시(셸·IDE로 고친 것도 반영)
```

- 서버는 누군가 지도를 켤 때 훅이 백그라운드로 띄우고, 할 일이 없으면 스스로 종료합니다. 지도를 켜지 않은 세션의 이벤트는 받지 않습니다.
- 서버는 컴퓨터에 하나(포트 4747)만 뜨고 모든 세션이 같이 씁니다. 세션은 서버 안에서 세션 id로 나뉘고, 각 세션 화면에는 그 세션이 고친 파일만 들어갑니다. 지도를 켜지 않은 세션이 같은 저장소에서 고친 파일도 "그 세션 것"으로 표시해 다른 세션 지도에 섞이지 않게 합니다.
- 플러그인을 업데이트하면 더 새 버전의 훅이 예전 버전 데몬을 내리고 새로 띄웁니다. 켜 둔 세션은 다음 요청 때 다시 등록되고, 열려 있던 화면은 그때 자동으로 다시 이어집니다. 직접 띄운 서버(`--demo`, 폴더 모드)는 건드리지 않습니다.
- 4747 포트를 다른 프로그램이 쓰고 있으면 지도를 켤 수 없다고 알려 줍니다. `CODE_MAP_PORT`로 다른 포트를 지정하세요.
- **서브에이전트**: 서브에이전트가 고친 파일도 부른 세션의 지도에 그려지고, 타임라인에 서브에이전트 이름이 붙습니다. 여러 서브에이전트가 동시에 고쳐도 도구 호출마다 순서대로 반영됩니다. `isolation: worktree` 서브에이전트가 별도 작업 트리(`.claude/worktrees/`)에서 고친 내용은 메인 체크아웃에 합쳐질 때 반영되고, 작업 트리 안의 복사본은 지도에 넣지 않습니다.
- 묻는 안내는 지도를 켜거나 끄기로 정할 때까지 Java/Kotlin 저장소의 요청마다 붙습니다(약 150토큰).
- 파서는 직접 작성했습니다. 클래스·생성자·프로퍼티·필드·메서드·애너테이션·상속을 읽고, 메서드 본문에서는 호출만 뽑습니다. 호출 대상은 필드·생성자 파라미터·메서드 파라미터·지역 변수·반환 타입을 따라가 정적으로 추론합니다.

## 설정 (환경 변수)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `CODE_MAP_MODE` | `ask` | `ask`: 코드 작업 때 물어봄 · `always`: 묻지 않고 모든 Java/Kotlin 저장소에서 켬 · `off`: 끔 |
| `CODE_MAP_PORT` | `4747` | 서버 포트 |
| `CODE_MAP_BROWSER` | (기본 브라우저) | 지도를 열 브라우저 앱 이름(macOS), 예: `Arc`, `Aside`. `none`이면 열지 않음 |
| `CODE_MAP_DISABLE` | | `1`이면 `CODE_MAP_MODE=off`와 같음 |

환경 변수는 `~/.claude/settings.json`의 `env`에 넣으면 됩니다.

## 보안·개인정보

- 서버는 `127.0.0.1`에만 열리고 `Host`/`Origin` 헤더를 검사해 다른 사이트가 소스를 읽어 가지 못하게 막습니다.
- 외부로 아무것도 보내지 않습니다. 텔레메트리도 없습니다. 프롬프트와 코드는 서버 메모리에만 있고 종료하면 사라집니다.
- 디스크에 남기는 것은 선택뿐입니다: 세션별 켬/끔과 저장소별 "항상/묻지 않기"를 플러그인 데이터 폴더(`~/.claude/plugins/data/live-code-map-ktae23/`)에 저장하고, 일주일 지난 세션 기록은 지웁니다.
- 외부 의존성이 없어 공급망 위험이 없고, 사내 PC에도 그대로 쓸 수 있습니다.

## 플러그인 없이 쓰기

```bash
git clone https://github.com/ktae23/live-code-map
node live-code-map/server.mjs /path/to/my-spring-project   # 이 폴더의 모든 변경을 그림
node live-code-map/server.mjs --demo                         # 데모: http://127.0.0.1:4747/s/demo
```

훅만 직접 걸고 싶다면 `hooks/settings.example.json`을 `~/.claude/settings.json`이나 프로젝트의 `.claude/settings.local.json`에 넣고 경로를 바꿉니다.

## 한계

- 정적 추론이라 잡지 못하는 호출이 있습니다: 람다의 `it`, 컬렉션 원소, 상속받은 Spring Data 메서드(`findById` 등), 리플렉션·프록시. 오버로드는 이름으로 연결합니다.
- 컴파일러가 아니라 선언부 파서입니다. 괄호가 안 맞는 중간 저장 상태는 건너뛰고, 맞춰지면 반영합니다.
- 같은 저장소에서 여러 세션이 동시에 작업할 때, 셸 명령으로 고친 파일은 지도를 켠 모든 작업 중 세션 화면에 보일 수 있습니다. Edit·Write 도구로 고친 파일은 정확히 그 세션에만 보입니다.
- 묻기는 Claude의 AskUserQuestion 도구를 씁니다. `claude -p`처럼 질문할 수 없는 실행에서는 묻지 않으니 `/live-code-map`이나 `CODE_MAP_MODE=always`를 쓰세요.
- Bash 샌드박스를 켜 두면 `/live-code-map`이 로컬 서버에 닿지 못할 수 있습니다. 질문에 답해서 여는 방식은 훅이 처리하므로 영향이 없습니다.
- macOS에서 개발·검증했습니다. Linux는 Node 20 이상에서 동작해야 하고, Windows는 아직 확인하지 않았습니다.

## 파일 구성

```text
.claude-plugin/     플러그인·마켓플레이스 매니페스트, 아이콘
hooks/              hooks.json(훅 설정), notify.mjs(훅 → 서버), state.mjs(켬/끔 선택), open.mjs(/live-code-map)
skills/live-code-map/  /live-code-map 스킬
server.mjs          로컬 서버: 세션·프로젝트 관리, 파일 감시, SSE
lib/parse.mjs       Java/Kotlin 선언부 + 호출 파서
lib/model.mjs       레이어 분류, 의존·호출 그래프, 두 시점 비교
lib/project.mjs     저장소 하나의 파일·클래스 상태
lib/root.mjs        저장소 루트 찾기, Java/Kotlin 프로젝트 판별
lib/session.mjs     Claude 세션 하나의 화면 상태
public/             화면(HTML/CSS/JS, 외부 라이브러리 없음)
demo/               예제 Spring 프로젝트와 데모 시나리오
```

## English

**Live Code Map** is a Claude Code plugin that shows, in a browser tab next to your terminal, a live diagram of what Claude is changing in Java/Kotlin + Spring code.

- Classes are laid out in Spring layers (Controller → Service → Repository → Domain → DTO).
- Added / modified / deleted members are highlighted as they happen; the file Claude is about to edit pulses.
- Dependency arrows (constructor injection, fields, implements) and **method-to-method call lines** — including new calls, removed calls, and callers of modified methods (impact).
- Opt-in per session: when you ask Claude to change Java/Kotlin code, it asks once whether to open the map (Open / Not now / Always in this repo / Never in this repo). Nothing runs for sessions you don't open.
- One view per Claude session; parallel sessions in the same repo don't mix.
- Click any member for a before/after diff of the current request; replay the whole request.
- Zero dependencies, local only (127.0.0.1, Host/Origin checked), no telemetry. Requires Node 20+.

```text
/plugin marketplace add ktae23/live-code-map
/plugin install live-code-map@ktae23
```

Ask Claude for a Java/Kotlin change and pick **Open** when it asks, or run `/live-code-map`. Turn it off with the **Off** button on the page or `/live-code-map off`; `/live-code-map reset` forgets the per-repo choice. Subagent edits show up on the calling session's map, tagged with the subagent name. `CODE_MAP_MODE=always` skips the question. Try it without Claude: `node server.mjs --demo`.

## License

MIT
