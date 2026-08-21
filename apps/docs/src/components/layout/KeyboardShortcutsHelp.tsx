import Dialog from "./Dialog.tsx";

import styles from "./KeyboardShortcutsHelp.module.css";

// =============================================================================
// KEYBOARD SHORTCUTS DATA
// =============================================================================

const SHORTCUTS = [
  ["j / k", "Scroll down / up"],
  ["g g", "Go to top"],
  ["G", "Go to bottom"],
  ["/", "Open search"],
  ["f", "Toggle focus mode"],
  ["Esc", "Close dialogs"],
  ["?", "Show this help"],
] as const;

// =============================================================================
// KEYBOARD SHORTCUTS HELP COMPONENT
// =============================================================================

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const KeyboardShortcutsHelp = (props: KeyboardShortcutsHelpProps) => {
  const { open, onClose } = props;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      center
      overlayPadding="20px"
      className={styles.container}
    >
      <div className={styles.title}>Keyboard Shortcuts</div>

      <div className={styles.shortcuts}>
        {SHORTCUTS.map(([key, desc]) => (
          <div key={key} className={styles.shortcutRow}>
            <kbd className={styles.key}>{key}</kbd>
            <span className={styles.description}>{desc}</span>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        Press <kbd className={styles.footerKey}>Esc</kbd> or click outside to
        close
      </div>
    </Dialog>
  );
};

export default KeyboardShortcutsHelp;
