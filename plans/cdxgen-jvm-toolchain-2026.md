# JVM toolchain for 2026

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4596 |
| Owner | @prabhu |
| AI use | Auto |
| Corpus | none |

## Why

JDK 27 was released in September 2026, and Gradle [9.8](https://docs.gradle.org/9.8.0/release-notes.html) supports it for the daemon and for toolchains. cdxgen's images stop at Java 26. Maven 4 is still a release candidate, with 3.10.0 as the current general availability release ([Maven release history](https://maven.apache.org/docs/history.html)), and cdxgen should be ready when 4.0.0 ships.

Maven Central rate limiting (cdxgen/cdxgen#4460) also showed how much JVM scans depend on the registry. Lockfiles that projects already commit, from [maven-lockfile](https://github.com/chains-project/maven-lockfile) or Gradle's [dependency verification](https://docs.gradle.org/current/userguide/dependency_verification.html), record resolved coordinates and checksums and can reduce that dependence.

## Scope

The plan covers the Java images under `ci/images`, the image workflows, the Gradle selection in `lib/stages/pregen`, the Maven 4 pin and repo tests, and two new parsers for JVM lockfiles. It does not change the cyclonedx-maven-plugin path, which stays the default.

## Approach

Java 27 images follow the java26 pattern for temurin and alpine. Gradle 8 does not support Java 27, so the image or the auto-install logic must select Gradle 9 for such projects. The Maven 4 work reruns the Maven repo tests and the `jvmBomToolingGate` checks on 4.0.0 and compares the BOMs with 3.10.

The lockfile parsers read a committed file when it exists and produce components with hashes, without running the build. maven-lockfile records the full graph, so it can supply dependencies too; Gradle verification metadata records artefacts and checksums but no graph, so it enriches components found by the Gradle path rather than replacing it.

## Deliverables

### D1. Java 27 images (cdxgen/cdxgen#4597)

Images build in CI and the Java repo tests pass on them.

### D2. Maven 4 readiness (cdxgen/cdxgen#4598)

The pin moves to 4.0.0 and the repo tests produce the same BOMs as on 3.10. Blocked until release.

### D3. maven-lockfile (cdxgen/cdxgen#1042)

cdxgen reads `lockfile.json` from maven-lockfile, with fixtures.

### D4. Gradle verification metadata (cdxgen/cdxgen#978)

Hashes from `verification-metadata.xml` are attached to Gradle components, with fixtures.

## Risks and open questions

Some build plugins may lag behind Java 27; those failures should be recorded rather than worked around. Whether the lockfile parsers should be used automatically when the file exists, or only behind a flag, is a maintainer decision.

## Outcome

To be filled in when the work ends.
