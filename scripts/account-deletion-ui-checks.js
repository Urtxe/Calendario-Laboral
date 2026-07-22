const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const ui = fs.readFileSync(path.join(repoRoot, "src/js/app/ui.js"), "utf8");
const legacy = fs.readFileSync(path.join(repoRoot, "src/js/script.js"), "utf8");
const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const firebaseJson = fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8");

assert.match(ui, /fetch\("\/deleteAccount"/);
assert.match(ui, /reauthenticateWithPopup/);
assert.match(ui, /reauthenticateWithCredential/);
assert.match(ui, /account-delete-status/);
assert.match(ui, /Las facturas o registros que Stripe deba conservar/);
assert.doesNotMatch(ui, /user\s*\.\s*delete\s*\(/);
assert.doesNotMatch(legacy, /user\s*\.\s*delete\s*\(/);
assert.match(index, /data-account-delete-action/);
assert.match(firebaseJson, /"source": "\/deleteAccount"/);

console.log("OK  El cliente usa el endpoint protegido, reautentica y muestra estado de borrado.");
