# TETRIX Rule Lab

브라우저에서 바로 플레이하는 오리지널 블록 스태커 프로토타입입니다.

## 현재 기능

- 싱글 플레이: Sprint, Blitz, Zen
- 온라인 파티: 각자 다른 기기에서 룸 코드로 접속, 최대 8명
- 실시간 보드 상태, 공격/가비지, 승패 및 재경기
- 룰 실험: 중력, 공격 배율, 고스트 피스

온라인 파티는 PeerJS/WebRTC 기반 P2P 방식입니다. 방장이 탭을 닫으면 방도
종료되며, 회사 네트워크 정책이나 방화벽 환경에 따라 연결이 제한될 수 있습니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

## 검증

```bash
npm run lint
npm test
```

GitHub Pages용 정적 빌드는 다음과 같이 확인할 수 있습니다.

```bash
GITHUB_PAGES=true \
GITHUB_REPOSITORY=estelle-ra/tetrix-rule-lab \
NEXT_PUBLIC_SITE_URL=https://estelle-ra.github.io/tetrix-rule-lab/ \
npm run build:pages
```

## 배포

`main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 정적 사이트를
빌드해 GitHub Pages에 배포합니다.
