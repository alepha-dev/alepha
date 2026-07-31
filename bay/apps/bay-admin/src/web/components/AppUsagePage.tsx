import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useRouter } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";
import UsageChart from "./UsageChart.tsx";

export interface AppUsagePageProps {
  appKey: string;
  hours: number;
  points: Array<{
    at: string;
    running: boolean;
    memoryBytes?: number;
    tasks?: number;
    restarts?: number;
    cpuPercent?: number;
  }>;
}

/**
 * What one app has cost over time.
 *
 * Every number here comes from Bay's supervisor — the cgroup, read through
 * systemd — and not from anything running inside the app. So it is the same
 * page whether the app embeds a client, is written in Go, or is a static site,
 * and the memory figure is the one the 512 MB limit is enforced against.
 */
const AppUsagePage = (props: AppUsagePageProps) => {
  const router = useRouter();
  const latest = props.points[props.points.length - 1];
  const restarts = latest?.restarts ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void router.push("home")}
          aria-label="Back to apps"
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-2xl font-semibold">{props.appKey}</h1>
        {latest && !latest.running && (
          <Badge variant="destructive">Not running</Badge>
        )}
        {restarts > 0 && (
          <Badge variant="destructive">{restarts}× restarted</Badge>
        )}
      </div>

      <div className="flex gap-2">
        {[1, 6, 24, 168].map((hours) => (
          <Button
            key={hours}
            variant={props.hours === hours ? "default" : "outline"}
            size="sm"
            onClick={() =>
              void router.push("appUsage", {
                params: { slug: props.appKey.split("/")[0] },
                query: { hours: String(hours) },
              })
            }
          >
            {hours < 24 ? `${hours}h` : `${hours / 24}d`}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Memory</CardTitle>
          <CardDescription>
            The cgroup charge, which is what <code>MemoryMax</code> is enforced
            against — larger than the RSS a process reads about itself, and the
            number that predicts an OOM kill.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsageChart
            label="Memory over time"
            values={props.points.map((point) => point.memoryBytes)}
            format={(value) => `${(value / 1024 / 1024).toFixed(0)} MB`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CPU</CardTitle>
          <CardDescription>
            Share of one core, differenced from the supervisor's cumulative
            counter. An interval containing a restart is left blank rather than
            drawn as zero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsageChart
            label="CPU over time"
            values={props.points.map((point) => point.cpuPercent)}
            format={(value) => `${value.toFixed(1)}%`}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default AppUsagePage;
