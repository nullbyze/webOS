import {useState, useEffect, useCallback} from 'react';
import {Panel, Header} from '@enact/sandstone/Panels';
import {VirtualGridList} from '@enact/sandstone/VirtualList';
import {useAuth} from '../../context/AuthContext';
import MediaCard from '../../components/MediaCard';
import LoadingSpinner from '../../components/LoadingSpinner';

import css from './Favorites.module.less';

const Favorites = ({onSelectItem}) => {
	const {api, serverUrl} = useAuth();
	const [items, setItems] = useState([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const loadFavorites = async () => {
			try {
				const result = await api.getFavorites(100);
				setItems(result.Items || []);
			} catch (err) {
				console.error('Failed to load favorites:', err);
			} finally {
				setIsLoading(false);
			}
		};

		loadFavorites();
	}, [api]);

	const handleSelectItem = useCallback((item) => {
		onSelectItem?.(item);
	}, [onSelectItem]);

	const renderItem = useCallback(({index, ...rest}) => {
		const item = items[index];
		if (!item) return null;

		return (
			<MediaCard
				{...rest}
				key={item.Id}
				item={item}
				serverUrl={serverUrl}
				onSelect={handleSelectItem}
			/>
		);
	}, [items, serverUrl, handleSelectItem]);

	if (isLoading) {
		return (
			<Panel>
				<Header title="Favorites" />
				<LoadingSpinner />
			</Panel>
		);
	}

	return (
		<Panel>
			<Header title="Favorites" subtitle={`${items.length} items`} />
			<div className={css.content}>
				{items.length > 0 ? (
					<VirtualGridList
						className={css.grid}
						dataSize={items.length}
						itemRenderer={renderItem}
						itemSize={{minWidth: 200, minHeight: 340}}
						spacing={24}
					/>
				) : (
					<div className={css.empty}>No favorites yet</div>
				)}
			</div>
		</Panel>
	);
};

export default Favorites;
