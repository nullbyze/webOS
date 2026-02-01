// webOS Video Service - Luna API interface for hardware video playback

let lunaClient = null;
let isLunaAvailable = false;

export const isWebOS = () => {
	if (typeof window === 'undefined') return false;
	if (typeof window.webOS !== 'undefined') return true;
	const ua = navigator.userAgent.toLowerCase();
	return ua.includes('webos') || ua.includes('web0s');
};

export const getWebOSVersion = () => {
	const ua = navigator.userAgent.toLowerCase();
	const chromeMatch = /chrome\/(\d+)/.exec(ua);
	if (chromeMatch) {
		const chromeVersion = parseInt(chromeMatch[1], 10);
		if (chromeVersion >= 120) return 25;
		if (chromeVersion >= 108) return 24;
		if (chromeVersion >= 94) return 23;
		if (chromeVersion >= 87) return 22;
		if (chromeVersion >= 79) return 6;
		if (chromeVersion >= 68) return 5;
		if (chromeVersion >= 53) return 4;
		if (chromeVersion >= 38) return 3;
		return 2;
	}
	return 4; // Default assumption
};

export const initLunaAPI = async () => {
	if (!isWebOS()) {
		console.log('[webosVideo] Not on webOS platform');
		return false;
	}

	try {
		const LS2Request = (await import('@enact/webos/LS2Request')).default;
		lunaClient = LS2Request;
		isLunaAvailable = true;
		console.log('[webosVideo] Luna API initialized');
		return true;
	} catch (e) {
		console.warn('[webosVideo] Luna API not available:', e.message);
		return false;
	}
};

const lunaCall = (service, method, parameters = {}) => {
	return new Promise((resolve, reject) => {
		if (!lunaClient) {
			reject(new Error('Luna API not initialized'));
			return;
		}

		// eslint-disable-next-line @babel/new-cap
		new lunaClient().send({
			service: `luna://${service}`,
			method,
			parameters,
			onSuccess: resolve,
			onFailure: (err) => reject(new Error(err.errorText || 'Luna call failed'))
		});
	});
};

const getDefaultCapabilities = () => {
	const webosVersion = getWebOSVersion();
	return {
		webosVersion,
		modelName: 'Unknown',
		uhd: true,
		uhd8K: webosVersion >= 5,
		oled: false,
		hdr10: webosVersion >= 4,
		hdr10Plus: false,
		hlg: webosVersion >= 4,
		dolbyVision: false,
		dolbyAtmos: false,
		hevc: webosVersion >= 4,
		av1: webosVersion >= 5,
		vp9: webosVersion >= 4,
		dts: true,
		ac3: true,
		eac3: true,
		truehd: false,
		mp4: true,
		m4v: true,
		ts: true,
		mov: true,
		avi: true,
		'3gp': true,
		mpg: true,
		vob: true,
		asf: true,
		wmv: true,
		mkv: webosVersion >= 4,
		webm: webosVersion >= 5,
		nativeHls: true,
		nativeHlsFmp4: webosVersion >= 5,
		hlsAc3: webosVersion >= 5,
		hlsByteRange: webosVersion >= 4
	};
};

