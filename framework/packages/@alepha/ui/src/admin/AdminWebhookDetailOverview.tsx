import * as React from "react";

void React;

import {
  type AdminWebhookController,
  updateWebhookEndpointSchema,
  type WebhookEndpointResource,
} from "alepha/api/webhooks";
import { useClient } from "alepha/react";
import { useActionForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import { Control } from "../form/Control.tsx";
import { ControlSelect } from "../form/ControlSelect.tsx";

export interface AdminWebhookDetailOverviewProps {
  endpoint: WebhookEndpointResource;
  events: string[];
  onSaved: () => void;
}

/**
 * An endpoint's editable fields. A refused URL lands under the field.
 */
export const AdminWebhookDetailOverview = (
  props: AdminWebhookDetailOverviewProps,
) => {
  const { tr } = useI18n();
  const api = useClient<AdminWebhookController>();
  const form = useActionForm(
    api.updateWebhookEndpoint,
    {
      schema: updateWebhookEndpointSchema,
      params: { id: props.endpoint.id },
      initialValues: {
        url: props.endpoint.url,
        description: props.endpoint.description ?? "",
        events: props.endpoint.events,
      },
      onSuccess: () => props.onSaved(),
    },
    [props.endpoint.id],
  );
  const state = useFormState(form, ["loading"]);

  return (
    <form {...form.props} className="flex max-w-xl flex-col gap-4 p-4">
      <Control
        label={tr("admin.webhooks.url", { default: "URL" })}
        input={form.input.url}
        text
      />
      <Control
        label={tr("admin.webhooks.description", { default: "Description" })}
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
      <div>
        <Button type="submit" loading={state.loading}>
          {tr("admin.webhooks.save", { default: "Save" })}
        </Button>
      </div>
    </form>
  );
};
