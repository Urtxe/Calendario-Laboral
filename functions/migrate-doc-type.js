const path = require("path");
const admin = require("firebase-admin");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "calendario-laboral-252b1";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const COLLECTION_NAME = "vectores_convenios";

async function main() {
  const snapshot = await db.collection(COLLECTION_NAME).get();

  if (snapshot.empty) {
    console.log(`No hay documentos en ${COLLECTION_NAME}.`);
    return;
  }

  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    if (data.doc_type != null) {
      if (data.file_name == null && data.fileName) {
        await doc.ref.update({ file_name: data.fileName });
        updated += 1;
      }
      continue;
    }

    await doc.ref.update({
      doc_type: "especifico",
      file_name: data.fileName || data.file_name || null,
    });
    updated += 1;
  }

  console.log(`Migración completada. Documentos actualizados: ${updated}`);
}

main().catch((error) => {
  console.error("Error durante la migración de doc_type:");
  console.error(error);
  process.exitCode = 1;
});
