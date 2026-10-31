import { $inject, $store, type FileLike } from "alepha";
import { FileService } from "alepha/api/files";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DbConflictError,
  DbEntityNotFoundError,
  sql,
} from "alepha/orm";
import { NotFoundError } from "alepha/server";

import type { OrderStatus } from "../../entities/orders.ts";
import { DownloadUnavailableError } from "../../errors/CommerceError.ts";
import type { OrderDownload } from "../../providers/OrderDownloadsProvider.ts";
import { OrderService } from "../../services/OrderService.ts";
import { downloadConfig } from "../downloadConfigAtom.ts";
import { type DownloadEntity, downloads } from "../entities/downloads.ts";

/**
 * Delivers digital goods: one link per paid line, expiring and counted.
 *
 * The file itself stays private: it sits in a storage bucket no public route
 * serves, and {@link open} is the only way out.
 */
export class DownloadService {
  /**
   * The order is paid for, and nothing undid that. A partial refund leaves it
   * on sale: {@link open} checks the line itself.
   */
  public static readonly SOLD: OrderStatus[] = [
    "paid",
    "fulfilled",
    "shipped",
    "delivered",
    "partially_refunded",
  ];

  protected readonly repo = $repository(downloads);
  protected readonly orders = $inject(OrderService);
  protected readonly files = $inject(FileService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly config = $store(downloadConfig);

  /**
   * The links of a paid order, issued as they are first asked for. Nothing
   * before payment, which is the whole point.
   */
  public async linksFor(orderId: string): Promise<OrderDownload[]> {
    const order = await this.orders.getById(orderId);
    if (!DownloadService.SOLD.includes(order.status)) {
      return [];
    }

    const issued = await this.issue(orderId);
    return issued
      .filter((it) => it.expiresAt >= this.dateTime.nowISOString())
      .map((it) => ({
        name: it.name,
        url: this.urlOf(it),
        expiresAt: it.expiresAt,
      }));
  }

  /**
   * Hand over the file behind a link, and count it.
   *
   * The count is one conditional update, so two clicks on the last download
   * cannot both have it.
   *
   * @throws NotFoundError for a token nobody issued
   * @throws DownloadUnavailableError when the order or the line was refunded,
   *   the link expired, or its downloads are spent
   */
  public async open(token: string): Promise<FileLike> {
    const row = await this.repo.findOne({ where: { token: { eq: token } } });
    if (!row) {
      throw new NotFoundError("No such download.");
    }

    const order = await this.orders.getById(row.orderId);
    const items = await this.orders.itemsOf(row.orderId);
    const item = items.find((it) => it.id === row.orderItemId);
    if (
      !DownloadService.SOLD.includes(order.status) ||
      !item ||
      item.refundedQuantity >= item.quantity
    ) {
      throw new DownloadUnavailableError({ reason: "refunded" });
    }
    if (row.expiresAt < this.dateTime.nowISOString()) {
      throw new DownloadUnavailableError({ reason: "expired" });
    }

    const file = await this.files.streamFile(row.fileId);

    try {
      await this.repo.updateOne(
        { id: { eq: row.id }, count: { lt: row.maxCount } },
        { count: sql`${this.repo.table.count} + 1` as unknown as number },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) {
        throw new DownloadUnavailableError({ reason: "spent" });
      }
      throw error;
    }

    return file;
  }

  /**
   * One row per line with a file. A line asked for twice at once, by the email
   * and the thank-you page, loses to the unique index and reads the winner's.
   */
  protected async issue(orderId: string): Promise<DownloadEntity[]> {
    const existing = await this.repo.findMany({
      where: { orderId: { eq: orderId } },
    });

    for (const item of await this.orders.itemsOf(orderId)) {
      const fileId = (item.config as { fileId?: string } | undefined)?.fileId;
      if (!fileId || existing.some((it) => it.orderItemId === item.id)) {
        continue;
      }
      try {
        await this.repo.create({
          orderId,
          orderItemId: item.id,
          fileId,
          name: item.name,
          token: this.crypto.randomText(32),
          expiresAt: new Date(
            this.dateTime.nowMillis() +
              this.config.linkTtlDays * 24 * 60 * 60 * 1000,
          ).toISOString(),
          maxCount: this.config.maxDownloads,
        });
      } catch (error) {
        if (!(error instanceof DbConflictError)) {
          throw error;
        }
      }
    }

    return this.repo.findMany({ where: { orderId: { eq: orderId } } });
  }

  protected urlOf(download: DownloadEntity): string {
    return `${this.config.baseUrl}/commerce/downloads/${download.token}`;
  }
}
