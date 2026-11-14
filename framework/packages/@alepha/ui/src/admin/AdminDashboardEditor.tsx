import type { AdminDashboardLayoutController } from "alepha/api/parameters";
import { ActionErrorPolicy, useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { Users } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { reorderKeys } from "../table/reorderKeys.ts";
import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";
import { AdminDashboardEditCell } from "./AdminDashboardEditCell.tsx";
import {
  type AdminDashboardLayoutEntry,
  type AdminDashboardLayoutTile,
  adminDashboardLayoutEntries,
  adminDashboardLayoutOf,
} from "./adminDashboardLayout.ts";
import { AdminDashboardTilePicker } from "./AdminDashboardTilePicker.tsx";

export interface AdminDashboardEditorProps {
  /**
   * The catalog.
   */
  cards: AdminDashboardCard[];
  /**
   * The stored layout the edit starts from.
   */
  layout?: { tiles: AdminDashboardLayoutTile[] };
  /**
   * Its version, sent back with the save: another admin's save in between
   * makes this one a 409, never a silent overwrite.
   */
  version: number;
  /**
   * Leave Customize mode: after a save (the page loader has run again), on
   * Cancel, or after reloading another admin's layout.
   */
  onClose: () => void;
}

/**
 * The admin dashboard in Customize mode: the grid with its edit controls,
 * the "Add a tile" picker, and Save, Cancel and Reset to defaults.
 *
 * The draft is every catalog tile with its flag, in order
 * (`adminDashboardLayoutEntries`), and Save writes it whole, so a tile this
 * admin cannot see keeps its place and its flag. After a save the page's
 * loader runs again (`router.invalidate()`), so the grid shows what is
 * stored, not what this tab believes.
 */
export const AdminDashboardEditor = (props: AdminDashboardEditorProps) => {
  const { tr } = useI18n();
  const dialog = useDialog();
  const router = useRouter<any>();
  const api = useClient<AdminDashboardLayoutController>();
  const [draft, setDraft] = useState<AdminDashboardLayoutEntry[]>(() =>
    adminDashboardLayoutEntries(props.cards, props.layout?.tiles),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const titleOf = (card: AdminDashboardCard) =>
    card.titleKey ? tr(card.titleKey, { default: card.title }) : card.title;
  const descriptionOf = (card: AdminDashboardCard) =>
    card.descriptionKey
      ? tr(card.descriptionKey, { default: card.description ?? "" })
      : card.description;
  const available = (card: AdminDashboardCard) =>
    card.can ? card.can() : true;

  const shown = draft.filter((entry) => entry.enabled && available(entry.card));
  const hidden = draft.filter(
    (entry) => !entry.enabled || !available(entry.card),
  );

  const save = useAction(
    {
      handler: async (_ctx, tiles: AdminDashboardLayoutTile[]) => {
        try {
          await api.setAdminDashboardLayout({
            body: { layout: { tiles }, expectedVersion: props.version },
          });
        } catch (error) {
          // Shown here, as the notice below, not as a toast: the admin has a
          // choice to make. Every other failure is the toaster's.
          if (error instanceof HttpError && error.status === 409) {
            ActionErrorPolicy.markShownInPlace(error);
            setConflict(true);
          }
          throw error;
        }
        await router.invalidate();
      },
    },
    [api, props.version, router],
  );

  const reload = useAction(
    {
      handler: async () => {
        await router.invalidate();
      },
    },
    [router],
  );

  /**
   * Drop `id` onto `target`'s slot, across the whole draft: the grid shows
   * only part of it, and a hidden tile keeps its place between the two.
   * `subject` is the tile the reader moved, which the live region names.
   */
  const move = (id: string, target: string, subject = id) => {
    const byId = new Map(draft.map((entry) => [entry.card.id, entry]));
    const next = reorderKeys(
      draft.map((entry) => entry.card.id),
      id,
      target,
    ).map((key) => byId.get(key)!);
    setDraft(next);
    const visible = next.filter(
      (entry) => entry.enabled && available(entry.card),
    );
    const position = visible.findIndex((entry) => entry.card.id === subject);
    const card = byId.get(subject)?.card;
    if (card && position >= 0) {
      setAnnouncement(
        tr("admin.dashboard.moved", {
          default: "$1 moved to position $2 of $3",
          args: [titleOf(card), String(position + 1), String(visible.length)],
        }),
      );
    }
  };

  const setEnabled = (id: string, enabled: boolean) =>
    setDraft((entries) => {
      const entry = entries.find((it) => it.card.id === id);
      if (!entry) {
        return entries;
      }
      const rest = entries.filter((it) => it.card.id !== id);
      // An added tile lands at the end of the grid, a removed one stays put
      // in the order (its place returns if it comes back on another day).
      return enabled
        ? [...rest, { ...entry, enabled }]
        : entries.map((it) => (it.card.id === id ? { ...it, enabled } : it));
    });

  const busy = save.loading || reload.loading;

  const onSave = async () => {
    if ((await save.run(adminDashboardLayoutOf(draft).tiles)).ok) {
      props.onClose();
    }
  };

  const onReset = async () => {
    const confirmed = await dialog.confirm({
      title: tr("admin.dashboard.resetTitle", {
        default: "Reset the dashboard?",
      }),
      description: tr("admin.dashboard.resetDescription", {
        default:
          "Every admin will see the default tiles, in the default order.",
      }),
      confirmLabel: tr("admin.dashboard.reset", {
        default: "Reset to defaults",
      }),
      destructive: true,
    });
    if (confirmed && (await save.run([])).ok) {
      props.onClose();
    }
  };

  const onReload = async () => {
    if ((await reload.run()).ok) {
      setConflict(false);
      props.onClose();
    }
  };

  return (
    <div className="flex flex-col gap-4" data-slot="dashboard-editor">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground flex flex-1 items-center gap-2 text-sm">
          <Users className="size-4" aria-hidden />
          {tr("admin.dashboard.sharedNotice", {
            default: "Changes apply to every admin.",
          })}
        </p>
        <Button
          type="button"
          variant="outlined"
          disabled={busy}
          onClick={() => onReset()}
        >
          {tr("admin.dashboard.reset", { default: "Reset to defaults" })}
        </Button>
        <Button
          type="button"
          variant="outlined"
          disabled={busy}
          onClick={() => props.onClose()}
        >
          {tr("admin.dashboard.cancel", { default: "Cancel" })}
        </Button>
        <Button
          type="button"
          loading={save.loading}
          disabled={busy || conflict}
          onClick={() => onSave()}
        >
          {tr("admin.dashboard.save", { default: "Save" })}
        </Button>
      </div>

      {conflict ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>
            {tr("admin.dashboard.conflictTitle", {
              default: "Another admin saved the layout meanwhile",
            })}
          </AlertTitle>
          <AlertDescription>
            {tr("admin.dashboard.conflictDescription", {
              default:
                "Your changes were not saved, so as not to overwrite theirs. Load their layout, then customize again.",
            })}
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="sm"
              variant="outlined"
              loading={reload.loading}
              onClick={() => onReload()}
            >
              {tr("admin.dashboard.loadTheirs", {
                default: "Load their layout",
              })}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((entry, index) => {
          const id = entry.card.id;
          return (
            <AdminDashboardEditCell
              key={id}
              title={titleOf(entry.card)}
              first={index === 0}
              last={index === shown.length - 1}
              dragging={dragging === id}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => setDragging(null)}
              onDrop={() => {
                if (dragging && dragging !== id) {
                  move(dragging, id);
                }
                setDragging(null);
              }}
              onMoveEarlier={() => move(id, shown[index - 1]!.card.id)}
              onMoveLater={() => move(shown[index + 1]!.card.id, id, id)}
              onRemove={() => setEnabled(id, false)}
            >
              {entry.card.render()}
            </AdminDashboardEditCell>
          );
        })}
      </div>

      <AdminDashboardTilePicker
        disabled={busy}
        items={hidden.map((entry) => ({
          id: entry.card.id,
          title: titleOf(entry.card),
          description: descriptionOf(entry.card),
          unavailable: !available(entry.card),
        }))}
        onAdd={(id) => setEnabled(id, true)}
      />

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
};
