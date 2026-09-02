# Panel privado de métricas

La URL del panel es `/admin/metricas`. El HTML no contiene métricas ni credenciales: solicita datos a `/admin/metricas/datos`, que exige un token de Firebase Authentication con el custom claim `admin: true` antes de contactar con Google Analytics Data API.

## Configuración única antes del despliegue

1. En GA4, abre **Administrar > Configuración de la propiedad** y copia el **ID de propiedad** numérico. No es el ID de medición `G-TMJ9H1T8QG`.
2. Habilita **Google Analytics Data API** en el proyecto `calendario-laboral-252b1`.
3. En **Administrar > Gestión de acceso a la propiedad** de GA4, añade como **Lector** la cuenta de servicio de ejecución de Functions: `130172535764-compute@developer.gserviceaccount.com`.
4. Guarda el ID de propiedad sin comillas en Secret Manager mediante:

   ```powershell
   firebase functions:secrets:set GA4_PROPERTY_ID --project calendario-laboral-252b1
   ```

5. Asigna el claim solo a la cuenta administradora elegida. Con credenciales ADC de un operador autorizado:

   ```powershell
   gcloud auth application-default login
   node functions/set-admin-claim.js administrador@dominio.es
   ```

   La persona administradora debe cerrar sesión y volver a entrar para obtener un token nuevo.

Después se puede desplegar únicamente lo nuevo con:

```powershell
firebase deploy --only functions:metricasGa4,hosting --project calendario-laboral-252b1
```

## Medición y privacidad

La web ya no escribe documentos por visita en `visitasAnonimas`. Los eventos de uso se envían a GA4 sin email, UID, identificador de instalación ni otros identificadores personales. Para ver el desglose web/PWA/TWA, registra `modo_acceso` como dimensión personalizada de evento en GA4; mientras tanto, el panel lo indica como no disponible, no como cero.

El panel distingue una respuesta vacía real de GA4 de errores de permisos y configuración. Tras desplegar, abre el panel como administrador: el bloque **Estado de medición** permite comprobar el último evento y los eventos de las últimas 24 horas. Si no llegan eventos, verifica en DevTools que cargan `firebase-analytics-compat.js` y `src/js/analytics.js`, y que el consentimiento de analítica no los esté bloqueando.
