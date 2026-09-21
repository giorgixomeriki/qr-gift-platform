import "server-only";
import { cookies } from "next/headers";
import { editTokenCookieName } from "@/lib/security/edit-token";
import { InvalidEditTokenError } from "./access";

/**
 * Shared by every "use server" actions file that mutates/reads a Greeting via
 * sender authorization (lib/greetings/actions.ts, lib/payments/actions.ts).
 * Deliberately NOT itself exported from a "use server" file — a plain helper,
 * not a directly-invokable Server Action. Every caller re-derives the token
 * from the HttpOnly cookie on every call — never from a client-supplied field.
 */
export async function getEditToken(greetingId: string): Promise<string> {
  const cookieStore = await cookies();
  const token = cookieStore.get(editTokenCookieName(greetingId))?.value;
  if (!token) throw new InvalidEditTokenError("No edit access for this greeting");
  return token;
}
