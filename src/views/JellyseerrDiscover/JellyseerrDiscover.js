import {useState, useEffect, useCallback} from 'react';
import {Panel, Header} from '@enact/sandstone/Panels';
import {VirtualGridList} from '@enact/sandstone/VirtualList';
import Button from '@enact/sandstone/Button';
import TabLayout, {Tab} from '@enact/sandstone/TabLayout';
import Spottable from '@enact/spotlight/Spottable';
import Image from '@enact/sandstone/Image';
import {useJellyseerr} from '../../context/JellyseerrContext';
import jellyseerrApi from '../../services/jellyseerrApi';
import LoadingSpinner from '../../components/LoadingSpinner';

import css from './JellyseerrDiscover.module.less';

const SpottableCard = Spottable('div');

const JellyseerrDiscover = ({onSelectItem, onOpenRequests}) => {
	const {isAuthenticated} = useJellyseerr();
	const [activeTab, setActiveTab] = useState(0);
	const [movies, setMovies] = useState([]);
	const [tvShows, setTvShows] = useState([]);
	const [trending, setTrending] = useState([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const loadData = async () => {
			setIsLoading(true);
			try {
				const [moviesData, tvData, trendingData] = await Promise.all([
					jellyseerrApi.discover(1),
					jellyseerrApi.discoverTv(1),
					jellyseerrApi.trending()
				]);
				setMovies(moviesData.results || []);
				setTvShows(tvData.results || []);
				setTrending(trendingData.results || []);
			} catch (err) {
				console.error('Failed to load Jellyseerr data:', err);
			} finally {
				setIsLoading(false);
			}
		};

		if (isAuthenticated) {
			loadData();
		}
	}, [isAuthenticated]);

	const handleSelectItem = useCallback((item, mediaType) => {
		onSelectItem?.({
			mediaId: item.id,
			mediaType: mediaType || item.media_type || (item.title ? 'movie' : 'tv')
		});
	}, [onSelectItem]);

	const renderItem = useCallback((items, mediaType) => ({index, ...rest}) => {
		const item = items[index];
		if (!item) return null;

		const imageUrl = jellyseerrApi.getImageUrl(item.poster_path, 'w342');
		const title = item.title || item.name;
		const year = (item.release_date || item.first_air_date)?.substring(0, 4);

		return (
			<SpottableCard
				{...rest}
				key={item.id}
				className={css.card}
				onClick={() => handleSelectItem(item, mediaType)}
			>
				{imageUrl ? (
					<Image className={css.poster} src={imageUrl} sizing="fill" />
				) : (
					<div className={css.noPoster}>{title?.[0]}</div>
				)}
				<div className={css.info}>
					<div className={css.title}>{title}</div>
					{year && <div className={css.year}>{year}</div>}
				</div>
				{item.mediaInfo?.status && (
					<div className={`${css.status} ${css[item.mediaInfo.status]}`}>
						{item.mediaInfo.status === 5 ? 'Available' :
						 item.mediaInfo.status === 4 ? 'Partially Available' :
						 item.mediaInfo.status === 3 ? 'Processing' :
						 item.mediaInfo.status === 2 ? 'Pending' : ''}
					</div>
				)}
			</SpottableCard>
		);
	}, [handleSelectItem]);

	if (!isAuthenticated) {
		return (
			<Panel>
				<Header title="Jellyseerr" />
				<div className={css.notConfigured}>
					<p>Jellyseerr is not configured or you are not logged in.</p>
					<p>Go to Settings to configure Jellyseerr.</p>
				</div>
			</Panel>
		);
	}

	if (isLoading) {
		return (
			<Panel>
				<Header title="Jellyseerr" />
				<LoadingSpinner />
			</Panel>
		);
	}

	return (
		<Panel>
			<Header title="Jellyseerr" subtitle="Request Movies & TV Shows">
				<Button icon="list" onClick={onOpenRequests}>My Requests</Button>
			</Header>
			<TabLayout onSelect={(e) => setActiveTab(e.index)}>
				<Tab title="Trending">
					<VirtualGridList
						className={css.grid}
						dataSize={trending.length}
						itemRenderer={renderItem(trending)}
						itemSize={{minWidth: 180, minHeight: 320}}
						spacing={20}
					/>
				</Tab>
				<Tab title="Movies">
					<VirtualGridList
						className={css.grid}
						dataSize={movies.length}
						itemRenderer={renderItem(movies, 'movie')}
						itemSize={{minWidth: 180, minHeight: 320}}
						spacing={20}
					/>
				</Tab>
				<Tab title="TV Shows">
					<VirtualGridList
						className={css.grid}
						dataSize={tvShows.length}
						itemRenderer={renderItem(tvShows, 'tv')}
						itemSize={{minWidth: 180, minHeight: 320}}
						spacing={20}
					/>
				</Tab>
			</TabLayout>
		</Panel>
	);
};

export default JellyseerrDiscover;
