import { useI18n } from "alepha/react/i18n";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import { useToast } from "../core/useToast.tsx";

export interface AccountRecoveryCodesProps {
  codes: string[];
  /**
   * The one way out: the reader says they kept the codes.
   */
  onSaved: () => void;
}

/**
 * A fresh set of recovery codes, shown once: the warning, the codes, a copy
 * button and the explicit "I have saved them" that ends the step.
 *
 * Shared by enrollment and regeneration, which both hand the user codes that
 * are stored hashed and can never be displayed again.
 */
export const AccountRecoveryCodes = (props: AccountRecoveryCodesProps) => {
  const { tr } = useI18n();
  const toaster = useToast();

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTriangle className="size-4" />
        <AlertDescription>
          {tr("account.mfa.recoveryDescription", {
            default:
              "Keep these somewhere safe. Each one works once, and this is the only time they can be shown.",
          })}
        </AlertDescription>
      </Alert>

      <div
        data-testid="recovery-codes"
        className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-4 font-mono text-sm"
      >
        {props.codes.map((recovery) => (
          <span key={recovery}>{recovery}</span>
        ))}
      </div>

      <Button
        variant="solid"
        intent="none"
        onClick={() => {
          void navigator.clipboard?.writeText(props.codes.join("\n"));
          toaster.show(
            tr("account.mfa.recoveryCopied", {
              default: "Recovery codes copied",
            }),
            "success",
          );
        }}
      >
        {tr("account.mfa.copyCodes", { default: "Copy codes" })}
      </Button>

      <Button onClick={props.onSaved}>
        {tr("account.mfa.saved", { default: "I have saved them" })}
      </Button>
    </div>
  );
};
