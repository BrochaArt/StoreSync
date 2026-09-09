// Queries del import inicial (guía §5.2, corregida: SIEMPRE con
// inventoryItem { id } — sin él no hay escrituras outbound §8).
//
// Nota (§5.1 paso 4): el available se pide POR LOCATION en una segunda fase
// (INVENTORY_BATCH_QUERY); el inventoryQuantity del §5.2 es el agregado de
// todas las locations y no sirve para inventory_levels(variant, location).

// Campos estándar del catálogo. Solo se piden campos que existen igual en
// CUALQUIER tienda Shopify: el gateway sirve a varios artistas con un mismo
// contrato, así que nada de convenciones de una tienda concreta.
// selectedOptions es el único lugar estándar donde vive el tamaño cuando un
// producto se vende en varias medidas.
export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query ProductsPage($cursor: String, $pageSize: Int!) {
    products(first: $pageSize, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        descriptionHtml
        status
        vendor
        productType
        tags
        category {
          id
          name
          fullName
        }
        collections(first: 20) {
          nodes {
            id
            title
            handle
          }
        }
        metafields(first: 25) {
          nodes {
            namespace
            key
            type
            value
          }
        }
        featuredImage {
          url
          altText
        }
        images(first: 50) {
          nodes {
            id
            url
            altText
          }
        }
        variants(first: 50) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            sku
            price
            position
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

export interface VariantNode {
  id: string;
  title: string | null;
  sku: string | null;
  price: string | null;
  /** Orden que el artista definió en su admin. Sin esto el orden es arbitrario. */
  position: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: { id: string };
}

export interface ProductNode {
  id: string;
  title: string | null;
  handle: string | null;
  descriptionHtml: string | null;
  status: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[] | null;
  category: { id: string; name: string; fullName: string } | null;
  collections: { nodes: Array<{ id: string; title: string; handle: string }> };
  metafields: {
    nodes: Array<{ namespace: string; key: string; type: string; value: string }>;
  };
  featuredImage: { url: string; altText: string | null } | null;
  images: { nodes: Array<{ id: string; url: string; altText: string | null }> };
  variants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: VariantNode[];
  };
}

export interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}

/** Variantes 51+ de un producto (catálogos con variantes masivas — PENDIENTES #4). */
export const EXTRA_VARIANTS_QUERY = /* GraphQL */ `
  query ExtraVariants($productId: ID!, $cursor: String) {
    product(id: $productId) {
      variants(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          sku
          price
          position
          selectedOptions {
            name
            value
          }
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

export interface ExtraVariantsData {
  product: {
    variants: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: VariantNode[];
    };
  } | null;
}

/**
 * Fase 2: available por item en TODAS sus locations, en lotes por ids.
 *
 * No se limita a la location primaria a propósito: los servicios de fulfillment
 * (Printful y similares) exponen su stock en una location propia que Shopify NO
 * devuelve en la consulta de `locations`. Pidiendo solo la primaria, esas
 * variantes llegaban al consumidor sin ninguna fila de inventario —
 * indistinguibles de "agotado" cuando en realidad son las que siempre hay.
 */
export const INVENTORY_BATCH_QUERY = /* GraphQL */ `
  query InventoryBatch($ids: [ID!]!, $levels: Int!) {
    nodes(ids: $ids) {
      __typename
      ... on InventoryItem {
        id
        inventoryLevels(first: $levels) {
          pageInfo {
            hasNextPage
          }
          nodes {
            location {
              id
              name
            }
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

export interface InventoryBatchData {
  nodes: Array<{
    __typename: string;
    id?: string;
    inventoryLevels?: {
      pageInfo: { hasNextPage: boolean };
      nodes: Array<{
        location: { id: string; name: string };
        quantities: Array<{ name: string; quantity: number }>;
      }>;
    } | null;
  } | null>;
}

export const PRODUCTS_COUNT_QUERY = /* GraphQL */ `
  query ProductsCount {
    productsCount {
      count
    }
  }
`;

export interface ProductsCountData {
  productsCount: { count: number } | null;
}
