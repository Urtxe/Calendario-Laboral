"use strict";

const MADRID_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function normalizeYear(value, fallback = Number(MADRID_DATE_FORMATTER.format(new Date()).slice(0, 4))) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fallback;
}

function resolvePersonalYear(question, selectedYear, fallback = Number(MADRID_DATE_FORMATTER.format(new Date()).slice(0, 4))) {
  const mentionedYears = [...new Set((String(question || "").match(/\b20\d{2}\b/g) || [])
    .map(Number)
    .filter((year) => year >= 2000 && year <= 2100))];
  if (mentionedYears.length > 1) return null;
  return mentionedYears.length === 1 ? mentionedYears[0] : normalizeYear(selectedYear, fallback);
}

function dateKeyInYear(value, year) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !value.startsWith(`${year}-`)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function numeric(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function yearMap(value, year) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => typeof key === "string" && key.startsWith(`${year}-`)));
}

function mergeYearData(profileData = {}, yearData = {}, year) {
  const legacyObjectives = profileData.objetivosAnuales && typeof profileData.objetivosAnuales === "object"
    ? profileData.objetivosAnuales[year]
    : undefined;
  const legacySchedule = profileData.tipoJornadaPorAnio && typeof profileData.tipoJornadaPorAnio === "object"
    ? profileData.tipoJornadaPorAnio[year]
    : undefined;
  return {
    horasAnuales: yearData.horasAnuales ?? legacyObjectives,
    tipoJornada: yearData.tipoJornada ?? legacySchedule,
    diasMarcados: {
      ...yearMap(profileData.diasMarcados, year),
      ...yearMap(yearData.diasMarcados, year),
    },
    horasExtraPorDia: {
      ...yearMap(profileData.horasExtraPorDia, year),
      ...yearMap(yearData.horasExtraPorDia, year),
    },
    horasExtraCompensadas: {
      ...yearMap(profileData.horasExtraCompensadas, year),
      ...yearMap(yearData.horasExtraCompensadas, year),
    },
  };
}

function madridDate(value = new Date()) {
  return MADRID_DATE_FORMATTER.format(value);
}

function isPersonalLaborQuestion(question) {
  const raw = String(question || "").toLowerCase();
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const laborData = /\b(dias?|horas?|jornada|balance|fichajes?|calendario|trabaj|extras?|objetivo anual|historico|resultados|vacaciones|festivos)\b/.test(text)
    || /\b(egun|ordu|lanaldi|lan egin|egutegi|oporr|jaiegun)\b/.test(raw);
  if (!laborData) return false;
  return /\b(mi|mis|me|he|tengo|llevo|apunte|apuntado|registrado|marque|marcado|segun mis|con mis|lo que llevo|este ano|este ejercicio|me quedan|me faltan|voy este ano)\b/.test(text)
    || /\bcuantos?\s+(?:dias?|horas?)\b.{0,70}\b(?:debo|deberia|me faltan|me quedan|trabajar)\b/.test(text)
    || /\b(?:como voy|que balance tengo|que resultado tengo)\b/.test(text)
    || /\b(nire|ditut|daukat|dauzkat|sartu ditudan|zenbat .* behar dut)\b/.test(raw);
}

function wantsOvertimeDetails(question) {
  const raw = String(question || "").toLowerCase();
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(horas extra|extras|compensad|compensacion de horas)\b/.test(text) || /\b(ordu estrak|ordu gehigarriak|konpentsat)\b/.test(raw);
}

function wantsVacationDetails(question) {
  const raw = String(question || "").toLowerCase();
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(vacaciones|dias libres|festivos)\b/.test(text) || /\b(oporr|jaiegun)\b/.test(raw);
}

