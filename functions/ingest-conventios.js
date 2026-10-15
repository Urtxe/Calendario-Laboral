const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");
const { PDFParse } = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MAX_ATOMIC_CHUNKS, activateChunkSet, reserveEmbeddingBudget, omitUndefinedFields } = require("./convenio-ingestion");
const { downloadOfficialPdf, storeOfficialPdf, verifyPdfBytes, classifyOfficialDocument } = require("./official-convenio-document");
const {
  CATALOGO_CONVENIOS,
  buildCatalogEntriesFromFileNames,
  getDocumentType,
  parseConvenioFileName,
  sanitizeId,
} = require("./convenio-metadata");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const CONVENIOS_DIR = path.join(__dirname, "convenios");
const INBOX_DIR = path.join(CONVENIOS_DIR, "inbox");
const PROCESSED_DIR = path.join(CONVENIOS_DIR, "processed");

const COLLECTION_NAME = "vectores_convenios";
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const GEMINI_BATCH_SIZE = 50;
const FIRESTORE_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 5000;
const MAX_RETRIES = 5;
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "calendario-laboral-252b1";
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const OFFICIAL_SOURCE_HOSTS = [
  "boe.es", "www.boe.es", "bop.diba.cat", "bop.dpz.es", "bopmalaga.es", "www.bopmalaga.es",
  "egoitza.gipuzkoa.eus", "boletin.gipuzkoa.eus", "bon.navarra.es", "www.araba.eus",
];

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GOOGLE_AI_STUDIO_API_KEY ||
  process.env.API_KEY;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
}

