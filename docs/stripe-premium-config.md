# Stripe Premium configuration

Balance Laboral activates `tipoCuenta: "premium"` only when the Stripe webhook can verify that the paid Checkout Session or Subscription belongs to an allowed Premium price or product.

Do not hardcode Stripe price IDs or product IDs in source code.

## Required variables

Use at least one of these variables:

```text
STRIPE_PREMIUM_PRICE_IDS=price_...,price_...
STRIPE_PREMIUM_PRODUCT_IDS=prod_...
```

Recommended setup:

- Use `STRIPE_PREMIUM_PRICE_IDS` for the exact monthly/yearly prices that grant Premium.
- Use `STRIPE_PREMIUM_PRODUCT_IDS` only as an optional fallback when all prices under that Stripe product should grant Premium.
- Keep test and live IDs separate. Do not mix `price_` IDs from test mode and live mode in the same production environment.

## Local development

Add the variables to `functions/.env`:

```dotenv
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PREMIUM_PRICE_IDS=price_monthly_test_xxxxxxxxx,price_yearly_test_xxxxxxxxx
STRIPE_PREMIUM_PRODUCT_IDS=prod_test_xxxxxxxxx
```

Then verify the local configuration loads:

```powershell
node --check functions\index.js
npm test
```

## Firebase production

This project reads runtime configuration from environment variables with `process.env`. For Firebase CLI deployments, use project-specific dotenv files in the `functions/` folder and keep them out of Git.

Create a production dotenv file:

```powershell
Copy-Item -LiteralPath functions\.env.example -Destination functions\.env.calendario-laboral-252b1
notepad functions\.env.calendario-laboral-252b1
```

Set your live IDs in that local file:

```dotenv
STRIPE_PREMIUM_PRICE_IDS=price_monthly_live_xxxxxxxxx,price_yearly_live_xxxxxxxxx
STRIPE_PREMIUM_PRODUCT_IDS=prod_live_xxxxxxxxx
```

Do not commit `functions/.env.calendario-laboral-252b1`. It is ignored by `.gitignore`.

If you prefer Firebase Secrets for sensitive values, keep using them for real secrets such as `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Stripe Price IDs and Product IDs are identifiers, not credentials, but they still should not be hardcoded in source code.

## Verification before deploy

Check the function manifest/dry-run:

```powershell
firebase deploy --only functions --project calendario-laboral-252b1 --dry-run
```

The Firebase CLI can print runtime environment values during verbose discovery. Do not share raw dry-run logs publicly.

Check locally without printing IDs:

```powershell
node -e "require('dotenv').config({path:'functions/.env.calendario-laboral-252b1'}); const p=(process.env.STRIPE_PREMIUM_PRICE_IDS||'').split(',').filter(Boolean).length; const r=(process.env.STRIPE_PREMIUM_PRODUCT_IDS||'').split(',').filter(Boolean).length; console.log({premiumPriceIds:p,premiumProductIds:r}); if(!p&&!r) process.exit(1)"
```

The hardened webhook intentionally fails closed. If neither `STRIPE_PREMIUM_PRICE_IDS` nor `STRIPE_PREMIUM_PRODUCT_IDS` is available at runtime, paid Stripe events are acknowledged but will not activate Premium.

## Stripe Dashboard checklist

- Confirm the live monthly Premium Price ID.
- Confirm the live yearly Premium Price ID.
- Confirm the Premium Product ID if using product fallback.
- Confirm the webhook sends:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Test in Stripe test mode before using live IDs.
