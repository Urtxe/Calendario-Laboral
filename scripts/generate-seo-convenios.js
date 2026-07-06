const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { PDFParse } = require("../functions/node_modules/pdf-parse");
const { parseConvenioFileName, normalizeText } = require("../functions/convenio-metadata");

const ROOT = path.join(__dirname, "..");
const PROCESSED_DIR = path.join(ROOT, "functions", "convenios", "processed");
const SEO_DIR = path.join(ROOT, "seo");
const SEO_DATA_DIR = path.join(SEO_DIR, "data");
const FIREBASE_JSON = path.join(ROOT, "firebase.json");
const SITEMAP_XML = path.join(ROOT, "sitemap.xml");
const ROBOTS_TXT = path.join(ROOT, "robots.txt");
const MANUAL_METADATA_JSON = path.join(SEO_DATA_DIR, "convenios.manual.json");
const SITE_URL = "https://balancelaboral.es";
const NOT_FOUND = "No localizado en el texto disponible";
const PRUDENT_NOT_FOUND = "No he podido extraer este dato con fiabilidad del texto disponible. Consulta el convenio completo o la publicacion oficial antes de tomar decisiones laborales.";

const SECTOR_CONFIG = {
  hosteleria: {
    label: "Hosteleria",
    title: "Hosteleria",
    cardGroup: "Hosteleria",
    aliases: ["hosteleria", "restauracion"],
  },
  alojamientos: {
    label: "Alojamientos",
    title: "Alojamientos",
    cardGroup: "Alojamientos",
    aliases: ["alojamientos", "hoteles"],
  },
  limpieza: {
    label: "Limpieza",
    title: "Limpieza",
    cardGroup: "Limpieza",
    aliases: ["limpieza", "edificios", "locales"],
  },
  transporte: {
    label: "Transporte",
    title: "Transporte",
    cardGroup: "Transporte",
    aliases: ["transporte", "conductores"],
  },
};

const PRIORITY_SLUGS = [
  "hosteleria-gipuzkoa",
  "alojamientos-gipuzkoa",
  "hosteleria-bizkaia",
  "hosteleria-madrid",
  "alojamientos-alava",
  "alojamientos-sevilla",
  "alojamientos-valencia",
  "alojamientos-zaragoza",
  "limpieza-madrid",
  "limpieza-gipuzkoa",
  "limpieza-bizkaia",
  "transporte-madrid",
  "transporte-valencia",
  "transporte-sevilla",
];

