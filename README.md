# FLAV4 shop

Storefront + order system + stock admin. Node.js, no build step.

- Site: `public/` · Admin: `/admin` · Orders & stock live in `data/` (kept out of git).
- Runs on any server with Node 20+: copy `.env.example` to `.env`, fill it in, `npm install`, `npm start`.
- Docker: `docker-compose.yml` runs it with HTTPS via Caddy (set `SITE_HOST` to the domain).
