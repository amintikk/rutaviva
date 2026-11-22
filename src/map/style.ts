// Base map style: Protomaps vector tiles (self-hosted PMTiles of Spain) with our own soft palette,
// relief shading from Mapterhorn terrain tiles, and optional 3D terrain.
import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

const ORIGIN = typeof location !== 'undefined' ? location.origin : '';
export const TILES = `pmtiles://${ORIGIN}/tiles/spain.pmtiles`;
export const TERRAIN = `pmtiles://${ORIGIN}/tiles/terrain.pmtiles`;

// Calm, slightly warm palette in the spirit of Apple Maps: pale land, soft greens, clear blue water,
// white streets with hairline casings and warm yellow motorways.
const LIGHT: Partial<Flavor> = {
  background: '#f3f1ec', earth: '#f3f1ec',
  park_a: '#dcebd3', park_b: '#cfe5c4', wood_a: '#d8e8cf', wood_b: '#c9e0bd', scrub_a: '#e1ead6', scrub_b: '#d6e4c8',
  hospital: '#f3e3e1', industrial: '#ebe8e4', school: '#efe9df', pedestrian: '#efede8', glacier: '#f7f7f7',
  sand: '#f1ead8', beach: '#f4ebcf', aerodrome: '#e8e8ea', runway: '#dcdce0', zoo: '#d9e8d3', military: '#e6e3dd',
  water: '#a8d4f5', pier: '#e6e3dd', buildings: '#e5e1da',
  tunnel_other_casing: '#e4e1da', tunnel_minor_casing: '#e4e1da', tunnel_link_casing: '#e4e1da', tunnel_major_casing: '#e4e1da',
  tunnel_highway_casing: '#e9d9b5', tunnel_other: '#f3f1ec', tunnel_minor: '#f5f4f0', tunnel_link: '#f5f4f0',
  tunnel_major: '#f5f4f0', tunnel_highway: '#f7e7c2',
  minor_service_casing: '#e2ded6', minor_casing: '#e2ded6', link_casing: '#e2c98f', major_casing_late: '#dcd6cb',
  highway_casing_late: '#e2b86a', other: '#f7f6f3', minor_service: '#ffffff', minor_a: '#ffffff', minor_b: '#ffffff',
  link: '#fbd98a', major_casing_early: '#dcd6cb', major: '#ffffff', highway_casing_early: '#e2b86a', highway: '#fcd27e',
  railway: '#c4c0ba', boundaries: '#b9b3c9',
  bridges_other_casing: '#dcd6cb', bridges_minor_casing: '#dcd6cb', bridges_link_casing: '#e2b86a',
  bridges_major_casing: '#dcd6cb', bridges_highway_casing: '#e2b86a', bridges_other: '#ffffff', bridges_minor: '#ffffff',
  bridges_link: '#fbd98a', bridges_major: '#ffffff', bridges_highway: '#fcd27e',
  roads_label_minor: '#77736c', roads_label_minor_halo: '#ffffff', roads_label_major: '#5f5b55', roads_label_major_halo: '#ffffff',
  ocean_label: '#5d8fc2', subplace_label: '#8a857d', subplace_label_halo: '#f3f1ec', city_label: '#2f2d2a',
  city_label_halo: '#f6f5f1', state_label: '#9c96ab', state_label_halo: '#f3f1ec', country_label: '#7d778c',
  address_label: '#97928a', address_label_halo: '#ffffff',
  landcover: { grassland: '#e5efd9', barren: '#f1ece0', urban_area: '#ebe8e2', farmland: '#ecf1df', glacier: '#fafafa', scrub: '#e3ecd5', forest: '#d3e6c8' },
};

