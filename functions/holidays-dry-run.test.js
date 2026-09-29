"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, compare, readUrl, collect } = require("./holidays-dry-run");
const { evaluate, trace, synchronize } = require("./holidays-publish");
const { URLS, parseOfficial, parseBilbaoLocal, discoverBilbaoLocal, discoverBarcelonaLocal, discoverEuskadiCalendar, parseEuskadiCalendar, parseCataloniaJson, parseMalaga, discoverPublication, discoverYearSection, discoverSevillaProposals, discoverAndaluciaLocal, parseSevillaDefinitive, parseMadrid, parseAragonPdf, parseZaragozaLocal, dogvSignature, dogvPdfUrl, parseValenciaLocalPdf } = require("./holidays-sources");

test("índices oficiales seleccionan 2027 y 2028 sin ramas por año y 2029 queda pendiente", () => {
  for (const [base, label, host] of [
    [URLS.aragonIndex, /Decreto.*fiestas laborales/i, "www.boa.aragon.es"],
    [URLS.navarraIndex, /calendario oficial de fiestas laborales/i, "www.lexnavarra.navarra.es"],
    [URLS.valenciaIndex, /calendario laboral/i, "dogv.gva.es"],
  ]) {
    const title = host === "dogv.gva.es" ? "Decreto calendario laboral" : "Decreto calendario oficial de fiestas laborales";
    const html = `<a href="https://${host}/a">${title} 2027</a><a href="https://${host}/b">${title} 2028</a>`;
    assert.equal(discoverPublication(html, 2027, base, label, [host]), `https://${host}/a`);
    assert.equal(discoverPublication(html, 2028, base, label, [host]), `https://${host}/b`);
    assert.equal(discoverPublication(html, 2029, base, label, [host]), null);
  }
});

test("Madrid toma generales y locales solo del año y municipio solicitados", async () => {
  const calendar = year => `<h2>Fiestas laborales en el ámbito de la Comunidad de Madrid para el año ${year}</h2>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(day => `— ${day} de enero`).join(" ")} Además de las doce fiestas <h2>Fiestas laborales de ámbito local en la Comunidad de Madrid para el año ${year}</h2>— Alcobendas: 1 de mayo y 2 de mayo. — Madrid: 13 de enero y 14 de enero. `;
  for (const year of [2027, 2028]) {
    assert.equal(parseMadrid(calendar(year), year)[0].length, 12);
    assert.deepEqual(parseMadrid(calendar(year), year)[1], [`${year}-01-13`, `${year}-01-14`]);
  }
  assert.deepEqual(parseMadrid(calendar(2028), 2029), [[], []]);
  const read = async url => url === URLS.madrid ? calendar(2028) : url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal) ? [] : "";
  const row = (await collect(2028, read)).find(item => item.city === "Madrid");
  assert.equal(row.status, "complete", row.reason);
  assert.equal(row.dates.length, 14);
});

test("índices por sección de Andalucía y Valencia seleccionan 2027, 2028 y ausencia 2029", () => {
  for (const [base, title, host] of [[URLS.andaluciaIndex, "Año", "www.juntadeandalucia.es"], [URLS.valenciaIndex, "Calendario laboral", "dogv.gva.es"]]) {
    const html = `<h2>${title} 2027</h2><a href="https://${host}/a">Decreto A</a><h2>${title} 2028</h2><a href="https://${host}/b">Decreto B</a>`;
    assert.equal(discoverYearSection(html, 2027, base, /año|calendario laboral/i, /Decreto/i, [host]), `https://${host}/a`);
    assert.equal(discoverYearSection(html, 2028, base, /año|calendario laboral/i, /Decreto/i, [host]), `https://${host}/b`);
    assert.equal(discoverYearSection(html, 2029, base, /año|calendario laboral/i, /Decreto/i, [host]), null);
  }
});

test("Iruña completa 2028 al aparecer la resolución local en el índice y 2029 queda pendiente", async () => {
  const generalUrl = "https://www.lexnavarra.navarra.es/detalle.asp?r=100";
  const localUrl = "https://www.lexnavarra.navarra.es/detalle.asp?r=101";
  const index = `<a href="${generalUrl}">Calendario oficial de fiestas laborales para el año 2028</a><a href="${localUrl}">Fiestas locales para el año 2028</a>`;
  const general = `RESOLUCIÓN 1/2027 Comunidad Foral de Navarra para el año 2028 1.º Establecer como fiestas ${Array.from({ length: 13 }, (_, i) => `${i + 1} de enero`).join("; ")} 2.º La otra fiesta local`;
  const local = `<h1>Fiestas locales para el año 2028</h1><table><tr><td>PAMPLONA</td><td>14 de enero</td></tr></table>`;
  const read = async url => url === URLS.navarraIndex ? index : url === generalUrl ? general : url === localUrl ? local : url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal) ? [] : "";
  const row = (await collect(2028, read)).find(item => item.city === "Iruña");
  assert.equal(row.status, "complete", row.reason);
  assert.equal(row.dates.length, 14);
  assert.equal(row.sourceAuthority, "definitive");
  assert.equal(discoverPublication(index, 2029, URLS.navarraIndex, /fiestas locales/i, ["www.lexnavarra.navarra.es"]), null);
});

