import React from "react";
import "./App.css";

type RawDirectionState = {
  left: boolean;
  right: boolean;
  down: boolean;
  up: boolean;
};

type Axis = -1 | 0 | 1;

type InputEntry = {
  id: string;
  raw: RawDirectionState;
  rawLabel: string;
  direction: number;
  directionLabel: string;
  startedAt: number;
  endedAt?: number;
  frames: number;
};

type TrainingStatus = "idle" | "success";

const DEFAULT_TARGETS = ["236", "623", "214", "236236", "214214", "636"];
const TARGETS_STORAGE_KEY = "hitbox-input-lab.targets.v1";
const MAX_GAP_FRAMES = 8;

const neutralRaw: RawDirectionState = {
  left: false,
  right: false,
  down: false,
  up: false,
};

const directionLabels: Record<number, string> = {
  1: "↙",
  2: "↓",
  3: "↘",
  4: "←",
  5: "•",
  6: "→",
  7: "↖",
  8: "↑",
  9: "↗",
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneRaw(raw: RawDirectionState): RawDirectionState {
  return {
    left: raw.left,
    right: raw.right,
    down: raw.down,
    up: raw.up,
  };
}

function sameRaw(a: RawDirectionState, b: RawDirectionState) {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.down === b.down &&
    a.up === b.up
  );
}

function rawLabel(raw: RawDirectionState) {
  const parts: string[] = [];

  if (raw.left) parts.push("←");
  if (raw.right) parts.push("→");
  if (raw.down) parts.push("↓");
  if (raw.up) parts.push("↑");

  return parts.length > 0 ? parts.join(" + ") : "Neutral";
}

function resolveHorizontal(raw: RawDirectionState): Axis {
  if (raw.left && raw.right) return 0;
  if (raw.left) return -1;
  if (raw.right) return 1;
  return 0;
}

function resolveVertical(raw: RawDirectionState): Axis {
  if (raw.down && raw.up) return 0;
  if (raw.down) return -1;
  if (raw.up) return 1;
  return 0;
}

function axisToDirection(horizontal: Axis, vertical: Axis): number {
  if (horizontal === -1 && vertical === 1) return 7;
  if (horizontal === 0 && vertical === 1) return 8;
  if (horizontal === 1 && vertical === 1) return 9;

  if (horizontal === -1 && vertical === 0) return 4;
  if (horizontal === 0 && vertical === 0) return 5;
  if (horizontal === 1 && vertical === 0) return 6;

  if (horizontal === -1 && vertical === -1) return 1;
  if (horizontal === 0 && vertical === -1) return 2;
  if (horizontal === 1 && vertical === -1) return 3;

  return 5;
}

function resolveDirection(raw: RawDirectionState) {
  const horizontal = resolveHorizontal(raw);
  const vertical = resolveVertical(raw);
  const direction = axisToDirection(horizontal, vertical);

  return {
    direction,
    directionLabel: directionLabels[direction],
  };
}

function readXboxDpad(gamepad: Gamepad): RawDirectionState {
  return {
    up: Boolean(gamepad.buttons[12]?.pressed),
    down: Boolean(gamepad.buttons[13]?.pressed),
    left: Boolean(gamepad.buttons[14]?.pressed),
    right: Boolean(gamepad.buttons[15]?.pressed),
  };
}

function framesBetween(start: number, end: number) {
  return Math.max(1, Math.round(((end - start) / 1000) * 60));
}

function parseTarget(target: string): number[] {
  return target
    .split("")
    .map((char) => Number(char))
    .filter((num) => Number.isFinite(num) && num >= 1 && num <= 9);
}

function isValidCommand(command: string) {
  return /^[12346789]+$/.test(command);
}

function loadTargets(): string[] {
  try {
    const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return DEFAULT_TARGETS;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TARGETS;

    const cleaned = parsed
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(isValidCommand);

    return cleaned.length > 0 ? cleaned : DEFAULT_TARGETS;
  } catch {
    return DEFAULT_TARGETS;
  }
}

function canMatchTargetWithFuzzyInput(
  history: InputEntry[],
  target: string,
  maxGapFrames: number
) {
  const targetDirections = parseTarget(target);

  if (targetDirections.length === 0) return false;
  if (history.length < targetDirections.length) return false;

  const recent = history.slice(-40);

  for (let start = 0; start < recent.length; start++) {
    if (recent[start].direction !== targetDirections[0]) continue;

    let targetCursor = 1;
    let lastMatched = recent[start];

    for (let i = start + 1; i < recent.length; i++) {
      const candidate = recent[i];
      const needed = targetDirections[targetCursor];

      const gap = framesBetween(lastMatched.startedAt, candidate.startedAt);

      if (gap > maxGapFrames) {
        break;
      }

      if (candidate.direction === needed) {
        lastMatched = candidate;
        targetCursor++;

        if (targetCursor >= targetDirections.length) {
          return true;
        }
      }
    }
  }

  return false;
}

