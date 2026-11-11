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

**Build on atom 4 directly.** cdxgen pins `@appthreat/atom` 4.0.0 (cdxgen/cdxgen#4779) and no
longer starts atom to find out what it supports: `atomFrontendArgKeys` and `atomOptions` are gone,
and atom 4.0.0 is the documented minimum. The work here therefore needs no switch on the installed
atom and no atom 3 code path. A slices file an older atom wrote and the user passes with
`--usages-slices-file` alone still gives occurrences, as it does today.

**One atom build for both slices.** The usages run writes the callsites slice too
(`atom usages --extract-endpoints --also-callsites <file>`), so the atom is built and tagged once,
and the separate JavaScript `callsites` run goes away. A `--callsites-slices-file` given by the user
is reused, never overwritten. `atomBomFileArgs` passes `--bom-file` to the usages run as well as
reachables, so atom can fill a record's `purl`.

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

**Added first, default later.** Until D4, callsites records add use-site occurrences to the
occurrences that `usages` gives, as JavaScript does today. D4 switches the source once every
language meets its targets.

## Deliverables

### D1. Run callsites for every atom language (cdxgen/cdxgen#4690)

Python, Java source, JAR and APK, PHP, Ruby and C/C++, from the same atom through
`usages --also-callsites`, with `--bom-file` passed. Done when `--evidence` writes a callsites slice
for each language from one atom start per project, and a run given only a usages slices file still
gives the occurrences it gives today.

### D2. Attribute records to components per ecosystem (cdxgen/cdxgen#4691)

Generalise `attributeJsCallsites` into the attribution order above. Done when poku tests cover each
ecosystem with a good and a bad twin (a shared name, a builtin with and without a runtime component,
a `purl` that names no component), and repotests assert occurrences for one project per ecosystem.
Each project reports how many records were attributed by `purl`, by ecosystem rule, to a runtime
component and not at all, and occurrence recall and precision against the ground truth stay within
0.02 of the slice's own package-level numbers.

Each occurrence from a callsites record also carries the record's position and name: `offset` from
its `col` and `symbol` from its `module` and `path` (CycloneDX 1.6 has both fields). Today an
occurrence holds only `location` and `line`, so the many uses on one line of a theme file, or one
member read thirty times, cannot be told apart. evinse keeps one occurrence per use site, as the
slice does (decision 0001 in AppThreat/.github), and does not collapse repeated reads of a member.
A tool that wants one row per file or per member can group on `symbol`. Done when poku tests show
two uses on one line as two occurrences with different `offset` values, and an occurrence seeded
from an input BOM without these fields is not duplicated by the slice's version of it. This part
landed with cdxgen/cdxgen#4727 (cdxgen/cdxgen#4726).

### D3. Filters and annotations (cdxgen/cdxgen#4692)

Apply `--exclude` to callsites records (`file`, both path separators), embed the slice under
`--annotate`, and add it to the slices-file checks in `bin/cdxgen.js`. Done with poku tests.

Every location that enters the occurrence set is written with `/`, whatever its source. On Windows
`initFromSbom` seeds the set with the input BOM's backslash locations while the slices give forward
slashes, so one place is counted twice: on ngx-admin 965 to 1111 of the occurrences in three evinse
runs were such duplicates (cdxgen/cdxgen#4693, comment 6634492064). Done when a poku test seeds a
BOM with backslash locations, merges a slice with forward slashes for the same places, and gets one
occurrence for each. This part landed with cdxgen/cdxgen#4727.

### D4. Occurrences from callsites by default (cdxgen/cdxgen#4693)

Switch occurrences to callsites for every atom language once each language meets its targets;
`usages` stays for services, user-defined types and C includes. Done when repotests pass and BOM
occurrence recall against the ground truth is at least the slice's.

## Risks and open questions

- atom 4.0.0 has known gaps that change evidence on some projects: PHP `vendor/` is dependency
  code (AppThreat/atom#394), reachables finds no flows on express and a Composer project
  (AppThreat/atom#395), and JavaScript usages on express has no user-defined types
  (AppThreat/atom#396). Comparisons against atom 3 output should name these rather than count them
  as callsites regressions.
- Each slice is a separate process with its own 20-minute budget; one build for usages and
  callsites changes how evinse accounts for timeouts.
- The ground truth and the scorer live in a private harness in AppThreat (decision 0001); the
  occurrence numbers in pull requests are reproduced from it by a maintainer.
- A Java BOM can need Maven to run, and some corpus projects cannot be built safely. Where that
  blocks a measurement, the pull request says so.
- On ngx-admin 1233 of 3229 occurrences sit at a file and line that no callsites record names; they
  come from `usages` and cdxgen's own heuristics. D4 must say which of them it keeps, so that the
  switch does not drop occurrences that only those sources find.

## Outcome

Filled in when the work ends.
