import {
  type RenderOptions,
  type RenderResult,
  render,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { ReactElement, ReactNode } from "react";

/**
 * Options for renderWithAlepha.
 */
export interface RenderWithAlephaOptions
  extends Omit<RenderOptions, "wrapper"> {
  /**
   * Pre-configured Alepha instance to use.
   * If not provided, a new instance with AlephaLogger will be created.
   */
  alepha?: Alepha;

  /**
   * Whether to automatically start the Alepha instance.
   * @default true
   */
  autoStart?: boolean;

  /**
   * Wrapper component to wrap around the rendered element.
   * Use this for UI framework providers (theme, etc.) or custom context providers.
   *
   * @example
   * ```tsx
   * import { ThemeProvider } from "my-ui-library";
   * renderWithAlepha(<MyComponent />, { wrapper: ThemeProvider });
   * ```
   */
  wrapper?: React.ComponentType<{ children: ReactNode }>;
}

/**
 * Result of renderWithAlepha, extending the standard render result.
 */
export interface RenderWithAlephaResult extends RenderResult {
  /**
   * The Alepha instance used for rendering.
   */
  alepha: Alepha;
}

/**
 * Render a React element with Alepha context for testing.
 *
 * This is a convenience wrapper around `@testing-library/react`'s `render` function
 * that automatically sets up the AlephaContext.Provider.
 *
 * @param element - The React element to render
 * @param options - Render options
 * @returns The render result with the Alepha instance
 *
 * @example
 * ```tsx
 * import { renderWithAlepha } from "alepha/react/testing";
 *
 * test("renders component", async () => {
 *   const { alepha, getByText } = await renderWithAlepha(<MyComponent />);
 *
 *   expect(getByText("Hello")).toBeDefined();
 * });
 * ```
 *
 * @example
 * ```tsx
 * // With custom Alepha configuration
 * import { renderWithAlepha } from "alepha/react/testing";
 * import { MyService, MockService } from "./services";
 *
 * test("renders with mocked service", async () => {
 *   const alepha = Alepha.create().with({ provide: MyService, use: MockService });
 *
 *   const { getByText } = await renderWithAlepha(<MyComponent />, { alepha });
 *
 *   expect(getByText("Mocked")).toBeDefined();
 * });
 * ```
 *
 * @example
 * ```tsx
 * // With UI framework provider
 * import { renderWithAlepha } from "alepha/react/testing";
 * import { ThemeProvider } from "my-ui-library";
 *
 * test("renders themed component", async () => {
 *   const { getByRole } = await renderWithAlepha(
 *     <Button>Click me</Button>,
 *     { wrapper: ThemeProvider }
 *   );
 *
 *   expect(getByRole("button")).toBeDefined();
 * });
 * ```
 */
export const renderWithAlepha = async (
  element: ReactElement,
  options: RenderWithAlephaOptions = {},
): Promise<RenderWithAlephaResult> => {
  const {
    alepha: providedAlepha,
    autoStart = true,
    wrapper: CustomWrapper,
    ...renderOptions
  } = options;

  const alepha = providedAlepha ?? Alepha.create().with(AlephaLogger);

  if (autoStart) {
    await alepha.start();
  }

  const Wrapper = ({ children }: { children: ReactNode }) => {
    return (
      <AlephaContext.Provider value={alepha}>
        {CustomWrapper ? <CustomWrapper>{children}</CustomWrapper> : children}
      </AlephaContext.Provider>
    );
  };

  const result = render(element, {
    wrapper: Wrapper,
    ...renderOptions,
  });

  return {
    ...result,
    alepha,
  };
};

/**
 * Synchronous version of renderWithAlepha for cases where you don't need to await.
 * Note: If autoStart is true (default), you should use the async version instead.
 *
 * @param element - The React element to render
 * @param options - Render options (autoStart defaults to false)
 * @returns The render result with the Alepha instance
 */
export const renderWithAlephaSync = (
  element: ReactElement,
  options: RenderWithAlephaOptions = {},
): RenderWithAlephaResult => {
  const {
    alepha: providedAlepha,
    autoStart = false,
    wrapper: CustomWrapper,
    ...renderOptions
  } = options;

  const alepha = providedAlepha ?? Alepha.create().with(AlephaLogger);

  if (autoStart) {
    // Fire and forget - not recommended, use async version instead
    alepha.start();
  }

  const Wrapper = ({ children }: { children: ReactNode }) => {
    return (
      <AlephaContext.Provider value={alepha}>
        {CustomWrapper ? <CustomWrapper>{children}</CustomWrapper> : children}
      </AlephaContext.Provider>
    );
  };

  const result = render(element, {
    wrapper: Wrapper,
    ...renderOptions,
  });

  return {
    ...result,
    alepha,
  };
};
