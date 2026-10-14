const path = require("path");

const CATALOGO_CONVENIOS = "catalogo_convenios";

const FILE_METADATA_OVERRIDES = {
  "Convenio Transporte Alava 201-2026.pdf": {
    yearStart: 2020,
    yearEnd: 2026,
    catalogKey: "transporte_alava_2026_2026",
    officialCode: "01100085162024",
    publication: {
      bulletin: "BOTHA",
      number: 16,
      date: "2024-02-07",
      identifier: "2024-00290",
      url: "https://www.araba.eus/botha/Boletines/2024/016/2024_016_00290_C.pdf",
    },
    legalEffect: "extraestatutario_eficacia_limitada",
    applicationWarning: "Este acuerdo se identifica oficialmente como extraestatutario y de eficacia limitada. Que el texto exista no confirma que se aplique a todas las empresas o personas del sector; para valorar su aplicación hay que comprobar la cobertura de la representación negociadora o una adhesión expresa y las circunstancias del caso.",
    sourceVerification: "verified",
  },
  "Convenio Limpieza edificios Zaragoza 2026-2029.pdf": {
    catalogKey: "limpieza_zaragoza_2026_2029",
    officialCode: "50000755011981",
    publication: {
      bulletin: "BOPZ",
      number: 216,
      date: "2026-09-19",
      identifier: "6181",
      url: "https://bop.dpz.es/BOPZ/UploadServlet?ruta=Boletines%5C2026%5C216%5Cbop.pdf",
    },
    officialSourceUrl: "https://bop.dpz.es/BOPZ/UploadServlet?ruta=Boletines%5C2026%5C216%5Cbop.pdf",
    sourceSha256: "004745dd7a5e0afd7df584a8c83a22afd1bb7d7b8a1641cd5f0cada05325a070",
    sourceStorageUri: "gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/zaragoza-limpieza/2026/BOPZ-216-6181.pdf",
    sourcePageCount: 33,
    sourceDocumentType: "collective_agreement",
    sourceVerification: "verified",
    applicationWarning: "El periodo 2026–2029 identifica el texto pactado incorporado; sus fechas no confirman por sí solas su aplicabilidad jurídica a una empresa o persona concreta.",
  },
  "Convenio Alojamientos y Hostelería Malaga parte 1.pdf": {
    yearStart: 2018,
    yearEnd: 2022,
    sourceVerification: "verified",
  },
  "Convenio Alojamientos y Hostelería Malaga parte 2 2018-2027.pdf": {
    yearStart: 2018,
    yearEnd: 2027,
    officialCode: "29000945011981",
    publication: {
      bulletin: "BOPMA",
      number: 24,
      date: "2024-02-02",
      identifier: "20240202-00115-2024",
      url: "https://www.bopmalaga.es/sumario.php?fecha=02-02-2024",
    },
    sourceVerification: "verified",
  },
  "Convenio Alojamientos y Hostelería Valencia2022-2025.pdf": {
    catalogKey: "alojamientos_hosteleria_sin_provincia_2025_2025",
  },
  "Convenio Transporte Barcelona 2011-2023.pdf": {
    sourceVerification: "unverified",
    documentaryWarning: "El PDF local indica 2011–2023. El BOPB publicó un convenio sectorial posterior de transporte de mercancías por carretera y logística para 2023–2025 (código 08004295011994) y tablas definitivas de 2025 en 2026. No presentar el PDF local como edición actual; el texto posterior debe descargarse, cotejarse por ámbito e incorporarse antes de responder sobre condiciones actuales.",
  },
  "BOPB-2026-03-16-08004295011994-tablas-2025.pdf": {
    catalogKey: "transporte_barcelona_tablas_2025",
    catalogTitle: "Tablas salariales 2025 — Transporte de mercancías Barcelona",
    province: "BARCELONA",
    sectorKeys: ["transporte"],
    yearStart: 2025,
    yearEnd: 2025,
    officialCode: "08004295011994",
    publication: {
      bulletin: "BOPB",
      date: "2026-03-16",
      identifier: "CVE 202610047645",
      url: "https://bop.diba.cat/anuncio/ver-pdf/3910056",
    },
    officialSourceUrl: "https://bop.diba.cat/anuncio/ver-pdf/3910056",
    sourceSha256: "65ba6993bcbaa71e98ea257969f5ea0b66d401f01e33ed5811031c77d3267571",
    sourcePageCount: 5,
    sourceDocumentType: "salary_tables",
    sourceVerification: "verified",
    automaticIngestionEligible: true,
    salaryEvidenceVerifiedThroughYear: 2025,
    salaryEvidenceWarning: "Las tablas verificadas cubren 2025. No constan aquí tablas oficiales verificadas para 2026 ni se declara actualizado el convenio completo.",
    applicationWarning: "Publicación complementaria de tablas salariales definitivas de 2025; no sustituye el texto completo del convenio ni determina por sí sola la aplicabilidad a una persona o empresa.",
  },
  "BOG-2026-02-16-20100035012014-revision-salarial-2026.pdf": {
    catalogKey: "alojamientos_gipuzkoa_revision_salarial_2026",
    catalogTitle: "Revisión salarial 2026 — Alojamientos de Gipuzkoa",
    province: "GIPUZKOA",
    sectorKeys: ["alojamientos"],
    yearStart: 2026,
    yearEnd: 2026,
    officialCode: "20100035012014",
    publication: {
      bulletin: "BOG",
      number: 30,
      date: "2026-02-16",
      identifier: "GAO-I-2026-00553",
      url: "https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/16/c2600553.pdf",
    },
    officialSourceUrl: "https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/16/c2600553.pdf",
    sourceSha256: "a77d5fd34e2f1e54551ebea2eb0b51b18bbd6d0623f24ed50b89594e224c79a9",
    sourcePageCount: 3,
    sourceDocumentType: "salary_revision",
    sourceVerification: "verified",
    automaticIngestionEligible: true,
    salaryEvidenceVerifiedThroughYear: 2026,
    applicationWarning: "Revisión salarial publicada para 2026; complementa el convenio de alojamientos 2025–2028 y no determina por sí sola su aplicabilidad individual.",
  },
  "estatuto_trabajadores.pdf": {
    sourceVerification: "verified",
    officialCode: "BOE-A-2015-11430",
    sourceEdition: "PUB-DT-2025-139",
    sourceUpdatedThrough: "2025-12-04",
    sourceValidThrough: "2026-10-22",
    officialSourceUrl: "https://www.boe.es/biblioteca_juridica/pdf/PUB-DT-2025-139.pdf",
  },
  "estatuto_trabajadores_parte1.pdf": {
    sourceVerification: "verified",
    officialCode: "BOE-A-2015-11430",
    sourceEdition: "PUB-DT-2025-139",
    sourceUpdatedThrough: "2025-12-04",
    sourceValidThrough: "2026-10-22",
    officialSourceUrl: "https://www.boe.es/biblioteca_juridica/pdf/PUB-DT-2025-139.pdf",
  },
  "estatuto_trabajadores_parte2.pdf": {
    sourceVerification: "verified",
    officialCode: "BOE-A-2015-11430",
    sourceEdition: "PUB-DT-2025-139",
    sourceUpdatedThrough: "2025-12-04",
    sourceValidThrough: "2026-10-22",
    officialSourceUrl: "https://www.boe.es/biblioteca_juridica/pdf/PUB-DT-2025-139.pdf",
  },
  "estatuto_trabajadores_2026-10-03.pdf": {
    officialCode: "BOE-A-2015-11430",
    publication: {
      bulletin: "BOE",
      number: 246,
      date: "2026-10-03",
      identifier: "BOE-A-2026-20528",
      url: "https://www.boe.es/boe/dias/2026/10/03/pdfs/BOE-A-2026-20528.pdf",
    },
    sourceEdition: "BOE-A-2015-11430-consolidated-2026-10-03",
    sourceUpdatedThrough: "2026-10-03",
    sourceValidFrom: "2026-10-23",
    officialSourceUrl: "https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430&lang=es&p=20261003&tn=2",
    sourceSha256: "459825db621a952edf65e843715c25fe586a6d1e4b3facb0bb8fdcbedf16adab",
    sourceStorageUri: "gs://calendario-laboral-252b1.firebasestorage.app/official-sources/normativa/BOE-A-2015-11430/2026-10-03/consolidado.pdf",
    sourcePageCount: 97,
    sourceDocumentType: "consolidated_statute",
    sourceVerification: "verified",
  },
  "Convenio Transporte Gipuzkoa 2010-2014.pdf": {
    sourceVerification: "unverified",
    documentaryWarning: "El nombre local indica 2010–2014, pero el texto PDF identificado corresponde aparentemente a 2007–2009. No utilizarlo como edición confirmada.",
  },
  "Convenio Transporte GIPUZKOA 2007-2010.pdf": {
    yearStart: 2007,
    yearEnd: 2009,
    catalogKey: "transporte_gipuzkoa_2007_2010",
    sourceVerification: "unverified",
    documentaryWarning: "El texto local indica 2007–2009 y la copia vectorizada está incompleta. La publicación oficial individual y la integridad requieren cotejo.",
  },
  "Convenio Transporte GIPUZKOA 2007-2010parte1.pdf": {
    yearStart: 2007,
    yearEnd: 2009,
    catalogKey: "transporte_gipuzkoa_2007_2010",
    sourceVerification: "unverified",
    documentaryWarning: "Parte de una compilación del BOG; no seleccionar automáticamente sin cotejar integridad y publicación oficial.",
  },
  "Convenio Transporte GIPUZKOA 2007-2010parte2.pdf": {
    yearStart: 2007,
    yearEnd: 2009,
    catalogKey: "transporte_gipuzkoa_2007_2010",
    sourceVerification: "unverified",
    documentaryWarning: "Parte de una compilación del BOG; no seleccionar automáticamente sin cotejar integridad y publicación oficial.",
  },
};

