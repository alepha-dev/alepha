import type { Page } from "alepha";
import type { FileResource, StorageStats } from "alepha/api/files";

/**
 * Fake stored files, paged in memory, plus the storage stats that feed the
 * bucket filter.
 *
 * ⚠️ The stats are DERIVED from the rows rather than written out. `AdminFiles`
 * builds its bucket filter from `stats.byBucket`, so a hand-written stat block
 * would let the filter offer a bucket no row belongs to, which looks like a
 * broken filter rather than a stale fixture.
 */
export class ShowcaseFiles {
  public stats(): StorageStats {
    const rows = this.rows();
    const buckets = new Map<string, { totalSize: number; fileCount: number }>();
    const mimes = new Map<string, number>();

    for (const row of rows) {
      const b = buckets.get(row.bucket) ?? { totalSize: 0, fileCount: 0 };
      b.totalSize += row.size;
      b.fileCount += 1;
      buckets.set(row.bucket, b);
      mimes.set(row.mimeType, (mimes.get(row.mimeType) ?? 0) + 1);
    }

    return {
      totalSize: rows.reduce((n, r) => n + r.size, 0),
      totalFiles: rows.length,
      byBucket: [...buckets].map(([bucket, s]) => ({ bucket, ...s })),
      byMimeType: [...mimes].map(([mimeType, fileCount]) => ({
        mimeType,
        fileCount,
      })),
    };
  }

  public paginate(query: ShowcaseFileQuery): Page<FileResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();

    const search = String(query.search ?? "").toLowerCase();
    if (search) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(search));
    }
    if (query.bucket) {
      rows = rows.filter((r) => r.bucket === query.bucket);
    }

    const offset = number * size;
    const content = rows.slice(offset, offset + size);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));

    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  /**
   * A spread of mime types and two buckets, so the type icons and the bucket
   * filter both have something to distinguish.
   */
  public rows(): FileResource[] {
    const seed: [string, string, string, number][] = [
      ["quarterly-report.pdf", "documents", "application/pdf", 2_412_336],
      ["logo.svg", "public", "image/svg+xml", 14_802],
      ["hero.png", "public", "image/png", 842_113],
      ["invoice-2026-08.pdf", "documents", "application/pdf", 188_240],
      ["export.csv", "documents", "text/csv", 4_920_331],
      ["avatar.jpg", "public", "image/jpeg", 62_004],
      ["backup.zip", "documents", "application/zip", 91_442_880],
      ["notes.md", "documents", "text/markdown", 3_112],
    ];

    return seed.map(([name, bucket, mimeType, size], i) => ({
      id: `00000000-0000-4000-c000-${String(i + 1).padStart(12, "0")}`,
      version: 1,
      createdAt: this.at(24 * (i + 1)),
      updatedAt: this.at(24 * (i + 1)),
      organizationId: undefined,
      blobId: `blob_${String(i + 1).padStart(6, "0")}`,
      creator: `00000000-0000-4000-8000-${String((i % 4) + 1).padStart(12, "0")}`,
      creatorRealm: "showcase",
      creatorName: [
        "Ada Lovelace",
        "Alan Turing",
        "Grace Hopper",
        "Barbara Liskov",
      ][i % 4],
      bucket,
      expirationDate: undefined,
      name,
      originalName: name,
      size,
      mimeType,
      tags: i % 3 === 0 ? ["archive"] : undefined,
      checksum: undefined,
      user: {
        id: `00000000-0000-4000-8000-${String((i % 4) + 1).padStart(12, "0")}`,
        email: ["ada", "alan", "grace", "barbara"][i % 4] + "@alepha.dev",
      },
    })) as unknown as FileResource[];
  }

  protected at(hoursAgo: number): string {
    return new Date(
      Date.UTC(2026, 8, 5, 9, 0) - hoursAgo * 3_600_000,
    ).toISOString();
  }
}

export interface ShowcaseFileQuery {
  page?: number;
  size?: number;
  sort?: string;
  search?: string;
  bucket?: string;
}
