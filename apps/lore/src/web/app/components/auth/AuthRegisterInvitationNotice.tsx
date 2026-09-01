import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { AlertCircle } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

export interface AuthRegisterInvitationNoticeProps {
  /**
   * Why the invitation cannot be used, or `accountExists` when it can but the
   * person already has somewhere better to be.
   */
  status:
    | "accountExists"
    | "invalid"
    | "expired"
    | "accepted"
    | "declined"
    | "revoked";
  /**
   * Where the button goes. Sign in for every one of these: they either have
   * an account already, or they need to talk to whoever invited them, and
   * sign-in is the only page that helps with both.
   */
  loginPath: string;
}

/**
 * What a visitor sees when their invite link cannot open the register form.
 *
 * Six states, six sentences. None of them is the realm's generic
 * "Registration is not available", which is the message this whole epic
 * exists to stop showing to somebody who was invited: it is true, useless,
 * and reads as a rejection rather than as an explanation.
 *
 * The distinctions are safe to make because every status past `invalid`
 * requires the invitation's own uuid - see `invitationTokenPreviewSchema`.
 */
const AuthRegisterInvitationNotice = (
  props: AuthRegisterInvitationNoticeProps,
) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertCircle className="size-4" />
          <AlertDescription>
            {tr(`auth.invitation.${props.status}` as keyof I18n)}
          </AlertDescription>
        </Alert>
        <Button nativeButton={false} render={<Link href={props.loginPath} />}>
          {tr("auth.invitation.signIn")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default AuthRegisterInvitationNotice;
