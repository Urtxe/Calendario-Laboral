# App Check en modo monitor para Balance Laboral

App Check queda preparado en modo soft para proteger progresivamente `/consultarConvenio` sin bloquear usuarios todavia.

## Estado actual

- Frontend carga Firebase App Check compat SDK.
- Frontend inicializa App Check solo si existe `window.APP_CONFIG.appCheckSiteKey`.
- Frontend intenta obtener token y, si existe, lo envia como:

```text
X-Firebase-AppCheck: <token>
```

- Backend verifica el token con:

```js
admin.appCheck().verifyToken(token)
```

- Backend registra:

```text
appCheckStatus: missing | invalid | valid
appCheckEnforcement: false | true
```

- Con `APP_CHECK_ENFORCEMENT=false`, una peticion sin token o con token invalido no se bloquea.
- Si en el futuro `APP_CHECK_ENFORCEMENT=true`, `/consultarConvenio` devolvera `403` antes de cuota/IA cuando App Check falte o sea invalido.

## Archivos tocados

- `index.html`
- `src/js/firebase-config.js`
- `src/js/app/ui.js`
- `functions/index.js`
- `functions/.env.example`
- `service-worker.js`

## Configuracion manual en Firebase Console

1. Abrir Firebase Console.
2. Seleccionar el proyecto `calendario-laboral-252b1`.
3. Ir a **App Check**.
4. Registrar la app web de Balance Laboral.
5. Elegir proveedor web.

Proveedor recomendado inicial:

```text
reCAPTCHA v3
```

Motivo:

- es compatible con web/PWA/TWA;
- no exige cambios nativos Android en la TWA;
- funciona en Firebase Hosting;
- permite activar primero monitorizacion sin enforcement.

reCAPTCHA Enterprise tambien es valido, pero conviene introducirlo mas adelante si se necesita gestion avanzada de riesgo o integracion empresarial.

## Configurar la site key

La site key de reCAPTCHA es publica, pero se deja como configuracion para no acoplarla a la logica.

En `index.html` existe:

```js
window.APP_CONFIG.appCheckSiteKey =
  window.APP_CONFIG.appCheckSiteKey || "";
```

Para activar App Check en produccion, establecer ahi la site key publica generada en Firebase Console o inyectarla antes de cargar `src/js/firebase-config.js`.

No usar claves secretas en el frontend.

## Localhost y debug token

En desarrollo local, App Check queda apagado por defecto si `appCheckSiteKey` esta vacia.

Para probar App Check en localhost:

1. Configurar `window.APP_CONFIG.appCheckSiteKey`.
2. Activar debug token antes de inicializar Firebase:

```js
window.APP_CONFIG.appCheckDebugToken = true;
```

3. Abrir la app en localhost.
4. Copiar el debug token que Firebase muestra en consola del navegador.
5. Registrar ese debug token en Firebase Console > App Check > Debug tokens.
6. Recargar la app.

Tambien se puede fijar un token concreto:

```js
window.APP_CONFIG.appCheckDebugToken = "DEBUG_TOKEN_REGISTRADO";
```

No versionar debug tokens reales.

## Validar en produccion

1. Configurar la app web en Firebase App Check.
2. Configurar la site key publica.
3. Desplegar Hosting y Functions cuando se autorice.
4. Abrir `https://balancelaboral.es`.
5. Iniciar sesion.
6. Hacer una consulta IA.
7. Revisar Network:

```text
Authorization: Bearer <Firebase ID token>
X-Firebase-AppCheck: <App Check token>
```

8. Revisar logs de Cloud Functions:

```text
event=consultarConvenio_app_check
appCheckStatus=valid
appCheckEnforcement=false
```

Durante la fase monitor, tambien es esperable ver `missing` desde navegadores antiguos, caches viejas, localhost o sesiones antes del despliegue.

## Debug temporal seguro

Para diagnosticar por que no se envia `X-Firebase-AppCheck`, se puede activar un log seguro en el navegador sin imprimir tokens:

```js
localStorage.setItem("appCheckDebug", "true");
location.reload();
```

El navegador mostrara eventos `[AppCheck]` con:

```text
siteKeyPresent
sdkAvailable
initialized
tokenObtained
tokenLength
headerAdded
errorName
errorCode
```

No se imprime el token. Para desactivar:

```js
localStorage.removeItem("appCheckDebug");
location.reload();
```

## Cuando pasar a enforcement real

Pasar a `APP_CHECK_ENFORCEMENT=true` solo cuando:

- la mayoria de trafico legitimo aparece como `valid`;
- PWA instalada funciona;
- TWA Android funciona;
- localhost tiene procedimiento de debug documentado;
- no hay volumen relevante de `invalid` legitimo;
- soporte sabe identificar errores 403 por App Check;
- hay dashboard/alertas suficientes para detectar caidas.

Antes del enforcement:

1. Revisar logs durante varios dias.
2. Confirmar Android TWA desde Play/internal testing.
3. Confirmar PWA instalada en Chrome/Safari/Edge.
4. Confirmar que Service Worker no sirve JS antiguo.
5. Comunicar ventana de cambio.

## Riesgos pendientes

- Si la site key no se configura, el frontend no enviara App Check token. En soft mode no rompe.
- Si se activa enforcement antes de verificar TWA/PWA/localhost, puede bloquear usuarios legitimos.
- reCAPTCHA v3 puede verse afectado por bloqueadores, navegadores endurecidos o entornos corporativos.
- Los debug tokens son sensibles operacionalmente y no deben versionarse.
- App Check reduce abuso desde clientes no registrados, pero no sustituye Auth, cuotas ni rate limiting.
