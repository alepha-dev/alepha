import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { AlertCircle, Copy } from "lucide-react";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface CampaignSettingsSigilTokenProps {
  token: string;
  onDismiss: () => void;
}

/**
 * The one moment a sigil token is readable.
 *
 * It is stored hashed, so this panel is not a convenience — it is the only
 * copy. Dismissing it is irreversible, which is why the button says so rather
 * than being a close cross in a corner.
 */
const CampaignSettingsSigilToken = (props: CampaignSettingsSigilTokenProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();

  return (
    <Alert>
      <AlertCircle />
      <AlertDescription className="flex flex-col gap-2">
        <span>{tr("sigils.token.title")}</span>
        <div className="flex items-center gap-2">
          <code className="bg-muted grow overflow-x-auto rounded px-2 py-1 font-mono text-xs">
            {props.token}
          </code>
          <Button
            size="sm"
            variant="outline"
            aria-label={tr("sigils.token.copy")}
            onClick={() => {
              void navigator.clipboard.writeText(props.token);
              toaster.success(tr("sigils.toast.copied"));
            }}
          >
            <Copy />
          </Button>
          <Button size="sm" onClick={props.onDismiss}>
            {tr("sigils.token.done")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};

export default CampaignSettingsSigilToken;
