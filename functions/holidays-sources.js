"use strict";

const MONTHS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, gener: 1, febrer: 2, març: 3, maig: 5, juny: 6, juliol: 7, agost: 8, setembre: 9, novembre: 11, desembre: 12 };
const URLS = {
  euskadiIndex: "https://www.euskadi.eus/calendario-laboral/web01-s2enple/es/",
  euskadi: "https://www.euskadi.eus/bopv2/datos/2026/07/2603215a.shtml",
  bilbaoIndex: "https://www.bizkaia.eus/es/bob/resultados",
  navarra: "https://bon.navarra.es/es/anuncio/-/texto/2026/103/23",
  aragon: "https://pro.aragonhoy.es/economia-competitividad-y-empleo/aragon-calendario-laboral-2027-12-festivos-autonomicos-traslado-asuncion-16-agosto-106318",
  catalonia: "https://treball.gencat.cat/ca/ambits/relacions_laborals/ci/calendari_laboral/calendari-festes-2027/",
  cataloniaIndex: "https://treball.gencat.cat/ca/ambits/relacions_laborals/ci/calendari_laboral/",
  cataloniaGeneral: "https://analisi.transparenciacatalunya.cat/resource/yf2b-mjr6.json",
  cataloniaLocal: "https://analisi.transparenciacatalunya.cat/resource/b4eh-r8up.json",
  barcelonaIndex: "https://seuelectronica.ajuntament.barcelona.cat/es/calendario-y-hora-oficiales",
  valenciaGeneral: "https://dogv.gva.es/datos/2026/03/25/pdf/2026_8641_es.pdf",
  valenciaLocal: "https://www.valencia.es/cas/actualidad/-/content/fiestas-locales-val%C3%A8ncia-2027",
  andalucia: "https://www.juntadeandalucia.es/boja/2026/84/1",
  malaga: "https://www.malaga.eu/la-ciudad/dias-festivos/",
  sevilla: "https://www.sevilla.org/ayuntamiento/el-ayuntamiento/pleno-municipal/convocatorias-plenos/2026/web-orden-propuestas-pleno-18-06-2026.pdf",
  madrid: "https://www.comunidad.madrid/empleo/calendario-laboral-comunidad-madrid-municipios",
  aragonIndex: "https://www.aragon.es/trabajo-y-relaciones-laborales/calendario-laboral",
  navarraIndex: "https://www.lexnavarra.navarra.es/indice.asp?p=26.1.&s=18",
  sevillaIndex: "https://www.sevilla.org/ayuntamiento/el-ayuntamiento/pleno-municipal/convocatorias-plenos",
  valenciaIndex: "https://ceice.gva.es/es/web/dg-trabajo/calendario-laboral",
  andaluciaIndex: "https://www.juntadeandalucia.es/organismos/empleoempresaytrabajoautonomo/areas/relaciones-laborales/calendario-fiestas.html",
};

function discoverPublication(html, year, base, label, hosts) {
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(([, , title]) => label.test(textOf(title)) && new RegExp(`\\b${year}\\b`).test(textOf(title)))
    .map(([, href]) => new URL(href.replaceAll("&amp;", "&"), base))
    .filter(url => url.protocol === "https:" && hosts.includes(url.hostname));
  if (matches.length > 1) throw new Error(`Publicación ${year} ambigua en ${base}`);
  return matches[0]?.href || null;
}

function discoverYearSection(html, year, base, heading, label, hosts) {
  const header = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)]
    .find(([, title]) => heading.test(textOf(title)) && new RegExp(`\\b${year}\\b`).test(textOf(title)));
  if (!header) return null;
  const start = header.index + header[0].length;
  const next = /<h[23]\b/i.exec(html.slice(start));
  const section = html.slice(start, next ? start + next.index : undefined);
  const matches = [...section.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(([, , title]) => label.test(textOf(title)))
    .map(([, href]) => new URL(href.replaceAll("&amp;", "&"), base))
    .filter(url => url.protocol === "https:" && hosts.includes(url.hostname));
  if (matches.length > 1) throw new Error(`Publicación ${year} ambigua en ${base}`);
  return matches[0]?.href || null;
}

