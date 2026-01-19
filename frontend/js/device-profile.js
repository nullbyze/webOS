/**
 * Device Profile Builder for webOS
 * 
 * This is a faithful port of jellyfin-web's browserDeviceProfile.js
 * adapted for standalone webOS apps (without NativeShell).
 * 
 * MKV DirectPlay Support (webOS 4+):
 * - webOS TV hardware natively supports MKV containers with H.264, HEVC,
 *   AC3, EAC3, AAC, etc. (confirmed by LG official documentation)
 * - Although canPlayType('video/x-matroska') returns empty on webOS 4,
 *   setting video.src to an MKV URL works because webOS routes it to
 *   the native media pipeline (similar to how Tizen uses AVPlay)
 * - This enables DirectPlay of MKV files, avoiding HLS transcoding issues
 *   with AC3/EAC3 audio on webOS 4
 * 
 * Based on jellyfin-web (January 2025)
 * @module DeviceProfile
 */
var DeviceProfile = (function() {
    'use strict';

    var _browser = null;
    var _videoTestElement = null;
    var _deviceInfo = null;
    var _deviceInfoCallbacks = [];
    var _deviceInfoLoaded = false;

    function detectBrowser() {
        if (_browser) return _browser;
        
        var userAgent = navigator.userAgent;
        var normalizedUA = userAgent.toLowerCase();
        
        var browser = {};
        
        var chromeMatch = /chrome\/(\d+)/.exec(normalizedUA);
        var safariMatch = /safari\/(\d+)/.exec(normalizedUA);
        var versionMatch = /version\/(\d+)/.exec(normalizedUA);
        
        if (chromeMatch) {
            browser.chrome = true;
            browser.versionMajor = parseInt(chromeMatch[1], 10);
        } else if (safariMatch) {
            browser.safari = true;
            browser.versionMajor = parseInt(safariMatch[1], 10);
        }
        
        if (versionMatch) {
            browser.version = versionMatch[1];
        }
        
        browser.web0s = normalizedUA.includes('web0s') || normalizedUA.includes('netcast');
        browser.tv = browser.web0s;
        browser.slow = browser.tv;
        
        if (browser.web0s) {
            browser.web0sVersion = getWeb0sVersion(browser);
            delete browser.chrome;
            delete browser.safari;
        }
        
        _browser = browser;
        return browser;
    }
    
    function getWeb0sVersion(browser) {
        var userAgent = navigator.userAgent.toLowerCase();
        
        if (userAgent.includes('netcast')) {
            console.warn('[DeviceProfile] NetCast browser detected - webOS version uncertain');
            return undefined;
        }
        
        var chromeMatch = /chrome\/(\d+)/.exec(userAgent);
        if (chromeMatch) {
            var chromeVersion = parseInt(chromeMatch[1], 10);
            
            if (chromeVersion >= 94) return 23;
            if (chromeVersion >= 87) return 22;
            if (chromeVersion >= 79) return 6;
            if (chromeVersion >= 68) return 5;
            if (chromeVersion >= 53) return 4;
            if (chromeVersion >= 38) return 3;
            if (chromeVersion >= 34) return 2;
            if (chromeVersion >= 26) return 1;
        }
        
        var safariMatch = /safari\/(\d+)/.exec(userAgent);
        if (safariMatch) {
            var safariVersion = parseInt(safariMatch[1], 10);
            if (safariVersion >= 538) return 2;
            if (safariVersion >= 537) return 1;
        }
        
        console.error('[DeviceProfile] Unable to detect webOS version');
        return undefined;
    }

    function getVideoTestElement() {
        if (!_videoTestElement) {
            _videoTestElement = document.createElement('video');
        }
        return _videoTestElement;
    }

    function loadDeviceInfo(callback) {
        if (_deviceInfoLoaded) {
            if (callback) callback(_deviceInfo);
            return;
        }
        
        if (callback) {
            _deviceInfoCallbacks.push(callback);
        }
        
        if (_deviceInfoCallbacks.length > 1) {
            return;
        }
        
        if (typeof webOS !== 'undefined' && typeof webOS.deviceInfo === 'function') {
            console.log('[DeviceProfile] Loading webOS deviceInfo...');
            try {
                webOS.deviceInfo(function(info) {
                    _deviceInfo = info || {};
                    _deviceInfoLoaded = true;
                    console.log('[DeviceProfile] webOS deviceInfo loaded:', JSON.stringify(_deviceInfo, null, 2));
                    
                    var callbacks = _deviceInfoCallbacks.slice();
                    _deviceInfoCallbacks = [];
                    callbacks.forEach(function(cb) { cb(_deviceInfo); });
                });
            } catch (e) {
                console.error('[DeviceProfile] Error loading webOS deviceInfo:', e);
                _deviceInfo = {};
                _deviceInfoLoaded = true;
                
                var callbacks = _deviceInfoCallbacks.slice();
                _deviceInfoCallbacks = [];
                callbacks.forEach(function(cb) { cb(_deviceInfo); });
            }
        } else {
            console.warn('[DeviceProfile] webOS.deviceInfo not available');
            _deviceInfo = {};
            _deviceInfoLoaded = true;
            
            var callbacks = _deviceInfoCallbacks.slice();
            _deviceInfoCallbacks = [];
            callbacks.forEach(function(cb) { cb(_deviceInfo); });
        }
    }

    function getDeviceInfo() {
        return _deviceInfo || {};
    }

    function canPlayH264(videoTestElement) {
        return !!(videoTestElement.canPlayType &&
            videoTestElement.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"').replace(/no/, ''));
    }
    
    function canPlayHevc(videoTestElement) {
        var browser = detectBrowser();
        // webOS always supports HEVC
        if (browser.web0s) {
            return true;
        }
        
        return !!(videoTestElement.canPlayType &&
            (videoTestElement.canPlayType('video/mp4; codecs="hvc1.1.L120"').replace(/no/, '') ||
             videoTestElement.canPlayType('video/mp4; codecs="hev1.1.L120"').replace(/no/, '') ||
             videoTestElement.canPlayType('video/mp4; codecs="hvc1.1.0.L120"').replace(/no/, '') ||
             videoTestElement.canPlayType('video/mp4; codecs="hev1.1.0.L120"').replace(/no/, '')));
    }
    
    function canPlayAv1(videoTestElement) {
        var browser = detectBrowser();
        if (browser.web0sVersion >= 5) {
            return true;
        }
        
        return !!(videoTestElement.canPlayType &&
            videoTestElement.canPlayType('video/mp4; codecs="av01.0.15M.08"').replace(/no/, '') &&
            videoTestElement.canPlayType('video/mp4; codecs="av01.0.15M.10"').replace(/no/, ''));
    }
    
    function canPlayNativeHls() {
        var media = document.createElement('video');
        return !!(media.canPlayType('application/x-mpegURL').replace(/no/, '') ||
                  media.canPlayType('application/vnd.apple.mpegURL').replace(/no/, ''));
    }
    
    function canPlayNativeHlsInFmp4() {
        var browser = detectBrowser();
        // webOS 5+ native player supports fMP4-HLS
        // webOS 4 uses hls.js which also supports fMP4-HLS
        // So all webOS 4+ can use fMP4-HLS (via hls.js on 4, native on 5+)
        if (browser.web0s) {
            return browser.web0sVersion >= 4;
        }
        return false;
    }
    
    function canPlayHls() {
        return canPlayNativeHls() || (window.MediaSource != null);
    }
    
    function supportsAc3(videoTestElement) {
        var browser = detectBrowser();
        if (browser.web0s) {
            return true;
        }
        return !!(videoTestElement.canPlayType('audio/mp4; codecs="ac-3"').replace(/no/, ''));
    }
    
    function supportsEac3(videoTestElement) {
        var browser = detectBrowser();
        if (browser.web0s) {
            return true;
        }
        return !!(videoTestElement.canPlayType('audio/mp4; codecs="ec-3"').replace(/no/, ''));
    }
    
    function supportsAc3InHls(videoTestElement) {
        var browser = detectBrowser();
        if (browser.web0s) {
            return true;
        }
        return !!(videoTestElement.canPlayType &&
            (videoTestElement.canPlayType('application/x-mpegurl; codecs="avc1.42E01E, ac-3"').replace(/no/, '') ||
             videoTestElement.canPlayType('application/vnd.apple.mpegURL; codecs="avc1.42E01E, ac-3"').replace(/no/, '')));
    }
    
    /**
     * Check DTS support
     * Per jellyfin-web: DTS is NOT supported on webOS 5.0-22
     */
    function canPlayDts(videoTestElement) {
        var browser = detectBrowser();
        // DTS not supported on webOS 5, 6, 22
        if (browser.web0sVersion >= 5 && browser.web0sVersion < 23) {
            return false;
        }
        
        if (videoTestElement.canPlayType('video/mp4; codecs="dts-"').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mp4; codecs="dts+"').replace(/no/, '')) {
            return true;
        }
        
        // webOS 4 and earlier support DTS
        return browser.web0sVersion <= 4;
    }
    
    function canPlayAudioFormat(format) {
        var browser = detectBrowser();
        var typeString;
        
        if (format === 'flac' || format === 'asf') {
            if (browser.web0s) return true;
        }
        
        if (format === 'opus') {
            if (browser.web0s) {
                return browser.web0sVersion >= 3.5;
            }
            typeString = 'audio/ogg; codecs="opus"';
        }
        
        if (format === 'webma') {
            typeString = 'audio/webm';
        } else if (format === 'mp2') {
            typeString = 'audio/mpeg';
        } else if (!typeString) {
            typeString = 'audio/' + format;
        }
        
        return !!document.createElement('audio').canPlayType(typeString).replace(/no/, '');
    }
    
    /**
     * MKV container support
     * 
     * webOS TV hardware natively supports MKV containers with H.264, HEVC, 
     * AC3, EAC3, AAC, etc. - confirmed by LG's official documentation:
     * https://webostv.developer.lge.com/develop/specifications/video-audio-230
     * 
     * HOWEVER, the HTML5 video element's canPlayType() does NOT report MKV support
     * because the browser engine (Chrome 53 on webOS 4) doesn't decode MKV itself.
     * 
     * When we set video.src to an MKV URL, webOS routes it to the native media
     * pipeline which CAN decode MKV. This is similar to how Tizen uses AVPlay
     * to access native decoder capabilities beyond what the browser reports.
     * 
     * For webOS 4+, we return TRUE to enable DirectPlay of MKV files.
     * This avoids unnecessary HLS transcoding which causes issues with
     * AC3/EAC3 audio codecs on webOS 4.
     */
    function testCanPlayMkv(videoTestElement) {
        var browser = detectBrowser();
        
        // Check actual browser support first
        if (videoTestElement.canPlayType('video/x-matroska').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mkv').replace(/no/, '')) {
            console.log('[DeviceProfile] MKV supported (browser reports support)');
            return true;
        }
        
        // webOS 4+ natively supports MKV via hardware decoder
        // Even though canPlayType returns empty, setting video.src to MKV URL works
        // because webOS routes it to the native media pipeline
        if (browser.web0s && browser.web0sVersion >= 4) {
            console.log('[DeviceProfile] MKV enabled for webOS ' + browser.web0sVersion + ' (native hardware support)');
            return true;
        }
        
        console.log('[DeviceProfile] MKV not supported on this platform');
        return false;
    }
    
    function testCanPlayTs() {
        var browser = detectBrowser();
        return browser.web0s;
    }
    
    function supportsMpeg2Video() {
        var browser = detectBrowser();
        return browser.web0s;
    }
    
    function supportsVc1(videoTestElement) {
        var browser = detectBrowser();
        return browser.web0s || !!(videoTestElement.canPlayType('video/mp4; codecs="vc-1"').replace(/no/, ''));
    }
    
    function supportsHdr10() {
        var browser = detectBrowser();
        var deviceInfo = getDeviceInfo();
        
        // Use deviceInfo if available
        if (deviceInfo && typeof deviceInfo.hdr10 !== 'undefined') {
            return deviceInfo.hdr10 === true;
        }
        
        // webOS 4+ generally supports HDR10
        return browser.web0s && browser.web0sVersion >= 4;
    }
    
    function supportsHlg() {
        return supportsHdr10();
    }
    
    function supportsDolbyVision() {
        var deviceInfo = getDeviceInfo();
        
        if (deviceInfo && typeof deviceInfo.dolbyVision !== 'undefined') {
            return deviceInfo.dolbyVision === true;
        }
        
        return false;
    }
    
    function supportedDolbyVisionProfilesHevc(videoTestElement) {
        var browser = detectBrowser();
        var supportedProfiles = [];
        
        if (videoTestElement.canPlayType) {
            if (videoTestElement.canPlayType('video/mp4; codecs="dvh1.05.06"').replace(/no/, '')) {
                supportedProfiles.push(5);
            }
            if (videoTestElement.canPlayType('video/mp4; codecs="dvh1.08.06"').replace(/no/, '') ||
                browser.web0sVersion >= 4) {
                supportedProfiles.push(8);
            }
        }
        
        return supportedProfiles;
    }
    
    /**
     * Check if secondary audio tracks are supported
     * Per jellyfin-web: webOS 4.0+ supports secondary audio
     */
    function canPlaySecondaryAudio(videoTestElement) {
        var browser = detectBrowser();
        return !!videoTestElement.audioTracks && (browser.web0sVersion >= 4.0 || !browser.web0sVersion);
    }
    
    // ========== Profile Helper Functions ==========
    
    function getMaxBitrate() {
        return 120000000;
    }
    
    function getPhysicalAudioChannels(videoTestElement) {
        var browser = detectBrowser();
        var isAc3Eac3Supported = supportsAc3(videoTestElement) || supportsEac3(videoTestElement);
        
        // webOS TVs support surround sound
        if (isAc3Eac3Supported && browser.tv) {
            return 6;
        }
        
        return 2;
    }
    
    function getDirectPlayProfileForVideoContainer(container, videoAudioCodecs, videoTestElement) {
        var browser = detectBrowser();
        var supported = false;
        var profileContainer = container;
        var videoCodecs = [];
        
        switch (container) {
            case 'asf':
            case 'wmv':
                supported = browser.web0s;
                videoAudioCodecs = [];
                break;
            case 'avi':
                supported = browser.web0s;
                break;
            case 'mpg':
            case 'mpeg':
                supported = browser.web0s;
                break;
            case 'mov':
                supported = browser.web0s;
                videoCodecs.push('h264');
                break;
            case 'm2ts':
                supported = browser.web0s;
                videoCodecs.push('h264');
                if (supportsVc1(videoTestElement)) {
                    videoCodecs.push('vc1');
                }
                if (supportsMpeg2Video()) {
                    videoCodecs.push('mpeg2video');
                }
                break;
            case 'ts':
                supported = testCanPlayTs();
                videoCodecs.push('h264');
                if (browser.web0s && canPlayHevc(videoTestElement)) {
                    videoCodecs.push('hevc');
                }
                if (supportsVc1(videoTestElement)) {
                    videoCodecs.push('vc1');
                }
                if (supportsMpeg2Video()) {
                    videoCodecs.push('mpeg2video');
                }
                profileContainer = 'ts,mpegts';
                break;
            default:
                break;
        }
        
        return supported ? {
            Container: profileContainer,
            Type: 'Video',
            VideoCodec: videoCodecs.join(','),
            AudioCodec: videoAudioCodecs.join(',')
        } : null;
    }

    function buildProfile(options) {
        options = options || {};
        
        var browser = detectBrowser();
        var bitrateSetting = getMaxBitrate();
        var videoTestElement = getVideoTestElement();
        var physicalAudioChannels = getPhysicalAudioChannels(videoTestElement);
        
        var canPlayVp8 = !!(videoTestElement.canPlayType('video/webm; codecs="vp8"').replace(/no/, ''));
        var canPlayVp9 = !!(videoTestElement.canPlayType('video/webm; codecs="vp9"').replace(/no/, ''));
        var webmAudioCodecs = ['vorbis'];
        
        var canPlayMkv = testCanPlayMkv(videoTestElement);
        
        var profile = {
            MaxStreamingBitrate: bitrateSetting,
            MaxStaticBitrate: 100000000,
            MusicStreamingTranscodingBitrate: Math.min(bitrateSetting, 384000),
            DirectPlayProfiles: []
        };
        
        var videoAudioCodecs = [];
        var hlsInTsVideoAudioCodecs = [];
        var hlsInFmp4VideoAudioCodecs = [];
        
        var supportsMp3VideoAudio = !!(videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.69"').replace(/no/, '') ||
                                       videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.6B"').replace(/no/, '') ||
                                       videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp3"').replace(/no/, ''));
        
        var supportsMp2VideoAudio = browser.web0s;
        
        // AAC support check
        var canPlayAacVideoAudio = !!(videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.2"').replace(/no/, ''));
        var canPlayAc3VideoAudio = supportsAc3(videoTestElement);
        var canPlayEac3VideoAudio = supportsEac3(videoTestElement);
        var canPlayAc3VideoAudioInHls = supportsAc3InHls(videoTestElement);
        
        if (canPlayAacVideoAudio) {
            videoAudioCodecs.push('aac');
            hlsInTsVideoAudioCodecs.push('aac');
            hlsInFmp4VideoAudioCodecs.push('aac');
        }
        
        if (supportsMp3VideoAudio) {
            videoAudioCodecs.push('mp3');
        }
        
        if (browser.web0s || supportsMp3VideoAudio) {
            hlsInTsVideoAudioCodecs.push('mp3');
        }
        
        if (canPlayAc3VideoAudio) {
            videoAudioCodecs.push('ac3');
            
            if (canPlayEac3VideoAudio) {
                videoAudioCodecs.push('eac3');
            }
            
            if (canPlayAc3VideoAudioInHls) {
                hlsInTsVideoAudioCodecs.push('ac3');
                hlsInFmp4VideoAudioCodecs.push('ac3');
                
                if (canPlayEac3VideoAudio) {
                    hlsInTsVideoAudioCodecs.push('eac3');
                    hlsInFmp4VideoAudioCodecs.push('eac3');
                }
            }
        }
        
        if (supportsMp2VideoAudio) {
            videoAudioCodecs.push('mp2');
            hlsInTsVideoAudioCodecs.push('mp2');
            hlsInFmp4VideoAudioCodecs.push('mp2');
        }
        
        var supportsDts = canPlayDts(videoTestElement);
        if (supportsDts) {
            videoAudioCodecs.push('dca');
            videoAudioCodecs.push('dts');
        }
        
        if (browser.web0s) {
            videoAudioCodecs.push('pcm_s16le');
            videoAudioCodecs.push('pcm_s24le');
        }
        
        // CRITICAL: AC3/EAC3 in HLS TS causes playback failures on webOS 4
        // Only AAC is reliable for HLS TS transcoding on webOS 4
        // AC3/EAC3 can be used for DirectPlay/DirectStream and HLS fMP4 on webOS 5+
        if (browser.web0sVersion === 4) {
            console.log('[DeviceProfile] webOS 4 detected - excluding AC3/EAC3 from HLS TS TranscodingProfile');
        }
        
        if (canPlayAudioFormat('opus')) {
            videoAudioCodecs.push('opus');
            webmAudioCodecs.push('opus');
            hlsInFmp4VideoAudioCodecs.push('opus');
        }
        
        if (canPlayAudioFormat('flac')) {
            videoAudioCodecs.push('flac');
            hlsInFmp4VideoAudioCodecs.push('flac');
        }
        
        if (canPlayAudioFormat('alac')) {
            videoAudioCodecs.push('alac');
            hlsInFmp4VideoAudioCodecs.push('alac');
        }
        
        var mp4VideoCodecs = [];
        var webmVideoCodecs = [];
        var hlsInTsVideoCodecs = [];
        var hlsInFmp4VideoCodecs = [];
        
        if (canPlayAv1(videoTestElement) && !browser.mobile) {
            hlsInFmp4VideoCodecs.push('av1');
        }
        
        if (canPlayHevc(videoTestElement) && browser.web0s) {
            hlsInFmp4VideoCodecs.push('hevc');
        }
        
        if (canPlayH264(videoTestElement)) {
            mp4VideoCodecs.push('h264');
            hlsInTsVideoCodecs.push('h264');
            hlsInFmp4VideoCodecs.push('h264');
        }
        
        if (canPlayHevc(videoTestElement)) {
            mp4VideoCodecs.push('hevc');
            if (browser.web0s) {
                hlsInTsVideoCodecs.push('hevc');
            }
        }
        
        if (supportsMpeg2Video()) {
            mp4VideoCodecs.push('mpeg2video');
        }
        
        if (supportsVc1(videoTestElement)) {
            mp4VideoCodecs.push('vc1');
        }
        
        if (canPlayVp8) {
            webmVideoCodecs.push('vp8');
        }
        
        if (canPlayVp9) {
            mp4VideoCodecs.push('vp9');
            webmVideoCodecs.push('vp9');
            hlsInFmp4VideoCodecs.push('vp9');
        }
        
        if (canPlayAv1(videoTestElement)) {
            mp4VideoCodecs.push('av1');
            webmVideoCodecs.push('av1');
        }
        
        if (canPlayVp8) {
            videoAudioCodecs.push('vorbis');
        }
        
        if (webmVideoCodecs.length) {
            profile.DirectPlayProfiles.push({
                Container: 'webm',
                Type: 'Video',
                VideoCodec: webmVideoCodecs.join(','),
                AudioCodec: webmAudioCodecs.join(',')
            });
        }
        
        if (mp4VideoCodecs.length) {
            profile.DirectPlayProfiles.push({
                Container: 'mp4,m4v',
                Type: 'Video',
                VideoCodec: mp4VideoCodecs.join(','),
                AudioCodec: videoAudioCodecs.join(',')
            });
        }
        
        if (canPlayMkv && mp4VideoCodecs.length) {
            profile.DirectPlayProfiles.push({
                Container: 'mkv',
                Type: 'Video',
                VideoCodec: mp4VideoCodecs.join(','),
                AudioCodec: videoAudioCodecs.join(',')
            });
        }
        
        ['m2ts', 'wmv', 'ts', 'asf', 'avi', 'mpg', 'mpeg', 'mov'].forEach(function(container) {
            var containerProfile = getDirectPlayProfileForVideoContainer(container, videoAudioCodecs, videoTestElement);
            if (containerProfile) {
                profile.DirectPlayProfiles.push(containerProfile);
            }
        });
        
        ['opus', 'mp3', 'mp2', 'aac', 'flac', 'alac', 'webma', 'wma', 'wav', 'ogg', 'oga'].filter(canPlayAudioFormat).forEach(function(audioFormat) {
            profile.DirectPlayProfiles.push({
                Container: audioFormat,
                Type: 'Audio'
            });
            
            if (audioFormat === 'opus' || audioFormat === 'webma') {
                profile.DirectPlayProfiles.push({
                    Container: 'webm',
                    AudioCodec: audioFormat,
                    Type: 'Audio'
                });
            }
            
            if (audioFormat === 'aac' || audioFormat === 'alac') {
                profile.DirectPlayProfiles.push({
                    Container: 'm4a',
                    AudioCodec: audioFormat,
                    Type: 'Audio'
                });
                profile.DirectPlayProfiles.push({
                    Container: 'm4b',
                    AudioCodec: audioFormat,
                    Type: 'Audio'
                });
            }
        });
        
        profile.TranscodingProfiles = [];
        
        var hlsBreakOnNonKeyFrames = !canPlayNativeHls();
        var enableFmp4Hls = canPlayNativeHlsInFmp4();
        
        if (canPlayHls()) {
            profile.TranscodingProfiles.push({
                Container: enableFmp4Hls ? 'mp4' : 'ts',
                Type: 'Audio',
                AudioCodec: 'aac',
                Context: 'Streaming',
                Protocol: 'hls',
                MaxAudioChannels: physicalAudioChannels.toString(),
                MinSegments: '1',
                BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames
            });
        }
        
        ['aac', 'mp3', 'opus', 'wav'].filter(canPlayAudioFormat).forEach(function(audioFormat) {
            profile.TranscodingProfiles.push({
                Container: audioFormat,
                Type: 'Audio',
                AudioCodec: audioFormat,
                Context: 'Streaming',
                Protocol: 'http',
                MaxAudioChannels: physicalAudioChannels.toString()
            });
        });
        
        if (canPlayHls()) {
            // HLS in fMP4 - webOS 4+ supports this (webOS 4 via hls.js, webOS 5+ native)
            // fMP4 is preferred over TS when available
            if (hlsInFmp4VideoCodecs.length && hlsInFmp4VideoAudioCodecs.length && enableFmp4Hls) {
                // Apply AC3/EAC3 restriction for webOS 4 (hls.js doesn't support AC3/EAC3)
                var fmp4AudioCodecs = hlsInFmp4VideoAudioCodecs;
                if (browser.web0sVersion === 4) {
                    // webOS 4 with hls.js: Only AAC and MP3 (hls.js limitation)
                    fmp4AudioCodecs = ['aac', 'mp3'].filter(function(codec) {
                        return hlsInFmp4VideoAudioCodecs.indexOf(codec) !== -1;
                    });
                    console.log('[DeviceProfile] webOS 4: HLS fMP4 audio limited to:', fmp4AudioCodecs.join(','));
                }
                
                profile.DirectPlayProfiles.push({
                    Container: 'hls',
                    Type: 'Video',
                    VideoCodec: hlsInFmp4VideoCodecs.join(','),
                    AudioCodec: fmp4AudioCodecs.join(',')
                });
                
                profile.TranscodingProfiles.push({
                    Container: 'mp4',
                    Type: 'Video',
                    AudioCodec: fmp4AudioCodecs.join(','),
                    VideoCodec: hlsInFmp4VideoCodecs.join(','),
                    Context: 'Streaming',
                    Protocol: 'hls',
                    MaxAudioChannels: physicalAudioChannels.toString(),
                    MinSegments: '1',
                    BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames
                });
            }
            
            // HLS in TS (primary for webOS)
            if (hlsInTsVideoCodecs.length && hlsInTsVideoAudioCodecs.length) {
                // CRITICAL: webOS 4 requires AAC-only for HLS TS
                // AC3/EAC3 in HLS TS causes video stalling/0x0 dimensions on webOS 4
                // This applies to BOTH DirectPlay and Transcoding profiles!
                var hlsTsAudioCodecs = hlsInTsVideoAudioCodecs;
                if (browser.web0sVersion === 4) {
                    // webOS 4: Only AAC and MP3 for ALL HLS TS audio
                    hlsTsAudioCodecs = ['aac', 'mp3'].filter(function(codec) {
                        return hlsInTsVideoAudioCodecs.indexOf(codec) !== -1;
                    });
                    console.log('[DeviceProfile] webOS 4: HLS TS audio limited to:', hlsTsAudioCodecs.join(','));
                }
                
                // DirectPlay profile - tells server what codecs can be passed through
                profile.DirectPlayProfiles.push({
                    Container: 'hls',
                    Type: 'Video',
                    VideoCodec: hlsInTsVideoCodecs.join(','),
                    AudioCodec: hlsTsAudioCodecs.join(',')
                });
                
                // Transcoding profile - tells server what codecs to transcode TO
                profile.TranscodingProfiles.push({
                    Container: 'ts',
                    Type: 'Video',
                    AudioCodec: hlsTsAudioCodecs.join(','),
                    VideoCodec: hlsInTsVideoCodecs.join(','),
                    Context: 'Streaming',
                    Protocol: 'hls',
                    MaxAudioChannels: physicalAudioChannels.toString(),
                    MinSegments: '1',
                    BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames
                });
            }
        }
        
        profile.CodecProfiles = [];
        
        var supportsSecondaryAudio = canPlaySecondaryAudio(videoTestElement);
        
        var aacCodecProfileConditions = [];
        
        // HE-AAC check
        if (!videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.5"').replace(/no/, '')) {
            aacCodecProfileConditions.push({
                Condition: 'NotEquals',
                Property: 'AudioProfile',
                Value: 'HE-AAC'
            });
        }
        
        if (!supportsSecondaryAudio) {
            aacCodecProfileConditions.push({
                Condition: 'Equals',
                Property: 'IsSecondaryAudio',
                Value: 'false',
                IsRequired: false
            });
        }
        
        if (aacCodecProfileConditions.length) {
            profile.CodecProfiles.push({
                Type: 'VideoAudio',
                Codec: 'aac',
                Conditions: aacCodecProfileConditions
            });
        }
        
        if (!supportsSecondaryAudio) {
            profile.CodecProfiles.push({
                Type: 'VideoAudio',
                Conditions: [{
                    Condition: 'Equals',
                    Property: 'IsSecondaryAudio',
                    Value: 'false',
                    IsRequired: false
                }]
            });
        }
        
        if (browser.web0s) {
            profile.CodecProfiles.push({
                Type: 'VideoAudio',
                Codec: 'flac',
                Conditions: [{
                    Condition: 'LessThanEqual',
                    Property: 'AudioChannels',
                    Value: '2',
                    IsRequired: false
                }]
            });
        }
        
        var maxH264Level = 42;
        var h264Profiles = 'high|main|baseline|constrained baseline';
        
        if (browser.web0s || videoTestElement.canPlayType('video/mp4; codecs="avc1.640833"').replace(/no/, '')) {
            maxH264Level = 51;
        }
        
        var maxHevcLevel = 120;
        var hevcProfiles = 'main';
        
        if (videoTestElement.canPlayType('video/mp4; codecs="hvc1.1.4.L123"').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mp4; codecs="hev1.1.4.L123"').replace(/no/, '')) {
            maxHevcLevel = 123;
        }
        
        if (videoTestElement.canPlayType('video/mp4; codecs="hvc1.2.4.L123"').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mp4; codecs="hev1.2.4.L123"').replace(/no/, '')) {
            maxHevcLevel = 123;
            hevcProfiles = 'main|main 10';
        }
        
        if (videoTestElement.canPlayType('video/mp4; codecs="hvc1.2.4.L153"').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mp4; codecs="hev1.2.4.L153"').replace(/no/, '')) {
            maxHevcLevel = 153;
            hevcProfiles = 'main|main 10';
        }
        
        if (videoTestElement.canPlayType('video/mp4; codecs="hvc1.2.4.L183"').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mp4; codecs="hev1.2.4.L183"').replace(/no/, '')) {
            maxHevcLevel = 183;
            hevcProfiles = 'main|main 10';
        }
        
        // webOS 4+ can decode HEVC regardless of canPlayType results
        // The hardware decoder supports main/main10 profiles and Dolby Vision profiles
        // Add DV profile identifiers for the CodecProfile VideoProfile condition
        if (browser.web0s && browser.web0sVersion >= 4) {
            hevcProfiles = 'main|main 10';
            maxHevcLevel = 183;  // webOS 4 hardware supports up to 6.1
            console.log('[DeviceProfile] webOS ' + browser.web0sVersion + ': Forcing HEVC profile support (main/main10, level 183)');
        }
        
        var h264VideoRangeTypes = 'SDR';
        var hevcVideoRangeTypes = 'SDR';
        var av1VideoRangeTypes = 'SDR';
        
        // webOS 4+ hardware decoder can decode HDR content regardless of display HDR support
        // The TV will tonemap HDR to SDR if the display doesn't support HDR
        // This allows DirectPlay of HDR content without transcoding
        // Also add ALL Dolby Vision types - webOS can decode the underlying HEVC stream
        // even if it can't display DV metadata properly
        if (browser.web0s && browser.web0sVersion >= 4) {
            console.log('[DeviceProfile] webOS ' + browser.web0sVersion + ': Enabling HDR decode (will tonemap if display is SDR)');
            hevcVideoRangeTypes += '|HDR10|HDR10Plus|HLG';
            av1VideoRangeTypes += '|HDR10|HDR10Plus|HLG';
            
            // Add ALL Dolby Vision variants - webOS can decode the HEVC stream
            // For Profile 5 (DOVI): decodes as standard HEVC, ignores DV metadata
            // For Profile 7 (DOVIWithEL): plays base layer
            // For Profile 8 (DOVIWithHDR10, etc.): plays HDR10/HLG/SDR base layer
            console.log('[DeviceProfile] webOS ' + browser.web0sVersion + ': Enabling all DV types (decodes as HEVC/HDR10)');
            hevcVideoRangeTypes += '|DOVI|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR|DOVIWithHDR10Plus';
            hevcVideoRangeTypes += '|DOVIWithEL|DOVIWithELHDR10Plus|DOVIInvalid';
        } else if (supportsHdr10()) {
            hevcVideoRangeTypes += '|HDR10|HDR10Plus';
            av1VideoRangeTypes += '|HDR10|HDR10Plus';
            
            if (supportsHlg()) {
                hevcVideoRangeTypes += '|HLG';
                av1VideoRangeTypes += '|HLG';
            }
        }
        
        if (supportsDolbyVision()) {
            var dvProfiles = supportedDolbyVisionProfilesHevc(videoTestElement);
            if (dvProfiles.indexOf(5) !== -1) {
                hevcVideoRangeTypes += '|DOVI';
            }
            if (dvProfiles.indexOf(8) !== -1) {
                hevcVideoRangeTypes += '|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR|DOVIWithHDR10Plus';
            }
            
            // webOS can play fallback of some DV profiles
            if (browser.web0s) {
                hevcVideoRangeTypes += '|DOVIWithEL|DOVIWithELHDR10Plus|DOVIInvalid';
            }
        }
        
        var h264CodecProfileConditions = [
            {
                Condition: 'EqualsAny',
                Property: 'VideoProfile',
                Value: h264Profiles,
                IsRequired: false
            },
            {
                Condition: 'EqualsAny',
                Property: 'VideoRangeType',
                Value: h264VideoRangeTypes,
                IsRequired: false
            },
            {
                Condition: 'LessThanEqual',
                Property: 'VideoLevel',
                Value: maxH264Level.toString(),
                IsRequired: false
            }
        ];
        
        var hevcCodecProfileConditions = [
            {
                Condition: 'EqualsAny',
                Property: 'VideoProfile',
                Value: hevcProfiles,
                IsRequired: false
            },
            {
                Condition: 'EqualsAny',
                Property: 'VideoRangeType',
                Value: hevcVideoRangeTypes,
                IsRequired: false
            },
            {
                Condition: 'LessThanEqual',
                Property: 'VideoLevel',
                Value: maxHevcLevel.toString(),
                IsRequired: false
            }
        ];
        
        // webOS supports interlaced video (no need to block it)
        // Per jellyfin-web: !browser.edgeUwp && !browser.tizen && !browser.web0s
        // So we DON'T add IsInterlaced condition for webOS
        
        profile.CodecProfiles.push({
            Type: 'Video',
            Codec: 'h264',
            Conditions: h264CodecProfileConditions
        });
        
        // Dolby Vision container restriction for webOS
        if (browser.web0s && supportsDolbyVision()) {
            var nonDoviRangeTypes = hevcVideoRangeTypes.split('|').filter(function(v) {
                return !v.startsWith('DOVI');
            }).join('|');
            
            profile.CodecProfiles.push({
                Type: 'Video',
                Container: '-mp4,ts',
                Codec: 'hevc',
                Conditions: [{
                    Condition: 'EqualsAny',
                    Property: 'VideoRangeType',
                    Value: nonDoviRangeTypes,
                    IsRequired: false
                }]
            });
        }
        
        profile.CodecProfiles.push({
            Type: 'Video',
            Codec: 'hevc',
            Conditions: hevcCodecProfileConditions
        });
        
        if (canPlayVp9) {
            profile.CodecProfiles.push({
                Type: 'Video',
                Codec: 'vp9',
                Conditions: [{
                    Condition: 'EqualsAny',
                    Property: 'VideoRangeType',
                    Value: 'SDR' + (supportsHdr10() ? '|HDR10|HDR10Plus' : '') + (supportsHlg() ? '|HLG' : ''),
                    IsRequired: false
                }]
            });
        }
        
        if (canPlayAv1(videoTestElement)) {
            profile.CodecProfiles.push({
                Type: 'Video',
                Codec: 'av1',
                Conditions: [
                    {
                        Condition: 'EqualsAny',
                        Property: 'VideoProfile',
                        Value: 'main',
                        IsRequired: false
                    },
                    {
                        Condition: 'EqualsAny',
                        Property: 'VideoRangeType',
                        Value: av1VideoRangeTypes,
                        IsRequired: false
                    }
                ]
            });
        }
        
        // ========== Build SubtitleProfiles ==========
        // Text-based subtitles (srt, vtt, ass, ssa) can be delivered externally as WebVTT
        // This allows DirectPlay of video while subtitles are fetched separately
        // Image-based subtitles (pgs, dvdsub, dvbsub) must be burned in (Encode)
        // 
        // IMPORTANT: Using 'External' for text subs prevents the server from
        // forcing transcode just because subtitles are enabled
        
        profile.SubtitleProfiles = [
            // Text-based subtitles - deliver externally (converted to WebVTT by server)
            { Format: 'vtt', Method: 'External' },
            { Format: 'srt', Method: 'External' },
            { Format: 'subrip', Method: 'External' },  // Same as srt
            { Format: 'ass', Method: 'External' },
            { Format: 'ssa', Method: 'External' },
            { Format: 'sub', Method: 'External' },
            { Format: 'smi', Method: 'External' },
            { Format: 'ttml', Method: 'External' },
            
            // Image-based subtitles - must be burned in (no native support)
            { Format: 'idx', Method: 'Encode' },
            { Format: 'pgs', Method: 'Encode' },
            { Format: 'pgssub', Method: 'Encode' },
            { Format: 'dvdsub', Method: 'Encode' },
            { Format: 'dvbsub', Method: 'Encode' }
        ];
        
        // ========== Response Profiles ==========
        
        profile.ResponseProfiles = [
            {
                Type: 'Video',
                Container: 'm4v',
                MimeType: 'video/mp4'
            }
        ];
        
        profile.ContainerProfiles = [];
        
        if (!testCanPlayMkv(videoTestElement)) {
            profile.ContainerProfiles.push({
                Type: 'Video',
                Container: 'mkv',
                Conditions: [
                    {
                        Condition: 'NotEquals',
                        Property: 'SupportsDirectPlay',
                        Value: 'true',
                        IsRequired: true
                    }
                ]
            });
            console.log('[DeviceProfile] MKV remux to MP4 enabled for DirectStream');
        }
        
        return profile;
    }

    function init(callback) {
        console.log('[DeviceProfile] Initializing...');
        loadDeviceInfo(function(deviceInfo) {
            console.log('[DeviceProfile] Initialization complete');
            if (callback) callback(deviceInfo);
        });
    }
    
    function getProfile(options) {
        var profile = buildProfile(options);
        
        console.log('[DeviceProfile] ========== Device Profile Summary ==========');
        console.log('[DeviceProfile] webOS Version:', detectBrowser().web0sVersion);
        console.log('[DeviceProfile] Native HLS fMP4 support:', canPlayNativeHlsInFmp4());
        console.log('[DeviceProfile] TranscodingProfiles:');
        profile.TranscodingProfiles.forEach(function(tp, idx) {
            console.log('[DeviceProfile]   ' + (idx + 1) + '. ' + tp.Type + ' - Container: ' + tp.Container + 
                       ', Protocol: ' + tp.Protocol + ', VideoCodec: ' + (tp.VideoCodec || 'N/A') + 
                       ', AudioCodec: ' + (tp.AudioCodec || 'N/A'));
        });
        console.log('[DeviceProfile] DirectPlayProfiles count:', profile.DirectPlayProfiles.length);
        console.log('[DeviceProfile] =============================================');
        console.log('[DeviceProfile] Full profile:', JSON.stringify(profile, null, 2));
        
        return profile;
    }
    
    function getCapabilities() {
        var browser = detectBrowser();
        var videoTestElement = getVideoTestElement();
        
        return {
            webosVersion: browser.web0sVersion,
            h264: canPlayH264(videoTestElement),
            hevc: canPlayHevc(videoTestElement),
            av1: canPlayAv1(videoTestElement),
            hdr10: supportsHdr10(),
            hlg: supportsHlg(),
            dolbyVision: supportsDolbyVision(),
            ac3: supportsAc3(videoTestElement),
            eac3: supportsEac3(videoTestElement),
            dts: canPlayDts(videoTestElement),
            nativeHls: canPlayNativeHls(),
            nativeHlsFmp4: canPlayNativeHlsInFmp4(),
            mkv: testCanPlayMkv(videoTestElement),
            secondaryAudio: canPlaySecondaryAudio(videoTestElement)
        };
    }
    
    /**
     * Determine if native HLS should be used instead of HLS.js
     * Per jellyfin-web htmlMediaHelper.js: webOS uses native HLS, NOT hls.js
     * Native players on webOS support seeking live streams natively.
     * EXCEPTION: webOS 4 native HLS has issues with certain transcoded streams,
     * so we use hls.js on webOS 4 if MediaSource is available.
     * @returns {boolean} True if native HLS should be used
     */
    function shouldUseNativeHls() {
        var browser = detectBrowser();
        // webOS 5+ uses native HLS player
        // webOS 4 has issues with native HLS for transcoding - prefer hls.js if available
        if (browser.web0s) {
            if (browser.web0sVersion === 4 && window.MediaSource != null) {
                console.log('[DeviceProfile] webOS 4: Using hls.js instead of native HLS');
                return false;
            }
            return true;
        }
        return false;
    }
    
    /**
     * Determine if HLS.js should be used
     * Per jellyfin-web: webOS should NOT use HLS.js - native is preferred
     * EXCEPTION: webOS 4 uses hls.js because native HLS has issues
     * @returns {boolean} True if HLS.js should be used
     */
    function shouldUseHlsJs() {
        var browser = detectBrowser();
        // webOS 4: use hls.js if MediaSource is available
        if (browser.web0s && browser.web0sVersion === 4 && window.MediaSource != null) {
            return true;
        }
        // webOS 5+: use native HLS
        if (browser.web0s) {
            return false;
        }
        // Other browsers: use hls.js if available
        return true;
    }
    
    /**
     * Recommend a play method for a given media source
     * @param {Object} mediaSource - Media source from PlaybackInfo
     * @returns {string} 'DirectPlay', 'DirectStream', or 'Transcode'
     */
    function getPlayMethod(mediaSource) {
        if (!mediaSource) return 'Transcode';
        
        var browser = detectBrowser();
        var videoTestElement = getVideoTestElement();
        
        // Check for MKV - we can't DirectPlay without NativeShell
        if (mediaSource.Container && mediaSource.Container.toLowerCase() === 'mkv') {
            if (!testCanPlayMkv(videoTestElement)) {
                console.log('[DeviceProfile] MKV container not supported for DirectPlay');
                return mediaSource.SupportsDirectStream ? 'DirectStream' : 'Transcode';
            }
        }
        
        // Check video codec compatibility
        var videoStream = mediaSource.MediaStreams ? 
            mediaSource.MediaStreams.find(function(s) { return s.Type === 'Video'; }) : null;
        
        if (videoStream) {
            var codec = (videoStream.Codec || '').toLowerCase();
            
            // HEVC - always supported on webOS
            if (codec === 'hevc' || codec.startsWith('hev1') || codec.startsWith('hvc1')) {
                if (!canPlayHevc(videoTestElement)) {
                    return 'Transcode';
                }
            }
            
            // AV1 - only webOS 5+
            if (codec === 'av1') {
                if (!canPlayAv1(videoTestElement)) {
                    return 'Transcode';
                }
            }
            
            // HDR/DV content - check device support
            if (videoStream.VideoRangeType) {
                var rangeType = videoStream.VideoRangeType;
                if (rangeType.includes('HDR10') && !supportsHdr10()) {
                    console.log('[DeviceProfile] HDR10 content but device may not support it');
                    // Could still DirectPlay if TV handles tonemapping
                }
                if (rangeType.includes('DOVI') && !supportsDolbyVision()) {
                    console.log('[DeviceProfile] Dolby Vision content but device may not support it');
                    // Could still DirectPlay for DV with HDR10 fallback (profile 8)
                }
            }
        }
        
        // Check audio codec compatibility
        var audioStream = mediaSource.MediaStreams ? 
            mediaSource.MediaStreams.find(function(s) { return s.Type === 'Audio'; }) : null;
        
        if (audioStream) {
            var audioCodec = (audioStream.Codec || '').toLowerCase();
            
            // DTS - not supported on webOS 5-22
            if (audioCodec === 'dts' || audioCodec === 'dca') {
                if (!canPlayDts(videoTestElement)) {
                    console.log('[DeviceProfile] DTS audio not supported on this webOS version');
                    return mediaSource.SupportsDirectStream ? 'DirectStream' : 'Transcode';
                }
            }
        }
        
        // If server says DirectPlay is supported and we haven't found issues
        if (mediaSource.SupportsDirectPlay) {
            return 'DirectPlay';
        }
        
        if (mediaSource.SupportsDirectStream) {
            return 'DirectStream';
        }
        
        return 'Transcode';
    }

    return {
        init: init,
        getProfile: getProfile,
        getCapabilities: getCapabilities,
        getDeviceInfo: getDeviceInfo,
        detectBrowser: detectBrowser,
        shouldUseNativeHls: shouldUseNativeHls,
        shouldUseHlsJs: shouldUseHlsJs,
        getPlayMethod: getPlayMethod
    };
})();
