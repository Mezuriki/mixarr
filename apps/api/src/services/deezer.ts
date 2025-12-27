/**
 * Deezer Service
 * 
 * Public Deezer API endpoints (no authentication required).
 * Documentation: https://developers.deezer.com/api
 */

interface DeezerArtist {
  id: number;
  name: string;
  link?: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  radio?: boolean;
  tracklist?: string;
  type?: string;
}

interface DeezerSearchResponse {
  data?: DeezerArtist[];
  total?: number;
  next?: string;
}

interface DeezerChartResponse {
  data: DeezerArtist[];
  total?: number;
}

interface DeezerGenre {
  id: number;
  name: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
}

interface DeezerGenreListResponse {
  data: DeezerGenre[];
}

const DEEZER_API_BASE = 'https://api.deezer.com';

/**
 * Fetch artist image by name (search)
 */
export async function fetchDeezerArtistImage(artistName: string): Promise<string | undefined> {
  try {
    const response = await fetch(
      `${DEEZER_API_BASE}/search/artist?q=${encodeURIComponent(artistName)}`
    );
    if (response.ok) {
      const data = await response.json() as DeezerSearchResponse;
      if (data.data && data.data.length > 0) {
        const artist = data.data[0];
        return artist.picture_xl || artist.picture_big || artist.picture_medium || artist.picture;
      }
    }
  } catch {
    // Ignore image fetch errors
  }
  return undefined;
}

/**
 * Fetch images for multiple artists in parallel
 */
export async function fetchDeezerArtistImages(
  artistNames: string[]
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  
  await Promise.all(
    artistNames.map(async (name) => {
      const imageUrl = await fetchDeezerArtistImage(name);
      if (imageUrl) {
        imageMap.set(name, imageUrl);
      }
    })
  );
  
  return imageMap;
}

/**
 * Get top chart artists (public, no auth required)
 */
export async function getDeezerChartArtists(limit: number = 100): Promise<DeezerArtist[]> {
  const response = await fetch(`${DEEZER_API_BASE}/chart/0/artists?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerChartResponse;
  return data.data || [];
}

/**
 * Get all available genres
 */
export async function getDeezerGenres(): Promise<DeezerGenre[]> {
  const response = await fetch(`${DEEZER_API_BASE}/genre`);
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerGenreListResponse;
  return data.data || [];
}

/**
 * Get artists by genre ID
 */
export async function getDeezerGenreArtists(genreId: number, limit: number = 100): Promise<DeezerArtist[]> {
  const response = await fetch(`${DEEZER_API_BASE}/genre/${genreId}/artists?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerChartResponse;
  return data.data || [];
}

/**
 * Search for artists
 */
export async function searchDeezerArtists(query: string, limit: number = 25): Promise<DeezerArtist[]> {
  const response = await fetch(
    `${DEEZER_API_BASE}/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerSearchResponse;
  return data.data || [];
}

/**
 * Get related artists for an artist ID
 */
export async function getDeezerRelatedArtists(artistId: number, limit: number = 25): Promise<DeezerArtist[]> {
  const response = await fetch(`${DEEZER_API_BASE}/artist/${artistId}/related?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerChartResponse;
  return data.data || [];
}

/**
 * Get artist details by ID
 */
export async function getDeezerArtist(artistId: number): Promise<DeezerArtist | null> {
  const response = await fetch(`${DEEZER_API_BASE}/artist/${artistId}`);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Deezer API error: ${response.status}`);
  }
  return response.json() as Promise<DeezerArtist>;
}
