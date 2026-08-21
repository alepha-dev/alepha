import { useCallback, useEffect, useState } from "react";

import styles from "./Dialog.module.css";

// =============================================================================
// DIALOG CONSTANTS
// =============================================================================

/** Duration of the close animation in milliseconds (matches CSS variable) */
export const DIALOG_CLOSE_DURATION = 120;

// =============================================================================
// DIALOG COMPONENT
// =============================================================================

export interface DialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog should close */
  onClose: () => void;
  /** Dialog content */
  children: React.ReactNode;
  /** Additional class name for the container */
  className?: string;
  /** Additional styles for the container */
  style?: React.CSSProperties;
  /** Whether to center the dialog vertically (default: false, aligns to top) */
  center?: boolean;
  /** Padding for the overlay (default: "80px 16px 20px") */
  overlayPadding?: string;
  /** Whether to close on Escape key (default: true) */
  closeOnEscape?: boolean;
  /** Whether to close on overlay click (default: true) */
  closeOnOverlayClick?: boolean;
  /** Accessible label for the dialog */
  ariaLabel?: string;
  /** ID of element that labels the dialog */
  ariaLabelledBy?: string;
  /** ID of element that describes the dialog */
  ariaDescribedBy?: string;
}

const Dialog = (props: DialogProps) => {
  const {
    open,
    onClose,
    children,
    className = "",
    style,
    center = false,
    overlayPadding = "80px 16px 20px",
    closeOnEscape = true,
    closeOnOverlayClick = true,
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
  } = props;

  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, DIALOG_CLOSE_DURATION);
  }, [closing, onClose]);

  // Handle Escape key
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closing) {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, closing, closeOnEscape, handleClose]);

  if (!open) return null;

  const overlayClasses = [
    styles.overlay,
    closing ? styles.overlayClosing : "",
    center ? styles.overlayCenter : "",
  ]
    .filter(Boolean)
    .join(" ");

  const containerClasses = [
    styles.container,
    closing ? styles.containerClosing : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={overlayClasses}
      style={{ padding: overlayPadding }}
      onClick={closeOnOverlayClick ? handleClose : undefined}
      role="presentation"
    >
      {/* `stopPropagation` so a click inside does not reach the overlay's close
          handler. Not an interaction of its own. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className={containerClasses}
        style={style}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
      >
        {children}
      </div>
    </div>
  );
};

export default Dialog;

// =============================================================================
// HOOK FOR DIALOG STATE MANAGEMENT
// =============================================================================

export interface UseDialogOptions {
  /** Initial open state */
  defaultOpen?: boolean;
}

export interface UseDialogReturn {
  /** Whether the dialog is open */
  open: boolean;
  /** Open the dialog */
  openDialog: () => void;
  /** Close the dialog */
  closeDialog: () => void;
  /** Toggle the dialog */
  toggleDialog: () => void;
  /** Props to spread on the Dialog component */
  dialogProps: {
    open: boolean;
    onClose: () => void;
  };
}

export const useDialog = (options: UseDialogOptions = {}): UseDialogReturn => {
  const { defaultOpen = false } = options;
  const [open, setOpen] = useState(defaultOpen);

  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);
  const toggleDialog = useCallback(() => setOpen((prev) => !prev), []);

  return {
    open,
    openDialog,
    closeDialog,
    toggleDialog,
    dialogProps: {
      open,
      onClose: closeDialog,
    },
  };
};
