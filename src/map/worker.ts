// Vite copies MapLibre's worker as an asset; tell MapLibre where it is (its own guess breaks when bundled).
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);
export const WORKER_URL = workerUrl;
