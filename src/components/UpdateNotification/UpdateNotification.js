/**
 * UpdateNotification component
 * Shows a popup when a new version is available
 */

import {useCallback} from 'react';
import Popup from '@enact/sandstone/Popup';
import Button from '@enact/sandstone/Button';
import BodyText from '@enact/sandstone/BodyText';
import Heading from '@enact/sandstone/Heading';

import css from './UpdateNotification.module.less';

const UpdateNotification = ({updateInfo, formattedNotes, onDismiss}) => {
	const handleDismiss = useCallback(() => {
		if (onDismiss) {
			onDismiss();
		}
	}, [onDismiss]);

	if (!updateInfo) {
		return null;
	}

	return (
		<Popup
			open
			onClose={handleDismiss}
			position="center"
			className={css.updatePopup}
		>
			<div className={css.content}>
				<Heading size="small" className={css.title}>
					Update Available
				</Heading>

				<div className={css.versionInfo}>
					<span className={css.newVersion}>Version {updateInfo.latestVersion}</span>
					<span className={css.currentVersion}>
						(Current: {updateInfo.currentVersion})
					</span>
				</div>

				<div className={css.notes}>
					<BodyText size="small">
						{formattedNotes}
					</BodyText>
				</div>

				<div className={css.buttons}>
					<Button
						size="small"
						onClick={handleDismiss}
					>
						OK
					</Button>
				</div>
			</div>
		</Popup>
	);
};

export default UpdateNotification;
export {UpdateNotification};
