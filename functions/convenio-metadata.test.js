"use strict";

const assert = require("assert");
const {
  buildCatalogEntriesFromFileNames,
  detectConvenioCriteria,
  getDocumentType,
  hasUnindexedSalaryEvidence,
  isWorkersStatuteChunkCurrent,
  parseConvenioFileName,
  resolveWorkersStatuteVersion,
  resolveCatalogEntry,
  resolveCatalogReference,
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
assert.strictEqual(getDocumentType("estatuto_trabajadores_2026-10-03.pdf"), "base");
assert.strictEqual(getDocumentType("Convenio Transporte Alava.pdf"), "especifico");

const zaragoza2026 = parseConvenioFileName("Convenio Limpieza edificios Zaragoza 2026-2029.pdf");
assert.strictEqual(zaragoza2026.province, "ZARAGOZA");
assert.deepStrictEqual(zaragoza2026.sectorKeys, ["limpieza"]);
assert.strictEqual(zaragoza2026.yearStart, 2026);
assert.strictEqual(zaragoza2026.yearEnd, 2029);
assert.strictEqual(zaragoza2026.catalogKey, "limpieza_zaragoza_2026_2029");
assert.strictEqual(zaragoza2026.officialCode, "50000755011981");
assert.strictEqual(zaragoza2026.sourceVerification, "verified");
assert.strictEqual(zaragoza2026.sourcePageCount, 33);
assert.match(zaragoza2026.applicationWarning, /no confirman por sí solas su aplicabilidad/);
const zaragozaEntries = buildCatalogEntriesFromFileNames([
  "Convenio Limpieza edificios Zaragoza 2022-2025.pdf",
  "Convenio Limpieza edificios Zaragoza 2026-2029.pdf",
]);
assert.strictEqual(resolveCatalogEntry(zaragozaEntries, detectConvenioCriteria({ pregunta: "Limpieza Zaragoza 2024" })).entry.yearStart, 2022);
assert.strictEqual(resolveCatalogEntry(zaragozaEntries, detectConvenioCriteria({ pregunta: "Limpieza Zaragoza 2026" })).entry.yearStart, 2026);
assert.strictEqual(resolveCatalogEntry(zaragozaEntries, detectConvenioCriteria({ pregunta: "Limpieza Zaragoza" })).entry.yearStart, 2026);
const revisionQuery = detectConvenioCriteria({ pregunta: "Revisión salarial 2026 de restauración en Gipuzkoa" });
assert.strictEqual(revisionQuery.isSalaryQuery, true);
assert.strictEqual(resolveCatalogEntry([
  { id: "restauracion", title: "Restauración", province: "GIPUZKOA", sectorKeys: ["hosteleria"], yearStart: 2023, yearEnd: 2026, fileNames: ["convenio.pdf"], sourceVerification: "verified" },
  { id: "revision", title: "Revisión salarial", province: "GIPUZKOA", sectorKeys: ["hosteleria"], yearStart: 2026, yearEnd: 2026, fileNames: ["revision.pdf"], sourceVerification: "verified", sourceDocumentType: "salary_revision" },
], revisionQuery).entry.id, "revision");

const statuteBeforeChange = resolveWorkersStatuteVersion("Estatuto a 22/10/2026");
const statuteAfterChange = resolveWorkersStatuteVersion("Estatuto a 23 de octubre de 2026");
assert.strictEqual(statuteBeforeChange.status, "resolved");
assert.deepStrictEqual(statuteBeforeChange.fileNames, ["estatuto_trabajadores_parte1.pdf", "estatuto_trabajadores_parte2.pdf"]);
assert.strictEqual(statuteAfterChange.status, "resolved");
assert.deepStrictEqual(statuteAfterChange.fileNames, ["estatuto_trabajadores_2026-10-03.pdf"]);
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto en 2026").status, "ambiguous");
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto en 2027").sourceEdition, statuteAfterChange.sourceEdition);
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto en 2020").status, "unsupported");
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto BOE-A-2015-11430 vigente", new Date("2026-10-13T10:00:00Z")).sourceEdition, "PUB-DT-2025-139");
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto el 1/1/2020").status, "unsupported");
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto entre 22/10/2026 y 23/10/2026").status, "ambiguous");
assert.strictEqual(resolveWorkersStatuteVersion("Estatuto vigente", new Date("2026-10-13T10:00:00Z")).sourceEdition, "PUB-DT-2025-139");
assert.strictEqual(isWorkersStatuteChunkCurrent({ officialCode: "BOE-A-2015-11430", sourceValidThrough: "2026-10-22" }, "2026-10-22"), true);
assert.strictEqual(isWorkersStatuteChunkCurrent({ officialCode: "BOE-A-2015-11430", sourceValidThrough: "2026-10-22" }, "2026-10-23"), false);
assert.strictEqual(isWorkersStatuteChunkCurrent({ officialCode: "BOE-A-2015-11430", sourceValidFrom: "2026-10-23" }, "2026-10-22"), false);
assert.strictEqual(isWorkersStatuteChunkCurrent({ officialCode: "BOE-A-2015-11430", sourceValidFrom: "2026-10-23" }, "2026-10-23"), true);

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

const barcelonaTablesFile = "BOPB-2026-03-16-08004295011994-tablas-2025.pdf";
const barcelonaTablesMetadata = parseConvenioFileName(barcelonaTablesFile);
assert.strictEqual(barcelonaTablesMetadata.sourceVerification, "verified");
assert.strictEqual(barcelonaTablesMetadata.officialCode, "08004295011994");
assert.strictEqual(barcelonaTablesMetadata.province, "BARCELONA");
assert.deepStrictEqual(barcelonaTablesMetadata.sectorKeys, ["transporte"]);
assert.strictEqual(barcelonaTablesMetadata.sourceDocumentType, "salary_tables");
assert.strictEqual(barcelonaTablesMetadata.yearStart, 2025);
assert.strictEqual(barcelonaTablesMetadata.yearEnd, 2025);
const barcelonaTables = buildCatalogEntriesFromFileNames([barcelonaTablesFile]);
assert.strictEqual(barcelonaTables[0].title, "Tablas salariales 2025 — Transporte de mercancías Barcelona");
assert.strictEqual(barcelonaTables[0].sourceSha256, "65ba6993bcbaa71e98ea257969f5ea0b66d401f01e33ed5811031c77d3267571");
assert.strictEqual(resolveCatalogEntry(barcelonaTables, detectConvenioCriteria({ pregunta: "transporte Barcelona 2025 jornada" })).status, "not_found");
assert.strictEqual(resolveCatalogEntry(barcelonaTables, detectConvenioCriteria({ pregunta: "salario transporte Barcelona 2025" })).status, "resolved");
assert.strictEqual(resolveCatalogEntry(barcelonaTables, detectConvenioCriteria({ pregunta: "salario transporte Barcelona 2026" })).status, "not_found");
assert.strictEqual(
  resolveCatalogReference(barcelonaTables, barcelonaTablesFile, detectConvenioCriteria({ pregunta: "jornada", ciudad: "Barcelona", sector: "transporte" })),
  null,
);
assert.strictEqual(
  resolveCatalogReference(barcelonaTables, barcelonaTablesFile, detectConvenioCriteria({ pregunta: "salario", ciudad: "Barcelona", sector: "transporte" })).id,
  "transporte_barcelona_tablas_2025",
);
assert.strictEqual(hasUnindexedSalaryEvidence(barcelonaTables[0], "salario en 2026", 2026), true);

const barcelonaNewFile = "Convenio Transporte Barcelona 2026-2028.pdf";
const barcelonaNew = parseConvenioFileName(barcelonaNewFile);
assert.equal(barcelonaNew.sourceVerification, "verified");
assert.equal(barcelonaNew.sourceDocumentType, "collective_agreement");
assert.equal(barcelonaNew.officialCode, "08004295011994");
assert.equal(barcelonaNew.sourceSha256, "e81893786bf944d2e42479ab78ad5a0ccc13c305aeb68e880962d10d17f1949b");
assert.equal(barcelonaNew.publication.identifier, "CVE 202610145528");
assert.equal(barcelonaNew.sourceValidFrom, "2026-01-01");
assert.equal(barcelonaNew.economicEffectsFrom, "2026-01-01");
const barcelonaTemporal = buildCatalogEntriesFromFileNames([
  "Convenio Transporte Barcelona 2011-2023.pdf", barcelonaTablesFile, barcelonaNewFile,
]);
assert.equal(resolveCatalogEntry(barcelonaTemporal, detectConvenioCriteria({ pregunta: "convenio transporte Barcelona 2025" })).status, "not_found");
assert.equal(resolveCatalogEntry(barcelonaTemporal, detectConvenioCriteria({ pregunta: "salarios transporte Barcelona 2025" })).entry.id, "transporte_barcelona_tablas_2025");
for (const year of [2026, 2027]) {
  assert.equal(resolveCatalogEntry(barcelonaTemporal, detectConvenioCriteria({ pregunta: `convenio transporte Barcelona ${year}` })).entry.id, "transporte_barcelona_2026_2028");
  assert.equal(resolveCatalogEntry(barcelonaTemporal, detectConvenioCriteria({ pregunta: `salarios transporte Barcelona ${year}` })).entry.id, "transporte_barcelona_2026_2028");
}
assert.equal(resolveCatalogEntry(barcelonaTemporal, detectConvenioCriteria({ pregunta: "convenio transporte Barcelona 2019" })).status, "source_unverified");
assert.equal(resolveCatalogEntry(barcelonaTemporal, detectConvenioCriteria({ pregunta: "jornada transporte Barcelona 15/01/2026" })).entry.id, "transporte_barcelona_2026_2028");

const zaragozaNewFile = "Convenio Transporte Zaragoza 2026-2028.pdf";
const zaragozaNew = parseConvenioFileName(zaragozaNewFile);
assert.equal(zaragozaNew.sourceVerification, "verified");
assert.equal(zaragozaNew.officialCode, "50001115011981");
assert.equal(zaragozaNew.publication.identifier, "Anuncio 6101");
assert.equal(zaragozaNew.sourceValidFrom, "2026-09-20");
assert.equal(zaragozaNew.economicEffectsFrom, "2026-01-01");
assert.deepEqual(zaragozaNew.economicEffectsExceptions, [{ subject: "dietas", effectiveFrom: "2026-07-01" }]);
const zaragozaTemporal = buildCatalogEntriesFromFileNames([
  "Convenio Transporte Zaragoza 2022-2025.pdf", zaragozaNewFile,
]);
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "convenio transporte Zaragoza 2024" })).entry.fileNames[0], "Convenio Transporte Zaragoza 2022-2025.pdf");
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "convenio transporte Zaragoza 2025" })).entry.fileNames[0], "Convenio Transporte Zaragoza 2022-2025.pdf");
for (const year of [2026, 2027]) {
  assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: `convenio transporte Zaragoza ${year}` })).entry.id, "transporte_zaragoza_2026_2028");
  assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: `salarios transporte Zaragoza ${year}` })).entry.id, "transporte_zaragoza_2026_2028");
}
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "jornada transporte Zaragoza 19/09/2026" })).status, "not_found");
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "salarios transporte Zaragoza 15/06/2026" })).entry.id, "transporte_zaragoza_2026_2028");
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "dietas transporte Zaragoza 15/06/2026" })).status, "not_found");
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "dietas transporte Zaragoza 01/07/2026" })).entry.id, "transporte_zaragoza_2026_2028");
assert.equal(resolveCatalogEntry(zaragozaTemporal, detectConvenioCriteria({ pregunta: "jornada transporte Zaragoza 20/09/2026" })).entry.id, "transporte_zaragoza_2026_2028");

