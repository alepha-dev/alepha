import { Flex, type ModalProps } from "@mantine/core";
import { modals } from "@mantine/modals";
import type { Static, TObject } from "alepha";
import type { ReactNode } from "react";
import ErrorViewer from "../components/data/ErrorViewer.tsx";
import AlertDialog from "../components/dialogs/AlertDialog.tsx";
import ConfirmDialog from "../components/dialogs/ConfirmDialog.tsx";
import PromptDialog from "../components/dialogs/PromptDialog.tsx";
import type { TypeFormProps } from "../components/form/TypeForm.tsx";
import { ui } from "../constants/ui.ts";

// Base interfaces
export interface BaseDialogOptions extends Partial<ModalProps> {
  title?: ReactNode;
  message?: ReactNode;
  content?: any; // weird typing for mantine modals content
}

export interface AlertDialogOptions extends BaseDialogOptions {
  okLabel?: string;
}

export interface ConfirmDialogOptions extends BaseDialogOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
}

export interface PromptDialogOptions extends BaseDialogOptions {
  placeholder?: string;
  defaultValue?: string;
  label?: string;
  required?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
}

export interface FormDialogOptions<T extends TObject = TObject>
  extends BaseDialogOptions {
  schema: T;
  columns?: TypeFormProps<T>["columns"];
  fieldControlProps?: TypeFormProps<T>["fieldControlProps"];
  controlProps?: TypeFormProps<T>["controlProps"];
  submitLabel?: string;
  cancelLabel?: string;
  defaults?: Record<string, unknown>;
}

// Component prop interfaces
export interface AlertDialogProps {
  options?: AlertDialogOptions;
  onClose: () => void;
}

export interface ConfirmDialogProps {
  options?: ConfirmDialogOptions;
  onConfirm: (confirmed: boolean) => void;
}

export interface PromptDialogProps {
  options?: PromptDialogOptions;
  onSubmit: (value: string | null) => void;
}

export interface DialogServiceOptions {
  default?: Partial<BaseDialogOptions>;
}

export class DialogService {
  public readonly options: DialogServiceOptions = {
    default: {
      centered: true,
      withCloseButton: true,
      size: "md",
      overlayProps: {
        backgroundOpacity: 0.55,
        blur: 3,
      },
      transitionProps: {
        transition: "pop",
        duration: 200,
      },
    },
  };

  /**
   * Show an alert dialog with a message
   */
  public alert(options?: AlertDialogOptions): Promise<void> {
    return new Promise((resolve) => {
      const modalId = this.open({
        ...options,
        title: options?.title || "Alert",
        content: (
          <AlertDialog
            options={options}
            onClose={() => {
              this.close(modalId);
              resolve();
            }}
          />
        ),
      });
    });
  }

  /**
   * Show a confirmation dialog that returns a promise
   */
  public confirm(options?: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const modalId = this.open({
        ...options,
        title: options?.title || "Confirm",
        closeOnClickOutside: false,
        closeOnEscape: false,
        content: (
          <ConfirmDialog
            options={options}
            onConfirm={(confirmed) => {
              this.close(modalId);
              resolve(confirmed);
            }}
          />
        ),
      });
    });
  }

  /**
   * Show a prompt dialog to get user input
   */
  public prompt(options?: PromptDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const modalId = this.open({
        ...options,
        title: options?.title || "Input",
        closeOnClickOutside: false,
        closeOnEscape: false,
        content: (
          <PromptDialog
            options={options}
            onSubmit={(value) => {
              this.close(modalId);
              resolve(value);
            }}
          />
        ),
      });
    });
  }

  /**
   * Open a custom dialog with provided content
   */
  public open(options?: BaseDialogOptions): string {
    return modals.open({
      ...this.options.default,
      ...options,
      children: options?.content || options?.message,
    });
  }

  /**
   * Close the currently open dialog or a specific dialog by ID
   */
  public close(modalId?: string): void {
    if (modalId) {
      modals.close(modalId);
    } else {
      modals.closeAll();
    }
  }

  /**
   * Show an error viewer dialog
   */
  public error(
    error: Error | unknown,
    options?: BaseDialogOptions & { showStack?: boolean },
  ): void {
    this.open({
      size: "lg",
      title: options?.title || "Error",
      ...options,
      content: (
        <Flex bdrs={"md"} w={"100%"} flex={1} p={"sm"} bg={ui.colors.surface}>
          <ErrorViewer
            size={"xs"}
            error={error}
            showStack={options?.showStack ?? true}
          />
        </Flex>
      ),
    });
  }

  /**
   * Show a form dialog for structured input.
   */
  public form<T extends TObject>(
    options: FormDialogOptions<T>,
  ): Promise<Static<T> | null> {
    return import("../components/dialogs/FormDialog.tsx").then(
      ({ default: FormDialog }) => {
        return new Promise((resolve) => {
          const modalId = this.open({
            ...options,
            title: options.title || "Form",
            closeOnClickOutside: false,
            closeOnEscape: false,
            content: (
              <FormDialog
                options={options}
                onSubmit={(value) => {
                  this.close(modalId);
                  resolve(value);
                }}
              />
            ),
          });
        });
      },
    );
  }
}
