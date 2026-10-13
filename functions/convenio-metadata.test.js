"use strict";

const assert = require("assert");
const {
  buildCatalogEntriesFromFileNames,
  detectConvenioCriteria,
  getDocumentType,
  hasUnindexedSalaryEvidence,
  isWorkersStatuteChunkCurrent,
  parseConvenioFileName,
  resolveCatalogEntry,
} = require("./convenio-metadata");

const valencia = parseConvenioFileName("Convenio Alojamientos y Hostelería Valencia2022-2025.pdf");
assert.strictEqual(valencia.province, "VALENCIA");
assert.strictEqual(valencia.yearStart, 2022);
assert.strictEqual(valencia.yearEnd, 2025);
assert.deepStrictEqual(valencia.sectorKeys, ["alojamientos", "hosteleria"]);

const alava = parseConvenioFileName("Convenio Transporte Alava 201-2026.pdf");
assert.strictEqual(alava.yearStart, 2020);
assert.strictEqual(alava.yearEnd, 2026);
assert.strictEqual(alava.officialCode, "01100085162024");
assert.strictEqual(alava.legalEffect, "extraestatutario_eficacia_limitada");
assert.match(alava.applicationWarning, /eficacia limitada/);

for (const fileName of ["estatuto_trabajadores.pdf", "estatuto_trabajadores_parte1.pdf", "estatuto_trabajadores_parte2.pdf"]) {
  assert.strictEqual(getDocumentType(fileName), "base", `${fileName} debe clasificarse como normativa base`);
}
assert.strictEqual(getDocumentType("estatuto_trabajadores_2026.pdf"), "especifico");
assert.strictEqual(getDocumentType("Convenio Transporte Alava.pdf"), "especifico");

const barcelona = parseConvenioFileName("Convenio Transporte Barcelona 2011-2023.pdf");
assert.strictEqual(barcelona.sourceVerification, "unverified");
assert.match(barcelona.documentaryWarning, /2023–2025/);
assert.strictEqual(
  resolveCatalogEntry(buildCatalogEntriesFromFileNames(["Convenio Transporte Barcelona 2011-2023.pdf"]),
    detectConvenioCriteria({ pregunta: "Transporte Barcelona" })).status,
  "source_unverified",
);

const statuteChunk = { officialCode: "BOE-A-2015-11430", sourceValidThrough: "2026-10-22" };
assert.strictEqual(isWorkersStatuteChunkCurrent(statuteChunk, new Date("2026-10-22T20:00:00Z")), true);
assert.strictEqual(isWorkersStatuteChunkCurrent(statuteChunk, new Date("2026-10-22T22:00:00Z")), false);
assert.strictEqual(isWorkersStatuteChunkCurrent({ officialCode: "BOE-A-2015-11430" }), false);

const malagaFiles = [
  "Convenio Alojamientos y Hostelería Malaga parte 1.pdf",
  "Convenio Alojamientos y Hostelería Malaga parte 2 2018-2027.pdf",
];
const malagaEntries = buildCatalogEntriesFromFileNames(malagaFiles);
assert.strictEqual(malagaEntries.length, 1, "original y revisión forman una entrada lógica");
const malaga = malagaEntries[0];
assert.deepStrictEqual(new Set(malaga.fileNames), new Set(malagaFiles));
assert.strictEqual(malaga.yearStart, 2018);
assert.strictEqual(malaga.yearEnd, 2027);
assert.strictEqual(malaga.publications.length, 2);
assert.deepStrictEqual(
  resolveCatalogEntry(malagaEntries, detectConvenioCriteria({ pregunta: "Hostelería Málaga 2021" })).entry.fileNames,
  [malagaFiles[0]],
);
assert.deepStrictEqual(
  new Set(resolveCatalogEntry(malagaEntries, detectConvenioCriteria({ pregunta: "Hostelería Málaga 2026" })).entry.fileNames),
  new Set(malagaFiles),
);
assert.strictEqual(hasUnindexedSalaryEvidence(malaga, "sueldo de camarero en 2026", 2026), true);
assert.strictEqual(hasUnindexedSalaryEvidence(malaga, "salario en 2022", 2026), false);
assert.strictEqual(hasUnindexedSalaryEvidence(malaga, "vacaciones en 2026", 2026), false);

const gipuzkoaFiles = [
  "Convenio Transporte Gipuzkoa 2010-2014.pdf",
  "Convenio Transporte GIPUZKOA 2007-2010.pdf",
  "Convenio Transporte GIPUZKOA 2007-2010parte1.pdf",
  "Convenio Transporte GIPUZKOA 2007-2010parte2.pdf",
];
const gipuzkoaEntries = buildCatalogEntriesFromFileNames(gipuzkoaFiles);
assert.strictEqual(
  resolveCatalogEntry(gipuzkoaEntries, detectConvenioCriteria({ pregunta: "Transporte Gipuzkoa 2012" })).status,
  "source_unverified",
);
assert.strictEqual(
  resolveCatalogEntry(gipuzkoaEntries, detectConvenioCriteria({ pregunta: "Transporte Gipuzkoa 2008" })).status,
  "source_unverified",
);

const datedEntries = [
  { id: "older", title: "Edición anterior", province: "MADRID", sectorKeys: ["transporte"], yearStart: 2010, yearEnd: 2014, fileNames: ["older.pdf"] },
  { id: "newer", title: "Edición posterior", province: "MADRID", sectorKeys: ["transporte"], yearStart: 2018, yearEnd: 2022, fileNames: ["newer.pdf"] },
];
assert.strictEqual(
  resolveCatalogEntry(datedEntries, detectConvenioCriteria({ pregunta: "Transporte Madrid 2012" })).entry.id,
  "older",
);
assert.strictEqual(
  resolveCatalogEntry(datedEntries, detectConvenioCriteria({ pregunta: "Transporte Madrid 2020" })).entry.id,
  "newer",
);
assert.strictEqual(resolveCatalogEntry(datedEntries, { provinces: ["MADRID"], sectorKeys: ["transporte"], requestedYears: [2016] }).status, "not_found");
assert.strictEqual(resolveCatalogEntry(datedEntries, { provinces: ["MADRID"], sectorKeys: ["transporte"], requestedYears: [2012, 2020] }).status, "not_found");
assert.strictEqual(resolveCatalogEntry(datedEntries, { provinces: ["MADRID"], sectorKeys: ["transporte"], requestedYears: [] }).entry.id, "newer");
assert.strictEqual(resolveCatalogEntry([
  ...datedEntries,
  { id: "overlap", title: "Otra edición para el mismo año", province: "MADRID", sectorKeys: ["transporte"], yearStart: 2012, yearEnd: 2013, fileNames: ["overlap.pdf"] },
], { provinces: ["MADRID"], sectorKeys: ["transporte"], requestedYears: [2012] }).status, "ambiguous");
assert.strictEqual(resolveCatalogEntry([
  { id: "inactive", title: "Entrada sustituida", province: "MADRID", sectorKeys: ["transporte"], yearStart: 2020, yearEnd: 2026, fileNames: ["old.pdf"], catalogStatus: "superseded" },
], { provinces: ["MADRID"], sectorKeys: ["transporte"], requestedYears: [] }).status, "not_found");

console.log("OK  Parser, fuentes verificadas, protección de años/salarios, Estatuto y selección documental.");
