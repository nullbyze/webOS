import {useCallback} from 'react';
import Scroller from '@enact/sandstone/Scroller';
import MediaCard from '../MediaCard';

import css from './MediaRow.module.less';

const MediaRow = ({title, items, serverUrl, onSelectItem}) => {
	const handleSelect = useCallback((item) => {
		onSelectItem?.(item);
	}, [onSelectItem]);

	if (!items || items.length === 0) return null;

	return (
		<div className={css.row}>
			<h2 className={css.title}>{title}</h2>
			<Scroller direction="horizontal" className={css.scroller}>
				<div className={css.items}>
					{items.map((item) => (
						<MediaCard
							key={item.Id}
							item={item}
							serverUrl={serverUrl}
							onSelect={handleSelect}
						/>
					))}
				</div>
			</Scroller>
		</div>
	);
};

export default MediaRow;
