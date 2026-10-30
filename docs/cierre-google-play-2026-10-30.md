# Cierre de las correcciones Google Play — 30-10-2026

Proyecto: `calendario-laboral-252b1`. Despliegue terminado y validación final realizada sin volver a desplegar Firebase ni modificar Android. Este documento resume resultados verificables; las evidencias locales, tokens, logs y capturas no forman parte del repositorio.

## Estado de producción

Las doce Functions están ACTIVE. Revisión final:

| Function | Revisión o versión |
|---|---|
| deleteAccount | deleteaccount-00006-zeh |
| limpiarDatosAlBorrarUsuario | 29, legacy con reintentos |
| reportAIResponse | reportairesponse-00001-xuj |
| cleanupAIReports | cleanupaireports-00001-fih |
| googlePlayRtdn | googleplayrtdn-00004-viv |
| verifyGooglePlayPurchase | verifygoogleplaypurchase-00004-ses |
| stripeWebhook | stripewebhook-00031-ram |
| consultarConvenio | consultarconvenio-00052-tab |
| metricasGa4 | metricasga4-00020-qom |
| syncOfficialHolidays | syncofficialholidays-00003-dum |
| processConvenioDocument | processconveniodocument-00009-rob |
| reviewConvenioSources | reviewconveniosources-00012-vup |

Hosting mantiene `sites/calendario-laboral-252b1/versions/0a3369fb48865220`. Los archivos principales, privacidad, módulos Play/denuncias y service worker servidos por `https://balancelaboral.es` coinciden con los locales. El navegador aislado activa el SW y la caché `balance-laboral-shell-v2.0.20-play-compliance-7a70d9399d70`; el SW se sirve con `no-store`.

Las reglas publicadas coinciden con `firestore.rules`: ruleset `d13d0c42-893b-4a82-95f6-00392a8aff48`. Se conservan la barrera `accountDeletions/{uid}`, las comprobaciones transaccionales de escritores y los hashes de compras eliminadas. No retirar estas protecciones en una reversión parcial.

No aparecieron nuevas entradas de severidad ERROR en Cloud Functions/Cloud Run durante la consulta de cierre iniciada a las 20:44:05 UTC. Es una observación temporal, no una garantía futura.

## RTDN

Tema único: `projects/calendario-laboral-252b1/topics/balance-laboral-rtdn`. Suscripción `balance-laboral-rtdn-push` ACTIVE, con envoltorio Pub/Sub estándar, backoff 10–600 segundos y retención de siete días.

Endpoint y audiencia OIDC: `https://us-central1-calendario-laboral-252b1.cloudfunctions.net/googlePlayRtdn`. La cuenta dedicada `google-play-rtdn-push@calendario-laboral-252b1.iam.gserviceaccount.com` es el único invocador directo del servicio. Google Play dispone de Publisher sobre el tema y el agente Pub/Sub puede emitir tokens para la cuenta push. No hay acceso público directo al receptor; se mantienen los permisos administrativos heredados del proyecto.

Los dos envíos del botón oficial confirmados por el titular se correlacionaron con entregas `ack_204` y peticiones HTTP 204 a las **21:24:26 y 21:26:31 de Madrid**. Se distinguen de los sintéticos anteriores de las 21:17:59 y 21:19:27. No se guardó el cuerpo en logs: no se afirma haber inspeccionado retrospectivamente el campo `testNotification`. Para ese formato oficial, el handler termina antes de acceder a Firestore o Play; el check local de ausencia de accesos pasó.

## App Check y login

El 403 histórico ocurrió en el intercambio `exchangeRecaptchaV3Token` de un navegador automatizado y produjo throttling de esa sesión. Otras dos sesiones aisladas devolvieron HTTP 200, incluida la validación de cierre, sin exponer sus tokens.

