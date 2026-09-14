import { Badge, useToast } from "@alepha/ui";
import { AlephaTable, type AlephaTableFilterFields } from "@alepha/ui/table";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EstateCommandController } from "@/api/controllers/EstateCommandController.ts";
import { ESTATE_COMMAND_KINDS } from "@/api/entities/estateCommands.ts";
import { ESTATE_COMMAND_STATUSES } from "@/api/entities/estateCommands.ts";
import type { EstateCommandListItem } from "@/api/schemas/estateCommandResourceSchema.ts";
import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface BayCommandsProps {
  /**
   * Which estate's queue. Passed by the drawer, which still renders this
   * while it exists; the page reads the open estate from the atom instead.
   */
  estateId?: string;
}

/**
 * What has been asked of this machine, and what became of it.
 *
 * States are the row's own (`pending`, `sent`, `running`, `done`, `failed`),
 * as `EstateCommandService` records them; nothing here asks a socket.
 *
 * ⚠️ **A stuck command has to stay visible, and the three ways it sticks are
 * three different sentences.** The interesting failure is not a rejected
 * command, it is a machine that took work and never came back. The sweep
 * writes the distinction into `reason` - never acknowledged, timed out, never
 * came to fetch it - and this page shows those words rather than a generic
 * "failed".
 *
 * ⚠️ **`deploy` rows are listed and never started here.** Epic #E1 owns
 * deploying; a Deploy button on this page would be that epic leaking into this
 * one.
 *
 * ⚠️ **Never sort by the status enum in SQL.** It sorts the label. The filters
 * below are client-side over the retained history, which is a couple of
 * hundred rows at most.
 */
const BayCommands = (props: BayCommandsProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<EstateCommandController>();
  const [openEstate] = useStore(currentEstateAtom);
  const estateId = props.estateId ?? openEstate?.id;

  const { data } = useQuery(
    {
      enabled: Boolean(estateId),
      key: ["bay-commands", estateId],
      keepPreviousData: true,
      handler: async () => {
        if (!estateId) {
          return undefined;
        }
        try {
          // The whole retained history in one read, bounded server-side by
          // the same cap the sweep enforces, so the filters can be in memory.
          return await api.listEstateCommands({
            params: { estateId },
            query: {},
          });
        } catch (error) {
          toaster.error(error instanceof Error ? error.message : String(error));
          return undefined;
        }
      },
    },
    [estateId],
  );

  if (!estateId) {
    return null;
  }
  const items = data?.items ?? [];

  /**
   * Both optional, and no search box. The empty trigger reads the filter's
   * name, and a set one names it before the value, so no label sits above
   * either.
   */
  const filterFields = {
    kind: {
      schema: z.enum(ESTATE_COMMAND_KINDS),
      label: tr("bay.commands.filter.kind"),
      placeholder: tr("bay.commands.filter.kind"),
    },
    status: {
      schema: z.enum(ESTATE_COMMAND_STATUSES),
      label: tr("bay.commands.filter.status"),
      placeholder: tr("bay.commands.filter.status"),
    },
  } satisfies AlephaTableFilterFields;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AlephaTable<EstateCommandListItem, typeof filterFields>
        className="min-h-0 flex-1"
        data={items}
        emptyState={{
          title: tr("bay.commands.empty"),
          description: tr("bay.commands.empty.description"),
        }}
        noMatchState={{
          title: tr("bay.commands.noMatch"),
          description: tr("bay.commands.noMatch.description"),
        }}
        filters={{ fields: filterFields }}
        filter={(command, values) => {
          return (
            (!values.kind || command.kind === values.kind) &&
            (!values.status || command.status === values.status)
          );
        }}
        columns={{
          createdAt: {
            label: tr("bay.commands.col.when"),
            sortable: true,
            cell: (command) => (
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {l(command.createdAt, { date: "lll" })}
              </span>
            ),
          },
          kind: {
            label: tr("bay.commands.col.kind"),
            sortable: true,
            cell: (command) => (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{command.kind}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {`${command.payload.app}/${command.payload.environment}`}
                </span>
              </span>
            ),
          },
          status: {
            label: tr("bay.commands.col.status"),
            // ⚠️ A text enum: sorting it sorts the label.
            sortable: false,
            cell: (command) => (
              <span className="flex items-center gap-1.5">
                <Badge
                  variant={
                    command.status === "failed"
                      ? "destructive"
                      : command.status === "done"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {command.status}
                </Badge>
                {/* The step a running deploy reports: downloading, verifying,
                    deploying. Absent for everything else. */}
                {command.step && (
                  <span className="text-muted-foreground text-xs">
                    {command.step}
                  </span>
                )}
              </span>
            ),
          },
          requestedByName: {
            label: tr("bay.commands.col.by"),
            sortable: true,
            cell: (command) => (
              <span className="text-muted-foreground truncate text-xs">
                {command.requestedByName ?? tr("bay.commands.byNobody")}
              </span>
            ),
          },
          reason: {
            label: tr("bay.commands.col.reason"),
            sortable: false,
            cell: (command) => (
              <span className="flex min-w-0 flex-col gap-1">
                {/* In full, not truncated: the sweep's three sentences and
                    the machine's own refusal are the whole value of the
                    column. */}
                {command.reason && (
                  <span className="text-muted-foreground font-mono text-xs">
                    {command.reason}
                  </span>
                )}
                {command.kind === "logs" && command.resultFileId && (
                  <a
                    className="text-xs underline-offset-4 hover:underline"
                    href={`/api/estates/${estateId}/commands/${command.id}/result`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("bay.commands.result")}
                  </a>
                )}
              </span>
            ),
          },
        }}
      />
    </div>
  );
};

export default BayCommands;