test("DOGV descubre general y local 2028 desde el índice y metadatos oficiales", async () => {
  const generalUrl = "https://dogv.gva.es/es/resultat-dogv?signatura=2027/100";
  const localUrl = "https://dogv.gva.es/es/resultat-dogv?signatura=2027/200";
  const index = `<h2>Calendario laboral 2028</h2><a href="${generalUrl}">DECRETO 1/2027 calendario laboral 2028</a><a href="${localUrl}">RESOLUCIÓN de 2027 por la que se aprueba el calendario de fiestas locales para el año 2028</a><h2>Calendario laboral 2027</h2>`;
  const general = `DECRETO 1/2027 Comunitat Valenciana para el año 2028 Primero Se declaran días inhábiles ${Array.from({ length: 12 }, (_, i) => `${i + 1} de enero`).join("; ")} Segundo El presente decreto`;
  const local = "RESOLUCIÓN por la que se aprueba el calendario de fiestas locales en la Comunitat Valenciana para el año 2028. RELACIÓN DE FIESTAS LOCALES EN LA PROVINCIA DE VALENCIA 2028. UTIEL: 1 de mayo. VALÈNCIA: 13 de enero; 14 de enero. VALLADA: 2 de mayo.";
  const reads = new Map([
    ["https://dogv.gva.es/dogv-portal/dogv/obtenerIdDogv/2027-100", 100],
    ["https://dogv.gva.es/dogv-portal/dogv/obtenerIdDogv/2027-200", 200],
    ["https://dogv.gva.es/dogv-portal/disposicion/100?lang=es_es", { codigoInsercion: "2027/100", fechaPublicacion: "2027-06-01" }],
    ["https://dogv.gva.es/dogv-portal/disposicion/200?lang=es_es", { codigoInsercion: "2027/200", fechaPublicacion: "2027-12-01" }],
    ["https://dogv.gva.es/datos/2027/06/01/pdf/2027_100_es.pdf", general],
    ["https://dogv.gva.es/datos/2027/12/01/pdf/2027_200_es.pdf", local],
  ]);
  const read = async url => url === URLS.valenciaIndex ? index : reads.has(url) ? reads.get(url) : url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal) ? [] : "";
  const row = (await collect(2028, read)).find(item => item.city === "Valencia");
  assert.equal(row.status, "complete");
  assert.equal(row.dates.length, 14);
  assert.equal(row.sourceAuthority, "definitive");
  assert.equal(discoverYearSection(index, 2029, URLS.valenciaIndex, /calendario laboral/i, /DECRETO/i, ["dogv.gva.es"]), null);
  assert.throws(() => dogvSignature("https://other.example/?signatura=2027/100"), /DOGV/);
  assert.throws(() => dogvPdfUrl(generalUrl, { codigoInsercion: "2027/200", fechaPublicacion: "2027-06-01" }), /DOGV/);
  assert.deepEqual(parseValenciaLocalPdf(local, 2028), ["2028-01-13", "2028-01-14"]);
});

test("Aragón localiza Zaragoza en la resolución futura sin fecha codificada", async () => {
  const general = `BOLETÍN OFICIAL DE ARAGÓN DECRETO 1/2027 por el que se fijan las fiestas laborales para el año 2028 en la Comunidad Autónoma de Aragón. Artículo primero. para el año 2028, en la Comunidad Autónoma de Aragón, serán las siguientes: ${Array.from({ length: 12 }, (_, i) => `${i + 1} de enero`).join("; ")} Artículo segundo.`;
  const local = "BOLETÍN OFICIAL DE ARAGÓN RESOLUCIÓN de fiestas laborales para el año 2028. Relación de días festivos de carácter local de los distintos municipios de la provincia de Zaragoza para el año 2028. - Zuera. 1 de mayo y 2 de mayo. - Zaragoza. 13 de enero y 14 de enero. - Zuera. 3 de mayo y 4 de mayo.";
  assert.equal(parseAragonPdf(general, 2028).length, 12);
  assert.deepEqual(parseZaragozaLocal(local, 2028), ["2028-01-13", "2028-01-14"]);
  const generalUrl = "https://www.boa.aragon.es/cgi-bin/EBOA/BRSCGI?CMD=VEROBJ&MLKOB=100";
  const localUrl = "https://www.boa.aragon.es/cgi-bin/EBOA/BRSCGI?CMD=VEROBJ&MLKOB=200";
  const index = `<a href="${generalUrl.replaceAll("&", "&amp;")}">Decreto de fiestas laborales para el año 2028 en la Comunidad Autónoma de Aragón</a><a href="${localUrl.replaceAll("&", "&amp;")}">Fiestas locales para el año 2028 en los municipios de las provincias de Huesca, Teruel y Zaragoza</a>`;
  const read = async url => url === URLS.aragonIndex ? index : url === generalUrl ? general : url === localUrl ? local : url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal) ? [] : "";
  const row = (await collect(2028, read)).find(item => item.city === "Zaragoza");
  assert.equal(row.status, "complete", row.reason);
  assert.equal(row.dates.length, 14);
});

test("Sevilla descubre el archivo y sus plenos por año, sin ID de PDF fijo", () => {
  const archive = `${URLS.sevillaIndex}/2026`;
  const index = `<a href="${archive}">Más información 2026</a><a href="${URLS.sevillaIndex}/2027">Más información 2027</a>`;
  assert.equal(discoverPublication(index, 2026, URLS.sevillaIndex, /Más información/i, ["www.sevilla.org"]), archive);
  assert.equal(discoverPublication(index, 2027, URLS.sevillaIndex, /Más información/i, ["www.sevilla.org"]), `${URLS.sevillaIndex}/2027`);
  assert.equal(discoverPublication(index, 2028, URLS.sevillaIndex, /Más información/i, ["www.sevilla.org"]), null);
  assert.deepEqual(discoverSevillaProposals(`<a href="${URLS.sevilla}">Orden del día, sesión ordinaria</a>`, archive, 2027), [URLS.sevilla]);
});

test("resolución definitiva andaluza prevalece sobre propuesta sevillana", async () => {
  const general = `<h1>Decreto 84/2026 Comunidad Autónoma de Andalucía para el año 2027</h1><p>Calendario de fiestas laborales de la Comunidad Autónoma de Andalucía para el año 2027 ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(day => `${day} de enero`).join("; ")} Descargar PDF</p>`;
  const localUrl = "https://www.juntadeandalucia.es/boja/2026/150/1";
  const index = `<h3>Año 2027</h3><a href="${URLS.andalucia}">Decreto 84/2026</a><h3>Años anteriores</h3><h2>Fiestas locales</h2><li><a href="${localUrl}">Resolución de 2026</a>, por la que se publica la relación de fiestas locales de los municipios de Andalucía para el año 2027.</li><h3>Años anteriores</h3>`;
  const local = `<h1>ANEXO FIESTAS LOCALES DE ANDALUCÍA 2027</h1><table><tr><td>SEVILLA</td><td>14 DE ABRIL</td><td>27 DE MAYO</td></tr></table>`;
  assert.equal(discoverAndaluciaLocal(index, 2027), localUrl);
  assert.deepEqual(parseSevillaDefinitive(local, 2027), ["2027-04-14", "2027-05-27"]);
  const read = async url => {
    if (url === URLS.andaluciaIndex) return index;
    if (url === URLS.andalucia) return general;
    if (url === localUrl) return local;
    if (url === URLS.sevillaIndex || url === URLS.sevilla) throw new Error("La propuesta no debe leerse");
    if (url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal)) return [];
    return "";
  };
  const row = (await collect(2027, read)).find(item => item.city === "Sevilla");
  assert.equal(row.status, "complete");
  assert.equal(row.sourceAuthority, "definitive");
  assert.equal(evaluate(row, null, 2027).action, "created");
});

