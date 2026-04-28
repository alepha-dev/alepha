import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient } from "alepha/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { PlaygroundController } from "../../../api/PlaygroundController.ts";

interface LogLine {
  level: "ok" | "err" | "info";
  text: string;
  at: number;
}

const Jobs = () => {
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        append("err", `${label} ✗ ${msg}`);
        toast.error(label, { description: msg });
      }
    },
    [append],
  );

  const c = client as never as Record<string, () => Promise<unknown>> & {
    pushMail: (req: {
      body: { to: string; subject: string };
    }) => Promise<unknown>;
    pushSlow: (req: { body: { label: string } }) => Promise<unknown>;
    pushManyMarketing: (req: { body: { count: number } }) => Promise<unknown>;
    pushDelayed: (req: {
      body: { to: string; delaySeconds: number };
    }) => Promise<unknown>;
    pushDeduped: (req: { body: { key: string } }) => Promise<unknown>;
    pushPriority: (req: { body: { priority: string } }) => Promise<unknown>;
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Jobs playground</h1>
        <p className="text-muted-foreground text-sm">
          Exercise the <code>$job</code> primitive end-to-end.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Cron
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => run("dailyTick", () => c.triggerDailyCron())}
          >
            trigger dailyTick
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => run("hourlyTick", () => c.triggerHourlyCron())}
          >
            trigger hourlyTick{" "}
            <Badge variant="secondary" className="ml-1">
              record: all
            </Badge>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => run("boomCron", () => c.triggerBoomCron())}
          >
            trigger boomCron
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Queue · single push
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("pushMail", () =>
                c.pushMail({
                  body: { to: "alice@example.com", subject: "Hello" },
                }),
              )
            }
          >
            push mail
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => run("pushFlaky", () => c.pushFlaky())}
          >
            push flaky
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("pushSlow", () =>
                c.pushSlow({ body: { label: "long-task" } }),
              )
            }
          >
            push slow
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Queue · batch / delay / key / priority
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("pushMany(10)", () =>
                c.pushManyMarketing({ body: { count: 10 } }),
              )
            }
          >
            pushMany 10
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("pushMany(200)", () =>
                c.pushManyMarketing({ body: { count: 200 } }),
              )
            }
          >
            pushMany 200
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("delayed 60s", () =>
                c.pushDelayed({
                  body: { to: "late@example.com", delaySeconds: 60 },
                }),
              )
            }
          >
            push delayed 60s
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("dedup key:A", () => c.pushDeduped({ body: { key: "A" } }))
            }
          >
            push key=A
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("priority critical", () =>
                c.pushPriority({ body: { priority: "critical" } }),
              )
            }
          >
            priority: critical
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("priority low", () =>
                c.pushPriority({ body: { priority: "low" } }),
              )
            }
          >
            priority: low
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
            Activity log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-auto rounded border p-3 font-mono text-xs leading-relaxed">
            {lines.length === 0 ? (
              <div className="text-muted-foreground">
                Click a button above to see request/response pairs…
              </div>
            ) : (
              lines.map((l) => (
                <div
                  key={l.at}
                  className={
                    l.level === "ok"
                      ? "text-green-600"
                      : l.level === "err"
                        ? "text-destructive"
                        : "text-muted-foreground"
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

export default Jobs;
