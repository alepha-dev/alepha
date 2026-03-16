import type { ModalProps } from "@mantine/core";
import { modals } from "@mantine/modals";
import type { ReactNode } from "react";
import AlertDialog from "../components/dialogs/AlertDialog.tsx";
import ConfirmDialog from "../components/dialogs/ConfirmDialog.tsx";
import PromptDialog from "../components/dialogs/PromptDialog.tsx";

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
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const modalId = this.open({
        ...options,
        title: options?.title || "Alert",
        onClose: done,
        content: (
          <AlertDialog
            options={options}
            onClose={() => {
              this.close(modalId);
              done();
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
      let resolved = false;
      const done = (confirmed: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(confirmed);
      };
      const modalId = this.open({
        ...options,
        title: options?.title || "Confirm",
        closeOnClickOutside: false,
        closeOnEscape: false,
        onClose: () => done(false),
        content: (
          <ConfirmDialog
            options={options}
            onConfirm={(confirmed) => {
              done(confirmed);
              this.close(modalId);
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
      let resolved = false;
      const done = (value: string | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };
      const modalId = this.open({
        ...options,
        title: options?.title || "Input",
        closeOnClickOutside: false,
        closeOnEscape: false,
        onClose: () => done(null),
        content: (
          <PromptDialog
            options={options}
            onSubmit={(value) => {
              done(value);
              this.close(modalId);
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
}
