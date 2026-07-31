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
import { useRouter } from "alepha/react/router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import type { PulseAppController } from "../../api/controllers/PulseAppController.ts";

/**
 * Enrols an app and shows its key — once.
 *
 * The token is displayed here and nowhere else: only its hash is stored, so
 * there is nothing to show a second time. Saying so on the card is what stops
 * someone closing the page and coming back for it.
 */
const EnrollCard = () => {
  const api = useClient<PulseAppController>();
  const router = useRouter();

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | undefined>();

  const enroll = useAction(
    {
      handler: async () => {
        const res = await api.enroll({ body: { slug, name: name || slug } });
        setToken(res.token);
        setSlug("");
        setName("");
        await router.reload();
      },
    },
    [slug, name],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          Enrol an app
        </CardTitle>
        <CardDescription>
          Works for an app hosted anywhere — Cloudflare, Vercel, a VPS, Bay. Add{" "}
          <code>@alepha/pulse-client</code>, then set <code>PULSE_SINK</code>{" "}
          and <code>PULSE_KEY</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            enroll.run();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              placeholder="my-app"
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              value={name}
              placeholder="from the slug"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={enroll.loading}>
            Enrol
          </Button>
        </form>

        {enroll.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {(enroll.error as Error).message}
            </AlertDescription>
          </Alert>
        )}

        {token && (
          <Alert>
            <AlertDescription className="flex flex-col gap-1">
              <span>
                Copy this key now — only its hash is stored, so it cannot be
                shown again.
              </span>
              <code className="bg-muted rounded px-2 py-1 font-mono text-xs">
                {token}
              </code>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default EnrollCard;
