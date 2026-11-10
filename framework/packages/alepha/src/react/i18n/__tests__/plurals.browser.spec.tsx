import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { Translate } from "../components/Translate.tsx";
import { useI18n } from "../hooks/useI18n.ts";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * A locale switch in the browser re-selects every variant with the new
 * language's rules (#Q3330): 2 is `other` in English and `few` in Polish.
 */
describe("plurals across a locale switch", () => {
  class App {
    en = $dictionary({
      lazy: async () => ({
        default: {
          files: { one: "{count} file", other: "{count} files" },
          greeting: "Hello {name}",
          status: { open: "Open", other: "Unknown" },
        },
      }),
    });
    pl = $dictionary({
      lazy: async () => ({
        default: {
          files: {
            one: "{count} plik",
            few: "{count} pliki",
            many: "{count} plików",
            other: "{count} pliku",
          },
        },
      }),
    });
  }

  const Files = () => {
    const { tr } = useI18n();
    return (
      <>
        <span data-testid="tr">{tr("files", { count: 2 })}</span>
        <span data-testid="component">
          <Translate k="files" count={5} />
        </span>
        <span data-testid="named">
          <Translate k="greeting" args={{ name: "Ada" }} />
        </span>
        <span data-testid="select">
          <Translate k="status" select="open" />
        </span>
        <span data-testid="fallback">
          <Translate
            k="missing"
            count={1}
            fallback={{ one: "{count} thing", other: "{count} things" }}
          />
        </span>
      </>
    );
  };

  it("re-selects with the new language's rules", async () => {
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);
    await alepha.start();

    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <Files />
      </AlephaContext.Provider>,
    );

    expect(ui.getByTestId("tr").textContent).toBe("2 files");
    expect(ui.getByTestId("component").textContent).toBe("5 files");
    expect(ui.getByTestId("fallback").textContent).toBe("1 thing");
    // #Q3331: <Translate> takes named arguments and select too.
    expect(ui.getByTestId("named").textContent).toBe("Hello Ada");
    expect(ui.getByTestId("select").textContent).toBe("Open");

    await act(async () => {
      await i18n.setLang("pl");
    });

    expect(ui.getByTestId("tr").textContent).toBe("2 pliki");
    expect(ui.getByTestId("component").textContent).toBe("5 plików");
    expect(ui.getByTestId("fallback").textContent).toBe("1 thing");
  });
});
