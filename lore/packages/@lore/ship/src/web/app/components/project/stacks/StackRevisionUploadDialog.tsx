import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useClient, useQueryClient } from "alepha/react";
import { useActionForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";
import { uploadStackRevisionBodySchema } from "../../../../../api/schemas/uploadStackRevisionBodySchema.ts";

export interface StackRevisionUploadDialogProps {
  onOpenChange: (open: boolean) => void;
  projectId: number;
  stackId: string;
  stackName: string;
}

/**
 * Uploads a revision, in a dialog opened from the stack's row menu
 * (#Q4320): a compose file, or a tar.gz bundle holding one and the files it
 * references. Refused with every reason when it cannot run on the stack's
 * hosts; the toaster at the root says why, and the dialog stays open.
 */
const StackRevisionUploadDialog = (props: StackRevisionUploadDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const stackApi = useClient<StackController>();
  const queries = useQueryClient();

  const form = useActionForm(stackApi.uploadStackRevision, {
    id: `stack-revision-upload-${props.stackId}`,
    schema: uploadStackRevisionBodySchema,
    params: { projectId: props.projectId, stackId: props.stackId },
    onSuccess: (revision) => {
      queries.invalidate(["stacks", props.projectId]);
      queries.invalidate(["stack-revisions", props.projectId, props.stackId]);
      toaster.success(
        tr("stacks.revision.uploaded", { args: [String(revision.number)] }),
      );
      props.onOpenChange(false);
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent data-testid="stack-revision-dialog">
        <DialogHeader>
          <DialogTitle>{tr("stacks.revision.upload.title")}</DialogTitle>
          <DialogDescription>
            {tr("stacks.revision.upload.description", {
              args: [props.stackName],
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <div data-testid="stack-revision-file">
            <Control
              file
              input={form.input.file}
              label={tr("stacks.revision.file")}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("stacks.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={loading}
              data-testid="stack-revision-upload"
            >
              {tr("stacks.revision.upload")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default StackRevisionUploadDialog;
