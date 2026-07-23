import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://tetrix.example/", {
      headers: {
        accept: "text/html",
        host: "tetrix.example",
        "x-forwarded-host": "tetrix.example",
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
  assert.match(html, /TETRIX/);
  assert.match(html, /40 LINES/);
  assert.match(html, /BLITZ/);
  assert.match(html, /ZEN/);
  assert.match(html, /ONLINE PARTY/);
  assert.match(html, /2–8 PLAYERS/);
  assert.match(html, /RULE LAB/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("ships without starter-only assets", async () => {
  const [packageJson, gameClient] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/GameClient.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"name": "tetrix-rule-lab"/);
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
  assert.match(gameClient, /lockDeadlineRef\.current = window\.performance\.now\(\) \+ 500/);
  assert.match(gameClient, /lockResetCount\.current < 15/);
  assert.match(gameClient, /T-SPIN DOUBLE!/);
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await access(new URL("../public/og.png", import.meta.url));
});