function parseMadrid(html, year) {
  const text = textOf(html);
  const general = text.match(new RegExp(`Fiestas laborales en el ámbito de la Comunidad de Madrid para el año ${year}([\\s\\S]*?)(?=Fiestas laborales de ámbito local|Calendario laboral ${year - 1}|$)`, "i"));
  const local = text.match(new RegExp(`Fiestas laborales de ámbito local en la Comunidad de Madrid para el año ${year}([\\s\\S]*?)(?=Calendario laboral ${year - 1}|$)`, "i"));
  const generals = general ? listedDates(general[1].split("Además de las doce fiestas")[0], year) : [];
  const madrid = local?.[1].match(/(?:^|[—–-])\s*Madrid\s*:\s*([^—–]+)/i);
  const locals = madrid ? listedDates(madrid[1], year) : [];
  if (generals.length && (generals.length !== 12 || new Set(generals).size !== 12)) throw new Error("Madrid: generales ambiguas");
  if (madrid && (locals.length !== 2 || new Set(locals).size !== 2)) throw new Error("Madrid: locales ambiguas");
  return [generals, locals];
}

function parseAragonPdf(content, year) {
  const value = content.replace(/\s+/g, " ");
  if (!value.includes("BOLETÍN OFICIAL DE ARAGÓN") || !new RegExp(`fiestas labora(?:les|bles)[^.]{0,200}año ${year} en la Comunidad Autónoma de Aragón`, "i").test(value)) throw new Error("Aragón: decreto o año inesperado");
  const section = between(value, `para el año ${year}, en la Comunidad Autónoma de Aragón, serán las siguientes:`, /(?:Segundo\.-|Artículo segundo\.)/i);
  const dates = listedDates(section, year);
  if (dates.length !== 12 || new Set(dates).size !== 12) throw new Error("Aragón: no se extrajeron doce generales");
  return dates;
}

function parseNavarraLocal(html, year) {
  const value = textOf(html);
  if (!new RegExp(`fiestas locales para el año ${year}`, "i").test(value)) throw new Error("Navarra: resolución local o año inesperado");
  const section = html.match(/<td>\s*PAMPLONA\s*<\/td>\s*<td>\s*([^<]+)<\/td>/i);
  const dates = section ? listedDates(section[1], year) : [];
  if (dates.length !== 1) throw new Error("Pamplona: no se extrajo una fiesta local");
  return dates;
}

function parseZaragozaLocal(content, year) {
  const value = content.replace(/\s+/g, " ");
  if (!value.includes("BOLETÍN OFICIAL DE ARAGÓN") || !new RegExp(`(?:fiestas locales|fiestas laborales)[^.]{0,180}año ${year}`, "i").test(value) || !value.includes(`provincia de Zaragoza para el año ${year}`)) throw new Error("Aragón: resolución local o año inesperado");
  const section = value.match(/(?:^|[. ]+[-•])\s*Zaragoza[.\s]+([^.;]+)/i);
  const dates = section ? listedDates(section[1], year) : [];
  if (dates.length !== 2 || new Set(dates).size !== 2) throw new Error("Zaragoza: no se extrajeron dos fiestas locales");
  return dates;
}

function dogvSignature(publicationUrl) {
  const url = new URL(publicationUrl);
  const signature = url.searchParams.get("signatura");
  if (url.protocol !== "https:" || url.hostname !== "dogv.gva.es" || !/^\d{4}\/\d+$/.test(signature || "")) throw new Error("Enlace DOGV inesperado");
  return signature;
}

function dogvPdfUrl(publicationUrl, disposition) {
  const signature = dogvSignature(publicationUrl);
  if (disposition.codigoInsercion !== signature || !/^\d{4}-\d{2}-\d{2}$/.test(disposition.fechaPublicacion || "")) throw new Error("Metadatos DOGV inesperados");
  const [year, month, day] = disposition.fechaPublicacion.split("-");
  return `https://dogv.gva.es/datos/${year}/${month}/${day}/pdf/${signature.replace("/", "_")}_es.pdf`;
}

