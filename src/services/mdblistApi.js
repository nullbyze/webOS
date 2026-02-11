/**
 * MDBList ratings API service.
 * Fetches ratings from the Moonfin plugin's MDBList proxy endpoint
 * and caches them client-side.
 */
import {getAuthHeader, getServerUrl} from './jellyfinApi';

// In-memory cache: key = "type:tmdbId" => { ratings, fetchedAt }
const cache = {};
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Rating source metadata with icon filenames served from Moonfin/Assets/
export const RATING_SOURCES = {
	imdb:           {name: 'IMDb',            iconFile: 'imdb.png',            color: '#F5C518', textColor: '#000'},
	tmdb:           {name: 'TMDb',            iconFile: 'tmdb.png',            color: '#01D277', textColor: '#fff'},
	trakt:          {name: 'Trakt',           iconFile: 'trakt.png',           color: '#ED1C24', textColor: '#fff'},
	tomatoes:       {name: 'Rotten Tomatoes', iconFile: 'rt-fresh.png',        color: '#FA320A', textColor: '#fff'},
	popcorn:        {name: 'RT Audience',     iconFile: 'rt-audience-up.png',  color: '#FA320A', textColor: '#fff'},
	metacritic:     {name: 'Metacritic',      iconFile: 'metacritic.png',      color: '#FFCC34', textColor: '#000'},
	metacriticuser: {name: 'Metacritic User', iconFile: 'metacritic-user.png', color: '#00CE7A', textColor: '#000'},
	letterboxd:     {name: 'Letterboxd',      iconFile: 'letterboxd.png',      color: '#00E054', textColor: '#fff'},
	rogerebert:     {name: 'RogerEbert',      iconFile: 'rogerebert.png',      color: '#E50914', textColor: '#fff'},
	myanimelist:    {name: 'MyAnimeList',      iconFile: 'mal.png',            color: '#2E51A2', textColor: '#fff'},
	anilist:        {name: 'AniList',          iconFile: 'anilist.png',         color: '#02A9FF', textColor: '#fff'}
};

// Default sources to show if none configured
const DEFAULT_SOURCES = ['imdb', 'tmdb', 'tomatoes', 'metacritic'];

/**
 * Get the icon URL for a rating source, with special variants based on score.
 */
export const getIconUrl = (baseUrl, source, rating) => {
	const info = RATING_SOURCES[source];
	if (!info) return '';

	const score = rating?.score;

	// Rotten Tomatoes tomatometer variants
	if (source === 'tomatoes' && score != null && score > 0) {
		if (score >= 75) return `${baseUrl}/Moonfin/Assets/rt-certified.png`;
		if (score < 60) return `${baseUrl}/Moonfin/Assets/rt-rotten.png`;
	}

	// RT Audience variants
	if (source === 'popcorn' && score != null && score > 0) {
		if (score >= 90) return `${baseUrl}/Moonfin/Assets/rt-verified.png`;
		if (score < 60) return `${baseUrl}/Moonfin/Assets/rt-audience-down.png`;
	}

	// Metacritic must-play/must-see badge
	if (source === 'metacritic' && score != null && score >= 81) {
		return `${baseUrl}/Moonfin/Assets/metacritic-score.png`;
	}

	return `${baseUrl}/Moonfin/Assets/${info.iconFile}`;
};

/**
 * Returns 'movie' or 'show', or null if unsupported type.
 */
export const getContentType = (item) => {
	if (!item) return null;
	const type = item.Type;
	if (type === 'Movie') return 'movie';
	if (type === 'Series') return 'show';
	if (type === 'Episode' || type === 'Season') return 'show';
	return null;
};

/**
 * Extract TMDb ID from item's ProviderIds.
 */
export const getTmdbId = (item) => {
	if (!item) return null;
	const providerIds = item.ProviderIds;
	if (!providerIds) return null;
	return providerIds.Tmdb || providerIds.tmdb || null;
};

