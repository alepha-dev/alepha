import { beforeEach, describe, expect, it } from "vitest";
import { MemoryShellProvider } from "../providers/MemoryShellProvider.ts";

describe("MemoryShellProvider", () => {
  let shell: MemoryShellProvider;

  beforeEach(() => {
    shell = new MemoryShellProvider();
  });

  describe("run", () => {
    it("should return empty string when no output configured", async () => {
      const result = await shell.run("echo hello");
      expect(result).toBe("");
    });

    it("should return configured output", async () => {
      shell.outputs.set("echo hello", "hello\n");
      const result = await shell.run("echo hello");
      expect(result).toBe("hello\n");
    });

    it("should throw configured error", async () => {
      shell.errors.set("bad-cmd", "Command failed");
      await expect(shell.run("bad-cmd")).rejects.toThrow("Command failed");
    });

    it("should record calls with options", async () => {
      await shell.run("yarn install", { capture: true });
      await shell.run("yarn build");

      expect(shell.calls).toHaveLength(2);
      expect(shell.calls[0].command).toBe("yarn install");
      expect(shell.calls[0].options).toEqual({ capture: true });
      expect(shell.calls[1].command).toBe("yarn build");
    });
  });

  describe("configure", () => {
    it("should configure outputs, errors, and installed commands", () => {
      shell.configure({
        outputs: { "echo hi": "hi" },
        errors: { fail: "fail!" },
        installedCommands: ["node", "yarn"],
      });

      expect(shell.outputs.get("echo hi")).toBe("hi");
      expect(shell.errors.get("fail")).toBe("fail!");
      expect(shell.installedCommands.has("node")).toBe(true);
      expect(shell.installedCommands.has("yarn")).toBe(true);
    });

    it("should return this for fluent chaining", () => {
      const result = shell.configure({ outputs: { a: "b" } });
      expect(result).toBe(shell);
    });
  });

  describe("wasCalled", () => {
    it("should return true when command was called", async () => {
      await shell.run("git status");
      expect(shell.wasCalled("git status")).toBe(true);
    });

    it("should return false when command was not called", () => {
      expect(shell.wasCalled("git status")).toBe(false);
    });
  });

  describe("wasCalledMatching", () => {
    it("should match commands by regex", async () => {
      await shell.run("yarn install --frozen-lockfile");
      expect(shell.wasCalledMatching(/yarn install/)).toBe(true);
      expect(shell.wasCalledMatching(/npm install/)).toBe(false);
    });
  });

  describe("getCallsMatching", () => {
    it("should return matching calls", async () => {
      await shell.run("yarn install");
      await shell.run("yarn build");
      await shell.run("git push");

      const yarnCalls = shell.getCallsMatching(/^yarn/);
      expect(yarnCalls).toHaveLength(2);
      expect(yarnCalls[0].command).toBe("yarn install");
      expect(yarnCalls[1].command).toBe("yarn build");
    });
  });

  describe("isInstalled", () => {
    it("should return true for configured commands", async () => {
      shell.installedCommands.add("node");
      expect(await shell.isInstalled("node")).toBe(true);
    });

    it("should return false for unconfigured commands", async () => {
      expect(await shell.isInstalled("missing-cmd")).toBe(false);
    });
  });

  describe("reset", () => {
    it("should clear all state", async () => {
      shell.configure({
        outputs: { a: "b" },
        errors: { c: "d" },
        installedCommands: ["node"],
      });
      await shell.run("a");

      shell.reset();

      expect(shell.calls).toHaveLength(0);
      expect(shell.outputs.size).toBe(0);
      expect(shell.errors.size).toBe(0);
      expect(shell.installedCommands.size).toBe(0);
    });
  });
});
