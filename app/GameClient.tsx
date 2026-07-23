"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DataConnection, Peer as PeerInstance } from "peerjs";

type PieceName = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
type Cell = PieceName | "G" | null;
type RenderCell = Exclude<Cell, null> | "ghost" | "";
type Board = Cell[][];
type Status = "playing" | "paused" | "won" | "lost";
type Screen = "home" | "sprint" | "blitz" | "zen" | "versus";
type GameAction =
  | "left"
  | "right"
  | "down"
  | "rotateCW"
  | "rotateCCW"
  | "hardDrop"
  | "hold";
type RepeatHandle = {
  delay?: number;
  interval?: number;
};

type Piece = {
  type: PieceName;
  rotation: number;
  x: number;
  y: number;
};

type Controls = {
  left: string;
  right: string;
  down: string;
  rotateCW: string;
  rotateCCW: string;
  hardDrop: string;
  hold: string;
};

type Rules = {
  gravity: number;
  attack: number;
  ghost: boolean;
};

type GameSnapshot = {
  cells: string[];
  lines: number;
  score: number;
  status: Status;
};

type RoomPlayer = {
  id: string;
  name: string;
  slot: number;
  alive: boolean;
  connected: boolean;
  snapshot?: GameSnapshot;
};

type RoomPacket =
  | {
      type: "welcome";
      selfId: string;
      players: RoomPlayer[];
      started: boolean;
    }
  | { type: "roster"; players: RoomPlayer[]; started: boolean }
  | { type: "start"; matchId: number; players: RoomPlayer[] }
  | { type: "attack"; amount: number }
  | { type: "garbage"; id: number; amount: number }
  | { type: "snapshot"; playerId?: string; snapshot: GameSnapshot }
  | { type: "finish"; status: "lost" }
  | {
      type: "end";
      winnerId: string;
      winnerName: string;
      players: RoomPlayer[];
    }
  | { type: "full"; reason: "ROOM_FULL" | "MATCH_STARTED" };

const WIDTH = 10;
const HEIGHT = 20;
const PIECES: PieceName[] = ["I", "J", "L", "O", "S", "T", "Z"];

const SHAPES: Record<PieceName, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
};

const DEFAULT_RULES: Rules = {
  gravity: 420,
  attack: 1,
  ghost: true,
};

const SINGLE_CONTROLS: Controls = {
  left: "ArrowLeft",
  right: "ArrowRight",
  down: "ArrowDown",
  rotateCW: "ArrowUp",
  rotateCCW: "KeyZ",
  hardDrop: "Space",
  hold: "KeyC",
};

function emptyBoard(): Board {
  return Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null));
}

function rotateMatrix(matrix: number[][], times: number): number[][] {
  let output = matrix;
  for (let turn = 0; turn < times % 4; turn += 1) {
    output = output[0].map((_, index) =>
      output.map((row) => row[index]).reverse(),
    );
  }
  return output;
}

function pieceCells(piece: Piece): Array<[number, number]> {
  const matrix = rotateMatrix(SHAPES[piece.type], piece.rotation);
  const cells: Array<[number, number]> = [];
  matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (value) cells.push([piece.x + x, piece.y + y]);
    }),
  );
  return cells;
}

function collides(board: Board, piece: Piece): boolean {
  return pieceCells(piece).some(
    ([x, y]) =>
      x < 0 ||
      x >= WIDTH ||
      y >= HEIGHT ||
      (y >= 0 && board[y][x] !== null),
  );
}

function shuffledBag(): PieceName[] {
  const bag = [...PIECES];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [bag[index], bag[swap]] = [bag[swap], bag[index]];
  }
  return bag;
}

function nextQueue(queue: PieceName[]): PieceName[] {
  let output = [...queue];
  while (output.length < 8) output = [...output, ...shuffledBag()];
  return output;
}

