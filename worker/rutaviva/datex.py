"""Namespace-agnostic readers for the DATEX II publications of the Spanish National Access Point.

The DGT publishes DATEX II v3.7 (incidents, cameras, VMS, ZBE, charging points) while the
Catalan (SCT) and Basque (DT-GV) traffic authorities and the older DGT location sets
(radars, INVIVE stretches) still use v1.0. Element names are almost the same in both,
only the namespaces and a few wrappers change, so everything here matches by local name.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Iterator

XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'


def local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def parse(data: bytes) -> ET.Element:
    return ET.fromstring(data)


def iter_local(el: ET.Element, name: str) -> Iterator[ET.Element]:
    for e in el.iter():
        if local(e.tag) == name:
            yield e


def first(el: ET.Element, name: str) -> ET.Element | None:
    return next(iter_local(el, name), None)


def text(el: ET.Element | None, name: str | None = None) -> str:
    if el is None:
        return ''
    if name is not None:
        el = first(el, name)
        if el is None:
            return ''
    return (el.text or '').strip()


def texts(el: ET.Element, name: str) -> list[str]:
    return [t for t in ((e.text or '').strip() for e in iter_local(el, name)) if t]


def xsi_type(el: ET.Element) -> str:
    return el.get(XSI_TYPE, '').split(':')[-1]


def all_values(el: ET.Element) -> str:
    """Every enum/text value under an element, joined: used to detect snow, closures..."""
    return ' '.join(t for t in ((e.text or '').strip() for e in el.iter()) if t and len(t) < 200)


def coords(el: ET.Element) -> list[tuple[float, float]]:
    """(lon, lat) of every pointCoordinates / openlrCoordinates / coordinatesForDisplay below el."""
    out: list[tuple[float, float]] = []
    for e in el.iter():
        if local(e.tag) in ('pointCoordinates', 'openlrCoordinates', 'coordinatesForDisplay', 'locationForDisplay'):
            lat, lon = text(e, 'latitude'), text(e, 'longitude')
            try:
                out.append((round(float(lon), 6), round(float(lat), 6)))
            except ValueError:
                continue
    return out


def descriptor(el: ET.Element, kind: str) -> str:
    """v1.0 names: <name><descriptor><value>X</value></descriptor><tpegDescriptorType>kind</...></name>."""
    for n in iter_local(el, 'name'):
        if text(n, 'tpegDescriptorType') == kind:
            v = text(n, 'value')
            if v:
                return v
    return ''


def to_float(s: str) -> float | None:
    try:
        return float(s.replace(',', '.'))
    except (ValueError, AttributeError):
        return None


_SPACES = re.compile(r'\s+')


def clean(s: str) -> str:
    return _SPACES.sub(' ', s).strip()
