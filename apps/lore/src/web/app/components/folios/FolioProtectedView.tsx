import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Switch } from "@alepha/ui/components/ui/switch";
import { CryptoProvider } from "alepha/crypto";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Lock, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "../../services/I18n.ts";
import FolioPassphraseDialog from "./FolioPassphraseDialog.tsx";
import {
  ensureProtectedKeysAutoLock,
  forgetProtectedKey,
  getProtectedKey,
  rememberProtectedKey,
} from "./protectedFolioKeys.ts";

export interface FolioProtectedViewProps {
  folio: Folio;
  /**
   * Optional escape hatch surfaced under the "Lost the passphrase?" hint
   * on the locked state. When provided, a destructive "Delete folio
   * (unrecoverable)" link calls this — the parent confirms + deletes.
   */
  onDeleteUnrecoverable?: () => void;
}

/**
 * Render the body of a protected folio behind a Clear ⇄ Encrypted toggle.
 *
 * The toggle is a *session view* control only — it never changes the
 * folio's stored state (the content stays encrypted at rest). Flipping to
 * Clear unlocks for viewing: if a session key is already cached it shows
 * instantly, otherwise a passphrase dialog decrypts it (PBKDF2 inside
 * `CryptoProvider`). Flipping to Encrypted forgets the key and re-locks.
 *
 * Plaintext lives only in component state — never echoed to any atom,
 * storage, or logger. The derived `CryptoKey` is cached in a module-level
 * Map that clears on tab close / idle.
 */
const FolioProtectedView = (props: FolioProtectedViewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const crypto = useInject(CryptoProvider);

  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  // Try the cached key first — quietly decrypt if it's still valid so the
  // toggle opens in the Clear state without re-prompting.
  useEffect(() => {
    let alive = true;
    const cached = getProtectedKey(props.folio.id);
    if (!cached) return;
    setWorking(true);
    decryptWithCachedKey(cached, props.folio.content)
      .then((out) => {
        if (alive) setPlaintext(out);
      })
      .catch(() => {
        forgetProtectedKey(props.folio.id);
      })
      .finally(() => {
        if (alive) setWorking(false);
      });
    return () => {
      alive = false;
    };
  }, [props.folio.id, props.folio.content]);

  const handleToggle = (toClear: boolean) => {
    if (toClear) {
      // → Clear. Already unlocked (cached key) → nothing to do; the
      // Switch flips on via `checked`. Otherwise prompt for the passphrase.
      if (plaintext !== null) return;
      setUnlockOpen(true);
    } else {
      // → Encrypted. Drop the in-memory key + plaintext (re-lock).
      setPlaintext(null);
      forgetProtectedKey(props.folio.id);
    }
  };

  const handleUnlock = async (passphrase: string): Promise<string | null> => {
    const envelope = parseEnvelope(props.folio.content);
    if (!envelope) return tr("folios.protected.invalid-envelope");
    try {
      const key = await crypto.deriveKeyFromPassphrase(
        passphrase,
        envelope.salt,
        envelope.iterations,
      );
      const out = await crypto.decryptWithPassphrase(
        props.folio.content,
        passphrase,
      );
      // Only cache after a successful decrypt — a bad passphrase derives a
      // key that won't decrypt the envelope; we must not cache it.
      rememberProtectedKey(props.folio.id, key);
      ensureProtectedKeysAutoLock();
      setPlaintext(out);
      return null;
    } catch {
      // Web Crypto throws DOMException("OperationError") on auth-tag
      // mismatch; surface a generic message, never the plaintext.
      return tr("folios.protected.unlock-failed");
    }
  };

  const unlocked = plaintext !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="border-border bg-card flex items-center justify-between gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          {unlocked ? (
            <ShieldCheck className="size-4 text-emerald-500" />
          ) : (
            <Lock className="text-muted-foreground size-4" />
          )}
          <span className="text-sm font-medium">
            {tr(
              unlocked
                ? "folios.protected.state-clear"
                : "folios.protected.state-encrypted",
            )}
          </span>
        </div>
        <Switch
          checked={unlocked}
          onCheckedChange={handleToggle}
          disabled={working}
          aria-label={tr("folios.protected.toggle-aria")}
        />
      </div>

      {unlocked ? (
        plaintext ? (
          <MarkdownView content={plaintext} />
        ) : (
          <p className="text-muted-foreground text-sm italic">
            {tr("folios.empty-folio")}
          </p>
        )
      ) : (
        <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-4">
          <p className="text-muted-foreground text-xs">
            {tr("folios.protected.locked-body")}
          </p>
          <p className="text-muted-foreground text-[11px] italic">
            {tr("folios.protected.lost-passphrase-hint")}{" "}
            <button
              type="button"
              onClick={() => props.onDeleteUnrecoverable?.()}
              className="text-destructive hover:underline"
            >
              <Trash2 className="mr-0.5 inline size-3" />
              {tr("folios.protected.delete-unrecoverable")}
            </button>
          </p>
        </div>
      )}

      <FolioPassphraseDialog
        open={unlockOpen}
        onOpenChange={setUnlockOpen}
        title={tr("folios.protected.unlock-title")}
        description={tr("folios.protected.unlock-description")}
        submitLabel={tr("folios.protected.unlock")}
        onSubmit={handleUnlock}
      />
    </div>
  );
};

export default FolioProtectedView;

const parseEnvelope = (
  raw: string,
): { salt: string; iterations: number } | null => {
  try {
    const parsed = JSON.parse(raw) as {
      salt?: string;
      kdf?: { iterations?: number };
    };
    if (!parsed.salt) return null;
    return {
      salt: parsed.salt,
      iterations: parsed.kdf?.iterations ?? 600_000,
    };
  } catch {
    return null;
  }
};

const decryptWithCachedKey = async (
  key: CryptoKey,
  envelopeRaw: string,
): Promise<string> => {
  const env = JSON.parse(envelopeRaw) as { iv: string; ciphertext: string };
  const ivBytes = hexToBytes(env.iv);
  const ctBytes = hexToBytes(env.ciphertext);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer },
    key,
    ctBytes.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(decrypted);
};

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
  }
  return out;
};
