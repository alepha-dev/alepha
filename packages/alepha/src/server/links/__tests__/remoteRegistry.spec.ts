import { $hook, Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $client,
  AlephaServerLinks,
  AlephaServerLinksClient,
  LinkProvider,
} from "../index.ts";

class Weather {
  forecast = $action({
    schema: { response: z.text() },
    handler: () => "rain",
  });
}

class Almanac {
  sunrise = $action({
    schema: { response: z.text() },
    handler: () => "06:12",
  });
}

/**
 * Counts the registry fetches this container actually put on the wire.
 *
 * `client:beforeFetch` fires after {@link HttpClient}'s own ETag cache has had
 * its say, so this measures what the per-host cache did rather than what the
 * HTTP layer papered over.
 */
class RegistryProbe {
  public readonly fetched: string[] = [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url }) => {
      if (url.endsWith(LinkProvider.path.apiLinks)) {
        this.fetched.push(url);
      }
    },
  });
}

/**
 * A consumer: the lean module and nothing else. No `$action`, no route, no
 * server. This is the process the epic exists for - a CLI, a worker, a script.
 */
const consumer = () =>
  Alepha.create().with(AlephaServerLinksClient).with(RegistryProbe);

const serve = async (app: new () => any) => {
  const alepha = Alepha.create().with(AlephaServerLinks).with(app);
  await alepha.start();
  return alepha.inject(ServerProvider).hostname;
};

describe("remote link registry", () => {
  it("resolves an action against a remote app, holding no local links", async () => {
    const hostname = await serve(Weather);

    const alepha = consumer();
    await alepha.start();

    // Nothing local to resolve against: this is exactly the state that used to
    // answer `UnauthorizedError: Action forecast not found`.
    expect(alepha.inject(LinkProvider).getServerLinks()).toHaveLength(0);

    const weather = alepha.inject(LinkProvider).client<Weather>({ hostname });
    expect(await weather.forecast()).toBe("rain");
  });

  it("fetches the registry once per host, however many calls follow", async () => {
    const hostname = await serve(Weather);

    const alepha = consumer();
    await alepha.start();

    const weather = alepha.inject(LinkProvider).client<Weather>({ hostname });
    await weather.forecast();
    await weather.forecast();
    await weather.forecast();

    expect(alepha.inject(RegistryProbe).fetched).toEqual([
      `${hostname}${LinkProvider.path.apiLinks}`,
    ]);
  });

  it("holds two remotes at once, neither evicting the other", async () => {
    const weatherHost = await serve(Weather);
    const almanacHost = await serve(Almanac);

    const alepha = consumer();
    await alepha.start();

    const links = alepha.inject(LinkProvider);
    const weather = links.client<Weather>({ hostname: weatherHost });
    const almanac = links.client<Almanac>({ hostname: almanacHost });

    // Interleaved, because a single shared slot would only show itself here:
    // each call would evict the other's registry and refetch.
    expect(await weather.forecast()).toBe("rain");
    expect(await almanac.sunrise()).toBe("06:12");
    expect(await weather.forecast()).toBe("rain");
    expect(await almanac.sunrise()).toBe("06:12");

    expect(alepha.inject(RegistryProbe).fetched.sort()).toEqual(
      [
        `${almanacHost}${LinkProvider.path.apiLinks}`,
        `${weatherHost}${LinkProvider.path.apiLinks}`,
      ].sort(),
    );
  });

  it("says 'not found' for an action the remote does not have", async () => {
    const hostname = await serve(Weather);

    const alepha = consumer();
    await alepha.start();

    const almanac = alepha.inject(LinkProvider).client<Almanac>({ hostname });

    await expect(almanac.sunrise()).rejects.toThrow("Action sunrise not found");
  });

  it("names the host when the registry cannot be fetched", async () => {
    const alepha = consumer();
    await alepha.start();

    const gone = alepha
      .inject(LinkProvider)
      .client<Weather>({ hostname: "http://127.0.0.1:1" });

    // Not an empty registry, which would report `Action forecast not found`
    // and send the reader hunting for a routing or permission bug.
    await expect(gone.forecast()).rejects.toThrow(
      "Could not fetch the action registry of http://127.0.0.1:1/api/_links",
    );
  });

  it("refuses a hostname carrying a path", async () => {
    const alepha = consumer();
    await alepha.start();

    const weather = alepha
      .inject(LinkProvider)
      .client<Weather>({ hostname: "https://api.example.com/v1" });

    await expect(weather.forecast()).rejects.toThrow(
      "expected an origin with no path",
    );
  });

  it("works through the $client primitive, not just the provider", async () => {
    const hostname = await serve(Weather);

    class Cli {
      weather = $client<Weather>({ hostname });

      report = async () => `today: ${await this.weather.forecast()}`;
    }

    const alepha = consumer().with(Cli);
    await alepha.start();

    expect(await alepha.inject(Cli).report()).toBe("today: rain");
  });
});
