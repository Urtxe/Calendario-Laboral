# Google Play Billing para la TWA

La app Android `es.balancelaboral.app` vende `premium_monthly` y `premium_yearly` solo mediante Google Play Billing. Stripe sigue siendo el único cobro de la web/PWA normal. La TWA nunca redirige a Stripe: si Digital Goods API o Payment Request no están disponibles, muestra un aviso temporal y no abre ningún flujo alternativo.

## Arquitectura

- `android/twa` declara `androidbrowserhelper:billing:1.2.0`, que incorpora Play Billing Library 8.3.0, activa `features.playBilling` en `twa-manifest.json`, registra el manejador Digital Goods y los componentes de pago de ABH, y usa `minSdkVersion 23`, mínimo exigido por ese módulo.
- `src/js/app/play-billing-service.js` comprueba la TWA, `getDigitalGoodsService('https://play.google.com/billing')` y `PaymentRequest`; obtiene los precios desde `getDetails`, cobra con Payment Request y envía únicamente el `purchaseToken` y el SKU al servidor.
- El selector de planes usa el mismo overlay fijo que el resto de modales de la aplicación. Se crea antes de consultar `getDetails`, con estado de carga visible, para que un fallo o una respuesta lenta de Play nunca parezca un toque sin efecto. Los errores mostrados y el diagnóstico de consola contienen únicamente un código permitido; no incluyen tokens ni respuestas de pago.
- `POST /playBilling/verify` exige Firebase ID token, consulta `purchases.subscriptionsv2.get` en Google Play Developer API, valida que el SKU sea uno de los dos permitidos y reconoce la compra si procede.
- El token nunca se guarda. Se guarda únicamente SHA-256 del token como `purchaseReference`, producto, estado, vencimiento y fuente en `playBillingPurchases/{hash}` y en `usuarios/{uid}.billing.googlePlay`.
- `tipoCuenta` se deriva de `billing.stripe` y `billing.googlePlay`; una baja o expiración de un proveedor no elimina el entitlement activo del otro. No hay custom claims de Premium: Firestore sigue siendo la fuente de la interfaz y el servidor es la fuente de verificación de pagos.
- `POST /playBilling/rtdn` es un push de Pub/Sub protegido con OIDC. Reconsulta Play antes de cambiar Firestore y usa la referencia hash para localizar el UID; una notificación no puede conceder acceso por sus propios datos.

No usar `listPurchaseHistory()`: con Android Browser Helper Billing 1.2.0 / PBL 8 devuelve una lista vacía. La restauración usa `listPurchases()` y vuelve a verificar cada token en el servidor.

## Diagnóstico del selector de compra

Si al tocar **Hazte Premium con Google Play** no aparece el selector, comprueba que el código servido contiene `modal-overlay play-billing-modal`. Una integración anterior creaba el selector con la clase `modal`, que no tiene reglas CSS en esta aplicación: el contenido se insertaba al final del documento, fuera de la vista. No afectaba a Play Billing ni al backend, pero visualmente parecía que el botón no hacía nada.

El service worker incluye `play-billing-service.js` y el contexto TWA entre sus assets críticos; al modificar cualquiera de ellos debe cambiar la revisión de caché. No hace falta actualizar el AAB para esta corrección web.

## Configuración manual antes de desplegar funciones

1. En Google Cloud del proyecto de Firebase, habilita **Google Play Android Developer API**.
2. En Play Console, abre **Configuración > Acceso a la API** y confirma que el proyecto `calendario-laboral-252b1` está enlazado. Después abre **Usuarios y permisos > Invitar a nuevos usuarios** e invita a `google-play-billing-runtime@calendario-laboral-252b1.iam.gserviceaccount.com`. Concede solo **Ver datos financieros, pedidos y respuestas a encuestas de cancelación** y **Gestionar pedidos y suscripciones**. Son los dos permisos exigidos por la API para consultar y reconocer suscripciones; no concedas permisos de publicación ni de pruebas.
3. No descargues una clave JSON: las Functions usan Application Default Credentials de esa cuenta de servicio dedicada. No hay una credencial de Play que guardar en Secret Manager, archivos versionados ni `window.APP_CONFIG`.
4. El tema RTDN es exactamente `projects/calendario-laboral-252b1/topics/balance-laboral-rtdn`. En Play Console configura **Monetización > Configuración de monetización > Notificaciones en tiempo real para desarrolladores** con ese nombre completo.
5. La suscripción `balance-laboral-rtdn-push` entrega al receptor directo `https://us-central1-calendario-laboral-252b1.cloudfunctions.net/googlePlayRtdn`, con autenticación OIDC de `google-play-rtdn-push@calendario-laboral-252b1.iam.gserviceaccount.com` y audiencia exactamente igual a esa URL. No apuntes RTDN al rewrite de Hosting: el receptor directo preserva el token OIDC de Pub/Sub.
6. Configura las variables públicas de Functions `GOOGLE_PLAY_RTDN_AUDIENCE` y `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT` con esos valores. El endpoint valida firma, audiencia, emisor y cuerpo Pub/Sub; cada evento vuelve a consultar la API de Play antes de actualizar Firestore. Un RTDN sin OIDC válido falla cerrado.

Si se introduce cualquier secreto futuro (por ejemplo, una clave de otro proveedor), usar `firebase functions:secrets:set NOMBRE_DEL_SECRETO`; no usar `.env` versionado. La integración actual no necesita secretos de Play.

## Prueba de extremo a extremo

1. Sube el AAB a la prueba interna y espera a que Play lo procese.
2. Crea las suscripciones `premium_monthly` y `premium_yearly`, con un plan base activo para cada una.
3. Añade cuentas de licencia de prueba en Play Console y acepta el enlace de prueba interna desde el mismo usuario de Google Play del dispositivo.
4. Inicia sesión en Balance Laboral con una cuenta Firebase, compra ambos planes por separado y confirma que el precio es el de Play Console, no uno escrito en la web.
5. Comprueba Firestore: `usuarios/{uid}.billing.googlePlay` debe tener estado y referencia hash, sin `purchaseToken`; `tipoCuenta` debe ser `premium` solo si la API de Play concede entitlement.
6. Cancela, deja que venza o fuerza los eventos de prueba de suscripción; confirma que el RTDN actualiza el estado. Durante período de gracia se conserva Premium; pendiente, en espera, pausa, expiración, reembolso o revocación no lo conceden.
7. Reinstala o inicia sesión con el mismo UID Firebase en otro dispositivo y usa **Restaurar compras**. La compra no se puede transferir a otro UID Firebase mediante el cliente.

## Referencias oficiales

- [Digital Goods API y Payment Request en TWA](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing/)
- [Migración ABH a Play Billing Library 8](https://github.com/GoogleChrome/android-browser-helper/blob/main/playbilling/docs/play-billing-library-8-migration.md)
- [Ciclo de compra y RTDN](https://developer.android.com/google/play/billing/lifecycle)
- [Requisitos de versiones de Play Billing](https://developer.android.com/google/play/billing/deprecation-faq)
