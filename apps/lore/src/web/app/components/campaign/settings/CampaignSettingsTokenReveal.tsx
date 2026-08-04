import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { AlertCircle, Copy } from "lucide-react";

export interface CampaignSettingsTokenRevealProps {
  token: string;
  title: string;
  copyLabel: string;
  doneLabel: string;
  copiedMessage: string;
  onDismiss: () => void;
}

/**
 * The one moment a minted credential is readable.
 *
 * Tokens are stored hashed, so this panel is not a convenience — it is the
 * only copy that will ever exist. Dismissing it is irreversible, which is why
 * the button says so rather than being a close cross in a corner.
 *
 * The strings arrive as props because sigils and outposts word this
 * differently: one names an environment, the other a machine.
 */
const CampaignSettingsTokenReveal = (
  props: CampaignSettingsTokenRevealProps,
) => {
  const toaster = useToast();

  return (
    <Alert>
      <AlertCircle />
      <AlertDescription className="flex flex-col gap-2">
        <span>{props.title}</span>
        <div className="flex items-center gap-2">
          <code className="bg-muted grow overflow-x-auto rounded px-2 py-1 font-mono text-xs">
            {props.token}
          </code>
          <Button
            size="sm"
            variant="outline"
            aria-label={props.copyLabel}
            onClick={() => {
              void navigator.clipboard.writeText(props.token);
              toaster.success(props.copiedMessage);
            }}
          >
            <Copy />
          </Button>
          <Button size="sm" onClick={props.onDismiss}>
            {props.doneLabel}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};

export default CampaignSettingsTokenReveal;
