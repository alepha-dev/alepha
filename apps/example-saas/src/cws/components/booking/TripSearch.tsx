import { Flex } from "@mantine/core";
import { useState } from "react";
import type { StationResource } from "../../../api/topology/schemas/stationSchema.ts";
import type { TripResource as Trip } from "../../../api/topology/schemas/tripSchema.ts";
import { ComparisonSection } from "./search/ComparisonSection.tsx";
import { FeaturesSection } from "./search/FeaturesSection.tsx";
import { Footer } from "./search/Footer.tsx";
import { HeroSection } from "./search/HeroSection.tsx";
import { PaymentMethods } from "./search/PaymentMethods.tsx";
import { PopularRoutes } from "./search/PopularRoutes.tsx";
import { SearchForm, type SearchFormState } from "./search/SearchForm.tsx";
import { StatsSection } from "./search/StatsSection.tsx";
import { TestimonialsSection } from "./search/TestimonialsSection.tsx";

/**
 * Props passed from $page resolve (SSR data fetching)
 */
export interface TripSearchProps {
  stations: StationResource[];
  popularRoutes: Trip[];
}

const TripSearch = (props: TripSearchProps) => {
  const [formState, setFormState] = useState<SearchFormState>({
    from: null,
    to: null,
    date: null,
  });

  const handleRouteSelect = (route: Trip) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    setFormState({
      from: route.departureStation,
      to: route.arrivalStation,
      date: tomorrow,
    });

    window.scrollTo({ top: 400, behavior: "smooth" });
  };

  return (
    <Flex flex={1} direction="column" bg="var(--alepha-background)">
      <HeroSection />
      <SearchForm
        stations={props.stations}
        value={formState}
        onChange={setFormState}
      />
      <FeaturesSection />
      <StatsSection />
      <PopularRoutes
        routes={props.popularRoutes}
        onRouteSelect={handleRouteSelect}
      />
      <TestimonialsSection />
      <ComparisonSection />
      <PaymentMethods />
      <Footer />
    </Flex>
  );
};

export default TripSearch;
