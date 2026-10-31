"use strict";

const FREE_AI_MONTHLY_LIMIT = 5;
const QUOTA_TIME_ZONE = "Europe/Madrid";

function partesMadrid(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function obtenerMesCuota(date = new Date()) {
  const { year, month } = partesMadrid(date);
  return `${year}-${month}`;
}

function madridMidnightUtc(year, month) {
  const target = Date.UTC(year, month - 1, 1);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Resolve local midnight against the zone offset (which changes with DST).
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .map(({ type, value }) => [type, value]));
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

function obtenerResetCuota(date = new Date()) {
  const { year, month } = partesMadrid(date);
  const nextMonth = Number(month) === 12
    ? { year: Number(year) + 1, month: 1 }
    : { year: Number(year), month: Number(month) + 1 };
  return madridMidnightUtc(nextMonth.year, nextMonth.month).toISOString();
}

function interrequestWindowActive(lastRequestAt, nowMs, windowMs) {
  const lastMs = lastRequestAt && typeof lastRequestAt.toMillis === "function"
    ? lastRequestAt.toMillis()
    : new Date(lastRequestAt).getTime();
  return Number.isFinite(lastMs) && nowMs - lastMs < windowMs;
}

module.exports = {
  FREE_AI_MONTHLY_LIMIT,
  QUOTA_TIME_ZONE,
  obtenerMesCuota,
  obtenerResetCuota,
  interrequestWindowActive,
};
