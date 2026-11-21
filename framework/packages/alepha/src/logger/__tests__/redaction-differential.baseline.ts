/**
 * Where origin/main printed the marker secret of each payload of
 * `redaction-differential.spec.ts`, recorded before the redaction walk was
 * touched: `<formatter>/<shape>:<sinks>`, with `f` the formatted line, `j`
 * `JSON.stringify(entry.data)` and `i` `util.inspect(entry.data)`. A payload
 * that is absent printed it nowhere.
 *
 * These are the leaks key-based masking has always had (an Error's fields, a
 * Date subclass, a value under an innocent key): the spec holds the walk to
 * "never more than this", it does not bless them.
 */
export const mainBaseline: Record<string, string> = {
  "Error enumerable secret field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:ji pretty/nested:fji pretty/listed:fji pretty/underError:ji cli/top:ji cli/nested:fji cli/listed:fji cli/underError:ji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "Error object field with secret":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:ji pretty/nested:fji pretty/listed:fji pretty/underError:ji cli/top:ji cli/nested:fji cli/listed:fji cli/underError:ji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "Error NON-enumerable secret field":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "Error NON-enumerable secret field + object field":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "Error cause depth 3 secret":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "Error cause plain object secret":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "AggregateError.errors secret":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "AggregateError.errors secret + object field":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "Error with proto toJSON (object field)":
    "json/top:j json/nested:j json/listed:j json/underError:j pretty/top:j pretty/nested:fj pretty/listed:fj pretty/underError:j cli/top:j cli/nested:fj cli/listed:fj cli/underError:j raw/top:j raw/nested:j raw/listed:j raw/underError:j",
  "Error with proto toJSON (no fields)":
    "json/top:j json/nested:j json/listed:j json/underError:j pretty/top:j pretty/nested:fj pretty/listed:fj pretty/underError:j cli/top:j cli/nested:fj cli/listed:fj cli/underError:j raw/top:j raw/nested:j raw/listed:j raw/underError:j",
  "Error with OWN toJSON":
    "json/top:j json/nested:j json/listed:j json/underError:j pretty/top:j pretty/nested:fj pretty/listed:fj pretty/underError:j cli/top:j cli/nested:fj cli/listed:fj cli/underError:j raw/top:j raw/nested:j raw/listed:j raw/underError:j",
  "AlephaError declared-like data secret":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:ji pretty/nested:fji pretty/listed:fji pretty/underError:ji cli/top:ji cli/nested:fji cli/listed:fji cli/underError:ji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "Date subclass with secret field":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "Date subclass toJSON fabricates":
    "json/top:fj json/nested:fj json/listed:fj json/underError:fj pretty/top:j pretty/nested:fj pretty/listed:fj pretty/underError:fj cli/top:j cli/nested:fj cli/listed:fj cli/underError:fj raw/top:j raw/nested:j raw/listed:j raw/underError:j",
  "flat object with fickle getter":
    "json/top:fj pretty/top:fj cli/top:fj raw/top:j",
  "Proxy of flat object answering secret later":
    "json/top:fj pretty/top:fj cli/top:fj raw/top:j",
  "flat with non-enumerable secret":
    "json/top:i pretty/top:i cli/top:i raw/top:i",
  "depth 100 Error":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "depth 101 Error":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "depth 100 Date subclass":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "cycle through Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 9995 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 9995 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 9996 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 9996 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 9997 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 9997 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 9998 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 9998 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 9999 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 9999 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 10000 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 10000 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 10001 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 10001 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
  "budget wide 10002 then Error field":
    "json/top:ji json/nested:ji json/listed:ji json/underError:ji pretty/top:fji pretty/nested:fji pretty/listed:fji pretty/underError:fji cli/top:fji cli/nested:fji cli/listed:fji cli/underError:fji raw/top:ji raw/nested:ji raw/listed:ji raw/underError:ji",
  "budget wide 10002 then Error cause":
    "json/top:i json/nested:i json/listed:i json/underError:i pretty/top:i pretty/nested:i pretty/listed:i pretty/underError:i cli/top:i cli/nested:i cli/listed:i cli/underError:i raw/top:i raw/nested:i raw/listed:i raw/underError:i",
};
