import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Lock, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";

import type { I18n } from "../../../../services/I18n.ts";
import FolioPassphraseDialog from "../../FolioPassphraseDialog.tsx";

export interface FolioLockedPanelProps {
  /**
   * Passphrase round-trip — see `useFolioActions.unlock`. Derives the key,
   * decrypts, caches the key for the session, and writes the plaintext
   * into the draft's `content` field so the folio becomes an ordinary
   * editable document once this resolves. Returns an error message to
   * show inline, or `null` on success.
   */
  onUnlock: (passphrase: string) => Promise<string | null>;
  /**
   * The escape hatch for a folio nobody can unlock anymore — routed to
   * `useFolioActions`'s `folio.delete` handler (the same one the menu's
   * Delete action uses), confirmed there via `useDialog`.
   */
  onDelete: () => void | Promise<void>;
}

/**
 * The centered gate a protected-and-not-yet-unlocked folio shows in place
 * of the document body. Deliberately NOT `FolioProtectedView` (that
 * component is a read-only view with its own Clear/Encrypted toggle, built
 * for the old split view/editor world) — this workspace is always
 * editable, so once unlocked the folio should become a normal editable
 * document rather than a second read-only render mode. The crypto itself
 * is not reimplemented here: `useFolioActions.unlock` uses the same
 * `CryptoProvider` calls and `protectedFolioKeys.ts` cache
 * (`getProtectedKey` / `rememberProtectedKey` / `ensureProtectedKeysAutoLock`)
 * that `FolioProtectedView` and the deleted `FolioView`/`FolioEditor` used.
 */
const FolioLockedPanel = (props: FolioLockedPanelProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [unlockOpen, setUnlockOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
      <Lock className="text-muted-foreground size-8" />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">
          {tr("folios.editor.locked.title")}
        </h2>
        <p className="text-muted-foreground max-w-md text-sm">
          {tr("folios.editor.locked.body")}
        </p>
        <p className="text-muted-foreground/80 max-w-md text-xs italic">
          {tr("folios.editor.locked.warning")}
        </p>
      </div>
      <Button onClick={() => setUnlockOpen(true)}>
        <Lock className="size-4" />
        {tr("folios.protected.unlock")}
      </Button>
      <p className="text-muted-foreground text-[11px] italic">
        {tr("folios.protected.lost-passphrase-hint")}{" "}
        <button
          type="button"
          onClick={() => props.onDelete()}
          className="text-destructive hover:underline"
        >
          <Trash2 className="mr-0.5 inline size-3" />
          {tr("folios.protected.delete-unrecoverable")}
        </button>
      </p>

      <FolioPassphraseDialog
        open={unlockOpen}
        onOpenChange={setUnlockOpen}
        title={tr("folios.protected.unlock-title")}
        description={tr("folios.protected.unlock-description")}
        submitLabel={tr("folios.protected.unlock")}
        onSubmit={props.onUnlock}
      />
    </div>
  );
};

export default FolioLockedPanel;
