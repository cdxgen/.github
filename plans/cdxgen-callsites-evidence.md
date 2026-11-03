# Occurrence evidence from atom's callsites slice for every language

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4718 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | [callsites-corpus.corpus.json](https://github.com/AppThreat/.github/blob/main/plans/callsites-corpus.corpus.json) in AppThreat/.github |

## Why

`evinse` turns atom's slices into `evidence.occurrences`, and dep-scan reads those occurrences to
decide which dependencies a project really uses. Today the occurrences come from atom's `usages`
slice, which finds 46 to 77 percent of external use sites in Java, JavaScript and Python (median
recall), 1 to 19 percent in PHP and none in Ruby, and whose JavaScript and Python output is about a
third noise. atom 4 adds a `callsites` slice for every language it supports, with one record per
external use site. Measured against compiler-grade ground truth, its package-level recall and
precision are 0.87 to 0.98 and 0.95 to 0.99 for Python, 0.90 to 0.98 and 0.97 to 1.0 for Java,
0.99 to 1.0 for PHP, Ruby, Android APKs and Kotlin and Scala bytecode, and 0.86 to 1.0 and 0.92 to
1.0 for C (details in AppThreat/.github `plans/callsites-status.md`).

cdxgen runs `callsites` only for JavaScript and TypeScript (`JS_LANGUAGES` in
`lib/evinser/evinser.js`) and reads three fields of each record (`module`, `file`, `line`), mapping
npm packages through the BOM's `ImportedModules`. Records are not filtered by `--exclude`, not
embedded by `--annotate`, and the slice is missing from the slices-file checks.

The slice itself is planned and built in AppThreat: the callsites plans in
[AppThreat/.github](https://github.com/AppThreat/.github/tree/main/plans) (`callsites-overview.md`
and the language plans) and decision record 0001, "what counts as a use". This plan covers only
what cdxgen does with the slice. dep-scan's part is in
[owasp-dep-scan/.github](https://github.com/owasp-dep-scan/.github/blob/main/plans/depscan-callsites.md).

## Scope

cdxgen's evidence pipeline: running the slice, attributing its records to components, filtering
and annotating it, and in the end making it the source of occurrences. OpenAPI, services and
user-defined type filtering keep reading `usages`, and so does C/C++ include attribution for
components the slice cannot see.

## Approach

**Land on master, switched on by the installed atom.** cdxgen pins `@appthreat/atom` 3.1.1, which
has no callsites for languages other than JavaScript, and atom 4 is not yet released. Every change
is switched on by what the installed atom offers, as `atomCompileCommandsArgs` and `atomBomFileArgs`
in `lib/inventory/atomUtils.js` already do: `atomOptions().has("--also-callsites")` means atom 4.
With atom 3 cdxgen behaves exactly as today, and that is tested.

**One atom build for both slices.** With atom 4 the usages run writes the callsites slice too
(`atom usages --also-callsites <file>`), so the atom is built and tagged once. A separate
`callsites` run remains only as the JavaScript fallback for an atom without the option. A
`--callsites-slices-file` given by the user is reused, never overwritten. `atomBomFileArgs` passes
`--bom-file` to the usages and callsites runs as well as reachables, so atom can fill a record's
`purl`.

**Attribution order.** For each record: the record's `purl` when it names a component of the BOM;
otherwise the ecosystem rule below; otherwise no component, and the record is counted as
unattributed. A record with `builtin: true` goes to the BOM's runtime or standard-library component
when there is exactly one (the Python, JDK, Node.js, PHP, Ruby, glibc or musl component), and to
nothing otherwise. A name two components share is never resolved by guessing.

| ecosystem | rule |
| --- | --- |
| npm | as today: `jsPackageOfModule` and every purl of the package |
| pypi | the top-level import name through each component's `ImportedModules` property, longest prefix, unique claims only |
| maven (Java source and bytecode) | the class through the namespaces `evinse` already reads (`readNamespaceMap`, `prepareDB`), the lookup `parseSliceUsages` uses for usages |
| composer | the namespace through the components' namespace data, longest prefix |
| gem | the constant path through the components' namespace data |
| C/C++ | the header through `cppIncludeResolver`, as `attributeCIncludes` does for usages |

If a rule needs data that is not in the BOM or the namespace map, that gap is recorded rather than
filled by a new heuristic. For C/C++, the resolver may need the absolute path of the header a
record resolved to; if a record kind lacks it, atom adds the field (atom and cdxgen change together,
with no schema versioning).

**Added first, default later.** Until D4, callsites records add `file#line` locations to the
occurrences that `usages` gives, as JavaScript does today. D4 switches the source once every
language meets its targets.

## Deliverables

### D1. Run callsites for every atom language (cdxgen/cdxgen#4690)

Python, Java source, JAR and APK, PHP, Ruby and C/C++, from the same atom through
`usages --also-callsites`, with `--bom-file` passed. Done when `--evidence` writes a callsites slice
for each language with atom 4, and the BOM is unchanged with atom 3.

### D2. Attribute records to components per ecosystem (cdxgen/cdxgen#4691)

Generalise `attributeJsCallsites` into the attribution order above. Done when poku tests cover each
ecosystem with a good and a bad twin (a shared name, a builtin with and without a runtime component,
a `purl` that names no component), and repotests assert occurrences for one project per ecosystem.
Each project reports how many records were attributed by `purl`, by ecosystem rule, to a runtime
component and not at all, and occurrence recall and precision against the ground truth stay within
0.02 of the slice's own package-level numbers.

### D3. Filters and annotations (cdxgen/cdxgen#4692)

Apply `--exclude` to callsites records (`file`, both path separators), embed the slice under
`--annotate`, and add it to the slices-file checks in `bin/cdxgen.js`. Done with poku tests.

### D4. Occurrences from callsites by default (cdxgen/cdxgen#4693)

Switch occurrences to callsites for every atom language once each language meets its targets;
`usages` stays for services, user-defined types and C includes. Done when repotests pass and BOM
occurrence recall against the ground truth is at least the slice's.

## Risks and open questions

- Repotests in CI use the pinned atom 3.1.1, so assertions that need atom 4 skip themselves until
  cdxgen moves its pin to an atom 4 release. They are run locally with `ATOM_CMD` until then.
- Each slice is a separate process with its own 20-minute budget; one build for usages and
  callsites changes how evinse accounts for timeouts.
- The ground truth and the scorer live in a private harness in AppThreat (decision 0001); the
  occurrence numbers in pull requests are reproduced from it by a maintainer.
- A Java BOM can need Maven to run, and some corpus projects cannot be built safely. Where that
  blocks a measurement, the pull request says so.

## Outcome

Filled in when the work ends.
