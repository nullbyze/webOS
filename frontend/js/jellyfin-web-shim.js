/**
 * Jellyfin Web Shim
 * 
 * Provides device profile builder for webOS.
 * This includes webOS version detection and all webOS-specific codec/container support.
 * 
 * Based on jellyfin-web's browserDeviceProfile.js with webOS-specific enhancements.
 * Reference: https://github.com/jellyfin/jellyfin-web/blob/main/src/scripts/browserDeviceProfile.js
 * 
 * @module JellyfinWebShim
 */

(function() {
    'use strict';

    console.log('[JF-Shim] Initializing Jellyfin Web Shim...');

    // ========================================================================
    // webOS Version Detection (from jellyfin-web browser.js)
    // ========================================================================
    
    /**
     * Detect webOS version based on Chrome version in user agent
     * @returns {number|undefined} webOS version (1-23) or undefined
     */
    function detectWebOSVersion() {
        var ua = navigator.userAgent.toLowerCase();
        
        // Check if this is webOS
        if (!ua.includes('web0s') && !ua.includes('netcast')) {
            // Not webOS, but we assume it is since this is a webOS app
            console.log('[JF-Shim] webOS not detected in UA, assuming webOS environment');
        }
        
        // Extract Chrome version
        var chromeMatch = /chrome\/(\d+)/.exec(ua);
        if (chromeMatch) {
            var chromeVersion = parseInt(chromeMatch[1], 10);
            
            // Map Chrome version to webOS version (from jellyfin-web)
            if (chromeVersion >= 94) return 23;      // webOS 23
            if (chromeVersion >= 87) return 22;      // webOS 22
            if (chromeVersion >= 79) return 6;       // webOS 6
            if (chromeVersion >= 68) return 5;       // webOS 5
            if (chromeVersion >= 53) return 4;       // webOS 4
            if (chromeVersion >= 38) return 3;       // webOS 3
            if (chromeVersion >= 34) return 2;       // webOS 2
            if (chromeVersion >= 26) return 1;       // webOS 1
        }
        
        // Safari version fallback for webOS app
        var safariMatch = /applewebkit\/(\d+)/.exec(ua);
        if (safariMatch) {
            var webkitVersion = parseInt(safariMatch[1], 10);
            if (webkitVersion >= 538) return 2;
            if (webkitVersion >= 537) return 1;
        }
        
        console.warn('[JF-Shim] Unable to detect webOS version, defaulting to 4');
        return 4; // Safe default
    }

    var webOSVersion = detectWebOSVersion();
    console.log('[JF-Shim] Detected webOS version:', webOSVersion);

    // Expose browser flags for compatibility
    window.browser = window.browser || {};
    window.browser.web0s = true;
    window.browser.web0sVersion = webOSVersion;
    window.browser.tv = true;

    // ========================================================================
    // Codec Support Detection
    // ========================================================================

    /**
     * Check if DTS is supported (disabled on webOS 5.0-22)
     * From: canPlayDts() in browserDeviceProfile.js line 111-122
     */
    function supportsDts() {
        // DTS audio is not supported by LG TV 2020-2022 (webOS 5.0, 6.0 and 22) models
        if (webOSVersion >= 5 && webOSVersion < 23) {
            return false;
        }
        return true;
    }

    /**
     * Check if AV1 is supported (webOS 5+)
     * From: canPlayAv1() in browserDeviceProfile.js line 25-33
     */
    function supportsAv1() {
        return webOSVersion >= 5;
    }

    /**
     * Check if native HLS in fMP4 is supported (webOS 3.5+)
     * From: canPlayNativeHlsInFmp4() in browserDeviceProfile.js line 78-83
     */
    function supportsHlsInFmp4() {
        return webOSVersion >= 3.5;
    }

    /**
     * Check if Opus audio is supported (webOS 3.5+)
     * From: canPlayAudioFormat('opus') in browserDeviceProfile.js line 172-174
     */
    function supportsOpus() {
        return webOSVersion >= 3.5;
    }

    /**
     * Check if Dolby Vision Profile 8 is supported (webOS 4+)
     * From: supportedDolbyVisionProfilesHevc() in browserDeviceProfile.js line 269-290
     */
    function supportsDolbyVisionProfile8() {
        return webOSVersion >= 4;
    }

    /**
     * Check if secondary audio track switching is supported (webOS 4+)
     * From: canPlaySecondaryAudio() in browserDeviceProfile.js line 481-489
     */
    function supportsSecondaryAudio() {
        return webOSVersion >= 4.0 || !webOSVersion;
    }

    /**
     * webOS supports interlaced video
     * From: CodecProfiles section in browserDeviceProfile.js line 1340-1351
     */
    function supportsInterlacedVideo() {
        return true; // webOS supports interlaced video
    }

    // ========================================================================
    // Device Profile Builder
    // ========================================================================

    /**
     * Device profile builder for Jellyfin playback
     * This follows jellyfin-web's profile builder pattern and includes all webOS capabilities
     * 
     * Expected profileOptions from jellyfin-web NativeShell.AppHost.getDeviceProfile():
     * {
     *   enableMkvProgressive: false,        // webOS doesn't support progressive MKV
     *   enableSsaRender: true,              // Enable SSA/ASS subtitle rendering
     *   supportsDolbyAtmos: true/false,     // Dolby Atmos audio support
     *   supportsDolbyVision: true/false,    // Dolby Vision HDR support
     *   supportsHdr10: true/false           // HDR10 support
     * }
     */
    function createProfileBuilder() {
        return function(profileOptions) {
            console.log('[JF-Shim] Building device profile with options:', profileOptions);
            
            // Extract webOS-specific capabilities (these come from deviceInfo in webOS.js)
            profileOptions = profileOptions || {};
            var enableMkvProgressive = profileOptions.enableMkvProgressive !== undefined ? profileOptions.enableMkvProgressive : false;
            var enableSsaRender = profileOptions.enableSsaRender !== undefined ? profileOptions.enableSsaRender : true;
            var supportsDolbyAtmos = profileOptions.supportsDolbyAtmos;
            var dolbyVision = profileOptions.supportsDolbyVision;
            var hdr10 = profileOptions.supportsHdr10 !== undefined ? profileOptions.supportsHdr10 : true; // webOS supports HDR10

            // Build audio codec list based on webOS version
            var videoAudioCodecs = ['aac', 'ac3', 'eac3', 'mp3', 'mp2', 'pcm_s16le', 'pcm_s24le'];
            
            if (supportsOpus()) {
                videoAudioCodecs.push('opus');
            }
            
            if (supportsDts()) {
                videoAudioCodecs.push('dca', 'dts');
            }
            
            // TrueHD and Atmos
            videoAudioCodecs.push('truehd');
            if (supportsDolbyAtmos) {
                videoAudioCodecs.push('eac3_atmos', 'truehd_atmos');
            }
            
            // Additional webOS audio codecs
            videoAudioCodecs.push('flac', 'vorbis', 'aac_latm', 'alac');

            // Build video codec list based on webOS version
            var videoCodecs = ['h264', 'hevc', 'mpeg2video', 'vc1', 'vp8', 'vp9', 'mpeg4', 'msmpeg4v2'];
            
            if (supportsAv1()) {
                videoCodecs.push('av1');
            }

            // Build HDR video range types
            var hevcVideoRangeTypes = 'SDR';
            var vp9VideoRangeTypes = 'SDR';
            var av1VideoRangeTypes = 'SDR';

            if (hdr10) {
                hevcVideoRangeTypes += '|HDR10|HDR10Plus|HLG';
                vp9VideoRangeTypes += '|HDR10|HDR10Plus|HLG';
                av1VideoRangeTypes += '|HDR10|HDR10Plus|HLG';
            }

            if (dolbyVision) {
                if (supportsDolbyVisionProfile8()) {
                    hevcVideoRangeTypes += '|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR|DOVIWithHDR10Plus';
                    // webOS can play fallback of Profile 7 and most invalid profiles
                    hevcVideoRangeTypes += '|DOVIWithEL|DOVIWithELHDR10Plus|DOVIInvalid';
                    av1VideoRangeTypes += '|DOVIWithHDR10|DOVIWithHDR10Plus|DOVIWithEL|DOVIWithELHDR10Plus|DOVIInvalid';
                }
                // Add DOVI profile 5 support
                hevcVideoRangeTypes += '|DOVI';
            }

            console.log('[JF-Shim] webOS capabilities:', {
                webOSVersion: webOSVersion,
                supportsDts: supportsDts(),
                supportsAv1: supportsAv1(),
                supportsHlsInFmp4: supportsHlsInFmp4(),
                supportsOpus: supportsOpus(),
                supportsDolbyVisionProfile8: supportsDolbyVisionProfile8(),
                supportsSecondaryAudio: supportsSecondaryAudio(),
                supportsInterlacedVideo: supportsInterlacedVideo(),
                hdr10: hdr10,
                dolbyVision: dolbyVision,
                dolbyAtmos: supportsDolbyAtmos
            });

            // Physical audio channels (jellyfin-web default for TV with AC3/EAC3)
            var physicalAudioChannels = 6;

            var profile = {
                MaxStreamingBitrate: 120000000,
                MaxStaticBitrate: 100000000,
                MusicStreamingTranscodingBitrate: 384000,
                DirectPlayProfiles: [
                    // HLS DirectPlay (from browserDeviceProfile.js line 899-913)
                    // HACK: Since there is no filter for TS/MP4 in the API, specify HLS support in general
                    {
                        Container: 'hls',
                        Type: 'Video',
                        VideoCodec: 'h264,hevc' + (supportsAv1() ? ',av1' : '') + ',vp9',
                        AudioCodec: 'aac,ac3,eac3,mp3' + (supportsOpus() ? ',opus' : '')
                    },
                    // MKV container - webOS native support
                    {
                        Container: 'mkv',
                        Type: 'Video',
                        VideoCodec: videoCodecs.join(','),
                        AudioCodec: videoAudioCodecs.join(',')
                    },
                    // WebM container
                    {
                        Container: 'webm',
                        Type: 'Video',
                        VideoCodec: 'vp8,vp9' + (supportsAv1() ? ',av1' : ''),
                        AudioCodec: 'vorbis' + (supportsOpus() ? ',opus' : '')
                    },
                    // MP4/M4V container
                    {
                        Container: 'mp4,m4v',
                        Type: 'Video',
                        VideoCodec: videoCodecs.join(','),
                        AudioCodec: videoAudioCodecs.join(',')
                    },
                    // MOV container
                    {
                        Container: 'mov',
                        Type: 'Video',
                        VideoCodec: 'h264,hevc,mpeg4',
                        AudioCodec: 'aac,ac3,eac3,alac,pcm_s16le,pcm_s24le,mp3'
                    },
                    // TS/MPEG-TS container (webOS native)
                    {
                        Container: 'ts,mpegts',
                        Type: 'Video',
                        VideoCodec: 'h264,hevc,mpeg2video,vc1',
                        AudioCodec: 'aac,ac3,eac3,mp3,mp2,dca,dts,pcm_s16le'
                    },
                    // M2TS container (webOS native)
                    {
                        Container: 'm2ts',
                        Type: 'Video',
                        VideoCodec: 'h264,hevc,mpeg2video,vc1',
                        AudioCodec: 'aac,ac3,eac3,dca,dts,truehd,pcm_s16le,pcm_s24le'
                    },
                    // AVI container (webOS native)
                    {
                        Container: 'avi',
                        Type: 'Video',
                        VideoCodec: 'h264,hevc,mpeg4,msmpeg4v2,xvid,divx',
                        AudioCodec: 'aac,ac3,mp3,mp2,pcm_s16le'
                    },
                    // WMV/ASF container (webOS native)
                    {
                        Container: 'asf,wmv',
                        Type: 'Video',
                        VideoCodec: 'vc1,wmv3,wmv2',
                        AudioCodec: 'wma,wmapro,wmalossless,wmav2'
                    },
                    // MPG/MPEG container (webOS native)
                    {
                        Container: 'mpg,mpeg',
                        Type: 'Video',
                        VideoCodec: 'mpeg2video,mpeg1video',
                        AudioCodec: 'mp2,mp3,ac3'
                    },
                    // FLV container
                    {
                        Container: 'flv',
                        Type: 'Video',
                        VideoCodec: 'h264',
                        AudioCodec: 'aac,mp3'
                    },
                    // 3GP container
                    {
                        Container: '3gp',
                        Type: 'Video',
                        VideoCodec: 'h264,mpeg4',
                        AudioCodec: 'aac,mp3'
                    },
                    // Audio containers (from browserDeviceProfile.js line 762-825)
                    { Container: 'mp3', Type: 'Audio' },
                    { Container: 'mp2', Type: 'Audio' },
                    { Container: 'aac,m4a,m4b', Type: 'Audio', AudioCodec: 'aac' },
                    { Container: 'flac', Type: 'Audio' },
                    { Container: 'wav', Type: 'Audio', AudioCodec: 'pcm_s16le,pcm_s24le' },
                    { Container: 'ogg,oga', Type: 'Audio', AudioCodec: 'vorbis' + (supportsOpus() ? ',opus' : '') },
                    { Container: 'webm', Type: 'Audio', AudioCodec: 'vorbis' + (supportsOpus() ? ',opus' : '') },
                    { Container: 'wma', Type: 'Audio' },
                    { Container: 'asf', Type: 'Audio', AudioCodec: 'wma,wmapro,wmav2' }
                ],
                TranscodingProfiles: [
                    // HLS with fMP4 segments (webOS 3.5+) - FIRST for better codec support
                    supportsHlsInFmp4() ? {
                        Container: 'mp4',
                        Type: 'Video',
                        AudioCodec: 'aac,ac3,eac3' + (supportsOpus() ? ',opus' : ''),
                        VideoCodec: 'h264,hevc,vp9' + (supportsAv1() ? ',av1' : ''),
                        Context: 'Streaming',
                        Protocol: 'hls',
                        MaxAudioChannels: physicalAudioChannels.toString(),
                        MinSegments: '1',
                        BreakOnNonKeyFrames: true
                    } : null,
                    // HLS with TS segments
                    {
                        Container: 'ts',
                        Type: 'Video',
                        AudioCodec: 'aac,ac3,eac3,mp3' + (supportsOpus() ? ',opus' : ''),
                        VideoCodec: 'h264,hevc',
                        Context: 'Streaming',
                        Protocol: 'hls',
                        MaxAudioChannels: physicalAudioChannels.toString(),
                        MinSegments: '1',
                        BreakOnNonKeyFrames: true
                    },
                    // Static MP4
                    {
                        Container: 'mp4',
                        Type: 'Video',
                        AudioCodec: 'aac,ac3,eac3,mp3',
                        VideoCodec: 'h264,hevc',
                        Context: 'Static',
                        Protocol: 'http'
                    },
                    // Audio transcoding (from browserDeviceProfile.js line 855-876)
                    {
                        Container: 'aac',
                        Type: 'Audio',
                        AudioCodec: 'aac',
                        Context: 'Streaming',
                        Protocol: 'http',
                        MaxAudioChannels: physicalAudioChannels.toString()
                    },
                    {
                        Container: 'mp3',
                        Type: 'Audio',
                        AudioCodec: 'mp3',
                        Context: 'Streaming',
                        Protocol: 'http',
                        MaxAudioChannels: physicalAudioChannels.toString()
                    },
                    {
                        Container: 'wav',
                        Type: 'Audio',
                        AudioCodec: 'wav',
                        Context: 'Streaming',
                        Protocol: 'http',
                        MaxAudioChannels: physicalAudioChannels.toString()
                    },
                    // Static audio transcoding
                    {
                        Container: 'aac',
                        Type: 'Audio',
                        AudioCodec: 'aac',
                        Context: 'Static',
                        Protocol: 'http',
                        MaxAudioChannels: physicalAudioChannels.toString()
                    },
                    {
                        Container: 'mp3',
                        Type: 'Audio',
                        AudioCodec: 'mp3',
                        Context: 'Static',
                        Protocol: 'http',
                        MaxAudioChannels: physicalAudioChannels.toString()
                    }
                ].filter(Boolean), // Remove null entries
                ContainerProfiles: [],
                CodecProfiles: [
                    // H.264 codec profile (webOS supports interlaced)
                    {
                        Type: 'Video',
                        Codec: 'h264',
                        Conditions: [
                            { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
                            { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR', IsRequired: false }
                            // Note: No IsAnamorphic or IsInterlaced conditions - webOS supports both
                        ]
                    },
                    // HEVC codec profile with HDR support
                    {
                        Type: 'Video',
                        Codec: 'hevc',
                        Conditions: [
                            { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main|main 10|main 10 still-image', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '186', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '10', IsRequired: false },
                            { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: hevcVideoRangeTypes, IsRequired: false }
                        ]
                    },
                    // VP9 codec profile
                    {
                        Type: 'Video',
                        Codec: 'vp9',
                        Conditions: [
                            { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '60', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '10', IsRequired: false },
                            { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: vp9VideoRangeTypes, IsRequired: false }
                        ]
                    },
                    // AV1 codec profile (webOS 5+)
                    supportsAv1() ? {
                        Type: 'Video',
                        Codec: 'av1',
                        Conditions: [
                            { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '19', IsRequired: false },
                            { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '10', IsRequired: false },
                            { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: av1VideoRangeTypes, IsRequired: false }
                        ]
                    } : null,
                    // VC1 codec profile
                    {
                        Type: 'Video',
                        Codec: 'vc1',
                        Conditions: [
                            { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '3', IsRequired: false }
                        ]
                    },
                    // MPEG2 codec profile
                    {
                        Type: 'Video',
                        Codec: 'mpeg2video',
                        Conditions: [
                            { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '2', IsRequired: false }
                        ]
                    },
                    // DOVI profile restriction for non-mp4/ts containers (webOS-specific)
                    // From browserDeviceProfile.js line 1496-1507
                    dolbyVision ? {
                        Type: 'Video',
                        Container: '-mp4,ts',
                        Conditions: [
                            { Condition: 'NotEquals', Property: 'VideoRangeType', Value: 'DOVI', IsRequired: false },
                            { Condition: 'NotEquals', Property: 'VideoRangeType', Value: 'DOVIWithHDR10', IsRequired: false },
                            { Condition: 'NotEquals', Property: 'VideoRangeType', Value: 'DOVIWithHLG', IsRequired: false },
                            { Condition: 'NotEquals', Property: 'VideoRangeType', Value: 'DOVIWithSDR', IsRequired: false }
                        ]
                    } : null,
                    // AAC codec profile (handle HE-AAC if not supported)
                    // From browserDeviceProfile.js line 943-970
                    {
                        Type: 'VideoAudio',
                        Codec: 'aac',
                        Conditions: supportsSecondaryAudio() ? [] : [
                            { Condition: 'Equals', Property: 'IsSecondaryAudio', Value: 'false', IsRequired: false }
                        ]
                    },
                    // FLAC channel limit for webOS (2 channels max)
                    // From browserDeviceProfile.js line 1017-1030
                    {
                        Type: 'VideoAudio',
                        Codec: 'flac',
                        Conditions: [
                            { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '2', IsRequired: false }
                        ]
                    },
                    // Opus channel limit for webOS (2 channels max like Safari)
                    // From browserDeviceProfile.js line 1058-1072
                    supportsOpus() ? {
                        Type: 'VideoAudio',
                        Codec: 'opus',
                        Conditions: [
                            { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '2', IsRequired: false }
                        ]
                    } : null,
                    // Global video audio channels limit
                    {
                        Type: 'VideoAudio',
                        Conditions: supportsSecondaryAudio() ? [
                            { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: physicalAudioChannels.toString(), IsRequired: false }
                        ] : [
                            { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: physicalAudioChannels.toString(), IsRequired: false },
                            { Condition: 'Equals', Property: 'IsSecondaryAudio', Value: 'false', IsRequired: false }
                        ]
                    },
                    // Global audio channels limit
                    {
                        Type: 'Audio',
                        Conditions: [
                            { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: physicalAudioChannels.toString(), IsRequired: false }
                        ]
                    }
                ].filter(Boolean), // Remove null entries
                SubtitleProfiles: [
                    // External subtitles (from browserDeviceProfile.js line 1563-1590)
                    { Format: 'vtt', Method: 'External' },
                    { Format: 'ass', Method: 'External' },
                    { Format: 'ssa', Method: 'External' },
                    { Format: 'srt', Method: 'External' },
                    { Format: 'sub', Method: 'External' },
                    { Format: 'pgssub', Method: 'External' },
                    // Embedded subtitles
                    { Format: 'srt', Method: 'Embed' },
                    { Format: 'ass', Method: 'Embed' },
                    { Format: 'ssa', Method: 'Embed' },
                    { Format: 'sub', Method: 'Embed' },
                    { Format: 'vtt', Method: 'Embed' },
                    { Format: 'pgs', Method: 'Embed' },
                    { Format: 'pgssub', Method: 'Embed' },
                    { Format: 'dvdsub', Method: 'Embed' },
                    { Format: 'dvbsub', Method: 'Embed' },
                    { Format: 'cc_dec', Method: 'Embed' }
                ],
                ResponseProfiles: [
                    // From browserDeviceProfile.js line 1591-1596
                    {
                        Type: 'Video',
                        Container: 'm4v',
                        MimeType: 'video/mp4'
                    }
                ]
            };

            console.log('[JF-Shim] Profile built successfully with', 
                profile.DirectPlayProfiles.length, 'direct play profiles,',
                profile.TranscodingProfiles.length, 'transcoding profiles,',
                profile.CodecProfiles.length, 'codec profiles');
                
            return profile;
        };
    }

    window.jellyfinProfileBuilder = createProfileBuilder();
    console.log('[JF-Shim] profileBuilder exposed at window.jellyfinProfileBuilder');

    // Also expose version info
    window.webOSVersion = webOSVersion;
    console.log('[JF-Shim] webOSVersion exposed at window.webOSVersion');

})();
