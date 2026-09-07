import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ScrollText } from "lucide-react";
import { useState } from "react";

import type { EstateCommandController } from "@/api/controllers/EstateCommandController.ts";
import type { EstateCommandResult } from "@/api/schemas/estateCommandResultSchema.ts";
import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface BayLogTailProps {
  app: string;
  env: string;
}

/**
 * A bounded tail of one instance's journal.
 *
 * ⚠️ **Rendered as TEXT, never as markup.** This is output from a third
 * party's application, and a log line is exactly the place an attacker
 * controls the bytes. It goes into a `<pre>` as a string; no markdown, no
 * `dangerouslySetInnerHTML`, ever.
 *
 * ⚠️ **The answer is asynchronous.** The command is queued, the machine reads
 * its journal and uploads the result over the pull seam, and only then is
 * there something to read. So this enqueues, then polls the owner's result
 * route until the blob is there or the command's own timeout has passed. A
 * promise that resolved with the lines would be a lie about the transport.
 *
 * ⚠️ **Refused while the machine is offline**, server-side at enqueue, and the
 * button says so before the click. A tail delivered three hours later, after
 * nobody is looking, is worse than an error.
 *
 * Three caveats travel with the answer and each is a sentence rather than a
 * silence: lines with no timestamp kept regardless of the window (an app
 * writing plain text to stdout produces nothing else, and hiding them would
 * suppress exactly the `console.log` just added), lines dropped to fit the
 * cap, and a tail whose blob has expired.
 */
const BayLogTail = (props: BayLogTailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const commandApi = useClient<EstateCommandController>();
  const [estate] = useStore(currentEstateAtom);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EstateCommandResult | undefined>();
  const [note, setNote] = useState<string | undefined>();

  if (!estate) {
    return null;
  }

  const fetchLogs = async () => {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    setNote(undefined);
    try {
      const command = await commandApi.enqueueEstateCommand({
        params: { estateId: estate.id },
        body: {
          kind: "logs",
          app: props.app,
          environment: props.env,
          lines: LINES,
        },
      });

      // Polled rather than awaited: the machine answers over its own
      // connection, and the blob appears on the row when it does. The window
      // is the command's own timeout, so a machine that never answers stops
      // this rather than leaving a spinner forever.
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        try {
          const file = await commandApi.getEstateCommandResult({
            params: { estateId: estate.id, commandId: command.id },
          });
          setResult(JSON.parse(await (file as unknown as Blob).text()));
          return;
        } catch {
          // 404 until the machine uploads. Any other failure surfaces when
          // the window runs out, with the same sentence: there is nothing to
          // read yet.
        }
      }
      setNote(String(tr("bay.logs.timeout")));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr("bay.logs.title")}</h3>
          <Button
            variant="secondary"
            size="sm"
            // Said before the click rather than refused after it. The enqueue
            // refuses too, server-side, which is what actually holds.
            disabled={busy || !estate.online}
            title={estate.online ? undefined : String(tr("bay.logs.offline"))}
            onClick={() => void fetchLogs()}
            data-testid="bay-logs-fetch"
          >
            <ScrollText className="size-4" />
            {busy ? tr("bay.logs.fetching") : tr("bay.logs.fetch")}
          </Button>
        </div>

        {!estate.online && (
          <p className="text-muted-foreground text-xs">
            {tr("bay.logs.offline")}
          </p>
        )}
        {note && <p className="text-muted-foreground text-xs">{note}</p>}

        {result && (
          <div className="flex flex-col gap-2">
            {/* Each caveat is its own sentence: an empty block explains
                nothing, and three empty blocks explain three different
                things identically. */}
            {!result.supervised && (
              <p className="text-muted-foreground text-xs">
                {tr("bay.logs.unsupervised")}
              </p>
            )}
            {result.static && (
              <p className="text-muted-foreground text-xs">
                {tr("bay.logs.static")}
              </p>
            )}
            {result.truncated ? (
              <p className="text-muted-foreground text-xs">
                {tr("bay.logs.truncated", { args: [String(result.truncated)] })}
              </p>
            ) : null}
            {result.undated ? (
              <p className="text-muted-foreground text-xs">
                {tr("bay.logs.undated", { args: [String(result.undated)] })}
              </p>
            ) : null}

            {result.lines.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {tr("bay.logs.empty")}
              </p>
            ) : (
              <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                {result.lines.map((line) => line.raw).join("\n")}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BayLogTail;

/** What one fetch asks for. Bay's own ceiling is 2000. */
const LINES = 200;
/** The gap between two polls of the result route. */
const POLL_MS = 1500;
/** Enough polls to cover the command's 60 s timeout, and no more. */
const ATTEMPTS = 40;
