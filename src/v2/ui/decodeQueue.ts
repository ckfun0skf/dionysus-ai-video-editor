/**
 * P29-CLIP-LOADING: thumbnails and filmstrips decode through a small shared queue with retries.
 * Before, every asset version started its own hidden <video> at once; with many clips the browser ran out
 * of decoders (mobile allows only a few), the 5–8 s timeouts fired and the failure was never retried, so the
 * clip stayed without a thumbnail.
 */
export const DECODE_CONCURRENCY = 2;
export const DECODE_TRIES = 3;

export function createQueue(limit = DECODE_CONCURRENCY) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => { if (active < limit && waiting.length) { active += 1; waiting.shift()!(); } };
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      return new Promise<T>((res, rej) => {
        waiting.push(() => { job().then(res, rej).finally(() => { active -= 1; next(); }); });
        next();
      });
    },
    get active() { return active; },
    get pending() { return waiting.length; },
  };
}

/** Run `job` until it returns a value (undefined or a throw count as a failure), waiting `backoffMs × attempt` between tries. */
export async function withRetry<T>(job: () => Promise<T | undefined>, tries = DECODE_TRIES, backoffMs = 800): Promise<T | undefined> {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await job(); if (r !== undefined) return r; } catch { /* retry */ }
    if (i < tries - 1 && backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
  }
  return undefined;
}

/** The queue shared by thumbnails and filmstrips. */
export const decodeQueue = createQueue();