test("normaliza, ordena y elimina duplicados", () => {
  assert.deepEqual(normalize(["2027-12-25", "2027-01-01", "2027-01-01"], 2027), ["2027-01-01", "2027-12-25"]);
});

test("rechaza fechas imposibles, ambiguas y fuera del año", () => {
  for (const value of ["2027-02-29", "2027-13-01", "01/06/2027", "2026-12-25", 20270101]) {
    assert.throws(() => normalize([value], 2027));
  }
  assert.deepEqual(normalize(["2028-02-29"], 2028), ["2028-02-29"]);
});

test("comparación de conjuntos: MATCH y DIFFERENT en ambos sentidos", () => {
  const source = { status: "complete", dates: ["2027-01-01", "2027-12-25"] };
  assert.equal(compare(source, { fechas: ["2027-12-25", "2027-01-01"] }, 2027).result, "MATCH");
  assert.deepEqual(compare(source, { fechas: ["2027-12-25", "2027-05-01"] }, 2027), {
    result: "DIFFERENT", missingInFirestore: ["2027-01-01"], extraInFirestore: ["2027-05-01"],
  });
  assert.deepEqual(compare(source, null, 2027).missingInFirestore, source.dates);
});

test("partial y pending no se convierten en diferencia", () => {
  assert.equal(compare({ status: "partial", reason: "falta local" }, null, 2027).result, "PARTIAL");
  assert.equal(compare({ status: "pending", reason: "sin decreto" }, null, 2027).result, "PENDING");
  assert.equal(compare({ status: "error", reason: "HTTP" }, null, 2027).result, "ERROR");
  assert.equal(compare({ status: "unsupported", reason: "PDF escaneado" }, null, 2027).result, "UNSUPPORTED");
});

test("Firestore con fechas ausentes o inválidas da ERROR", () => {
  const source = { status: "complete", dates: ["2027-01-01"] };
  assert.equal(compare(source, {}, 2027).result, "ERROR");
  assert.equal(compare(source, { fechas: ["2027-02-29"] }, 2027).result, "ERROR");
});

test("HTTP falla ante status y Content-Type inesperados", async () => {
  await assert.rejects(readUrl("https://example.org/x", "html", async () => new Response("no", { status: 503, headers: { "content-type": "text/html" } })), /HTTP 503/);
  await assert.rejects(readUrl("https://example.org/x", "json", async () => new Response("<html/>", { headers: { "content-type": "text/html" } })), /Content-Type/);
  await assert.rejects(readUrl("https://example.org/x", "json", async () => new Response("{broken", { headers: { "content-type": "application/json" } })), /JSON/);
});

test("API catalana: filtra ámbito, deduplica y rechaza registros inesperados", () => {
  const row = { any_calendari: "2026", data: "2026-09-24T00:00:00.000", codi_municipi_ine: "08019", festiu: "Festiu local" };
  assert.deepEqual(parseCataloniaJson([row, row], 2026, true), ["2026-09-24"]);
  assert.throws(() => parseCataloniaJson([{ ...row, codi_municipi_ine: "08020" }], 2026, true), /Ámbito/);
  assert.throws(() => parseCataloniaJson({ data: row }, 2026, true), /array/);
});

test("Barcelona 2026 combina doce generales y dos locales, sin trasladar la excepción de Aran", async () => {
  const general = ["2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01", "2026-06-24", "2026-08-15", "2026-09-11", "2026-10-12", "2026-12-08", "2026-12-25", "2026-12-26"];
  const local = ["2026-05-25", "2026-09-24"];
  const generalRows = general.map(date => ({ any_calendari: "2026", data: `${date}T00:00:00.000`, localitzaci: "Catalunya" }));
  const localRows = local.map(date => ({ any_calendari: "2026", data: `${date}T00:00:00.000`, codi_municipi_ine: "08019", festiu: "Festiu local" }));
  const malagaGeneral = ["1 de enero", "6 de enero", "28 de febrero", "2 de abril", "3 de abril", "1 de mayo", "15 de agosto", "12 de octubre", "2 de noviembre", "7 de diciembre", "8 de diciembre", "25 de diciembre"];
  const table = dates => `<table>${dates.map(date => `<tr><td>${date}</td></tr>`).join("")}</table>`;
  const malagaHtml = `FIESTAS NACIONALES Y AUTONÓMICAS 2026 ${table(malagaGeneral)} FIESTAS LOCALES 2026 ${table(["19 de agosto", "8 de septiembre"])}`;
  const read = async url => {
    if (url.startsWith(URLS.cataloniaGeneral)) return generalRows;
    if (url.startsWith(URLS.cataloniaLocal)) return localRows;
    if (url === URLS.malaga) return malagaHtml;
    throw new Error(`Petición inesperada: ${url}`);
  };

  assert.equal(parseCataloniaJson(generalRows, 2026, false).length, 12);
  assert.deepEqual(parseCataloniaJson(localRows, 2026, true), local);
  const barcelona = (await collect(2026, read)).find(row => row.city === "Barcelona");
  assert.equal(barcelona.status, "complete");
  assert.deepEqual(barcelona.dates, normalize([...general, ...local], 2026));
  assert.equal(barcelona.dates.length, 14);
  assert.ok(barcelona.dates.includes("2026-12-26"));
  for (const date of ["2026-06-17", "2026-11-01", "2026-12-06"]) assert.ok(!barcelona.dates.includes(date));
  assert.equal(compare(barcelona, { fechas: [...barcelona.dates].reverse() }, 2026).result, "MATCH");

  assert.throws(() => parseCataloniaJson([{ ...generalRows[0], data: "2026-06-17T00:00:00.000", localitzaci: "Aran" }], 2026, false), /Ámbito/);
});

