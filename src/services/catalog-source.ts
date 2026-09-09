// Fuente de catálogo para el import inicial (guía §5).
// La interfaz existe para que Bulk Operations (§5.3) sea un swap, no un rewrite.

import {
  EXTRA_VARIANTS_QUERY,
  PRODUCTS_PAGE_QUERY,
  type ExtraVariantsData,
  type ProductNode,
  type ProductsPageData,
} from "../graphql/products.query.js";
import { numericId } from "./gid.js";
import { shopifyGraphql } from "./shopify-client.js";

export interface ImagenImportada {
  shopifyImageId: string | null;
  url: string;
  altText: string | null;
  position: number;
}

export interface OpcionVariante {
  name: string;
  value: string;
}

export interface VarianteImportada {
  shopifyVariantId: string; // numérico
  inventoryItemId: string; // numérico — OBLIGATORIO (§5, advertencia de la guía)
  title: string | null;
  sku: string | null;
  price: string | null;
  /**
   * Orden que el artista definió en su admin de Shopify. Sin esto el API
   * entregaba las variantes ordenadas por uuid, o sea al azar: en la ficha de
   * un grabado eso ponía adelante "A4 / Con marco" (S/. 475) en vez de la
   * primera real, "A4 / Sin marco" (S/. 395), y con ella el precio de portada.
   */
  position: number | null;
  /** selectedOptions tal cual: donde el tamaño es opción, vive aquí */
  options: OpcionVariante[];
}

export interface CategoriaTaxonomia {
  id: string;
  name: string;
  full_name: string;
}

export interface ColeccionImportada {
  id: string; // numérico
  title: string;
  handle: string;
}

export interface MetafieldImportado {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface ProductoImportado {
  shopifyProductId: string; // numérico
  title: string | null;
  handle: string | null;
  descriptionHtml: string | null;
  status: string | null;
  // Campos estándar: se guardan crudos, sin interpretar. Traducir "Posters" a
  // una categoría de negocio es convención de UNA tienda — eso lo decide el
  // consumidor, no nosotros (rompería al siguiente artista).
  vendor: string | null;
  productType: string | null;
  tags: string[];
  category: CategoriaTaxonomia | null;
  collections: ColeccionImportada[];
  metafields: MetafieldImportado[];
  images: ImagenImportada[];
  variants: VarianteImportada[];
}

export interface CatalogSource {
  /** Entrega el catálogo completo por páginas, con inventoryItem.id por variante. */
  fetchCatalog(): AsyncGenerator<ProductoImportado[]>;
}

const PAGE_SIZE = 25; // contiene el costo: 25 productos × 50 variantes + imágenes

/** Import paginado (§5.2) — adecuado para catálogos chicos/medianos. */
export class PaginatedCatalogSource implements CatalogSource {
  constructor(
    private readonly shopDomain: string,
    private readonly accessToken: string,
  ) {}

  async *fetchCatalog(): AsyncGenerator<ProductoImportado[]> {
    let cursor: string | null = null;
    do {
      const page: ProductsPageData = await shopifyGraphql<ProductsPageData>({
        shopDomain: this.shopDomain,
        accessToken: this.accessToken,
        query: PRODUCTS_PAGE_QUERY,
        variables: { cursor, pageSize: PAGE_SIZE },
      });

      const productos: ProductoImportado[] = [];
      for (const node of page.products.nodes) {
        productos.push(await this.mapProduct(node));
      }
      yield productos;

      cursor = page.products.pageInfo.hasNextPage ? page.products.pageInfo.endCursor : null;
    } while (cursor);
  }

  private async mapProduct(node: ProductNode): Promise<ProductoImportado> {
    // Variantes 51+: paginación anidada aparte (PENDIENTES #4)
    let variants = node.variants.nodes;
    let vCursor = node.variants.pageInfo.hasNextPage ? node.variants.pageInfo.endCursor : null;
    while (vCursor) {
      const extra: ExtraVariantsData = await shopifyGraphql<ExtraVariantsData>({
        shopDomain: this.shopDomain,
        accessToken: this.accessToken,
        query: EXTRA_VARIANTS_QUERY,
        variables: { productId: node.id, cursor: vCursor },
      });
      const conn = extra.product?.variants;
      if (!conn) break;
      variants = variants.concat(conn.nodes);
      vCursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    }

    // Imágenes: featuredImage primero (posición 0), resto en orden, dedupe por url
    const images: ImagenImportada[] = [];
    const seen = new Set<string>();
    if (node.featuredImage?.url) {
      images.push({
        shopifyImageId: null,
        url: node.featuredImage.url,
        altText: node.featuredImage.altText,
        position: 0,
      });
      seen.add(node.featuredImage.url);
    }
    for (const img of node.images.nodes) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      images.push({
        shopifyImageId: numericId(img.id),
        url: img.url,
        altText: img.altText,
        position: images.length,
      });
    }

    return {
      shopifyProductId: numericId(node.id),
      title: node.title,
      handle: node.handle,
      descriptionHtml: node.descriptionHtml,
      status: node.status?.toLowerCase() ?? null,
      vendor: node.vendor?.trim() || null,
      productType: node.productType?.trim() || null,
      tags: node.tags ?? [],
      category: node.category
        ? {
            // El id de taxonomía NO es numérico (gid://shopify/TaxonomyCategory/ae-2-1),
            // así que no pasa por numericId: se toma el último segmento.
            id: node.category.id.split("/").pop() ?? node.category.id,
            name: node.category.name,
            full_name: node.category.fullName,
          }
        : null,
      collections: node.collections.nodes.map((c) => ({
        id: numericId(c.id),
        title: c.title,
        handle: c.handle,
      })),
      metafields: node.metafields.nodes.map((m) => ({
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: m.value,
      })),
      images,
      variants: variants.map((v) => ({
        shopifyVariantId: numericId(v.id),
        inventoryItemId: numericId(v.inventoryItem.id), // sin esto no hay outbound (§8)
        title: v.title,
        sku: v.sku,
        price: v.price,
        position: v.position,
        // Se guarda el nombre con trim (hay tiendas con la opción " Size"),
        // pero el VALOR no se toca: "30x 40" no se reescribe a "30cm x 40cm"
        // porque la unidad no está en el dato.
        options: (v.selectedOptions ?? []).map((o) => ({
          name: o.name.trim(),
          value: o.value,
        })),
      })),
    };
  }
}

/**
 * Camino listo para catálogos grandes (guía §5.3): Bulk Operations corre la
 * query server-side y devuelve un JSONL descargable, sin drenar el rate limit
 * normal. Implementación pendiente:
 *   1. bulkOperationRunQuery con la query de productos+variantes(+inventoryItem.id)
 *   2. poll de currentBulkOperation hasta COMPLETED (o webhook bulk_operations/finish)
 *   3. descargar el JSONL (url firmada), parsear líneas padre/hijo (__parentId)
 *   4. yield en lotes de ProductoImportado — el resto del import no cambia
 */
export class BulkCatalogSource implements CatalogSource {
  // eslint-disable-next-line require-yield
  async *fetchCatalog(): AsyncGenerator<ProductoImportado[]> {
    throw new Error(
      "BulkCatalogSource pendiente: usar PaginatedCatalogSource (el import lo usa por defecto). Ver guía §5.3.",
    );
  }
}
