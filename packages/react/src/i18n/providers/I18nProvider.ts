import {
  $hook,
  $inject,
  Alepha,
  TypeBoxError,
  TypeProvider,
  t,
} from "alepha";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $cookie } from "alepha/server/cookies";
import type { ServiceDictionary } from "../hooks/useI18n.ts";

export class I18nProvider<
  S extends object,
  K extends keyof ServiceDictionary<S>,
> {
  protected logger = $logger();
  protected alepha = $inject(Alepha);
  protected dateTimeProvider = $inject(DateTimeProvider);

  protected cookie = $cookie({
    name: "lang",
    schema: t.text(),
  });

  public readonly registry: Array<{
    name: string;
    lang: string;
    loader: () => Promise<Record<string, string>>;
    translations: Record<string, string>;
  }> = [];

  options = {
    fallbackLang: "en",
  };

  public dateFormat: { format: (value: Date) => string } =
    new Intl.DateTimeFormat(this.lang);

  public numberFormat: { format: (value: number) => string } =
    new Intl.NumberFormat(this.lang);

  public get languages() {
    const languages = new Set<string>();

    for (const item of this.registry) {
      languages.add(item.lang);
    }
    languages.add(this.options.fallbackLang);

    return Array.from(languages);
  }

  constructor() {
    this.refreshLocale();
  }

  protected readonly onRender = $hook({
    on: "server:onRequest",
    priority: "last",
    handler: async ({ request }) => {
      this.alepha.state.set("alepha.react.i18n.lang", this.cookie.get(request));
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      if (this.alepha.isBrowser()) {
        // get cookie lang
        const cookieLang = this.cookie.get();
        if (cookieLang) {
          this.alepha.state.set("alepha.react.i18n.lang", cookieLang);
        }

        for (const item of this.registry) {
          if (
            item.lang === this.lang ||
            item.lang === this.options.fallbackLang
          ) {
            item.translations = await item.loader();
          }
        }
        return;
      }

      for (const item of this.registry) {
        item.translations = await item.loader();
      }
    },
  });

  protected refreshLocale() {
    this.numberFormat = new Intl.NumberFormat(this.lang);
    this.dateFormat = new Intl.DateTimeFormat(this.lang);
    this.dateTimeProvider.setLocale(this.lang);
    TypeProvider.setLocale(this.lang);
  }

  public setLang = async (lang: string) => {
    if (this.alepha.isBrowser()) {
      for (const item of this.registry) {
        if (lang === item.lang) {
          if (Object.keys(item.translations).length > 0) {
            continue; // already loaded
          }
          item.translations = await item.loader();
        }
      }
      this.cookie.set(lang);
    }

    this.alepha.state.set("alepha.react.i18n.lang", lang);
    this.refreshLocale();
  };

  protected readonly mutate = $hook({
    on: "state:mutate",
    handler: async ({ key, value }) => {
      if (key === "alepha.react.i18n.lang" && this.alepha.isBrowser()) {
        let hasChanged = false;
        for (const item of this.registry) {
          if (value === item.lang) {
            if (Object.keys(item.translations).length > 0) {
              continue; // already loaded
            }
            item.translations = await item.loader();
            hasChanged = true;
          }
        }

        this.refreshLocale();

        if (hasChanged) {
          this.alepha.state.set("alepha.react.i18n.lang", value);
        }
      }
    },
  });

  public get lang(): string {
    return (
      this.alepha.state.get("alepha.react.i18n.lang") ||
      this.options.fallbackLang
    );
  }

  public translate = (key: string, args: string[] = []) => {
    for (const item of this.registry) {
      if (item.lang === this.lang) {
        if (item.translations[key]) {
          return this.render(item.translations[key], args); // append lang for fallback
        } else {
          break;
        }
      }
    }

    for (const item of this.registry) {
      if (item.lang === this.options.fallbackLang) {
        if (item.translations[key]) {
          return this.render(item.translations[key], args); // append lang for fallback
        } else {
          break;
        }
      }
    }

    return key; // fallback to the key itself if not found
  };

  public readonly l = (
    value: I18nLocalizeType,
    options: I18nLocalizeOptions = {},
  ) => {
    // Handle numbers
    if (typeof value === "number") {
      if (options.number) {
        return new Intl.NumberFormat(this.lang, options.number).format(value);
      }
      return this.numberFormat.format(value);
    }

    // Handle dates
    if (
      value instanceof Date ||
      this.dateTimeProvider.isDateTime(value) ||
      (typeof value === "string" && options.date)
    ) {
      // convert to DateTime with locale applied
      let dt = this.dateTimeProvider.of(value);

      // apply timezone if specified
      if (options.timezone) {
        dt = dt.tz(options.timezone);
      }

      // format using dayjs format string
      if (typeof options.date === "string") {
        if (options.date === "fromNow") {
          return dt.locale(this.lang).fromNow();
        }
        return dt.locale(this.lang).format(options.date);
      }

      // format using Intl.DateTimeFormatOptions
      if (options.date) {
        return new Intl.DateTimeFormat(
          this.lang,
          options.timezone
            ? { ...options.date, timeZone: options.timezone }
            : options.date,
        ).format(dt.toDate());
      }

      // default formatting with timezone
      if (options.timezone) {
        return new Intl.DateTimeFormat(this.lang, {
          timeZone: options.timezone,
        }).format(dt.toDate());
      }

      // default formatting
      return this.dateFormat.format(dt.toDate());
    }

    // handle TypeBox errors
    if (value instanceof TypeBoxError) {
      return TypeProvider.translateError(value, this.lang);
    }

    // return string values as-is
    return value;
  };

  public readonly tr = (
    key: keyof ServiceDictionary<S>[K],
    options: {
      args?: string[];
      default?: string;
    } = {},
  ) => {
    const translation = this.translate(key as string, options.args || []);
    if (translation === key && options.default) {
      return options.default;
    }
    return translation;
  };

  protected render(item: string, args: string[]): string {
    let result = item;
    for (let i = 0; i < args.length; i++) {
      result = result.replace(`$${i + 1}`, args[i]);
    }
    return result;
  }
}

export type I18nLocalizeType = string | number | Date | DateTime | TypeBoxError;

export interface I18nLocalizeOptions {
  /**
   * Options for number formatting (when value is a number)
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat
   */
  number?: Intl.NumberFormatOptions;
  /**
   * Options for date formatting (when value is a Date or DateTime)
   * Can be:
   * - A dayjs format string (e.g., "LLL", "YYYY-MM-DD", "dddd, MMMM D YYYY")
   * - "fromNow" for relative time (e.g., "2 hours ago")
   * - Intl.DateTimeFormatOptions for native formatting
   * @see https://day.js.org/docs/en/display/format
   * @see https://day.js.org/docs/en/display/from-now
   */
  date?: string | "fromNow" | Intl.DateTimeFormatOptions;
  /**
   * Timezone to display dates in (when value is a Date or DateTime)
   * Uses IANA timezone names (e.g., "America/New_York", "Europe/Paris", "Asia/Tokyo")
   * @see https://day.js.org/docs/en/timezone/timezone
   */
  timezone?: string;
}
