// Perfil de la tienda y definiciones de metafields.
//
// De aquí sale el bloque `artist` del API: nombre, email, web y bio son campos
// ESTÁNDAR de `shop { }`, presentes en cualquier tienda Shopify. Nada de
// deducir el artista desde `vendor` (suele ser la marca, no la persona) ni
// desde un metafield de SEO.

export const SHOP_PROFILE_QUERY = /* GraphQL */ `
  query ShopProfile {
    shop {
      name
      email
      contactEmail
      url
      description
      currencyCode
    }
  }
`;

export interface ShopProfileData {
  shop: {
    name: string | null;
    /** email de la cuenta */
    email: string | null;
    /** email de cara al público — se prefiere este */
    contactEmail: string | null;
    url: string | null;
    description: string | null;
    /**
     * Moneda en la que el artista publica sus precios. Sin esto el API entrega
     * números sin unidad y el consumidor adivina: un grabado de S/. 475 se
     * publicó como USD 475, casi cuatro veces su precio.
     */
    currencyCode: string | null;
  };
}

// Etiqueta legible de cada metafield, tal como el artista la definió en SU
// Shopify. Es lo que permite devolver `details` con nombre ("Shipping",
// "About the artwork") sin que nosotros hardcodeemos una sola clave.
export const METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query MetafieldDefinitions($cursor: String) {
    metafieldDefinitions(ownerType: PRODUCT, first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        namespace
        key
        name
      }
    }
  }
`;

export interface MetafieldDefinitionsData {
  metafieldDefinitions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ namespace: string; key: string; name: string }>;
  };
}
