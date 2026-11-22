"""Place "road + kilometre" on the map.

Reference points with a known road and kilometre come from OpenStreetMap kilometre posts and from
the DGT's own feeds (cameras, panels, radars, INVIVE stretches). For a kilometre between two
reference points the position is found along the road itself: the shortest Valhalla route between
them is walked to the right fraction. Results carry a `quality` so doubtful ones can be told apart.
"""
from __future__ import annotations

import bisect
import math
from typing import Awaitable, Callable

from .osm import road_key

Router = Callable[[tuple[float, float], tuple[float, float]], Awaitable[tuple[float, list[tuple[float, float]]] | None]]


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot((a[0] - b[0]) * 85, (a[1] - b[1]) * 111)


class PkIndex:
    def __init__(self) -> None:
        self.roads: dict[str, list[tuple[float, float, float]]] = {}

    def add(self, road: str, km: float | None, lon: float, lat: float) -> None:
        if km is None or not road or not (-19 < lon < 5 and 27 < lat < 44.5):
            return
        self.roads.setdefault(road_key(road), []).append((float(km), lon, lat))

    def finish(self) -> None:
        """Sort, merge duplicates and drop reference points that contradict their neighbours
        (a post tagged with the wrong road or kilometre would otherwise drag positions away)."""
        for key, pts in self.roads.items():
            pts.sort()
            merged: list[tuple[float, float, float]] = []
            for p in pts:
                if merged and abs(p[0] - merged[-1][0]) < 0.02 and _km(p[1:], merged[-1][1:]) < 0.3:
                    continue
                merged.append(p)
            clean = []
            for i, p in enumerate(merged):
                prev = merged[i - 1] if i else None
                nxt = merged[i + 1] if i + 1 < len(merged) else None
                ok = True
                for q in (prev, nxt):
                    # Straight distance can be shorter than the kilometre difference (curves), never much longer.
                    if q and _km(p[1:], q[1:]) > abs(p[0] - q[0]) * 1.15 + 1.5:
                        ok = False
                if ok or not (prev and nxt):
                    clean.append(p)
            self.roads[key] = clean

    def neighbours(self, road: str, km: float) -> tuple[tuple[float, float, float] | None, tuple[float, float, float] | None]:
        pts = self.roads.get(road_key(road), [])
        i = bisect.bisect_left(pts, (km, -999, -999))
        below = pts[i - 1] if i > 0 else None
        above = pts[i] if i < len(pts) else None
        return below, above

    async def locate(self, road: str, km: float, route: Router, max_gap: float = 20) -> tuple[float, float, str] | None:
        """(lon, lat, quality) where quality is 'exacto' (a reference point within 50 m), 'ruta'
        (interpolated along the road), 'lineal' (straight interpolation) or None if unknown."""
        below, above = self.neighbours(road, km)
        for p in (below, above):
            if p and abs(p[0] - km) <= 0.05:
                return p[1], p[2], 'exacto'
        if below and above and above[0] - below[0] <= max_gap:
            frac = (km - below[0]) / (above[0] - below[0])
            r = await route(below[1:], above[1:])
            span = above[0] - below[0]
            if r and span * 0.6 - 0.5 <= r[0] <= span * 1.5 + 0.5 and len(r[1]) > 1:
                return (*_along(r[1], frac), 'ruta')
            return below[1] + (above[1] - below[1]) * frac, below[2] + (above[2] - below[2]) * frac, 'lineal'
        near = min((p for p in (below, above) if p), key=lambda p: abs(p[0] - km), default=None)
        if near and abs(near[0] - km) <= 1.0:
            return near[1], near[2], 'cercano'
        return None


def _along(line: list[tuple[float, float]], frac: float) -> tuple[float, float]:
    seg = [_km(line[i], line[i + 1]) for i in range(len(line) - 1)]
    total = sum(seg) or 1e-9
    target = max(0.0, min(1.0, frac)) * total
    acc = 0.0
    for i, s in enumerate(seg):
        if acc + s >= target:
            t = (target - acc) / (s or 1e-9)
            a, b = line[i], line[i + 1]
            return round(a[0] + (b[0] - a[0]) * t, 6), round(a[1] + (b[1] - a[1]) * t, 6)
        acc += s
    return line[-1][0], line[-1][1]
