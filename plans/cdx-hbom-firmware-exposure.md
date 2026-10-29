# Firmware exposure in Linux HBOMs

| | |
| --- | --- |
| Epic | https://github.com/cdxgen/cdx-hbom/issues/20 |
| Owner | @prabhu |
| AI use | Pair |
| Corpus | none |

## Why

When a firmware vulnerability is announced, people ask two things about each machine: can it be reached through the vulnerable code path, and which firmware build is it running? A Linux HBOM from cdx-hbom answers neither well today.

The case that prompted this plan is [CVE-2026-97631](https://github.com/tianocore/edk2/security/advisories/GHSA-99cj-7hg9-mp4m), a critical buffer overflow in the EDK II PXE Base Code driver (`NetworkPkg/UefiPxeBcDxe`). While a machine is booting from the network, an ICMP error message longer than 504 bytes overwrites DXE-phase memory. An attacker who knows the firmware build can use that to run code before the operating system or Secure Boot is involved. EDK II is the base of most server and PC firmware, and the fix ([tianocore/edk2#13302](https://github.com/tianocore/edk2/pull/13302)) only reaches a machine when its vendor ships a BIOS update. Until then, the advice is to turn off network boot where it is not needed.

We ran cdxgen 13.2.1 with cdx-hbom 0.5.1 (`cdxgen -t hbom --include-runtime`) on an AMI-based Ryzen mini PC with Ubuntu 24.04. The HBOM had a `firmware` component holding the SMBIOS BIOS string `HPT.8xxx.SER8.V029.P8C0M0C15.08.Link`, its vendor and its date. Separately, it had a "System Firmware" `device` with ESRT GUID `52bbf6bf-735d-4281-83ed-9f6848060100` and version 29, which came from fwupd. There was no boot path information, and nothing linked the two firmware records.

## Scope

The plan covers the Linux collector in cdx-hbom (`src/linux/common/index.js` and `src/linux/common/commands.js`), the custom properties documentation, and one audit rule in cdxgen's `data/rules/hbom-security.yaml`.

It does not try to say whether a machine's firmware contains a vulnerable driver. The operating system cannot see the contents of the flash image, so that question needs a tool that reads firmware images. That work is planned for blint in [owasp-dep-scan/blint#264](https://github.com/owasp-dep-scan/blint/issues/264). Windows and macOS collectors are out of scope here. Windows already gathers platform trust signals, and the boot configuration there needs administrator rights through `bcdedit /enum firmware`, which deserves its own decision.

## Approach

UEFI keeps the boot configuration in variables that Linux exposes under `/sys/firmware/efi/efivars`. On the test host, `Boot####`, `BootOrder` and `BootCurrent` were readable without root, so the collector can parse the `EFI_LOAD_OPTION` structures directly (load options, [UEFI specification](https://uefi.org/specifications) 2.10, section 3.1.3) instead of depending on `efibootmgr`. The device path tells disk boot (`HD` and `File` nodes) apart from PXE (`MAC` followed by `IPv4` or `IPv6`) and HTTP boot (`Uri`). `efibootmgr -v` stays as a fallback and as a cross-check in tests.

For firmware identity, fwupd is the primary source because it reports the ESRT GUID and version without root. The kernel's ESRT files under `/sys/firmware/efi/esrt/entries` are readable only by root. When they are available they add the lowest supported version and the result of the last update attempt. The ESRT format is defined in section 23.4 of the [UEFI specification](https://uefi.org/specifications) 2.10. fwupd's [Host Security ID](https://fwupd.github.io/libfwupdplugin/hsi.html) attributes add the platform protections that decide how much damage firmware-level code could do.

The audit rule reports network boot by position in the boot order, not as a vulnerability. A network entry ahead of the current boot entry runs on every boot. One later in the order runs only when earlier entries fail.

## Deliverables

### D1. UEFI boot entries and network boot exposure (cdxgen/cdx-hbom#21)

The firmware component carries the boot entries, their order, and summary properties saying whether network boot is present, active, ahead of the current entry, and over which IP versions. Hosts without UEFI say so explicitly.

### D2. Firmware identifiers on the system firmware component (cdxgen/cdx-hbom#22)

The ESRT GUID, current version, lowest supported version and last attempt status sit on the firmware component, each with its source. The fwupd capsule device is merged into the firmware component or linked to it.

### D3. fwupd host security attributes (cdxgen/cdx-hbom#23)

Each HSI attribute and the overall HSI level are recorded as properties. A missing or old fwupd is reported, and collection continues.

### D4. Network boot audit rule (cdxgen/cdxgen#4618)

An `hbom-security` rule warns when network boot comes ahead of the current boot entry and reports it at a lower level when it is present later in the order. The message points the reader to the firmware identifiers.

## Risks and open questions

Some firmware hides network boot entries until the network stack is enabled in setup, and some regenerates them at every boot. A disk-only boot order seen from Linux is therefore a strong signal, not proof. We need fixtures from at least one server board (AMI or Insyde) to confirm the device path parsing on vendor firmware. Distributions mount efivarfs with different permissions. The collector must cope with variables that cannot be read and must not fail the run.

## Outcome

To be filled in when the work ends.
