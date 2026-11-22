"""The DGT's own lists of enforcement equipment, published as PDF on dgt.es ("Equipos y tramos de
vigilancia"): every fixed speed camera, average-speed section (with its length) and mobile-radar
stretch, plus the automatic cameras for seat belt / phone use, red lights, stop signs and solid
lines. They come as road + kilometre + direction, without coordinates; `pk.py` places them."""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

PAGE = 'https://www.dgt.es/conoce-el-estado-del-trafico/vigilancia-y-control/equipos-y-tramos-de-vigilancia'
BASE = 'https://www.dgt.es'


def pdf_links(html: str) -> dict[str, str]:
    """URLs of the speed-camera report and the equipment list (their names change with each update)."""
    links = re.findall(r'href="([^"]+\.pdf)"', html)
    out = {}
    for href in links:
        name = href.rsplit('/', 1)[-1].upper()
        if 'CINEMOMETROS' in name:
            out['informe'] = href if href.startswith('http') else BASE + href
        elif name.startswith('EQUIPOS'):
            out['equipos'] = href if href.startswith('http') else BASE + href
    return out


def pdf_text(data: bytes) -> str:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / 'f.pdf'
        p.write_bytes(data)
        return subprocess.run(['pdftotext', '-layout', str(p), '-'], capture_output=True, text=True, check=True, timeout=120).stdout


def _f(s: str) -> float:
    return float(s.replace(',', '.'))


ROW = re.compile(r'^\s*(\S.*?)\s{2,}(\S+)\s{2,}(Radar \w+(?: \w+)?)\s{2,}([\d.,]+(?:\s*-\s*[\d.,]+)?)\s{2,}(\S+)\s{2,}(\d\d/\d\d/\d{4})')
LEN = re.compile(r'^\s*\(([\d.]+) m\)\s*$')
SENTIDO = {'Creciente': 'positive', 'Decreciente': 'negative', 'Ambos': 'bothWays', 'C': 'positive', 'D': 'negative'}


def parse_informe(text: str) -> list[dict[str, Any]]:
    """Rows of INFORME_CINEMOMETROS: province, road, type, PK (or PK range), direction, date.
    The length of an average-speed section comes on the next line, "(5.638 m)"."""
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        m = ROW.match(line)
        if m:
            prov, road, tipo, pk, sentido, fecha = (x.strip() for x in m.groups())
            kind = {'Radar Fijo': 'fijo', 'Radar Tramo': 'tramo', 'Radar Móvil': 'movil'}.get(tipo, tipo.lower())
            if '-' in pk:
                a, b = (x.strip() for x in pk.split('-'))
                km, km2 = _f(a), _f(b)
            else:
                km, km2 = _f(pk), None
            rows.append({'prov': prov, 'road': road, 'kind': kind, 'km': km, 'km2': km2,
                         'dir': SENTIDO.get(sentido, sentido), 'date': fecha})
            continue
        lm = LEN.match(line)
        if lm and rows and rows[-1]['kind'] == 'tramo' and 'len_m' not in rows[-1]:
            length = float(lm.group(1).replace('.', '')) / 1000
            r = rows[-1]
            r['len_m'] = round(length * 1000)
            # The PK is where the section starts in its direction of travel.
            r['km2'] = round(r['km'] - length if r['dir'] == 'negative' else r['km'] + length, 3)
    return rows


EQUIPO = {'cinturón': 'cinturon', 'cinturon': 'cinturon', 'rojo': 'semaforo', 'semáforo': 'semaforo', 'semaforo': 'semaforo',
          'stop': 'stop', 'contínua': 'linea', 'continua': 'linea'}
EQ_ROW = re.compile(r'^\s*(\S.*?)\s{2,}([A-Z0-9-]+)\s{2,}([\d.,]+)\s{2,}([CD])\s{2,}(.+?)\s*$')


def parse_equipos(text: str) -> list[dict[str, Any]]:
    """Rows of EQUIPOS.pdf: province, road (without hyphen), PK, direction (C/D), equipment."""
    rows = []
    for line in text.splitlines():
        m = EQ_ROW.match(line)
        if not m:
            continue
        prov, road, pk, sentido, eq = (x.strip() for x in m.groups())
        kind = next((v for k, v in EQUIPO.items() if k in eq.lower()), None)
        if not kind:
            continue
        rows.append({'prov': prov.title(), 'road': road, 'kind': kind, 'km': _f(pk), 'dir': SENTIDO[sentido], 'equipo': eq})
    return rows