function parseValenciaLocalPdf(content, year) {
  const value = content.replace(/\s+/g, " ");
  if (!new RegExp(`RESOLUCIÓN[^.]{0,250}calendario de fiestas locales[^.]{0,250}año ${year}`, "i").test(value) || !value.includes(`PROVINCIA DE VALENCIA ${year}`)) throw new Error("DOGV local: resolución o año inesperado");
  const section = value.match(/\bVALÈNCIA:\s*([\s\S]*?)(?=\bVALLADA:)/i);
  const dates = section ? listedDates(section[1], year) : [];
  if (dates.length !== 2 || new Set(dates).size !== 2) throw new Error("DOGV local: València no tiene dos fechas inequívocas");
  return dates;
}

function discoverSevillaProposals(html, archiveUrl, year) {
  const archive = new URL(archiveUrl);
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(([, , title]) => /Orden del día, sesión ordinaria/i.test(textOf(title)))
    .map(([, href]) => new URL(href, archiveUrl))
    .filter(url => url.protocol === "https:" && url.hostname === "www.sevilla.org" && url.pathname.startsWith(`${archive.pathname}/`) && /web-orden-propuestas-pleno-\d{2}-(0[5-9])-\d{4}\.pdf$/i.test(url.pathname));
  // ponytail: examina como máximo ocho plenos ordinarios de mayo a septiembre; ampliar ventana si cambian el calendario municipal.
  if (matches.length > 8) throw new Error("Sevilla: demasiados plenos candidatos");
  return matches.sort((a, b) => Math.abs(Number(a.pathname.match(/-(0[5-9])-\d{4}\.pdf$/)[1]) - 6) - Math.abs(Number(b.pathname.match(/-(0[5-9])-\d{4}\.pdf$/)[1]) - 6)).map(url => url.href);
}

function discoverAndaluciaLocal(html, year) {
  const section = html.split(/<h2[^>]*>Fiestas locales<\/h2>/i)[1]?.split(/<h3\b/i)[0] || "";
  const matches = [...section.matchAll(/<li>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/gi)]
    .filter(([, , title, rest]) => /Resolución/i.test(textOf(title)) && !/modifica|Corrección/i.test(textOf(title + rest)) && new RegExp(`fiestas locales[^.]{0,180}año ${year}`, "i").test(textOf(rest)))
    .map(([, href]) => new URL(href, URLS.andaluciaIndex))
    .filter(url => url.protocol === "https:" && url.hostname === "www.juntadeandalucia.es" && /^\/boja\/\d{4}\/\d+\/\d+$/.test(url.pathname));
  if (matches.length > 1) throw new Error(`Andalucía: varias resoluciones locales ${year}`);
  return matches[0]?.href || null;
}

function parseSevillaDefinitive(html, year) {
  if (!textOf(html).includes(`FIESTAS LOCALES DE ANDALUCÍA ${year}`)) throw new Error("BOJA local: año inesperado");
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(([, row]) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => textOf(cell)))
    .filter(cells => cells[0] === "SEVILLA");
  if (rows.length !== 1) throw new Error("BOJA local: municipio Sevilla ambiguo");
  const dates = rows[0].slice(1).flatMap(cell => listedDates(cell, year));
  if (dates.length !== 2 || new Set(dates).size !== 2) throw new Error("BOJA local: dos fechas de Sevilla ausentes");
  return dates;
}

