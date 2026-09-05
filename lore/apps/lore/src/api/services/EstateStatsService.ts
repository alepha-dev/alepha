import type { Estate } from "../entities/estates.ts";
import type { EstateStatsFrame } from "../schemas/estateStatsFrameSchema.ts";

/**
 * What Lore does with a stats push: the gauge and the series (#1627).
 *
 * The websocket endpoint owns the connection and stamps `lastSeenAt` itself,
 * then hands the validated frame here. This split is deliberate: the
 * endpoint knows sockets and the service knows what a measurement is, and
 * the two facts should not be in one file.
 *
 * ⚠️ A seam in this commit: the gauge upsert onto the row and the
 * `$analytics` series gated by `collectSeries` are #1627's, the next quest.
 * Until then a stats frame updates the row's liveness and nothing else.
 */
export class EstateStatsService {
  async record(estate: Estate, frame: EstateStatsFrame): Promise<void> {
    void estate;
    void frame;
  }
}
