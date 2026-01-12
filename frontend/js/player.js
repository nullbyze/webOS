/**
 * Player Controller Module
 * Manages video playback, controls, track selection, and playback reporting
 * Supports direct play, transcoding, and Live TV streaming
 * 
 * PlaybackManager Integration:
 * - When USE_PLAYBACK_MANAGER is true, uses jellyfin-web's PlaybackManager for playback
 * - When false, uses legacy direct video URL loading
 * - PlaybackManager provides automatic server reporting, profile negotiation, and track management
 * 
 * @module PlayerController
 */
var PlayerController = (function() {
    'use strict';

    // ========================================================================
    // PlaybackManager Integration Toggle
    // ========================================================================
    
    /**
     * Enable PlaybackManager integration (recommended)
     * Set to false to use legacy direct playback mode
     * @constant {boolean}
     */
    const USE_PLAYBACK_MANAGER = false; // TODO: Set to true once jellyfin-web is bundled

    let auth = null;
    let itemId = null;
    let itemData = null;
    let videoPlayer = null;
    /** @type {Object|null} Video player adapter (Shaka/webOS/HTML5) */
    let playerAdapter = null;
    /** @type {Object|null} PlaybackManager adapter when USE_PLAYBACK_MANAGER is enabled */
    let playbackManagerAdapter = null;
    let controlsVisible = false;
    let controlsTimeout = null;
    let playbackInfo = null;
    let playSessionId = null;
    let progressInterval = null;
    let focusableButtons = [];
    let currentFocusIndex = 0;
    let audioStreams = [];
    let subtitleStreams = [];
    let currentAudioIndex = -1;
    let currentSubtitleIndex = -1;
    let audioLanguageMap = []; // Maps Jellyfin stream index to language code
    let modalFocusableItems = [];
    let currentModalFocusIndex = 0;
    let activeModal = null;
    let isSeekbarFocused = false;
    let seekPosition = 0;
    let loadingTimeout = null;
    let seekDebounceTimer = null;
    let isSeeking = false;
    let isSeekingActive = false; // True while user is actively seeking (before debounce completes)
    let pendingSeekPosition = null;
    let hasTriedTranscode = false;
    let currentMediaSource = null;
    let isTranscoding = false;
    let currentPlaybackSpeed = 1.0;
    let isDolbyVisionMedia = false; // Track if current media is Dolby Vision
    let willUseDirectPlay = false; // Track if we plan to use direct play before loading
    let playbackHealthCheckTimer = null; // Timer for checking playback health
    let forcePlayMode = null; // User override for playback mode ('direct' or 'transcode')
    const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    let bitrateUpdateInterval = null;
    let mediaSegments = [];
    let currentSkipSegment = null;
    let skipOverlayVisible = false;
    let nextEpisodeData = null;
    let previousEpisodeData = null;
    let trickplayData = null;
    let trickplayResolution = null;
    let trickplayVisible = false;
    let audioContext = null;
    let gainNode = null;
    let sourceNode = null;
    let normalizationGain = 1.0;
    let audioNormalizationEnabled = true;
    
    const LoadingState = {
        IDLE: 'idle',
        INITIALIZING: 'initializing',
        LOADING: 'loading',
        READY: 'ready',
        ERROR: 'error'
    };
    let loadingState = LoadingState.IDLE;

    let elements = {};

    const PROGRESS_REPORT_INTERVAL_MS = 10000;
    const CONTROLS_HIDE_DELAY_MS = 3000;
    const SKIP_INTERVAL_SECONDS = 10;
    const SEEK_DEBOUNCE_MS = 300;
    const BITRATE_UPDATE_INTERVAL_MS = 3000;
    const FOCUS_DELAY_MS = 100;
    const CONTROLS_FADE_DELAY_MS = 300;
    const AUTO_HIDE_CONTROLS_MS = 2000;
    const DIRECT_PLAY_TIMEOUT_MS = 15000;
    const TRANSCODE_TIMEOUT_MS = 45000;
    const TICKS_PER_SECOND = 10000000;

    /**
     * Attempt fallback to transcoding if direct play fails
     * @param {Object} mediaSource - Original media source
     * @param {string} reason - Reason for fallback
     * @returns {boolean} True if fallback attempted, false if not possible
     */
    function attemptTranscodeFallback(mediaSource, reason) {
        if (hasTriedTranscode) {
            return false;
        }
        
        if (!mediaSource || !mediaSource.SupportsTranscoding) {
            return false;
        }
        
        hasTriedTranscode = true;
        willUseDirectPlay = false;
        
        var modifiedSource = Object.assign({}, mediaSource);
        modifiedSource.SupportsDirectPlay = false;
        
        clearLoadingTimeout();
        startPlayback(modifiedSource).catch(onError);
        return true;
    }
    
    function clearLoadingTimeout() {
        if (loadingTimeout) {
            clearTimeout(loadingTimeout);
            loadingTimeout = null;
        }
    }
    
    function setLoadingState(state) {
        loadingState = state;
        
        switch (state) {
            case LoadingState.LOADING:
            case LoadingState.INITIALIZING:
                showLoading();
                break;
            case LoadingState.READY:
            case LoadingState.ERROR:
            case LoadingState.IDLE:
                hideLoading();
                break;
        }
        
    }

    function init() {
        console.log('[Player] Initializing player controller');
        
        if (typeof DeviceProfile !== 'undefined' && DeviceProfile.init) {
            DeviceProfile.init(function(deviceInfo) {
                console.log('[Player] DeviceProfile initialized with device info:', deviceInfo);
            });
        }
        
        auth = typeof MultiServerManager !== 'undefined' 
            ? MultiServerManager.getAuthForPage() 
            : JellyfinAPI.getStoredAuth();
        
        if (!auth) {
            window.location.href = 'login.html';
            return;
        }

        itemId = getItemIdFromUrl();
        if (!itemId) {
            showErrorDialog('Invalid Request', 'No media ID was provided. Please select a media item to play.');
            return;
        }

        cacheElements();
        setupEventListeners();
        
        // Initialize PlaybackManager if enabled
        if (USE_PLAYBACK_MANAGER) {
            initPlaybackManagerAdapter();
        }
        
        loadItemAndPlay();
    }

    /**
     * Initialize PlaybackManager adapter with UI callbacks
     * Called once during player initialization when USE_PLAYBACK_MANAGER is true
     */
    function initPlaybackManagerAdapter() {
        console.log('[Player] Initializing PlaybackManager adapter');
        
        if (typeof PlaybackManagerAdapter === 'undefined') {
            console.error('[Player] PlaybackManagerAdapter not available');
            return;
        }

        const callbacks = {
            onTimeUpdate: function(currentTicks, durationTicks) {
                updateProgressDisplay(currentTicks / TICKS_PER_SECOND, durationTicks / TICKS_PER_SECOND);
            },
            onPause: function() {
                updatePlayPauseButton(true);
            },
            onUnpause: function() {
                updatePlayPauseButton(false);
            },
            onPlaybackStart: function(state) {
                console.log('[Player] PlaybackManager playback started:', state);
                hideLoading();
                startProgressReporting();
            },
            onPlaybackStop: function(stopInfo) {
                console.log('[Player] PlaybackManager playback stopped:', stopInfo);
                handlePlaybackEnd();
            },
            onMediaStreamsChange: function() {
                console.log('[Player] Media streams changed');
                if (playbackManagerAdapter) {
                    loadAudioTracksFromPlaybackManager();
                    loadSubtitleTracksFromPlaybackManager();
                }
            },
            onError: function(error) {
                console.error('[Player] PlaybackManager error:', error);
                showErrorDialog('Playback Error', error.message || 'An error occurred during playback');
            }
        };

        playbackManagerAdapter = PlaybackManagerAdapter.init(callbacks);
        
        if (!playbackManagerAdapter) {
            console.error('[Player] Failed to initialize PlaybackManager adapter');
        } else {
            console.log('[Player] PlaybackManager adapter initialized successfully');
        }
    }

    function getItemIdFromUrl() {
        var params = new URLSearchParams(window.location.search);
        return params.get('id');
    }
    
    function getStartPositionFromUrl() {
        var params = new URLSearchParams(window.location.search);
        var position = params.get('position');
        if (position !== null) {
            return parseInt(position, 10);
        }
        return null;
    }

    function cacheElements() {
        elements = {
            videoPlayer: document.getElementById('videoPlayer'),
            videoDimmer: document.getElementById('videoDimmer'),
            playerControls: document.getElementById('playerControls'),
            mediaLogo: document.getElementById('mediaLogo'),
            mediaTitle: document.getElementById('mediaTitle'),
            mediaSubtitle: document.getElementById('mediaSubtitle'),
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            seekIndicator: document.getElementById('seekIndicator'),
            timeDisplay: document.getElementById('timeDisplay'),
            endTime: document.getElementById('endTime'),
            playPauseBtn: document.getElementById('playPauseBtn'),
            rewindBtn: document.getElementById('rewindBtn'),
            forwardBtn: document.getElementById('forwardBtn'),
            audioBtn: document.getElementById('audioBtn'),
            subtitleBtn: document.getElementById('subtitleBtn'),
            chaptersBtn: document.getElementById('chaptersBtn'),
            previousItemBtn: document.getElementById('previousItemBtn'),
            nextItemBtn: document.getElementById('nextItemBtn'),
            videoInfoBtn: document.getElementById('videoInfoBtn'),
            backBtn: document.getElementById('backBtn'),
            loadingIndicator: document.getElementById('loadingIndicator'),
            errorDialog: document.getElementById('errorDialog'),
            errorDialogTitle: document.getElementById('errorDialogTitle'),
            errorDialogMessage: document.getElementById('errorDialogMessage'),
            errorDialogDetails: document.getElementById('errorDialogDetails'),
            errorDialogBtn: document.getElementById('errorDialogBtn'),
            audioModal: document.getElementById('audioModal'),
            audioTrackList: document.getElementById('audioTrackList'),
            subtitleModal: document.getElementById('subtitleModal'),
            subtitleTrackList: document.getElementById('subtitleTrackList'),
            chaptersModal: document.getElementById('chaptersModal'),
            chaptersContent: document.getElementById('chaptersContent'),
            videoInfoModal: document.getElementById('videoInfoModal'),
            videoInfoContent: document.getElementById('videoInfoContent'),
            speedBtn: document.getElementById('speedBtn'),
            speedModal: document.getElementById('speedModal'),
            speedList: document.getElementById('speedList'),
            speedIndicator: document.getElementById('speedIndicator'),
            bitrateIndicator: document.getElementById('bitrateIndicator'),
            qualityBtn: document.getElementById('qualityBtn'),
            qualityModal: document.getElementById('qualityModal'),
            qualityList: document.getElementById('qualityList'),
            playModeBtn: document.getElementById('playModeBtn'),
            playModeModal: document.getElementById('playModeModal'),
            playModeList: document.getElementById('playModeList'),
            skipOverlay: document.getElementById('skipOverlay'),
            skipButton: document.getElementById('skipButton'),
            skipButtonText: document.getElementById('skipButtonText'),
            skipButtonTime: document.getElementById('skipButtonTime'),
            trickplayBubble: document.getElementById('trickplayBubble'),
            trickplayThumb: document.getElementById('trickplayThumb'),
            trickplayChapterName: document.getElementById('trickplayChapterName'),
            trickplayTime: document.getElementById('trickplayTime'),
            errorDialog: document.getElementById('errorDialog'),
            errorDialogTitle: document.getElementById('errorDialogTitle'),
            errorDialogMessage: document.getElementById('errorDialogMessage'),
            errorDialogDetails: document.getElementById('errorDialogDetails'),
            errorDialogBtn: document.getElementById('errorDialogBtn')
        };

        videoPlayer = elements.videoPlayer;
        
        focusableButtons = [
            elements.playPauseBtn,
            elements.rewindBtn,
            elements.forwardBtn,
            elements.audioBtn,
            elements.subtitleBtn,
            elements.playModeBtn,
            elements.chaptersBtn,
            elements.previousItemBtn,
            elements.nextItemBtn,
            elements.speedBtn,
            elements.qualityBtn,
            elements.videoInfoBtn,
            elements.backBtn
        ].filter(Boolean);
    }

    function setupEventListeners() {
        elements.errorDialogBtn.addEventListener('click', closeErrorDialog);
        document.addEventListener('keydown', handleKeyDown);
        videoPlayer.addEventListener('play', onPlay);
        videoPlayer.addEventListener('pause', onPause);
        videoPlayer.addEventListener('timeupdate', onTimeUpdate);
        videoPlayer.addEventListener('ended', onEnded);
        videoPlayer.addEventListener('error', onError);
        videoPlayer.addEventListener('canplay', onCanPlay);
        videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
        videoPlayer.addEventListener('waiting', onWaiting);
        videoPlayer.addEventListener('playing', onPlaying);

        if (elements.playPauseBtn) {
            elements.playPauseBtn.addEventListener('click', togglePlayPause);
        }
        if (elements.rewindBtn) {
            elements.rewindBtn.addEventListener('click', rewind);
        }
        if (elements.forwardBtn) {
            elements.forwardBtn.addEventListener('click', forward);
        }
        if (elements.backBtn) {
            elements.backBtn.addEventListener('click', exitPlayer);
        }
        if (elements.audioBtn) {
            elements.audioBtn.addEventListener('click', showAudioTrackSelector);
        }
        if (elements.subtitleBtn) {
            elements.subtitleBtn.addEventListener('click', showSubtitleTrackSelector);
        }
        if (elements.chaptersBtn) {
            elements.chaptersBtn.addEventListener('click', showChaptersModal);
        }
        if (elements.previousItemBtn) {
            elements.previousItemBtn.addEventListener('click', playPreviousItem);
        }
        if (elements.nextItemBtn) {
            elements.nextItemBtn.addEventListener('click', playNextItem);
        }
        if (elements.videoInfoBtn) {
            elements.videoInfoBtn.addEventListener('click', showVideoInfo);
        }
        if (elements.speedBtn) {
            elements.speedBtn.addEventListener('click', showPlaybackSpeedSelector);
        }
        if (elements.qualityBtn) {
            elements.qualityBtn.addEventListener('click', showQualitySelector);
        }
        if (elements.playModeBtn) {
            elements.playModeBtn.addEventListener('click', showPlayModeSelector);
        }

        if (elements.skipButton) {
            elements.skipButton.addEventListener('click', executeSkip);
            elements.skipButton.addEventListener('keydown', function(evt) {
                if (evt.keyCode === KeyCodes.ENTER) {
                    evt.preventDefault();
                    executeSkip();
                }
            });
        }

        document.addEventListener('mousemove', showControls);
        document.addEventListener('click', showControls);
        
        if (elements.progressBar) {
            elements.progressBar.setAttribute('tabindex', '0');
            elements.progressBar.addEventListener('click', handleProgressBarClick);
            elements.progressBar.addEventListener('focus', function() {
                isSeekbarFocused = true;
                seekPosition = videoPlayer.currentTime;
                showTrickplayBubble();
            });
            elements.progressBar.addEventListener('blur', function() {
                isSeekbarFocused = false;
                hideTrickplayBubble();
            });
            
            elements.progressBar.addEventListener('mousemove', function(evt) {
                if (!videoPlayer.duration) return;
                var rect = elements.progressBar.getBoundingClientRect();
                var percent = ((evt.clientX - rect.left) / rect.width) * 100;
                var positionTicks = (percent / 100) * videoPlayer.duration * TICKS_PER_SECOND;
                updateTrickplayBubble(positionTicks, percent);
            });
            
            elements.progressBar.addEventListener('mouseenter', function() {
                showTrickplayBubble();
            });
            
            elements.progressBar.addEventListener('mouseleave', function() {
                if (!isSeekbarFocused) {
                    hideTrickplayBubble();
                }
            });
        }
    }

    async function ensurePlayerAdapter(options = {}) {
        try {
            if (playerAdapter) {
                var name = playerAdapter.getName();
                if (options.preferWebOS && name === 'WebOSVideo') {
                    return;
                }
                if ((options.preferHTML5 || options.preferHLS) && name === 'HTML5Video') {
                    return;
                }
                if (!options.preferWebOS && !options.preferHTML5 && !options.preferHLS && name === 'ShakaPlayer') {
                    return;
                }
                await playerAdapter.destroy();
            }

            showLoading();
            console.log('[Player] Initializing video player adapter, options:', JSON.stringify(options));

            playerAdapter = await VideoPlayerFactory.createPlayer(videoPlayer, options);
            console.log('[Player] Using adapter:', playerAdapter.getName());
            
            playerAdapter.on('error', function(error) {
                onError(error);
            });
            
            playerAdapter.on('buffering', function(buffering) {
                if (buffering) {
                    showLoading();
                } else {
                    hideLoading();
                }
            });
            
            playerAdapter.on('loaded', function(data) {
                hideLoading();
            });
            
            playerAdapter.on('qualitychange', function(data) {
            });
            
            playerAdapter.on('audiotrackchange', function(data) {
                detectCurrentAudioTrack();
            });
        } catch (error) {
            alert('Failed to initialize video player: ' + error.message);
            window.history.back();
        }
    }

    function handleKeyDown(evt) {
        evt = evt || window.event;

        if (elements.errorDialog && elements.errorDialog.style.display !== 'none') {
            if (evt.keyCode === KeyCodes.OK || evt.keyCode === KeyCodes.ENTER || 
                evt.keyCode === KeyCodes.BACK || evt.keyCode === 461) {
                evt.preventDefault();
                closeErrorDialog();
            }
            return;
        }

        if (activeModal) {
            handleModalKeyDown(evt);
            return;
        }

        switch (evt.keyCode) {
            case KeyCodes.PLAY_PAUSE:
                evt.preventDefault();
                togglePlayPause();
                break;
                
            case KeyCodes.ENTER:
                if (!document.activeElement || !focusableButtons.includes(document.activeElement)) {
                    evt.preventDefault();
                    togglePlayPause();
                }
                break;

            case KeyCodes.PLAY:
                evt.preventDefault();
                play();
                break;

            case KeyCodes.PAUSE:
                evt.preventDefault();
                pause();
                break;

            case KeyCodes.REWIND:
                evt.preventDefault();
                if (!document.activeElement || !focusableButtons.includes(document.activeElement)) {
                    rewind();
                }
                break;

            case KeyCodes.FORWARD:
                evt.preventDefault();
                if (!document.activeElement || !focusableButtons.includes(document.activeElement)) {
                    forward();
                }
                break;

            case KeyCodes.BACK:
            case 461: // webOS back button
                evt.preventDefault();

                if (controlsVisible) {
                    hideControls();
                    controlsVisible = false;
                } else {
                    exitPlayer();
                }
                break;

            case KeyCodes.UP:
                evt.preventDefault();
                showControls();

                if (isSeekbarFocused) {

                    if (focusableButtons.length > 0) {
                        currentFocusIndex = 0;
                        focusableButtons[currentFocusIndex].focus();
                    }
                } else if (document.activeElement && focusableButtons.includes(document.activeElement)) {

                    if (currentFocusIndex === focusableButtons.length - 1 || currentFocusIndex === focusableButtons.length - 2) {
                        if (elements.progressBar) {
                            elements.progressBar.focus();
                        }
                    }
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                showControls();

                if (document.activeElement && focusableButtons.includes(document.activeElement)) {

                    if (currentFocusIndex < focusableButtons.length - 2) {
                        if (elements.progressBar) {
                            elements.progressBar.focus();
                        }
                    }
                } else if (isSeekbarFocused) {

                    if (focusableButtons.length > 1) {
                        currentFocusIndex = focusableButtons.length - 2;
                        focusableButtons[currentFocusIndex].focus();
                    }
                } else if (focusableButtons.length > 0) {
                    currentFocusIndex = 0;
                    focusableButtons[currentFocusIndex].focus();
                }
                break;
                
            case KeyCodes.LEFT:
                if (isSeekbarFocused) {

                    evt.preventDefault();
                    seekBackward();
                } else if (document.activeElement && focusableButtons.includes(document.activeElement)) {
                    evt.preventDefault();
                    currentFocusIndex = (currentFocusIndex - 1 + focusableButtons.length) % focusableButtons.length;
                    focusableButtons[currentFocusIndex].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                if (isSeekbarFocused) {

                    evt.preventDefault();
                    seekForward();
                } else if (document.activeElement && focusableButtons.includes(document.activeElement)) {
                    evt.preventDefault();
                    currentFocusIndex = (currentFocusIndex + 1) % focusableButtons.length;
                    focusableButtons[currentFocusIndex].focus();
                }
                break;
        }
    }

    function handleModalKeyDown(evt) {
        if (activeModal === 'videoInfo') {
            switch (evt.keyCode) {
                case KeyCodes.UP:
                    evt.preventDefault();
                    if (elements.videoInfoContent) {
                        elements.videoInfoContent.scrollTop -= 60; // Scroll up
                    }
                    break;
                    
                case KeyCodes.DOWN:
                    evt.preventDefault();
                    if (elements.videoInfoContent) {
                        elements.videoInfoContent.scrollTop += 60; // Scroll down
                    }
                    break;
                    
                case KeyCodes.BACK:
                case KeyCodes.ESC:
                    evt.preventDefault();
                    closeModal();
                    break;
            }
            return;
        }
        
        currentModalFocusIndex = TrackSelector.handleModalKeyDown(
            evt,
            modalFocusableItems,
            currentModalFocusIndex,
            closeModal
        );
    }

    function loadItemAndPlay() {
        showLoading();

        var endpoint = '/Users/' + auth.userId + '/Items/' + itemId;
        var params = {
            Fields: 'MediaSources,MediaStreams,Chapters'
        };

        JellyfinAPI.getItems(auth.serverAddress, auth.accessToken, endpoint, params, function(err, data) {
            if (err || !data) {
                alert('Failed to load media item');
                window.history.back();
                return;
            }

            itemData = data;
            console.log('[Player] Loaded item:', itemData.Name, 'Type:', itemData.Type);
            var hasLogo = false;
            

            if (itemData.ImageTags && itemData.ImageTags.Logo) {
                if (elements.mediaLogo) {
                    elements.mediaLogo.src = auth.serverAddress + '/Items/' + itemData.Id +
                        '/Images/Logo?quality=90&maxHeight=150';
                    elements.mediaLogo.style.display = 'block';
                    hasLogo = true;
                }
            } else if (itemData.SeriesId && itemData.Type === 'Episode') {

                if (elements.mediaLogo) {
                    elements.mediaLogo.src = auth.serverAddress + '/Items/' + itemData.SeriesId +
                        '/Images/Logo?quality=90&maxHeight=150';
                    elements.mediaLogo.style.display = 'block';
                    hasLogo = true;
                }
            }
            

            if (!hasLogo && elements.mediaTitle) {
                elements.mediaTitle.textContent = itemData.Name;
                elements.mediaTitle.style.display = 'block';
                if (elements.mediaLogo) {
                    elements.mediaLogo.style.display = 'none';
                }
            } else if (elements.mediaTitle) {
                elements.mediaTitle.style.display = 'none';
            }

            if (elements.mediaSubtitle && itemData.Type === 'Episode') {
                var subtitle = '';
                if (itemData.SeriesName) subtitle += itemData.SeriesName;
                if (itemData.SeasonName) subtitle += ' - ' + itemData.SeasonName;
                if (itemData.IndexNumber) subtitle += ' - Episode ' + itemData.IndexNumber;
                elements.mediaSubtitle.textContent = subtitle;
            }

            initializeTrickplay();
            loadMediaSegments();
            loadAdjacentEpisodes();
            getPlaybackInfo();
        });
    }

    function getPlaybackInfo() {
        var playbackUrl = auth.serverAddress + '/Items/' + itemId + '/PlaybackInfo';
        
        var isLiveTV = itemData && itemData.Type === 'TvChannel';
        
        var requestData = {
            UserId: auth.userId,
            DeviceProfile: getDeviceProfile(),

            AutoOpenLiveStream: isLiveTV
        };

        ajax.request(playbackUrl, {
            method: 'POST',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken),
                'Content-Type': 'application/json'
            },
            data: requestData,
            success: function(response) {
                playbackInfo = response;
                

                if (playbackInfo.MediaSources && playbackInfo.MediaSources.length > 0) {
                    var mediaSource = playbackInfo.MediaSources[0];
                    var videoStream = mediaSource.MediaStreams ? mediaSource.MediaStreams.find(function(s) { return s.Type === 'Video'; }) : null;
                    
                    isDolbyVisionMedia = videoStream && videoStream.Codec && 
                        (videoStream.Codec.toLowerCase().startsWith('dvhe') || videoStream.Codec.toLowerCase().startsWith('dvh1'));
                    
                    if (isDolbyVisionMedia) {
                        console.log('[Player] Dolby Vision media detected, will use WebOS native adapter if available');
                    }
                }
                

                if (playbackInfo.MediaSources && playbackInfo.MediaSources.length > 0) {
                    startPlayback(playbackInfo.MediaSources[0]).catch(onError);
                } else {
                    showErrorDialog(
                        'No Media Sources',
                        'No playable media sources were found for this item.',
                        'The server did not provide any compatible media streams.'
                    );
                }
            },
            error: function(err) {
                var title = 'Playback Error';
                var message = 'Failed to get playback information from the server.';
                var details = '';
                
                if (err && err.error === 500) {
                    title = 'Server Error';
                    message = 'The Jellyfin server encountered an error processing this item.';
                    details = 'This may indicate:\n• Corrupted or incompatible media file\n• Missing codecs on the server\n• Server configuration issue\n\nError Code: 500\n\nCheck the Jellyfin server logs for more details.';
                } else if (err && err.error) {
                    details = 'Error Code: ' + err.error;
                    if (err.responseData && err.responseData.Message) {
                        details += '\nMessage: ' + err.responseData.Message;
                    }
                }
                
                showErrorDialog(title, message, details);
            }
        });
    }

    function getDeviceProfile() {

        if (typeof DeviceProfile !== 'undefined') {
            return DeviceProfile.getProfile({
                maxBitrate: 120000000,
                maxWidth: 3840,
                maxHeight: 2160
            });
        }
        

        return {
            MaxStreamingBitrate: 120000000,
            MaxStaticBitrate: 100000000,
            MusicStreamingTranscodingBitrate: 384000,
            DirectPlayProfiles: [

                { Container: 'mp4', Type: 'Video', VideoCodec: 'hevc,h264,avc', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd,flac' },
                { Container: 'mkv', Type: 'Video', VideoCodec: 'hevc,h264,avc', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd,flac' },

                { Container: 'mp4', Type: 'Video', VideoCodec: 'dvhe,dvh1', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd' },
                { Container: 'mkv', Type: 'Video', VideoCodec: 'dvhe,dvh1', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd' }
            ],
            TranscodingProfiles: [
                { Container: 'mp4', Type: 'Video', AudioCodec: 'aac,mp3,ac3', VideoCodec: 'h264', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '6', MinSegments: '2', BreakOnNonKeyFrames: false },
                { Container: 'ts', Type: 'Video', AudioCodec: 'aac,mp3,ac3', VideoCodec: 'h264', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '6' },
                { Container: 'mp4', Type: 'Video', AudioCodec: 'aac,mp3', VideoCodec: 'h264', Context: 'Static' }
            ],
            ContainerProfiles: [],
            CodecProfiles: [
                {
                    Type: 'Video',
                    Codec: 'h264',
                    Conditions: [
                        { Condition: 'LessThanEqual', Property: 'Width', Value: '3840' },
                        { Condition: 'LessThanEqual', Property: 'Height', Value: '2160' },
                        { Condition: 'LessThanEqual', Property: 'VideoFramerate', Value: '60' },
                        { Condition: 'LessThanEqual', Property: 'VideoBitrate', Value: '120000000' },
                        { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '51' }
                    ]
                },
                {
                    Type: 'Video',
                    Codec: 'hevc',
                    Conditions: [
                        { Condition: 'LessThanEqual', Property: 'Width', Value: '3840' },
                        { Condition: 'LessThanEqual', Property: 'Height', Value: '2160' },
                        { Condition: 'LessThanEqual', Property: 'VideoFramerate', Value: '60' },
                        { Condition: 'LessThanEqual', Property: 'VideoBitrate', Value: '120000000' }
                    ]
                },
                {
                    Type: 'VideoAudio',
                    Conditions: [
                        { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '8' }
                    ]
                }
            ],
            SubtitleProfiles: [

                { Format: 'srt', Method: 'Encode' },
                { Format: 'ass', Method: 'Encode' },
                { Format: 'ssa', Method: 'Encode' },
                { Format: 'vtt', Method: 'Encode' },
                { Format: 'sub', Method: 'Encode' },
                { Format: 'idx', Method: 'Encode' },
                { Format: 'subrip', Method: 'Encode' }
            ],
            ResponseProfiles: []
        };
    }

    /**
     * Start playback using PlaybackManager (when USE_PLAYBACK_MANAGER is true)
     * PlaybackManager handles server negotiation, stream selection, and automatic reporting
     * @param {Object} mediaSource - Media source from PlaybackInfo
     */
    async function startPlaybackViaPlaybackManager(mediaSource) {
        console.log('[Player] Starting playback via PlaybackManager');
        
        if (!playbackManagerAdapter) {
            console.error('[Player] PlaybackManager adapter not initialized');
            showErrorDialog('Playback Error', 'PlaybackManager is not available');
            return;
        }

        try {
            showLoading();
            
            // Get start position from URL or resume position
            const startPositionTicks = getStartPositionFromUrl() * TICKS_PER_SECOND || 
                                      (itemData.UserData && itemData.UserData.PlaybackPositionTicks) || 
                                      0;

            // PlaybackManager.play() options
            const playOptions = {
                items: [itemData],
                startPositionTicks: startPositionTicks,
                mediaSourceId: mediaSource.Id,
                audioStreamIndex: currentAudioIndex >= 0 ? audioStreams[currentAudioIndex].Index : undefined,
                subtitleStreamIndex: currentSubtitleIndex >= 0 ? subtitleStreams[currentSubtitleIndex].Index : undefined
            };

            console.log('[Player] PlaybackManager play options:', playOptions);

            // Start playback through adapter
            const success = await playbackManagerAdapter.play(playOptions);
            
            if (!success) {
                throw new Error('PlaybackManager failed to start playback');
            }

            // Load tracks from PlaybackManager
            loadAudioTracksFromPlaybackManager();
            loadSubtitleTracksFromPlaybackManager();
            
            // Initialize player features
            initializeAudioNormalization();
            
            console.log('[Player] PlaybackManager playback started successfully');
            
        } catch (error) {
            console.error('[Player] PlaybackManager playback error:', error);
            showErrorDialog('Playback Error', error.message || 'Failed to start playback via PlaybackManager');
        }
    }

    async function startPlayback(mediaSource) {
        // Use PlaybackManager if enabled
        if (USE_PLAYBACK_MANAGER) {
            return startPlaybackViaPlaybackManager(mediaSource);
        }

        // Legacy direct playback mode
        playSessionId = generateUUID();
        currentMediaSource = mediaSource;
        isDolbyVisionMedia = false; // Reset flag for new playback session
        

        audioStreams = mediaSource.MediaStreams ? mediaSource.MediaStreams.filter(function(s) { return s.Type === 'Audio'; }) : [];
        subtitleStreams = mediaSource.MediaStreams ? mediaSource.MediaStreams.filter(function(s) { return s.Type === 'Subtitle'; }) : [];
        

        currentAudioIndex = -1;
        currentSubtitleIndex = -1;
        for (var i = 0; i < audioStreams.length; i++) {
            if (audioStreams[i].IsDefault) {
                currentAudioIndex = i;
                break;
            }
        }
        if (currentAudioIndex < 0 && audioStreams.length > 0) {
            currentAudioIndex = 0;
        }
        for (var i = 0; i < subtitleStreams.length; i++) {
            if (subtitleStreams[i].IsDefault) {
                currentSubtitleIndex = i;
                break;
            }
        }
        
        var isLiveTV = itemData && itemData.Type === 'TvChannel';
        var streamUrl;
        var mimeType;
        var useDirectPlay = false;

        // Must append parameters one by one
        var params = new URLSearchParams();
        params.append('mediaSourceId', mediaSource.Id);
        params.append('deviceId', JellyfinAPI.init());
        params.append('api_key', auth.accessToken);
        params.append('PlaySessionId', playSessionId);
        
        var videoStream = mediaSource.MediaStreams ? mediaSource.MediaStreams.find(function(s) { return s.Type === 'Video'; }) : null;
        var audioStream = mediaSource.MediaStreams ? mediaSource.MediaStreams.find(function(s) { return s.Type === 'Audio'; }) : null;
        

        var isDolbyVision = videoStream && videoStream.Codec && 
            (videoStream.Codec.toLowerCase().startsWith('dvhe') || videoStream.Codec.toLowerCase().startsWith('dvh1'));
        var isHEVC10bit = videoStream && videoStream.Codec && 
            (videoStream.Codec.toLowerCase() === 'hevc' || videoStream.Codec.toLowerCase().startsWith('hev1') || 
             videoStream.Codec.toLowerCase().startsWith('hvc1')) && 
            videoStream.BitDepth === 10;
        var isHDR = videoStream && videoStream.VideoRangeType && 
            videoStream.VideoRangeType !== 'SDR';
        
        var safeVideoCodecs = ['h264', 'avc', 'hevc', 'h265', 'hev1', 'hvc1', 'dvhe', 'dvh1'];
        var safeAudioCodecs = ['aac', 'mp3', 'ac3', 'eac3', 'dts', 'truehd', 'flac'];
        var safeContainers = ['mp4', 'mkv', 'ts', 'm2ts'];
        

        var recommendedPlayMethod = 'Transcode';
        if (typeof DeviceProfile !== 'undefined' && DeviceProfile.getPlayMethod) {
            recommendedPlayMethod = DeviceProfile.getPlayMethod(mediaSource);
            console.log('[Player] DeviceProfile recommended play method:', recommendedPlayMethod);
        }
        
        var canDirectPlay = mediaSource.SupportsDirectPlay && 
            mediaSource.Container && 
            safeContainers.indexOf(mediaSource.Container.toLowerCase()) !== -1 &&
            videoStream && videoStream.Codec && safeVideoCodecs.indexOf(videoStream.Codec.toLowerCase()) !== -1 &&
            audioStream && audioStream.Codec && safeAudioCodecs.indexOf(audioStream.Codec.toLowerCase()) !== -1;
        

        if (isHDR && typeof DeviceProfile !== 'undefined') {
            var caps = DeviceProfile.getCapabilities();
            if (!caps.hdr10 && videoStream.VideoRangeType && videoStream.VideoRangeType.indexOf('HDR10') !== -1) {
                console.log('[Player] HDR10 content but TV may not support HDR10, preferring transcode');
                canDirectPlay = false;
            }
            if (!caps.dolbyVision && isDolbyVision) {
                console.log('[Player] Dolby Vision content but TV may not support DV, preferring transcode');
                canDirectPlay = false;
            }
        }
        
        var canTranscode = mediaSource.SupportsTranscoding;
        
        var shouldUseDirectPlay = false;
        if (forcePlayMode === 'direct') {
            shouldUseDirectPlay = canDirectPlay;
        } else if (forcePlayMode === 'transcode') {
            shouldUseDirectPlay = false;
        } else {
            shouldUseDirectPlay = canDirectPlay;
        }
        

        if (mediaSource.TranscodingUrl) {
            streamUrl = auth.serverAddress + mediaSource.TranscodingUrl;
            
            params = new URLSearchParams();
            var urlParts = streamUrl.split('?');
            if (urlParts.length > 1) {
                streamUrl = urlParts[0];
                params = new URLSearchParams(urlParts[1]);
            }
            
            if (!params.has('api_key')) {
                params.append('api_key', auth.accessToken);
            }
            if (!params.has('PlaySessionId')) {
                params.append('PlaySessionId', playSessionId);
            }
            if (!params.has('deviceId')) {
                params.append('deviceId', JellyfinAPI.init());
            }
            
            mimeType = 'application/x-mpegURL';
            isTranscoding = true;
        } else if (shouldUseDirectPlay) {
            willUseDirectPlay = true;
            streamUrl = auth.serverAddress + '/Videos/' + itemId + '/stream';
            params.append('Static', 'true');
            var container = mediaSource.Container || 'mp4';
            mimeType = 'video/' + container;
            useDirectPlay = true;
            isTranscoding = false;
        } else if (canTranscode) {
            streamUrl = auth.serverAddress + '/Videos/' + itemId + '/master.m3u8';
            

            var transVideoCodec = 'h264';
            var transAudioCodec = 'aac';
            var transMaxBitrate = '20000000';
            

            if (typeof DeviceProfile !== 'undefined') {
                var caps = DeviceProfile.getCapabilities();
                if (caps.hevc && caps.webosVersion >= 4 && (isHDR || isHEVC10bit)) {
                    transVideoCodec = 'hevc';
                    console.log('[Player] Using HEVC transcoding for HDR content');
                }

                if (caps.ac3 || caps.eac3) {
                    transAudioCodec = 'aac,ac3,eac3';
                }
            }
            
            params.append('VideoCodec', transVideoCodec);
            params.append('AudioCodec', transAudioCodec);
            params.append('VideoBitrate', transMaxBitrate);
            params.append('AudioBitrate', '256000');
            params.append('MaxWidth', '3840');  // Support 4K transcoding
            params.append('MaxHeight', '2160');
            params.append('SegmentLength', '6');
            params.append('MinSegments', '2');
            params.append('BreakOnNonKeyFrames', 'false');
            

            if (!isLiveTV) {
                var preferredAudioIndex = localStorage.getItem('preferredAudioTrack_' + itemId);
                var preferredSubtitleIndex = localStorage.getItem('preferredSubtitleTrack_' + itemId);
                
                if (preferredAudioIndex !== null && audioStreams[preferredAudioIndex]) {
                    params.append('AudioStreamIndex', audioStreams[preferredAudioIndex].Index);
                }
                
                if (preferredSubtitleIndex !== null && preferredSubtitleIndex >= 0 && subtitleStreams[preferredSubtitleIndex]) {
                    params.append('SubtitleStreamIndex', subtitleStreams[preferredSubtitleIndex].Index);
                    params.append('SubtitleMethod', 'Encode');
                }
            }
            
            mimeType = 'application/x-mpegURL';
            isTranscoding = true;
        } else {
            console.log('Unsupported media source:', {
                container: mediaSource.Container,
                supportsDirectPlay: mediaSource.SupportsDirectPlay,
                supportsDirectStream: mediaSource.SupportsDirectStream,
                supportsTranscoding: mediaSource.SupportsTranscoding
            });
            setLoadingState(LoadingState.ERROR);
            alert('This video format is not supported');
            window.history.back();
            return;
        }
        var creationOptions = {};
        if (isDolbyVision) {
            creationOptions.preferWebOS = true;
        } else if (useDirectPlay) {
            creationOptions.preferHTML5 = true;
        } else if (isTranscoding) {
            creationOptions.preferHLS = true;
        }
        await ensurePlayerAdapter(creationOptions);

        var videoUrl = streamUrl + '?' + params.toString();
        
        console.log('[Player] Starting playback');
        console.log('[Player] Method:', isLiveTV ? 'Live TV' : (useDirectPlay ? 'Direct Play' : 'Transcode'));
        console.log('[Player] Container:', mediaSource.Container);
        console.log('[Player] Video Codec:', videoStream ? videoStream.Codec : 'none');
        if (isDolbyVision || isHEVC10bit) {
            console.log('[Player] Note: For best Dolby Vision/HDR10 support, transcoding to HLS is recommended');
        }
        console.log('[Player] URL:', videoUrl.substring(0, 100) + '...');
        
        var startPosition = 0;
        var urlPosition = getStartPositionFromUrl();
        if (urlPosition !== null) {

            startPosition = urlPosition;
        } else if (!isLiveTV && itemData.UserData && itemData.UserData.PlaybackPositionTicks > 0) {

            startPosition = itemData.UserData.PlaybackPositionTicks / TICKS_PER_SECOND;
        }
        

        if (useDirectPlay) {
            setupDirectPlayTimeout(mediaSource);
        } else {
            var timeoutDuration = TRANSCODE_TIMEOUT_MS;
            loadingTimeout = setTimeout(function() {
                if (loadingState === LoadingState.LOADING) {
                    setLoadingState(LoadingState.ERROR);
                    alert('Video loading timed out. The server may be transcoding or the format is not supported.');
                    window.history.back();
                }
            }, timeoutDuration);
        }
        
        setLoadingState(LoadingState.LOADING);
        
        playerAdapter.load(videoUrl, {
            mimeType: mimeType,
            startPosition: startPosition
        }).then(function() {
            clearLoadingTimeout();
            console.log('[Player] Playback loaded successfully (' + (useDirectPlay ? 'direct' : 'stream') + ')');
            if (useDirectPlay) {
                startPlaybackHealthCheck(mediaSource);
            }
        }).catch(function(error) {
            handlePlaybackLoadError(error, mediaSource, useDirectPlay);
        });
    }
    
    function startPlaybackHealthCheck(mediaSource) {
        console.log('[Player] Starting playback health check for direct play');
        

        if (playbackHealthCheckTimer) {
            clearTimeout(playbackHealthCheckTimer);
        }
        
        var checkCount = 0;
        var lastTime = videoPlayer.currentTime;
        
        function checkHealth() {

            if (checkCount >= 3 || isTranscoding) {
                playbackHealthCheckTimer = null;
                return;
            }
            
            checkCount++;
            var currentTime = videoPlayer.currentTime;
            
            // Check 1: Is playback stuck? (time not advancing)
            var isStuck = !videoPlayer.paused && currentTime === lastTime && currentTime > 0;
            
            // Check 2: Video element in bad state?
            var isBadState = videoPlayer.error || 
                            videoPlayer.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
                            (videoPlayer.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !videoPlayer.paused);
            
            // Check 3: No video or audio tracks? (for containers with track support)
            var noTracks = false;
            if (videoPlayer.videoTracks && videoPlayer.audioTracks) {
                noTracks = videoPlayer.videoTracks.length === 0 || videoPlayer.audioTracks.length === 0;
            }
            
            if (isStuck || isBadState || noTracks) {
                console.log('[Player] Playback health issue detected:', {
                    stuck: isStuck,
                    badState: isBadState,
                    noTracks: noTracks,
                    readyState: videoPlayer.readyState,
                    networkState: videoPlayer.networkState
                });
                
                playbackHealthCheckTimer = null;
                if (attemptTranscodeFallback(mediaSource, 'Playback health check failed')) {
                    console.log('[Player] Falling back to HLS transcoding due to playback issues');
                }
            } else {
                lastTime = currentTime;
                playbackHealthCheckTimer = setTimeout(checkHealth, 2000); // Check every 2 seconds
            }
        }
        

        playbackHealthCheckTimer = setTimeout(checkHealth, 2000);
    }

    function handlePlaybackLoadError(error, mediaSource, isDirectPlay) {
        clearLoadingTimeout();
        console.log('[Player] Playback load failed:', error.message);
        
        if (isDirectPlay && mediaSource && attemptTranscodeFallback(mediaSource, error.message || 'Load error')) {
            alert('Direct playback failed. Switching to transcoding...');
        } else {
            setLoadingState(LoadingState.ERROR);
            alert('Failed to start playback: ' + (error.message || error));
            window.history.back();
        }
    }
    
    function setupDirectPlayTimeout(mediaSource) {
        var timeoutDuration = DIRECT_PLAY_TIMEOUT_MS;
        var directPlayStartTime = Date.now();
        var hasProgressedSinceStart = false;
        

        var onProgress = function() {
            hasProgressedSinceStart = true;
            console.log('[Player] Buffering progress detected for direct play');
        };
        
        var onLoadedMetadata = function() {
            hasProgressedSinceStart = true;
            console.log('[Player] Media metadata loaded for direct play');
        };
        
        var onCanPlay = function() {
            hasProgressedSinceStart = true;
            console.log('[Player] Video ready to play - direct play is working');
        };
        

        videoPlayer.addEventListener('progress', onProgress);
        videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
        videoPlayer.addEventListener('canplay', onCanPlay);
        
        loadingTimeout = setTimeout(function() {

            videoPlayer.removeEventListener('progress', onProgress);
            videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
            videoPlayer.removeEventListener('canplay', onCanPlay);
            

            if (loadingState !== LoadingState.LOADING) {
                return;
            }
            

            if (!hasProgressedSinceStart) {

                var elapsedSeconds = ((Date.now() - directPlayStartTime) / 1000).toFixed(1);
                console.log('[Player] Direct play timeout after ' + elapsedSeconds + 's (no buffering progress)');
                if (mediaSource && attemptTranscodeFallback(mediaSource, 'No buffering progress')) {
                    alert('Direct playback not responding. Switching to transcoding...');
                }
            } else {

                console.log('[Player] Direct play buffering but not ready. Extending timeout...');
                var extendedTimeout = setTimeout(function() {
                    if (loadingState === LoadingState.LOADING && mediaSource) {
                        console.log('[Player] Extended timeout reached, switching to transcoding');
                        if (attemptTranscodeFallback(mediaSource, 'Extended timeout')) {
                            alert('Direct playback too slow. Switching to transcoding...');
                        }
                    }
                }, 10000); // Additional 10 seconds if buffering detected
                
                loadingTimeout = extendedTimeout;
            }
        }, timeoutDuration);
    }

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return hours + ':' + padZero(minutes) + ':' + padZero(secs);
        }
        return minutes + ':' + padZero(secs);
    }

    function padZero(num) {
        return num < 10 ? '0' + num : num;
    }

    function buildPlaybackData() {
        return {
            ItemId: itemId,
            PlaySessionId: playSessionId,
            PositionTicks: Math.floor(videoPlayer.currentTime * 10000000),
            IsPaused: videoPlayer.paused,
            IsMuted: videoPlayer.muted,
            VolumeLevel: Math.floor(videoPlayer.volume * 100)
        };
    }

    function makePlaybackRequest(url, data, onSuccess, onError) {
        ajax.request(url, {
            method: 'POST',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken),
                'Content-Type': 'application/json'
            },
            data: data,
            success: onSuccess,
            error: onError
        });
    }

    // ============================================================================
    // PLAYBACK REPORTING
    // ============================================================================

    function reportPlaybackStart() {
        if (USE_PLAYBACK_MANAGER) {
            console.log('[Player] Skipping manual playback start report (using PlaybackManager)');
            return;
        }

        makePlaybackRequest(
            auth.serverAddress + '/Sessions/Playing',
            buildPlaybackData(),
            function() {
            },
            function(err) {
            }
        );
    }

    function reportPlaybackProgress() {
        if (!playSessionId) return;

        if (USE_PLAYBACK_MANAGER) {
            return;
        }

        console.log('[Player] Reporting progress to:', auth.serverAddress);
        makePlaybackRequest(
            auth.serverAddress + '/Sessions/Playing/Progress',
            buildPlaybackData(),
            function() {
                console.log('[Player] Progress reported successfully');
            },
            function(err) {
                console.error('[Player] Failed to report progress:', err);
                ServerLogger.logPlaybackError('Failed to report progress', {
                    error: err,
                    sessionId: playSessionId,
                    serverAddress: auth.serverAddress
                });
            }
        );
    }

    function reportPlaybackStop() {
        if (!playSessionId) return;

        if (USE_PLAYBACK_MANAGER) {
            console.log('[Player] Skipping manual playback stop report (using PlaybackManager)');
            return;
        }

        console.log('[Player] Reporting stop to:', auth.serverAddress);
        makePlaybackRequest(
            auth.serverAddress + '/Sessions/Playing/Stopped',
            buildPlaybackData(),
            function() {
                console.log('[Player] Stop reported successfully');
            },
            function(err) {
                console.error('[Player] Failed to report stop:', err);
                ServerLogger.logPlaybackError('Failed to report stop', {
                    error: err,
                    sessionId: playSessionId,
                    serverAddress: auth.serverAddress
                });
            }
        );
    }

    function startProgressReporting() {
        if (progressInterval) clearInterval(progressInterval);
        
        progressInterval = setInterval(function() {
            reportPlaybackProgress();
        }, PROGRESS_REPORT_INTERVAL_MS);
    }

    function stopProgressReporting() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    // ============================================================================
    // PLAYBACK CONTROLS
    // ============================================================================

    // ============================================================================
    // PLAYBACK CONTROLS
    // ============================================================================

    function togglePlayPause() {
        if (videoPlayer.paused) {
            play();
        } else {
            pause();
        }
    }

    function play() {
        videoPlayer.play();
        if (elements.playPauseBtn) {
            const icon = elements.playPauseBtn.querySelector('.btn-icon');
            if (icon) icon.src = 'assets/pause.png';
        }
        showControls();
    }

    function pause() {
        videoPlayer.pause();
        if (elements.playPauseBtn) {
            const icon = elements.playPauseBtn.querySelector('.btn-icon');
            if (icon) icon.src = 'assets/play.png';
        }
        showControls();
    }

    function rewind() {
        seekTo(Math.max(0, videoPlayer.currentTime - SKIP_INTERVAL_SECONDS));
        showControls();
    }

    function forward() {
        seekTo(Math.min(videoPlayer.duration, videoPlayer.currentTime + SKIP_INTERVAL_SECONDS));
        showControls();
    }
    
    function seekForward() {
        var duration = videoPlayer.duration;
        if (duration) {

            var currentPosition = pendingSeekPosition !== null ? pendingSeekPosition : videoPlayer.currentTime;
            seekPosition = Math.min(currentPosition + SKIP_INTERVAL_SECONDS, duration);
            seekTo(seekPosition);
            
            // Update trickplay bubble during keyboard seeking
            if (isSeekbarFocused && duration) {
                var percent = (seekPosition / duration) * 100;
                updateTrickplayBubble(seekPosition * TICKS_PER_SECOND, percent);
            }
            
            showControls();
        }
    }
    
    function seekBackward() {
        var duration = videoPlayer.duration;

        var currentPosition = pendingSeekPosition !== null ? pendingSeekPosition : videoPlayer.currentTime;
        seekPosition = Math.max(currentPosition - SKIP_INTERVAL_SECONDS, 0);
        seekTo(seekPosition);
        
        // Update trickplay bubble during keyboard seeking
        if (isSeekbarFocused && duration) {
            var percent = (seekPosition / duration) * 100;
            updateTrickplayBubble(seekPosition * TICKS_PER_SECOND, percent);
        }
        
        showControls();
    }
    
    function seekTo(position) {
        if (!videoPlayer.duration || isNaN(position)) return;
        
        position = Math.max(0, Math.min(position, videoPlayer.duration));
        pendingSeekPosition = position;
        isSeekingActive = true; // Prevent onTimeUpdate from overriding seek preview
        
        updateSeekPreview(position);
        
        if (seekDebounceTimer) {
            clearTimeout(seekDebounceTimer);
        }
        
        seekDebounceTimer = setTimeout(function() {
            performSeek(pendingSeekPosition);
            seekDebounceTimer = null;
        }, SEEK_DEBOUNCE_MS);
    }
    
    function performSeek(position) {
        if (isSeeking) return;
        
        isSeeking = true;
        showSeekingIndicator();
        
        try {
            if (playerAdapter && playerAdapter.seek) {
                playerAdapter.seek(position);
            } else {
                videoPlayer.currentTime = position;
            }
        } catch (error) {
        }
        
        setTimeout(function() {
            isSeeking = false;
            isSeekingActive = false; // Allow onTimeUpdate to update seek indicator again
            hideSeekingIndicator();
        }, FOCUS_DELAY_MS);
    }
    
    function updateSeekPreview(position) {
        if (!videoPlayer.duration) return;
        
        var progress = (position / videoPlayer.duration) * 100;
        
        if (elements.seekIndicator) {
            elements.seekIndicator.style.left = progress + '%';
            elements.seekIndicator.style.opacity = '1';
        }
        
        if (elements.timeDisplay) {
            elements.timeDisplay.textContent = formatTime(position) + ' / ' + formatTime(videoPlayer.duration);
        }
        
        if (elements.endTime) {
            var remainingSeconds = videoPlayer.duration - position;
            var endDate = new Date(Date.now() + remainingSeconds * 1000);
            var hours = endDate.getHours();
            var minutes = endDate.getMinutes();
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            var timeString = hours + ':' + (minutes < 10 ? '0' + minutes : minutes) + ' ' + ampm;
            elements.endTime.textContent = 'Ends at ' + timeString;
        }
    }
    
    function showSeekingIndicator() {
        if (elements.seekIndicator) {
            elements.seekIndicator.classList.add('seeking');
        }
    }
    
    function hideSeekingIndicator() {
        if (elements.seekIndicator) {
            elements.seekIndicator.classList.remove('seeking');
            elements.seekIndicator.style.opacity = '';
        }
    }
    
    function handleProgressBarClick(evt) {
        var rect = elements.progressBar.getBoundingClientRect();
        var pos = (evt.clientX - rect.left) / rect.width;
        var targetTime = pos * videoPlayer.duration;
        seekTo(targetTime);
        showControls();
    }

    // ============================================================================
    // UI CONTROLS
    // ============================================================================

    function showControls() {
        if (elements.playerControls) {
            elements.playerControls.classList.add('visible');
        }
        if (elements.videoDimmer) {
            elements.videoDimmer.classList.add('visible');
        }
        document.body.classList.add('controls-visible');
        controlsVisible = true;
        
        // Temporarily hide skip button when controls are shown to avoid focus conflicts
        if (skipOverlayVisible && elements.skipOverlay) {
            elements.skipOverlay.style.opacity = '0';
            elements.skipOverlay.style.pointerEvents = 'none';
        }

        if (controlsTimeout) clearTimeout(controlsTimeout);
        
        controlsTimeout = setTimeout(function() {
            if (!videoPlayer.paused) {
                hideControls();
            }
        }, CONTROLS_HIDE_DELAY_MS);
    }

    function hideControls() {
        if (elements.playerControls) {
            elements.playerControls.classList.remove('visible');
        }
        if (elements.videoDimmer) {
            elements.videoDimmer.classList.remove('visible');
        }
        document.body.classList.remove('controls-visible');
        controlsVisible = false;
        
        // Restore skip button visibility when controls hide
        if (skipOverlayVisible && elements.skipOverlay) {
            elements.skipOverlay.style.opacity = '1';
            elements.skipOverlay.style.pointerEvents = 'all';
            // Refocus skip button if it was visible
            if (elements.skipButton) {
                elements.skipButton.focus();
            }
        }
    }

    // ============================================================================
    // VIDEO EVENT HANDLERS
    // ============================================================================

    function onPlay() {
    }

    function onPause() {
    }
    
    function onCanPlay() {
        console.log('[Player] Video ready to play');
        clearLoadingTimeout();
        setLoadingState(LoadingState.READY);
        
        if (videoPlayer.paused && videoPlayer.readyState >= 3) {
            videoPlayer.play().catch(function(err) {
            });
        }
    }
    
    function onLoadedMetadata() {
        clearLoadingTimeout();
    }
    
    function onWaiting() {
    }
    
    function onPlaying() {
        clearLoadingTimeout();
        setLoadingState(LoadingState.READY);
        
        if (!progressInterval) {
            reportPlaybackStart();
            startProgressReporting();
            detectCurrentAudioTrack();
        }
        
        // Apply playback speed
        if (videoPlayer && currentPlaybackSpeed !== 1.0) {
            videoPlayer.playbackRate = currentPlaybackSpeed;
        }
        
        // Start bitrate monitoring
        startBitrateMonitoring();
        
        showControls();
        
        if (elements.progressBar && !document.activeElement.classList.contains('progress-bar')) {
            setTimeout(function() {
                elements.progressBar.focus();
            }, FOCUS_DELAY_MS);
        }
    }

    function onTimeUpdate() {
        if (!videoPlayer.duration) return;

        var progress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        if (elements.progressFill) {
            elements.progressFill.style.width = progress + '%';
        }
        
        // Don't update seek indicator position while user is actively seeking
        // to prevent jumping back and forth during seek preview
        if (elements.seekIndicator && !isSeekingActive) {
            elements.seekIndicator.style.left = progress + '%';
        }

        if (elements.timeDisplay) {
            elements.timeDisplay.textContent = formatTime(videoPlayer.currentTime) + ' / ' + formatTime(videoPlayer.duration);
        }

        if (elements.endTime) {
            var remainingSeconds = videoPlayer.duration - videoPlayer.currentTime;
            var endDate = new Date(Date.now() + remainingSeconds * 1000);
            var hours = endDate.getHours();
            var minutes = endDate.getMinutes();
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            var timeString = hours + ':' + (minutes < 10 ? '0' + minutes : minutes) + ' ' + ampm;
            elements.endTime.textContent = 'Ends at ' + timeString;
        }
        

        checkSkipSegments(videoPlayer.currentTime);
        
        // Update skip button countdown if visible
        if (skipOverlayVisible && currentSkipSegment) {
            var timeLeft = Math.ceil(currentSkipSegment.EndTicks / 10000000 - videoPlayer.currentTime);
            updateSkipButtonTime(timeLeft);
        }
    }

    /**
     * Handle video ended event
     */
    function onEnded() {
        console.log('[Player] Playback ended');
        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        
        // Clear health check timer
        if (playbackHealthCheckTimer) {
            clearTimeout(playbackHealthCheckTimer);
            playbackHealthCheckTimer = null;
        }
        
        window.history.back();
    }

    /**
     * Handle video error event
     * @param {Event} evt - Error event
     */
    function onError(evt) {
        console.error('[Player] Playback error:', evt);
        
        var errorCode = videoPlayer.error ? videoPlayer.error.code : 'unknown';
        var errorMessage = videoPlayer.error ? videoPlayer.error.message : 'Unknown error';
        console.error('[Player] Error code:', errorCode, 'Message:', errorMessage);
        
        ServerLogger.logPlaybackError('Playback error occurred', {
            errorCode: errorCode,
            errorMessage: errorMessage,
            mediaSourceId: currentMediaSource ? currentMediaSource.Id : null,
            sessionId: playSessionId
        });
        
        clearLoadingTimeout();
        setLoadingState(LoadingState.ERROR);
        
        if (currentMediaSource && currentMediaSource.SupportsDirectPlay && 
            attemptTranscodeFallback(currentMediaSource, 'Playback error: ' + errorCode)) {
            alert('Direct playback error (code: ' + errorCode + '). Switching to transcoding...');
            return;
        }
        
        alert('Playback error occurred (code: ' + errorCode + ')');
    }

    function playPreviousItem() {

        if (previousEpisodeData) {
            playPreviousEpisode();
            return;
        }
        

        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        cleanupAudioNormalization();
        
        window.history.back();
    }
    
    function playNextItem() {

        if (nextEpisodeData) {
            playNextEpisode();
            return;
        }
        

        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        cleanupAudioNormalization();
        
        window.history.back();
    }
    
    /**
     * Play the previous episode in the series without reloading the page
     */
    function playPreviousEpisode() {
        console.log('[playPreviousEpisode] START');
        if (!previousEpisodeData) {
            console.log('[playPreviousEpisode] No previous episode data available');
            return;
        }
        
        console.log('[playPreviousEpisode] Previous episode:', previousEpisodeData.Name, previousEpisodeData.Id);
        

        var prevEpisodeId = previousEpisodeData.Id;
        

        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        cleanupAudioNormalization();
        

        currentSkipSegment = null;
        skipOverlayVisible = false;
        hideSkipOverlay();
        mediaSegments = [];
        nextEpisodeData = null;
        previousEpisodeData = null;
        trickplayData = null;
        trickplayResolution = null;
        hideTrickplayBubble();
        
        // Update browser history
        if (window && window.history && window.location) {
            var newUrl = 'player.html?id=' + prevEpisodeId;
            window.history.replaceState({}, '', newUrl);
        }
        

        itemId = prevEpisodeId;
        loadItemAndPlay();
    }

    function exitPlayer() {

        if (playSessionId) {
            makePlaybackRequest(
                auth.serverAddress + '/Sessions/Playing/Stopped',
                buildPlaybackData(),
                function() {

                    finishExit();
                },
                function(err) {

                    finishExit();
                }
            );
        } else {
            finishExit();
        }
        
        function finishExit() {
            stopProgressReporting();
            stopBitrateMonitoring();
            
            clearLoadingTimeout();
            
            if (seekDebounceTimer) {
                clearTimeout(seekDebounceTimer);
                seekDebounceTimer = null;
            }
            
            // Clear health check timer
            if (playbackHealthCheckTimer) {
                clearTimeout(playbackHealthCheckTimer);
                playbackHealthCheckTimer = null;
            }
            
            // Cleanup audio normalization
            cleanupAudioNormalization();
            
            // Cleanup trickplay
            trickplayData = null;
            trickplayResolution = null;
            hideTrickplayBubble();
            
            if (playerAdapter) {
                playerAdapter.destroy().catch(function(err) {
                });
                playerAdapter = null;
            }
            
            setLoadingState(LoadingState.IDLE);
            window.history.back();
        }
    }

    // ============================================================================
    // LOADING STATE MANAGEMENT
    // ============================================================================

    function showLoading() {
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'flex';
        }
    }

    function hideLoading() {
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'none';
        }
    }

    function showErrorDialog(title, message, details) {
        hideLoading();
        
        if (!elements.errorDialog) return;
        
        elements.errorDialogTitle.textContent = title || 'Playback Error';
        elements.errorDialogMessage.textContent = message || 'An error occurred during playback';
        
        if (details) {
            elements.errorDialogDetails.textContent = details;
            elements.errorDialogDetails.style.display = 'block';
        } else {
            elements.errorDialogDetails.style.display = 'none';
        }
        
        elements.errorDialog.style.display = 'flex';
        setTimeout(() => {
            elements.errorDialogBtn.focus();
        }, 100);
    }

    function closeErrorDialog() {
        if (elements.errorDialog) {
            elements.errorDialog.style.display = 'none';
        }
        window.history.back();
    }

    function detectCurrentAudioTrack() {
        if (!playerAdapter || !itemData || !itemData.MediaSources) return;
        
        try {
            // For Shaka Player, get the current audio language
            if (playerAdapter.getName() === 'ShakaPlayer' && playerAdapter.player) {
                var currentVariant = playerAdapter.player.getVariantTracks().find(function(t) {
                    return t.active;
                });
                
                if (currentVariant && currentVariant.language) {
                    var audioStreams = itemData.MediaSources[0].MediaStreams.filter(function(s) {
                        return s.Type === 'Audio';
                    });
                    
                    // Find matching stream by language
                    for (var i = 0; i < audioStreams.length; i++) {
                        if (audioStreams[i].Language === currentVariant.language) {
                            currentAudioIndex = i;
                            break;
                        }
                    }
                }
            } else {
                // For non-Shaka, initialize to default track
                initializeDefaultTrackIndices();
            }
        } catch (error) {
        }
    }
    
    function initializeDefaultTrackIndices() {
        if (!itemData || !itemData.MediaSources || !itemData.MediaSources[0].MediaStreams) return;
        
        var mediaStreams = itemData.MediaSources[0].MediaStreams;
        
        // Initialize audio index to default track if not already set
        if (currentAudioIndex < 0) {
            var audioStreams = mediaStreams.filter(function(s) { return s.Type === 'Audio'; });
            for (var i = 0; i < audioStreams.length; i++) {
                if (audioStreams[i].IsDefault) {
                    currentAudioIndex = i;
                    break;
                }
            }
            // If no default, use first track
            if (currentAudioIndex < 0 && audioStreams.length > 0) {
                currentAudioIndex = 0;
            }
        }
        
        // Initialize subtitle index to default track if not already set
        if (currentSubtitleIndex === -1) {
            var subtitleStreams = mediaStreams.filter(function(s) { return s.Type === 'Subtitle'; });
            for (var i = 0; i < subtitleStreams.length; i++) {
                if (subtitleStreams[i].IsDefault) {
                    currentSubtitleIndex = i;
                    break;
                }
            }
        }
    }

    // ============================================================================
    // PLAYBACKMANAGER TRACK LOADING
    // ============================================================================

    /**
     * Load audio tracks from PlaybackManager
     * Called when USE_PLAYBACK_MANAGER is true
     */
    function loadAudioTracksFromPlaybackManager() {
        if (!playbackManagerAdapter) {
            console.warn('[Player] PlaybackManager adapter not available');
            return;
        }

        const tracks = playbackManagerAdapter.getAudioTracks();
        if (!tracks || tracks.length === 0) {
            console.log('[Player] No audio tracks from PlaybackManager');
            audioStreams = [];
            return;
        }

        console.log('[Player] Loaded', tracks.length, 'audio tracks from PlaybackManager');
        
        audioStreams = tracks.map(function(track) {
            return {
                Index: track.Index,
                Type: 'Audio',
                Codec: track.Codec,
                Language: track.Language,
                DisplayTitle: track.DisplayTitle || track.Language || 'Track ' + (track.Index + 1),
                IsDefault: track.IsDefault,
                Channels: track.Channels,
                BitRate: track.BitRate
            };
        });

        currentAudioIndex = playbackManagerAdapter.getCurrentAudioStreamIndex();
        if (currentAudioIndex === undefined || currentAudioIndex < 0) {
            currentAudioIndex = 0;
        }

        console.log('[Player] Current audio track index:', currentAudioIndex);
    }

    /**
     * Load subtitle tracks from PlaybackManager
     * Called when USE_PLAYBACK_MANAGER is true
     */
    function loadSubtitleTracksFromPlaybackManager() {
        if (!playbackManagerAdapter) {
            console.warn('[Player] PlaybackManager adapter not available');
            return;
        }

        const tracks = playbackManagerAdapter.getSubtitleTracks();
        if (!tracks || tracks.length === 0) {
            console.log('[Player] No subtitle tracks from PlaybackManager');
            subtitleStreams = [];
            return;
        }

        console.log('[Player] Loaded', tracks.length, 'subtitle tracks from PlaybackManager');
        
        subtitleStreams = tracks.map(function(track) {
            return {
                Index: track.Index,
                Type: 'Subtitle',
                Codec: track.Codec,
                Language: track.Language,
                DisplayTitle: track.DisplayTitle || track.Language || 'Track ' + (track.Index + 1),
                IsDefault: track.IsDefault,
                IsForced: track.IsForced,
                IsExternal: track.DeliveryMethod === 'External'
            };
        });

        currentSubtitleIndex = playbackManagerAdapter.getCurrentSubtitleStreamIndex();
        if (currentSubtitleIndex === undefined) {
            currentSubtitleIndex = -1; // -1 means off
        }

        console.log('[Player] Current subtitle track index:', currentSubtitleIndex);
    }

    // ============================================================================
    // TRACK SELECTION
    // ============================================================================

    function showAudioTrackSelector() {
        
        if (!itemData || !itemData.MediaSources || !itemData.MediaSources[0].MediaStreams) {
            return;
        }

        audioStreams = itemData.MediaSources[0].MediaStreams.filter(function(s) {
            return s.Type === 'Audio';
        });

        if (audioStreams.length === 0) {
            return;
        }
        // Build language map for Shaka Player
        audioLanguageMap = audioStreams.map(function(s) {
            return s.Language || 'und';
        });

        modalFocusableItems = TrackSelector.buildAudioTrackList(
            audioStreams,
            currentAudioIndex,
            elements.audioTrackList,
            selectAudioTrack
        );
        

        activeModal = 'audio';
        elements.audioModal.style.display = 'flex';
        currentModalFocusIndex = Math.max(0, currentAudioIndex);
        if (modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
        }
    }

    function showSubtitleTrackSelector() {
        
        if (!itemData || !itemData.MediaSources || !itemData.MediaSources[0].MediaStreams) {
            return;
        }

        subtitleStreams = itemData.MediaSources[0].MediaStreams.filter(function(s) {
            return s.Type === 'Subtitle';
        });
        modalFocusableItems = TrackSelector.buildSubtitleTrackList(
            subtitleStreams,
            currentSubtitleIndex,
            elements.subtitleTrackList,
            selectSubtitleTrack
        );
        

        activeModal = 'subtitle';
        elements.subtitleModal.style.display = 'flex';
        currentModalFocusIndex = currentSubtitleIndex + 1; // +1 because of "None" option
        if (modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
        }
    }

    function selectAudioTrack(index) {
        console.log('[Player] Selecting audio track:', index);
        
        if (index < 0 || index >= audioStreams.length) {
            console.warn('[Player] Invalid audio track index:', index);
            return;
        }

        if (USE_PLAYBACK_MANAGER && playbackManagerAdapter) {
            const stream = audioStreams[index];
            const success = playbackManagerAdapter.setAudioStreamIndex(stream.Index);
            
            if (success) {
                currentAudioIndex = index;
                console.log('[Player] Audio track changed via PlaybackManager');
                
                if (modalFocusableItems && modalFocusableItems.length > 0) {
                    modalFocusableItems.forEach(function(item) {
                        item.classList.remove('selected');
                    });
                    if (modalFocusableItems[index]) {
                        modalFocusableItems[index].classList.add('selected');
                    }
                }
                
                closeModal();
                return;
            } else {
                console.error('[Player] Failed to change audio track via PlaybackManager');
            }
        }


        if (modalFocusableItems && modalFocusableItems.length > 0) {
            modalFocusableItems.forEach(function(item) {
                item.classList.remove('selected');
            });
            if (modalFocusableItems[index]) {
                modalFocusableItems[index].classList.add('selected');
            }
        }
        
        currentAudioIndex = index;
        var stream = audioStreams[index];
        var language = stream.Language || 'und';
        
        

        // Must reload video with new AudioStreamIndex parameter
        if (!isTranscoding && playerAdapter && typeof playerAdapter.selectAudioTrack === 'function') {
            try {
                // For Shaka, we need to pass the language, not the array index
                var adapterIndex = index;
                
                // If using Shaka adapter, it expects a language-based index
                // We need to find which unique language position this is
                if (playerAdapter.constructor.name === 'ShakaPlayerAdapter') {
                    var uniqueLanguages = [];
                    var seenLanguages = new Set();
                    audioStreams.forEach(function(s) {
                        var lang = s.Language || 'und';
                        if (!seenLanguages.has(lang)) {
                            seenLanguages.add(lang);
                            uniqueLanguages.push(lang);
                        }
                    });
                    adapterIndex = uniqueLanguages.indexOf(language);
                }
                
                var result = playerAdapter.selectAudioTrack(adapterIndex);
                
                if (result) {
                    closeModal();
                    return;
                } else {
                }
            } catch (error) {
            }
        }
        
        reloadVideoWithTrack('audio', stream);
        closeModal();
    }

    function selectSubtitleTrack(index) {
        console.log('[Player] Selecting subtitle track:', index === -1 ? 'None' : index);
        
        if (USE_PLAYBACK_MANAGER && playbackManagerAdapter) {
            const streamIndex = index >= 0 && index < subtitleStreams.length ? subtitleStreams[index].Index : -1;
            const success = playbackManagerAdapter.setSubtitleStreamIndex(streamIndex);
            
            if (success) {
                currentSubtitleIndex = index;
                console.log('[Player] Subtitle track changed via PlaybackManager');
                
                // Update UI
                if (modalFocusableItems && modalFocusableItems.length > 0) {
                    modalFocusableItems.forEach(function(item) {
                        item.classList.remove('selected');
                    });
                    var modalIndex = index === -1 ? 0 : index + 1; // +1 because "None" is at position 0
                    if (modalFocusableItems[modalIndex]) {
                        modalFocusableItems[modalIndex].classList.add('selected');
                    }
                }
                
                closeModal();
                return;
            } else {
                console.error('[Player] Failed to change subtitle track via PlaybackManager');
            }
        }


        if (modalFocusableItems && modalFocusableItems.length > 0) {
            modalFocusableItems.forEach(function(item) {
                item.classList.remove('selected');
            });
            var modalIndex = index === -1 ? 0 : index + 1; // +1 because "None" is at position 0
            if (modalFocusableItems[modalIndex]) {
                modalFocusableItems[modalIndex].classList.add('selected');
            }
        }
        
        currentSubtitleIndex = index;
        

        // Must reload video with new SubtitleStreamIndex parameter  
        if (!isTranscoding && playerAdapter && typeof playerAdapter.selectSubtitleTrack === 'function') {
            try {
                // For subtitles, -1 means disable, otherwise use the array index
                var adapterIndex = index;
                
                // If using Shaka adapter and not disabling, map to unique subtitle tracks
                if (index >= 0 && playerAdapter.constructor.name === 'ShakaPlayerAdapter') {
                    if (index >= subtitleStreams.length) {
                        return;
                    }
                    var stream = subtitleStreams[index];
                }
                
                var result = playerAdapter.selectSubtitleTrack(adapterIndex);
                
                closeModal();
                if (index >= 0 && index < subtitleStreams.length) {
                    var stream = subtitleStreams[index];
                } else {
                }
                return;
            } catch (error) {
            }
        }
        
        var tracks = videoPlayer.textTracks;
        for (var i = 0; i < tracks.length; i++) {
            tracks[i].mode = 'disabled';
        }

        if (index >= 0 && index < subtitleStreams.length) {
            var stream = subtitleStreams[index];
            reloadVideoWithTrack('subtitle', stream);
        } else {
        }

        closeModal();
    }

    function reloadVideoWithTrack(trackType, stream) {
        console.log('[Player] Reloading video with', trackType, 'track:', stream.Index);
        
        var currentTime = videoPlayer.currentTime;
        var wasPaused = videoPlayer.paused;
        
        // Generate a NEW PlaySessionId to force Jellyfin to create a fresh transcode with the selected tracks
        var newPlaySessionId = generateUUID();
        
        // Build stream URL with track-specific parameters
        var streamUrl = auth.serverAddress + '/Videos/' + itemId + '/master.m3u8';

        var params = new URLSearchParams();
        params.append('mediaSourceId', currentMediaSource.Id);
        params.append('deviceId', JellyfinAPI.init());
        params.append('api_key', auth.accessToken);
        params.append('PlaySessionId', newPlaySessionId);  // New session ID
        params.append('VideoCodec', 'h264');
        params.append('AudioCodec', 'aac');
        params.append('VideoBitrate', '20000000');  // Increased for better quality
        params.append('AudioBitrate', '256000');
        params.append('MaxWidth', '3840');  // Support 4K transcoding
        params.append('MaxHeight', '2160');
        params.append('SegmentLength', '6');
        params.append('MinSegments', '3');
        params.append('BreakOnNonKeyFrames', 'false');

        // Set the specific track indices - these tell Jellyfin which tracks to transcode
        if (trackType === 'audio') {
            params.set('AudioStreamIndex', stream.Index);
            // Preserve subtitle selection
            if (currentSubtitleIndex >= 0 && currentSubtitleIndex < subtitleStreams.length) {
                params.set('SubtitleStreamIndex', subtitleStreams[currentSubtitleIndex].Index);
            }
        } else if (trackType === 'subtitle') {
            params.set('SubtitleStreamIndex', stream.Index);
            params.set('SubtitleMethod', 'Encode');  // Tell Jellyfin to burn in subtitles
            // Preserve audio selection
            if (currentAudioIndex >= 0 && currentAudioIndex < audioStreams.length) {
                params.set('AudioStreamIndex', audioStreams[currentAudioIndex].Index);
            }
        }

        var videoUrl = streamUrl + '?' + params.toString();
        

        playSessionId = newPlaySessionId;
        
        setLoadingState(LoadingState.LOADING);
        

        if (playerAdapter && typeof playerAdapter.load === 'function') {
            playerAdapter.load(videoUrl, { startPosition: currentTime })
                .then(function() {
                    if (!wasPaused) {
                        return videoPlayer.play();
                    }
                })
                .then(function() {
                    setLoadingState(LoadingState.READY);
                })
                .catch(function(err) {
                    setLoadingState(LoadingState.ERROR);
                    alert('Failed to switch track. The selected track may not be compatible.');
                });
        } else {
            videoPlayer.src = videoUrl;
            
            var onLoaded = function() {
                videoPlayer.removeEventListener('loadedmetadata', onLoaded);
                videoPlayer.currentTime = currentTime;
                
                if (!wasPaused) {
                    videoPlayer.play().catch(function(err) {
                    });
                }
                
                setLoadingState(LoadingState.READY);
            };
            
            videoPlayer.addEventListener('loadedmetadata', onLoaded);
        }
    }

    function showVideoInfo() {
        if (!itemData || !playbackInfo) {
            return;
        }

        var infoHtml = '<div class="info-section">';
        

        var liveStats = null;
        if (playerAdapter && typeof playerAdapter.getPlaybackStats === 'function') {
            liveStats = playerAdapter.getPlaybackStats();
        }
        
        // Show live playback information first if available (what's actually playing)
        if (liveStats) {
            infoHtml += '<div class="info-header">Active Playback</div>';
            
            // Show HDR status prominently
            if (liveStats.hdrType && liveStats.hdrType !== 'SDR') {
                infoHtml += '<div class="info-row info-highlight"><span class="info-label">HDR:</span><span class="info-value">' + liveStats.hdrType + '</span></div>';
            }
            
            // Show actual video codec being decoded
            if (liveStats.videoCodec) {
                var codecDisplay = liveStats.videoCodec.split('.')[0].toUpperCase();
                if (liveStats.videoCodec.startsWith('dvhe') || liveStats.videoCodec.startsWith('dvh1')) {
                    codecDisplay = 'DOLBY VISION (' + liveStats.videoCodec + ')';
                } else if (liveStats.videoCodec.startsWith('hev1') || liveStats.videoCodec.startsWith('hvc1')) {
                    codecDisplay = 'HEVC (' + liveStats.videoCodec + ')';
                }
                infoHtml += '<div class="info-row"><span class="info-label">Video Codec:</span><span class="info-value">' + codecDisplay + '</span></div>';
            }
            
            // Show actual resolution being played
            if (liveStats.width && liveStats.height) {
                var resolution = liveStats.width + 'x' + liveStats.height;
                var resolutionName = '';
                if (liveStats.height >= 2160) resolutionName = ' (4K)';
                else if (liveStats.height >= 1080) resolutionName = ' (1080p)';
                else if (liveStats.height >= 720) resolutionName = ' (720p)';
                infoHtml += '<div class="info-row"><span class="info-label">Playing:</span><span class="info-value">' + resolution + resolutionName + '</span></div>';
            }
            
            // Show actual bitrate
            if (liveStats.bandwidth) {
                var bitrateMbps = (liveStats.bandwidth / 1000000).toFixed(1);
                infoHtml += '<div class="info-row"><span class="info-label">Stream Bitrate:</span><span class="info-value">' + bitrateMbps + ' Mbps</span></div>';
            }
            
            // Show audio codec
            if (liveStats.audioCodec) {
                var audioCodecDisplay = liveStats.audioCodec.split('.')[0].toUpperCase();
                infoHtml += '<div class="info-row"><span class="info-label">Audio Codec:</span><span class="info-value">' + audioCodecDisplay + '</span></div>';
            }
            
            // Show performance stats if there are issues
            if (liveStats.droppedFrames > 0) {
                infoHtml += '<div class="info-row info-warning"><span class="info-label">Dropped Frames:</span><span class="info-value">' + liveStats.droppedFrames + '</span></div>';
            }
            
            if (liveStats.stallsDetected > 0) {
                infoHtml += '<div class="info-row info-warning"><span class="info-label">Stalls:</span><span class="info-value">' + liveStats.stallsDetected + '</span></div>';
            }
            
            infoHtml += '</div><div class="info-section">';
        }
        
        infoHtml += '<div class="info-header">Playback Method</div>';
        var mediaSource = playbackInfo.MediaSources[0];
        if (mediaSource.SupportsDirectPlay && !mediaSource.SupportsTranscoding) {
            infoHtml += '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Direct Play</span></div>';
        } else if (!mediaSource.SupportsDirectPlay && mediaSource.SupportsTranscoding) {
            infoHtml += '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Transcoding (HLS)</span></div>';
        } else {
            infoHtml += '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Direct Play (Transcode Available)</span></div>';
        }
        
        infoHtml += '</div><div class="info-section">';
        infoHtml += '<div class="info-header">Stream Information</div>';
        
        if (mediaSource.Container) {
            infoHtml += '<div class="info-row"><span class="info-label">Container:</span><span class="info-value">' + mediaSource.Container.toUpperCase() + '</span></div>';
        }
        
        if (mediaSource.Bitrate) {
            var bitrateMbps = (mediaSource.Bitrate / 1000000).toFixed(1);
            infoHtml += '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' + bitrateMbps + ' Mbps</span></div>';
        }
        
        if (mediaSource.Size) {
            var sizeGB = (mediaSource.Size / 1073741824).toFixed(2);
            infoHtml += '<div class="info-row"><span class="info-label">File Size:</span><span class="info-value">' + sizeGB + ' GB</span></div>';
        }
        
        if (mediaSource.MediaStreams) {
            var videoStream = null;
            var audioStream = null;
            
            for (var i = 0; i < mediaSource.MediaStreams.length; i++) {
                var stream = mediaSource.MediaStreams[i];
                if (stream.Type === 'Video' && !videoStream) {
                    videoStream = stream;
                } else if (stream.Type === 'Audio' && !audioStream) {
                    audioStream = stream;
                }
            }
            
            if (videoStream) {
                infoHtml += '</div><div class="info-section">';
                infoHtml += '<div class="info-header">Video (Source File)</div>';
                
                if (videoStream.DisplayTitle) {
                    infoHtml += '<div class="info-row"><span class="info-label">Stream:</span><span class="info-value">' + videoStream.DisplayTitle + '</span></div>';
                }
                
                if (videoStream.Codec) {
                    infoHtml += '<div class="info-row"><span class="info-label">Codec:</span><span class="info-value">' + videoStream.Codec.toUpperCase() + '</span></div>';
                }
                
                // Show codec profile if available (helps identify Dolby Vision profile)
                if (videoStream.Profile) {
                    infoHtml += '<div class="info-row"><span class="info-label">Profile:</span><span class="info-value">' + videoStream.Profile + '</span></div>';
                }
                
                if (videoStream.Width && videoStream.Height) {
                    var resolution = videoStream.Width + 'x' + videoStream.Height;
                    var resolutionName = '';
                    if (videoStream.Height >= 2160) resolutionName = ' (4K)';
                    else if (videoStream.Height >= 1080) resolutionName = ' (1080p)';
                    else if (videoStream.Height >= 720) resolutionName = ' (720p)';
                    else if (videoStream.Height >= 480) resolutionName = ' (480p)';
                    
                    infoHtml += '<div class="info-row"><span class="info-label">Resolution:</span><span class="info-value">' + resolution + resolutionName + '</span></div>';
                }
                
                if (videoStream.BitRate) {
                    var videoBitrateMbps = (videoStream.BitRate / 1000000).toFixed(1);
                    infoHtml += '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' + videoBitrateMbps + ' Mbps</span></div>';
                }
                
                // Highlight HDR information from source file
                if (videoStream.VideoRange) {
                    var rangeDisplay = videoStream.VideoRange.toUpperCase();
                    var cssClass = (videoStream.VideoRange.toLowerCase() !== 'sdr') ? 'info-row info-highlight' : 'info-row';
                    infoHtml += '<div class="' + cssClass + '"><span class="info-label">Range:</span><span class="info-value">' + rangeDisplay + '</span></div>';
                }
                
                // Show color space and bit depth if available
                if (videoStream.ColorSpace) {
                    infoHtml += '<div class="info-row"><span class="info-label">Color Space:</span><span class="info-value">' + videoStream.ColorSpace + '</span></div>';
                }
                
                if (videoStream.BitDepth) {
                    infoHtml += '<div class="info-row"><span class="info-label">Bit Depth:</span><span class="info-value">' + videoStream.BitDepth + '-bit</span></div>';
                }
                
                if (videoStream.AverageFrameRate || videoStream.RealFrameRate) {
                    var fps = videoStream.AverageFrameRate || videoStream.RealFrameRate;
                    infoHtml += '<div class="info-row"><span class="info-label">Frame Rate:</span><span class="info-value">' + fps.toFixed(2) + ' fps</span></div>';
                }
            }
            
            if (audioStream) {
                infoHtml += '</div><div class="info-section">';
                infoHtml += '<div class="info-header">Audio</div>';
                
                if (audioStream.DisplayTitle) {
                    infoHtml += '<div class="info-row"><span class="info-label">Stream:</span><span class="info-value">' + audioStream.DisplayTitle + '</span></div>';
                }
                
                if (audioStream.Codec) {
                    infoHtml += '<div class="info-row"><span class="info-label">Codec:</span><span class="info-value">' + audioStream.Codec.toUpperCase() + '</span></div>';
                }
                
                if (audioStream.Channels) {
                    var channelLayout = audioStream.Channels + '.0';
                    if (audioStream.Channels === 6) channelLayout = '5.1';
                    else if (audioStream.Channels === 8) channelLayout = '7.1';
                    infoHtml += '<div class="info-row"><span class="info-label">Channels:</span><span class="info-value">' + channelLayout + '</span></div>';
                }
                
                if (audioStream.SampleRate) {
                    var sampleRateKHz = (audioStream.SampleRate / 1000).toFixed(1);
                    infoHtml += '<div class="info-row"><span class="info-label">Sample Rate:</span><span class="info-value">' + sampleRateKHz + ' kHz</span></div>';
                }
                
                if (audioStream.BitRate) {
                    var audioBitrateKbps = (audioStream.BitRate / 1000).toFixed(0);
                    infoHtml += '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' + audioBitrateKbps + ' kbps</span></div>';
                }
                
                if (audioStream.Language) {
                    infoHtml += '<div class="info-row"><span class="info-label">Language:</span><span class="info-value">' + audioStream.Language.toUpperCase() + '</span></div>';
                }
            }
        }
        
        infoHtml += '</div>';
        
        elements.videoInfoContent.innerHTML = infoHtml;
        elements.videoInfoModal.style.display = 'flex';
        activeModal = 'videoInfo';
        
        // Make the content scrollable with remote control
        // Use the content container itself as the focusable element for scrolling
        setTimeout(function() {
            if (elements.videoInfoContent) {
                elements.videoInfoContent.setAttribute('tabindex', '0');
                elements.videoInfoContent.focus();
            }
        }, 100);
        
    }

    function showChaptersModal() {
        if (!itemData || !itemData.Chapters || itemData.Chapters.length === 0) {
            // Still show modal but with "No chapters" message
            elements.chaptersContent.innerHTML = '<div class="no-chapters"><p>No chapters available for this video</p></div>';
            elements.chaptersModal.style.display = 'flex';
            activeModal = 'chapters';
            return;
        }

        // Build chapters list
        var chaptersHtml = '<div class="chapter-list">';
        
        var currentTime = videoPlayer.currentTime * 10000000; // Convert to ticks
        
        itemData.Chapters.forEach(function(chapter, index) {
            var chapterStartSeconds = chapter.StartPositionTicks / 10000000;
            var hours = Math.floor(chapterStartSeconds / 3600);
            var minutes = Math.floor((chapterStartSeconds % 3600) / 60);
            var seconds = Math.floor(chapterStartSeconds % 60);
            
            var timeStr = '';
            if (hours > 0) {
                timeStr = hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
            } else {
                timeStr = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
            }
            
            var chapterName = chapter.Name || ('Chapter ' + (index + 1));
            
            // Check if this is the current chapter
            var isCurrent = false;
            if (index < itemData.Chapters.length - 1) {
                var nextChapterStart = itemData.Chapters[index + 1].StartPositionTicks;
                isCurrent = currentTime >= chapter.StartPositionTicks && currentTime < nextChapterStart;
            } else {
                // Last chapter
                isCurrent = currentTime >= chapter.StartPositionTicks;
            }
            
            var currentClass = isCurrent ? ' current-chapter' : '';
            var currentIndicator = isCurrent ? ' ► ' : '';
            
            chaptersHtml += '<div class="chapter-item' + currentClass + '" data-chapter-index="' + index + '" data-start-ticks="' + chapter.StartPositionTicks + '" tabindex="0">';
            chaptersHtml += '<div class="chapter-time">' + currentIndicator + timeStr + '</div>';
            chaptersHtml += '<div class="chapter-name">' + chapterName + '</div>';
            chaptersHtml += '</div>';
        });
        
        chaptersHtml += '</div>';
        
        elements.chaptersContent.innerHTML = chaptersHtml;
        elements.chaptersModal.style.display = 'flex';
        activeModal = 'chapters';
        
        // Set up focusable items for keyboard navigation
        modalFocusableItems = Array.from(document.querySelectorAll('.chapter-item'));
        currentModalFocusIndex = 0;
        
        // Find current chapter and focus it
        var currentChapterIndex = 0;
        itemData.Chapters.forEach(function(chapter, index) {
            if (index < itemData.Chapters.length - 1) {
                var nextChapterStart = itemData.Chapters[index + 1].StartPositionTicks;
                if (currentTime >= chapter.StartPositionTicks && currentTime < nextChapterStart) {
                    currentChapterIndex = index;
                }
            } else if (currentTime >= chapter.StartPositionTicks) {
                currentChapterIndex = index;
            }
        });
        
        currentModalFocusIndex = currentChapterIndex;
        
        if (modalFocusableItems.length > 0) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        // Add click/enter handlers for chapters
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var startTicks = parseInt(item.getAttribute('data-start-ticks'));
                seekToChapter(startTicks);
            });
        });
        
    }

    function seekToChapter(startTicks) {
        var startSeconds = startTicks / 10000000;
        
        

        if (playerAdapter && typeof playerAdapter.seek === 'function') {
            playerAdapter.seek(startSeconds);
        } else {
            videoPlayer.currentTime = startSeconds;
        }
        

        closeModal();
    }

    function showPlaybackSpeedSelector() {
        if (!elements.speedList || !elements.speedModal) {
            return;
        }
        
        var listHtml = '';
        PLAYBACK_SPEEDS.forEach(function(speed) {
            var isSelected = Math.abs(speed - currentPlaybackSpeed) < 0.01;
            listHtml += '<div class="track-item' + (isSelected ? ' selected' : '') + '" tabindex="0" data-speed="' + speed + '">';
            listHtml += '<span class="track-name">' + speed.toFixed(2) + 'x</span>';
            if (isSelected) {
                listHtml += '<span class="selected-indicator"><img src="assets/icons/check.png" alt="" class="emoji-icon"></span>';
            }
            listHtml += '</div>';
        });
        
        elements.speedList.innerHTML = listHtml;
        elements.speedModal.style.display = 'flex';
        activeModal = 'speed';
        
        modalFocusableItems = Array.from(elements.speedList.querySelectorAll('.track-item'));
        currentModalFocusIndex = PLAYBACK_SPEEDS.indexOf(currentPlaybackSpeed);
        if (currentModalFocusIndex < 0) currentModalFocusIndex = 3; // Default to 1.0x
        
        if (modalFocusableItems.length > 0) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        // Add click handlers
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var speed = parseFloat(item.getAttribute('data-speed'));
                setPlaybackSpeed(speed);
            });
        });
        
    }
    
    function setPlaybackSpeed(speed) {
        if (speed < 0.25 || speed > 2.0) {
            return;
        }
        
        currentPlaybackSpeed = speed;
        
        if (videoPlayer) {
            videoPlayer.playbackRate = speed;
        }
        
        // Show speed indicator briefly
        if (elements.speedIndicator) {
            elements.speedIndicator.textContent = speed.toFixed(1) + 'x';
            elements.speedIndicator.style.display = 'block';
            elements.speedIndicator.style.opacity = '1';
            
            setTimeout(function() {
                elements.speedIndicator.style.opacity = '0';
                setTimeout(function() {
                    elements.speedIndicator.style.display = 'none';
                }, CONTROLS_FADE_DELAY_MS);
            }, AUTO_HIDE_CONTROLS_MS);
        }
        
        closeModal();
    }
    
    // Quality/Bitrate profiles (in Mbps)
    var QUALITY_PROFILES = [
        { value: '200000000', label: '200 Mbps' },
        { value: '180000000', label: '180 Mbps' },
        { value: '140000000', label: '140 Mbps' },
        { value: '120000000', label: '120 Mbps' },
        { value: '110000000', label: '110 Mbps' },
        { value: '100000000', label: '100 Mbps' },
        { value: '90000000', label: '90 Mbps' },
        { value: '80000000', label: '80 Mbps' },
        { value: '70000000', label: '70 Mbps' },
        { value: '60000000', label: '60 Mbps' },
        { value: '50000000', label: '50 Mbps' },
        { value: '40000000', label: '40 Mbps' },
        { value: '30000000', label: '30 Mbps' },
        { value: '20000000', label: '20 Mbps' },
        { value: '15000000', label: '15 Mbps' },
        { value: '10000000', label: '10 Mbps' },
        { value: '5000000', label: '5 Mbps' },
        { value: '3000000', label: '3 Mbps' },
        { value: '2000000', label: '2 Mbps' },
        { value: '1000000', label: '1 Mbps' },
        { value: '720000', label: '720 Kbps' },
        { value: '420000', label: '420 Kbps' }
    ];
    
    function showQualitySelector() {
        if (!elements.qualityList || !elements.qualityModal) {
            return;
        }
        
        // Get current max bitrate setting (stored in bps)
        var currentMaxBitrate = storage.get('maxBitrate', false) || '120000000';
        
        var listHtml = '';
        QUALITY_PROFILES.forEach(function(profile) {
            var isSelected = profile.value === currentMaxBitrate;
            listHtml += '<div class="track-item' + (isSelected ? ' selected' : '') + '" tabindex="0" data-bitrate="' + profile.value + '">';
            listHtml += '<span class="track-name">' + profile.label + '</span>';
            if (isSelected) {
                listHtml += '<span class="selected-indicator"><img src="assets/icons/check.png" alt="" class="emoji-icon"></span>';
            }
            listHtml += '</div>';
        });
        
        elements.qualityList.innerHTML = listHtml;
        elements.qualityModal.style.display = 'flex';
        activeModal = 'quality';
        
        modalFocusableItems = Array.from(elements.qualityList.querySelectorAll('.track-item'));
        

        currentModalFocusIndex = QUALITY_PROFILES.findIndex(function(p) {
            return p.value === currentMaxBitrate;
        });
        if (currentModalFocusIndex < 0) currentModalFocusIndex = 3; // Default to 120 Mbps
        
        if (modalFocusableItems.length > 0 && modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        // Add click handlers
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var bitrate = item.getAttribute('data-bitrate');
                setMaxBitrate(bitrate);
            });
        });
        
    }
    
    function setMaxBitrate(bitrate) {
        storage.set('maxBitrate', bitrate, false);
        
        var profile = QUALITY_PROFILES.find(function(p) { return p.value === bitrate; });
        var label = profile ? profile.label : bitrate;
        
        
        // Show indicator briefly
        if (elements.bitrateIndicator) {
            elements.bitrateIndicator.textContent = 'Max: ' + label;
            elements.bitrateIndicator.style.display = 'block';
            elements.bitrateIndicator.style.opacity = '1';
            
            setTimeout(function() {
                elements.bitrateIndicator.style.opacity = '0';
                setTimeout(function() {
                    elements.bitrateIndicator.style.display = 'none';
                }, CONTROLS_FADE_DELAY_MS);
            }, AUTO_HIDE_CONTROLS_MS);
        }
        
        closeModal();
    }
    
    function showPlayModeSelector() {
        if (!elements.playModeList || !elements.playModeModal) {
            return;
        }
        
        if (!currentMediaSource) {
            return;
        }
        
        var modes = [];
        if (currentMediaSource.SupportsDirectPlay) {
            modes.push({ label: 'Direct Play', value: 'direct' });
        }
        if (currentMediaSource.SupportsTranscoding) {
            modes.push({ label: 'Transcode', value: 'transcode' });
        }
        
        if (modes.length === 0) {
            return;
        }
        
        var listHtml = '';
        modes.forEach(function(mode) {
            var isSelected = forcePlayMode === mode.value;
            listHtml += '<div class="track-item' + (isSelected ? ' selected' : '') + '" tabindex="0" data-mode="' + mode.value + '">';
            listHtml += '<span class="track-name">' + mode.label + '</span>';
            if (isSelected) {
                listHtml += '<span class="selected-indicator"><img src="assets/icons/check.png" alt="" class="emoji-icon"></span>';
            }
            listHtml += '</div>';
        });
        
        elements.playModeList.innerHTML = listHtml;
        elements.playModeModal.style.display = 'flex';
        activeModal = 'playmode';
        
        modalFocusableItems = Array.from(elements.playModeList.querySelectorAll('.track-item'));
        
        currentModalFocusIndex = 0;
        if (forcePlayMode) {
            currentModalFocusIndex = modes.findIndex(function(m) { return m.value === forcePlayMode; });
            if (currentModalFocusIndex < 0) currentModalFocusIndex = 0;
        }
        
        if (modalFocusableItems.length > 0 && modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var mode = item.getAttribute('data-mode');
                setPlayMode(mode);
            });
        });
    }
    
    function setPlayMode(mode) {
        forcePlayMode = mode;
        hideControls();
        closeModal();
    }
    
    function startBitrateMonitoring() {
        if (bitrateUpdateInterval) {
            clearInterval(bitrateUpdateInterval);
        }
        
        bitrateUpdateInterval = setInterval(function() {
            updateBitrateIndicator();
        }, BITRATE_UPDATE_INTERVAL_MS);
    }
    
    function stopBitrateMonitoring() {
        if (bitrateUpdateInterval) {
            clearInterval(bitrateUpdateInterval);
            bitrateUpdateInterval = null;
        }
        
        if (elements.bitrateIndicator) {
            elements.bitrateIndicator.style.display = 'none';
        }
    }
    
    function updateBitrateIndicator() {
        if (!elements.bitrateIndicator || !playbackInfo || !playbackInfo.MediaSource) {
            return;
        }
        
        var mediaSource = playbackInfo.MediaSource;
        var bitrate = 0;
        

        if (mediaSource.Bitrate) {
            bitrate = mediaSource.Bitrate;
        } else if (playbackInfo.PlayMethod === 'Transcode' && playbackInfo.TranscodingInfo) {
            // For transcoding, use target bitrate
            bitrate = playbackInfo.TranscodingInfo.Bitrate || 0;
        }
        
        if (bitrate > 0) {
            var bitrateMbps = (bitrate / 1000000).toFixed(1);
            elements.bitrateIndicator.textContent = bitrateMbps + ' Mbps';
            elements.bitrateIndicator.style.display = 'block';
        }
    }

    function closeModal() {
        if (elements.audioModal) {
            elements.audioModal.style.display = 'none';
        }
        if (elements.subtitleModal) {
            elements.subtitleModal.style.display = 'none';
        }
        if (elements.speedModal) {
            elements.speedModal.style.display = 'none';
        }
        if (elements.qualityModal) {
            elements.qualityModal.style.display = 'none';
        }
        if (elements.playModeModal) {
            elements.playModeModal.style.display = 'none';
        }
        if (elements.videoInfoModal) {
            elements.videoInfoModal.style.display = 'none';
        }
        if (elements.chaptersModal) {
            elements.chaptersModal.style.display = 'none';
        }
        activeModal = null;
        modalFocusableItems = [];
        
        if (elements.playModeBtn && focusableButtons.indexOf(elements.playModeBtn) !== -1) {
            setTimeout(function() {
                elements.playModeBtn.focus();
            }, 100);
        }
    }

    function loadMediaSegments() {
        if (!auth || !itemId) {
            return;
        }
        
        var url = auth.serverAddress + '/MediaSegments/' + itemId;
        
        var authHeader = 'MediaBrowser Client="' + JellyfinAPI.appName + '", Device="' + JellyfinAPI.deviceName + 
                         '", DeviceId="' + JellyfinAPI.deviceId + '", Version="' + JellyfinAPI.appVersion + '", Token="' + auth.accessToken + '"';
        
        ajax.request(url, {
            method: 'GET',
            headers: {
                'X-Emby-Authorization': authHeader
            },
            success: function(response) {
                try {
                    var data = response;
                    if (data && data.Items && data.Items.length > 0) {
                        data.Items.forEach(function(seg, idx) {
                            var duration = (seg.EndTicks - seg.StartTicks) / 10000000;
                            console.log('Segment', idx, seg.Type,
                                        'from', (seg.StartTicks / 10000000).toFixed(0), 'to', (seg.EndTicks / 10000000).toFixed(0));
                        });
                        
                        // Filter out very short segments (< 1 second)
                        mediaSegments = data.Items.filter(function(segment) {
                            var duration = (segment.EndTicks - segment.StartTicks) / 10000000;
                            return duration >= 1;
                        });
                        mediaSegments.forEach(function(seg) {
                        });
                    } else {
                        mediaSegments = [];
                    }
                } catch (e) {
                    mediaSegments = [];
                }
            },
            error: function(errorObj) {
                mediaSegments = [];
            }
        });
    }

    /**
     * Load adjacent episodes (previous and next) for navigation
     */
    function loadAdjacentEpisodes() {
        console.log('[loadAdjacentEpisodes] START');
        
        if (!auth || !itemData) {
            console.log('[loadAdjacentEpisodes] Missing auth or itemData, returning');
            return;
        }
        

        if (itemData.Type !== 'Episode' || !itemData.SeriesId) {
            console.log('[loadAdjacentEpisodes] Not an episode or no SeriesId, returning');
            return;
        }
        
        // Load next episode
        var nextUrl = auth.serverAddress + '/Shows/' + itemData.SeriesId + '/Episodes';
        var nextParams = {
            UserId: auth.userId,
            StartItemId: itemId,
            Limit: 2,
            Fields: 'Overview'
        };
        
        var nextQueryString = Object.keys(nextParams).map(function(key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(nextParams[key]);
        }).join('&');
        
        ajax.request(nextUrl + '?' + nextQueryString, {
            method: 'GET',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken)
            },
            success: function(response) {
                try {
                    var data = response;
                    if (data && data.Items && data.Items.length > 1) {
                        nextEpisodeData = data.Items[1];
                        console.log('[loadAdjacentEpisodes] Next episode:', nextEpisodeData.Name);
                    } else {
                        nextEpisodeData = null;
                    }
                } catch (e) {
                    nextEpisodeData = null;
                }
            },
            error: function() {
                nextEpisodeData = null;
            }
        });
        
        // Load previous episode by getting the episode before current one
        var prevUrl = auth.serverAddress + '/Shows/' + itemData.SeriesId + '/Episodes';
        var prevParams = {
            UserId: auth.userId,
            SeasonId: itemData.SeasonId || null,
            Fields: 'Overview'
        };
        
        // Only include SeasonId if it exists
        if (!prevParams.SeasonId) {
            delete prevParams.SeasonId;
        }
        
        var prevQueryString = Object.keys(prevParams).map(function(key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(prevParams[key]);
        }).join('&');
        
        ajax.request(prevUrl + '?' + prevQueryString, {
            method: 'GET',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken)
            },
            success: function(response) {
                try {
                    var data = response;
                    if (data && data.Items && data.Items.length > 0) {

                        var currentIndex = -1;
                        for (var i = 0; i < data.Items.length; i++) {
                            if (data.Items[i].Id === itemId) {
                                currentIndex = i;
                                break;
                            }
                        }
                        
                        if (currentIndex > 0) {
                            previousEpisodeData = data.Items[currentIndex - 1];
                            console.log('[loadAdjacentEpisodes] Previous episode:', previousEpisodeData.Name);
                        } else {
                            previousEpisodeData = null;
                            console.log('[loadAdjacentEpisodes] No previous episode (first in list)');
                        }
                    } else {
                        previousEpisodeData = null;
                    }
                } catch (e) {
                    previousEpisodeData = null;
                }
            },
            error: function() {
                previousEpisodeData = null;
            }
        });
    }

    function checkSkipSegments(currentTime) {
        if (!mediaSegments || mediaSegments.length === 0) return;
        

        var stored = storage.getUserPreference('jellyfin_settings', null);
        if (stored) {
            try {
                var settings = typeof stored === 'string' ? JSON.parse(stored) : stored;
                if (settings.skipIntro === false) {
                    // Skip intro is disabled, don't show skip buttons
                    if (skipOverlayVisible) {
                        hideSkipOverlay();
                    }
                    return;
                }
            } catch (e) {
                // If parsing fails, continue with default behavior
            }
        }
        
        var currentTicks = currentTime * 10000000;
        
        // Check each segment
        for (var i = 0; i < mediaSegments.length; i++) {
            var segment = mediaSegments[i];
            
            if (currentTicks >= segment.StartTicks && currentTicks <= segment.EndTicks) {
                // We're in a skip segment
                if (!skipOverlayVisible || currentSkipSegment !== segment) {
                    currentSkipSegment = segment;
                    showSkipOverlay(segment);
                }
                return;
            }
        }
        
        // Not in any segment - hide overlay if visible
        if (skipOverlayVisible) {
            hideSkipOverlay();
        }
    }

    function showSkipOverlay(segment) {
        if (!elements.skipOverlay || !elements.skipButton || !elements.skipButtonText) return;
        
        var buttonText = getSkipButtonText(segment.Type);
        elements.skipButtonText.textContent = buttonText;
        
        elements.skipOverlay.style.display = 'block';
        setTimeout(function() {
            elements.skipOverlay.classList.add('visible');
            // Auto-focus the skip button for remote control
            if (elements.skipButton) {
                elements.skipButton.focus();
            }
        }, 10);
        
        skipOverlayVisible = true;
    }

    function hideSkipOverlay() {
        if (!elements.skipOverlay) return;
        
        elements.skipOverlay.classList.remove('visible');
        setTimeout(function() {
            elements.skipOverlay.style.display = 'none';
        }, 300);
        
        skipOverlayVisible = false;
        currentSkipSegment = null;
    }

    function getSkipButtonText(segmentType) {
        switch (segmentType) {
            case 'Intro':
                return 'Skip Intro';
            case 'Outro':
            case 'Credits':

                if (nextEpisodeData) {
                    return 'Play Next Episode';
                }
                return 'Skip Credits';
            case 'Preview':
                return 'Skip Preview';
            case 'Recap':
                return 'Skip Recap';
            default:
                return 'Skip';
        }
    }

    function updateSkipButtonTime(seconds) {
        if (!elements.skipButtonTime) return;
        
        if (seconds > 0) {
            elements.skipButtonTime.textContent = seconds + 's';
        } else {
            elements.skipButtonTime.textContent = '';
        }
    }

    function playNextEpisode() {
        console.log('[playNextEpisode] START');
        if (!nextEpisodeData) {
            console.log('[playNextEpisode] No next episode data available');
            return;
        }
        
        console.log('[playNextEpisode] Next episode:', nextEpisodeData.Name, nextEpisodeData.Id);
        
        // Save next episode ID before clearing
        var nextEpisodeId = nextEpisodeData.Id;
        console.log('[playNextEpisode] Saved next episode ID:', nextEpisodeId);
        

        console.log('[playNextEpisode] Stopping current playback...');
        console.log('[playNextEpisode] Reporting playback stop...');
        reportPlaybackStop();
        console.log('[playNextEpisode] Stopping progress reporting...');
        stopProgressReporting();
        stopBitrateMonitoring();
        cleanupAudioNormalization();
        

        console.log('[playNextEpisode] Clearing current state...');
        currentSkipSegment = null;
        skipOverlayVisible = false;
        hideSkipOverlay();
        mediaSegments = [];
        nextEpisodeData = null;
        previousEpisodeData = null;
        trickplayData = null;
        trickplayResolution = null;
        hideTrickplayBubble();
        
        // Update browser history so BACK goes to correct details page
        if (window && window.history && window.location) {
            var newUrl = 'player.html?id=' + nextEpisodeId;
            window.history.replaceState({}, '', newUrl);
        }

        console.log('[playNextEpisode] Setting itemId to:', nextEpisodeId);
        itemId = nextEpisodeId;
        console.log('[playNextEpisode] Calling loadItemAndPlay()...');
        loadItemAndPlay();
        console.log('[playNextEpisode] END');
    }
    
    function executeSkip() {
        console.log('[executeSkip] START - currentSkipSegment:', currentSkipSegment);
        if (!currentSkipSegment) {
            console.log('[executeSkip] No currentSkipSegment, returning');
            return;
        }
        
        var segmentType = currentSkipSegment.Type;
        console.log('[executeSkip] segmentType:', segmentType, 'nextEpisodeData:', nextEpisodeData);
        
        // For outro/credits with next episode available, play next episode directly
        // (User manually pressed skip, so honor that intent regardless of autoPlay setting)
        if ((segmentType === 'Outro' || segmentType === 'Credits') && nextEpisodeData) {
            console.log('[executeSkip] Conditions met - calling playNextEpisode()');
            playNextEpisode();
            console.log('[executeSkip] Returned from playNextEpisode()');
            return;
        }
        
        // Otherwise, seek past the segment
        var skipToTime = currentSkipSegment.EndTicks / 10000000;
        console.log('[executeSkip] Seeking to:', skipToTime);
        videoPlayer.currentTime = skipToTime;
        hideSkipOverlay();
        console.log('[executeSkip] END');
    }

    // ============================================================================
    // TRICKPLAY THUMBNAILS (Jellyfin Web Compatible)
    // ============================================================================

    /**
     * Initialize trickplay data from item data
     * Following jellyfin-web implementation exactly
     */
    function initializeTrickplay() {
        trickplayData = null;
        trickplayResolution = null;

        if (!itemData || !itemData.Trickplay) {
            console.log('[Trickplay] No trickplay data available for this item');
            return;
        }

        // Get the primary media source ID
        var mediaSourceId = null;
        if (itemData.MediaSources && itemData.MediaSources.length > 0) {
            mediaSourceId = itemData.MediaSources[0].Id;
        }

        if (mediaSourceId) {
            initializeTrickplayForMediaSource(mediaSourceId);
        }
    }

    /**
     * Initialize trickplay for a specific media source ID
     * @param {string} mediaSourceId - The media source ID to use
     */
    function initializeTrickplayForMediaSource(mediaSourceId) {
        trickplayData = null;
        trickplayResolution = null;

        if (!itemData || !itemData.Trickplay) {
            console.log('[Trickplay] No trickplay data available for this item');
            return;
        }

        if (!mediaSourceId) {
            console.log('[Trickplay] No media source ID provided');
            return;
        }

        var trickplayResolutions = itemData.Trickplay[mediaSourceId];
        if (!trickplayResolutions) {
            console.log('[Trickplay] No trickplay resolutions for media source:', mediaSourceId);
            return;
        }

        // Prefer highest resolution <= 20% of screen width (following jellyfin-web)
        var maxWidth = window.screen.width * window.devicePixelRatio * 0.2;
        var bestWidth = null;

        for (var widthKey in trickplayResolutions) {
            if (trickplayResolutions.hasOwnProperty(widthKey)) {
                var info = trickplayResolutions[widthKey];
                var width = info.Width;

                if (!bestWidth || 
                    (width < bestWidth && bestWidth > maxWidth) ||
                    (width > bestWidth && width <= maxWidth)) {
                    bestWidth = width;
                }
            }
        }

        if (bestWidth && trickplayResolutions[bestWidth]) {
            trickplayResolution = trickplayResolutions[bestWidth];
            trickplayData = {
                mediaSourceId: mediaSourceId,
                resolution: trickplayResolution
            };

            console.log('[Trickplay] Initialized with resolution:', bestWidth, 'Info:', trickplayResolution);

            // Setup trickplay bubble dimensions
            if (elements.trickplayThumb) {
                elements.trickplayThumb.style.width = trickplayResolution.Width + 'px';
                elements.trickplayThumb.style.height = trickplayResolution.Height + 'px';
            }
        }
    }

    /**
     * Update trickplay bubble HTML - following jellyfin-web implementation exactly
     * @param {number} positionTicks - Position in ticks
     * @param {number} percent - Progress bar percentage
     */
    function updateTrickplayBubble(positionTicks, percent) {
        if (!elements.trickplayBubble) return;

        var bubble = elements.trickplayBubble;
        var progressBarRect = elements.progressBar.getBoundingClientRect();

        // Calculate bubble position
        var bubblePos = progressBarRect.width * percent / 100;
        bubble.style.left = bubblePos + 'px';

        // If no trickplay data, just show time
        if (!trickplayResolution || !trickplayData) {
            bubble.classList.add('no-trickplay');
            if (elements.trickplayTime) {
                elements.trickplayTime.textContent = formatTime(positionTicks / TICKS_PER_SECOND);
            }
            if (elements.trickplayChapterName) {
                elements.trickplayChapterName.textContent = '';
            }
            bubble.style.display = 'block';
            return;
        }

        bubble.classList.remove('no-trickplay');

        // Find current chapter name
        var chapterName = '';
        if (itemData && itemData.Chapters) {
            for (var i = 0; i < itemData.Chapters.length; i++) {
                var chapter = itemData.Chapters[i];
                if (positionTicks >= chapter.StartPositionTicks) {
                    chapterName = chapter.Name || '';
                } else {
                    break;
                }
            }
        }

        // Calculate trickplay tile position (following jellyfin-web exactly)
        var currentTimeMs = positionTicks / 10000; // Ticks to milliseconds
        var currentTile = Math.floor(currentTimeMs / trickplayResolution.Interval);
        var tileSize = trickplayResolution.TileWidth * trickplayResolution.TileHeight;
        var tileOffset = currentTile % tileSize;
        var imageIndex = Math.floor(currentTile / tileSize);

        var tileOffsetX = tileOffset % trickplayResolution.TileWidth;
        var tileOffsetY = Math.floor(tileOffset / trickplayResolution.TileWidth);
        var offsetX = -(tileOffsetX * trickplayResolution.Width);
        var offsetY = -(tileOffsetY * trickplayResolution.Height);

        // Build trickplay image URL (following jellyfin-web API format)
        var imgSrc = auth.serverAddress + '/Videos/' + itemId + '/Trickplay/' + 
                     trickplayResolution.Width + '/' + imageIndex + '.jpg?MediaSourceId=' + 
                     trickplayData.mediaSourceId;

        // Update thumbnail
        if (elements.trickplayThumb) {
            elements.trickplayThumb.style.backgroundImage = "url('" + imgSrc + "')";
            elements.trickplayThumb.style.backgroundPositionX = offsetX + 'px';
            elements.trickplayThumb.style.backgroundPositionY = offsetY + 'px';
            elements.trickplayThumb.style.width = trickplayResolution.Width + 'px';
            elements.trickplayThumb.style.height = trickplayResolution.Height + 'px';
        }

        // Update text
        if (elements.trickplayTime) {
            elements.trickplayTime.textContent = formatTime(positionTicks / TICKS_PER_SECOND);
        }
        if (elements.trickplayChapterName) {
            elements.trickplayChapterName.textContent = chapterName;
        }

        bubble.style.display = 'block';
    }

    /**
     * Show trickplay bubble
     */
    function showTrickplayBubble() {
        if (elements.trickplayBubble) {
            trickplayVisible = true;
        }
    }

    /**
     * Hide trickplay bubble
     */
    function hideTrickplayBubble() {
        if (elements.trickplayBubble) {
            elements.trickplayBubble.style.display = 'none';
            trickplayVisible = false;
        }
    }

    // ============================================================================
    // AUDIO NORMALIZATION (Jellyfin Web Compatible)
    // ============================================================================

    /**
     * Initialize audio normalization using Web Audio API
     * Following jellyfin-web implementation
     */
    function initializeAudioNormalization() {
        if (!audioNormalizationEnabled) {
            console.log('[AudioNorm] Audio normalization disabled');
            return;
        }

        // Check if item has normalization gain data
        var trackGain = itemData && itemData.NormalizationGain;
        var albumGain = null;

        // Get album gain from media source if available
        if (playbackInfo && playbackInfo.MediaSources && playbackInfo.MediaSources.length > 0) {
            albumGain = playbackInfo.MediaSources[0].albumNormalizationGain || null;
        }

        // Use track gain, falling back to album gain (TrackGain mode - default in jellyfin-web)
        var gainValue = trackGain || albumGain;

        if (!gainValue) {
            console.log('[AudioNorm] No normalization gain data available');
            cleanupAudioNormalization();
            return;
        }

        try {
            // Create or reuse AudioContext
            var AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                console.log('[AudioNorm] Web Audio API not supported');
                return;
            }

            if (!audioContext) {
                audioContext = new AudioContextClass();
            }

            // Resume audio context if suspended (required by browsers after user interaction)
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            // Create gain node if not exists
            if (!gainNode) {
                gainNode = audioContext.createGain();
                gainNode.connect(audioContext.destination);
            }

            // Create media element source if not exists
            if (!sourceNode) {
                sourceNode = audioContext.createMediaElementSource(videoPlayer);
                sourceNode.connect(gainNode);
            }

            // Convert dB to linear gain (following jellyfin-web: Math.pow(10, normalizationGain / 20))
            normalizationGain = Math.pow(10, gainValue / 20);
            gainNode.gain.value = normalizationGain;

            console.log('[AudioNorm] Applied normalization gain:', gainValue, 'dB -> linear:', normalizationGain);

        } catch (error) {
            console.error('[AudioNorm] Failed to initialize audio normalization:', error);
            cleanupAudioNormalization();
        }
    }

    /**
     * Cleanup audio normalization resources
     */
    function cleanupAudioNormalization() {
        if (gainNode) {
            gainNode.gain.value = 1.0;
        }
        normalizationGain = 1.0;
        // Note: We don't destroy the audioContext/sourceNode as they cannot be 
        // recreated once destroyed for the same video element
    }

    /**
     * Get current audio normalization setting
     * @returns {string} 'TrackGain', 'AlbumGain', or 'Off'
     */
    function getAudioNormalizationMode() {
        // Can be expanded to read from user settings storage
        return audioNormalizationEnabled ? 'TrackGain' : 'Off';
    }

    /**
     * Set audio normalization mode
     * @param {string} mode - 'TrackGain', 'AlbumGain', or 'Off'
     */
    function setAudioNormalizationMode(mode) {
        audioNormalizationEnabled = mode !== 'Off';
        if (audioNormalizationEnabled && itemData) {
            initializeAudioNormalization();
        } else {
            cleanupAudioNormalization();
        }
    }

    return {
        init: init
    };
})();

window.addEventListener('load', function() {
    PlayerController.init();
});
