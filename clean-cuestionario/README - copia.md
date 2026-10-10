# CLEAN · Cuestionario de diagnóstico de procesos

Página del cuestionario (estática) y función que recibe las respuestas, para Vercel.

```
Navegador ──POST /api/enviar──▶ Función (Vercel) ──▶ Supabase (guarda)
                                       │
                                       └──▶ n8n (webhook autenticado) ──▶ Gmail (aviso)
```

- Si **Supabase falla**, el cliente ve un error real y puede descargar sus respuestas. No se avisa a n8n.
- Si **n8n falla** después de guardar, el diagnóstico **no se pierde**: queda en Supabase con
  `notificacion_estado = 'fallida'` (o `'pendiente'` si la función se cortó) y se reenvía **a mano**
  con `scripts/reintentar-notificaciones.mjs`. **No hay reintentos automáticos.**
- Las respuestas que quedan en el navegador del cliente no se borran solas: se le ofrece borrarlas
  cuando el servidor confirma que están guardadas.

## Estructura

| Ruta | Qué es |
|---|---|
| `public/index.html` | El cuestionario. **Lo genera el kit; no se edita a mano** (ver «Actualizar el cuestionario») |
| `public/privacidad.html`, `public/aviso-legal.html` | **Borradores** con `[POR COMPLETAR]` |
| `api/enviar.js` | `POST /api/enviar` |
| `lib/` | Validación, reglas de privacidad del kit, Supabase, n8n, IP |
| `supabase/esquema.sql` | Tablas, funciones y permisos |
| `scripts/` | Comprobación antes de publicar (build), copiar el cuestionario, servidor local, reintentos |
| `tests/` | Pruebas (`npm test`) y prueba en navegador (`npm run test:navegador`) |

## Qué comprueba la función

En este orden, y sin tocar la base de datos hasta que el envío es válido:

1. Solo `POST` (si no, 405).
2. Interruptor `ENVIOS_HABILITADOS` (si no es `true`, 503 «todavía no está activo»).
3. Configuración completa (si no, 503, y se registra qué variable falta, nunca su valor).
4. Origen: la cabecera `Origin` tiene que ser el propio dominio (o uno de `ORIGENES_PERMITIDOS`).
   No se devuelven cabeceras CORS: solo funciona desde la propia web. **Esto frena envíos desde otras webs
   en el navegador, no a quien llame con un programa**: para eso están los límites.
5. `Content-Type: application/json` (415) y como mucho 1 MB (413).
6. Formato del cuestionario, casilla trampa vacía, empresa, nombre y email válidos, consentimiento.
7. **Reglas de privacidad del kit** (las mismas que `herramientas/borrador.mjs`): si el texto libre
   tiene correos, teléfonos, IBAN, DNI/NIE, tarjetas o contraseñas, se rechaza (422) diciendo **dónde**,
   sin repetir el dato. El email de contacto y la web de la empresa no cuentan, igual que en el kit.
8. **Límites de frecuencia en Supabase** (por defecto 5 envíos por IP y hora y 200 al día en total), con
   un bloqueo en la base de datos para que dos envíos simultáneos no se cuelen. La IP se toma de
   `x-vercel-forwarded-for`, que pone Vercel y el cliente no puede falsear; fuera de Vercel, de la conexión.
   Solo se guarda un HMAC de la IP, que se borra a los 2 días.
9. Guarda en `diagnosticos`, avisa a n8n (8 s de tiempo máximo) y marca el aviso como `enviada` o `fallida`.

**Contra el spam hay:** la casilla trampa, la comprobación de origen, la validación estricta y los límites
por IP y diarios. **No hay CAPTCHA.** Si llega spam real, el siguiente paso sería añadir uno
(por ejemplo Cloudflare Turnstile), y eso necesita una cuenta y una clave.

Los registros (`console.log`) solo llevan eventos, ids y códigos de error: ni respuestas, ni emails, ni IP.

## 1. Supabase

1. Abre tu proyecto → **SQL Editor** → **New query**.
2. Pega el contenido de `supabase/esquema.sql` y pulsa **Run**. Solo crea lo que no existe (no borra nada).
3. Comprueba en **Table Editor** que existen `diagnosticos` y `envios_limite` con **RLS enabled**
   y **sin políticas**. Así nadie puede leerlas con la clave pública.
4. **Project Settings → API**: copia la **Project URL** y una clave **secreta**
   (`sb_secret_…`, o la antigua `service_role`). **Nunca** la clave pública (`anon`/`publishable`) y
   **nunca** en el HTML.
5. Anota la **región** del proyecto: el aviso de privacidad la necesita.

Para ver los avisos que fallaron: la vista `diagnosticos_por_notificar`, sin las respuestas.
El campo `estado` (`recibido` → `en_revision` → `diagnosticado` → `archivado`) es para tu seguimiento.

## 2. n8n

1. Nuevo flujo → nodo **Webhook**:
   - HTTP Method: `POST`.
   - Authentication: **Header Auth**, con una credencial nueva: Name `Authorization`, Value `Bearer <tu secreto>`.
     El secreto es una cadena aleatoria de al menos 32 caracteres; es el mismo valor que irá en `N8N_WEBHOOK_SECRET`.
   - Respond: **Immediately**. La función solo necesita un 2xx y espera como mucho 8 s.
