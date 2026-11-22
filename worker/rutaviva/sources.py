"""Status of each enforcement source (live/sources.json): when we last got it, how old its data is and
whether it is ok, stale ('obsoleta') or missing ('falta'). The last good copy of every file is kept on
disk, so a source that fails keeps serving what it had (and shows as stale once that gets too old)."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from .store import DATA, now_iso, read_json, write_json

CACHE = DATA / 'sources'

# name, publisher, licence, page; refresh: hours after which a copy we could not renew is stale;
# max_age: days after which the publisher's own data counts as old (None: the date is not meaningful).
CATALOGUE: dict[str, dict[str, Any]] = {
    'dgt_informe': {'name': 'Radares fijos, de tramo y tramos de radar móvil (informe de cinemómetros)', 'by': 'DGT',
                    'licence': 'Reutilización con cita (Ley 37/2007)', 'url': 'https://www.dgt.es/conoce-el-estado-del-trafico/vigilancia-y-control/equipos-y-tramos-de-vigilancia',
                    'refresh': 12, 'max_age': 270},
    'dgt_equipos': {'name': 'Cámaras de cinturón, semáforo, stop y línea continua', 'by': 'DGT',
                    'licence': 'Reutilización con cita (Ley 37/2007)', 'url': 'https://www.dgt.es/conoce-el-estado-del-trafico/vigilancia-y-control/equipos-y-tramos-de-vigilancia',
                    'refresh': 12, 'max_age': 540},
    'nap_radares': {'name': 'Posición exacta de los radares de la DGT', 'by': 'DGT · Punto de Acceso Nacional',
                    'licence': 'CC BY 4.0', 'url': 'https://nap.dgt.es/', 'refresh': 12, 'max_age': 270},
    'nap_invive': {'name': 'Tramos de vigilancia intensificada (INVIVE)', 'by': 'DGT · Punto de Acceso Nacional',
                   'licence': 'CC BY 4.0', 'url': 'https://nap.dgt.es/', 'refresh': 12, 'max_age': 540},
    'nap_motos': {'name': 'Tramos de riesgo para motos', 'by': 'DGT · Punto de Acceso Nacional',
                  'licence': 'CC BY 4.0', 'url': 'https://nap.dgt.es/', 'refresh': 12, 'max_age': 540},
    'dgt_paneles': {'name': 'Controles anunciados en los paneles', 'by': 'DGT · Punto de Acceso Nacional',
                    'licence': 'CC BY 4.0', 'url': 'https://nap.dgt.es/', 'refresh': 0.25, 'max_age': None},
    'sct_fijos': {'name': 'Radares fijos y de tramo de Cataluña', 'by': 'Generalitat de Catalunya · Servei Català de Trànsit',
                  'licence': "Llicència oberta d'ús d'informació – Catalunya",
                  'url': 'https://transit.gencat.cat/ca/seguretat_viaria/cinemometres-fixos-trams-mobils/', 'refresh': 12, 'max_age': 540},
    'sct_remolque': {'name': 'Ubicaciones de los radares remolque de Cataluña', 'by': 'Generalitat de Catalunya · Servei Català de Trànsit',
                     'licence': "Llicència oberta d'ús d'informació – Catalunya",
                     'url': 'https://transit.gencat.cat/ca/seguretat_viaria/cinemometres-fixos-trams-mobils/', 'refresh': 12, 'max_age': 540},
    'madrid_radares': {'name': 'Radares fijos y de tramo de la ciudad de Madrid', 'by': 'Ayuntamiento de Madrid',
                       'licence': 'CC BY 4.0', 'url': 'https://datos.madrid.es/', 'refresh': 12, 'max_age': 540},
    'donostia': {'name': 'Radar móvil de hoy en Donostia / San Sebastián', 'by': 'Ayuntamiento de Donostia / San Sebastián',
                 'licence': 'Reutilización con cita (Ley 37/2007)', 'url': 'https://www.donostia.eus/info/ciudadano/radar_movil.nsf/fwHome?ReadForm&idioma=cas',
                 'refresh': 6, 'max_age': None, 'may_be_empty': True},
    'leon': {'name': 'Radares móviles del mes en León', 'by': 'Ayuntamiento de León', 'licence': 'Sin licencia de reutilización: desactivada hasta tener permiso',
             'url': 'https://aytoleon.es/es/actualidad/noticias', 'refresh': 48, 'max_age': 40, 'placeholder': True},
    'bcn_multas': {'name': 'Zonas de radar móvil deducidas de las multas de Barcelona', 'by': 'Ajuntament de Barcelona',
                   'licence': 'CC BY 4.0', 'url': 'https://opendata-ajuntament.barcelona.cat/data/es/dataset/denuncies_sancions_transit_bcn_detall',
                   'refresh': 72, 'max_age': 400},
    'madrid_multas': {'name': 'Zonas de radar móvil deducidas de las multas de Madrid', 'by': 'Ayuntamiento de Madrid',
                      'licence': 'CC BY 4.0', 'url': 'https://datos.madrid.es/', 'refresh': 72, 'max_age': 300},
    'euskadi_navarra': {'name': 'Radares fijos de Euskadi y Navarra (oficiales)', 'by': 'Trafikoa · Gobierno de Navarra',
                        'licence': 'Sin dataset abierto: solo OpenStreetMap hasta tener permiso', 'url': 'https://www.trafikoa.euskadi.eus/',
                        'refresh': None, 'max_age': None, 'placeholder': True},
    'osm': {'name': 'Radares de OpenStreetMap (País Vasco, Navarra, ciudades) y límites de velocidad', 'by': 'Colaboradores de OpenStreetMap',
            'licence': 'ODbL', 'url': 'https://www.openstreetmap.org/copyright', 'refresh': None, 'max_age': 45},
}


def _age_days(date: str) -> float | None:
    if not date:
        return None
    try:
        d = dt.datetime.fromisoformat(date.replace('Z', '+00:00'))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.UTC)
    return (dt.datetime.now(dt.UTC) - d).total_seconds() / 86400


class Sources:
    def __init__(self) -> None:
        self.state: dict[str, dict[str, Any]] = (read_json('sources') or {}).get('state', {})

    def ok(self, sid: str, *, count: int | None = None, data_date: str = '', note: str = '') -> None:
        prev = self.state.get(sid, {})
        self.state[sid] = {'fetched': now_iso(), 'data_date': data_date or prev.get('data_date', ''),
                           'count': prev.get('count') if count is None else count, 'note': note, 'error': ''}
        self.flush()

    def fail(self, sid: str, error: str) -> None:
        self.state[sid] = {**self.state.get(sid, {}), 'error': error[:300], 'failed_at': now_iso()}
        self.flush()

    def count(self, sid: str, n: int, note: str = '') -> None:
        st = self.state.setdefault(sid, {})
        st['count'] = n
        if note:
            st['note'] = note
        self.flush()

    def status(self, sid: str) -> dict[str, Any]:
        info = CATALOGUE.get(sid, {})
        st = self.state.get(sid, {})
        out = {'id': sid, **{k: info.get(k) for k in ('name', 'by', 'licence', 'url')}, **st}
        fetched_age = _age_days(st.get('fetched', ''))
        data_age = _age_days(st.get('data_date', ''))
        out['data_age_days'] = None if data_age is None else round(data_age, 1)
        if info.get('placeholder') and not st:
            out['status'], out['why'] = 'falta', info['licence']
        elif fetched_age is None or (not st.get('count') and not info.get('may_be_empty')):
            out['status'], out['why'] = 'falta', st.get('error') or 'Todavía no se ha podido descargar'
        elif info.get('refresh') and fetched_age * 24 > info['refresh'] * 2:
            out['status'], out['why'] = 'obsoleta', f"No se renueva desde hace {fetched_age:.1f} días: se usa la última copia buena" + (
                f" ({st['error']})" if st.get('error') else '')
        elif info.get('max_age') and data_age is not None and data_age > info['max_age']:
            out['status'], out['why'] = 'obsoleta', f'El organismo no la actualiza desde hace {data_age:.0f} días'
        else:
            out['status'], out['why'] = 'ok', ''
        return out

    def flush(self) -> None:
        write_json('sources', {'generated': now_iso(), 'state': self.state,
                               'sources': [self.status(s) for s in CATALOGUE if s in self.state or not CATALOGUE[s].get('optional')]})

    def note(self, sid: str, text: str) -> None:
        self.state.setdefault(sid, {})['note'] = text
        self.flush()


def cache_path(sid: str) -> Path:
    return CACHE / f'{sid}.bin'


def save_copy(sid: str, data: bytes, headers: dict[str, str]) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = cache_path(sid).with_suffix('.tmp')
    tmp.write_bytes(data)
    tmp.replace(cache_path(sid))
    (CACHE / f'{sid}.json').write_text(json.dumps({'at': now_iso(), 'headers': headers}))


def last_copy(sid: str) -> tuple[bytes, dict[str, str]] | None:
    p = cache_path(sid)
    if not p.exists():
        return None
    try:
        meta = json.loads((CACHE / f'{sid}.json').read_text())
    except (OSError, ValueError):
        meta = {}
    return p.read_bytes(), meta.get('headers', {})


def http_date(value: str) -> str:
    """'Thu, 17 Sep 2026 08:21:58 GMT' -> ISO 8601, '' if absent or unreadable."""
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(value).astimezone(dt.UTC).strftime('%Y-%m-%dT%H:%M:%SZ') if value else ''
    except (TypeError, ValueError):
        return ''
