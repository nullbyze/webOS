const APP_NAME = 'Moonfin for webOS';
const APP_VERSION = '2.0.0';

let deviceId = null;
let currentServer = null;
let currentUser = null;
let accessToken = null;

export const setServer = (serverUrl) => {
	currentServer = serverUrl.replace(/\/+$/, '');
};

export const setAuth = (userId, token) => {
	currentUser = userId;
	accessToken = token;
};

export const getAuthHeader = () => {
	let header = `MediaBrowser Client="${APP_NAME}", Device="LG Smart TV", DeviceId="${deviceId}", Version="${APP_VERSION}"`;
	if (accessToken) {
		header += `, Token="${accessToken}"`;
	}
	return header;
};

export const initDeviceId = async () => {
	try {
		const {getFromStorage, saveToStorage} = await import('./storage');
		const stored = await getFromStorage('_deviceId');
		if (stored) {
			deviceId = stored;
			return deviceId;
		}
	} catch (e) {
		// Storage not available
	}

	deviceId = btoa([navigator.userAgent, Date.now()].join('|')).replace(/=/g, '1');

	try {
		const {saveToStorage} = await import('./storage');
		await saveToStorage('_deviceId', deviceId);
	} catch (e) {
		// Storage not available
	}

	return deviceId;
};

export const getServerUrl = () => currentServer;
export const getUserId = () => currentUser;

const request = async (endpoint, options = {}) => {
	const url = `${currentServer}${endpoint}`;

	const response = await fetch(url, {
		method: options.method || 'GET',
		headers: {
			'X-Emby-Authorization': getAuthHeader(),
			'Content-Type': 'application/json',
			...options.headers
		},
		body: options.body ? JSON.stringify(options.body) : undefined
	});

	if (!response.ok) {
		const error = new Error(`API Error: ${response.status}`);
		error.status = response.status;
		throw error;
	}

	if (response.status === 204) {
		return null;
	}

	return response.json();
};

export const api = {
	getPublicInfo: () => request('/System/Info/Public'),

	authenticateByName: (username, password) => request('/Users/AuthenticateByName', {
		method: 'POST',
		body: {Username: username, Pw: password}
	}),

	getLibraries: () => request(`/Users/${currentUser}/Views`),

	getItems: (params = {}) => {
		const query = new URLSearchParams(params).toString();
		return request(`/Users/${currentUser}/Items?${query}`);
	},

	getItem: (itemId) => request(`/Users/${currentUser}/Items/${itemId}`),

	getLatest: (libraryId, limit = 20) =>
		request(`/Users/${currentUser}/Items/Latest?ParentId=${libraryId}&Limit=${limit}`),

	getResumeItems: (limit = 12) =>
		request(`/Users/${currentUser}/Items/Resume?Limit=${limit}&MediaTypes=Video`),

	getNextUp: (limit = 24) =>
		request(`/Shows/NextUp?UserId=${currentUser}&Limit=${limit}`),

	getPlaybackInfo: (itemId, body = {}) => request(`/Items/${itemId}/PlaybackInfo`, {
		method: 'POST',
		body: {UserId: currentUser, ...body}
	}),

	reportPlaybackStart: (data) => request('/Sessions/Playing', {
		method: 'POST',
		body: data
	}),

	reportPlaybackProgress: (data) => request('/Sessions/Playing/Progress', {
		method: 'POST',
		body: data
	}),

	reportPlaybackStopped: (data) => request('/Sessions/Playing/Stopped', {
		method: 'POST',
		body: data
	}),

	search: (query, limit = 24) =>
		request(`/Users/${currentUser}/Items?searchTerm=${encodeURIComponent(query)}&Limit=${limit}&Recursive=true&IncludeItemTypes=Movie,Series,Episode&Fields=PrimaryImageAspectRatio,ProductionYear`),

	getSeasons: (seriesId) =>
		request(`/Shows/${seriesId}/Seasons?UserId=${currentUser}&Fields=PrimaryImageAspectRatio`),

	getEpisodes: (seriesId, seasonId) =>
		request(`/Shows/${seriesId}/Episodes?UserId=${currentUser}&SeasonId=${seasonId}&Fields=PrimaryImageAspectRatio,Overview`),

	getSimilar: (itemId, limit = 12) =>
		request(`/Items/${itemId}/Similar?UserId=${currentUser}&Limit=${limit}&Fields=PrimaryImageAspectRatio,ProductionYear`),

	getGenres: (libraryId) =>
		request(`/Genres?UserId=${currentUser}&ParentId=${libraryId}&SortBy=SortName`),

	getItemsByGenre: (genreId, libraryId, limit = 50) =>
		request(`/Users/${currentUser}/Items?GenreIds=${genreId}&ParentId=${libraryId}&Limit=${limit}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=PrimaryImageAspectRatio,ProductionYear`),

	getPerson: (personId) =>
		request(`/Users/${currentUser}/Items/${personId}`),

	getItemsByPerson: (personId, limit = 50) =>
		request(`/Users/${currentUser}/Items?PersonIds=${personId}&Recursive=true&IncludeItemTypes=Movie,Series&Limit=${limit}&Fields=PrimaryImageAspectRatio,ProductionYear`),

	getFavorites: (limit = 50) =>
		request(`/Users/${currentUser}/Items?IsFavorite=true&Recursive=true&Limit=${limit}&Fields=PrimaryImageAspectRatio,ProductionYear`),

	setFavorite: (itemId, isFavorite) => request(`/Users/${currentUser}/FavoriteItems/${itemId}`, {
		method: isFavorite ? 'POST' : 'DELETE'
	}),

	setWatched: (itemId, watched) => request(`/Users/${currentUser}/PlayedItems/${itemId}`, {
		method: watched ? 'POST' : 'DELETE'
	}),

	getIntros: (itemId) =>
		request(`/Users/${currentUser}/Items/${itemId}/Intros`),

	getAdditionalParts: (itemId) =>
		request(`/Videos/${itemId}/AdditionalParts?UserId=${currentUser}`),

	getSpecialFeatures: (itemId) =>
		request(`/Users/${currentUser}/Items/${itemId}/SpecialFeatures`),

	getLiveTvChannels: () =>
		request(`/LiveTv/Channels?UserId=${currentUser}&EnableFavoriteSorting=true`),

	getLiveTvPrograms: (channelId) =>
		request(`/LiveTv/Programs?UserId=${currentUser}&ChannelIds=${channelId}&EnableTotalRecordCount=false`),

	getLiveTvRecordings: () =>
		request(`/LiveTv/Recordings?UserId=${currentUser}`),

	getMediaStreams: (itemId) =>
		request(`/Items/${itemId}?Fields=MediaStreams`)
};
