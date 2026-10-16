const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/js/app/calendar.js"), "utf8");
const events = [];
const nodes = {
  "fecha-extra-display": { textContent: "" },
  "input-horas-extra": { value: "" },
  "modal-horas-extra": { style: {} },
};
const context = {
  window: { BalanceLaboralConversion: { trackShiftAdded() { events.push("shift_added"); } } },
  document: { getElementById(id) { return nodes[id] || null; }, querySelectorAll() { return []; } },
  anioActual: 2026,
  mesActual: 7,
  ciudadActual: "Donostia",
  sectorUsuario: "general",
  festivosCargados: [],
  modoSeleccionado: "trabajado",
  diasMarcados: {},
  horasExtraPorDia: {},
  getFechaKey(date) { return date.toISOString().slice(0, 10); },
  esFestivo() { return false; },
  renderTodo() {},
  guardarTodoEnFirebase: () => Promise.resolve(true),
  actualizarVisualBotones() {},
  usuarioPuedeUsarPremium() { return true; },
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "calendar.js" });

(async () => {
  let resolveSave;
  context.guardarTodoEnFirebase = () => new Promise((resolve) => { resolveSave = resolve; });
  context.procesarClickDia(1);
  assert.deepEqual(events, [], "a shift is not reported while persistence is pending");
  resolveSave(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["shift_added"], "a newly saved calendar record is reported once");

  context.guardarTodoEnFirebase = () => Promise.resolve(false);
  context.procesarClickDia(2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["shift_added"], "failed persistence emits no shift event");

  context.guardarTodoEnFirebase = () => Promise.resolve(true);
  context.procesarClickDia(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["shift_added"], "removing an existing record emits no shift-added event");

  context.modoSeleccionado = "horasExtra";
  context.procesarClickDia(3);
  assert.deepEqual(events, ["shift_added"], "opening the extra-hours editor is not a shift registration");
  assert.equal(nodes["modal-horas-extra"].style.display, "flex");
  context.modoSeleccionado = "vacaciones";
  context.procesarClickDia(4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["shift_added"], "holidays are not a worked shift");
  context.modoSeleccionado = "trabajado";
  context.procesarClickDia(4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["shift_added"], "editing an existing day does not add a new shift");
  console.log("calendar analytics checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
