import { JsonSchemaCodec, TypeBox, t } from "@alepha/core";
import dayjs from "dayjs";
import type { TSchema } from "typebox";

export class TDateTime extends TypeBox.Type.Base<Date> {
  public override Check(value: unknown): value is Date {
    return value instanceof Date;
  }
  public override Errors(value: unknown): object[] {
    return !this.Check(value) ? [{ message: "not a Date" }] : [];
  }
}

export class DrizzleSchemaCodec extends JsonSchemaCodec {
  protected transformType(schema: TSchema): TSchema | false | void {
    if (this.guard.isBigInt(schema)) {
      return t.raw.BigInt(); // original BigInt support
    }
    if (this.guard.isDateTime(schema)) {
      return t.raw
        .Codec(new TDateTime())
        .Decode((val) => dayjs(val))
        .Encode((dt: dayjs.Dayjs) => dt.toDate());
    }
    if (this.guard.isDate(schema)) {
      return t.raw
        .Codec(new TDateTime())
        .Decode((val) => dayjs(val))
        .Encode((dt: dayjs.Dayjs) => dt.toDate());
    }
  }
}
