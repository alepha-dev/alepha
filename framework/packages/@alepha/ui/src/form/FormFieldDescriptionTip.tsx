import { useI18n } from "alepha/react/i18n";
import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";

/**
 * Past this many characters a field's description leaves the form and sits
 * behind an (i) icon on the label line (#Q3427).
 *
 * 120 is about two lines under a half-width field: a sentence that says what
 * the field is stays in view, a paragraph explaining the trade-offs of a
 * security setting does not, since six lines under every such input made the
 * form unreadable as a form.
 */
export const FORM_FIELD_DESCRIPTION_INLINE_MAX = 120;

export interface FormFieldDescriptionTipProps {
  description: string;
}

/**
 * The (i) beside a field label holding a description too long to show
 * inline. A real button, so it takes keyboard focus and opens its tooltip on
 * focus as on hover. The field keeps its `aria-describedby` on a
 * visually-hidden copy of the text, which `FormField` renders.
 */
export const FormFieldDescriptionTip = (
  props: FormFieldDescriptionTipProps,
) => {
  const { tr } = useI18n();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="form-field-description-tip"
              aria-label={tr("form.field.moreInfo", {
                default: "About this field",
              })}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
            />
          }
        >
          <Info className="size-3.5" aria-hidden />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {props.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
