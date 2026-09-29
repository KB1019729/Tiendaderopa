# Mercado Pago Checkout Pro — Guía de Registro y Configuración

Esta guía cubre todo lo necesario para integrar **Mercado Pago Checkout Pro** (redirect flow) en tu tienda, reemplazando a PayU.

---

## 1. Crear Cuenta y Aplicación en Mercado Pago Developers

### 1.1 Registro
1. Ir a https://www.mercadopago.com.mx/developers (o el portal de tu país: .com.ar, .com.br, .co, .cl, .pe, .uy, .com.co)
2. **Ingresar** con tu cuenta de Mercado Pago / Mercado Libre
3. Si no tienes cuenta: **Crear cuenta** → Tipo "Vendedor" → Completar datos

### 1.2 Crear Aplicación
1. En el panel lateral: **Tus integraciones** → **Crear aplicación**
2. Nombre: `Mi Tienda VESTA` (o el nombre de tu marca)
3. Descripción: `Integración Checkout Pro para e-commerce de ropa`
4. **Crear** → Se genera automáticamente:
   - **Client ID** (identificador público)
   - **Client Secret** (clave privada, **nunca exponer al frontend**)

---

## 2. Credenciales de Prueba (Sandbox) — Inmediatas

Al crear la app, **se generan automáticamente** credenciales de prueba:

| Variable | Dónde está | Para qué sirve |
|----------|------------|----------------|
| `MERCADOPAGO_PUBLIC_KEY_TEST` | Panel → Tu app → **Credenciales de prueba** → Public Key | Frontend: inicializar SDK, mostrar medios de pago |
| `MERCADOPAGO_ACCESS_TOKEN_TEST` | Panel → Tu app → **Credenciales de prueba** → Access Token | Backend: crear preferencias, consultar pagos, webhooks |

**Copialas a tu `.env.local`:**
```env
MERCADOPAGO_ENV=sandbox
MERCADOPAGO_PUBLIC_KEY_TEST=TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MERCADOPAGO_ACCESS_TOKEN_TEST=TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MERCADOPAGO_CURRENCY=MXN
```

**Listo para probar.** No necesitas activar nada más para sandbox.

---

## 3. Credenciales de Producción — Requiere Activación

### 3.1 Requisitos Previos
- Tener cuenta de **vendedor verificada** en Mercado Pago / Mercado Libre
- Tener **Industria** (rubro) y **Sitio web** (URL real de tu tienda)
- Aceptar **Términos y Condiciones** y **Declaración de Privacidad**

### 3.2 Activación
1. Panel → Tu app → **Credenciales de producción**
2. Completar:
   - **Industria**: selecciona tu rubro (ej. "Ropa y accesorios")
   - **Sitio web**: `https://TU_DOMINIO.com` (debe ser HTTPS real)
3. Aceptar: Términos, Privacidad, reCAPTCHA
4. **Activar credenciales de producción**

### 3.3 Credenciales Generadas
| Variable | Dónde está |
|----------|------------|
| `MERCADOPAGO_PUBLIC_KEY_PROD` | Panel → Tu app → **Credenciales de producción** → Public Key |
| `MERCADOPAGO_ACCESS_TOKEN_PROD` | Panel → Tu app → **Credenciales de producción** → Access Token |

**Copialas a tu `.env.local` y cambia el entorno:**
```env
MERCADOPAGO_ENV=production
MERCADOPAGO_PUBLIC_KEY_PROD=APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MERCADOPAGO_ACCESS_TOKEN_PROD=APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MERCADOPAGO_CURRENCY=MXN
```

---

## 4. Configurar Webhooks (Notificaciones Server-to-Server)

**El webhook es la única fuente de verdad para confirmar pagos.**

### 4.1 Configuración en Panel
1. Panel → Tu app → **Notificaciones** → **Webhooks** → **Configurar**
2. **URL de notificación**: `https://TU_DOMINIO.com/api/mercadopago/webhook`
3. **Eventos a suscribir**: 
   - ✅ `payment` (pagos creados, aprobados, rechazados, pendientes, reembolsados)
   - Opcional: `merchant_order`, `preapproval` (si usas suscripciones)
