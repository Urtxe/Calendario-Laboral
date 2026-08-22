const path = require("path");

const { classifyLaborIntent } = require(path.join(
  __dirname,
  "..",
  "functions",
  "intent-classifier",
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

console.log(`\n${cases.length} comprobaciones de intención pasaron.`);
