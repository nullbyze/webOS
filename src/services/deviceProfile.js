let cachedCapabilities = null;

export const getDeviceCapabilities = async () => {
	if (cachedCapabilities) return cachedCapabilities;

	let deviceInfoData = {};
	let configData = {};

	try {
		const deviceInfo = await import('@enact/webos/deviceInfo');
		deviceInfoData = await new Promise(resolve => deviceInfo.default(resolve));
	} catch (e) {
		// Not on webOS
	}

	try {
		const LS2Request = (await import('@enact/webos/LS2Request')).default;
		configData = await new Promise((resolve) => {
			new LS2Request().send({
				service: 'luna://com.webos.service.config',
				method: 'getConfigs',
				parameters: {
					configNames: [
						'tv.model.modelName',
						'tv.config.supportDolbyHDRContents',
						'tv.model.supportHDR',
						'tv.hw.supportCodecH265',
						'tv.hw.supportCodecAV1',
						'tv.hw.supportCodecVP9',
						'tv.hw.panelResolution',
						'tv.hw.ddrSize',
						'tv.conti.supportDolbyAtmos',
						'tv.config.supportDolbyAtmos'
					]
				},
				onSuccess: resolve,
				onFailure: () => resolve({configs: {}})
			});
		});
	} catch (e) {
		// Not on webOS
	}

	const cfg = configData.configs || {};
	const webosVersion = parseFloat(deviceInfoData.sdkVersion) || 4;

	cachedCapabilities = {
		modelName: deviceInfoData.modelName || cfg['tv.model.modelName'] || 'Unknown',
		sdkVersion: deviceInfoData.sdkVersion || '0',
		webosVersion,
		screenWidth: deviceInfoData.screenWidth || 1920,
		screenHeight: deviceInfoData.screenHeight || 1080,
		uhd: cfg['tv.hw.panelResolution'] === 'UD' || deviceInfoData.uhd || false,
		uhd8K: cfg['tv.hw.panelResolution'] === '8K' || deviceInfoData.uhd8K || false,
		hdr10: cfg['tv.model.supportHDR'] === true,
		dolbyVision: cfg['tv.config.supportDolbyHDRContents'] === true,
		dolbyAtmos: cfg['tv.conti.supportDolbyAtmos'] === true || cfg['tv.config.supportDolbyAtmos'] === true,
		hevc: cfg['tv.hw.supportCodecH265'] !== false,
		av1: cfg['tv.hw.supportCodecAV1'] === true,
		vp9: cfg['tv.hw.supportCodecVP9'] === true || webosVersion >= 5,
		ddrSize: cfg['tv.hw.ddrSize'] || 0
	};

	return cachedCapabilities;
};

export const getJellyfinDeviceProfile = async () => {
	const caps = await getDeviceCapabilities();

	const videoCodecs = ['h264'];
	if (caps.hevc) videoCodecs.push('hevc');
	if (caps.vp9) videoCodecs.push('vp9');
	if (caps.av1) videoCodecs.push('av1');

	const audioCodecs = ['aac', 'mp3', 'ac3', 'eac3', 'flac', 'opus', 'vorbis'];
	if (caps.dolbyAtmos) {
		audioCodecs.push('truehd');
	}

	const maxBitrate = caps.uhd8K ? 200000000 : caps.uhd ? 120000000 : 80000000;

	return {
		MaxStreamingBitrate: maxBitrate,
		MaxStaticBitrate: maxBitrate,
		MusicStreamingTranscodingBitrate: 384000,

		DirectPlayProfiles: [
			{
				Container: 'mp4,m4v,mkv,webm,mov',
				Type: 'Video',
				VideoCodec: videoCodecs.join(','),
				AudioCodec: audioCodecs.join(',')
			},
			{
				Container: 'mp3,flac,aac,m4a,ogg,opus,wav',
				Type: 'Audio'
			}
		],

		TranscodingProfiles: [
			{
				Container: 'ts',
				Type: 'Video',
				AudioCodec: 'aac,ac3,eac3',
				VideoCodec: caps.hevc ? 'hevc,h264' : 'h264',
				Context: 'Streaming',
				Protocol: 'hls',
				MaxAudioChannels: caps.dolbyAtmos ? '8' : '6',
				MinSegments: '1',
				BreakOnNonKeyFrames: true
			},
			{
				Container: 'mp4',
				Type: 'Video',
				AudioCodec: 'aac,ac3',
				VideoCodec: 'h264',
				Context: 'Static'
			},
			{
				Container: 'mp3',
				Type: 'Audio',
				AudioCodec: 'mp3',
				Context: 'Streaming',
				Protocol: 'http'
			}
		],

		CodecProfiles: [
			{
				Type: 'Video',
				Codec: 'h264',
				Conditions: [
					{
						Condition: 'NotEquals',
						Property: 'IsAnamorphic',
						Value: 'true',
						IsRequired: false
					},
					{
						Condition: 'LessThanEqual',
						Property: 'VideoLevel',
						Value: caps.uhd ? '51' : '41',
						IsRequired: false
					}
				]
			},
			{
				Type: 'Video',
				Codec: 'hevc',
				Conditions: [
					{
						Condition: 'LessThanEqual',
						Property: 'VideoLevel',
						Value: caps.uhd ? '153' : '120',
						IsRequired: false
					}
				]
			}
		],

		SubtitleProfiles: [
			{Format: 'srt', Method: 'External'},
			{Format: 'ass', Method: 'External'},
			{Format: 'ssa', Method: 'External'},
			{Format: 'vtt', Method: 'External'},
			{Format: 'sub', Method: 'External'},
			{Format: 'smi', Method: 'External'},
			{Format: 'pgs', Method: 'Embed'},
			{Format: 'dvdsub', Method: 'Embed'}
		],

		ResponseProfiles: [
			{
				Type: 'Video',
				Container: 'mkv',
				MimeType: 'video/x-matroska'
			}
		]
	};
};
