"""Minimal PNG decoding helpers for browser-acceptance screenshot evidence.

Usage:
  png-tools.py --stats FILE          -> width height distinctColors lumMin lumMedian lumMax lumMean
  png-tools.py --diff FILE_A FILE_B  -> meanAbsDiff changedPixelPct
"""
import sys
import zlib
import struct
import collections


def decode(path):
    data = open(path, "rb").read()
    pos = 8
    idat = b""
    w = h = ct = 0
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, _bitd, ct = struct.unpack(">IIBB", body[:10])
        elif typ == b"IDAT":
            idat += body
        pos += 12 + ln
    buf = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * ch
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        f = buf[i]
        i += 1
        line = bytearray(buf[i:i + stride])
        i += stride
        if f:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                if f == 1:
                    line[x] = (line[x] + a) & 255
                elif f == 2:
                    line[x] = (line[x] + b) & 255
                elif f == 3:
                    line[x] = (line[x] + ((a + b) >> 1)) & 255
                elif f == 4:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, ch, out


def stats(path):
    w, h, ch, px = decode(path)
    stride = w * ch
    colors = collections.Counter()
    lum = []
    step = max(1, (w * h) // 40000)
    n = 0
    for py in range(h):
        for pxi in range(w):
            n += 1
            if n % step:
                continue
            o = py * stride + pxi * ch
            r = px[o]
            g = px[o + 1] if ch >= 3 else r
            b = px[o + 2] if ch >= 3 else r
            colors[(r >> 3, g >> 3, b >> 3)] += 1
            lum.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    lum.sort()
    print(w, h, len(colors), round(lum[0], 1), round(lum[len(lum) // 2], 1),
          round(lum[-1], 1), round(sum(lum) / len(lum), 1))


def diff(a, b):
    wa, ha, cha, pa = decode(a)
    wb, hb, chb, pb = decode(b)
    if (wa, ha, cha) != (wb, hb, chb):
        print(255, 100)
        return
    total = 0
    changed = 0
    count = 0
    stride = wa * cha
    step = max(1, (wa * ha) // 60000)
    n = 0
    for py in range(ha):
        for pxi in range(wa):
            n += 1
            if n % step:
                continue
            o = py * stride + pxi * cha
            d = max(abs(pa[o] - pb[o]),
                    abs(pa[o + 1] - pb[o + 1]) if cha >= 3 else 0,
                    abs(pa[o + 2] - pb[o + 2]) if cha >= 3 else 0)
            total += d
            count += 1
            if d > 12:
                changed += 1
    print(round(total / max(count, 1), 3), round(100 * changed / max(count, 1), 3))


if __name__ == "__main__":
    if sys.argv[1] == "--stats":
        stats(sys.argv[2])
    elif sys.argv[1] == "--diff":
        diff(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("unknown mode")