const MALAGA_ORIGINAL_FILE = "Convenio Alojamientos y Hostelería Malaga parte 1.pdf";
const MALAGA_REVISION_FILE = "Convenio Alojamientos y Hostelería Malaga parte 2 2018-2027.pdf";
const MALAGA_PUBLICATIONS = [
  {
    fileName: MALAGA_ORIGINAL_FILE,
    role: "original",
    yearStart: 2018,
    yearEnd: 2022,
    officialCode: "29000945011981",
    bulletin: "BOPMA 162",
    publicationDate: "2018-08-23",
    identifier: "20180823-05720-2018",
    url: "https://www.bopmalaga.es/sumario.php?fecha=23-08-2018",
  },
  {
    fileName: MALAGA_REVISION_FILE,
    role: "revision",
    yearStart: 2018,
    yearEnd: 2027,
    officialCode: "29000945011981",
    bulletin: "BOPMA 24",
    publicationDate: "2024-02-02",
    identifier: "20240202-00115-2024",
    url: "https://www.bopmalaga.es/sumario.php?fecha=02-02-2024",
  },
];

const MALAGA_UNINDEXED_PUBLICATIONS = [
  {
    bulletin: "BOPMA 160",
    publicationDate: "2024-08-20",
    edict: "2957/2024",
    cve: "20240820-02957-2024",
    title: "Resolución de inscripción y publicación del Convenio Colectivo de Hostelería de Málaga y Provincia",
    url: "https://www.bopmalaga.es/sumario.php?fecha=20-08-2024",
    indexed: false,
    contentVerified: false,
  },
  {
    bulletin: "BOPMA 90",
    publicationDate: "2025-05-14",
    edict: "1559/2025",
    cve: "20250514-01559-2025",
    title: "Convenio Colectivo del Sector de la Hostelería de Málaga y provincia",
    url: "https://www.bopmalaga.es/sumario.php?fecha=14-05-2025",
    indexed: false,
    contentVerified: false,
  },
  {
    bulletin: "BOPMA 70",
    publicationDate: "2026-04-14",
    edict: "1187/2026",
    cve: "20260414-01187-2026",
    title: "Resolución sobre inscripción y publicación de las tablas salariales del sector de hostelería",
    url: "https://www.bopmalaga.es/sumario.php?fecha=14-04-2026",
    indexed: false,
    contentVerified: false,
  },
];

