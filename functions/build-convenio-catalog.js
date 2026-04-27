const admin = require("firebase-admin");
require("dotenv").config({ path: __dirname + "/.env" });

const {
  CATALOGO_CONVENIOS,
  buildCatalogEntriesFromFileNames,
} = require("./convenio-metadata");

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "calendario-laboral-252b1";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const COLLECTION_VECTORES = "vectores_convenios";

async function cargarFileNamesUnicos() {
  const snapshot = await db
    .collection(COLLECTION_VECTORES)
    .where("doc_type", "==", "especifico")
    .select("file_name", "fileName")
    .get();

  const fileNames = new Set();
  snapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const fileName = data.file_name || data.fileName;
    if (fileName) {
      fileNames.add(fileName);
    }
  });

  return Array.from(fileNames);
}

async function guardarCatalogo(entries) {
  for (const entry of entries) {
    await db.collection(CATALOGO_CONVENIOS).doc(entry.id).set({
      ...entry,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function main() {
  const fileNames = await cargarFileNamesUnicos();
  if (!fileNames.length) {
    console.log("No se han encontrado convenios específicos para construir el catálogo.");
    return;
  }

  const entries = buildCatalogEntriesFromFileNames(fileNames);
  await guardarCatalogo(entries);

  console.log(`Catalogo reconstruido con ${entries.length} entradas a partir de ${fileNames.length} PDFs.`);
}

main().catch((error) => {
  console.error("Error reconstruyendo el catalogo de convenios:", error);
  process.exitCode = 1;
});
