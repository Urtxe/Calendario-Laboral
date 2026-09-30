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

La web ya no escribe documentos por visita en `visitasAnonimas` ni crea `usuariosRepetidos`. Los eventos de uso se envían a GA4 sin email, UID, identificador de instalación ni otros identificadores personales, y solo después de que la persona acepte la analítica opcional. Para ver el desglose web/PWA/TWA, registra `modo_acceso` como dimensión personalizada de evento en GA4; mientras tanto, el panel lo indica como no disponible, no como cero.

El panel distingue una respuesta vacía real de GA4 de errores de permisos y configuración. Tras desplegar, abre el panel directamente: el bloque **Estado de medición** permite comprobar el último evento y los eventos de las últimas 24 horas. Si no llegan eventos, verifica en DevTools que cargan `firebase-analytics-compat.js` y `src/js/analytics.js`, y que el consentimiento de analítica no los esté bloqueando.