const MALAGA_UNINDEXED_SALARY_NOTICE = "El BOPMA publicó documentación posterior de Hostelería de Málaga, incluidos anuncios del sector en 2024 y 2025 y un anuncio de tablas salariales en 2026. El contenido íntegro de esas publicaciones no está indexado ni verificado aquí; no se deben confirmar importes salariales posteriores a 2022 con los fragmentos locales.";

const WORKERS_STATUTE_FILE_PATTERN = /^estatuto_trabajadores(?:_parte\d+|_\d{4}-\d{2}-\d{2})?$/i;

const COMMUNITY_BY_PROVINCE = {
  GIPUZKOA: "PAIS VASCO",
  BIZKAIA: "PAIS VASCO",
  ALAVA: "PAIS VASCO",
  NAVARRA: "NAVARRA",
  BARCELONA: "CATALUNA",
  MADRID: "COMUNIDAD DE MADRID",
  MALAGA: "ANDALUCIA",
  SEVILLA: "ANDALUCIA",
  VALENCIA: "COMUNIDAD VALENCIANA",
  ZARAGOZA: "ARAGON",
};

const LOCATION_ALIASES = {
  GIPUZKOA: ["gipuzkoa", "guipuzcoa", "donostia", "san sebastian", "donosti"],
  BIZKAIA: ["bizkaia", "vizcaya", "bilbao", "bilbo"],
  ALAVA: ["alava", "araba", "vitoria", "gasteiz"],
  NAVARRA: ["navarra", "nafarroa", "pamplona", "iruna", "iruña"],
  BARCELONA: ["barcelona"],
  MADRID: ["madrid"],
  MALAGA: ["malaga", "málaga"],
  SEVILLA: ["sevilla"],
  VALENCIA: ["valencia"],
  ZARAGOZA: ["zaragoza"],
};

const COMMUNITY_ALIASES = {
  "PAIS VASCO": ["pais vasco", "país vasco", "euskadi", "euskal autonomia erkidegoa"],
  NAVARRA: ["navarra", "comunidad foral de navarra"],
  CATALUNA: ["cataluna", "cataluña"],
  "COMUNIDAD DE MADRID": ["comunidad de madrid", "madrid"],
  ANDALUCIA: ["andalucia", "andalucía"],
  "COMUNIDAD VALENCIANA": ["comunidad valenciana", "pais valenciano", "país valenciano", "valenciana"],
  ARAGON: ["aragon", "aragón"],
};

