"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  buildCatalogEntriesFromFileNames,
  getDocumentType,
} = require("./convenio-metadata");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "calendario-laboral-252b1";
const EXPECTED_PROJECT_ID = "calendario-laboral-252b1";
const VECTORS = "vectores_convenios";
const CATALOG = "catalogo_convenios";
const STATUTE_FILES = ["estatuto_trabajadores_parte1.pdf", "estatuto_trabajadores_parte2.pdf"];
const SOURCE_FILES = [
  "Convenio Alojamientos y Hostelería Valencia2022-2025.pdf",
  "Convenio Transporte Alava 201-2026.pdf",
  "Convenio Transporte Barcelona 2011-2023.pdf",
  "Convenio Alojamientos y Hostelería Malaga parte 1.pdf",
  "Convenio Alojamientos y Hostelería Malaga parte 2 2018-2027.pdf",
  ...STATUTE_FILES,
  "Convenio Transporte Gipuzkoa 2010-2014.pdf",
  "Convenio Transporte GIPUZKOA 2007-2010.pdf",
  "Convenio Transporte GIPUZKOA 2007-2010parte1.pdf",
  "Convenio Transporte GIPUZKOA 2007-2010parte2.pdf",
];
const STATUTE_COUNTS = new Map([
  ["estatuto_trabajadores_parte1.pdf", 444],
  ["estatuto_trabajadores_parte2.pdf", 363],
]);
const REQUIRED_CATALOG_IDS = [
  "alojamientos_hosteleria_sin_provincia_2025_2025",
  "transporte_alava_2026_2026",
  "transporte_barcelona_2011_2023",
  "alojamientos_hosteleria_malaga_2018_2027",
  "alojamientos_hosteleria_malaga_na_na",
  "sin_sector_sin_provincia_na_na",
  "transporte_gipuzkoa_2010_2014",
  "transporte_gipuzkoa_2007_2010",
  "transporte_gipuzkoa_2007_2007",
];
const MALAGA_PRIMARY_ID = "alojamientos_hosteleria_malaga_2018_2027";
const MALAGA_OLD_PART_ID = "alojamientos_hosteleria_malaga_na_na";
const GIPUZKOA_PRIMARY_ID = "transporte_gipuzkoa_2007_2010";
const GIPUZKOA_OLD_PARTS_ID = "transporte_gipuzkoa_2007_2007";
const STATUTE_CATALOG_ID = "sin_sector_sin_provincia_na_na";
const MIGRATION_ID = "convenio-rag-integrity-2026-v1";

if (PROJECT_ID !== EXPECTED_PROJECT_ID) {
  throw new Error(`Refusing project ${PROJECT_ID}; expected ${EXPECTED_PROJECT_ID}.`);
}
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function parseArguments(argv) {
  const options = { mode: "dry-run", backupPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (["--export", "--apply", "--restore", "--verify"].includes(argv[index])) {
      const mode = argv[index].slice(2);
      options.mode = mode;
      if (mode !== "apply" && mode !== "restore") options.mode = "export";
      if (mode === "verify") options.mode = "verify";
      if (mode === "export") options.backupPath = argv[index + 1];
      if (mode === "apply" || mode === "restore" || mode === "verify") {
        if (argv[index + 1] === "--backup") options.backupPath = argv[index + 2];
      }
    }
  }
  return options;
}

function serializeValue(value) {
  if (value && typeof value.toArray === "function") {
    return { __firestoreType: "vector", values: value.toArray() };
  }
  if (value && typeof value.toDate === "function" && Number.isInteger(value.seconds)) {
    return { __firestoreType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds || 0 };
  }
  if (value instanceof Date) return { __firestoreType: "date", value: value.toISOString() };
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
  }
  return value;
}

function deserializeValue(value) {
  if (Array.isArray(value)) return value.map(deserializeValue);
  if (!value || typeof value !== "object") return value;
  if (value.__firestoreType === "vector") return admin.firestore.FieldValue.vector(value.values);
  if (value.__firestoreType === "timestamp") return new admin.firestore.Timestamp(value.seconds, value.nanoseconds);
  if (value.__firestoreType === "date") return new Date(value.value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserializeValue(item)]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(serializeValue(value))).digest("hex");
}

