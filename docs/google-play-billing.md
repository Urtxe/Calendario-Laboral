# Google Play Billing para la TWA

## Correcciones de cumplimiento y borrado (30-10-2026)

Los controles de cuenta muestran gestión Google Play solo ante una compra Play conocida; Stripe se conserva en web/PWA y permanece bloqueado en la TWA. Antes de borrar una cuenta con Play se ofrece el enlace oficial y se advierte que borrar no cancela renovaciones ni solicita reembolso. El selector mantiene precios de catálogo y explica período, renovación, cancelación y vencimiento del acceso pagado.

El borrado mantiene `accountDeletions/{uid}` como barrera privada. Tras completar la preparación Stripe, se crea transaccionalmente guardando solo su resultado mínimo; un fallo posterior permite reintentar sin perder esa información. Los escritores Play, Stripe y de reservas IA leen la barrera dentro de sus transacciones. Las reglas bloquean también clientes con tokens antiguos. Las compras vinculadas se sustituyen por `{accountDeleted:true}` en su documento hash, sin UID ni metadatos; así se impide transferir la misma compra a otra cuenta. El marcador y los hashes se conservan como registros pseudónimos de seguridad, sin correo o datos laborales. No existe migración global ni se cancelan compras Play al borrar.

El trigger Auth ejecuta la misma limpieza idempotente y habilita reintentos. No revertir las barreras, las reglas o las protecciones de escritores si ya existen marcadores: una reversión parcial podría reabrir la recreación. Reintentar una limpieza pendiente es preferible a retirar la barrera.

Las denuncias IA se reciben en `/aiReports` mediante `reportAIResponse`: autenticación Firebase con comprobación de revocación, CORS permitido, App Check según la configuración actual, payload acotado y transacción de límites (5/día y 1/minuto). No se envían preguntas ni UID/correo explícitos. La respuesta puede contener información personal: el cliente pide confirmación y limita el texto a 8.000 caracteres. Los clientes no pueden leer ni escribir las colecciones de denuncias directamente. `cleanupAIReports` purga diariamente reportes caducados (90 días) y contadores pseudónimos (2 días), con límite de 5.000 documentos por ejecución y aviso de backlog. No requiere habilitar TTL aparte. Para moderar, el titular o personal autorizado debe revisar `aiReports` desde Firebase/Cloud con IAM restringido; no se ha creado un panel público ni se envían mensajes automáticos. Revisar los avisos y registrar la respuesta operativa, eliminándolos antes cuando ya no sean necesarios.

### Verificación local y despliegue

El despliegue del 30-10-2026 está completado. El estado publicado, las pruebas y sus límites se recogen en [el cierre de la intervención](cierre-google-play-2026-10-30.md).

- `npm test`: regresión existente y tests nuevos de interfaz, borrado, barreras y denuncias; sin servicios de pago.
- `npm run test:firestore-emulator`: requiere Firestore Emulator en `127.0.0.1:8088`, proyecto `demo-balance-play`, con las reglas actuales cargadas. El script rechaza hosts no locales y nunca selecciona el proyecto real.
- `scripts/google-play-visual-checks.js`: servir el repo en `127.0.0.1:8765` y ejecutar con `playwright-cli run-code --filename scripts/google-play-visual-checks.js`. Usa HTML/CSS/JS locales, bloquea red externa y simula catálogo y envío de avisos. Capturas en `output/playwright/` ignoradas por Git. No sustituye la prueba del salto a Play Store en un dispositivo TWA instalado.

Orden recomendado, solo después de autorización:

1. Revisar los diffs y las métricas/configuración reales, confirmar permisos IAM, recursos de la limpieza programada y planificar una ventana controlada. No ejecutar el script global de deploy sin revisar el alcance.
2. Desplegar primero los escritores protegidos `verifyGooglePlayPurchase`, `googlePlayRtdn`, `stripeWebhook`, `consultarConvenio` y las reglas Firestore. Esperar a que no queden solicitudes antiguas en vuelo antes de activar el nuevo borrado. Durante el despliegue escalonado no se puede asumir la garantía completa de barrera hasta actualizar todos los escritores.
3. Desplegar `deleteAccount` y el trigger legacy `limpiarDatosAlBorrarUsuario` con la limpieza idempotente. Desplegar `reportAIResponse` y `cleanupAIReports`; confirmar que el job está activo y el receptor de denuncias es accesible.
4. Desplegar Hosting (UI, política, rewrite y revisión de caché PWA). Comprobar en pista de prueba con cuentas de licencia y sin compras reales que el enlace HTTPS de gestión abre Play Store/navegador y que Stripe permanece bloqueado en TWA.
5. Revisar errores, RTDN y limpieza, y actualizar Data Safety si procede.

Reversión: se puede volver a la versión Hosting anterior si es necesario, aunque reaparecerían sus carencias de interfaz. Conservar backend y reglas que respetan la barrera; no borrar marcadores ni restaurar datos de cuentas eliminadas. Para un fallo backend, detener nuevas operaciones de borrado durante la intervención y corregir o restablecer una versión que mantenga las mismas garantías. No hay deshacer automático de una cancelación Stripe o una eliminación de cuenta.

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
