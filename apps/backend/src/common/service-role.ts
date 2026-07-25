/**
 * What this process is. The SAME build runs as two Render services:
 *   - web    (default): serves HTTP + the light background work
 *   - worker (SERVICE_ROLE=worker): no HTTP, consumes the heavy-video queue
 *
 * Heavy ffmpeg reel work runs ONLY on the worker, so a runaway render can never
 * take down the customer-facing web service (which is exactly what happened when
 * it all ran in one process).
 */
export function isWorkerRole(): boolean {
  return process.env.SERVICE_ROLE === 'worker';
}
