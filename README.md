# Mayhem Pocket

광고·게임 연동 없이 필요한 증강과 빌드만 찾는 개인용 로컬 ARAM: Mayhem 도구.
React + TypeScript + Vite · shadcn/ui · Fastify.

## Windows에서 사용

Releases의 `mayhem-pocket-v…-windows-x64.zip`을 받으세요. GitHub의 Source code ZIP은 실행용이 아닙니다.

1. ZIP 압축을 쓰기 가능한 폴더에 풉니다.
2. `.env.example`을 `.env`로 복사하고 `ARAMGG_API_KEY`에 본인 키를 입력합니다.
3. `Mayhem Pocket.exe`를 더블클릭합니다. 터미널 창 없이 서버와 기본 브라우저를 열고 작업 표시줄 알림 영역에 트레이 아이콘을 표시합니다. Node 별도 설치는 필요 없습니다. 기존 `실행.cmd`도 같은 실행기를 엽니다.
4. 목록 갱신(필요 시 1 credit) 후 챔피언 선택 → 상세 받기(필요 시 2 credits)를 누릅니다.
5. 종료는 화면의 종료 버튼, 트레이 우클릭 → `서버 종료`, 또는 `종료.cmd`를 사용합니다. 트레이 더블클릭이나 `화면 열기`로 브라우저를 다시 열 수 있습니다.

브라우저 탭만 닫으면 서버와 트레이는 남습니다. 다시 실행해도 서버는 중복 생성되지 않고 기존 화면을 엽니다. 트레이 아이콘은 Windows 알림 영역의 숨겨진 아이콘(∧) 안에 있을 수 있습니다. 실행 오류는 오류창과 `logs/launcher.log`에 기록하며 트레이의 `로그 폴더 열기`로 확인할 수 있습니다. 로그인 시 자동 시작은 등록하지 않습니다.
업데이트 전 앱을 종료하고 `Mayhem Pocket.exe`, `app/`, `dist/`, `runtime/`, `scripts/`, 실행·종료 스크립트를 교체하세요. `.env`와 `cache/`는 유지합니다. 자동 업데이트는 없습니다.

## 개발

Node 22 이상 필요:

```sh
npm ci
cp .env.example .env
npm run dev
```

화면: http://127.0.0.1:5173 · API: http://127.0.0.1:4318

```sh
npm test
npm run build
npm start
```

## 데이터·비용

[ARAMGG](https://aramgg.com)의 한국어 API를 사용합니다. 무료 플랜은 문서 기준 하루 200 credits, UTC 자정(KST 09시) 초기화입니다. 최신 버전의 목록과 상세는 재다운로드하지 않습니다. 화면에 다운로드 시각·통계 기준일·최신 여부를 구분해 표시합니다. 기존 캐시에 다운로드 시각이 없으면 미기록으로 표시합니다. 전체 증강 수집은 비용 안내를 확인한 뒤 시작하며 다음 날 이어받을 수 있고 상세용으로 20 credits를 남깁니다. API에서 다른 앱의 사용량을 아직 받지 못한 경우 잔량은 예상값입니다. 키가 바뀌면 이전 키의 잔량을 재사용하지 않습니다. 실제 429 응답 시 중단합니다. 기존 캐시는 계속 볼 수 있습니다. 캐시 버전이 다르면 더 최신인 증강을 선택하고 이전 빌드는 버전·다운로드 시각을 표시해 보존합니다. 즐겨찾기·최근 조회·필터는 cache/settings.json에 저장되어 포트가 바뀌어도 유지됩니다. 아이콘 다운로드 실패 시 데이터 관리의 아이콘 다시 받기를 사용할 수 있습니다.

증강 추천 순위와 승률은 서로 다른 표본일 수 있습니다. 빌드는 일반 칼바람 참고용입니다. 음수 또는 wins/games와 불일치하는 승률은 표시하지 않습니다. API가 누락한 정보는 추측하지 않습니다. 키·캐시·이미지·개인 백업은 Git 및 릴리스에서 제외합니다.

## Release

`package.json` 버전과 일치하는 `v0.1.0` 같은 태그를 push하면 Windows CI가 검사·빌드·공식 Node 런타임 포함 ZIP·SHA-256을 생성하고 사전 릴리스를 게시합니다. API 키는 CI에 필요 없습니다. 로컬 패키징은 Windows에서 `npm run package:windows`로 실행합니다.

Windows 10 실사용과 게임 병행 메모리 사용은 실제 PC에서 별도로 검증해야 합니다.

[설계](docs/design.md) · [제3자 고지](THIRD_PARTY_NOTICES.md)

## Windows 실행기 개발

`launcher/Program.cs`는 Windows 기본 .NET Framework의 WinForms 트레이 실행기입니다. 별도의 Chromium이나 웹뷰는 포함하지 않습니다. 패키징 시 Windows의 .NET Framework C# 컴파일러로 GUI 실행 파일을 만들고 Node 프로세스는 창 없이 시작합니다. 서버 상태를 약 2초 간격으로 로컬에서 확인하며 외부 API는 폴링하지 않습니다.

- 트레이 메뉴: 실행 상태, 화면 열기, 로그 폴더 열기, 서버 종료.
- 같은 폴더에서 중복 실행하면 기존 실행기에 화면 열기를 요청합니다.
- 실행기 소유 Node 프로세스는 Windows Job Object로 묶어 실행기 강제 종료 시 정리합니다. 이미 실행 중인 서버에 연결한 경우 임의로 프로세스를 강제 종료하지 않습니다.
- Windows CI의 `node scripts/check-windows.mjs`는 ZIP 생성 후 한글·공백 경로, 중복 실행, 종료 경로, 포트 충돌, 이전 실행 기록, 강제 종료 정리와 필수 파일 누락을 검증합니다.
- `MAYHEM_POCKET_NO_BROWSER=1`은 CI 전용으로 브라우저와 오류창을 생략합니다. `Mayhem Pocket.exe --stop`은 트레이 메뉴와 같은 종료 경로를 호출합니다.
- 실제 Windows 10에서 트레이의 위치·모양, 기본 브라우저 열기, 서명 없는 실행 파일의 보안 안내는 최종 확인이 필요합니다.
