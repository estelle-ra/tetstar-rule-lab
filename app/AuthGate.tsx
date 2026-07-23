"use client";

import { useMemo, useState } from "react";
import { supabase, supabaseConfig } from "./lib/supabase";

export type PlayerIdentity = {
  username: string;
  guest: boolean;
  userId?: string;
};

type View = "login" | "signup" | "forgot" | "guest" | "profile" | "update";

function normalizeUsername(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase()
    .slice(0, 16);
}

function accountUsername(value: string) {
  return normalizeUsername(value).toUpperCase();
}

function currentPageUrl() {
  return window.location.href.split(/[?#]/)[0];
}

async function callUsernameAuth(body: Record<string, string>) {
  if (!supabaseConfig.configured) {
    throw new Error("계정 서버 연결이 아직 설정되지 않았습니다.");
  }

  const response = await fetch(
    `${supabaseConfig.url}/functions/v1/username-auth`,
    {
      method: "POST",
      headers: {
        apikey: supabaseConfig.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    session?: {
      access_token: string;
      refresh_token: string;
    };
    user?: { id: string; username: string };
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
  }
  return payload;
}

export default function AuthGate({
  identity,
  canClose,
  recoveryMode,
  onIdentity,
  onSignOut,
  onRecoveryComplete,
  onClose,
}: {
  identity: PlayerIdentity | null;
  canClose: boolean;
  recoveryMode: boolean;
  onIdentity: (identity: PlayerIdentity) => void;
  onSignOut: () => void;
  onRecoveryComplete: () => void;
  onClose: () => void;
}) {
  const initialView: View = recoveryMode
    ? "update"
    : identity
      ? "profile"
      : "login";
  const [view, setView] = useState<View>(initialView);
  const [username, setUsername] = useState(identity?.username ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const normalizedUsername = useMemo(
    () => normalizeUsername(username),
    [username],
  );
  const configured = supabaseConfig.configured && Boolean(supabase);

  const changeView = (next: View) => {
    setView(next);
    setError("");
    setMessage("");
    setPassword("");
    setPasswordConfirm("");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "요청을 처리하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const login = () =>
    run(async () => {
      if (!supabase || normalizedUsername.length < 2 || password.length < 8) {
        throw new Error("username과 8자 이상의 비밀번호를 확인해주세요.");
      }
      const payload = await callUsernameAuth({
        action: "login",
        username: normalizedUsername,
        password,
      });
      if (!payload.session || !payload.user) {
        throw new Error("로그인 정보를 받지 못했습니다.");
      }
      const { error: sessionError } = await supabase.auth.setSession(
        payload.session,
      );
      if (sessionError) throw sessionError;
      onIdentity({
        username: accountUsername(payload.user.username),
        guest: false,
        userId: payload.user.id,
      });
    });

  const signup = () =>
    run(async () => {
      if (!supabase || normalizedUsername.length < 2) {
        throw new Error("username은 2–16자로 입력해주세요.");
      }
      if (!email.includes("@")) {
        throw new Error("이메일 주소를 확인해주세요.");
      }
      if (password.length < 8) {
        throw new Error("비밀번호는 8자 이상이어야 합니다.");
      }
      if (password !== passwordConfirm) {
        throw new Error("비밀번호 확인이 일치하지 않습니다.");
      }

      const { data: available, error: availabilityError } = await supabase.rpc(
        "is_username_available",
        { candidate: normalizedUsername },
      );
      if (availabilityError) throw availabilityError;
      if (!available) throw new Error("이미 사용 중인 username입니다.");

      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: currentPageUrl(),
          data: { username: normalizedUsername },
        },
      });
      if (signupError) throw signupError;

      if (data.session && data.user) {
        onIdentity({
          username: accountUsername(normalizedUsername),
          guest: false,
          userId: data.user.id,
        });
        return;
      }
      setMessage(
        "가입 확인 메일을 보냈습니다. 메일에서 확인한 뒤 username으로 로그인하세요.",
      );
    });

  const resetRequest = () =>
    run(async () => {
      if (normalizedUsername.length < 2) {
        throw new Error("가입할 때 사용한 username을 입력해주세요.");
      }
      await callUsernameAuth({
        action: "reset",
        username: normalizedUsername,
        redirectTo: `${currentPageUrl()}?recovery=1`,
      });
      setMessage(
        "등록된 계정이 있다면 비밀번호 재설정 메일을 보냈습니다.",
      );
    });

  const saveGuest = () => {
    if (normalizedUsername.length < 2) {
      setError("username은 2–16자로 입력해주세요.");
      return;
    }
    onIdentity({
      username: accountUsername(normalizedUsername),
      guest: true,
    });
  };

  const updatePassword = () =>
    run(async () => {
      if (!supabase || password.length < 8) {
        throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
      }
      if (password !== passwordConfirm) {
        throw new Error("비밀번호 확인이 일치하지 않습니다.");
      }
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
      setMessage("비밀번호가 변경되었습니다.");
      onRecoveryComplete();
    });

  const logout = () =>
    run(async () => {
      await supabase?.auth.signOut();
      onSignOut();
    });

  const submit = () => {
    if (busy) return;
    if (view === "login") void login();
    if (view === "signup") void signup();
    if (view === "forgot") void resetRequest();
    if (view === "guest") saveGuest();
    if (view === "update") void updatePassword();
  };

  return (
    <div className="identity-gate" role="dialog" aria-modal="true">
      <div className="identity-card auth-card">
        {canClose && !recoveryMode && (
          <button
            className="identity-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        )}
        <span className="eyebrow">PLAYER IDENTITY</span>
        <h2>
          {view === "profile"
            ? identity?.username
            : view === "update"
              ? "NEW PASSWORD"
              : "WELCOME TO TETSTAR"}
        </h2>

        {view === "profile" ? (
          <>
            <p>
              {identity?.guest
                ? "이 기기에 저장된 게스트 프로필입니다."
                : "Supabase 계정으로 로그인되어 기록을 저장할 수 있습니다."}
            </p>
            <div className="profile-summary">
              <span>{identity?.guest ? "GUEST" : "ACCOUNT"}</span>
              <strong>{identity?.username}</strong>
            </div>
            {identity?.guest ? (
              <div className="auth-actions">
                <button onClick={() => changeView("guest")}>
                  USERNAME 변경
                </button>
                <button onClick={() => changeView("login")}>
                  계정 로그인
                </button>
              </div>
            ) : (
              <button className="identity-submit" onClick={() => void logout()}>
                LOG OUT
              </button>
            )}
          </>
        ) : (
          <>
            {!recoveryMode && (
              <div className="auth-tabs" role="tablist" aria-label="계정 방식">
                <button
                  className={view === "login" ? "auth-tab-active" : ""}
                  onClick={() => changeView("login")}
                >
                  LOGIN
                </button>
                <button
                  className={view === "signup" ? "auth-tab-active" : ""}
                  onClick={() => changeView("signup")}
                >
                  SIGN UP
                </button>
                <button
                  className={view === "guest" ? "auth-tab-active" : ""}
                  onClick={() => changeView("guest")}
                >
                  GUEST
                </button>
              </div>
            )}

            <p className="auth-intro">
              {view === "login" &&
                "username과 비밀번호로 로그인합니다."}
              {view === "signup" &&
                "username을 먼저 정하고 이메일과 비밀번호를 연결합니다. 이메일 확인은 최초 1회만 필요합니다."}
              {view === "forgot" &&
                "username에 등록된 이메일로 재설정 링크를 보냅니다."}
              {view === "guest" &&
                "계정 없이 이 기기에서 사용할 username을 정합니다."}
              {view === "update" && "새 비밀번호를 입력해주세요."}
            </p>

            {view !== "update" && (
              <label>
                <span>USERNAME</span>
                <input
                  autoFocus
                  autoComplete="username"
                  maxLength={16}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                  placeholder="2–16자 / 한글·영문·숫자"
                />
              </label>
            )}

            {view === "signup" && (
              <label>
                <span>EMAIL</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                />
              </label>
            )}

            {(view === "login" ||
              view === "signup" ||
              view === "update") && (
              <label>
                <span>{view === "update" ? "NEW PASSWORD" : "PASSWORD"}</span>
                <input
                  autoComplete={
                    view === "login" ? "current-password" : "new-password"
                  }
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                  placeholder="8자 이상"
                />
              </label>
            )}

            {(view === "signup" || view === "update") && (
              <label>
                <span>PASSWORD CONFIRM</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                  placeholder="비밀번호 다시 입력"
                />
              </label>
            )}

            {error && <p className="auth-feedback auth-error">{error}</p>}
            {message && <p className="auth-feedback auth-success">{message}</p>}
            {!configured && view !== "guest" && (
              <p className="auth-feedback auth-error">
                계정 서버 설정을 불러오지 못했습니다. 게스트로 입장할 수 있습니다.
              </p>
            )}

            <button
              className="identity-submit"
              disabled={busy || (!configured && view !== "guest")}
              onClick={submit}
            >
              {busy
                ? "PLEASE WAIT…"
                : view === "login"
                  ? "LOG IN →"
                  : view === "signup"
                    ? "CREATE ACCOUNT →"
                    : view === "forgot"
                      ? "SEND RESET LINK →"
                      : view === "update"
                        ? "UPDATE PASSWORD →"
                        : "GUEST PLAY →"}
            </button>

            {view === "login" && (
              <button
                className="auth-text-button"
                onClick={() => changeView("forgot")}
              >
                비밀번호를 잊었나요?
              </button>
            )}
            {view === "forgot" && (
              <button
                className="auth-text-button"
                onClick={() => changeView("login")}
              >
                ← 로그인으로 돌아가기
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
