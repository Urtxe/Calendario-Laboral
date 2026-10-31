(function (root) {
  "use strict";
  function expiryMillis(value) {
    if (!value) return null;
    if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return Date.parse(value);
  }
  function active(entitlement, now = Date.now()) {
    if (!entitlement || entitlement.active !== true) return false;
    if (!entitlement.expiresAt) return String(entitlement.status || "").toLowerCase() !== "trialing";
    const expiry = expiryMillis(entitlement.expiresAt);
    return Number.isFinite(expiry) && expiry > now;
  }
  function isPremium(data = {}, now = Date.now()) {
    const billing = data.billing || {};
    const legacy = Boolean(data.stripeSubscriptionId || data.subscriptionStatus || data.stripeCurrentPeriodEnd);
    const legacyStripe = !billing.stripe && data.stripeSubscriptionId && data.subscriptionStatus === "active"
      && active({ active: true, expiresAt: data.stripeCurrentPeriodEnd }, now);
    if (billing.stripe || billing.googlePlay) return Boolean(active(billing.stripe, now) || active(billing.googlePlay, now) || legacyStripe);
    return legacy ? Boolean(legacyStripe) : data.tipoCuenta === "premium";
  }
  root.PremiumAccess = Object.freeze({ isPremium, active, expiryMillis });
})(window);
