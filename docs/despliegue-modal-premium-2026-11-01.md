# Publicación del modal Premium — 01-11-2026

Proyecto: calendario-laboral-252b1. Autorización explícita del titular para commit, push y despliegue. Código publicado: commit 7a20cad. Rama main sincronizada con origin/main antes de publicar, sin force push.

## Resultado

- Retirado el ejemplo ficticio del histórico anual.
- Modal de bienvenida para visitantes y cuentas gratuitas verificadas, una vez por sesión de pestaña. Excluye Premium y espera a cerrar consentimiento u otros diálogos.
- Destaca cinco consultas IA gratuitas al mes y las ventajas Premium. La prueba de siete días depende de la oferta y elegibilidad del proveedor; explica renovación y cancelación, sin una fecha límite inventada.
- Los visitantes pasan por registro antes de ver planes; no se inicia un pago automáticamente.
- Solo se desplegó Firebase Hosting. No se redesplegaron Functions ni reglas; las doce Functions permanecen ACTIVE. No se modificaron Android, precios, IAM ni datos de usuarios.

## Versión y comprobaciones

- Hosting: projects/calendario-laboral-252b1/sites/calendario-laboral-252b1/versions/afa43ee7fa4b6bed.
- Publicación: 2026-10-31T23:15:27.004Z (00:15 del 01-11-2026, Europe/Madrid).
- Caché comprobada en navegador público: balance-laboral-shell-v2.0.22-premium-welcome-20d40a741591, con service worker controlando la página y cabecera no-cache, no-store, must-revalidate.
- Siete archivos publicados comparados con los locales: index, service worker, Firebase config, módulo de promoción, UI, Play Billing y CSS del modal; todos HTTP 200 y contenido coincidente.
- Navegador real sin sesión: rechazo de analítica opcional, modal visible, texto de cinco consultas, CTA de registro y ausencia del ejemplo del histórico. Captura móvil revisada.
- npm test y git diff --check satisfactorios antes del commit. Pruebas locales con mocks de visitantes, gratuitos, Premium, consentimiento, registro, frecuencia, catálogo Play, móvil y oscuro satisfactorias.
- Revisados los 32 archivos de implementación pendientes y patrones de credenciales. Auditorías, logs y capturas excluidos de Git; docs excluidos de Hosting.

## Límites

No se ejecutaron login autenticado, compras, consultas Gemini, eliminaciones ni pruebas E2E de suscripción en producción. Las condiciones reales de elegibilidad y la contratación en TWA requieren las pruebas de licencia ya documentadas. No se crearon recursos ni costes fijos nuevos; se mantienen el tráfico de Hosting y el coste variable IA existentes.

Las pruebas y la publicación anterior de cuotas, Stripe y RTDN se documentan en [el informe anterior](despliegue-premium-2026-10-31.md).
