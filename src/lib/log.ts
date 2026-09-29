import "server-only";

/**
 * The one place every Server Action's catch block logs to before returning a
 * friendly message to the client. Before this, a failing action returned
 * `{ ok: false, error }` to the browser and logged NOTHING server-side — an
 * operator had no way to see "checkout is failing at rate X" from server
 * logs (the exact gap named in the pilot-readiness audit's observability
 * phase). Deliberately not a logging *library* (no new dependency): this
 * writes structured JSON to stdout, which any hosting platform's log
 * drain/aggregator already captures — see docs/OBSERVABILITY.md for how to
 * point real monitoring at it.
 *
 * `context` is typed as id/count/string-literal only — never `unknown` or a
 * free-form object — specifically so a caller CANNOT accidentally pass a
 * password, token, signed URL, or greeting message through it. If you need
 * to log something new, widen this type deliberately, don't cast around it.
 */
type LogContextValue = string | number | boolean | null | undefined;

export function logServerError(scope: string, err: unknown, context: Record<string, LogContextValue> = {}): void {
  const requestId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      requestId,
      message: err instanceof Error ? err.message : String(err),
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}
