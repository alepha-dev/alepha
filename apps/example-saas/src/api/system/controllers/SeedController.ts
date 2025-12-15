import { $env, $inject, t } from "alepha";
import { notifications } from "alepha/api/notifications";
import { UserRealmProvider, UserService } from "alepha/api/users";
import { fake } from "alepha/fake";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { CryptoProvider } from "alepha/security";
import { $action } from "alepha/server";
import { agentProfiles } from "../../agents/entities/agentProfiles.ts";
import { bookings } from "../../bookings/entities/bookings.ts";
import { customers } from "../../customers/entities/customers.ts";
import { vouchers } from "../../customers/entities/vouchers.ts";
import { devices } from "../../devices/entities/devices.ts";
import { fareClasses } from "../../inventory/entities/fareClasses.ts";
import { seatReservations } from "../../inventory/entities/seatReservations.ts";
import { tripInstances } from "../../inventory/entities/tripInstances.ts";
import { issueMessages } from "../../issues/entities/issueMessages.ts";
import { issues } from "../../issues/entities/issues.ts";
import {
  type OrderItem,
  productOrders,
} from "../../orders/entities/productOrders.ts";
import { payments } from "../../payments/entities/payments.ts";
import { priceRules } from "../../pricing/entities/priceRules.ts";
import { products } from "../../products/entities/products.ts";
import { stations } from "../../topology/entities/stations.ts";
import { trips } from "../../topology/entities/trips.ts";
import { seatLayouts } from "../../vehicles/entities/seatLayouts.ts";
import * as seed from "../seeds/index.ts";

const CUSTOMER_REALM = "customer";
const AGENT_REALM = "agent";

export class SeedController {
  protected readonly log = $logger();

  protected readonly env = $env(
    t.object({
      SAAS_DEMO_USERNAME: t.string({
        description: "Default username for superadmin",
        default: "admin",
      }),
      SAAS_DEMO_PASSWORD: t.string({
        description: "Default password for superadmin",
        default: "Demo1234!",
      }),
      SAAS_DEMO_EMAIL: t.string({
        description: "Default email for superadmin",
        default: "admin@alepha.dev",
      }),
    }),
  );

  // Repositories
  protected readonly stations = $repository(stations);
  protected readonly trips = $repository(trips);
  protected readonly tripInstances = $repository(tripInstances);
  protected readonly seatReservations = $repository(seatReservations);
  protected readonly fareClasses = $repository(fareClasses);
  protected readonly priceRules = $repository(priceRules);
  protected readonly bookings = $repository(bookings);
  protected readonly payments = $repository(payments);
  protected readonly seatLayouts = $repository(seatLayouts);
  protected readonly customers = $repository(customers);
  protected readonly vouchers = $repository(vouchers);
  protected readonly agentProfiles = $repository(agentProfiles);
  protected readonly devices = $repository(devices);
  protected readonly products = $repository(products);
  protected readonly productOrders = $repository(productOrders);
  protected readonly notifications = $repository(notifications);
  protected readonly issues = $repository(issues);
  protected readonly issueMessages = $repository(issueMessages);

