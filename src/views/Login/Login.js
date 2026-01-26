import {useState, useCallback, useEffect} from 'react';
import Spottable from '@enact/spotlight/Spottable';
import Spotlight from '@enact/spotlight';
import {useAuth} from '../../context/AuthContext';
import * as jellyfinApi from '../../services/jellyfinApi';

import css from './Login.module.less';

const SpottableInput = Spottable('input');
const SpottableButton = Spottable('button');
const SpottableDiv = Spottable('div');

const Login = ({onLoggedIn}) => {
	const {login, loginWithToken, isLoading, isAuthenticated} = useAuth();

	const [step, setStep] = useState('server');
	const [serverUrl, setServerUrl] = useState('');
	const [serverInfo, setServerInfo] = useState(null);
	const [publicUsers, setPublicUsers] = useState([]);
	const [selectedUser, setSelectedUser] = useState(null);
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [quickConnectCode, setQuickConnectCode] = useState('');
	const [, setQuickConnectSecret] = useState(null);
	const [quickConnectInterval, setQuickConnectInterval] = useState(null);
	const [error, setError] = useState(null);
	const [status, setStatus] = useState(null);
	const [isConnecting, setIsConnecting] = useState(false);

	useEffect(() => {
		if (isAuthenticated) {
			onLoggedIn?.();
		}
	}, [isAuthenticated, onLoggedIn]);

	useEffect(() => {
		if (!isLoading && step === 'server') {
			setTimeout(() => Spotlight.focus('[data-spotlight-id="server-input"]'), 100);
		}
	}, [isLoading, step]);

	const handleServerUrlChange = useCallback((e) => {
		setServerUrl(e.target.value);
	}, []);

	const handleUsernameChange = useCallback((e) => {
		setUsername(e.target.value);
	}, []);

	const handlePasswordChange = useCallback((e) => {
		setPassword(e.target.value);
	}, []);

	const handleConnect = useCallback(async () => {
		if (!serverUrl.trim()) return;

		setIsConnecting(true);
		setError(null);
		setStatus('Connecting to server...');

		try {
			jellyfinApi.setServer(serverUrl);
			const info = await jellyfinApi.api.getPublicInfo();
			setServerInfo(info);
			setStatus(`Connected to ${info.ServerName}! Loading users...`);

			try {
				const users = await jellyfinApi.api.getPublicUsers();
				setPublicUsers(users || []);
				if (users && users.length > 0) {
					setStep('users');
					setStatus(null);
					setTimeout(() => Spotlight.focus('[data-spotlight-id="user-0"]'), 100);
				} else {
					setStep('manual');
					setStatus(null);
					setTimeout(() => Spotlight.focus('[data-spotlight-id="username-input"]'), 100);
				}
			} catch {
				setStep('manual');
				setStatus(null);
				setTimeout(() => Spotlight.focus('[data-spotlight-id="username-input"]'), 100);
			}
		} catch (err) {
			setError('Failed to connect to server. Check the address and try again.');
			setStatus(null);
		} finally {
			setIsConnecting(false);
		}
	}, [serverUrl]);

	const handleUserSelect = useCallback((user) => {
		setSelectedUser(user);
		setUsername(user.Name);
		setPassword('');
		setStep('password');
		setTimeout(() => Spotlight.focus('[data-spotlight-id="password-input"]'), 100);
	}, []);

	const handleLogin = useCallback(async () => {
		if (!username) return;

		setIsConnecting(true);
		setError(null);
		setStatus('Signing in...');

		try {
			await login(jellyfinApi.getServerUrl(), username, password);
			onLoggedIn?.();
		} catch (err) {
			console.error('Login error:', err);
			setError(err.message || 'Login failed. Check your credentials.');
			setStatus(null);
		} finally {
			setIsConnecting(false);
		}
	}, [username, password, login, onLoggedIn]);

	const handleBack = useCallback(() => {
		setError(null);
		setStatus(null);
		if (quickConnectInterval) {
			clearInterval(quickConnectInterval);
			setQuickConnectInterval(null);
		}
		if (step === 'password' || step === 'passwordform' || step === 'quickconnect') {
			setStep('users');
			setSelectedUser(null);
			setPassword('');
			setQuickConnectCode('');
			setQuickConnectSecret(null);
			setTimeout(() => Spotlight.focus('[data-spotlight-id="user-0"]'), 100);
		} else if (step === 'manual' || step === 'users') {
			setStep('server');
			setServerInfo(null);
			setPublicUsers([]);
			setTimeout(() => Spotlight.focus('[data-spotlight-id="server-input"]'), 100);
		}
	}, [step, quickConnectInterval]);

	const handleManualLogin = useCallback(() => {
		setStep('manual');
		setSelectedUser(null);
		setUsername('');
		setPassword('');
		setTimeout(() => Spotlight.focus('[data-spotlight-id="username-input"]'), 100);
	}, []);

	const handleQuickConnect = useCallback(async (user) => {
		setSelectedUser(user);
		setUsername(user.Name);
		setIsConnecting(true);
		setError(null);
		setStatus('Initiating Quick Connect...');

		try {
			const result = await jellyfinApi.api.initiateQuickConnect();
			setQuickConnectCode(result.Code);
			setQuickConnectSecret(result.Secret);
			setStep('quickconnect');
			setStatus('Enter the code on another device or authorize in the Jellyfin dashboard');

			const intervalId = setInterval(async () => {
				try {
					const state = await jellyfinApi.api.getQuickConnectState(result.Secret);
					if (state.Authenticated) {
						clearInterval(intervalId);
						setQuickConnectInterval(null);
						setStatus('Quick Connect authorized! Signing in...');

						const authResult = await jellyfinApi.api.authenticateQuickConnect(result.Secret);
						await loginWithToken(jellyfinApi.getServerUrl(), authResult);
						onLoggedIn?.();
					}
				} catch (err) {
					console.error('Quick Connect poll error:', err);
				}
			}, 3000);

			setQuickConnectInterval(intervalId);
			setTimeout(() => Spotlight.focus('[data-spotlight-id="qc-back-btn"]'), 100);
		} catch (err) {
			console.error('Quick Connect error:', err);
			setError('Quick Connect failed. Try password login instead.');
			setStatus(null);
		} finally {
			setIsConnecting(false);
		}
	}, [loginWithToken, onLoggedIn]);

	const cancelQuickConnect = useCallback(() => {
		if (quickConnectInterval) {
			clearInterval(quickConnectInterval);
			setQuickConnectInterval(null);
		}
		setQuickConnectCode('');
		setQuickConnectSecret(null);
		setStep('users');
		setSelectedUser(null);
		setTimeout(() => Spotlight.focus('[data-spotlight-id="user-0"]'), 100);
	}, [quickConnectInterval]);

	const handleServerInputKeyDown = useCallback((e) => {
		if (e.keyCode === 13) {
			handleConnect();
		}
	}, [handleConnect]);

	const handlePasswordKeyDown = useCallback((e) => {
		if (e.keyCode === 13) {
			handleLogin();
		}
	}, [handleLogin]);

	const handleUserCardClick = useCallback((e) => {
		const userId = e.currentTarget.dataset.userId;
		const user = publicUsers.find(u => u.Id === userId);
		if (user) handleUserSelect(user);
	}, [publicUsers, handleUserSelect]);

	const handleUserCardKeyDown = useCallback((e) => {
		if (e.keyCode === 13) {
			const userId = e.currentTarget.dataset.userId;
			const user = publicUsers.find(u => u.Id === userId);
			if (user) handleUserSelect(user);
		}
	}, [publicUsers, handleUserSelect]);

	const handleQuickConnectClick = useCallback(() => {
		if (selectedUser) handleQuickConnect(selectedUser);
	}, [selectedUser, handleQuickConnect]);

	const handlePasswordMethodClick = useCallback(() => {
		setStep('passwordform');
		setTimeout(() => Spotlight.focus('[data-spotlight-id="password-input"]'), 100);
	}, []);

	const handlePasswordFormCancel = useCallback(() => {
		setStep('password');
		setPassword('');
		setTimeout(() => Spotlight.focus('[data-spotlight-id="use-password-btn"]'), 100);
	}, []);

	const handleUsePasswordInstead = useCallback(() => {
		if (quickConnectInterval) {
			clearInterval(quickConnectInterval);
			setQuickConnectInterval(null);
		}
		setQuickConnectCode('');
		setQuickConnectSecret(null);
		setStep('passwordform');
		setTimeout(() => Spotlight.focus('[data-spotlight-id="password-input"]'), 100);
	}, [quickConnectInterval]);

	useEffect(() => {
		return () => {
			if (quickConnectInterval) {
				clearInterval(quickConnectInterval);
			}
		};
	}, [quickConnectInterval]);

	if (isLoading) {
		return (
			<div className={css.page}>
				<div className={css.loading}>
					<div className={css.spinner} />
					<span>Loading...</span>
				</div>
			</div>
		);
	}

	return (
		<div className={css.page}>
			<div className={css.container}>
				<div className={css.logoSection}>
					<img src="resources/banner-dark.png" alt="Moonfin" className={css.logo} />
				</div>

				{status && <div className={css.statusMessage}>{status}</div>}
				{error && <div className={css.errorMessage}>{error}</div>}

				<div className={css.contentWrapper}>
					{step === 'server' && (
						<div className={css.section}>
							<h2>Connect to Server</h2>
							<div className={css.formGroup}>
								<label>Server Address</label>
								<SpottableInput
									data-spotlight-id="server-input"
									type="text"
									className={css.input}
									placeholder="192.168.1.100 or jellyfin.example.com"
									value={serverUrl}
									onChange={handleServerUrlChange}
									onKeyDown={handleServerInputKeyDown}
									disabled={isConnecting}
								/>
								<div className={css.buttonGroup}>
									<SpottableButton
										data-spotlight-id="connect-btn"
										className={`${css.btn} ${css.btnPrimary}`}
										onClick={handleConnect}
										disabled={isConnecting || !serverUrl.trim()}
									>
										{isConnecting ? 'Connecting...' : 'Connect'}
									</SpottableButton>
								</div>
							</div>
						</div>
					)}

					{step === 'users' && (
						<div className={css.section}>
							<h2>Select User</h2>
							<div className={css.serverName}>{serverInfo?.ServerName}</div>
							<div className={css.userGrid}>
								{publicUsers.map((user, index) => (
									<SpottableDiv
										key={user.Id}
										data-spotlight-id={`user-${index}`}
										data-user-id={user.Id}
										className={css.userCard}
										onClick={handleUserCardClick}
										onKeyDown={handleUserCardKeyDown}
									>
										{user.PrimaryImageTag ? (
											<img
												src={`${jellyfinApi.getServerUrl()}/Users/${user.Id}/Images/Primary?tag=${user.PrimaryImageTag}&quality=90&maxHeight=150`}
												alt={user.Name}
												className={css.userAvatar}
											/>
										) : (
											<div className={css.userAvatarPlaceholder}>
												{user.Name.charAt(0).toUpperCase()}
											</div>
										)}
										<span className={css.userName}>{user.Name}</span>
									</SpottableDiv>
								))}
							</div>
							<div className={css.buttonGroup}>
								<SpottableButton
									data-spotlight-id="manual-login-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={handleManualLogin}
								>
									Manual Login
								</SpottableButton>
								<SpottableButton
									data-spotlight-id="back-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={handleBack}
								>
									Change Server
								</SpottableButton>
							</div>
						</div>
					)}

					{step === 'password' && selectedUser && (
						<div className={css.section}>
							<h2>Sign In As {selectedUser.Name}</h2>
							<div className={css.selectedUserInfo}>
								{selectedUser.PrimaryImageTag ? (
									<img
										src={`${jellyfinApi.getServerUrl()}/Users/${selectedUser.Id}/Images/Primary?tag=${selectedUser.PrimaryImageTag}&quality=90&maxHeight=150`}
										alt={selectedUser.Name}
										className={css.selectedAvatar}
									/>
								) : (
									<div className={css.selectedAvatarPlaceholder}>
										{selectedUser.Name.charAt(0).toUpperCase()}
									</div>
								)}
								<span className={css.selectedName}>{selectedUser.Name}</span>
							</div>
							<div className={css.loginMethodButtons}>
								<SpottableButton
									data-spotlight-id="use-qc-btn"
									className={`${css.btn} ${css.btnPrimary}`}
									onClick={handleQuickConnectClick}
								>
									Quick Connect
								</SpottableButton>
								<SpottableButton
									data-spotlight-id="use-password-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={handlePasswordMethodClick}
								>
									Password
								</SpottableButton>
							</div>
							<div className={css.buttonGroup}>
								<SpottableButton
									data-spotlight-id="password-back-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={handleBack}
								>
									Back
								</SpottableButton>
							</div>
						</div>
					)}

					{step === 'passwordform' && selectedUser && (
						<div className={css.section}>
							<h2>Enter Password</h2>
							<div className={css.selectedUserInfo}>
								{selectedUser.PrimaryImageTag ? (
									<img
										src={`${jellyfinApi.getServerUrl()}/Users/${selectedUser.Id}/Images/Primary?tag=${selectedUser.PrimaryImageTag}&quality=90&maxHeight=150`}
										alt={selectedUser.Name}
										className={css.selectedAvatar}
									/>
								) : (
									<div className={css.selectedAvatarPlaceholder}>
										{selectedUser.Name.charAt(0).toUpperCase()}
									</div>
								)}
								<span className={css.selectedName}>{selectedUser.Name}</span>
							</div>
							<div className={css.formGroup}>
								<SpottableInput
									data-spotlight-id="password-input"
									type="password"
									className={css.input}
									placeholder="Password (leave empty if none)"
									value={password}
									onChange={handlePasswordChange}
									onKeyDown={handlePasswordKeyDown}
									disabled={isConnecting}
								/>
								<div className={css.buttonGroup}>
									<SpottableButton
										data-spotlight-id="login-btn"
										className={`${css.btn} ${css.btnPrimary}`}
										onClick={handleLogin}
										disabled={isConnecting}
									>
										{isConnecting ? 'Signing in...' : 'Sign In'}
									</SpottableButton>
									<SpottableButton
										data-spotlight-id="cancel-btn"
										className={`${css.btn} ${css.btnSecondary}`}
										onClick={handlePasswordFormCancel}
									>
										Back
									</SpottableButton>
								</div>
							</div>
						</div>
					)}

					{step === 'quickconnect' && selectedUser && (
						<div className={css.section}>
							<h2>Quick Connect</h2>
							<div className={css.selectedUserInfo}>
								{selectedUser.PrimaryImageTag ? (
									<img
										src={`${jellyfinApi.getServerUrl()}/Users/${selectedUser.Id}/Images/Primary?tag=${selectedUser.PrimaryImageTag}&quality=90&maxHeight=150`}
										alt={selectedUser.Name}
										className={css.selectedAvatar}
									/>
								) : (
									<div className={css.selectedAvatarPlaceholder}>
										{selectedUser.Name.charAt(0).toUpperCase()}
									</div>
								)}
								<span className={css.selectedName}>{selectedUser.Name}</span>
							</div>
							<div className={css.quickConnectCodeDisplay}>
								<div className={css.qcLabel}>Enter this code on another device or authorize in Jellyfin dashboard:</div>
								<div className={css.qcCode}>{quickConnectCode}</div>
								<div className={css.qcWaiting}>Waiting for authorization...</div>
							</div>
							<div className={css.buttonGroup}>
								<SpottableButton
									data-spotlight-id="use-password-instead-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={handleUsePasswordInstead}
								>
									Use Password Instead
								</SpottableButton>
								<SpottableButton
									data-spotlight-id="qc-back-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={cancelQuickConnect}
								>
									Cancel
								</SpottableButton>
							</div>
						</div>
					)}

					{step === 'manual' && (
						<div className={css.section}>
							<h2>Manual Login</h2>
							{serverInfo && <div className={css.serverName}>{serverInfo.ServerName}</div>}
							<div className={css.formGroup}>
								<label>Username</label>
								<SpottableInput
									data-spotlight-id="username-input"
									type="text"
									className={css.input}
									placeholder="Username"
									value={username}
									onChange={handleUsernameChange}
									disabled={isConnecting}
								/>
							</div>
							<div className={css.formGroup}>
								<label>Password</label>
								<SpottableInput
									data-spotlight-id="manual-password-input"
									type="password"
									className={css.input}
									placeholder="Password"
									value={password}
									onChange={handlePasswordChange}
									onKeyDown={handlePasswordKeyDown}
									disabled={isConnecting}
								/>
							</div>
							<div className={css.buttonGroup}>
								<SpottableButton
									data-spotlight-id="manual-submit-btn"
									className={`${css.btn} ${css.btnPrimary}`}
									onClick={handleLogin}
									disabled={isConnecting || !username.trim()}
								>
									{isConnecting ? 'Signing in...' : 'Sign In'}
								</SpottableButton>
								<SpottableButton
									data-spotlight-id="manual-back-btn"
									className={`${css.btn} ${css.btnSecondary}`}
									onClick={handleBack}
								>
									Back
								</SpottableButton>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default Login;
