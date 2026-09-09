import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { Container } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

export interface ArtifactPullCommandProps {
  /**
   * The pullable reference, verbatim as the registry entry recorded it.
   */
  reference: string;
}

/**
 * `docker pull <reference>`, copyable, for an image variant.
 *
 * ## ⚠️ This is the affordance the whole epic exists for
 *
 * An image artifact has nothing to download: Lore stores a reference and
 * never bytes. So the reference IS the artifact, and the one useful thing a
 * reader can do with it is run it. A row that showed the reference and made
 * them select it by hand would be showing the answer and withholding it.
 *
 * ## ⚠️ It is not, and must never become, a Download button
 *
 * There is no Download button on any variant anywhere - the authenticated
 * download endpoint does not exist, and a control that cannot do its job is
 * worse than an absent one. When that endpoint lands it must not grow one
 * HERE either: an image row points at bytes Lore never stored, so the button
 * would be offering a file that does not exist on this server.
 *
 * ## The command, not the reference
 *
 * What is COPIED is the whole `docker pull` line, because that is what the
 * reader is going to paste. What is SHOWN is the reference alone, because the
 * row is dense and `docker pull` is the same eleven characters on every one
 * of them. The full command is on the title attribute.
 */
const ArtifactPullCommand = (props: ArtifactPullCommandProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const command = `docker pull ${props.reference}`;

  return (
    <button
      type="button"
      data-testid="artifact-pull"
      title={command}
      aria-label={tr("artifacts.pull.copy", { args: [props.reference] })}
      className="text-muted-foreground hover:text-foreground flex min-w-0 shrink items-center gap-1.5 font-mono text-[11.5px]"
      onClick={async () => {
        // ⚠️ The toast only after the write RESOLVED. `writeText` rejects on
        // an insecure context, and "copied" would then be a lie about the
        // reader's clipboard.
        try {
          await navigator.clipboard.writeText(command);
          toaster.success(tr("artifacts.pull.copied"));
        } catch (error) {
          toaster.error(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      <Container className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{props.reference}</span>
    </button>
  );
};

export default ArtifactPullCommand;
