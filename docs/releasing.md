# DOMSculptor release checklist

Use this checklist from a clean working tree on the intended release commit.

## Before the release

- Confirm `package.json` and `CHANGELOG.md` use the intended semantic version.
- Install exactly from the lockfile with `npm ci`.
- Install the declared Playwright browser versions.
- Run `npm run check`.
- Run `npm run test:browser` and require Chromium, Firefox, and WebKit to pass.
- Run `npm run test:api` and require every reachable public member to be
  exercised with no failures.
- Run `npm run test:edge` and require every probe to pass, including the
  ownership churn sweep.
- Run `npm run test:fuzz` and require no counterexample. Record the seed it
  prints, so a later failure can be compared against a known-good run.
- Run `npm run benchmark` and record the runtime, browser, medians, variance,
  memory result, and compressed bundle sizes.
- Run `npm pack --dry-run --json` and inspect every published path.
- Confirm both production bundles remain within the 13 KB gzip budget that
  `npm run size` enforces.
- Confirm `src` contains only `index.js`.
- Review the migration guide, compatibility policy, and versioned CDN URLs.
- Confirm the version matches the changes: a release containing anything under
  the changelog's breaking notes needs a major version, not a minor one.

## Release

1. Commit the reviewed release changes.
2. Create an annotated `v<version>` tag on that commit.
3. Push the commit and tag.
4. Authenticate with the npm account that owns the package using `npm login`.
5. Confirm the account with `npm whoami`.
6. Publish manually with `npm publish --access public`.
7. Create the GitHub release from the matching changelog section if wanted.
8. Verify the npm package exports from a new temporary project.
9. Verify the versioned browser ESM URL in a clean browser session.

## Rollback

Do not rewrite or reuse a published tag. If a release is defective, deprecate
the affected npm version, document the issue, fix forward, and publish a new
patch version.
