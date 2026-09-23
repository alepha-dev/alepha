import * as React from "react";

void React;

import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

import { Button } from "../core/Button.tsx";
import type { AutoFormAction } from "./AutoForm.tsx";
import { AutoFormErrorPopover } from "./AutoFormErrorPopover.tsx";
import { iconFor } from "./iconHint.tsx";

export interface AutoFormBottomBarProps {
  form: FormModel<ZObject>;
  dirty?: boolean;
  loading?: boolean;
  disabled?: boolean;
  disabledIfPristine?: boolean;
  submitLabel?: string;
  noSubmit?: boolean;
  onCancel?: () => void;
  skipReset?: boolean;
  actions?: AutoFormAction[];
  /**
   * Drop the standalone chrome (border / rounded / background / padding) so
   * the bar slots into a `CardFooter`, which provides that chrome itself.
   */
  bare?: boolean;
}

export const AutoFormBottomBar = (props: AutoFormBottomBarProps) => {
  const { tr } = useI18n();
  return (
    <div
      className={
        props.bare
          ? "flex w-full items-center gap-2"
          : "bg-card flex items-center gap-2 rounded-md border p-2"
      }
    >
      {props.onCancel && (
        <Button
          type="button"
          variant="minimal"
          onClick={props.onCancel}
          disabled={props.disabled}
        >
          <X className="mr-1 size-4" />
          {tr("autoForm.cancel", { default: "Cancel" })}
        </Button>
      )}
      {!props.skipReset && (
        <Button
          type="button"
          variant="minimal"
          onClick={() => props.form.reset()}
          disabled={props.disabled || !props.dirty}
        >
          {/* No icon, deliberately. The submit button next to it carries none
              — a glyph would have to be either a dated floppy disk or a tick
              that reads as "done" rather than "do it" — and a bar where only
              some buttons are decorated reads as unfinished rather than as a
              hierarchy. `Button` still shows a spinner while submitting,
              which is the one icon here that carries information. */}
          {tr("autoForm.reset", { default: "Reset" })}
        </Button>
      )}
      {props.actions?.map((action, i) => {
        const Icon = action.icon ? iconFor(action.icon) : undefined;
        return (
          <Button
            key={i}
            type="button"
            variant={action.variant ?? "minimal"}
            intent={action.intent}
            onClick={() => action.onClick()}
            disabled={props.disabled || action.disabled}
          >
            {Icon && <Icon className="mr-1 size-4" />}
            {action.label}
          </Button>
        );
      })}

      <div className="ml-auto flex items-center gap-2">
        <AutoFormErrorPopover form={props.form} />
        {!props.noSubmit && (
          <Button
            type="submit"
            loading={props.loading}
            disabled={
              props.disabled || (props.disabledIfPristine && !props.dirty)
            }
          >
            {props.submitLabel ?? tr("autoForm.save", { default: "Save" })}
          </Button>
        )}
      </div>
    </div>
  );
};
