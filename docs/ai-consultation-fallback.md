# Jerarquía de respuesta del asistente IA

Para consultas laborales, `consultarConvenio` sigue siempre esta secuencia:

```text
convenio/RAG con evidencia suficiente -> fuentes oficiales web -> IA general
```

La búsqueda web usa exclusivamente la lista de dominios oficiales definida en
`functions/official-web-fallback.js`. Está activada por defecto. Puede apagarse
temporalmente con `ENABLE_WEB_FALLBACK=false`; no se utiliza para preguntas
generales no laborales.

Si el convenio no tiene evidencia suficiente, la búsqueda oficial falla, agota
su timeout o no devuelve fuentes permitidas, el endpoint continúa con
`general_ai` y marca la respuesta como orientación no verificada en convenio.

## Reservas de cuota

La cuota se reserva antes de las llamadas costosas para mantener la garantía de
concurrencia. Cada reserva tiene un id único y caduca a los 5 minutos: el timeout
normal de la Function es 90 segundos, por lo que queda margen para completar la
respuesta y liquidarla. En la siguiente comprobación/reserva del usuario, las
reservas vencidas se expiran y descuentan transaccionalmente; no bloquean ni
consumen cuota y no requieren Scheduler ni intervención manual.

Las transiciones `reserved -> consumed`, `reserved -> refunded` y
`reserved -> expired` son idempotentes: una reserva ya liquidada no modifica de
nuevo el contador.