const gipuzkoaRevisionFile = "BOG-2026-02-16-20100035012014-revision-salarial-2026.pdf";
const gipuzkoaRevision = parseConvenioFileName(gipuzkoaRevisionFile);
assert.strictEqual(gipuzkoaRevision.officialCode, "20100035012014");
assert.strictEqual(gipuzkoaRevision.sourceDocumentType, "salary_revision");
const gipuzkoaCatalog = buildCatalogEntriesFromFileNames([
  "Convenio Alojamientos GIPUZKOA 2025-2028.pdf", gipuzkoaRevisionFile,
]);
assert.strictEqual(resolveCatalogEntry(gipuzkoaCatalog, detectConvenioCriteria({ pregunta: "salario alojamientos Gipuzkoa 2026" })).entry.id, gipuzkoaRevision.catalogKey);
assert.notStrictEqual(resolveCatalogEntry(gipuzkoaCatalog, detectConvenioCriteria({ pregunta: "jornada alojamientos Gipuzkoa 2026" })).entry.id, gipuzkoaRevision.catalogKey);
assert.notStrictEqual(resolveCatalogEntry(gipuzkoaCatalog, detectConvenioCriteria({ pregunta: "salario alojamientos Gipuzkoa 2025" })).entry.id, gipuzkoaRevision.catalogKey);
