# Alertas de Cloud Monitoring para Balance Laboral

Este documento describe las politicas de alertas versionadas para el proyecto Firebase/GCP `calendario-laboral-252b1`.

Las politicas estan en:

```text
docs/monitoring-alerts/
```

No se crean alertas reales automaticamente desde este repositorio. Los JSON son importables con `gcloud` cuando se autorice.

## Politicas incluidas

### 1. Errores 5xx en consultarConvenio

Archivo:

```text
docs/monitoring-alerts/consultarconvenio-5xx-errors.json
```

Detecta:

- mas de 3 errores 5xx en 10 minutos.

Metrica:

```text
run.googleapis.com/request_count
```

Filtro principal:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="consultarconvenio"
metric.labels.response_code_class="5xx"
```

Decision: se usa conteo absoluto y no tasa >5%. Con poco trafico, una tasa porcentual es muy ruidosa: 1 fallo de 1 request seria 100%. Mas de 3 fallos en 10 minutos es un umbral prudente para detectar fallo real sin alertar por incidentes aislados.

### 2. Latencia alta en consultarConvenio

Archivo:

```text
docs/monitoring-alerts/consultarconvenio-p95-latency.json
```

Detecta:

- p95 > 10 segundos durante 10 minutos.

Metrica:

```text
run.googleapis.com/request_latencies
```

Filtro principal:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="consultarconvenio"
```

Decision: 10 segundos es prudente porque `consultarConvenio` usa IA/RAG y algunas peticiones pueden tardar. Si el p95 supera 10 segundos de forma sostenida, probablemente hay degradacion de Gemini, Firestore, cold starts, saturacion o fallback lento.

### 3. Errores 5xx en Stripe webhook

Archivo:

```text
docs/monitoring-alerts/stripewebhook-5xx-errors.json
```

Detecta:

- al menos 1 error 5xx en 10 minutos.

Metrica:

```text
run.googleapis.com/request_count
```

Filtro principal:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="stripewebhook"
metric.labels.response_code_class="5xx"
```

Decision: Stripe es critico porque activa y desactiva premium. Un solo error de servidor puede dejar una compra sin reflejarse correctamente o retrasar cambios de suscripcion.

### 4. Errores Firestore

La metrica `firestore.googleapis.com/api/request_count` expone los labels `response_code` y `api_method`, pero no `response_code_class`. Las politicas separan explicitamente disponibilidad, cuota y rechazos esperables, y reducen las series por metodo API.

- `docs/monitoring-alerts/firestore-server-errors.json`: `INTERNAL`, `UNAVAILABLE`, `UNKNOWN`, `DATA_LOSS` y `DEADLINE_EXCEEDED`; 2 o mas en 5 minutos por metodo. Severidad `warning` de disponibilidad.
- `docs/monitoring-alerts/firestore-quota-exhaustion.json`: `RESOURCE_EXHAUSTED`; 3 o mas en 10 minutos por metodo. Severidad `warning`.
- `docs/monitoring-alerts/firestore-permission-denials.json`: `PERMISSION_DENIED`; 10 o mas en 10 minutos por metodo. Senal `warning` informativa, no critica de disponibilidad.
- `docs/monitoring-alerts/firestore-client-request-errors.json`: `UNAUTHENTICATED` e `INVALID_ARGUMENT`; 20 o mas en 10 minutos por metodo. Senal `warning` informativa, no critica de disponibilidad.

La politica generica `firestore-api-non-ok-errors.json` queda retirada. No debe volver a importarse: mezclaba rechazos normales de reglas/sesion con errores reales de plataforma.

### 5. Errores 5xx en Gemini API

Archivo:

```text
docs/monitoring-alerts/gemini-api-5xx-errors.json
```

Detecta:

- mas de 3 errores 5xx en 10 minutos al consumir `generativelanguage.googleapis.com`.

Metrica:

```text
serviceruntime.googleapis.com/api/request_count
```

Filtro principal:

```text
resource.type="consumed_api"
resource.labels.service="generativelanguage.googleapis.com"
metric.labels.response_code_class="5xx"
```

Decision: Service Runtime expone `response_code_class` para APIs consumidas. Es la forma mas fiable de alertar sobre fallos de servidor de Gemini desde Cloud Monitoring sin instrumentacion custom.

### 6. Pico anomalo de llamadas a consultarConvenio

Archivo:

```text
docs/monitoring-alerts/consultarconvenio-request-spike.json
```

Detecta:

- mas de 100 requests en 1 hora.

Metrica:

```text
run.googleapis.com/request_count
```

Filtro principal:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="consultarconvenio"
```

Decision: con pocos usuarios actuales, 100 requests/hora en una funcion IA puede indicar abuso, automatizacion, bucle de frontend, pruebas accidentales contra produccion o consumo inesperado de coste.

## Importar politicas

No ejecutar estos comandos hasta que se quiera crear las alertas reales.

```bash
gcloud alpha monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/consultarconvenio-5xx-errors.json
```

```bash
gcloud alpha monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/consultarconvenio-p95-latency.json
```

```bash
gcloud alpha monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/stripewebhook-5xx-errors.json
```

```bash
gcloud monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/firestore-server-errors.json
```

