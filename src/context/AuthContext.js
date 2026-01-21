import {createContext, useContext, useState, useEffect, useCallback} from 'react';
import * as jellyfinApi from '../services/jellyfinApi';
import {initStorage, getFromStorage, saveToStorage, removeFromStorage} from '../services/storage';

const AuthContext = createContext(null);

export const AuthProvider = ({children}) => {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [user, setUser] = useState(null);
	const [serverUrl, setServerUrl] = useState(null);

	useEffect(() => {
		const init = async () => {
			await initStorage();
			await jellyfinApi.initDeviceId();

			const storedAuth = await getFromStorage('auth');
			if (storedAuth) {
				jellyfinApi.setServer(storedAuth.serverUrl);
				jellyfinApi.setAuth(storedAuth.userId, storedAuth.token);
				setServerUrl(storedAuth.serverUrl);
				setUser(storedAuth.user);
				setIsAuthenticated(true);
			}
			setIsLoading(false);
		};
		init();
	}, []);

	const login = useCallback(async (server, username, password) => {
		jellyfinApi.setServer(server);

		const result = await jellyfinApi.api.authenticateByName(username, password);

		jellyfinApi.setAuth(result.User.Id, result.AccessToken);

		const authData = {
			serverUrl: server,
			userId: result.User.Id,
			token: result.AccessToken,
			user: result.User
		};

		await saveToStorage('auth', authData);

		setServerUrl(server);
		setUser(result.User);
		setIsAuthenticated(true);

		return result;
	}, []);

	const loginWithToken = useCallback(async (server, authResult) => {
		jellyfinApi.setServer(server);
		jellyfinApi.setAuth(authResult.User.Id, authResult.AccessToken);

		const authData = {
			serverUrl: server,
			userId: authResult.User.Id,
			token: authResult.AccessToken,
			user: authResult.User
		};

		await saveToStorage('auth', authData);

		setServerUrl(server);
		setUser(authResult.User);
		setIsAuthenticated(true);

		return authResult;
	}, []);

	const logout = useCallback(async () => {
		await removeFromStorage('auth');
		setUser(null);
		setServerUrl(null);
		setIsAuthenticated(false);
	}, []);

	return (
		<AuthContext.Provider value={{
			isAuthenticated,
			isLoading,
			user,
			serverUrl,
			login,
			loginWithToken,
			logout,
			api: jellyfinApi.api
		}}>
			{children}
		</AuthContext.Provider>
	);
};

export const useAuth = () => {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error('useAuth must be used within AuthProvider');
	}
	return context;
};
