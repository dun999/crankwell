// Runs once when the server starts. The payment reconciler lives in the Node.js server process only:
// not on the edge runtime, and not in `next build`'s prerender workers.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.RECONCILER === "off") return;
  const { startReconciler } = await import("./lib/server/reconcile");
  startReconciler();
}
