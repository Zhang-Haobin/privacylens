// Shared browser/server budgets. Keep the backend below vercel.json maxDuration.
export const AI_BUDGET = Object.freeze({
  backendMs: 50_000,
  firstAttemptMs: 35_000,
  responseReserveMs: 2_000,
  minimumRetryMs: 5_000,
  browserMs: 55_000
});
