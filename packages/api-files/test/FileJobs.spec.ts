import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { FileSystemProvider } from "@alepha/file";
import { describe, expect, it } from "vitest";
import { FileService } from "../src";
import { FileJobs } from "../src/jobs/FileJobs.ts";

describe("FileJobRegistry", () => {
  const alepha = Alepha.create();
  const jobs = alepha.inject(FileJobs);
  const service = alepha.inject(FileService);
  const dtp = alepha.inject(DateTimeProvider);
  const fs = alepha.inject(FileSystemProvider);

  const createFile = (
    textOrOpts: string | { text: string; name?: string; type?: string },
    opts?: { name?: string; type?: string },
  ) => {
    if (typeof textOrOpts === "string") {
      return fs.createFile({ text: textOrOpts, ...(opts || {}) });
    }
    return fs.createFile(textOrOpts);
  };

  it("should remove expired files", { retry: 2 }, async () => {
    const file = createFile("");

    await Promise.all([
      service.uploadFile(file),
      service.uploadFile(file, {
        expirationDate: new Date().toISOString(),
      }),
      service.uploadFile(file, {
        expirationDate: dtp.now().add(1, "hour").toISOString(),
      }),
      service.uploadFile(file, {
        expirationDate: dtp.now().add(4, "hours").toISOString(),
      }),
    ]);

    const list = () => service.findFiles().then((it) => it.content);

    expect(await list()).toHaveLength(4);

    await jobs.purgeFiles.trigger();

    expect(await list()).toHaveLength(3);

    await dtp.travel(2, "hours");

    expect(await list()).toHaveLength(2); // TODO: fail sometimes here
  });
});
