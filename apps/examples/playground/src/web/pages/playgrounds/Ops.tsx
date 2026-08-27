import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useQuery } from "alepha/react";
import { useCallback, useEffect, useState } from "react";

import type { PlaygroundController } from "../../../api/PlaygroundController.ts";

/**
 * The generic job console: pick any registered `$job`, edit the payload the
 * server generated from its schema, push it, and watch its executions.
 *
 * The endpoints behind it (`/playground/jobs`, `.../sample`, `/playground/run`,
 * `/playground/executions-any/:id/cancel`, `/playground/reset`) existed with no
 * page at all, which is how the sample endpoint went on returning `{}` for
 * months after the TypeBox-to-zod migration without anyone noticing.
 */
const Ops = () => {
  const toast = useToast();
  const client = useClient<PlaygroundController>();
  const [selected, setSelected] = useState<string | undefined>();
  // Kept with the job it belongs to, so switching jobs empties the box by
  // derivation rather than by a synchronous setState inside the effect.
  const [draft, setDraft] = useState<{ job: string; text: string }>();
  const [payloadError, setPayloadError] = useState<string | undefined>();

  const payload = draft && draft.job === selected ? draft.text : "";

  const jobs = useQuery({ handler: () => client.playgroundListJobs() }, []);

  const executions = useQuery(
    {
      handler: () =>
        selected
          ? client.playgroundListExecutions({ params: { name: selected } })
          : Promise.resolve([]),
      runEvery: [2, "seconds"],
    },
    [selected],
  );

  // Whenever the selected job changes, ask the server for a payload shaped
  // like its schema. A cron job has no schema and answers `undefined`.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const job = selected;
    client
      .playgroundJobSample({ params: { name: job } })
      .then((res) => {
        if (cancelled) return;
        setDraft({
          job,
          text: res.sample ? JSON.stringify(res.sample, null, 2) : "",
        });
        setPayloadError(undefined);
      })
      .catch(() => {
        if (!cancelled) setDraft({ job, text: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const run = useCallback(async () => {
    if (!selected) return;
    let parsed: Record<string, unknown> | undefined;
    if (payload.trim()) {
      try {
        parsed = JSON.parse(payload);
      } catch (e) {
        setPayloadError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setPayloadError(undefined);
    try {
      await client.runAnyJob({ body: { name: selected, payload: parsed } });
      toast.success(`Queued ${selected}`);
      await executions.refetch();
    } catch (e) {
      toast.error("Run failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [selected, payload, executions.refetch]);

  const cancel = useCallback(
    async (id: string) => {
      try {
        await client.cancelAny({ params: { id } });
        await executions.refetch();
      } catch (e) {
        toast.error("Cancel failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [executions.refetch],
  );

  const reset = useCallback(async () => {
    const res = await client.playgroundReset();
    toast.success(`Deleted ${res.deleted} executions`);
    await executions.refetch();
  }, [executions.refetch]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Ops</h1>
        <p className="text-muted-foreground text-sm">
          Run any registered <code>$job</code> with a payload generated from its
          own schema.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs tracking-wider uppercase">
            Jobs
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2" data-testid="ops-jobs">
          {(jobs.data ?? []).map((job) => (
            <Button
              key={job.name}
              variant={selected === job.name ? "default" : "outline"}
              size="sm"
              data-testid={`ops-job-${job.name}`}
              onClick={() => setSelected(job.name)}
            >
              {job.name}
            </Button>
          ))}
          {jobs.data?.length === 0 && (
            <span className="text-muted-foreground text-sm">
              No jobs registered.
            </span>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs tracking-wider uppercase">
              Payload
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <textarea
              className="min-h-40 rounded border p-3 font-mono text-xs"
              data-testid="ops-payload"
              value={payload}
              onChange={(e) =>
                setDraft({ job: selected, text: e.target.value })
              }
              placeholder="This job takes no payload."
            />
            {payloadError && (
              <p className="text-destructive text-xs">{payloadError}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" data-testid="ops-run" onClick={run}>
                Run {selected}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="ops-reset"
                onClick={reset}
              >
                Reset executions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs tracking-wider uppercase">
            Executions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="max-h-80 overflow-auto rounded border"
            data-testid="ops-executions"
          >
            {(executions.data ?? []).length === 0 ? (
              <div className="text-muted-foreground p-3 text-xs">
                {selected ? "No executions yet." : "Pick a job."}
              </div>
            ) : (
              (executions.data ?? []).map((execution) => (
                <div
                  key={execution.id}
                  className="flex items-center justify-between gap-2 border-b p-2 text-xs last:border-b-0"
                >
                  <Badge variant="outline">{execution.status}</Badge>
                  <span className="font-mono">{execution.id}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancel(execution.id)}
                  >
                    cancel
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Ops;
