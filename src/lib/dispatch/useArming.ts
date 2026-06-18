/**
 * Wend — auto-arm state machine.
 *
 *   IDLE → (type) → COMPOSING → (settle 2.5s) → EVALUATING → ARMED | IDLE
 *   ARMED + autoWend → 3s countdown → fire()
 *   ARMED + !autoWend → static "Wend it" pill (no countdown)
 *   any keystroke or cancel() → COMPOSING (settle resets)
 *
 * The countdown is the reversible consent window — fire() spawns the real
 * dispatch, there is no daemon-side hold. Only one target arms at a time; the
 * caller keys this hook on whichever text is the active dispatch target (body
 * on first send, else the last follow-up).
 */
import { useEffect, useRef, useState } from "react";

import {
  classifyNote,
  isComplete,
  MIN_ARM_LENGTH,
} from "@/lib/dispatch/classifyNote";

export type ArmPhase = "idle" | "composing" | "armed";

const SETTLE_MS = (() => {
  const raw = process.env.EXPO_PUBLIC_WEND_SETTLE_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 2500;
})();

const COUNTDOWN_SECONDS = 3;

interface UseArmingOptions {
  text: string;
  autoWend: boolean;
  enabled: boolean;
  fire: () => void;
}

interface Arming {
  phase: ArmPhase;
  secondsLeft: number;
  cancel: () => void;
  fireNow: () => void;
}

function gatePasses(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_ARM_LENGTH) return false;
  const intent = classifyNote(text);
  if (intent === "idea") return false;
  return isComplete(text, intent);
}

export function useArming({
  text,
  autoWend,
  enabled,
  fire,
}: UseArmingOptions): Arming {
  const [phase, setPhase] = useState<ArmPhase>("idle");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fireRef = useRef(fire);
  fireRef.current = fire;

  const clearSettle = () => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  };
  const clearCountdown = () => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
  };

  // Settle: any text change (or disable) restarts the timer and drops back to
  // composing. When the timer fires we evaluate the gate and arm or go silent.
  useEffect(() => {
    clearSettle();
    clearCountdown();

    if (!enabled || text.trim().length < MIN_ARM_LENGTH) {
      setPhase("idle");
      return clearSettle;
    }

    setPhase("composing");
    setSecondsLeft(COUNTDOWN_SECONDS);
    settleTimer.current = setTimeout(() => {
      if (gatePasses(text)) {
        setPhase("armed");
      } else {
        setPhase("idle");
      }
    }, SETTLE_MS);

    return clearSettle;
  }, [text, enabled, autoWend]);

  // Countdown: only when armed AND auto-fire is on. Ticks 3→2→1, fires at 0.
  useEffect(() => {
    clearCountdown();
    if (phase !== "armed" || !autoWend) return clearCountdown;

    setSecondsLeft(COUNTDOWN_SECONDS);
    countdownTimer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearCountdown();
          setPhase("idle");
          fireRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return clearCountdown;
  }, [phase, autoWend]);

  useEffect(
    () => () => {
      clearSettle();
      clearCountdown();
    },
    [],
  );

  function cancel() {
    clearSettle();
    clearCountdown();
    setPhase(text.trim().length >= MIN_ARM_LENGTH ? "composing" : "idle");
  }

  function fireNow() {
    clearSettle();
    clearCountdown();
    setPhase("idle");
    fireRef.current();
  }

  return { phase, secondsLeft, cancel, fireNow };
}
