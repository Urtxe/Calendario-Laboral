# Dashboard de observabilidad de Balance Laboral

Este documento explica como importar el dashboard de Google Cloud Monitoring para el proyecto Firebase `calendario-laboral-252b1`.

El dashboard JSON esta en:

```text
docs/monitoring-dashboard.json
```

No modifica codigo de la aplicacion, Firestore Rules, Firebase Hosting ni Cloud Functions. Es solo una definicion de observabilidad importable en Google Cloud Monitoring.

## Estado General

El dashboard empieza con una seccion de **Estado General** para revisar rapidamente:

- salud de `consultarConvenio`;
- errores y latencia p95 de Cloud Functions Gen2;
- actividad y errores de Firestore;
- estado operativo de Hosting;
- uso de Gemini API;
- estado del webhook de Stripe;
- limitaciones de instrumentacion pendientes.

Tambien incluye una seccion final de **Metricas de negocio** preparada para KPIs futuros. Inicialmente es un bloque informativo sin series temporales porque no existen metricas custom ni log-based metrics especificas de negocio.

## Que incluye

### Cloud Functions Gen2

Usa metricas de Cloud Run porque las Cloud Functions Gen2 se ejecutan sobre Cloud Run.

- Invocaciones por funcion.
- Errores 5xx por funcion.
- Latencia media por funcion.
- Latencia p95 por funcion.

Metricas usadas:

- `run.googleapis.com/request_count`
- `run.googleapis.com/request_latencies`

Verificadas en Cloud Monitoring con recurso:

- `cloud_run_revision`

Labels usados:

- `resource.labels.service_name`
- `metric.labels.response_code_class`

### consultarConvenio

Incluye paneles dedicados filtrando el servicio Gen2 `consultarConvenio`:

- Numero de llamadas.
- Errores 5xx.
- Tiempo medio.
- Tiempo p95.

