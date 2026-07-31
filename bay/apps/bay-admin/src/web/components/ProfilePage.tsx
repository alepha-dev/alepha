import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import type { MyPasswordController } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";

/**
 * The operator's own account.
 *
 * Only a password change, because that is the whole account: this realm has no
 * email, no avatar and no display name. A profile page that padded that out
 * with empty fields would suggest they mean something.
 */
const ProfilePage = () => {
  const auth = useAuth();
  const passwordApi = useClient<MyPasswordController>();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState<string | undefined>();

  const change = useAction(
    {
      handler: async () => {
        setDone(undefined);
        // Checked here and not on the server: the server has no idea the
        // person typed it twice, and asking it to would mean sending the
        // confirmation over the wire for nothing.
        if (newPassword !== confirmPassword) {
          throw new Error("The two new passwords do not match");
        }
        const res = await passwordApi.changeMyPassword({
          body: { currentPassword, newPassword },
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setDone(
          res.otherSessionsRevoked > 0
            ? `Password changed. ${res.otherSessionsRevoked} other session(s) were signed out.`
            : "Password changed.",
        );
      },
    },
    [currentPassword, newPassword, confirmPassword],
  );

  const username = (auth.user as { username?: string } | undefined)?.username;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium">{username}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Change password
          </CardTitle>
          <CardDescription>
            Every other session is signed out. This one stays.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex max-w-sm flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              change.run();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {change.error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {(change.error as Error).message}
                </AlertDescription>
              </Alert>
            )}
            {done && (
              <Alert>
                <CheckCircle2 />
                <AlertDescription>{done}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={change.loading}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProfilePage;