const SECTOR_DEFINITIONS = [
  {
    key: "alojamientos",
    labels: ["alojamientos", "alojamiento", "hotel", "hoteles", "hostal", "hostales", "hospedaje", "recepcionista", "recepción"],
    fileKeywords: ["alojamientos"],
  },
  {
    key: "hosteleria",
    labels: ["hosteleria", "hostelería", "restauracion", "restauración", "camarero", "camarera", "cocina", "cocinero", "cocinera", "bar", "restaurante", "cafeteria", "cafetería"],
    fileKeywords: ["hosteleria", "hosteleria y restauracion", "hosteleria y restauración", "restauracion", "restauración"],
  },
  {
    key: "limpieza",
    labels: ["limpieza", "limpiador", "limpiadora", "limpiar", "oficinas", "edificios", "locales"],
    fileKeywords: ["limpieza"],
  },
  {
    key: "transporte",
    labels: ["transporte", "transportista", "conductor", "conductora", "chofer", "repartidor", "repartidora", "logistica", "logística", "camionero", "camionera"],
    fileKeywords: ["transporte"],
  },
];

function sanitizeId(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "convenio";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFileName(value) {
  return normalizeText(String(value || "").replace(/([a-z])(?=\d)/gi, "$1 "));
}

function getDocumentType(fileName) {
  const baseName = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  return WORKERS_STATUTE_FILE_PATTERN.test(baseName) ? "base" : "especifico";
}

function isSupportedLaborLocation(value) {
  const normalized = normalizeText(value);
  return Object.entries(LOCATION_ALIASES).some(([province, aliases]) =>
    normalizeText(province) === normalized || aliases.some((alias) => normalizeText(alias) === normalized)) ||
    Object.entries(COMMUNITY_ALIASES).some(([community, aliases]) =>
      normalizeText(community) === normalized || aliases.some((alias) => normalizeText(alias) === normalized));
}

function isSupportedLaborSector(value) {
  const normalized = normalizeText(value);
  return SECTOR_DEFINITIONS.some((definition) =>
    definition.key === normalized || definition.labels.some((label) => normalizeText(label) === normalized));
}

function includesWholeAlias(texto, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(texto);
}

function detectProvinceFromText(value) {
  const normalized = normalizeText(value);
  const provinces = new Set();

  Object.entries(LOCATION_ALIASES).forEach(([province, aliases]) => {
    if (aliases.some((alias) => includesWholeAlias(normalized, normalizeText(alias)))) {
      provinces.add(province);
    }
  });

  if (provinces.size > 0) {
    return Array.from(provinces);
  }

  Object.entries(COMMUNITY_ALIASES).forEach(([community, aliases]) => {
    if (aliases.some((alias) => includesWholeAlias(normalized, normalizeText(alias)))) {
      Object.entries(COMMUNITY_BY_PROVINCE).forEach(([province, provinceCommunity]) => {
        if (provinceCommunity === community) {
          provinces.add(province);
        }
      });
    }
  });

  return Array.from(provinces);
}

function detectSectorKeysFromText(value) {
  const normalized = normalizeText(value);
  const detected = SECTOR_DEFINITIONS
    .filter((definition) =>
      definition.labels.some((alias) => includesWholeAlias(normalized, normalizeText(alias)))
    )
    .map((definition) => definition.key);

  const explicitAlojamientos = includesWholeAlias(normalized, "convenio alojamientos");
  const strongAlojamientos = explicitAlojamientos ||
    ["hotel", "hoteles", "alojamiento", "alojamientos", "hospedaje"]
      .some((alias) => includesWholeAlias(normalized, alias));

  if (strongAlojamientos && detected.includes("alojamientos")) {
    return ["alojamientos", ...detected.filter((sectorKey) => sectorKey !== "alojamientos" && sectorKey !== "hosteleria")];
  }

  return detected;
}

function detectSectorKeysFromFileName(fileName) {
  const normalized = normalizeFileName(path.basename(fileName, path.extname(fileName)));
  return SECTOR_DEFINITIONS
    .filter((definition) =>
      definition.fileKeywords.some((keyword) => normalized.includes(normalizeText(keyword)))
    )
    .map((definition) => definition.key);
}

function extractYears(value) {
  const matches = String(value || "").match(/(?:19|20)\d{2}(?!\d)/g) || [];
  const years = matches.map((year) => parseInt(year, 10)).filter(Number.isFinite);
  if (!years.length) {
    return { yearStart: null, yearEnd: null };
  }

  return {
    yearStart: years[0],
    yearEnd: years[years.length - 1],
  };
}

function detectProvinceFromFileName(fileName) {
  const normalized = normalizeFileName(path.basename(fileName, path.extname(fileName)));
  return Object.keys(LOCATION_ALIASES).find((province) =>
    LOCATION_ALIASES[province].some((alias) => includesWholeAlias(normalized, normalizeText(alias)))
  ) || null;
}

function parseConvenioFileName(fileName) {
  const cleanFileName = path.basename(String(fileName || ""));
  const title = path.basename(cleanFileName, path.extname(cleanFileName));
  const override = FILE_METADATA_OVERRIDES[cleanFileName] || {};
  const province = override.province || detectProvinceFromFileName(cleanFileName);
  const sectorKeys = override.sectorKeys || detectSectorKeysFromFileName(cleanFileName);
  const detectedYears = extractYears(title);
  const yearStart = override.yearStart ?? detectedYears.yearStart;
  const yearEnd = override.yearEnd ?? detectedYears.yearEnd;
  const partMatch = normalizeText(title).match(/\bparte\s*(\d+)\b/);
  const partNumber = partMatch ? parseInt(partMatch[1], 10) : null;
  const autonomousCommunity = province ? COMMUNITY_BY_PROVINCE[province] || null : null;
  const groupYearStart = yearStart || "na";
  const groupYearEnd = yearEnd || "na";
  const sectorGroup = sectorKeys.length ? sectorKeys.join("_") : "sin_sector";
  const provinceGroup = province || "sin_provincia";

  return {
    fileName: cleanFileName,
    title: override.catalogTitle || title,
    province,
    autonomousCommunity,
    sectorKeys,
    yearStart,
    yearEnd,
    partNumber,
    catalogKey: override.catalogKey || sanitizeId(`${sectorGroup}_${provinceGroup}_${groupYearStart}_${groupYearEnd}`),
    ...(override.officialCode ? { officialCode: override.officialCode } : {}),
    ...(override.publication ? { publication: override.publication } : {}),
    ...(override.legalEffect ? { legalEffect: override.legalEffect } : {}),
    ...(override.applicationWarning ? { applicationWarning: override.applicationWarning } : {}),
    ...(override.sourceVerification ? { sourceVerification: override.sourceVerification } : {}),
    ...(override.automaticIngestionEligible === true ? { automaticIngestionEligible: true } : {}),
    ...(override.salaryEvidenceVerifiedThroughYear != null ? { salaryEvidenceVerifiedThroughYear: override.salaryEvidenceVerifiedThroughYear } : {}),
    ...(override.salaryEvidenceWarning ? { salaryEvidenceWarning: override.salaryEvidenceWarning } : {}),
    ...(override.documentaryWarning ? { documentaryWarning: override.documentaryWarning } : {}),
    ...(override.sourceEdition ? { sourceEdition: override.sourceEdition } : {}),
    ...(override.sourceUpdatedThrough ? { sourceUpdatedThrough: override.sourceUpdatedThrough } : {}),
    ...(override.sourceValidFrom ? { sourceValidFrom: override.sourceValidFrom } : {}),
    ...(override.sourceValidThrough ? { sourceValidThrough: override.sourceValidThrough } : {}),
    ...(override.sourceSha256 ? { sourceSha256: override.sourceSha256 } : {}),
    ...(override.sourceStorageUri ? { sourceStorageUri: override.sourceStorageUri } : {}),
    ...(override.sourcePageCount ? { sourcePageCount: override.sourcePageCount } : {}),
    ...(override.sourceDocumentType ? { sourceDocumentType: override.sourceDocumentType } : {}),
    ...(override.officialSourceUrl ? { officialSourceUrl: override.officialSourceUrl } : {}),
  };
}

function buildCatalogEntriesFromFileNames(fileNames) {
  const grouped = new Map();

  fileNames.forEach((fileName) => {
    const parsed = parseConvenioFileName(fileName);
    const existing = grouped.get(parsed.catalogKey);

    if (existing) {
      if (!existing.fileNames.includes(parsed.fileName)) {
        existing.fileNames.push(parsed.fileName);
      }
      if (parsed.sourceVerification === "unverified") existing.sourceVerification = "unverified";
      return;
    }

    grouped.set(parsed.catalogKey, {
      id: parsed.catalogKey,
      catalogKey: parsed.catalogKey,
      title: parsed.title,
      province: parsed.province,
      autonomousCommunity: parsed.autonomousCommunity,
      sectorKeys: parsed.sectorKeys,
      yearStart: parsed.yearStart,
      yearEnd: parsed.yearEnd,
      fileNames: [parsed.fileName],
      ...(parsed.officialCode ? { officialCode: parsed.officialCode } : {}),
      ...(parsed.publication ? { publication: parsed.publication } : {}),
      ...(parsed.legalEffect ? { legalEffect: parsed.legalEffect } : {}),
      ...(parsed.applicationWarning ? { applicationWarning: parsed.applicationWarning } : {}),
      ...(parsed.sourceVerification ? { sourceVerification: parsed.sourceVerification } : {}),
      ...(parsed.automaticIngestionEligible === true ? { automaticIngestionEligible: true } : {}),
      ...(parsed.sourceDocumentType ? { sourceDocumentType: parsed.sourceDocumentType } : {}),
      ...(parsed.salaryEvidenceVerifiedThroughYear != null ? { salaryEvidenceVerifiedThroughYear: parsed.salaryEvidenceVerifiedThroughYear } : {}),
      ...(parsed.salaryEvidenceWarning ? { salaryEvidenceWarning: parsed.salaryEvidenceWarning } : {}),
      ...(parsed.documentaryWarning ? { documentaryWarning: parsed.documentaryWarning } : {}),
      ...(parsed.sourceEdition ? { sourceEdition: parsed.sourceEdition } : {}),
      ...(parsed.sourceUpdatedThrough ? { sourceUpdatedThrough: parsed.sourceUpdatedThrough } : {}),
      ...(parsed.sourceValidFrom ? { sourceValidFrom: parsed.sourceValidFrom } : {}),
      ...(parsed.sourceValidThrough ? { sourceValidThrough: parsed.sourceValidThrough } : {}),
      ...(parsed.sourceSha256 ? { sourceSha256: parsed.sourceSha256 } : {}),
      ...(parsed.sourceStorageUri ? { sourceStorageUri: parsed.sourceStorageUri } : {}),
      ...(parsed.sourcePageCount ? { sourcePageCount: parsed.sourcePageCount } : {}),
      ...(parsed.sourceDocumentType ? { sourceDocumentType: parsed.sourceDocumentType } : {}),
      ...(parsed.officialSourceUrl ? { officialSourceUrl: parsed.officialSourceUrl } : {}),
      updatedAt: new Date().toISOString(),
    });
  });

  const malagaOriginal = Array.from(grouped.values()).find((entry) => entry.fileNames.includes(MALAGA_ORIGINAL_FILE));
  const malagaRevision = Array.from(grouped.values()).find((entry) => entry.fileNames.includes(MALAGA_REVISION_FILE));
  if (malagaOriginal && malagaRevision && malagaOriginal !== malagaRevision) {
    malagaRevision.fileNames = Array.from(new Set([...malagaOriginal.fileNames, ...malagaRevision.fileNames]));
    malagaRevision.yearStart = 2018;
    malagaRevision.yearEnd = 2027;
    malagaRevision.officialCode = "29000945011981";
    malagaRevision.publications = MALAGA_PUBLICATIONS;
    malagaRevision.documentaryWarning = MALAGA_UNINDEXED_SALARY_NOTICE;
    malagaRevision.unindexedPublications = MALAGA_UNINDEXED_PUBLICATIONS;
    malagaRevision.salaryEvidenceVerifiedThroughYear = 2022;
    malagaRevision.salaryEvidenceWarning = MALAGA_UNINDEXED_SALARY_NOTICE;
    grouped.delete(malagaOriginal.catalogKey);
  } else if (malagaRevision) {
    malagaRevision.documentaryWarning = MALAGA_UNINDEXED_SALARY_NOTICE;
    malagaRevision.salaryEvidenceVerifiedThroughYear = 2022;
    malagaRevision.salaryEvidenceWarning = MALAGA_UNINDEXED_SALARY_NOTICE;
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const yearA = a.yearEnd || 0;
    const yearB = b.yearEnd || 0;
    return yearB - yearA || a.title.localeCompare(b.title, "es");
  });
}

