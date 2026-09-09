import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import TimeAgo from "./time-ago.tsx";

/**
 * The two halves of what this component exists for: a relative label a reader
 * can act on, and a server render that does not depend on the clock.
 *
 * The second is the one that cannot be checked by looking. A `fromNow()`
 * string is computed from the current time, so a component that renders it on
 * the server produces different HTML on each side of hydration and React
 * throws #418 - a mismatch that surfaces as a console error on a page that
 * otherwise looks correct. Asserting it here is how the guard stays inside the
 * component instead of being remembered at each call site, which is what the
 * 11-guards-against-42-call-sites count showed does not happen.
 */
describe("TimeAgo", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const setup = async () => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    // Pinned, so "an hour ago" cannot become "2 hours ago" between the arrange
    // and the assert.
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();

    return { alepha, dateTime };
  };

  it("renders the exact datetime on the server, never the relative one", async () => {
    const { alepha, dateTime } = await setup();
    const anHourAgo = dateTime.of(dateTime.now()).subtract(1, "hour").toDate();

    const html = renderToString(
      <AlephaContext value={alepha}>
        <TimeAgo value={anHourAgo} />
      </AlephaContext>,
    );

    // The server has no business guessing what "now" will be when this
    // hydrates. It renders the instant.
    expect(html).not.toContain("ago");
    expect(html).toContain(String(dateTime.of(anHourAgo).format("lll")));
  });

  it("carries the exact datetime as its title, on both sides", async () => {
    const { alepha, dateTime } = await setup();
    const anHourAgo = dateTime.of(dateTime.now()).subtract(1, "hour").toDate();
    const exact = String(dateTime.of(anHourAgo).format("lll"));

    expect(
      renderToString(
        <AlephaContext value={alepha}>
          <TimeAgo value={anHourAgo} />
        </AlephaContext>,
      ),
    ).toContain(`title="${exact}"`);

    render(
      <AlephaContext value={alepha}>
        <TimeAgo value={anHourAgo} />
      </AlephaContext>,
    );
    expect(screen.getByTitle(exact)).toBeDefined();
  });

  it("reads as time ago once mounted", async () => {
    const { alepha, dateTime } = await setup();
    const anHourAgo = dateTime.of(dateTime.now()).subtract(1, "hour").toDate();

    render(
      <AlephaContext value={alepha}>
        <TimeAgo value={anHourAgo} />
      </AlephaContext>,
    );

    expect(screen.getByText(/ago$/)).toBeDefined();
  });

  it("puts the caller's className on the element that carries the title", async () => {
    const { alepha, dateTime } = await setup();
    const exact = String(dateTime.of(dateTime.now()).format("lll"));

    render(
      <AlephaContext value={alepha}>
        <TimeAgo value={dateTime.now()} className="text-muted-foreground" />
      </AlephaContext>,
    );

    // One element, not a class on a wrapper around a titled child: the sweep
    // collapsed the span that used to carry the class, so a caller that passes
    // one must get it on the thing it wraps.
    expect(screen.getByTitle(exact).className).toContain(
      "text-muted-foreground",
    );
  });
});