4. **Guardar** → Se genera **Clave secreta (Secret Key)** para validar `x-signature`

### 4.2 Copiar Clave Secreta
```env
MERCADOPAGO_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4.3 Importante
- La URL **debe ser HTTPS** y accesible desde internet (no `localhost`)
- En local: usa túnel (ngrok, cloudflared, localtunnel) y pon la URL del túnel en el panel
- Mercado Pago reintenta si no recibe HTTP 200/201 en < 22s

---

## 5. URLs de Retorno (Response URLs)

Configura en tu `.env.local` (opcional, se derivan del request si omites):

```env
# Usuario regresa aquí tras pagar (aprobado)
MERCADOPAGO_SUCCESS_URL=https://TU_DOMINIO.com/pago/resultado?status=approved

# Usuario regresa tras rechazo
MERCADOPAGO_FAILURE_URL=https://TU_DOMINIO.com/pago/resultado?status=rejected

# Usuario regresa tras pago pendiente (ej. efectivo, transferencia)
MERCADOPAGO_PENDING_URL=https://TU_DOMINIO.com/pago/resultado?status=pending
```

**En el frontend:** la página `/pago/resultado` lee el estado real desde tu BD (webhook), **no** confía en estos parámetros URL.

---

## 6. Usuarios de Prueba (Test Users) — Para Sandbox

Para probar pagos en sandbox necesitas un **comprador de prueba**:

1. Panel → **Cuentas de prueba** → **Crear cuenta de prueba**
2. Tipo: **Comprador**
3. País: México (o tu país)
4. Se genera: email de prueba, tarjeta de prueba, documento

**Tarjetas de prueba México (sandbox):**

| Resultado | Titular | CVV | Vencimiento | Tarjeta |
|-----------|---------|-----|-------------|---------|
| **Aprobado** | `APRO` | `123` | `12/28` | `5031 7557 3453 0604` (Mastercard) |
| **Aprobado** | `APRO` | `123` | `12/28` | `4509 9535 6623 3704` (Visa) |
| **Rechazado** | `RECHAZADO` | `123` | `12/28` | `5031 7557 3453 0604` |
| **Pendiente** | `PENDING` | `123` | `12/28` | `5031 7557 3453 0604` |

> Usa el email del usuario de prueba como comprador en el checkout.

---

## 7. Flujo de Integración (Resumen Técnico)

### 7.1 Backend (Node.js / Next.js Route Handler)
```javascript
// POST /api/mercadopago/preference
// Body: { items: [{id, title, quantity, unit_price, currency_id}], payer: {email}, back_urls, notification_url }
const preference = await mpClient.preference.create({ body: preferenceData });
return NextResponse.json({ id: preference.id, init_point: preference.init_point });
```

### 7.2 Frontend
```javascript
// Redirigir al usuario al checkout
window.location.href = preference.init_point;
// O usar SDK JS para abrir en modal (opcional)
```

### 7.3 Webhook (Fuente de Verdad)
```javascript
// POST /api/mercadopago/webhook
// Validar x-signature con MERCADOPAGO_WEBHOOK_SECRET
// Buscar pago en MP: GET /v1/payments/{payment_id}
// Actualizar orden en BD según payment.status
```

### 7.4 Mapeo de Estados

| MP `status` | Tu Estado | Acción |
|-------------|-----------|--------|
| `approved` | `paid` | Descuenta stock, fulfillment |
| `rejected` | `rejected` | No toca stock |
| `pending` | `pending` | Espera webhook final |
| `cancelled` | `cancelled` | No toca stock |
| `refunded` | `refunded` | Devuelve stock si aplica |
| `charged_back` | `charged_back` | Contracargo, revisión manual |

---

## 8. Checklist Rápido de Verificación

### Pre-Despliegue
- [ ] Cuenta Mercado Pago creada y verificada
- [ ] App creada en Developers Panel
- [ ] Credenciales de prueba copiadas (TEST)
- [ ] Credenciales de producción activadas y copiadas (PROD)
- [ ] Webhook configurado en panel con URL HTTPS pública
- [ ] `MERCADOPAGO_WEBHOOK_SECRET` copiado
- [ ] URLs de retorno definidas
- [ ] Usuarios de prueba creados para sandbox

### Smoke Test (Producción Controlada)
- [ ] `MERCADOPAGO_ENV=production` en variables de entorno
- [ ] Compra real con tarjeta de prueba (monto bajo, ej. $1 MXN)
- [ ] Verificar redirección a `https://www.mercadopago.com.mx/checkout/v1/...`
- [ ] Pagar con tarjeta `APRO` / CVV `123` / `12/28`
- [ ] Verificar redirección a `SUCCESS_URL`
- [ ] Verificar webhook recibido → orden `paid` en BD
- [ ] Verificar stock descontado 1 sola vez
- [ ] Probar pago rechazado (`RECHAZADO`) → orden `rejected`, stock intacto
- [ ] Probar idempotencia: simular webhook duplicado → sin doble descuento

