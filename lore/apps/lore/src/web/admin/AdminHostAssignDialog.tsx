import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type {
  AdminProjectController,
  AdminHostController,
} from "@lore/core/api";
import type { AdminHostResource } from "@lore/core/schemas";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useState } from "react";

import { adminHostAssignFormSchema } from "./adminHostAssignFormSchema.ts";

export interface AdminHostAssignDialogProps {
  host: AdminHostResource | undefined;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

/**
 * Move a host to another home project (#Q3280, #Q3281), normally to a
 * project it is lent to. The projects it is lent to come first, the one of
 * its oldest loan preselected; the dialog says what assigning does, and
 * shows a refusal (Apps off, a slug already used) in place.
 *
 * Literal English, like the rest of the Lore admin.
 */
const AdminHostAssignDialog = (props: AdminHostAssignDialogProps) => {
  const host = props.host;
  const toaster = useToast();
  const admin = useClient<AdminHostController>();
  const projectsApi = useClient<AdminProjectController>();
  const [error, setError] = useState<string | undefined>();

  const others =
    useQuery(
      {
        enabled: !!host,
        handler: () =>
          projectsApi.findProjects({ query: { page: 0, size: 100 } }),
      },
      [projectsApi, !!host],
    ).data?.content ?? [];

  const loans = host?.loans ?? [];
  const loanIds = new Set(loans.map((loan) => loan.id));
  const items = [
    ...loans.map((loan) => ({
      value: String(loan.id),
      label: `${loan.title} (lent to)`,
    })),
    ...others
      .filter(
        (project) =>
          !loanIds.has(project.id) && project.id !== host?.project?.id,
      )
      .map((project) => ({ value: String(project.id), label: project.title })),
  ];

  // The oldest loan, for a host with no home: where it is normally
  // assigned.
  const [initialValues] = useState(() => ({
    // The oldest loan that is not already its home (#Q3627: every host has
    // one, so this is always a move).
    projectId: String(
      loans.find((loan) => loan.id !== host?.project?.id)?.id ?? "",
    ),
  }));
  const form = useForm({
    schema: adminHostAssignFormSchema,
    initialValues,
    handler: () => undefined,
  });
  const values = useFormValues(form);
  const projectId = Number(values.projectId) || undefined;

  const assign = useAction<[], void>(
    {
      handler: async () => {
        if (!host || projectId === undefined) return;
        setError(undefined);
        const result = await admin.assignHost({
          params: { id: host.id },
          body: { projectId },
        });
        toaster.success(
          `"${host.slug}" now belongs to ${result.project.title}`,
        );
        props.onAssigned();
        props.onOpenChange(false);
      },
      onError: (caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
    },
    [admin, host, projectId],
  );

  return (
    <Dialog
      open={!!host}
      onOpenChange={(next) => {
        if (assign.loading) return;
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="admin-host-assign">
        <DialogHeader>
          <DialogTitle>Assign {host?.slug} to a project</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Control
            select
            input={form.input.projectId}
            label="Project"
            disabled={assign.loading}
            items={items}
            inputProps={{ "data-testid": "admin-host-assign-project" }}
          />
          <p className="text-muted-foreground text-xs">
            That project's owner will manage the host, and its members by their
            rank. Its loans do not change: the projects it is lent to keep
            deploying there.
          </p>
          {error && (
            <p
              className="text-destructive text-sm"
              data-testid="admin-host-assign-error"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="solid"
            intent="none"
            disabled={assign.loading}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={projectId === undefined || assign.loading}
            onClick={() => void assign.run()}
            data-testid="admin-host-assign-submit"
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminHostAssignDialog;
