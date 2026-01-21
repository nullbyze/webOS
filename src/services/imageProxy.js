import LS2Request from '@enact/webos/LS2Request';

const SERVICE_URI = 'luna://org.moonfin.webos.service';

const imageCache = new Map();
const pendingRequests = new Map();

export const proxyImage = (url) => {
	if (!url) return Promise.resolve(null);

	if (imageCache.has(url)) {
		return Promise.resolve(imageCache.get(url));
	}

	if (pendingRequests.has(url)) {
		return pendingRequests.get(url);
	}

	const promise = new Promise((resolve) => {
		new LS2Request().send({
			service: SERVICE_URI,
			method: 'imageProxy',
			parameters: {url},
			onSuccess: (response) => {
				if (response.success && response.data) {
					const dataUrl = `data:${response.contentType || 'image/jpeg'};base64,${response.data}`;
					imageCache.set(url, dataUrl);
					pendingRequests.delete(url);
					resolve(dataUrl);
				} else {
					pendingRequests.delete(url);
					resolve(null);
				}
			},
			onFailure: () => {
				pendingRequests.delete(url);
				resolve(null);
			}
		});
	});

	pendingRequests.set(url, promise);
	return promise;
};

export const clearImageCache = () => {
	imageCache.clear();
};

export default {
	proxyImage,
	clearImageCache
};
