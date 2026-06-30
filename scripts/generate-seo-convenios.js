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
const SITE_URL = "https://balancelaboral.es";
const PILOT_SLUGS = new Set([
  "hosteleria-gipuzkoa",
  "alojamientos-gipuzkoa",
  "hosteleria-bizkaia",
]);
const MAX_NEW_PAGES = 10;
const NOT_FOUND = "No localizado en el texto disponible";

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

function extractHourValue(fragment) {
  const match = fragment.match(/\b1[.,]\d{3}\s*horas?\b/i);
  return match ? match[0].replace(".", ".") : "";
}

function extractContent(text, sector, province) {
  const jornadaFragment = findFirst(text, [/jornada (anual|laboral|de trabajo)/i, /c[oó]mputo anual/i], 1200);
  const jornadaHour = extractHourValue(jornadaFragment);
  const vacacionesFragment = findFirst(text, [/vacaciones/i, /vacaci[oó]n anual/i], 1200);
  const festivosFragment = findFirst(text, [/festivos/i, /d[ií]as festivos/i, /fiestas retribuidas/i], 1200);
  const permisosFragment = findFirst(text, [/permisos y licencias/i, /licencias/i], 1200);
  const horasExtraFragment = findFirst(text, [/horas extraordinarias/i, /horas extras/i], 1200);
  const plusesFragment = findFirst(text, [/plus/i, /complementos?/i, /nocturnidad/i], 1200);
  const categoriasFragment = findFirst(text, [/categor[ií]as profesionales/i, /grupos profesionales/i, /clasificaci[oó]n profesional/i], 1200);
  const ambitoFragment = findFirst(text, [/[aá]mbito territorial/i, /[aá]mbito funcional/i], 1600);

  const jornada = jornadaHour
    ? `Jornada anual localizada: ${jornadaHour}.`
    : NOT_FOUND;

  const vacaciones = /30\s*(?:\(|treinta\))?\s*d[ií]as|30\s*d[ií]as/i.test(vacacionesFragment)
    ? "Vacaciones anuales localizadas: 30 dias naturales."
    : NOT_FOUND;

  let festivos = NOT_FOUND;
  if (/75\s*%/.test(festivosFragment) && /50\s*%/.test(festivosFragment)) {
    festivos = "Festivos trabajados localizados: compensacion economica con incremento del 75% o descanso posterior con aumento del 50%.";
  } else if (/fiestas retribuidas|festivos/i.test(festivosFragment)) {
    festivos = "Reglas sobre festivos trabajados localizadas en el documento.";
  }

  const permisos = /matrimonio|fallecimiento|hospitalizaci[oó]n|enfermedad grave|licencia/i.test(permisosFragment)
    ? "Articulo o cuadro de permisos y licencias localizado en el documento."
    : NOT_FOUND;

  const horasExtra = /no podr[aá]n efectuarse|norma general|horas extraordinarias|horas extras/i.test(horasExtraFragment)
    ? "Reglas sobre horas extra localizadas en el documento."
    : NOT_FOUND;

  const pluses = /plus|complemento|nocturnidad|antig[uü]edad|transporte/i.test(plusesFragment)
    ? "Pluses o complementos localizados en el documento."
    : NOT_FOUND;

  const categorias = /categor|grupos profesionales|clasificaci[oó]n profesional/i.test(categoriasFragment)
    ? "Categorias o grupos profesionales localizados en el documento."
    : NOT_FOUND;

  const ambito = ambitoFragment
    ? `Ambito del convenio localizado para el sector ${SECTOR_CONFIG[sector].label.toLowerCase()} en ${titleCase(province)}.`
    : NOT_FOUND;

  return {
    resumen: `Resumen orientativo del convenio colectivo de ${SECTOR_CONFIG[sector].label.toLowerCase()} de ${titleCase(province)}, elaborado a partir del texto disponible en Balance Laboral.`,
    ambito,
    jornada_anual: jornada,
    vacaciones,
    festivos_descansos: festivos,
    permisos,
    horas_extra: horasExtra,
    pluses,
    categorias,
  };
}

function buildFaq(entry) {
  const label = entry.sectorLabel.toLowerCase();
  const province = entry.provinciaDisplay;
  return [
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
      question: "Existen pluses?",
      answer: entry.content.pluses,
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
}

function buildEntry({ fileName, filePath, parsed, text }) {
  const sector = pickSector(fileName, parsed);
  const province = parsed.province;
  const sectorLabel = SECTOR_CONFIG[sector].label;
  const provinciaDisplay = titleCase(province);
  const slug = buildSlug(sector, province);
  const content = extractContent(text, sector, province);

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
    `        <p>${escapeHtml(removePublicYears(text))}</p>`,
    "      </section>",
  ].join("\n");
}

