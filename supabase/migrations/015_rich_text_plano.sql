-- 015 — rich_text_plano: los metafields de tipo rich_text_field, legibles.
--
-- Shopify guarda `rich_text_field` como un árbol JSON, no como HTML:
--   {"type":"root","children":[{"type":"paragraph","children":[
--     {"type":"text","value":"“Obra”","bold":true},
--     {"type":"text","value":" es un tributo a…"}]}]}
--
-- El consumidor recibía ese blob y no podía mostrarlo. Aplanarlo es
-- normalización de formato —el árbol es de Shopify y es idéntico en toda
-- tienda—, así que no contradice la Decisión 7: no interpreta contenido.
--
-- Cambios en el contrato, los dos ADITIVOS:
--   · `details[].value_text` — el valor SIEMPRE legible. Para rich_text_field
--     es el árbol aplanado; para el resto, el mismo `value`. El consumidor
--     puede leer value_text siempre y olvidarse del `type`.
--   · `about_the_artwork` — sube a campo propio del producto, ya en texto
--     plano, siguiendo la convención custom.<clave> -> <clave>.

create or replace function rich_text_plano(p_valor text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_json jsonb;
begin
  if p_valor is null or btrim(p_valor) = '' then
    return null;
  end if;

  -- Si no es JSON válido no es rich text: se devuelve tal cual, así la
  -- función es segura de aplicar sobre cualquier metafield.
  begin
    v_json := p_valor::jsonb;
  exception when others then
    return p_valor;
  end;

  if jsonb_typeof(v_json) <> 'object' then
    return p_valor;
  end if;

  return nullif(
    btrim(regexp_replace(rich_text_nodo(v_json), '\n{3,}', E'\n\n', 'g'), E' \t\n\r'),
    ''
  );
end;
$$;

-- Recorre un nodo del árbol. Los bloques cierran con salto de línea; el resto
-- concatena en línea (un enlace o un fragmento en negrita no parte el párrafo).
create or replace function rich_text_nodo(p_nodo jsonb)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_tipo   text;
  v_hijo   jsonb;
  v_partes text := '';
begin
  if p_nodo is null or jsonb_typeof(p_nodo) <> 'object' then
    return '';
  end if;

  v_tipo := p_nodo->>'type';

  if v_tipo = 'text' then
    return coalesce(p_nodo->>'value', '');
  end if;

  if jsonb_typeof(p_nodo->'children') = 'array' then
    for v_hijo in select * from jsonb_array_elements(p_nodo->'children') loop
      v_partes := v_partes || rich_text_nodo(v_hijo);
    end loop;
  end if;

  if v_tipo in ('paragraph', 'heading', 'list-item') then
    return v_partes || E'\n';
  end if;

  return v_partes;
end;
$$;

comment on function rich_text_plano(text) is
  'rich_text_field de Shopify -> texto plano. Devuelve la entrada intacta si no es JSON.';
