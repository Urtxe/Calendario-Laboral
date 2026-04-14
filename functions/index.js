const { onRequest } = require("firebase-functions/v2/https");
// Forzamos la carga de la versión 1 específicamente para el disparador de usuario
const functionsV1 = require("firebase-functions/v1"); 
const admin = require("firebase-admin");
require("dotenv").config({ path: __dirname + "/.env" });

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const stripe = require("stripe")(stripeSecretKey);

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// 1. WEBHOOK DE STRIPE (V2)
exports.stripeWebhook = onRequest({ cors: true }, async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        if (!stripeSecretKey || !webhookSecret) {
            console.error("Stripe no está configurado: faltan STRIPE_SECRET_KEY o STRIPE_WEBHOOK_SECRET");
            return res.status(500).send("Stripe not configured");
        }
        event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
        console.error("❌ Error de firma:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.client_reference_id; 
        const customerId = session.customer;

        if (userId) {
            await db.collection("usuarios").doc(userId).set({
                tipoCuenta: "premium",
                stripeCustomerId: customerId
            }, { merge: true });
            console.log(`✅ Usuario ${userId} activado como PREMIUM`);
        }
    }

    if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const userQuery = await db.collection("usuarios")
            .where("stripeCustomerId", "==", customerId)
            .limit(1).get();

        if (!userQuery.empty) {
            await userQuery.docs[0].ref.set({ tipoCuenta: "free" }, { merge: true });
            console.log(`ℹ️ Suscripción cancelada para el cliente ${customerId}`);
        }
    }

    res.json({ received: true });
});

// 2. LIMPIEZA AL BORRAR USUARIO (Usando la ruta V1 explícita)
exports.limpiarDatosAlBorrarUsuario = functionsV1.auth.user().onDelete(async (user) => {
    const uid = user.uid;
    console.log(`🗑️ Borrando datos de Firestore para el UID: ${uid}`);

    const userRef = db.collection('usuarios').doc(uid);
    const yearsSnap = await userRef.collection('years').get();
    const deletes = [];

    yearsSnap.forEach((doc) => deletes.push(doc.ref.delete()));

    await Promise.all(deletes);

    await userRef.delete();
    console.log(`✅ Datos del usuario ${uid} borrados correctamente.`);
});