function backupRecord(collection, doc) {
  return { collection, id: doc.id, data: serializeValue(doc.data()) };
}

function ensureBackupPathIsOutsideRepository(backupPath) {
  if (!backupPath) throw new Error("Specify a backup path outside the repository.");
  const absolute = path.resolve(backupPath);
  const repoRoot = path.resolve(__dirname, "..");
  if (absolute === repoRoot || absolute.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("The Firestore backup must be stored outside the repository.");
  }
  return absolute;
}

async function readSnapshot() {
  const vectorSnapshot = await db.collection(VECTORS)
    .where("file_name", "in", STATUTE_FILES)
    .get();
  const catalogSnapshot = await db.collection(CATALOG).get();
  const targetNames = new Set(SOURCE_FILES);
  const catalogDocs = catalogSnapshot.docs.filter((doc) => {
    const names = doc.data()?.fileNames;
    return Array.isArray(names) && names.some((name) => targetNames.has(name));
  });
  return { vectorDocs: vectorSnapshot.docs, catalogDocs };
}

async function exportBackup(backupPath) {
  const absolute = ensureBackupPathIsOutsideRepository(backupPath);
  const { vectorDocs, catalogDocs } = await readSnapshot();
  const expectedTotal = Array.from(STATUTE_COUNTS.values()).reduce((sum, count) => sum + count, 0);
  if (vectorDocs.length !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} statute chunks for backup; found ${vectorDocs.length}.`);
  }
  const backup = {
    migrationId: MIGRATION_ID,
    projectId: PROJECT_ID,
    createdAt: new Date().toISOString(),
    records: [
      ...vectorDocs.map((doc) => backupRecord(VECTORS, doc)),
      ...catalogDocs.map((doc) => backupRecord(CATALOG, doc)),
    ],
  };
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(backup), { flag: "wx" });
  const diskBackup = JSON.parse(fs.readFileSync(absolute, "utf8"));
  validateBackup(diskBackup);
  const expectedHashes = new Map([
    ...vectorDocs.map((doc) => [`${VECTORS}/${doc.id}`, recordHash(doc.data())]),
    ...catalogDocs.map((doc) => [`${CATALOG}/${doc.id}`, recordHash(doc.data())]),
  ]);
  const backupHashes = new Map(diskBackup.records.map((record) => [
    `${record.collection}/${record.id}`,
    recordHash(deserializeValue(record.data)),
  ]));
  if (expectedHashes.size !== backupHashes.size || Array.from(expectedHashes).some(([key, hash]) => backupHashes.get(key) !== hash)) {
    throw new Error("Backup round-trip validation failed; no Firestore writes are permitted.");
  }
  console.log(`Backup verified: ${vectorDocs.length} vector records and ${catalogDocs.length} catalog records.`);
}

function readBackup(backupPath) {
  const absolute = ensureBackupPathIsOutsideRepository(backupPath);
  if (!fs.existsSync(absolute)) throw new Error(`Backup file not found: ${absolute}`);
  const backup = JSON.parse(fs.readFileSync(absolute, "utf8"));
  validateBackup(backup);
  return backup;
}

function validateBackup(backup) {
  if (backup.migrationId !== MIGRATION_ID || backup.projectId !== EXPECTED_PROJECT_ID || !Array.isArray(backup.records)) {
    throw new Error("Backup does not match this migration/project.");
  }
  const seen = new Set();
  const vectorCounts = new Map();
  for (const record of backup.records) {
    if (![VECTORS, CATALOG].includes(record.collection) || !record.id || !record.data) {
      throw new Error("Backup contains an invalid document record.");
    }
    const key = `${record.collection}/${record.id}`;
    if (seen.has(key)) throw new Error(`Backup contains duplicate record ${key}.`);
    seen.add(key);
    const data = deserializeValue(record.data);
    if (record.collection === VECTORS) {
      const fileName = data.file_name;
      if (!STATUTE_COUNTS.has(fileName) || !data.vector || typeof data.vector._toProto !== "function") {
        throw new Error(`Backup vector record is incomplete (${key}).`);
      }
      const values = record.data.vector.values;
      if (!Array.isArray(values) || values.length !== 768) throw new Error(`Backup embedding dimension mismatch (${key}).`);
      vectorCounts.set(fileName, (vectorCounts.get(fileName) || 0) + 1);
    }
  }
  const catalogIds = new Set(backup.records.filter((record) => record.collection === CATALOG).map((record) => record.id));
  if (REQUIRED_CATALOG_IDS.some((id) => !catalogIds.has(id))) {
    throw new Error("Backup is missing one or more affected catalog records.");
  }
  for (const [fileName, expected] of STATUTE_COUNTS) {
    if (vectorCounts.get(fileName) !== expected) throw new Error(`Backup count mismatch for ${fileName}.`);
  }
  if (!backup.records.some((record) => record.collection === CATALOG && record.id === STATUTE_CATALOG_ID)) {
    throw new Error("Backup is missing the statute catalog record.");
  }
  return true;
}

function requireCatalogRecord(catalogById, id) {
  const doc = catalogById.get(id);
  if (!doc) throw new Error(`Expected catalog document is missing: ${id}.`);
  return doc;
}

async function buildMigrationPlan() {
  const { vectorDocs, catalogDocs } = await readSnapshot();
  const catalogById = new Map(catalogDocs.map((doc) => [doc.id, doc]));
  for (const id of REQUIRED_CATALOG_IDS) requireCatalogRecord(catalogById, id);

  const vectorsByFile = new Map();
  vectorDocs.forEach((doc) => {
    const data = doc.data() || {};
    const fileName = data.file_name;
    if (!STATUTE_COUNTS.has(fileName) || data.doc_type !== "especifico" || !data.vector) {
      throw new Error(`Unexpected statute vector record state for ${doc.id}.`);
    }
    const vector = typeof data.vector.toArray === "function" ? data.vector.toArray() : [];
    if (vector.length !== 768 || data.outputDimensionality !== 768 || data.embeddingModel !== "gemini-embedding-001") {
      throw new Error(`Unexpected statute embedding metadata for ${doc.id}.`);
    }
    if (!vectorsByFile.has(fileName)) vectorsByFile.set(fileName, []);
    vectorsByFile.get(fileName).push({ doc, data });
  });
  for (const [fileName, expected] of STATUTE_COUNTS) {
    if (vectorsByFile.get(fileName)?.length !== expected) throw new Error(`Unexpected chunk count for ${fileName}.`);
    const indices = vectorsByFile.get(fileName).map(({ data }) => data.chunkIndex).sort((a, b) => a - b);
    if (indices.some((value, index) => value !== index)) throw new Error(`Non-contiguous chunk indices for ${fileName}.`);
  }

  const existingSpecific = await db.collection(VECTORS).where("doc_type", "==", "especifico").select("file_name").get();
  const fileNames = Array.from(new Set(existingSpecific.docs.map((doc) => doc.get("file_name")).filter(Boolean)));
  const generatedEntries = buildCatalogEntriesFromFileNames(fileNames);
  const entryFor = (fileName) => generatedEntries.find((entry) => entry.fileNames.includes(fileName));
  const catalogUpdates = [];

  for (const fileName of [
    "Convenio Alojamientos y Hostelería Valencia2022-2025.pdf",
    "Convenio Transporte Alava 201-2026.pdf",
    "Convenio Alojamientos y Hostelería Malaga parte 1.pdf",
    "Convenio Transporte Barcelona 2011-2023.pdf",
    "Convenio Transporte Gipuzkoa 2010-2014.pdf",
    "Convenio Transporte GIPUZKOA 2007-2010.pdf",
  ]) {
    const entry = entryFor(fileName);
    if (!entry) throw new Error(`No canonical catalog metadata generated for ${fileName}.`);
    const existing = catalogById.get(entry.id);
    if (!existing) throw new Error(`Canonical catalog ID is not present: ${entry.id}.`);
    catalogUpdates.push({
      id: entry.id,
      ref: existing.ref,
      fields: {
        ...entry,
        catalogStatus: "active",
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  const statuteRecord = requireCatalogRecord(catalogById, STATUTE_CATALOG_ID);
  catalogUpdates.push({
    id: STATUTE_CATALOG_ID,
    ref: statuteRecord.ref,
    fields: {
      catalogStatus: "normative_base",
      active: false,
      doc_type: "base",
      normativeSource: "BOE-A-2015-11430",
      sourceEdition: "PUB-DT-2025-139",
      sourceUpdatedThrough: "2025-12-04",
      sourceValidThrough: "2026-10-22",
      officialSourceUrl: "https://www.boe.es/biblioteca_juridica/pdf/PUB-DT-2025-139.pdf",
      sourceVerification: "verified",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  });

  for (const [id, supersededBy, reason] of [
    [MALAGA_OLD_PART_ID, MALAGA_PRIMARY_ID, "Original publication is now grouped with its verified revision."],
    [GIPUZKOA_OLD_PARTS_ID, GIPUZKOA_PRIMARY_ID, "Related historical BOG files are grouped under one unverified documentary source."],
  ]) {
    const existing = requireCatalogRecord(catalogById, id);
    catalogUpdates.push({
      id,
      ref: existing.ref,
      fields: {
        catalogStatus: "superseded",
        active: false,
        supersededBy,
        documentaryNote: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  const vectorUpdates = [];
  for (const records of vectorsByFile.values()) {
    for (const { doc } of records) {
      vectorUpdates.push({
        id: doc.id,
        ref: doc.ref,
        fields: {
          doc_type: getDocumentType(doc.get("file_name")),
          officialCode: "BOE-A-2015-11430",
          sourceEdition: "PUB-DT-2025-139",
          sourceUpdatedThrough: "2025-12-04",
          sourceValidThrough: "2026-10-22",
          officialSourceUrl: "https://www.boe.es/biblioteca_juridica/pdf/PUB-DT-2025-139.pdf",
          sourceVerification: "verified",
          normativeSource: "Estatuto de los Trabajadores",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }
  }

  return { catalogDocs, vectorDocs, catalogUpdates, vectorUpdates };
}

async function assertSnapshotMatchesBackup(backup) {
  const { vectorDocs, catalogDocs } = await readSnapshot();
  const current = new Map([
    ...vectorDocs.map((doc) => [`${VECTORS}/${doc.id}`, recordHash(doc.data())]),
    ...catalogDocs.map((doc) => [`${CATALOG}/${doc.id}`, recordHash(doc.data())]),
  ]);
  const expected = new Map(backup.records.map((record) => [
    `${record.collection}/${record.id}`,
    recordHash(deserializeValue(record.data)),
  ]));
  if (current.size !== expected.size) throw new Error("Firestore target set changed since backup; refusing write.");
  for (const [key, hash] of expected) {
    if (current.get(key) !== hash) throw new Error(`Firestore document changed since backup; refusing write (${key}).`);
  }
}

async function writeInBatches(records, label) {
  for (let offset = 0; offset < records.length; offset += 400) {
    const batch = db.batch();
    for (const record of records.slice(offset, offset + 400)) batch.set(record.ref, record.fields, { merge: true });
    await batch.commit();
  }
  console.log(`Applied ${records.length} ${label} metadata updates.`);
}

async function applyMigration(backupPath) {
  const backup = readBackup(backupPath);
  const plan = await buildMigrationPlan();
  await assertSnapshotMatchesBackup(backup);
  console.log(`Plan verified: ${plan.vectorUpdates.length} statute chunks, ${plan.catalogUpdates.length} catalog records.`);
  await writeInBatches(plan.vectorUpdates, "vector");
  await writeInBatches(plan.catalogUpdates, "catalog");

  const updatedVectorSnapshot = await db.collection(VECTORS).where("file_name", "in", STATUTE_FILES).get();
  if (updatedVectorSnapshot.size !== plan.vectorUpdates.length || updatedVectorSnapshot.docs.some((doc) =>
    doc.get("doc_type") !== "base" || doc.get("officialCode") !== "BOE-A-2015-11430" || !doc.get("vector")
  )) throw new Error("Post-migration vector validation failed; restore from the supplied backup.");

  for (const update of plan.catalogUpdates) {
    const doc = await update.ref.get();
    const expected = update.fields;
    for (const [key, value] of Object.entries(expected)) {
      if (key === "updatedAt") continue;
      if (canonicalJson(serializeValue(doc.get(key))) !== canonicalJson(serializeValue(value))) {
        throw new Error(`Post-migration catalog validation failed at ${update.id}.${key}; restore from backup.`);
      }
    }
  }
  console.log("Post-migration validation passed. Embedding vectors and chunk text were not rewritten.");
}

async function restoreBackup(backupPath) {
  const backup = readBackup(backupPath);
  const records = backup.records.map((record) => ({
    ref: db.collection(record.collection).doc(record.id),
    data: deserializeValue(record.data),
  }));
  for (let offset = 0; offset < records.length; offset += 400) {
    const batch = db.batch();
    for (const record of records.slice(offset, offset + 400)) batch.set(record.ref, record.data, { merge: false });
    await batch.commit();
  }
  console.log(`Restored ${records.length} original Firestore documents from backup.`);
}

async function verifyMigration(backupPath) {
  const backup = readBackup(backupPath);
  const { vectorDocs, catalogDocs } = await readSnapshot();
  const originalVectors = new Map(backup.records
    .filter((record) => record.collection === VECTORS)
    .map((record) => [record.id, record.data]));
  if (vectorDocs.length !== originalVectors.size) throw new Error("Post-migration vector count differs from backup.");
  for (const doc of vectorDocs) {
    const original = originalVectors.get(doc.id);
    const current = doc.data();
    if (!original || current.doc_type !== "base" || current.officialCode !== "BOE-A-2015-11430" ||
        current.file_name !== original.file_name || current.texto !== original.texto ||
        current.chunkIndex !== original.chunkIndex || current.chunkTotal !== original.chunkTotal ||
        current.embeddingModel !== original.embeddingModel || current.outputDimensionality !== original.outputDimensionality ||
        canonicalJson(current.vector.toArray()) !== canonicalJson(original.vector.values)) {
      throw new Error(`Post-migration vector or chunk integrity check failed (${doc.id}).`);
    }
  }
  if (catalogDocs.length !== REQUIRED_CATALOG_IDS.length) throw new Error("Post-migration catalog target count differs from backup.");
  const catalogById = new Map(catalogDocs.map((doc) => [doc.id, doc.data()]));
  if (catalogById.get(STATUTE_CATALOG_ID)?.catalogStatus !== "normative_base" ||
      catalogById.get(MALAGA_OLD_PART_ID)?.catalogStatus !== "superseded" ||
      catalogById.get(GIPUZKOA_OLD_PARTS_ID)?.catalogStatus !== "superseded" ||
      catalogById.get("transporte_barcelona_2011_2023")?.sourceVerification !== "unverified") {
    throw new Error("Post-migration catalog classification check failed.");
  }
  console.log(`Read-only verification passed: ${vectorDocs.length} Estatuto chunks retain their text and embeddings; ${catalogDocs.length} catalog records are present.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === "export") return exportBackup(options.backupPath);
  if (options.mode === "apply") {
    if (!options.backupPath) throw new Error("Use --apply --backup <path> after exporting and validating the backup.");
    return applyMigration(options.backupPath);
  }
  if (options.mode === "verify") {
    if (!options.backupPath) throw new Error("Use --verify --backup <path> to compare current records with the pre-migration backup.");
    return verifyMigration(options.backupPath);
  }
  if (options.mode === "restore") {
    if (!options.backupPath) throw new Error("Use --restore --backup <path> to restore the pre-migration snapshot.");
    return restoreBackup(options.backupPath);
  }
  const plan = await buildMigrationPlan();
  console.log(`Dry run only: would update ${plan.vectorUpdates.length} statute chunks and ${plan.catalogUpdates.length} catalog records.`);
  console.log("No Firestore writes performed. Export a backup before using --apply.");
}

main().catch((error) => {
  console.error(`Firestore reconciliation failed: ${error.name || "Error"}: ${error.message}`);
  process.exitCode = 1;
});
