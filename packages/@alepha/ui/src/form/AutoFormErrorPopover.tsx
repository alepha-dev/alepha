import * as React from "react";

void React;

import type { ZObject } from "alepha";
import { type FormModel, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { AlertCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";

export interface AutoFormErrorPopoverProps {
  form: FormModel<ZObject>;
}

export const AutoFormErrorPopover = (props: AutoFormErrorPopoverProps) => {
  const { error } = useFormState(props.form, ["error"]);
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  // Close the popover when the error clears. Guarded on `open`, so it settles
  // in one pass and does not need an effect.
  if (!error && open) {
    setOpen(false);
  }

  if (!error) return null;

  const items = collectErrors(error);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tr("autoForm.errors", { default: "Form errors" })}
            className="text-destructive"
          />
        }
      >
        <AlertCircle className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="text-destructive px-2 py-1 text-sm font-medium">
          {items.length === 1
            ? tr("autoForm.error", { default: "Error" })
            : tr("autoForm.errors", { default: "Errors" })}
        </p>
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => focusError(it.path, props.form.id)}
                className="hover:bg-accent w-full rounded px-2 py-1 text-left text-xs"
              >
                <span className="font-medium">
                  {it.path || tr("autoForm.formLabel", { default: "Form" })}
                </span>
                <span className="text-muted-foreground"> — {it.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

interface ErrorItem {
  path: string;
  message: string;
}

const collectErrors = (error: Error): ErrorItem[] => {
  const anyErr = error as Error & {
    value?: { message?: string; path?: string };
  };
  const path = anyErr.value?.path ?? "";
  const message = anyErr.value?.message ?? error.message ?? "Invalid";
  return [{ path, message }];
};

const focusError = (path: string, formId: string) => {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return;
  const dotted = segments.join(".");
  // ControlArray names its item fields `items[0].email` and joins their ids
  // with `-`; the dotted forms are what every other control renders.
  const bracketed = segments
    .map((segment, i) =>
      i === 0
        ? segment
        : /^\d+$/.test(segment)
          ? `[${segment}]`
          : `.${segment}`,
    )
    .join("");
  const el =
    document.getElementById(`${formId}-${dotted}`) ??
    document.getElementById(`${formId}-${segments.join("-")}`) ??
    document.querySelector<HTMLElement>(`[name="${dotted}"]`) ??
    document.querySelector<HTMLElement>(`[name="${bracketed}"]`);
  el?.focus();
};
