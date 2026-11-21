import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it, vi } from "vitest";

import { FileJobs, FileService } from "../index.ts";

describe("FileJobs", () => {
  it("should remove expired files", { retry: 3 }, async () => {
    const alepha = Alepha.create().with(AlephaOrmTestPostgres);
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

  it("purges every other expired file when one row cannot be deleted", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmTestPostgres);
    const jobs = alepha.inject(FileJobs);
    const service = alepha.inject(FileService);
    const dtp = alepha.inject(DateTimeProvider);
    const fs = alepha.inject(FileSystemProvider);

    await alepha.start();
    await service.fileRepository.clear();

    // A row whose `$storage` no longer exists in the code: `deleteFile`
    // refuses it. Created first and expired first, so it sits in the first
    // batch of ten.
    const stuck = await service.fileRepository.create({
      blobId: "gone",
      bucket: "removed-storage",
      name: "stuck.txt",
      size: 0,
      mimeType: "text/plain",
      expirationDate: dtp.now().subtract(2, "hours").toISOString(),
    });

    const expired = dtp.now().subtract(1, "hour").toISOString();
    for (let i = 0; i < 25; i++) {
      await service.uploadFile(fs.createFile({ text: "" }), {
        expirationDate: expired,
      });
    }

    // A triggered cron run reports its failure on `job:error`.
    const jobErrors: string[] = [];
    alepha.events.on("job:error", ({ error }) => {
      jobErrors.push(String(error?.message));
    });

    await jobs.purgeFiles.trigger();

    // Every other row is purged, and the run still ends in error.
    expect(jobErrors).toEqual(["Failed to purge 1 of 26 expired files"]);
    const left = await service.fileRepository.findMany({});
    expect(left.map((file) => file.id)).toEqual([stuck.id]);
  });
});
