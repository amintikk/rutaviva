<img src="public/icon.svg" width="64" height="64" alt="">

# Ruta viva

**El estado de las carreteras de España, en directo y en un solo mapa.** Incidencias, cámaras, radares, paneles,
gasolineras con su historia de precios desde 2007, recarga eléctrica con estado y precio en tiempo real y zonas de
bajas emisiones, todo con datos abiertos oficiales.

👉 **https://rutaviva.aminox.dev**

- **Tráfico**: accidentes, cortes, obras, nieve, retenciones y meteorología de la DGT, el Servei Català de Trànsit y
  Tráfico del Gobierno Vasco, cada 3 minutos, con el tramo afectado dibujado sobre la carretera.
- **Cámaras**: 1.980 cámaras de la DGT en directo, con navegación por la misma carretera.
- **Radares**: fijos, de tramo (con su longitud), tramos de vigilancia intensificada (INVIVE) y tramos peligrosos para motos.
- **Paneles**: lo que dicen ahora mismo los paneles de mensaje variable, con sus pictogramas.
- **Gasolineras**: precio de las 11.500 estaciones cada 30 minutos, coloreadas de barata a cara, y la historia diaria de
  cada una desde 2007; qué día de la semana sale más barato, marcas y provincias.
- **Recarga**: 12.000 estaciones; al acercarte, el estado de cada punto (libre, en uso, averiado) y su precio desde REVE;
  cada noche, un recorrido completo que mide qué operadores tienen más cargadores averiados.
- **Zonas de bajas emisiones**: los polígonos de 46 ciudades y qué etiquetas tienen restringido el acceso.
- **Planificador**: ruta con un servidor Valhalla propio y todo lo que hay en el camino: avisos, radares, cámaras,
  la gasolinera más barata y la recarga rápida a menos de 1,5 km, y si el destino está en una ZBE.
- Una página por carretera (`/carretera/a-6/`), terremotos del IGN, tema claro y oscuro, móvil con hoja deslizante.

## Arquitectura

```
worker/      Servicio en Python (aiohttp) que lee cada fuente a su ritmo y escribe /live/*.json
  rutaviva/datex.py     Lector DATEX II (v1.0 y v3.7) independiente de los espacios de nombres
  rutaviva/feeds.py     De cada publicación a registros compactos (probado con ficheros reales en tests/fixtures)
  rutaviva/fuelhist.py  Historia de precios: un parquet por día, compactado por año (DuckDB)
  rutaviva/reve.py      Estado y precio de la recarga (REVE), con caché y una sola cola lenta
  rutaviva/main.py      Planificador, archivo de incidencias (SQLite), ajuste de tramos a la carretera, /api/
src/         Web en TypeScript sin framework: MapLibre GL 6 + estilo propio sobre Protomaps
scripts/     Generación de páginas (una por carretera), sitemap, iconos e imagen social
deploy/      nginx (teselas por rangos, cachés de cámaras y geocodificador, proxy al worker y a Valhalla) y compose
```

Tres contenedores: `rutaviva` (nginx con la web y las teselas PMTiles de España), `rutaviva-worker` y
`rutaviva-valhalla` (rutas sobre OpenStreetMap). El mapa base y el relieve se sirven desde el propio servidor: no hay
claves ni límites de terceros.

## Desarrollo

```bash
npm install
cd worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
npm run dev          # reenvía /live, /tiles, /api… a producción (RUTAVIVA_DEV_TARGET para otro servidor)
npm test && worker/.venv/bin/python -m pytest worker/tests
./deploy.sh          # web + nginx;  ./deploy.sh worker  también reconstruye el servicio
```

Mapa base: `pmtiles extract https://build.protomaps.com/<fecha>.pmtiles spain.pmtiles --bbox=-18.3,27.5,4.6,43.9 --maxzoom=15`
y relieve de `https://download.mapterhorn.com/planet.pmtiles` hasta el zoom 11, en `data/tiles/`.

## Datos y licencias

DGT, Punto de Acceso Nacional de tráfico y movilidad (CC BY 4.0) · Servei Català de Trànsit y Dirección de Tráfico
del Gobierno Vasco vía el mismo punto (CC BY 4.0) · Ministerio para la Transición Ecológica, precios de carburantes y
estaciones de recarga (Ley 37/2007) · REVE, Red Eléctrica · IGN, terremotos y CartoCiudad · © OpenStreetMap (ODbL) ·
Protomaps · Mapterhorn. Detalle en https://rutaviva.aminox.dev/fuentes/. Ruta viva no es una web oficial ni está
vinculada a ninguno de estos organismos.

Código con licencia [MIT](LICENSE). © 2026 Amin Tahtah Toumi.
