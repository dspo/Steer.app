import { Instance } from "zu/native";

/**
 * The typed face of `zu/native`'s `Instance`: the single-instance claim.
 *
 * The app calls it once, before the engine boots, and only on a desktop
 * (`nsh/desktop`'s `isAvailable`). The Rust side owns the file, the pid
 * liveness check and the stale-lock reclamation; this module only names the
 * shape and stays quiet when the native module is not there (a headless
 * fixture has no lock to claim).
 */

/** What `Instance.claim()` found. */
export type InstanceClaim = {
  /** This process owns the state directory now. */
  acquired: boolean;
  /** This process already held it (an idempotent second call). */
  already: boolean;
  /** A stale lock (its process was gone) was reclaimed on the way. */
  stale: boolean;
  /** This process's pid. */
  pid: number;
  /** The live owner that blocked the claim; null when acquired. */
  ownerPid?: number | null;
  /** The lock file's path. */
  path: string;
  /** When the lock was created, in milliseconds since the Unix epoch. */
  startedAt: number;
};

/** Claims the state directory for this process; `null` when the native module has no answer. */
export function claimInstance(): InstanceClaim | null {
  try {
    const claim = Instance.claim() as InstanceClaim;
    return normalizeClaim(claim);
  } catch {
    return null;
  }
}

/** Gives back this process's claim (an explicit quit); `false` when it held none. */
export function releaseInstance(): boolean {
  try {
    return Instance.release() === true;
  } catch {
    return false;
  }
}

/** The lock file's path; empty when the native module has no answer. */
export function instanceLockPath(): string {
  try {
    return String(Instance.lockPath());
  } catch {
    return "";
  }
}

function normalizeClaim(claim: unknown): InstanceClaim {
  const value = (claim ?? {}) as Partial<InstanceClaim>;
  return {
    acquired: value.acquired === true,
    already: value.already === true,
    stale: value.stale === true,
    pid: typeof value.pid === "number" ? value.pid : 0,
    ownerPid: typeof value.ownerPid === "number" ? value.ownerPid : null,
    path: typeof value.path === "string" ? value.path : "",
    startedAt: typeof value.startedAt === "number" ? value.startedAt : 0,
  };
}
