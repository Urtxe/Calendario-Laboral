# Medición de producto v3 — Balance Laboral

Validación final del 16/10/2026. El propietario confirma las ocho dimensiones de evento y los ajustes de medición mejorada/ocultación del flujo `G-TMJ9H1T8QG`. El panel permanece público por decisión expresa del propietario. No se solicitan scopes OAuth ni se crean dimensiones.

## Configuración confirmada y privacidad

Parámetros de evento exactos confirmados manualmente: `event_revision`, `modo_acceso`, `auth_state`, `origin_page`, `activation_cohort`, `retention_day`, `activity_kind`, `provider`. Las consultas anteriores del panel ya aceptaban los tres primeros. El error administrativo previo `ACCESS_TOKEN_SCOPE_INSUFFICIENT` limita nuestra lectura de configuración; no invalida la confirmación manual. Las dimensiones nuevas pueden tardar en ofrecer informes.

La política de privacidad, los dos avisos de consentimiento y el resumen dentro de la aplicación se amplían exclusivamente para explicar origen SEO, activación, registro, Premium y regresos D1/D7/D30, más los marcadores locales y su eliminación al retirar consentimiento. No se añade otra finalidad ni se transmiten jornadas, horarios, salarios, consultas, correo o UID.

El SDK real se comprobó localmente interceptando la recogida antes de que llegase a GA4: una sola `page_view`, URL sin queries ni fragmentos (incluidos `prefilled_email`, `client_reference_id` y token ficticios), cero recogida antes del consentimiento y tras retirarlo. Los parámetros propios tienen lista cerrada; los referentes sociales conservan solo dominios reconocidos, nunca perfiles, rutas o queries.

## Panel público y límites

`/admin/metricas` y su endpoint son públicos por decisión del propietario y solo consultan GA4 para producir estadísticas agregadas. No leen ni escriben perfiles, jornadas o colecciones de Firestore. El cliente solo puede elegir uno de cuatro periodos (7/30/90 días o mes actual); se rechazan campos de consulta adicionales y cuerpos de más de 2 KiB. No hay acceso a consultas arbitrarias ni secretos.

Las consultas coincidentes comparten una promesa; los resultados se cachean cinco minutos y los errores treinta segundos. La caché no cruza fechas distintas. `metricasGa4` se limita a una instancia y veinte peticiones concurrentes para acotar la ejecución del endpoint público. Es un límite razonable, no una garantía de coste cero frente a cualquier tráfico hostil; no se añade infraestructura de limitación externa.

Los límites de filas están fijados en código; el informe de cohortes no supera 90 días de activación y 10.000 filas. Un informe vacío se presenta como falta de datos; un fallo de dimensión mantiene disponible el resto del panel. Las cifras operativas de Firebase no se mezclan con visitantes consentidos.

## Auditoría y señales

Se conserva Firebase Analytics, el módulo de conversión y la Function `metricasGa4`; no hay una segunda infraestructura, nuevas colecciones ni lecturas de perfiles desde el panel. Las cifras operativas de Auth/Firestore no se suman ni se equiparan a usuarios consentidos de GA4.