function summarizePersonalYear(rawData, year, asOf = new Date(), { includeOvertime = false, includeVacations = false } = {}) {
  const data = rawData || {};
  const annualHours = numeric(data.horasAnuales, 1, 4000);
  const scheduleFactor = numeric(data.tipoJornada, 0.1, 2.5);
  if (annualHours === null || scheduleFactor === null) return { available: false, reason: "missing_annual_setup" };

  const hoursPerDay = 8 * scheduleFactor;
  const annualTargetHours = annualHours * scheduleFactor;
  const dateToday = typeof asOf === "string" ? asOf : madridDate(asOf);
  let computedDaysToDate = 0;
  let computedHolidayDaysToDate = 0;
  let futurePlannedDays = 0;
  let futurePlannedHolidayDays = 0;
  let allComputedDays = 0;
  let allComputedHolidayDays = 0;
  let vacationDaysToDate = 0;
  let futureVacationDays = 0;

  const days = data.diasMarcados && typeof data.diasMarcados === "object" && !Array.isArray(data.diasMarcados)
    ? data.diasMarcados
    : {};
  for (const [date, day] of Object.entries(days)) {
    if (!dateKeyInYear(date, year) || !day) continue;
    if (includeVacations && day.tipo === "vacaciones") {
      if (date <= dateToday) vacationDaysToDate += 1;
      else futureVacationDays += 1;
      continue;
    }
    if (!["trabajado", "baja"].includes(day.tipo)) continue;
    const isHoliday = day.esFestivo === true;
    allComputedDays += 1;
    if (isHoliday) allComputedHolidayDays += 1;
    if (date <= dateToday) {
      computedDaysToDate += 1;
      if (isHoliday) computedHolidayDaysToDate += 1;
    } else {
      futurePlannedDays += 1;
      if (isHoliday) futurePlannedHolidayDays += 1;
    }
  }

  const computedHoursToDate = computedDaysToDate * hoursPerDay;
  const adjustedTargetToDate = annualTargetHours - computedHolidayDaysToDate * 4 * scheduleFactor;
  const balanceHoursToDate = Math.round(computedHoursToDate - adjustedTargetToDate);
  const remainingHoursToTarget = Math.max(0, adjustedTargetToDate - computedHoursToDate);
  const allComputedHours = allComputedDays * hoursPerDay;
  const adjustedAnnualTarget = annualTargetHours - allComputedHolidayDays * 4 * scheduleFactor;
  const appBalanceHours = Math.round(allComputedHours - adjustedAnnualTarget);
  const remainingHoursAfterKnownPlans = Math.max(0, adjustedAnnualTarget - allComputedHours);

  const summary = {
    available: true,
    year,
    asOf: dateToday,
    annualTargetHours: Math.round(annualTargetHours * 100) / 100,
    scheduleFactor,
    hoursPerTypicalDay: Math.round(hoursPerDay * 100) / 100,
    computedDaysToDate,
    computedHoursToDate: Math.round(computedHoursToDate * 100) / 100,
    holidayDaysToDate: computedHolidayDaysToDate,
    balanceHoursToDate,
    remainingHoursToTarget: Math.round(remainingHoursToTarget * 100) / 100,
    equivalentFullDaysRemaining: Math.round((remainingHoursToTarget / hoursPerDay) * 100) / 100,
    remainingHoursAfterKnownPlans: Math.round(remainingHoursAfterKnownPlans * 100) / 100,
    equivalentUnmarkedDaysAfterKnownPlans: Math.round((remainingHoursAfterKnownPlans / hoursPerDay) * 100) / 100,
    futurePlannedDays,
    futurePlannedHolidayDays,
    appBalanceHoursIncludingFuturePlans: appBalanceHours,
    calculationNote: "Estimación de Balance Laboral: asigna 8 × jornada a cada día computable según la aplicación, reduce el objetivo en 4 × jornada por festivo marcado y cuenta las horas extra por separado. El total agregado no identifica qué marcas fueron trabajo efectivo; no determina horas reales, turnos futuros ni derechos legales.",
  };

  if (includeOvertime) {
    const overtime = data.horasExtraPorDia && typeof data.horasExtraPorDia === "object" && !Array.isArray(data.horasExtraPorDia)
      ? data.horasExtraPorDia
      : {};
    summary.overtimeHoursEntered = Math.round(Object.entries(overtime).reduce((total, [date, hours]) => {
      if (!dateKeyInYear(date, year)) return total;
      const validHours = numeric(hours, 0, 24);
      return total + (validHours === null ? 0 : validHours);
    }, 0) * 100) / 100;
    const compensated = data.horasExtraCompensadas && typeof data.horasExtraCompensadas === "object" && !Array.isArray(data.horasExtraCompensadas)
      ? data.horasExtraCompensadas
      : {};
    summary.monthsMarkedOvertimeCompensated = Object.entries(compensated).filter(([month, value]) =>
      new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(month) && value === true,
    ).length;
    summary.overtimeNote = "Las horas extra no se suman al balance de jornada. La aplicación marca la compensación por mes, sin vincular horas concretas a cada compensación.";
  }
  if (includeVacations) {
    summary.vacationDaysRecordedToDate = vacationDaysToDate;
    summary.futureVacationDaysMarked = futureVacationDays;
  }

  return summary;
}