const DARK: Partial<Flavor> = {
  background: '#1d1e21', earth: '#1d1e21',
  park_a: '#1f2b22', park_b: '#223024', wood_a: '#1f2a21', wood_b: '#213023', scrub_a: '#22291f', scrub_b: '#242d21',
  hospital: '#2a2223', industrial: '#232427', school: '#26241f', pedestrian: '#242528', glacier: '#2b2d31',
  sand: '#2a2822', beach: '#2c2a22', aerodrome: '#26272b', runway: '#34363b', zoo: '#212a22', military: '#26262a',
  water: '#16314a', pier: '#2a2b2f', buildings: '#2b2c30',
  tunnel_other_casing: '#2a2b2f', tunnel_minor_casing: '#2a2b2f', tunnel_link_casing: '#2a2b2f', tunnel_major_casing: '#2a2b2f',
  tunnel_highway_casing: '#4a3f2b', tunnel_other: '#2e3034', tunnel_minor: '#303236', tunnel_link: '#303236',
  tunnel_major: '#303236', tunnel_highway: '#5a4a2c',
  minor_service_casing: '#1d1e21', minor_casing: '#1d1e21', link_casing: '#3c3220', major_casing_late: '#1d1e21',
  highway_casing_late: '#3c3220', other: '#34363b', minor_service: '#393b40', minor_a: '#3a3c42', minor_b: '#3f4147',
  link: '#7a6334', major_casing_early: '#1d1e21', major: '#4a4c53', highway_casing_early: '#3c3220', highway: '#8c6f35',
  railway: '#45474d', boundaries: '#5d5870',
  bridges_other_casing: '#1d1e21', bridges_minor_casing: '#1d1e21', bridges_link_casing: '#3c3220',
  bridges_major_casing: '#1d1e21', bridges_highway_casing: '#3c3220', bridges_other: '#3a3c42', bridges_minor: '#3f4147',
  bridges_link: '#7a6334', bridges_major: '#4a4c53', bridges_highway: '#8c6f35',
  roads_label_minor: '#9a9ca3', roads_label_minor_halo: '#1d1e21', roads_label_major: '#b4b6bd', roads_label_major_halo: '#1d1e21',
  ocean_label: '#5f86ad', subplace_label: '#8c8e95', subplace_label_halo: '#1d1e21', city_label: '#e6e6ea',
  city_label_halo: '#1d1e21', state_label: '#7f7a91', state_label_halo: '#1d1e21', country_label: '#9590a8',
  address_label: '#8c8e95', address_label_halo: '#1d1e21',
  landcover: { grassland: '#20281f', barren: '#29271f', urban_area: '#232427', farmland: '#222820', glacier: '#2d2f33', scrub: '#21281f', forest: '#1d2a20' },
};

export function baseStyle(dark: boolean, relief: boolean): StyleSpecification {
  const flavor: Flavor = { ...namedFlavor(dark ? 'dark' : 'light'), ...(dark ? DARK : LIGHT) } as Flavor;
  const base = layers('protomaps', flavor, { lang: 'es' }) as LayerSpecification[];
  // Points of interest from the basemap compete with our own markers: keep only a few big ones.
  for (const l of base) {
    if (l.id === 'pois') (l as { filter?: unknown }).filter = ['all', ['in', ['get', 'kind'], ['literal', ['airport', 'aerodrome', 'hospital', 'national_park', 'stadium', 'train_station', 'university']]], ['>=', ['zoom'], ['get', 'min_zoom']]];
  }
  const firstLabel = base.findIndex((l) => l.type === 'symbol');
  const hill: LayerSpecification[] = relief
    ? [{
        id: 'hillshade', type: 'hillshade', source: 'terrain',
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 5, 0.42, 10, 0.32, 13, 0.18],
          'hillshade-shadow-color': dark ? 'rgba(0,0,0,0.55)' : 'rgba(92,84,70,0.38)',
          'hillshade-highlight-color': dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)',
          'hillshade-accent-color': dark ? 'rgba(0,0,0,0.3)' : 'rgba(110,100,85,0.25)',
          'hillshade-illumination-anchor': 'viewport',
        },
      } as LayerSpecification]
    : [];
  const all = [...base.slice(0, firstLabel), ...hill, ...base.slice(firstLabel)];
  return {
    version: 8,
    glyphs: `${ORIGIN}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ORIGIN}/map/sprites/${dark ? 'dark' : 'light'}`,
    sources: {
      protomaps: {
        type: 'vector', url: TILES,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
      terrain: {
        type: 'raster-dem', url: TERRAIN, encoding: 'terrarium', tileSize: 512,
        attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
      },
    },
    layers: all,
  };
}