test("BOPV: extrae únicamente la sección laboral general identificada", () => {
  const dates = ["1 de enero", "6 de enero", "25 de marzo", "26 de marzo", "29 de marzo", "1 de mayo", "7 de octubre", "12 de octubre", "1 de noviembre", "6 de diciembre", "8 de diciembre", "25 de diciembre"];
  const html = `<h1>DECRETO 90/2026</h1><p>Comunidad Autónoma de Euskadi para el año 2027</p><p>Artículo 1. Días inhábiles a efectos laborales en 2027. ${dates.join(". ")}.</p><p>Artículo 2. Fiesta local: 20 de enero.</p>`;
  assert.equal(parseOfficial("euskadi", html, 2027).length, 12);
  assert.ok(!parseOfficial("euskadi", html, 2027).includes("2027-01-20"));
  assert.throws(() => parseOfficial("euskadi", html.replace("DECRETO 90/2026", "NOTICIA"), 2027), /Identidad/);
});

test("índice Euskadi descubre el año solicitado y separa territorios", () => {
  const index = `<h2><a id="euskadi"></a>Comunidad Autónoma de Euskadi</h2><a href="/contenidos/informacion/5907/es_2296/general-2027.pdf">Calendario laboral 2027, Comunidad Autónoma de Euskadi</a><a href="/contenidos/informacion/5907/es_2296/general-2028.pdf">Calendario laboral 2028, Comunidad Autónoma de Euskadi</a><h2><a id="alava"></a>Araba / Álava</h2><a href="/contenidos/informacion/5907/es_2296/alava-2028.pdf">Calendario laboral 2028, Araba / Álava</a><h2><a id="gipuzkoa"></a>Gipuzkoa</h2><a href="/contenidos/informacion/5907/es_2296/gipuzkoa-2028.pdf">Calendario laboral 2028, Gipuzkoa</a>`;
  assert.match(discoverEuskadiCalendar(index, 2028, "general"), /general-2028\.pdf$/);
  assert.match(discoverEuskadiCalendar(index, 2028, "gasteiz"), /alava-2028\.pdf$/);
  assert.match(discoverEuskadiCalendar(index, 2028, "donostia"), /gipuzkoa-2028\.pdf$/);
  assert.equal(discoverEuskadiCalendar(index, 2027, "donostia"), null);
  assert.equal(discoverEuskadiCalendar(index, 2029, "general"), null);
  assert.throws(() => discoverEuskadiCalendar(index.replace("/contenidos/informacion/5907/es_2296/gipuzkoa-2028.pdf", "https://example.org/other.pdf"), 2028, "donostia"), /URL oficial/);
});

test("índices locales BOB y Gaseta cambian publicación al cambiar el año", () => {
  const bob = `${BILBAO_INDEX}<p>Calendario de Fiestas Locales del Territorio Histórico de Bizkaia para el año 2028.</p><a href="https://www.bizkaia.eus/lehendakaritza/Bao_bob/2027/09/22/III-150_cas.pdf">Descargar</a>`;
  const gaseta = BARCELONA_INDEX.replace("Cataluña. Fiestas laborales:", `<a href="https://w123.bcn.cat/APPS/egaseta/home.do?reqCode=downloadFile&amp;publicacionsId=36001">2028 (enlace anuncio Gaseta Municipal)</a> Cataluña. Fiestas laborales:`);
  assert.match(discoverBilbaoLocal(bob, 2027), /III-145_cas\.pdf$/);
  assert.match(discoverBilbaoLocal(bob, 2028), /III-150_cas\.pdf$/);
  assert.equal(discoverBilbaoLocal(bob, 2029), null);
  assert.match(discoverBarcelonaLocal(gaseta, 2027), /publicacionsId=35009$/);
  assert.match(discoverBarcelonaLocal(gaseta, 2028), /publicacionsId=36001$/);
  assert.equal(discoverBarcelonaLocal(gaseta, 2029), null);
});

test("PDF Euskadi valida año, ámbito territorial y municipio antes de extraer locales", () => {
  const general = "BOLETÍN OFICIAL DEL PAÍS VASCO Calendario Oficial de Fiestas Laborales de la Comunidad Autónoma de Euskadi para el año 2028 Artículo 1. 1 de enero. 6 de enero. 2 de abril. 3 de abril. 6 de abril. 1 de mayo. 25 de julio. 15 de agosto. 12 de octubre. 8 de diciembre. 24 de diciembre. 25 de diciembre. Artículo 2. 20 de enero";
  assert.equal(parseEuskadiCalendar(general, 2028, "general").length, 12);
  assert.throws(() => parseEuskadiCalendar(general, 2027, "general"), /año/);
  const alava = "BOLETÍN OFICIAL DEL TERRITORIO HISTÓRICO DE ÁLAVA fiestas locales de Álava para el año 2028 Día de fiesta del territorio histórico: 28 de abril DÍAS DE FIESTA DE CARÁCTER LOCAL Vitoria-Gasteiz 5 de agosto Yécora 21 de agosto";
  assert.deepEqual(parseEuskadiCalendar(alava, 2028, "gasteiz"), ["2028-04-28", "2028-08-05"]);
  assert.throws(() => parseEuskadiCalendar(alava.replace("Vitoria-Gasteiz", "Llodio"), 2028, "gasteiz"), /incompleto/);
  const gipuzkoa = "Boletín Oficial de Gipuzkoa fiestas locales de Gipuzkoa para el año 2028 DISPONGO — 31 de julio, en todo el Territorio His- tórico de Gipuzkoa. — Para cada municipio SAN SEBASTIÁN 20 de enero EIBAR 24 de junio";
  assert.deepEqual(parseEuskadiCalendar(gipuzkoa, 2028, "donostia"), ["2028-07-31", "2028-01-20"]);
  assert.throws(() => parseEuskadiCalendar(gipuzkoa.replace("SAN SEBASTIÁN", "EIBAR"), 2028, "donostia"), /incompleto/);
});

const BILBAO_BOB = "BOLETÍN OFICIAL DE BIZKAIA Resolución por la que se establece el Calendario de Fiestas Locales del Territorio Histórico de Bizkaia para el año 2027. DISPONGO: Que, en el Territorio Histórico de Bizkaia para el año 2027 las dos Festividades de ámbito local, inhábiles para el trabajo, retribuidas y no recuperables, serán las siguientes: — El 31 de Julio, San Ignacio de Loyola, en todo el Territorio Histórico de Bizkaia. — Para cada Municipio del Territorio Histórico de Bizkaia: • Bermeo – 08 de septiembre • Bilbao – 27 de agosto (Viernes de la Semana Grande) • Busturia – 26 de julio";
const BILBAO_INDEX = `<p>Calendario de Fiestas Locales del Territorio Histórico de Bizkaia para el año 2027.</p><a href="https://www.bizkaia.eus/lehendakaritza/Bao_bob/2026/09/22/III-145_cas.pdf">Descargar</a>`;

