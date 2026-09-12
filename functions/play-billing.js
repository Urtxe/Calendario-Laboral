"use strict";

const { createHash } = require("crypto");
const { GoogleAuth } = require("google-auth-library");

const PLAY_PACKAGE_NAME = "es.balancelaboral.app";
const PREMIUM_PRODUCT_IDS = new Set(["premium_monthly", "premium_yearly"]);
const ENTITLED_STATES = new Set([
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    "SUBSCRIPTION_STATE_CANCELED",
]);

function hashPurchaseToken(purchaseToken) {
    return createHash("sha256").update(String(purchaseToken || "")).digest("hex");
}

function validatePurchaseInput({ purchaseToken, productId }) {
    if (!PREMIUM_PRODUCT_IDS.has(productId)) return { ok: false, code: "unsupported_product" };
    if (typeof purchaseToken !== "string" || purchaseToken.length < 12 || purchaseToken.length > 8192) {
        return { ok: false, code: "invalid_purchase_token" };
    }
    return { ok: true };
}

function toIsoDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getSubscriptionLineItem(purchase) {
    const items = Array.isArray(purchase && purchase.lineItems) ? purchase.lineItems : [];
    return items.find((item) => PREMIUM_PRODUCT_IDS.has(item.productId)) || null;
}

function normalizeSubscriptionPurchase(purchase) {
    const lineItem = getSubscriptionLineItem(purchase);
    const subscriptionState = String(purchase && purchase.subscriptionState || "");
    const expiryTime = toIsoDate(lineItem && lineItem.expiryTime);
    const expiryMs = expiryTime ? Date.parse(expiryTime) : 0;
    const notExpired = expiryMs > Date.now();
    const entitled = ENTITLED_STATES.has(subscriptionState) && notExpired;

    return {
        productId: lineItem ? lineItem.productId : null,
        subscriptionState: subscriptionState || "SUBSCRIPTION_STATE_UNSPECIFIED",
        expiryTime,
        latestOrderId: lineItem && lineItem.latestSuccessfulOrderId || null,
        autoRenewEnabled: Boolean(lineItem && lineItem.autoRenewingPlan && lineItem.autoRenewingPlan.autoRenewEnabled),
        acknowledgementPending: purchase &&
            purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGEMENT_PENDING",
        entitled,
    };
}

function isActiveProviderEntitlement(entitlement) {
    return Boolean(entitlement && entitlement.active === true);
}

function hasLegacyStripeEntitlement(userData) {
    const status = String(userData && userData.subscriptionStatus || "").toLowerCase();
    return Boolean(userData && userData.stripeSubscriptionId && status === "active");
}

function userHasPremiumEntitlement(userData, nextBilling = null) {
    const billing = nextBilling || userData && userData.billing || {};
    const stripe = billing.stripe;
    const stripeActive = stripe
        ? isActiveProviderEntitlement(stripe)
        : hasLegacyStripeEntitlement(userData);
    return stripeActive || isActiveProviderEntitlement(billing.googlePlay);
}

function buildGooglePlayEntitlement({ normalizedPurchase, purchaseToken, source }) {
    return {
        active: normalizedPurchase.entitled,
        source: "google_play",
        productId: normalizedPurchase.productId,
        status: normalizedPurchase.subscriptionState,
        expiresAt: normalizedPurchase.expiryTime,
        autoRenewEnabled: normalizedPurchase.autoRenewEnabled,
        purchaseReference: hashPurchaseToken(purchaseToken),
        lastVerifiedSource: source,
    };
}

function createPlayDeveloperClient({ auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
}) } = {}) {
    async function request(url, options = {}) {
        const client = await auth.getClient();
        const response = await client.request({ url, ...options });
        return response.data;
    }

    return {
        getSubscription: (purchaseToken) => request(
            `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
        ),
        acknowledgeSubscription: (subscriptionId, purchaseToken) => request(
            `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE_NAME}/purchases/subscriptions/${encodeURIComponent(subscriptionId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
            { method: "POST", data: {} },
        ),
    };
}

module.exports = {
    PLAY_PACKAGE_NAME,
    PREMIUM_PRODUCT_IDS,
    hashPurchaseToken,
    validatePurchaseInput,
    normalizeSubscriptionPurchase,
    userHasPremiumEntitlement,
    buildGooglePlayEntitlement,
    createPlayDeveloperClient,
};