---

## 9. Diferencias Clave vs PayU

| Aspecto | PayU WebCheckout | Mercado Pago Checkout Pro |
|---------|------------------|---------------------------|
| **Firma** | MD5 (`ApiKey~merchantId~ref~amount~currency`) | HMAC-SHA256 (`x-signature` header) |
| **Token** | No usa (form POST) | `access_token` en header `Authorization: Bearer` |
| **Webhook** | `state_pol` (4/6/7/5) | `payment.status` (approved/rejected/pending) |
| **Sandbox** | Credenciales públicas fijas | Credenciales por app (TEST/PROD) |
| **Retorno** | `referenceCode` en query | `preference_id` + `payment_id` en query |
| **Moneda** | `currency` en form | `currency_id` en preference items |
| **Webhook validation** | MD5 recreado | HMAC-SHA256 con `x-signature` + `x-request-id` |

---

## 10. Recursos Oficiales

- **Checkout Pro Overview**: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/overview
- **Preferencia de Pago (API)**: https://www.mercadopago.com.mx/developers/es/reference/preferences/_checkout_preferences/post
- **Pagos (API)**: https://www.mercadopago.com.mx/developers/es/reference/payments/_payments_id/get
- **Webhooks**: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks
- **Probar Integración**: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/testing
- **SDK Node.js**: https://github.com/mercadopago/sdk-nodejs
- **SDK JavaScript (Frontend)**: https://github.com/mercadopago/sdk-js

---

## 11. Próximos Pasos para ti

1. **Crea la app en Mercado Pago Developers** (sección 1)
2. **Copia credenciales TEST** a `.env.local` y prueba sandbox
3. **Cuando estés listo para producción:**
   - Activa credenciales PROD en panel
   - Configura webhook con URL real
   - Cambia `MERCADOPAGO_ENV=production`
   - Inyecta `MERCADOPAGO_ACCESS_TOKEN_PROD` y `MERCADOPAGO_PUBLIC_KEY_PROD` en tu deployment (secret manager)
4. **Ejecuta smoke test** con tarjeta real ($1 MXN)
5. **Verifica webhook → orden `paid` → stock descontado 1 vez**

---

## Notas de Seguridad

- **NUNCA** expongas `ACCESS_TOKEN` (ni TEST ni PROD) al frontend
- **NUNCA** guardes `Client Secret` ni `ACCESS_TOKEN` en repositorio
- **SIEMPRE** valida `x-signature` en webhook antes de procesar
- **SIEMPRE** consulta el pago en la API de MP (`GET /v1/payments/{id}`) antes de actualizar tu BD
- **SIEMPRE** usa idempotencia: guarda `payment_id` y evita procesar el mismo pago dos veces