const path = require("path");
const assert = require("assert");

const { classifyLaborIntent } = require(path.join(
  __dirname,
  "..",
  "functions",
  "intent-classifier",
));
const { MAX_PREVIOUS_QUESTION_LENGTH, prepararContextoConversacional, validarPreguntaAnterior } = require(path.join(
  __dirname, "..", "functions", "conversation-context",
));
const { construirConsultaRag, MAX_CONSULTA_RAG_LENGTH } = require(path.join(
  __dirname, "..", "functions", "rag-query",
));

const cases = [
  {
    question: "cuándo es la final del Mundial",
    expected: "out_of_scope",
  },
  {
    question: "cuándo es la final del Mundial, quiero pedir vacaciones ese día",
    expected: "mixed_labor",
  },
  {
    question: "qué es un despido objetivo",
    expected: "general_labor",
  },
  {
    question: "cuál es el salario mínimo",
    expected: "current_labor",
  },
  {
    question: "camarero en hotel de Donosti, vacaciones",
    expected: "collective_agreement",
  },
  {
    question: "días festivos de gipuzkoa",
    expectedOneOf: ["needs_clarification", "current_labor"],
  },
  {
    question: "cocinero en Madrid, asuntos propios",
    expected: "collective_agreement",
  },
  {
    question: "mi empresa no me paga las horas extra",
    expected: "collective_agreement",
  },
  {
    question: "Estoy currando de más",
    expected: "collective_agreement",
  },
  {
    question: "¿Puedo compensarlas con días libres?",
    expected: "collective_agreement",
  },
  {
    question: "Me hacen currar de más",
    expected: "collective_agreement",
  },
  {
    question: "¿Tengo 30 días?",
    expected: "out_of_scope",
  },
  {
    question: "¿Son naturales o laborables?",
    expected: "out_of_scope",
  },
  {
    question: "¿Quién ganó el Mundial?",
    expected: "out_of_scope",
  },
  {
    question: "Quiero una receta de pasta",
    expected: "out_of_scope",
  },
];

let failures = 0;

for (const testCase of cases) {
  const result = classifyLaborIntent({ pregunta: testCase.question });
  const expectedValues = testCase.expectedOneOf || [testCase.expected];

  if (!expectedValues.includes(result.intent)) {
    failures += 1;
    console.error(
      `FAIL "${testCase.question}" -> ${result.intent}, expected ${expectedValues.join(" or ")}`,
    );
    continue;
  }

  console.log(`OK  "${testCase.question}" -> ${result.intent}`);
}

if (failures > 0) {
  console.error(`\n${failures} comprobacion(es) de intención fallaron.`);
  process.exit(1);
}

