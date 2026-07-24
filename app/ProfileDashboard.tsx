"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type Mode = "sprint" | "blitz" | "zen" | "versus";

type ProfileRow = {
  id: string;
  username: string;
  username_normalized: string;
  level: number;
  experience: number;
};

type RecordRow = {
  user_id: string;
  mode: Mode;
  best_score: number;
  best_time_ms: number | null;
  best_lines: number;
  wins: number;
  games_played: number;
};

type FriendshipRow = {
  id: number;
  user_low: string;
  user_high: string;
  requested_by: string;
  status: "pending" | "accepted";
};

const MODES: Mode[] = ["sprint", "blitz", "zen", "versus"];
const MODE_LABELS: Record<Mode, string> = {
  sprint: "40 LINES",
  blitz: "BLITZ",
  zen: "ZEN",
  versus: "VERSUS",
};

function normalizeSearch(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase()
    .slice(0, 16);
}

function formatMilliseconds(value: number | null) {
  if (!value) return "—";
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  const milliseconds = value % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function recordMetric(mode: Mode, record?: RecordRow) {
  if (!record) return "NO RECORD";
  if (mode === "sprint") return formatMilliseconds(record.best_time_ms);
  if (mode === "versus") return `${record.wins} WINS`;
  return `${record.best_score.toLocaleString()} PTS`;
}

function friendlyError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: string } | null)?.message ?? error);
  if (message.includes("PLAYER_NOT_FOUND")) return "해당 username을 찾을 수 없습니다.";
  if (message.includes("ALREADY_FRIENDS")) return "이미 친구입니다.";
  if (message.includes("CANNOT_FRIEND_SELF")) return "자기 자신에게 요청할 수 없습니다.";
  if (message.includes("REQUEST_NOT_FOUND")) return "이미 처리되었거나 없는 요청입니다.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export default function ProfileDashboard({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [relations, setRelations] = useState<FriendshipRow[]>([]);
  const [people, setPeople] = useState<ProfileRow[]>([]);
  const [friendRecords, setFriendRecords] = useState<RecordRow[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);
  const [leaderboardMode, setLeaderboardMode] = useState<Mode>("sprint");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    const [profileResult, recordResult, relationResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, username_normalized, level, experience")
        .eq("id", userId)
        .single(),
      supabase
        .from("mode_records")
        .select(
          "user_id, mode, best_score, best_time_ms, best_lines, wins, games_played",
        )
        .eq("user_id", userId),
      supabase
        .from("friendships")
        .select("id, user_low, user_high, requested_by, status")
        .or(`user_low.eq.${userId},user_high.eq.${userId}`),
    ]);

    const firstError =
      profileResult.error ?? recordResult.error ?? relationResult.error;
    if (firstError) {
      setError(friendlyError(firstError));
      setLoading(false);
      return;
    }

    const nextRelations = (relationResult.data ?? []) as FriendshipRow[];
    const memberIds = Array.from(
      new Set([
        userId,
        ...nextRelations.map((relation) =>
          relation.user_low === userId ? relation.user_high : relation.user_low,
        ),
      ]),
    );
    const [peopleResult, friendRecordResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, username_normalized, level, experience")
        .in("id", memberIds),
      supabase
        .from("mode_records")
        .select(
          "user_id, mode, best_score, best_time_ms, best_lines, wins, games_played",
        )
        .in("user_id", memberIds),
    ]);

    if (peopleResult.error || friendRecordResult.error) {
      setError(friendlyError(peopleResult.error ?? friendRecordResult.error));
      setLoading(false);
      return;
    }

    setProfile(profileResult.data as ProfileRow);
    setRecords((recordResult.data ?? []) as RecordRow[]);
    setRelations(nextRelations);
    setPeople((peopleResult.data ?? []) as ProfileRow[]);
    setFriendRecords((friendRecordResult.data ?? []) as RecordRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const recordByMode = useMemo(
    () => new Map(records.map((record) => [record.mode, record])),
    [records],
  );
  const friendIds = useMemo(
    () =>
      relations
        .filter((relation) => relation.status === "accepted")
        .map((relation) =>
          relation.user_low === userId ? relation.user_high : relation.user_low,
        ),
    [relations, userId],
  );
  const incoming = relations.filter(
    (relation) =>
      relation.status === "pending" && relation.requested_by !== userId,
  );
  const outgoing = relations.filter(
    (relation) =>
      relation.status === "pending" && relation.requested_by === userId,
  );
  const friendIdSet = useMemo(
    () => new Set([userId, ...friendIds]),
    [friendIds, userId],
  );

  const leaderboard = useMemo(() => {
    const rows = people
      .filter((person) => friendIdSet.has(person.id))
      .map((person) => ({
        person,
        record: friendRecords.find(
          (record) =>
            record.user_id === person.id && record.mode === leaderboardMode,
        ),
      }))
      .filter((row) => Boolean(row.record));
    return rows.sort((a, b) => {
      const left = a.record;
      const right = b.record;
      if (!left || !right) return 0;
      if (leaderboardMode === "sprint") {
        return (
          (left.best_time_ms || Number.MAX_SAFE_INTEGER) -
          (right.best_time_ms || Number.MAX_SAFE_INTEGER)
        );
      }
      if (leaderboardMode === "versus" && left.wins !== right.wins) {
        return right.wins - left.wins;
      }
      return right.best_score - left.best_score;
    });
  }, [friendRecords, friendIdSet, leaderboardMode, people]);

  const runMutation = async (
    action: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ) => {
    setBusy(true);
    setError("");
    setMessage("");
    const result = await action();
    if (result.error) {
      setError(friendlyError(result.error));
    } else {
      setMessage(success);
      await load();
    }
    setBusy(false);
  };

  const searchPlayers = async () => {
    if (!supabase) return;
    const query = normalizeSearch(search);
    if (query.length < 2) {
      setError("username을 2자 이상 입력해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const { data, error: searchError } = await supabase
      .from("profiles")
      .select("id, username, username_normalized, level, experience")
      .ilike("username_normalized", `%${query}%`)
      .neq("id", userId)
      .limit(8);
    setBusy(false);
    if (searchError) {
      setError(friendlyError(searchError));
      return;
    }
    setSearchResults((data ?? []) as ProfileRow[]);
  };

  const currentLevel = profile?.level ?? 1;
  const experience = profile?.experience ?? 0;
  const currentFloor = (currentLevel - 1) ** 2 * 500;
  const nextLevel = currentLevel ** 2 * 500;
  const levelProgress = Math.max(
    0,
    Math.min(
      100,
      ((experience - currentFloor) / Math.max(1, nextLevel - currentFloor)) *
        100,
    ),
  );

  if (loading) {
    return <div className="profile-loading">PROFILE DATA LOADING…</div>;
  }

  return (
    <div className="profile-dashboard">
      <section className="profile-hero-card">
        <div>
          <span>ACCOUNT PROFILE</span>
          <h3>{profile?.username ?? username}</h3>
        </div>
        <strong>LV. {currentLevel}</strong>
        <div className="level-progress">
          <i style={{ width: `${levelProgress}%` }} />
        </div>
        <small>
          {experience.toLocaleString()} XP / {nextLevel.toLocaleString()} XP
        </small>
      </section>

      <section className="profile-section">
        <div className="profile-section-head">
          <div>
            <span>01 / PERSONAL BEST</span>
            <h3>모드별 최고 기록</h3>
          </div>
        </div>
        <div className="record-grid">
          {MODES.map((mode) => {
            const record = recordByMode.get(mode);
            return (
              <article key={mode}>
                <span>{MODE_LABELS[mode]}</span>
                <strong>{recordMetric(mode, record)}</strong>
                <small>
                  {record
                    ? `${record.games_played} GAMES · ${record.best_lines} LINES`
                    : "첫 기록을 만들어보세요."}
                </small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-section-head">
          <div>
            <span>02 / FRIENDS</span>
            <h3>친구 관리</h3>
          </div>
          <strong>{friendIds.length} FRIENDS</strong>
        </div>
        <form
          className="friend-search"
          onSubmit={(event) => {
            event.preventDefault();
            void searchPlayers();
          }}
        >
          <input
            aria-label="친구 username 검색"
            placeholder="username 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            SEARCH
          </button>
        </form>
        {searchResults.length > 0 && (
          <div className="friend-list friend-search-results">
            {searchResults.map((person) => (
              <div key={person.id}>
                <span>LV.{person.level}</span>
                <strong>{person.username}</strong>
                <button
                  disabled={busy || friendIdSet.has(person.id)}
                  onClick={() =>
                    void runMutation(
                      () =>
                        supabase!.rpc("send_friend_request", {
                          p_username: person.username_normalized,
                        }),
                      `${person.username}에게 친구 요청을 보냈습니다.`,
                    )
                  }
                >
                  {friendIdSet.has(person.id) ? "FRIEND" : "ADD"}
                </button>
              </div>
            ))}
          </div>
        )}

        {incoming.length > 0 && (
          <>
            <h4 className="friend-subhead">받은 요청</h4>
            <div className="friend-list">
              {incoming.map((relation) => {
                const requester = peopleById.get(relation.requested_by);
                return (
                  <div key={relation.id}>
                    <span>REQUEST</span>
                    <strong>{requester?.username ?? "PLAYER"}</strong>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void runMutation(
                            () =>
                              supabase!.rpc("respond_friend_request", {
                                p_request_id: relation.id,
                                p_accept: true,
                              }),
                            "친구 요청을 수락했습니다.",
                          )
                        }
                      >
                        ACCEPT
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void runMutation(
                            () =>
                              supabase!.rpc("respond_friend_request", {
                                p_request_id: relation.id,
                                p_accept: false,
                              }),
                            "친구 요청을 거절했습니다.",
                          )
                        }
                      >
                        DECLINE
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <h4 className="friend-subhead">보낸 요청</h4>
            <div className="friend-list">
              {outgoing.map((relation) => {
                const targetId =
                  relation.user_low === userId
                    ? relation.user_high
                    : relation.user_low;
                const target = peopleById.get(targetId);
                return (
                  <div key={relation.id}>
                    <span>PENDING</span>
                    <strong>{target?.username ?? "PLAYER"}</strong>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void runMutation(
                          () =>
                            supabase!.rpc("remove_friend", {
                              p_friend_id: targetId,
                            }),
                          "친구 요청을 취소했습니다.",
                        )
                      }
                    >
                      CANCEL
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <h4 className="friend-subhead">친구 목록</h4>
        <div className="friend-list">
          {friendIds.length ? (
            friendIds.map((friendId) => {
              const friend = peopleById.get(friendId);
              return (
                <div key={friendId}>
                  <span>LV.{friend?.level ?? 1}</span>
                  <strong>{friend?.username ?? "PLAYER"}</strong>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm("이 친구를 삭제할까요?")) return;
                      void runMutation(
                        () =>
                          supabase!.rpc("remove_friend", {
                            p_friend_id: friendId,
                          }),
                        "친구를 삭제했습니다.",
                      );
                    }}
                  >
                    REMOVE
                  </button>
                </div>
              );
            })
          ) : (
            <p className="profile-empty">아직 추가한 친구가 없습니다.</p>
          )}
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-section-head">
          <div>
            <span>03 / FRIEND LEADERBOARD</span>
            <h3>친구 기록 랭킹</h3>
          </div>
        </div>
        <div className="leaderboard-tabs">
          {MODES.map((mode) => (
            <button
              className={leaderboardMode === mode ? "active" : ""}
              key={mode}
              onClick={() => setLeaderboardMode(mode)}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="leaderboard-list">
          {leaderboard.length ? (
            leaderboard.map(({ person, record }, index) => (
              <div
                className={person.id === userId ? "leaderboard-self" : ""}
                key={person.id}
              >
                <span>#{index + 1}</span>
                <strong>
                  {person.username}
                  {person.id === userId ? " · YOU" : ""}
                </strong>
                <em>{recordMetric(leaderboardMode, record)}</em>
              </div>
            ))
          ) : (
            <p className="profile-empty">
              이 모드의 친구 기록이 아직 없습니다.
            </p>
          )}
        </div>
      </section>

      {message && <p className="profile-feedback profile-success">{message}</p>}
      {error && <p className="profile-feedback profile-error">{error}</p>}
    </div>
  );
}
