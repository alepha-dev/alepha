import type { Wagon } from "../../vehicles/entities/seatLayouts.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StationSeed {
  name: string;
  code: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  platforms?: number;
  description?: string;
  imageUrl?: string;
}

export interface TripSeed {
  from: string;
  to: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  trainNumber: string;
  trainType: string;
  basePrice: number;
  seatLayoutName: string;
}

export interface FareClassSeed {
  code: string;
  name: string;
  description: string;
  priceMultiplier: number;
  isRefundable: boolean;
  isChangeable: boolean;
  changeFeePercent: number;
  refundFeePercent: number;
  minDaysBeforeDeparture: number;
  sortOrder: number;
}

export interface PriceRuleSeed {
  name: string;
  description: string;
  ruleType: "occupancy" | "time_to_departure" | "day_of_week" | "peak_hours";
  config: {
    thresholds?: Array<{ value: number; multiplier: number }>;
    dayMultipliers?: Record<string, number>;
    hourMultipliers?: Record<string, number>;
  };
  priority: number;
}

export interface SeatLayoutSeed {
  name: string;
  description: string;
  trainType: string;
  wagons: Wagon[];
  totalSeats: number;
  firstClassSeats: number;
  secondClassSeats: number;
  totalWagons: number;
  isDefault: boolean;
}

export interface CustomerSeed {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  loyaltyTier: "bronze" | "silver" | "gold" | "platinum";
  loyaltyPoints: number;
  loyaltyPointsLifetime: number;
}

export interface VoucherSeed {
  code: string;
  name: string;
  description: string;
  type:
    | "percentage"
    | "fixed_amount"
    | "free_upgrade"
    | "free_seat_selection"
    | "points_multiplier";
  value: number;
  maxUses: number;
  currentUses: number;
  validFrom: string;
  validUntil: string;
  source:
    | "welcome"
    | "loyalty"
    | "promotion"
    | "compensation"
    | "referral"
    | "birthday"
    | "gift"
    | "partner";
}

export interface AgentSeed {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "admin" | "supervisor" | "support" | "operations";
  employeeId: string;
  department: string;
  jobTitle: string;
}

export interface DeviceSeed {
  type: "gate" | "tvm" | "validator";
  name: string;
  serialNumber: string;
  stationName: string;
  zone: string;
  status: "online" | "offline" | "maintenance";
}

export interface ProductSeed {
  name: string;
  description: string;
  sku: string;
  price: number;
  currency: string;
  category:
    | "food_beverage"
    | "comfort"
    | "entertainment"
    | "travel_accessories"
    | "merchandise"
    | "insurance"
    | "services";
  sellType: "standalone" | "with_booking" | "both";
  trackStock: boolean;
  stock?: number;
  active: boolean;
  taxRate?: number;
  sortOrder: number;
}

