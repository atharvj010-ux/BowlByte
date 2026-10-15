"""Generate the BowlByte PWA icons with only the Python standard library.

Run from the frontend folder:  python scripts/generate-icons.py
The shapes mirror the header logo (a bowl with a steam arc on a teal tile).
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
TEAL = (0x1D, 0x6B, 0x64)
CREAM = (0xF4, 0xEF, 0xE6)
ORANGE = (0xE0, 0x7A, 0x2F)
SS = 2  # supersampling per axis


def _rounded(px: float, py: float, radius: float) -> bool:
    """Inside a 32x32 rounded square."""
    if radius <= 0:
        return 0 <= px <= 32 and 0 <= py <= 32
    cx = min(max(px, radius), 32 - radius)
    cy = min(max(py, radius), 32 - radius)
    return 0 <= px <= 32 and 0 <= py <= 32 and (px - cx) ** 2 + (py - cy) ** 2 <= radius**2


def _bowl(px: float, py: float) -> bool:
    return py >= 14 and ((px - 16) / 9) ** 2 + ((py - 14) / 11) ** 2 <= 1 and 7 <= px <= 25


def _arc(px: float, py: float) -> bool:
    if py > 13.6:
        return False
    f = math.hypot((px - 16) / 6, (py - 14) / 2.6)
    return abs(f - 1) * 2.6 <= 0.45


def render(size: int, *, radius: float, scale: float, mode: str) -> bytes:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    u = (x + (sx + 0.5) / SS) / size * 32
                    v = (y + (sy + 0.5) / SS) / size * 32
                    gx = (u - 16) / scale + 16
                    gy = (v - 16) / scale + 16
                    if mode == "badge":
                        hit = _bowl(gx, gy) or _arc(gx, gy)
                        pixel = (255, 255, 255, 255) if hit else (0, 0, 0, 0)
                    elif not _rounded(u, v, radius):
                        pixel = (0, 0, 0, 0)
                    elif _arc(gx, gy):
                        pixel = (*ORANGE, 255)
                    elif _bowl(gx, gy):
                        pixel = (*CREAM, 255)
                    else:
                        pixel = (*TEAL, 255)
                    alpha = pixel[3]
                    acc[0] += pixel[0] * alpha
                    acc[1] += pixel[1] * alpha
                    acc[2] += pixel[2] * alpha
                    acc[3] += alpha
            total = SS * SS
            if acc[3] == 0:
                row.extend((0, 0, 0, 0))
            else:
                row.extend(
                    (acc[0] // acc[3], acc[1] // acc[3], acc[2] // acc[3], acc[3] // total)
                )
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path: Path, size: int, **kwargs: object) -> None:
    raw = render(size, **kwargs)  # type: ignore[arg-type]

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"wrote {path.name} ({size}x{size}, {len(png)} bytes)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", 192, radius=10, scale=1.0, mode="tile")
    write_png(OUT / "icon-512.png", 512, radius=10, scale=1.0, mode="tile")
    # Maskable: full-bleed square, artwork kept inside the 80% safe zone.
    write_png(OUT / "maskable-512.png", 512, radius=0, scale=0.72, mode="tile")
    write_png(OUT / "apple-touch-icon.png", 180, radius=0, scale=0.86, mode="tile")
    write_png(OUT / "badge-96.png", 96, radius=0, scale=0.9, mode="badge")


if __name__ == "__main__":
    main()
