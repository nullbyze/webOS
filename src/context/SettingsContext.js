import {createContext, useContext, useState, useEffect, useCallback} from 'react';
import {getFromStorage, saveToStorage} from '../services/storage';

const defaultSettings = {
	preferTranscode: false,
	maxBitrate: 0,
	audioLanguage: '',
	subtitleLanguage: '',
	subtitleMode: 'default',
	skipIntro: true,
	skipCredits: false,
	autoPlay: true,
	theme: 'dark'
};

const SettingsContext = createContext(null);

export function SettingsProvider({children}) {
	const [settings, setSettings] = useState(defaultSettings);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		getFromStorage('settings').then((stored) => {
			if (stored) {
				setSettings({...defaultSettings, ...stored});
			}
			setLoaded(true);
		});
	}, []);

	const updateSetting = useCallback((key, value) => {
		setSettings(prev => {
			const updated = {...prev, [key]: value};
			saveToStorage('settings', updated);
			return updated;
		});
	}, []);

	const updateSettings = useCallback((newSettings) => {
		setSettings(prev => {
			const updated = {...prev, ...newSettings};
			saveToStorage('settings', updated);
			return updated;
		});
	}, []);

	const resetSettings = useCallback(() => {
		setSettings(defaultSettings);
		saveToStorage('settings', defaultSettings);
	}, []);

	return (
		<SettingsContext.Provider value={{
			settings,
			loaded,
			updateSetting,
			updateSettings,
			resetSettings
		}}>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings() {
	const context = useContext(SettingsContext);
	if (!context) {
		throw new Error('useSettings must be used within SettingsProvider');
	}
	return context;
}