/**
 * Format a rating's value for display.
 */
export const formatRating = (rating) => {
	if (!rating || !rating.source) return null;
	const source = rating.source.toLowerCase();
	const value = rating.value;
	const score = rating.score;

	if (value == null && score == null) return null;

	switch (source) {
		case 'imdb':
			return value != null ? `${Number(value).toFixed(1)}/10` : null;
		case 'tmdb':
			return value != null ? `${Math.round(value)}%` : null;
		case 'trakt':
			return value != null ? `${Math.round(value)}%` : null;
		case 'tomatoes':
		case 'popcorn':
		case 'metacriticuser':
			return score != null ? `${Math.round(score)}%` : null;
		case 'metacritic':
			return value != null ? `${Math.round(value)}` : (score != null ? `${Math.round(score)}` : null);
		case 'letterboxd':
			return value != null ? `${Number(value).toFixed(1)}/5` : null;
		case 'rogerebert':
			return value != null ? `${Number(value).toFixed(1)}/4` : null;
		case 'myanimelist':
		case 'anilist':
			return value != null ? `${Number(value).toFixed(1)}` : null;
		default:
			return score != null ? `${Math.round(score)}%` : null;
	}
};

/**
 * Fetch ratings from the Moonfin MDBList proxy.
 * @param {string} serverUrl - Base server URL
 * @param {Object} item - Jellyfin item object
 * @returns {Promise<Array>} Array of rating objects
 */
export const fetchRatings = async (serverUrl, item) => {
	const contentType = getContentType(item);
	const tmdbId = getTmdbId(item);

	if (!contentType || !tmdbId) return [];

	const cacheKey = `${contentType}:${tmdbId}`;

	// Check client cache
	const cached = cache[cacheKey];
	if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
		return cached.ratings;
	}

	const baseUrl = serverUrl || getServerUrl();
	if (!baseUrl) return [];

	try {
		const url = `${baseUrl}/Moonfin/MdbList/Ratings?type=${encodeURIComponent(contentType)}&tmdbId=${encodeURIComponent(tmdbId)}`;
		const response = await fetch(url, {
			headers: {
				'X-Emby-Authorization': getAuthHeader()
			}
		});

		if (!response.ok) return [];

		const data = await response.json();
		if (data && data.success !== false && data.ratings) {
			// Normalize keys to camelCase
			const ratings = data.ratings.map(r => ({
				source: r.Source || r.source,
				value: r.Value ?? r.value,
				score: r.Score ?? r.score,
				votes: r.Votes ?? r.votes,
				url: r.Url || r.url
			}));
			cache[cacheKey] = {ratings, fetchedAt: Date.now()};
			return ratings;
		}
		return [];
	} catch (err) {
		console.warn('[MDBList] Fetch failed:', err);
		return [];
	}
};

/**
 * Build an array of processed rating objects ready for display.
 * @param {Array} ratings - Raw ratings from API
 * @param {string} serverUrl - Base server URL for icon URLs
 * @param {Array} selectedSources - Which sources to display (defaults to DEFAULT_SOURCES)
 * @returns {Array} Display-ready rating objects
 */
export const buildDisplayRatings = (ratings, serverUrl, selectedSources = DEFAULT_SOURCES) => {
	if (!ratings || ratings.length === 0) return [];

	const result = [];

	for (const source of selectedSources) {
		const rating = ratings.find(r => r.source && r.source.toLowerCase() === source);
		if (!rating) continue;

		const formatted = formatRating(rating);
		if (!formatted) continue;

		const info = RATING_SOURCES[source] || {name: source, iconFile: '', color: '#666', textColor: '#fff'};
		const iconUrl = getIconUrl(serverUrl, source, rating);

		result.push({
			source,
			name: info.name,
			formatted,
			iconUrl,
			color: info.color,
			textColor: info.textColor,
			score: rating.score,
			value: rating.value
		});
	}

	return result;
};
