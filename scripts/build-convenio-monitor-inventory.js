"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const matrixPath = path.join(root, "docs", "matriz-vigencia-convenios-2026.md");
const outputPath = path.join(root, "functions", "convenio-monitor-inventory.generated.json");

function cell(value) {
  return value.trim().replace(/^`|`$/g, "");
}

function buildInventory(markdown) {
  const lines = markdown.split(/\r?\n/).filter((line) => /^\|\s*\d+\s*\|/.test(line));
  const rows = lines.map((line) => {
    const columns = line.split("|").slice(1, -1).map(cell);
    if (columns.length !== 7 && columns.length !== 8) throw new Error(`Fila de matriz con columnas inesperadas (${columns.length})`);
    const number = Number(columns[0]);
    const officialCode = columns.slice(2, 7).join(" ").match(/\b\d{14}\b/)?.[0] || null;
    const regconUrl = columns.slice(2, 7).join(" ").match(/https:\/\/expinterweb\.mites\.gob\.es\/regcon\/pub\/consultaCodigoMapas\?convenioMapa=\d+/)?.[0] || null;
    if (regconUrl && !officialCode) throw new Error(`Fila ${number}: enlace REGCON sin código detectable`);
    if (officialCode && regconUrl && !regconUrl.endsWith(officialCode)) throw new Error(`Fila ${number}: código y enlace REGCON no coinciden`);
    const statusMatch = columns.at(-1).match(/\*\*([^*]+)\*\*/);
    const status = statusMatch ? statusMatch[1] : "INCOMPLETO";
    const explicitPactPeriod = columns[3].match(/(?:periodo pactado|vigencia pactada)\s+(20\d{2})\s*[–-]\s*(20\d{2})/i)?.[0];
    const periods = (explicitPactPeriod || columns.slice(2, 4).join(" ")).match(/\b(20\d{2})\s*[–-]\s*(20\d{2})\b/g) || [];
    const pactEndYear = periods.length ? Math.max(...periods.map((period) => Number(period.match(/20\d{2}$/)[0]))) : null;
    const id = `convenio-${String(number).padStart(2, "0")}`;
    return {
      id,
      number,
      title: columns[1].slice(0, 180),
      officialCode,
      sourceUrl: regconUrl,
      source: regconUrl ? "REGCON" : null,
      pactEndYear,
      documentaryStatus: status,
      sourceCheck: regconUrl ? "available" : "missing_official_regcon_reference",
    };
  });
  if (rows.length !== 28 || rows.some((row, index) => row.number !== index + 1)) {
    throw new Error(`La matriz debe contener 28 filas ordenadas; se detectaron ${rows.length}`);
  }
  return rows;
}

const inventory = buildInventory(fs.readFileSync(matrixPath, "utf8"));
fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Inventario de monitor generado desde la matriz: ${inventory.length} convenios.`);

module.exports = { buildInventory };
