# Verificación manual de clientes OAuth — noviembre de 2026

## Lo que está comprobado

- Firebase web config usa el proyecto `calendario-laboral-252b1` y `authDomain=calendario-laboral-252b1.firebaseapp.com`.
- La web inicia Google Sign-In con Firebase Authentication y `GoogleAuthProvider`; el código no contiene un OAuth Client ID literal.
- El paquete Android TWA es `es.balancelaboral.app`. El inicio de sesión se sirve desde la web dentro de la TWA; el repositorio no contiene configuración nativa de Google Sign-In con un client ID.
- El repositorio no permite identificar clientes OAuth concretos ni su actividad. La lista vacía obtenida con una consulta CLI no confirma que no existan clientes en Cloud Console ni identifica los marcados por el aviso. No se cambió OAuth ni se declara resuelto el aviso.

## Datos que hay que consultar

En Google Cloud Console, seleccionar el proyecto **`calendario-laboral-252b1`** y abrir **Google Auth Platform → Clients** (o **APIs y servicios → Credenciales → ID de cliente OAuth 2.0**, según la interfaz). Por cada cliente registrar:

1. El **ID de cliente OAuth completo** (termina en `apps.googleusercontent.com`) y el nombre visible. No copiar ni confundir la API key de Firebase.
2. Tipo de aplicación: **Web application** o **Android**; fecha de creación; estado de publicación/verificación, si aparece.
3. Si Google muestra actividad: fecha de último uso, estado “inactivo”/“sin uso” y fecha exacta de eliminación indicada por el aviso. Copiar también el ID que nombra el aviso. Si la consola no muestra el último uso, registrar “no expuesto” y usar la lista que Google entregó en la notificación.
4. Para clientes web: lista literal de **Authorized JavaScript origins** y **Authorized redirect URIs**. Comprobar los orígenes de producción `https://balancelaboral.es` y `https://www.balancelaboral.es` solo si la aplicación mantiene ambos. Comprobar también el callback Firebase que aparece en ese cliente y coincide con el `authDomain` configurado (`https://calendario-laboral-252b1.firebaseapp.com/__/auth/handler`). Registrar cada URI tal como está, sin añadirla ni corregirla durante esta auditoría.
5. Para clientes Android: **package name** y huellas SHA-1/SHA-256 configuradas. Compararlas con `es.balancelaboral.app` y con los certificados mostrados en Play Console.

En Firebase Console, seleccionar el mismo proyecto y abrir **Authentication → Sign-in method → Google** y **Authentication → Settings → Authorized domains**. Registrar si Google está habilitado, el correo de soporte y la lista literal de dominios autorizados. Verificar la presencia de `balancelaboral.es`, `calendario-laboral-252b1.firebaseapp.com` y cualquier otro dominio realmente utilizado; no añadir ni borrar dominios en esta revisión.

En Google Play Console, abrir **Balance Laboral → Integridad de la aplicación → Firma de aplicaciones** y registrar los SHA-1/SHA-256 del certificado de firma de la aplicación. Comparar con los fingerprints del cliente Android OAuth. No usar solo la huella de upload key como sustituto del certificado de App Signing.

## Cómo identificar el cliente del aviso

Comparar el ID completo de cada fila con cada client ID enumerado en el correo/notificación de Google. Si la notificación no enumera IDs, pedirlos o abrir su enlace autenticado para consultar el detalle del proyecto. Una coincidencia de nombre, plataforma, antigüedad o SHA no es evidencia suficiente para borrar. Un cliente se puede considerar prescindible solo tras comprobar que el aviso lo identifica, que no lo usa Firebase Sign-In ni otra aplicación y que sus orígenes/redirects/package/fingerprints no corresponden al despliegue. Conservar captura o exportación de los datos y fecha de consulta.

**No eliminar ni recrear clientes durante esta verificación.** Después de completar la tabla, revisar el impacto y pedir autorización antes de cambiar credenciales productivas.
