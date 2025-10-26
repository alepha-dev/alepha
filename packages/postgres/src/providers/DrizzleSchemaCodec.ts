import { JsonSchemaCodec, t } from "@alepha/core";
import dayjs from "dayjs";
import type { TSchema } from "typebox";

export class DrizzleSchemaCodec extends JsonSchemaCodec {
  protected transformType(schema: TSchema): TSchema | false | void {
    if (this.guard.isBigInt(schema)) {
      return t.raw.BigInt(); // original BigInt support
    }
    if (this.guard.isDateTime(schema)) {
      return t
        .codec(t.text())
        .Decode((val) => {
          return dayjs(val);
        })
        .Encode((dt: dayjs.Dayjs) => {
          return dt.toISOString();
        });
    }
  }
}
