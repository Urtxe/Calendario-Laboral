const path = require("path");

const CATALOGO_CONVENIOS = "catalogo_convenios";

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
    labels: ["alojamientos", "hotel", "hoteles", "hostal", "hostales", "recepcionista", "recepción"],
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
  return SECTOR_DEFINITIONS
    .filter((definition) =>
      definition.labels.some((alias) => includesWholeAlias(normalized, normalizeText(alias)))
    )
    .map((definition) => definition.key);
}

function detectSectorKeysFromFileName(fileName) {
  const normalized = normalizeText(path.basename(fileName, path.extname(fileName)));
  return SECTOR_DEFINITIONS
    .filter((definition) =>
      definition.fileKeywords.some((keyword) => normalized.includes(normalizeText(keyword)))
    )
    .map((definition) => definition.key);
}

function extractYears(value) {
  const matches = String(value || "").match(/\b(19|20)\d{2}\b/g) || [];
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
  const normalized = normalizeText(path.basename(fileName, path.extname(fileName)));
  return Object.keys(LOCATION_ALIASES).find((province) =>
    LOCATION_ALIASES[province].some((alias) => includesWholeAlias(normalized, normalizeText(alias)))
  ) || null;
}

function parseConvenioFileName(fileName) {
  const cleanFileName = path.basename(String(fileName || ""));
  const title = path.basename(cleanFileName, path.extname(cleanFileName));
  const province = detectProvinceFromFileName(cleanFileName);
  const sectorKeys = detectSectorKeysFromFileName(cleanFileName);
  const { yearStart, yearEnd } = extractYears(title);
  const partMatch = normalizeText(title).match(/\bparte\s*(\d+)\b/);
  const partNumber = partMatch ? parseInt(partMatch[1], 10) : null;
  const autonomousCommunity = province ? COMMUNITY_BY_PROVINCE[province] || null : null;
  const groupYearStart = yearStart || "na";
  const groupYearEnd = yearEnd || "na";
  const sectorGroup = sectorKeys.length ? sectorKeys.join("_") : "sin_sector";
  const provinceGroup = province || "sin_provincia";

  return {
    fileName: cleanFileName,
    title,
    province,
    autonomousCommunity,
    sectorKeys,
    yearStart,
    yearEnd,
    partNumber,
    catalogKey: sanitizeId(`${sectorGroup}_${provinceGroup}_${groupYearStart}_${groupYearEnd}`),
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
      updatedAt: new Date().toISOString(),
    });
  });

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

  return {
    provinces: pickDetectedValue(provincesFromQuestion, provincesFromCity) || [],
    sectorKeys: pickDetectedValue(sectorFromQuestion, sectorFromField) || [],
  };
}

function resolveCatalogEntry(catalogEntries, criteria) {
  const provinces = criteria.provinces || [];
  const sectorKeys = criteria.sectorKeys || [];

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
    entry.province &&
    provinces.includes(entry.province) &&
    Array.isArray(entry.sectorKeys) &&
    entry.sectorKeys.some((sectorKey) => sectorKeys.includes(sectorKey))
  );

  if (!candidates.length) {
    return {
      status: "not_found",
      message: "No he encontrado un convenio claro con esos datos. Indícame trabajo y provincia de la forma más concreta posible.",
    };
  }

  const sortedCandidates = candidates.sort((a, b) => {
    const yearA = a.yearEnd || 0;
    const yearB = b.yearEnd || 0;
    return yearB - yearA || a.title.localeCompare(b.title, "es");
  });

  return {
    status: "resolved",
    entry: sortedCandidates[0],
  };
}

module.exports = {
  CATALOGO_CONVENIOS,
  buildCatalogEntriesFromFileNames,
  detectConvenioCriteria,
  normalizeText,
  parseConvenioFileName,
  resolveCatalogEntry,
  sanitizeId,
};
