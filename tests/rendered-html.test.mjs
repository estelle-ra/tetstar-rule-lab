import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://tetstar.example/", {
      headers: {
        accept: "text/html",
        host: "tetstar.example",
        "x-forwarded-host": "tetstar.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete game selector", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /TETSTAR/);
  assert.match(html, /40 LINES/);
  assert.match(html, /BLITZ/);
  assert.match(html, /ZEN/);
  assert.match(html, /ONLINE PARTY/);
  assert.match(html, /2–8 PLAYERS/);
  assert.match(html, /RULE LAB/);
  assert.match(html, /7-BAG · 7종 균등/);
  assert.match(html, /GARBAGE · 공격 방해줄/);
  assert.ok(
    html.indexOf("게임 모드") < html.indexOf("STACK FAST"),
    "mode selection should render before the promotional hero",
  );
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("ships without starter-only assets", async () => {
  const [packageJson, gameClient] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/GameClient.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"name": "tetstar-rule-lab"/);
  assert.match(packageJson, /"peerjs":/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(gameClient, /playersRef\.current\.length >= 8/);
  assert.match(gameClient, /reason: "ROOM_FULL"/);
  assert.match(gameClient, /peer\.connect\(roomPeerId\(code\)/);
  assert.match(gameClient, /aria-label="모바일 게임 조작"/);
  assert.match(gameClient, /initialDelay = 105/);
  assert.match(gameClient, /repeatRate = 38/);
  assert.match(gameClient, /y: 0,/);
  assert.match(gameClient, /gravity: 420/);
  assert.match(gameClient, /hold: "ShiftLeft"/);
  assert.match(gameClient, /occupiedCorners >= 3/);
  assert.match(gameClient, /const LOCK_DELAY_MS = 350/);
  assert.match(gameClient, /const MAX_LOCK_RESETS = 8/);
  assert.match(gameClient, /const MAX_GROUNDED_MS = 1800/);
  assert.match(gameClient, /aria-label="왼손 이동 조이스틱"/);
  assert.match(gameClient, /className="joystick-base"/);
  assert.match(gameClient, /const radius = 46/);
  assert.match(gameClient, /distance >= 18/);
  assert.match(gameClient, /stepDownRef\.current\(\)/);
  assert.match(gameClient, /rules: rulesRef\.current/);
  assert.match(gameClient, /온라인 대전은 방장의 설정을 모든 참가자에게 동일하게 적용합니다/);
  assert.match(gameClient, /T-SPIN DOUBLE!/);
  assert.match(gameClient, /tetstar-identity-v1/);
  assert.match(gameClient, /WELCOME TO TETSTAR/);
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await access(new URL("../public/og.png", import.meta.url));
  await access(
    new URL("../app/fonts/PretendardVariable.woff2", import.meta.url),
  );
  await access(new URL("../public/LICENSE-PRETENDARD.txt", import.meta.url));
});