const CONTENT_FIELDS = [
  "vigencia",
  "ambito",
  "jornada_anual",
  "vacaciones",
  "permisos",
  "horas_extra",
  "nocturnidad",
  "descansos",
  "festivos_descansos",
  "fuente_oficial",
  "fuente_url",
];

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJson(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

function removePublicYears(value) {
  return String(value || "").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim();
}

function hasPartMarker(fileName) {
  return /\bparte\s*\d*\b/i.test(fileName) || /parte\d+/i.test(fileName);
}

function detectBrokenMetadata(fileName, parsed) {
  if (!parsed.province || !parsed.sectorKeys.length) return true;
  if (/\b\d{3}-\d{4}\b/.test(fileName)) return true;
  return false;
}

function pickSector(fileName, parsed) {
  const normalized = normalizeText(fileName);
  if (normalized.includes("alojamientos y hosteleria bizkaia")) return "hosteleria";
  if (parsed.sectorKeys.includes("alojamientos")) return "alojamientos";
  if (parsed.sectorKeys.includes("hosteleria")) return "hosteleria";
  if (parsed.sectorKeys.includes("limpieza")) return "limpieza";
  if (parsed.sectorKeys.includes("transporte")) return "transporte";
  return null;
}

function buildSlug(sector, province) {
  return `${slugify(sector)}-${slugify(province)}`;
}

function qualityFromText(text) {
  if (text.length > 50000) return "alta";
  if (text.length > 15000) return "media";
  return "baja";
}

function isFound(value) {
  return Boolean(value && value !== NOT_FOUND);
}

function scoreContent(content) {
  return CONTENT_FIELDS.filter((field) => isFound(content[field])).length;
}

function displayText(value) {
  return isFound(value) ? value : PRUDENT_NOT_FOUND;
}

function dataState(value) {
  return isFound(value) ? "extraido" : "no_localizado";
}

async function loadManualMetadata() {
  try {
    const raw = await fsp.readFile(MANUAL_METADATA_JSON, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return {
      entries,
      byDocument: new Map(entries.map((entry) => [entry.documento, entry])),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { entries: [], byDocument: new Map() };
    }
    throw error;
  }
}

function parseYearsFromManual(value) {
  const matches = String(value || "").match(/\b(19|20)\d{2}\b/g) || [];
  return {
    yearStart: matches[0] ? Number(matches[0]) : null,
    yearEnd: matches[matches.length - 1] ? Number(matches[matches.length - 1]) : null,
  };
}

function applyManualParsed(parsed, manual) {
  if (!manual || !manual.verified) return parsed;
  const years = parseYearsFromManual(manual.vigencia);
  return {
    ...parsed,
    province: manual.provincia || parsed.province,
    sectorKeys: manual.sector ? [manual.sector] : parsed.sectorKeys,
    yearStart: years.yearStart || parsed.yearStart,
    yearEnd: years.yearEnd || parsed.yearEnd,
  };
}

function applyManualContent(content, manual) {
  if (!manual || !manual.verified) return { content, fields: [] };
  const mapping = {
    vigencia: "vigencia",
    jornada_anual: "jornada_anual",
    vacaciones: "vacaciones",
    fuente_oficial: "fuente_oficial",
    fuente_url: "fuente_url",
  };
  const fields = [];
  const next = { ...content };
  Object.entries(mapping).forEach(([manualKey, contentKey]) => {
    if (manual[manualKey]) {
      next[contentKey] = manual[manualKey];
      fields.push(contentKey);
    }
  });
  return { content: next, fields };
}

function findFirst(text, patterns, around = 700) {
  const lower = text.toLowerCase();
  for (const pattern of patterns) {
    const index = lower.search(pattern);
    if (index >= 0) {
      return compact(text.slice(index, Math.min(text.length, index + around)));
    }
  }
  return "";
}

function findFragmentWithValue(text, keywordPattern, valueFn, around = 1800) {
  const regex = new RegExp(keywordPattern.source, keywordPattern.flags.includes("g") ? keywordPattern.flags : `${keywordPattern.flags}g`);
  let match;
  while ((match = regex.exec(text)) !== null) {
    const fragment = compact(text.slice(match.index, Math.min(text.length, match.index + around)));
    if (valueFn(fragment)) return fragment;
    if (regex.lastIndex === match.index) regex.lastIndex += 1;
  }
  return "";
}

function extractHourValue(fragment) {
  const match = fragment.match(/\b1[.,]\d{3}\s*horas?\b/i);
  return match ? match[0].replace(".", ".") : "";
}

function extractDayValue(fragment) {
  const match = fragment.match(/\b(22|23|24|25|26|27|28|29|30|31)\s+d[ií]as?\s+(naturales|laborables|h[aá]biles)\b/i);
  return match ? compact(match[0]) : "";
}

function extractPercentage(fragment) {
  const match = fragment.match(/\b\d{1,3}\s*%\b/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function extractVigencia(parsed) {
  if (parsed.yearStart && parsed.yearEnd) {
    return `Vigencia detectada en el documento: ${parsed.yearStart}-${parsed.yearEnd}.`;
  }
  return NOT_FOUND;
}

function extractOfficialSource(text) {
  const compactText = compact(text.slice(0, 10000));
  const sourcePatterns = [
    /Bolet[ií]n Oficial (?:de|del) [A-ZÁÉÍÓÚÜÑa-záéíóúüñ ]+/,
    /BOLET[IÍ]N OFICIAL (?:DE|DEL) [A-ZÁÉÍÓÚÜÑ ]+/,
    /\bBOPV\b/,
    /\bBOB\b/,
    /\bBON\b/,
    /\bBOCM\b/,
    /\bBOE\b/,
  ];
  for (const pattern of sourcePatterns) {
    const match = compactText.match(pattern);
    if (match) {
      return `Referencia de publicacion localizada en el PDF: ${titleCase(match[0])}.`;
    }
  }
  return NOT_FOUND;
}

function extractOfficialUrl(text) {
  const compactText = compact(text.slice(0, 15000));
  const allowedDomains = [
    "bopmalaga.es",
    "bop.dival.es",
    "araba.eus",
    "bop.diba.cat",
    "bocm.es",
    "boe.es",
    "bizkaia.eus",
    "gipuzkoa.eus",
    "navarra.es",
    "sevilla.es",
    "dpz.es",
  ];
  const urls = compactText.match(/https?:\/\/[^\s)]+/gi) || [];
  const officialUrl = urls
    .map((url) => url.replace(/[.,;]+$/, ""))
    .find((url) => allowedDomains.some((domain) => url.toLowerCase().includes(domain)));
  if (officialUrl) return officialUrl;
  const webMatch = compactText.match(/\b(?:www\.)?(?:bopmalaga\.es|araba\.eus|bop\.dival\.es|bop\.diba\.cat)[^\s)]*/i);
  if (webMatch) {
    const value = webMatch[0].replace(/[.,;]+$/, "");
    return value.startsWith("www.") ? `https://${value}` : `https://${value}`;
  }
  return NOT_FOUND;
}

function extractContent(text, sector, province, parsed) {
  const jornadaFragment = findFragmentWithValue(text, /jornada|c[oó]mputo anual/i, extractHourValue, 2200) ||
    findFirst(text, [/jornada (anual|laboral|de trabajo)/i, /jornada anual/i, /c[oó]mputo anual/i], 1800);
  const jornadaHour = extractHourValue(jornadaFragment);
  const vacacionesFragment = findFragmentWithValue(text, /vacaciones|vacaci[oó]n anual/i, extractDayValue, 2200) ||
    findFirst(text, [/vacaciones/i, /vacaci[oó]n anual/i], 1800);
  const vacationDays = extractDayValue(vacacionesFragment);
  const festivosFragment = findFirst(text, [/festivos/i, /d[ií]as festivos/i, /fiestas retribuidas/i], 1600);
  const permisosFragment = findFirst(text, [/permisos y licencias/i, /licencias/i, /permisos retribuidos/i], 1800);
  const horasExtraFragment = findFirst(text, [/horas extraordinarias/i, /horas extras/i], 1800);
  const nocturnidadFragment = findFirst(text, [/nocturnidad/i, /trabajos nocturnos/i, /horario nocturno/i], 1800);
  const descansosFragment = findFirst(text, [/descanso semanal/i, /descansos/i, /descanso entre jornadas/i, /festivos/i], 1800);
  const plusesFragment = findFirst(text, [/plus/i, /complementos?/i, /nocturnidad/i], 1200);
  const categoriasFragment = findFirst(text, [/categor[ií]as profesionales/i, /grupos profesionales/i, /clasificaci[oó]n profesional/i], 1200);
  const ambitoFragment = findFirst(text, [/[aá]mbito territorial/i, /[aá]mbito funcional/i], 1600);

  const jornada = jornadaHour
    ? `Jornada anual localizada en el texto: ${jornadaHour}.`
    : NOT_FOUND;

  const vacaciones = vacationDays
    ? `Vacaciones localizadas en el texto: ${vacationDays}.`
    : NOT_FOUND;

  let festivos = NOT_FOUND;
  if (/75\s*%/.test(festivosFragment) && /50\s*%/.test(festivosFragment)) {
    festivos = "Festivos trabajados localizados: compensacion economica con incremento del 75% o descanso posterior con aumento del 50%.";
  } else if (/fiestas retribuidas|festivos/i.test(festivosFragment)) {
    festivos = "Reglas sobre festivos trabajados localizadas en el documento.";
  }

  const permisos = /matrimonio|fallecimiento|hospitalizaci[oó]n|enfermedad grave|licencia/i.test(permisosFragment)
    ? "Articulo o cuadro de permisos y licencias localizado en el documento; revisa el texto completo para duraciones y supuestos concretos."
    : NOT_FOUND;

  const horasExtra = /no podr[aá]n efectuarse|norma general|horas extraordinarias|horas extras/i.test(horasExtraFragment)
    ? "Reglas sobre horas extraordinarias localizadas en el documento; consulta el convenio para limites, compensacion y excepciones."
    : NOT_FOUND;

  const nocturnidadPercent = extractPercentage(nocturnidadFragment);
  const nocturnidad = /nocturn|trabajos nocturnos|horario nocturno/i.test(nocturnidadFragment)
    ? nocturnidadPercent
      ? `Regla de nocturnidad localizada en el texto, con referencia a un incremento del ${nocturnidadPercent}.`
      : "Regla de nocturnidad localizada en el texto; consulta el convenio para el tramo horario y la compensacion aplicable."
    : NOT_FOUND;

  let descansos = NOT_FOUND;
  if (/descanso semanal|descansos|descanso entre jornadas/i.test(descansosFragment)) {
    descansos = "Reglas de descansos localizadas en el documento; consulta el convenio para calendario, descansos semanales y posibles compensaciones.";
  } else if (isFound(festivos)) {
    descansos = "Reglas sobre festivos y descansos compensatorios localizadas en el documento.";
  }

  const pluses = /plus|complemento|nocturnidad|antig[uü]edad|transporte/i.test(plusesFragment)
    ? "Pluses o complementos localizados en el documento."
    : NOT_FOUND;

  const categorias = /categor|grupos profesionales|clasificaci[oó]n profesional/i.test(categoriasFragment)
    ? "Categorias o grupos profesionales localizados en el documento."
    : NOT_FOUND;

  const ambito = ambitoFragment
    ? `Ambito del convenio localizado para el sector ${SECTOR_CONFIG[sector].label.toLowerCase()} en ${titleCase(province)}.`
    : NOT_FOUND;

  const vigencia = extractVigencia(parsed);
  const fuenteOficial = extractOfficialSource(text);
  const fuenteUrl = extractOfficialUrl(text);
  const resumenParts = [
    `Pagina orientativa del convenio colectivo de ${SECTOR_CONFIG[sector].label.toLowerCase()} de ${titleCase(province)}.`,
    isFound(vigencia) ? vigencia : "La vigencia no se ha podido confirmar automaticamente.",
    isFound(jornada) ? jornada : "La jornada anual debe comprobarse en el convenio completo.",
    isFound(vacaciones) ? vacaciones : "Las vacaciones deben comprobarse en el convenio completo.",
  ];

  return {
    resumen: resumenParts.join(" "),
    vigencia,
    ambito,
    jornada_anual: jornada,
    vacaciones,
    permisos,
    horas_extra: horasExtra,
    nocturnidad,
    descansos,
    festivos_descansos: festivos,
    pluses,
    categorias,
    fuente_oficial: fuenteOficial,
    fuente_url: fuenteUrl,
  };
}

function buildFaq(entry) {
  const label = entry.sectorLabel.toLowerCase();
  const province = entry.provinciaDisplay;
  const items = [
    {
      question: `Que vigencia tiene el convenio de ${label} de ${province}?`,
      answer: entry.content.vigencia,
    },
    {
      question: `Cuantas horas anuales tiene el convenio de ${label} de ${province}?`,
      answer: entry.content.jornada_anual,
    },
    {
      question: "Cuantos dias de vacaciones corresponden?",
      answer: entry.content.vacaciones,
    },
    {
      question: "Como funcionan los festivos?",
      answer: entry.content.festivos_descansos,
    },
    {
      question: "Como se pagan las horas extra?",
      answer: entry.content.horas_extra,
    },
    {
      question: "Hay regla de nocturnidad?",
      answer: entry.content.nocturnidad,
    },
    {
      question: "Que descansos aparecen en el convenio?",
      answer: entry.content.descansos,
    },
    {
      question: "Que permisos retribuidos hay?",
      answer: entry.content.permisos,
    },
    {
      question: "Como consultar mi convenio con IA?",
      answer: "Entra en Balance Laboral y abre el asesor de convenio con IA para buscar informacion concreta dentro del documento.",
    },
  ];
  return items.filter((item) => isFound(item.answer));
}

function buildEntry({ fileName, filePath, parsed, text, manual }) {
  const sector = manual && manual.verified && manual.sector ? manual.sector : pickSector(fileName, parsed);
  const province = manual && manual.verified && manual.provincia ? manual.provincia : parsed.province;
  const sectorLabel = SECTOR_CONFIG[sector].label;
  const provinciaDisplay = titleCase(province);
  const slug = manual && manual.verified && manual.slug ? manual.slug : buildSlug(sector, province);
  const extractedContent = extractContent(text, sector, province, parsed);
  const manualContent = applyManualContent(extractedContent, manual);
  const content = manualContent.content;
  const contentScore = scoreContent(content);

  const entry = {
    sector,
    sectorLabel,
    provincia: province,
    provinciaDisplay,
    slug,
    title: `Convenio de ${sectorLabel} de ${provinciaDisplay}`,
    source: {
      documento: fileName,
      path: path.relative(ROOT, filePath).replace(/\\/g, "/"),
      years_detected_internal_only: [parsed.yearStart, parsed.yearEnd].filter(Boolean).join("-") || null,
      quality: qualityFromText(text),
      content_score: contentScore,
      manual_fields: manualContent.fields,
      manual_verified: Boolean(manual && manual.verified),
      status: "generar",
    },
    content,
  };

  entry.faq = buildFaq(entry);
  return entry;
}

function sectionHtml(id, title, text) {
  return [
    `      <section class="topic-section" id="${id}" data-topic="${id}">`,
    `        <h2>${escapeHtml(title)}</h2>`,
    `        <p>${escapeHtml(displayText(text))}</p>`,
    "      </section>",
  ].join("\n");
}

function sourceSectionHtml(entry) {
  const sourceText = displayText(entry.content.fuente_oficial);
  const sourceUrl = isFound(entry.content.fuente_url) ? entry.content.fuente_url : "";
  const linkHtml = sourceUrl
    ? ` <a href="${escapeHtml(sourceUrl)}" rel="nofollow noopener" target="_blank">Abrir fuente oficial</a>.`
    : "";
  return [
    `      <section class="topic-section" id="fuente" data-topic="fuente">`,
    "        <h2>Fuente de la informacion</h2>",
    `        <p>${escapeHtml(sourceText)}${linkHtml}</p>`,
    "      </section>",
  ].join("\n");
}

function buildRelatedBySector(entry, generatedEntries) {
  return generatedEntries
    .filter((candidate) => candidate.slug !== entry.slug && candidate.sector === entry.sector)
    .sort((a, b) => {
      const sameSectorA = a.sector === entry.sector ? 0 : 1;
      const sameSectorB = b.sector === entry.sector ? 0 : 1;
      return sameSectorA - sameSectorB || a.title.localeCompare(b.title, "es");
    })
    .slice(0, 4);
}

function buildRelatedByProvince(entry, generatedEntries) {
  return generatedEntries
    .filter((candidate) => candidate.slug !== entry.slug && candidate.provincia === entry.provincia)
    .sort((a, b) => a.title.localeCompare(b.title, "es"))
    .slice(0, 4);
}

function buildMeta(entry) {
  const core = `${entry.title}: vigencia, jornada, vacaciones, permisos y horas extra`;
  const foundBits = [
    isFound(entry.content.vigencia) ? entry.content.vigencia.replace(/^Vigencia detectada en el documento: /, "Vigencia ") : "",
    isFound(entry.content.jornada_anual) ? entry.content.jornada_anual.replace(/^Jornada anual localizada en el texto: /, "Jornada ") : "",
    isFound(entry.content.vacaciones) ? entry.content.vacaciones.replace(/^Vacaciones localizadas en el texto: /, "Vacaciones ") : "",
  ].filter(Boolean);
  const description = `${core}. ${foundBits.length ? foundBits.join(" ") : "Resumen prudente con datos extraidos del PDF disponible."} Consulta el convenio completo antes de decidir.`;
  const trimmedDescription = description.length > 230
    ? `${description.slice(0, 227).replace(/\s+\S*$/, "")}...`
    : description;
  return {
    title: `${entry.title}: vigencia, jornada y permisos | Balance Laboral`,
    description: trimmedDescription,
  };
}

function buildSchema(entry) {
  const url = `${SITE_URL}/convenios/${entry.slug}`;
  const faqId = `${url}#faq`;
  const breadcrumbId = `${url}#breadcrumb`;
  const meta = buildMeta(entry);
  const graph = [
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: meta.title,
      description: meta.description,
      inLanguage: "es",
      isPartOf: {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Balance Laboral",
        url: `${SITE_URL}/`,
      },
      breadcrumb: { "@id": breadcrumbId },
      mainEntity: entry.faq.length ? { "@id": faqId } : undefined,
      about: [
        { "@type": "Thing", name: `Convenio colectivo de ${entry.sectorLabel.toLowerCase()}` },
        { "@type": "Thing", name: `Sector ${entry.sectorLabel.toLowerCase()}` },
        { "@type": "Place", name: entry.provinciaDisplay },
        { "@type": "Thing", name: "Vigencia" },
        { "@type": "Thing", name: "Jornada anual" },
        { "@type": "Thing", name: "Vacaciones" },
        { "@type": "Thing", name: "Festivos" },
        { "@type": "Thing", name: "Permisos y licencias" },
        { "@type": "Thing", name: "Horas extra" },
        { "@type": "Thing", name: "Nocturnidad" },
        { "@type": "Thing", name: "Descansos" },
      ],
      keywords: [
        `convenio ${entry.sectorLabel.toLowerCase()} ${entry.provinciaDisplay}`,
        "convenio colectivo",
        "jornada anual",
        "vacaciones",
        "festivos",
        "permisos",
        "horas extra",
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": breadcrumbId,
      inLanguage: "es",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Convenios", item: `${SITE_URL}/convenios` },
        { "@type": "ListItem", position: 3, name: entry.title, item: url },
      ],
    },
  ];

  if (entry.faq.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": faqId,
      inLanguage: "es",
      mainEntity: entry.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

function renderPage(entry, generatedEntries) {
  const meta = buildMeta(entry);
  const sameSector = buildRelatedBySector(entry, generatedEntries);
  const sameProvince = buildRelatedByProvince(entry, generatedEntries);
  const keywords = [
    `convenio ${entry.sectorLabel.toLowerCase()} ${entry.provinciaDisplay}`,
    "convenio colectivo",
    "jornada anual",
    "vacaciones",
    "festivos",
    "permisos",
    "horas extra",
  ].join(", ");
  const schema = buildSchema(entry);
  const sameSectorHtml = sameSector.map((item) => `          <li><a href="/convenios/${item.slug}">${escapeHtml(item.title)}</a></li>`).join("\n");
  const sameProvinceHtml = sameProvince.map((item) => `          <li><a href="/convenios/${item.slug}">${escapeHtml(item.title)}</a></li>`).join("\n");
  const faqHtml = entry.faq.map((item) => {
    return `          <article class="faq-item"><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p></article>`;
  }).join("\n");
  const faqSection = entry.faq.length >= 3 ? `
      <section class="faq" id="faq">
        <h2>Preguntas frecuentes sobre ${escapeHtml(entry.title.toLowerCase())}</h2>
        <div class="faq-list">
${faqHtml}
        </div>
      </section>
` : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="${escapeHtml(meta.description)}">
  <meta name="keywords" content="${escapeHtml(keywords)}">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#24344d">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="es_ES">
  <meta property="og:title" content="${escapeHtml(meta.title)}">
  <meta property="og:description" content="${escapeHtml(meta.description)}">
  <meta property="og:url" content="${SITE_URL}/convenios/${entry.slug}">
  <meta property="og:site_name" content="Balance Laboral">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(meta.title)}">
  <meta name="twitter:description" content="${escapeHtml(meta.description)}">
  <link rel="canonical" href="${SITE_URL}/convenios/${entry.slug}">
  <link rel="icon" type="image/png" sizes="32x32" href="../assets/icons/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="../src/css/convenios.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <title>${escapeHtml(meta.title)}</title>
  <script type="application/ld+json">
  ${escapeJson(schema)}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="page-wrap header-inner">
      <a class="brand" href="/" aria-label="Balance Laboral">
        <img src="../assets/images/logo.png" alt="Balance Laboral" width="42" height="42">
        <span>Balance Laboral</span>
      </a>
      <a class="header-link" href="/convenios">Convenios</a>
    </div>
  </header>

  <main class="narrow-wrap article-layout">
    <nav class="breadcrumbs" aria-label="Migas de pan">
      <ol>
        <li><a href="/">Inicio</a></li>
        <li><a href="/convenios">Convenios</a></li>
        <li aria-current="page">${escapeHtml(entry.title)}</li>
      </ol>
    </nav>

    <article class="article-shell">
      <section class="hero">
        <p class="eyebrow">${escapeHtml(entry.sectorLabel)} · ${escapeHtml(entry.provinciaDisplay)}</p>
        <h1>${escapeHtml(entry.title)}</h1>
        <p class="lead">Para trabajadores del sector ${escapeHtml(entry.sectorLabel.toLowerCase())} en ${escapeHtml(entry.provinciaDisplay)} que buscan jornada anual, vacaciones, festivos, permisos y horas extra.</p>
        <ul class="hero-points" aria-label="Contenido principal">
          <li>Vigencia</li>
          <li>Jornada anual</li>
          <li>Vacaciones</li>
          <li>Permisos</li>
          <li>Horas extra</li>
          <li>Nocturnidad</li>
        </ul>
      </section>

      <section class="notice">
        <strong>Informacion orientativa.</strong> Consulta siempre el convenio oficial vigente o asesoramiento profesional.
      </section>

      <section class="quick-summary" aria-labelledby="resumen-rapido">
        <h2 id="resumen-rapido">Resumen rapido</h2>
        <dl class="summary-grid">
          <div class="summary-item"><dt>Sector</dt><dd>${escapeHtml(entry.sectorLabel)}</dd></div>
          <div class="summary-item"><dt>Provincia</dt><dd>${escapeHtml(entry.provinciaDisplay)}</dd></div>
          <div class="summary-item"><dt>Vigencia</dt><dd>${escapeHtml(displayText(entry.content.vigencia))}</dd></div>
          <div class="summary-item"><dt>Jornada anual</dt><dd>${escapeHtml(displayText(entry.content.jornada_anual))}</dd></div>
          <div class="summary-item"><dt>Vacaciones</dt><dd>${escapeHtml(displayText(entry.content.vacaciones))}</dd></div>
          <div class="summary-item"><dt>Permisos</dt><dd>${escapeHtml(displayText(entry.content.permisos))}</dd></div>
          <div class="summary-item"><dt>Horas extra</dt><dd>${escapeHtml(displayText(entry.content.horas_extra))}</dd></div>
          <div class="summary-item"><dt>Nocturnidad</dt><dd>${escapeHtml(displayText(entry.content.nocturnidad))}</dd></div>
          <div class="summary-item"><dt>Descansos</dt><dd>${escapeHtml(displayText(entry.content.descansos))}</dd></div>
          <div class="summary-item"><dt>Fuente</dt><dd>${escapeHtml(displayText(entry.content.fuente_oficial))}${isFound(entry.content.fuente_url) ? ` <a href="${escapeHtml(entry.content.fuente_url)}" rel="nofollow noopener" target="_blank">Fuente oficial</a>` : ""}</dd></div>
        </dl>
      </section>

      <section class="conversion-panel" aria-labelledby="cta-horas">
        <div>
          <h2 id="cta-horas">Quieres saber exactamente cuantas horas te corresponden?</h2>
          <p>Calcula gratuitamente tu jornada con Balance Laboral y revisa tu calendario de trabajo.</p>
        </div>
        <div class="conversion-actions">
          <a class="btn primary" href="/">Calcular mis horas</a>
        </div>
      </section>

      <section class="conversion-panel secondary" aria-labelledby="cta-ia">
        <div>
          <h2 id="cta-ia">Tienes una duda concreta sobre este convenio?</h2>
          <p>La IA de Balance Laboral puede ayudarte a localizar informacion del convenio colectivo.</p>
        </div>
        <div class="conversion-actions">
          <a class="btn light" href="/">Preguntar a la IA</a>
        </div>
      </section>

      <nav class="content-nav" aria-label="Temas del convenio">
        <p>Consultar por tema</p>
        <ul>
          <li><a href="#fuente">Fuente</a></li>
          <li><a href="#resumen">Resumen practico</a></li>
          <li><a href="#vigencia">Vigencia</a></li>
          <li><a href="#ambito">Ambito</a></li>
          <li><a href="#jornada-anual">Jornada anual</a></li>
          <li><a href="#vacaciones">Vacaciones</a></li>
          <li><a href="#permisos">Permisos</a></li>
          <li><a href="#horas-extra">Horas extra</a></li>
          <li><a href="#nocturnidad">Nocturnidad</a></li>
          <li><a href="#descansos">Descansos</a></li>
          <li><a href="#festivos">Festivos</a></li>
        </ul>
      </nav>

${sourceSectionHtml(entry)}
${sectionHtml("resumen", "Resumen practico", entry.content.resumen)}
${sectionHtml("vigencia", "Vigencia", entry.content.vigencia)}
${sectionHtml("ambito", "Ambito del convenio", entry.content.ambito)}
${sectionHtml("jornada-anual", "Jornada anual", entry.content.jornada_anual)}
${sectionHtml("vacaciones", "Vacaciones", entry.content.vacaciones)}
${sectionHtml("permisos", "Permisos/licencias", entry.content.permisos)}
${sectionHtml("horas-extra", "Horas extra", entry.content.horas_extra)}
${sectionHtml("nocturnidad", "Nocturnidad", entry.content.nocturnidad)}
${sectionHtml("descansos", "Descansos", entry.content.descansos)}
${sectionHtml("festivos", "Festivos", entry.content.festivos_descansos)}

${faqSection}

      <section class="related-box" aria-labelledby="mismo-sector">
        <h2 id="mismo-sector">Otros convenios de ${escapeHtml(entry.sectorLabel.toLowerCase())}</h2>
        <ul class="related-list">
${sameSectorHtml}
          <li><a href="/convenios#sector-${entry.sector}">Ver sector ${escapeHtml(entry.sectorLabel.toLowerCase())}</a></li>
        </ul>
      </section>

      <section class="related-box" aria-labelledby="misma-provincia">
        <h2 id="misma-provincia">Otros convenios de ${escapeHtml(entry.provinciaDisplay)}</h2>
        <ul class="related-list">
${sameProvinceHtml || `          <li><a href="/convenios#provincia-${slugify(entry.provinciaDisplay)}">Ver convenios de ${escapeHtml(entry.provinciaDisplay)}</a></li>`}
          <li><a href="/convenios">Todos los convenios</a></li>
        </ul>
      </section>
    </article>
  </main>

  <footer class="site-footer">
    <div class="page-wrap footer-inner">
      <a href="/convenios">Volver al listado de convenios</a>
      <a href="/privacy">Privacidad</a>
    </div>
  </footer>
</body>
</html>
`;
}

function renderListing(generatedEntries) {
  const groups = ["hosteleria", "alojamientos", "limpieza", "transporte"]
    .map((sector) => ({
      sector,
      label: SECTOR_CONFIG[sector].cardGroup,
      items: generatedEntries.filter((entry) => entry.sector === sector).sort((a, b) => a.provinciaDisplay.localeCompare(b.provinciaDisplay, "es")),
    }))
    .filter((group) => group.items.length);
  const provinces = Array.from(new Set(generatedEntries.map((entry) => entry.provinciaDisplay)))
    .sort((a, b) => a.localeCompare(b, "es"));
  const sectorLinks = groups.map((group) => `          <li><a href="#sector-${group.sector}">${escapeHtml(group.label)}</a></li>`).join("\n");
  const provinceLinks = provinces.map((province) => `          <li><a href="#provincia-${slugify(province)}">${escapeHtml(province)}</a></li>`).join("\n");

  const cards = groups.map((group) => {
    const items = group.items.map((entry) => `          <article class="listing-card">
            <p class="card-kicker">${escapeHtml(entry.provinciaDisplay)}</p>
            <h3><a href="/convenios/${entry.slug}">${escapeHtml(entry.title)}</a></h3>
            <p>${escapeHtml(isFound(entry.content.jornada_anual) ? entry.content.jornada_anual : "Resumen con vigencia, vacaciones, permisos, descansos y horas extra cuando el dato se ha extraido con fiabilidad.")}</p>
          </article>`).join("\n");
    return `      <section id="sector-${group.sector}" aria-labelledby="grupo-${group.sector}">
        <h2 id="grupo-${group.sector}">${escapeHtml(group.label)}</h2>
        <div class="cards-grid">
${items}
        </div>
      </section>`;
  }).join("\n\n");
  const provinceSections = provinces.map((province) => {
    const items = generatedEntries
      .filter((entry) => entry.provinciaDisplay === province)
      .sort((a, b) => a.sectorLabel.localeCompare(b.sectorLabel, "es"))
      .map((entry) => `          <li><a href="/convenios/${entry.slug}">${escapeHtml(entry.title)}</a></li>`)
      .join("\n");
    return `      <section class="related-box" id="provincia-${slugify(province)}" aria-labelledby="titulo-provincia-${slugify(province)}">
        <h2 id="titulo-provincia-${slugify(province)}">Convenios de ${escapeHtml(province)}</h2>
        <ul class="related-list">
${items}
        </ul>
      </section>`;
  }).join("\n\n");

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/convenios#webpage`,
        url: `${SITE_URL}/convenios`,
        name: "Convenios colectivos | Balance Laboral",
        description: "Listado publico de convenios colectivos analizados por Balance Laboral.",
        inLanguage: "es",
        isPartOf: {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: "Balance Laboral",
          url: `${SITE_URL}/`,
        },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: generatedEntries.map((entry, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${SITE_URL}/convenios/${entry.slug}`,
            name: entry.title,
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${SITE_URL}/convenios#breadcrumb`,
        inLanguage: "es",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Convenios", item: `${SITE_URL}/convenios` },
        ],
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="Listado publico de convenios colectivos analizados por Balance Laboral: hosteleria, alojamientos, limpieza y transporte.">
  <meta name="keywords" content="convenios colectivos, jornada anual, vacaciones, festivos, permisos, horas extra">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#24344d">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="es_ES">
  <meta property="og:title" content="Convenios colectivos | Balance Laboral">
  <meta property="og:description" content="Consulta paginas orientativas de convenios con jornada anual, vacaciones, festivos, permisos y horas extra.">
  <meta property="og:url" content="${SITE_URL}/convenios">
  <meta property="og:site_name" content="Balance Laboral">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Convenios colectivos | Balance Laboral">
  <meta name="twitter:description" content="Listado publico de convenios analizados por Balance Laboral.">
  <link rel="canonical" href="${SITE_URL}/convenios">
  <link rel="icon" type="image/png" sizes="32x32" href="../assets/icons/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="../src/css/convenios.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <title>Convenios colectivos | Balance Laboral</title>
  <script type="application/ld+json">
  ${escapeJson(schema)}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="page-wrap header-inner">
      <a class="brand" href="/" aria-label="Balance Laboral">
        <img src="../assets/images/logo.png" alt="Balance Laboral" width="42" height="42">
        <span>Balance Laboral</span>
      </a>
      <a class="header-link" href="/">Abrir app</a>
    </div>
  </header>

  <main class="page-wrap">
    <nav class="breadcrumbs" aria-label="Migas de pan">
      <ol>
        <li><a href="/">Inicio</a></li>
        <li aria-current="page">Convenios</li>
      </ol>
    </nav>

    <section class="hero">
      <p class="eyebrow">Convenios colectivos</p>
      <h1>Convenios laborales: jornada, vacaciones, festivos y permisos</h1>
      <p class="lead">Elige tu convenio para ver un resumen rapido del documento base analizado y usar Balance Laboral para calcular horas o preguntar a la IA.</p>
    </section>

    <section class="notice" aria-label="Aviso importante">
      <strong>Informacion orientativa.</strong> Consulta siempre el convenio oficial vigente o asesoramiento profesional.
    </section>

    <nav class="content-nav" aria-label="Explorar convenios">
      <p>Sectores</p>
      <ul>
${sectorLinks}
      </ul>
      <p>Provincias</p>
      <ul>
${provinceLinks}
      </ul>
    </nav>

${cards}

${provinceSections}

    <section class="conversion-panel">
      <div>
        <h2>Quieres aplicar tu convenio a tu calendario?</h2>
        <p>Calcula tus horas, organiza tu jornada y consulta dudas concretas desde Balance Laboral.</p>
      </div>
      <div class="conversion-actions">
        <a class="btn primary" href="/">Calcular mis horas</a>
        <a class="btn" href="/">Preguntar a la IA</a>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="page-wrap footer-inner">
      <span>© 2026 Balance Laboral</span>
      <a href="/privacy">Privacidad</a>
    </div>
  </footer>
</body>
</html>
`;
}

function renderSitemap(generatedEntries) {
  const urls = [`${SITE_URL}/convenios`, ...generatedEntries.map((entry) => `${SITE_URL}/convenios/${entry.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>\n    <loc>${url}</loc>\n  </url>`).join("\n")}
</urlset>
`;
}

function ensureRobots() {
  return `User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
`;
}

async function loadPdfText(filePath) {
  const buffer = await fsp.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  return cleanText(parsed.text || "");
}

async function listPdfFiles() {
  const names = await fsp.readdir(PROCESSED_DIR);
  return names.filter((name) => name.toLowerCase().endsWith(".pdf")).sort();
}

function chooseCandidates(records) {
  const bySlug = new Map();
  const needsCorrections = [];
  const doNotPublish = [];

  for (const record of records) {
    if (record.status !== "candidate") {
      if (record.status === "corregir") needsCorrections.push(record);
      else doNotPublish.push(record);
      continue;
    }

    if (record.entry.source.content_score < 4) {
      const target = record.entry.source.content_score >= 2 ? needsCorrections : doNotPublish;
      target.push({
        ...record,
        status: record.entry.source.content_score >= 2 ? "corregir" : "no_publicar",
        reason: `Contenido tematico insuficiente para publicar (${record.entry.source.content_score}/${CONTENT_FIELDS.length} bloques localizados).`,
      });
      continue;
    }

    const existing = bySlug.get(record.entry.slug);
    if (!existing) {
      bySlug.set(record.entry.slug, record);
      continue;
    }

    const currentYear = record.entry.source.years_detected_internal_only || "";
    const existingYear = existing.entry.source.years_detected_internal_only || "";
    const currentEnd = Number(String(currentYear).split("-").pop()) || 0;
    const existingEnd = Number(String(existingYear).split("-").pop()) || 0;
    if (currentEnd > existingEnd) {
      doNotPublish.push({ ...existing, status: "no_publicar", reason: `Duplicado para ${record.entry.slug}; sustituido por documento mas reciente.` });
      bySlug.set(record.entry.slug, record);
    } else {
      doNotPublish.push({ ...record, status: "no_publicar", reason: `Duplicado para ${record.entry.slug}; existe documento igual o mas reciente.` });
    }
  }

  const ordered = Array.from(bySlug.values()).sort((a, b) => {
    const pa = PRIORITY_SLUGS.indexOf(a.entry.slug);
    const pb = PRIORITY_SLUGS.indexOf(b.entry.slug);
    const priorityA = pa === -1 ? Number.MAX_SAFE_INTEGER : pa;
    const priorityB = pb === -1 ? Number.MAX_SAFE_INTEGER : pb;
    return priorityA - priorityB || a.entry.title.localeCompare(b.entry.title, "es");
  });

  return {
    selected: ordered,
    needsCorrections,
    doNotPublish,
  };
}

async function buildRecords() {
  const manualMetadata = await loadManualMetadata();
  const files = await listPdfFiles();
  const records = [];

  for (const fileName of files) {
    const manual = manualMetadata.byDocument.get(fileName) || null;
    if (manual && manual.skip) {
      records.push({
        fileName,
        status: manual.skipStatus || "no_publicar",
        reason: manual.reason || "Documento marcado manualmente como no publicable.",
      });
      continue;
    }

    const parsed = applyManualParsed(parseConvenioFileName(fileName), manual);
    const filePath = path.join(PROCESSED_DIR, fileName);
    const normalized = normalizeText(fileName);

    if (normalized.startsWith("estatuto trabajadores")) {
      records.push({ fileName, status: "no_publicar", reason: "No es convenio provincial especifico." });
      continue;
    }

    if (!manual?.verified && hasPartMarker(fileName)) {
      records.push({ fileName, status: "corregir", reason: "PDF partido o parte no fusionada." });
      continue;
    }

    if (!manual?.verified && detectBrokenMetadata(fileName, parsed)) {
      records.push({ fileName, status: "corregir", reason: "Metadata ambigua o rota en nombre de archivo." });
      continue;
    }

    const sector = manual && manual.verified && manual.sector ? manual.sector : pickSector(fileName, parsed);
    if (!sector) {
      records.push({ fileName, status: "corregir", reason: "Sector no detectado." });
      continue;
    }

    let text = "";
    try {
      text = await loadPdfText(filePath);
    } catch (error) {
      records.push({ fileName, status: "no_publicar", reason: `Error leyendo PDF: ${error.message}` });
      continue;
    }

    if (qualityFromText(text) === "baja") {
      records.push({ fileName, status: "no_publicar", reason: "Baja calidad de extraccion de texto." });
      continue;
    }

    const entry = buildEntry({ fileName, filePath, parsed, text, manual });
    records.push({ fileName, status: "candidate", entry });
  }

  return records;
}

async function updatePackageScript() {
  const packagePath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(await fsp.readFile(packagePath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts["generate:seo"] = "node scripts/generate-seo-convenios.js";
  await fsp.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function updateFirebaseRewrites(generatedEntries) {
  const config = JSON.parse(await fsp.readFile(FIREBASE_JSON, "utf8"));
  const rewrites = config.hosting.rewrites || [];
  const protectedRewrites = rewrites.filter((rewrite) => {
    if (!rewrite.source) return true;
    if (rewrite.source === "**") return false;
    if (rewrite.source === "/convenios") return false;
    return !rewrite.source.startsWith("/convenios/");
  });
  const fallback = rewrites.find((rewrite) => rewrite.source === "**") || { source: "**", destination: "/index.html" };
  const seoRewrites = [
    { source: "/convenios", destination: "/seo/convenios.html" },
    ...generatedEntries.map((entry) => ({
      source: `/convenios/${entry.slug}`,
      destination: `/seo/${entry.slug}.html`,
    })),
  ];
  config.hosting.rewrites = [...protectedRewrites, ...seoRewrites, fallback];
  await fsp.writeFile(FIREBASE_JSON, `${JSON.stringify(config, null, 2)}\n`);
}

function validateNoYearInPublicFields(entry) {
  const publicFields = [
    entry.slug,
    entry.title,
    entry.content.resumen,
    entry.content.vigencia,
    entry.content.ambito,
    entry.content.jornada_anual,
    entry.content.vacaciones,
    entry.content.festivos_descansos,
    entry.content.permisos,
    entry.content.horas_extra,
    entry.content.nocturnidad,
    entry.content.descansos,
    entry.content.pluses,
    entry.content.categorias,
    entry.content.fuente_oficial,
    ...entry.faq.flatMap((item) => [item.question, item.answer]),
  ];
  return !publicFields.some((field) => /\b(19|20)\d{2}\b/.test(removePublicYears(field)));
}

function validateRenderedPages(generatedEntries) {
  const seenTitles = new Set();
  const seenDescriptions = new Set();
  const issues = [];

  for (const entry of generatedEntries) {
    const html = renderPage(entry, generatedEntries);
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
    const description = html.match(/<meta name="description" content="([^"]+)">/i)?.[1] || "";
    const checks = [
      ["title", /<title>[^<]+<\/title>/i],
      ["meta_description", /<meta name="description" content="[^"]+">/i],
      ["canonical", /<link rel="canonical" href="[^"]+">/i],
      ["open_graph", /<meta property="og:title" content="[^"]+">/i],
      ["twitter_cards", /<meta name="twitter:card" content="[^"]+">/i],
      ["json_ld", /<script type="application\/ld\+json">/i],
      ["app_links", /href="\/"/i],
    ];

    for (const [name, pattern] of checks) {
      if (!pattern.test(html)) {
        issues.push({ slug: entry.slug, issue: `Falta ${name}.` });
      }
    }

    if (entry.faq.length >= 3 && !/<section class="faq" id="faq">/i.test(html)) {
      issues.push({ slug: entry.slug, issue: "Falta FAQ pese a existir contenido suficiente." });
    }

    if (seenTitles.has(title)) {
      issues.push({ slug: entry.slug, issue: `Title duplicado: ${title}` });
    }
    if (seenDescriptions.has(description)) {
      issues.push({ slug: entry.slug, issue: `Meta description duplicada: ${description}` });
    }
    seenTitles.add(title);
    seenDescriptions.add(description);
  }

  const listing = renderListing(generatedEntries);
  const listingChecks = [
    ["listing_title", /<title>[^<]+<\/title>/i],
    ["listing_meta_description", /<meta name="description" content="[^"]+">/i],
    ["listing_canonical", /<link rel="canonical" href="[^"]+">/i],
    ["listing_open_graph", /<meta property="og:title" content="[^"]+">/i],
    ["listing_twitter_cards", /<meta name="twitter:card" content="[^"]+">/i],
    ["listing_json_ld", /<script type="application\/ld\+json">/i],
    ["listing_app_links", /href="\/"/i],
  ];
  for (const [name, pattern] of listingChecks) {
    if (!pattern.test(listing)) {
      issues.push({ slug: "convenios", issue: `Falta ${name}.` });
    }
  }

  return issues;
}

function buildContentReport(generatedEntries) {
  const fields = [
    ["vigencia", "Vigencia"],
    ["jornada_anual", "Jornada anual"],
    ["vacaciones", "Vacaciones"],
    ["permisos", "Permisos"],
    ["horas_extra", "Horas extra"],
    ["nocturnidad", "Nocturnidad"],
    ["descansos", "Descansos"],
    ["festivos_descansos", "Festivos"],
    ["fuente_oficial", "Fuente oficial/boletin"],
    ["fuente_url", "URL del boletin"],
  ];
  const byField = fields.map(([key, label]) => {
    const extracted = generatedEntries.filter((entry) => isFound(entry.content[key]));
    const missing = generatedEntries.filter((entry) => !isFound(entry.content[key]));
    return {
      field: key,
      label,
      extracted: extracted.length,
      missing: missing.length,
      missingSlugs: missing.map((entry) => entry.slug),
    };
  });
  const pages = generatedEntries.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    extracted: fields.filter(([key]) => isFound(entry.content[key])).map(([, label]) => label),
    notLocated: fields.filter(([key]) => !isFound(entry.content[key])).map(([, label]) => label),
    links: {
      app: 3,
      sameSector: buildRelatedBySector(entry, generatedEntries).length,
      sameProvince: buildRelatedByProvince(entry, generatedEntries).length,
      index: 2,
    },
  }));
  const totals = {
    extracted: byField.reduce((sum, item) => sum + item.extracted, 0),
    missing: byField.reduce((sum, item) => sum + item.missing, 0),
    internalLinksAdded: pages.reduce((sum, page) => sum + page.links.app + page.links.sameSector + page.links.sameProvince + page.links.index, 0),
  };

  return { fields: byField, pages, totals };
}

function detectDuplicateRisks(generatedEntries) {
  const risks = [];
  const genericByPage = generatedEntries
    .map((entry) => ({
      slug: entry.slug,
      missing: CONTENT_FIELDS.filter((field) => !isFound(entry.content[field])).length,
    }))
    .filter((item) => item.missing >= 4);

  if (genericByPage.length) {
    risks.push(`Hay ${genericByPage.length} paginas con 4 o mas campos no localizados; conviene enriquecerlas para reducir similitud textual.`);
  }

  const bySector = new Map();
  generatedEntries.forEach((entry) => {
    bySector.set(entry.sector, (bySector.get(entry.sector) || 0) + 1);
  });
  Array.from(bySector.entries()).forEach(([sector, count]) => {
    if (count >= 8) {
      risks.push(`El sector ${sector} concentra ${count} paginas; revisar snippets especificos de jornada/vacaciones para evitar patrones repetidos.`);
    }
  });

  if (!risks.length) {
    risks.push("Riesgo moderado: las paginas comparten estructura, pero titles, descriptions, canonicals, enlaces y datos extraidos son especificos por convenio.");
  }

  return risks;
}

function buildManualRecoveryReport(generatedEntries) {
  const manualPages = generatedEntries.filter((entry) => entry.source.manual_verified);
  return {
    newPublished: manualPages.map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      documento: entry.source.documento,
    })),
    recoveredData: manualPages.map((entry) => ({
      slug: entry.slug,
      fields: entry.source.manual_fields || [],
    })).filter((item) => item.fields.length),
    officialSources: generatedEntries
      .filter((entry) => isFound(entry.content.fuente_oficial) || isFound(entry.content.fuente_url))
      .map((entry) => ({
        slug: entry.slug,
        source: isFound(entry.content.fuente_oficial) ? entry.content.fuente_oficial : null,
        url: isFound(entry.content.fuente_url) ? entry.content.fuente_url : null,
      })),
  };
}

