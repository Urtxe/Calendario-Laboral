# Balance Laboral Android TWA

Proyecto Android generado con Bubblewrap para publicar la PWA de Balance Laboral como Trusted Web Activity.

## Datos base

- Web manifest: `https://balancelaboral.es/manifest.json`
- Package name: `es.balancelaboral.app`
- App name: `Balance Laboral`
- Launcher name: `Balance`
- Host: `balancelaboral.es`

## Firma

La keystore de release no debe guardarse en este repositorio.

Ruta configurada para builds de release:

```text
C:/keys/balance-laboral/balance-laboral-release.jks
```

Alias configurado:

```text
balance-laboral-release
```

Consulta `docs/twa-android.md` para crear la keystore, obtener el SHA-256, publicar `assetlinks.json` y generar APK/AAB.
