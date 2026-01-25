import {useState, useEffect, useCallback} from 'react';
import {Panel, Header} from '@enact/sandstone/Panels';
import {VirtualList} from '@enact/sandstone/VirtualList';
import Item from '@enact/sandstone/Item';
import Image from '@enact/sandstone/Image';
import Button from '@enact/sandstone/Button';
import {useAuth} from '../../context/AuthContext';
import LoadingSpinner from '../../components/LoadingSpinner';

import css from './LiveTV.module.less';

const LiveTV = ({onPlayChannel, onBack}) => {
	const {api, serverUrl} = useAuth();
	const [channels, setChannels] = useState([]);
	const [selectedChannel, setSelectedChannel] = useState(null);
	const [currentProgram, setCurrentProgram] = useState(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.keyCode === 461 || e.keyCode === 27) {
				onBack?.();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [onBack]);

	useEffect(() => {
		const loadChannels = async () => {
			try {
				const result = await api.getLiveTvChannels();
				setChannels(result.Items || []);
			} catch (err) {
				console.error('Failed to load channels:', err);
			} finally {
				setIsLoading(false);
			}
		};

		loadChannels();
	}, [api]);

	useEffect(() => {
		const loadProgram = async () => {
			if (!selectedChannel) {
				setCurrentProgram(null);
				return;
			}

			try {
				const result = await api.getLiveTvPrograms(selectedChannel.Id);
				const now = Date.now();
				const current = result.Items?.find(p => {
					const start = new Date(p.StartDate).getTime();
					const end = new Date(p.EndDate).getTime();
					return now >= start && now <= end;
				});
				setCurrentProgram(current || null);
			} catch (err) {
				console.error('Failed to load program:', err);
				setCurrentProgram(null);
			}
		};

		loadProgram();
	}, [api, selectedChannel]);

	const handleSelectChannel = useCallback((channel) => {
		setSelectedChannel(channel);
	}, []);

	const handlePlayChannel = useCallback(() => {
		if (selectedChannel && onPlayChannel) {
			onPlayChannel(selectedChannel);
		}
	}, [selectedChannel, onPlayChannel]);

	const renderChannel = useCallback(({index, ...rest}) => {
		const channel = channels[index];
		if (!channel) return null;

		const imageUrl = channel.ImageTags?.Primary
			? `${serverUrl}/Items/${channel.Id}/Images/Primary?maxHeight=100&quality=90`
			: null;

		return (
			<Item
				{...rest}
				key={channel.Id}
				onClick={() => handleSelectChannel(channel)}
				selected={selectedChannel?.Id === channel.Id}
				className={css.channelItem}
			>
				<div className={css.channelRow}>
					{imageUrl && (
						<Image className={css.channelLogo} src={imageUrl} sizing="fit" />
					)}
					<div className={css.channelInfo}>
						<div className={css.channelNumber}>{channel.ChannelNumber}</div>
						<div className={css.channelName}>{channel.Name}</div>
					</div>
				</div>
			</Item>
		);
	}, [channels, serverUrl, selectedChannel, handleSelectChannel]);

	if (isLoading) {
		return (
			<Panel>
				<Header title="Live TV" />
				<LoadingSpinner />
			</Panel>
		);
	}

	return (
		<Panel>
			<Header title="Live TV" subtitle={`${channels.length} channels`} />
			<div className={css.content}>
				<div className={css.channelList}>
					{channels.length > 0 ? (
						<VirtualList
							dataSize={channels.length}
							itemRenderer={renderChannel}
							itemSize={80}
							spacing={8}
						/>
					) : (
						<div className={css.empty}>No channels available</div>
					)}
				</div>

				<div className={css.preview}>
					{selectedChannel ? (
						<>
							<h2 className={css.selectedName}>{selectedChannel.Name}</h2>
							{currentProgram && (
								<div className={css.programInfo}>
									<h3 className={css.programName}>{currentProgram.Name}</h3>
									<div className={css.programTime}>
										{new Date(currentProgram.StartDate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
										{' - '}
										{new Date(currentProgram.EndDate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
									</div>
									{currentProgram.Overview && (
										<p className={css.programOverview}>{currentProgram.Overview}</p>
									)}
								</div>
							)}
							<Button onClick={handlePlayChannel} className={css.watchButton}>
								Watch Now
							</Button>
						</>
					) : (
						<div className={css.selectPrompt}>Select a channel</div>
					)}
				</div>
			</div>
		</Panel>
	);
};

export default LiveTV;
