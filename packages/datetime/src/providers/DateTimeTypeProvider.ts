import {
  type TStringOptions,
  TypeBox,
  TypeGuard,
  TypeProvider,
  t,
} from "@alepha/core";
import dayjs from "dayjs";

export const datetime = (options?: TStringOptions) =>
  TypeBox.Type.Codec(
    t.text({
      ...options,
      format: "date-time",
    }),
  )
    .Decode((val) => dayjs(val))
    .Encode((dt: dayjs.Dayjs) => dt.toISOString());

export const date = (options?: TStringOptions) =>
  TypeBox.Type.Codec(
    t.text({
      ...options,
      format: "date",
    }),
  )
    .Decode((val) => dayjs(val))
    .Encode((dt: dayjs.Dayjs) => dt.format("YYYY-MM-DD"));

export const time = (options?: TStringOptions) =>
  TypeBox.Type.Codec(
    t.text({
      ...options,
      format: "time",
    }),
  )
    .Decode((val) => {
      return dayjs(`1970-01-01T${val}`);
    })
    .Encode((dt: dayjs.Dayjs) => dt.format("HH:mm:ssZ"));

export const duration = (options?: TStringOptions) =>
  TypeBox.Type.Codec(
    t.text({
      ...options,
      format: "duration",
    }),
  )
    .Decode((val) => dayjs.duration(val))
    .Encode((dur) => dur.toISOString());

export const isDateTimeSchema = (
  schema: unknown,
): schema is ReturnType<typeof datetime> => {
  return t.schema.isString(schema) && schema.format === "date-time";
};

export const isDateSchema = (
  schema: unknown,
): schema is ReturnType<typeof date> => {
  return t.schema.isString(schema) && schema.format === "date";
};

export const isTimeSchema = (
  schema: unknown,
): schema is ReturnType<typeof time> => {
  return t.schema.isString(schema) && schema.format === "time";
};

export const isDurationSchema = (
  schema: unknown,
): schema is ReturnType<typeof duration> => {
  return t.schema.isString(schema) && schema.format === "duration";
};

TypeProvider.prototype.datetime = datetime;
TypeProvider.prototype.date = date;
TypeProvider.prototype.time = time;
TypeProvider.prototype.duration = duration;

TypeGuard.prototype.isDateTime = isDateTimeSchema;
TypeGuard.prototype.isDate = isDateSchema;
TypeGuard.prototype.isTime = isTimeSchema;
TypeGuard.prototype.isDuration = isDurationSchema;
