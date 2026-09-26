export interface LatLng {
    lat: number;
    lon: number;
}
export function distanceMiles(a: LatLng, b: LatLng) { const d = Math.PI / 180, lat = (b.lat - a.lat) * d, lon = (b.lon - a.lon) * d; const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(lon / 2) ** 2; return 3958.7613 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h))); }