function pickDetectedValue(primary, fallback) {
  if (Array.isArray(primary) && primary.length) return primary;
  if (typeof primary === "string" && primary) return primary;
  return fallback;
}

function detectConvenioCriteria({ pregunta, ciudad, sector }) {
  const provincesFromQuestion = detectProvinceFromText(pregunta);
  const provincesFromCity = detectProvinceFromText(ciudad);
  const sectorFromQuestion = detectSectorKeysFromText(pregunta);
  const sectorFromField = detectSectorKeysFromText(sector);
  const requestedYears = Array.from(new Set((String(pregunta || "").match(/\b(?:19|20)\d{2}\b/g) || []).map(Number)));

  return {
    provinces: pickDetectedValue(provincesFromQuestion, provincesFromCity) || [],
    sectorKeys: pickDetectedValue(sectorFromQuestion, sectorFromField) || [],
    requestedYears,
    isSalaryQuery: /\b(?:salario|salarios|sueldo|sueldos|retribucion|retribuciones|tabla salarial|tablas salariales|importe|bruto|cobrar|cobra|paga|plus|complemento)\b/.test(normalizeText(pregunta)),
  };
}

function entryCoversRequestedYears(entry, requestedYears) {
  if (!requestedYears.length) return true;
  const yearStart = Number(entry.yearStart);
  const yearEnd = Number(entry.yearEnd);
  return Number.isFinite(yearStart) && Number.isFinite(yearEnd) &&
    requestedYears.every((year) => year >= yearStart && year <= yearEnd);
}

