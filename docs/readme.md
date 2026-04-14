Balance Laboral
Esta es una herramienta que he creado pensando exclusivamente en nosotros, los trabajadores. La idea nació de una necesidad muy simple: tener un sitio fiable e independiente donde apuntar nuestras horas, sin depender de lo que la empresa diga o deje de decir.

Es una aplicación web (PWA) que puedes instalar en tu móvil para llevar el control de tu jornada, tus festivos y tus horas extra de forma privada y segura.

Por qué he hecho esta aplicación
Casi todos los sistemas de fichaje que existen están hechos para que el jefe controle al empleado. Yo quería darle la vuelta a eso. Balance Laboral es para que tú tengas tus propias pruebas. Si alguna vez tienes un descuadre en la nómina o una inspección de trabajo, aquí tienes un registro profesional y certificado con sello digital que respalda tu palabra.

Qué archivos componen el proyecto
Para que todo funcione correctamente en el servidor de Firebase, estos son los archivos que deben estar en la carpeta principal:

index.html: Es la aplicación donde entras cada día para marcar tus horas.

mensajeUsuarios.html: Es la página de presentación que explica de qué va el proyecto.

src/js/app/: Módulos de estado, calendario, sincronización, UI y PDF.

src/css/main.css: Entrada principal de estilos que importa base, layout y componentes.

assets/images y assets/icons: Aquí van los logos e iconos públicos de la app.

src/js/firebase-config.js: La llave que conecta la app con la base de datos de Google.

docs/guia.pdf: Guía de usuario descargable desde la página de ayuda.

service-worker.js: Permite que la app funcione rápido y se pueda usar incluso sin internet.

manifest.json: La configuración para que el móvil la reconozca como una app instalable.

firebase.json: Las reglas de configuración para el alojamiento web.

.firebaserc: El identificador de nuestro proyecto en la nube.

Cómo subir cambios a la web
Cada vez que hagas una mejora o quieras actualizar algo, solo tienes que abrir la terminal y escribir:

Plaintext

firebase deploy
Automáticamente, los cambios se subirán a balancelaboral.es. Recuerda que si tocas algo importante en el funcionamiento, es bueno cambiar el número de versión en el archivo service-worker.js para que los móviles de los usuarios se enteren de que hay una actualización disponible.

Seguridad y Privacidad
He configurado las reglas de la base de datos para que cada persona solo pueda ver sus propios datos. Nadie más, ni siquiera yo, puede entrar a ver tus registros. El historial de cada usuario se organiza por años dentro de `usuarios/{uid}/years/{anio}` para evitar que un único documento crezca demasiado.

Contacto y Ayuda
Si algo no funciona como debería o tienes alguna idea para mejorar la herramienta, puedes escribir directamente al correo: soporte@balancelaboral.es
