# Embedded Linux firmware SBOMs in cdxgen

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen/issues/4632 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | See [cdxgen-firmware-corpus.md](cdxgen-firmware-corpus.md) |

## Why

By device count, most firmware is embedded Linux: routers, cameras, printers, industrial gateways, BMCs and set-top boxes. These are the products the EU Cyber Resilience Act will push hardest towards SBOMs, and the ones where SBOMs are hardest to get, because the build systems (Buildroot, Yocto, OpenWrt and vendor SDKs) often leave no package database in the image, or one that common scanners do not read.

The usual pipeline today is to extract with binwalk or unblob, then point Syft or Trivy at the result, or to run EMBA, which adds emulation and binary version detection and writes CycloneDX. cdxgen has a strong second half already (rootfs scanning via trivy-cdxgen, binary analysis, container-style OS identification). This plan adds the missing pieces on the cdxgen side, on top of romi's safe extraction ([romi-embedded-linux.md](romi-embedded-linux.md)).

## Scope

In scope: running the rootfs pipeline on extracted firmware filesystems and nesting the results; reading OpenWrt opkg databases; identifying common embedded components from binaries; and describing Linux firmware blobs in OS, rootfs and container BOMs.

Out of scope: emulating firmware to find running services, which EMBA does well; Android framework analysis beyond the boot and system images; and RTOS firmware (Zephyr, FreeRTOS, ThreadX) without a filesystem. RTOS images are worth a later plan, starting from Zephyr's own SPDX output.

## Approach

### Filesystems to packages

romi splits the image and extracts each filesystem into a sandboxed temporary directory, listing anything it skipped. cdxgen then decides which trees are root filesystems, from the presence of `/etc`, `/bin` or `/usr`, or a package database. It runs the same analysis as `-t rootfs` on each one, and nests the packages under the filesystem component in the firmware BOM. Read-only roots with writable overlays (SquashFS plus JFFS2 or UBIFS) are common, so both are scanned and the overlay is labelled as configuration. OS identity comes from `/etc/os-release` and, for OpenWrt and Yocto, from `/etc/openwrt_release` and `/etc/version`.

### opkg

opkg's `status` file and `info/*.control` files are plain text. They give name, version, architecture, source, licence, maintainer, dependencies and file lists, which is enough for a proper dependency graph. The open decision is the purl. The purl specification has no `opkg` type, so the choice is between `pkg:generic/openwrt/<name>@<version>` with qualifiers and proposing a type upstream. cdxgen/cdxgen#4634 decides and documents. OpenWrt is moving to APK in newer releases, which cdxgen already reads, so both paths are tested.

### Components without a package database

For Buildroot-style images, identity comes from version strings in binaries. The rules are data (pattern, component, CPE template), applied only to ELF files no package claims, and each match records the string and offset as evidence with lower confidence. BusyBox also gets its applet list, read from the binary, so an advisory against one applet can be judged. Kernel and U-Boot versions come from romi ([cdxgen/cdxgen-plugins-bin#159](https://github.com/cdxgen/cdxgen-plugins-bin/issues/159)), with CPEs `cpe:2.3:o:linux:linux_kernel` and `cpe:2.3:a:denx:u-boot`, and the embedded kernel configuration kept as evidence.

### Linux firmware blobs everywhere

`linux-firmware`'s `WHENCE` file maps blobs to drivers, licences and sometimes versions. Grouping blobs per driver entry gives a useful middle level between one package and thousands of files. Microcode files are expanded per processor signature using romi. This applies to every OS, rootfs and container scan, not only to firmware images.

## Test cases

| Case | Input | Expected |
| --- | --- | --- |
| Yocto IPK or RPM image | `core-image-minimal` for QEMU, SquashFS | package list equals the build's installed-packages manifest |
| Buildroot image | QEMU ARM, BusyBox, musl, dropbear | BusyBox, musl, dropbear and kernel with versions from the Buildroot configuration |
| OpenWrt x86-64 | release image | opkg packages equal `opkg list-installed` captured at corpus build time, with ROM and overlay distinguished |
| Overlay layout | SquashFS root with a JFFS2 overlay | both scanned, overlay labelled as configuration |
| Debian-based BMC style image | debootstrap into ext4 | dpkg packages nested under the ext4 filesystem |
| Static binary with embedded library | statically linked tool with OpenSSL | two components from one file |
| Skipped content | image with a traversal entry and an unsupported filesystem | diagnostics in the BOM and in the fidelity report |
| Firmware blobs | Debian container with `linux-firmware` | components per `WHENCE` driver entry with licences, nested under the package |
| Microcode | `intel-ucode` and `amd-ucode` files | one entry per processor signature with revision |

## Deliverables

### D1. Rootfs pipeline on extracted filesystems (cdxgen/cdxgen#4633)

Packages from firmware filesystems nested under their filesystem, with OS identity and coverage accounting.

### D2. opkg databases (cdxgen/cdxgen#4634)

One component per installed opkg package with dependencies, licences and files, and a documented purl choice.

### D3. Binary identification (cdxgen/cdxgen#4635)

Kernel, U-Boot, BusyBox (with applets), libc, TLS libraries and common daemons identified from binaries by data-driven rules.

### D4. Linux firmware blobs (cdxgen/cdxgen#4636)

Firmware blobs in OS, rootfs and container BOMs, grouped by driver with licences, and microcode per processor signature.

## Risks and open questions

- **opkg purl.** Choosing `pkg:generic` now and a proper type later would change identities. It may be worth proposing an `opkg` type to the purl specification early, so the first release uses it.
- **False positives from version strings.** Strings can appear in binaries that only mention a component, for example in an error message. Rules must be anchored (for example, the BusyBox banner format), and the corpus must include negative cases.
- **Very large images.** NAS and BMC images can hold hundreds of thousands of files. The extraction budget and the rootfs pipeline's performance on such trees need testing before release.

## Outcome

To be filled in when the work ends.
