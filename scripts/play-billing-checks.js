"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/js/app/play-billing-service.js"), "utf8");

async function availability({ inTwa, paymentRequest, digitalGoods }) {
    const window = {
        esContextoPlayTwa: () => inTwa,
        PaymentRequest: paymentRequest ? function PaymentRequest() {} : undefined,
        getDigitalGoodsService: digitalGoods ? async () => ({}) : undefined,
    };
    vm.runInNewContext(source, { window, document: {}, Intl, navigator: { language: "es-ES" } });
    return window.PlayBillingService.isAvailable();
}

(async () => {
    assert.strictEqual(await availability({ inTwa: true, paymentRequest: true, digitalGoods: true }), true);
    assert.strictEqual(await availability({ inTwa: false, paymentRequest: true, digitalGoods: true }), false);
    assert.strictEqual(await availability({ inTwa: true, paymentRequest: false, digitalGoods: true }), false);

    const ui = fs.readFileSync(path.join(repoRoot, "src/js/app/ui.js"), "utf8");
    const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
    const androidManifest = fs.readFileSync(
      path.join(repoRoot, "android/twa/app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    const delegationService = fs.readFileSync(
      path.join(repoRoot, "android/twa/app/src/main/java/es/balancelaboral/app/DelegationService.java"),
      "utf8",
    );
    const backend = fs.readFileSync(path.join(repoRoot, "functions/index.js"), "utf8");
    assert.match(ui, /PlayBillingService\.openPremiumModal/);
    assert.match(ui, /\[onclick\*="seleccionarPlan"\], \[onclick\*="redirigirPortalStripe"\]/);
    assert.match(index, /src\/js\/app\/play-billing-service\.js/);
    assert.match(androidManifest, /playbilling\.provider\.PaymentActivity/);
    assert.match(androidManifest, /playbilling\.provider\.PaymentService/);
    assert.match(delegationService, /DigitalGoodsRequestHandler/);
    assert.match(backend, /serviceAccount: PLAY_BILLING_RUNTIME_SERVICE_ACCOUNT/);
    assert.match(backend, /GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT/);
    assert.match(backend, /payload\.email !== PLAY_BILLING_RTDN_PUSH_SERVICE_ACCOUNT/);
    assert.match(backend, /payload\.email_verified !== true/);
    console.log("Play Billing web checks passed.");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
