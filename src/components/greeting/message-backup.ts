"use client";

/**
 * The message as typed, kept on the device until the server has it. Phones
 * discard background tabs freely — a sender who switches to Photos or a chat
 * to copy a line can come back to a reloaded page; what they typed must
 * still be there. Cleared once the message is saved (MessageStep).
 */
const draftKey = (greetingId: string) => `qrs:message:${greetingId}`;
export function readMessageBackup(greetingId: string): string | null {
  try {
    return window.localStorage.getItem(draftKey(greetingId));
  } catch {
    return null;
  }
}
export function writeMessageBackup(greetingId: string, value: string) {
  try {
    window.localStorage.setItem(draftKey(greetingId), value);
  } catch {
    /* storage unavailable (private mode, quota): the server copy still saves on Continue */
  }
}
export function clearMessageBackup(greetingId: string) {
  try {
    window.localStorage.removeItem(draftKey(greetingId));
  } catch {
    /* ignore */
  }
}
