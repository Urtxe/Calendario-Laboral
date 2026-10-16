"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { loadClaims, validateClaims, publishableClaims, officialUrl } = require("./seo-convenio-claims");

const ROOT = path.join(__dirname, "..");
const SEO_DIR = path.join(ROOT, "seo");
const data = loadClaims();
const pilot = Object.keys(data.convenios);

test("el esquema exige evidencia trazable para toda afirmación verificada", () => {
  assert.equal(pilot.length, 2);
  const invalid = structuredClone(data);
  invalid.convenios[pilot[0]][0].referencia = null;
  assert.throws(() => validateClaims(invalid), /evidencia oficial completa/);
  const noText = structuredClone(data);
  noText.convenios[pilot[0]][0].evidenciaTextual = "";
  assert.throws(() => validateClaims(noText), /evidencia oficial completa/);
  const badCorrection = structuredClone(data);
  badCorrection.convenios["limpieza-barcelona"].find((claim) => claim.correccionOficial).correccionOficial.url = "https://example.com/correction.pdf";
  assert.throws(() => validateClaims(badCorrection), /Corrección oficial incompleta/);
  assert.equal(officialUrl("https://egoitza.gipuzkoa.eus.ejemplo.com/falso.pdf"), false);
  assert.equal(officialUrl("http://egoitza.gipuzkoa.eus/falso.pdf"), false);
  assert.equal(officialUrl("https://egoitza.gipuzkoa.eus/es/bog"), false);
});

test("pendientes y contradicciones nunca se publican", () => {
  const claims = structuredClone(data.convenios[pilot[0]]);
  assert.equal(publishableClaims(claims).length, claims.filter((claim) => claim.estado === "verificada").length);
  claims.push({ ...claims[0], id: "otra", materia: "revision_salarial", estado: "contradictoria" });
  assert.ok(!publishableClaims(claims).some((claim) => claim.materia === "revision_salarial"));
});

test("el generador piloto conserva las demás páginas y alinea HTML, metadatos y JSON-LD", () => {
  const otherPages = fs.readdirSync(SEO_DIR).filter((name) => name.endsWith(".html") && name !== "convenios.html" && !pilot.some((slug) => name === `${slug}.html`));
  const hash = (name) => crypto.createHash("sha256").update(fs.readFileSync(path.join(SEO_DIR, name))).digest("hex");
  const before = new Map(otherPages.map((name) => [name, hash(name)]));
  execFileSync(process.execPath, [path.join(__dirname, "generate-seo-convenios.js"), "--pilot"], { cwd: ROOT, timeout: 180000 });
  for (const [name, prior] of before) assert.equal(hash(name), prior, `${name} cambió`);
  const listing = fs.readFileSync(path.join(SEO_DIR, "convenios.html"), "utf8");
  const inventory = JSON.parse(fs.readFileSync(path.join(SEO_DIR, "data/convenios.generated.json"), "utf8"));
  assert.equal(inventory.summary.verifiedPilots, 2);
  assert.equal(inventory.generated.length, 28);
  for (const entry of inventory.generated.filter((item) => pilot.includes(item.slug))) {
    assert.equal(entry.claims.length, data.convenios[entry.slug].filter((claim) => claim.estado === "verificada").length);
    assert.ok(!("autoCandidates" in entry) && !("content" in entry) && !("source" in entry));
  }
  assert.match(listing, /Convenio de restauración de Gipuzkoa/);
  assert.match(listing, /Convenio de limpieza de edificios y locales de Cataluña \(Barcelona\)/);
  assert.doesNotMatch(listing, /Jornada anual localizada en el texto: 1\.708 horas|Vacaciones localizadas en el texto: 31 días naturales/);

  for (const slug of pilot) {
    const html = fs.readFileSync(path.join(SEO_DIR, `${slug}.html`), "utf8");
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
    const webpage = schema["@graph"].find((item) => item["@type"] === "WebPage");
    const description = html.match(/<meta name="description" content="([^"]+)">/)[1];
    const canonical = `https://balancelaboral.es/convenios/${slug}`;
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
    assert.equal(webpage.url, canonical);
    assert.equal(webpage.description, description);
    assert.ok(!schema["@graph"].some((item) => item["@type"] === "FAQPage"));
    assert.doesNotMatch(html, /No he podido extraer|No localizado en el texto|Resumen con vigencia|Jornada anual localizada en el texto/);
    assert.ok(html.indexOf("Empezar a registrar horas") < html.indexOf('id="horas-extra"'));
    for (const claim of data.convenios[slug]) {
      if (claim.estado === "verificada") {
        assert.ok(html.includes(claim.texto));
        assert.ok(html.includes(`href="${claim.documentoOficial.url.replace(/&/g, "&amp;")}"`));
        assert.ok(webpage.citation.includes(claim.documentoOficial.url));
        if (claim.correccionOficial) {
          assert.ok(html.includes(claim.correccionOficial.url.replace(/&/g, "&amp;")));
          assert.ok(webpage.citation.includes(claim.correccionOficial.url));
        }
      } else {
        assert.ok(!html.includes(claim.texto));
      }
    }
  }
});
