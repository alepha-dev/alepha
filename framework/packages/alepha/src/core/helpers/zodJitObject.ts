import * as mini from "zod/mini";
import { $constructor, $ZodObjectJIT, util } from "zod/v4/core";

/**
 * zod/mini's object, with classic zod's compiled parser.
 *
 * ## Why
 *
 * `mini.object` parses with zod's interpreter: per property, a closure call,
 * a result object and a check of its issues. Classic zod compiles each
 * object shape, on its first parse, into one function that reads every
 * property in place. On a 100-row JSON list the response validation took
 * twice as long under mini (24 µs against 12.6 µs per list), which was the
 * one endpoint where Alepha used more CPU than Express doing the same job.
 *
 * The compiler is classic's own (`$ZodObjectJIT`), so what parses, and the
 * issues a failure reports, are what classic zod gives. It needs `new
 * Function`: where that is refused zod's `allowsEval` probe says so and the
 * interpreter runs, as before. Cloudflare Workers is detected by name and
 * never probed.
 *
 * ## Same identity as mini's object
 *
 * Declared under the trait name `ZodMiniObject`, so `instanceof
 * mini.ZodMiniObject` holds (zod's `instanceof` checks traits) and every
 * `z.schema.isObject` keeps working. Clones (`extend`, `pick`, `partial`...)
 * are built from `_zod.constr`, so they compile too. The chain methods are
 * installed on its prototype with mini's, see `installZodChain`.
 *
 * Not used in the browser (see {@link ZodJitObjectFactory.create}).
 */
export const ZodMiniJitObject: typeof mini.ZodMiniObject = $constructor(
  "ZodMiniObject",
  (inst: any, def: any) => {
    ($ZodObjectJIT as any).init(inst, def);
    (mini.ZodMiniType as any).init(inst, def);
    util.installLazyProp(
      inst,
      "shape",
      (self: any) => self._zod.def.shape,
      false,
    );
  },
) as any;

/**
 * Which object constructor `z.object` builds with.
 */
export class ZodJitObjectFactory {
  /**
   * Whether this runtime gets the compiled parser: every one but the
   * browser. There, zod's probe for `new Function` is itself a violation of
   * a CSP without `'unsafe-eval'` (Alepha's default sends `script-src
   * 'self'`), reported even though zod catches the throw, and a page's
   * validation runs on a few form fields where the interpreter is enough.
   */
  public static enabled(): boolean {
    return typeof window === "undefined";
  }

  /**
   * `mini.object`, built with {@link ZodMiniJitObject} where enabled.
   */
  public static create(shape?: any, params?: any): any {
    if (!ZodJitObjectFactory.enabled()) {
      return mini.object(shape, params);
    }
    return new ZodMiniJitObject({
      type: "object",
      shape: shape ?? {},
      ...util.normalizeParams(params),
    } as any);
  }
}
