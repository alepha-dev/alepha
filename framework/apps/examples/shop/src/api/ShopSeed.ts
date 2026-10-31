import {
  CatalogService,
  type OptionGroup,
  orderConfig,
  StockService,
  VariantService,
} from "@alepha/commerce";
import { sellerIdentityAtom } from "@alepha/commerce/invoicing";
import { PromotionService } from "@alepha/commerce/promotions";
import { ShippingService } from "@alepha/commerce/shipping";
import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import { ShopDrawings } from "./ShopDrawings.ts";
import { ShopMedia } from "./ShopMedia.ts";

/**
 * One catalogue entry, with the drawing that will be generated for it.
 */
interface Piece {
  slug: string;
  name: string;
  description: string;
  /**
   * Tax-inclusive price in cents.
   */
  price: number;
  kind?: string;
  /**
   * Metal titre, shown in the poinçon.
   */
  titre: string;
  metal: string;
  /**
   * Grams.
   */
  poids: string;
  /**
   * The grams a delivery rate reads, on what `poids` says for a person.
   */
  grammes?: number;
  compareAtPrice?: number;
  metaTitle?: string;
  dimensions: string;
  drawing: string;
  stock: number;
  config?: Record<string, any>;
  /**
   * The file a digital piece delivers: stored at seed time, since its id is
   * what goes in the config.
   */
  download?: { name: string; text: string };
  /**
   * The choices a buyer makes, and one entry per combination. `stock` is then
   * not used: a product sold by variant holds its stock on them.
   */
  optionGroups?: OptionGroup[];
  variants?: Array<{
    sku: string;
    options: Record<string, string>;
    price?: number;
    stock: number;
  }>;
}

/**
 * Fills the shop on boot: the seller's legal identity, the delivery zones, and
 * the catalogue with a generated drawing per piece.
 *
 * Idempotent on slug and on zone count, so restarting does not duplicate
 * anything.
 */
export class ShopSeed {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly catalog = $inject(CatalogService);
  protected readonly stock = $inject(StockService);
  protected readonly variants = $inject(VariantService);
  protected readonly shipping = $inject(ShippingService);
  protected readonly promotions = $inject(PromotionService);
  protected readonly media = $inject(ShopMedia);
  protected readonly drawings = $inject(ShopDrawings);

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Without this every invoice would claim to come from "Unnamed seller",
      // which is the default precisely so that forgetting is visible.
      this.alepha.store.set(sellerIdentityAtom.key, {
        name: "Atelier Aurore",
        address: "12 rue des Orfèvres, 75001 Paris",
        registrationNumber: "912 345 678 00012",
        legalForm: "SASU",
        vatNumber: "FR91234567800",
        email: "contact@atelier-aurore.test",
        numberPrefix: "FA",
        // A Paris atelier bills on Paris dates: a sale at 00:30 on 1 January
        // is a January sale, not a 31 December one.
        timezone: "Europe/Paris",
      });

      // Francs in the back office, for the price lists: the storefront stays in
      // euros, since a cart only changes currency when it is asked to.
      this.alepha.store.set(orderConfig.key, {
        ...this.alepha.store.get(orderConfig.key)!,
        currencies: ["EUR", "CHF"],
      });