const db = admin.firestore();
const embeddingModel = apiKey
  ? new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: EMBEDDING_MODEL })
  : null;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDocType(fileName) {
  return getDocumentType(fileName);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findPdfFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findPdfFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function loadPdfText(buffer) {
  verifyPdfBytes(buffer);
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  const text = (parsed && parsed.text ? parsed.text : "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const pageCount = parsed && (parsed.total || parsed.numpages) ? (parsed.total || parsed.numpages) : null;
  if (!pageCount || pageCount < 1 || !text) throw new Error("El PDF oficial está vacío o no se pudo validar estructuralmente.");
  return {
    text,
    pageCount,
  };
}

async function splitText(text) {
  const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  return splitter.splitText(text);
}

function extractRetryDelayMs(error) {
  const retryInfo = Array.isArray(error && error.errorDetails)
    ? error.errorDetails.find((detail) => detail && detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo")
    : null;

  if (retryInfo && typeof retryInfo.retryDelay === "string") {
    const seconds = parseInt(retryInfo.retryDelay, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  return 60000;
}

async function embedBatch(model, batch, title) {
  let attempt = 0;

  while (true) {
    try {
      const response = await model.batchEmbedContents({
        requests: batch.map((chunk) => ({
          content: {
            parts: [{ text: chunk }],
          },
          taskType: "RETRIEVAL_DOCUMENT",
          title,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      });

      return response.embeddings.map((embedding) => embedding.values);
    } catch (error) {
      const status = error && (error.status || error.code);
      if (String(status) === "429" && attempt < MAX_RETRIES) {
        attempt += 1;
        const waitMs = extractRetryDelayMs(error);
        console.warn(`  ⚠️  Gemini en límite temporal. Reintentando en ${Math.round(waitMs / 1000)}s...`);
        await pause(waitMs);
        continue;
      }

      throw error;
    }
  }
}

async function inspectExistingChunks(fileName, sourceSha256, chunks) {
  const snapshot = await db.collection(COLLECTION_NAME).where("fileName", "==", fileName).get();
  const existingByIndex = new Map();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.sourceSha256 !== sourceSha256) {
      throw new Error(`Ya existen chunks de ${fileName} con checksum distinto o sin checksum; no se modifica ningún registro.`);
    }
    const index = Number(data.chunkIndex);
    if (!Number.isInteger(index) || index < 0 || index >= chunks.length || data.chunkTotal !== chunks.length || data.texto !== chunks[index]) {
      throw new Error(`Los chunks existentes de ${fileName} no coinciden con la fuente actual; se requiere revisión manual.`);
    }
    if (!data.vector || data.embeddingModel !== EMBEDDING_MODEL || data.outputDimensionality !== EMBEDDING_DIMENSIONS) {
      throw new Error(`El chunk ${doc.id} de ${fileName} tiene un embedding ausente o incompatible; no se sobrescribe.`);
    }
    if (existingByIndex.has(index)) throw new Error(`Índice de chunk duplicado para ${fileName}: ${index}`);
    existingByIndex.set(index, doc.id);
  }
  const missing = Array.from({ length: chunks.length }, (_, index) => index).filter((index) => !existingByIndex.has(index));
  if (missing.length) {
    const convenioId = sanitizeId(path.basename(fileName, path.extname(fileName)));
    const refs = missing.map((index) => db.collection(COLLECTION_NAME)
      .doc(`${convenioId}_${String(index + 1).padStart(4, "0")}`));
    const collisions = await db.getAll(...refs);
    const collision = collisions.find((doc) => doc.exists);
    if (collision) throw new Error(`El identificador determinista ${collision.id} ya existe fuera de la consulta por archivo; no se sobrescribe.`);
  }
  return missing;
}

async function writeChunkGroup({
  convenioId,
  fileName,
  docType,
  filePath,
  pageCount,
  sourceStorageUri,
  chunks,
  embeddings,
  sourceSha256,
  totalChunks,
  startIndex,
  chunkIndexes,
  metadata,
}) {
  const writePromises = [];
  const convenioMetadata = metadata || parseConvenioFileName(fileName);

  for (let offset = 0; offset < chunks.length; offset += FIRESTORE_BATCH_SIZE) {
    const writeStart = offset;
    const writeEnd = Math.min(offset + FIRESTORE_BATCH_SIZE, chunks.length);

    writePromises.push((async () => {
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();

      for (let i = writeStart; i < writeEnd; i += 1) {
        const globalIndex = chunkIndexes ? chunkIndexes[i] : startIndex + i;
        const docId = `${convenioId}_${String(globalIndex + 1).padStart(4, "0")}`;
        const docRef = db.collection(COLLECTION_NAME).doc(docId);

        batch.create(docRef, {
          convenioId,
          fileName,
          file_name: fileName,
          doc_type: `staged_${docType}`,
          filePath,
          pageCount,
          province: convenioMetadata.province,
          autonomousCommunity: convenioMetadata.autonomousCommunity,
          sectorKeys: convenioMetadata.sectorKeys,
          catalogKey: convenioMetadata.catalogKey,
          yearStart: convenioMetadata.yearStart,
          yearEnd: convenioMetadata.yearEnd,
          ...(convenioMetadata.officialCode ? { officialCode: convenioMetadata.officialCode } : {}),
          ...(convenioMetadata.publication ? { publication: convenioMetadata.publication } : {}),
          ...(convenioMetadata.legalEffect ? { legalEffect: convenioMetadata.legalEffect } : {}),
          ...(convenioMetadata.sourceVerification ? { sourceVerification: convenioMetadata.sourceVerification } : {}),
          ...(convenioMetadata.automaticIngestionEligible === true ? { automaticIngestionEligible: true } : {}),
          ...(convenioMetadata.sourceEdition ? { sourceEdition: convenioMetadata.sourceEdition } : {}),
          ...(convenioMetadata.sourceUpdatedThrough ? { sourceUpdatedThrough: convenioMetadata.sourceUpdatedThrough } : {}),
          ...(convenioMetadata.sourceValidFrom ? { sourceValidFrom: convenioMetadata.sourceValidFrom } : {}),
          ...(convenioMetadata.sourceValidThrough ? { sourceValidThrough: convenioMetadata.sourceValidThrough } : {}),
          ...(convenioMetadata.economicEffectsFrom ? { economicEffectsFrom: convenioMetadata.economicEffectsFrom } : {}),
          ...(convenioMetadata.economicEffectsExceptions ? { economicEffectsExceptions: convenioMetadata.economicEffectsExceptions } : {}),
          ...(convenioMetadata.officialSourceUrl ? { officialSourceUrl: convenioMetadata.officialSourceUrl } : {}),
          sourceDocumentType: convenioMetadata.sourceDocumentType || classifyOfficialDocument(convenioMetadata.title),
          sourceSha256,
          ...(sourceStorageUri ? { sourceStorageUri } : {}),
          ...(convenioMetadata.sourcePageCount ? { sourcePageCount: convenioMetadata.sourcePageCount } : {}),
          ...(convenioMetadata.sourceDocumentType ? { sourceDocumentType: convenioMetadata.sourceDocumentType } : {}),
          chunkIndex: globalIndex,
          chunkTotal: totalChunks,
          texto: chunks[i],
          vector: admin.firestore.FieldValue.vector(embeddings[i]),
          embeddingModel: EMBEDDING_MODEL,
          outputDimensionality: EMBEDDING_DIMENSIONS,
          chunkSize: 1000,
          chunkOverlap: 200,
          source: "pdf",
          updatedAt: now,
        });
      }

      await batch.commit();
      const writtenIndexes = chunkIndexes ? chunkIndexes.slice(writeStart, writeEnd) : null;
      console.log(`    Firestore: guardados ${writtenIndexes ? writtenIndexes.map((index) => index + 1).join(",") : `${startIndex + writeStart + 1}-${startIndex + writeEnd}`} de ${totalChunks}`);
    })());
  }

  await Promise.all(writePromises);
}

async function upsertCatalogForFileNames(fileNames, sourceDocument = null, metadata = null) {
  const entries = metadata ? [omitUndefinedFields({
    id: metadata.catalogKey, catalogKey: metadata.catalogKey, title: metadata.title,
    province: metadata.province, autonomousCommunity: metadata.autonomousCommunity || null,
    sectorKeys: metadata.sectorKeys, yearStart: metadata.yearStart, yearEnd: metadata.yearEnd,
    fileNames, officialCode: metadata.officialCode, publication: metadata.publication,
    applicationWarning: metadata.applicationWarning, sourceVerification: metadata.sourceVerification,
    automaticIngestionEligible: metadata.automaticIngestionEligible,
    sourceDocumentType: metadata.sourceDocumentType, salaryEvidenceVerifiedThroughYear: metadata.salaryEvidenceVerifiedThroughYear,
    officialSourceUrl: metadata.officialSourceUrl, sourceSha256: metadata.sourceSha256,
    sourceStorageUri: metadata.sourceStorageUri, sourcePageCount: metadata.sourcePageCount,
    sourceValidFrom: metadata.sourceValidFrom, sourceValidThrough: metadata.sourceValidThrough,
    economicEffectsFrom: metadata.economicEffectsFrom,
    economicEffectsExceptions: metadata.economicEffectsExceptions,
  })] : buildCatalogEntriesFromFileNames(fileNames);

  for (const entry of entries) {
    const docRef = db.collection(CATALOGO_CONVENIOS).doc(entry.id || sanitizeId(entry.title));
    const docData = {
      ...entry,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const existing = await docRef.get();
    const current = existing.exists ? existing.data() : {};
    const documentSources = Array.isArray(current.documentSources) ? current.documentSources : [];
    if (sourceDocument) {
      const definedSourceDocument = omitUndefinedFields(sourceDocument);
      if (current.fileNames?.some((name) => !entry.fileNames.includes(name)) ||
          (current.fileNames?.includes(definedSourceDocument.fileName) && current.sourceSha256 && current.sourceSha256 !== definedSourceDocument.sourceSha256)) {
        throw new Error(`La entrada de catálogo ${docRef.id} ya cubre otra edición; se requiere cotejo antes de modificarla.`);
      }
      const previous = documentSources.find((item) => item.fileName === definedSourceDocument.fileName);
      if (previous && previous.sourceSha256 !== definedSourceDocument.sourceSha256) {
        throw new Error(`La fuente del catálogo ${docRef.id} cambió de checksum; se requiere revisión manual.`);
      }
      docData.documentSources = [
        ...documentSources.filter((item) => item.fileName !== definedSourceDocument.fileName),
        definedSourceDocument,
      ];
    }
    await docRef.set(docData, { merge: true });
  }
}

async function upsertNormativeBaseCatalog(fileName, metadata) {
  const id = `normativa_base_${sanitizeId(metadata.officialCode)}_${sanitizeId(metadata.sourceEdition)}`;
  const docRef = db.collection(CATALOGO_CONVENIOS).doc(id);
  const docData = {
    id,
    title: "Estatuto de los Trabajadores — texto consolidado",
    catalogStatus: "normative_base",
    active: false,
    doc_type: "base",
    officialCode: metadata.officialCode,
    sourceEdition: metadata.sourceEdition,
    sourceUpdatedThrough: metadata.sourceUpdatedThrough,
    sourceValidFrom: metadata.sourceValidFrom,
    sourceValidThrough: metadata.sourceValidThrough || null,
    officialSourceUrl: metadata.officialSourceUrl,
    publication: metadata.publication,
    sourceSha256: metadata.sourceSha256,
    sourceStorageUri: metadata.sourceStorageUri,
    sourcePageCount: metadata.sourcePageCount,
    sourceVerification: metadata.sourceVerification,
    fileNames: [fileName],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const existing = await docRef.get();
  if (existing.exists) {
    const current = existing.data();
    if (current.sourceSha256 !== metadata.sourceSha256 || !current.fileNames?.includes(fileName)) {
      throw new Error(`La entrada de catálogo ${id} ya existe con otra fuente; se requiere revisión manual.`);
    }
    return;
  }
  await docRef.create(docData);
}

async function buildProcessedPath(filePath) {
  const fileName = path.basename(filePath);
  const baseName = path.basename(fileName, path.extname(fileName));
  let destination = path.join(PROCESSED_DIR, fileName);
  let counter = 1;

  while (await fileExists(destination)) {
    const suffix = `_${String(counter).padStart(2, "0")}`;
    destination = path.join(PROCESSED_DIR, `${baseName}${suffix}${path.extname(fileName)}`);
    counter += 1;
  }

  return destination;
}

async function moveToProcessed(filePath, destination) {
  await fs.rename(filePath, destination);
}

async function loadVerifiedStoredPdf(sourceStorageUri, expectedSha256) {
  const match = String(sourceStorageUri || "").match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match || match[1] !== STORAGE_BUCKET || !expectedSha256) {
    throw new Error("La ubicación de respaldo oficial no coincide con el bucket privado configurado.");
  }
  const [buffer] = await admin.storage().bucket(match[1]).file(match[2]).download();
  const actual = verifyPdfBytes(buffer).sha256;
  if (actual !== expectedSha256) throw new Error("El objeto del bucket no coincide con el SHA-256 esperado.");
  return buffer;
}

async function verifyStagedKnn(fileName, sourceSha256, docs) {
  const staged = docs.find((doc) => doc.data().doc_type === "staged_especifico" || doc.data().doc_type === "staged_base");
  if (!staged) return;
  const vector = staged.data().vector?.toArray?.();
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) throw new Error("INGESTION_STAGED_KNN_INVALID_VECTOR");
  const matches = await db.collection(COLLECTION_NAME)
    .where("doc_type", "==", staged.data().doc_type)
    .where("file_name", "==", fileName)
    .findNearest({ vectorField: "vector", queryVector: vector, limit: 5, distanceMeasure: "COSINE" }).get();
  if (!matches.docs.some((doc) => doc.id === staged.id && doc.data().sourceSha256 === sourceSha256)) {
    throw new Error("INGESTION_STAGED_KNN_NOT_VERIFIED");
  }
}

async function processFile(filePath, { dryRun = false, metadataOverride = null, keepSource = false, verifiedSourceBuffer = null } = {}) {
  const fileName = path.basename(filePath);
  const docType = getDocType(fileName);
  const metadata = metadataOverride || parseConvenioFileName(fileName);
  if (metadataOverride && (metadataOverride.fileName !== fileName || !/^BOG-\d{4}-\d{2}-\d{2}-\d{14}-[a-z0-9-]+\.pdf$/.test(fileName))) {
    throw new Error("INGESTION_DYNAMIC_METADATA_INVALID");
  }
  console.log(`\n📄 Procesando ${fileName}`);
  console.log(`  - Tipo de documento: ${docType}`);

  let sourceBuffer;
  let sourceSha256;
  let sourceStorageUri = metadata.sourceStorageUri || null;
  if (metadata.sourceStorageUri && metadata.sourceSha256) {
    sourceBuffer = verifiedSourceBuffer || await loadVerifiedStoredPdf(metadata.sourceStorageUri, metadata.sourceSha256);
    sourceSha256 = verifyPdfBytes(sourceBuffer).sha256;
    if (metadata.sourceSha256 !== sourceSha256) throw new Error(`El SHA-256 de ${fileName} no coincide con la fuente oficial verificada.`);
  } else if (metadata.sourceSha256) {
    if (metadata.sourceVerification !== "verified" || !metadata.officialSourceUrl || !metadata.publication?.identifier) {
      throw new Error(`El archivo local de ${fileName} no tiene metadatos oficiales acreditados.`);
    }
    sourceBuffer = await fs.readFile(filePath);
    sourceSha256 = verifyPdfBytes(sourceBuffer).sha256;
    if (metadata.sourceSha256 !== sourceSha256) throw new Error(`El SHA-256 de ${fileName} no coincide con la copia oficial registrada.`);
  } else {
    if (metadata.sourceVerification !== "verified" || !metadata.officialSourceUrl || !metadata.publication?.identifier) {
      throw new Error(`La fuente oficial de ${fileName} no está acreditada; no se generan embeddings.`);
    }
    const officialUrl = new URL(metadata.officialSourceUrl);
    if (/UploadServlet/i.test(officialUrl.pathname) && /(?:^|\\|\/)bop\.pdf$/i.test(officialUrl.searchParams.get("ruta") || "") && !metadata.sourcePageRange) {
      throw new Error("La URL identifica un boletín completo; falta una extracción documental acreditada por páginas.");
    }
    const downloaded = await downloadOfficialPdf(metadata.officialSourceUrl, { allowedHosts: OFFICIAL_SOURCE_HOSTS });
    sourceBuffer = downloaded.buffer;
    sourceSha256 = downloaded.sha256;
  }
  const { text, pageCount } = await loadPdfText(sourceBuffer);
  if (metadata.sourcePageCount && metadata.sourcePageCount !== pageCount) {
    throw new Error(`El número de páginas de ${fileName} no coincide con la fuente oficial verificada.`);
  }
  if (!metadata.sourceStorageUri && !dryRun) {
    const objectName = `official-sources/convenios/${sanitizeId(metadata.catalogKey)}/${sourceSha256}.pdf`;
    sourceStorageUri = await storeOfficialPdf(admin.storage().bucket(STORAGE_BUCKET), objectName, {
      buffer: sourceBuffer,
      sha256: sourceSha256,
      url: metadata.officialSourceUrl,
      publicationIdentifier: metadata.publication.identifier,
    });
  }
  if (!text) {
    console.warn(`⚠️  El PDF ${fileName} no devolvió texto legible.`);
    return { chunks: 0 };
  }
  const chunks = await splitText(text);
  console.log(`  - Texto extraído: ${text.length} caracteres`);
  console.log(`  - Chunks generados: ${chunks.length}`);

  const convenioId = sanitizeId(path.basename(fileName, path.extname(fileName)));
  const isAlreadyProcessed = path.resolve(path.dirname(filePath)) === path.resolve(PROCESSED_DIR);
  const processedPath = keepSource ? sourceStorageUri : isAlreadyProcessed ? filePath : await buildProcessedPath(filePath);
  const missingChunkIndexes = await inspectExistingChunks(fileName, sourceSha256, chunks);
  console.log(`  - Chunks nuevos: ${missingChunkIndexes.length}; embeddings reutilizados: ${chunks.length - missingChunkIndexes.length}`);
  if (dryRun) return { chunks: chunks.length, newChunks: missingChunkIndexes.length, dryRun: true };
  if (missingChunkIndexes.length && (metadata.sourceVerification !== "verified" || !metadata.officialSourceUrl || !metadata.publication?.identifier)) {
    throw new Error(`La fuente oficial de ${fileName} no está acreditada; los chunks nuevos no se activan.`);
  }
  if (missingChunkIndexes.length && (metadata.automaticIngestionEligible !== true || !metadata.officialCode || !metadata.province || !metadata.sectorKeys.length)) {
    throw new Error(`La relación de ${fileName} con el convenio no está aprobada para ingesta automática.`);
  }
  if (missingChunkIndexes.length && chunks.length > MAX_ATOMIC_CHUNKS) {
    throw new Error(`El documento supera el límite de activación atómica (${MAX_ATOMIC_CHUNKS} chunks); no se generan embeddings.`);
  }
  if (missingChunkIndexes.length && !embeddingModel) {
    throw new Error("Se requieren embeddings nuevos, pero no hay API key configurada. No se han escrito chunks.");
  }
  const estimatedTokens = missingChunkIndexes.reduce((total, index) => total + Math.ceil(chunks[index].length / 4), 0);
  const budget = await reserveEmbeddingBudget(db, estimatedTokens);
  console.log(`  - Presupuesto reservado: ~${budget.estimatedTokens} tokens; mes acumulado: ${budget.monthReservedTokens ?? "sin consumo"}`);

  const totalBatches = Math.ceil(missingChunkIndexes.length / GEMINI_BATCH_SIZE);
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const indexes = missingChunkIndexes.slice(batchIndex * GEMINI_BATCH_SIZE, (batchIndex + 1) * GEMINI_BATCH_SIZE);
    const batchChunks = indexes.map((index) => chunks[index]);

    console.log(`  - Procesando lote ${batchIndex + 1} de ${totalBatches} para ${fileName}...`);

    const embeddings = await embedBatch(embeddingModel, batchChunks, fileName);
    if (embeddings.length !== batchChunks.length) {
      throw new Error(`No se pudieron generar todos los embeddings para ${fileName} en el lote ${batchIndex + 1}`);
    }

    await writeChunkGroup({
      convenioId,
      fileName,
      docType,
      filePath: processedPath,
      pageCount,
      sourceStorageUri,
      chunks: batchChunks,
      embeddings,
      sourceSha256,
      totalChunks: chunks.length,
      startIndex: indexes[0],
      chunkIndexes: indexes,
      metadata,
    });

    if (batchIndex < totalBatches - 1) {
      await pause(BATCH_DELAY_MS);
    }
  }

  const stagedSnapshot = await db.collection(COLLECTION_NAME).where("file_name", "==", fileName).get();
  await verifyStagedKnn(fileName, sourceSha256, stagedSnapshot.docs);

  if (docType === "especifico") {
    await upsertCatalogForFileNames([fileName], {
      fileName,
      sourceSha256,
      sourceStorageUri,
      officialSourceUrl: metadata.officialSourceUrl,
      publication: metadata.publication,
      sourcePageCount: pageCount,
      documentType: metadata.sourceDocumentType || classifyOfficialDocument(metadata.title),
      officialCode: metadata.officialCode,
      sourceVerification: metadata.sourceVerification,
      automaticIngestionEligible: metadata.automaticIngestionEligible === true,
      sourceValidFrom: metadata.sourceValidFrom,
      sourceValidThrough: metadata.sourceValidThrough,
      economicEffectsFrom: metadata.economicEffectsFrom,
      economicEffectsExceptions: metadata.economicEffectsExceptions,
    }, metadataOverride);
  } else if (metadata.officialCode === "BOE-A-2015-11430") {
    await upsertNormativeBaseCatalog(fileName, metadata);
  }

  const chunkRefs = stagedSnapshot.docs.map((doc) => doc.ref);
  if (chunks.length <= MAX_ATOMIC_CHUNKS) {
    await activateChunkSet({
      db,
      refs: chunkRefs,
      fileName,
      sourceSha256,
      totalChunks: chunks.length,
      docType,
      embeddingModel: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    });
  }

  if (!isAlreadyProcessed && !keepSource) {
    await moveToProcessed(filePath, processedPath);
    console.log(`  - PDF movido a: ${processedPath}`);
  }

  return { chunks: chunks.length, newChunks: missingChunkIndexes.length };
}

async function main() {
  await ensureDir(INBOX_DIR);
  await ensureDir(PROCESSED_DIR);

  const selectedFileIndex = process.argv.indexOf("--file");
  const dryRun = process.argv.includes("--dry-run");
  const files = selectedFileIndex >= 0
    ? [path.resolve(process.argv[selectedFileIndex + 1] || "")]
    : await findPdfFiles(INBOX_DIR);
  if (selectedFileIndex >= 0 && (!process.argv[selectedFileIndex + 1] || !files[0].toLowerCase().endsWith(".pdf"))) {
    throw new Error("Uso: node ingest-conventios.js --file <ruta-exacta-al-pdf>");
  }

  if (!files.length) {
    console.log(`No hay PDFs en ${INBOX_DIR}. Añade convenios ahí y vuelve a ejecutar.`);
    return;
  }

  let totalFiles = 0;
  let totalChunks = 0;

  for (const filePath of files) {
    const result = await processFile(filePath, { dryRun });
    totalFiles += 1;
    totalChunks += result.chunks;
    console.log(`   - Chunks totales: ${result.chunks}; nuevos en Firestore: ${result.newChunks}`);
  }

  if (dryRun) {
    console.log(`\n✅ Preflight completado sin escribir datos ni generar embeddings.`);
    return;
  }
  console.log(`\n✅ Ingesta completada.`);
  console.log(`   - PDFs procesados: ${totalFiles}`);
  console.log(`   - Chunks almacenados: ${totalChunks}`);
  console.log(`   - Colección destino: ${COLLECTION_NAME}`);
}

if (require.main === module) main().catch((error) => {
  console.error("❌ Error durante la ingesta de convenios:");
  console.error(error);
  process.exitCode = 1;
});

module.exports = { loadPdfText, processFile };
