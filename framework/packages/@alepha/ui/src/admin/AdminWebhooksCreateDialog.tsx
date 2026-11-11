import * as React from "react";

void React;

import {
  type AdminWebhookController,
  createWebhookEndpointSchema,
  type WebhookEndpointWithSecret,
} from "alepha/api/webhooks";
import { useClient } from "alepha/react";
import { useActionForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { Control } from "../form/Control.tsx";
import { ControlSelect } from "../form/ControlSelect.tsx";

export interface AdminWebhooksCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The event names the catalog lists, for the subscription picker.
   */
  events: string[];
  onCreated: (created: WebhookEndpointWithSecret) => void;
}

/**
 * Register a webhook endpoint. Posted with `useActionForm`, so a refused
 * destination (a private host, http in production) lands under the URL
 * field instead of in a toast.
 */
export const AdminWebhooksCreateDialog = (
  props: AdminWebhooksCreateDialogProps,
) => {
  const { tr } = useI18n();
  const api = useClient<AdminWebhookController>();
  const form = useActionForm(api.createWebhookEndpoint, {
    schema: createWebhookEndpointSchema,
    initialValues: { url: "", events: [] },
    onSuccess: (created) => {
      props.onOpenChange(false);
      props.onCreated(created);
    },
  });

  const formState = useFormState(form, ["loading"]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.webhooks.createTitle", { default: "New endpoint" })}
          </DialogTitle>
          <DialogDescription>
            {tr("admin.webhooks.createDescription", {
              default:
                "The URL receives a signed POST for every event it subscribes to.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-4"
          id="create-webhook-endpoint-form"
        >
          <Control
            label={tr("admin.webhooks.url", { default: "URL" })}
            input={form.input.url}
            text
          />
          <Control
            label={tr("admin.webhooks.description", {
              default: "Description",
            })}
            input={form.input.description}
            text
          />
          <ControlSelect
            label={tr("admin.webhooks.events", { default: "Events" })}
            description={tr("admin.webhooks.eventsAll", {
              default: "Leave empty to receive every event.",
            })}
            input={form.input.events}
            items={props.events}
          />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="minimal"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("admin.webhooks.cancel", { default: "Cancel" })}
          </Button>
          <Button
            type="submit"
            form="create-webhook-endpoint-form"
            loading={formState.loading}
          >
            {tr("admin.webhooks.create", { default: "Create endpoint" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
