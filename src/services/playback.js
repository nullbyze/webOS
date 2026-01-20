import * as jellyfinApi from './jellyfinApi';
import {getJellyfinDeviceProfile} from './deviceProfile';

let currentPlaySession = null;
let progressInterval = null;

export const getPlaybackUrl = async (itemId, startPositionTicks = 0) => {
	const deviceProfile = await getJellyfinDeviceProfile();

	const playbackInfo = await jellyfinApi.api.getPlaybackInfo(itemId, {
		DeviceProfile: deviceProfile,
		StartTimeTicks: startPositionTicks,
		AutoOpenLiveStream: true,
		EnableDirectPlay: true,
		EnableDirectStream: true,
		EnableTranscoding: true
	});

	if (!playbackInfo.MediaSources?.length) {
		throw new Error('No playable media source found');
	}

	const mediaSource = playbackInfo.MediaSources[0];
	currentPlaySession = {
		itemId,
		playSessionId: playbackInfo.PlaySessionId,
		mediaSourceId: mediaSource.Id,
		startPositionTicks
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
		runTimeTicks: mediaSource.RunTimeTicks
	};
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
