# Premium: cinco consultas mensuales y prueba de siete días

Publicado el 31-10-2026 tras autorización del titular. Stripe verificado por API: ambos Payment Links reales activos, prueba de siete días y método de pago obligatorio; productos/precios reconocidos por el backend, 0,99 EUR/mes y 9,99 EUR/año sin cambios. El titular confirmó la configuración Play; no se inspeccionó Play Console ni se hizo una compra E2E. Estado y verificaciones: [resultado del despliegue](despliegue-premium-2026-10-31.md).

## Comportamiento implementado

- Gratis: cinco consultas IA por mes natural de Europe/Madrid, con reinicio automático al inicio de mes y ajuste horario de verano/invierno. La interfaz muestra saldo y fecha de renovación; el backend es la autoridad. Los errores y aclaraciones no descuentan consultas; las reservas abandonadas caducan a los cinco minutos.
- Premium: no tiene cuota diaria ni mensual de consultas. Se permite una consulta en curso por usuario y hay un intervalo mínimo de dos segundos entre inicios; las peticiones rechazadas no consumen cuota. No es un límite oculto de 200/día. El uso de Gemini sigue teniendo coste variable y estos controles no sustituyen la monitorización de facturación.
- Los antiguos contadores diarios no se migran ni borran. El contador mensual empieza de forma diferida al usar el nuevo backend; no se reconstruye consumo anterior al cambio de política. Las barreras de cuentas eliminadas siguen vigentes.
- Ajuste publicado el 01-11-2026: retirado el ejemplo ficticio del histórico. Modal de bienvenida para visitantes y cuentas gratuitas verificadas, una vez por sesión de pestaña; excluye Premium y espera a cerrar consentimiento u otros diálogos. Destaca cinco consultas IA mensuales frente a Premium sin cuota mensual, histórico, PDF y horas extra. El visitante pasa por registro antes de ver planes; no se inicia ningún cobro automáticamente. La prueba de siete días se anuncia condicionada a la oferta del proveedor y la elegibilidad, con renovación y cancelación explicadas. Se conservan los mensajes específicos de histórico, PDF y horas extra.
- Stripe concede acceso por una suscripción verificada `trialing` hasta `trial_end`; no se concede por importe cero ni por un cambio en el navegador. Se conservan `active`, los productos/precios admitidos y los derechos independientes Play/Stripe. La interfaz comprueba expiración al actuar, al volver a primer plano y mediante temporizador.
- Google Play ya representa la prueba como una suscripción activa con vencimiento. Se mantiene `PaymentRequest` con `sku`, sin inventar parámetros de ofertas para la TWA. Solo se muestra «7 días gratis» cuando el catálogo devuelve `freeTrialPeriod` equivalente a P7D/P1W, siempre condicionado a elegibilidad y confirmación de Play.
- La promoción Stripe se habilitó tras verificar ambos enlaces reales. `APP_CONFIG.stripeTrialEnabled` permite desactivar el texto si se retiran las ofertas. La bandera nunca concede derechos ni cambia el cobro.

## Orden de publicación y configuración

1. Revisar y probar el diff; publicar primero las Functions afectadas (`consultarConvenio`, `stripeWebhook`, `verifyGooglePlayPurchase`, `googlePlayRtdn`) y Hosting, conservando las restantes revisiones y la política privada RTDN. La cuenta invocadora dedicada RTDN queda explícita en el código y no depende de las variables disponibles durante el descubrimiento local de Functions.
2. Configurar las ofertas en entornos de prueba de cada proveedor y verificar los flujos correspondientes. Los tests locales no prueban los enlaces ni la elegibilidad real.
3. Activar las ofertas reales solo cuando el código publicado reconozca correctamente inicio, vencimiento y cancelación.
4. Para Stripe, después de comprobar ambos enlaces, cambiar `stripeTrialEnabled` a true en la configuración pública de `index.html` y publicar Hosting con su nueva huella de caché. Esa bandera solo modifica el texto; nunca concede Premium ni cambia el cobro. Si solo se configura un enlace, mantenerla false hasta preparar ambos.

No ejecutar un deploy global ni modificar las suscripciones existentes para concederles una prueba. No se requieren nuevos productos, cambios de precios ni un AAB por estos cambios web/backend. La oferta Play debe comprobarse en la versión TWA instalada.

## Stripe — pasos manuales

Se usan **Payment Links de suscripción**, uno mensual y otro anual. Sus URLs están en `src/js/app/ui.js`, en `window.seleccionarPlan`. Conserva los productos y precios ya permitidos por el backend.

