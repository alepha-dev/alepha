import { Card, CardContent, TimeAgo } from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import BayJobToolSignIn from "./BayJobToolSignIn.tsx";
import { useBayInventory } from "./useBayInventory.ts";

/**
 * What the host's jobs user has (#Q4254): each agent CLI, then git, gh, cf
 * and lore, installed with its version or not installed, as the machine's
 * last inventory reports them, whether or not the host is an Agent host. The
 * owner sees what a job would find before running one.
 *
 * Three states before any tool: never reported, reported with no jobs user
 * (`bay config jobs --user` was never run), and the list, each tool with its
 * sign-in (#Q4256).
 */
const BayJobTools = () => {
  const { tr } = useI18n<I18n, "en">();
  const [host] = useStore(currentHostAtom);
  const { data } = useBayInventory();
  if (!host || host.type !== "bay") return null;
  const reportedAt = data?.inventory?.reportedAt;

  return (
    <Card id="host-tools" data-testid="bay-job-tools">
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <span>{tr("hosts.tools.title")}</span>
          {reportedAt && host.jobsUser && (
            <span className="text-muted-foreground text-xs">
              {tr("hosts.tools.reported")} <TimeAgo value={reportedAt} />
            </span>
          )}
        </div>
        {host.jobsUser === undefined || host.jobsUser === null ? (
          <span
            className="text-muted-foreground text-xs"
            data-testid="bay-job-tools-never"
          >
            {tr("hosts.tools.never")}
          </span>
        ) : host.jobsUser === "" ? (
          <span
            className="text-muted-foreground text-xs"
            data-testid="bay-job-tools-no-user"
          >
            {tr("hosts.tools.noUser", {
              args: ["bay config jobs --user <name>"],
            })}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground text-xs">
              {tr("hosts.tools.user", { args: [host.jobsUser] })}
            </span>
            <ul className="flex flex-col gap-0.5 text-xs">
              {(host.jobsTools ?? []).map((tool) => (
                <li
                  key={tool.name}
                  className="flex gap-2"
                  data-testid={`bay-job-tool-${tool.name}`}
                >
                  <span className="text-foreground w-14 font-mono">
                    {tool.name}
                  </span>
                  {!tool.found ? (
                    <span className="text-muted-foreground" title={tool.error}>
                      {tr("hosts.tools.missing")}
                    </span>
                  ) : tool.error ? (
                    <span className="text-danger">{tool.error}</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        {tr("hosts.tools.installed", {
                          args: [tool.version ?? ""],
                        })}
                      </span>
                      <BayJobToolSignIn
                        tool={tool}
                        user={host.jobsUser ?? ""}
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default BayJobTools;
