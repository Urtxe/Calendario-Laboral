"use strict";

const assert = require("assert");
const { prepararContextoConversacional } = require("./conversation-context");

const identificacion = "Trabajo en limpieza en Barcelona. ¿Qué convenio me corresponde?";

const followUp = prepararContextoConversacional(
    "¿Cuántos días de vacaciones tengo?",
    identificacion,
);
assert.strictEqual(followUp.preguntaAnterior, identificacion);
assert.match(followUp.preguntaParaBusqueda, /Barcelona/);
assert.match(followUp.preguntaParaBusqueda, /limpieza/);
assert.match(followUp.preguntaParaBusqueda, /vacaciones/);

const unrelated = prepararContextoConversacional(
    "¿Qué tiempo hará mañana?",
    identificacion,
);
assert.strictEqual(unrelated.preguntaAnterior, "");
assert.strictEqual(unrelated.preguntaParaBusqueda, "¿Qué tiempo hará mañana?");

const mixed = prepararContextoConversacional(
    "¿Qué tiempo hará mañana y qué convenio aplica?",
    identificacion,
);
assert.strictEqual(mixed.preguntaAnterior, "");

console.log("Contexto conversacional: mantiene territorio y sector en una repregunta laboral.");