1. Abre Stripe Dashboard y selecciona primero el entorno de prueba. En **Payment Links / Enlaces de pago**, abre el enlace del plan mensual y revisa que usa un precio recurrente del producto Premium correcto.
2. En editar o crear enlace, busca la opción de **prueba gratuita / free trial** de la suscripción, normalmente en opciones avanzadas, y fija **7 días**. Es el período tradicional `subscription_data.trial_period_days=7`, no un cupón del 100 % ni una nueva funcionalidad de catálogo llamada «Trial Offers».
3. Mantén la recogida de método de pago para que la suscripción pueda convertirse al pago al terminar. La página debe mostrar siete días, el importe posterior y la periodicidad. Revisa también el acceso al portal de gestión/cancelación y las notificaciones al cliente.
4. Repite para el enlace anual, conservando el importe anual y dejando claro que, al terminar los siete días, se cobra ese período anual.
5. Si el panel no permite editar la prueba del enlace existente, crea otro enlace con **el mismo precio recurrente**, sin crear un precio diferente. Su URL tendrá que sustituirse en el código antes de publicar la interfaz; conservar la referencia Firebase `client_reference_id` que añade la aplicación. No abrir un enlace aislado y asumir que vinculará un UID automáticamente.
6. Comprueba que el endpoint de webhook Stripe existente recibe `checkout.session.completed`, `customer.subscription.updated` y `customer.subscription.deleted`; se mantiene también la gestión existente de fallos de pago. Las suscripciones de prueba deben tener estado `trialing` y un `trial_end` futuro, y el usuario debe recibir un `billing.stripe.expiresAt` coherente.
7. Verifica en pruebas: inicio sin cargo, acceso Premium, cancelación de renovación durante la prueba, cancelación inmediata, conversión a pago y vencimiento sin derecho vigente. Usa herramientas de prueba de Stripe, no una compra real.
8. Una vez publicado el código y validado lo anterior, replica la configuración en los enlaces reales y comprueba sus condiciones sin confirmar una compra. Entonces puede habilitarse la promoción `stripeTrialEnabled`.

**Elegibilidad:** un Payment Link reutilizable no garantiza una única prueba por UID Firebase ni coordina elegibilidad con Google Play. No se anuncia esa garantía. Para imponer estrictamente «una prueba por cuenta» incluso al reutilizar enlaces haría falta un Checkout autenticado controlado por backend y un registro duradero de elegibilidad; este cambio no introduce ese flujo adicional. No confundir esa restricción con los controles por cuenta de la cuota IA.

Documentación: [Payment Links](https://docs.stripe.com/payment-links), [períodos gratuitos de Checkout](https://docs.stripe.com/payments/checkout/free-trials), [diferencia entre free trials y Trial Offers](https://support.stripe.com/questions/trial-offers-faq). Los Trial Offers nuevos no son compatibles con Payment Links según las [restricciones de Stripe](https://docs.stripe.com/billing/subscriptions/trials).

## Google Play Console — pasos manuales

1. Abre **Balance Laboral → Monetizar con Play / Monetización → Productos → Suscripciones**.
2. Abre el producto existente **`premium_monthly`**. Identifica su plan base de renovación automática mensual; conserva precio, moneda y países que ya utilizas. No crees un SKU nuevo para esta tarea.
3. Añade una oferta al plan base. Pon un ID descriptivo, por ejemplo `prueba-7-dias`. Selecciona **adquisición de nuevos clientes** y, cuando esté disponible, la condición **nunca haber tenido ninguna suscripción en esta aplicación**. Evita una condición limitada al producto si quieres impedir que se encadene la prueba mensual con la anual dentro de Play.
4. Añade una fase de **prueba gratuita de siete días**, seguida del precio normal del plan base. Revisa duración, países y condiciones mostradas antes de activar.
5. Marca esa oferta como **compatible con versiones anteriores / backwards compatible**, mediante la opción correspondiente de plan/oferta. Es necesario para esta integración TWA basada en `sku`: crear una oferta moderna que no sea compatible no garantiza que la app la utilice. Solo hay una oferta/plan compatible por producto; revisa cuál sustituye y conserva el plan base.
6. Repite para **`premium_yearly`**, usando su plan anual existente y una fase gratuita de siete días. Mantén el criterio de nuevos suscriptores de la aplicación.
7. Verifica primero en una pista de prueba, con cuentas de licencia: catálogo con prueba, cuenta elegible y no elegible, condiciones del diálogo de Play, restauración, cancelación, vencimiento y notificaciones RTDN. No hacer compras reales durante la comprobación. El campo `freeTrialPeriod` es información del catálogo, no prueba independiente de elegibilidad individual.
8. Activa las ofertas definitivas cuando el código esté publicado y las pruebas de licencia sean satisfactorias. No es necesario cambiar el tema RTDN ni crear otra suscripción Pub/Sub.

Documentación: [crear ofertas](https://support.google.com/googleplay/android-developer/answer/140504), [compatibilidad de ofertas antiguas](https://support.google.com/googleplay/android-developer/answer/12124625?hl=en-GB), [pagos TWA](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing/).

## Verificación realizada y límites

`npm test` incluye ahora reservas mensuales reales contra un modelo transaccional, acceso por vencimiento, siete escenarios Stripe y las comprobaciones de promoción Premium. Hay casos para sexta consulta, reembolso, concurrencia, cambio de mes, reservas antiguas, 201 consultas Premium, `trial_end` sin período de facturación, conservación del proveedor independiente y barreras de borrado.

La prueba local de navegador en `scripts/premium-trial-visual-checks.js` bloquea red externa y compras. Comprueba ausencia de ejemplos ficticios, móvil y oscuro, ausencia de promoción Stripe sin habilitar, y anuncio Play solo en el producto cuyo catálogo simulado ofrece siete días. `scripts/premium-welcome-visual-checks.js` verifica además visitantes, gratuitos, exclusión de Premium, consentimiento, registro y frecuencia por sesión mediante estados simulados. Estos ajustes del modal se publicaron el 01-11-2026; resultado en [despliegue del modal](despliegue-modal-premium-2026-11-01.md). Las capturas quedan en `output/playwright`, fuera de Git/Hosting.

Las ofertas fueron configuradas por el titular, no mediante esta intervención. Posteriormente se leyeron los Payment Links por API, sin crear suscripciones, pagos ni modificar clientes. Sigue existiendo la limitación previa de eventos Stripe fuera de orden: los controles de vencimiento impiden acceso por una prueba caducada almacenada, pero no equivalen a una reconciliación completa de eventos antiguos del proveedor.
