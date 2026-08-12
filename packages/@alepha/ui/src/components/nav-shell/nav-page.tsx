import {
  $page,
  type PageConfigSchema,
  type PagePrimitive,
  type PagePrimitiveOptions,
  type TPropsDefault,
  type TPropsParentDefault,
} from "alepha/react/router";
import { $secure } from "alepha/security";

export interface PageNavOptions<
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
export const $pageNav = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: PageNavOptions<TConfig, TProps, TPropsParent>,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  const { permission, use, nav, ...rest } = options;
  const permissions = permission
    ? Array.isArray(permission)
      ? permission
      : [permission]
    : undefined;

  return $page<TConfig, TProps, TPropsParent>({
    ...rest,
    use: permissions ? [$secure({ permissions }), ...(use ?? [])] : use,
    nav: nav ? { ...nav, permission: nav.permission ?? permission } : nav,
  });
};
