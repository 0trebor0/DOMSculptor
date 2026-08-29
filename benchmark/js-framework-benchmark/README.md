# DOMSculptor entry for js-framework-benchmark

A keyed implementation of the [js-framework-benchmark][upstream] operations,
kept in this repository so it stays in step with the library and can be verified
before it is submitted.

[upstream]: https://github.com/krausest/js-framework-benchmark

## Layout

| file | purpose |
| --- | --- |
| `index.html` | The markup the harness requires: the six control buttons, `#tbody`, and the preload icon. |
| `src/main.js` | The implementation. One `signal()` holds the rows and a keyed `list()` renders them. |
| `webpack.config.cjs` | Bundles `src/main.js` and the library into `dist/main.js`. |
| `package.json` | Declares `build-prod`, which is the script the harness runs. |

## Verifying it

From the repository root:

```bash
node benchmark/jsfb-verify.mjs
```

That builds the bundle against the working tree rather than the published
package, serves it, and drives all six buttons plus row selection and removal in
headless Chromium, asserting the row markup, the class names the harness's CSS
selectors depend on, and the result of every operation.

## Submitting it

1. Clone the upstream repository.
2. Copy this directory to `frameworks/keyed/domsculptor`.
3. Run `npm install` there, then `npm run build-prod`.
4. Follow the upstream README for `npm run bench keyed/domsculptor` and for
   opening the pull request.

Two details are worth keeping in mind when the numbers are compared with other
entries.

**Selection is applied directly, not through the list.** Marking one row
`danger` by writing to the signal would re-run the keyed diff across every
mounted row to change a single attribute, so the click handler toggles the class
on the row itself. This is what the `vanillajs` entry does and what Solid's
fine-grained bindings achieve without the diff; React, Preact, and Vue entries
pay a re-render instead.

**The library is dependency-free and needs no compiler.** `build-prod` only
bundles; there is no JSX or template compilation step, so the built entry is a
close reflection of the source.
