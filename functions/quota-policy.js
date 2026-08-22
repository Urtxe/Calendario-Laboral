"use strict";

const FREE_AI_DAILY_LIMIT = 50;
const PREMIUM_AI_DAILY_LIMIT = 200;

function limiteDiarioIA(isPremium) {
  return isPremium ? PREMIUM_AI_DAILY_LIMIT : FREE_AI_DAILY_LIMIT;
}

module.exports = {
  FREE_AI_DAILY_LIMIT,
  PREMIUM_AI_DAILY_LIMIT,
  limiteDiarioIA,
};
