# Balance Laboral - Trusted Web Activity (TWA)

Esta guia prepara la publicacion Android de Balance Laboral con Trusted Web Activity y Bubblewrap, manteniendo una unica base web desplegada en Firebase Hosting.

## Estado de la PWA

La PWA ya tiene los requisitos base para iniciar TWA:

- `manifest.json` con `id`, `start_url`, `scope`, `display`, `theme_color`, `background_color` e iconos `any` y `maskable`.
- `service-worker.js` con cache separada para app shell, assets estaticos y navegacion.
- Firebase Hosting preparado para servir `/.well-known/assetlinks.json` con `Content-Type: application/json`.
- Iconos Android reales en `assets/icons/`.
- `viewport-fit=cover` y ajustes iOS safe-area ya aplicados.

Pendiente antes de generar la app final:

- Instalar/configurar Android SDK en el entorno local.
- Generar keystore de release.
- Obtener SHA-256 del certificado.
- Crear y desplegar `/.well-known/assetlinks.json`.
- Verificar Digital Asset Links.

## Estado del proyecto Android

Proyecto Bubblewrap creado en:

```text
android/twa
```

Manifest web usado:

```text
https://balancelaboral.es/manifest.json
```

Valores fijados en `android/twa/twa-manifest.json`:

```text
Package name: es.balancelaboral.app
Host: balancelaboral.es
App name: Balance Laboral
Launcher name: Balance
Start URL: /
Display mode: standalone
Orientation: portrait
Theme color: #24344D
Background color: #FFFFFF
Version code: 1
Version name: 1.0.0
Signing key path: C:/keys/balance-laboral/balance-laboral-release.jks
Signing key alias: balance-laboral-release
```

La keystore no existe todavia y no se ha generado dentro del repositorio. La ruta anterior es externa al repo y debe crearse manualmente solo en la maquina segura de release.

## Package name

Package recomendado:

```text
es.balancelaboral.app
```

Es valido para Android porque usa formato reverse-DNS, minusculas y segmentos estables. Si el dominio final es `balancelaboral.es`, el prefijo `es.balancelaboral` encaja bien y `.app` identifica el producto Android.

Antes de publicarlo en Google Play hay que confirmar:

- Que se controla el dominio `balancelaboral.es` o el dominio final elegido.
- Que el package name no esta ocupado en Play Console.
- Que se quiere mantener este identificador para siempre; Google Play no permite cambiar el `applicationId` de una app ya publicada.

## Dominio de produccion

Usar el manifest real desplegado en HTTPS:

```text
https://balancelaboral.es/manifest.json
```

No inicializar la app final contra un dominio temporal si luego se va a publicar con dominio propio. En TWA, el origen validado con Digital Asset Links es parte critica de la experiencia.

## Instalar Bubblewrap

Requisitos:

- Node.js 14.15 o superior.
- JDK instalado.
- Android SDK instalado o permitir que Bubblewrap lo configure.

Instalacion recomendada:

```powershell
npm install -g @bubblewrap/cli
bubblewrap doctor
```

Alternativa sin instalacion global:

```powershell
npx @bubblewrap/cli doctor
```

## Inicializar el proyecto Android

El proyecto ya se ha generado en `android/twa`. Para regenerarlo desde cero en otra maquina, partir de la rama correcta y usar:

```powershell
mkdir android
cd android
bubblewrap init --manifest https://balancelaboral.es/manifest.json --directory twa
```

Valores recomendados durante `init`:

```text
Application ID / Package name: es.balancelaboral.app
App name: Balance Laboral
Launcher name: Balance
Host: TU_DOMINIO_FINAL
Start URL: /
Display mode: standalone
Orientation: portrait
Theme color: #24344d
Background color: #ffffff
Signing key alias: balance-laboral-release
```

No generar la keystore dentro de `android/twa`. Si Bubblewrap pregunta si debe crearla, responder `No` y crearla fuera del repositorio siguiendo la seccion siguiente.

## Keystore de release

Guardar el keystore fuera del repositorio o en una carpeta local ignorada por Git.

Ejemplo:

```powershell
mkdir C:\keys\balance-laboral
keytool -genkeypair `
  -v `
  -keystore C:\keys\balance-laboral\balance-laboral-release.jks `
  -alias balance-laboral-release `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

No commitear:

- `.jks`
- `.keystore`
- `.p12`
- contrasenas
- `keystore.properties`
- service accounts de Google Play

## Obtener SHA-256

Con keystore local:

```powershell
keytool -list -v `
  -keystore C:\keys\balance-laboral\balance-laboral-release.jks `
  -alias balance-laboral-release