function renderAuditMarkdown(inventory) {
  const lines = [
    "# Informe SEO de convenios",
    "",
    `Generado: ${inventory.generatedAt}`,
    "",
    "## Resumen",
    "",
    `- Convenios publicados: ${inventory.summary.published}`,
    `- Requieren pequenas correcciones: ${inventory.summary.needsCorrections}`,
    `- No publicar / descartados: ${inventory.summary.doNotPublish}`,
    `- Incidencias SEO detectadas: ${inventory.summary.seoIssues}`,
    `- Datos extraidos correctamente: ${inventory.summary.dataExtracted}`,
    `- Datos no localizados: ${inventory.summary.dataMissing}`,
    `- Enlaces internos contabilizados: ${inventory.summary.internalLinksAdded}`,
    `- Nuevos convenios publicados: ${inventory.manualRecovery.newPublished.length}`,
    `- Fuentes oficiales con URL: ${inventory.manualRecovery.officialSources.filter((item) => item.url).length}`,
    "",
    "## Nuevos convenios publicados",
    "",
    ...(inventory.manualRecovery.newPublished.length
      ? inventory.manualRecovery.newPublished.map((item) => `- ${item.title} (${item.slug}) desde ${item.documento}.`)
      : ["- Ninguno."]),
    "",
    "## Datos recuperados con metadata manual verificada",
    "",
    ...(inventory.manualRecovery.recoveredData.length
      ? inventory.manualRecovery.recoveredData.map((item) => `- ${item.slug}: ${item.fields.join(", ")}.`)
      : ["- Ninguno."]),
    "",
    "## Fuentes oficiales añadidas",
    "",
    ...(inventory.manualRecovery.officialSources.length
      ? inventory.manualRecovery.officialSources.map((item) => `- ${item.slug}: ${item.source || "Fuente no localizada"}${item.url ? ` (${item.url})` : ""}.`)
      : ["- Ninguna."]),
    "",
    "## Paginas mejoradas",
    "",
    ...inventory.contentReport.pages.map((page) => `- ${page.title} (${page.slug}): extraido ${page.extracted.join(", ") || "ningun campo"}; no localizado ${page.notLocated.join(", ") || "ninguno"}; enlaces app ${page.links.app}, sector ${page.links.sameSector}, provincia ${page.links.sameProvince}, indice ${page.links.index}.`),
    "",
    "## Datos extraidos por campo",
    "",
    ...inventory.contentReport.fields.map((item) => `- ${item.label}: ${item.extracted} extraidos, ${item.missing} no localizados.`),
    "",
    "## Requieren pequenas correcciones",
    "",
    ...(inventory.needsCorrections.length
      ? inventory.needsCorrections.map((item) => `- ${item.fileName}${item.slug ? ` (${item.slug})` : ""}: ${item.reason}`)
      : ["- Ninguno."]),
    "",
    "## No publicar",
    "",
    ...(inventory.doNotPublish.length
      ? inventory.doNotPublish.map((item) => `- ${item.fileName}${item.slug ? ` (${item.slug})` : ""}: ${item.reason}`)
      : ["- Ninguno."]),
    "",
    "## Validacion SEO",
    "",
    ...(inventory.seoValidation.issues.length
      ? inventory.seoValidation.issues.map((item) => `- ${item.slug}: ${item.issue}`)
      : ["- Todas las paginas publicadas incluyen title unico, meta description unica, canonical, Open Graph, Twitter Cards, JSON-LD y enlaces hacia la aplicacion."]),
    "",
    "## Riesgos de contenido duplicado",
    "",
    ...inventory.duplicateRisks.map((item) => `- ${item}`),
    "",
    "## Posibles mejoras detectadas",
    "",
    ...inventory.improvements.map((item) => `- ${item}`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

async function main() {
  await fsp.mkdir(SEO_DIR, { recursive: true });
  await fsp.mkdir(SEO_DATA_DIR, { recursive: true });

  const records = await buildRecords();
  const { selected, needsCorrections, doNotPublish } = chooseCandidates(records);
  const generatedEntries = selected.map((record) => record.entry);

  for (const entry of generatedEntries) {
    await fsp.writeFile(path.join(SEO_DIR, `${entry.slug}.html`), renderPage(entry, generatedEntries));
  }

  await fsp.writeFile(path.join(SEO_DIR, "convenios.html"), renderListing(generatedEntries));
  await fsp.writeFile(SITEMAP_XML, renderSitemap(generatedEntries));
  await fsp.writeFile(ROBOTS_TXT, ensureRobots());
  await updateFirebaseRewrites(generatedEntries);
  await updatePackageScript();

  const seoIssues = validateRenderedPages(generatedEntries);
  const normalizedNeedsCorrections = needsCorrections.map((item) => ({
    fileName: item.fileName,
    slug: item.entry && item.entry.slug,
    reason: item.reason,
  }));
  const normalizedDoNotPublish = doNotPublish.map((item) => ({
    fileName: item.fileName,
    slug: item.entry && item.entry.slug,
    reason: item.reason,
  }));
  const contentReport = buildContentReport(generatedEntries);
  const duplicateRisks = detectDuplicateRisks(generatedEntries);
  const manualRecovery = buildManualRecoveryReport(generatedEntries);
  const improvements = [
    "Revisar manualmente las paginas que aun no tienen jornada anual o vacaciones localizadas para evitar completar datos sin evidencia suficiente.",
    "Sustituir URLs base de boletines por URLs profundas a cada anuncio cuando se incorpore un repositorio oficial de enlaces.",
    "Mantener el JSON manual como fuente pequena y auditada; evitar usarlo para datos no contrastados en PDF o boletin oficial.",
  ];

  const inventory = {
    generatedAt: new Date().toISOString(),
    classificationCriteria: {
      publish: "PDF legible, metadata suficiente, convenio provincial, no partido, sin duplicado mas reciente y al menos 4 bloques tematicos localizados.",
      needsCorrections: "Documento potencialmente util con incidencias pequenas: PDF partido, metadata ambigua o extraccion tematica mejorable.",
      doNotPublish: "No es convenio especifico, PDF ilegible, texto insuficiente o duplicado sustituido por otro documento.",
    },
    summary: {
      published: generatedEntries.length,
      needsCorrections: normalizedNeedsCorrections.length,
      doNotPublish: normalizedDoNotPublish.length,
      seoIssues: seoIssues.length,
      dataExtracted: contentReport.totals.extracted,
      dataMissing: contentReport.totals.missing,
      internalLinksAdded: contentReport.totals.internalLinksAdded,
    },
    generated: generatedEntries,
    contentReport,
    duplicateRisks,
    manualRecovery,
    needsCorrections: normalizedNeedsCorrections,
    doNotPublish: normalizedDoNotPublish,
    seoValidation: {
      checked: [
        "title unico",
        "meta description unica",
        "canonical",
        "Open Graph",
        "Twitter Cards",
        "JSON-LD",
        "FAQ cuando hay contenido suficiente",
        "enlaces hacia la aplicacion",
      ],
      issues: seoIssues,
    },
    improvements,
  };

  await fsp.writeFile(path.join(SEO_DATA_DIR, "convenios.generated.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  await fsp.writeFile(path.join(SEO_DATA_DIR, "convenios.audit.md"), renderAuditMarkdown(inventory));

  console.log(`SEO generado: ${generatedEntries.length} paginas.`);
  console.log(`Requieren pequenas correcciones: ${inventory.needsCorrections.length}`);
  console.log(`No publicar: ${inventory.doNotPublish.length}`);
  console.log(`Incidencias SEO: ${inventory.seoValidation.issues.length}`);
  console.log("Paginas:");
  generatedEntries.forEach((entry) => console.log(`- /convenios/${entry.slug}`));
}

main().catch((error) => {
  console.error("Error generando SEO de convenios:", error);
  process.exitCode = 1;
});
