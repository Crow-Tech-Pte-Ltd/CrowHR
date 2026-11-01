"""Generate optional PDF fonts from the checksum-verified upstream SC OTF and Tamil TTF.
Requires fontTools 4.57.0. Sources, license notices and size record: src/pdf/fonts.md.
"""
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from pathlib import Path
import sys
source = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'src/pdf'
import base64,gzip,hashlib
assert hashlib.sha256((source / 'NotoSansSC-Regular.otf').read_bytes()).hexdigest() == 'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9'
assert hashlib.sha256((source / 'NotoSansTamil-Regular.ttf').read_bytes()).hexdigest() == '6532db33b8b264abe3a098a40619feb489b5ddf5ab1d2b46e72b51eeb548001b'
original=TTFont(source / 'NotoSansSC-Regular.otf')
glyphSet=original.getGlyphSet();order=original.getGlyphOrder();glyf={}
for name in order:
 pen=TTGlyphPen(None);quad=Cu2QuPen(pen,max_err=1.0,reverse_direction=True)
 glyphSet[name].draw(quad);glyf[name]=pen.glyph()
builder=FontBuilder(original['head'].unitsPerEm,isTTF=True)
builder.setupGlyphOrder(order)
builder.setupCharacterMap(original.getBestCmap())
builder.setupGlyf(glyf)
builder.setupHorizontalMetrics(original['hmtx'].metrics)
builder.setupHorizontalHeader(ascent=original['hhea'].ascent,descent=original['hhea'].descent,lineGap=original['hhea'].lineGap)
builder.setupNameTable({'familyName':'Crow HR SC','styleName':'Regular','uniqueFontIdentifier':'CrowHR-SC-Regular','fullName':'Crow HR SC Regular','psName':'CrowHR-SC-Regular','version':'Version 1.0'})
builder.setupOS2();builder.font['OS/2']=original['OS/2']
builder.setupPost(keepGlyphNames=False)
builder.setupMaxp()
builder.font['head'].created=original['head'].created;builder.font['head'].modified=original['head'].modified
builder.font.recalcTimestamp=False
builder.font['glyf'].padding = 4
# Fontkit chooses short loca offsets when subsetting. Every outline must be aligned.
from io import BytesIO
buffer = BytesIO()
builder.font.save(buffer)
data = buffer.getvalue()
assert hashlib.sha256(data).hexdigest() == 'ff3a4b6af199554edc1906fe8fff1401d9c5ebcd5fdad82737e7787412a8d6d6'
fonts = {'sc': data, 'tamil': (source / 'NotoSansTamil-Regular.ttf').read_bytes()}
for key, data in fonts.items():
    compressed = gzip.compress(data, mtime=0)
    b64 = base64.b64encode(compressed).decode()
    (out / f'noto-{key}.generated.ts').write_text('// Generated gzip-compressed Noto font, SIL OFL 1.1. Source and checksum: fonts.md.\nexport const fontGzipBase64 = "' + b64 + '";\n')
    print(key, len(data), 'font bytes;', len(b64), 'source bytes')
