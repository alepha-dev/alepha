import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { FileJobs, FileService } from "../index.ts";

describe("FileJobRegistry", () => {
  it("should remove expired files", { retry: 3 }, async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const jobs = alepha.inject(FileJobs);
    const service = alepha.inject(FileService);
    const dtp = alepha.inject(DateTimeProvider);
    const fs = alepha.inject(FileSystemProvider);

    const createFile = (
      textOrOpts: string | { text: string; name?: string; type?: string },
      opts?: { name?: string; type?: string },
    ) => {
      if (typeof textOrOpts === "string") {
        return fs.createFile({ text: textOrOpts, ...opts });
      }
      return fs.createFile(textOrOpts);
    };

    await alepha.start();

    await service.fileRepository.clear();

    const file = createFile("");

    await Promise.all([
      service.uploadFile(file),
      service.uploadFile(file, {
        expirationDate: dtp.nowISOString(),
      }),
      service.uploadFile(file, {
        expirationDate: dtp.now().add(1, "hour").toISOString(),
      }),
      service.uploadFile(file, {
        expirationDate: dtp.now().add(4, "hours").toISOString(),
      }),
    ]);

    const list = async () => {
      const it = await service.findFiles();
      return it.content;
    };

    expect(await list()).toHaveLength(4);

    await jobs.purgeFiles.trigger();

    expect(await list()).toHaveLength(3);

    await dtp.travel(2, "hours");

    // Time-travel fires the hourly cron, whose purge handler runs asynchronously
    // (CronProvider dispatches handlers fire-and-forget) and holds the scheduler
    // lock while in flight. Let that settle so the manual trigger below isn't
    // (correctly) deduped by the still-running travel-fired run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await jobs.purgeFiles.trigger();

    expect(await list()).toHaveLength(2);
  });
});
