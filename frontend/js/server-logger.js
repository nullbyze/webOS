/**
 * @module ServerLogger
 * @description Server-side logging and telemetry for Moonfin webOS
 * Sends error logs and telemetry to Jellyfin server's Activity Log.
 * Similar to Android TV app's TelemetryService. Handles buffering and structured logging.
 */
var ServerLogger = (function () {
   "use strict";

   var LOG_LEVELS = {
      DEBUG: "Debug",
      INFO: "Information",
      WARNING: "Warning",
      ERROR: "Error",
      FATAL: "Fatal",
   };

   var LOG_CATEGORIES = {
      PLAYBACK: "Playback",
      NETWORK: "Network",
      APP: "Application",
      AUTHENTICATION: "Authentication",
      NAVIGATION: "Navigation",
   };

   var isEnabled = false;
   var maxLogBuffer = 50;
   var logBuffer = [];
   var appVersion = "1.0.0";
   var deviceInfo = null;

   /**
    * Initialize the server logger
    * @param {Object} options - Configuration options
    * @param {boolean} options.enabled - Whether server logging is enabled
    */
   function init(options) {
      options = options || {};

      loadSettings();

      if (typeof APP_VERSION !== "undefined") {
         appVersion = APP_VERSION;
      }

      deviceInfo = getDeviceInfo();

      console.log(
         "[ServerLogger] Initialized - enabled:",
         isEnabled,
         "version:",
         appVersion
      );
   }

   /**
    * Load settings from storage
    */
   function loadSettings() {
      isEnabled = true;

      if (typeof storage === "undefined") return;

      try {
         var settingsStr = storage.getUserPreference("jellyfin_settings", null);
         if (settingsStr) {
            var settings = JSON.parse(settingsStr);
            if (settings.serverLogging === false) {
               isEnabled = false;
            }
         }
      } catch (e) {
         console.error("[ServerLogger] Error loading settings:", e);
      }
   }

   /**
    * Get device information for log context
    */
   function getDeviceInfo() {
      var info = {
         platform: "webOS",
         appVersion: appVersion,
         userAgent: navigator.userAgent || "Unknown",
         screenSize:
            window.screen.width + "x" + window.screen.height || "Unknown",
         webOSVersion: "Unknown",
         modelName: "Unknown",
      };

      // Try to get webOS version and model info
      try {
         if (typeof webOS !== "undefined" && webOS.deviceInfo) {
            webOS.deviceInfo(function (device) {
               if (device) {
                  info.modelName = device.modelName || "Unknown";
                  info.webOSVersion = device.version || "Unknown";
               }
            });
         }
      } catch (e) {}

      return info;
   }

   /**
    * Format timestamp for logs
    */
   function getTimestamp() {
      try {
         return new Date().toISOString();
      } catch (e) {
         return new Date().toString();
      }
   }

   /**
    * Log a message with specified level and category
    * @param {string} level - Log level (from LOG_LEVELS)
    * @param {string} category - Log category (from LOG_CATEGORIES)
    * @param {string} message - Log message
    * @param {Object} context - Additional context data
    * @param {boolean} immediate - Send immediately instead of buffering
    */
   function log(level, category, message, context, immediate) {
      var entry = {
         timestamp: getTimestamp(),
         level: level,
         category: category,
         message: message,
         context: context || {},
         device: deviceInfo,
      };

      logBuffer.push(entry);

      if (logBuffer.length > maxLogBuffer) {
         logBuffer.shift();
      }

      var consoleMethod = level === LOG_LEVELS.ERROR ? "error" : "log";
      console[consoleMethod](
         "[ServerLogger]",
         level,
         "-",
         category,
         ":",
         message,
         context || ""
      );

      if (!isEnabled) return;

      if (immediate) {
         sendLogToServer(entry);
      }
   }

   /**
    * Send a log entry to the Jellyfin server
    * @param {Object} entry - Log entry to send
    */
   function sendLogToServer(entry) {
      var auth = getAuth();
      if (!auth) {
         console.log("[ServerLogger] No auth available, skipping server log");
         return;
      }

      var logContent = formatLogAsText(entry);
      var url =
         auth.serverAddress +
         "/ClientLog/Document?documentType=Log&name=moonfin-webos-log";

      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "text/plain");
      
      var authHeader = buildAuthHeader(auth.accessToken);
      xhr.setRequestHeader("X-Emby-Authorization", authHeader);
      xhr.setRequestHeader("Authorization", authHeader);
      
      if (auth.accessToken) {
         xhr.setRequestHeader("X-MediaBrowser-Token", auth.accessToken);
      }
      
      xhr.timeout = 10000;

      xhr.onreadystatechange = function () {
         if (xhr.readyState === 4) {
            if (xhr.status === 200 || xhr.status === 204) {
               console.log("[ServerLogger] Log sent to server successfully");
            } else if (xhr.status === 401 || xhr.status === 403) {
               console.warn(
                  "[ServerLogger] Authentication failed sending log to server (" + xhr.status + "). Check reverse proxy headers."
               );
            } else if (xhr.status !== 0) {
               console.warn(
                  "[ServerLogger] Failed to send log to server:",
                  xhr.status,
                  xhr.statusText
               );
            }
         }
      };

      xhr.onerror = function () {
         console.warn("[ServerLogger] Network error sending log to server - may be CORS/reverse proxy issue");
      };
      
      xhr.ontimeout = function () {
         console.warn("[ServerLogger] Timeout sending log to server");
      };

      try {
         xhr.send(logContent);
      } catch (e) {
         console.error("[ServerLogger] Error sending log:", e);
      }
   }

   /**
    * Format log entry as text for server
    */
   function formatLogAsText(entry) {
      var lines = [];

      lines.push("=== Moonfin for webOS Log ===");
      lines.push("Timestamp: " + entry.timestamp);
      lines.push("Level: " + entry.level);
      lines.push("Category: " + entry.category);
      lines.push("Message: " + entry.message);
      lines.push("");
      lines.push("=== Device Info ===");

      if (entry.device) {
         lines.push("Platform: " + entry.device.platform);
         lines.push("App Version: " + entry.device.appVersion);
         lines.push("webOS Version: " + entry.device.webOSVersion);
         lines.push("Model: " + entry.device.modelName);
         lines.push("Screen: " + entry.device.screenSize);
         lines.push("User Agent: " + entry.device.userAgent);
      }

      if (entry.context && Object.keys(entry.context).length > 0) {
         lines.push("");
         lines.push("=== Context ===");
         for (var key in entry.context) {
            if (entry.context.hasOwnProperty(key)) {
               var value = entry.context[key];
               if (typeof value === "object") {
                  value = JSON.stringify(value, null, 2);
               }
               lines.push(key + ": " + value);
            }
         }
      }

      return lines.join("\n");
   }

   /**
    * Get auth from available sources
    */
   function getAuth() {
      if (
         typeof MultiServerManager !== "undefined" &&
         MultiServerManager.getAuthForPage
      ) {
         return MultiServerManager.getAuthForPage();
      }
      if (typeof JellyfinAPI !== "undefined" && JellyfinAPI.getStoredAuth) {
         return JellyfinAPI.getStoredAuth();
      }
      return null;
   }

   /**
    * Build authorization header
    */
   function buildAuthHeader(accessToken) {
      var header =
         'MediaBrowser Client="Moonfin for webOS", Device="LG TV", DeviceId="';
      header += getDeviceId() + '", Version="' + appVersion + '"';
      if (accessToken) {
         header += ', Token="' + accessToken + '"';
      }
      return header;
   }

   /**
    * Get or generate device ID
    */
   function getDeviceId() {
      if (typeof storage !== "undefined" && storage) {
         var deviceId = storage.get("moonfin_device_id", false);
         if (!deviceId) {
            deviceId =
               "webos-" +
               Date.now() +
               "-" +
               Math.random().toString(36).substr(2, 9);
            storage.set("moonfin_device_id", deviceId, false);
         }
         return deviceId;
      }
      return "webos-unknown";
   }

   /**
    * Log a playback error
    */
   function logPlaybackError(message, context) {
      log(LOG_LEVELS.ERROR, LOG_CATEGORIES.PLAYBACK, message, context, true);
   }

   /**
    * Log a playback warning
    */
   function logPlaybackWarning(message, context) {
      log(LOG_LEVELS.WARNING, LOG_CATEGORIES.PLAYBACK, message, context, false);
   }

   /**
    * Log playback info
    */
   function logPlaybackInfo(message, context) {
      log(LOG_LEVELS.INFO, LOG_CATEGORIES.PLAYBACK, message, context, false);
   }

   /**
    * Log a network error
    */
   function logNetworkError(message, context) {
      log(LOG_LEVELS.ERROR, LOG_CATEGORIES.NETWORK, message, context, true);
   }

   /**
    * Log an app error
    */
   function logAppError(message, context) {
      log(LOG_LEVELS.ERROR, LOG_CATEGORIES.APP, message, context, true);
   }

   /**
    * Log an app info message
    */
   function logAppInfo(message, context) {
      log(LOG_LEVELS.INFO, LOG_CATEGORIES.APP, message, context, true);
   }

   /**
    * Log an authentication error
    */
   function logAuthError(message, context) {
      log(
         LOG_LEVELS.ERROR,
         LOG_CATEGORIES.AUTHENTICATION,
         message,
         context,
         true
      );
   }

   /**
    * Log a navigation error
    */
   function logNavigationError(message, context) {
      log(
         LOG_LEVELS.ERROR,
         LOG_CATEGORIES.NAVIGATION,
         message,
         context,
         true
      );
   }

   /**
    * Create a detailed playback report
    * Useful for debugging complex playback issues
    */
   function createPlaybackReport(title, details) {
      var report = {
         title: title,
         timestamp: getTimestamp(),
         details: details,
         recentLogs: logBuffer.slice(-10),
      };

      log(
         LOG_LEVELS.INFO,
         LOG_CATEGORIES.PLAYBACK,
         "Playback Report: " + title,
         report,
         true
      );

      return report;
   }

   /**
    * Flush all buffered logs to server
    */
   function flushLogs() {
      if (!isEnabled || logBuffer.length === 0) return;

      var auth = getAuth();
      if (!auth) return;

      var fullLog = logBuffer
         .map(function (entry) {
            return formatLogAsText(entry);
         })
         .join("\n\n---\n\n");

      var url =
         auth.serverAddress +
         "/ClientLog/Document?documentType=Log&name=moonfin-webos-crash-log";

      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "text/plain");
      xhr.setRequestHeader(
         "X-Emby-Authorization",
         buildAuthHeader(auth.accessToken)
      );

      try {
         xhr.send(fullLog);
         logBuffer = [];
      } catch (e) {
         console.error("[ServerLogger] Error flushing logs:", e);
      }
   }

   /**
    * Enable/disable server logging
    */
   function setEnabled(enabled) {
      isEnabled = enabled;
      console.log("[ServerLogger] Server logging", enabled ? "enabled" : "disabled");

      try {
         if (typeof storage !== "undefined" && storage) {
            var settings = storage.getUserPreference("jellyfin_settings") || {};
            if (typeof settings === "string") {
               settings = JSON.parse(settings);
            }
            settings.serverLogging = enabled;
            storage.setUserPreference("jellyfin_settings", JSON.stringify(settings));
         }
      } catch (e) {
         console.warn("[ServerLogger] Failed to save settings:", e);
      }
   }

   /**
    * Check if server logging is enabled
    */
   function getEnabled() {
      return isEnabled;
   }

   /**
    * Get recent logs from buffer
    */
   function getRecentLogs() {
      return logBuffer.slice();
   }

   if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
         document.addEventListener("DOMContentLoaded", function () {
            init();
         });
      } else {
         init();
      }
   }

   return {
      init: init,
      log: log,
      logPlaybackError: logPlaybackError,
      logPlaybackWarning: logPlaybackWarning,
      logPlaybackInfo: logPlaybackInfo,
      logNetworkError: logNetworkError,
      logAppError: logAppError,
      logAppInfo: logAppInfo,
      logAuthError: logAuthError,
      logNavigationError: logNavigationError,
      createPlaybackReport: createPlaybackReport,
      flushLogs: flushLogs,
      setEnabled: setEnabled,
      getEnabled: getEnabled,
      getRecentLogs: getRecentLogs,
      LOG_LEVELS: LOG_LEVELS,
      LOG_CATEGORIES: LOG_CATEGORIES,
   };
})();
