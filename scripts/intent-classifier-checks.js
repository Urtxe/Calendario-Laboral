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
  prepararContextoConversacional("¿Y si hago 50 más?", "¿Quién ganó el Mundial?").preguntaAnterior,
  "",
);
assert.strictEqual(validarPreguntaAnterior(undefined), true);
assert.strictEqual(validarPreguntaAnterior("x".repeat(MAX_PREVIOUS_QUESTION_LENGTH)), true);
assert.strictEqual(validarPreguntaAnterior("x".repeat(MAX_PREVIOUS_QUESTION_LENGTH + 1)), false);
assert.strictEqual(validarPreguntaAnterior(["pregunta"]), false);
console.log("OK  Contexto de 3 repreguntas, pregunta independiente, historial irrelevante y límites.");

console.log(`\n${cases.length} comprobaciones de intención pasaron.`);
