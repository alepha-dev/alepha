import type { JobRetention } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";

export interface JobRetentionLabels {
  /**
   * A short phrase for a table cell: "OK: last 7 · Errors: 30 days".
   */
  short: (retention: JobRetention) => string;
  /**
   * The full rule, and where it came from, for a tooltip or an aside.
   */
  sentence: (retention: JobRetention) => string;
  /**
   * True when neither status declares a rule of its own.
   */
  isDefault: (retention: JobRetention) => boolean;
}

/**
 * Localised phrases for a job's effective retention.
 *
 * Every key is a literal `tr()`, never a computed one: `i18n-fr.spec.ts` only
 * sees keys written out after `tr(`, so a template key could not be given its
 * French value at all. The rule and its fragments are assembled from those,
 * which is why a cadence or a source maps to a key through a switch rather
 * than through its value.
 */
export const useJobRetentionLabels = (): JobRetentionLabels => {
  const { tr } = useI18n();

  const rule = (value: JobRetention["ok"]): string => {
    if (value === false) {
      return tr("admin.jobs.retention.notKept", { default: "not kept" });
    }
    if (value.last !== undefined && value.days !== undefined) {
      return tr("admin.jobs.retention.lastWithinDays", {
        default: `last ${value.last} within ${value.days} days`,
        args: [String(value.last), String(value.days)],
      });
    }
    if (value.last !== undefined) {
      return tr("admin.jobs.retention.last", {
        default: `last ${value.last}`,
        args: [String(value.last)],
      });
    }
    return tr("admin.jobs.retention.days", {
      default: `${value.days} days`,
      args: [String(value.days)],
    });
  };

  const origin = (retention: JobRetention): string => {
    const { ok, error } = retention.source;
    if (ok === "job" && error === "job") {
      return tr("admin.jobs.retention.source.job", {
        default: "Declared by the job.",
      });
    }
    if (ok !== error) {
      return tr("admin.jobs.retention.source.mixed", {
        default: "Partly declared by the job, partly the default.",
      });
    }
    switch (retention.cadence) {
      case "frequent":
        return tr("admin.jobs.retention.source.frequent", {
          default:
            "Default for a job that runs every 15 minutes or more often.",
        });
      case "hourly":
        return tr("admin.jobs.retention.source.hourly", {
          default: "Default for a job that runs up to hourly.",
        });
      case "daily":
        return tr("admin.jobs.retention.source.daily", {
          default: "Default for a job that runs up to daily.",
        });
      case "slower":
        return tr("admin.jobs.retention.source.slower", {
          default: "Default for a job that runs less than daily.",
        });
      default:
        return tr("admin.jobs.retention.source.queue", {
          default: "Default for a pushed job.",
        });
    }
  };

  return {
    short: (retention) =>
      tr("admin.jobs.retention.short", {
        default: `OK: ${rule(retention.ok)} · Errors: ${rule(retention.error)}`,
        args: [rule(retention.ok), rule(retention.error)],
      }),
    sentence: (retention) =>
      `${tr("admin.jobs.retention.sentence", {
        default: `Successes: ${rule(retention.ok)}. Failures and cancellations: ${rule(retention.error)}.`,
        args: [rule(retention.ok), rule(retention.error)],
      })} ${origin(retention)}`,
    isDefault: (retention) =>
      retention.source.ok === "default" && retention.source.error === "default",
  };
};
