import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { Button } from "@alepha/ui/components/ui/button";
import { useClient } from "alepha/react";
import { useState } from "react";

import type { AdminReferenceController } from "@/api/controllers/AdminReferenceController.ts";
import type { ReferenceConversionReport } from "@/api/schemas/referenceConversionReportSchema.ts";

/**
 * Changed rows one write request may touch. The first production run put
 * every row of every project in one request and was cut off after twenty
 * minutes; a page this size is a few seconds on D1.
 */
const PAGE = 25;

/**
 * The operator's page for the one-shot reference converter of epic #32.
 *
 * Two buttons and a report. Dry run first, read the report, then Convert,
 * which asks for confirmation naming the bookmark to take. Convert is a
 * loop: a dry run for the plan, then one project at a time, a page of rows
 * per request until that project reports nothing left, then one write over
 * every project, which is the call that deletes the blob link rows. A
 * request that fails stops the loop where it is; the scan is idempotent,
 * so Convert again continues from there. English only, like the rest of
 * the admin shell: this page exists for one operator on one instance and
 * is deleted with the converter (quest #1808).
 */
export const AdminReferences = () => {
  const client = useClient<AdminReferenceController>();
  const [report, setReport] = useState<ReferenceConversionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const dryRun = async (): Promise<void> => {
    setBusy(true);
    try {
      setReport(await client.convertReferences({ body: { dryRun: true } }));
    } finally {
      setBusy(false);
    }
  };

  const convert = useConfirmedAction<[]>(
    {
      confirm: () => ({
        title: "Convert references",
        description:
          "Rewrite every stored reference in every project to the typed form (#Q12, #E3, #F12, #P120, #R7) and delete the blob link rows. Take a D1 Time Travel bookmark first: this cannot be undone from here.",
        confirmLabel: "Convert",
        destructive: true,
      }),
      handler: async () => {
        setBusy(true);
        try {
          const plan = await client.convertReferences({
            body: { dryRun: true },
          });
          setReport(plan);
          for (const project of plan.projects) {
            let remaining = project.rewritten;
            // Bounded, so a project whose count never reaches 0 (a row the
            // write cannot store) ends the loop instead of holding it.
            for (let page = 0; remaining > 0 && page < 400; page++) {
              setProgress(`${project.slug}: ${remaining} rows to write`);
              const step = await client.convertReferences({
                body: {
                  dryRun: false,
                  projectId: project.projectId,
                  limit: PAGE,
                },
              });
              remaining = step.remaining;
            }
          }
          setProgress("Checking every project and deleting the blob link rows");
          setReport(
            await client.convertReferences({
              body: { dryRun: false, limit: PAGE },
            }),
          );
        } finally {
          setProgress(null);
          setBusy(false);
        }
      },
      success: () => "References converted",
    },
    [client],
  );

  const totals = report
    ? report.projects.reduce(
        (acc, p) => ({
          scanned: acc.scanned + p.scanned,
          rewritten: acc.rewritten + p.rewritten,
          skippedProtected: acc.skippedProtected + p.skippedProtected,
          anchorsDropped: acc.anchorsDropped + p.anchorsDropped,
          unresolved: acc.unresolved + p.unresolved,
        }),
        {
          scanned: 0,
          rewritten: 0,
          skippedProtected: 0,
          anchorsDropped: 0,
          unresolved: 0,
        },
      )
    : null;

  return (
    <AdminPage>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-muted-foreground text-sm">
          Rewrites every stored wiki-link to the typed grammar of epic #32. Run
          a dry run, read the report, then convert. The converter and this page
          are deleted once the old grammar is purged.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void dryRun()}
          >
            Dry run
          </Button>
          <Button
            variant="destructive"
            disabled={busy || convert.loading}
            onClick={() => void convert.run()}
          >
            Convert
          </Button>
        </div>
        {progress && (
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {progress}
          </p>
        )}
        {report && totals && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">
              {report.dryRun ? "Dry run" : "Written"}: {totals.rewritten} of{" "}
              {totals.scanned} bodies rewritten, {totals.skippedProtected}{" "}
              protected folios skipped, {totals.anchorsDropped} anchors dropped,{" "}
              {totals.unresolved} tokens left verbatim, {report.blobLinks} blob
              link rows{" "}
              {report.dryRun
                ? "to delete"
                : report.remaining === 0
                  ? "deleted"
                  : "kept until nothing is left"}
              {report.dryRun ? "" : `, ${report.remaining} rows left to write`}.
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="pr-4">Project</th>
                    <th className="pr-4">Scanned</th>
                    <th className="pr-4">Rewritten</th>
                    <th className="pr-4">Protected</th>
                    <th className="pr-4">Anchors</th>
                    <th className="pr-4">Unresolved</th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.map((p) => (
                    <tr key={p.projectId}>
                      <td className="pr-4">{p.slug}</td>
                      <td className="pr-4 tabular-nums">{p.scanned}</td>
                      <td className="pr-4 tabular-nums">{p.rewritten}</td>
                      <td className="pr-4 tabular-nums">
                        {p.skippedProtected}
                      </td>
                      <td className="pr-4 tabular-nums">{p.anchorsDropped}</td>
                      <td className="pr-4 tabular-nums">{p.unresolved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">
                Every row, before and after
              </summary>
              <pre className="bg-muted mt-2 max-h-[60vh] overflow-auto rounded-md p-3 text-xs">
                {JSON.stringify(report.projects, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </AdminPage>
  );
};

export default AdminReferences;