function buildRelated(entry, generatedEntries) {
  return generatedEntries
    .filter((candidate) => candidate.slug !== entry.slug)
    .sort((a, b) => {
      const sameSectorA = a.sector === entry.sector ? 0 : 1;
      const sameSectorB = b.sector === entry.sector ? 0 : 1;
      return sameSectorA - sameSectorB || a.title.localeCompare(b.title, "es");
    })
    .slice(0, 4);
}

function buildSchema(entry) {
  const url = `${SITE_URL}/convenios/${entry.slug}`;
  const faqId = `${url}#faq`;
  const breadcrumbId = `${url}#breadcrumb`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: entry.title,
        description: `${entry.title}: resumen orientativo con jornada anual, vacaciones, festivos, permisos y horas extra segun el documento base analizado.`,
        inLanguage: "es",
        isPartOf: {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: "Balance Laboral",
          url: `${SITE_URL}/`,
        },
        breadcrumb: { "@id": breadcrumbId },
        mainEntity: { "@id": faqId },
        about: [
          { "@type": "Thing", name: `Convenio colectivo de ${entry.sectorLabel.toLowerCase()}` },
          { "@type": "Thing", name: `Sector ${entry.sectorLabel.toLowerCase()}` },
          { "@type": "Place", name: entry.provinciaDisplay },
          { "@type": "Thing", name: "Jornada anual" },
          { "@type": "Thing", name: "Vacaciones" },
          { "@type": "Thing", name: "Festivos" },
          { "@type": "Thing", name: "Permisos y licencias" },
          { "@type": "Thing", name: "Horas extra" },
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
      {
        "@type": "FAQPage",
        "@id": faqId,
        inLanguage: "es",
        mainEntity: entry.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: removePublicYears(item.answer),
          },
        })),
      },
    ],
  };
}

