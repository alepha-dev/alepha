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
import type { AdminProjectController } from "@lore/core/api";
import type { AdminEstateController } from "@lore/deploy/api";
import type { AdminEstateResource } from "@lore/deploy/schemas";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useState } from "react";

import { adminEstateAssignFormSchema } from "./adminEstateAssignFormSchema.ts";

export interface AdminEstateAssignDialogProps {
  estate: AdminEstateResource | undefined;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

/**
 * Give an estate a home project (#Q3280, #Q3281): the step an estate the
 * migration could not place needs, normally to the project it is lent to.
 * The projects it is lent to come first, the one of its oldest loan
 * preselected for an estate with no home; the dialog says what assigning
 * does, and shows a refusal (Apps off, a slug already used) in place.
 *
 * Literal English, like the rest of the Lore admin.
 */
const AdminEstateAssignDialog = (props: AdminEstateAssignDialogProps) => {
  const estate = props.estate;
  const toaster = useToast();
  const admin = useClient<AdminEstateController>();
  const projectsApi = useClient<AdminProjectController>();
  const [error, setError] = useState<string | undefined>();

  const others =
    useQuery(
      {
        enabled: !!estate,
        handler: () =>
          projectsApi.findProjects({ query: { page: 0, size: 100 } }),
      },
      [projectsApi, !!estate],
    ).data?.content ?? [];

  const loans = estate?.loans ?? [];
  const loanIds = new Set(loans.map((loan) => loan.id));
  const items = [
    ...loans.map((loan) => ({
      value: String(loan.id),
      label: `${loan.title} (lent to)`,
    })),
    ...others
      .filter(
        (project) =>
          !loanIds.has(project.id) && project.id !== estate?.project?.id,
      )
      .map((project) => ({ value: String(project.id), label: project.title })),
  ];

  // The oldest loan, for an estate with no home: where it is normally
  // assigned.
  const [initialValues] = useState(() => ({
    projectId: estate && !estate.project && loans[0] ? String(loans[0].id) : "",
  }));
  const form = useForm({
    schema: adminEstateAssignFormSchema,
    initialValues,
    handler: () => undefined,
  });
  const values = useFormValues(form);
  const projectId = Number(values.projectId) || undefined;

  const assign = useAction<[], void>(
    {
      handler: async () => {
        if (!estate || projectId === undefined) return;
        setError(undefined);
        const result = await admin.assignEstate({
          params: { id: estate.id },
          body: { projectId },
        });
        toaster.success(
          `"${estate.slug}" now belongs to ${result.project.title}`,
        );
        props.onAssigned();
        props.onOpenChange(false);
      },
      onError: (caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
    },
    [admin, estate, projectId],
  );

  return (
    <Dialog
      open={!!estate}
      onOpenChange={(next) => {
        if (assign.loading) return;
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="admin-estate-assign">
        <DialogHeader>
          <DialogTitle>Assign {estate?.slug} to a project</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Control
            select
            input={form.input.projectId}
            label="Project"
            disabled={assign.loading}
            items={items}
            inputProps={{ "data-testid": "admin-estate-assign-project" }}
          />
          <p className="text-muted-foreground text-xs">
            That project's owner will manage the estate, and its members by
            their rank. Its loans do not change: the projects it is lent to keep
            deploying there.
          </p>
          {error && (
            <p
              className="text-destructive text-sm"
              data-testid="admin-estate-assign-error"
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
            data-testid="admin-estate-assign-submit"
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminEstateAssignDialog;
