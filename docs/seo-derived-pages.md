# Arquitectura para paginas SEO derivadas de convenios

Este documento define la infraestructura para generar paginas tematicas derivadas de cada convenio sin activar todavia su publicacion.

## Objetivo

Crear paginas especificas por tema a partir de cada convenio ya estructurado:

- jornada anual
- vacaciones
- permisos
- horas extra
- nocturnidad
- festivos

La generacion esta desactivada por defecto. La configuracion vive en `seo/data/convenios.derived-topics.json` con `generationEnabled: false`.

## Flujo de datos

1. `scripts/generate-seo-convenios.js` extrae y normaliza cada convenio.
2. El resultado estructurado queda en `seo/data/convenios.generated.json`.
3. `seo/data/convenios.manual.json` completa solo datos verificados manualmente.
4. `seo/data/convenios.derived-topics.json` define los tipos de paginas derivadas.
5. `scripts/plan-derived-seo-pages.js` calcula que paginas se podrian generar sin escribir archivos.

Cuando se active la fase siguiente, el render de paginas derivadas debe consumir exclusivamente `convenios.generated.json` y la configuracion de topics. Asi, una modificacion en un convenio madre actualiza automaticamente todas sus paginas relacionadas al regenerar.

## Modelo de pagina derivada

Cada topic define:

- `slug`: segmento URL, por ejemplo `jornada-anual`.
- `contentField`: campo del convenio que alimenta la pagina.
- `searchIntent`: intencion SEO principal.
- `titlePattern`: title unico por convenio y topic.
- `descriptionPattern`: meta description especifica.
- `uniqueAngle`: enfoque editorial para evitar duplicados.
- `minimumData`: campos necesarios para publicar con seguridad.
- `fallbackPolicy`: `do_not_generate` o `generate_prudent`.

URL prevista:

```text
/convenios/{convenioSlug}/{topicSlug}
```

Salida prevista:

```text
seo/derived/{convenioSlug}/{topicSlug}.html
```

## Reglas anti-duplicado

- No usar una plantilla generica unica para todos los topics.
- Cada tipo de pagina debe tener H1, lead, resumen, FAQ y JSON-LD propios.
- Las paginas de jornada deben centrarse en horas, vigencia y calculo.
- Las paginas de vacaciones deben centrarse en dias, disfrute y fuente.
- Las paginas de permisos deben centrarse en supuestos y cautela legal.
- Las paginas de horas extra deben centrarse en limites, compensacion y jornada.
- Las paginas de nocturnidad deben centrarse en trabajo nocturno y compensacion.
- Las paginas de festivos deben centrarse en festivos trabajados y descansos.
- Si el campo principal no existe y `fallbackPolicy` es `do_not_generate`, no se publica.
- Si se usa `generate_prudent`, el texto debe indicar que el dato concreto debe revisarse en el convenio completo.

## Enlazado interno previsto

Cada pagina derivada debe enlazar a:

- la pagina madre del convenio;
- la app para calcular jornada o consultar IA;
- otros topics del mismo convenio;
- convenios del mismo sector;
- convenios de la misma provincia cuando aporte valor.

La pagina madre del convenio podra enlazar a topics derivados solo cuando existan y esten incluidos en sitemap.

## Sitemap y Firebase

Mientras `generationEnabled` sea `false`:

- no se crean HTML derivados;
- no se anaden URLs al sitemap;
- no se anaden rewrites de Firebase;
- el indice de convenios no enlaza a paginas derivadas.

Cuando se active:

1. generar HTML derivados;
2. anadir URLs derivadas a `sitemap.xml`;
3. anadir rewrites `/convenios/{convenioSlug}/{topicSlug}`;
4. validar title, description, canonical, Open Graph, Twitter Cards, JSON-LD y enlaces internos;
5. ampliar el informe de auditoria con paginas derivadas publicadas y bloqueadas.

## Planner

Para ver el potencial sin publicar:

```bash
node scripts/plan-derived-seo-pages.js
```

El planner solo lee datos y muestra:

- convenios base;
- topics configurados;
- paginas potenciales;
- paginas listas;
- candidatas con fallback prudente;
- bloqueadas por falta de datos.

No escribe archivos.

## Criterio de activacion

Activar la generacion solo cuando:

- existan plantillas especificas por topic;
- el sitemap soporte URLs derivadas;
- los rewrites esten probados;
- el informe diferencie paginas madre y derivadas;
- la validacion SEO detecte duplicados entre paginas derivadas;
- se haya decidido si `generate_prudent` se permite para permisos y horas extra.
