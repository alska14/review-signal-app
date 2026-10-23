# API 키 발급 (서버 연결 전)

이메일 확인 뒤 키를 발급하는 기능입니다. 로직과 시험(`tests/keys.test.js`)은 끝났고 **서버 연결만 남았습니다.** 이 앱의 로컬 MCP·로컬 API는 키가 필요 없습니다. 키는 인터넷에 열린 서버를 만들 때만 의미가 있습니다.

## 만든 것
- `../emailcheck.js`: 이메일 형식 점검(브라우저·서버 공용). 공백·잘못된 형식, 일회용·예시·테스트 도메인, 임시로 만든 듯한 이름을 거릅니다. 지메일의 점·`+별칭` 변형은 같은 사람으로 봅니다.
- `service.mjs`: 요청 → 도메인의 메일 수신 가능 여부(MX/A) 확인 → 인증 메일 → 링크(30분, 한 번만) → 키 발급(원문은 한 번만 보여 주고 해시만 저장). 이메일당 시간당 3번, 같은 접속지당 10번 제한. 같은 사람이 다시 받으면 이전 키 폐기.
- `handlers.mjs`: `POST /keys/request`, `GET|POST /keys/verify`, 키로 보호되는 `POST /v1/verify`·`/v1/check`·`/v1/score`, `GET /health`. 허용한 출처에만 CORS 헤더를 붙입니다.
- `dev-server.mjs`: 내 컴퓨터(127.0.0.1)에서만 열리는 개발 서버. 메일은 실제로 보내지 않고 `/dev/outbox` 에 쌓습니다. `node keys/dev-server.mjs` 후 화면의 `config.js` 에 `http://127.0.0.1:8788` 을 넣으면 'API 키' 칸이 켜집니다(허용 출처는 `dev-server.mjs` 에서 맞추세요).

## 서버에 올릴 때 남은 일
1. 호스팅 선택(Vercel·Cloudflare Workers 등)과 HTTPS 주소. `handlers.mjs` 의 `createHandlers(...)` 를 그 서비스의 요청 형식에 감싸면 됩니다.
2. 저장소: `memoryStore()` 를 같은 모양(`get/set/del`)의 KV·DB로 교체(만료 처리 포함).
3. 메일: `devMailer()` 를 `resendMailer({apiKey, from})` 로 교체하고, 발신 도메인의 SPF/DKIM 설정. 메일 서비스 키는 서버 환경변수로만 두고 저장소·ZIP에 넣지 않습니다. **`resendMailer` 는 실제 서비스로 시험하지 못했습니다.**
4. 개인정보 고지: 수집 항목(이메일), 목적, 보유 기간, 파기 방법, 위탁(메일 발송·호스팅), 삭제 요청 경로를 화면에 적어야 합니다.
5. `config.js` 의 `REVIEW_SIGNAL_API_BASE` 에 서버 주소를 넣고 `index.html` 의 개인정보 문구를 실제 상태에 맞게 고칩니다.

## 한계
가짜 이메일을 완벽히 걸러낼 수 없습니다. 인증 메일 링크를 누른 사람이 그 사서함에 접근할 수 있다는 것만 확인됩니다. 일회용 도메인 목록은 일부이며, 신원 확인은 하지 않습니다.
