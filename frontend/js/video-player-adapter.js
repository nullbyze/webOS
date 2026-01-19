// -*- coding: utf-8 -*-

/*
 * Video Player Adapter - Abstraction layer for multiple playback engines
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * Media Error Types
 */
const MediaError = {
    NETWORK_ERROR: 'NetworkError',
    MEDIA_DECODE_ERROR: 'MediaDecodeError',
    MEDIA_NOT_SUPPORTED: 'MediaNotSupported',
    FATAL_HLS_ERROR: 'FatalHlsError',
    SERVER_ERROR: 'ServerError',
    NO_MEDIA_ERROR: 'NoMediaError'
};

/**
 * HLS.js error recovery timing
 */
let recoverDecodingErrorDate;
let recoverSwapAudioCodecDate;

/**
 * Base class for video player adapters
 */
class VideoPlayerAdapter {
    constructor(videoElement) {
        this.videoElement = videoElement;
        this.eventHandlers = {};
    }

    /**
     * Initialize the player
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    /**
     * Load and play a media source
     * @param {string} url - Media URL
     * @param {Object} options - Playback options (mimeType, startPosition, etc.)
     * @returns {Promise<void>}
     */
    async load(url, options = {}) {
        throw new Error('load() must be implemented by subclass');
    }

    /**
     * Play the video
     */
    play() {
        return this.videoElement.play();
    }

    /**
     * Pause the video
     */
    pause() {
        this.videoElement.pause();
    }

    /**
     * Seek to a specific time
     * @param {number} time - Time in seconds
     */
    seek(time) {
        this.videoElement.currentTime = time;
    }

    /**
     * Get current playback time
     * @returns {number} Current time in seconds
     */
    getCurrentTime() {
        return this.videoElement.currentTime;
    }

    /**
     * Get video duration
     * @returns {number} Duration in seconds
     */
    getDuration() {
        return this.videoElement.duration;
    }

    /**
     * Set volume
     * @param {number} volume - Volume level (0-1)
     */
    setVolume(volume) {
        this.videoElement.volume = volume;
    }

    /**
     * Get current volume
     * @returns {number} Volume level (0-1)
     */
    getVolume() {
        return this.videoElement.volume;
    }

    /**
     * Check if video is paused
     * @returns {boolean}
     */
    isPaused() {
        return this.videoElement.paused;
    }

    /**
     * Register event handler
     * @param {string} event - Event name
     * @param {Function} handler - Event handler function
     */
    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);
    }

    /**
     * Emit event to registered handlers
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }

    /**
     * Select audio track
     * @param {number} trackId - Track ID
     */
    selectAudioTrack(trackId) {
        throw new Error('selectAudioTrack() must be implemented by subclass');
    }

    /**
     * Select subtitle track
     * @param {number} trackId - Track ID (use -1 to disable)
     */
    selectSubtitleTrack(trackId) {
        throw new Error('selectSubtitleTrack() must be implemented by subclass');
    }

    /**
     * Get available audio tracks
     * @returns {Array<Object>} Audio tracks
     */
    getAudioTracks() {
        throw new Error('getAudioTracks() must be implemented by subclass');
    }

    /**
     * Get available subtitle tracks
     * @returns {Array<Object>} Subtitle tracks
     */
    getSubtitleTracks() {
        throw new Error('getSubtitleTracks() must be implemented by subclass');
    }

    /**
     * Destroy the player and cleanup resources
     */
    async destroy() {
        this.eventHandlers = {};
    }

    /**
     * Get player name/type
     * @returns {string}
     */
    getName() {
        return 'BaseAdapter';
    }
}

/**
 * Shaka Player Adapter
 */
