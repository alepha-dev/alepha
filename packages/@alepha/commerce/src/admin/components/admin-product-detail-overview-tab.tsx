import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { productFormSchema } from "./product-form-schema.ts";

export interface AdminProductDetailOverviewTabProps {
  form: FormModel<ReturnType<typeof productFormSchema>>;
}

/**
 * What the product *is* and what it costs.
 *
 * `AutoForm` builds the layout from the schema, so adding a field is a schema
 * entry rather than a form redesign — which is how `vatRateBps` and `currency`
 * arrived here at all. See `product-form-schema.ts` for the field list and the
 * reasoning about units.
 */
export const AdminProductDetailOverviewTab = (
  props: AdminProductDetailOverviewTabProps,
) => {
  const { tr } = useI18n();

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <AutoForm
        form={props.form}
        submitLabel={String(tr("commerce.admin.save", { default: "Save" }))}
      />
    </div>
  );
};
