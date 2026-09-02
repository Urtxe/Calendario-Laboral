const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const project = process.env.GCLOUD_PROJECT || "calendario-laboral-252b1";
const region = "us-central1";
const functionName = "metricasGa4";
const secretName = "GA4_PROPERTY_ID";
const runtimeServiceAccount = "130172535764-compute@developer.gserviceaccount.com";

function gcloudJson(args) {
    return JSON.parse(execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
}

function gcloudText(args) {
    return execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const functionConfig = gcloudJson(["functions", "describe", functionName, "--gen2", "--region", region, "--project", project, "--format=json"]);
assert.equal(functionConfig.state, "ACTIVE", "metricasGa4 no está activa");
const functionSecret = (functionConfig.serviceConfig.secretEnvironmentVariables || []).find((item) => item.key === secretName);
assert(functionSecret, "La configuración efectiva de Functions no declara GA4_PROPERTY_ID");
assert.equal(functionSecret.secret, secretName, "GA4_PROPERTY_ID no enlaza con el secreto esperado");
assert(functionSecret.version === "latest" || /^\d+$/.test(functionSecret.version), "La versión del secreto no es válida");

const service = gcloudJson(["run", "services", "describe", "metricasga4", "--region", region, "--project", project, "--format=json"]);
const traffic = (service.status.traffic || []).find((item) => item.percent === 100);
assert(traffic && traffic.revisionName, "No hay una revisión de Cloud Run con el 100% del tráfico");
const revision = gcloudJson(["run", "revisions", "describe", traffic.revisionName, "--region", region, "--project", project, "--format=json"]);
const runtimeSecret = (revision.spec.containers[0].env || []).find((item) => item.name === secretName);
assert(runtimeSecret && runtimeSecret.valueFrom && runtimeSecret.valueFrom.secretKeyRef, "La revisión activa no inyecta GA4_PROPERTY_ID como secretKeyRef");
assert.equal(runtimeSecret.value, undefined, "GA4_PROPERTY_ID no debe tener un valor literal en Cloud Run");
assert.equal(revision.spec.serviceAccountName, runtimeServiceAccount, "La revisión activa usa una cuenta de ejecución inesperada");

const version = functionSecret.version === "latest" ? "latest" : functionSecret.version;
const versionState = gcloudText(["secrets", "versions", "describe", version, "--secret", secretName, "--project", project, "--format=value(state)"]);
assert.equal(versionState.toUpperCase(), "ENABLED", "La versión de GA4_PROPERTY_ID no está habilitada");
const secretValue = gcloudText(["secrets", "versions", "access", version, "--secret", secretName, "--project", project]);
assert(/^\d{6,}$/.test(secretValue), "GA4_PROPERTY_ID no contiene un ID numérico completo");

const policy = gcloudJson(["secrets", "get-iam-policy", secretName, "--project", project, "--format=json"]);
const hasAccessor = (policy.bindings || []).some((binding) => binding.role === "roles/secretmanager.secretAccessor" && (binding.members || []).includes(`serviceAccount:${runtimeServiceAccount}`));
assert(hasAccessor, "La cuenta de ejecución no tiene roles/secretmanager.secretAccessor para GA4_PROPERTY_ID");

console.log(`OK metricasGa4: ${traffic.revisionName} recibe el 100% del tráfico con GA4_PROPERTY_ID inyectado mediante secretKeyRef.`);