function iso(day, month, year) {
  const number = MONTHS[month.toLocaleLowerCase("es")];
  if (!number) throw new Error(`Mes desconocido: ${month}`);
  return `${year}-${String(number).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function textOf(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)))
    .replace(/&nbsp;|&amp;/gi, " ").replace(/\s+/g, " ").trim();
}

function between(value, start, end) {
  const a = value.indexOf(start);
  if (a < 0) throw new Error(`No se encontró la sección: ${start}`);
  const offset = end instanceof RegExp ? value.slice(a + start.length).search(end) : -1;
  const b = end instanceof RegExp ? offset < 0 ? -1 : a + start.length + offset : value.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`No se encontró el fin de sección: ${end}`);
  return value.slice(a + start.length, b);
}

function listedDates(section, year) {
  return [...section.matchAll(/\b(\d{1,2}) (?:de |d['’])(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gener|febrer|març|maig|juny|juliol|agost|setembre|novembre|desembre)(?=\W|$)/gi)]
    .map(match => iso(match[1], match[2], year));
}

function discoverEuskadiCalendar(html, year, territory) {
  const anchors = { general: "euskadi", gasteiz: "alava", donostia: "gipuzkoa" };
  const labels = { general: "Comunidad Aut", gasteiz: "Araba", donostia: "Gipuzkoa" };
  const anchor = anchors[territory];
  if (!anchor) throw new Error(`Territorio vasco inesperado: ${territory}`);
  const start = html.indexOf(`id="${anchor}"`);
  if (start < 0) throw new Error(`Índice Euskadi sin sección ${territory}`);
  const end = html.indexOf("</h2>", start);
  const next = html.indexOf("<h2", end);
  const section = html.slice(end, next < 0 ? undefined : next);
  const matches = [...section.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(([, , label]) => new RegExp(`Calendario laboral ${year}\\b`, "i").test(textOf(label)));
  if (!matches.length) {
    if (new RegExp(`Calendario laboral ${year}\\b`, "i").test(textOf(section))) throw new Error(`Euskadi ${territory} ${year}: publicación sin PDF reconocible`);
    return null;
  }
  if (matches.length !== 1 || !textOf(matches[0][2]).includes(labels[territory])) throw new Error(`Euskadi ${territory} ${year}: publicación ambigua`);
  const url = new URL(matches[0][1], URLS.euskadiIndex);
  if (url.protocol !== "https:" || url.host !== "www.euskadi.eus" || !url.pathname.startsWith("/contenidos/informacion/5907/") || !url.pathname.endsWith(".pdf")) throw new Error("Euskadi: URL oficial inesperada");
  return url.href;
}

function parseEuskadiCalendar(content, year, territory) {
  const value = content.replace(/\s+/g, " ");
  if (territory === "general") {
    if (!value.includes("BOLETÍN OFICIAL DEL PAÍS VASCO") || !new RegExp(`Calendario Oficial de Fiestas Labora-? ?les de la Comunidad Autónoma de Euskadi para el año ${year}`).test(value)) throw new Error("Euskadi: calendario general o año inesperado");
    const section = between(value, "Artículo 1.", "Artículo 2.").split(/-- 1 of \d+ --/)[0];
    const dates = listedDates(section, year);
    if (dates.length !== 12 || new Set(dates).size !== 12) throw new Error("Euskadi: no se extrajeron doce generales");
    return dates;
  }
  if (territory === "gasteiz") {
    if (!value.includes("BOLETÍN OFICIAL DEL TERRITORIO HISTÓRICO DE ÁLAVA") || !value.includes(`fiestas locales de Álava para el año ${year}`)) throw new Error("Álava: publicación o año inesperado");
    const territorial = value.match(/Día de fiesta del territorio histórico:\s*(\d{1,2} de [a-záéíóúñ]+)/i);
    const local = value.match(/\bVitoria-Gasteiz\s+(\d{1,2} de [a-záéíóúñ]+)/i);
    if (!territorial || !local || !value.includes("DÍAS DE FIESTA DE CARÁCTER LOCAL")) throw new Error("Álava: ámbito local incompleto");
    return distinctLocalDates(territorial[1], local[1], year);
  }
  if (territory === "donostia") {
    if (!value.includes("Boletín Oficial de Gipuzkoa") || !new RegExp(`fiestas loca-? ?les de Gi ?pu ?z ?koa para el año ${year}`, "i").test(value)) throw new Error("Gipuzkoa: publicación o año inesperado");
    const territorial = value.match(/DISPONGO\s+—\s*(\d{1,2} de [a-záéíóúñ]+)[^.]*en todo el Territorio His-/i);
    const local = value.match(/\bSAN SEBASTIÁN\s+(\d{1,2} de [a-záéíóúñ]+)/i);
    if (!territorial || !local) throw new Error("Gipuzkoa: ámbito local incompleto");
    return distinctLocalDates(territorial[1], local[1], year);
  }
  throw new Error(`Territorio vasco inesperado: ${territory}`);
}

function distinctLocalDates(territorial, municipal, year) {
  const dates = [territorial, municipal].flatMap(part => listedDates(part, year));
  if (dates.length !== 2 || new Set(dates).size !== 2) throw new Error("Euskadi: se esperaban dos fiestas locales distintas");
  return dates;
}

function discoverBarcelonaLocal(html, year) {
  const section = between(html, "Barcelona. Fiestas locales:", "Cataluña. Fiestas laborales:");
  const matches = [...section.matchAll(/<a\s+href="([^"]+)"[^>]*>\s*(\d{4}) \(enlace anuncio Gaseta Municipal\)<\/a>/gi)]
    .filter(match => Number(match[2]) === year);
  if (!matches.length) {
    if (new RegExp(`\\b${year}\\b`).test(section)) throw new Error(`Barcelona: anuncio local ${year} sin enlace reconocible`);
    return null;
  }
  if (matches.length !== 1) throw new Error(`Barcelona: varios anuncios locales de ${year}`);
  const url = new URL(matches[0][1].replaceAll("&amp;", "&"));
  if (url.host !== "w123.bcn.cat" || url.pathname !== "/APPS/egaseta/home.do" || url.searchParams.get("reqCode") !== "downloadFile" || !/^\d+$/.test(url.searchParams.get("publicacionsId") || "")) throw new Error("Enlace municipal de Barcelona inesperado");
  return url.href;
}

function discoverBilbaoLocal(html, year) {
  const title = `Calendario de Fiestas Locales del Territorio Histórico de Bizkaia para el año ${year}`;
  const match = html.match(new RegExp(`${title}\\.\\s*</p>[\\s\\S]{0,1000}?<a href="([^"]+\\.pdf)"`, "i"));
  if (!match) {
    if (textOf(html).includes(title)) throw new Error(`Bizkaia: resolución local ${year} sin PDF reconocible`);
    return null;
  }
  const url = new URL(match[1]);
  if (url.host !== "www.bizkaia.eus" || !/^\/lehendakaritza\/Bao_bob\/\d{4}\/\d{2}\/\d{2}\/III-\d+_cas\.pdf$/.test(url.pathname)) throw new Error("Enlace BOB Bizkaia inesperado");
  return url.href;
}