test("BOB Bizkaia 2027: combina territorial y municipio Bilbao, rechaza otro ámbito o año", () => {
  assert.equal(discoverBilbaoLocal(BILBAO_INDEX, 2027), "https://www.bizkaia.eus/lehendakaritza/Bao_bob/2026/09/22/III-145_cas.pdf");
  assert.equal(discoverBilbaoLocal(BILBAO_INDEX, 2028), null);
  assert.throws(() => discoverBilbaoLocal(BILBAO_INDEX.replace("III-145_cas.pdf", "anuncio.html"), 2027), /sin PDF/);
  assert.deepEqual(parseBilbaoLocal(BILBAO_BOB, 2027), ["2027-07-31", "2027-08-27"]);
  assert.throws(() => parseBilbaoLocal(BILBAO_BOB.replace("Bilbao –", "Barakaldo –"), 2027), /Bilbao/);
  assert.throws(() => parseBilbaoLocal(BILBAO_BOB, 2028), /Identidad/);
  assert.throws(() => parseBilbaoLocal(BILBAO_BOB.replace("en todo el Territorio Histórico de Bizkaia", "en Bilbao"), 2027), /territorial/);
});

const BARCELONA_GASETA = "GASETA MUNICIPAL Disposicions generals – Decrets de l'Alcaldia DECRET D'ALCALDIA ANY2026-15675 de 4 de juny, pel qual es fixen les festes locals a celebrar durant l'any 2027. Fixar, com a festes locals a celebrar durant l'any 2027 en el terme municipal de Barcelona, els dies: - 17 de maig, dilluns de Pasqua Granada - 24 de setembre, Mare de Déu de la Mercè Barcelona, 4 de juny de 2026.";
const BARCELONA_INDEX = `<p>Barcelona. Fiestas locales:</p><p><a href="https://w123.bcn.cat/APPS/egaseta/home.do?reqCode=downloadFile&amp;publicacionsId=35009">2027 (enlace anuncio Gaseta Municipal)</a></p><p>Cataluña. Fiestas laborales:</p>`;

test("Gaseta Barcelona: descubre el año, extrae dos locales y rechaza otro municipio/año/sección", () => {
  const url = discoverBarcelonaLocal(BARCELONA_INDEX, 2027);
  assert.equal(url, "https://w123.bcn.cat/APPS/egaseta/home.do?reqCode=downloadFile&publicacionsId=35009");
  assert.equal(discoverBarcelonaLocal(BARCELONA_INDEX, 2028), null);
  assert.throws(() => discoverBarcelonaLocal(BARCELONA_INDEX.replace("Gaseta Municipal)</a>", "Gaseta Municipal)</span>"), 2027), /sin enlace/);
  assert.deepEqual(parseOfficial("barcelonaLocal", BARCELONA_GASETA, 2027), ["2027-05-17", "2027-09-24"]);
  assert.throws(() => parseOfficial("barcelonaLocal", BARCELONA_GASETA.replace("terme municipal de Barcelona", "terme municipal de Girona"), 2027), /Identidad/);
  assert.throws(() => parseOfficial("barcelonaLocal", BARCELONA_GASETA.replaceAll("2027", "2028"), 2027));
  assert.throws(() => parseOfficial("barcelonaLocal", BARCELONA_GASETA.replace("- 24 de setembre, Mare de Déu de la Mercè", "Mare de Déu de la Mercè"), 2027), /ausentes/);
  assert.throws(() => parseOfficial("barcelonaLocal", `24 de setembre. ${BARCELONA_GASETA.replace("- 24 de setembre, Mare de Déu de la Mercè", "Mare de Déu de la Mercè")}`, 2027), /ausentes/);
});

test("Bilbao y Barcelona 2027 completan sus calendarios solo con extractores oficiales", async () => {
  const euskadiDates = ["1 de enero", "6 de enero", "25 de marzo", "26 de marzo", "29 de marzo", "1 de mayo", "7 de octubre", "12 de octubre", "1 de noviembre", "6 de diciembre", "8 de diciembre", "25 de diciembre"];
  const euskadi = `BOLETÍN OFICIAL DEL PAÍS VASCO Calendario Oficial de Fiestas Laborales de la Comunidad Autónoma de Euskadi para el año 2027 Artículo 1. ${euskadiDates.join(". ")}. Artículo 2. Fiesta local`;
  const euskadiPdf = "https://www.euskadi.eus/contenidos/informacion/5907/es_2296/general-2027.pdf";
  const euskadiIndex = `<h2><a id="euskadi"></a>Comunidad Autónoma de Euskadi</h2><a href="${euskadiPdf}">Calendario laboral 2027, Comunidad Autónoma de Euskadi</a><h2><a id="alava"></a>Araba / Álava</h2><h2><a id="gipuzkoa"></a>Gipuzkoa</h2>`;
  const catalonia = ["2027-01-01", "2027-01-06", "2027-03-26", "2027-03-29", "2027-05-01", "2027-06-24", "2027-09-11", "2027-10-12", "2027-11-01", "2027-12-06", "2027-12-08", "2027-12-25"];
  let bobReads = 0;
  const read = async url => {
    if (url === URLS.euskadiIndex) return euskadiIndex;
    if (url === euskadiPdf) return euskadi;
    if (url.startsWith(URLS.bilbaoIndex)) return ++bobReads === 1 ? "<p>Sin resultados</p>" : BILBAO_INDEX;
    if (url === discoverBilbaoLocal(BILBAO_INDEX, 2027)) return BILBAO_BOB;
    if (url.startsWith(URLS.cataloniaGeneral)) return catalonia.map(date => ({ any_calendari: "2027", data: `${date}T00:00:00.000`, localitzaci: "Catalunya" }));
    if (url.startsWith(URLS.cataloniaLocal)) return [];
    if (url === URLS.barcelonaIndex) return BARCELONA_INDEX;
    if (url === discoverBarcelonaLocal(BARCELONA_INDEX, 2027)) return BARCELONA_GASETA;
    throw new Error("Fuente no disponible en este fixture");
  };
  const rows = await collect(2027, read);
  assert.equal(bobReads, 2);
  for (const city of ["Bilbao", "Barcelona"]) {
    const row = rows.find(item => item.city === city);
    assert.equal(row.status, "complete");
    assert.equal(row.dates.length, 14);
  }
  assert.ok(rows.find(row => row.city === "Bilbao").dates.includes("2027-07-31"));
  assert.ok(rows.find(row => row.city === "Barcelona").dates.includes("2027-09-24"));
  assert.ok(!rows.find(row => row.city === "Barcelona").dates.includes("2027-06-17"));
});

