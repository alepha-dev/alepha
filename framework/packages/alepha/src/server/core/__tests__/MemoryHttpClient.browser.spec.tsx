import { waitFor } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { useInject, useQuery } from "alepha/react";
import { renderWithAlepha } from "alepha/testing/react";
import { describe, it } from "vitest";

import { HttpClient, MemoryHttpClient } from "../index.browser.ts";

/**
 * The browser build of `alepha/server` exports the double too, and a
 * component reading through the container's HttpClient sees its routes
 * (#Q3325).
 */
describe("MemoryHttpClient in the browser", () => {
  class Weather {
    http = $inject(HttpClient);

    async today() {
      const res = await this.http.fetch("https://api.example.com/today");
      return res.data as { sky: string };
    }
  }

  const Today = () => {
    const weather = useInject(Weather);
    const query = useQuery({ handler: () => weather.today() }, []);
    return <p data-testid="sky">{query.data?.sky ?? "..."}</p>;
  };

  it("answers a useQuery under renderWithAlepha", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaDateTime)
      .with({ provide: HttpClient, use: MemoryHttpClient })
      .with(Weather);
    const http = alepha.inject(MemoryHttpClient);
    http.on("GET", "https://api.example.com/today", () => ({ sky: "clear" }));

    const ui = await renderWithAlepha(<Today />, { alepha });

    await waitFor(() => {
      expect(ui.getByTestId("sky").textContent).toBe("clear");
    });
    expect(http.calls("GET", "https://api.example.com/today")).toHaveLength(1);
  });
});
