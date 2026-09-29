"use strict";

const { PDFParse } = require("pdf-parse");
const { URLS, parseOfficial, parseBilbaoLocal, discoverBilbaoLocal, discoverBarcelonaLocal, discoverEuskadiCalendar, parseEuskadiCalendar, parseMalaga, parseCataloniaJson, discoverPublication, discoverYearSection, discoverSevillaProposals, discoverAndaluciaLocal, parseSevillaDefinitive, parseMadrid, parseAragonPdf, parseNavarraLocal, parseZaragozaLocal, dogvSignature, dogvPdfUrl, parseValenciaLocalPdf } = require("./holidays-sources");

const PROJECT_ID = "calendario-laboral-252b1";
const CITIES = ["Donostia", "Bilbao", "Gasteiz", "Iruña", "Madrid", "Barcelona", "Zaragoza", "Valencia", "Sevilla", "Malaga"];
const MAX_BYTES = 3_000_000;

async function readUrl(url, format, fetcher = fetch) {
  const largePdf = new URL(url).hostname === "www.sevilla.org" && format === "pdf";
  const maxBytes = largePdf ? 15_000_000 : MAX_BYTES;
  const response = await fetcher(url, { method: "GET", signal: AbortSignal.timeout(largePdf ? 45000 : 15000), headers: { Accept: format === "pdf" ? "application/pdf" : format === "json" ? "application/json" : "text/html" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).host}`);
  const type = response.headers.get("content-type") || "";
  if (!(format === "pdf" ? /application\/pdf/i : format === "json" ? /application\/json/i : /text\/html/i).test(type)) throw new Error(`Content-Type inesperado: ${type}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error(`Respuesta supera ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (format === "pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      if (largePdf) {
        const first = await parser.getText({ first: 10 });
        if (first.total > 150) throw new Error("PDF municipal demasiado extenso");
        let text = first.text;
        for (let page = 11; page <= first.total; page += 10) text += (await parser.getText({ partial: Array.from({ length: Math.min(10, first.total - page + 1) }, (_, offset) => page + offset) })).text;
        if (text.trim().length < 100) throw new Error("PDF sin texto extraíble; OCR no soportado");
        return text;
      }
      const result = await parser.getText();
      if (!result.text || result.text.trim().length < 100) throw new Error("PDF sin texto extraíble; OCR no soportado");
      return result.text;
    } finally { await parser.destroy(); }
  }
  const charset = type.match(/charset\s*=\s*([^;\s]+)/i)?.[1] || (new URL(url).hostname === "www.lexnavarra.navarra.es" ? "windows-1252" : "utf-8");
  const body = new TextDecoder(charset).decode(bytes);
  return format === "json" ? JSON.parse(body) : body;
}

function normalize(dates, year) {
  if (!Array.isArray(dates)) throw new Error("Se esperaba un array de fechas");
  const found = new Set();
  for (const value of dates) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !value.startsWith(`${year}-`)) throw new Error(`Fecha o año inválido: ${value}`);
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`Fecha imposible: ${value}`);
    found.add(value);
  }
  return [...found].sort();
}

function compare(source, stored, year) {
  if (source.status === "error") return { result: "ERROR", reason: source.reason };
  if (source.status === "unsupported") return { result: "UNSUPPORTED", reason: source.reason };
  if (source.status === "pending") return { result: "PENDING", reason: source.reason };
  if (source.status === "partial") return { result: "PARTIAL", reason: source.reason };
  if (stored !== null && (!stored || !Array.isArray(stored.fechas))) return { result: "ERROR", reason: "Firestore: falta el array fechas" };
  let current;
  try { current = stored === null ? [] : normalize(stored.fechas, year); }
  catch (error) { return { result: "ERROR", reason: `Firestore: ${error.message}` }; }
  const a = new Set(source.dates);
  const b = new Set(current);
  const missingInFirestore = source.dates.filter(date => !b.has(date));
  const extraInFirestore = current.filter(date => !a.has(date));
  return { result: missingInFirestore.length || extraInFirestore.length ? "DIFFERENT" : "MATCH", missingInFirestore, extraInFirestore };
}

async function collect(year, read = readUrl) {
  const rows = Object.fromEntries(CITIES.map(city => [city, { city, year, status: "pending", dates: [], sources: [], reason: "Sin publicación oficial comprobada" }]));
  const cache = new Map();
  async function get(key, format = "html") {
    const url = URLS[key];
    if (!cache.has(url)) cache.set(url, read(url, format));
    return cache.get(url);
  }
  function apply(cities, groups, needed, reason, sourceAuthority = "pending") {
    const dates = normalize(groups.flatMap(group => group.dates), year);
    if (dates.length !== groups.reduce((sum, group) => sum + group.dates.length, 0)) throw new Error(`Fechas solapadas: ${cities.join(", ")}`);
    for (const city of cities) rows[city] = { city, year, status: needed.length ? dates.length ? "partial" : "pending" : "complete", dates, sources: groups.map(group => group.url), sourceAuthority: needed.length ? "pending" : sourceAuthority, reason: needed.length ? `${reason}: ${needed.join(", ")}` : null };
  }
  async function attempt(cities, action) {
    try { await action(); }
    catch (error) { for (const city of cities) rows[city] = { city, year, status: "error", dates: [], sources: [], reason: error.message }; }
  }

  let euskadiGeneralUrl;
  let euskadiIndex;
  await attempt(["Donostia", "Bilbao", "Gasteiz"], async () => {
    euskadiIndex = await get("euskadiIndex");
    euskadiGeneralUrl = discoverEuskadiCalendar(euskadiIndex, year, "general");
    if (!euskadiGeneralUrl) return;
    const dates = parseEuskadiCalendar(await read(euskadiGeneralUrl, "pdf"), year, "general");
    apply(["Donostia", "Bilbao", "Gasteiz"], [{ dates, url: euskadiGeneralUrl }], ["dos fiestas locales por municipio"], "Publicación parcial");
  });
  for (const [city, territory] of [["Donostia", "donostia"], ["Gasteiz", "gasteiz"]]) {
    if (rows[city].status !== "partial") continue;
    await attempt([city], async () => {
      const pdfUrl = discoverEuskadiCalendar(euskadiIndex, year, territory);
      if (!pdfUrl) return;
      const dates = parseEuskadiCalendar(await read(pdfUrl, "pdf"), year, territory);
      apply([city], [{ dates: rows[city].dates, url: euskadiGeneralUrl }, { dates, url: pdfUrl }], [], "", "definitive");
    });
  }
    if (rows.Bilbao.status === "partial") await attempt(["Bilbao"], async () => {
      const index = new URL(URLS.bilbaoIndex);
      index.searchParams.set("p_p_id", "IYBIWBCC");
      index.searchParams.set("p_p_lifecycle", "0");
      index.searchParams.set("_IYBIWBCC_mvcRenderCommandName", "/search/filtros");
      index.searchParams.set("_IYBIWBCC_text", `Calendario de Fiestas Locales del Territorio Histórico de Bizkaia para el año ${year}`);
      let pdfUrl = discoverBilbaoLocal(await read(index.href, "html"), year);
      // ponytail: BOB alterna respuestas vacías y válidas; un segundo intento basta como límite, hasta disponer de un índice estable.
      if (!pdfUrl) pdfUrl = discoverBilbaoLocal(await read(index.href, "html"), year);
      if (!pdfUrl) return;
      const dates = parseBilbaoLocal(await read(pdfUrl, "pdf"), year);
      apply(["Bilbao"], [{ dates: rows.Bilbao.dates, url: euskadiGeneralUrl }, { dates, url: pdfUrl }], [], "", "definitive");
    });
    await attempt(["Iruña"], async () => {
      const index = await get("navarraIndex");
      let generalUrl = discoverPublication(index, year, URLS.navarraIndex, /calendario oficial de fiestas laborales/i, ["www.lexnavarra.navarra.es"]);
      // ponytail: BON 2027 aún no figura en el índice consolidado; retirar este respaldo cuando aparezca allí.
      if (!generalUrl && year === 2027) generalUrl = URLS.navarra;
      if (!generalUrl) return;
      const general = parseOfficial("navarra", await read(generalUrl, "html"), year);
      const localUrl = discoverPublication(index, year, URLS.navarraIndex, /fiestas locales/i, ["www.lexnavarra.navarra.es"]);
      const local = localUrl ? parseNavarraLocal(await read(localUrl, "html"), year) : [];
      apply(["Iruña"], [{ dates: general, url: generalUrl }, ...(local.length ? [{ dates: local, url: localUrl }] : [])], local.length ? [] : ["una fiesta municipal"], "Publicación parcial", local.length ? "definitive" : "pending");
    });
    await attempt(["Zaragoza"], async () => {
      const index = await get("aragonIndex");
      const generalUrl = discoverPublication(index, year, URLS.aragonIndex, new RegExp(`Decreto.*fiestas labora(?:les|bles).*para el año ${year} en la Comunidad Autónoma de Aragón`, "i"), ["www.boa.aragon.es"]);
      if (!generalUrl) return;
      const general = parseAragonPdf(await read(generalUrl, "pdf"), year);
      const localUrl = discoverPublication(index, year, URLS.aragonIndex, new RegExp(`^Fiestas locales para el año ${year} en los municipios`, "i"), ["www.boa.aragon.es"]);
      const local = localUrl ? parseZaragozaLocal(await read(localUrl, "pdf"), year) : [];
      apply(["Zaragoza"], [{ dates: general, url: generalUrl }, ...(local.length ? [{ dates: local, url: localUrl }] : [])], local.length ? [] : ["dos fiestas locales"], "Publicación parcial", local.length ? "definitive" : "pending");
    });
    await attempt(["Valencia"], async () => {
      const index = await get("valenciaIndex");
      const publication = discoverYearSection(index, year, URLS.valenciaIndex, /calendario laboral/i, /DECRETO/i, ["dogv.gva.es"]);
      if (!publication) return;
      async function pdfOf(url) {
        const signature = dogvSignature(url);
        const id = await read(`https://dogv.gva.es/dogv-portal/dogv/obtenerIdDogv/${signature.replace("/", "-")}`, "json");
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error("DOGV: identificador inesperado");
        const disposition = await read(`https://dogv.gva.es/dogv-portal/disposicion/${id}?lang=es_es`, "json");
        return read(dogvPdfUrl(url, disposition), "pdf");
      }
      const general = parseOfficial("valenciaGeneral", await pdfOf(publication), year);
      const localPublication = discoverYearSection(index, year, URLS.valenciaIndex, /calendario laboral/i, /^RESOLUCI[ÓO]N\b.*por la que se aprueba el calendario de fiestas locales/i, ["dogv.gva.es"]);
      let local = [];
      let localUrl = localPublication;
      let authority = "definitive";
      if (localPublication) local = parseValenciaLocalPdf(await pdfOf(localPublication), year);
      else if (year === 2027) {
        localUrl = URLS.valenciaLocal;
        local = parseOfficial("valenciaLocal", await read(localUrl, "html"), year);
        authority = "official_municipal";
      }
      apply(["Valencia"], [{ dates: general, url: publication }, ...(local.length ? [{ dates: local, url: localUrl }] : [])], local.length ? [] : ["dos fiestas locales"], "Publicación parcial", local.length ? authority : "pending");
    });
    await attempt(["Sevilla"], async () => {
      const index = await get("andaluciaIndex");
      const generalUrl = discoverYearSection(index, year, URLS.andaluciaIndex, /año/i, /Decreto/i, ["www.juntadeandalucia.es"]);
      if (!generalUrl) return;
      const general = parseOfficial("andalucia", await read(generalUrl, "html"), year);
      const definitiveUrl = discoverAndaluciaLocal(index, year);
      if (definitiveUrl) {
        const local = parseSevillaDefinitive(await read(definitiveUrl, "html"), year);
        apply(["Sevilla"], [{ dates: general, url: generalUrl }, { dates: local, url: definitiveUrl }], [], "", "definitive");
        return;
      }
      const archive = discoverPublication(await get("sevillaIndex"), year - 1, URLS.sevillaIndex, /Más información/i, ["www.sevilla.org"]);
      let localUrl = null;
      let local = [];
      if (archive) for (const candidate of discoverSevillaProposals(await read(archive, "html"), archive, year)) {
        const content = await read(candidate, "pdf");
        if (!content.replace(/\s+/g, " ").includes(`fiestas locales de la ciudad de Sevilla para el año ${year}`)) continue;
        local = parseOfficial("sevilla", content, year);
        localUrl = candidate;
        break;
      }
      apply(["Sevilla"], [{ dates: general, url: generalUrl }, ...(local.length ? [{ dates: local, url: localUrl }] : [])], local.length ? [] : ["dos fiestas locales"], "Publicación parcial", local.length ? "proposal" : "pending");
    });
    await attempt(["Madrid"], async () => {
      const [general, local] = parseMadrid(await get("madrid"), year);
      apply(["Madrid"], [...(general.length ? [{ dates: general, url: URLS.madrid }] : []), ...(local.length ? [{ dates: local, url: URLS.madrid }] : [])], [...(!general.length ? ["calendario general"] : []), ...(!local.length ? ["dos fiestas locales"] : [])], "Publicación parcial", "definitive");
    });

  await attempt(["Barcelona"], async () => {
    const filter = `any_calendari='${year}'`;
    const generalUrl = `${URLS.cataloniaGeneral}?$where=${encodeURIComponent(filter)}&$limit=100`;
    const localUrl = `${URLS.cataloniaLocal}?$where=${encodeURIComponent(`${filter} AND codi_municipi_ine='08019'`)}&$limit=100`;
    const generalRows = await read(generalUrl, "json");
    const localRows = await read(localUrl, "json");
    if (generalRows.length >= 100 || localRows.length >= 100) throw new Error("API catalana posiblemente truncada");
    let general = parseCataloniaJson(generalRows, year, false);
    let local = parseCataloniaJson(localRows, year, true);
    let localSource = localUrl;
    let generalSource = generalUrl;
    if (!general.length) {
      const publication = discoverPublication(await get("cataloniaIndex"), year, URLS.cataloniaIndex, /Calendari oficial de festes laborals a Catalunya/i, ["treball.gencat.cat"]);
      if (publication) {
        general = parseOfficial("catalonia", await read(publication, "html"), year);
        generalSource = publication;
      }
    }
    if (!local.length) {
      const pdfUrl = discoverBarcelonaLocal(await get("barcelonaIndex"), year);
      if (pdfUrl) {
        local = parseOfficial("barcelonaLocal", await read(pdfUrl, "pdf"), year);
        localSource = pdfUrl;
      }
    }
    if (general.length && general.length !== 12) throw new Error(`Cataluña: ${general.length} generales, se esperaban 12`);
    if (local.length && local.length !== 2) throw new Error(`Barcelona: ${local.length} locales, se esperaban 2`);
    const groups = [];
    if (general.length) groups.push({ dates: general, url: generalSource });
    if (local.length) groups.push({ dates: local, url: localSource });
    apply(["Barcelona"], groups, [...(!general.length ? ["calendario general"] : []), ...(!local.length ? ["dos fiestas locales"] : [])], "Publicación parcial", "definitive");
  });

  await attempt(["Malaga"], async () => {
    const groups = parseMalaga(await get("malaga"), year);
    if (!groups) return;
    apply(["Malaga"], [{ dates: groups[0], url: URLS.malaga }, { dates: groups[1], url: URLS.malaga }], [], "", "official_municipal");
  });

  return CITIES.map(city => rows[city]);
}

async function dryRun(year, read = readUrl, getDocument) {
  const sources = await collect(year, read);
  return Promise.all(sources.map(async row => {
    try {
      const stored = await getDocument(row.city, year);
      return { ...row, firestore: stored === null ? "absent" : "present", comparison: compare(row, stored, year) };
    } catch (error) { return { ...row, firestore: "error", comparison: { result: "ERROR", reason: `Firestore: ${error.message}` } }; }
  }));
}

async function main() {
  const year = Number(process.argv[2]);
  if (!Number.isInteger(year) || year < 2026 || year > 2100) throw new Error("Uso: npm run holidays:dry-run -- AÑO (2026-2100)");
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) throw new Error(`Proyecto activo distinto de ${PROJECT_ID}`);
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  const result = await dryRun(year, readUrl, async (city, selectedYear) => {
    const doc = await db.doc(`festivos_oficiales/${city}/años/${selectedYear}`).get();
    return doc.exists ? doc.data() : null;
  });
  console.log(JSON.stringify({ projectId: PROJECT_ID, year, readOnly: true, results: result }, null, 2));
  if (result.some(row => row.status === "error" || row.comparison.result === "ERROR")) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { PROJECT_ID, CITIES, readUrl, normalize, compare, collect, dryRun };
