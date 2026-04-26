import type { AdminJobController, JobRegistration } from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

const POLL_MS = 30_000;

export function AdminJobs() {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
  const [jobs, setJobs] = useState<JobRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await client.listJobs();
      setJobs(data);
    } catch {
      toast.error("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const trigger = async (name: string) => {
    try {
      await client.triggerJob({ params: { name }, body: {} });
      toast.success(`Triggered ${name}`);
      void load();
    } catch (e) {
      toast.error(
        `Failed to trigger: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Jobs</h1>
          <p className="text-muted-foreground text-sm">
            {jobs.length} registered job{jobs.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw
            className={loading ? "mr-2 size-4 animate-spin" : "mr-2 size-4"}
          />
          Refresh
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead className="text-right">OK</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.name}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{job.name}</span>
                    {job.description && (
                      <span className="text-muted-foreground text-xs">
                        {job.description}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={job.type === "cron" ? "default" : "secondary"}
                  >
                    {job.type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{job.cron ?? "—"}</code>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{job.priority}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {job.recent.lastRun
                    ? String(l(job.recent.lastRun, { date: "fromNow" }))
                    : "never"}
                </TableCell>
                <TableCell className="text-right">{job.recent.ok}</TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      job.recent.error > 0 ? "text-destructive" : undefined
                    }
                  >
                    {job.recent.error}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => trigger(job.name)}
                  >
                    <Play className="mr-2 size-4" />
                    Trigger
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && jobs.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-8 text-center"
                >
                  No jobs registered.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
