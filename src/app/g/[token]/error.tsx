"use client";

import { useEffect, useState } from "react";
import { CloudOff, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusScreen } from "@/components/flow/status-screen";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";
import { Button } from "@/components/ui/button";

/**
 * When a card's page fails to load (a server error, or the phone dropped its
 * connection mid-request): the same calm status layout as every other card
 * state, in the visitor's language, with one way forward — never the
 * framework's raw error page. Nothing the sender saved is affected; retrying
 * re-renders the same card.
 */
export default function CardError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error("[card-page]", error.digest ?? error.message);
  }, [error]);

  return (
    <StatusScreen
      icon={<CloudOff aria-hidden />}
      title={t("error")}
      body={t("errorBody")}
      headerEnd={<LocaleSwitcher />}
      action={
        <Button
          size="lg"
          block
          loading={retrying}
          icon={<RotateCcw className="size-4" aria-hidden />}
          onClick={() => {
            setRetrying(true);
            // A full reload: the failure may have been the connection, and a
            // fresh request is what actually tries again.
            window.location.reload();
          }}
          data-testid="card-error-retry"
        >
          {t("retry")}
        </Button>
      }
    />
  );
}
