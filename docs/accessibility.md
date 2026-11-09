# Naturedex accessibility verification

The engineering target is WCAG 2.2 Level AA, with a separate mapping to the applicable Revised Section 508 web requirements (which incorporate WCAG 2.0 Level A and AA). This document records scope and evidence; passing automated checks alone does not establish site-wide conformance.

## Automated checks

`npm run test:e2e` serves a disposable copy of the working Drupal database on `127.0.0.1:4322`, so tests never touch the working site. `npm run test:a11y` runs the accessibility subset, using axe on rendered pages. Tests also assert accessible names, keyboard interaction, focus, and page overflow. A result is evidence only for the tested route, state, browser, and build.

Reports are written to `playwright-report/`; failures keep screenshots and traces in `test-results/`.

### What this edition changes for accessibility

- Public pages are rendered by Drupal, so content, headings, and links exist before and without JavaScript. A browser test covers the guide, a species page, and an article with JavaScript off.
- Controls that only work with JavaScript (filters, seen toggles, map buttons, the motion control) are hidden when it is off, rather than shown and inert.
- Card titles are links that TypeScript upgrades to dialog buttons, so without JavaScript they lead to the species page.
- Region map buttons have no no-JavaScript filter. The full species list remains available as the map's text alternative.
- Field note bodies can only hold paragraphs and level-two headings, from either editor, so authors cannot skip heading levels or add images without alternatives.
- The sign-in page and the not-found page are scanned, because both are reached from the public site.
- Drupal's administration pages use the core Claro theme and are outside these scans.

The automated scope is the first Naturedex's set of states (catalog, map, journal, writing desk, animal dialog, new-post form, article preview, a published article, and the paused and reduced-motion states) plus sign-in and not-found. Results for the current build are in [docs/comparison.md](comparison.md#measured-results).

## Manual assessment record

All manual assessments below are **not evaluated** until a person performs the procedure and records the result. Test the main catalog, a filtered catalog, an entry detail, the regional map, an article, and the writing desk including validation errors and save/delete flows.

| Area | WCAG criteria to assess | Procedure | Current manual result |
| --- | --- | --- | --- |
| Text alternatives | 1.1.1 | Review whether animal sprite/image alternatives and map equivalents communicate the relevant information; decorative art should not create noise. | Not evaluated |
| Structure and relationships | 1.3.1, 1.3.2, 2.4.6 | Use a screen reader's heading, landmark, list, and form navigation. Check order and relationships in every view. | Not evaluated |
| Color and contrast | 1.4.1, 1.4.3, 1.4.11 | Check text, focus indicators, controls, selected states, badges, and map markers. Confirm information remains understandable without color. | Not evaluated |
| Reflow and text adjustment | 1.4.4, 1.4.10, 1.4.12 | Check 200% text enlargement, 400% zoom, a 320 CSS-pixel viewport, and text-spacing overrides. Confirm essential content and controls remain usable. | Not evaluated |
| Keyboard operation | 2.1.1, 2.1.2 | Complete catalog search/filter, entry selection, region selection, reading, blog create/edit/publish/delete using only a keyboard. Check that no control traps focus. | Not evaluated |
| Focus and navigation | 2.4.1, 2.4.3, 2.4.7, 2.4.11 | Use the skip link; inspect visible focus, logical order, focus after view changes and modal closure, and focus visibility behind sticky content. | Not evaluated |
| Target sizes | 2.5.8 | Check small icon buttons, tabs, map markers, filters, and close controls at desktop and mobile sizes, accounting for applicable exceptions. | Not evaluated |
| Forms and errors | 3.3.1, 3.3.2, 3.3.3 | Submit an incomplete or invalid article; inspect instructions, labels, error identification, correction guidance, focus, and retained input. | Not evaluated |
| Name, role, value and status | 4.1.2, 4.1.3 | Check control states and announcements for filtering, save, publish, delete, empty results, and request failures using VoiceOver/Safari or another documented browser/assistive-technology pair. | Not evaluated |
| Parsing under the 508/WCAG 2.0 mapping | 4.1.1 (WCAG 2.0) | Validate generated markup for duplicate IDs and malformed relationships; retain this mapping even though WCAG 2.2 removed this success criterion. | Not evaluated |

For each assessed item retain: standard/version, criterion, route or component, interactive state, procedure, automated report if applicable, manual result, source version, date, browser/assistive technology, and linked remediation issue. Use pass, fail, not evaluated, or not applicable with a rationale.

## Content authoring

The blog editor should support meaningful titles, readable excerpts, structured headings, and related species references. Test content quality as well as editor controls: an automated check cannot determine whether descriptions, headings, sources, or animal-identification cues are accurate and useful.

Map associations represent illustrative regional habitat guidance rather than exact animal sightings. The visible text/list equivalent must remain available independently of interpreting the map graphic.

## Reference standards and tool limits

- [U.S. Access Board: Revised 508 Standards](https://www.access-board.gov/ict/)
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Section508.gov: Testing methods](https://www.section508.gov/test/testing-overview/)
- [Playwright: Accessibility testing](https://playwright.dev/docs/accessibility-testing)
