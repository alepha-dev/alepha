import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider, Localize } from "../index.ts";

describe("<Localize/>", () => {
  const setup = () => {
    const alepha = Alepha.create();
    return {
      i18n: alepha.inject(I18nProvider),
      dateTime: alepha.inject(DateTimeProvider),
      alepha,
      render: (children: ReactNode) =>
        renderToString(
          <AlephaContext value={alepha}>{children}</AlephaContext>,
        ),
    };
  };

  it("should format date", () => {
    const { render, i18n } = setup();
    const date = new Date("2024-09-23T23:45:00Z");
    expect(render(<Localize value={date} />)).toBe("9/24/2024");
    i18n.setLang("fr");
    expect(render(<Localize value={date} />)).toBe("24/09/2024");
  });

  it("should format number", () => {
    const { render, i18n } = setup();
    const number = 1234567.89;
    expect(render(<Localize value={number} />)).toBe("1,234,567.89");
    i18n.setLang("de");
    expect(render(<Localize value={number} />)).toBe("1.234.567,89");
    i18n.setLang("fr");
    expect(render(<Localize value={number} />)).toBe("1\u202f234\u202f567,89");
  });

  // it("should format typebox error", async () => {
  //   const { render, i18n, alepha } = setup();
  //   const boom = async () => alepha.codec.decode(z.number(), "..");
  //   const error = await boom().catch((err) => err);
  //   expect(render(<Localize value={error} />)).toBe("must be number");
  //   await i18n.setLang("fr");
  //   expect(render(<Localize value={error} />)).toBe("doit être number");
  // });

  describe("number formatting options", () => {
    it("should format currency", () => {
      const { render } = setup();
      const number = 1234.56;
      expect(
        render(
          <Localize
            value={number}
            number={{ style: "currency", currency: "USD" }}
          />,
        ),
      ).toBe("$1,234.56");
    });

    it("should format currency with locale", () => {
      const { render, i18n } = setup();
      const number = 1234.56;
      i18n.setLang("fr");
      expect(
        render(
          <Localize
            value={number}
            number={{ style: "currency", currency: "EUR" }}
          />,
        ),
      ).toBe("1\u202f234,56\u00a0€");
    });

    it("should format percentage", () => {
      const { render } = setup();
      const number = 0.1234;
      expect(
        render(<Localize value={number} number={{ style: "percent" }} />),
      ).toBe("12%");
    });

    it("should format with minimum fraction digits", () => {
      const { render } = setup();
      const number = 10;
      expect(
        render(
          <Localize value={number} number={{ minimumFractionDigits: 2 }} />,
        ),
      ).toBe("10.00");
    });

    it("should format with maximum fraction digits", () => {
      const { render } = setup();
      const number = 10.123456;
      expect(
        render(
          <Localize value={number} number={{ maximumFractionDigits: 2 }} />,
        ),
      ).toBe("10.12");
    });

    it("should format with notation", () => {
      const { render } = setup();
      const number = 1000000;
      expect(
        render(<Localize value={number} number={{ notation: "compact" }} />),
      ).toBe("1M");
    });
  });

  describe("date formatting options", () => {
    it("should format with dayjs format string - LLL", () => {
      const { render, i18n, dateTime } = setup();
      const date = dateTime.utc("2024-09-24T00:45:00Z").toDate();
      const formatted = render(<Localize value={date} date="LLL" />);
      // Format depends on local timezone, so just check it contains the key parts
      expect(formatted).toContain("September");
      expect(formatted).toContain("2024");
      i18n.setLang("fr");
      const frFormatted = render(<Localize value={date} date="LLL" />);
      expect(frFormatted).toContain("septembre");
      expect(frFormatted).toContain("2024");
    });

    it("should format with dayjs format string - YYYY-MM-DD", () => {
      const { render } = setup();
      const date = new Date("2024-09-23T23:45:00Z");
      expect(render(<Localize value={date} date="YYYY-MM-DD" />)).toBe(
        "2024-09-24",
      );
    });

    it("should format with dayjs format string - dddd, MMMM D YYYY", () => {
      const { render } = setup();
      const date = new Date("2024-09-23T23:45:00Z");
      expect(render(<Localize value={date} date="dddd, MMMM D YYYY" />)).toBe(
        "Tuesday, September 24 2024",
      );
    });

    it("should format with fromNow for Date", () => {
      const { render, dateTime } = setup();
      dateTime.pause();
      const date = dateTime.now().subtract(2, "hour").toDate();
      const result = render(<Localize value={date} date="fromNow" />);
      expect(result).toBe("2 hours ago");
    });

    it("should format with fromNow for DateTime", () => {
      const { render, dateTime } = setup();
      dateTime.pause();
      const date = dateTime.now().subtract(3, "day");
      const result = render(<Localize value={date} date="fromNow" />);
      expect(result).toBe("3 days ago");
    });

    it("should format DateTime with dayjs format string", () => {
      const { render, dateTime } = setup();
      const date = dateTime.of("2024-09-23T23:45:00Z");
      expect(render(<Localize value={date} date="YYYY-MM-DD" />)).toBe(
        "2024-09-24",
      );
    });

    it("should format with Intl.DateTimeFormatOptions", () => {
      const { render } = setup();
      const date = new Date("2024-09-23T23:45:00Z");
      expect(
        render(
          <Localize
            value={date}
            date={{
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }}
          />,
        ),
      ).toBe("Tuesday, September 24, 2024");
    });

    it("should format with Intl.DateTimeFormatOptions and locale", () => {
      const { render, i18n } = setup();
      const date = new Date("2024-09-23T23:45:00Z");
      i18n.setLang("fr");
      expect(
        render(
          <Localize
            value={date}
            date={{
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }}
          />,
        ),
      ).toBe("mardi 24 septembre 2024");
    });

    it("should format DateTime with Intl.DateTimeFormatOptions", () => {
      const { render, dateTime } = setup();
      const date = dateTime.utc("2024-09-24T00:45:00Z");
      const formatted = render(
        <Localize
          value={date}
          date={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }}
        />,
      );
      // Format depends on local timezone, so just verify it contains time parts
      expect(formatted).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/);
    });
  });

  describe("string date parsing", () => {
    it("should parse string date when dateOptions is provided", () => {
      const { render } = setup();
      const dateString = "2024-09-24T12:00:00Z";
      expect(render(<Localize value={dateString} date="YYYY-MM-DD" />)).toBe(
        "2024-09-24",
      );
    });

    it("should parse string date with format options", () => {
      const { render } = setup();
      const dateString = "2024-09-24T12:00:00Z";
      expect(render(<Localize value={dateString} date="LLL" />)).toContain(
        "September",
      );
    });

    it("should parse string date with timezone", () => {
      const { render } = setup();
      const dateString = "2024-09-24T12:00:00Z";
      expect(
        render(
          <Localize
            value={dateString}
            timezone="America/New_York"
            date="YYYY-MM-DD HH:mm"
          />,
        ),
      ).toBe("2024-09-24 08:00");
    });

    it("should return string as-is when no dateOptions provided", () => {
      const { render } = setup();
      const dateString = "2024-09-24T12:00:00Z";
      expect(render(<Localize value={dateString} />)).toBe(dateString);
    });
  });

  describe("timezone formatting", () => {
    it("should format Date with timezone using Intl", () => {
      const { render } = setup();
      const date = new Date("2024-09-24T12:00:00Z");
      expect(
        render(<Localize value={date} timezone="America/New_York" />),
      ).toBe("9/24/2024");
    });

    it("should format Date with timezone and dateOptions", () => {
      const { render } = setup();
      const date = new Date("2024-09-24T12:00:00Z");
      expect(
        render(
          <Localize
            value={date}
            timezone="America/New_York"
            date={{
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZoneName: "short",
            }}
          />,
        ),
      ).toContain("EDT");
    });

    it("should format Date with timezone using dayjs format", () => {
      const { render } = setup();
      const date = new Date("2024-09-24T12:00:00Z");
      const formatted = render(
        <Localize
          value={date}
          timezone="America/New_York"
          date="YYYY-MM-DD HH:mm"
        />,
      );
      expect(formatted).toBe("2024-09-24 08:00");
    });

    it("should format DateTime with timezone using dayjs format", () => {
      const { render, dateTime } = setup();
      const date = dateTime.utc("2024-09-24T12:00:00Z");
      const formatted = render(
        <Localize
          value={date}
          timezone="Europe/Paris"
          date="YYYY-MM-DD HH:mm"
        />,
      );
      expect(formatted).toBe("2024-09-24 14:00");
    });

    it("should format DateTime with timezone and Intl options", () => {
      const { render, dateTime } = setup();
      const date = dateTime.utc("2024-09-24T12:00:00Z");
      const formatted = render(
        <Localize
          value={date}
          timezone="Asia/Tokyo"
          date={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
        />,
      );
      expect(formatted).toBe("21:00");
    });

    it("should format DateTime with timezone using LLL format", () => {
      const { render, dateTime } = setup();
      const date = dateTime.utc("2024-09-24T12:00:00Z");
      const formatted = render(
        <Localize value={date} timezone="America/Los_Angeles" date="LLL" />,
      );
      expect(formatted).toContain("September");
      expect(formatted).toContain("2024");
      expect(formatted).toContain("5:00 AM");
    });

    it("should respect locale and timezone together", () => {
      const { render, i18n, dateTime } = setup();
      const date = dateTime.utc("2024-09-24T12:00:00Z");
      i18n.setLang("fr");
      const formatted = render(
        <Localize value={date} timezone="Europe/Paris" date="LLL" />,
      );
      console.log(formatted);
      expect(formatted).toContain("septembre");
      expect(formatted).toContain("2024");
      expect(formatted).toContain("14:00");
    });
  });
});
