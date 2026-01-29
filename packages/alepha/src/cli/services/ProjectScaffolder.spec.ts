import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";
import { ProjectScaffolder } from "./ProjectScaffolder.ts";

describe("ProjectScaffolder", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const scaffolder = alepha.inject(ProjectScaffolder);

    return { alepha, scaffolder };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // getAppName
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getAppName", () => {
    it("should return lowercase directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/MyApp")).toBe("myapp");
    });

    it("should remove dashes from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my-cool-app")).toBe("mycoolapp");
    });

    it("should remove underscores from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my_cool_app")).toBe("mycoolapp");
    });

    it("should remove spaces from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my cool app")).toBe("mycoolapp");
    });

    it("should remove dots from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my.cool.app")).toBe("mycoolapp");
    });

    it("should remove digits from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/app123")).toBe("app");
      expect(scaffolder.getAppName("/project/my2app")).toBe("myapp");
      expect(scaffolder.getAppName("/project/v2-app")).toBe("vapp");
    });

    it("should handle combination of special characters", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my-cool_app.v2")).toBe(
        "mycoolappv",
      );
      expect(scaffolder.getAppName("/project/test_app-2.0")).toBe("testapp");
    });

    it("should fallback to 'app' when all characters are removed", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/123")).toBe("app");
      expect(scaffolder.getAppName("/project/---")).toBe("app");
      expect(scaffolder.getAppName("/project/1.2.3")).toBe("app");
      expect(scaffolder.getAppName("/project/_-._")).toBe("app");
    });

    it("should handle deeply nested paths", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/workspace/packages/apps/my-app")).toBe(
        "myapp",
      );
    });

    it("should handle root-level directories", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/myapp")).toBe("myapp");
    });
  });
});