No se puede demostrar retrospectivamente la causa exacta del primer rechazo: no quedó registrado su cuerpo ni la valoración reCAPTCHA. Es compatible con un rechazo de atestación de la sesión automatizada, pero **no debe atribuirse a credenciales Firebase inválidas ni a la ausencia de login**. App Check autentica la aplicación/dispositivo y Firebase Auth al usuario; son controles complementarios. [Documentación de App Check](https://firebase.google.com/docs/app-check), [reCAPTCHA v3 y entornos automatizados](https://firebase.google.com/docs/app-check/web/recaptcha-provider).

En la configuración consultada, Auth, Firestore y Storage tienen App Check `UNENFORCED`. Las Functions de verificación Play, denuncias y consulta mantienen el valor predeterminado false de `APP_CHECK_ENFORCEMENT`; no se cambió. El helper del cliente captura errores de atestación y devuelve null, conservando el ID token Firebase en las peticiones. La nueva prueba ejecuta el helper real con rechazo simulado y comprueba que el aviso autenticado sigue enviándose sin el header App Check.

No se encontró un bloqueo persistente causado por App Check con la configuración actual. Esto no certifica todos los navegadores ni una sesión autenticada de producción. No activar enforcement como parte de este cierre sin una validación específica de tráfico legítimo.

## Denuncias y acceso

Se verificó en Firestore Emulator que el handler almacena exactamente una denuncia ante envíos concurrentes duplicados, con `response`, `reason`, `createdAt` y `expiresAt`, sin pregunta, correo ni UID explícito. El backend puede leer el documento almacenado; el denunciante, otro usuario y un cliente anónimo reciben 403. Tampoco pueden listar ni sobrescribir las denuncias. El endpoint exige Firebase Auth con comprobación de revocación, valida tamaño/motivo y aplica límites transaccionales.

En producción las reglas no conceden acceso cliente a `aiReports` ni `aiReportRateLimits`, y no existe un endpoint público de lectura o panel de moderación. El acceso operativo se realiza mediante IAM en Firebase/Cloud: en la política revisada el único principal humano es el titular con Owner; no hay miembros públicos ni grupos. También pueden acceder las cuentas de servicio con permisos Firestore y los administradores IAM autorizados. Admin SDK no queda restringido por Security Rules ni estos roles limitan el acceso por colección; no se afirma aislamiento de colección frente a otras cuentas técnicas autorizadas del proyecto.

El escritor usa `ai-reports-writer`, y la limpieza `ai-reports-cleanup`, con los roles específicos documentados en la guía Billing. La limpieza privada tiene OIDC y cron `30 4 * * *`, zona Europe/Madrid, máximo 5.000 borrados caducados por ejecución. Su primera ejecución está prevista para el **31-10-2026 a las 04:30 de Madrid**. No se ejecutó manualmente ni se borraron datos reales.

## Pruebas y límites

- `npm test`: satisfactorio; regresiones, Premium, separación Stripe/Play, borrado, concurrencia, denuncias y caché.
- Firestore Emulator (`demo-balance-play`): reglas, barreras ante tokens antiguos, idempotencia y privacidad de denuncias almacenadas; satisfactorio.
- Auth + Firestore Emulator: registro y login email/password con cuenta desechable local, verificación de ID token, escritura/lectura de calendario anual y lectura de un estado Premium simulado; modificación cliente de billing rechazada. No se conecta al proyecto de producción.
- Producción: archivos publicados, headers, nueva caché/SW, configuración Auth/App Check, IAM RTDN y respuestas negativas sin sesión comprobados. No se consultó Gemini ni se hicieron compras o eliminaciones reales.
- Revisión completa del diff y exclusión de auditorías, credenciales y artefactos temporales. `git diff --check` debe pasar antes del commit.

No se declara E2E de login o fichajes en producción, compra/restauración Stripe/Play, borrado real, actualización de una TWA instalada, ni una ejecución efectiva del job. Las pruebas de calendario y Premium indicadas arriba son de emulador o mocks. No hay una credencial de prueba autenticada de producción disponible para este cierre.

Pendientes manuales: verificar primera ejecución de limpieza; comprobar login/fichajes/sincronización con una cuenta de prueba en dispositivo real y atestación App Check en esa sesión. No es necesario repetir los envíos oficiales RTDN ya correlacionados.

## Costes y cierre Git

Un job Scheduler adicional: 0–0,10 USD/mes según cuota gratuita disponible, más ejecución, Firestore, logs y almacenamiento según uso. RTDN no añade una cuota fija por suscripción estándar. [Precio Scheduler](https://cloud.google.com/scheduler/pricing), [precio Pub/Sub](https://cloud.google.com/pubsub/pricing).

El commit reúne únicamente las correcciones Play, borrado, denuncias y su soporte de privacidad, Hosting, caché, pruebas y documentación. No incluye `.env`, claves, auditorías locales, capturas ni `.playwright-cli`. La sincronización debe ser un push normal sin force, tras comprobar `origin/main`, y contrastarse al terminar mediante igualdad de hashes y divergencia 0/0.
