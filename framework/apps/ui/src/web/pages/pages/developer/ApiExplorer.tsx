import { SwaggerExplorer } from "@alepha/ui/swagger";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `SwaggerExplorer`, the page `$uiSwagger` mounts, over this site's
 * own OpenAPI document (`ShowcaseOpenApi`, at `/docs/json`): every showcase
 * action, with what Alepha declared about it.
 */
const ApiExplorer = () => (
  <Showcase
    id="pages/developer/ApiExplorer"
    title="API explorer"
    description="The site's OpenAPI document, browsed."
  >
    {() => <SwaggerExplorer specUrl="/docs/json" />}
  </Showcase>
);

export default ApiExplorer;