function selectCatalogSourceFiles(entry, requestedYears = []) {
  const files = Array.isArray(entry.fileNames) ? entry.fileNames : [];
  if (!requestedYears.length || !Array.isArray(entry.publications) || !entry.publications.length) return files;

  const minYear = Math.min(...requestedYears);
  const maxYear = Math.max(...requestedYears);
  const original = entry.publications.find((publication) => publication.role === "original");
  const revision = entry.publications.find((publication) => publication.role === "revision");
  if (original && revision && files.includes(original.fileName) && files.includes(revision.fileName)) {
    if (maxYear <= original.yearEnd) return [original.fileName];
    if (minYear >= original.yearStart && minYear <= revision.yearEnd) return [original.fileName, revision.fileName];
  }
  return files.filter((fileName) => entry.publications.some((publication) =>
    publication.fileName === fileName && requestedYears.every((year) => year >= publication.yearStart && year <= publication.yearEnd)
  ));
}

function hasUnindexedSalaryEvidence(entry, question, currentYear = new Date().getFullYear()) {
  if (!entry || !Number.isFinite(Number(entry.salaryEvidenceVerifiedThroughYear))) return false;
  const normalized = normalizeText(question);
  const asksSalary = /\b(?:salario|salarios|sueldo|sueldos|retribucion|retribuciones|tabla salarial|tablas salariales|importe|bruto|cobrar|cobra|paga|plus|complemento)\b/.test(normalized);
  if (!asksSalary) return false;
  const years = Array.from(new Set((String(question || "").match(/\b(?:19|20)\d{2}\b/g) || []).map(Number)));
  const yearsToCheck = years.length ? years : [currentYear];
  return yearsToCheck.some((year) => year > Number(entry.salaryEvidenceVerifiedThroughYear));
}

function madridDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function parseWorkersStatuteAsOfDates(question) {
  const text = String(question || "");
  const dates = new Set();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.add(match[0]);
  for (const match of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    dates.add(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  }
  const months = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };
  for (const match of text.toLocaleLowerCase("es").matchAll(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/g)) {
    dates.add(`${match[3]}-${months[match[2]]}-${match[1].padStart(2, "0")}`);
  }
  return [...dates].filter((date) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }).sort();
}

function workersStatuteVersionForDate(asOfDate) {
  if (asOfDate >= "2025-12-05" && asOfDate <= "2026-10-22") {
    return { sourceEdition: "PUB-DT-2025-139", fileNames: ["estatuto_trabajadores_parte1.pdf", "estatuto_trabajadores_parte2.pdf"], asOfDate };
  }
  if (asOfDate >= "2026-10-23") {
    return { sourceEdition: "BOE-A-2015-11430-consolidated-2026-10-03", fileNames: ["estatuto_trabajadores_2026-10-03.pdf"], asOfDate };
  }
  return null;
}

function resolveWorkersStatuteVersion(question = "", now = new Date()) {
  const dates = parseWorkersStatuteAsOfDates(question);
  if (dates.length) {
    const versions = dates.map(workersStatuteVersionForDate);
    if (versions.some((version) => !version)) return { status: "unsupported", dates };
    const editions = new Set(versions.map((version) => version.sourceEdition));
    return editions.size === 1 ? { status: "resolved", ...versions[0] } : { status: "ambiguous", dates };
  }

  const yearSearchText = String(question || "").replace(/\bBOE-A-\d{4}-\d+\b/gi, " ");
  const years = [...new Set((yearSearchText.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number))];
  if (years.length) {
    const yearRanges = years.map((year) => {
      const first = workersStatuteVersionForDate(`${year}-01-01`);
      const last = workersStatuteVersionForDate(`${year}-12-31`);
      return { first, last };
    });
    if (yearRanges.every(({ first, last }) => !first && !last)) return { status: "unsupported", years };
    if (yearRanges.some(({ first, last }) => !first || !last || first.sourceEdition !== last.sourceEdition)) {
      return { status: "ambiguous", years };
    }
    const versions = yearRanges.map(({ first }) => first);
    const editions = new Set(versions.map((version) => version.sourceEdition));
    return editions.size === 1 ? { status: "resolved", ...versions[0] } : { status: "ambiguous", years };
  }

  const asOfDate = madridDate(now);
  const version = workersStatuteVersionForDate(asOfDate);
  return version ? { status: "resolved", ...version } : { status: "unsupported", dates: [asOfDate] };
}

