"use strict";

const { createHash } = require("node:crypto");
const { hasAccountDeletionBarrier } = require("./account-lifecycle");

const MAX_RESPONSE_LENGTH = 8_000;
const MAX_REQUEST_BYTES = 40_000;
const MAX_REPORTS_PER_DAY = 5;
const MIN_REPORT_INTERVAL_MS = 60_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_LIMIT = 500;
const AI_REPORT_COLLECTIONS = ["aiReports", "aiReportRateLimits"];
const REPORT_REASONS = new Set(["inaccurate", "outdated", "unsafe", "other"]);

function hash(value) {
    return createHash("sha256").update(value).digest("hex");
}

function json(res, status, body) {
    res.status(status).json(body);
}

function createAIReportsHandler({ auth, db, now = () => Date.now() }) {
    if (!auth || typeof auth.verifyIdToken !== "function") throw new TypeError("auth.verifyIdToken is required");
    if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore db is required");
    }

    return async function handleAIReport(req, res) {
        if (req.method !== "POST") return json(res, 405, { code: "method_not_allowed" });
        if (!/^application\/json(?:\s*;|\s*$)/i.test(String(req.get ? req.get("content-type") : req.headers?.["content-type"] || ""))) {
            return json(res, 415, { code: "json_required" });
        }
        if (Buffer.byteLength(JSON.stringify(req.body ?? null), "utf8") > MAX_REQUEST_BYTES) {
            return json(res, 413, { code: "request_too_large" });
        }

        const idToken = String(req.get ? req.get("authorization") : req.headers?.authorization || "")
            .match(/^Bearer\s+(.+)$/i)?.[1];
        if (!idToken) return json(res, 401, { code: "unauthenticated" });

        let decoded;
        try {
            decoded = await auth.verifyIdToken(idToken, true);
        } catch (_) {
            return json(res, 401, { code: "unauthenticated" });
        }
        if (!decoded || typeof decoded.uid !== "string" || !decoded.uid) {
            return json(res, 401, { code: "unauthenticated" });
        }

        const body = req.body;
        const reason = body && body.reason;
        const response = body && body.response;
        if (!REPORT_REASONS.has(reason) || typeof response !== "string" || !response.trim() || response.length > MAX_RESPONSE_LENGTH) {
            return json(res, 400, { code: "invalid_report" });
        }

        const timestamp = Number(now());
        if (!Number.isFinite(timestamp)) return json(res, 500, { code: "report_unavailable" });
        const day = new Date(timestamp).toISOString().slice(0, 10);
        const userKey = hash(decoded.uid);
        const reportKey = hash(`${decoded.uid}\n${day}\n${reason}\n${response}`);
        const rateRef = db.collection("aiReportRateLimits").doc(userKey);
        const reportRef = db.collection("aiReports").doc(reportKey);

        try {
            const result = await db.runTransaction(async (transaction) => {
                const [reportSnap, rateSnap] = await Promise.all([
                    transaction.get(reportRef),
                    transaction.get(rateRef),
                ]);
                if (await hasAccountDeletionBarrier({ db, uid: decoded.uid, transaction })) {
                    return { accountDeleted: true };
                }
                if (reportSnap.exists) return { duplicate: true };

                const rate = rateSnap.exists ? rateSnap.data() : {};
                const count = rate.day === day ? Number(rate.count) || 0 : 0;
                const lastAt = rate.day === day ? Number(rate.lastAt) || 0 : 0;
                if (count >= MAX_REPORTS_PER_DAY || (lastAt && timestamp - lastAt < MIN_REPORT_INTERVAL_MS)) {
                    return { limited: true };
                }

                const expiresAt = new Date(timestamp + RETENTION_MS);
                transaction.create(reportRef, {
                    reason,
                    response: response.trim(),
                    createdAt: new Date(timestamp),
                    expiresAt,
                });
                transaction.set(rateRef, {
                    day,
                    count: count + 1,
                    lastAt: timestamp,
                    expiresAt: new Date(timestamp + RATE_LIMIT_RETENTION_MS),
                });
                return { duplicate: false };
            });
            if (result.accountDeleted) return json(res, 403, { code: "account_unavailable" });
            if (result.limited) return json(res, 429, { code: "rate_limited" });
            return json(res, result.duplicate ? 200 : 201, { ok: true, duplicate: result.duplicate });
        } catch (_) {
            return json(res, 500, { code: "report_unavailable" });
        }
    };
}

async function cleanupExpiredAIReports({ db, now = () => Date.now() }) {
    if (!db || typeof db.collection !== "function" || typeof db.batch !== "function") {
        throw new TypeError("Firestore db is required");
    }
    const timestamp = Number(typeof now === "function" ? now() : now);
    if (!Number.isFinite(timestamp)) throw new TypeError("A valid cleanup time is required");

    const expiredBefore = new Date(timestamp);
    const batch = db.batch();
    let deleted = 0;
    let hasMore = false;
    for (const name of AI_REPORT_COLLECTIONS) {
        const remaining = CLEANUP_BATCH_LIMIT - deleted;
        if (remaining <= 0) {
            hasMore = true;
            break;
        }
        const snapshot = await db.collection(name)
            .where("expiresAt", "<=", expiredBefore)
            .limit(remaining + 1)
            .get();
        const expiredDocs = snapshot.docs.slice(0, remaining);
        for (const doc of expiredDocs) batch.delete(doc.ref);
        deleted += expiredDocs.length;
        if (snapshot.docs.length > remaining) {
            hasMore = true;
            break;
        }
    }
    if (deleted) await batch.commit();
    return { deleted, hasMore };
}

module.exports = {
    AI_REPORT_COLLECTIONS,
    CLEANUP_BATCH_LIMIT,
    MAX_RESPONSE_LENGTH,
    MAX_REQUEST_BYTES,
    MAX_REPORTS_PER_DAY,
    MIN_REPORT_INTERVAL_MS,
    REPORT_REASONS,
    RETENTION_MS,
    RATE_LIMIT_RETENTION_MS,
    cleanupExpiredAIReports,
    createAIReportsHandler,
};
