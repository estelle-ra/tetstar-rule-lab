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
  assert.match(html, /SINGLEPLAYER/);
  assert.match(html, /MULTIPLAYER/);
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
  const [
    packageJson,
    gameClient,
    authGate,
    profileDashboard,
    migration,
    writeLockMigration,
    directoryGrantMigration,
    socialMigration,
    personalBestMigration,
    usernameAuth,
    icon,
  ] =
    await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../app/GameClient.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/AuthGate.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/ProfileDashboard.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/migrations/20260723153000_accounts.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/migrations/20260723162000_lock_profile_and_record_writes.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/migrations/20260724002500_allow_username_auth_directory_read.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/migrations/20260724033000_records_friends_leaderboards.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/migrations/20260724060000_personal_best_result.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/functions/username-auth/index.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../app/icon.svg", import.meta.url), "utf8"),
    ]);

  assert.match(packageJson, /"name": "tetstar-rule-lab"/);
  assert.match(packageJson, /"peerjs":/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(gameClient, /playersRef\.current\.length >= 8/);
  assert.match(gameClient, /reason: "ROOM_FULL"/);
  assert.match(gameClient, /peer\.connect\(roomPeerId\(code\)/);
  assert.match(gameClient, /searchParams\.set\("room", roomCode\)/);
  assert.match(gameClient, /COPY INVITE LINK/);
  assert.match(gameClient, /type: "chat-submit"/);
  assert.match(gameClient, /PARTY CHAT/);
  assert.match(gameClient, /screen === "versus" && !multiplayerPlaying/);
  assert.match(gameClient, /nextScreen !== "versus"/);
  assert.match(gameClient, /submit_game_result/);
  assert.match(gameClient, /NEW PERSONAL BEST/);
  assert.match(gameClient, /inputBlockedUntilRef/);
  assert.match(gameClient, /clearRepeatHandles/);
  assert.match(gameClient, /RETRY JOIN/);
  assert.match(gameClient, /MULTIPLAYER INVITE/);
  assert.match(gameClient, /connectionTimeoutRef/);
  assert.match(gameClient, /retryCount < 1/);
  assert.match(gameClient, /자동으로 한 번 더 시도/);
  assert.match(gameClient, /if \(connection\.open\) registerConnection\(\)/);
  assert.doesNotMatch(gameClient, /online-mode-label/);
  assert.match(gameClient, /GAME_THEMES/);
  assert.match(gameClient, /themes\/\$\{gameTheme\}\.webp/);
  assert.match(gameClient, /onMatchResult/);
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
  assert.match(authGate, /WELCOME TO TETSTAR/);
  assert.match(authGate, /CREATE ACCOUNT/);
  assert.match(authGate, /SEND RESET LINK/);
  assert.match(authGate, /ProfileDashboard/);
  assert.match(profileDashboard, /모드별 최고 기록/);
  assert.match(profileDashboard, /send_friend_request/);
  assert.match(profileDashboard, /친구 기록 랭킹/);
  assert.match(migration, /alter table public\.profiles enable row level security/);
  assert.match(migration, /is_username_available/);
  assert.match(writeLockMigration, /revoke update on public\.profiles/);
  assert.match(
    writeLockMigration,
    /revoke insert, update on public\.mode_records/,
  );
  assert.match(
    directoryGrantMigration,
    /grant select on public\.account_directory to service_role/,
  );
  assert.match(usernameAuth, /withSupabase/);
  assert.match(usernameAuth, /context\.supabaseAdmin/);
  assert.match(usernameAuth, /username 또는 비밀번호가 올바르지 않습니다/);
  assert.doesNotMatch(usernameAuth, /sb_secret_|service_role.*=/i);
  assert.match(socialMigration, /create table if not exists public\.friendships/);
  assert.match(socialMigration, /create or replace function public\.record_game_result/);
  assert.match(socialMigration, /security definer/);
  assert.match(socialMigration, /participants read friendships/);
  assert.match(socialMigration, /records readable by player or friends/);
  assert.match(
    personalBestMigration,
    /create or replace function public\.submit_game_result/,
  );
  assert.match(personalBestMigration, /'personal_best'/);
  assert.match(personalBestMigration, /security definer/);
  assert.match(icon, /<svg/);
  assert.match(icon, /<rect/);
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/themes/megacity.webp", import.meta.url));
  await access(new URL("../public/themes/orbit.webp", import.meta.url));
  await access(new URL("../public/themes/refinery.webp", import.meta.url));
  await access(
    new URL("../app/fonts/PretendardVariable.woff2", import.meta.url),
  );
  await access(new URL("../public/LICENSE-PRETENDARD.txt", import.meta.url));
});
