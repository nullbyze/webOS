import {useCallback, useEffect, useState} from 'react';
import {Row, Cell, Column} from '@enact/ui/Layout';
import {Panel, Header} from '@enact/sandstone/Panels';
import Spinner from '@enact/sandstone/Spinner';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Image from '@enact/sandstone/Image';
import Item from '@enact/sandstone/Item';
import Scroller from '@enact/sandstone/Scroller';
import Spotlight from '@enact/spotlight';
import jellyseerrApi from '../../services/jellyseerrApi';
import {useJellyseerr} from '../../context/JellyseerrContext';
import css from './JellyseerrDetails.module.less';

const STATUS_LABELS = {
	1: 'Unknown',
	2: 'Pending',
	3: 'Processing',
	4: 'Partially Available',
	5: 'Available'
};

const JellyseerrDetails = ({mediaType, mediaId, onClose, ...rest}) => {
	const {isAuthenticated, user} = useJellyseerr();
	const [details, setDetails] = useState(null);
	const [loading, setLoading] = useState(true);
	const [requesting, setRequesting] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (!mediaId || !mediaType) return;

		const loadDetails = async () => {
			setLoading(true);
			setError(null);
			try {
				const data = mediaType === 'movie'
					? await jellyseerrApi.getMovie(mediaId)
					: await jellyseerrApi.getTv(mediaId);
				setDetails(data);
			} catch (err) {
				console.error('Failed to load details:', err);
				setError(err.message || 'Failed to load details');
			} finally {
				setLoading(false);
			}
		};

		loadDetails();
	}, [mediaId, mediaType]);

	useEffect(() => {
		if (!loading && details) {
			Spotlight.focus('[data-spotlight-id="request-btn"]');
		}
	}, [loading, details]);

	const handleRequest = useCallback(async () => {
		if (requesting || !isAuthenticated) return;

		setRequesting(true);
		try {
			if (mediaType === 'movie') {
				await jellyseerrApi.requestMovie(mediaId);
			} else {
				await jellyseerrApi.requestTv(mediaId);
			}
			const updated = mediaType === 'movie'
				? await jellyseerrApi.getMovie(mediaId)
				: await jellyseerrApi.getTv(mediaId);
			setDetails(updated);
		} catch (err) {
			console.error('Request failed:', err);
			setError(err.message || 'Request failed');
		} finally {
			setRequesting(false);
		}
	}, [mediaId, mediaType, requesting, isAuthenticated]);

	const handleCancelRequest = useCallback(async () => {
		if (!details?.mediaInfo?.id) return;

		setRequesting(true);
		try {
			await jellyseerrApi.cancelRequest(details.mediaInfo.id);
			const updated = mediaType === 'movie'
				? await jellyseerrApi.getMovie(mediaId)
				: await jellyseerrApi.getTv(mediaId);
			setDetails(updated);
		} catch (err) {
			console.error('Cancel request failed:', err);
			setError(err.message || 'Cancel failed');
		} finally {
			setRequesting(false);
		}
	}, [details, mediaId, mediaType]);

	const getStatus = () => {
		if (!details?.mediaInfo) return null;
		return details.mediaInfo.status;
	};

	const canRequest = () => {
		if (!isAuthenticated) return false;
		const status = getStatus();
		return !status || status === 1;
	};

	const canCancel = () => {
		if (!isAuthenticated) return false;
		const status = getStatus();
		const isOwner = details?.mediaInfo?.requests?.some(r => r.requestedBy?.id === user?.id);
		return status === 2 && isOwner;
	};

	const renderContent = () => {
		if (loading) {
			return <Spinner centered>Loading...</Spinner>;
		}

		if (error) {
			return (
				<Column align="center center" className={css.error}>
					<BodyText>{error}</BodyText>
					<Button onClick={onClose}>Go Back</Button>
				</Column>
			);
		}

		if (!details) {
			return <BodyText>No details available</BodyText>;
		}

		const posterUrl = details.posterPath
			? jellyseerrApi.getImageUrl(details.posterPath, 'w500')
			: null;
		const backdropUrl = details.backdropPath
			? jellyseerrApi.getImageUrl(details.backdropPath, 'original')
			: null;
		const status = getStatus();
		const year = details.releaseDate
			? new Date(details.releaseDate).getFullYear()
			: details.firstAirDate
				? new Date(details.firstAirDate).getFullYear()
				: null;

		return (
			<Scroller direction="vertical" focusableScrollbar>
				{backdropUrl && (
					<div className={css.backdrop}>
						<Image src={backdropUrl} className={css.backdropImage} />
						<div className={css.backdropOverlay} />
					</div>
				)}
				<Row className={css.content}>
					<Cell shrink>
						{posterUrl && (
							<Image
								src={posterUrl}
								className={css.poster}
								sizing="fill"
							/>
						)}
					</Cell>
					<Cell>
						<Column className={css.info}>
							<BodyText className={css.title}>
								{details.title || details.name}
								{year && <span className={css.year}> ({year})</span>}
							</BodyText>

							{details.tagline && (
								<BodyText className={css.tagline}>{details.tagline}</BodyText>
							)}

							<Row className={css.meta}>
								{details.voteAverage > 0 && (
									<BodyText className={css.rating}>
										★ {details.voteAverage.toFixed(1)}
									</BodyText>
								)}
								{details.runtime && (
									<BodyText className={css.runtime}>
										{Math.floor(details.runtime / 60)}h {details.runtime % 60}m
									</BodyText>
								)}
								{details.numberOfSeasons && (
									<BodyText className={css.seasons}>
										{details.numberOfSeasons} Season{details.numberOfSeasons > 1 ? 's' : ''}
									</BodyText>
								)}
							</Row>

							{status && (
								<div className={css.statusBadge} data-status={status}>
									{STATUS_LABELS[status] || 'Unknown'}
								</div>
							)}

							{details.genres && details.genres.length > 0 && (
								<Row className={css.genres}>
									{details.genres.map(g => (
										<span key={g.id} className={css.genre}>{g.name}</span>
									))}
								</Row>
							)}

							<BodyText className={css.overview}>
								{details.overview || 'No overview available.'}
							</BodyText>

							<Row className={css.actions}>
								{canRequest() && (
									<Button
										data-spotlight-id="request-btn"
										onClick={handleRequest}
										disabled={requesting}
										icon="plus"
									>
										{requesting ? 'Requesting...' : 'Request'}
									</Button>
								)}
								{canCancel() && (
									<Button
										onClick={handleCancelRequest}
										disabled={requesting}
										icon="trash"
									>
										Cancel Request
									</Button>
								)}
								{status === 5 && (
									<BodyText className={css.available}>
										Available in your library
									</BodyText>
								)}
							</Row>

							{details.credits?.cast && details.credits.cast.length > 0 && (
								<Column className={css.cast}>
									<BodyText className={css.sectionTitle}>Cast</BodyText>
									<Row wrap className={css.castList}>
										{details.credits.cast.slice(0, 10).map(person => (
											<Item
												key={person.id}
												className={css.castMember}
												label={person.character}
											>
												{person.name}
											</Item>
										))}
									</Row>
								</Column>
							)}

							{mediaType === 'tv' && details.seasons && details.seasons.length > 0 && (
								<Column className={css.seasons}>
									<BodyText className={css.sectionTitle}>Seasons</BodyText>
									{details.seasons.filter(s => s.seasonNumber > 0).map(season => (
										<Item
											key={season.id}
											className={css.season}
											label={`${season.episodeCount} episodes`}
										>
											{season.name}
										</Item>
									))}
								</Column>
							)}
						</Column>
					</Cell>
				</Row>
			</Scroller>
		);
	};

	return (
		<Panel {...rest}>
			<Header
				title={details?.title || details?.name || (mediaType === 'movie' ? 'Movie Details' : 'TV Details')}
				onClose={onClose}
				type="compact"
			/>
			{renderContent()}
		</Panel>
	);
};

export default JellyseerrDetails;
