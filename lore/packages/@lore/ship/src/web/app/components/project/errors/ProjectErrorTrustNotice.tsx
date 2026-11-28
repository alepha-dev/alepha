import { Button } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ShieldCheck, TriangleAlert } from "lucide-react";

export interface ProjectErrorTrustNoticeProps {
  /**
   * Absent for a member who may not triage: they read the notice, and are
   * offered no verb.
   */
  onTrust?: () => void;
  busy: boolean;
  /**
   * The trust this notice asked for is running: its button spins.
   */
  trusting?: boolean;
}

/**
 * The notice an error awaiting trust shows above its thread (#Q4233): its
 * text came from an ingest open to anyone, so no agent reads it, or its
 * thread, until a member did. Members comment as usual.
 */
const ProjectErrorTrustNotice = (props: ProjectErrorTrustNoticeProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div
      className="border-warning/40 bg-warning/10 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
      data-testid="error-untrusted-notice"
    >
      <TriangleAlert className="text-warning size-4 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">
        {tr("errors.thread.untrusted")}
      </span>
      {props.onTrust && (
        <Button
          type="button"
          variant="outlined"
          size="sm"
          disabled={props.busy}
          loading={props.trusting}
          onClick={props.onTrust}
          data-testid="error-untrusted-trust"
        >
          <ShieldCheck className="size-4" />
          {tr("errors.action.trust")}
        </Button>
      )}
    </div>
  );
};

export default ProjectErrorTrustNotice;
