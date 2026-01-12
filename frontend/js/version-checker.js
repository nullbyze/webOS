/**
 * @module VersionChecker
 * @description Version management system for Moonfin webOS
 * Checks GitHub releases API for newer versions and displays update notifications
 * with 24-hour cooldown and version dismissal capability.
 */

var VersionChecker = (function () {
   "use strict";

   var GITHUB_API_URL =
      "https://api.github.com/repos/Moonfin-Client/webOS/releases/latest";
   var CHECK_COOLDOWN_HOURS = 24;
   var STORAGE_KEY_LAST_CHECK = "version_last_check";
   var STORAGE_KEY_DISMISSED_VERSION = "version_dismissed";

   /**
    * Get current application version
    * @private
    * @returns {string} Current version string (e.g., "1.0.0")
    */
   function getCurrentVersion() {
      return typeof APP_VERSION !== "undefined" ? APP_VERSION : "1.0.0";
   }

   /**
    * Compare two version strings
    * @param {string} v1 - First version
    * @param {string} v2 - Second version
    * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
    */
   function compareVersions(v1, v2) {
      v1 = v1.replace(/^v/, "");
      v2 = v2.replace(/^v/, "");

      const parts1 = v1.split(".").map(function (n) {
         return parseInt(n, 10) || 0;
      });
      const parts2 = v2.split(".").map(function (n) {
         return parseInt(n, 10) || 0;
      });

      const maxLength = Math.max(parts1.length, parts2.length);

      for (let i = 0; i < maxLength; i++) {
         const part1 = parts1[i] || 0;
         const part2 = parts2[i] || 0;

         if (part1 < part2) return -1;
         if (part1 > part2) return 1;
      }

      return 0;
   }

   /**
    * Check if enough time has passed since last check
    * @private
    * @returns {boolean} True if we should check for updates
    */
   function shouldCheckForUpdate() {
      if (!storage) return true;

      const lastCheck = storage.get(STORAGE_KEY_LAST_CHECK, false);
      if (!lastCheck) return true;

      const lastCheckTime = parseInt(lastCheck, 10);
      const now = Date.now();
      const hoursSinceCheck = (now - lastCheckTime) / (1000 * 60 * 60);

      return hoursSinceCheck >= CHECK_COOLDOWN_HOURS;
   }

   /**
    * Mark that we've checked for updates
    * @private
    */
   function markChecked() {
      if (storage) {
         storage.set(STORAGE_KEY_LAST_CHECK, Date.now().toString(), false);
      }
   }

   /**
    * Check if user dismissed this version
    * @private
    * @param {string} version - Version to check
    * @returns {boolean} True if dismissed
    */
   function isVersionDismissed(version) {
      if (!storage) return false;

      const dismissedVersion = storage.get(
         STORAGE_KEY_DISMISSED_VERSION,
         false
      );
      return dismissedVersion === version;
   }

   /**
    * Mark version as dismissed
    * @private
    * @param {string} version - Version to dismiss
    */
   function dismissVersion(version) {
      if (storage) {
         storage.set(STORAGE_KEY_DISMISSED_VERSION, version, false);
      }
   }

   /**
    * Fetch latest release info from GitHub
    * @private
    * @returns {Promise<Object>} Release info object
    */
   function fetchLatestRelease() {
      return new Promise(function (resolve, reject) {
         var xhr = new XMLHttpRequest();
         xhr.open("GET", GITHUB_API_URL, true);
         xhr.setRequestHeader("Accept", "application/vnd.github+json");
         xhr.setRequestHeader("User-Agent", "Moonfin-webOS-Client");

         xhr.timeout = 10000;

         xhr.onload = function () {
            if (xhr.status === 200) {
               try {
                  var data = JSON.parse(xhr.responseText);
                  resolve(data);
               } catch (e) {
                  reject(new Error("Failed to parse response"));
               }
            } else {
               reject(new Error("HTTP " + xhr.status));
            }
         };

         xhr.onerror = function () {
            reject(new Error("Network error"));
         };

         xhr.ontimeout = function () {
            reject(new Error("Request timeout"));
         };

         xhr.send();
      });
   }

   /**
    * Show update notification modal
    * @private
    * @param {Object} releaseInfo - GitHub release information
    */
   function showUpdateModal(releaseInfo) {
      const latestVersion = releaseInfo.tag_name.replace(/^v/, "");
      const currentVersion = getCurrentVersion();

      const modalHTML = `
            <div id="updateModal" class="update-modal" role="dialog" aria-labelledby="updateTitle" aria-modal="true">
                <div class="update-modal-content">
                    <h2 id="updateTitle" class="update-modal-title">Update Available</h2>
                    <p class="update-modal-version">
                        Version ${latestVersion} is now available<br>
                        <span class="update-modal-current">(Current: ${currentVersion})</span>
                    </p>
                    <div class="update-modal-notes">
                        ${
                           releaseInfo.body
                              ? formatReleaseNotes(releaseInfo.body)
                              : "A new version is available. Visit GitHub to download."
                        }
                    </div>
                    <div class="update-modal-buttons">
                        <button id="updateModalOk" class="update-modal-button update-modal-button-focused">
                            OK
                        </button>
                    </div>
                </div>
            </div>
        `;

      var modalContainer = document.createElement("div");
      modalContainer.innerHTML = modalHTML;

      var previousFocus = document.activeElement;

      document.body.appendChild(modalContainer.firstElementChild);

      var modal = document.getElementById("updateModal");
      var okButton = document.getElementById("updateModalOk");

      okButton.focus();

      function closeModal() {
         dismissVersion(latestVersion);
         modal.remove();

         var homeBtn = document.getElementById("homeBtn");
         if (homeBtn) {
            homeBtn.focus();
         } else if (previousFocus && previousFocus.focus) {
            previousFocus.focus();
         }
      }

      okButton.addEventListener("click", closeModal);

      document.addEventListener("keydown", function handleModalKeys(e) {
         if (modal.parentElement) {
            if (e.keyCode === KeyCodes.ENTER || e.keyCode === KeyCodes.OK) {
               e.preventDefault();
               e.stopPropagation();
               closeModal();
               document.removeEventListener("keydown", handleModalKeys);
            }
            else if (
               e.keyCode === KeyCodes.BACK ||
               e.keyCode === KeyCodes.ESCAPE ||
               e.keyCode === KeyCodes.BACKSPACE
            ) {
               e.preventDefault();
               e.stopPropagation();
               closeModal();
               document.removeEventListener("keydown", handleModalKeys);
            }
         }
      });

      console.log(
         "[VERSION] Update modal displayed for version " + latestVersion
      );
   }

   /**
    * Format release notes for display
    * @private
    * @param {string} notes - Raw release notes
    * @returns {string} Formatted HTML
    */
   function formatReleaseNotes(notes) {
      let formatted = notes.substring(0, 500);
      if (notes.length > 500) {
         formatted += "...";
      }

      formatted = formatted
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/\n/g, "<br>")
         .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
         .replace(/\*(.*?)\*/g, "<em>$1</em>");

      return formatted;
   }

   /**
    * Check for updates and show modal if newer version available
    */
   function checkForUpdates() {
      console.log("[VERSION] Checking for updates...");

      if (!shouldCheckForUpdate()) {
         console.log("[VERSION] Skipping check (cooldown period)");
         return;
      }

      const currentVersion = getCurrentVersion();

      fetchLatestRelease()
         .then(function (releaseInfo) {
            markChecked();

            if (!releaseInfo || !releaseInfo.tag_name) {
               console.log("[VERSION] No release information available");
               return;
            }

            const latestVersion = releaseInfo.tag_name.replace(/^v/, "");

            console.log(
               "[VERSION] Current:",
               currentVersion,
               "Latest:",
               latestVersion
            );

            if (compareVersions(currentVersion, latestVersion) < 0) {
               if (!isVersionDismissed(latestVersion)) {
                  console.log(
                     "[VERSION] Newer version available:",
                     latestVersion
                  );
                  showUpdateModal(releaseInfo);
               } else {
                  console.log(
                     "[VERSION] Update available but dismissed by user"
                  );
               }
            } else {
               console.log("[VERSION] App is up to date");
            }
         })
         .catch(function (error) {
            console.log(
               "[VERSION] Failed to check for updates:",
               error.message
            );
         });
   }

   /**
    * Initialize version checker on app startup
    * Waits 3 seconds before checking to allow app to fully load
    */
   function init() {
      setTimeout(function () {
         checkForUpdates();
      }, 3000);
   }

   return {
      init: init,
      checkForUpdates: checkForUpdates,
      getCurrentVersion: getCurrentVersion,
   };
})();