2. Lo que llega en el cuerpo es: `{ evento: "diagnostico.recibido", id, recibido_en, empresa, respuestas }`.
3. Detrás, el aviso a tu Gmail, por ejemplo un nodo **Gmail → Send** con el asunto
   «Nuevo diagnóstico: {{empresa}}» y el `id`. Si quieres el `.json` adjunto para dejarlo en
   `entrada/<cliente>/` del kit, añade antes un nodo **Convert to File** con `respuestas`.
   **Tu dirección de Gmail se pone solo en n8n**, no en este repositorio.
4. Activa el flujo y copia la **Production URL** del webhook para `N8N_WEBHOOK_URL`.

## 3. Variables de entorno

En Vercel: **Project → Settings → Environment Variables**. Se pueden poner distintas para Preview y Production.
Lista completa en `.env.example`:

| Variable | Obligatoria | Qué es |
|---|---|---|
| `ENVIOS_HABILITADOS` | sí | `true` para recibir envíos. **Déjala vacía en Production hasta que los textos legales estén completos y revisados** (el build también se niega si siguen con `[POR COMPLETAR]`) |
| `AVISO_PRIVACIDAD_VERSION` | sí | Versión del aviso aceptado (se guarda con cada diagnóstico). Igual a la que figure en `privacidad.html` |
| `SUPABASE_URL` | sí | Project URL de Supabase |
| `SUPABASE_SECRET_KEY` | sí | Clave secreta de Supabase (solo servidor) |
| `N8N_WEBHOOK_URL` | sí | Production URL del webhook de n8n (https) |
| `N8N_WEBHOOK_SECRET` | sí | Secreto del webhook, ≥ 32 caracteres |
| `IP_HASH_SECRET` | sí | Secreto para el HMAC de la IP, ≥ 32 caracteres (distinto del anterior) |
| `LIMITE_POR_IP_HORA` | no | Por defecto 5 |
| `LIMITE_GLOBAL_DIA` | no | Por defecto 200 |
| `ORIGENES_PERMITIDOS` | no | Orígenes extra separados por comas; normalmente no hace falta |

Para generar un secreto en tu ordenador:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 4. Vercel

1. Sube esta carpeta a GitHub como **repositorio privado** (GitHub Desktop → *Publish repository* → *Keep this code private*).
   Antes, revisa en GitHub Desktop que **no** aparece ningún `.env.local`.
2. En Vercel: **Add New → Project**, importa el repositorio. No cambies nada: `vercel.json` ya indica
   el build (`npm run build`, que solo hace comprobaciones) y la carpeta publicada (`public`).
3. Añade las variables y despliega. Para probar de verdad, usa primero un despliegue **Preview** con
   `ENVIOS_HABILITADOS=true` y datos inventados. Production, con los envíos desactivados hasta tener los textos legales.

`vercel.json` añade cabeceras de seguridad: CSP (solo recursos propios; la página no carga nada de fuera),
`frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS y `noindex`.
La CSP permite `'unsafe-inline'` porque el cuestionario es un único HTML con su script y sus estilos dentro.

## Actualizar el cuestionario

El HTML no se toca aquí. Para cambiar marca, preguntas o textos:

1. En el kit: `node herramientas/formulario.mjs`. `marca/marca.json` debe tener `"webhook_formulario": "/api/enviar"`.
2. Aquí: `npm run copiar-formulario`, que comprueba que trae el bloque de envío y lo copia a `public/index.html`.
3. `npm test`, commit y push. Vercel publica solo.

## Pruebas

```
npm test                 # validación, errores, envío correcto, n8n caído, límites, secretos, build
npm run test:navegador   # Chrome/Edge sin ventana: el bloque de envío del cuestionario de punta a punta
```

Supabase y n8n están **simulados** en las pruebas: no se conectan servicios reales ni se usan credenciales.
Probar en tu ordenador contra tus servicios reales:
`node --env-file=.env.local scripts/servidor-local.mjs`, que abre http://127.0.0.1:3000.

## Reintentar avisos a n8n (manual)

```
node --env-file=.env.local scripts/reintentar-notificaciones.mjs           # lista
node --env-file=.env.local scripts/reintentar-notificaciones.mjs --enviar  # reenvía
```

## Antes de enviarlo a empresas reales

- [ ] Completar y hacer revisar por un profesional `privacidad.html` y `aviso-legal.html`
      (titular, NIF, dirección, email, base jurídica, plazo de conservación, región de Supabase,
      alojamiento de n8n, transferencias internacionales).
- [ ] Poner la versión del aviso en `privacidad.html` y en `AVISO_PRIVACIDAD_VERSION`.
- [ ] Email de contacto en `marca/marca.json` del kit (sale en el cuestionario) y regenerar.
- [ ] Probar un envío completo en Preview: llega a Supabase, llega el aviso a Gmail, y con n8n
      apagado queda `fallida` y se recupera con el script.
- [ ] Activar `ENVIOS_HABILITADOS=true` en Production.
