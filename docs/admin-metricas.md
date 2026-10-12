# Panel público de métricas

La URL del panel es `/admin/metricas`. Es pública y muestra únicamente datos agregados de GA4; el ID de propiedad y las credenciales permanecen en la Function.

## Configuración única antes del despliegue

1. En GA4, abre **Administrar > Configuración de la propiedad** y copia el **ID de propiedad** numérico. No es el ID de medición `G-TMJ9H1T8QG`.
2. Habilita **Google Analytics Data API** en el proyecto `calendario-laboral-252b1`.
3. En **Administrar > Gestión de acceso a la propiedad** de GA4, añade como **Lector** la cuenta de servicio de ejecución de Functions: `130172535764-compute@developer.gserviceaccount.com`.
4. Guarda el ID de propiedad sin comillas en Secret Manager mediante:

   ```powershell
   firebase functions:secrets:set GA4_PROPERTY_ID --project calendario-laboral-252b1
   ```

Después se puede desplegar únicamente lo nuevo con:

```powershell
firebase deploy --only functions:metricasGa4,hosting --project calendario-laboral-252b1
```

## Medición y privacidad

La web no escribe documentos por visita en `visitasAnonimas` ni crea `usuariosRepetidos`. Analytics solo se carga tras aceptar; revocar detiene la colección y volver a aceptar la reanuda. No se envían email, UID, identificador propio de instalación, preguntas IA, respuestas ni datos laborales. El SDK de Google puede usar sus identificadores pseudónimos propios de GA4 después del consentimiento.

En GA4 registra estas tres dimensiones personalizadas con alcance **Evento**:

- `modo_acceso`: `web`, `pwa` o `android_twa`.
- `auth_state`: `anonymous`, `authenticated` o `unknown`.
- `event_revision`: `v2`, etiqueta técnica que permite excluir eventos anteriores a estas correcciones.

En **Administrar > Visualización de datos > Definiciones personalizadas > Crear dimensión personalizada**, crea una dimensión por parámetro y selecciona alcance **Evento**. Confirma también en Firebase Console que Analytics está habilitado para `calendario-laboral-252b1` y que el flujo web enlazado usa `G-TMJ9H1T8QG`, el ID que contiene la configuración del repositorio; el estado real de esas pantallas no se puede inferir del código.

Completa esas tres dimensiones antes de desplegar el código. GA4 puede tardar entre 24 y 48 horas en habilitar su uso en informes después de recibir los parámetros y crear las dimensiones; mientras tanto, las tarjetas de eventos se muestran como no disponibles en lugar de mezclar el histórico anterior.

El marcador TWA identifica el contenedor detectado por la aplicación; no demuestra que la app se instalara desde Google Play. El panel separa plataforma y estado de cuenta sobre el evento consentido `app_open`, y muestra los recuentos de eventos de producto por plataforma si GA4 devuelve las dimensiones. Los eventos de producto y recorrido se filtran por `event_revision=v2`, así los clics duplicados históricos no contaminan los recuentos; hasta que la dimensión esté registrada, el panel indica que esos datos no están disponibles. Usuarios recurrentes usa la dimensión estándar de GA4 `newVsReturning`; si GA4 rechaza esa consulta, el panel muestra “No disponible”. Las tasas entre pasos del recorrido no se calculan porque los recuentos de eventos no prueban que sean las mismas personas.

Los nuevos eventos (`ai_consultation_succeeded` y `premium_activation_confirmed`) solo tendrán datos desde que se publiquen y una persona acepte Analytics. El evento legado `premium_activated` se conserva en el histórico de GA4, pero el panel nuevo no lo suma al evento confirmado. Eventos históricos generados por clics o duplicados no pueden corregirse retroactivamente.

Las páginas estáticas de convenios muestran el mismo consentimiento y cargan Firebase Analytics solo después de aceptar; incluyen un `page_view` estándar y el `app_open` agregado. No se inyecta el SDK en el HTML inicial. No es necesario instalar SDKs ni registrar eventos adicionales en Firebase. No se han comprobado los ajustes actuales desde Firebase Console, GA4 Admin ni Play Console: hay que confirmar manualmente las tres dimensiones anteriores en GA4.

Google documenta Firebase Analytics como servicio sin coste. El panel añade una consulta `runReport` de GA4 por petición no cacheada para obtener usuarios recurrentes; esto consume cuota de Data API y aumenta ligeramente el tiempo de Function. No añade consultas Firestore, almacenamiento ni dependencias. El coste monetario exacto de Functions depende del plan y tráfico del proyecto y no se puede determinar desde el repositorio. Play Console mantiene sus propios datos de instalaciones, usuarios activos, usuarios recurrentes y retención para la app Android; no se mezclan ni se enlazan con estos eventos GA4.

El panel distingue una respuesta vacía real de GA4 de errores de permisos y configuración. Tras desplegar, abre el panel directamente: el bloque **Estado de medición** permite comprobar el último evento y los eventos de las últimas 24 horas. Si no llegan eventos, verifica en DevTools que cargan `firebase-analytics-compat.js` y `src/js/analytics.js`, y que el consentimiento de analítica no los esté bloqueando.
