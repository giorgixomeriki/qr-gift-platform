/**
 * The sender's "Download confirmation" link (payment + contract record,
 * app/api/greetings/[greetingId]/confirmation). A plain link: the server
 * answers with a file only for the browser holding this greeting's edit token.
 */
export function ConfirmationLink({ greetingId, label }: { greetingId: string; label: string }) {
  return (
    <a href={`/api/greetings/${greetingId}/confirmation`} download className="sx-banner__link" data-testid="download-confirmation">
      {label}
    </a>
  );
}