export const getMediaCapabilities = async () => {
	if (!isLunaAvailable) {
		return getDefaultCapabilities();
	}

	try {
		const result = await lunaCall('com.webos.service.config', 'getConfigs', {
			configNames: [
				'tv.model.modelName',
				'tv.config.supportDolbyHDRContents',
				'tv.model.supportHDR',
				'tv.hw.supportCodecH265',
				'tv.hw.supportCodecAV1',
				'tv.hw.supportCodecVP9',
				'tv.hw.panelResolution',
				'tv.conti.supportDolbyAtmos',
				'tv.config.supportDolbyAtmos',
				'tv.model.oled',
				'tv.hw.ddrSize',
				'tv.nvm.support.edid.hdr10plus',
				'tv.config.supportHLG'
			]
		});

		const cfg = result.configs || {};
		const webosVersion = getWebOSVersion();

		return {
			webosVersion,
			modelName: cfg['tv.model.modelName'] || 'Unknown',
			uhd: cfg['tv.hw.panelResolution'] === 'UD' || cfg['tv.hw.panelResolution'] === '8K',
			uhd8K: cfg['tv.hw.panelResolution'] === '8K',
			oled: cfg['tv.model.oled'] === true,
			hdr10: cfg['tv.model.supportHDR'] === true,
			hdr10Plus: cfg['tv.nvm.support.edid.hdr10plus'] === true,
			hlg: cfg['tv.config.supportHLG'] === true,
			dolbyVision: cfg['tv.config.supportDolbyHDRContents'] === true,
			dolbyAtmos: cfg['tv.conti.supportDolbyAtmos'] === true || cfg['tv.config.supportDolbyAtmos'] === true,
			// Video codecs - use Luna API if available, fall back to version-based
			hevc: cfg['tv.hw.supportCodecH265'] !== false && webosVersion >= 4,
			av1: cfg['tv.hw.supportCodecAV1'] === true || (cfg['tv.hw.supportCodecAV1'] !== false && webosVersion >= 5),
			vp9: cfg['tv.hw.supportCodecVP9'] === true || webosVersion >= 4,
			// Audio codecs
			dts: true, // All versions support DTS in MKV
			ac3: true,
			eac3: true,
			truehd: cfg['tv.conti.supportDolbyAtmos'] === true,
			// Containers
			mp4: true,
			m4v: true,
			ts: true,
			mov: true,
			avi: true,
			'3gp': true,
			mpg: true,
			vob: true,
			asf: true,
			wmv: webosVersion < 25 || cfg['tv.hw.supportCodecVC1'] !== false, // webOS 25 model-specific
			mkv: webosVersion >= 4,
			webm: webosVersion >= 5,
			// HLS
			nativeHls: true,
			nativeHlsFmp4: webosVersion >= 5,
			hlsAc3: webosVersion >= 5,
			hlsByteRange: webosVersion >= 4
		};
	} catch (e) {
		console.warn('[webosVideo] Failed to get capabilities:', e.message);
		return getDefaultCapabilities();
	}
};

export const getPlayMethod = (mediaSource, capabilities) => {
	if (!mediaSource) return 'Transcode';

	const container = (mediaSource.Container || '').toLowerCase();
	const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video');
	const audioStream = mediaSource.MediaStreams?.find(s => s.Type === 'Audio');

	// Build supported video codecs list
	const videoCodec = (videoStream?.Codec || '').toLowerCase();
	const supportedVideoCodecs = ['h264', 'avc', 'mpeg4', 'mpeg2', 'mpeg1'];
	if (capabilities.hevc) supportedVideoCodecs.push('hevc', 'h265', 'hev1', 'hvc1');
	if (capabilities.av1) supportedVideoCodecs.push('av1', 'av01');
	if (capabilities.vp9) supportedVideoCodecs.push('vp9');
	supportedVideoCodecs.push('vp8'); // VP8 supported in MKV on webOS 4+
	if (capabilities.dolbyVision) supportedVideoCodecs.push('dvhe', 'dvh1', 'dovi');

	// Build supported audio codecs list
	const audioCodec = (audioStream?.Codec || '').toLowerCase();
	const supportedAudioCodecs = ['aac', 'mp3', 'mp2', 'mp1', 'flac', 'pcm', 'lpcm', 'wav'];
	if (capabilities.ac3) supportedAudioCodecs.push('ac3', 'dolby');
	if (capabilities.eac3) supportedAudioCodecs.push('eac3', 'ec3');
	if (capabilities.dts) supportedAudioCodecs.push('dts', 'dca', 'dts-hd', 'dtshd');
	if (capabilities.truehd) supportedAudioCodecs.push('truehd', 'mlp');
	// Opus only on webOS 24+
	if (capabilities.webosVersion >= 24) supportedAudioCodecs.push('opus');
	supportedAudioCodecs.push('vorbis', 'wma', 'amr', 'amrnb', 'amrwb');

	// Build supported containers list (based on LG documentation)
	const supportedContainers = ['mp4', 'm4v', 'mov', 'ts', 'mpegts', 'mts', 'm2ts', 'avi', '3gp', '3g2', 'mpg', 'mpeg', 'vob', 'dat'];
	if (capabilities.mkv) supportedContainers.push('mkv', 'matroska');
	if (capabilities.webm) supportedContainers.push('webm');
	if (capabilities.asf) supportedContainers.push('asf');
	if (capabilities.wmv) supportedContainers.push('wmv');
	if (capabilities.nativeHls) supportedContainers.push('m3u8', 'hls');

	const videoOk = !videoCodec || supportedVideoCodecs.includes(videoCodec);
	const audioOk = !audioCodec || supportedAudioCodecs.includes(audioCodec);
	const containerOk = !container || supportedContainers.includes(container);

	// HDR compatibility check
	let hdrOk = true;
	if (videoStream?.VideoRangeType) {
		const rangeType = videoStream.VideoRangeType.toUpperCase();
		if (rangeType.includes('DOLBY') || rangeType.includes('DV') || rangeType === 'DOVI') {
			// Dolby Vision requires specific hardware support
			hdrOk = capabilities.dolbyVision;
		} else if (rangeType.includes('HDR10+') || rangeType === 'HDR10PLUS') {
			// HDR10+ requires specific hardware support
			hdrOk = capabilities.hdr10Plus || capabilities.hdr10; // Fall back to HDR10
		} else if (rangeType.includes('HDR') || rangeType === 'HDR10') {
			hdrOk = capabilities.hdr10;
		} else if (rangeType.includes('HLG')) {
			hdrOk = capabilities.hlg || capabilities.hdr10; // HLG often works on HDR10 TVs
		}
	}

	// Special check: DTS container restrictions by webOS version
	let dtsContainerOk = true;
	if (audioCodec && (audioCodec === 'dts' || audioCodec === 'dca' || audioCodec.startsWith('dts'))) {
		const webosVersion = capabilities.webosVersion || 4;
		if (webosVersion >= 23) {
			// webOS 23+: DTS in MP4, MOV, MKV, TS (model-specific)
			dtsContainerOk = ['mkv', 'matroska', 'mp4', 'm4v', 'mov', 'ts', 'mpegts', 'mts', 'm2ts'].includes(container);
		} else if (webosVersion >= 5) {
			// webOS 5-22: DTS only in MKV container
			dtsContainerOk = container === 'mkv' || container === 'matroska';
		} else {
			// webOS 4.x: DTS in AVI and MKV
			dtsContainerOk = ['mkv', 'matroska', 'avi'].includes(container);
		}
	}

	console.log('[webosVideo] getPlayMethod check:', {
		container,
		videoCodec,
		audioCodec,
		videoRange: videoStream?.VideoRangeType,
		videoOk,
		audioOk,
		containerOk,
		hdrOk,
		dtsContainerOk,
		supportedContainers,
		supportedVideoCodecs,
		supportedAudioCodecs,
		serverSupportsDirectPlay: mediaSource.SupportsDirectPlay
	});

	if (mediaSource.SupportsDirectPlay && videoOk && audioOk && containerOk && hdrOk && dtsContainerOk) {
		return 'DirectPlay';
	}

	if (mediaSource.SupportsDirectStream && videoOk && containerOk) {
		return 'DirectStream';
	}

	return 'Transcode';
};

