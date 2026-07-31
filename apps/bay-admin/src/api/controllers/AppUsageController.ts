import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { AppUsageService } from "../services/AppUsageService.ts";
import { BayControlService } from "../services/BayControlService.ts";

/**
 * One app's history, as Bay's supervisor recorded it.
 *
 * Nothing here comes from inside the app. That is the whole point: it works
 * for an app that embeds no client, for a Go binary, for a static site — and
 * the memory figure is the cgroup charge the 512 MB limit is enforced against,
 * which is the number that predicts a kill rather than the smaller one a
 * process reads about itself.
 */
export class AppUsageController {
  protected readonly usage = $inject(AppUsageService);
  protected readonly bay = $inject(BayControlService);

  appUsage = $action({
    method: "GET",
    path: "/bay/apps/:name/:env/usage",
    use: [$secure({ roles: ["admin"] })],
    description: "Supervisor memory, CPU and restarts over time",
    schema: {
      params: z.object({ name: z.text(), env: z.text() }),
      query: z.object({
        // Capped rather than free: the series is one row a minute, so a request
        // for a year would try to draw half a million points into a sparkline.
        hours: z.integer().min(1).max(336).default(6),
      }),
      response: z.object({
        appKey: z.text(),
        points: z.array(
          z.object({
            at: z.text(),
            running: z.boolean(),
            memoryBytes: z.integer().optional(),
            tasks: z.integer().optional(),
            restarts: z.integer().optional(),
            cpuPercent: z.number().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params, query }) => {
      const appKey = `${params.name}/${params.env}`;

      // Checked against Bay rather than against the series: an app deployed a
      // moment ago has no samples yet, and answering 404 for it would say "no
      // such app" about one that is running perfectly well.
      const apps = await this.bay.listApps();
      if (!apps.some((app) => `${app.name}/${app.env}` === appKey)) {
        throw new NotFoundError(`No app ${appKey} on this Bay`);
      }

      const points = await this.usage.series(appKey, query.hours);
      return {
        appKey,
        points: points.map((point) => ({
          at: point.at,
          running: point.running,
          memoryBytes: point.memoryBytes,
          tasks: point.tasks,
          restarts: point.restarts,
          cpuPercent: point.cpuPercent,
        })),
      };
    },
  });
}
