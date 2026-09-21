import "server-only";
import { eq } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { greetings } from "@/db/schema";
import { verifyEditToken } from "@/lib/security/edit-token";

export class InvalidEditTokenError extends Error {
  constructor(message = "Invalid or expired edit access") {
    super(message);
    this.name = "InvalidEditTokenError";
  }
}

/**
 * Verifies a presented sender edit token against the greeting it claims to
 * unlock. Reads via withPublicContext first (DRAFT/ACTIVE greeting metadata,
 * including edit_token_hash, is publicly SELECT-able — see
 * migrations/0001's greetings_select policy) purely to fetch the hash to
 * compare against; this is NOT itself an authorization grant. Only after the
 * hash comparison succeeds does a caller open a withEditableGreeting-scoped
 * transaction for the actual mutation.
 */
export async function verifyGreetingEditAccess(greetingId: string, presentedToken: string) {
  const [greeting] = await withPublicContext((tx) =>
    tx.select().from(greetings).where(eq(greetings.id, greetingId)).limit(1),
  );
  if (!greeting) throw new InvalidEditTokenError("Greeting not found");
  if (!verifyEditToken(presentedToken, greeting.editTokenHash)) {
    throw new InvalidEditTokenError("Edit token does not match");
  }
  if (greeting.status !== "DRAFT") {
    throw new InvalidEditTokenError("Greeting is no longer editable");
  }
  return greeting;
}