export const getMimeType = (container) => {
	const mimeTypes = {
		mp4: 'video/mp4',
		m4v: 'video/mp4',
		mkv: 'video/x-matroska',
		matroska: 'video/x-matroska',
		webm: 'video/webm',
		ts: 'video/mp2t',
		mpegts: 'video/mp2t',
		m2ts: 'video/mp2t',
		mts: 'video/mp2t',
		avi: 'video/x-msvideo',
		mov: 'video/quicktime',
		m3u8: 'application/x-mpegURL',
		mpd: 'application/dash+xml',
		'3gp': 'video/3gpp',
		'3g2': 'video/3gpp2',
		mpg: 'video/mpeg',
		mpeg: 'video/mpeg',
		vob: 'video/mpeg',
		dat: 'video/mpeg',
		asf: 'video/x-ms-asf',
		wmv: 'video/x-ms-wmv'
	};
	return mimeTypes[container?.toLowerCase()] || 'video/mp4';
};

export const setDisplayWindow = async (rect) => {
	if (!isLunaAvailable) return false;

	try {
		await lunaCall('com.webos.service.avoutput', 'video/setDisplayWindow', {
			sourceInput: {
				x: rect.x || 0,
				y: rect.y || 0,
				width: rect.width || 1920,
				height: rect.height || 1080
			},
			outputDestination: {
				x: rect.destX || 0,
				y: rect.destY || 0,
				width: rect.destWidth || 1920,
				height: rect.destHeight || 1080
			}
		});
		return true;
	} catch (e) {
		console.warn('[webosVideo] setDisplayWindow failed:', e.message);
		return false;
	}
};