function renderPage(entry, generatedEntries) {
  const related = buildRelated(entry, generatedEntries);
  const description = `${entry.title}: jornada anual, vacaciones, festivos, permisos, horas extra y pluses segun el documento base analizado.`;
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
  const relatedHtml = related.map((item) => `          <li><a href="/convenios/${item.slug}">${escapeHtml(item.title)}</a></li>`).join("\n");
  const faqHtml = entry.faq.map((item) => {
    return `          <article class="faq-item"><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(removePublicYears(item.answer))}</p></article>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="keywords" content="${escapeHtml(keywords)}">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#24344d">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="es_ES">
  <meta property="og:title" content="${escapeHtml(entry.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${SITE_URL}/convenios/${entry.slug}">
  <meta property="og:site_name" content="Balance Laboral">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(entry.title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${SITE_URL}/convenios/${entry.slug}">
  <link rel="icon" type="image/png" sizes="32x32" href="../assets/icons/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="../src/css/convenios.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <title>${escapeHtml(entry.title)} | Jornada, vacaciones y permisos</title>
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
    <article class="article-shell">
      <section class="hero">
        <p class="eyebrow">${escapeHtml(entry.sectorLabel)} · ${escapeHtml(entry.provinciaDisplay)}</p>
        <h1>${escapeHtml(entry.title)}</h1>
        <p class="lead">Para trabajadores del sector ${escapeHtml(entry.sectorLabel.toLowerCase())} en ${escapeHtml(entry.provinciaDisplay)} que buscan jornada anual, vacaciones, festivos, permisos y horas extra.</p>
        <ul class="hero-points" aria-label="Contenido principal">
          <li>Jornada anual</li>
          <li>Vacaciones</li>
          <li>Festivos</li>
          <li>Permisos</li>
          <li>Horas extra</li>
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
          <div class="summary-item"><dt>Fuente</dt><dd>Convenio colectivo de ${escapeHtml(entry.sectorLabel.toLowerCase())} de ${escapeHtml(entry.provinciaDisplay)}</dd></div>
          <div class="summary-item"><dt>Jornada anual</dt><dd>${escapeHtml(removePublicYears(entry.content.jornada_anual))}</dd></div>
          <div class="summary-item"><dt>Vacaciones</dt><dd>${escapeHtml(removePublicYears(entry.content.vacaciones))}</dd></div>
          <div class="summary-item"><dt>Festivos</dt><dd>${escapeHtml(removePublicYears(entry.content.festivos_descansos))}</dd></div>
          <div class="summary-item"><dt>Permisos</dt><dd>${escapeHtml(removePublicYears(entry.content.permisos))}</dd></div>
          <div class="summary-item"><dt>Horas extra</dt><dd>${escapeHtml(removePublicYears(entry.content.horas_extra))}</dd></div>
          <div class="summary-item"><dt>Categorias</dt><dd>${escapeHtml(removePublicYears(entry.content.categorias))}</dd></div>
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
          <li><a href="#ambito">Ambito</a></li>
          <li><a href="#jornada-anual">Jornada anual</a></li>
          <li><a href="#vacaciones">Vacaciones</a></li>
          <li><a href="#festivos">Festivos</a></li>
          <li><a href="#permisos">Permisos</a></li>
          <li><a href="#horas-extra">Horas extra</a></li>
          <li><a href="#pluses">Pluses</a></li>
          <li><a href="#categorias">Categorias</a></li>
        </ul>
      </nav>

${sectionHtml("fuente", "Fuente de la informacion", `Convenio colectivo de ${entry.sectorLabel.toLowerCase()} de ${entry.provinciaDisplay}. Informacion extraida y resumida a partir del texto del convenio disponible en Balance Laboral. Consulta siempre la version oficial vigente o asesoramiento profesional.`)}
${sectionHtml("resumen", "Resumen practico", entry.content.resumen)}
${sectionHtml("ambito", "Ambito del convenio", entry.content.ambito)}
${sectionHtml("jornada-anual", "Jornada anual", entry.content.jornada_anual)}
${sectionHtml("vacaciones", "Vacaciones", entry.content.vacaciones)}
${sectionHtml("festivos", "Festivos y descansos", entry.content.festivos_descansos)}
${sectionHtml("permisos", "Permisos/licencias", entry.content.permisos)}
${sectionHtml("horas-extra", "Horas extra", entry.content.horas_extra)}
${sectionHtml("pluses", "Pluses/complementos", entry.content.pluses)}
${sectionHtml("categorias", "Categorias profesionales", entry.content.categorias)}

      <section class="faq" id="faq">
        <h2>Preguntas frecuentes sobre ${escapeHtml(entry.title.toLowerCase())}</h2>
        <div class="faq-list">
${faqHtml}
        </div>
      </section>

      <section class="related-box" aria-labelledby="relacionados">
        <h2 id="relacionados">Convenios relacionados</h2>
        <ul class="related-list">
${relatedHtml}
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

  const cards = groups.map((group) => {
    const items = group.items.map((entry) => `          <article class="listing-card">
            <p class="card-kicker">${escapeHtml(entry.provinciaDisplay)}</p>
            <h3><a href="/convenios/${entry.slug}">${escapeHtml(entry.title)}</a></h3>
            <p>Jornada anual, vacaciones, festivos, permisos y horas extra segun el documento base analizado.</p>
          </article>`).join("\n");
    return `      <section aria-labelledby="grupo-${group.sector}">
        <h2 id="grupo-${group.sector}">${escapeHtml(group.label)}</h2>
        <div class="cards-grid">
${items}
        </div>
      </section>`;
  }).join("\n\n");

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
    <section class="hero">
      <p class="eyebrow">Convenios colectivos</p>
      <h1>Convenios laborales: jornada, vacaciones, festivos y permisos</h1>
      <p class="lead">Elige tu convenio para ver un resumen rapido del documento base analizado y usar Balance Laboral para calcular horas o preguntar a la IA.</p>
    </section>

    <section class="notice" aria-label="Aviso importante">
      <strong>Informacion orientativa.</strong> Consulta siempre el convenio oficial vigente o asesoramiento profesional.
    </section>

${cards}

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
  const review = [];
  const omitted = [];

  for (const record of records) {
    if (record.status !== "candidate") {
      if (record.status === "revisar") review.push(record);
      else omitted.push(record);
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
      review.push({ ...existing, reason: `Duplicado para ${record.entry.slug}; sustituido por documento mas reciente.` });
      bySlug.set(record.entry.slug, record);
    } else {
      review.push({ ...record, reason: `Duplicado para ${record.entry.slug}; existe documento igual o mas reciente.` });
    }
  }

  const ordered = Array.from(bySlug.values()).sort((a, b) => {
    const pa = PRIORITY_SLUGS.indexOf(a.entry.slug);
    const pb = PRIORITY_SLUGS.indexOf(b.entry.slug);
    const priorityA = pa === -1 ? Number.MAX_SAFE_INTEGER : pa;
    const priorityB = pb === -1 ? Number.MAX_SAFE_INTEGER : pb;
    return priorityA - priorityB || a.entry.title.localeCompare(b.entry.title, "es");
  });

  const maxTotal = PILOT_SLUGS.size + MAX_NEW_PAGES;
  const selected = [];
  let newPages = 0;

  for (const record of ordered) {
    if (PILOT_SLUGS.has(record.entry.slug)) {
      selected.push(record);
      continue;
    }
    if (newPages < MAX_NEW_PAGES && PRIORITY_SLUGS.includes(record.entry.slug)) {
      selected.push(record);
      newPages += 1;
      continue;
    }
    review.push({ ...record, reason: newPages >= MAX_NEW_PAGES ? "Fuera del limite actual de 10 paginas nuevas." : "Fuera de la priorizacion actual." });
  }

  return {
    selected: selected.slice(0, maxTotal),
    review,
    omitted,
  };
}

async function buildRecords() {
  const files = await listPdfFiles();
  const records = [];

  for (const fileName of files) {
    const parsed = parseConvenioFileName(fileName);
    const filePath = path.join(PROCESSED_DIR, fileName);
    const normalized = normalizeText(fileName);

    if (normalized.startsWith("estatuto trabajadores")) {
      records.push({ fileName, status: "omitir", reason: "No es convenio provincial especifico." });
      continue;
    }

    if (hasPartMarker(fileName)) {
      records.push({ fileName, status: "revisar", reason: "PDF partido o parte no fusionada." });
      continue;
    }

    if (detectBrokenMetadata(fileName, parsed)) {
      records.push({ fileName, status: "revisar", reason: "Metadata ambigua o rota en nombre de archivo." });
      continue;
    }

    const sector = pickSector(fileName, parsed);
    if (!sector) {
      records.push({ fileName, status: "revisar", reason: "Sector no detectado." });
      continue;
    }

    let text = "";
    try {
      text = await loadPdfText(filePath);
    } catch (error) {
      records.push({ fileName, status: "revisar", reason: `Error leyendo PDF: ${error.message}` });
      continue;
    }

    if (qualityFromText(text) === "baja") {
      records.push({ fileName, status: "revisar", reason: "Baja calidad de extraccion de texto." });
      continue;
    }

    const entry = buildEntry({ fileName, filePath, parsed, text });
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
    entry.content.ambito,
    entry.content.jornada_anual,
    entry.content.vacaciones,
    entry.content.festivos_descansos,
    entry.content.permisos,
    entry.content.horas_extra,
    entry.content.pluses,
    entry.content.categorias,
    ...entry.faq.flatMap((item) => [item.question, item.answer]),
  ];
  return !publicFields.some((field) => /\b(19|20)\d{2}\b/.test(removePublicYears(field)));
}

async function main() {
  await fsp.mkdir(SEO_DIR, { recursive: true });
  await fsp.mkdir(SEO_DATA_DIR, { recursive: true });

  const records = await buildRecords();
  const { selected, review, omitted } = chooseCandidates(records);
  const generatedEntries = selected.map((record) => record.entry);

  for (const entry of generatedEntries) {
    if (!validateNoYearInPublicFields(entry)) {
      entry.source.status = "revisar";
      review.push({ fileName: entry.source.documento, status: "revisar", reason: "Se detectaron años en campos publicos.", entry });
      continue;
    }
    await fsp.writeFile(path.join(SEO_DIR, `${entry.slug}.html`), renderPage(entry, generatedEntries));
  }

  await fsp.writeFile(path.join(SEO_DIR, "convenios.html"), renderListing(generatedEntries));
  await fsp.writeFile(SITEMAP_XML, renderSitemap(generatedEntries));
  await fsp.writeFile(ROBOTS_TXT, ensureRobots());
  await updateFirebaseRewrites(generatedEntries);
  await updatePackageScript();

  const inventory = {
    generatedAt: new Date().toISOString(),
    limits: {
      maxNewPages: MAX_NEW_PAGES,
      pilotSlugs: Array.from(PILOT_SLUGS),
    },
    generated: generatedEntries,
    omitted: omitted.map((item) => ({ fileName: item.fileName, reason: item.reason })),
    review: review.map((item) => ({
      fileName: item.fileName,
      slug: item.entry && item.entry.slug,
      reason: item.reason,
    })),
  };

  await fsp.writeFile(path.join(SEO_DATA_DIR, "convenios.generated.json"), `${JSON.stringify(inventory, null, 2)}\n`);

  console.log(`SEO generado: ${generatedEntries.length} paginas (${generatedEntries.filter((entry) => !PILOT_SLUGS.has(entry.slug)).length} nuevas + ${generatedEntries.filter((entry) => PILOT_SLUGS.has(entry.slug)).length} piloto).`);
  console.log(`Omitidos: ${inventory.omitted.length}`);
  console.log(`En revision: ${inventory.review.length}`);
  console.log("Paginas:");
  generatedEntries.forEach((entry) => console.log(`- /convenios/${entry.slug}`));
}

main().catch((error) => {
  console.error("Error generando SEO de convenios:", error);
  process.exitCode = 1;
});
