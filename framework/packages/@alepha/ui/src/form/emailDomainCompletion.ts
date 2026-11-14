/**
 * Domains an email field completes by default, most common first: the first
 * one matching what follows `@` wins, so `g` gives `gmail.com`.
 */
export const DEFAULT_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
];

/**
 * The rest of the domain to suggest after what was typed: `"mail.com"` for
 * `"jane@g"`. Empty when there is nothing to suggest: no `@` yet, nothing
 * typed after it, no domain starting with it, or the domain already complete.
 */
export const emailDomainCompletion = (
  value: string,
  domains: readonly string[] = DEFAULT_EMAIL_DOMAINS,
): string => {
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return "";
  const typed = value.slice(at + 1).toLowerCase();
  if (!typed || /\s/.test(typed)) return "";
  const match = domains.find(
    (domain) => domain.length > typed.length && domain.startsWith(typed),
  );
  return match ? match.slice(typed.length) : "";
};
