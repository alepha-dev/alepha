import {
  $page,
  type PageCanContext,
  type PageConfigSchema,
  type PagePrimitive,
  type PagePrimitiveOptions,
  type TPropsDefault,
  type TPropsParentDefault,
} from "alepha/react/router";
import { $secure } from "alepha/security";

export interface NavPageOptions<
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
> extends PagePrimitiveOptions<TConfig, TProps, TPropsParent> {
  /**
   * Permission(s) required for this page — wired into BOTH the route gate
   * (`use: [$secure({ permissions })]`) and the nav-entry gate
   * (`nav.permission`) so the two can never drift. A single string requires
   * that permission; an array requires ALL of them (AND), matching `$secure`.
   *
   * For OR / custom logic use `can` instead. An explicit `nav.permission`
   * still takes precedence over this when both are set.
   */
  permission?: string | string[];

  /**
   * Action name(s) this page's content depends on — the nav entry is hidden
   * when the server does not offer them.
   *
   * This is what makes a page mounted for a module the application did not
   * register disappear on its own. `permission` cannot do it: `$secure` on
   * this very page declares the permission it names, so an admin holding the
   * `*` wildcard is granted it whether or not any controller exists. An
   * action name has no such shortcut — `LinkProvider.can()` resolves it
   * against `/api/_links`, which only ever lists actions the server actually
   * registered and this caller may actually call.
   *
   * A single name requires that action; an array requires ALL of them.
   * Name the action the page reads on load, not one behind a button.
   */
  requires?: string | string[];
}

/**
 * `$page` sugar for shell pages: declares the page's `nav` metadata and its
 * permission in one place. The single `permission` value feeds both the real
 * route gate and the UI nav gate, eliminating the repeated permission string
 * that the two would otherwise both need.
 *
 * Pages declared this way are picked up by {@link useNavTree} /
 * {@link NavShell} purely from their `nav` field — no separate nav list.
 */
export const navPage = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: NavPageOptions<TConfig, TProps, TPropsParent>,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  const { permission, requires, use, nav, can: ownCan, ...rest } = options;
  const permissions = permission
    ? Array.isArray(permission)
      ? permission
      : [permission]
    : undefined;

  const requiredActions = requires
    ? Array.isArray(requires)
      ? requires
      : [requires]
    : undefined;

  const can = requiredActions
    ? (ctx: PageCanContext) => {
        if (!requiredActions.every((action) => ctx.has(action))) {
          return false;
        }
        return ownCan ? ownCan(ctx) : true;
      }
    : ownCan;

  return $page<TConfig, TProps, TPropsParent>({
    ...rest,
    use: permissions ? [$secure({ permissions }), ...(use ?? [])] : use,
    nav: nav ? { ...nav, permission: nav.permission ?? permission } : nav,
    can,
  });
};