export default function App() {
  const [gamepad, setGamepad] = React.useState<Gamepad | null>(null);
  const [raw, setRaw] = React.useState<RawDirectionState>(neutralRaw);
  const [history, setHistory] = React.useState<InputEntry[]>([]);
  const [paused, setPaused] = React.useState(false);

  const [targets, setTargets] = React.useState<string[]>(loadTargets);
  const [targetIndex, setTargetIndex] = React.useState(0);
  const [newTarget, setNewTarget] = React.useState("");
  const [trainingStatus, setTrainingStatus] =
    React.useState<TrainingStatus>("idle");

  const historyListRef = React.useRef<HTMLDivElement | null>(null);
  const lastRawRef = React.useRef<RawDirectionState>(neutralRaw);
  const pausedRef = React.useRef(false);
  const successLockRef = React.useRef(false);

  const currentTarget = targets[targetIndex] ?? targets[0] ?? DEFAULT_TARGETS[0];

  React.useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  React.useEffect(() => {
    localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(targets));
  }, [targets]);

  React.useEffect(() => {
    const el = historyListRef.current;
    if (!el) return;

    el.scrollLeft = el.scrollWidth;
  }, [history]);

  React.useEffect(() => {
    if (history.length === 0) return;
    if (successLockRef.current) return;
    if (targets.length === 0) return;

    const success = canMatchTargetWithFuzzyInput(
      history,
      currentTarget,
      MAX_GAP_FRAMES
    );

    if (!success) return;

    successLockRef.current = true;
    setTrainingStatus("success");

    window.setTimeout(() => {
      setHistory([]);
      lastRawRef.current = neutralRaw;
      setTargetIndex((index) => (index + 1) % targets.length);
      setTrainingStatus("idle");
      successLockRef.current = false;
    }, 500);
  }, [history, currentTarget, targets.length]);

  function commitInput(nextRaw: RawDirectionState) {
    const previousRaw = lastRawRef.current;

    if (sameRaw(previousRaw, nextRaw)) return;

    const now = performance.now();
    lastRawRef.current = cloneRaw(nextRaw);
    setRaw(cloneRaw(nextRaw));

    if (pausedRef.current) return;

    const resolved = resolveDirection(nextRaw);

    setHistory((prev) => {
      const next = [...prev];

      if (next.length > 0 && !next[next.length - 1].endedAt) {
        const lastIndex = next.length - 1;

        next[lastIndex] = {
          ...next[lastIndex],
          endedAt: now,
          frames: framesBetween(next[lastIndex].startedAt, now),
        };
      }

      if (resolved.direction === 5) {
        return next;
      }

      const newEntry: InputEntry = {
        id: makeId(),
        raw: cloneRaw(nextRaw),
        rawLabel: rawLabel(nextRaw),
        direction: resolved.direction,
        directionLabel: resolved.directionLabel,
        startedAt: now,
        frames: 1,
      };

      return [...next, newEntry].slice(-100);
    });
  }

  React.useEffect(() => {
    let raf = 0;

    function loop() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const activePad = Array.from(pads).find(Boolean) ?? null;

      if (activePad) {
        setGamepad(activePad);
        commitInput(readXboxDpad(activePad));
      } else {
        setGamepad(null);
        commitInput(neutralRaw);
      }

      raf = requestAnimationFrame(loop);
    }

    loop();

    return () => cancelAnimationFrame(raf);
  }, []);

  function clearHistory() {
    successLockRef.current = false;
    setHistory([]);
    setTrainingStatus("idle");
  }

  function selectTarget(index: number) {
    successLockRef.current = false;
    setTargetIndex(index);
    setTrainingStatus("idle");
    setHistory([]);
  }

  function addTarget() {
    const command = newTarget.trim();

    if (!isValidCommand(command)) {
      alert("Command can only contain 1, 2, 3, 4, 6, 7, 8, 9.");
      return;
    }

    setTargets((prev) => {
      if (prev.includes(command)) return prev;
      return [...prev, command];
    });

    setNewTarget("");
    setTrainingStatus("idle");
  }

  function removeTarget(indexToRemove: number) {
    setTargets((prev) => {
      if (prev.length <= 1) return prev;

      const next = prev.filter((_, index) => index !== indexToRemove);

      setTargetIndex((current) => {
        if (indexToRemove < current) return current - 1;
        if (indexToRemove === current) return 0;
        return Math.min(current, next.length - 1);
      });

      return next;
    });

    successLockRef.current = false;
    setTrainingStatus("idle");
    setHistory([]);
  }

  function resetTargets() {
    successLockRef.current = false;
    setTargets(DEFAULT_TARGETS);
    setTargetIndex(0);
    setNewTarget("");
    setTrainingStatus("idle");
    setHistory([]);
  }

  const current = resolveDirection(raw);
  const currentRawLabel = rawLabel(raw);

  return (
    <main className="app">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Xbox / XInput Mode</p>
          <h1>Hitbox Input Lab</h1>
          <p className="subtitle">
            Records the direction input that your PC receives from the Hitbox.
          </p>
        </div>

        <div className="current-direction">
          <div className="direction-symbol">{current.directionLabel}</div>
          <div className="direction-number">{current.direction}</div>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Current Input</h2>

          <div className="info-row">
            <span>Raw D-pad</span>
            <strong>{currentRawLabel}</strong>
          </div>

          <div className="info-row">
            <span>Resolved</span>
            <strong>
              {current.directionLabel} / {current.direction}
            </strong>
          </div>

          <div className="info-row">
            <span>SOCD handling</span>
            <strong>Handled by Hitbox firmware</strong>
          </div>

          <div className="controls">
            <button onClick={() => setPaused((value) => !value)}>
              {paused ? "Resume" : "Pause"}
            </button>

            <button onClick={clearHistory}>Clear</button>
          </div>
        </div>

        <div className="panel">
          <h2>Detected Controller</h2>

          {gamepad ? (
            <>
              <div className="info-row">
                <span>ID</span>
                <strong>{gamepad.id}</strong>
              </div>

              <div className="info-row">
                <span>Mapping</span>
                <strong>{gamepad.mapping || "unknown"}</strong>
              </div>

              <div className="info-row">
                <span>Buttons</span>
                <strong>{gamepad.buttons.length}</strong>
              </div>

              <div className="info-row">
                <span>Axes</span>
                <strong>{gamepad.axes.length}</strong>
              </div>
            </>
          ) : (
            <p className="note">
              No controller detected. Plug in your Hitbox and press a button.
            </p>
          )}
        </div>
      </section>

      <section className="panel training-panel">
        <div className="training-header">
          <div>
            <p className="eyebrow">Training Mode</p>
            <h2>Target Command</h2>
          </div>

          <div
            className={`training-status ${
              trainingStatus === "success" ? "success" : ""
            }`}
          >
            {trainingStatus === "success" ? "Success" : "Waiting"}
          </div>
        </div>

        <div className="target-command">
          {currentTarget.split("").map((char, index) => (
            <span className="target-digit" key={`${char}-${index}`}>
              {char}
            </span>
          ))}
        </div>

        <div className="target-list">
          {targets.map((target, index) => (
            <div className="target-chip" key={`${target}-${index}`}>
              <button
                className={`target-button ${
                  index === targetIndex ? "active" : ""
                }`}
                onClick={() => selectTarget(index)}
              >
                {target}
              </button>

              <button
                className="target-remove"
                onClick={() => removeTarget(index)}
                disabled={targets.length <= 1}
                title="Remove target"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="target-editor">
          <input
            value={newTarget}
            onChange={(event) => setNewTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addTarget();
            }}
            placeholder="Add target, e.g. 41236"
          />

          <button onClick={addTarget}>Add</button>
          <button onClick={resetTargets}>Reset Default</button>
        </div>

        <p className="note">
          Fuzzy input enabled. Extra directions are allowed as long as adjacent
          correct inputs are within {MAX_GAP_FRAMES}f. Targets cannot contain 5
          because Neutral is not recorded in history.
        </p>
      </section>

      <section className="panel history-panel">
        <div className="history-header">
          <h2>Input History</h2>
          <span>{history.length} entries</span>
        </div>

        <div className="history-list" ref={historyListRef}>
          {history.length === 0 ? (
            <div className="empty">Press directions to start recording.</div>
          ) : (
            history.map((entry) => (
              <div className="history-item" key={entry.id}>
                <div className="history-direction">{entry.directionLabel}</div>
                <div className="history-number">{entry.direction}</div>
                <div className="history-frames">{entry.frames}f</div>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}