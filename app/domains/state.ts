import { signal } from "nsh";
import { State } from "zu/native";

export { State } from "zu/native";

/**
 * The UI's durable state over the native `zu/state` module (v2 §6): the
 * registry, the projects, the settings and one layout file per container —
 * read, merged and written **by this side**, atomically, with the top-level
 * `v` version guarding against an older build's clobber.
 *
 * The files keep their old names (`registry.json`, `projects.json`,
 * `settings.json`, `layouts/<encoded container id>.json`), so the first read
 * after an upgrade finds the engine-written files in place and adopts them —
 * the migration is "read in place". From this build on, the engine child is
 * pointed at an `engine/` subdirectory (native spawn policy) and never
 * touches these files again.
 *
 * The signals below are the working truth; each mutation writes through.
 * Writes of one file are serialized (they are read-merge-write), and a stale
 * refusal is retried once from the file's truth rather than dropped.
 */

/** The state version this build reads and writes. */
export const STATE_VERSION = 1;

type Loadable = { v?: number | [unknown] };

/** The last read of each file, so a write can stamp and merge cheaply. */
const cache = new Map<string, Record<string, unknown>>();
/** One in-flight write chain per file: reads merge, writes queue. */
const writeChains = new Map<string, Promise<void>>();

/** A failed read or write of the UI state, for the status line. */
export const stateError = signal<string | null>(null);

function noteError(error: unknown): void {
  stateError.set(String(error instanceof Error ? error.message : error));
}

/**
 * Reads one state file (cached after the first load; `refresh` re-reads —
 * the fold path after another writer moved the file).
 */
export async function readState<T>(name: string, refresh = false): Promise<T | null> {
  if (!refresh && cache.has(name)) return (cache.get(name) as T) ?? null;
  try {
    const found = await State.read(name);
    if (!found) {
      cache.delete(name);
      return null;
    }
    const value = JSON.parse(found.text) as T & Loadable;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    // A newer build's file is still read through the fields this build
    // knows (the object model only grew optional fields), but its version
    // is preserved on the next write so a downgrade cannot clobber it.
    if (typeof value.v === "number" && value.v > STATE_VERSION) {
      cache.set(name, { ...(value as unknown as Record<string, unknown>) });
      return value;
    }
    cache.set(name, { ...(value as unknown as Record<string, unknown>) });
    stateError.set(null);
    return value;
  } catch (error) {
    noteError(error);
    return null;
  }
}

/**
 * Writes one state file: the data merged over the last read (or over the
 * file, when this side has not read it yet), stamped with the version.
 * Writes of the same file serialize; a stale refusal re-reads the file's
 * truth and retries once.
 */
export async function writeState(name: string, data: Record<string, unknown>): Promise<void> {
  const chain = writeChains.get(name) ?? Promise.resolve();
  const next = chain.then(
    () => writeNow(name, data),
    () => writeNow(name, data),
  );
  writeChains.set(
    name,
    next.catch(() => {}),
  );
  try {
    await next;
  } catch (error) {
    noteError(error);
    throw error;
  }
}

async function writeNow(name: string, data: Record<string, unknown>): Promise<void> {
  const previous = cache.has(name) ? (cache.get(name) as Record<string, unknown>) : ((await readState(name)) ?? {});
  const merged = { ...previous, ...data, v: STATE_VERSION };
  try {
    await State.write(name, JSON.stringify(merged));
    cache.set(name, merged);
    stateError.set(null);
  } catch (error) {
    if (String((error as { code?: string })?.code ?? "") === "ERR_STATE_STALE") {
      // A newer state on disk: adopt it, merge again once, and never fight.
      cache.delete(name);
      const truth = ((await readState(name)) ?? {}) as { v?: number };
      const remerged = { ...truth, ...data, v: Math.max(truth.v ?? STATE_VERSION, STATE_VERSION) };
      await State.write(name, JSON.stringify(remerged));
      cache.set(name, remerged);
      return;
    }
    throw error;
  }
}

/** Forgets the cache (tests reset their state directory this way). */
export function resetStateCache(): void {
  cache.clear();
  writeChains.clear();
  stateError.set(null);
}

/** The layout file name for a container, encoded to one path segment. */
export function layoutName(containerId: string): string {
  return `layouts/${encodeURIComponent(containerId)}.json`;
}