class ShakaPlayerAdapter extends VideoPlayerAdapter {
    constructor(videoElement) {
        super(videoElement);
        this.player = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Check if Shaka Player is supported
            if (!shaka.Player.isBrowserSupported()) {
                console.log('[ShakaAdapter] Browser not supported');
                return false;
            }

            // Install polyfills
            shaka.polyfill.installAll();

            // Create player instance (use attach method instead of constructor with element)
            this.player = new shaka.Player();
            await this.player.attach(this.videoElement);
            
            // Detect codec support using MediaSource API
            // Test multiple Dolby Vision profiles and variants
            this.codecSupport = {
                h264: this.checkCodecSupport('video/mp4; codecs="avc1.64001f"'),
                hevc: this.checkCodecSupport('video/mp4; codecs="hev1.1.6.L93.B0"'),
                hevcMain10: this.checkCodecSupport('video/mp4; codecs="hev1.2.4.L153.B0"'),
                dolbyVisionP5: this.checkCodecSupport('video/mp4; codecs="dvhe.05.07"'),
                dolbyVisionP7: this.checkCodecSupport('video/mp4; codecs="dvhe.07.06"'),
                dolbyVisionP8: this.checkCodecSupport('video/mp4; codecs="dvhe.08.07"'),
                vp9: this.checkCodecSupport('video/webm; codecs="vp9"'),
                vp9Profile2: this.checkCodecSupport('video/webm; codecs="vp09.02.10.10"')
            };
            
            // Determine overall HDR capability
            const hasDolbyVision = this.codecSupport.dolbyVisionP5 || this.codecSupport.dolbyVisionP7 || this.codecSupport.dolbyVisionP8;
            const hasHDR = this.codecSupport.hevcMain10 || hasDolbyVision || this.codecSupport.vp9Profile2;
            
            console.log('[ShakaAdapter] Hardware codec support detected:');
            console.log('  - H.264/AVC:', this.codecSupport.h264);
            console.log('  - HEVC/H.265:', this.codecSupport.hevc, '(10-bit:', this.codecSupport.hevcMain10 + ')');
            console.log('  - Dolby Vision Profile 5:', this.codecSupport.dolbyVisionP5);
            console.log('  - Dolby Vision Profile 7:', this.codecSupport.dolbyVisionP7);
            console.log('  - Dolby Vision Profile 8:', this.codecSupport.dolbyVisionP8);
            console.log('  - VP9:', this.codecSupport.vp9, '(HDR:', this.codecSupport.vp9Profile2 + ')');
            console.log('[ShakaAdapter] HDR Capabilities: Dolby Vision=' + hasDolbyVision + ', HDR10=' + this.codecSupport.hevcMain10);
            
            // Store for later reference
            this.hasDolbyVisionSupport = hasDolbyVision;
            this.hasHDRSupport = hasHDR;

            // Optimized configuration for webOS with Dolby Vision and HDR support
            this.player.configure({
                streaming: {
                    bufferingGoal: 20,
                    rebufferingGoal: 2,
                    bufferBehind: 30,
                    alwaysStreamText: false,
                    startAtSegmentBoundary: false,
                    safeSeekOffset: 0.1,
                    stallEnabled: true,
                    stallThreshold: 1,
                    retryParameters: {
                        timeout: 15000,
                        maxAttempts: 2,
                        baseDelay: 500,
                        backoffFactor: 2,
                        fuzzFactor: 0.5
                    }
                },
                abr: {
                    enabled: true,
                    defaultBandwidthEstimate: 5000000,
                    switchInterval: 8,
                    bandwidthUpgradeTarget: 0.85,
                    bandwidthDowngradeTarget: 0.95,
                    restrictions: {
                        maxHeight: 2160,  // Allow 4K for HDR content
                        maxWidth: 3840,
                        maxBandwidth: 100000000  // Increase for high-bitrate HDR
                    }
                },
                manifest: {
                    retryParameters: {
                        timeout: 15000,
                        maxAttempts: 2
                    },
                    defaultPresentationDelay: 0,
                    dash: {
                        ignoreMinBufferTime: true
                    }
                },
                // Prefer Dolby Vision and HDR codecs over SDR
                // Order: Dolby Vision (Profile 7 dual-layer, Profile 5, Profile 8), HDR10+, HDR10, SDR
                preferredVideoCodecs: [
                    'dvhe.07',  // Dolby Vision Profile 7 (dual-layer with backward compatibility)
                    'dvh1.07',  // Dolby Vision Profile 7 variant
                    'dvhe.05',  // Dolby Vision Profile 5 (single-layer)
                    'dvh1.05',  // Dolby Vision Profile 5 variant
                    'dvhe.08',  // Dolby Vision Profile 8 (single-layer)
                    'dvh1.08',  // Dolby Vision Profile 8 variant
                    'hev1',     // HEVC/H.265 with HDR10
                    'hvc1',     // HEVC/H.265 variant
                    'avc1',     // H.264/AVC (SDR fallback)
                    'avc3'      // H.264/AVC variant
                ]
            });            // Note: Codec support depends on webOS device capabilities
            // The player will automatically select the best codec the device can decode

            // Setup error handling
            this.player.addEventListener('error', (event) => {
                this.emit('error', event.detail);
            });

            // Setup buffering events
            this.player.addEventListener('buffering', (event) => {
                this.emit('buffering', event.buffering);
            });

            // Setup adaptation events (quality changes)
            this.player.addEventListener('adaptation', () => {
                const stats = this.player.getStats();
                this.emit('qualitychange', {
                    width: stats.width,
                    height: stats.height,
                    bandwidth: stats.estimatedBandwidth
                });
            });
            
            // Setup variant change events (audio/video track changes)
            this.player.addEventListener('variantchanged', () => {
                const currentVariant = this.player.getVariantTracks().find(t => t.active);
                if (currentVariant) {
                    this.emit('audiotrackchange', {
                        language: currentVariant.language,
                        bandwidth: currentVariant.bandwidth
                    });
                }
            });

            this.initialized = true;
            return true;
        } catch (error) {
            return false;
        }
    }

    async load(url, options = {}) {
        if (!this.initialized || !this.player) {
            throw new Error('Shaka Player not initialized');
        }

        try {
            console.log('[ShakaAdapter] Loading:', url.substring(0, 80) + '...');
            if (options.startPosition) {
                console.log('[ShakaAdapter] Start position:', options.startPosition, 'seconds');
            }
            
            // Provide helpful info about playback method and codec support
            const isDirect = url.includes('.mp4') && !url.includes('.m3u8') && !url.includes('.mpd');
            const isStreaming = url.includes('.m3u8') || url.includes('.mpd');
            
            if (isDirect) {
                console.log('[ShakaAdapter] Direct file playback mode');
                if (this.hasDolbyVisionSupport) {
                    console.log('[ShakaAdapter] ✓ Device supports Dolby Vision hardware decoding');
                } else if (this.hasHDRSupport) {
                    console.log('[ShakaAdapter] ✓ Device supports HDR10 (HEVC 10-bit)');
                } else {
                    console.log('[ShakaAdapter] ℹ Device supports SDR only (no HDR hardware)');
                }
            } else if (isStreaming) {
                console.log('[ShakaAdapter] Adaptive streaming mode (DASH/HLS)');
                if (this.hasDolbyVisionSupport) {
                    console.log('[ShakaAdapter] ✓ Will prefer Dolby Vision tracks if available');
                } else if (this.hasHDRSupport) {
                    console.log('[ShakaAdapter] ✓ Will prefer HDR10 tracks if available');
                }
            }
            
            // Load the manifest
            await this.player.load(url);
            console.log('[ShakaAdapter] Manifest loaded successfully');
            
            this.emit('loaded', { url });

            // Set start position AFTER loading (when metadata is available)
            if (options.startPosition && options.startPosition > 0) {
                this.videoElement.currentTime = options.startPosition;
            }

            // Apply track selections if provided
            if (options.audioTrackId !== undefined) {
                this.selectAudioTrack(options.audioTrackId);
            }
            if (options.subtitleTrackId !== undefined) {
                this.selectSubtitleTrack(options.subtitleTrackId);
            }

        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    selectAudioTrack(trackId) {
        if (!this.player || !this.initialized) {
            console.warn('[ShakaAdapter] Player not ready for audio track selection');
            return false;
        }

        try {
            const allTracks = this.player.getVariantTracks();
            console.log('[ShakaAdapter] Selecting audio track:', trackId, 'from', allTracks.length, 'variants');
            
            // Get unique audio languages
            const audioLanguages = [];
            const seenLanguages = new Set();
            allTracks.forEach(track => {
                if (track.language && !seenLanguages.has(track.language)) {
                    seenLanguages.add(track.language);
                    audioLanguages.push(track.language);
                }
            });
            
            
            if (trackId >= 0 && trackId < audioLanguages.length) {
                const targetLanguage = audioLanguages[trackId];
                
                // Select all variant tracks with this language
                const tracksToSelect = allTracks.filter(t => t.language === targetLanguage);
                if (tracksToSelect.length > 0) {
                    // Select the first track with this language (Shaka will handle quality variants)
                    this.player.selectAudioLanguage(targetLanguage);
                    console.log('[ShakaAdapter] Audio language selected:', targetLanguage);
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    selectSubtitleTrack(trackId) {
        if (!this.player || !this.initialized) {
            console.warn('[ShakaAdapter] Player not ready for subtitle selection');
            return false;
        }

        try {
            if (trackId === -1) {
                this.player.setTextTrackVisibility(false);
                console.log('[ShakaAdapter] Subtitles disabled');
                return true;
            }

            const tracks = this.player.getTextTracks();
            console.log('[ShakaAdapter] Selecting subtitle:', trackId, 'from', tracks.length, 'tracks');
            
            if (trackId >= 0 && trackId < tracks.length) {
                const track = tracks[trackId];
                this.player.selectTextTrack(track);
                this.player.setTextTrackVisibility(true);
                console.log('[ShakaAdapter] Subtitle track selected:', track.language || trackId);
                return true;
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    getAudioTracks() {
        if (!this.player) return [];

        const tracks = this.player.getVariantTracks();
        const uniqueLanguages = new Map();
        
        tracks.forEach(track => {
            if (track.language && !uniqueLanguages.has(track.language)) {
                uniqueLanguages.set(track.language, {
                    id: uniqueLanguages.size,
                    language: track.language,
                    label: track.label || track.language,
                    channels: track.channelsCount
                });
            }
        });

        return Array.from(uniqueLanguages.values());
    }

    getSubtitleTracks() {
        if (!this.player) return [];

        return this.player.getTextTracks().map((track, index) => ({
            id: index,
            language: track.language,
            label: track.label || track.language,
            kind: track.kind
        }));
    }

    /**
     * Get real-time playback statistics
     * @returns {Object|null} Playback stats including codec, quality, and HDR info
     */
    getPlaybackStats() {
        if (!this.player || !this.initialized) return null;

        try {
            const stats = this.player.getStats();
            const variantTracks = this.player.getVariantTracks();
            const activeVariant = variantTracks.find(t => t.active);
            
            if (!activeVariant) return null;

            // Extract codec information
            const videoCodec = activeVariant.videoCodec || 'unknown';
            const audioCodec = activeVariant.audioCodec || 'unknown';
            
            // Determine HDR type from codec string
            let hdrType = 'SDR';
            let colorInfo = null;
            
            if (videoCodec.startsWith('dvhe.') || videoCodec.startsWith('dvh1.')) {
                // Dolby Vision profiles
                const profileMatch = videoCodec.match(/dv[he]1?\.(\d+)/);
                if (profileMatch) {
                    const profile = profileMatch[1];
                    if (profile === '05') hdrType = 'Dolby Vision (Profile 5)';
                    else if (profile === '07') hdrType = 'Dolby Vision (Profile 7)';
                    else if (profile === '08') hdrType = 'Dolby Vision (Profile 8)';
                    else hdrType = 'Dolby Vision (Profile ' + profile + ')';
                }
            } else if (videoCodec.includes('hev1') || videoCodec.includes('hvc1') || videoCodec.includes('hevc')) {
                // HEVC - likely HDR10 if high bitrate
                hdrType = 'HDR10 (HEVC)';
            } else if (videoCodec.includes('vp9')) {
                hdrType = 'HDR (VP9)';
            }
            
            // Get color information from video element if available
            if (this.videoElement && this.videoElement.videoWidth) {
                colorInfo = {
                    width: this.videoElement.videoWidth,
                    height: this.videoElement.videoHeight
                };
            }

            return {
                // Codec information
                videoCodec: videoCodec,
                audioCodec: audioCodec,
                hdrType: hdrType,
                
                // Quality information
                width: stats.width || (activeVariant.width || 0),
                height: stats.height || (activeVariant.height || 0),
                bandwidth: activeVariant.bandwidth || 0,
                
                // Performance stats
                estimatedBandwidth: stats.estimatedBandwidth || 0,
                droppedFrames: stats.droppedFrames || 0,
                stallsDetected: stats.stallsDetected || 0,
                streamBandwidth: stats.streamBandwidth || 0,
                
                // Additional info
                frameRate: activeVariant.frameRate || 0,
                audioChannels: activeVariant.channelsCount || 0,
                colorInfo: colorInfo
            };
        } catch (error) {
            console.error('[ShakaAdapter] Error getting playback stats:', error);
            return null;
        }
    }

    async destroy() {
        if (this.player) {
            await this.player.destroy();
            this.player = null;
        }
        this.initialized = false;
        await super.destroy();
    }

    /**
     * Get playback statistics
     * @returns {Object} Playback stats including dropped/corrupted frames
     */
    getStats() {
        const stats = {
            categories: []
        };

        if (!this.player || !this.videoElement) {
            return stats;
        }

        const shakaStats = this.player.getStats();
        const videoCategory = {
            type: 'video',
            stats: []
        };

        // Video resolution
        if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
            videoCategory.stats.push({
                label: 'Video Resolution',
                value: `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`
            });
        }

        // Dropped frames (from HTMLVideoElement API)
        if (this.videoElement.getVideoPlaybackQuality) {
            const quality = this.videoElement.getVideoPlaybackQuality();
            videoCategory.stats.push({
                label: 'Dropped Frames',
                value: quality.droppedVideoFrames || 0
            });
            videoCategory.stats.push({
                label: 'Corrupted Frames',
                value: quality.corruptedVideoFrames || 0
            });
        }

        // Shaka-specific stats
        if (shakaStats.estimatedBandwidth) {
            videoCategory.stats.push({
                label: 'Estimated Bandwidth',
                value: `${(shakaStats.estimatedBandwidth / 1000000).toFixed(2)} Mbps`
            });
        }

        stats.categories.push(videoCategory);
        return stats;
    }

    getName() {
        return 'ShakaPlayer';
    }
    
    /**
     * Check if a specific codec is supported by the browser/device
     * @param {string} mimeType - MIME type with codec string
     * @returns {boolean} True if codec is supported
     */
    checkCodecSupport(mimeType) {
        try {
            if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
                return window.MediaSource.isTypeSupported(mimeType);
            }
            // Fallback to video element canPlayType
            const video = document.createElement('video');
            const support = video.canPlayType(mimeType);
            return support === 'probably' || support === 'maybe';
        } catch (e) {
            console.warn('[ShakaAdapter] Error checking codec support:', e);
            return false;
        }
    }
}

/**
 * webOS Luna Service Video Adapter
 * Uses luna://com.webos.media for hardware-accelerated playback of all container formats
 * Including MKV, MP4, AVI, TS, FLV, etc.
 */
class WebOSVideoAdapter extends VideoPlayerAdapter {
    constructor(videoElement) {
        super(videoElement);
        this.mediaId = null;
        this.initialized = false;
        this.currentUrl = null;
        this.duration = 0;
        this.currentTime = 0;
        this.isPaused = true;
        this.isBuffering = false;
        this.sourceInfo = null;
        this.videoInfo = null;
        this.audioInfo = null;
        this.appId = 'org.moonfin.webos'; // Must match appinfo.json
        this.subscriptionActive = false;
        this.lunaServiceAvailable = false;
    }

    async initialize() {
        try {
            // Check if webOS Luna service bridge is available
            // This is available on webOS TV devices
            if (typeof window.webOS !== 'undefined' && typeof window.webOS.service !== 'undefined') {
                console.log('[WebOSLuna] Luna Service Bridge available');
                this.lunaServiceAvailable = true;
                this.initialized = true;
                
                // Setup video element for punch-through (transparent to show Luna video layer)
                this.setupVideoElement();
                return true;
            }
            
            // Also check for PalmServiceBridge (lower-level API)
            if (typeof window.PalmServiceBridge !== 'undefined') {
                console.log('[WebOSLuna] PalmServiceBridge available');
                this.lunaServiceAvailable = true;
                this.initialized = true;
                
                this.setupVideoElement();
                return true;
            }

            console.log('[WebOSLuna] No Luna service API available - not a webOS device');
            return false;
        } catch (error) {
            console.error('[WebOSLuna] Initialize error:', error);
            return false;
        }
    }

    /**
     * Setup video element for webOS punch-through rendering
     * The Luna media service renders video on a hardware layer behind the web app
     * The video element needs to be transparent to show this layer
     */
    setupVideoElement() {
        if (this.videoElement) {
            // Make video element transparent punch-through
            this.videoElement.style.backgroundColor = 'transparent';
            this.videoElement.style.visibility = 'visible';
            
            // Set webOS-specific attributes
            this.videoElement.setAttribute('mediaPlaybackRequiresUserGesture', 'false');
        }
    }

    /**
     * Make a Luna service request
     * @param {string} service - Luna service URL
     * @param {string} method - Method name
     * @param {Object} parameters - Request parameters
     * @returns {Promise<Object>} Response
     */
    lunaRequest(service, method, parameters = {}) {
        return new Promise((resolve, reject) => {
            const uri = service + '/' + method;
            console.log('[WebOSLuna] Request:', uri, JSON.stringify(parameters));

            if (window.webOS && window.webOS.service && window.webOS.service.request) {
                // Use webOS.service.request if available
                window.webOS.service.request(service, {
                    method: method,
                    parameters: parameters,
                    onSuccess: (response) => {
                        console.log('[WebOSLuna] Success:', method, response);
                        resolve(response);
                    },
                    onFailure: (error) => {
                        console.error('[WebOSLuna] Failure:', method, error);
                        reject(error);
                    }
                });
            } else if (window.PalmServiceBridge) {
                // Fallback to PalmServiceBridge
                const bridge = new PalmServiceBridge();
                bridge.onservicecallback = (response) => {
                    try {
                        const parsed = JSON.parse(response);
                        if (parsed.returnValue === false) {
                            console.error('[WebOSLuna] Error:', method, parsed);
                            reject(parsed);
                        } else {
                            console.log('[WebOSLuna] Success:', method, parsed);
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject({ errorText: 'Failed to parse response', response: response });
                    }
                };
                bridge.call(uri, JSON.stringify(parameters));
            } else {
                reject({ errorText: 'No Luna service API available' });
            }
        });
    }

    /**
     * Subscribe to media events using Luna service
     */
    subscribeToMediaEvents() {
        if (!this.mediaId || this.subscriptionActive) return;

        console.log('[WebOSLuna] Subscribing to media events for:', this.mediaId);
        
        const subscribeParams = {
            mediaId: this.mediaId
        };

        // Use -n 2 style subscription (continuous)
        if (window.webOS && window.webOS.service && window.webOS.service.request) {
            this.subscriptionService = window.webOS.service.request('luna://com.webos.media', {
                method: 'subscribe',
                parameters: subscribeParams,
                subscribe: true,
                onSuccess: (response) => {
                    this.handleMediaEvent(response);
                },
                onFailure: (error) => {
                    console.error('[WebOSLuna] Subscription error:', error);
                }
            });
            this.subscriptionActive = true;
        } else if (window.PalmServiceBridge) {
            // PalmServiceBridge subscription
            this.subscriptionBridge = new PalmServiceBridge();
            this.subscriptionBridge.onservicecallback = (response) => {
                try {
                    const parsed = JSON.parse(response);
                    this.handleMediaEvent(parsed);
                } catch (e) {
                    console.error('[WebOSLuna] Subscription parse error:', e);
                }
            };
            this.subscriptionBridge.call('luna://com.webos.media/subscribe', JSON.stringify(subscribeParams));
            this.subscriptionActive = true;
        }
    }

    /**
     * Handle media events from Luna service subscription
     */
    handleMediaEvent(event) {
        // Current playback time
        if (event.currentTime !== undefined) {
            this.currentTime = event.currentTime / 1000; // Convert ms to seconds
            this.emit('timeupdate', { currentTime: this.currentTime });
        }

        // Buffer range
        if (event.bufferRange) {
            this.emit('bufferRange', event.bufferRange);
        }

        // Buffering start
        if (event.bufferingStart) {
            this.isBuffering = true;
            this.emit('buffering', true);
        }

        // Buffering end
        if (event.bufferingEnd) {
            this.isBuffering = false;
            this.emit('buffering', false);
        }

        // Source info (contains duration, container, streams)
        if (event.sourceInfo) {
            this.sourceInfo = event.sourceInfo;
            this.duration = (event.sourceInfo.duration || 0) / 1000; // Convert ms to seconds
            console.log('[WebOSLuna] Source info:', this.sourceInfo);
            console.log('[WebOSLuna] Duration:', this.duration, 'seconds');
            console.log('[WebOSLuna] Container:', this.sourceInfo.container);
            this.emit('loadedmetadata', { duration: this.duration, sourceInfo: this.sourceInfo });
        }

        // Video info
        if (event.videoInfo) {
            this.videoInfo = event.videoInfo;
            console.log('[WebOSLuna] Video info:', this.videoInfo);
            this.emit('videoInfo', this.videoInfo);
        }

        // Audio info
        if (event.audioInfo) {
            this.audioInfo = event.audioInfo;
            console.log('[WebOSLuna] Audio info:', this.audioInfo);
            this.emit('audioInfo', this.audioInfo);
        }

        // Load completed
        if (event.loadCompleted) {
            console.log('[WebOSLuna] Load completed');
            this.emit('canplay', {});
        }

        // Playing
        if (event.playing) {
            this.isPaused = false;
            this.emit('playing', {});
        }

        // Paused
        if (event.paused) {
            this.isPaused = true;
            this.emit('pause', {});
        }

        // Seek done
        if (event.seekDone) {
            this.emit('seeked', {});
        }

        // End of stream
        if (event.endOfStream) {
            console.log('[WebOSLuna] End of stream');
            this.emit('ended', {});
        }

        // Error
        if (event.error) {
            console.error('[WebOSLuna] Media error:', event.error);
            this.emit('error', event.error);
        }
    }

    async load(url, options = {}) {
        if (!this.initialized) {
            throw new Error('WebOS Luna adapter not initialized');
        }

        try {
            // Unload any existing media first
            if (this.mediaId) {
                await this.unloadMedia();
            }

            this.currentUrl = url;
            console.log('[WebOSLuna] Loading media:', url);

            // For webOS web apps, we use a simpler load approach
            // The Luna service handles the video pipeline automatically
            const loadParams = {
                uri: url,
                type: 'media',
                payload: {
                    option: {
                        appId: this.appId,
                        // For web apps, use fullscreen pipeline mode
                        transmission: {
                            playTime: {
                                start: 0
                            }
                        }
                    },
                    // Request media info for metadata
                    mediaTransportType: 'URI'
                }
            };

            console.log('[WebOSLuna] Load params:', JSON.stringify(loadParams));

            // Load the media using Luna service
            const loadResponse = await this.lunaRequest('luna://com.webos.media', 'load', loadParams);

            if (!loadResponse.mediaId) {
                throw new Error('No mediaId returned from load');
            }

            this.mediaId = loadResponse.mediaId;
            console.log('[WebOSLuna] Media loaded with ID:', this.mediaId);

            // Subscribe to media events for state updates
            this.subscribeToMediaEvents();

            this.emit('loaded', { url, mediaId: this.mediaId });

            // Start playback immediately after load
            // Don't wait for events - the subscription may not work reliably in web apps
            console.log('[WebOSLuna] Starting playback immediately after load');
            await this.lunaRequest('luna://com.webos.media', 'play', {
                mediaId: this.mediaId
            });
            this.isPaused = false;

            // Signal that we can play (Luna has accepted the media)
            this.emit('canplay', {});
            this.emit('playing', {});

            // Seek to start position if provided
            if (options.startPosition && options.startPosition > 0) {
                await this.seek(options.startPosition);
            }

        } catch (error) {
            console.error('[WebOSLuna] Load error:', error);
            this.emit('error', error);
            throw error;
        }
    }

    async play() {
        if (!this.mediaId) {
            console.warn('[WebOSLuna] Cannot play - no media loaded');
            return;
        }

        try {
            await this.lunaRequest('luna://com.webos.media', 'play', {
                mediaId: this.mediaId
            });
            this.isPaused = false;
        } catch (error) {
            console.error('[WebOSLuna] Play error:', error);
            throw error;
        }
    }

    async pause() {
        if (!this.mediaId) {
            console.warn('[WebOSLuna] Cannot pause - no media loaded');
            return;
        }

        try {
            await this.lunaRequest('luna://com.webos.media', 'pause', {
                mediaId: this.mediaId
            });
            this.isPaused = true;
        } catch (error) {
            console.error('[WebOSLuna] Pause error:', error);
            throw error;
        }
    }

    async seek(time) {
        if (!this.mediaId) {
            console.warn('[WebOSLuna] Cannot seek - no media loaded');
            return;
        }

        try {
            // Luna service expects position in milliseconds
            const positionMs = Math.floor(time * 1000);
            console.log('[WebOSLuna] Seeking to:', time, 'seconds (', positionMs, 'ms)');
            
            await this.lunaRequest('luna://com.webos.media', 'seek', {
                mediaId: this.mediaId,
                position: positionMs
            });
            
            this.currentTime = time;
        } catch (error) {
            console.error('[WebOSLuna] Seek error:', error);
            throw error;
        }
    }

    getCurrentTime() {
        return this.currentTime;
    }

    getDuration() {
        return this.duration;
    }

    async setVolume(volume) {
        if (!this.mediaId) return;

        try {
            // Luna service expects volume 0-100
            const volumePercent = Math.floor(volume * 100);
            await this.lunaRequest('luna://com.webos.media', 'setVolume', {
                mediaId: this.mediaId,
                volume: volumePercent
            });
        } catch (error) {
            console.error('[WebOSLuna] setVolume error:', error);
        }
    }

    getVolume() {
        // Volume is managed at system level on webOS
        return 1.0;
    }

    isPaused() {
        return this.isPaused;
    }

    /**
     * Remove event handler
     */
    off(event, handler) {
        if (this.eventHandlers[event]) {
            const index = this.eventHandlers[event].indexOf(handler);
            if (index > -1) {
                this.eventHandlers[event].splice(index, 1);
            }
        }
    }

    selectAudioTrack(trackId) {
        // Audio track selection via Luna service would require selectTrack method
        // For now, return false as this is handled by server-side transcoding
        console.log('[WebOSLuna] Audio track selection not yet implemented:', trackId);
        return false;
    }

    selectSubtitleTrack(trackId) {
        // Subtitle track selection via Luna service
        // For now, return false as this is handled by server-side transcoding
        console.log('[WebOSLuna] Subtitle track selection not yet implemented:', trackId);
        return false;
    }

    getAudioTracks() {
        // Return tracks from sourceInfo if available
        if (this.sourceInfo && this.sourceInfo.audio_streams) {
            return this.sourceInfo.audio_streams.map((stream, index) => ({
                id: index,
                language: stream.language || 'unknown',
                label: stream.label || `Audio ${index + 1}`,
                codec: stream.codec,
                sampleRate: stream.sample_rate
            }));
        }
        return [];
    }

    getSubtitleTracks() {
        // Subtitles are typically handled via separate subtitle files on webOS
        return [];
    }

    /**
     * Unload current media
     */
    async unloadMedia() {
        if (!this.mediaId) return;

        try {
            // Cancel subscription first
            if (this.subscriptionActive) {
                if (this.subscriptionService && this.subscriptionService.cancel) {
                    this.subscriptionService.cancel();
                }
                if (this.subscriptionBridge) {
                    this.subscriptionBridge.cancel();
                    this.subscriptionBridge = null;
                }
                this.subscriptionActive = false;
            }

            // Unload media
            await this.lunaRequest('luna://com.webos.media', 'unload', {
                mediaId: this.mediaId
            });

            console.log('[WebOSLuna] Media unloaded:', this.mediaId);
        } catch (error) {
            console.error('[WebOSLuna] Unload error:', error);
        } finally {
            this.mediaId = null;
        }
    }

    async destroy() {
        await this.unloadMedia();
        this.currentUrl = null;
        this.duration = 0;
        this.currentTime = 0;
        this.sourceInfo = null;
        this.videoInfo = null;
        this.audioInfo = null;
        this.initialized = false;
        await super.destroy();
    }

    getName() {
        return 'WebOSLuna';
    }

    /**
     * Get playback statistics
     */
    getStats() {
        const stats = {
            categories: []
        };

        const videoCategory = {
            type: 'video',
            stats: []
        };

        // Video info from Luna service
        if (this.videoInfo && this.videoInfo.video) {
            const video = this.videoInfo.video;
            videoCategory.stats.push({
                label: 'Video Resolution',
                value: `${video.width || 0}x${video.height || 0}`
            });
            if (video.codec) {
                videoCategory.stats.push({
                    label: 'Video Codec',
                    value: video.codec
                });
            }
            if (video.bitrate) {
                videoCategory.stats.push({
                    label: 'Video Bitrate',
                    value: `${(video.bitrate / 1000000).toFixed(2)} Mbps`
                });
            }
        }

        // Container info
        if (this.sourceInfo && this.sourceInfo.container) {
            videoCategory.stats.push({
                label: 'Container',
                value: this.sourceInfo.container
            });
        }

        // Audio info
        if (this.audioInfo) {
            const audioCategory = {
                type: 'audio',
                stats: []
            };
            if (this.audioInfo.codec) {
                audioCategory.stats.push({
                    label: 'Audio Codec',
                    value: this.audioInfo.codec
                });
            }
            if (this.audioInfo.sample_rate) {
                audioCategory.stats.push({
                    label: 'Sample Rate',
                    value: `${this.audioInfo.sample_rate} Hz`
                });
            }
            stats.categories.push(audioCategory);
        }

        videoCategory.stats.push({
            label: 'Player',
            value: 'WebOS Luna (Native)'
        });

        stats.categories.push(videoCategory);
        return stats;
    }
}

/**
 * Handle HLS.js media errors with retry logic
 */
function handleHlsJsMediaError(hlsPlayer) {
    if (!hlsPlayer) return false;

    const now = performance.now ? performance.now() : Date.now();

    // First attempt: recover from decoding error
    if (!recoverDecodingErrorDate || (now - recoverDecodingErrorDate) > 3000) {
        recoverDecodingErrorDate = now;
        console.log('[HLS Recovery] Attempting to recover from media error...');
        hlsPlayer.recoverMediaError();
        return true;
    } 
    // Second attempt: swap audio codec and recover
    else if (!recoverSwapAudioCodecDate || (now - recoverSwapAudioCodecDate) > 3000) {
        recoverSwapAudioCodecDate = now;
        console.log('[HLS Recovery] Swapping audio codec and recovering...');
        hlsPlayer.swapAudioCodec();
        hlsPlayer.recoverMediaError();
        return true;
    } 
    // Failed: cannot recover
    else {
        console.error('[HLS Recovery] Cannot recover, last attempts failed');
        return false;
    }
}

/**
 * Get cross-origin value based on media source
 */
function getCrossOriginValue(mediaSource) {
    if (mediaSource && mediaSource.IsRemote) {
        return null;
    }
    return 'anonymous';
}

/**
 * HTML5 Video Element Adapter (Fallback)
 */
class HTML5VideoAdapter extends VideoPlayerAdapter {
    constructor(videoElement) {
        super(videoElement);
        this.initialized = false;
        this.hlsPlayer = null;
    }

    async initialize() {
        this.initialized = true;
        return true;
    }

    async load(url, options = {}) {
        if (!this.initialized) {
            throw new Error('HTML5 Video adapter not initialized');
        }

        console.log('[HTML5Adapter] Loading:', url.substring(0, 80) + '...');

        try {
            // Check if HLS stream
            const isHLS = url.includes('.m3u8') || (options.mimeType && options.mimeType.includes('mpegURL'));
            
            if (isHLS) {
                // Use DeviceProfile module if available for smarter HLS decision
                if (typeof DeviceProfile !== 'undefined') {
                    const preferNative = DeviceProfile.shouldUseNativeHls();
                    const preferHlsJs = DeviceProfile.shouldUseHlsJs();
                    
                    console.log('[HTML5Adapter] DeviceProfile: preferNative=' + preferNative + ', preferHlsJs=' + preferHlsJs);
                    
                    // If device profile says use native HLS
                    if (preferNative) {
                        console.log('[HTML5Adapter] Using native HLS playback (DeviceProfile)');
                        return this.loadNativeHLS(url, options);
                    }
                    
                    // If device profile says use HLS.js and it's available
                    if (preferHlsJs && typeof Hls !== 'undefined' && Hls.isSupported()) {
                        console.log('[HTML5Adapter] Using HLS.js for HLS playback (DeviceProfile)');
                        return this.loadWithHlsJs(url, options);
                    }
                    
                    // DeviceProfile returned false for both - prefer HLS.js if available
                    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                        console.log('[HTML5Adapter] Using HLS.js for HLS playback (DeviceProfile default)');
                        return this.loadWithHlsJs(url, options);
                    }
                }
                
                // Fallback: Check for native HLS support first (Safari, iOS, some smart TVs)
                // Native HLS is more reliable on older/embedded browsers than HLS.js + MediaSource
                const videoTest = document.createElement('video');
                const canPlayNativeHLS = videoTest.canPlayType('application/vnd.apple.mpegurl') || 
                                         videoTest.canPlayType('application/x-mpegURL');
                
                if (canPlayNativeHLS) {
                    console.log('[HTML5Adapter] Using native HLS playback (fallback)');
                    return this.loadNativeHLS(url, options);
                }
                
                // Fall back to HLS.js if native not supported but MediaSource is
                if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                    console.log('[HTML5Adapter] Using HLS.js for HLS playback (fallback)');
                    return this.loadWithHlsJs(url, options);
                }
                
                // Last resort: try direct src assignment (some browsers handle it)
                console.log('[HTML5Adapter] Trying direct HLS src assignment');
                return this.loadNativeHLS(url, options);
            }

            // Non-HLS content - use standard HTML5 video
            return this.loadDirect(url, options);

        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Load video directly without HLS.js
     * Used for DirectPlay of MP4, MKV, and other container formats
     * On webOS, MKV files are routed to native decoder even though canPlayType returns empty
     * @private
     */
    loadDirect(url, options = {}) {
        console.log('[HTML5Adapter] ========== loadDirect called ==========');
        console.log('[HTML5Adapter] URL:', url.substring(0, 120) + '...');
        console.log('[HTML5Adapter] MimeType:', options.mimeType || 'not specified');
        console.log('[HTML5Adapter] StartPosition:', options.startPosition || 0);
        
        // Detect container type from URL
        const isMKV = url.toLowerCase().includes('.mkv') || url.toLowerCase().includes('container=mkv');
        const isMP4 = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('container=mp4');
        
        if (isMKV) {
            console.log('[HTML5Adapter] MKV container detected - relying on webOS native decoder');
            console.log('[HTML5Adapter] Note: canPlayType() may return empty but native pipeline supports MKV');
        }
        
        // Clear existing sources
        this.videoElement.innerHTML = '';
        
        // Set cross-origin if needed
        const crossOrigin = getCrossOriginValue(options.mediaSource);
        if (crossOrigin) {
            this.videoElement.crossOrigin = crossOrigin;
        }
        
        // For MKV, don't set type attribute - let browser detect format from content
        // Chrome 53 doesn't recognize video/x-matroska MIME type, but can play MKV via native decoder
        if (isMKV && options.mimeType) {
            console.log('[HTML5Adapter] MKV file - skipping MIME type "' + options.mimeType + '" (browser will auto-detect)');
            options.mimeType = null;
        }
        
        // Set src directly (more reliable than <source> element on some browsers)
        // Per jellyfin-web htmlMediaHelper.js applySrc()
        this.videoElement.src = url;
        
        // Log whether the video element thinks it can play this type
        if (options.mimeType) {
            const canPlayResult = this.videoElement.canPlayType(options.mimeType);
            console.log('[HTML5Adapter] canPlayType("' + options.mimeType + '"): "' + canPlayResult + '"');
        }

        // Set start position if provided
        if (options.startPosition) {
            this.videoElement.currentTime = options.startPosition;
        }

        this.emit('loaded', { url });

        // Wait for video to be ready
        return new Promise((resolve, reject) => {
            const onCanPlay = () => {
                console.log('[HTML5Adapter] loadDirect: canplay event fired');
                console.log('[HTML5Adapter] Video dimensions:', this.videoElement.videoWidth + 'x' + this.videoElement.videoHeight);
                this.videoElement.removeEventListener('canplay', onCanPlay);
                this.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                this.videoElement.removeEventListener('error', onError);
                resolve();
            };
            
            const onLoadedMetadata = () => {
                console.log('[HTML5Adapter] loadDirect: loadedmetadata event fired');
                console.log('[HTML5Adapter] Video duration:', this.videoElement.duration);
                console.log('[HTML5Adapter] Video dimensions:', this.videoElement.videoWidth + 'x' + this.videoElement.videoHeight);
            };
            
            const onError = (e) => {
                console.error('[HTML5Adapter] loadDirect: error event fired');
                console.error('[HTML5Adapter] Error code:', this.videoElement.error?.code);
                console.error('[HTML5Adapter] Error message:', this.videoElement.error?.message);
                this.videoElement.removeEventListener('canplay', onCanPlay);
                this.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                this.videoElement.removeEventListener('error', onError);
                reject(e);
            };

            this.videoElement.addEventListener('canplay', onCanPlay);
            this.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
            this.videoElement.addEventListener('error', onError);
        });
    }

    /**
     * Load HLS stream using native browser support
     * Works on Safari, iOS, and some smart TV browsers
     * @private
     */
    loadNativeHLS(url, options = {}) {
        var self = this;
        
        console.log('[HTML5Adapter] ========== loadNativeHLS called ==========');
        console.log('[HTML5Adapter] Full URL:', url);
        
        // Parse URL to extract key parameters
        try {
            var urlObj = new URL(url);
            var params = new URLSearchParams(urlObj.search);
            console.log('[HTML5Adapter] Server:', urlObj.origin);
            console.log('[HTML5Adapter] Path:', urlObj.pathname);
            console.log('[HTML5Adapter] Key parameters:');
            console.log('[HTML5Adapter]   - VideoCodec:', params.get('VideoCodec') || 'not specified');
            console.log('[HTML5Adapter]   - AudioCodec:', params.get('AudioCodec') || 'not specified');
            console.log('[HTML5Adapter]   - Container:', params.get('Container') || 'not specified');
            console.log('[HTML5Adapter]   - TranscodingMaxAudioChannels:', params.get('TranscodingMaxAudioChannels') || 'not specified');
            console.log('[HTML5Adapter]   - MediaSourceId:', params.get('MediaSourceId') || 'not specified');
        } catch (e) {
            console.error('[HTML5Adapter] Error parsing URL:', e);
        }
        
        console.log('[HTML5Adapter] MediaSource info:', options.mediaSource);
        console.log('[HTML5Adapter] ==========================================');
        
        return new Promise(function(resolve, reject) {
            // Clear existing sources
            self.videoElement.innerHTML = '';
            
            // Set cross-origin if needed  
            var crossOrigin = getCrossOriginValue(options.mediaSource);
            if (crossOrigin) {
                self.videoElement.crossOrigin = crossOrigin;
            }
            
            // Set src directly for native HLS
            self.videoElement.src = url;
            
            // Set start position if provided
            if (options.startPosition && options.startPosition > 0) {
                self.videoElement.currentTime = options.startPosition;
            }
            
            var resolved = false;
            var timeoutId = null;
            
            var cleanup = function() {
                if (timeoutId) clearTimeout(timeoutId);
                self.videoElement.removeEventListener('canplay', onCanPlay);
                self.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                self.videoElement.removeEventListener('error', onError);
                self.videoElement.removeEventListener('stalled', onStalled);
                self.videoElement.removeEventListener('waiting', onWaiting);
                self.videoElement.removeEventListener('loadstart', onLoadStart);
            };
            
            var onCanPlay = function() {
                if (resolved) return;
                resolved = true;
                cleanup();
                console.log('[HTML5Adapter] Native HLS ready to play');
                self.videoElement.play().then(function() {
                    console.log('[HTML5Adapter] Native HLS playback started');
                    resolve();
                }).catch(function(err) {
                    // Play might be blocked by autoplay policy, but stream is loaded
                    console.log('[HTML5Adapter] Native HLS loaded (play pending):', err.message);
                    resolve();
                });
            };
            
            var onLoadedMetadata = function() {
                console.log('[HTML5Adapter] Native HLS metadata loaded');
                console.log('[HTML5Adapter] Video dimensions:', self.videoElement.videoWidth, 'x', self.videoElement.videoHeight);
                console.log('[HTML5Adapter] Video duration:', self.videoElement.duration);
                console.log('[HTML5Adapter] Video readyState:', self.videoElement.readyState);
                console.log('[HTML5Adapter] Video networkState:', self.videoElement.networkState);
                
                if (self.videoElement.videoWidth === 0 || self.videoElement.videoHeight === 0) {
                    console.error('[HTML5Adapter] VIDEO DIMENSIONS ARE 0x0 - PLAYBACK WILL FAIL');
                    console.error('[HTML5Adapter] This indicates the native HLS player cannot decode the video codec');
                    console.error('[HTML5Adapter] Fetching HLS manifest to diagnose...');
                    
                    fetch(url).then(function(response) {
                        return response.text();
                    }).then(function(manifestText) {
                        console.error('[HTML5Adapter] HLS Master Manifest:', manifestText.substring(0, 500));
                        
                        // Parse and log the variant playlist URL
                        var lines = manifestText.split('\n');
                        for (var i = 0; i < lines.length; i++) {
                            if (lines[i] && !lines[i].startsWith('#')) {
                                var variantUrl = lines[i].trim();
                                // Make it absolute
                                if (!variantUrl.startsWith('http')) {
                                    var baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
                                    variantUrl = baseUrl + variantUrl;
                                }
                                console.error('[HTML5Adapter] Variant playlist URL:', variantUrl);
                                
                                // Fetch variant playlist to see codec info
                                fetch(variantUrl).then(function(resp) {
                                    return resp.text();
                                }).then(function(variantText) {
                                    console.error('[HTML5Adapter] Variant Playlist (first 800 chars):', variantText.substring(0, 800));
                                }).catch(function(e) {
                                    console.error('[HTML5Adapter] Failed to fetch variant playlist:', e);
                                });
                                break;
                            }
                        }
                    }).catch(function(err) {
                        console.error('[HTML5Adapter] Failed to fetch manifest:', err);
                    });
                }
            };
            
            var onError = function(e) {
                if (resolved) return;
                resolved = true;
                cleanup();
                var error = self.videoElement.error;
                var errorDetails = error ? 
                    'code=' + error.code + ' message=' + (error.message || 'none') : 
                    'Unknown error';
                console.error('[HTML5Adapter] Native HLS error:', errorDetails);
                console.error('[HTML5Adapter] Video networkState:', self.videoElement.networkState);
                console.error('[HTML5Adapter] Video readyState:', self.videoElement.readyState);
                reject(new Error('Native HLS playback failed: ' + errorDetails));
            };
            
            var onStalled = function() {
                console.warn('[HTML5Adapter] Native HLS stalled');
            };
            
            var onWaiting = function() {
                console.log('[HTML5Adapter] Native HLS waiting for data');
            };
            
            var onLoadStart = function() {
                console.log('[HTML5Adapter] Native HLS load started');
            };
            
            self.videoElement.addEventListener('canplay', onCanPlay);
            self.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
            self.videoElement.addEventListener('error', onError);
            self.videoElement.addEventListener('stalled', onStalled);
            self.videoElement.addEventListener('waiting', onWaiting);
            self.videoElement.addEventListener('loadstart', onLoadStart);
            
            // Timeout after 30 seconds
            timeoutId = setTimeout(function() {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(new Error('Native HLS timeout'));
                }
            }, 30000);
            
            self.emit('loaded', { url: url });
        });
    }

    /**
     * Load HLS stream using HLS.js with error recovery
     * Configured to match jellyfin-web for maximum compatibility
     * @private
     */
    loadWithHlsJs(url, options = {}) {
        return new Promise((resolve, reject) => {
            // Destroy existing HLS player
            if (this.hlsPlayer) {
                try {
                    this.hlsPlayer.destroy();
                } catch (e) {
                    console.warn('[HTML5+HLS.js] Error destroying old player:', e);
                }
                this.hlsPlayer = null;
            }

            // HLS.js configuration matching jellyfin-web for best compatibility
            var hlsConfig = {
                // Manifest loading settings
                manifestLoadingTimeOut: 20000,
                manifestLoadingMaxRetry: 4,
                manifestLoadingRetryDelay: 500,

                // Level loading settings
                levelLoadingTimeOut: 20000,
                levelLoadingMaxRetry: 4,
                levelLoadingRetryDelay: 500,

                // Fragment loading settings
                fragLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 500,

                // Buffer settings - important for smooth playback
                maxBufferLength: 30,
                maxBufferSize: 60 * 1000 * 1000, // 60MB
                maxBufferHole: 0.5,
                backBufferLength: 90,
                liveBackBufferLength: 90,

                // Low latency mode disabled for better compatibility with webOS
                lowLatencyMode: false,

                // ABR settings - matching jellyfin-web
                abrEwmaDefaultEstimate: 1000000,
                abrBandWidthFactor: 0.8,
                abrBandWidthUpFactor: 0.7,
                abrMaxWithRealBitrate: true,

                // Start from specific position if provided
                startPosition: options.startPosition || -1,

                // XHR setup for credentials
                xhrSetup: function(xhr) {
                    xhr.withCredentials = options.withCredentials || false;
                }
            };

            console.log('[HTML5+HLS.js] Creating player with config:', JSON.stringify({
                maxBufferLength: hlsConfig.maxBufferLength,
                backBufferLength: hlsConfig.backBufferLength,
                lowLatencyMode: hlsConfig.lowLatencyMode,
                startPosition: hlsConfig.startPosition
            }));

            var hls = new Hls(hlsConfig);
            var self = this;

            hls.loadSource(url);
            hls.attachMedia(this.videoElement);

            hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                console.log('[HTML5+HLS.js] Manifest parsed, levels:', data.levels ? data.levels.length : 0);
                // Call play() but don't reject the load promise on play() errors
                // The "interrupted by new load request" error is common during HLS.js recovery
                // and shouldn't be treated as a fatal load failure
                self.videoElement.play().then(function() {
                    console.log('[HTML5+HLS.js] Play started successfully');
                    resolve();
                }).catch(function(err) {
                    // AbortError ("interrupted by new load request") is not fatal
                    // The video will continue loading and play via HLS.js events
                    if (err.name === 'AbortError' || (err.message && err.message.indexOf('interrupted') !== -1)) {
                        console.log('[HTML5+HLS.js] Play interrupted (non-fatal):', err.message);
                        // Still resolve - HLS.js will handle playback
                        resolve();
                    } else {
                        console.error('[HTML5+HLS.js] Play failed:', err.message);
                        reject(err);
                    }
                });
            });

            hls.on(Hls.Events.LEVEL_LOADED, function(event, data) {
                console.log('[HTML5+HLS.js] Level loaded - duration:', data.details ? data.details.totalduration : 'unknown');
            });

            hls.on(Hls.Events.FRAG_LOADED, function(event, data) {
                var fragSize = data.frag && data.frag.stats ? Math.round(data.frag.stats.loaded / 1024) : 0;
                console.log('[HTML5+HLS.js] Fragment loaded - size:', fragSize + 'KB');
            });

            hls.on(Hls.Events.FRAG_BUFFERED, function(event, data) {
                if (data.stats) {
                    var bufferingTime = typeof data.stats.buffering === 'object' 
                        ? JSON.stringify(data.stats.buffering) 
                        : data.stats.buffering;
                    console.log('[HTML5+HLS.js] Fragment buffered - processing:', bufferingTime + 'ms');
                }
            });

            hls.on(Hls.Events.ERROR, function(event, data) {
                console.error('[HTML5+HLS.js] Error:', data.type, data.details, 'fatal:', data.fatal);

                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Check if it's a 4xx error (client error - likely invalid stream)
                            if (data.response && data.response.code >= 400 && data.response.code < 500) {
                                console.error('[HTML5+HLS.js] Client error (4xx), not recoverable:', data.response.code);
                                hls.destroy();
                                self.emit('error', { type: MediaError.SERVER_ERROR, details: data, code: data.response.code });
                                reject(new Error(MediaError.SERVER_ERROR + ': ' + data.response.code));
                            } else if (data.response && data.response.code >= 500) {
                                // 5xx server error - might be temporary, try recovery
                                console.log('[HTML5+HLS.js] Server error (5xx), attempting recovery...');
                                hls.startLoad();
                            } else {
                                // Network issue without HTTP response - try recovery
                                console.log('[HTML5+HLS.js] Network error, attempting recovery...');
                                hls.startLoad();
                            }
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            if (handleHlsJsMediaError(hls)) {
                                console.log('[HTML5+HLS.js] Media error recovery attempted');
                            } else {
                                console.error('[HTML5+HLS.js] Media error recovery exhausted');
                                hls.destroy();
                                self.emit('error', { type: MediaError.MEDIA_DECODE_ERROR, details: data });
                                reject(new Error(MediaError.MEDIA_DECODE_ERROR));
                            }
                            break;
                        default:
                            console.error('[HTML5+HLS.js] Fatal error, no recovery available');
                            hls.destroy();
                            self.emit('error', { type: MediaError.FATAL_HLS_ERROR, details: data });
                            reject(new Error(MediaError.FATAL_HLS_ERROR));
                            break;
                    }
                }
            });

            this.hlsPlayer = hls;
            this.emit('loaded', { url: url });
        });
    }

    selectAudioTrack(trackId) {
        try {
            const audioTracks = this.videoElement.audioTracks;
            if (audioTracks && trackId >= 0 && trackId < audioTracks.length) {
                for (let i = 0; i < audioTracks.length; i++) {
                    audioTracks[i].enabled = (i === trackId);
                }
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    selectSubtitleTrack(trackId) {
        try {
            const textTracks = this.videoElement.textTracks;
            
            if (trackId === -1) {
                for (let i = 0; i < textTracks.length; i++) {
                    textTracks[i].mode = 'disabled';
                }
                return true;
            }

            if (textTracks && trackId >= 0 && trackId < textTracks.length) {
                for (let i = 0; i < textTracks.length; i++) {
                    textTracks[i].mode = (i === trackId) ? 'showing' : 'disabled';
                }
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    getAudioTracks() {
        const audioTracks = this.videoElement.audioTracks;
        if (!audioTracks) return [];

        const tracks = [];
        for (let i = 0; i < audioTracks.length; i++) {
            const track = audioTracks[i];
            tracks.push({
                id: i,
                language: track.language,
                label: track.label || track.language,
                enabled: track.enabled
            });
        }
        return tracks;
    }

    getSubtitleTracks() {
        const textTracks = this.videoElement.textTracks;
        if (!textTracks) return [];

        const tracks = [];
        for (let i = 0; i < textTracks.length; i++) {
            const track = textTracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
                tracks.push({
                    id: i,
                    language: track.language,
                    label: track.label || track.language,
                    kind: track.kind
                });
            }
        }
        return tracks;
    }

    /**
     * Get playback statistics
     * @returns {Object} Playback stats
     */
    getStats() {
        const stats = {
            categories: []
        };

        if (!this.videoElement) {
            return stats;
        }

        const videoCategory = {
            type: 'video',
            stats: []
        };

        // Video resolution
        if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
            videoCategory.stats.push({
                label: 'Video Resolution',
                value: `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`
            });
        }

        // Dropped/corrupted frames
        if (this.videoElement.getVideoPlaybackQuality) {
            const quality = this.videoElement.getVideoPlaybackQuality();
            videoCategory.stats.push({
                label: 'Dropped Frames',
                value: quality.droppedVideoFrames || 0
            });
            videoCategory.stats.push({
                label: 'Corrupted Frames',
                value: quality.corruptedVideoFrames || 0
            });
        }

        stats.categories.push(videoCategory);
        return stats;
    }

    async destroy() {
        // Cleanup HLS.js player
        if (this.hlsPlayer) {
            try {
                this.hlsPlayer.destroy();
            } catch (err) {
                console.error('[HTML5VideoAdapter] Error destroying HLS player:', err);
            }
            this.hlsPlayer = null;
        }

        this.videoElement.innerHTML = '';
        this.initialized = false;
        await super.destroy();
    }

    getName() {
        return 'HTML5Video';
    }
}

/**
 * Video Player Factory
 * Creates the best available player adapter with automatic fallback
 */
class VideoPlayerFactory {
    /**
     * Create a video player adapter with automatic capability detection
     * @param {HTMLVideoElement} videoElement - Video element to use
     * @param {Object} options - Creation options
     * @param {boolean} options.preferWebOS - Prefer WebOS native adapter for DirectPlay (MKV, HEVC, etc.)
     * @param {boolean} options.preferHTML5 - Prefer HTML5 video element for direct files
     * @param {boolean} options.preferHLS - Prefer HTML5+HLS.js for transcoded HLS streams (matches jellyfin-web)
     * @returns {Promise<VideoPlayerAdapter>} Initialized player adapter
     */
    static async createPlayer(videoElement, options = {}) {
        // Determine adapter priority based on playback needs
        var adapters = [
            ShakaPlayerAdapter,
            HTML5VideoAdapter
        ];

        if (options.preferWebOS) {
            // For DirectPlay on webOS: Use native Luna service for MKV/HEVC/etc.
            // WebOSVideoAdapter uses luna://com.webos.media which supports all native codecs
            console.log('[PlayerFactory] preferWebOS mode - using WebOS Luna service for DirectPlay');
            adapters = [
                WebOSVideoAdapter,
                HTML5VideoAdapter,
                ShakaPlayerAdapter
            ];
        } else if (options.preferHLS) {
            // For transcoded HLS streams: HTML5+HLS.js > Shaka
            // This matches jellyfin-web behavior for better compatibility
            console.log('[PlayerFactory] preferHLS mode - using HTML5+HLS.js for transcoded stream');
            adapters = [
                HTML5VideoAdapter,
                ShakaPlayerAdapter
            ];
        } else if (options.preferHTML5) {
            // For direct files: HTML5 > Shaka
            adapters = [
                HTML5VideoAdapter,
                ShakaPlayerAdapter
            ];
        }

        for (var i = 0; i < adapters.length; i++) {
            var AdapterClass = adapters[i];
            try {
                console.log('[PlayerFactory] Attempting:', AdapterClass.name || 'UnknownAdapter');
                var adapter = new AdapterClass(videoElement);
                var success = await adapter.initialize();
                
                if (success) {
                    console.log('[PlayerFactory] Using:', adapter.getName());
                    return adapter;
                }
            } catch (error) {
                console.warn('[PlayerFactory]', (AdapterClass.name || 'UnknownAdapter'), 'failed:', error.message);
            }
        }

        throw new Error('No video player adapter could be initialized');
    }
}
