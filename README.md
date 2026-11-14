# Naturedex — Drupal edition

A Virginia wildlife field guide with an original Game Boy Advance–inspired look: 24 animated pixel-art animals, a linked region map, a personal discovery collection, and a field journal.

This is the Drupal implementation of [Naturedex](../Naturedex), built for comparison with the original (Astro/React with a headless Drupal blog) and the [WordPress](../Naturedex-WordPress) and [Contentstack](../Naturedex-Contentstack) editions. It reuses their species data, journal posts, sprites, CSS, and test scenarios. Here **Drupal owns everything**: the content model, every page, sign-in, and editorial permissions. The frontend is Twig templates plus the same small, framework-free TypeScript as the WordPress edition.

## Run it locally

Requires Node 22.12 or later, macOS or Linux, and an internet connection the first time. No system PHP, Composer, database server, or Docker is needed.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4321**. The first start downloads Drupal 11.4.11 and a project-local [FrankenPHP](https://frankenphp.dev) binary (checked against its published SHA-256), installs Drupal on SQLite, and imports the seed content. That takes under a minute.

- Sign in at `/user/login` as `admin`. The generated password is in `.runtime/admin-password`.
- The Writing desk is at `/editor`; Drupal's own admin is at `/admin/content`.
- Everything generated lives in `.runtime/` (ignored by git). The database is `.runtime/data/naturedex.sqlite` and survives restarts. Delete it and run `npm run setup` to start over.
- PHP and Twig changes under `drupal/` apply on the next request; the module and theme are symlinked into the Drupal distribution. After changing `frontend/`, run `npm run build:frontend`.

## How it is built

| Part | Location | Role |
| --- | --- | --- |
| Module | `drupal/modules/naturedex_core` | Content model (config YAML), page routes, blocks, Writing desk API, body format, seeding |
| Theme | `drupal/themes/naturedex` | Page shell, block placement, built assets |
| Frontend | `frontend/` | TypeScript behavior and CSS, bundled into the theme by esbuild |
| Runtime scripts | `scripts/` | Download, install, seed, and serve; `drupal-task.php` installs Drupal and runs tasks, locally and in production |
| Production image | `docker/` | Official Drupal image plus this code; `settings.php` reads the environment |
| Infrastructure | `infra/` | AWS CDK stack, deployed by the manual GitHub Actions workflow |

**Rendering.** Drupal produces all the HTML, so pages work without JavaScript. The app shell (sidebar, top bar, heading) is three blocks with route-based cache metadata. The guide, map, journal, and desk are controller routes. Species, field notes, and About are ordinary nodes, rendered by `hook_node_view` from the same normalized records the API returns. TypeScript then adds filtering, the seen collection, dialogs, sprite motion, and the Writing desk. A species entry is rendered once by Twig, into both its own page and the `<template>` a dialog clones.

**Content model.** Everything ships as configuration in `naturedex_core/config/install`.

| Content | Drupal type |
| --- | --- |
| Species | `species` node type: dex number, scientific name, ranges, references (link field), sprite |
| Animal groups, regions | Vocabularies; region terms hold their ID, map position, short name, and color |
| Field notes | `field_note` node type with an excerpt, a category term, and related species (entity references) |
| About | `page` node |
| Addresses | Each node's path alias follows its slug: `/species/…`, `/journal/…`, `/about` |

Slugs are validated by a constraint plugin (format and uniqueness within the bundle), so Drupal's node form and the Writing desk enforce the same rules. Related species are entity references, so renaming a species or changing its ID cannot break a link.

**One body format.** Field note bodies are stored as plain text: paragraphs separated by blank lines, and `## ` headings. A text format filter plugin renders them and escapes any HTML. The Writing desk and Drupal's node form therefore edit exactly the same value, and neither can damage the other's work. `tests/unit/format.test.ts` checks that the desk's preview parser and the PHP filter agree.

**Access.** Reading is public. Accounts are created by an administrator. Two roles ship with the module:

- **Contributor** writes and edits their own field notes, as drafts only.
- **Editor** edits and deletes any note, publishes and unpublishes (core's `administer node published status`), reviews drafts, and edits species, regions, and About.

The Writing desk uses Drupal sessions and Drupal's own `X-CSRF-Token` header. Every save is a node revision. Deleting is permanent: Drupal core has no trash, so the desk asks for confirmation.

**Caching.** Public pages are served from Drupal's page cache. Every page that shows records carries their cache tags, so saving a species or note, from either editor, clears exactly the pages that show it. The Writing desk is the only page with a CSRF token, and it is never cached.

**Your browser.** The discovery collection and motion preference stay in local storage. Neither reaches Drupal.

## System status

`/status` shows live site checks (website, database, hourly cron, and the daily Drupal security-release check), test counts, and recent deployments. CI publishes a sanitized summary to the `status` branch (the first run on `main` creates it), and Drupal reads that plus GitHub's public workflow history, caching the result for 5 minutes. The page skips Drupal's own page cache, which ignores max-age, and tells CloudFront to keep it for 5 minutes instead.

The page is deliberately limited. It shows counts and yes-or-no results only, never test names, errors, logs, versions, or infrastructure details. Those rules are enforced in `Drupal\naturedex_core\Status`, which treats its inputs as untrusted, and in `tests/browser/status.spec.ts`, which runs against hostile stand-ins for GitHub (`tests/status-fixtures.mjs`).

## API

Under `/api/naturedex`, JSON only:

| Route | Access |
| --- | --- |
| `GET /species`, `GET /regions` | Public |
| `GET /posts` | Public; `?includeDrafts=1` needs the Writing desk permission (contributors see their own notes) |
| `GET /posts/{id or slug}` | Published notes are public; drafts need view access |
| `POST /posts` | Signed in, with `X-CSRF-Token` |
| `PATCH /posts/{id}`, `DELETE /posts/{id}` | Signed in, with `X-CSRF-Token`, and node access to that note |

Invalid input returns 422 with every problem in one message. Publishing without permission returns 403. Get a token from `/session/token`.

## Commands

```sh
npm run dev            # build the frontend, set up if needed, serve on :4321
npm run setup          # download, install, and import missing seeds
npm run build          # sprites, type-check, frontend bundle
npm test               # unit tests
npm run test:e2e       # browser, API, and accessibility tests
npm run test:a11y      # accessibility subset
npm run verify         # all of the above, plus the infrastructure tests
```

Browser tests need Chromium (`npx playwright install chromium`) and an installed site (`npm run setup`). They run against a disposable copy of your database on port 4322, so they never change your working site. Sign-in uses one-time login links, as `drush user:login` would.

To change a sprite animation, edit `data/sprite-motion-*.json` and run `npm run sprites:build`.

Seeding only adds what is missing. It never overwrites edits, and it does not bring back seeds you deleted. Seeded notes are bylined to a blocked "Naturedex field team" account so the administrator's username is never shown publicly.

## Deploy to AWS

**Live:** https://dlp9hw0zcp41x.cloudfront.net

The production design is one Drupal container on ECS Fargate behind CloudFront and AWS WAF, with RDS for MySQL, defined with AWS CDK in `infra/` and deployed by a manual GitHub Actions workflow. Drupal keeps all its state in the database, so unlike the WordPress edition there is no shared file storage. The image (`docker/`) is built and smoke-tested against MySQL in CI on every push; deploying is a manual `gh workflow run deploy.yml`. See [docs/deployment-aws.md](docs/deployment-aws.md) for the architecture, caching, security, cost, and setup steps.

```sh
npm run infra:test     # assertions on the AWS stack
npm run infra:synth    # generate CloudFormation offline
```

The local FrankenPHP server is for development only, bound to `127.0.0.1`; do not expose it publicly.

## Verification

Results from the last full run are in [docs/comparison.md](docs/comparison.md#measured-results). Passing automated scans is not a WCAG or Section 508 conformance claim; manual checks are recorded as not evaluated in [docs/accessibility.md](docs/accessibility.md).

## Content scope

This is a representative collection across mammals, birds, reptiles, amphibians, fish, and invertebrates, not a complete checklist of Virginia wildlife. Map pins mark broad regional habitat associations, **not sightings, ranges, or precise boundaries**. The interface and sprites are original and contain no Pokémon artwork. The Silkscreen font is under the SIL Open Font License (`drupal/themes/naturedex/assets/fonts/OFL.txt`). The Virginia outline keeps its source attribution in `drupal/modules/naturedex_core/assets/map/virginia.geojson`.
