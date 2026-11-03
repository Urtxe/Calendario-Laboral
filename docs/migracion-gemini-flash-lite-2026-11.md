# Migración Gemini Flash-Lite — noviembre de 2026

## Estado y alcance

El backend usa `gemini-3.5-flash-lite` por defecto, con `thinkingLevel: medium` para respuestas laborales y el mismo modelo para el fallback REST. `GEMINI_CONSULTATION_MODEL` y `GEMINI_THINKING_LEVEL` permiten configurar el modelo y el esfuerzo. Las llamadas de generación tienen timeout de 35 s y un reintento para 429/5xx; un 400 no se reintenta. Los errores finales siguen el flujo existente de abstención y devolución de cuota si no hubo respuesta útil.

El aviso de modelo no requiere cambios en `gemini-embedding-001`, vectores, documentos ni ingestas. Se conserva `generateContent`: está disponible para el modelo, no hay function calling cliente y no se mantiene un historial de objetos `Content` con `thoughtSignature`. La conversación pasa solo la pregunta previa del usuario.

El Agente de Instagram usa también `gemini-3.5-flash-lite`, con `thinking_level=minimal` por defecto, salida JSON estructurada y sin `temperature`, `top_p` ni `thinking_budget`.

## Comprobaciones

- La API autenticada de `calendario-laboral-252b1` lista `gemini-3.5-flash-lite` con `generateContent` disponible.
- Consultas mínimas reales con `thinkingLevel=minimal` y `medium` terminaron en `STOP`; no se enviaron preguntas laborales reales ni datos personales. El coste incremental estimado de estos smoke tests es inferior a USD 0,001; no se consultó factura.
- Las pruebas locales de serialización, timeout/reintento, errores 400/5xx, RAG, cuota, conversación y seguridad están en los tests del repositorio.
- La disponibilidad del modelo no valida por sí sola la calidad de respuestas jurídicas. Antes de publicar, revisar los casos de Limpieza Barcelona, Hostelería Málaga, Transporte Navarra y conversación multi-turno en un entorno controlado.

## Publicación controlada

Después de autorizar la publicación, desplegar únicamente:

```powershell
firebase deploy --only functions:consultarConvenio --project calendario-laboral-252b1
```

No hace falta desplegar Hosting ni modificar reglas, secretos, Firebase Auth o el índice RAG. El agente se actualiza por separado al incorporar `caption.py` en su repositorio; no ejecutar su workflow manual de publicación como prueba.

## Rollback

Si la revisión causa errores, recuperar el último commit conocido como bueno y desplegar de nuevo solo `functions:consultarConvenio`. La reversión debe incluir tanto la generación principal como el fallback REST, ya que ambos comparten el modelo y la configuración `thinkingLevel`. No basta con cambiar el nombre del modelo en una variable: Gemini 2.5 usa `thinkingBudget`, mientras que esta versión envía `thinkingLevel`.