async function loadPersonalYearContext(db, uid, year, asOf = new Date(), options = {}) {
  if (typeof uid !== "string" || !uid || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return { available: false, reason: "invalid_request" };
  }
  const profileRef = db.collection("usuarios").doc(uid);
  const yearRef = profileRef.collection("years").doc(String(year));
  const deletionRef = db.collection("accountDeletions").doc(uid);
  return db.runTransaction(async (transaction) => {
    const [deletionSnapshot, profileSnapshot, yearSnapshot] = await Promise.all([
      transaction.get(deletionRef),
      transaction.get(profileRef),
      transaction.get(yearRef),
    ]);
    if (deletionSnapshot.exists || !profileSnapshot.exists) return { available: false, reason: "account_unavailable" };
    const rawData = mergeYearData(profileSnapshot.data() || {}, yearSnapshot.exists ? yearSnapshot.data() || {} : {}, year);
    return summarizePersonalYear(rawData, year, asOf, options);
  });
}

function formatPersonalLaborContext(summary) {
  if (!summary || summary.available !== true) return "";
  const fields = [
    `Año consultado: ${summary.year}; el corte de días registrados es la fecha actual.`,
    `Jornada registrada: ${summary.scheduleFactor} de jornada completa; jornada equivalente: ${summary.hoursPerTypicalDay} horas.`,
    `Objetivo anual proporcional: ${summary.annualTargetHours} horas.`,
    `Marcas computadas hasta hoy: ${summary.computedDaysToDate} días y ${summary.computedHoursToDate} horas según la fórmula de la aplicación; festivos marcados: ${summary.holidayDaysToDate}.`,
    `Saldo registrado hasta hoy según la aplicación: ${summary.balanceHoursToDate} horas.`,
    `Horas que faltan para alcanzar el objetivo usando solo las marcas hasta hoy (sin restar planificación futura): ${summary.remainingHoursToTarget}; equivalencia matemática: ${summary.equivalentFullDaysRemaining} jornadas típicas.`,
    `Tras contar también todas las marcas futuras, quedarían ${summary.remainingHoursAfterKnownPlans} horas (${summary.equivalentUnmarkedDaysAfterKnownPlans} jornadas típicas) para completar el objetivo.`,
    `Días futuros que ya aparecen marcados como planificación: ${summary.futurePlannedDays}.`,
    `Balance que muestra actualmente la aplicación, incluidas marcas futuras: ${summary.appBalanceHoursIncludingFuturePlans} horas.`,
    summary.calculationNote,
  ];
  if (summary.overtimeHoursEntered !== undefined) {
    fields.push(`Horas extra anotadas por separado: ${summary.overtimeHoursEntered}; meses marcados como compensados: ${summary.monthsMarkedOvertimeCompensated}.`);
    fields.push(summary.overtimeNote);
  }
  if (summary.vacationDaysRecordedToDate !== undefined) {
    fields.push(`Días registrados como vacaciones hasta hoy: ${summary.vacationDaysRecordedToDate}; días futuros marcados como vacaciones: ${summary.futureVacationDaysMarked}. Esto no indica el saldo de vacaciones disponible ni el derecho anual.`);
  }
  return `[RESUMEN AGREGADO DEL CALENDARIO DEL USUARIO — NO ES UNA FUENTE LEGAL]\n${fields.join("\n")}`;
}

module.exports = {
  dateKeyInYear,
  formatPersonalLaborContext,
  isPersonalLaborQuestion,
  loadPersonalYearContext,
  mergeYearData,
  normalizeYear,
  resolvePersonalYear,
  summarizePersonalYear,
  wantsOvertimeDetails,
  wantsVacationDetails,
};