```bash
gcloud monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/firestore-quota-exhaustion.json
```

```bash
gcloud monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/firestore-permission-denials.json
```

```bash
gcloud monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/firestore-client-request-errors.json
```

```bash
gcloud alpha monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/gemini-api-5xx-errors.json
```

```bash
gcloud alpha monitoring policies create \
  --project=calendario-laboral-252b1 \
  --policy-from-file=docs/monitoring-alerts/consultarconvenio-request-spike.json
```

Importar todas desde PowerShell:

```powershell
Get-ChildItem docs/monitoring-alerts/*.json | ForEach-Object {
  gcloud alpha monitoring policies create `
    --project=calendario-laboral-252b1 `
    --policy-from-file=$_.FullName
}
```

## Listar politicas existentes

```bash
gcloud alpha monitoring policies list \
  --project=calendario-laboral-252b1
```

Con filtro por Balance Laboral:

```bash
gcloud alpha monitoring policies list \
  --project=calendario-laboral-252b1 \
  --filter='displayName:"Balance Laboral"'
```

## Borrar una politica creada por error

Primero listar para obtener el `name`:

```bash
gcloud alpha monitoring policies list \
  --project=calendario-laboral-252b1
```

Despues borrar:

```bash
gcloud alpha monitoring policies delete POLICY_NAME \
  --project=calendario-laboral-252b1
```

`POLICY_NAME` tendra una forma parecida a:

```text
projects/calendario-laboral-252b1/alertPolicies/123456789
```

## Asociar un canal de email

Los JSON no incluyen canales de notificacion para evitar versionar emails personales o IDs de canales.

Despues de importar:

1. Abrir Google Cloud Console.
2. Ir a **Monitoring**.
3. Abrir **Alerting**.
4. Entrar en la politica creada.
5. Editar **Notifications and name**.
6. Asociar un notification channel de email existente o crear uno nuevo.
7. Guardar.

Tambien se puede listar canales con:

```bash
gcloud alpha monitoring channels list \
  --project=calendario-laboral-252b1
```

Si se decide versionar canales mas adelante, hacerlo en un archivo separado y sin direcciones personales.

## Probar de forma segura

Opciones recomendadas:

- Importar primero una sola politica, por ejemplo `consultarconvenio-request-spike.json`, pero dejarla sin canal de email y observar si abre incidentes.
- Crear temporalmente una copia local con umbral bajo y `enabled=false` para revisar que la consola la interpreta bien.
- Usar el dashboard para comprobar que las series existen antes de activar notificaciones.
- No provocar fallos reales en Stripe webhook en produccion.
- No generar trafico masivo contra `consultarConvenio` en produccion salvo que sea una prueba controlada.

## Riesgos de falsos positivos

- `consultarconvenio-5xx-errors`: puede saltar durante despliegues, cold starts problematicos o errores transitorios de dependencias.
- `consultarconvenio-p95-latency`: puede saltar si Gemini esta lento o si hay consultas especialmente largas.
- `stripewebhook-5xx-errors`: intencionadamente sensible; un solo 5xx alerta.
- `firestore-server-errors`: cubre errores reales de plataforma y se mantiene separado por metodo API.
- `firestore-quota-exhaustion`: puede indicar limite de cuota o recurso y requiere revisar el volumen del metodo afectado.
- `firestore-permission-denials`: normalmente refleja reglas, sesion o App Check; es informativa y no una senal de disponibilidad por si sola.
- `firestore-client-request-errors`: normalmente refleja sesiones ausentes o peticiones malformadas del cliente; es informativa.
- `gemini-api-5xx-errors`: puede saltar por incidencias temporales del proveedor.
- `consultarconvenio-request-spike`: puede saltar por pruebas internas, bots, bucles o lanzamiento con trafico real superior al esperado.

## Cuando subir o bajar umbrales

Bajar umbrales si:

- hay pocos usuarios y cualquier degradacion debe verse rapido;
- la funcion IA se considera critica para conversion premium;
- los errores afectan pagos o acceso premium.

Subir umbrales si:

- hay falsos positivos frecuentes;
- aumenta el trafico normal;
- hay pruebas o campanas que generan picos esperados;
- la latencia p95 supera 10 s ocasionalmente pero sin impacto percibido.

Regla practica inicial:

- revisar alertas tras 1 semana de trafico real;
- ajustar tras tener percentiles y volumen normales;
- separar alertas criticas de warning cuando haya canal on-call real.

## Verificacion realizada al generar estos archivos

Se verificaron descriptores reales de Cloud Monitoring para:

```text
run.googleapis.com/request_count
run.googleapis.com/request_latencies
firestore.googleapis.com/api/request_count
serviceruntime.googleapis.com/api/request_count
generativelanguage.googleapis.com/quota/generate_requests_per_model/usage
```

Servicios Cloud Run verificados:

```text
consultarconvenio
stripewebhook
```

Labels confirmados:

```text
run.googleapis.com/request_count:
  response_code, response_code_class, route

run.googleapis.com/request_latencies:
  response_code, response_code_class, route

firestore.googleapis.com/api/request_count:
  api_method, response_code

serviceruntime.googleapis.com/api/request_count:
  protocol, response_code, response_code_class, grpc_status_code
```

