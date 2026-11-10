import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  formatBytes,
  Input,
  Textarea,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  DatabaseBackup,
  History,
  ListOrdered,
  Radar,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import type { EstateEvent } from "../../../../api/entities/estateEvents.ts";
import type { EstateBackupCommandBody } from "../../../../api/schemas/estateBackupCommandSchema.ts";
import type { EstateBackupsListResult } from "../../../../api/schemas/estateBackupResultSchemas.ts";
import type { EstateCommandResource } from "../../../../api/schemas/estateCommandResourceSchema.ts";
import type { EstateInventoryBackup } from "../../../../api/schemas/estateInventoryBackupSchema.ts";

type Tr = ReturnType<typeof useI18n<I18n, "en">>["tr"];
type TrKey = Parameters<Tr>[0];

/**
 * Where the panel reads and writes, so the project's Backups tab and the Bay
 * console draw the same screen over two different routes.
 *
 * ⚠️ `canManage` only hides buttons. Every write is refused server-side by the
 * route it goes through, then by Bay itself (`deployAllowed`, a reason for a
 * real restore), which is what actually holds.
 */
export interface BackupSource {
  /** The machine name, typed back to confirm a restore. */
  appLabel: string;
  backup?: EstateInventoryBackup;
  /**
   * What to say in place of the backup facts while `backup` is absent, when
   * the caller knows more than "not reported": why this copy is missing from
   * the machine's report.
   */
  notice?: string;
  events: EstateEvent[];
  online: boolean;
  deployAllowed: boolean;
  canManage: boolean;
  /**
   * Whether a restore may name another instance's backups (`from`). Only the
   * estate owner's route accepts it, so the project's Backups tab hides the
   * field rather than offer one the server always refuses.
   */
  canRestoreFrom: boolean;
  /**
   * Whether the operator policy may be edited. It is Bay's operator layer,
   * the estate owner's alone: a project declares its policy at deploy.
   */
  canEditPolicy: boolean;
  send: (body: EstateBackupCommandBody) => Promise<EstateCommandResource>;
  poll: (id: string) => Promise<EstateCommandResource | undefined>;
  /** The uploaded result, parsed; `undefined` while there is none yet. */
  result: (id: string) => Promise<unknown>;
  reload: () => void;
}

export interface BackupPanelProps {
  source: BackupSource;
}

interface Outcome {
  kind: EstateBackupCommandBody["kind"];
  command: EstateCommandResource;
  result?: unknown;
}

