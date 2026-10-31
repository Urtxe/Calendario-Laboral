# Despliegue Premium y prueba de siete días — 31-10-2026

Proyecto exclusivo: `calendario-laboral-252b1`. Despliegue completado con autorización del titular, sin Android, compras reales, consultas Gemini, eliminaciones, commits ni push. Precios conservados.

## Resultado publicado

- Gratis: cinco consultas IA por mes natural de Europe/Madrid. Contadores mensuales nuevos, sin migración destructiva de los diarios. Errores/aclaraciones se devuelven; el backend es la autoridad.
- Premium: sin cuota numérica diaria/mensual. Una petición en curso por usuario e intervalo mínimo de dos segundos entre inicios.
- Pruebas Stripe: acceso por estado verificado `trialing`, hasta `trial_end`, con barreras de borrado y combinación independiente de derechos Stripe/Play.
- Vistas previas ficticias del histórico, CTA contextuales y sugerencias discretas después de uso significativo.
- Promoción de siete días Stripe habilitada tras verificar ambos enlaces reales por API. Método de pago `always`; importes 99 céntimos mensuales y 999 céntimos anuales, EUR; ambos productos reconocidos por las listas permitidas del backend. No se modificó Stripe por API.
- Google Play: configuración declarada por el titular. El mensaje de prueba se condiciona al catálogo y a elegibilidad; no se inspeccionó la oferta real en una TWA instalada.

Hosting: `sites/calendario-laboral-252b1/versions/5a7fc6219f3ec6e3`, publicado a las 22:52:15.595 UTC / 23:52:15.595 Madrid. Service worker activo y caché `balance-laboral-shell-v2.0.21-premium-trial-2ce71b3c7d80` comprobados en navegador público sin sesión. Archivos principales y privacidad coinciden con los locales; SW con `no-store`.

## Functions

Las doce permanecen ACTIVE. Solo cambiaron estas cuatro:

| Function | Revisión final |
|---|---|
| stripeWebhook | stripewebhook-00032-qew |
| verifyGooglePlayPurchase | verifygoogleplaypurchase-00005-pet |
| googlePlayRtdn | googleplayrtdn-00006-def |
| consultarConvenio | consultarconvenio-00053-fim |

Las tres Functions europeas, `metricasGa4`, `deleteAccount`, el trigger Auth versión 29 y las dos Functions de denuncias conservan sus revisiones. No se desplegaron reglas: siguen coincidiendo con `firestore.rules`, ruleset `d13d0c42-893b-4a82-95f6-00392a8aff48`.

## Corrección IAM detectada durante la validación

El primer despliegue de RTDN resolvió su opción de invocador a `private` durante el descubrimiento local, porque la variable de entorno del push no estaba disponible en esa fase. Firebase retiró el binding directo de Invoker: no hubo acceso público, pero la entrega quedaba bloqueada.

Se restableció inmediatamente `roles/run.invoker` para `google-play-rtdn-push@calendario-laboral-252b1.iam.gserviceaccount.com`, exclusivamente en el servicio receptor. Se declaró la cuenta de forma explícita en las opciones de la Function y se redesplegó solo RTDN para impedir que se repita. Política final: únicamente esa cuenta como invocador directo, sin `allUsers` ni `allAuthenticatedUsers`; permisos administrativos heredados sin cambios. No se crearon identidades, temas ni suscripciones adicionales.

Comprobación final real: POST anónimo 403 y mensaje **sintético** publicado en `balance-laboral-rtdn`, entregado por el push con OIDC y HTTP 204. Message ID `22174434128015090`, entrega 22:51:28.574415 UTC, revisión `googleplayrtdn-00006-def`, trace `8b6586fc933801ee530eca712eaffff2`. No es otra prueba oficial de Play Console ni una compra; no contenía token de compra y termina antes de acceder a Firestore.

## Verificaciones

- `npm test`: satisfactorio antes de publicar; incluye seis pruebas transaccionales de cuota mensual, pruebas de trial Stripe, expiración de cliente, proveedor independiente y barreras de cuentas eliminadas. Tras corregir la declaración IAM, las 22 pruebas focalizadas de cuotas, Stripe y lifecycle volvieron a pasar.
- GET/POST negativos de consulta y verificación sin sesión: 401, sin llamada Gemini ni validación de compra real.
- Producción: archivos iguales a local, header SW, cuota gratuita de cinco visible en código cliente, bandera de promoción Stripe true, vista previa móvil y caché activada. No se consumió una cuota de usuario real.
- Cero entradas nuevas de severidad ERROR en Cloud Functions/Cloud Run entre 22:43 y 22:54:09 UTC. Ventana acotada, no garantía futura. No se encontraron logs `trialing` del webhook Stripe desde las 16:20 UTC que indicaran pruebas atendidas por la revisión anterior en ese intervalo; esto no sustituye una reconciliación de clientes.
- El navegador automatizado volvió a recibir un 403 de atestación App Check, comportamiento ya documentado. La carga y los festivos públicos funcionaron. No se cambió ni activó enforcement; no se certificó login autenticado en producción.
- Scheduler de denuncias permanece ENABLED; el intento del 31-10 a las 03:30 UTC consta con estado OK en Scheduler. No se ejecutó manualmente la limpieza ni se inspeccionaron/eliminaron denuncias reales.
- `git diff --check`: satisfactorio. Sin commit/push; los cambios locales de implementación y documentación quedan pendientes de cierre Git.

Evidencias técnicas locales: archivos `premium-*` en la carpeta de auditoría ignorada y captura `output/playwright/premium-live-mobile.png`, excluidos de Git/Hosting. No se almacenaron credenciales ni tokens de Stripe/App Check en esos resultados.

## Límites y pendientes

Comprobar el catálogo y la oferta en la TWA instalada con cuenta de licencia, y la contratación/cancelación/renovación en entornos de prueba. La lectura de configuración y el push sintético no son un E2E de suscripción. Los Payment Links reutilizables siguen sin imponer una única prueba por UID Firebase; se mantiene la elegibilidad condicionada al proveedor, sin prometer esa restricción.

No hay nuevo coste fijo por recursos adicionales: se actualizaron Functions y Hosting existentes. El uso IA sin cuota Premium mantiene coste variable y las protecciones contra abuso documentadas en la [guía de configuración](prueba-premium-7-dias.md).
