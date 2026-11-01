# Optional PDF script fonts

Noto fonts are SIL Open Font License 1.1; full notices are alongside the generated modules.

- SC source: https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
  SHA-256 `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`, 8,331,336 bytes.
- Tamil source: https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf
  SHA-256 `6532db33b8b264abe3a098a40619feb489b5ddf5ab1d2b46e72b51eeb548001b`, 74,248 bytes.

SC is converted with fontTools 4.57.0 from CFF to quadratic TrueType (maximum curve error one font unit), renamed **Crow HR SC** under the OFL, and aligned to four bytes per glyph. Fontkit 1.1.1's CFF subset rendered blank in Poppler, and its short-loca subset truncates unaligned glyph offsets. The raster regression verifies painted CJK outlines as well as searchable Unicode text. The converted TTF is 9,706,072 bytes, SHA-256 `ff3a4b6af199554edc1906fe8fff1401d9c5ebcd5fdad82737e7787412a8d6d6`.

Generated modules contain gzip-compressed font bytes as base64. `createPdf` imports and decompresses only the script needed by the document, then pdf-lib/fontkit embeds only used glyphs. Tamil shaping also lazily loads regenerator-runtime 0.14.1 (fontkit's Indic shaper needs it). No network or filesystem access occurs while generating a PDF. The Docker image gains only these source assets and that small runtime; the browser's initial bundle does not load either font. The final bundle size record is below.

Regenerate from the two checksum-verified upstream files using `python3 packages/core/scripts/pdf-noto-fonts.py /path/to/source-fonts` (fontTools 4.57.0). Output is deterministic; no download happens in the generator. Keep both OFL license notices when redistributing.

## Measured local build (Node 24, 1 Nov 2026)

`bun run demo:build` passes the server-module exclusion check and produces independent lazy chunks:

| Asset | Raw JS | gzip |
| --- | ---: | ---: |
| SC font | 7,895,623 bytes | 5,979,631 bytes |
| Tamil font | 49,215 bytes | 37,169 bytes |
| Indic runtime | 6,799 bytes | 2,559 bytes |

The optional fonts add no initial font download for Latin-only documents. The full static site including those optional chunks measures 12,921 kB gzip; that is the whole deployable site, not the initial page download. Generated font modules plus the small runtime add approximately 7.6 MiB to the Docker source payload (no Docker image was built). A sample with Chinese, Tamil and Latin text is 12,460 bytes after pdf-lib/fontkit subsetting, and passes both text extraction and raster checks. No external font requests occur.