Filtro base:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="consultarconvenio"
```

Nota: el nombre exportado de Firebase Functions es `consultarConvenio`, pero el servicio real de Cloud Run verificado en el proyecto es `consultarconvenio`.

### Firestore

Incluye actividad principal de documentos:

- Lecturas.
- Escrituras.
- Eliminaciones.

Metricas usadas:

- `firestore.googleapis.com/document/read_count`
- `firestore.googleapis.com/document/write_count`
- `firestore.googleapis.com/document/delete_count`
- `firestore.googleapis.com/api/request_count`

Verificadas en Cloud Monitoring con recursos:

- `firestore_instance`
- `firestore.googleapis.com/Database`

Labels usados:

- `metric.labels.op`
- `metric.labels.response_code`

### Hosting

Incluye metricas nativas de Firebase Hosting:

- Ancho de banda servido.
- Storage publicado.

Metricas usadas:

- `firebasehosting.googleapis.com/network/sent_bytes_count`
- `firebasehosting.googleapis.com/storage/total_bytes`

Verificadas en Cloud Monitoring con recurso:

- `firebase_domain`

Para requests, errores 4xx y errores 5xx, Firebase Hosting necesita estar enlazado con Cloud Logging. Una vez activado, se pueden crear metricas basadas en logs o consultar Log Explorer con:

```text
resource.type="firebase_domain"
```

4xx:

```text
resource.type="firebase_domain"
httpRequest.status>=400
httpRequest.status<500
```

5xx:

```text
resource.type="firebase_domain"
httpRequest.status>=500
```

### Authentication

Incluye metricas oficiales de Identity Toolkit, que es el servicio usado por Firebase Authentication:

- nuevos inicios de sesion diarios con `identitytoolkit.googleapis.com/usage/daily_new_signin_count`;
- llamadas API agregadas con `serviceruntime.googleapis.com/api/request_count`.

Metricas verificadas:

- `identitytoolkit.googleapis.com/usage/daily_new_signin_count`
- `serviceruntime.googleapis.com/api/request_count`

Recursos verificados:

- `identitytoolkit_project`
- `consumed_api`

Labels usados:

- `metric.labels.is_anon`
- `metric.labels.response_code_class`

Firebase Authentication no expone todos los eventos funcionales de login/email/Google como metricas nativas detalladas de producto en Cloud Monitoring. Si se necesitan conversiones, errores por proveedor o altas/bajas de usuarios, conviene crear eventos de Analytics, logs estructurados o exportacion a BigQuery.

### Gemini API

Incluye:

- Requests de generacion por modelo.
- Requests de embeddings.
- Tokens de salida.
- Errores.

Metricas usadas:

- `generativelanguage.googleapis.com/quota/generate_requests_per_model/usage`
- `generativelanguage.googleapis.com/quota/embed_content_free_tier_requests/usage`
- `generativelanguage.googleapis.com/generate_content_usage_output_token_count`
- `serviceruntime.googleapis.com/api/request_count`

Recursos verificados:

- `generativelanguage.googleapis.com/Location`
- `consumed_api`

Labels usados:

- `metric.labels.model`
- `metric.labels.response_code_class`

Nota: si el proyecto pasa a otra tier de Gemini, puede convenir anadir los equivalentes `paid_tier` de embeddings/generate en nuevos paneles. La metrica de errores via Service Runtime sigue cubriendo la API consumida `generativelanguage.googleapis.com`.

### Stripe

Stripe no envia metricas nativas a Google Cloud Monitoring.

El dashboard incluye el estado del webhook `stripeWebhook` visto desde Cloud Functions Gen2. El servicio real de Cloud Run verificado en el proyecto es `stripewebhook`.

- Requests por clase de respuesta.

Para observabilidad real de Stripe dentro de Google Cloud se recomienda una de estas opciones:

- crear log-based metrics sobre los logs estructurados del webhook;
- exportar eventos de Stripe a BigQuery;
- usar alertas directas de Stripe Dashboard;
- enviar metricas custom a Cloud Monitoring desde un proceso separado.

### Metricas de negocio

La seccion esta preparada como bloque informativo. No usa metricas inexistentes para evitar que el dashboard importe paneles rotos.

KPIs recomendados para instrumentar mas adelante:

- consultas IA aceptadas por plan;
- respuestas por fuente: convenio, Estatuto, web oficial, aclaracion, fuera de ambito;
- conversiones premium iniciadas y completadas;
- usuarios activos diarios/semanales;
- agotamiento de cuota gratuita;
- errores funcionales del RAG.

Opciones recomendadas:

- log-based metrics desde logs estructurados existentes;
- metricas custom bajo `custom.googleapis.com/balance_laboral/...`;
- exportacion a BigQuery y Looker Studio para analitica de producto.

## Verificacion de metricas

Se revisaron los descriptores reales de Cloud Monitoring del proyecto `calendario-laboral-252b1`.

Metricas confirmadas:

```text
run.googleapis.com/request_count
run.googleapis.com/request_latencies
firestore.googleapis.com/document/read_count
firestore.googleapis.com/document/write_count
firestore.googleapis.com/document/delete_count
firestore.googleapis.com/api/request_count
firebasehosting.googleapis.com/network/sent_bytes_count
firebasehosting.googleapis.com/storage/total_bytes
identitytoolkit.googleapis.com/usage/daily_new_signin_count
serviceruntime.googleapis.com/api/request_count
generativelanguage.googleapis.com/quota/generate_requests_per_model/usage
generativelanguage.googleapis.com/quota/embed_content_free_tier_requests/usage
generativelanguage.googleapis.com/generate_content_usage_output_token_count
```

Correcciones aplicadas respecto a la primera version:

- `metric.label.*` se sustituyo por `metric.labels.*`.
- Authentication dejo de depender solo de `serviceruntime` y ahora usa tambien `identitytoolkit.googleapis.com/usage/daily_new_signin_count`.
- Gemini usa metricas nativas de `generativelanguage.googleapis.com` para requests/cuota/tokens, y `serviceruntime` solo para errores API agregados.
- Firestore API errors mantiene `firestore.googleapis.com/api/request_count` con recurso verificado `firestore.googleapis.com/Database`.
- Hosting requests/4xx/5xx quedan documentados como dependientes de Cloud Logging/log-based metrics, no como metricas nativas directas del JSON.
- Los filtros dedicados de Cloud Run usan los nombres reales verificados: `consultarconvenio` y `stripewebhook`.

## Como importarlo desde Google Cloud Console

1. Abre Google Cloud Console.
2. Selecciona el proyecto `calendario-laboral-252b1`.
3. Ve a **Monitoring**.
4. Abre **Dashboards**.
5. Pulsa **Create dashboard**.
6. Abre el editor JSON del dashboard.
7. Copia el contenido de `docs/monitoring-dashboard.json`.
8. Pega el JSON.
9. Guarda el dashboard.

## Como importarlo con gcloud

Desde la raiz del repositorio:

```bash
gcloud monitoring dashboards create \
  --project=calendario-laboral-252b1 \
  --config-from-file=docs/monitoring-dashboard.json
```

Este comando crea el dashboard en Cloud Monitoring. No despliega Firebase Hosting, Functions, Rules ni indices.

## Validaciones despues de importar

Revisar estos puntos:

- Los paneles de Cloud Functions muestran series para los servicios reales `consultarconvenio` y `stripewebhook`.
- El panel dedicado de `consultarConvenio` muestra llamadas despues de una consulta real.
- Firestore muestra lecturas/escrituras al usar la app.
- Hosting muestra ancho de banda y storage.
- Gemini API muestra llamadas despues de una consulta IA real.
- Identity Toolkit muestra llamadas despues de login/logout.

Si algun panel aparece vacio, comprobar:

- que el servicio haya recibido trafico dentro del rango temporal seleccionado;
- que la API correspondiente este habilitada;
- que el dashboard se haya importado en el proyecto correcto;
- que Firebase Hosting este enlazado con Cloud Logging para requests y codigos HTTP.

## Integracion de coste

Cloud Monitoring no ofrece un widget universal de coste en este JSON. Para coste se recomienda:

1. Crear presupuestos y alertas en Cloud Billing:

```text
https://console.cloud.google.com/billing/budgets?project=calendario-laboral-252b1
```

2. Revisar informes de coste:

```text
https://console.cloud.google.com/billing/reports?project=calendario-laboral-252b1
```

3. Si hace falta verlo dentro de Monitoring, exportar Cloud Billing a BigQuery y crear metricas custom o un panel en Looker Studio.
