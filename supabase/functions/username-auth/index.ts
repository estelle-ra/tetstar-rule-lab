import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const allowedOrigins = new Set([
  "https://estelle-ra.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const attempts = new Map<string, { count: number; resetAt: number }>();

function firstConfigured(
  directNames: string[],
  collectionName: string,
): string {
  const collection = Deno.env.get(collectionName);
  if (collection) {
    try {
      const values = JSON.parse(collection) as Record<string, string>;
      const selected = values.default ?? Object.values(values)[0];
      if (selected) return selected;
    } catch {
      // Fall back to the legacy single-key environment variable.
    }
  }
  for (const name of directNames) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return "";
}

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

Deno.serve(async (request) => {
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

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = request.headers.get("apikey") ?? "";
  const secretKey = firstConfigured(
    ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    "SUPABASE_SECRET_KEYS",
  );
  if (!url || !publishableKey || !secretKey) {
    return response(request, { error: "SERVER_NOT_CONFIGURED" }, 503);
  }
  if (
    !publishableKey.startsWith("sb_publishable_") &&
    publishableKey.split(".").length !== 3
  ) {
    return response(request, { error: "INVALID_CLIENT" }, 401);
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

  const admin = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: directory } = await admin
    .from("account_directory")
    .select("user_id, email, username_normalized")
    .eq("username_normalized", username)
    .maybeSingle();

  if (action === "reset") {
    if (directory?.email) {
      await client.auth.resetPasswordForEmail(directory.email, {
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

  const { data, error } = await client.auth.signInWithPassword({
    email: directory.email,
    password: body.password,
  });
  if (error || !data.session || !data.user) {
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
});