function parseBilbaoLocal(content, year) {
  const value = content.replace(/\s+/g, " ");
  if (!value.includes("BOLETÍN OFICIAL DE BIZKAIA") || !value.includes(`Calendario de Fiestas Locales del Territorio Histórico de Bizkaia para el año ${year}`)) throw new Error("Identidad BOB Bizkaia inesperada");
  const territorial = between(value, "DISPONGO:", "— Para cada Municipio");
  if (!territorial.includes("en todo el Territorio Histórico de Bizkaia") || !territorial.includes(`para el año ${year}`)) throw new Error("Fiesta territorial de Bizkaia ausente");
  const municipality = value.match(/•\s*Bilbao\s+[–-]\s*(.*?)(?=•\s*Busturia\b)/);
  if (!municipality || !municipality[1].includes("Viernes de la Semana Grande")) throw new Error("Fiesta local de Bilbao ausente");
  const dates = [...listedDates(territorial, year), ...listedDates(municipality[1], year)];
  if (dates.length !== 2 || new Set(dates).size !== 2) throw new Error("Bizkaia/Bilbao: se esperaban dos fiestas locales distintas");
  return dates;
}

function parseOfficial(kind, content, year) {
  const value = ["valenciaGeneral", "sevilla", "barcelonaLocal"].includes(kind) ? content.replace(/\s+/g, " ") : textOf(content);
  let section;
  switch (kind) {
    case "euskadi":
      if (!value.includes("DECRETO 90/2026") || !value.includes("Comunidad Autónoma de Euskadi para el año 2027")) throw new Error("Identidad BOPV inesperada");
      section = between(value, "Artículo 1.", "Artículo 2.");
      break;
    case "navarra":
      if (!/RESOLUCI[ÓO]N \d+\/\d{4}/i.test(value) || !value.includes("Comunidad Foral de Navarra") || !value.includes(`año ${year}`)) throw new Error("Identidad BON inesperada");
      section = between(value, "1.º Establecer como fiestas", /(?:En la relación anterior está incluida|2\.º La otra fiesta local)/i);
      break;
    case "aragon":
      if (!value.includes(`Aragón ya tiene calendario laboral para ${year}`)) throw new Error("Identidad Aragón inesperada");
      section = between(value, `Las fiestas laborales de carácter retribuido y no recuperable que se celebrarán en Aragón durante ${year} serán las siguientes:`, "El decreto establece asimismo");
      break;
    case "catalonia":
      if (!value.includes(`Calendari oficial de festes laborals a Catalunya ${year}`)) throw new Error("Identidad Cataluña inesperada");
      section = between(value, `Són festes laborals a Catalunya durant l'any ${year}:`, "Al territori d'Aran");
      break;
    case "barcelonaLocal":
      if (!value.includes("GASETA MUNICIPAL") || !value.includes("DECRET D'ALCALDIA") || !value.includes(`festes locals a celebrar durant l'any ${year} en el terme municipal de Barcelona`)) throw new Error("Identidad Gaseta Barcelona inesperada");
      section = between(value, `festes locals a celebrar durant l'any ${year} en el terme municipal de Barcelona, els dies:`, "Barcelona,");
      if (!/-\s*\d{1,2} de [^\s,]+,\s*dilluns de Pasqua Granada\s*-\s*\d{1,2} de [^\s,]+,\s*Mare de Déu de la Mercè/.test(section)) throw new Error("Festividades locales de Barcelona ausentes");
      break;
    case "valenciaGeneral":
      if (!/DECRETO \d+\/\d{4}/i.test(value) || !value.includes(`Comunitat Valenciana para el año ${year}`)) throw new Error("Identidad DOGV inesperada");
      section = between(value, "Primero Se declaran", "Segundo El presente decreto");
      break;
    case "valenciaLocal":
      section = between(value, `El Pleno del Ayuntamiento ha aprobado los festivos locales en la ciudad de València en el año ${year}.`, "El Grupo Municipal de Compromís había propuesto");
      break;
    case "andalucia":
      if (!/Decreto \d+\/\d{4}/i.test(value) || !value.includes(`Comunidad Autónoma de Andalucía para el año ${year}`)) throw new Error("Identidad BOJA inesperada");
      section = between(value, value.includes(`ANEXO CALENDARIO DE FIESTAS LABORALES DE LA COMUNIDAD AUTÓNOMA DE ANDALUCÍA PARA EL AÑO ${year}`) ? `ANEXO CALENDARIO DE FIESTAS LABORALES DE LA COMUNIDAD AUTÓNOMA DE ANDALUCÍA PARA EL AÑO ${year}` : `Calendario de fiestas laborales de la Comunidad Autónoma de Andalucía para el año ${year}`, "Descargar PDF");
      break;
    case "sevilla":
      if (!/ORDEN DEL DIA DE LA SESION ORDINARIA DEL AYUNTAMIENTO PLENO/i.test(value)) throw new Error("Identidad del documento municipal inesperada");
      {
        const target = value.indexOf(`fiestas locales de la ciudad de Sevilla para el año ${year}`);
        const start = value.lastIndexOf("Expte.", target);
        const end = value.indexOf("Código Seguro De Verificación", target);
        section = target >= 0 && start >= 0 && end > target ? value.slice(start, end) : "";
      }
      if (!section.includes("AL EXCMO. AYUNTAMIENTO PLENO") || !section.includes("Área de Fiestas Mayores (Servicio de Fiestas Mayores)") || !section.includes(`fiestas locales de la ciudad de Sevilla para el año ${year}`)) throw new Error(`Contexto de fiestas locales de Sevilla ${year} ausente`);
      const first = between(section, `ACUERDO PRIMERO.- Determinar como fiesta local de la ciudad de Sevilla para el año ${year}, el día`, `SEGUNDO.- Determinar como fiesta local de la ciudad de Sevilla para el año ${year}, el día`);
      const second = between(section, `SEGUNDO.- Determinar como fiesta local de la ciudad de Sevilla para el año ${year}, el día`, "TERCERO.- Dar cuenta");
      if (!first.includes("Feria de Abril") || !second.includes("Corpus Christi") || listedDates(first, year).length !== 1 || listedDates(second, year).length !== 1) throw new Error("Propuesta municipal de Sevilla incompleta o ambigua");
      section = `${first} ${second}`;
      break;
    default: throw new Error(`Fuente no soportada: ${kind}`);
  }
  const dates = listedDates(section, year);
  const expected = kind === "navarra" ? 13 : ["valenciaLocal", "sevilla", "barcelonaLocal"].includes(kind) ? 2 : 12;
  if (dates.length !== expected || new Set(dates).size !== expected) throw new Error(`${kind}: se esperaban ${expected} fechas, se extrajeron ${dates.length}`);
  return dates;
}

