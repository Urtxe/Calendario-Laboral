const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");
const pdfParseModule = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const pdfParse = pdfParseModule.default || pdfParseModule;
const CONVENIOS_DIR = path.join(__dirname, "convenios");
const COLLECTION_NAME = "vectores_convenios";
const EMBEDDING_MODEL = "text-embedding-004";
const BATCH_SIZE = 16;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

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
  admin.initializeApp();
}

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(apiKey);

function sanitizeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "convenio";
}

async function findPdfFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findPdfFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function loadPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const rawText = (parsed && parsed.text ? parsed.text : "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: rawText,
    pageCount: parsed && parsed.numpages ? parsed.numpages : null,
  };
}

async function splitText(text) {
  const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  return splitter.splitText(text);
}

async function embedChunks(model, chunks, title) {
  const embeddings = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const response = await model.batchEmbedContents({
      requests: batch.map((chunk) => ({
        content: {
          parts: [{ text: chunk }],
        },
        taskType: "RETRIEVAL_DOCUMENT",
        title,
      })),
    });

    response.embeddings.forEach((embedding) => {
      embeddings.push(embedding.values);
    });
  }

  return embeddings;
}

async function saveChunks({
  fileName,
  filePath,
  pageCount,
  chunks,
  embeddings,
}) {
  const convenioId = sanitizeId(path.basename(fileName, path.extname(fileName)));

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  chunks.forEach((chunk, index) => {
    const docId = `${convenioId}_${String(index + 1).padStart(4, "0")}`;
    const docRef = db.collection(COLLECTION_NAME).doc(docId);

    batch.set(docRef, {
      convenioId,
      fileName,
      filePath,
      pageCount,
      chunkIndex: index,
      chunkTotal: chunks.length,
      texto: chunk,
      vector: admin.firestore.FieldValue.vector(embeddings[index]),
      embeddingModel: EMBEDDING_MODEL,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
      source: "pdf",
      updatedAt: now,
    });
  });

  await batch.commit();
}

async function processFile(model, filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n📄 Procesando ${fileName}`);

  const { text, pageCount } = await loadPdfText(filePath);
  if (!text) {
    console.warn(`⚠️  El PDF ${fileName} no devolvió texto legible.`);
    return { chunks: 0 };
  }

  const chunks = await splitText(text);
  console.log(`  - Texto extraído: ${text.length} caracteres`);
  console.log(`  - Chunks generados: ${chunks.length}`);

  const embeddings = await embedChunks(model, chunks, fileName);
  if (embeddings.length !== chunks.length) {
    throw new Error(`No se pudieron generar todos los embeddings para ${fileName}`);
  }

  await saveChunks({
    fileName,
    filePath,
    pageCount,
    chunks,
    embeddings,
  });

  return { chunks: chunks.length };
}

async function main() {
  const files = await findPdfFiles(CONVENIOS_DIR);

  if (!files.length) {
    console.log(`No hay PDFs en ${CONVENIOS_DIR}. Añade convenios y vuelve a ejecutar.`);
    return;
  }

  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  let totalFiles = 0;
  let totalChunks = 0;

  for (const filePath of files) {
    const result = await processFile(model, filePath);
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
