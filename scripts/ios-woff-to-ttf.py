#!/usr/bin/env python3
"""Converts a WOFF 1.0 file to its original sfnt (TTF/OTF) bytes. Standard library only.

The Ubuntu font ships to this repo as WOFF via @fontsource/ubuntu (Ubuntu Font Licence 1.0);
iOS bundles TTF/OTF, and WOFF 1.0 is just zlib-compressed sfnt tables (W3C WOFF 1.0 §4–5).
Usage: scripts/ios-woff-to-ttf.py IN.woff OUT.ttf
"""
import struct
import sys
import zlib


def woff_to_sfnt(data: bytes) -> bytes:
    (signature, flavor, _length, num_tables, _res, _total_sfnt, _maj, _min,
     _meta_off, _meta_len, _meta_orig, _priv_off, _priv_len) = struct.unpack(">4sIIHHIHHIIIII", data[:44])
    if signature != b"wOFF":
        raise ValueError("not a WOFF 1.0 file")
    entries = []
    for i in range(num_tables):
        tag, off, comp_len, orig_len, checksum = struct.unpack(">4sIIII", data[44 + i * 20: 64 + i * 20])
        raw = data[off: off + comp_len]
        table = zlib.decompress(raw) if comp_len < orig_len else raw
        if len(table) != orig_len:
            raise ValueError(f"table {tag!r} has the wrong length")
        entries.append((tag, checksum, table))
    entries.sort(key=lambda e: e[0])
    # sfnt header: searchRange etc. per the OpenType spec.
    max_pow2 = 1
    while max_pow2 * 2 <= num_tables:
        max_pow2 *= 2
    search_range = max_pow2 * 16
    entry_selector = max_pow2.bit_length() - 1
    range_shift = num_tables * 16 - search_range
    out = bytearray(struct.pack(">IHHHH", flavor, num_tables, search_range, entry_selector, range_shift))
    offset = 12 + 16 * num_tables
    directory = bytearray()
    body = bytearray()
    for tag, checksum, table in entries:
        directory += struct.pack(">4sIII", tag, checksum, offset + len(body), len(table))
        body += table
        body += b"\0" * ((4 - len(table) % 4) % 4)
    return bytes(out + directory + body)


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, "rb") as f:
        sfnt = woff_to_sfnt(f.read())
    with open(dst, "wb") as f:
        f.write(sfnt)
