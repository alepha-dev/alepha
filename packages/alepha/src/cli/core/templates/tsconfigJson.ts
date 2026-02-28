export const tsconfigJson = () =>
  `
{
  "extends": "alepha/tsconfig.base",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
`.trim();
