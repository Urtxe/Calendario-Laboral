"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { filterSalaryChunksForReferenceDates } = require("./rag-evidence");

test("selects only the 2026 salary table effective on an exact reference date", () => {
  const chunks = [
    { id: "jan-aug", sourceDocumentType: "salary_tables", sourceValidFrom: "2026-01-01", sourceValidThrough: "2026-08-31" },
    { id: "sep-dec", sourceDocumentType: "salary_tables", sourceValidFrom: "2026-09-01", sourceValidThrough: "2026-12-31" },
    { id: "tarragona", sourceDocumentType: "collective_agreement", province: "TARRAGONA" },
  ];

  assert.deepEqual(filterSalaryChunksForReferenceDates(chunks, ["2026-08-31"]).map((chunk) => chunk.id), ["jan-aug", "tarragona"]);
  assert.deepEqual(filterSalaryChunksForReferenceDates(chunks, ["2026-09-01"]).map((chunk) => chunk.id), ["sep-dec", "tarragona"]);
  assert.deepEqual(filterSalaryChunksForReferenceDates(chunks).map((chunk) => chunk.id), ["jan-aug", "sep-dec", "tarragona"]);
});

test("keeps all requested periods for comparisons and preserves unrelated evidence", () => {
  const chunks = [
    { id: "2026-01", sourceDocumentType: "salary_tables", sourceValidFrom: "2026-01-01", sourceValidThrough: "2026-08-31" },
    { id: "2026-09", sourceDocumentType: "salary_tables", sourceValidFrom: "2026-09-01", sourceValidThrough: "2026-12-31" },
    { id: "main-text", sourceDocumentType: "collective_agreement", sourceValidFrom: "2022-01-01" },
    { id: "undated-table", sourceDocumentType: "salary_tables" },
  ];

  assert.deepEqual(
    filterSalaryChunksForReferenceDates(chunks, ["2026-03-01", "2026-10-01"]).map((chunk) => chunk.id),
    ["2026-01", "2026-09", "main-text", "undated-table"],
  );
});