  // Services for user creation
  protected readonly userService = $inject(UserService);
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);

  /**
   * Get available seed sets (for UI display).
   * GET /admin/seeds/sets
   */
  getSeedSets = $action({
    path: "/admin/seeds/sets",
    secure: false,
    description: "Get available seed sets",
    schema: {
      response: t.object({
        sets: t.array(
          t.object({
            id: t.text(),
            name: t.text(),
            description: t.text(),
          }),
        ),
      }),
    },
    handler: async () => {
      return {
        sets: [
          {
            id: "demo",
            name: "Demo Dataset",
            description:
              "Complete demo data with AlephaRail Canadian train network, stations, and devices",
          },
        ],
      };
    },
  });

  /**
   * Get seed status - shows current data counts.
   * GET /admin/seeds/status
   */
  getStatus = $action({
    path: "/admin/seeds/status",
    secure: false,
    description: "Get current database status",
    schema: {
      response: t.object({
        stations: t.integer(),
        trips: t.integer(),
        tripInstances: t.integer(),
        seatLayouts: t.integer(),
        fareClasses: t.integer(),
        priceRules: t.integer(),
        customers: t.integer(),
        vouchers: t.integer(),
        agents: t.integer(),
        devices: t.integer(),
        products: t.integer(),
        productOrders: t.integer(),
        bookings: t.integer(),
        payments: t.integer(),
        issues: t.integer(),
      }),
    },
    handler: async () => {
      const [
        stationsCount,
        tripsCount,
        tripInstancesCount,
        seatLayoutsCount,
        fareClassesCount,
        priceRulesCount,
        customersCount,
        vouchersCount,
        agentsCount,
        devicesCount,
        productsCount,
        productOrdersCount,
        bookingsCount,
        paymentsCount,
        issuesCount,
      ] = await Promise.all([
        this.stations.findMany({}).then((r) => r.length),
        this.trips.findMany({}).then((r) => r.length),
        this.tripInstances.findMany({}).then((r) => r.length),
        this.seatLayouts.findMany({}).then((r) => r.length),
        this.fareClasses.findMany({}).then((r) => r.length),
        this.priceRules.findMany({}).then((r) => r.length),
        this.customers.findMany({}).then((r) => r.length),
        this.vouchers.findMany({}).then((r) => r.length),
        this.agentProfiles.findMany({}).then((r) => r.length),
        this.devices.findMany({}).then((r) => r.length),
        this.products.findMany({}).then((r) => r.length),
        this.productOrders.findMany({}).then((r) => r.length),
        this.bookings.findMany({}).then((r) => r.length),
        this.payments.findMany({}).then((r) => r.length),
        this.issues.findMany({}).then((r) => r.length),
      ]);

      return {
        stations: stationsCount,
        trips: tripsCount,
        tripInstances: tripInstancesCount,
        seatLayouts: seatLayoutsCount,
        fareClasses: fareClassesCount,
        priceRules: priceRulesCount,
        customers: customersCount,
        vouchers: vouchersCount,
        agents: agentsCount,
        devices: devicesCount,
        products: productsCount,
        productOrders: productOrdersCount,
        bookings: bookingsCount,
        payments: paymentsCount,
        issues: issuesCount,
      };
    },
  });

  /**
   * Hard reset - clears ALL data and seeds fresh demo data.
   * POST /admin/seeds/hard-reset
   */
  hardReset = $action({
    method: "GET",
    path: "/admin/seeds/hard-reset",
    secure: false,
    description: "Clear all data and seed fresh demo dataset",
    schema: {
      response: t.object({
        ok: t.boolean(),
        cleared: t.object({
          tables: t.integer(),
        }),
        created: t.object({
          seatLayouts: t.integer(),
          stations: t.integer(),
          trips: t.integer(),
          tripInstances: t.integer(),
          fareClasses: t.integer(),
          priceRules: t.integer(),
          vouchers: t.integer(),
          agents: t.integer(),
          devices: t.integer(),
          products: t.integer(),
          productOrders: t.integer(),
        }),
      }),
    },
    handler: async () => {
      this.log.warn("Starting hard reset - clearing all data");

      // ─────────────────────────────────────────────────────────────────────
      // Step 1: Clear all tables (respecting foreign key order)
      // ─────────────────────────────────────────────────────────────────────

      await this.clearAllTables();

      // ─────────────────────────────────────────────────────────────────────
      // Step 2: Seed fresh data
      // ─────────────────────────────────────────────────────────────────────

      const result = {
        seatLayouts: 0,
        stations: 0,
        trips: 0,
        tripInstances: 0,
        fareClasses: 0,
        priceRules: 0,
        vouchers: 0,
        agents: 0,
        devices: 0,
        products: 0,
        productOrders: 0,
      };

      // Seat layouts
      const seatLayoutMap = new Map<string, string>();
      for (const layout of seed.seatLayouts) {
        const created = await this.seatLayouts.create({
          ...layout,
          active: true,
        });
        seatLayoutMap.set(layout.name, created.id);
        result.seatLayouts++;
      }
      this.log.info("Created seat layouts", { count: result.seatLayouts });

      // Stations
      const stationMap = new Map<string, string>();
      for (const station of seed.stations) {
        const created = await this.stations.create(station);
        stationMap.set(station.name, created.id);
        result.stations++;
      }
      this.log.info("Created stations", { count: result.stations });

      // Trips
      const tripMap = new Map<string, { id: string; seatLayoutId: string }>();
      for (const trip of seed.trips) {
        const departureStationId = stationMap.get(trip.from);
        const arrivalStationId = stationMap.get(trip.to);
        const seatLayoutId = seatLayoutMap.get(trip.seatLayoutName);

        if (!departureStationId || !arrivalStationId) {
          this.log.warn("Station not found for trip", {
            trip: trip.trainNumber,
          });
          continue;
        }

        const created = await this.trips.create({
          departureStationId,
          arrivalStationId,
          departureTime: trip.departureTime,
          arrivalTime: trip.arrivalTime,
          duration: trip.duration,
          trainNumber: trip.trainNumber,
          trainType: trip.trainType,
          basePrice: trip.basePrice,
          availableSeats: 0, // Computed from seat layout
          active: true,
        });
        tripMap.set(trip.trainNumber, {
          id: created.id,
          seatLayoutId: seatLayoutId || "",
        });
        result.trips++;
      }
      this.log.info("Created trips", { count: result.trips });

      // Fare classes
      const fareClassMap = new Map<string, string>();
      for (const fc of seed.fareClasses) {
        const created = await this.fareClasses.create({
          ...fc,
          active: true,
        });
        fareClassMap.set(fc.code, created.id);
        result.fareClasses++;
      }
      this.log.info("Created fare classes", { count: result.fareClasses });

      // Price rules
      for (const pr of seed.priceRules) {
        await this.priceRules.create({
          ...pr,
          active: true,
        });
        result.priceRules++;
      }
      this.log.info("Created price rules", { count: result.priceRules });

      // Trip instances for next 30 days (with embedded fareQuotas)
      const today = new Date();
      const tripInstanceBatch: Array<{
        tripId: string;
        travelDate: string;
        seatLayoutId: string;
        availableFirstClass: number;
        availableSecondClass: number;
        totalSeats: number;
        fareQuotas: Record<
          string,
          {
            fareClassId: string;
            totalQuota: number;
            bookedCount: number;
            reservedCount: number;
            status: "available" | "sold_out" | "closed";
          }
        >;
        bookedSeats: string[];
        currentPriceMultiplier: number;
        status: "scheduled" | "boarding" | "departed" | "cancelled";
      }> = [];

      for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
        const date = new Date(today);
        date.setDate(date.getDate() + dayOffset);
        const travelDate = date.toISOString().split("T")[0];

        for (const [, tripInfo] of tripMap) {
          const layout = seed.seatLayouts.find(
            (l) => seatLayoutMap.get(l.name) === tripInfo.seatLayoutId,
          );

          const totalSeats = layout?.totalSeats ?? 200;
          const firstClassSeats = layout?.firstClassSeats ?? 40;
          const secondClassSeats = layout?.secondClassSeats ?? 160;

          // Build fareQuotas as JSONB object keyed by fare class code
          const fareQuotas: Record<
            string,
            {
              fareClassId: string;
              totalQuota: number;
              bookedCount: number;
              reservedCount: number;
              status: "available" | "sold_out" | "closed";
            }
          > = {};

          for (const [code, fareClassId] of fareClassMap) {
            const quota =
              code === "PROMO"
                ? Math.floor(totalSeats * 0.1)
                : code === "SAVER"
                  ? Math.floor(totalSeats * 0.25)
                  : code === "BUSINESS"
                    ? Math.floor(firstClassSeats * 0.5)
                    : totalSeats;

            fareQuotas[code] = {
              fareClassId,
              totalQuota: quota,
              bookedCount: 0,
              reservedCount: 0,
              status: "available",
            };
          }

          tripInstanceBatch.push({
            tripId: tripInfo.id,
            travelDate,
            seatLayoutId: tripInfo.seatLayoutId,
            availableFirstClass: firstClassSeats,
            availableSecondClass: secondClassSeats,
            totalSeats,
            fareQuotas,
            bookedSeats: [], // No seats booked initially
            currentPriceMultiplier: 1.0,
            status: "scheduled",
          });
        }
      }

      // Batch insert trip instances
      await this.tripInstances.createMany(tripInstanceBatch);
      result.tripInstances = tripInstanceBatch.length;
      this.log.info("Created trip instances", { count: result.tripInstances });

      // Vouchers
      for (const voucher of seed.vouchers) {
        await this.vouchers.create(voucher);
        result.vouchers++;
      }
      this.log.info("Created vouchers", { count: result.vouchers });

      // Agents (with user accounts) - Create admin from $env
      const identityRepository =
        this.userRealmProvider.identityRepository(AGENT_REALM);

      // Create admin user from environment variables
      const adminPasswordHash = await this.cryptoProvider.hashPassword(
        this.env.SAAS_DEMO_PASSWORD,
      );

      try {
        const adminUser = await this.userService.createUser(
          {
            email: this.env.SAAS_DEMO_EMAIL,
            username: this.env.SAAS_DEMO_USERNAME,
            firstName: "John",
            lastName: "Doe",
            roles: ["admin"],
            enabled: true,
            emailVerified: true,
          },
          AGENT_REALM,
        );

        await identityRepository.create({
          userId: adminUser.id,
          provider: "credentials",
          password: adminPasswordHash,
        });

        await this.agentProfiles.create({
          userId: adminUser.id,
          employeeId: "ADM-001",
          department: "Management",
          jobTitle: "System Administrator",
          workEmail: this.env.SAAS_DEMO_EMAIL,
          status: "active",
        });

        result.agents++;
        this.log.info("Created admin user", {
          username: this.env.SAAS_DEMO_USERNAME,
          email: this.env.SAAS_DEMO_EMAIL,
        });
      } catch (error) {
        this.log.warn("Failed to create admin user", {
          username: this.env.SAAS_DEMO_USERNAME,
          error: String(error),
        });
      }

      this.log.info("Created agents", { count: result.agents });

      // Devices
      for (const device of seed.devices) {
        const stationId = stationMap.get(device.stationName);
        await this.devices.create({
          ...device,
          stationId,
          healthScore:
            device.status === "online"
              ? 85 + Math.floor(Math.random() * 15)
              : 50,
          lastSeenAt:
            device.status === "online"
              ? new Date().toISOString()
              : device.status === "maintenance"
                ? new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
                : undefined,
          totalTransactions: Math.floor(Math.random() * 10000),
          todayTransactions: Math.floor(Math.random() * 500),
          totalErrors: Math.floor(Math.random() * 50),
        });
        result.devices++;
      }
      this.log.info("Created devices", { count: result.devices });

      // Products
      const productMap = new Map<
        string,
        {
          id: string;
          name: string;
          sku: string;
          price: number;
          category: string;
          taxRate: number;
        }
      >();
      for (const product of seed.products) {
        const created = await this.products.create({
          name: product.name,
          description: product.description,
          sku: product.sku,
          price: product.price,
          currency: product.currency,
          category: product.category,
          sellType: product.sellType,
          trackStock: product.trackStock,
          stock: product.stock,
          active: product.active,
          taxRate: product.taxRate,
          sortOrder: product.sortOrder,
        });
        productMap.set(product.sku, {
          id: created.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          category: product.category,
          taxRate: product.taxRate ?? 0,
        });
        result.products++;
      }
      this.log.info("Created products", { count: result.products });

      // Product Orders
      for (const order of seed.productOrders) {
        // Build order items with product lookups
        const orderItems: OrderItem[] = [];
        let subtotal = 0;
        let taxAmount = 0;

        for (const item of order.items) {
          const product = productMap.get(item.productSku);
          if (!product) {
            this.log.warn("Product not found for order item", {
              sku: item.productSku,
              orderNumber: order.orderNumber,
            });
            continue;
          }

          const itemSubtotal = product.price * item.quantity;
          const itemTax = itemSubtotal * (product.taxRate / 100);
          subtotal += itemSubtotal;
          taxAmount += itemTax;

          orderItems.push({
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            category: product.category,
            quantity: item.quantity,
            unitPrice: product.price,
            taxRate: product.taxRate,
            subtotal: itemSubtotal,
            taxAmount: itemTax,
            total: itemSubtotal + itemTax,
            status: order.status === "fulfilled" ? "fulfilled" : "pending",
            fulfilledAt:
              order.status === "fulfilled"
                ? new Date(
                    Date.now() - order.createdDaysAgo * 24 * 60 * 60 * 1000,
                  ).toISOString()
                : undefined,
          });
        }

        const total = subtotal + taxAmount;
        const createdAt = new Date(
          Date.now() - order.createdDaysAgo * 24 * 60 * 60 * 1000,
        ).toISOString();

        await this.productOrders.create({
          orderNumber: order.orderNumber,
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          channel: order.channel,
          isBookingAddOn: order.isBookingAddOn,
          status: order.status,
          items: orderItems,
          itemCount: orderItems.reduce((sum, item) => sum + item.quantity, 0),
          subtotal,
          taxAmount,
          discountAmount: 0,
          total,
          currency: "EUR",
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          paidAt: order.paymentStatus === "paid" ? createdAt : undefined,
          fulfilledAt: order.status === "fulfilled" ? createdAt : undefined,
          refundedAt: order.status === "refunded" ? createdAt : undefined,
          createdAt,
        });
        result.productOrders++;
      }
      this.log.info("Created product orders", { count: result.productOrders });

      this.log.info("Hard reset completed successfully", result);

      return {
        ok: true,
        cleared: { tables: 13 },
        created: result,
      };
    },
  });

  /**
   * Populate database with fake data (customers, bookings, payments, issues, orders).
   * POST /admin/seeds/populate
   */
  populateDatabase = $action({
    method: "GET",
    path: "/admin/seeds/populate",
    secure: false,
    description: "Populate database with fake customer data and transactions",
    schema: {
      response: t.object({
        ok: t.boolean(),
        created: t.object({
          customers: t.integer(),
          bookings: t.integer(),
          payments: t.integer(),
          issues: t.integer(),
          issueMessages: t.integer(),
          productOrders: t.integer(),
        }),
      }),
    },
    handler: async () => {
      this.log.info("Starting database population with fake data");

      const result = {
        customers: 0,
        bookings: 0,
        payments: 0,
        issues: 0,
        issueMessages: 0,
        productOrders: 0,
      };

      // Helper function to generate random date between now and 2 months ago
      const randomPastDate = () => {
        const now = Date.now();
        const twoMonthsAgo = now - 60 * 24 * 60 * 60 * 1000;
        const randomTime = twoMonthsAgo + Math.random() * (now - twoMonthsAgo);
        return new Date(randomTime);
      };

      // Get existing trip instances for booking creation
      const tripInstancesList = await this.tripInstances.findMany({});
      const stationsList = await this.stations.findMany({});
      const productsList = await this.products.findMany({});
      const fareClassList = await this.fareClasses.findMany({});

      // Create 50 fake customers with user accounts
      const customerIds: string[] = [];
      const customerIdentityRepo =
        this.userRealmProvider.identityRepository(CUSTOMER_REALM);

      for (let i = 0; i < 50; i++) {
        const createdAt = randomPastDate();
        const firstName = fake.person.firstName();
        const lastName = fake.person.lastName();
        const email = fake.internet
          .email({ firstName, lastName })
          .toLowerCase();
        const loyaltyTiers = ["bronze", "silver", "gold", "platinum"] as const;
        const loyaltyTier = loyaltyTiers[Math.floor(Math.random() * 4)];
        const loyaltyPoints = Math.floor(Math.random() * 10000);

        try {
          // Create user account
          const user = await this.userService.createUser(
            {
              email,
              username: email,
              firstName,
              lastName,
              roles: [],
              enabled: true,
              emailVerified: true,
            },
            CUSTOMER_REALM,
          );

          // Add password identity
          const passwordHash =
            await this.cryptoProvider.hashPassword("Demo1234!");
          await customerIdentityRepo.create({
            userId: user.id,
            provider: "credentials",
            password: passwordHash,
          });

          // Create customer profile
          const genders = [
            "male",
            "female",
            "other",
            "prefer_not_to_say",
          ] as const;
          const seatPrefs = ["window", "aisle", "any"] as const;
          const classPrefs = ["first", "second", "any"] as const;
          const languages = ["en", "fr"];
          const nationalities = ["CA", "US", "FR", "GB", "DE"];

          const customer = await this.customers.create({
            userId: user.id,
            firstName,
            lastName,
            birthDate: fake.date
              .birthdate({ min: 18, max: 75, mode: "age" })
              .toISOString()
              .split("T")[0],
            gender: genders[Math.floor(Math.random() * genders.length)],
            phone: fake.phone.number({ style: "international" }),
            nationality:
              nationalities[Math.floor(Math.random() * nationalities.length)],
            preferredLanguage:
              languages[Math.floor(Math.random() * languages.length)],
            preferredCurrency: "CAD",
            preferredSeatPosition:
              seatPrefs[Math.floor(Math.random() * seatPrefs.length)],
            preferredClass:
              classPrefs[Math.floor(Math.random() * classPrefs.length)],
            marketingEmails: Math.random() > 0.5,
            marketingSms: Math.random() > 0.7,
            tripReminders: true,
            loyaltyTier,
            loyaltyPoints,
            loyaltyPointsLifetime:
              loyaltyPoints + Math.floor(Math.random() * 5000),
            loyaltyJoinedAt: createdAt.toISOString(),
            loyaltyNumber: `AR-${String(100000 + i).padStart(6, "0")}`,
            totalBookings: 0,
            totalSpent: 0,
            addresses: [
              {
                id: crypto.randomUUID(),
                type: "home" as const,
                street: fake.location.streetAddress(),
                city: fake.location.city(),
                state: fake.location.state({ abbreviated: true }),
                postalCode: fake.location.zipCode(),
                country: "CA",
                isDefaultBilling: true,
                isDefaultShipping: true,
              },
            ],
            passengers: [
              {
                id: crypto.randomUUID(),
                label: "Myself",
                isDefault: true,
                firstName,
                lastName,
                email,
                preferredSeatPosition:
                  seatPrefs[Math.floor(Math.random() * seatPrefs.length)],
              },
            ],
          });

          customerIds.push(customer.id);
          result.customers++;
        } catch (error) {
          this.log.warn("Failed to create customer", {
            email,
            error: String(error),
          });
        }
      }
      this.log.info("Created customers", { count: result.customers });

      // Create 100 fake bookings with payments
      const bookingRefs: Array<{
        id: string;
        reference: string;
        amount: number;
        email: string;
      }> = [];

      for (let i = 0; i < 100; i++) {
        const createdAt = randomPastDate();
        const tripInstance =
          tripInstancesList[
            Math.floor(Math.random() * tripInstancesList.length)
          ];

        if (!tripInstance) continue;

        // Get trip details
        const trip = await this.trips.findOne({
          where: { id: tripInstance.tripId },
        });
        if (!trip) continue;

        const departureStation = stationsList.find(
          (s) => s.id === trip.departureStationId,
        );
        const arrivalStation = stationsList.find(
          (s) => s.id === trip.arrivalStationId,
        );
        if (!departureStation || !arrivalStation) continue;

        const firstName = fake.person.firstName();
        const lastName = fake.person.lastName();
        const email = fake.internet
          .email({ firstName, lastName })
          .toLowerCase();
        const reference = this.generateBookingReference();

        const seatClasses = ["first", "second"] as const;
        const seatClass = seatClasses[Math.floor(Math.random() * 2)];
        const seatCount = 1 + Math.floor(Math.random() * 3);
        const baseFare = trip.basePrice * seatCount;
        const seatUpgrades = seatClass === "first" ? 50 * seatCount : 0;
        const totalPrice = baseFare + seatUpgrades;
        const fareClass =
          fareClassList[Math.floor(Math.random() * fareClassList.length)];

        const statuses = ["pending", "confirmed", "cancelled"] as const;
        const status =
          Math.random() > 0.1
            ? "confirmed"
            : statuses[Math.floor(Math.random() * 3)];

        const seats = [];
        for (let s = 0; s < seatCount; s++) {
          seats.push({
            id: crypto.randomUUID(),
            number: `${Math.floor(Math.random() * 20) + 1}${["A", "B", "C", "D"][Math.floor(Math.random() * 4)]}`,
            class: seatClass,
            price: trip.basePrice + (seatClass === "first" ? 50 : 0),
          });
        }

        try {
          const booking = await this.bookings.create({
            reference,
            departureStation: departureStation.name,
            arrivalStation: arrivalStation.name,
            departureTime: trip.departureTime,
            arrivalTime: trip.arrivalTime,
            travelDate: tripInstance.travelDate,
            trainNumber: trip.trainNumber,
            trainType: trip.trainType,
            passengerFirstName: firstName,
            passengerLastName: lastName,
            passengerEmail: email,
            seats,
            baseFare,
            seatUpgrades,
            totalPrice,
            passengerCount: seatCount,
            status,
            tripInstanceId: tripInstance.id,
            fareClassId: fareClass?.id,
            fareClassName: fareClass?.name,
            lockedBasePrice: trip.basePrice,
            priceMultiplierApplied: 1.0,
            priceCalculatedAt: createdAt.toISOString(),
          });

          bookingRefs.push({
            id: booking.id,
            reference,
            amount: Math.round(totalPrice * 100),
            email,
          });
          result.bookings++;
        } catch (error) {
          this.log.warn("Failed to create booking", {
            reference,
            error: String(error),
          });
        }
      }
      this.log.info("Created bookings", { count: result.bookings });

      // Create payments for bookings
      for (const booking of bookingRefs) {
        const createdAt = randomPastDate();
        const paymentMethods = [
          "card",
          "paypal",
          "apple_pay",
          "google_pay",
        ] as const;
        const method =
          paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
        const cardBrands = ["visa", "mastercard", "amex"];
        const statuses = [
          "completed",
          "completed",
          "completed",
          "failed",
          "refunded",
        ] as const;
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        try {
          await this.payments.create({
            bookingId: booking.id,
            bookingReference: booking.reference,
            amount: booking.amount,
            currency: "CAD",
            method,
            cardLast4:
              method === "card"
                ? String(1000 + Math.floor(Math.random() * 9000))
                : undefined,
            cardBrand:
              method === "card"
                ? cardBrands[Math.floor(Math.random() * cardBrands.length)]
                : undefined,
            stripePaymentIntentId: `pi_${crypto.randomUUID().replace(/-/g, "").substring(0, 24)}`,
            transactionId: `txn_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`,
            payerEmail: booking.email,
            status,
            failureReason: status === "failed" ? "Card declined" : undefined,
            refundedAt:
              status === "refunded" ? createdAt.toISOString() : undefined,
            refundAmount: status === "refunded" ? booking.amount : undefined,
          });
          result.payments++;
        } catch (error) {
          this.log.warn("Failed to create payment", {
            bookingId: booking.id,
            error: String(error),
          });
        }
      }
      this.log.info("Created payments", { count: result.payments });

      // Create 30 fake issues with messages
      const issueCategories = [
        "refund",
        "complaint",
        "inquiry",
        "feedback",
        "technical",
      ];
      const issuePriorities = ["low", "medium", "high", "urgent"] as const;
      const issueStatuses = [
        "open",
        "pending",
        "accepted",
        "rejected",
      ] as const;

      for (let i = 0; i < 30; i++) {
        const createdAt = randomPastDate();
        const customerId =
          customerIds.length > 0
            ? customerIds[Math.floor(Math.random() * customerIds.length)]
            : undefined;
        const bookingRef =
          bookingRefs.length > 0 && Math.random() > 0.5
            ? bookingRefs[Math.floor(Math.random() * bookingRefs.length)]
            : undefined;
        const category =
          issueCategories[Math.floor(Math.random() * issueCategories.length)];
        const priority =
          issuePriorities[Math.floor(Math.random() * issuePriorities.length)];
        const status =
          issueStatuses[Math.floor(Math.random() * issueStatuses.length)];

        const issueTitles: Record<string, string[]> = {
          refund: [
            "Request refund for cancelled trip",
            "Partial refund needed",
            "Refund not received",
          ],
          complaint: [
            "Late departure",
            "Unclean carriage",
            "Staff behavior",
            "Seat assignment issue",
          ],
          inquiry: [
            "How to modify booking?",
            "Loyalty points question",
            "Group booking inquiry",
          ],
          feedback: [
            "Great service!",
            "Suggestion for improvement",
            "App feature request",
          ],
          technical: [
            "App not loading",
            "Payment failed",
            "Cannot download ticket",
          ],
        };

        const titles = issueTitles[category] || ["General inquiry"];
        const title = titles[Math.floor(Math.random() * titles.length)];

        try {
          const issue = await this.issues.create({
            title,
            description: fake.lorem.paragraphs(2),
            status,
            creatorType: "customer",
            creatorId: customerId,
            customerId,
            bookingId: bookingRef?.id,
            priority,
            category,
            tags: [category],
            resolvedAt:
              status === "accepted" || status === "rejected"
                ? createdAt.toISOString()
                : undefined,
            resolutionNotes:
              status === "accepted"
                ? "Issue resolved to customer satisfaction"
                : status === "rejected"
                  ? "Unable to process request"
                  : undefined,
          });

          // Create initial message
          await this.issueMessages.create({
            issueId: issue.id,
            messageType: "comment",
            authorType: "customer",
            authorId: customerId,
            authorName: "Customer",
            content: fake.lorem.paragraph(),
          });
          result.issueMessages++;

          // Add 1-3 follow-up messages
          const messageCount = 1 + Math.floor(Math.random() * 3);
          for (let m = 0; m < messageCount; m++) {
            const authorTypes = ["customer", "agent", "system"] as const;
            const authorType =
              authorTypes[Math.floor(Math.random() * authorTypes.length)];

            await this.issueMessages.create({
              issueId: issue.id,
              messageType: authorType === "system" ? "system" : "comment",
              authorType,
              authorId: authorType === "customer" ? customerId : undefined,
              authorName:
                authorType === "customer"
                  ? "Customer"
                  : authorType === "agent"
                    ? "Support Agent"
                    : "System",
              content:
                authorType === "system"
                  ? "Status updated automatically"
                  : fake.lorem.paragraph(),
            });
            result.issueMessages++;
          }

          result.issues++;
        } catch (error) {
          this.log.warn("Failed to create issue", {
            title,
            error: String(error),
          });
        }
      }
      this.log.info("Created issues", { count: result.issues });

      // Create 40 fake product orders
      for (let i = 0; i < 40; i++) {
        const createdAt = randomPastDate();
        const firstName = fake.person.firstName();
        const lastName = fake.person.lastName();
        const email = fake.internet
          .email({ firstName, lastName })
          .toLowerCase();
        const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${String(i).padStart(4, "0")}`;

        const orderStatuses = [
          "pending",
          "confirmed",
          "fulfilled",
          "cancelled",
          "refunded",
        ] as const;
        const status =
          orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
        const paymentStatuses = [
          "pending",
          "paid",
          "failed",
          "refunded",
        ] as const;
        const paymentStatus =
          status === "fulfilled"
            ? "paid"
            : paymentStatuses[
                Math.floor(Math.random() * paymentStatuses.length)
              ];
        const channels = [
          "web",
          "mobile",
          "onboard",
          "station",
          "agent",
        ] as const;
        const channel = channels[Math.floor(Math.random() * channels.length)];
        const paymentMethods = ["card", "cash", "voucher", "invoice"] as const;
        const paymentMethod =
          paymentMethods[Math.floor(Math.random() * paymentMethods.length)];

        // Generate random items
        const itemCount = 1 + Math.floor(Math.random() * 4);
        const orderItems: OrderItem[] = [];
        let subtotal = 0;
        let taxAmount = 0;

        for (let j = 0; j < itemCount && productsList.length > 0; j++) {
          const product =
            productsList[Math.floor(Math.random() * productsList.length)];
          const quantity = 1 + Math.floor(Math.random() * 3);
          const itemSubtotal = product.price * quantity;
          const taxRate = product.taxRate ?? 13;
          const itemTax = itemSubtotal * (taxRate / 100);
          subtotal += itemSubtotal;
          taxAmount += itemTax;

          orderItems.push({
            productId: product.id,
            productName: product.name,
            productSku: product.sku ?? `SKU-${product.id.substring(0, 8)}`,
            category: product.category ?? "general",
            quantity,
            unitPrice: product.price,
            taxRate,
            subtotal: itemSubtotal,
            taxAmount: itemTax,
            total: itemSubtotal + itemTax,
            status: status === "fulfilled" ? "fulfilled" : "pending",
            fulfilledAt:
              status === "fulfilled" ? createdAt.toISOString() : undefined,
          });
        }

        if (orderItems.length === 0) continue;

        const total = subtotal + taxAmount;

        try {
          await this.productOrders.create({
            orderNumber,
            customerEmail: email,
            customerName: `${firstName} ${lastName}`,
            channel,
            isBookingAddOn: Math.random() > 0.7,
            status,
            items: orderItems,
            itemCount: orderItems.reduce((sum, item) => sum + item.quantity, 0),
            subtotal,
            taxAmount,
            discountAmount: 0,
            total,
            currency: "CAD",
            paymentStatus,
            paymentMethod,
            paidAt:
              paymentStatus === "paid" ? createdAt.toISOString() : undefined,
            fulfilledAt:
              status === "fulfilled" ? createdAt.toISOString() : undefined,
            refundedAt:
              status === "refunded" ? createdAt.toISOString() : undefined,
            createdAt: createdAt.toISOString(),
          });
          result.productOrders++;
        } catch (error) {
          this.log.warn("Failed to create product order", {
            orderNumber,
            error: String(error),
          });
        }
      }
      this.log.info("Created product orders", { count: result.productOrders });

      this.log.info("Database population completed", result);

      return {
        ok: true,
        created: result,
      };
    },
  });

  /**
   * Generate a random 6-character booking reference.
   */
  protected generateBookingReference(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let ref = "";
    for (let i = 0; i < 6; i++) {
      ref += chars[Math.floor(Math.random() * chars.length)];
    }
    return ref;
  }

  /**
   * Clear all tables in the correct order.
   */
  protected async clearAllTables() {
    this.log.info("Clearing all tables");

    // Order matters due to foreign key constraints
    // 1. Clear transactional data
    await this.payments.deleteMany({});
    await this.bookings.deleteMany({});
    await this.seatReservations.deleteMany({});

    // 2. Clear inventory
    await this.tripInstances.deleteMany({});

    // 3. Clear master data
    await this.trips.deleteMany({});
    await this.stations.deleteMany({});
    await this.seatLayouts.deleteMany({});
    await this.fareClasses.deleteMany({});
    await this.priceRules.deleteMany({});

    // 4. Clear customers (addresses/passengers are now embedded JSONB)
    await this.vouchers.deleteMany({});
    await this.customers.deleteMany({});

    // 5. Clear agents (profiles only - users remain)
    await this.agentProfiles.deleteMany({});

    // 6. Clear devices
    await this.devices.deleteMany({});

    // 7. Clear product orders (before products due to potential FK)
    await this.productOrders.deleteMany({});

    // 8. Clear products
    await this.products.deleteMany({});

    // 9. Clear notifications
    await this.notifications.deleteMany({});

    // 10. Clear issues and messages
    await this.issueMessages.deleteMany({});
    await this.issues.deleteMany({});

    // 11. Clear user data for both realms (sessions, identities, users)
    const customerRealm = this.userRealmProvider.getRealm(CUSTOMER_REALM);
    const agentRealm = this.userRealmProvider.getRealm(AGENT_REALM);

    // Clear sessions first (FK to users)
    await customerRealm.repositories.sessions.deleteMany({});
    await agentRealm.repositories.sessions.deleteMany({});

    // Clear identities (FK to users)
    await customerRealm.repositories.identities.deleteMany({});
    await agentRealm.repositories.identities.deleteMany({});

    // Clear users
    await customerRealm.repositories.users.deleteMany({});
    await agentRealm.repositories.users.deleteMany({});

    this.log.info("All tables cleared");
  }
}
