import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { CryptoProvider } from "alepha/crypto";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Lock, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "../../services/I18n.ts";
import {
  ensureProtectedKeysAutoLock,
  forgetProtectedKey,
  getProtectedKey,
  rememberProtectedKey,
} from "./protectedFolioKeys.ts";

export interface FolioProtectedViewProps {
  folio: Folio;
  /**
   * Optional escape hatch the unlock card surfaces under the
   * "Lost the passphrase?" hint. When provided, a destructive
   * "Delete folio (unrecoverable)" link calls this — the parent is
   * expected to confirm + invoke the standard delete action.
   */
  onDeleteUnrecoverable?: () => void;
}

/**
 * Render the body of a protected folio. If no in-memory key is cached
 * for this folio, shows an unlock card; on success, derives the key
 * (PBKDF2 inside `BrowserCryptoProvider`), decrypts, displays markdown.
 *
 * The plaintext lives only in component state — never echoed to any
 * atom, storage, or logger. The derived `CryptoKey` is cached in a
 * module-level Map (NOT a store atom) so a re-render reuses it without
 * re-prompting; the Map clears on tab close.
 */
const FolioProtectedView = (props: FolioProtectedViewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const crypto = useInject(CryptoProvider);

  const [passphrase, setPassphrase] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Try the cached key first — quietly decrypt if it's still valid.
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
        if (alive) setError(String(tr("folios.protected.unlock-failed")));
      })
      .finally(() => {
        if (alive) setWorking(false);
      });
    return () => {
      alive = false;
    };
  }, [props.folio.id, props.folio.content]);

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setWorking(true);
    setError(null);
    try {
      const envelope = parseEnvelope(props.folio.content);
      if (!envelope) {
        setError(String(tr("folios.protected.invalid-envelope")));
        return;
      }
      const key = await crypto.deriveKeyFromPassphrase(
        passphrase,
        envelope.salt,
        envelope.iterations,
      );
      const out = await crypto.decryptWithPassphrase(
        props.folio.content,
        passphrase,
      );
      // Only cache after a successful decrypt — a bad passphrase derives
      // a key that won't decrypt the envelope; we must not cache it.
      rememberProtectedKey(props.folio.id, key);
      // Arm the inactivity watcher the moment we have any key in memory.
      // Idempotent — repeated unlocks don't double-install listeners.
      ensureProtectedKeysAutoLock();
      setPlaintext(out);
      setPassphrase("");
    } catch {
      // Web Crypto throws DOMException("OperationError") on auth-tag
      // mismatch; we don't distinguish — surface a generic message.
      setError(String(tr("folios.protected.unlock-failed")));
    } finally {
      setWorking(false);
    }
  };

  const handleLock = () => {
    setPlaintext(null);
    forgetProtectedKey(props.folio.id);
  };

  if (plaintext !== null) {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-muted-foreground flex items-center justify-end gap-2 text-xs">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            {tr("folios.protected.unlocked-badge")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleLock}
            className="h-6 px-2 text-xs"
          >
            <Lock className="size-3" />
            {tr("folios.protected.lock-now")}
          </Button>
        </div>
        {plaintext ? (
          <MarkdownView content={plaintext} />
        ) : (
          <p className="text-muted-foreground text-sm italic">
            {tr("folios.empty-folio")}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleUnlock}
      className="border-border bg-card flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex items-center gap-2">
        <Lock className="text-muted-foreground size-4" />
        <h3 className="text-sm font-semibold">
          {tr("folios.protected.locked-title")}
        </h3>
      </div>
      <p className="text-muted-foreground text-xs">
        {tr("folios.protected.locked-body")}
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`passphrase-${props.folio.id}`} className="text-xs">
          {tr("folios.protected.passphrase")}
        </Label>
        <Input
          id={`passphrase-${props.folio.id}`}
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.currentTarget.value)}
          disabled={working}
        />
      </div>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
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
        <Button
          type="submit"
          size="sm"
          disabled={working || passphrase.length === 0}
        >
          <Unlock className="size-3.5" />
          {tr("folios.protected.unlock")}
        </Button>
      </div>
    </form>
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
