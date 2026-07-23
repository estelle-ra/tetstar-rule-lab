import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const allowedOrigins = new Set([
  "https://estelle-ra.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const attempts = new Map<string, { count: number; resetAt: number }>();

function normalizeUsername(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase()
    .slice(0, 16);
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  if (allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function isRateLimited(request: Request, username: string) {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${address}:${username}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

function safeRedirect(value: unknown) {
  const fallback =
    "https://estelle-ra.github.io/tetstar-rule-lab/?recovery=1";
  try {
    const parsed = new URL(String(value ?? fallback));
    if (!allowedOrigins.has(parsed.origin)) return fallback;
    if (
      parsed.origin === "https://estelle-ra.github.io" &&
      !parsed.pathname.startsWith("/tetstar-rule-lab/")
    ) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

const handler = {
  fetch: withSupabase(
    { auth: "publishable" },
    async (request, context) => {
      const origin = request.headers.get("origin") ?? "";
      if (request.method === "OPTIONS") {
        if (!allowedOrigins.has(origin)) {
          return response(request, { error: "ORIGIN_NOT_ALLOWED" }, 403);
        }
        return new Response("ok", {
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "apikey, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            Vary: "Origin",
          },
        });
      }

      if (request.method !== "POST" || !allowedOrigins.has(origin)) {
        return response(request, { error: "REQUEST_NOT_ALLOWED" }, 403);
      }

      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return response(request, { error: "INVALID_JSON" }, 400);
      }

      const action = String(body.action ?? "");
      const username = normalizeUsername(body.username);
      if (!/^[a-z0-9가-힣_-]{2,16}$/.test(username)) {
        return response(request, { error: "username을 확인해주세요." }, 400);
      }
      if (isRateLimited(request, username)) {
        return response(
          request,
          { error: "잠시 후 다시 시도해주세요." },
          429,
        );
      }

      const { data: directory, error: directoryError } =
        await context.supabaseAdmin
          .from("account_directory")
          .select("user_id, email, username_normalized")
          .eq("username_normalized", username)
          .maybeSingle();

      if (directoryError) {
        console.error("DIRECTORY_LOOKUP_FAILED", directoryError.code);
        return response(
          request,
          { error: "로그인 서버 연결을 확인해주세요." },
          500,
        );
      }

      if (action === "reset") {
        if (directory?.email) {
          await context.supabase.auth.resetPasswordForEmail(directory.email, {
            redirectTo: safeRedirect(body.redirectTo),
          });
        }
        return response(request, {
          message: "등록된 계정이 있다면 재설정 메일을 보냈습니다.",
        });
      }

      if (action !== "login" || typeof body.password !== "string") {
        return response(request, { error: "INVALID_ACTION" }, 400);
      }
      if (!directory?.email) {
        return response(
          request,
          { error: "username 또는 비밀번호가 올바르지 않습니다." },
          401,
        );
      }

      const { data, error } = await context.supabase.auth.signInWithPassword({
        email: directory.email,
        password: body.password,
      });
      if (error || !data.session || !data.user) {
        console.warn("PASSWORD_LOGIN_REJECTED", error?.code ?? "NO_SESSION");
        return response(
          request,
          { error: "username 또는 비밀번호가 올바르지 않습니다." },
          401,
        );
      }

      return response(request, {
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
        user: {
          id: data.user.id,
          username: directory.username_normalized,
        },
      });
    },
  ),
};

export default handler;
