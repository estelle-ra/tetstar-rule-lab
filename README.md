# TETSTAR Rule Lab

브라우저에서 바로 플레이하는 오리지널 블록 스태커 프로토타입입니다.

## 현재 기능

- 싱글 플레이: Sprint, Blitz, Zen
- 온라인 파티: 각자 다른 기기에서 룸 코드로 접속, 최대 8명
- 실시간 보드 상태, 공격/가비지, 승패 및 재경기
- 룰 실험: 중력, 공격 배율, 고스트 피스

온라인 파티는 Supabase Realtime Broadcast 방식입니다. 방장이 탭을 닫으면
방도 종료되며, 방 코드별 실시간 채널로 게임 상태와 채팅을 전달합니다.
Supabase 설정이 없는 로컬 환경에서는 PeerJS/WebRTC 방식으로 대체됩니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

Supabase 계정 기능을 사용하려면 `.env.example`을 참고해
`NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를
설정합니다. Secret 또는 service role 키는 브라우저 빌드에 넣지 않습니다.

## Supabase 구성

- `supabase/migrations/20260723153000_accounts.sql`: 프로필, username
  디렉터리, 모드별 기록과 RLS 정책
- `supabase/migrations/20260723162000_lock_profile_and_record_writes.sql`:
  레벨·랭킹 기록을 브라우저에서 임의 수정하지 못하도록 쓰기 권한 잠금
- `supabase/migrations/20260724002500_allow_username_auth_directory_read.sql`:
  username 로그인 함수에 계정 디렉터리 읽기 권한만 부여
- `supabase/functions/username-auth`: username 로그인과 비밀번호 재설정
- 가입은 username + email + password, 로그인은 username + password

## 검증

```bash
npm run lint
npm test
```

GitHub Pages용 정적 빌드는 다음과 같이 확인할 수 있습니다.

```bash
GITHUB_PAGES=true \
GITHUB_REPOSITORY=estelle-ra/tetstar-rule-lab \
NEXT_PUBLIC_SITE_URL=https://estelle-ra.github.io/tetstar-rule-lab/ \
npm run build:pages
```

## 배포

`main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 정적 사이트를
빌드해 GitHub Pages에 배포합니다.
