/**
 * @module AccentColor
 * @description Manages the global accent color theme from user settings
 * Applies CSS custom properties for dynamic theming throughout the application
 */
(function() {
    'use strict';
    
    /**
     * Apply the accent color from user settings to CSS custom properties
     * @private
     */
    function applyAccentColor() {
        var settings = storage.getUserPreference('jellyfin_settings', null);
        if (!settings) return;
        
        try {
            if (typeof settings === 'string') settings = JSON.parse(settings);
            var accentColor = settings.accentColor || 'blue';
            
            var root = document.documentElement;
            if (accentColor === 'purple') {
                root.style.setProperty('--accent-color', '#6d4aff');
                root.style.setProperty('--accent-color-rgb', '109, 74, 255');
            } else {
                root.style.setProperty('--accent-color', '#007bff');
                root.style.setProperty('--accent-color-rgb', '0, 123, 255');
            }
        } catch (e) {
            // Failed to parse settings, use default
        }
    }
    
    // Apply accent color when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyAccentColor);
    } else {
        applyAccentColor();
    }
    
    // Expose globally
    window.AccentColor = {
        apply: applyAccentColor
    };
})();
