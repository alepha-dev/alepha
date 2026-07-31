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
import { useAction, useClient } from "alepha/react";
import { AlertCircle, CheckCircle2, Terminal } from "lucide-react";
import { useState } from "react";
import type { DeviceController } from "../../api/controllers/DeviceController.ts";

export interface DevicePageProps {
  /** Pre-filled from `verification_uri_complete`, empty when typed by hand. */
  userCode: string;
  /** What the server knows about `userCode` at load time. */
  initialStatus: "pending" | "approved" | "denied" | "unknown";
}

/**
 * Approves a terminal that is waiting to log in.
 *
 * The whole security of the device grant rests on this page: the code alone
 * proves nothing, and it is the authenticated session here that decides who the
 * terminal will act as. Hence the deliberate plainness — the one thing a reader
 * must do is check that a login is one they just started.
 */
const DevicePage = (props: DevicePageProps) => {
  const deviceApi = useClient<DeviceController>();
  const [code, setCode] = useState(props.userCode);
  const [outcome, setOutcome] = useState<"approved" | "denied" | undefined>();

  const decide = useAction<["approve" | "deny"]>(
    {
      handler: async (decision) => {
        await deviceApi.decide({ body: { userCode: code, decision } });
        setOutcome(decision === "approve" ? "approved" : "denied");
      },
    },
    [code],
  );

  if (outcome) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {outcome === "approved" ? "Terminal approved" : "Login refused"}
          </CardTitle>
          <CardDescription>
            {outcome === "approved"
              ? "You can go back to your terminal — it should already be through."
              : "Nothing was granted. The terminal will stop waiting."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-5" />
          Approve a terminal
        </CardTitle>
        <CardDescription>
          A command line is asking to act as you. It will be able to deploy,
          restart and remove apps.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertCircle />
          <AlertDescription>
            Only approve a code you are reading off your own screen, right now.
            If you did not start a login, refuse it.
          </AlertDescription>
        </Alert>

        {/*
          Shown only for a code that arrived pre-filled: someone who has not
          typed anything yet would otherwise be told their empty field is
          "unknown". Codes expire in ten minutes, so "no longer waiting" is the
          ordinary outcome of walking away, not an error.
        */}
        {props.userCode && props.initialStatus !== "pending" && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {props.initialStatus === "unknown"
                ? "This code is not waiting for a decision — it may have expired, or already been answered. Run the login command again."
                : `This login was already ${props.initialStatus}.`}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="user-code">Code</Label>
          <Input
            id="user-code"
            value={code}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            // Uppercase for legibility only; the server normalizes case and
            // separators, so nothing here can make a valid code invalid.
            className="font-mono text-lg uppercase tracking-widest"
            onChange={(event) => setCode(event.target.value)}
          />
        </div>

        {decide.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{decide.error.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => decide.run("approve")}
            disabled={!code || decide.loading}
          >
            <CheckCircle2 />
            Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => decide.run("deny")}
            disabled={!code || decide.loading}
          >
            Refuse
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default DevicePage;
