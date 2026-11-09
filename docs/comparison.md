# Comparing this implementation

This edition is one side of the exercise in the original project's [docs/comparison.md](../../Naturedex/docs/comparison.md). This file records the facts for Drupal. It doesn't score them.

## What differs from the other editions

| | First Naturedex | WordPress edition | Drupal edition |
| --- | --- | --- | --- |
| Frontend | Astro and React | PHP templates and plain TypeScript | Twig templates and the same plain TypeScript |
| Rendering | React, server-rendered and hydrated | PHP; TypeScript enhances existing HTML | Drupal blocks, controllers, and node views; TypeScript enhances existing HTML |
| CMS | Drupal 11 as a headless blog store | WordPress 7.1 | Drupal 11.4, owning every page |
| Species | JSON file in the repository | Custom post type | `species` node type |
| Groups and regions | JSON | Custom taxonomies with term meta | Vocabularies with term fields |
| Content model lives in | Setup script | PHP registration code | Module config YAML |
| Journal body storage | Plain text field | Native blocks | Plain text, rendered by a text format filter |
| Second editor | Drupal node form (separate) | Block editor; rich bodies are read-only in the desk | Drupal node form, same format, nothing read-only |
| Editor access | Local token on loopback | WordPress accounts, roles, and nonces | Drupal accounts, roles, node access, and `X-CSRF-Token` |
| Publish permission | Token holder | `publish_posts` capability | Core `administer node published status` |
| Delete | Permanent | Trash, recoverable | Permanent, after confirmation |
| Species address | Dialog only | Dialog and its own page | Dialog and its own page |
| Cache invalidation | Not applicable | 5-minute shared cache at the CDN | Cache tags clear affected pages on save |
| Without JavaScript | Not a goal | Guide, entries, and journal readable | Guide, entries, and journal readable |
| Local runtime | FrankenPHP binary | PHP-WASM through Playground | FrankenPHP binary and SQLite |
| Deployment | Hosted copy, not Drupal | AWS: ECS, RDS, EFS, CloudFront | AWS: ECS, RDS, CloudFront (designed, not yet deployed) |
| Shared file storage | Not applicable | EFS for uploads | None; all state is in the database |
| Edge cache bypass for editors | Not applicable | Fixed `COOKIEHASH` | Fixed session cookie name |

## Change exercises

| Exercise | What happened here |
| --- | --- |
| Create, preview, draft, publish | Writing desk, and also Drupal's node form, on the same text. Covered by browser tests |
| Correct a reused record | One edit in Drupal's species form updates the card, species page, dialog, and article cards for visitors, through cache tags. Covered by a browser test that warms the page cache first |
| Add a field and filter on it | Add field storage and instance YAML (or use Field UI), add it to `Records::speciesRecord()`, the template, and the TypeScript filter. Not exercised yet |
| Unpublish referenced content | An unpublished species leaves the guide and article cards, its page returns 403, and the reference survives republishing. Covered by a browser test |
| Restart after an edit | Data persists in `.runtime/data/naturedex.sqlite`. Setup is idempotent and imports nothing on a second run. Checked by hand |
| Replace the renderer | `/api/naturedex/species`, `/regions`, and `/posts` return the same normalized records the templates use, so a different frontend could read them. Templates do not go through HTTP, so this is not exercised |

## Measured results

Measured November 9, 2026, on Drupal 11.4.11, FrankenPHP 1.13.0 (PHP 8.5, Intel macOS), SQLite, and Chromium, after a fresh install.

| Measure | First Naturedex | WordPress edition | Drupal edition |
| --- | ---: | ---: | ---: |
| Browser JavaScript (minified) | 254 KB | 11.6 KB | 11.7 KB |
| Browser JavaScript (gzip) | 79 KB | 4.7 KB | 4.7 KB |
| Fresh install, including seeding | — | under a minute | about 8 seconds after downloads |

| Custom code | Lines |
| --- | ---: |
| TypeScript frontend | 805 |
| PHP (module, install, constraint, blocks, controllers) | 1,658 |
| Twig (module and theme) | 727 |
| Configuration YAML (80 files, mostly fields and form displays) | 1,918 |
| Runtime scripts (Node and PHP) | 380 |
| CDK stack | 618 |
| Production image (Dockerfile, settings, scripts, smoke test) | 280 |

| Automated tests | Passed |
| --- | ---: |
| Unit (Vitest), including PHP/TypeScript format parity | 22 of 22 |
| Browser, API, accessibility (Playwright) | 32 of 32 |
| AWS stack (CDK assertions) | 28 of 28 |
| Production image on MySQL (smoke test) | Not run yet; runs in CI |

The browser suite includes the first version's scenarios as adapted for the WordPress edition. New here: Drupal's node form and the desk round-tripping one body, a species correction reaching cached visitor pages, unpublishing a referenced species, role checks for contributors and readers, CSRF and origin checks, revisions on every save, sign-in and not-found accessibility scans, and the site without JavaScript.

The configuration line count is large because Drupal config is explicit: each field is a storage file and an instance file, and each form display lists every widget. It was generated once and is now edited as YAML or through Field UI. Don't read fewer lines or tests as a more elegant result; the original comparison warns against this.

Page speed was not measured. Hands-on time was not measured.

## Things Drupal made easier or harder

Observed while building this. These are notes, not scores.

**Easier**

- Revisions, roles, sessions, CSRF tokens, path aliases, and an admin UI came with core. The Writing desk API is mostly mapping JSON onto entities and calling `validate()`.
- Entity validation constraints apply to every editor at once. The slug rule is written once and enforced in the node form and the API.
- Cache tags made "correct one record, every page updates" automatic, even with full-page caching for visitors.
- A text format filter plugin let both editors share one storage format, which avoided the WordPress edition's read-only rich-content case.
- OOP hooks with explicit ordering (`#[Hook('page_top', order: Order::Last)]`) made it clear where the module changes core behavior.

**Harder**

- Core has no permission to view others' unpublished content. Editors could not open drafts, and the node form sent them to the front page after saving one, until a small `hook_node_access` rule was added.
- Core has no trash. Deleting is permanent.
- Inside a Playwright test, `request.newContext()` inherits the configured signed-in session. An "anonymous" API check passed for the wrong reason until it was given an empty storage state.
- Drupal's installer write-protects `sites/default`, so setup has to restore write access before it can reinstall.
- `ControllerBase::create()` is the static factory, so an API action can't be called `create`.
- Unpublished nodes return 403 rather than 404, which reveals that a draft address exists. The page says the note is unavailable either way.
- Generic term pages and listings (`/taxonomy/term/…`, `/node`) exist by default and had to be closed or disabled.
- Behind CloudFront, Drupal needed the visitor's host, scheme, and address restored from CloudFront headers, and a fixed session cookie name so the edge can tell signed-in visitors apart. The WordPress edition needed the equivalent fixed cookie hash.
- Drupal's page cache uses the second a page was cached as its `ETag`. If a page is cached, invalidated by a save, and cached again within one second, a browser revalidating its old copy is told it is unchanged. Only the fast CI runner hit this, in a test that saved and revisited immediately.
- Core's quick-start installer only creates SQLite sites and refuses to run when `settings.php` exists. Calling `install_drupal()` directly serves both local SQLite and production MySQL.

**Easier for deployment**

- No shared file storage: Drupal regenerates CSS/JS aggregates per container, so a second task needs nothing extra.
