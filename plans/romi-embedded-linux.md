# Embedded Linux images in romi

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdxgen-plugins-bin/issues/155 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | See [cdxgen-firmware-corpus.md](cdxgen-firmware-corpus.md) |

## Why

Embedded Linux device images are wrappers around a kernel, device trees, an initial ramdisk and one or more filesystems, and often the filesystems are flash formats that desktop tools do not read. Existing extraction frameworks (binwalk, unblob, EMBA) call external extractors for many of these formats, often written in C or Python and rarely hardened against hostile input. cdxgen needs a safe, self-contained way to get from an image to directories it can scan, and to know the kernel and bootloader it found along the way.

## Scope

In scope: wrappers (U-Boot legacy and FIT, TRX, Android boot, vendor boot and sparse images, raw concatenations), filesystems (SquashFS, CPIO, ext2, ext3 and ext4, UBI, UBIFS, JFFS2, with YAFFS2 recognised), and kernel, U-Boot and device tree identification. Package and binary analysis of the extracted trees is cdxgen's job ([cdxgen-firmware-embedded-linux.md](cdxgen-firmware-embedded-linux.md)).

## Approach

### Formats

| Format | Signature | Implementation |
| --- | --- | --- |
| U-Boot legacy image | `0x27051956` | in romi: header, multi-file parts |
| FIT | FDT `0xd00dfeed` with `images` node | `fdt` crate: images, configurations, hashes, signatures |
| TRX | `HDR0` | in romi: partition offsets |
| Android boot and vendor boot | `ANDROID!`, `VNDRBOOT` | in romi: header versions 0 to 4, OS version and patch level |
| Android sparse | `0xed26ff3a` | in romi: chunk expansion within limits |
| SquashFS 4.0 and 3.0, vendor variants | `hsqs` and variants | `backhand`, compression features as needed |
| CPIO `newc` and `crc` | `070701`, `070702` | in romi |
| ext2, ext3 and ext4 | `0xEF53` at 1080 | evaluate existing crates; otherwise a read-only reader in romi |
| UBI | `UBI#`, `UBI!` | in romi: volume reconstruction |
| UBIFS | superblock node | in romi: index walk, LZO, zlib and Zstd |
| JFFS2 | `0x1985` | in romi: node scan and latest-version reconstruction |
| YAFFS2 | heuristic | recognised and reported; extraction decided by corpus frequency |
| Raw concatenation | signature scan at block alignment | parts reported as low-confidence guesses |

Compression for kernels and ramdisks (gzip, LZMA, XZ, LZ4, Zstd, bzip2) uses Rust crates with the foundation's limits.

### Extraction

`romi extract --select filesystems` writes each filesystem under its own directory in the destination, following the foundation's safety rules. Device nodes, FIFOs and setuid bits are dropped, and links are never followed out of the tree. A per-filesystem manifest lists entries skipped and why, which cdxgen copies into the BOM's diagnostics.

### Identity

The kernel banner (`Linux version ...`) gives release, compiler and build date. The embedded configuration (`IKCFG_ST`) is extracted when present. U-Boot's version string and environment block, Barebox and GRUB versions, and device tree `model` and `compatible` strings are reported as attributes of their parts, with offsets as evidence.

## Test cases

| Case | Input | Expected |
| --- | --- | --- |
| FIT | `mkimage` FIT with kernel, two device trees and a ramdisk; signed variant | parts, hashes and signature nodes match `mkimage -l` |
| Legacy uImage | multi-file image | parts and names |
| OpenWrt x86-64 | release image | partitions, kernel, SquashFS root and overlay |
| OpenWrt NAND target | UBI image | UBI volumes and UBIFS extracted, matching the build file list |
| Buildroot | SquashFS, ext4, JFFS2 and UBIFS variants | entries match `unsquashfs -lls`, `debugfs` and the `mkfs` inputs |
| Android | GSI boot image and a sparse system image | header fields, and sparse expansion to the right size |
| Raw concatenation | kernel plus SquashFS with no wrapper | both found, flagged low confidence |
| Kernel identity | kernel with `CONFIG_IKCONFIG` | release and configuration extracted |
| U-Boot identity | corpus U-Boot builds | version and environment |
| Malicious filesystems | traversal names, symlink escape, loops, huge sizes, overlapping erase blocks | safe handling and diagnostics |

## Deliverables

### D1. Wrappers and splitting (cdxgen/cdxgen-plugins-bin#156)

### D2. SquashFS, CPIO and ext4 (cdxgen/cdxgen-plugins-bin#157)

### D3. UBI, UBIFS and JFFS2 (cdxgen/cdxgen-plugins-bin#158)

### D4. Kernel and bootloader identity (cdxgen/cdxgen-plugins-bin#159)

## Risks and open questions

- **UBIFS and JFFS2 effort.** These are the largest pieces of new parser code in romi and the most exposed to hostile input. If they cannot be finished and fuzzed in time, they ship as "recognised, not extracted", and cdxgen says so in the BOM.
- **ext4 crate quality.** The available Rust ext4 readers vary in how they handle corrupt metadata. Fuzzing them before adoption is part of D2.
- **Vendor SquashFS variants.** Some older router firmware uses modified SquashFS with non-standard compression. backhand covers several, and anything else is reported as unsupported with the variant noted.

## Outcome

To be filled in when the work ends.