test("DOGV textual: exige decreto, ámbito y doce fechas", () => {
  const dates = ["1 de enero", "6 de enero", "19 de marzo", "26 de marzo", "29 de marzo", "1 de mayo", "9 de octubre", "12 de octubre", "1 de noviembre", "6 de diciembre", "8 de diciembre", "25 de diciembre"];
  const text = `DECRETO 42/2026 calendario laboral de aplicación en el ámbito territorial de la Comunitat Valenciana para el año 2027. Primero Se declaran días inhábiles a efectos laborales para el año 2027: ${dates.join("; ")}. Segundo El presente decreto surtirá efectos.`;
  assert.equal(parseOfficial("valenciaGeneral", text, 2027).length, 12);
  assert.throws(() => parseOfficial("valenciaGeneral", text.replace("9 de octubre", "9 de octubre y 10 de octubre"), 2027), /se esperaban 12/);
});

const SEVILLA_PROPOSAL = "ORDEN DEL DIA DE LA SESION ORDINARIA DEL AYUNTAMIENTO PLENO DE 18 DE JUNIO DE 2026. Expte. 44/2026 AL EXCMO. AYUNTAMIENTO PLENO Por el Área de Fiestas Mayores (Servicio de Fiestas Mayores), se ha instruido expediente para determinar las fiestas locales de la ciudad de Sevilla para el año 2027. ACUERDO PRIMERO.- Determinar como fiesta local de la ciudad de Sevilla para el año 2027, el día 14 de abril (miércoles): Feria de Abril. SEGUNDO.- Determinar como fiesta local de la ciudad de Sevilla para el año 2027, el día 27 de mayo (jueves): Corpus Christi. TERCERO.- Dar cuenta de la propuesta a la Consejería. Código Seguro De Verificación";

test("propuesta sevillana: extrae las dos locales dentro del expediente 44/2026", () => {
  assert.deepEqual(parseOfficial("sevilla", SEVILLA_PROPOSAL, 2027), ["2027-04-14", "2027-05-27"]);
});

test("Sevilla 2027: combina doce generales BOJA y dos locales municipales", async () => {
  const general = ["1 de enero", "6 de enero", "1 de marzo", "25 de marzo", "26 de marzo", "1 de mayo", "16 de agosto", "12 de octubre", "1 de noviembre", "6 de diciembre", "8 de diciembre", "25 de diciembre"];
  const boja = `<h1>Decreto 84/2026 de la Comunidad Autónoma de Andalucía para el año 2027</h1><p>Calendario de fiestas laborales de la Comunidad Autónoma de Andalucía para el año 2027 ${general.join("; ")}. Descargar PDF</p>`;
  assert.equal(parseOfficial("andalucia", boja, 2027).length, 12);
  const read = async url => {
    if (url === URLS.andaluciaIndex) return `<h3>Año 2027</h3><a href="${URLS.andalucia}">Decreto 84/2026</a><h3>Años anteriores</h3>`;
    if (url === URLS.andalucia) return boja;
    if (url === URLS.sevillaIndex) return `<a href="${URLS.sevillaIndex}/2026">Más información 2026</a>`;
    if (url === `${URLS.sevillaIndex}/2026`) return `<a href="${URLS.sevilla}">Orden del día, sesión ordinaria</a>`;
    if (url === URLS.sevilla) return SEVILLA_PROPOSAL;
    throw new Error("Fuente no disponible en este fixture");
  };
  const sevilla = (await collect(2027, read)).find(row => row.city === "Sevilla");
  assert.equal(sevilla.status, "complete");
  assert.equal(sevilla.dates.length, 14);
  assert.ok(sevilla.dates.includes("2027-04-14"));
  assert.ok(sevilla.dates.includes("2027-05-27"));
  assert.deepEqual(sevilla.sources, [URLS.andalucia, URLS.sevilla]);
  assert.equal(evaluate(sevilla, null, 2027).action, "not_publicable");
});

test("Sevilla: rechaza una propuesta sin año 2027", () => {
  assert.throws(() => parseOfficial("sevilla", SEVILLA_PROPOSAL.replaceAll("2027", "2028"), 2027));
});

test("Sevilla: rechaza texto sin contexto de fiestas locales de Sevilla", () => {
  assert.throws(() => parseOfficial("sevilla", SEVILLA_PROPOSAL.replace("fiestas locales de la ciudad de Sevilla para el año 2027", "actividades culturales"), 2027), /Contexto/);
});

test("Sevilla: rechaza una propuesta con una sola fiesta", () => {
  assert.throws(() => parseOfficial("sevilla", SEVILLA_PROPOSAL.replace("27 de mayo (jueves): Corpus Christi", "Corpus Christi"), 2027), /incompleta/);
});

test("Sevilla: ignora fechas fuera del acuerdo y no las acepta como fiestas", () => {
  const misplaced = `14 de abril. 27 de mayo. ${SEVILLA_PROPOSAL.replace("14 de abril (miércoles): Feria de Abril", "Feria de Abril").replace("27 de mayo (jueves): Corpus Christi", "Corpus Christi")}`;
  assert.throws(() => parseOfficial("sevilla", misplaced, 2027), /incompleta/);
});