| Evento | Emisor y acción demostrada | Tratamiento v3 |
|---|---|---|
| `page_view` | SDK, visita consentida a una página | Se reutiliza. URL sin query/hash, título fijo y referrer reducido. Canales y entradas mediante dimensiones estándar GA4. |
| `app_open` | `analytics.js`, inicialización consentida en la raíz de la aplicación | Una vez por documento; las visitas SEO dejan de contarse como aperturas de la aplicación. No demuestra uso. |
| `convenio_cta_clicked` | `analytics.js`, delegación de clic sobre `a.btn[href="/"]` desde `/convenios/<slug>` | Nuevo. En la misma pestaña, una marca de sesión de un solo uso entrega el evento al llegar a la aplicación para evitar pérdidas al descargar el documento de origen. Caduca a los cinco minutos. No se altera URL ni navegación. En clics con modificadores se emite desde el origen; con almacenamiento bloqueado el envío es de mejor esfuerzo. Incluye botones existentes hacia calendario o asesor, no logo ni enlaces del menú. |
| `calendar_configured` | `ui.js`, `trackCalendarConfigurationAfterSave`, promesa de guardado resuelta con éxito | Se reutiliza como uso real: configuración persistida. No implica primera jornada ni usuario único. |
| `shift_added` | `calendar.js`, `procesarClickDia`, resultado exitoso de `guardarTodoEnFirebase` | Corregido: solo nuevo día de tipo `trabajado`, nunca vacaciones/bajas, edición, eliminación, formulario o guardado fallido. Es un evento por nueva incorporación al calendario actual, no una prueba de jornada histórica nunca registrada. |
| `first_shift_saved` | `conversion-funnel.js`, después del guardado anterior, con cero días trabajados conocidos antes de actuar | Nuevo. Una activación por estado consentido conservado. Un calendario que ya contiene jornadas no inventa una activación pasada. |
| `repeat_shift_saved` | Mismo guardado, ya había al menos una jornada conocida | Nuevo, una vez por estado consentido conservado. Demuestra varias jornadas conocidas, no necesariamente días distintos de uso de la aplicación. |
| `balance_viewed` | Módulo de UI, consulta del balance | Se reutiliza; no define activación ni cohorte. |
| `signup_started` | Apertura del registro | Se reutiliza; no representa alta. |
| `signup_completed` | `firebase-config.js`, creación Auth y perfil resueltas; Google requiere `additionalUserInfo.isNewUser` | Se reutiliza en lugar de añadir `registration_completed` o `sign_up`. Crear un perfil que faltaba a una cuenta Google existente es login. Dedupe de confirmaciones en memoria; ninguna clave Auth se envía ni persiste en analítica. |
| `login` | `firebase-config.js`, autenticación email o Google existente completada | Nuevo. Método limitado a `email` o `google`. El modo anónimo actual usa calendario local, no Firebase Anonymous Auth ni vinculación de credenciales. No se añaden flujos de Auth. |
| `registration_prompt_*` | Mostrar, cerrar o aceptar el aviso funcional existente | Se reutilizan; no equivalen a registro. El aviso sigue funcionando sin analítica. |
| `premium_prompt_shown` | `abrirModalPremium`, presentación existente de oferta/modal | Se reutiliza. No demuestra checkout ni pago. |
| `premium_checkout_started` | Stripe: antes de navegar al Payment Link validado; Play: antes de `PaymentRequest.show`, tras comprobar servicio y producto | Se reutiliza, ahora con `provider=stripe/google_play`. Un intento puede cancelarse. El punto común de compra Play cubre ambos accesos sin duplicarlos. |
| `premium_activation_confirmed` | Lectura existente `verificarNivelPremium`, después de checkout en esa sesión, derecho backend `billing.<provider>` activo y con procedencia coincidente | Corregido: `tipoCuenta` solo no basta. Excluye derecho vencido y Premium ya activo al iniciar checkout. Es derecho activo observado tras checkout, no ingreso cobrado, compra nueva demostrada ni atribución causal. |
| `cohort_return` | Apertura de app o nuevo guardado de jornada en D1/D7/D30 | Nuevo, una vez por día relativo y tipo de actividad. |
| `ai_consultation_succeeded`, `pdf_exported` | Éxito existente del asesor/exportación | Se reutilizan sin datos de consultas o documentos. |

No se añade un evento `purchase`: sin una confirmación de cobro correlacionable y consentida no puede afirmarse que se ha pagado. Las activaciones de gracia, prueba, restauración o estado activo no se convierten en ventas. Stripe y Google Play conservan sus flujos y verificaciones existentes.

## Datos, consentimiento y atribución

