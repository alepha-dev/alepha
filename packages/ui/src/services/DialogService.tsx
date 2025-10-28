import type { ModalProps } from "@mantine/core";
import { modals } from "@mantine/modals";
import type { ReactNode } from "react";
import { AlertDialog } from "../components/dialogs/AlertDialog";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";

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
    const modalId = modals.open({
      ...this.options.default,
      ...options,
      children: options?.content || options?.message,
    });
    return modalId;
  }

  /**
   * Show a JSON editor/viewer dialog
   */
  public json(data?: any, options?: BaseDialogOptions): void {
    // Implementation to be added
  }

  /**
   * Show a form dialog for structured input
   */
  public form(options?: BaseDialogOptions): Promise<any> {
    // Implementation to be added
    return Promise.resolve(null);
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
   * Show a loading/progress dialog with optional progress percentage
   */
  public loading(options?: BaseDialogOptions & { progress?: number }): void {
    // Implementation to be added
  }

  /**
   * Show an image viewer/gallery dialog
   */
  public image(src: string | string[], options?: BaseDialogOptions): void {
    // Implementation to be added
  }

  /**
   * Show a table/data grid dialog for displaying tabular data
   */
  public table(
    data: any[],
    options?: BaseDialogOptions & { columns?: any[] },
  ): void {
    // Implementation to be added
  }

  /**
   * Show a multi-step wizard dialog
   */
  public wizard(steps: any[], options?: BaseDialogOptions): Promise<any> {
    // Implementation to be added
    return Promise.resolve(null);
  }
}
