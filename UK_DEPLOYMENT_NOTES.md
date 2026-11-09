# FLAV4 UK storefront update

This is an in-place update to Claude's original Node.js/Express shop. It preserves the existing routes, checkout flow, email notifications, SQLite records, stock manager, Docker configuration and original visual layout.

## UK settings
- Display currency: **GBP (£)**.
- Catalogue price: **£60 per sleeve**.
- One tracked-delivery charge: **£15 per order**.
- UK only: country code **GB**, UK postcode validation, timezone **Europe/London**, 10:00 weekday dispatch cutoff.
- Delivery wording: eligible **next working day**, conditional on postcode, courier acceptance, service and bank holidays. Do not advertise a legally enforceable guaranteed delivery service until fulfilment and coverage have been verified.

## Image replacements
- Platinum Seven Double Mix and Double Switch now replace the ESSE variants.
- Top Gun Iceberry and Mint Berry replace the old Iceberry and invented Citrusburst listing.
- Four newly embedded, original-product-based WebP images live in `public/img/`.
- The desktop cinematic hero remains; its obsolete image-embedded product strip is covered by an interactive four-item gallery. The mobile hero uses the updated product photo.

These third-party product photographs are references, not proof of commercial image-reuse permission.

## Existing installation migration
On app start, a one-time tagged migration updates saved public pricing, currency, allowed-country settings and product descriptions. It **retains** the existing historical orders, stock movement records and retired product rows, making retired products inactive. New replacement product rows are seeded at **zero stock** to avoid inventing inventory. Set real stock counts in the admin before taking orders.

## Deployment
The repository's Docker Compose service clones `main` when the container STARTS. Pushing to GitHub **does not automatically restart the live service**. Back up the existing SQLite volume before redeploying, and recreate the application container from the updated branch using the host's normal deployment process. Verify `/api/catalog` returns the four products, `GBP`, `£`, `Europe/London`, `GB`, price 60 and delivery 15. Confirm the UK postcode check, actual stock and admin access.

The live server hostname or administrative deployment connection was not available in this ChatGPT session. A successful GitHub push alone is not evidence of a live deployment.
