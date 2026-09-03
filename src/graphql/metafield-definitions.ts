// Definiciones de metafield del namespace `custom` — la convención publicada
// (Decisión 7b): `custom.<clave>` alimenta el campo `<clave>` del contrato.
//
// Sin la DEFINICIÓN, el campo no aparece en el editor de productos de Shopify:
// el artista no tiene dónde escribir el atributo aunque quiera. Por eso crearlas
// es el primer paso de cualquier tienda nueva, antes de pedirle que cargue nada.
//
// Los tipos calcan los que ya funcionan en la primera tienda dada de alta, para
// que el mismo pipeline lea a todos los artistas sin excepciones por tienda.

export interface MetafieldDefinicion {
  key: string;
  name: string;
  description: string;
  type: string;
  /** Validaciones de Shopify, p.ej. la lista cerrada de `category`. */
  validations?: Array<{ name: string; value: string }>;
}

/** Vocabulario fijo de `category` — lo único del contrato que NO es texto libre. */
export const CATEGORIAS = ["Obra Original", "Replica", "Productos"] as const;

export const DEFINICIONES_CANONICAS: MetafieldDefinicion[] = [
  {
    key: "category",
    name: "Categoría",
    description: "Categoría de negocio de la pieza. Lista cerrada.",
    type: "single_line_text_field",
    validations: [{ name: "choices", value: JSON.stringify(CATEGORIAS) }],
  },
  {
    key: "size",
    name: "Tamaño",
    description: "Medidas de la pieza, p.ej. 100cm x 70cm. Si se vende en varias medidas, van como opción de variante.",
    type: "single_line_text_field",
  },
  {
    key: "year",
    name: "Año",
    description: "Año de la obra original.",
    type: "single_line_text_field",
  },
  {
    key: "technique",
    name: "Técnica",
    description: "Técnica o soporte, p.ej. Acrílico sobre lienzo.",
    type: "single_line_text_field",
  },
  {
    key: "material",
    name: "Material",
    description: "Material de la pieza. No usar para texto de marketing.",
    type: "multi_line_text_field",
  },
  {
    key: "paper_type",
    name: "Tipo de papel",
    description: "Papel o soporte de impresión, para réplicas y posters.",
    type: "multi_line_text_field",
  },
  {
    key: "additional_info",
    name: "Información adicional",
    description: "Notas sueltas sobre la pieza que no encajan en otro campo.",
    type: "multi_line_text_field",
  },
  {
    key: "nft_link",
    name: "Enlace NFT",
    description: "URL del NFT asociado, si existe.",
    type: "multi_line_text_field",
  },
  {
    key: "shipping",
    name: "Envío",
    description: "Nota de envío que verá el comprador, p.ej. Worldwide free shipping.",
    type: "multi_line_text_field",
  },
  {
    key: "about_the_artwork",
    name: "About the artwork",
    description: "Texto del artista sobre la obra.",
    type: "rich_text_field",
  },
];

export const LIST_DEFINITIONS_QUERY = /* GraphQL */ `
  query MetafieldDefs($cursor: String) {
    metafieldDefinitions(first: 100, after: $cursor, ownerType: PRODUCT, namespace: "custom") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        key
        name
        type {
          name
        }
      }
    }
  }
`;

export interface ListDefinitionsData {
  metafieldDefinitions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ key: string; name: string; type: { name: string } }>;
  };
}

export const CREATE_DEFINITION_MUTATION = /* GraphQL */ `
  mutation CrearDefinicion($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export interface CreateDefinitionData {
  metafieldDefinitionCreate: {
    createdDefinition: { id: string; key: string } | null;
    userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
  };
}