const followUps = [
  ["¿Cuántas horas tengo que hacer?", "¿Y si hago 50 más?", "collective_agreement"],
  ["¿Cuántos días de vacaciones tengo?", "¿Son naturales?", "collective_agreement"],
  ["¿Qué pasa si trabajo un festivo?", "¿Me lo tienen que pagar?", "current_labor"],
  ["¿Cuántas horas extra hago?", "¿Puedo compensarlas con días libres?", "collective_agreement"],
  ["¿Cuántos días de vacaciones tengo?", "¿Cuántos días puedo coger?", "collective_agreement"],
  ["¿Cuántos días de vacaciones tengo?", "¿Tengo 30 días?", "collective_agreement"],
  ["¿Cuántos días de vacaciones tengo?", "¿Son naturales o laborables?", "collective_agreement"],
];
for (const [anterior, actual, intent] of followUps) {
  const contexto = prepararContextoConversacional(actual, anterior);
  assert.strictEqual(contexto.preguntaAnterior, anterior);
  assert.strictEqual(contexto.preguntaParaBusqueda, `${anterior} ${actual}`);
  assert.strictEqual(classifyLaborIntent({ pregunta: contexto.preguntaParaBusqueda }).intent, intent);
}
assert.deepStrictEqual(
  prepararContextoConversacional("¿Cuántas horas tengo que hacer?"),
  { preguntaParaBusqueda: "¿Cuántas horas tengo que hacer?", preguntaAnterior: "" },
);
assert.strictEqual(
  prepararContextoConversacional("¿Cuántos días de vacaciones tengo?", "¿Qué pasa si trabajo un festivo?").preguntaAnterior,
  "",
);
assert.strictEqual(
  prepararContextoConversacional("¿Y quién ganó el Mundial?", "¿Cuántas horas tengo que hacer?").preguntaAnterior,
  "",
);
assert.strictEqual(
  prepararContextoConversacional("¿Y si hago deporte?", "¿Cuántas horas tengo que hacer?").preguntaAnterior,
  "",
);
assert.strictEqual(
  prepararContextoConversacional("¿Tengo 30 días?", "¿Cuántas horas tengo que hacer?").preguntaAnterior,
  "",
);
assert.strictEqual(
  prepararContextoConversacional("¿Son naturales o laborables?", "¿Cuántas horas tengo que hacer?").preguntaAnterior,
  "",
);
assert.strictEqual(
  prepararContextoConversacional("¿Y si hago 50 más?", "¿Quién ganó el Mundial?").preguntaAnterior,
  "",
);
assert.strictEqual(validarPreguntaAnterior(undefined), true);
assert.strictEqual(validarPreguntaAnterior("x".repeat(MAX_PREVIOUS_QUESTION_LENGTH)), true);
assert.strictEqual(validarPreguntaAnterior("x".repeat(MAX_PREVIOUS_QUESTION_LENGTH + 1)), false);
assert.strictEqual(validarPreguntaAnterior(["pregunta"]), false);
console.log("OK  Contexto de 7 repreguntas, pregunta independiente, historial irrelevante y límites.");

function consultaRag(pregunta, anterior = "", datos = {}) {
  const contexto = prepararContextoConversacional(pregunta, anterior);
  const intent = classifyLaborIntent({ pregunta: contexto.preguntaParaBusqueda }).intent;
  return construirConsultaRag({ preguntaParaBusqueda: contexto.preguntaParaBusqueda, intent, ...datos });
}

assert.match(consultaRag("¿Cuántas horas me tocan?"), /jornada anual duracion laboral/);
assert.match(consultaRag("¿Cuántos días de vacaciones tengo?"), /naturales laborables/);
assert.match(consultaRag("¿Cómo funcionan las horas extra?"), /compensacion descanso/);
assert.match(consultaRag("Estoy currando de más, ¿qué puedo hacer?"), /horas extra compensacion descanso/);
assert.match(consultaRag("¿Y si hago 50 más?", "¿Cuántas horas tengo que hacer?"), /extra compensacion descanso/);
assert.match(consultaRag("¿Son naturales?", "¿Cuántos días de vacaciones tengo?"), /vacaciones/);
const conDatos = consultaRag("¿Cuántas horas me tocan?", "", {
  sector: "Hostelería", ciudad: "Donostia", territorio: "Gipuzkoa", convenio: "Convenio Hostelería Gipuzkoa",
});
for (const termino of ["hosteleria", "donostia", "gipuzkoa", "convenio"]) {
  assert.strictEqual(conDatos.match(new RegExp(termino, "g"))?.length, 1, termino);
}
assert.strictEqual(consultaRag("¿Quién ganó el Mundial?", "¿Cuántas horas tengo que hacer?"), "¿Quién ganó el Mundial?");
assert.strictEqual(consultaRag("¿Cómo estás?"), "¿Cómo estás?");
assert.ok(consultaRag("¿Cuántas horas me tocan?", "", { convenio: "x".repeat(600) }).length <= MAX_CONSULTA_RAG_LENGTH);
console.log("OK  Consulta RAG: jornada, vacaciones, horas extra, repregunta, metadatos y límites.");

console.log(`\n${cases.length} comprobaciones de intención pasaron.`);
