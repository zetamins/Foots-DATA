/**
 * Static capital-city coordinates for common footballing nations, used only
 * for a rough country-to-country travel distance -- no live geocoding
 * service was usable (Nominatim, Photon, and geocode.maps.co all disallow
 * their search endpoints in robots.txt, and this project has held the line
 * on explicit disallows throughout, even where a documented usage policy
 * separately claims to permit rate-limited access). This table is shipped
 * data, not scraped at request time, so no compliance question applies to
 * it. Deliberately not exhaustive -- covers nations that actually show up
 * as team/venue countries across the sources this tool uses. Unlisted
 * countries just leave the distance null rather than guessing.
 */
const COUNTRY_COORDS: Record<string, { lat: number; lon: number }> = {
  England: { lat: 51.5072, lon: -0.1276 },
  Scotland: { lat: 55.9533, lon: -3.1883 },
  Wales: { lat: 51.4816, lon: -3.1791 },
  "Northern Ireland": { lat: 54.5973, lon: -5.9301 },
  Ireland: { lat: 53.3498, lon: -6.2603 },
  Spain: { lat: 40.4168, lon: -3.7038 },
  Portugal: { lat: 38.7223, lon: -9.1393 },
  France: { lat: 48.8566, lon: 2.3522 },
  Germany: { lat: 52.52, lon: 13.405 },
  Italy: { lat: 41.9028, lon: 12.4964 },
  Netherlands: { lat: 52.3676, lon: 4.9041 },
  Belgium: { lat: 50.8503, lon: 4.3517 },
  Switzerland: { lat: 46.948, lon: 7.4474 },
  Austria: { lat: 48.2082, lon: 16.3738 },
  Poland: { lat: 52.2297, lon: 21.0122 },
  "Czech Republic": { lat: 50.0755, lon: 14.4378 },
  Turkey: { lat: 39.9334, lon: 32.8597 },
  Greece: { lat: 37.9838, lon: 23.7275 },
  Croatia: { lat: 45.815, lon: 15.9819 },
  Serbia: { lat: 44.7866, lon: 20.4489 },
  Ukraine: { lat: 50.4501, lon: 30.5234 },
  Russia: { lat: 55.7558, lon: 37.6173 },
  Denmark: { lat: 55.6761, lon: 12.5683 },
  Sweden: { lat: 59.3293, lon: 18.0686 },
  Norway: { lat: 59.9139, lon: 10.7522 },
  Finland: { lat: 60.1699, lon: 24.9384 },
  Romania: { lat: 44.4268, lon: 26.1025 },
  Hungary: { lat: 47.4979, lon: 19.0402 },
  Slovakia: { lat: 48.1486, lon: 17.1077 },
  Slovenia: { lat: 46.0569, lon: 14.5058 },
  Bulgaria: { lat: 42.6977, lon: 23.3219 },
  "Bosnia and Herzegovina": { lat: 43.8563, lon: 18.4131 },
  Cyprus: { lat: 35.1856, lon: 33.3823 },
  Israel: { lat: 31.7683, lon: 35.2137 },
  Qatar: { lat: 25.2854, lon: 51.531 },
  "Saudi Arabia": { lat: 24.7136, lon: 46.6753 },
  "United Arab Emirates": { lat: 24.4539, lon: 54.3773 },
  Egypt: { lat: 30.0444, lon: 31.2357 },
  Morocco: { lat: 33.9716, lon: -6.8498 },
  Algeria: { lat: 36.7538, lon: 3.0588 },
  Tunisia: { lat: 36.8065, lon: 10.1815 },
  Nigeria: { lat: 9.0765, lon: 7.3986 },
  Senegal: { lat: 14.7167, lon: -17.4677 },
  Ghana: { lat: 5.6037, lon: -0.187 },
  "South Africa": { lat: -25.7461, lon: 28.1881 },
  USA: { lat: 38.9072, lon: -77.0369 },
  "United States of America": { lat: 38.9072, lon: -77.0369 },
  Canada: { lat: 45.4215, lon: -75.6972 },
  Mexico: { lat: 19.4326, lon: -99.1332 },
  Brazil: { lat: -15.8267, lon: -47.9218 },
  Argentina: { lat: -34.6037, lon: -58.3816 },
  Uruguay: { lat: -34.9011, lon: -56.1645 },
  Paraguay: { lat: -25.2637, lon: -57.5759 },
  Chile: { lat: -33.4489, lon: -70.6693 },
  Colombia: { lat: 4.711, lon: -74.0721 },
  Peru: { lat: -12.0464, lon: -77.0428 },
  Ecuador: { lat: -0.1807, lon: -78.4678 },
  Bolivia: { lat: -16.5, lon: -68.15 },
  Venezuela: { lat: 10.4806, lon: -66.9036 },
  Japan: { lat: 35.6762, lon: 139.6503 },
  "South Korea": { lat: 37.5665, lon: 126.978 },
  China: { lat: 39.9042, lon: 116.4074 },
  "People's Republic of China": { lat: 39.9042, lon: 116.4074 },
  India: { lat: 28.6139, lon: 77.209 },
  Australia: { lat: -35.2809, lon: 149.13 },
  "New Zealand": { lat: -41.2865, lon: 174.7762 },
  Iran: { lat: 35.6892, lon: 51.389 },
  Iraq: { lat: 33.3152, lon: 44.3661 },
  Jordan: { lat: 31.9539, lon: 35.9106 },
};

function normalizeCountry(name: string): string {
  return name.trim();
}

/** Haversine great-circle distance in km between two lat/lon points. */
function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Rough country-to-country distance in km, or null if either country isn't in the static table. */
export function countryDistanceKm(countryA: string, countryB: string): number | null {
  const a = COUNTRY_COORDS[normalizeCountry(countryA)];
  const b = COUNTRY_COORDS[normalizeCountry(countryB)];
  if (!a || !b) return null;
  return haversineKm(a, b);
}
