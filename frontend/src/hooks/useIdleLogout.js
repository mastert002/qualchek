import { useEffect, useRef, useState } from 'react';

// Sign the user out after a period with no interaction, warning them first.
//
// Timing is worked out from a stored timestamp rather than a counting-down
// timer: a laptop that sleeps for an hour, or a tab the browser suspends,
// stops running timers but does not stop time passing. Comparing "now" against
// "last activity" gets those cases right, where setTimeout would silently
// extend the session.
//
// Last activity is kept in localStorage so several tabs of the app agree:
// working in one tab keeps the others alive, which is what a person expects.
// The token itself stays in sessionStorage - this only coordinates the clock.

// 30 minutes. Set back from 2 minutes, which interrupted ordinary work:
// reading a long test case or stepping away briefly both exceeded it.
const IDLE_MS = 30 * 60 * 1000;
// Two minutes of warning is proportionate at this length, and leaves time to
// come back to the desk and keep the session rather than lose unsaved input.
const WARN_MS = 2 * 60 * 1000;
const TICK_MS = 1000;
const KEY = 'lastActivity';

// Writing to storage on every mousemove would be wasteful; once a second is
// plenty when the threshold is measured in minutes.
const WRITE_THROTTLE_MS = 1000;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];

function readLast() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeLast(t) {
  try { localStorage.setItem(KEY, String(t)); } catch { /* storage blocked */ }
}

export function clearIdleTracking() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

/**
 * @param {boolean} enabled  only run while someone is signed in
 * @param {() => void} onIdle called once when the session has expired
 * @returns {{ warning: boolean, secondsLeft: number, staySignedIn: () => void }}
 */
export function useIdleLogout(enabled, onIdle) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const onIdleRef = useRef(onIdle);
  const firedRef = useRef(false);

  // Keep the callback current without restarting the interval every render.
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  useEffect(() => {
    if (!enabled) {
      setSecondsLeft(null);
      firedRef.current = false;
      return undefined;
    }

    // A session that starts now counts as activity now, otherwise a stale
    // timestamp from a previous session could expire this one immediately.
    if (!readLast()) writeLast(Date.now());

    let lastWrite = 0;
    const bump = () => {
      const now = Date.now();
      // Once the warning is showing, only the explicit button may extend the
      // session. Otherwise a stray mouse nudge silently cancels the warning
      // and the person never learns their session was about to end.
      if (secondsLeftRef.current !== null) return;
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      writeLast(now);
    };

    ACTIVITY_EVENTS.forEach(e =>
      window.addEventListener(e, bump, { passive: true, capture: true }));

    const tick = () => {
      const last = readLast() || Date.now();
      const idleFor = Date.now() - last;

      if (idleFor >= IDLE_MS) {
        if (!firedRef.current) {
          firedRef.current = true;
          setSecondsLeft(null);
          clearIdleTracking();
          onIdleRef.current?.();
        }
        return;
      }

      const untilLogout = IDLE_MS - idleFor;
      setSecondsLeft(untilLogout <= WARN_MS ? Math.ceil(untilLogout / 1000) : null);
    };

    tick();
    const id = setInterval(tick, TICK_MS);

    return () => {
      clearInterval(id);
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, bump, { capture: true }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Mirror state into a ref so the event handler above can read it without
  // being torn down and rebuilt every second.
  const secondsLeftRef = useRef(null);
  useEffect(() => { secondsLeftRef.current = secondsLeft; }, [secondsLeft]);

  const staySignedIn = () => {
    writeLast(Date.now());
    setSecondsLeft(null);
  };

  return { warning: secondsLeft !== null, secondsLeft, staySignedIn };
}

export const IDLE_MINUTES = IDLE_MS / 60000;
export const WARN_MINUTES = WARN_MS / 60000;
