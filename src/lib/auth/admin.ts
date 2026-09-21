import "server-only";
import { checkIsAdmin, withAdminContext, type Tx } from "@/db/client";
import { getSessionUser } from "./session";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Verifies the current request is an authenticated admin and returns a
 * transaction scoped to that identity. Every admin route handler/server action
 * should go through this rather than trusting any client-supplied flag.
 */
export async function requireAdmin<T>(fn: (tx: Tx, adminUserId: string) => Promise<T>): Promise<T> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError("Not signed in");

  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) throw new UnauthorizedError("Not an admin");

  return withAdminContext(user.id, (tx) => fn(tx, user.id));
}
