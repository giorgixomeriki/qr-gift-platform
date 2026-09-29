import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

/**
 * Role-agnostic (admin and partner share the same Supabase Auth user table) —
 * reached only via /auth/confirm after a real recovery session is
 * established. Outside the (admin)/(partner) route groups on purpose: this
 * page needs neither layout's chrome.
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
