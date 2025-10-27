import type { TSchema } from "@alepha/core";
import { JsonSchemaCodec, t } from "@alepha/core";
import { dayjs } from "@alepha/datetime";

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
        .Encode((dt: any) => {
          if (!dt) return undefined;
          return dt.toISOString();
        });
    }
  }
}
