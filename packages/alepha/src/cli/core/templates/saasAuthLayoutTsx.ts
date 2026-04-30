/**
 * SaaS auth layout — wraps every /auth/* page with a centered card.
 * Routes (login, register, reset-password, verify-email) are mounted as
 * children so they share this shell.
 */
export const saasAuthLayoutTsx = () =>
  `import { NestedView } from "alepha/react/router";

const AuthLayout = () => {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <NestedView />
      </div>
    </div>
  );
};

export default AuthLayout;
`;
