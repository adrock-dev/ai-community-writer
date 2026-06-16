# Admin JSON API for Next.js

NestJS exposes the JSON admin surface under `/api/admin/*` for the Next.js admin UI while keeping SQLite data. This company build is optimized for driving-license/driving-school domains.

## Auth

If `ADMIN_PASSWORD` is set, every admin JSON endpoint accepts one of:

- cookie: `admin_token=<ADMIN_PASSWORD>`
- header: `x-admin-token: <ADMIN_PASSWORD>`
- header: `Authorization: Bearer <ADMIN_PASSWORD>`

## Core endpoints

- `GET /api/admin/options` — driving-only vertical, theme/template/provider/preset/indexing options.
- `GET /api/admin/domains` — domain list with counts.
- `POST /api/admin/domains` — create a driving domain. Defaults to driving preset + local-guide design.
- `GET /api/admin/domains/{domain}?include=slots,posts,academies,jobs` — domain detail, axes, slot counts, optional tab data.
- `PATCH /api/admin/domains/{domain}` — update settings, enabled templates, design template, and content brief.
- `DELETE /api/admin/domains/{domain}` — delete domain.

## Axes and slots

- `PUT /api/admin/domains/{domain}/axes/{axis}` — replace one axis with `{ "values": [...] }`.
- `POST /api/admin/domains/{domain}/axes/preset` — apply `{ "preset_key": "driving" }`.
- `POST /api/admin/domains/{domain}/axes/ai-fill` — reapplies the driving preset in the Nest runtime; a future provider can swap this for true LLM axis expansion.
- `GET /api/admin/domains/{domain}/slots?status=&template=&limit=` — list slots.
- `POST /api/admin/domains/{domain}/slots/generate` — generate slots (`max_per_template`).
- `DELETE /api/admin/domains/{domain}/slots/{slot_id}` — delete slot.
- `POST /api/admin/domains/{domain}/slots/{slot_id}/reset` — reset failed/in-progress slot to planned.

## Posts, academies, jobs, indexing

- `GET /api/admin/domains/{domain}/posts?status=&limit=` — list posts.
- `GET /api/admin/domains/{domain}/posts/{post_id}?include_rendered=true` — post detail, optionally rendered HTML.
- `DELETE /api/admin/domains/{domain}/posts/{post_id}` — delete post.
- `GET /api/admin/domains/{domain}/academies?region=&limit=` — list academies.
- `POST /api/admin/domains/{domain}/academies` — upsert one object, an array, or `{ "items": [...] }`.
- `DELETE /api/admin/domains/{domain}/academies/{acad_id}` — delete academy.
- `POST /api/admin/domains/{domain}/jobs/generate` — queue generation job (`slot_ids`, `provider`, `model`, `cooldown_sec`, `timeout_sec`).
- `POST /api/admin/domains/{domain}/jobs/dedup` — queue dedup job (`threshold`, `dry_run`).
- `POST /api/admin/domains/{domain}/jobs/prune` — queue prune job (`min_body_chars`, `stale_noindex_days`, `dry_run`).
- `POST /api/admin/domains/{domain}/jobs/indexing` — queue indexing URL collection job (`max`).
- `GET /api/admin/jobs?domain=&status=&limit=` — job list with parsed `payload_obj` / `result_obj`.
- `GET /api/admin/settings/indexing` — indexing settings metadata.
- `PUT /api/admin/settings/indexing` — save `sa_json` and/or `url_template`.

The public content API remains under `/api/v1/*` and is now served by NestJS.

## Next.js admin app

A complete Next.js admin UI lives in `apps/admin-next/`.

- It calls its own `/api/admin/*` route handler.
- The route handler proxies to Nest `SEO_API_BASE_URL/api/admin/*`.
- Set `ADMIN_API_TOKEN` to the same value as Nest `ADMIN_PASSWORD` when auth is enabled.

Run:

```bash
cd apps/api-nest
npm install
API_WORKER=1 npm run dev

cd ../admin-next
cp .env.example .env.local
npm install
npm run dev
```
