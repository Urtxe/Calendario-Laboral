"use strict";

// La Function tiene timeout de 90 s. Cinco minutos deja margen para reintentos
// internos y liquidación, pero recupera automáticamente una reserva abandonada.
const AI_QUOTA_RESERVATION_TTL_MS = 5 * 60 * 1000;

function toMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isReservationExpired(reservation, nowMs = Date.now()) {
  return Boolean(reservation) && reservation.state === "reserved" &&
    toMillis(reservation.expiresAt) > 0 && toMillis(reservation.expiresAt) <= nowMs;
}

function resumirReservasCaducadas(reservations, { today, nowMs = Date.now() } = {}) {
  const expiredReservations = (reservations || []).filter((reservation) =>
    isReservationExpired(reservation, nowMs)
  );
  const expiredByPlan = { free: 0, premium: 0 };

  expiredReservations.forEach((reservation) => {
    if (reservation.dayKey === today && expiredByPlan[reservation.plan] !== undefined) {
      expiredByPlan[reservation.plan] += 1;
    }
  });

  return { expiredReservations, expiredByPlan };
}

function liquidarEstadoReserva(state, consume) {
  if (state !== "reserved") return { changed: false, state };
  return { changed: true, state: consume ? "consumed" : "refunded" };
}

module.exports = {
  AI_QUOTA_RESERVATION_TTL_MS,
  isReservationExpired,
  liquidarEstadoReserva,
  resumirReservasCaducadas,
};
