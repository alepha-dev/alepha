import { createRequire } from "node:module";

export const importViteReact = async (): Promise<any> => {
  // Add React plugin for JSX/TSX compilation
  try {
    const { default: viteReact } = createRequire(import.meta.url)(
      "@vitejs/plugin-react",
    );
    return viteReact;
  } catch {
    // @vitejs/plugin-react not installed, skip
  }
};