export interface ProductOrderSeed {
  orderNumber: string;
  customerEmail?: string;
  customerName?: string;
  channel: "web" | "mobile" | "station" | "onboard" | "agent";
  isBookingAddOn: boolean;
  status:
    | "pending"
    | "confirmed"
    | "processing"
    | "fulfilled"
    | "partially_fulfilled"
    | "cancelled"
    | "refunded";
  items: Array<{
    productSku: string;
    quantity: number;
  }>;
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  paymentMethod?: "card" | "cash" | "voucher" | "invoice";
  createdDaysAgo: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function createStandardWagon(
  wagonNumber: number,
  wagonType: "first_class" | "second_class",
  rowCount: number,
): Wagon {
  const isFirstClass = wagonType === "first_class";
  const seatsPerRow = isFirstClass ? 4 : 5;
  const positions = isFirstClass
    ? ["A", "B", "C", "D"]
    : ["A", "B", "C", "D", "E"];
  const aisleAfter = isFirstClass ? "B" : "B";

  const rows = Array.from({ length: rowCount }, (_, i) => ({
    rowNumber: i + 1,
    seats: positions.map((pos) => ({
      position: pos,
      seatType: (pos === "A" || pos === positions[positions.length - 1]
        ? "window"
        : pos === "B" || pos === "D"
          ? "aisle"
          : "middle") as "window" | "aisle" | "middle",
      seatClass: (isFirstClass ? "first" : "second") as "first" | "second",
      premium: isFirstClass
        ? 25
        : pos === "A" || pos === positions[positions.length - 1]
          ? 5
          : 0,
    })),
    isEmergencyRow: i === 5,
    hasExtraLegroom: i === 0 || i === 5,
  }));

  return {
    wagonNumber,
    wagonType,
    name: `Car ${wagonNumber}`,
    rows,
    seatsPerRow,
    aisleAfterPosition: aisleAfter,
    hasWifi: true,
    hasPowerOutlets: true,
    hasToilet: wagonNumber === 1 || wagonNumber % 3 === 0,
    hasBikeStorage: wagonNumber === 1,
    hasLuggageRack: true,
    totalSeats: rowCount * seatsPerRow,
    firstClassSeats: isFirstClass ? rowCount * seatsPerRow : 0,
    secondClassSeats: isFirstClass ? 0 : rowCount * seatsPerRow,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seat Layouts
// ─────────────────────────────────────────────────────────────────────────────

export const seatLayouts: SeatLayoutSeed[] = [
  {
    name: "AlephaRail Corridor",
    description: "Standard train for Quebec-Windsor corridor",
    trainType: "AR Corridor",
    isDefault: true,
    totalWagons: 6,
    wagons: [
      createStandardWagon(1, "first_class", 10),
      createStandardWagon(2, "second_class", 14),
      createStandardWagon(3, "second_class", 14),
      createStandardWagon(4, "second_class", 14),
      createStandardWagon(5, "second_class", 14),
      createStandardWagon(6, "second_class", 14),
    ],
    totalSeats: 40 + 350,
    firstClassSeats: 40,
    secondClassSeats: 350,
  },
  {
    name: "AlephaRail Canadian",
    description: "Transcontinental sleeper train",
    trainType: "AR Canadian",
    isDefault: true,
    totalWagons: 8,
    wagons: [
      createStandardWagon(1, "first_class", 8),
      createStandardWagon(2, "first_class", 8),
      createStandardWagon(3, "second_class", 12),
      createStandardWagon(4, "second_class", 12),
      createStandardWagon(5, "second_class", 12),
      createStandardWagon(6, "second_class", 12),
      createStandardWagon(7, "second_class", 12),
      createStandardWagon(8, "second_class", 12),
    ],
    totalSeats: 64 + 360,
    firstClassSeats: 64,
    secondClassSeats: 360,
  },
  {
    name: "AlephaRail Ocean",
    description: "Montreal to Halifax overnight service",
    trainType: "AR Ocean",
    isDefault: true,
    totalWagons: 5,
    wagons: [
      createStandardWagon(1, "first_class", 8),
      createStandardWagon(2, "second_class", 12),
      createStandardWagon(3, "second_class", 12),
      createStandardWagon(4, "second_class", 12),
      createStandardWagon(5, "second_class", 12),
    ],
    totalSeats: 32 + 240,
    firstClassSeats: 32,
    secondClassSeats: 240,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stations - Canadian Rail Network
// ─────────────────────────────────────────────────────────────────────────────

export const stations: StationSeed[] = [
  // Ontario
  {
    name: "Toronto Union Station",
    code: "CATOR",
    city: "Toronto",
    country: "Canada",
    latitude: 43.6453,
    longitude: -79.3806,
    timezone: "America/Toronto",
    platforms: 16,
    description:
      "Canada's busiest transportation hub, Toronto Union Station is a Beaux-Arts masterpiece built in 1927. The Great Hall features a stunning 76-foot coffered ceiling and serves over 72 million passengers annually. The station offers direct connections to GO Transit, TTC subway, UP Express to Pearson Airport, and the downtown PATH network. Amenities include the AlephaRail Business Lounge, Tim Hortons, and premium shopping.",
    imageUrl: "/stations/toronto-union.jpg",
  },
  {
    name: "Ottawa Station",
    code: "CAOTT",
    city: "Ottawa",
    country: "Canada",
    latitude: 45.4162,
    longitude: -75.6517,
    timezone: "America/Toronto",
    platforms: 4,
    description:
      "Located in the nation's capital, Ottawa Station provides convenient access to Parliament Hill, the Rideau Canal UNESCO World Heritage Site, and major government institutions. The modern station features bilingual services, free WiFi, and easy connections to OC Transpo. The AlephaRail Lounge offers views of the Ottawa River and complimentary refreshments.",
    imageUrl: "/stations/ottawa.jpg",
  },
  {
    name: "Kingston Station",
    code: "CAKNG",
    city: "Kingston",
    country: "Canada",
    latitude: 44.2537,
    longitude: -76.512,
    timezone: "America/Toronto",
    platforms: 2,
    description:
      "Historic Kingston Station serves as the gateway to 'The Limestone City', home to Queen's University and the Royal Military College. The station is a short distance from the beautiful Kingston waterfront on Lake Ontario, Fort Henry, and the Thousand Islands. Enjoy scenic views along the St. Lawrence River corridor.",
    imageUrl: "/stations/kingston.jpg",
  },
  {
    name: "London Station",
    code: "CALON",
    city: "London",
    country: "Canada",
    latitude: 42.9871,
    longitude: -81.2519,
    timezone: "America/Toronto",
    platforms: 2,
    description:
      "London Station serves Southwestern Ontario's largest city, known as 'The Forest City'. The station provides easy access to Western University, downtown attractions, and connects the Toronto-Windsor corridor. Modern amenities include heated waiting areas and ample parking.",
    imageUrl: "/stations/london.jpg",
  },
  {
    name: "Windsor Station",
    code: "CAWIN",
    city: "Windsor",
    country: "Canada",
    latitude: 42.3149,
    longitude: -83.0364,
    timezone: "America/Toronto",
    platforms: 2,
    description:
      "Canada's southernmost major station, Windsor Station sits across the Detroit River from the American automotive capital. The station serves the Windsor-Quebec City corridor and offers views of the Detroit skyline. The city is known for its diverse culture, riverfront parks, and proximity to Point Pelee National Park.",
    imageUrl: "/stations/windsor.jpg",
  },

  // Quebec
  {
    name: "Montréal Central Station",
    code: "CAMTL",
    city: "Montréal",
    country: "Canada",
    latitude: 45.4998,
    longitude: -73.5673,
    timezone: "America/Montreal",
    platforms: 8,
    description:
      "Gare Centrale de Montréal is an Art Deco masterpiece located beneath the Queen Elizabeth Hotel in downtown Montréal. The station connects to the Underground City (RÉSO), the largest underground complex in the world. Direct access to métro, downtown festivals, Old Montréal, and the Bell Centre. The AlephaRail Panorama Lounge features floor-to-ceiling windows and gourmet Québécois cuisine.",
    imageUrl: "/stations/montreal-central.jpg",
  },
  {
    name: "Québec City Station",
    code: "CAQBC",
    city: "Québec City",
    country: "Canada",
    latitude: 46.8186,
    longitude: -71.2233,
    timezone: "America/Montreal",
    platforms: 4,
    description:
      "Gare du Palais is one of the most beautiful train stations in North America, built in 1915 in the Château style. Located in the heart of Old Québec, a UNESCO World Heritage Site, the station features stunning copper turrets and provides easy access to the Plains of Abraham, Château Frontenac, and the charming cobblestone streets of the historic quarter.",
    imageUrl: "/stations/quebec-city.jpg",
  },

  // Atlantic Canada
  {
    name: "Halifax Station",
    code: "CAHAL",
    city: "Halifax",
    country: "Canada",
    latitude: 44.6507,
    longitude: -63.5868,
    timezone: "America/Halifax",
    platforms: 2,
    description:
      "Halifax Station welcomes passengers to the vibrant capital of Nova Scotia, a major Atlantic port city rich in maritime heritage. The station is walking distance from the historic Halifax Waterfront, Citadel Hill, and the Canadian Museum of Immigration at Pier 21. This is the eastern terminus of the Ocean service, one of Canada's most scenic rail journeys.",
    imageUrl: "/stations/halifax.jpg",
  },
  {
    name: "Moncton Station",
    code: "CAMON",
    city: "Moncton",
    country: "Canada",
    latitude: 46.092,
    longitude: -64.7833,
    timezone: "America/Moncton",
    platforms: 2,
    description:
      "Moncton Station serves as the hub city of the Maritimes, strategically located in New Brunswick. Known for the famous tidal bore on the Petitcodiac River and as the gateway to the Bay of Fundy, home to the world's highest tides. The bilingual city offers Acadian culture, Magnetic Hill, and warm Maritime hospitality.",
    imageUrl: "/stations/moncton.jpg",
  },

  // Western Canada
  {
    name: "Vancouver Pacific Central",
    code: "CAVAN",
    city: "Vancouver",
    country: "Canada",
    latitude: 49.2736,
    longitude: -123.0981,
    timezone: "America/Vancouver",
    platforms: 4,
    description:
      "Pacific Central Station is the western terminus of The Canadian, one of the world's great train journeys. Located near Science World and the Main Street-Science World SkyTrain station, it provides easy access to downtown Vancouver, Gastown, and Granville Island. The station marks the start or end of the spectacular transcontinental journey through the Rocky Mountains.",
    imageUrl: "/stations/vancouver-pacific.jpg",
  },
  {
    name: "Winnipeg Union Station",
    code: "CAWPG",
    city: "Winnipeg",
    country: "Canada",
    latitude: 49.8883,
    longitude: -97.1336,
    timezone: "America/Winnipeg",
    platforms: 4,
    description:
      "Winnipeg Union Station is a stunning Beaux-Arts landmark built in 1911, featuring a grand rotunda and Manitoba Tyndall stone architecture. Located in the heart of Canada's geographic centre, the station provides access to The Forks National Historic Site, the Canadian Museum for Human Rights, and the vibrant Exchange District. A key stop on the transcontinental route.",
    imageUrl: "/stations/winnipeg-union.jpg",
  },
  {
    name: "Edmonton Station",
    code: "CAEDM",
    city: "Edmonton",
    country: "Canada",
    latitude: 53.5431,
    longitude: -113.4978,
    timezone: "America/Edmonton",
    platforms: 2,
    description:
      "Edmonton Station serves Alberta's capital city, gateway to Canada's north and the Canadian Rockies. The city is known for West Edmonton Mall (one of the largest in North America), a thriving arts scene, and the beautiful River Valley park system. The station provides connections to Jasper National Park and the spectacular mountain route westward.",
    imageUrl: "/stations/edmonton.jpg",
  },
  {
    name: "Jasper Station",
    code: "CAJAS",
    city: "Jasper",
    country: "Canada",
    latitude: 52.8754,
    longitude: -118.0822,
    timezone: "America/Edmonton",
    platforms: 2,
    description:
      "Nestled in the heart of Jasper National Park, a UNESCO World Heritage Site, Jasper Station offers one of the most scenic stops in North America. Surrounded by the majestic Canadian Rockies, the station provides access to Maligne Lake, the Columbia Icefield, and world-class wildlife viewing. The rustic stone station building complements the spectacular mountain wilderness.",
    imageUrl: "/stations/jasper.jpg",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Trips - Canadian Rail Routes
// ─────────────────────────────────────────────────────────────────────────────

export const trips: TripSeed[] = [
  // Toronto - Montréal (Corridor)
  {
    from: "Toronto Union Station",
    to: "Montréal Central Station",
    departureTime: "06:30",
    arrivalTime: "11:30",
    duration: "5h 00min",
    trainNumber: "AR 60",
    trainType: "AR Corridor",
    basePrice: 89,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Toronto Union Station",
    to: "Montréal Central Station",
    departureTime: "09:00",
    arrivalTime: "14:00",
    duration: "5h 00min",
    trainNumber: "AR 62",
    trainType: "AR Corridor",
    basePrice: 99,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Toronto Union Station",
    to: "Montréal Central Station",
    departureTime: "14:00",
    arrivalTime: "19:00",
    duration: "5h 00min",
    trainNumber: "AR 66",
    trainType: "AR Corridor",
    basePrice: 89,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Toronto Union Station",
    to: "Montréal Central Station",
    departureTime: "18:00",
    arrivalTime: "23:00",
    duration: "5h 00min",
    trainNumber: "AR 68",
    trainType: "AR Corridor",
    basePrice: 79,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Montréal Central Station",
    to: "Toronto Union Station",
    departureTime: "07:00",
    arrivalTime: "12:00",
    duration: "5h 00min",
    trainNumber: "AR 61",
    trainType: "AR Corridor",
    basePrice: 89,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Montréal Central Station",
    to: "Toronto Union Station",
    departureTime: "11:00",
    arrivalTime: "16:00",
    duration: "5h 00min",
    trainNumber: "AR 63",
    trainType: "AR Corridor",
    basePrice: 99,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Montréal Central Station",
    to: "Toronto Union Station",
    departureTime: "15:00",
    arrivalTime: "20:00",
    duration: "5h 00min",
    trainNumber: "AR 67",
    trainType: "AR Corridor",
    basePrice: 89,
    seatLayoutName: "AlephaRail Corridor",
  },

  // Toronto - Ottawa
  {
    from: "Toronto Union Station",
    to: "Ottawa Station",
    departureTime: "07:15",
    arrivalTime: "11:45",
    duration: "4h 30min",
    trainNumber: "AR 40",
    trainType: "AR Corridor",
    basePrice: 75,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Toronto Union Station",
    to: "Ottawa Station",
    departureTime: "12:30",
    arrivalTime: "17:00",
    duration: "4h 30min",
    trainNumber: "AR 44",
    trainType: "AR Corridor",
    basePrice: 85,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Ottawa Station",
    to: "Toronto Union Station",
    departureTime: "08:00",
    arrivalTime: "12:30",
    duration: "4h 30min",
    trainNumber: "AR 41",
    trainType: "AR Corridor",
    basePrice: 75,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Ottawa Station",
    to: "Toronto Union Station",
    departureTime: "16:00",
    arrivalTime: "20:30",
    duration: "4h 30min",
    trainNumber: "AR 47",
    trainType: "AR Corridor",
    basePrice: 85,
    seatLayoutName: "AlephaRail Corridor",
  },

  // Montréal - Québec City
  {
    from: "Montréal Central Station",
    to: "Québec City Station",
    departureTime: "08:00",
    arrivalTime: "11:15",
    duration: "3h 15min",
    trainNumber: "AR 20",
    trainType: "AR Corridor",
    basePrice: 55,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Montréal Central Station",
    to: "Québec City Station",
    departureTime: "14:00",
    arrivalTime: "17:15",
    duration: "3h 15min",
    trainNumber: "AR 24",
    trainType: "AR Corridor",
    basePrice: 65,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Québec City Station",
    to: "Montréal Central Station",
    departureTime: "09:00",
    arrivalTime: "12:15",
    duration: "3h 15min",
    trainNumber: "AR 21",
    trainType: "AR Corridor",
    basePrice: 55,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Québec City Station",
    to: "Montréal Central Station",
    departureTime: "17:00",
    arrivalTime: "20:15",
    duration: "3h 15min",
    trainNumber: "AR 27",
    trainType: "AR Corridor",
    basePrice: 65,
    seatLayoutName: "AlephaRail Corridor",
  },

  // Montréal - Halifax (Ocean)
  {
    from: "Montréal Central Station",
    to: "Halifax Station",
    departureTime: "18:30",
    arrivalTime: "17:00",
    duration: "22h 30min",
    trainNumber: "AR 14",
    trainType: "AR Ocean",
    basePrice: 199,
    seatLayoutName: "AlephaRail Ocean",
  },
  {
    from: "Halifax Station",
    to: "Montréal Central Station",
    departureTime: "12:30",
    arrivalTime: "11:00",
    duration: "22h 30min",
    trainNumber: "AR 15",
    trainType: "AR Ocean",
    basePrice: 199,
    seatLayoutName: "AlephaRail Ocean",
  },

  // Toronto - Vancouver (Canadian)
  {
    from: "Toronto Union Station",
    to: "Vancouver Pacific Central",
    departureTime: "22:00",
    arrivalTime: "08:00",
    duration: "82h 00min",
    trainNumber: "AR 1",
    trainType: "AR Canadian",
    basePrice: 499,
    seatLayoutName: "AlephaRail Canadian",
  },
  {
    from: "Vancouver Pacific Central",
    to: "Toronto Union Station",
    departureTime: "20:00",
    arrivalTime: "06:00",
    duration: "82h 00min",
    trainNumber: "AR 2",
    trainType: "AR Canadian",
    basePrice: 499,
    seatLayoutName: "AlephaRail Canadian",
  },

  // Toronto - Windsor
  {
    from: "Toronto Union Station",
    to: "Windsor Station",
    departureTime: "07:00",
    arrivalTime: "11:30",
    duration: "4h 30min",
    trainNumber: "AR 70",
    trainType: "AR Corridor",
    basePrice: 69,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Toronto Union Station",
    to: "Windsor Station",
    departureTime: "17:00",
    arrivalTime: "21:30",
    duration: "4h 30min",
    trainNumber: "AR 72",
    trainType: "AR Corridor",
    basePrice: 79,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Windsor Station",
    to: "Toronto Union Station",
    departureTime: "06:30",
    arrivalTime: "11:00",
    duration: "4h 30min",
    trainNumber: "AR 71",
    trainType: "AR Corridor",
    basePrice: 69,
    seatLayoutName: "AlephaRail Corridor",
  },
  {
    from: "Windsor Station",
    to: "Toronto Union Station",
    departureTime: "14:30",
    arrivalTime: "19:00",
    duration: "4h 30min",
    trainNumber: "AR 73",
    trainType: "AR Corridor",
    basePrice: 79,
    seatLayoutName: "AlephaRail Corridor",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fare Classes
// ─────────────────────────────────────────────────────────────────────────────

export const fareClasses: FareClassSeed[] = [
  {
    code: "ESCAPE",
    name: "Escape Fare",
    description: "Limited availability discount fare. Non-refundable.",
    priceMultiplier: 0.6,
    isRefundable: false,
    isChangeable: false,
    changeFeePercent: 0,
    refundFeePercent: 0,
    minDaysBeforeDeparture: 7,
    sortOrder: 0,
  },
  {
    code: "ECONOMY",
    name: "Economy",
    description: "Standard economy class with basic amenities.",
    priceMultiplier: 1.0,
    isRefundable: true,
    isChangeable: true,
    changeFeePercent: 0.15,
    refundFeePercent: 0.25,
    minDaysBeforeDeparture: 0,
    sortOrder: 1,
  },
  {
    code: "ECONOMY_PLUS",
    name: "Economy Plus",
    description: "Economy with added flexibility and meal service.",
    priceMultiplier: 1.3,
    isRefundable: true,
    isChangeable: true,
    changeFeePercent: 0,
    refundFeePercent: 0.1,
    minDaysBeforeDeparture: 0,
    sortOrder: 2,
  },
  {
    code: "BUSINESS",
    name: "Business Class",
    description:
      "Premium service with meals, lounge access, and full flexibility.",
    priceMultiplier: 1.8,
    isRefundable: true,
    isChangeable: true,
    changeFeePercent: 0,
    refundFeePercent: 0,
    minDaysBeforeDeparture: 0,
    sortOrder: 3,
  },
  {
    code: "SLEEPER",
    name: "Sleeper Plus",
    description: "Private cabin with bed, meals, and shower access.",
    priceMultiplier: 2.5,
    isRefundable: true,
    isChangeable: true,
    changeFeePercent: 0,
    refundFeePercent: 0,
    minDaysBeforeDeparture: 0,
    sortOrder: 4,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Price Rules
// ─────────────────────────────────────────────────────────────────────────────

export const priceRules: PriceRuleSeed[] = [
  {
    name: "Occupancy Surge",
    description: "Price increases as the train fills up",
    ruleType: "occupancy",
    config: {
      thresholds: [
        { value: 90, multiplier: 1.5 },
        { value: 80, multiplier: 1.3 },
        { value: 60, multiplier: 1.15 },
        { value: 40, multiplier: 1.0 },
        { value: 20, multiplier: 0.95 },
      ],
    },
    priority: 10,
  },
  {
    name: "Last Minute Premium",
    description: "Higher prices closer to departure",
    ruleType: "time_to_departure",
    config: {
      thresholds: [
        { value: 0, multiplier: 1.6 },
        { value: 1, multiplier: 1.4 },
        { value: 3, multiplier: 1.2 },
        { value: 7, multiplier: 1.1 },
        { value: 14, multiplier: 1.0 },
        { value: 30, multiplier: 0.9 },
      ],
    },
    priority: 20,
  },
  {
    name: "Weekend Premium",
    description: "Higher prices on Friday, Saturday, Sunday",
    ruleType: "day_of_week",
    config: {
      dayMultipliers: {
        monday: 0.95,
        tuesday: 0.9,
        wednesday: 0.9,
        thursday: 0.95,
        friday: 1.15,
        saturday: 1.1,
        sunday: 1.1,
      },
    },
    priority: 5,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Customers - Empty (no customers)
// ─────────────────────────────────────────────────────────────────────────────

export const customers: CustomerSeed[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Vouchers
// ─────────────────────────────────────────────────────────────────────────────

export const vouchers: VoucherSeed[] = [
  {
    code: "WELCOME15",
    name: "Welcome Discount",
    description: "15% off your first booking",
    type: "percentage",
    value: 15,
    maxUses: 1000,
    currentUses: 0,
    validFrom: "2025-01-01T00:00:00Z",
    validUntil: "2025-12-31T23:59:59Z",
    source: "welcome",
  },
  {
    code: "CANADA20",
    name: "Canada Discount",
    description: "$20 off any booking",
    type: "fixed_amount",
    value: 20,
    maxUses: 500,
    currentUses: 0,
    validFrom: "2025-01-01T00:00:00Z",
    validUntil: "2025-12-31T23:59:59Z",
    source: "promotion",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Agents - Only admin
// ─────────────────────────────────────────────────────────────────────────────

export const agents: AgentSeed[] = [
  {
    username: "admin",
    email: "admin@alepha.dev",
    firstName: "Admin",
    lastName: "User",
    role: "admin",
    employeeId: "ADM-001",
    department: "Management",
    jobTitle: "System Administrator",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Devices
// ─────────────────────────────────────────────────────────────────────────────

export const devices: DeviceSeed[] = [
  // Toronto Union Station
  {
    type: "gate",
    name: "Gate A1",
    serialNumber: "GT-TOR-001",
    stationName: "Toronto Union Station",
    zone: "AlephaRail Concourse",
    status: "online",
  },
  {
    type: "gate",
    name: "Gate A2",
    serialNumber: "GT-TOR-002",
    stationName: "Toronto Union Station",
    zone: "AlephaRail Concourse",
    status: "online",
  },
  {
    type: "tvm",
    name: "TVM Lobby-01",
    serialNumber: "TV-TOR-001",
    stationName: "Toronto Union Station",
    zone: "Main Lobby",
    status: "online",
  },
  {
    type: "tvm",
    name: "TVM Lobby-02",
    serialNumber: "TV-TOR-002",
    stationName: "Toronto Union Station",
    zone: "Main Lobby",
    status: "online",
  },
  {
    type: "validator",
    name: "Validator P1",
    serialNumber: "VL-TOR-001",
    stationName: "Toronto Union Station",
    zone: "Platform 1",
    status: "online",
  },

  // Montréal Central Station
  {
    type: "gate",
    name: "Gate M1",
    serialNumber: "GT-MTL-001",
    stationName: "Montréal Central Station",
    zone: "AlephaRail Hall",
    status: "online",
  },
  {
    type: "tvm",
    name: "TVM Hall-01",
    serialNumber: "TV-MTL-001",
    stationName: "Montréal Central Station",
    zone: "Main Hall",
    status: "online",
  },
  {
    type: "validator",
    name: "Validator P1",
    serialNumber: "VL-MTL-001",
    stationName: "Montréal Central Station",
    zone: "Platform 1",
    status: "online",
  },

  // Ottawa Station
  {
    type: "gate",
    name: "Gate O1",
    serialNumber: "GT-OTT-001",
    stationName: "Ottawa Station",
    zone: "Main Entrance",
    status: "online",
  },
  {
    type: "tvm",
    name: "TVM Lobby-01",
    serialNumber: "TV-OTT-001",
    stationName: "Ottawa Station",
    zone: "Lobby",
    status: "maintenance",
  },

  // Vancouver Pacific Central
  {
    type: "gate",
    name: "Gate V1",
    serialNumber: "GT-VAN-001",
    stationName: "Vancouver Pacific Central",
    zone: "AlephaRail Terminal",
    status: "online",
  },
  {
    type: "tvm",
    name: "TVM Main-01",
    serialNumber: "TV-VAN-001",
    stationName: "Vancouver Pacific Central",
    zone: "Main Hall",
    status: "online",
  },
  {
    type: "validator",
    name: "Validator P1",
    serialNumber: "VL-VAN-001",
    stationName: "Vancouver Pacific Central",
    zone: "Platform 1",
    status: "offline",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Products - Canadian themed, fewer products
// ─────────────────────────────────────────────────────────────────────────────

export const products: ProductSeed[] = [
  // Food & Beverage
  {
    name: "Tim Hortons Coffee",
    description: "Freshly brewed Tim Hortons coffee",
    sku: "FB-COFFEE-01",
    price: 3.5,
    currency: "CAD",
    category: "food_beverage",
    sellType: "both",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 1,
  },
  {
    name: "Maple Donut",
    description: "Classic Canadian maple-glazed donut",
    sku: "FB-DONUT-01",
    price: 2.5,
    currency: "CAD",
    category: "food_beverage",
    sellType: "both",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 2,
  },
  {
    name: "Sandwich Combo",
    description: "Fresh sandwich with chips and drink",
    sku: "FB-SANDWICH-01",
    price: 14.99,
    currency: "CAD",
    category: "food_beverage",
    sellType: "both",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 3,
  },
  {
    name: "Bottled Water",
    description: "500ml natural spring water",
    sku: "FB-WATER-01",
    price: 2.99,
    currency: "CAD",
    category: "food_beverage",
    sellType: "both",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 4,
  },

  // Comfort
  {
    name: "Travel Blanket",
    description: "Cozy fleece blanket for long journeys",
    sku: "CF-BLANKET-01",
    price: 15.0,
    currency: "CAD",
    category: "comfort",
    sellType: "with_booking",
    trackStock: true,
    stock: 50,
    active: true,
    taxRate: 13,
    sortOrder: 10,
  },
  {
    name: "Neck Pillow",
    description: "Memory foam neck pillow",
    sku: "CF-PILLOW-01",
    price: 18.0,
    currency: "CAD",
    category: "comfort",
    sellType: "both",
    trackStock: true,
    stock: 40,
    active: true,
    taxRate: 13,
    sortOrder: 11,
  },

  // Insurance
  {
    name: "Trip Cancellation Insurance",
    description: "Full refund coverage for trip cancellation",
    sku: "IN-CANCEL-01",
    price: 12.99,
    currency: "CAD",
    category: "insurance",
    sellType: "with_booking",
    trackStock: false,
    active: true,
    taxRate: 0,
    sortOrder: 50,
  },

  // Services
  {
    name: "Priority Boarding",
    description: "Board first and settle in before other passengers",
    sku: "SV-PRIORITY-01",
    price: 10.0,
    currency: "CAD",
    category: "services",
    sellType: "with_booking",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 60,
  },
  {
    name: "Business Lounge Access",
    description:
      "Access to AlephaRail Business lounge with WiFi and refreshments",
    sku: "SV-LOUNGE-01",
    price: 45.0,
    currency: "CAD",
    category: "services",
    sellType: "with_booking",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 61,
  },
  {
    name: "Bicycle Reservation",
    description: "Reserved space for your bicycle",
    sku: "SV-BIKE-01",
    price: 15.0,
    currency: "CAD",
    category: "services",
    sellType: "with_booking",
    trackStock: false,
    active: true,
    taxRate: 13,
    sortOrder: 62,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Product Orders - Empty (no orders without customers)
// ─────────────────────────────────────────────────────────────────────────────

export const productOrders: ProductOrderSeed[] = [];
