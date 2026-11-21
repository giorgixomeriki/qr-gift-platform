/** Client-safe constants shared by the partner login forms and lib/partners/login-access.ts. */
// Must match Supabase Auth's password policy (production 2026-11-21:
// password_min_length 12, password_required_characters letters:digits). If the
// app is laxer, the form accepts a password Auth then refuses as weak_password.
export const PASSWORD_MIN_LENGTH_PUBLIC = 12;
export const PASSWORD_MAX_LENGTH_PUBLIC = 128;

/** Same rule as Supabase Auth: length bounds plus at least one letter and one digit. */
export function meetsPasswordPolicy(password: string): boolean {
  return (
    typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH_PUBLIC &&
    password.length <= PASSWORD_MAX_LENGTH_PUBLIC &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