- Todo evento propio usa `event_revision=v3`, `modo_acceso=web/pwa/android_twa` y `auth_state=anonymous/authenticated`. Los informes de producto v3 excluyen los v2 para evitar mezclar definiciones.
- Lista cerrada de eventos y parámetros: origen de registro, disparador del aviso, proveedor, método de autenticación, ruta SEO, fecha UTC de cohorte, día relativo y tipo de actividad. Valores fuera de las listas se descartan. No se transmiten UID, emails, fechas de jornadas, horarios, importes, salarios ni preguntas/respuestas.
- El SDK solo se carga tras aceptación. La cola transitoria en memoria únicamente admite eventos consentidos y se vacía al retirar consentimiento. No se reproduce actividad anterior a la aceptación.
- `bl_seo_origin_v1` es una ruta pública de convenio en `sessionStorage`, creada al clic consentido y borrada al rechazar. No contiene identificadores ni parámetros de URL. Atribuye acciones posteriores en la misma pestaña/sesión; no se extiende entre dispositivos, pestañas independientes ni sesiones futuras.
- `bl_seo_pending_cta_v3` contiene esa misma ruta y la hora de clic, exclusivamente para entregar una vez el evento en la aplicación. Se consume y elimina al llegar, caduca a los cinco minutos y se borra al rechazar. No reconstruye clics anteriores al consentimiento ni añade identificadores. Si la aplicación no llega a cargar, el clic en la misma pestaña puede no llegar a medirse.
- `bl_activation_cohort_v3` guarda solo fecha de activación y banderas de deduplicación consentidas. No es un identificador de instalación ni se vincula a una cuenta. Se elimina al retirar consentimiento y también al iniciar sin consentimiento.
- El estado funcional previo `bl_conversion_funnel_state_v1` controla cuándo ofrecer registro; sigue funcionando sin GA4. No se utiliza para reconstruir actividad analítica de quien rechaza.
- No se añade SDK nativo Android. La TWA usa el mismo emisor web y el contexto nativo ya existente. El marcador TWA identifica contexto de ejecución, no prueba una instalación ni identidad. No se garantiza deduplicación entre navegadores/dispositivos.
- Los enlaces de pago actuales incluyen datos necesarios para el proveedor; no se cambian. Precisamente por ello es obligatorio comprobar que GA4 no captura automáticamente sus URLs.

Las campañas UTM arbitrarias no se copian a Analytics. El referrer solo conserva buscadores y redes sociales reconocidos y origen propio, sin URL completa; se pierde detalle de campañas y referentes desconocidos a cambio de evitar valores sensibles. Bloqueadores, red, consentimiento tardío y navegación rápida pueden perder eventos. Con almacenamiento bloqueado no se garantiza continuidad entre cargas.

## Panel y cohortes

Se mantiene `/admin/metricas` y su endpoint público agregado. Se añade un bloque con usuarios por acción (`totalUsers`), entradas SEO por canal, acciones con origen CTA conservado, desglose Premium por proveedor y cohortes diarias. Conserva periodo elegido, caché de cinco minutos y disponibilidad por bloque. No hace nuevas lecturas de Firestore.

La cohorte es la fecha UTC de la primera jornada observada con calendario previo sin jornadas. El periodo seleccionado delimita **la fecha de activación**; el seguimiento se consulta desde el inicio del periodo hasta ayer UTC, aunque el periodo de activación sea histórico. Una cohorte sin denominador observado no se muestra. D1, D7 y D30 son días UTC exactos, no retención acumulada ni ventanas de siete días. Cada fila distingue abrir la aplicación y guardar otra jornada. Volver a hacer visible la aplicación también registra regreso, para cubrir PWA/TWA que permanecen abiertas varios días; la deduplicación de cohorte impide repetir el regreso del mismo día/tipo.

Una cohorte inmadura muestra esa condición, nunca cero. Las tasas se ocultan con menos de cinco activaciones, numerador superior al denominador o informe de cohortes sometido a umbrales/pérdidas de GA4. Cinco es un mínimo de presentación, no una garantía estadística. Conteos pequeños no permiten conclusiones comerciales firmes. El registro por cohorte representa registros posteriores observados hasta ayer, con distinta duración de seguimiento entre cohortes; no es una ventana uniforme de conversión.

No se divide el total de CTA por el total de primeras jornadas, ni checkout por derechos activos para inventar un embudo secuencial. Se muestran acciones y usuarios con atribución disponible; una tasa estricta entre las mismas personas y ventanas requeriría una exploración secuencial GA4 o evidencia adicional. Borrar cookies/almacenamiento, rechazar y volver a aceptar o cambiar dispositivo rompe la continuidad.