function spawn(type: PieceName): Piece {
  return {
    type,
    rotation: 0,
    x: type === "O" ? 4 : 3,
    y: 0,
  };
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function MiniPiece({ type }: { type: PieceName | null }) {
  if (!type) return <div className="mini-empty">—</div>;
  const matrix = SHAPES[type];
  const cells = Array.from({ length: 8 }, (_, index) => {
    const y = Math.floor(index / 4);
    const x = index % 4;
    return Boolean(matrix[y]?.[x]);
  });
  return (
    <div className="mini-grid" aria-label={`${type} 블록`}>
      {cells.map((filled, index) => (
        <span
          className={filled ? `mini-cell piece-${type}` : "mini-cell"}
          key={index}
        />
      ))}
    </div>
  );
}

type BoardProps = {
  player: string;
  controls: Controls;
  rules: Rules;
  mode: "sprint" | "blitz" | "zen" | "versus";
  compact?: boolean;
  garbage?: { id: number; amount: number };
  onAttack?: (amount: number) => void;
  onFinish?: (status: "won" | "lost") => void;
  onSnapshot?: (snapshot: GameSnapshot) => void;
};

function GameBoard({
  player,
  controls,
  rules,
  mode,
  compact = false,
  garbage,
  onAttack,
  onFinish,
  onSnapshot,
}: BoardProps) {
  const initialQueue = useMemo(() => nextQueue([]), []);
  const [board, setBoard] = useState<Board>(() => emptyBoard());
  const [active, setActive] = useState<Piece>(() => spawn(initialQueue[0]));
  const [queue, setQueue] = useState<PieceName[]>(() => initialQueue.slice(1));
  const [held, setHeld] = useState<PieceName | null>(null);
  const [canHold, setCanHold] = useState(true);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [combo, setCombo] = useState(-1);
  const [status, setStatus] = useState<Status>("playing");
  const [seconds, setSeconds] = useState(mode === "blitz" ? 120 : 0);
  const [flash, setFlash] = useState("");
  const finishSent = useRef(false);
  const snapshotSentAt = useRef(0);
  const repeatHandles = useRef(new Map<string, RepeatHandle>());
  const actionRef = useRef<(action: GameAction) => void>(() => undefined);

  const finish = useCallback(
    (nextStatus: "won" | "lost") => {
      setStatus(nextStatus);
      if (!finishSent.current) {
        finishSent.current = true;
        onFinish?.(nextStatus);
      }
    },
    [onFinish],
  );

  const lockPiece = useCallback(
    (piece: Piece) => {
      const merged = board.map((row) => [...row]);
      let overflow = false;
      pieceCells(piece).forEach(([x, y]) => {
        if (y < 0) overflow = true;
        else if (y < HEIGHT && x >= 0 && x < WIDTH) merged[y][x] = piece.type;
      });
      if (overflow) {
        finish("lost");
        return;
      }

      const fullRows = merged.filter((row) => row.every(Boolean));
      const cleared = fullRows.length;
      const cleaned = merged.filter((row) => !row.every(Boolean));
      while (cleaned.length < HEIGHT) cleaned.unshift(Array(WIDTH).fill(null));

      const replenished = nextQueue(queue);
      const nextPiece = spawn(replenished[0]);
      const nextLines = lines + cleared;
      const nextCombo = cleared ? combo + 1 : -1;
      const baseScores = [0, 100, 300, 500, 800];

      setBoard(cleaned);
      setActive(nextPiece);
      setQueue(replenished.slice(1));
      setCanHold(true);
      setLines(nextLines);
      setCombo(nextCombo);
      setScore(
        (value) =>
          value +
          (baseScores[cleared] ?? 1200) * (1 + Math.floor(nextLines / 10)) +
          (cleared ? Math.max(0, nextCombo) * 50 : 0),
      );

      if (cleared) {
        const attackBase = [0, 0, 1, 2, 4][cleared] ?? 4;
        const attack = Math.max(
          0,
          Math.round((attackBase + Math.max(0, nextCombo - 1)) * rules.attack),
        );
        if (attack > 0) onAttack?.(attack);
        setFlash(cleared === 4 ? "QUAD!" : `${cleared} LINE`);
        window.setTimeout(() => setFlash(""), 620);
      }

      if (mode === "sprint" && nextLines >= 40) {
        finish("won");
      } else if (collides(cleaned, nextPiece)) {
        finish("lost");
      }
    },
    [
      board,
      combo,
      finish,
      lines,
      mode,
      onAttack,
      queue,
      rules.attack,
    ],
  );

  const stepDown = useCallback(() => {
    if (status !== "playing") return;
    const moved = { ...active, y: active.y + 1 };
    if (collides(board, moved)) lockPiece(active);
    else setActive(moved);
  }, [active, board, lockPiece, status]);

  useEffect(() => {
    if (status !== "playing") return;
    const gravity = Math.max(90, rules.gravity - Math.floor(lines / 10) * 55);
    const timer = window.setInterval(stepDown, gravity);
    return () => window.clearInterval(timer);
  }, [lines, rules.gravity, status, stepDown]);

  useEffect(() => {
    if (status !== "playing") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (mode === "blitz" && value <= 1) {
          finish("won");
          return 0;
        }
        return mode === "blitz" ? value - 1 : value + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [finish, mode, status]);

  useEffect(() => {
    if (!garbage?.amount || status !== "playing") return;
    let clearTimer: number | undefined;
    const applyTimer = window.setTimeout(() => {
      setBoard((current) => {
        const amount = Math.min(garbage.amount, 8);
        const hole = Math.floor(Math.random() * WIDTH);
        const shifted = current.slice(amount);
        for (let row = 0; row < amount; row += 1) {
          shifted.push(
            Array.from({ length: WIDTH }, (_, x) => (x === hole ? null : "G")),
          );
        }
        return shifted;
      });
      setFlash(`+${garbage.amount} GARBAGE`);
      clearTimer = window.setTimeout(() => setFlash(""), 620);
    }, 0);
    return () => {
      window.clearTimeout(applyTimer);
      if (clearTimer) window.clearTimeout(clearTimer);
    };
  }, [garbage, status]);

  const move = useCallback(
    (dx: number) => {
      const moved = { ...active, x: active.x + dx };
      if (!collides(board, moved)) setActive(moved);
    },
    [active, board],
  );

  const rotate = useCallback(
    (direction: 1 | -1) => {
      const rotated = {
        ...active,
        rotation: (active.rotation + direction + 4) % 4,
      };
      for (const kick of [0, -1, 1, -2, 2]) {
        const candidate = { ...rotated, x: rotated.x + kick };
        if (!collides(board, candidate)) {
          setActive(candidate);
          return;
        }
      }
    },
    [active, board],
  );

  const hardDrop = useCallback(() => {
    let dropped = { ...active };
    let distance = 0;
    while (!collides(board, { ...dropped, y: dropped.y + 1 })) {
      dropped = { ...dropped, y: dropped.y + 1 };
      distance += 1;
    }
    setScore((value) => value + distance * 2);
    lockPiece(dropped);
  }, [active, board, lockPiece]);

  const holdPiece = useCallback(() => {
    if (!canHold) return;
    if (held) {
      setHeld(active.type);
      setActive(spawn(held));
    } else {
      const replenished = nextQueue(queue);
      setHeld(active.type);
      setActive(spawn(replenished[0]));
      setQueue(replenished.slice(1));
    }
    setCanHold(false);
  }, [active.type, canHold, held, queue]);

  const performAction = useCallback(
    (action: GameAction) => {
      if (status !== "playing") return;
      if (action === "left") move(-1);
      if (action === "right") move(1);
      if (action === "down") {
        setScore((value) => value + 1);
        stepDown();
      }
      if (action === "rotateCW") rotate(1);
      if (action === "rotateCCW") rotate(-1);
      if (action === "hardDrop") hardDrop();
      if (action === "hold") holdPiece();
    },
    [hardDrop, holdPiece, move, rotate, status, stepDown],
  );

  useEffect(() => {
    actionRef.current = performAction;
  }, [performAction]);

  const stopRepeat = useCallback((token: string) => {
    const handle = repeatHandles.current.get(token);
    if (!handle) return;
    if (handle.delay) window.clearTimeout(handle.delay);
    if (handle.interval) window.clearInterval(handle.interval);
    repeatHandles.current.delete(token);
  }, []);

  const stopAllRepeats = useCallback(() => {
    for (const token of repeatHandles.current.keys()) stopRepeat(token);
  }, [stopRepeat]);

  const startRepeat = useCallback(
    (
      token: string,
      action: GameAction,
      initialDelay = 105,
      repeatRate = 38,
    ) => {
      stopRepeat(token);
      actionRef.current(action);
      const handle: RepeatHandle = {};
      repeatHandles.current.set(token, handle);
      handle.delay = window.setTimeout(() => {
        actionRef.current(action);
        handle.interval = window.setInterval(
          () => actionRef.current(action),
          repeatRate,
        );
      }, initialDelay);
    },
    [stopRepeat],
  );

  useEffect(() => {
    const actionForCode = (code: string): GameAction | null => {
      if (code === controls.left) return "left";
      if (code === controls.right) return "right";
      if (code === controls.down) return "down";
      if (code === controls.rotateCW) return "rotateCW";
      if (code === controls.rotateCCW) return "rotateCCW";
      if (code === controls.hardDrop) return "hardDrop";
      if (code === controls.hold) return "hold";
      return null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (status === "lost" || status === "won") return;
      if (event.code === "Escape") {
        if (event.repeat) return;
        stopAllRepeats();
        setStatus((value) => (value === "paused" ? "playing" : "paused"));
        return;
      }
      if (status !== "playing") return;
      const action = actionForCode(event.code);
      if (!action) return;
      event.preventDefault();
      if (event.repeat) return;
      if (action === "left" || action === "right" || action === "down") {
        startRepeat(
          `key:${event.code}`,
          action,
          action === "down" ? 70 : 105,
          action === "down" ? 32 : 38,
        );
      } else {
        actionRef.current(action);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      stopRepeat(`key:${event.code}`);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopAllRepeats);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopAllRepeats);
      stopAllRepeats();
    };
  }, [
    controls,
    startRepeat,
    status,
    stopAllRepeats,
    stopRepeat,
  ]);

  const handleMobilePress = (
    event: ReactPointerEvent<HTMLButtonElement>,
    action: GameAction,
    repeat = false,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const token = `touch:${event.pointerId}`;
    if (repeat) {
      startRepeat(
        token,
        action,
        action === "down" ? 60 : 95,
        action === "down" ? 28 : 34,
      );
    } else {
      actionRef.current(action);
    }
  };

  const handleMobileRelease = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    stopRepeat(`touch:${event.pointerId}`);
  };

  const rendered = useMemo(() => {
    const cells: RenderCell[][] = board.map((row) =>
      row.map((cell) => cell ?? ""),
    );
    if (status === "playing" || status === "paused") {
      if (rules.ghost) {
        let ghost = { ...active };
        while (!collides(board, { ...ghost, y: ghost.y + 1 })) {
          ghost = { ...ghost, y: ghost.y + 1 };
        }
        pieceCells(ghost).forEach(([x, y]) => {
          if (y >= 0 && y < HEIGHT && !cells[y][x]) cells[y][x] = "ghost";
        });
      }
      pieceCells(active).forEach(([x, y]) => {
        if (y >= 0 && y < HEIGHT && x >= 0 && x < WIDTH) {
          cells[y][x] = active.type;
        }
      });
    }
    return cells;
  }, [active, board, rules.ghost, status]);

  useEffect(() => {
    if (!onSnapshot) return;
    const now = Date.now();
    const delay = Math.max(0, 180 - (now - snapshotSentAt.current));
    const timer = window.setTimeout(() => {
      snapshotSentAt.current = Date.now();
      onSnapshot({
        cells: rendered.flat(),
        lines,
        score,
        status,
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [lines, onSnapshot, rendered, score, status]);

  const controlLabel = "←/→ 이동 · ↑/Z 회전 · Space 드롭 · C 홀드";

  return (
    <section className={`game-unit ${compact ? "game-unit-compact" : ""}`}>
      <div className="player-line">
        <div>
          <span className="eyebrow">{mode === "versus" ? "ONLINE ROOM" : mode}</span>
          <h2>{player}</h2>
        </div>
        <span className={`status-dot status-${status}`}>
          {status === "playing"
            ? "LIVE"
            : status === "paused"
              ? "PAUSED"
              : status === "won"
                ? "CLEAR"
                : "TOP OUT"}
        </span>
      </div>

      <div className="game-rig">
        <aside className="piece-rail">
          <span>HOLD</span>
          <MiniPiece type={held} />
          <div className="rail-stat">
            <small>LINES</small>
            <strong>{lines}</strong>
          </div>
          <div className="rail-stat">
            <small>SCORE</small>
            <strong>{score.toLocaleString()}</strong>
          </div>
        </aside>

        <div className="board-shell">
          <div className="board" role="grid" aria-label={`${player} 게임 보드`}>
            {rendered.flatMap((row, y) =>
              row.map((cell, x) => (
                <span
                  className={`cell ${cell ? `piece-${cell}` : ""}`}
                  key={`${x}-${y}`}
                />
              )),
            )}
          </div>
          {flash && <div className="line-flash">{flash}</div>}
          {status !== "playing" && (
            <div className="board-overlay">
              <strong>
                {status === "paused"
                  ? "PAUSED"
                  : status === "lost"
                    ? "TOP OUT"
                    : mode === "blitz"
                      ? "TIME!"
                      : "CLEAR!"}
              </strong>
              <span>
                {status === "paused" ? "ESC로 계속" : `${lines} lines · ${score} pts`}
              </span>
            </div>
          )}
        </div>

        <aside className="piece-rail next-rail">
          <span>NEXT</span>
          {queue.slice(0, 3).map((type, index) => (
            <MiniPiece type={type} key={`${type}-${index}`} />
          ))}
          <div className="rail-stat timer-stat">
            <small>{mode === "blitz" ? "LEFT" : "TIME"}</small>
            <strong>{formatTime(seconds)}</strong>
          </div>
        </aside>
      </div>
      <div className="mobile-controls" aria-label="모바일 게임 조작">
        <button
          className="touch-button touch-hold"
          aria-label="블록 홀드"
          onPointerDown={(event) => handleMobilePress(event, "hold")}
        >
          <small>HOLD</small>
          C
        </button>
        <button
          className="touch-button"
          aria-label="왼쪽으로 이동"
          onPointerDown={(event) => handleMobilePress(event, "left", true)}
          onPointerUp={handleMobileRelease}
          onPointerCancel={handleMobileRelease}
          onLostPointerCapture={handleMobileRelease}
        >
          ←
        </button>
        <button
          className="touch-button"
          aria-label="아래로 빠르게 이동"
          onPointerDown={(event) => handleMobilePress(event, "down", true)}
          onPointerUp={handleMobileRelease}
          onPointerCancel={handleMobileRelease}
          onLostPointerCapture={handleMobileRelease}
        >
          ↓
        </button>
        <button
          className="touch-button"
          aria-label="오른쪽으로 이동"
          onPointerDown={(event) => handleMobilePress(event, "right", true)}
          onPointerUp={handleMobileRelease}
          onPointerCancel={handleMobileRelease}
          onLostPointerCapture={handleMobileRelease}
        >
          →
        </button>
        <button
          className="touch-button touch-rotate"
          aria-label="블록 회전"
          onPointerDown={(event) => handleMobilePress(event, "rotateCW")}
        >
          ↻
        </button>
        <button
          className="touch-button touch-drop"
          aria-label="블록 즉시 내리기"
          onPointerDown={(event) => handleMobilePress(event, "hardDrop")}
        >
          <small>DROP</small>
          ⇣
        </button>
      </div>
      <p className="controls-hint">
        <span className="desktop-control-label">{controlLabel}</span>
        <span className="mobile-control-label">
          버튼을 길게 누르면 즉시 연속 이동합니다.
        </span>
      </p>
    </section>
  );
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

function roomPeerId(code: string) {
  return `tetrix-${code.toLowerCase()}`;
}

function cleanPlayerName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 14) || "PLAYER";
}

function RemoteBoard({
  player,
  isSelf,
}: {
  player: RoomPlayer;
  isSelf?: boolean;
}) {
  const cells = player.snapshot?.cells ?? Array(HEIGHT * WIDTH).fill("");
  return (
    <article
      className={`remote-player ${!player.alive ? "remote-player-out" : ""} ${isSelf ? "remote-player-self" : ""}`}
    >
      <div className="remote-player-head">
        <span>
          P{player.slot + 1} {player.name}
        </span>
        <em>{player.alive ? (player.connected ? "LIVE" : "OFFLINE") : "OUT"}</em>
      </div>
      <div className="remote-board" aria-label={`${player.name} 상대 보드`}>
        {cells.slice(0, HEIGHT * WIDTH).map((cell, index) => (
          <i className={cell ? `piece-${cell}` : ""} key={index} />
        ))}
      </div>
      <div className="remote-stats">
        <span>{player.snapshot?.lines ?? 0} LINES</span>
        <span>{(player.snapshot?.score ?? 0).toLocaleString()} PTS</span>
      </div>
    </article>
  );
}

function OnlineParty({ rules }: { rules: Rules }) {
  const [phase, setPhaseState] = useState<
    "entry" | "connecting" | "lobby" | "playing" | "ended"
  >("entry");
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [playerName, setPlayerName] = useState("PLAYER");
  const [joinCode, setJoinCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [localId, setLocalId] = useState("");
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [roomError, setRoomError] = useState("");
  const [winnerName, setWinnerName] = useState("");
  const [matchId, setMatchId] = useState(0);
  const [garbageSignal, setGarbageSignal] = useState({ id: 0, amount: 0 });
  const peerRef = useRef<PeerInstance | null>(null);
  const hostConnectionRef = useRef<DataConnection | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const playersRef = useRef<RoomPlayer[]>([]);
  const localIdRef = useRef("");
  const roleRef = useRef<"host" | "guest" | null>(null);
  const phaseRef = useRef(phase);
  const targetCursor = useRef(0);

  const setPhase = (next: typeof phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const replacePlayers = (next: RoomPlayer[]) => {
    playersRef.current = next;
    setPlayers(next);
  };

  const broadcast = (packet: RoomPacket, exceptId?: string) => {
    connectionsRef.current.forEach((connection, peerId) => {
      if (peerId === exceptId || !connection.open) return;
      try {
        connection.send(packet);
      } catch {
        // The close handler will reconcile a dropped peer.
      }
    });
  };

  const publishRoster = (next: RoomPlayer[]) => {
    replacePlayers(next);
    broadcast({
      type: "roster",
      players: next,
      started: phaseRef.current === "playing",
    });
  };

  const concludeIfNeeded = (next: RoomPlayer[]) => {
    if (phaseRef.current !== "playing") return;
    const survivors = next.filter((player) => player.alive && player.connected);
    if (survivors.length > 1 || next.length < 2) return;
    const winner =
      survivors[0] ??
      [...next].sort(
        (a, b) => (b.snapshot?.score ?? 0) - (a.snapshot?.score ?? 0),
      )[0];
    const finalPlayers = next.map((player) =>
      player.id === winner.id ? { ...player, alive: true } : player,
    );
    replacePlayers(finalPlayers);
    setWinnerName(winner.name);
    setPhase("ended");
    broadcast({
      type: "end",
      winnerId: winner.id,
      winnerName: winner.name,
      players: finalPlayers,
    });
  };

  const eliminatePlayer = (playerId: string) => {
    const next = playersRef.current.map((player) =>
      player.id === playerId ? { ...player, alive: false } : player,
    );
    publishRoster(next);
    concludeIfNeeded(next);
  };

  const updateSnapshot = (playerId: string, snapshot: GameSnapshot) => {
    const next = playersRef.current.map((player) =>
      player.id === playerId ? { ...player, snapshot } : player,
    );
    replacePlayers(next);
  };

  const routeAttack = (fromId: string, amount: number) => {
    const opponents = playersRef.current.filter(
      (player) =>
        player.id !== fromId && player.alive && player.connected,
    );
    if (!opponents.length) return;
    const target = opponents[targetCursor.current % opponents.length];
    targetCursor.current += 1;
    const packet: RoomPacket = {
      type: "garbage",
      id: Date.now() + targetCursor.current,
      amount,
    };
    if (target.id === localIdRef.current) {
      setGarbageSignal({ id: packet.id, amount });
    } else {
      const connection = connectionsRef.current.get(target.id);
      if (connection?.open) connection.send(packet);
    }
  };

  const handleHostPacket = (senderId: string, packet: RoomPacket) => {
    if (packet.type === "attack") {
      routeAttack(senderId, packet.amount);
    }
    if (packet.type === "snapshot") {
      updateSnapshot(senderId, packet.snapshot);
      broadcast(
        {
          type: "snapshot",
          playerId: senderId,
          snapshot: packet.snapshot,
        },
        senderId,
      );
    }
    if (packet.type === "finish") {
      eliminatePlayer(senderId);
    }
  };

  const handlePeerDeparture = (peerId: string) => {
    connectionsRef.current.delete(peerId);
    if (phaseRef.current === "lobby") {
      publishRoster(
        playersRef.current.filter((player) => player.id !== peerId),
      );
      return;
    }
    const next = playersRef.current.map((player) =>
      player.id === peerId
        ? { ...player, connected: false, alive: false }
        : player,
    );
    publishRoster(next);
    concludeIfNeeded(next);
  };

  const acceptConnection = (connection: DataConnection) => {
    connection.on("open", () => {
      if (playersRef.current.length >= 8) {
        connection.send({ type: "full", reason: "ROOM_FULL" } satisfies RoomPacket);
        connection.close();
        return;
      }
      if (phaseRef.current !== "lobby") {
        connection.send({
          type: "full",
          reason: "MATCH_STARTED",
        } satisfies RoomPacket);
        connection.close();
        return;
      }

      const occupied = new Set(playersRef.current.map((player) => player.slot));
      const slot = Array.from({ length: 8 }, (_, index) => index).find(
        (index) => !occupied.has(index),
      );
      if (slot === undefined) return;
      const metadata = (connection.metadata ?? {}) as { name?: string };
      const next = [
        ...playersRef.current,
        {
          id: connection.peer,
          name: cleanPlayerName(metadata.name ?? "PLAYER"),
          slot,
          alive: true,
          connected: true,
        },
      ].sort((a, b) => a.slot - b.slot);
      connectionsRef.current.set(connection.peer, connection);
      replacePlayers(next);
      connection.send({
        type: "welcome",
        selfId: connection.peer,
        players: next,
        started: false,
      } satisfies RoomPacket);
      broadcast({ type: "roster", players: next, started: false });
    });
    connection.on("data", (data) =>
      handleHostPacket(connection.peer, data as RoomPacket),
    );
    connection.on("close", () => handlePeerDeparture(connection.peer));
    connection.on("error", () => handlePeerDeparture(connection.peer));
  };

  const mapPeerError = (error: unknown) => {
    const typed = error as { type?: string };
    if (typed.type === "peer-unavailable") return "방을 찾을 수 없습니다.";
    if (typed.type === "unavailable-id") return "이미 사용 중인 방 코드입니다.";
    if (typed.type === "browser-incompatible")
      return "이 브라우저는 실시간 연결을 지원하지 않습니다.";
    return "실시간 연결에 실패했습니다. 네트워크를 확인해 주세요.";
  };

  const createRoom = async () => {
    setRoomError("");
    setPhase("connecting");
    setRole("host");
    roleRef.current = "host";
    const code = generateRoomCode();
    setRoomCode(code);
    try {
      const { Peer } = await import("peerjs");
      const peer = new Peer(roomPeerId(code), { debug: 0 });
      peerRef.current = peer;
      peer.on("open", (id) => {
        const host: RoomPlayer = {
          id,
          name: cleanPlayerName(playerName),
          slot: 0,
          alive: true,
          connected: true,
        };
        localIdRef.current = id;
        setLocalId(id);
        replacePlayers([host]);
        setPhase("lobby");
      });
      peer.on("connection", acceptConnection);
      peer.on("error", (error) => {
        setRoomError(mapPeerError(error));
        setPhase("entry");
      });
    } catch {
      setRoomError("온라인 연결 모듈을 불러오지 못했습니다.");
      setPhase("entry");
    }
  };

  const handleGuestPacket = (packet: RoomPacket) => {
    if (packet.type === "welcome") {
      localIdRef.current = packet.selfId;
      setLocalId(packet.selfId);
      replacePlayers(packet.players);
      setPhase(packet.started ? "playing" : "lobby");
    }
    if (packet.type === "roster") {
      replacePlayers(packet.players);
    }
    if (packet.type === "start") {
      replacePlayers(packet.players);
      setMatchId(packet.matchId);
      setWinnerName("");
      setGarbageSignal({ id: 0, amount: 0 });
      setPhase("playing");
    }
    if (packet.type === "snapshot" && packet.playerId) {
      updateSnapshot(packet.playerId, packet.snapshot);
    }
    if (packet.type === "garbage") {
      setGarbageSignal({ id: packet.id, amount: packet.amount });
    }
    if (packet.type === "end") {
      replacePlayers(packet.players);
      setWinnerName(packet.winnerName);
      setPhase("ended");
    }
    if (packet.type === "full") {
      setRoomError(
        packet.reason === "ROOM_FULL"
          ? "이 방은 8명으로 가득 찼습니다."
          : "이미 게임이 진행 중입니다.",
      );
      setPhase("entry");
    }
  };

  const joinRoom = async () => {
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length !== 6) {
      setRoomError("6자리 방 코드를 입력해 주세요.");
      return;
    }
    setRoomError("");
    setRoomCode(code);
    setRole("guest");
    roleRef.current = "guest";
    setPhase("connecting");
    try {
      const { Peer } = await import("peerjs");
      const peer = new Peer({ debug: 0 });
      peerRef.current = peer;
      peer.on("open", () => {
        const connection = peer.connect(roomPeerId(code), {
          metadata: { name: cleanPlayerName(playerName) },
          serialization: "json",
          reliable: true,
        });
        hostConnectionRef.current = connection;
        connection.on("data", (data) =>
          handleGuestPacket(data as RoomPacket),
        );
        connection.on("close", () => {
          setRoomError("호스트와 연결이 끊겼습니다.");
          setPhase("entry");
        });
        connection.on("error", () => {
          setRoomError("호스트와 연결할 수 없습니다.");
          setPhase("entry");
        });
      });
      peer.on("error", (error) => {
        setRoomError(mapPeerError(error));
        setPhase("entry");
      });
    } catch {
      setRoomError("온라인 연결 모듈을 불러오지 못했습니다.");
      setPhase("entry");
    }
  };

  const startMatch = () => {
    if (roleRef.current !== "host" || playersRef.current.length < 2) return;
    const next = playersRef.current
      .filter(
        (player) =>
          player.id === localIdRef.current ||
          connectionsRef.current.has(player.id),
      )
      .map((player) => ({
        ...player,
        alive: true,
        connected: true,
        snapshot: undefined,
      }));
    if (next.length < 2) {
      publishRoster(next);
      setRoomError("재대전을 시작하려면 한 명 이상 다시 접속해야 합니다.");
      setPhase("lobby");
      return;
    }
    const nextMatchId = Date.now();
    targetCursor.current = 0;
    replacePlayers(next);
    setRoomError("");
    setWinnerName("");
    setMatchId(nextMatchId);
    setGarbageSignal({ id: 0, amount: 0 });
    setPhase("playing");
    broadcast({ type: "start", matchId: nextMatchId, players: next });
  };

  const shareSnapshot = useCallback((snapshot: GameSnapshot) => {
    const id = localIdRef.current;
    if (!id) return;
    const next = playersRef.current.map((player) =>
      player.id === id ? { ...player, snapshot } : player,
    );
    playersRef.current = next;
    setPlayers(next);
    if (roleRef.current === "host") {
      connectionsRef.current.forEach((connection) => {
        if (connection.open) {
          connection.send({
            type: "snapshot",
            playerId: id,
            snapshot,
          } satisfies RoomPacket);
        }
      });
    } else if (hostConnectionRef.current?.open) {
      hostConnectionRef.current.send({ type: "snapshot", snapshot } satisfies RoomPacket);
    }
  }, []);

  const sendAttack = (amount: number) => {
    if (roleRef.current === "host") {
      routeAttack(localIdRef.current, amount);
    } else if (hostConnectionRef.current?.open) {
      hostConnectionRef.current.send({ type: "attack", amount } satisfies RoomPacket);
    }
  };

  const finishLocalPlayer = (status: "won" | "lost") => {
    if (status !== "lost") return;
    if (roleRef.current === "host") {
      eliminatePlayer(localIdRef.current);
    } else if (hostConnectionRef.current?.open) {
      hostConnectionRef.current.send({
        type: "finish",
        status: "lost",
      } satisfies RoomPacket);
    }
  };

  const leaveRoom = () => {
    connectionsRef.current.forEach((connection) => connection.close());
    connectionsRef.current.clear();
    hostConnectionRef.current?.close();
    peerRef.current?.destroy();
    peerRef.current = null;
    hostConnectionRef.current = null;
    playersRef.current = [];
    localIdRef.current = "";
    roleRef.current = null;
    setPlayers([]);
    setLocalId("");
    setRoomCode("");
    setRole(null);
    setWinnerName("");
    setRoomError("");
    setPhase("entry");
  };

  useEffect(
    () => () => {
      connectionsRef.current.forEach((connection) => connection.close());
      hostConnectionRef.current?.close();
      peerRef.current?.destroy();
    },
    [],
  );

  const localPlayer = players.find((player) => player.id === localId);
  const remotePlayers = players.filter((player) => player.id !== localId);
  const survivors = players.filter(
    (player) => player.alive && player.connected,
  ).length;

  if (phase === "entry" || phase === "connecting") {
    return (
      <section className="online-entry">
        <div className="online-entry-head">
          <span className="eyebrow">ONLINE PARTY / UP TO 8</span>
          <h2>각자의 기기에서 접속하세요.</h2>
          <p>
            한 명이 방을 만들고, 나머지 참가자는 6자리 코드로 접속합니다.
            게임 데이터는 참가자 기기끼리 직접 전송됩니다.
          </p>
        </div>
        <label className="online-name-field">
          <span>PLAYER NAME</span>
          <input
            value={playerName}
            maxLength={14}
            onChange={(event) => setPlayerName(event.target.value)}
            disabled={phase === "connecting"}
          />
        </label>
        <div className="online-entry-grid">
          <button
            className="online-choice online-choice-host"
            onClick={createRoom}
            disabled={phase === "connecting"}
          >
            <span>01 / HOST</span>
            <strong>새 방 만들기</strong>
            <small>코드를 공유하고 최대 7명을 초대</small>
            <em>{phase === "connecting" && role === "host" ? "CONNECTING…" : "CREATE ↗"}</em>
          </button>
          <div className="online-choice online-choice-join">
            <span>02 / JOIN</span>
            <strong>방 코드로 참가</strong>
            <small>호스트에게 받은 6자리 코드 입력</small>
            <div className="room-code-input">
              <input
                aria-label="6자리 방 코드"
                placeholder="ABC234"
                value={joinCode}
                maxLength={6}
                onChange={(event) =>
                  setJoinCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") joinRoom();
                }}
                disabled={phase === "connecting"}
              />
              <button onClick={joinRoom} disabled={phase === "connecting"}>
                {phase === "connecting" && role === "guest" ? "…" : "JOIN"}
              </button>
            </div>
          </div>
        </div>
        {roomError && <p className="room-error">{roomError}</p>}
        <p className="online-note">
          인터넷 연결이 필요합니다. 회사망·일부 모바일망에서는 WebRTC 연결이
          제한될 수 있습니다.
        </p>
      </section>
    );
  }

  if (phase === "lobby") {
    return (
      <section className="online-lobby">
        <div className="lobby-code-panel">
          <span>ROOM CODE</span>
          <strong>{roomCode}</strong>
          <button
            onClick={() => navigator.clipboard.writeText(roomCode)}
            aria-label="방 코드 복사"
          >
            COPY CODE
          </button>
        </div>
        <div className="lobby-main">
          <div className="lobby-heading">
            <div>
              <span className="eyebrow">WAITING ROOM</span>
              <h2>{players.length} / 8 PLAYERS</h2>
            </div>
            <button className="leave-room" onClick={leaveRoom}>
              LEAVE
            </button>
          </div>
          <div className="lobby-slots">
            {Array.from({ length: 8 }, (_, index) => {
              const player = players.find((item) => item.slot === index);
              return (
                <div className={`lobby-slot ${player ? "slot-filled" : ""}`} key={index}>
                  <span>P{index + 1}</span>
                  <strong>{player?.name ?? "OPEN SLOT"}</strong>
                  <em>{player ? (index === 0 ? "HOST" : "CONNECTED") : "WAITING"}</em>
                </div>
              );
            })}
          </div>
          {roomError && <p className="room-error">{roomError}</p>}
          {role === "host" ? (
            <button
              className="start-online"
              onClick={startMatch}
              disabled={players.length < 2}
            >
              {players.length < 2 ? "한 명 이상 기다리는 중…" : "START MATCH →"}
            </button>
          ) : (
            <div className="guest-waiting">호스트가 게임을 시작하기를 기다리는 중…</div>
          )}
        </div>
      </section>
    );
  }

  if (phase === "ended") {
    const standings = [...players].sort((a, b) => {
      if (a.name === winnerName) return -1;
      if (b.name === winnerName) return 1;
      return (b.snapshot?.score ?? 0) - (a.snapshot?.score ?? 0);
    });
    return (
      <section className="online-results">
        <span className="eyebrow">MATCH COMPLETE</span>
        <h2>{winnerName} WINS</h2>
        <div className="result-list">
          {standings.map((player, index) => (
            <div key={player.id}>
              <span>#{index + 1}</span>
              <strong>{player.name}</strong>
              <em>{player.snapshot?.lines ?? 0} LINES</em>
              <em>{(player.snapshot?.score ?? 0).toLocaleString()} PTS</em>
            </div>
          ))}
        </div>
        <div className="result-actions">
          {role === "host" ? (
            <button className="start-online" onClick={startMatch}>
              REMATCH →
            </button>
          ) : (
            <div className="guest-waiting">호스트의 재시작을 기다리는 중…</div>
          )}
          <button className="leave-room" onClick={leaveRoom}>
            LEAVE ROOM
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="online-match">
      <div className="online-match-bar">
        <div>
          <span>ROOM</span>
          <strong>{roomCode}</strong>
        </div>
        <div>
          <span>SURVIVORS</span>
          <strong>
            {survivors} / {players.length}
          </strong>
        </div>
        <button onClick={leaveRoom}>LEAVE</button>
      </div>
      <div className="online-arena">
        <div className="local-board-zone">
          {localPlayer && (
            <GameBoard
              key={matchId}
              player={localPlayer.name}
              controls={SINGLE_CONTROLS}
              rules={rules}
              mode="versus"
              garbage={garbageSignal}
              onAttack={sendAttack}
              onFinish={finishLocalPlayer}
              onSnapshot={shareSnapshot}
            />
          )}
        </div>
        <aside className="opponents-zone">
          <div className="opponents-title">
            <span>OPPONENTS</span>
            <em>LIVE BOARDS</em>
          </div>
          <div className="opponents-grid">
            {remotePlayers.map((player) => (
              <RemoteBoard player={player} key={player.id} />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function RulesPanel({
  rules,
  setRules,
}: {
  rules: Rules;
  setRules: (rules: Rules) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`rules-panel ${open ? "rules-open" : ""}`}>
      <button
        className="rules-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="rules-icon">⌁</span>
        <span>
          <small>EXPERIMENTAL</small>
          <strong>RULE LAB</strong>
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="rules-body">
          <label>
            <span>
              <strong>낙하 속도</strong>
              <em>{rules.gravity}ms</em>
            </span>
            <input
              type="range"
              min="120"
              max="1200"
              step="40"
              value={rules.gravity}
              onChange={(event) =>
                setRules({ ...rules, gravity: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>
              <strong>공격 배율</strong>
              <em>{rules.attack.toFixed(1)}×</em>
            </span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={rules.attack}
              onChange={(event) =>
                setRules({ ...rules, attack: Number(event.target.value) })
              }
            />
          </label>
          <button
            className="switch-row"
            onClick={() => setRules({ ...rules, ghost: !rules.ghost })}
            aria-pressed={rules.ghost}
          >
            <span>
              <strong>고스트 피스</strong>
              <small>착지 위치 미리보기</small>
            </span>
            <span className={`switch ${rules.ghost ? "switch-on" : ""}`} />
          </button>
          <p>설정은 이 브라우저에 자동 저장됩니다.</p>
        </div>
      )}
    </aside>
  );
}

function ModeCard({
  accent,
  code,
  title,
  description,
  meta,
  onClick,
}: {
  accent: "orange" | "cyan" | "violet" | "lime";
  code: string;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button className={`mode-card accent-${accent}`} onClick={onClick}>
      <span className="mode-code">{code}</span>
      <span className="mode-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="mode-meta">{meta}</span>
      <span className="mode-arrow">↗</span>
    </button>
  );
}

function DemoStack() {
  const rows = [
    "..........",
    "..........",
    "..........",
    "..........",
    ".....TT...",
    "....TT....",
    "....OO....",
    "..SSOO.J..",
    ".SSIIIIJJJ",
    "ZZ.LLLLXXX",
  ];
  return (
    <div className="demo-stage" aria-hidden="true">
      <div className="demo-word">
        <span>BUILD.</span>
        <span>BREAK.</span>
        <span>REPEAT.</span>
      </div>
      <div className="demo-board">
        {rows.flatMap((row, y) =>
          row.split("").map((cell, x) => (
            <i
              key={`${x}-${y}`}
              className={
                cell === "."
                  ? ""
                  : cell === "X"
                    ? "piece-G"
                    : `piece-${cell}`
              }
            />
          )),
        )}
      </div>
      <div className="demo-metric">
        <span>APM</span>
        <strong>48</strong>
        <i />
      </div>
    </div>
  );
}

export default function GameClient() {
  const [screen, setScreen] = useState<Screen>("home");
  const [run, setRun] = useState(0);
  const [rules, setRulesState] = useState<Rules>(DEFAULT_RULES);

  useEffect(() => {
    const saved = window.localStorage.getItem("tetrix-rules-v2");
    if (!saved) return;
    const timer = window.setTimeout(() => {
      try {
        setRulesState({ ...DEFAULT_RULES, ...JSON.parse(saved) });
      } catch {
        setRulesState(DEFAULT_RULES);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setRules = (next: Rules) => {
    setRulesState(next);
    window.localStorage.setItem("tetrix-rules-v2", JSON.stringify(next));
  };

  const start = (nextScreen: Screen) => {
    setRun((value) => value + 1);
    setScreen(nextScreen);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  return (
    <main
      className={`app-shell ${screen === "home" ? "screen-home" : "screen-playing"}`}
    >
      <header className="topbar">
        <button className="brand" onClick={() => setScreen("home")}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>TETRIX</strong>
            <small>RULE LAB</small>
          </span>
        </button>
        <nav aria-label="주요 메뉴">
          <button
            className={screen === "home" ? "nav-active" : ""}
            onClick={() => setScreen("home")}
          >
            PLAY
          </button>
          <button onClick={() => document.getElementById("rule-lab")?.click()}>
            RULES
          </button>
          <span className="version">ALPHA 0.1</span>
        </nav>
        <div className="server-status">
          <i />
          P2P READY
        </div>
      </header>

      {screen === "home" ? (
        <>
          <section className="hero">
            <div className="hero-copy">
              <span className="kicker">
                <i /> MODERN STACKER / OPEN RULESET
              </span>
              <h1>
                STACK FAST.
                <br />
                <span>CHANGE THE RULES.</span>
              </h1>
              <p>
                익숙한 블록 스태커의 속도감에 실험 가능한 룰을 더했습니다.
                혼자 기록을 깨거나, 한 키보드로 바로 맞붙어보세요.
              </p>
              <div className="hero-tags">
                <span>7-BAG</span>
                <span>HOLD</span>
                <span>GHOST</span>
                <span>GARBAGE</span>
              </div>
            </div>
            <DemoStack />
          </section>

          <section className="mode-section">
            <div className="section-title">
              <span>01 / SELECT MODE</span>
              <h2>게임 모드</h2>
              <p>연습부터 로컬 대전까지, 바로 시작할 수 있습니다.</p>
            </div>
            <div className="mode-grid">
              <ModeCard
                accent="orange"
                code="40L"
                title="40 LINES"
                description="40줄을 가장 빠르게 클리어"
                meta="SPRINT / SOLO"
                onClick={() => start("sprint")}
              />
              <ModeCard
                accent="cyan"
                code="2M"
                title="BLITZ"
                description="2분 동안 최고 점수에 도전"
                meta="SCORE / SOLO"
                onClick={() => start("blitz")}
              />
              <ModeCard
                accent="violet"
                code="∞"
                title="ZEN"
                description="끝없이 쌓으며 룰을 테스트"
                meta="PRACTICE / SOLO"
                onClick={() => start("zen")}
              />
              <ModeCard
                accent="lime"
                code="8P"
                title="ONLINE PARTY"
                description="방 코드로 각자의 기기에서 실시간 대전"
                meta="2–8 PLAYERS / P2P"
                onClick={() => start("versus")}
              />
            </div>
          </section>
        </>
      ) : (
        <section className="play-screen">
          <div className="play-toolbar">
            <button className="back-button" onClick={() => setScreen("home")}>
              ← MODE SELECT
            </button>
            <div>
              <span>ACTIVE RULESET</span>
              <strong>
                {rules.gravity}MS / {rules.attack.toFixed(1)}× ATTACK
              </strong>
            </div>
            {screen === "versus" ? (
              <span className="online-mode-label">ROOM CODE / P2P</span>
            ) : (
              <button className="restart-button" onClick={() => start(screen)}>
                ↻ RESTART
              </button>
            )}
          </div>

          {screen === "versus" ? (
            <OnlineParty rules={rules} key={run} />
          ) : (
            <div className="solo-wrap" key={run}>
              <GameBoard
                player={
                  screen === "sprint"
                    ? "40 LINES"
                    : screen === "blitz"
                      ? "BLITZ"
                      : "ZEN MODE"
                }
                controls={SINGLE_CONTROLS}
                rules={rules}
                mode={screen}
              />
              <aside className="mission-panel">
                <span className="eyebrow">MISSION BRIEF</span>
                <h3>
                  {screen === "sprint"
                    ? "40줄을 클리어하세요."
                    : screen === "blitz"
                      ? "2분간 점수를 쌓으세요."
                      : "리듬을 찾고 실험하세요."}
                </h3>
                <p>
                  {screen === "sprint"
                    ? "점수보다 속도가 우선입니다. 홀드와 고스트를 활용하세요."
                    : screen === "blitz"
                      ? "연속 클리어와 QUAD로 콤보 보너스를 노리세요."
                      : "시간 제한이 없습니다. RULE LAB 설정은 즉시 반영됩니다."}
                </p>
                <div className="key-map">
                  <span>
                    <kbd>←</kbd>
                    <kbd>→</kbd> 이동
                  </span>
                  <span>
                    <kbd>↑</kbd>
                    <kbd>Z</kbd> 회전
                  </span>
                  <span>
                    <kbd>SPACE</kbd> 하드드롭
                  </span>
                  <span>
                    <kbd>C</kbd> 홀드
                  </span>
                  <span>
                    <kbd>ESC</kbd> 일시정지
                  </span>
                </div>
              </aside>
            </div>
          )}
        </section>
      )}

      <div id="rule-lab">
        <RulesPanel rules={rules} setRules={setRules} />
      </div>

      <footer>
        <span>ORIGINAL STACKER PROTOTYPE · NOT AFFILIATED WITH TETR.IO</span>
        <span>2–8 DEVICES · WEBRTC P2P</span>
      </footer>
    </main>
  );
}
