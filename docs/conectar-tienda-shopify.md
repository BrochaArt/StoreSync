# Conectar tu tienda de Shopify a StoreSync

Para sincronizar tu catálogo (productos, variantes, inventario, imágenes) necesitamos
que crees una app privada en tu tienda y nos compartas sus credenciales. Son 10 minutos.

## Qué es esto (y qué no)

Es una app instalada **solo en tu tienda**, que nos da permiso para leer tu catálogo y
mantener el inventario sincronizado. No es una app pública, nadie más la ve ni la usa.
Puedes desinstalarla cuando quieras desde tu propio admin — eso corta el acceso al
instante.

## Paso 1 — Encuentra tu dominio `.myshopify.com`

Toda tienda de Shopify tiene un dominio interno con esa terminación, aunque tengas un
dominio propio (ej. `tutienda.com`). Para encontrarlo:

- Entra a tu admin de Shopify y mira la barra de direcciones: verás algo como
  `admin.shopify.com/store/`**`abc123`** → tu dominio es **`abc123.myshopify.com`**
- O ve a **Settings → Domains**, ahí aparece listado

Anótalo, lo vas a necesitar al final.

## Paso 2 — Crea la app

⚠️ **Créala desde el admin de TU PROPIA tienda.** No la crees desde
partners.shopify.com ni desde el Dev Dashboard de otra organización — si la app nace
fuera de tu tienda, Shopify después rechaza la conexión con el error
`shop_not_permitted`, y no hay forma de arreglarlo salvo volver a crearla por el
camino correcto. (El Client Credentials grant solo funciona cuando la app y la tienda
son de la misma organización; una app creada dentro de tu admin cumple eso siempre.)
De paso, el camino de abajo crea una app privada que se instala al instante, sin la
revisión de Shopify que exigen las apps públicas.

1. En el admin de tu tienda: **Settings → Apps and sales channels → Develop apps**
2. Si es la primera vez, te pedirá confirmar **Allow custom app development**
3. **Create an app** (o "Create custom app")
4. Ponle un nombre — por ejemplo `StoreSync`
5. Entra a **Configuration** → **Admin API integration** → **Configure** → busca la
   sección **Admin API access scopes**
6. Marca **exactamente** estos permisos y ningún otro (no marques nada de clientes,
   empleados/colaboradores, ni "propietario de tienda"):
   - `read_products`
   - `write_products`
   - `read_inventory`
   - `write_inventory`
   - `read_orders`
   - `read_locations`

7. **Save**

## Paso 3 — Instala la app en tu tienda

Crearla no es suficiente — falta instalarla. Esto se hace **en el mismo lugar donde
creaste la app** (no hay que ir a otro sitio):

- Dentro de esa misma app, ve a la pestaña **API credentials**
- Haz clic en **Install app** (puede decir "Instalar app")
- Confirma

Si el botón **Instalar** aparece deshabilitado con un aviso de "Esta app está en
revisión", algo quedó mal configurado en el Paso 2 (probablemente se creó desde
Partners como app pública). La solución es recrearla siguiendo el Paso 2 desde el
admin de tu propia tienda — ese camino jamás pide revisión.

## Paso 4 — Copia las dos credenciales

Ya instalada, sigue en **API credentials** → sección **Client credentials**:

- **Client ID** — se ve directo en pantalla
- **Client secret** — haz clic en revelarlo (algo como "Reveal once" / "Ver una vez").

⚠️ **Shopify solo te lo muestra una vez.** Cópialo a un lugar seguro (tu gestor de
contraseñas, por ejemplo) apenas lo veas. Si cierras la página sin copiarlo, no hay
forma de recuperarlo — hay que generar uno nuevo.

## Paso 5 — Envíanos los 3 datos

Necesitamos:

| Dato | Ejemplo |
|---|---|
| Dominio | `abc123.myshopify.com` |
| Client ID | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6` |
| Client secret | `shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |

**El client secret es sensible — trátalo como una contraseña.** Mejor evita mandarlo
por un chat que quede guardado permanentemente (WhatsApp/email sin cifrar). Si tienes
forma de compartirlo por un gestor de contraseñas o un mensaje que se autodestruya,
mejor. Si no, un mensaje directo está bien — solo avísanos para rotarlo después si en
algún momento pasó por un canal que no controlas.

Con esos tres datos, la sincronización queda lista del lado nuestro.