```

Copiar el valor `SHA256`.

Si Google Play App Signing esta activado, usar tambien el SHA-256 del certificado de firma de Play Console. Ese suele ser el fingerprint que debe estar en `assetlinks.json` para la app instalada desde Google Play.

## assetlinks.json

Ruta publica obligatoria:

```text
https://balancelaboral.es/.well-known/assetlinks.json
```

Contenido:

```json
[
  {
    "relation": [
      "delegate_permission/common.handle_all_urls"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "es.balancelaboral.app",
      "sha256_cert_fingerprints": [
        "SHA256:REEMPLAZAR:POR:FINGERPRINT:REAL"
      ]
    }
  }
]
```

No crear el archivo real hasta tener el SHA-256 definitivo. Un `assetlinks.json` con fingerprint incorrecto provoca que la TWA no quede validada.

Bubblewrap tambien puede generar el archivo desde su configuracion:

```powershell
cd android\twa
bubblewrap fingerprint add "SHA256:REAL:..." --name "release"
bubblewrap fingerprint generateAssetLinks --output assetlinks.json
Move-Item -LiteralPath assetlinks.json -Destination ..\..\.well-known\assetlinks.json
```

Si el comando de salida no encaja bien en Windows, generar a un archivo temporal y moverlo manualmente a `.well-known/assetlinks.json`.

## Verificar Digital Asset Links

Comprobar que Firebase Hosting sirve JSON:

```powershell
Invoke-WebRequest https://TU_DOMINIO_FINAL/.well-known/assetlinks.json
```

Verificar con la API de Digital Asset Links:

```text
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://balancelaboral.es&relation=delegate_permission/common.handle_all_urls
```

Tambien se puede usar:

```text
https://developers.google.com/digital-asset-links/tools/generator
```

## Build APK y AAB

Desde el proyecto Bubblewrap:

```powershell
cd android\twa
bubblewrap build
```

No ejecutar `bubblewrap build` definitivo hasta tener:

- Android SDK configurado.
- Keystore de release creada fuera del repositorio.
- Passwords disponibles solo en entorno seguro o introducidas manualmente.
- SHA-256 preparado para `assetlinks.json`.

Salidas esperadas:

```text
app-release-signed.apk
app-release-bundle.aab
```

Instalar APK en Android real:

```powershell
adb devices
bubblewrap install
```

O directamente:

```powershell
adb install -r app-release-signed.apk
```

El archivo para Google Play es:

```text
app-release-bundle.aab
```

## Actualizar despues de cambios en manifest

Cuando cambie `manifest.json` o `twa-manifest.json`:

```powershell
cd android\twa
bubblewrap update
bubblewrap build
```

## Pruebas obligatorias en Android real

- Instalacion desde APK.
- Apertura en modo pantalla completa TWA sin barra del navegador.
- Login email/password.
- Login con Google.
- Lectura/escritura Firestore.
- Asesor IA contra `/consultarConvenio`.
- Flujo Stripe y vuelta a la app/web.
- Exportacion PDF.
- Offline basico del app shell.
- Teclado en modales y chat.
- Enlaces externos y `mailto:`.

## Riesgos pendientes

- Google Sign-In: revisar dominios autorizados en Firebase Auth y comportamiento dentro de TWA.
- Stripe: revisar politica de pagos de Google Play para suscripciones o contenido digital.
- PDF: validar descarga/guardado desde TWA en Android real.
- Offline: la app shell carga, pero datos vivos dependen de Firebase y red.
- Play Store Data Safety: documentar Auth, Firestore, Analytics, pagos y datos laborales.
- Navegacion externa: Stripe, billing portal, mailto y ayuda deben probarse desde TWA.

## Checklist Google Play

- Package name definitivo confirmado.
- Dominio final HTTPS confirmado.
- `assetlinks.json` publicado y verificado.
- Keystore guardado fuera de Git y con backup seguro.
- SHA-256 correcto en Digital Asset Links.
- AAB generado con versionCode/versionName correctos.
- Icono, nombre, capturas y descripcion Play preparados.
- Politica de privacidad publica.
- Data Safety completado.
- Pruebas en track interno antes de produccion.