test("tabla municipal de Málaga separa generales y locales", () => {
  const general = ["1 de enero", "6 de enero", "1 de marzo", "25 de marzo", "26 de marzo", "1 de mayo", "16 de agosto", "12 de octubre", "1 de noviembre", "6 de diciembre", "8 de diciembre", "25 de diciembre"];
  const table = dates => `<table>${dates.map(date => `<tr><td>${date}</td><td>Festividad</td></tr>`).join("")}</table>`;
  const html = `FIESTAS NACIONALES Y AUTONÓMICAS 2027 ${table(general)} FIESTAS LOCALES 2027 ${table(["19 de agosto", "8 de septiembre"])}`;
  assert.deepEqual(parseMalaga(html, 2027).map(group => group.length), [12, 2]);
  assert.throws(() => parseMalaga(html.replace("19 de agosto", "20 de febrero" ).replace("8 de septiembre", "20 de febrero"), 2027), /contiene/);
});

const PUBLISH_DATES = ["2027-01-01", "2027-01-06", "2027-03-26", "2027-03-29", "2027-05-01", "2027-05-17", "2027-06-24", "2027-09-11", "2027-09-24", "2027-10-12", "2027-11-01", "2027-12-06", "2027-12-08", "2027-12-25"];
const PUBLISH_ROW = { city: "Barcelona", year: 2027, status: "complete", dates: PUBLISH_DATES, sources: ["https://treball.gencat.cat/calendari", "https://w123.bcn.cat/gaseta.pdf"], sourceAuthority: "definitive" };

function memoryFirestore(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const writes = [];
  const ref = path => ({
    path,
    async get() { return { exists: docs.has(path), data: () => docs.get(path) }; },
    async set(value) { docs.set(path, value); writes.push({ path, type: "set" }); },
  });
  return {
    docs, writes,
    doc: ref,
    batch() {
      const operations = [];
      return {
        create(document, value) { operations.push({ path: document.path, value, type: "create" }); },
        set(document, value) { operations.push({ path: document.path, value, type: "set" }); },
        async commit() {
          if (operations.some(op => op.type === "create" && docs.has(op.path))) throw Object.assign(new Error("exists"), { code: 6 });
          for (const op of operations) { docs.set(op.path, op.value); writes.push({ path: op.path, type: op.type }); }
        },
      };
    },
  };
}

test("publicación: preview, creación atómica e idempotencia", async () => {
  const db = memoryFirestore();
  const preview = await synchronize(2027, db, { rows: [PUBLISH_ROW], timestamp: "now" });
  assert.equal(preview[0].action, "WOULD_CREATE");
  assert.equal(db.writes.length, 0);
  const first = await synchronize(2027, db, { rows: [PUBLISH_ROW], write: true, timestamp: "now" });
  assert.equal(first[0].action, "created");
  assert.deepEqual(db.docs.get("festivos_oficiales/Barcelona/años/2027"), { fechas: PUBLISH_DATES });
  assert.equal(db.docs.get("festivos_sync/Barcelona_2027").publicationResult, "created");
  const second = await synchronize(2027, db, { rows: [PUBLISH_ROW], write: true, timestamp: "later" });
  assert.equal(second[0].action, "unchanged");
  assert.equal(db.writes.filter(write => write.path.startsWith("festivos_oficiales/")).length, 1);
});

test("publicación: documento diferente produce conflicto sin sobrescritura", async () => {
  const path = "festivos_oficiales/Barcelona/años/2027";
  const original = { fechas: [...PUBLISH_DATES.slice(1), "2027-12-26"] };
  const db = memoryFirestore({ [path]: original });
  const result = await synchronize(2027, db, { rows: [PUBLISH_ROW], write: true, timestamp: "now" });
  assert.equal(result[0].action, "conflict");
  assert.deepEqual(result[0].missingInFirestore, ["2027-01-01"]);
  assert.deepEqual(result[0].extraInFirestore, ["2027-12-26"]);
  assert.deepEqual(db.docs.get(path), original);
  assert.equal(db.writes.filter(write => write.path === path).length, 0);
  db.docs.set(path, { fechas: PUBLISH_DATES });
  assert.equal((await synchronize(2027, db, { rows: [PUBLISH_ROW], write: true, timestamp: "later" }))[0].action, "unchanged");
  assert.ok(!("missingInFirestore" in db.docs.get("festivos_sync/Barcelona_2027")));
});

test("publicación: propuesta, partial, pending, unsupported y error nunca crean calendario", async () => {
  for (const [status, authority, expected] of [["complete", "proposal", "not_publicable"], ["partial", "pending", "partial"], ["pending", "pending", "pending"], ["unsupported", "pending", "unsupported"], ["error", "pending", "error"]]) {
    const row = { ...PUBLISH_ROW, status, sourceAuthority: authority, dates: status === "complete" ? PUBLISH_DATES : [] };
    const db = memoryFirestore();
    const result = await synchronize(2027, db, { rows: [row], write: true, timestamp: "now" });
    assert.equal(result[0].action, expected);
    assert.equal(result[0].publicable, false);
    assert.ok(!db.docs.has("festivos_oficiales/Barcelona/años/2027"));
    assert.equal(db.docs.get("festivos_sync/Barcelona_2027").publicationResult, expected);
  }
});

test("publicación: fallo de fuente no altera documento existente", async () => {
  const path = "festivos_oficiales/Barcelona/años/2027";
  const db = memoryFirestore({ [path]: { fechas: PUBLISH_DATES } });
  const row = { ...PUBLISH_ROW, status: "error", dates: [], sources: [], reason: "HTTP 503" };
  const result = await synchronize(2027, db, { rows: [row], write: true, timestamp: "now" });
  assert.equal(result[0].action, "error");
  assert.equal(db.writes.filter(write => write.path === path).length, 0);
  assert.deepEqual(db.docs.get(path).fechas, PUBLISH_DATES);
  assert.equal(db.docs.get("festivos_sync/Barcelona_2027").errorCode, "SOURCE_ERROR");
});

test("publicación: rechaza año, ciudad, duplicados, orden, ámbito y autoridad insuficiente", () => {
  assert.throws(() => evaluate({ ...PUBLISH_ROW, year: 2028 }, null, 2027), /Ciudad o año/);
  assert.throws(() => evaluate({ ...PUBLISH_ROW, city: "Barcelona/otro" }, null, 2027), /Ciudad o año/);
  assert.throws(() => evaluate({ ...PUBLISH_ROW, dates: [...PUBLISH_DATES.slice(0, 13), PUBLISH_DATES[0]] }, null, 2027), /normalizar/);
  assert.throws(() => evaluate({ ...PUBLISH_ROW, dates: [...PUBLISH_DATES].reverse() }, null, 2027), /desordenadas/);
  assert.throws(() => evaluate({ ...PUBLISH_ROW, dates: [...PUBLISH_DATES.slice(0, 13), "2028-01-01"] }, null, 2027), /Fecha o año/);
  assert.equal(evaluate({ ...PUBLISH_ROW, sourceAuthority: "proposal" }, null, 2027).action, "not_publicable");
  assert.equal(evaluate({ ...PUBLISH_ROW, sourceAuthority: "unknown" }, null, 2027).publicable, false);
});