function parseMalaga(html, year) {
  const groups = [];
  for (const [label, count] of [["NACIONALES Y AUTONÓMICAS", 12], ["LOCALES", 2]]) {
    const heading = `FIESTAS ${label} ${year}`;
    const start = html.indexOf(heading);
    if (start < 0) return null;
    const tableStart = html.indexOf("<table", start);
    const tableEnd = html.indexOf("</table>", tableStart);
    if (tableStart < 0 || tableEnd < 0 || tableStart - start > 300 || tableEnd - tableStart > 18000) throw new Error(`Tabla Málaga inesperada: ${heading}`);
    const dates = listedDates(textOf(html.slice(tableStart, tableEnd)), year);
    if (dates.length !== count || new Set(dates).size !== count) throw new Error(`Málaga ${year}: ${heading} contiene ${dates.length} fechas, se esperaban ${count}`);
    groups.push(dates);
  }
  return groups;
}

function parseCataloniaJson(rows, year, local) {
  if (!Array.isArray(rows)) throw new Error("La API catalana no devolvió un array");
  const dates = [];
  for (const row of rows) {
    if (row.any_calendari !== String(year) || !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d+)?$/.test(row.data || "")) throw new Error("Registro catalán inesperado");
    if (local ? row.codi_municipi_ine !== "08019" || row.festiu !== "Festiu local" : !["Catalunya", "C. A. de Catalunya", undefined].includes(row.localitzaci)) throw new Error("Ámbito catalán inesperado");
    dates.push(row.data.slice(0, 10));
  }
  return [...new Set(dates)]; // La API general de 2026 repite registros equivalentes.
}

module.exports = { URLS, iso, textOf, listedDates, discoverPublication, discoverYearSection, discoverSevillaProposals, discoverAndaluciaLocal, parseSevillaDefinitive, parseMadrid, parseAragonPdf, parseNavarraLocal, parseZaragozaLocal, dogvSignature, dogvPdfUrl, parseValenciaLocalPdf, discoverEuskadiCalendar, parseEuskadiCalendar, discoverBarcelonaLocal, discoverBilbaoLocal, parseOfficial, parseBilbaoLocal, parseMalaga, parseCataloniaJson };
