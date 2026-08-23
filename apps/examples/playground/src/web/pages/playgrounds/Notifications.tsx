import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useCallback, useState } from "react";

import type { PlaygroundController } from "../../../api/PlaygroundController.ts";

interface LogLine {
  level: "ok" | "err";
  text: string;
  at: number;
}

const Notifications = () => {
  const toast = useToast();
  const client = useClient<PlaygroundController>();
  const [lines, setLines] = useState<LogLine[]>([]);

  const append = useCallback((level: LogLine["level"], text: string) => {
    setLines((prev) => [{ level, text, at: Date.now() }, ...prev].slice(0, 80));
  }, []);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        const res = await fn();
        append("ok", `${label} → ${JSON.stringify(res)}`);
        toast.success(label);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        append("err", `${label} ✗ ${msg}`);
        toast.error(label, { description: msg });
      }
    },
    [append],
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Notifications playground</h1>
        <p className="text-muted-foreground text-sm">
          Exercise notification dispatch endpoints.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs tracking-wider uppercase">
            Send
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("pushWelcomeEmail", () => client.pushWelcomeEmail())
            }
          >
            push welcome email
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("pushPasswordReset", () => client.pushPasswordReset())
            }
          >
            push password reset
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs tracking-wider uppercase">
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-auto rounded border p-3 font-mono text-xs">
            {lines.length === 0 ? (
              <div className="text-muted-foreground">No activity yet.</div>
            ) : (
              lines.map((l) => (
                <div
                  key={l.at}
                  className={
                    l.level === "ok" ? "text-green-600" : "text-destructive"
                  }
                >
                  [{new Date(l.at).toLocaleTimeString()}] {l.text}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Notifications;