No se recuperan cohortes históricas a partir de los 20 perfiles, las 11 personas con jornadas, eventos v2 o cifras de Search Console. Las sesiones de GA4 son consentidas; las impresiones/clics de Search Console tienen otra población y definición.

## Control del despliegue

Solo Hosting y `metricasGa4`. La carpeta Hosting aislada parte de los archivos activos de producción y sustituye únicamente los assets de Analytics v3, privacidad y panel. Se excluye `.playwright-cli/`, incluidos artefactos antiguos presentes en Hosting. Las páginas de convenios permanecen idénticas.

La fuente de `metricasGa4` se reconstruye desde su archivo de producción, con solo dos diferencias: `metrics-ga4.js` y la configuración de recursos de esa exportación en `index.js`. Así no se suben cambios históricos del repositorio en RAG, catálogos, pagos u otras Functions. Se omite el hook de inventario documental en la configuración aislada. Se conservan la revisión anterior y la versión Hosting para poder revertir.

Pruebas antes de publicar: `npm test`, sintaxis de los JS modificados, diferencias sin errores, consentimiento, guardados y Auth simulados, cohortes, panel responsive y comprobación con SDK real interceptado. Después de publicar: estado/revisión de Function, respuesta anónima del panel, rechazo de consultas arbitrarias, hashes Hosting, comparación de otras Functions y observación de peticiones GA4 consentidas. El procesamiento posterior de informes se verifica por separado y no se presume por un HTTP 204 de recogida. Commit y push solo tras estas verificaciones.

