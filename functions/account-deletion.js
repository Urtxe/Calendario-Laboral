"use strict";

const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;
const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
    "canceled",
    "incomplete_expired",
]);

function createAccountDeletionError(code, message, status = 500) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function isStripeResourceMissing(error) {
    return Boolean(error && error.code === "resource_missing");
}

function subscriptionNeedsCancellation(subscription) {
    return Boolean(
        subscription &&
        !TERMINAL_SUBSCRIPTION_STATUSES.has(String(subscription.status || "").toLowerCase()),
    );
}

async function verifyRecentAuthenticatedUser({ auth, idToken, nowSeconds = Date.now() / 1000 }) {
    if (!idToken) {
        return {
            ok: false,
            code: "unauthenticated",
            status: 401,
            message: "Debes iniciar sesión para eliminar tu cuenta.",
        };
    }

    let decodedToken;
    try {
        decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
        return {
            ok: false,
            code: "unauthenticated",
            status: 401,
            message: "Tu sesión ya no es válida. Inicia sesión de nuevo.",
        };
    }

    const authTime = Number(decodedToken && decodedToken.auth_time);
    const ageSeconds = Number.isFinite(authTime) ? nowSeconds - authTime : Infinity;

    if (!decodedToken || !decodedToken.uid) {
        return {
            ok: false,
            code: "unauthenticated",
            status: 401,
            message: "No se pudo validar tu sesión.",
        };
    }

    if (!Number.isFinite(authTime) || ageSeconds < 0 || ageSeconds > RECENT_AUTH_MAX_AGE_SECONDS) {
        return {
            ok: false,
            code: "requires_recent_login",
            status: 401,
            message: "Por seguridad, vuelve a autenticarte antes de eliminar la cuenta.",
        };
    }

    return { ok: true, uid: decodedToken.uid };
}

async function cancelStripeSubscriptionForAccountDeletion({ stripe, subscriptionId, uid }) {
    if (!subscriptionId) {
        return { status: "not_linked", endsImmediately: false };
    }

    let subscription;
    try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
        if (isStripeResourceMissing(error)) {
            return { status: "not_found", endsImmediately: false };
        }
        throw createAccountDeletionError(
            "stripe_subscription_lookup_failed",
            "No se pudo comprobar la suscripción Premium. Tu cuenta no se ha eliminado.",
            502,
        );
    }

    if (!subscriptionNeedsCancellation(subscription)) {
        return {
            status: "already_inactive",
            endsImmediately: false,
        };
    }

    try {
        await stripe.subscriptions.cancel(
            subscriptionId,
            {},
            { idempotencyKey: `account-delete-${uid}-${subscriptionId}` },
        );
    } catch (error) {
        throw createAccountDeletionError(
            "stripe_subscription_cancel_failed",
            "No se pudo cancelar la suscripción Premium. Tu cuenta no se ha eliminado.",
            502,
        );
    }

    return {
        status: "cancelled",
        // Stripe cancel() cancela la suscripción ahora; no conserva el acceso hasta el final del periodo.
        endsImmediately: true,
    };
}

async function removeStripeCustomerWhenPossible({ stripe, customerId, uid }) {
    if (!customerId) return { status: "not_linked" };

    try {
        await stripe.customers.del(
            customerId,
            {},
            { idempotencyKey: `account-delete-customer-${uid}-${customerId}` },
        );
        return { status: "deleted" };
    } catch (error) {
        if (isStripeResourceMissing(error)) return { status: "not_found" };

        // La cuenta se puede eliminar aunque Stripe deba conservar un registro de cliente/facturación.
        // No se eliminan ni modifican facturas o apuntes contables desde este flujo.
        return { status: "retained" };
    }
}

async function deleteFirestoreAccountTree({ db, uid }) {
    if (!uid || typeof uid !== "string") {
        throw createAccountDeletionError("invalid_uid", "No se pudo identificar la cuenta que se va a eliminar.", 400);
    }

    if (!db || typeof db.collection !== "function" || typeof db.recursiveDelete !== "function") {
        throw createAccountDeletionError(
            "firestore_recursive_delete_unavailable",
            "El borrado seguro de datos no está disponible. Tu cuenta no se ha eliminado.",
            500,
        );
    }

    const userRef = db.collection("usuarios").doc(uid);
    await db.recursiveDelete(userRef);
}

async function prepareStripeAccountDeletion({ stripe, stripeConfigured, userData, uid }) {
    const data = userData || {};
    const subscriptionId = typeof data.stripeSubscriptionId === "string"
        ? data.stripeSubscriptionId
        : "";
    const customerId = typeof data.stripeCustomerId === "string"
        ? data.stripeCustomerId
        : "";
    const knownActiveSubscription = subscriptionId || ["active", "trialing", "past_due", "unpaid", "paused"]
        .includes(String(data.subscriptionStatus || "").toLowerCase());

    if (knownActiveSubscription && !stripeConfigured) {
        throw createAccountDeletionError(
            "stripe_cleanup_unavailable",
            "No se puede comprobar o cancelar tu suscripción Premium ahora. Tu cuenta no se ha eliminado.",
            503,
        );
    }

    if (knownActiveSubscription && !subscriptionId) {
        throw createAccountDeletionError(
            "stripe_subscription_reference_missing",
            "No se ha podido verificar la suscripción Premium. Contacta con soporte; tu cuenta no se ha eliminado.",
            409,
        );
    }

    const subscription = stripeConfigured
        ? await cancelStripeSubscriptionForAccountDeletion({ stripe, subscriptionId, uid })
        : { status: "not_checked", endsImmediately: false };
    const customer = stripeConfigured
        ? await removeStripeCustomerWhenPossible({ stripe, customerId, uid })
        : { status: "not_checked" };

    return { subscription, customer };
}

async function deleteAccountSafely({ db, auth, stripe, stripeConfigured, uid }) {
    const userRef = db.collection("usuarios").doc(uid);
    const userSnap = await userRef.get();
    const billing = await prepareStripeAccountDeletion({
        stripe,
        stripeConfigured,
        userData: userSnap.exists ? userSnap.data() : {},
        uid,
    });

    await deleteFirestoreAccountTree({ db, uid });

    try {
        await auth.deleteUser(uid);
    } catch (error) {
        throw createAccountDeletionError(
            "auth_delete_failed",
            "Tus datos de la aplicación se han eliminado, pero no se pudo cerrar la cuenta. Contacta con soporte.",
            500,
        );
    }

    return billing;
}

module.exports = {
    RECENT_AUTH_MAX_AGE_SECONDS,
    cancelStripeSubscriptionForAccountDeletion,
    createAccountDeletionError,
    deleteAccountSafely,
    deleteFirestoreAccountTree,
    prepareStripeAccountDeletion,
    removeStripeCustomerWhenPossible,
    verifyRecentAuthenticatedUser,
};
