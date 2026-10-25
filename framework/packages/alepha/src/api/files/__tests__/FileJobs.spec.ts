import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it, vi } from "vitest";

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

    // travel() fires the hourly cron, whose purge CronProvider runs
    // fire-and-forget, so it can still be deleting when the trigger below
    // starts. Today the trigger runs a purge of its own (the cron lock is held
    // per process, see JobProvider.acquireCronLock); behind a lock that
    // dedupes in-process, as $scheduler's did, it would return at once. Either
    // way a purge after the +1h expiry lands, so wait for its outcome rather
    // than a guessed delay. The deadline stays under the 10s test timeout, so
    // a purge that never lands still fails on this assertion.
    await jobs.purgeFiles.trigger();

    await vi.waitFor(
      async () => {
        expect(await list()).toHaveLength(2);
      },
      { timeout: 5_000, interval: 20 },
    );
  });
});
