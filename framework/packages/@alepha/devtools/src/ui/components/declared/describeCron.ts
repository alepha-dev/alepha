const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const pad = (n: string): string => (n.length === 1 ? `0${n}` : n);

/**
 * Describe a 5-field cron expression in English.
 *
 * Deliberately covers only the shapes schedulers actually use in practice
 * (every N minutes/hours, daily/weekly/monthly at a time) and returns
 * `undefined` for anything else, so the caller falls back to showing the raw
 * expression. A wrong plain-English description is worse than none — it would
 * be trusted.
 */
export const describeCron = (expression?: string): string | undefined => {
  if (!expression) return undefined;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;

  const [min, hour, dom, month, dow] = parts;
  const anyDate = dom === "*" && month === "*" && dow === "*";

  if (min.startsWith("*/") && hour === "*" && anyDate) {
    return `Every ${min.slice(2)} minutes`;
  }
  if (min === "*" && hour === "*" && anyDate) {
    return "Every minute";
  }
  if (/^\d+$/.test(min) && hour === "*" && anyDate) {
    return `Every hour at :${pad(min)}`;
  }
  if (/^\d+$/.test(min) && hour.startsWith("*/") && anyDate) {
    return `Every ${hour.slice(2)} hours at :${pad(min)}`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const time = `${pad(hour)}:${pad(min)}`;
    if (anyDate) return `Every day at ${time}`;
    if (dom === "*" && month === "*" && /^[0-6]$/.test(dow)) {
      return `Every ${DAYS[Number(dow)]} at ${time}`;
    }
    if (/^\d+$/.test(dom) && month === "*" && dow === "*") {
      return `Day ${dom} of every month at ${time}`;
    }
  }

  return undefined;
};
