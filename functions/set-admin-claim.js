#!/usr/bin/env node
// Uso restringido a operadores con credenciales ADC y permisos Firebase Auth:
// node set-admin-claim.js administrador@dominio.es
const admin = require("firebase-admin");

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("Indica el email de la cuenta que recibirá el claim admin.");
}

admin.initializeApp();
admin.auth().getUserByEmail(email)
    .then((user) => admin.auth().setCustomUserClaims(user.uid, { ...user.customClaims, admin: true }))
    .then(() => console.log("Claim admin asignado. La persona debe cerrar sesión y volver a entrar."));
