import {useState, useCallback} from 'react';
import ThemeDecorator from '@enact/sandstone/ThemeDecorator';
import Panels from '@enact/sandstone/Panels';

import {AuthProvider} from '../context/AuthContext';
import {SettingsProvider} from '../context/SettingsContext';
import Login from '../views/Login';
import Browse from '../views/Browse';

import css from './App.module.less';

const AppBase = (props) => {
	const [panelIndex, setPanelIndex] = useState(0);
	const [selectedItem, setSelectedItem] = useState(null);

	const handleLoggedIn = useCallback(() => {
		setPanelIndex(1);
	}, []);

	const handleBack = useCallback(() => {
		if (panelIndex > 0) {
			setPanelIndex(panelIndex - 1);
			setSelectedItem(null);
		}
	}, [panelIndex]);

	const handleSelectItem = useCallback((item) => {
		setSelectedItem(item);
	}, []);

	return (
		<SettingsProvider>
			<AuthProvider>
				<div className={css.app} {...props}>
					<Panels index={panelIndex} onBack={handleBack} noCloseButton>
						<Login onLoggedIn={handleLoggedIn} />
						<Browse onSelectItem={handleSelectItem} />
					</Panels>
				</div>
			</AuthProvider>
		</SettingsProvider>
	);
};

const App = ThemeDecorator(AppBase);
export default App;