Referencias: [parámetros de configuración del SDK](https://firebase.google.com/docs/reference/js/analytics.gtagconfigparams), [dimensiones y métricas de GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema).

Los nombres propios de eventos y parámetros usan caracteres admitidos, comienzan por letra y tienen menos de 40 caracteres; el payload propio admite como máximo 11 parámetros, por debajo del máximo de 25. Los valores personalizados se limitan a 100 caracteres (origen SEO incluido); `page_location` se limita a 1.000. Se reutilizan ocho dimensiones de evento, sin propiedades de usuario propias. La fecha diaria de activación añade cardinalidad; se evita cualquier identificador individual. Las nuevas definiciones pueden necesitar 24–48 horas para aparecer en informes y no reconstruyen el histórico. Referencias oficiales: [límites de recogida](https://support.google.com/analytics/answer/9267744?hl=es), [definiciones personalizadas](https://support.google.com/analytics/answer/14240153?hl=es), [medición mejorada](https://support.google.com/analytics/answer/9216061?hl=es).

## Pruebas y lectura comercial a 30 días

Pruebas ampliadas en los checks existentes: aceptación/rechazo/revocación, lista de parámetros sin información personal, CTA y atribución, guardado correcto/fallido, edición/borrado/vacaciones, primera y varias jornadas, dedupe, Auth nuevo frente a login, proveedor Premium verificado, web/PWA/TWA y construcción de cohortes por periodo/madurez. `npm test`, `node --check` y `git diff --check` forman la validación final. La huella del service worker cambia con los assets críticos.

Prueba de navegador local con Playwright y SDK Analytics simulado: convenio → CTA → app → jornada anónima persistida; se observaron exactamente CTA, apertura, jornada y primera jornada con origen conservado. Panel comprobado a 390 y 1280 px con respuesta simulada, sin desbordamiento horizontal. App Check de localhost produce errores reCAPTCHA esperables: no acredita funcionamiento Auth/Firestore real en producción ni una prueba en dispositivo Android. Los guardados Firestore correctos/fallidos se cubren por contratos y mocks sin escribir datos reales.

Tras **30 días completos desde el futuro despliegue validado**, revisar en este orden:

| Posible problema | Evidencia útil |
|---|---|
| Falta de tráfico | Search Console: impresiones/clics por piloto; GA4: entradas consentidas por página/canal. Con pocas entradas, no atribuir el problema al producto. |
| Poca conversión SEO | Entradas de convenio frente a usuarios que pulsan CTA; revisar cada página y plataforma, manteniendo separadas sesiones, usuarios y clics. |
| Poca activación | Clics con origen conservado y primeras jornadas observadas desde ese origen; configuración guardada ayuda a localizar abandono antes de guardar. No usar una razón de totales como tasa de personas. |
| Poco registro | Registros posteriores por cohorte de activación y su duración de seguimiento; contrastar, por separado, altas operativas legítimas de Auth. |
| Mala retención | D1/D7 maduros, separando aperturas de nuevos guardados. D30 solo estará maduro para las cohortes más antiguas y puede seguir sin muestra suficiente. |
| Poco Premium | Modal → intentos de checkout por proveedor → derecho verificado observado. Confirmar ventas reales en Stripe/Play de forma operativa; estos eventos no demuestran ingreso ni permiten atribuir automáticamente una venta. |

Con el volumen actual puede seguir faltando muestra tras 30 días. El sistema debe mostrar esa incertidumbre, no convertirla en una tasa histórica o causal falsa.

## Resultado de producción, 16/10/2026

- Hosting final: `75bf0c9163ee3dba`, publicado a las `20:58:18 UTC` (22:58:18 en Madrid).
- Function: `metricasGa4`, revisión `metricasga4-00019-vey`, estado `ACTIVE`, máximo una instancia y concurrencia veinte. Las otras nueve Functions conservan su configuración y hash; no se desplegaron reglas, índices ni procesos documentales.
- Inventario Hosting: 102 archivos incluyendo dos recursos automáticos de Firebase; 11 archivos modificados respecto de la versión anterior al trabajo. Se retiraron 166 artefactos antiguos de `.playwright-cli/`, sin otras eliminaciones. Las 28 páginas de convenio y el índice SEO conservaron sus hashes. Los 100 archivos aportados coinciden byte a byte con el paquete aislado.
- Inicio de recogida v3: 16/10/2026; la entrega fiable de CTA quedó en la versión final indicada. La primera comprobación detectó pérdida del evento al navegar y se corrigió con la entrega de sesión descrita arriba, sin retrasar la navegación.
- Navegador real en producción con consentimiento: `page_view` una vez por documento (convenio y app), `convenio_cta_clicked` una vez, `app_open`, `shift_added` dos veces por dos días nuevos, `first_shift_saved` una vez, `repeat_shift_saved` una vez y `signup_started`. Peticiones de recogida observadas con respuesta 204 y parámetros `event_revision=v3`/origen SEO correctos. Esto acredita envío y respuesta, no procesamiento posterior de informes. Las pruebas consentidas pueden aparecer como tráfico de QA.
- No se observó recogida antes de aceptar ni tras retirar consentimiento; los marcadores de origen, entrega y cohorte se eliminan. La URL de prueba contenía valores ficticios en `prefilled_email`, `client_reference_id`, token y fragmento, ausentes de las peticiones GA4.
- Guardados únicamente locales en navegador anónimo de prueba, sin crear cuentas ni registros en cuentas de usuarios. `signup_completed`, login autenticado y activaciones Premium se cubren mediante tests; no se simulan altas ni pagos reales en producción. D1/D7/D30 necesitan madurar y no se declaran verificados con tráfico histórico.
- Panel anónimo operativo, HTTP 200, informes v3 y las ocho dimensiones aceptados por la Data API, incluidos estados vacíos. Visual comprobado a 390 y 1280 px sin desbordamiento. Métodos no permitidos: 405; periodos y campos arbitrarios: 400; caché reutilizada en peticiones consecutivas.
- `npm test`, tests específicos y `node --check` correctos; service worker con huella actualizada; `git diff --check` correcto. Las pruebas del guardado, edición, fallo, Auth y pagos usan mocks y no alteran datos reales.
- Limitación de navegador automatizado: App Check devolvió 403 al intercambiar reCAPTCHA. Su configuración no se modificó y el calendario anónimo y Analytics funcionaron; no se utilizó este resultado para afirmar validación real de operaciones autenticadas, pagos o asesor IA.
