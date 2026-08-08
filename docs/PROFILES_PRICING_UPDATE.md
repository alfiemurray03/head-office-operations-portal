# Sousa Murray Profiles — governed monthly price update

The Head Office Central Payments standard catalogue keeps Starter unchanged and updates the fixed monthly Profiles prices used for new purchases:

- Starter: £5.00
- Professional: £16.00
- Organisation: £30.00
- Ultimate Organisation: £80.00

Ultimate Organisation+ remains a separately managed/tailored tier and is not silently mapped onto the fixed Ultimate Organisation Stripe Price.

Stripe Price amounts are immutable. `functions/_central-payment-standard-catalogue.js` therefore validates the live Stripe Price against the governed amount, currency, product and recurring interval. When a governed amount changes it creates a replacement Price, transfers the stable lookup key, updates the Central Payments D1 mapping and marks the former Price inactive for new purchases. Existing subscriptions may continue to reference their historical Price.
