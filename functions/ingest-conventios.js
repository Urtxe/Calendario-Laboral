const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");
const { PDFParse } = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  CATALOGO_CONVENIOS,
  buildCatalogEntriesFromFileNames,
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

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GOOGLE_AI_STUDIO_API_KEY ||
  process.env.API_KEY;

if (!apiKey) {
  throw new Error(
    "Falta la API key de Gemini. Define GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY o GOOGLE_AI_STUDIO_API_KEY en functions/.env"
  );
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(apiKey);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDocType(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName)).toLowerCase();
  return baseName === "estatuto_trabajadores" ? "base" : "especifico";
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

async function loadPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  const text = (parsed && parsed.text ? parsed.text : "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    pageCount: parsed && parsed.numpages ? parsed.numpages : null,
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

async function deleteExistingChunksForFileName(fileName) {
  const snapshot = await db.collection(COLLECTION_NAME).where("fileName", "==", fileName).get();

  if (snapshot.empty) {
    console.log(`  - No hay chunks previos para ${fileName}`);
    return 0;
  }

  let deleted = 0;
  const docs = snapshot.docs;

  for (let offset = 0; offset < docs.length; offset += 450) {
    const batch = db.batch();
    const slice = docs.slice(offset, offset + 450);

    for (const doc of slice) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    deleted += slice.length;
  }

  console.log(`  - Eliminados ${deleted} chunks previos de ${fileName}`);
  return deleted;
}

async function writeChunkGroup({
  convenioId,
  fileName,
  docType,
  filePath,
  pageCount,
  chunks,
  embeddings,
  totalChunks,
  startIndex,
}) {
  const writePromises = [];
  const convenioMetadata = parseConvenioFileName(fileName);

  for (let offset = 0; offset < chunks.length; offset += FIRESTORE_BATCH_SIZE) {
    const writeStart = offset;
    const writeEnd = Math.min(offset + FIRESTORE_BATCH_SIZE, chunks.length);

    writePromises.push((async () => {
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();

      for (let i = writeStart; i < writeEnd; i += 1) {
        const globalIndex = startIndex + i;
        const docId = `${convenioId}_${String(globalIndex + 1).padStart(4, "0")}`;
        const docRef = db.collection(COLLECTION_NAME).doc(docId);

        batch.set(docRef, {
          convenioId,
          fileName,
          file_name: fileName,
          doc_type: docType,
          filePath,
          pageCount,
          province: convenioMetadata.province,
          autonomousCommunity: convenioMetadata.autonomousCommunity,
          sectorKeys: convenioMetadata.sectorKeys,
          catalogKey: convenioMetadata.catalogKey,
          yearStart: convenioMetadata.yearStart,
          yearEnd: convenioMetadata.yearEnd,
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
      console.log(`    Firestore: guardados chunks ${startIndex + writeStart + 1}-${startIndex + writeEnd} de ${totalChunks}`);
    })());
  }

  await Promise.all(writePromises);
}

async function upsertCatalogForFileNames(fileNames) {
  const entries = buildCatalogEntriesFromFileNames(fileNames);

  for (const entry of entries) {
    const docRef = db.collection(CATALOGO_CONVENIOS).doc(entry.id || sanitizeId(entry.title));
    await docRef.set({
      ...entry,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
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

async function processFile(filePath) {
  const fileName = path.basename(filePath);
  const docType = getDocType(fileName);
  console.log(`\n📄 Procesando ${fileName}`);
  console.log(`  - Tipo de documento: ${docType}`);

  const { text, pageCount } = await loadPdfText(filePath);
  if (!text) {
    console.warn(`⚠️  El PDF ${fileName} no devolvió texto legible.`);
    return { chunks: 0 };
  }

  const chunks = await splitText(text);
  console.log(`  - Texto extraído: ${text.length} caracteres`);
  console.log(`  - Chunks generados: ${chunks.length}`);

  const totalBatches = Math.ceil(chunks.length / GEMINI_BATCH_SIZE);
  const convenioId = sanitizeId(path.basename(fileName, path.extname(fileName)));
  const processedPath = await buildProcessedPath(filePath);

  await deleteExistingChunksForFileName(fileName);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const start = batchIndex * GEMINI_BATCH_SIZE;
    const end = Math.min(start + GEMINI_BATCH_SIZE, chunks.length);
    const batchChunks = chunks.slice(start, end);

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
      chunks: batchChunks,
      embeddings,
      totalChunks: chunks.length,
      startIndex: start,
    });

    if (batchIndex < totalBatches - 1) {
      await pause(BATCH_DELAY_MS);
    }
  }

  if (docType === "especifico") {
    await upsertCatalogForFileNames([fileName]);
  }

  await moveToProcessed(filePath, processedPath);
  console.log(`  - PDF movido a: ${processedPath}`);

  return { chunks: chunks.length };
}

async function main() {
  await ensureDir(INBOX_DIR);
  await ensureDir(PROCESSED_DIR);

  const files = await findPdfFiles(INBOX_DIR);

  if (!files.length) {
    console.log(`No hay PDFs en ${INBOX_DIR}. Añade convenios ahí y vuelve a ejecutar.`);
    return;
  }

  let totalFiles = 0;
  let totalChunks = 0;

  for (const filePath of files) {
    const result = await processFile(filePath);
    totalFiles += 1;
    totalChunks += result.chunks;
  }

  console.log(`\n✅ Ingesta completada.`);
  console.log(`   - PDFs procesados: ${totalFiles}`);
  console.log(`   - Chunks almacenados: ${totalChunks}`);
  console.log(`   - Colección destino: ${COLLECTION_NAME}`);
}

main().catch((error) => {
  console.error("❌ Error durante la ingesta de convenios:");
  console.error(error);
  process.exitCode = 1;
});
