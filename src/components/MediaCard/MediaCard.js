import {memo, useCallback} from 'react';
import Spottable from '@enact/spotlight/Spottable';
import Image from '@enact/sandstone/Image';
import {getImageUrl} from '../../utils/helpers';

import css from './MediaCard.module.less';

const SpottableDiv = Spottable('div');

const MediaCard = ({item, serverUrl, onSelect}) => {
	const imageUrl = item.ImageTags?.Primary
		? getImageUrl(serverUrl, item.Id, 'Primary', {maxHeight: 400, quality: 90})
		: null;

	const handleClick = useCallback(() => {
		onSelect?.(item);
	}, [item, onSelect]);

	const progress = item.UserData?.PlayedPercentage || 0;

	return (
		<SpottableDiv className={css.card} onClick={handleClick}>
			{imageUrl ? (
				<Image className={css.image} src={imageUrl} sizing="fill" />
			) : (
				<div className={css.placeholder}>{item.Name?.[0]}</div>
			)}
			<div className={css.info}>
				<div className={css.title}>{item.Name}</div>
				{item.ProductionYear && (
					<div className={css.year}>{item.ProductionYear}</div>
				)}
			</div>
			{progress > 0 && (
				<div className={css.progressBar}>
					<div className={css.progress} style={{width: `${progress}%`}} />
				</div>
			)}
		</SpottableDiv>
	);
};

export default memo(MediaCard);
