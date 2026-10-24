# Runtime de Node.js

El desarrollo local usa Node.js 24.22.1 (`.nvmrc`). Las nueve funciones de segunda generación usan `nodejs24`; Google gestiona el parche y tiene activadas las actualizaciones automáticas.

`limpiarDatosAlBorrarUsuario` usa un trigger de Firebase Authentication de primera generación. Google no admite `nodejs24` para esa generación, por lo que esta función conserva `nodejs22` actualizado por Google. Cambiar su generación requiere otro tipo de trigger y no forma parte de la actualización del runtime.

Desde `functions/`, ejecutar `npm run deploy` para desplegar ambas generaciones con sus runtimes. `npm run deploy:node24` y `npm run deploy:legacy` permiten hacerlo por separado. No ejecutar un despliegue global con la configuración Node 24 para la función de primera generación.
