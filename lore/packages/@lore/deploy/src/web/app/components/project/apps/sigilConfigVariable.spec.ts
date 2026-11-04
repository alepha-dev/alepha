import { describe, it } from "vitest";

import {
  readSigilConfigVariable,
  sigilConfigDefaults,
  writeSigilConfigVariable,
} from "./sigilConfigVariable.ts";

describe("sigilConfigVariable", () => {
  describe("readSigilConfigVariable", () => {
    it("starts from the defaults when the copy has no SIGIL_CONFIG", ({
      expect,
    }) => {
      const read = readSigilConfigVariable(undefined);

      expect(read.state).toBe("unset");
      expect(read.config).toEqual(sigilConfigDefaults());
    });

    it("reads a stored variable over the defaults", ({ expect }) => {
      const read = readSigilConfigVariable({
        kind: "variable",
        value: '{"vitals":false,"feedbackButton":"hidden"}',
      });

      expect(read.state).toBe("set");
      expect(read.config.vitals).toBe(false);
      expect(read.config.feedbackButton).toBe("hidden");
      expect(read.config.analytics).toBe(true);
    });

    it("says it cannot read a secret or a value that does not parse", ({
      expect,
    }) => {
      expect(readSigilConfigVariable({ kind: "secret" }).state).toBe(
        "unreadable",
      );
      expect(
        readSigilConfigVariable({ kind: "variable", value: "not json" }).state,
      ).toBe("unreadable");
      expect(
        readSigilConfigVariable({ kind: "variable", value: '{"vitals":1}' })
          .state,
      ).toBe("unreadable");
    });
  });

  describe("writeSigilConfigVariable", () => {
    it("writes only the switches that differ from the defaults", ({
      expect,
    }) => {
      const value = writeSigilConfigVariable({
        ...sigilConfigDefaults(),
        vitals: false,
        feedbackButtonExcludedPaths: ["/feedback/**"],
      });

      expect(JSON.parse(value ?? "")).toEqual({
        vitals: false,
        feedbackButtonExcludedPaths: ["/feedback/**"],
      });
    });

    it("answers nothing when every switch is at its default", ({ expect }) => {
      expect(writeSigilConfigVariable(sigilConfigDefaults())).toBeUndefined();
    });

    it("round-trips through the reader", ({ expect }) => {
      const config = {
        ...sigilConfigDefaults(),
        analytics: false,
        reportOutsideProduction: true,
      };

      const read = readSigilConfigVariable({
        kind: "variable",
        value: writeSigilConfigVariable(config),
      });

      expect(read.config).toEqual(config);
    });
  });
});