export const registerAppStateObserver = (onForeground, onBackground) => {
	if (typeof document === 'undefined') return () => {};

	const handleVisibilityChange = () => {
		if (document.hidden) {
			onBackground?.();
		} else {
			onForeground?.();
		}
	};

	document.addEventListener('visibilitychange', handleVisibilityChange);
	document.addEventListener('webOSRelaunch', onForeground);

	return () => {
		document.removeEventListener('visibilitychange', handleVisibilityChange);
		document.removeEventListener('webOSRelaunch', onForeground);
	};
};

export const keepScreenOn = async (enable) => {
	if (!isLunaAvailable) return true;

	try {
		await lunaCall('com.webos.service.power', 'state', {
			state: enable ? 'Active' : 'ActiveStandby'
		});
		return true;
	} catch {
		return true;
	}
};

export const getAudioOutputInfo = async () => {
	if (!isLunaAvailable) return null;

	try {
		const result = await lunaCall('com.webos.service.avoutput', 'audio/getStatus', {});
		return result;
	} catch (e) {
		return null;
	}
};

/**
 * Release hardware video resources per WHATWG spec.
 * Critical on webOS due to limited hardware decoder instances.
 */
export const cleanupVideoElement = (videoElement, options = {}) => {
	if (!videoElement) {
		console.log('[webosVideo] No video element to cleanup');
		return false;
	}

	try {
		console.log('[webosVideo] Cleaning up video element resources');

		if (!videoElement.paused) {
			videoElement.pause();
		}

		// Clear source and call load() to release hardware decoder
		videoElement.removeAttribute('src');
		if (videoElement.srcObject) {
			videoElement.srcObject = null;
		}
		videoElement.load();

		if (options.removeFromDOM && videoElement.parentNode) {
			videoElement.parentNode.removeChild(videoElement);
		}

		console.log('[webosVideo] Video element cleanup complete');
		return true;
	} catch (err) {
		console.error('[webosVideo] Error during video cleanup:', err);
		return false;
	}
};

/**
 * Handle visibility changes for app suspend/resume.
 * Uses webkit prefix for webOS 4.x compatibility.
 */
export const setupVisibilityHandler = (onHidden, onVisible) => {
	let hidden, visibilityChange;

	if (typeof document.hidden !== 'undefined') {
		hidden = 'hidden';
		visibilityChange = 'visibilitychange';
	} else if (typeof document.webkitHidden !== 'undefined') {
		hidden = 'webkitHidden';
		visibilityChange = 'webkitvisibilitychange';
	} else {
		console.warn('[webosVideo] Visibility API not supported');
		return () => {};
	}

	const handleVisibilityChange = () => {
		if (document[hidden]) {
			console.log('[webosVideo] App hidden/suspended - triggering cleanup');
			onHidden?.();
		} else {
			console.log('[webosVideo] App visible - resuming');
			onVisible?.();
		}
	};

	document.addEventListener(visibilityChange, handleVisibilityChange, true);

	// Listen to both variants for maximum compatibility
	const altVisibilityChange = visibilityChange === 'visibilitychange'
		? 'webkitvisibilitychange'
		: 'visibilitychange';

	if (visibilityChange !== altVisibilityChange) {
		document.addEventListener(altVisibilityChange, handleVisibilityChange, true);
	}

	console.log('[webosVideo] Visibility handler registered');

	// Return cleanup function
	return () => {
		document.removeEventListener(visibilityChange, handleVisibilityChange, true);
		document.removeEventListener(altVisibilityChange, handleVisibilityChange, true);
		console.log('[webosVideo] Visibility handler removed');
	};
};

/**
 * Handle webOSRelaunch event (app re-launched while already running).
 */
export const setupWebOSLifecycle = (onRelaunch) => {
	if (!isWebOS()) {
		return () => {};
	}

	const handleRelaunch = (event) => {
		console.log('[webosVideo] webOSRelaunch event received', event?.detail);
		onRelaunch?.(event?.detail);
	};

	document.addEventListener('webOSRelaunch', handleRelaunch, true);
	console.log('[webosVideo] webOS lifecycle handler registered');

	return () => {
		document.removeEventListener('webOSRelaunch', handleRelaunch, true);
		console.log('[webosVideo] webOS lifecycle handler removed');
	};
}

export default {
	isWebOS,
	getWebOSVersion,
	initLunaAPI,
	getMediaCapabilities,
	getPlayMethod,
	getMimeType,
	setDisplayWindow,
	registerAppStateObserver,
	keepScreenOn,
	getAudioOutputInfo,
	cleanupVideoElement,
	setupVisibilityHandler,
	setupWebOSLifecycle
};