      await this.seedShipping();
      await this.seedCatalogue();
      await this.seedPromotions();
    },
  });

  /**
   * One code, so the cart's field has something to accept.
   */
  protected async seedPromotions(): Promise<void> {
    if (await this.promotions.findByCode("BIENVENUE10")) {
      return;
    }
    await this.promotions.create({
      name: "Bienvenue à l'atelier",
      code: "BIENVENUE10",
      kind: "percent",
      value: 1000,
    });
  }

  protected pieces(): Piece[] {
    const { OR_JAUNE, OR_GRIS, ARGENT } = ShopDrawings;
    return [
      {
        slug: "collier-aurore",
        name: "Collier Aurore",
        description:
          "Une goutte de nacre taillée à la main, suspendue à une chaîne forçat. La nacre est prélevée sur des coquilles d'élevage bretonnes ; deux gouttes ne sont jamais du même blanc.",
        price: 8900,
        compareAtPrice: 10900,
        metaTitle: "Collier en nacre et argent 925, taillé main",
        titre: "925",
        metal: "Argent",
        poids: "4,2 g",
        grammes: 4,
        dimensions: "Chaîne 42 cm · goutte 18 × 11 mm",
        drawing: this.drawings.necklace(ARGENT),
        stock: 6,
        config: { trackStock: true, lowStockThreshold: 2 },
      },
      {
        slug: "bague-solstice",
        name: "Bague Solstice",
        description:
          "Un anneau large à face plate, gravé à la main au burin. La gravure est faite après votre commande : comptez une semaine de plus, et dites-nous quoi y écrire.",
        price: 24900,
        kind: "engraved",
        titre: "750",
        metal: "Or jaune 18 carats",
        poids: "6,8 g",
        dimensions: "Largeur 7 mm · gravure 20 signes",
        drawing: this.drawings.ring(OR_JAUNE, { engraved: true }),
        stock: 3,
        config: { maxCharacters: 20, extraLeadDays: 7 },
      },
      {
        slug: "bague-nadir",
        name: "Bague Nadir",
        description:
          "Un grenat de 4 mm serti clos, posé bas sur l'anneau pour qu'il ne s'accroche à rien. La pierre vient d'un lot unique acheté à Lyon en 2024.",
        price: 69000,
        titre: "750",
        metal: "Or jaune 18 carats",
        poids: "5,1 g",
        dimensions: "Grenat 4 mm · anneau 2,4 mm",
        drawing: this.drawings.ringWithStone(OR_JAUNE),
        stock: 2,
        config: { trackStock: true, lowStockThreshold: 1 },
      },
      {
        slug: "bracelet-meridien",
        name: "Bracelet Méridien",
        description:
          "Sept maillons rectangulaires, chacun limé et poli séparément. Il tombe à plat sur le poignet plutôt que de rouler.",
        price: 42000,
        titre: "750",
        metal: "Or gris 18 carats",
        poids: "18,4 g",
        dimensions: "19 cm · maillons 9 × 13 mm",
        drawing: this.drawings.bracelet(OR_GRIS),
        stock: 4,
        config: { trackStock: true, lowStockThreshold: 1 },
      },
      {
        slug: "boucles-eclipse",
        name: "Boucles Éclipse",
        description:
          "Deux disques décalés, l'un passant devant l'autre. Le disque arrière est bruni, le disque avant poli miroir — l'un avale la lumière que l'autre renvoie.",
        price: 14500,
        titre: "925",
        metal: "Argent",
        poids: "3,1 g la paire",
        dimensions: "Disques 14 mm · tige 11 mm",
        drawing: this.drawings.earrings(ARGENT),
        stock: 8,
        config: { trackStock: true, lowStockThreshold: 2 },
      },
      {
        slug: "alliance-zenith",
        name: "Alliance Zénith",
        description:
          "Un jonc plein, sans soudure apparente, tourné à la taille de votre doigt. La plus grande taille demande un peu plus d'or, et le prix le dit.",
        price: 42000,
        titre: "750",
        metal: "Or gris 18 carats",
        poids: "4,4 g",
        dimensions: "Largeur 3 mm · jonc plein",
        drawing: this.drawings.ring(OR_GRIS),
        stock: 0,
        config: { trackStock: true, lowStockThreshold: 1 },
        optionGroups: [{ name: "Taille", values: ["50", "54", "58"] }],
        variants: [
          { sku: "ZENITH-50", options: { Taille: "50" }, stock: 2 },
          { sku: "ZENITH-54", options: { Taille: "54" }, stock: 3 },
          {
            sku: "ZENITH-58",
            options: { Taille: "58" },
            price: 45000,
            stock: 1,
          },
        ],
      },
      {
        slug: "carte-cadeau-50",
        name: "Carte cadeau",
        description:
          "Cinquante euros à dépenser à l'atelier, envoyés par courriel dans la minute. Valable deux ans.",
        price: 5000,
        kind: "digital",
        titre: "—",
        metal: "Dématérialisé",
        poids: "—",
        dimensions: "Envoi immédiat",
        drawing: this.drawings.giftCard(ShopDrawings.OR_JAUNE),
        stock: 0,
        download: {
          name: "carte-cadeau.txt",
          text: "Carte cadeau de cinquante euros, valable deux ans.",
        },
      },
    ];
  }

  protected async seedCatalogue(): Promise<void> {
    for (const piece of this.pieces()) {
      if (await this.catalog.findBySlug(piece.slug)) {
        continue;
      }

      const fileId = await this.media.storeDrawing(piece.slug, piece.drawing);

      const product = await this.catalog.create({
        slug: piece.slug,
        name: piece.name,
        description: piece.description,
        price: piece.price,
        compareAtPrice: piece.compareAtPrice,
        metaTitle: piece.metaTitle,
        weightGrams: piece.grammes,
        kind: piece.kind,
        published: true,
        images: [fileId],
        // The kind's payload. Anything not declared by its handler's schema is
        // stripped on write, which is why the spec plate lives in `attributes`.
        config: piece.download
          ? {
              fileId: await this.media.storeDownload(
                piece.download.name,
                piece.download.text,
              ),
            }
          : piece.config,
        optionGroups: piece.optionGroups,
        attributes: {
          titre: piece.titre,
          metal: piece.metal,
          poids: piece.poids,
          dimensions: piece.dimensions,
        },
      });

      if (piece.stock > 0) {
        await this.stock.recordIntake(product.id, piece.stock, {
          note: "Put on display",
        });
      }
      for (const { stock, ...variant } of piece.variants ?? []) {
        const created = await this.variants.create(product.id, variant);
        await this.stock.recordIntake(product.id, stock, {
          note: "Put on display",
          variantId: created.id,
        });
      }
      this.log.info(`Seeded '${piece.slug}'`);
    }
  }

  /**
   * A France zone and a broader EU one, with the narrow zone at priority 0 so it
   * wins for French addresses.
   */
  protected async seedShipping(): Promise<void> {
    if ((await this.shipping.listZones()).length > 0) {
      return;
    }

    const france = await this.shipping.createZone({
      name: "France",
      countries: ["FR"],
      priority: 0,
    });
    await this.shipping.createRate({
      zoneId: france.id,
      code: "colissimo",
      name: "Colissimo suivi",
      price: 690,
      freeAbove: 15000,
      minDays: 2,
      maxDays: 3,
    });
    await this.shipping.createRate({
      zoneId: france.id,
      code: "retrait",
      name: "Retrait à l'atelier",
      price: 0,
      minDays: 1,
      maxDays: 1,
    });

    const eu = await this.shipping.createZone({
      name: "Union européenne",
      countries: ["AT", "BE", "DE", "ES", "IE", "IT", "LU", "NL", "PT"],
      priority: 10,
    });
    await this.shipping.createRate({
      zoneId: eu.id,
      code: "eu-standard",
      name: "Standard Europe",
      price: 1490,
      minDays: 5,
      maxDays: 8,
    });

    this.log.info("Seeded shipping zones");
  }
}