test("trazabilidad: conserva procedencia y resultado sin guardar respuestas completas", () => {
  const metadata = trace(PUBLISH_ROW, { action: "created", publicable: true }, "now");
  assert.deepEqual(metadata.sources, PUBLISH_ROW.sources);
  assert.equal(metadata.dateCount, 14);
  assert.equal(metadata.lastCheckedAt, "now");
  assert.equal(metadata.lastSuccessfulExtractionAt, "now");
  assert.equal(metadata.sourceAuthority, "definitive");
  assert.equal(metadata.publicationResult, "created");
  assert.ok(!("html" in metadata));
});

test("timeout de Sevilla conserva las diez ciudades y no contamina las otras nueve", async () => {
  const read = async url => {
    if (url === URLS.andaluciaIndex) return `<h3>Año 2027</h3><a href="${URLS.andalucia}">Decreto 84/2026</a><h3>Años anteriores</h3>`;
    if (url === URLS.andalucia) return `<h1>Decreto 84/2026 Comunidad Autónoma de Andalucía para el año 2027</h1><p>Calendario de fiestas laborales de la Comunidad Autónoma de Andalucía para el año 2027 ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(day => `${day} de enero`).join("; ")} Descargar PDF</p>`;
    if (url === URLS.sevillaIndex) return `<a href="${URLS.sevillaIndex}/2026">Más información 2026</a>`;
    if (url === `${URLS.sevillaIndex}/2026`) return `<a href="${URLS.sevilla}">Orden del día, sesión ordinaria</a>`;
    if (url === URLS.sevilla) throw new Error("timeout Sevilla");
    if (url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal)) return [];
    if (url === URLS.malaga) return "";
    return "";
  };
  const rows = await collect(2027, read);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map(row => row.city)).size, 10);
  assert.equal(rows.find(row => row.city === "Sevilla").status, "error");
  assert.match(rows.find(row => row.city === "Sevilla").reason, /timeout/);
  assert.ok(rows.filter(row => row.city !== "Sevilla").every(row => row.reason !== "timeout Sevilla"));
});

test("2028 entra en el pipeline y publicaciones ausentes quedan pending", async () => {
  const read = async url => {
    if (url === URLS.euskadiIndex) return `<h2><a id="euskadi"></a>Comunidad Autónoma de Euskadi</h2><h2><a id="alava"></a>Araba</h2><h2><a id="gipuzkoa"></a>Gipuzkoa</h2>`;
    if (url === URLS.barcelonaIndex) return "Barcelona. Fiestas locales: <p>Sin publicar</p> Cataluña. Fiestas laborales:";
    if (url.startsWith(URLS.cataloniaGeneral) || url.startsWith(URLS.cataloniaLocal)) return [];
    return "";
  };
  const rows = await collect(2028, read);
  assert.equal(rows.length, 10);
  assert.ok(rows.every(row => row.year === 2028 && row.status === "pending"));
});

test("preview conserva creación válida con Sevilla error y Madrid pending", async () => {
  const db = memoryFirestore();
  const rows = [
    { ...PUBLISH_ROW, city: "Bilbao" },
    { city: "Sevilla", year: 2027, status: "error", dates: [], sources: [], reason: "timeout" },
    { city: "Madrid", year: 2027, status: "pending", dates: [], sources: [] },
    PUBLISH_ROW,
  ];
  const result = await synchronize(2027, db, { rows });
  assert.deepEqual(result.map(row => row.action), ["WOULD_CREATE", "WOULD_NOT_PUBLISH", "WOULD_NOT_PUBLISH", "WOULD_CREATE"]);
  assert.equal(db.writes.length, 0);
});

test("publicador simulado continúa con ciudad válida aunque otra fuente falle", async () => {
  const db = memoryFirestore();
  const rows = [
    { city: "Sevilla", year: 2027, status: "error", dates: [], sources: [], reason: "timeout" },
    { ...PUBLISH_ROW, city: "Bilbao" },
  ];
  const result = await synchronize(2027, db, { rows, write: true, timestamp: "now" });
  assert.deepEqual(result.map(row => row.action), ["error", "created"]);
  assert.deepEqual(db.docs.get("festivos_oficiales/Bilbao/años/2027").fechas, PUBLISH_DATES);
  assert.ok(!db.docs.has("festivos_oficiales/Sevilla/años/2027"));
});

test("preview continúa tras fallo de lectura de una ciudad", async () => {
  const db = memoryFirestore();
  const original = db.doc;
  db.doc = path => ({ ...original(path), async get() { if (path.includes("Sevilla")) throw new Error("timeout lectura"); return original(path).get(); } });
  const result = await synchronize(2027, db, { rows: [{ city: "Sevilla", year: 2027, status: "pending", dates: [], sources: [] }, PUBLISH_ROW] });
  assert.equal(result[0].status, "error");
  assert.equal(result[1].action, "WOULD_CREATE");
  assert.equal(db.writes.length, 0);
});

test("publicador simulado continúa tras fallo de Firestore en una ciudad", async () => {
  const db = memoryFirestore();
  const original = db.doc;
  db.doc = path => ({ ...original(path), async get() { if (path.includes("Sevilla")) throw new Error("timeout Firestore"); return original(path).get(); } });
  const rows = [{ ...PUBLISH_ROW, city: "Sevilla" }, { ...PUBLISH_ROW, city: "Bilbao" }];
  const result = await synchronize(2027, db, { rows, write: true, timestamp: "now" });
  assert.deepEqual(result.map(row => row.action), ["error", "created"]);
  assert.deepEqual(db.docs.get("festivos_oficiales/Bilbao/años/2027").fechas, PUBLISH_DATES);
  assert.ok(!db.docs.has("festivos_oficiales/Sevilla/años/2027"));
});
