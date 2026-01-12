/**
 * webOS Video MediaPlayer Plugin for jellyfin-web PlaybackManager
 * 
 * Priority: 50 (higher than HTML5's 1, lower than potential native plugins)
 * Delegates to our existing VideoPlayerAdapter/Factory system
 * 
 * This plugin is OPTIONAL - provides webOS-specific capability detection
 * and ensures optimal adapter selection (Shaka vs HTML5)
 */

(function() {
    'use strict';
    
    const isWebOS = (function() {
        if (typeof window === 'undefined') return false;
        if (typeof webOS !== 'undefined') return true;
        
        const ua = navigator.userAgent.toLowerCase();
        return ua.indexOf('webos') !== -1 || ua.indexOf('web0s') !== -1;
    })();
    
    if (!isWebOS) {
        console.log('[webOSPlugin] Not on webOS platform, skipping plugin registration');
        return;
    }
    
    class WebOSVideoPlugin {
        
        name() {
            return 'webOS Video Player';
        }
        
        type() {
            return 'mediaplayer';
        }
        
        id() {
            return 'webosvideo';
        }
        
        priority() {
            return 50;
        }
        
        canPlayItem(item) {
            if (!item || item.MediaType !== 'Video') {
                return Promise.resolve(false);
            }
            return Promise.resolve(true);
        }
        
        canPlayMediaSource(mediaSource) {
            if (!mediaSource) return Promise.resolve(false);
            
            const container = (mediaSource.Container || '').toLowerCase();
            const supportedContainers = ['mp4', 'mkv', 'webm', 'mov', 'm3u8', 'mpd', 'ts'];
            
            if (container && !supportedContainers.includes(container)) {
                console.log('[webOSPlugin] Unsupported container:', container);
                return Promise.resolve(false);
            }
            
            const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video');
            if (videoStream) {
                const codec = (videoStream.Codec || '').toLowerCase();
                const supportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'];
                
                if (!supportedCodecs.includes(codec)) {
                    console.log('[webOSPlugin] Unsupported video codec:', codec);
                    return Promise.resolve(false);
                }
            }
            
            return Promise.resolve(true);
        }
        
        getDeviceProfile(profileBuilder) {
            if (typeof buildWebOSDeviceProfile === 'function') {
                return buildWebOSDeviceProfile(profileBuilder);
            }
            
            if (typeof profileBuilder === 'function') {
                return profileBuilder({
                    enableMkvProgressive: false,
                    enableSsaRender: true
                });
            }
            
            return {};
        }
        

    }
    
    function registerWithPlaybackManager() {
        if (typeof window.playbackManager !== 'undefined' && window.playbackManager.registerPlayer) {
            try {
                const plugin = new WebOSVideoPlugin();
                window.playbackManager.registerPlayer(plugin);
                console.log('[webOSPlugin] Successfully registered with PlaybackManager');
                console.log('[webOSPlugin] Priority: 50 (higher than HTML5, optimized for webOS)');
            } catch (error) {
                console.error('[webOSPlugin] Failed to register plugin:', error);
            }
        } else {
            console.log('[webOSPlugin] PlaybackManager not available yet, will retry...');
            setTimeout(registerWithPlaybackManager, 500);
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', registerWithPlaybackManager);
    } else {
        registerWithPlaybackManager();
    }
    
})();
