/**
 * SaaS auth layout — route parent for every /auth/* page (login, register,
 * reset-password, verify-email), mounted as children so they share it.
 *
 * The auth-* blocks from the registry are self-contained full-page layouts
 * (they own their own min-height, centering and padding), so this layout is
 * just a passthrough — wrapping them in another centered, padded, full-height
 * box would overflow the viewport and add a scrollbar.
 */
export const saasAuthLayoutTsx = () =>
  `import { NestedView } from "alepha/react/router";

const AuthLayout = () => {
  return (
    <div className="bg-background">
      <NestedView />
    </div>
  );
};

export default AuthLayout;
`;
