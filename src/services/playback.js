import * as jellyfinApi from './jellyfinApi';
import {getJellyfinDeviceProfile} from './deviceProfile';

let currentPlaySession = null;
let progressInterval = null;

export const getPlaybackUrl = async (itemId, startPositionTicks = 0, options = {}) => {
	const deviceProfile = await getJellyfinDeviceProfile();

	const playbackInfo = await jellyfinApi.api.getPlaybackInfo(itemId, {
		DeviceProfile: deviceProfile,
		StartTimeTicks: startPositionTicks,
		AutoOpenLiveStream: true,
		EnableDirectPlay: true,
		EnableDirectStream: true,
		EnableTranscoding: true,
		AudioStreamIndex: options.audioStreamIndex,
		SubtitleStreamIndex: options.subtitleStreamIndex,
		MaxStreamingBitrate: options.maxBitrate
	});

	if (!playbackInfo.MediaSources?.length) {
		throw new Error('No playable media source found');
	}

	const mediaSource = playbackInfo.MediaSources[0];
	currentPlaySession = {
		itemId,
		playSessionId: playbackInfo.PlaySessionId,
		mediaSourceId: mediaSource.Id,
		startPositionTicks,
		mediaSource
	};

	let url;
	if (mediaSource.SupportsDirectPlay && mediaSource.Path) {
		url = `${jellyfinApi.getServerUrl()}/Videos/${itemId}/stream?Static=true&MediaSourceId=${mediaSource.Id}&api_key=${playbackInfo.PlaySessionId}`;
	} else if (mediaSource.SupportsDirectStream) {
		url = `${jellyfinApi.getServerUrl()}${mediaSource.DirectStreamUrl}`;
	} else if (mediaSource.TranscodingUrl) {
		url = `${jellyfinApi.getServerUrl()}${mediaSource.TranscodingUrl}`;
	} else {
		throw new Error('No playback URL available');
	}

	return {
		url,
		playSessionId: playbackInfo.PlaySessionId,
		mediaSourceId: mediaSource.Id,
		mediaSource,
		runTimeTicks: mediaSource.RunTimeTicks,
		audioStreams: extractAudioStreams(mediaSource),
		subtitleStreams: extractSubtitleStreams(mediaSource),
		chapters: mediaSource.Chapters || []
	};
};

const extractAudioStreams = (mediaSource) => {
	if (!mediaSource.MediaStreams) return [];
	return mediaSource.MediaStreams
		.filter(s => s.Type === 'Audio')
		.map(s => ({
			index: s.Index,
			codec: s.Codec,
			language: s.Language || 'Unknown',
			displayTitle: s.DisplayTitle || `${s.Language || 'Unknown'} (${s.Codec})`,
			channels: s.Channels,
			isDefault: s.IsDefault
		}));
};

const extractSubtitleStreams = (mediaSource) => {
	if (!mediaSource.MediaStreams) return [];
	return mediaSource.MediaStreams
		.filter(s => s.Type === 'Subtitle')
		.map(s => ({
			index: s.Index,
			codec: s.Codec,
			language: s.Language || 'Unknown',
			displayTitle: s.DisplayTitle || s.Language || 'Unknown',
			isExternal: s.IsExternal,
			isForced: s.IsForced,
			isDefault: s.IsDefault,
			deliveryUrl: s.DeliveryUrl ? `${jellyfinApi.getServerUrl()}${s.DeliveryUrl}` : null
		}));
};

export const getSubtitleUrl = (subtitleStream) => {
	if (!subtitleStream || !currentPlaySession) return null;
	if (subtitleStream.deliveryUrl) return subtitleStream.deliveryUrl;

	const {itemId, mediaSourceId, playSessionId} = currentPlaySession;
	return `${jellyfinApi.getServerUrl()}/Videos/${itemId}/${mediaSourceId}/Subtitles/${subtitleStream.index}/Stream.vtt?api_key=${playSessionId}`;
};

export const getIntroMarkers = async (itemId) => {
	try {
		const item = await jellyfinApi.api.getItem(itemId);
		if (item.Chapters) {
			const introChapter = item.Chapters.find(c =>
				c.Name?.toLowerCase().includes('intro') ||
				c.MarkerType === 'IntroStart'
			);
			const outroChapter = item.Chapters.find(c =>
				c.Name?.toLowerCase().includes('credit') ||
				c.MarkerType === 'Credits'
			);
			return {
				introStart: introChapter?.StartPositionTicks || null,
				introEnd: introChapter ? (item.Chapters[item.Chapters.indexOf(introChapter) + 1]?.StartPositionTicks || null) : null,
				creditsStart: outroChapter?.StartPositionTicks || null
			};
		}
	} catch (e) {
		// Intro markers not available
	}
	return {introStart: null, introEnd: null, creditsStart: null};
};

export const getNextEpisode = async (item) => {
	if (item.Type !== 'Episode' || !item.SeriesId) return null;
	try {
		const result = await jellyfinApi.api.getNextEpisode(item.SeriesId, item.Id);
		return result.Items?.[0] || null;
	} catch (e) {
		return null;
	}
};

export const reportStart = async (positionTicks = 0) => {
	if (!currentPlaySession) return;

	await jellyfinApi.api.reportPlaybackStart({
		ItemId: currentPlaySession.itemId,
		PlaySessionId: currentPlaySession.playSessionId,
		MediaSourceId: currentPlaySession.mediaSourceId,
		PositionTicks: positionTicks,
		CanSeek: true,
		IsPaused: false,
		PlayMethod: 'DirectPlay'
	});
};

export const reportProgress = async (positionTicks, isPaused = false) => {
	if (!currentPlaySession) return;

	await jellyfinApi.api.reportPlaybackProgress({
		ItemId: currentPlaySession.itemId,
		PlaySessionId: currentPlaySession.playSessionId,
		MediaSourceId: currentPlaySession.mediaSourceId,
		PositionTicks: positionTicks,
		CanSeek: true,
		IsPaused: isPaused
	});
};

export const reportStop = async (positionTicks) => {
	if (!currentPlaySession) return;

	stopProgressReporting();

	await jellyfinApi.api.reportPlaybackStopped({
		ItemId: currentPlaySession.itemId,
		PlaySessionId: currentPlaySession.playSessionId,
		MediaSourceId: currentPlaySession.mediaSourceId,
		PositionTicks: positionTicks
	});

	currentPlaySession = null;
};

export const startProgressReporting = (getPositionTicks, intervalMs = 10000) => {
	stopProgressReporting();

	progressInterval = setInterval(async () => {
		const ticks = getPositionTicks();
		if (ticks !== null) {
			await reportProgress(ticks, false);
		}
	}, intervalMs);
};

export const stopProgressReporting = () => {
	if (progressInterval) {
		clearInterval(progressInterval);
		progressInterval = null;
	}
};

export const getCurrentSession = () => currentPlaySession;
