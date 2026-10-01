import * as React from "react";

void React;

import type { RealmConfig } from "alepha/api/users";
import { useI18n } from "alepha/react/i18n";
import { Check, X } from "lucide-react";

export interface AuthRegisterPasswordRulesProps {
  policy: RealmConfig["settings"]["passwordPolicy"];
  value: string;
}

export const AuthRegisterPasswordRules = (
  props: AuthRegisterPasswordRulesProps,
) => {
  const { tr } = useI18n();
  const policy = props.policy;
  const value = props.value;

  const rules: { ok: boolean; label: string }[] = [];

  if (policy?.minLength && policy.minLength > 0) {
    rules.push({
      ok: value.length >= policy.minLength,
      label: tr("auth.register.password.rule.minLength", {
        default: `At least ${policy.minLength} characters`,
        args: [String(policy.minLength)],
      }),
    });
  }
  if (policy?.requireUppercase) {
    rules.push({
      ok: /[A-Z]/.test(value),
      label: tr("auth.register.password.rule.uppercase", {
        default: "One uppercase letter",
      }),
    });
  }
  if (policy?.requireLowercase) {
    rules.push({
      ok: /[a-z]/.test(value),
      label: tr("auth.register.password.rule.lowercase", {
        default: "One lowercase letter",
      }),
    });
  }
  if (policy?.requireNumbers) {
    rules.push({
      ok: /[0-9]/.test(value),
      label: tr("auth.register.password.rule.number", {
        default: "One number",
      }),
    });
  }
  if (policy?.requireSpecialCharacters) {
    rules.push({
      ok: /[^A-Za-z0-9]/.test(value),
      label: tr("auth.register.password.rule.special", {
        default: "One special character",
      }),
    });
  }

  if (rules.length === 0) return null;

  return (
    <ul className="text-muted-foreground -mt-2 flex flex-col gap-1 text-xs">
      {rules.map((rule, idx) => (
        <li
          key={idx}
          className={`flex items-center gap-1.5 ${rule.ok ? "text-emerald-600 dark:text-emerald-400" : ""}`}
        >
          {rule.ok ? (
            <Check className="size-3.5" />
          ) : (
            <X className="size-3.5 opacity-50" />
          )}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
};