function isWorkersStatuteChunkCurrent(chunk, asOf = new Date()) {
  if (!chunk || chunk.officialCode !== "BOE-A-2015-11430") return true;
  const asOfDate = asOf instanceof Date ? madridDate(asOf) : String(asOf || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return false;
  if (chunk.sourceValidFrom && asOfDate < chunk.sourceValidFrom) return false;
  if (chunk.sourceValidThrough && asOfDate > chunk.sourceValidThrough) return false;
  return Boolean(chunk.sourceValidFrom || chunk.sourceValidThrough);
}

function resolveCatalogEntry(catalogEntries, criteria) {
  const provinces = criteria.provinces || [];
  const sectorKeys = criteria.sectorKeys || [];
  const requestedYears = criteria.requestedYears || [];

  if (!sectorKeys.length && !provinces.length) {
    return {
      status: "missing_all",
      message: "Indícame tu trabajo y la provincia, ciudad o comunidad autónoma para localizar el convenio correcto.",
    };
  }

  if (!sectorKeys.length) {
    return {
      status: "missing_sector",
      message: "Necesito que me indiques tu trabajo o sector para localizar el convenio que te corresponde.",
    };
  }

  if (!provinces.length) {
    return {
      status: "missing_location",
      message: "Necesito que me indiques la provincia, ciudad o comunidad autónoma para localizar tu convenio.",
    };
  }

  const candidates = catalogEntries.filter((entry) =>
    entry.catalogStatus !== "superseded" && entry.catalogStatus !== "normative_base" && entry.active !== false &&
    entry.province &&
    provinces.includes(entry.province) &&
    Array.isArray(entry.sectorKeys) &&
    entry.sectorKeys.some((sectorKey) => sectorKeys.includes(sectorKey)) &&
    (!['salary_tables', 'salary_revision'].includes(entry.sourceDocumentType) || criteria.isSalaryQuery === true)
  );

  const yearCandidates = requestedYears.length
    ? candidates.filter((entry) => entryCoversRequestedYears(entry, requestedYears))
    : candidates;
  const verifiedCandidates = yearCandidates.filter((entry) => entry.sourceVerification !== "unverified");

  if (!verifiedCandidates.length) {
    if (yearCandidates.some((entry) => entry.sourceVerification === "unverified") ||
        (!requestedYears.length && candidates.some((entry) => entry.sourceVerification === "unverified"))) {
      return {
        status: "source_unverified",
        message: "He encontrado documentos con fechas o contenido documental sin verificar para ese convenio. No puedo presentarlos como la edición confirmada. Indícame el año concreto o consulta el boletín oficial para verificar la fuente.",
        options: yearCandidates.filter((entry) => entry.sourceVerification === "unverified").map((entry) => ({
          title: entry.title,
          province: entry.province || null,
          sectorKeys: entry.sectorKeys || [],
          fileNames: entry.fileNames || [],
        })),
      };
    }
    return {
      status: "not_found",
      message: "No he encontrado un convenio claro con esos datos. Indícame trabajo y provincia de la forma más concreta posible.",
    };
  }

  const salaryYear = requestedYears.length === 1 ? requestedYears[0] : !requestedYears.length ? Number(madridDate().slice(0, 4)) : null;
  const salarySupplements = criteria.isSalaryQuery && salaryYear != null
    ? verifiedCandidates.filter((entry) => ["salary_tables", "salary_revision"].includes(entry.sourceDocumentType) &&
      entry.yearStart <= salaryYear && entry.yearEnd >= salaryYear)
    : [];
  const sortedCandidates = (salarySupplements.length ? salarySupplements : verifiedCandidates).sort((a, b) => {
    const yearA = a.yearEnd || 0;
    const yearB = b.yearEnd || 0;
    return yearB - yearA || a.title.localeCompare(b.title, "es");
  });

  const sectorGroups = new Set(
    sortedCandidates.map((candidate) =>
      Array.isArray(candidate.sectorKeys) ? candidate.sectorKeys.slice().sort().join("|") : ""
    )
  );

  if (sectorGroups.size > 1) {
    return {
      status: "ambiguous",
      message: "¿Te refieres a hostelería/restauración o a alojamientos/hoteles?",
      options: sortedCandidates.map((candidate) => ({
        title: candidate.title,
        province: candidate.province || null,
        sectorKeys: candidate.sectorKeys || [],
        fileNames: candidate.fileNames || [],
      })),
    };
  }

  if (requestedYears.length && sortedCandidates.length > 1) {
    return {
      status: "ambiguous",
      message: "Hay varias ediciones documentales que cubren el año indicado. Necesito identificar el texto concreto antes de responder.",
      options: sortedCandidates.map((candidate) => ({
        title: candidate.title,
        province: candidate.province || null,
        sectorKeys: candidate.sectorKeys || [],
        fileNames: candidate.fileNames || [],
      })),
    };
  }

  const selectedEntry = { ...sortedCandidates[0] };
  selectedEntry.fileNames = selectCatalogSourceFiles(selectedEntry, requestedYears);
  if (!selectedEntry.fileNames.length) {
    return {
      status: "not_found",
      message: "No he encontrado una fuente documental que cubra el año indicado. Esto no determina por sí mismo qué convenio resulta jurídicamente aplicable.",
    };
  }

  return {
    status: "resolved",
    entry: selectedEntry,
  };
}

function resolveCatalogReference(catalogEntries, reference, criteria) {
  const entry = catalogEntries.find((candidate) =>
    candidate.catalogStatus !== "superseded" && candidate.catalogStatus !== "normative_base" && candidate.active !== false &&
    (candidate.id === reference || candidate.title === reference || candidate.fileNames?.includes(reference)) &&
    (!['salary_tables', 'salary_revision'].includes(candidate.sourceDocumentType) || criteria.isSalaryQuery === true));
  if (!entry || (criteria.provinces.length && !criteria.provinces.includes(entry.province)) ||
      (criteria.sectorKeys.length && !criteria.sectorKeys.some((key) => entry.sectorKeys?.includes(key)))) {
    return null;
  }
  return entry;
}

module.exports = {
  CATALOGO_CONVENIOS,
  buildCatalogEntriesFromFileNames,
  detectConvenioCriteria,
  getDocumentType,
  hasUnindexedSalaryEvidence,
  isWorkersStatuteChunkCurrent,
  isSupportedLaborLocation,
  isSupportedLaborSector,
  normalizeText,
  parseConvenioFileName,
  parseWorkersStatuteAsOfDates,
  resolveWorkersStatuteVersion,
  resolveCatalogEntry,
  resolveCatalogReference,
  selectCatalogSourceFiles,
  sanitizeId,
};