const BackupPanel = ({ source }: BackupPanelProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const [listed, setListed] = useState<EstateBackupsListResult | undefined>();
  const [tag, setTag] = useState("");
  const [policyDraft, setPolicyDraft] = useState("");
  const [policyError, setPolicyError] = useState<string | undefined>();
  const [restoreKey, setRestoreKey] = useState("");
  const [restoreAt, setRestoreAt] = useState("");
  const [restoreFrom, setRestoreFrom] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [dryRunFor, setDryRunFor] = useState<string | undefined>();

  // What a restore aims at. A dry run unlocks the real one only for this
  // exact point, so changing any of the three asks for a new dry run.
  const point = {
    ...(restoreKey ? { key: restoreKey } : {}),
    ...(!restoreKey && restoreAt.trim() ? { at: restoreAt.trim() } : {}),
    ...(source.canRestoreFrom && restoreFrom.trim()
      ? { from: restoreFrom.trim() }
      : {}),
  };
  const pointId = JSON.stringify(point);

  const action = useAction<[EstateBackupCommandBody], Outcome | undefined>(
    {
      handler: async ({ signal }, body) => {
        setOutcome(undefined);
        let command = await source.send(body);
        setOutcome({ kind: body.kind, command });

        // Followed rather than assumed: the machine acks over its own
        // connection. Long verbs (a backup, a restore) can outlast this
        // window, and the events timeline is where their outcome lands then.
        for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
          if (command.status === "done" || command.status === "failed") break;
          await sleep(POLL_MS);
          if (signal.aborted) return undefined;
          command = (await source.poll(command.id)) ?? command;
          setOutcome({ kind: body.kind, command });
        }

        let result: unknown;
        if (RESULT_KINDS.has(body.kind)) {
          // Uploaded beside the ack, sometimes just after it. A failed verify
          // uploads too, so it is read whatever the status.
          for (let attempt = 0; attempt < RESULT_ATTEMPTS; attempt += 1) {
            result = await source.result(command.id);
            if (result !== undefined || signal.aborted) break;
            if (command.status !== "done" && body.kind !== "backup-verify") {
              break;
            }
            await sleep(POLL_MS);
          }
        }

        const done = { kind: body.kind, command, result };
        setOutcome(done);
        if (body.kind === "backups-list" && result) {
          setListed(result as EstateBackupsListResult);
        }
        if (body.kind === "restore" && body.dryRun) {
          setDryRunFor(command.status === "done" ? pointId : undefined);
        }
        if (body.kind === "restore" && !body.dryRun) {
          setDryRunFor(undefined);
          setRestoreConfirm("");
        }
        source.reload();
        return done;
      },
    },
    [source, pointId],
  );

  const busy = action.loading;
  const run = (body: EstateBackupCommandBody) => void action.run(body);
  const backup = source.backup;
  const writable = source.canManage && source.online;
  const confirmed = restoreConfirm.trim() === source.appLabel;
  const reason = restoreReason.trim();

  const applyPolicy = (clear: boolean) => {
    setPolicyError(undefined);
    if (clear) {
      run({ kind: "backup-policy", policy: null });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(policyDraft);
    } catch {
      setPolicyError(tr("backup.policy.invalidJson"));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setPolicyError(tr("backup.policy.notObject"));
      return;
    }
    run({
      kind: "backup-policy",
      policy: parsed as Record<string, unknown>,
    });
  };

  const restore = (dryRun: boolean) =>
    run({
      kind: "restore",
      ...point,
      ...(dryRun ? { dryRun: true } : { reason }),
    });

  return (
    <div className="flex flex-col gap-4" data-testid="backup-panel">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              {tr("backup.title")}
              {backup && <BackupStateBadge state={backup.state} />}
            </CardTitle>
            <CardDescription>{tr("backup.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {!source.online && (
            <p className="text-muted-foreground">{tr("backup.offline")}</p>
          )}
          {!backup ? (
            <p className="text-muted-foreground" data-testid="backup-notice">
              {source.notice ?? tr("backup.notReported")}
            </p>
          ) : (
            <>
              {backup.restorePending && (
                <p className="text-danger font-medium">
                  {tr("backup.restorePending", {
                    args: [l(backup.restorePending.since, { date: "fromNow" })],
                  })}
                  {backup.restorePending.reason
                    ? ` ${backup.restorePending.reason}`
                    : ""}
                </p>
              )}
              {backup.failure && (
                <p className="text-danger">
                  {tr("backup.failure", {
                    args: [
                      String(backup.failure.consecutive),
                      l(backup.failure.at, { date: "fromNow" }),
                    ],
                  })}{" "}
                  <span className="font-mono text-xs">
                    {backup.failure.stage ? `[${backup.failure.stage}] ` : ""}
                    {backup.failure.message}
                  </span>
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <Fact
                  label={tr("backup.fact.last")}
                  value={
                    backup.last
                      ? l(backup.last.at, { date: "fromNow" })
                      : undefined
                  }
                />
                <Fact
                  label={tr("backup.fact.next")}
                  value={
                    backup.nextAt
                      ? l(backup.nextAt, { date: "fromNow" })
                      : undefined
                  }
                />
                <Fact
                  label={tr("backup.fact.size")}
                  value={
                    backup.last?.storedBytes === undefined
                      ? undefined
                      : formatBytes(backup.last.storedBytes)
                  }
                />
                <Fact
                  label={tr("backup.fact.duration")}
                  value={
                    backup.last?.durationMs === undefined
                      ? undefined
                      : `${(backup.last.durationMs / 1000).toFixed(1)}s`
                  }
                />
                <Fact
                  label={tr("backup.fact.target")}
                  value={backup.target?.status}
                />
                <Fact
                  label={tr("backup.fact.bucket")}
                  value={backup.target?.bucket}
                />
                <Fact
                  label={tr("backup.fact.points")}
                  value={
                    backup.catalog
                      ? `${backup.catalog.count} · ${formatBytes(backup.catalog.totalBytes)}`
                      : undefined
                  }
                />
                <Fact
                  label={tr("backup.fact.verify")}
                  value={
                    backup.verify
                      ? `${backup.verify.ok ? tr("backup.verify.ok") : tr("backup.verify.failed")} · ${l(backup.verify.at, { date: "fromNow" })}`
                      : undefined
                  }
                />
              </dl>

              {backup.policy && (
                <p className="text-muted-foreground">
                  {backup.policy.enabled
                    ? tr("backup.policy.summary", {
                        args: [backup.policy.schedule, backup.policy.retention],
                      })
                    : tr("backup.policy.disabled")}
                  {backup.policy.onDeploy
                    ? ` ${tr("backup.policy.onDeploy")}`
                    : ""}
                </p>
              )}
              {backup.target?.lastError && (
                <p className="text-muted-foreground font-mono text-xs">
                  {backup.target.lastError}
                </p>
              )}
              {backup.verify?.error && (
                <p className="text-muted-foreground font-mono text-xs">
                  {backup.verify.error}
                </p>
              )}
              {backup.restore && (
                <p className="text-muted-foreground">
                  {tr("backup.lastRestore", {
                    args: [
                      backup.restore.status,
                      l(backup.restore.at, { date: "fromNow" }),
                    ],
                  })}
                  {backup.restore.reason ? ` ${backup.restore.reason}` : ""}
                  {backup.restore.error ? ` ${backup.restore.error}` : ""}
                </p>
              )}
              {backup.notCovered?.length ? (
                <p className="text-muted-foreground">
                  {tr("backup.notCovered", {
                    args: [backup.notCovered.join(", ")],
                  })}
                </p>
              ) : null}
              {backup.last?.anomalies?.length ? (
                <ul className="text-muted-foreground flex flex-col gap-1 font-mono text-xs">
                  {backup.last.anomalies.map((anomaly) => (
                    <li key={anomaly}>{anomaly}</li>
                  ))}
                </ul>
              ) : null}

              {backup.last?.databases?.length ? (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="py-1 font-normal">
                        {tr("backup.db.path")}
                      </th>
                      <th className="py-1 font-normal">
                        {tr("backup.db.size")}
                      </th>
                      <th className="py-1 font-normal">
                        {tr("backup.db.tables")}
                      </th>
                      <th className="py-1 font-normal">
                        {tr("backup.db.integrity")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {backup.last.databases.map((db) => (
                      <tr key={db.path} className="border-t">
                        <td className="py-1 font-mono">{db.path}</td>
                        <td className="py-1 tabular-nums">
                          {formatBytes(db.rawBytes)}
                        </td>
                        <td className="py-1 tabular-nums">{db.tables}</td>
                        <td className="py-1">{db.integrity ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <h3 className="font-semibold">{tr("backup.actions")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-48"
              placeholder={tr("backup.tag.placeholder")}
              value={tag}
              maxLength={100}
              onChange={(event) => setTag(event.target.value)}
              disabled={!writable || busy}
              data-testid="backup-tag"
            />
            <Button
              variant="solid"
              size="sm"
              disabled={!writable || busy}
              onClick={() =>
                run({
                  kind: "backup",
                  ...(tag.trim() ? { tag: tag.trim() } : {}),
                })
              }
              data-testid="backup-now"
            >
              <DatabaseBackup className="size-4" aria-hidden />
              {tr("backup.now")}
            </Button>
            <Button
              variant="outlined"
              size="sm"
              disabled={!writable || busy}
              onClick={() => run({ kind: "backups-list" })}
              data-testid="backup-list"
            >
              <ListOrdered className="size-4" aria-hidden />
              {tr("backup.list")}
            </Button>
            <Button
              variant="outlined"
              size="sm"
              disabled={!writable || busy}
              onClick={() =>
                run({
                  kind: "backup-verify",
                  ...(restoreKey ? { key: restoreKey } : {}),
                })
              }
              data-testid="backup-verify"
            >
              <ShieldCheck className="size-4" aria-hidden />
              {restoreKey ? tr("backup.verifyChosen") : tr("backup.verify")}
            </Button>
            <Button
              variant="outlined"
              size="sm"
              disabled={!writable || busy}
              onClick={() => run({ kind: "target-probe" })}
              data-testid="backup-probe"
            >
              <Radar className="size-4" aria-hidden />
              {tr("backup.probe")}
            </Button>
          </div>

          {outcome && <CommandOutcome outcome={outcome} busy={busy} tr={tr} />}

          {listed && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground">
                {tr("backup.listed", {
                  args: [
                    String(listed.catalog.count),
                    formatBytes(listed.catalog.totalBytes),
                  ],
                })}
                {listed.truncated
                  ? ` ${tr("backup.truncated", { args: [String(listed.truncated)] })}`
                  : ""}
              </p>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs" data-testid="backup-points">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="py-1 font-normal">
                        {tr("backup.point.at")}
                      </th>
                      <th className="py-1 font-normal">
                        {tr("backup.point.kind")}
                      </th>
                      <th className="py-1 font-normal">
                        {tr("backup.point.size")}
                      </th>
                      <th className="py-1 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {listed.backups.map((item) => (
                      <tr
                        key={item.key}
                        className={
                          item.key === restoreKey
                            ? "bg-muted border-t"
                            : "border-t"
                        }
                      >
                        <td className="py-1" title={item.key}>
                          {l(item.at, { date: "fromNow" })}
                          {item.tag ? (
                            <Badge variant="outline" className="ml-2">
                              {item.tag}
                            </Badge>
                          ) : null}
                        </td>
                        <td className="py-1">{item.kind ?? "-"}</td>
                        <td className="py-1 tabular-nums">
                          {formatBytes(item.bytes)}
                        </td>
                        <td className="py-1 text-right">
                          <Button
                            variant="minimal"
                            size="sm"
                            onClick={() =>
                              setRestoreKey(
                                item.key === restoreKey ? "" : item.key,
                              )
                            }
                            data-testid="backup-point-choose"
                          >
                            {item.key === restoreKey
                              ? tr("backup.point.chosen")
                              : tr("backup.point.choose")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {source.canManage && source.canEditPolicy && (
        <Card>
          <CardContent className="flex flex-col gap-3 text-sm">
            <h3 className="font-semibold">{tr("backup.policy.title")}</h3>
            <p className="text-muted-foreground">{tr("backup.policy.help")}</p>
            <Textarea
              className="min-h-28 font-mono text-xs"
              placeholder={POLICY_EXAMPLE}
              value={policyDraft}
              onChange={(event) => setPolicyDraft(event.target.value)}
              disabled={!writable || busy}
              data-testid="backup-policy-draft"
            />
            {policyError && <p className="text-danger">{policyError}</p>}
            {!source.deployAllowed && (
              <p className="text-muted-foreground">
                {tr("backup.deployRefused")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="solid"
                size="sm"
                disabled={
                  !writable ||
                  busy ||
                  !source.deployAllowed ||
                  !policyDraft.trim()
                }
                onClick={() => applyPolicy(false)}
                data-testid="backup-policy-apply"
              >
                {tr("backup.policy.apply")}
              </Button>
              <Button
                variant="outlined"
                size="sm"
                disabled={!writable || busy || !source.deployAllowed}
                onClick={() => applyPolicy(true)}
                data-testid="backup-policy-clear"
              >
                {tr("backup.policy.clear")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {source.canManage && (
        <Card>
          <CardContent className="flex flex-col gap-3 text-sm">
            <h3 className="font-semibold">{tr("backup.restore.title")}</h3>
            <p className="text-muted-foreground">
              {restoreKey
                ? tr("backup.restore.point", { args: [restoreKey] })
                : tr("backup.restore.latest")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={tr("backup.restore.at")}
                value={restoreAt}
                maxLength={40}
                onChange={(event) => setRestoreAt(event.target.value)}
                disabled={!writable || busy || !!restoreKey}
                data-testid="backup-restore-at"
              />
              {source.canRestoreFrom && (
                <Input
                  placeholder={tr("backup.restore.from")}
                  value={restoreFrom}
                  maxLength={200}
                  onChange={(event) => setRestoreFrom(event.target.value)}
                  disabled={!writable || busy}
                  data-testid="backup-restore-from"
                />
              )}
            </div>
            <Input
              placeholder={tr("backup.restore.reason")}
              value={restoreReason}
              maxLength={500}
              onChange={(event) => setRestoreReason(event.target.value)}
              disabled={!writable || busy}
              data-testid="backup-restore-reason"
            />
            <Input
              placeholder={tr("backup.restore.confirm", {
                args: [source.appLabel],
              })}
              value={restoreConfirm}
              onChange={(event) => setRestoreConfirm(event.target.value)}
              disabled={!writable || busy}
              data-testid="backup-restore-confirm"
            />
            {dryRunFor !== pointId && (
              <p className="text-muted-foreground">
                {tr("backup.restore.dryRunFirst")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outlined"
                size="sm"
                disabled={!writable || busy}
                onClick={() => restore(true)}
                data-testid="backup-restore-dry"
              >
                <History className="size-4" aria-hidden />
                {tr("backup.restore.dryRun")}
              </Button>
              <Button
                variant="solid"
                intent="danger"
                size="sm"
                // A dry run of this very point first, a reason Bay records,
                // and the machine name typed back: three deliberate steps
                // before the one write that replaces live data.
                disabled={
                  !writable ||
                  busy ||
                  !source.deployAllowed ||
                  !reason ||
                  !confirmed ||
                  dryRunFor !== pointId
                }
                onClick={() => restore(false)}
                data-testid="backup-restore-run"
              >
                <RotateCcw className="size-4" aria-hidden />
                {tr("backup.restore.run")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <h3 className="font-semibold">{tr("backup.events")}</h3>
          {source.events.length === 0 ? (
            <p className="text-muted-foreground">{tr("backup.noEvents")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="backup-events">
              {source.events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-x-3">
                  <span className="text-muted-foreground w-28 shrink-0 tabular-nums">
                    {l(event.at, { date: "fromNow" })}
                  </span>
                  <Badge variant={eventVariant(event.kind)}>{event.kind}</Badge>
                  <span className="text-muted-foreground font-mono text-xs">
                    {eventSummary(event)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BackupPanel;

export const BackupStateBadge = ({ state }: { state: string }) => {
  const { tr } = useI18n<I18n, "en">();
  const variant =
    state === "ok"
      ? "secondary"
      : state === "failing" || state === "restore-pending"
        ? "destructive"
        : "outline";
  const key = STATE_LABELS[state];
  return <Badge variant={variant}>{key ? tr(key) : state}</Badge>;
};

const CommandOutcome = (props: { outcome: Outcome; busy: boolean; tr: Tr }) => {
  const { outcome, tr } = props;
  const { command } = outcome;
  const status =
    command.status === "done"
      ? tr("backup.command.done")
      : command.status === "failed"
        ? tr("backup.command.failed")
        : props.busy
          ? tr("backup.command.waiting")
          : tr("backup.command.later");
  return (
    <div className="flex flex-col gap-1" data-testid="backup-outcome">
      <p>
        <span className="font-medium">{outcome.kind}</span>
        {" · "}
        {status}
      </p>
      {/* Bay's own sentence, untranslated, so this screen and the box read
          the same. */}
      {command.reason && (
        <p className="text-muted-foreground font-mono text-xs">
          {command.reason}
        </p>
      )}
      {outcome.result !== undefined && outcome.kind !== "backups-list" && (
        <pre className="bg-muted max-h-64 overflow-auto rounded p-2 text-xs">
          {JSON.stringify(outcome.result, null, 2)}
        </pre>
      )}
    </div>
  );
};

interface FactProps {
  label: string;
  value?: string;
}

const Fact = (props: FactProps) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-muted-foreground text-xs">{props.label}</dt>
    <dd
      className={
        props.value ? "font-medium tabular-nums" : "text-muted-foreground"
      }
    >
      {props.value ?? "-"}
    </dd>
  </div>
);

const eventVariant = (kind: string) =>
  kind.endsWith(".failed") || kind === "target.down" || kind.endsWith("anomaly")
    ? "destructive"
    : kind.endsWith(".pending")
      ? "outline"
      : "secondary";

/** The one line worth showing from an event's data, Bay's words verbatim. */
export const eventSummary = (event: Pick<EstateEvent, "data">) => {
  const data = event.data ?? {};
  for (const name of ["error", "message", "reason", "key", "policy"]) {
    const value = data[name];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const STATE_LABELS: Record<string, TrKey> = {
  ok: "backup.state.ok",
  stale: "backup.state.stale",
  failing: "backup.state.failing",
  never: "backup.state.never",
  off: "backup.state.off",
  unconfigured: "backup.state.unconfigured",
  "restore-pending": "backup.state.restorePending",
};

const RESULT_KINDS = new Set<EstateBackupCommandBody["kind"]>([
  "backups-list",
  "backup-verify",
  "target-probe",
  "restore",
]);

const POLICY_EXAMPLE = `{
  "schedule": { "every": "6h", "timezone": "Europe/Paris" },
  "retention": { "hourly": 24, "daily": 7, "weekly": 4, "monthly": 6 },
  "verify": { "every": "24h" }
}`;

/** The gap between two reads of the command. */
const POLL_MS = 2000;
/** ~2 minutes; a longer backup lands in the events timeline instead. */
const ATTEMPTS = 60;
const RESULT_ATTEMPTS = 5;
