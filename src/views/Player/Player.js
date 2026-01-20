import {useState, useEffect, useCallback, useRef} from 'react';
import VideoPlayer from '@enact/sandstone/VideoPlayer';
import {MediaControls} from '@enact/sandstone/MediaPlayer';
import * as playback from '../../services/playback';
import LoadingSpinner from '../../components/LoadingSpinner';

import css from './Player.module.less';

const Player = ({item, onEnded, onBack}) => {
	const [mediaUrl, setMediaUrl] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [title, setTitle] = useState('');

	const positionRef = useRef(0);
	const playSessionRef = useRef(null);

	useEffect(() => {
		const loadMedia = async () => {
			setIsLoading(true);
			setError(null);

			try {
				const startPosition = item.UserData?.PlaybackPositionTicks || 0;
				const result = await playback.getPlaybackUrl(item.Id, startPosition);

				setMediaUrl(result.url);
				playSessionRef.current = result.playSessionId;
				positionRef.current = startPosition;

				let displayTitle = item.Name;
				if (item.SeriesName) {
					displayTitle = `${item.SeriesName} - ${item.Name}`;
				}
				setTitle(displayTitle);
			} catch (err) {
				console.error('Failed to get playback URL:', err);
				setError(err.message || 'Failed to load media');
			} finally {
				setIsLoading(false);
			}
		};

		loadMedia();

		return () => {
			playback.stopProgressReporting();
		};
	}, [item]);

	const handlePlay = useCallback(() => {
		playback.reportStart(positionRef.current);
		playback.startProgressReporting(() => positionRef.current);
	}, []);

	const handleTimeUpdate = useCallback((e) => {
		if (e.currentTime) {
			positionRef.current = Math.floor(e.currentTime * 10000000);
		}
	}, []);

	const handleEnded = useCallback(async () => {
		await playback.reportStop(positionRef.current);
		onEnded?.();
	}, [onEnded]);

	const handleBack = useCallback(async () => {
		await playback.reportStop(positionRef.current);
		onBack?.();
	}, [onBack]);

	const handleError = useCallback((e) => {
		console.error('Playback error:', e);
		setError('Playback failed');
	}, []);

	if (isLoading) {
		return (
			<div className={css.container}>
				<LoadingSpinner message="Loading media..." />
			</div>
		);
	}

	if (error) {
		return (
			<div className={css.container}>
				<div className={css.error}>
					<h2>Playback Error</h2>
					<p>{error}</p>
					<button onClick={onBack}>Go Back</button>
				</div>
			</div>
		);
	}

	return (
		<div className={css.container}>
			<VideoPlayer
				title={title}
				src={mediaUrl}
				autoPlay
				onPlay={handlePlay}
				onUpdate={handleTimeUpdate}
				onEnded={handleEnded}
				onBack={handleBack}
				onError={handleError}
			>
				<MediaControls>
					<leftComponents />
					<rightComponents />
				</MediaControls>
			</VideoPlayer>
		</div>
	);
};

export default Player;
