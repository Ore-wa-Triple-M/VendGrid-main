/**
 * theme-manager.js – Dark/Light mode switching
 */
(function() {
    'use strict';

    const STORAGE_KEY = 'vendgrid_theme';
    const THEME_LIGHT = 'light';
    const THEME_DARK = 'dark';

    let currentTheme = THEME_LIGHT;
    let darkStyleSheet = null;

    function createDarkStyleSheet() {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'assets/css/dark-theme.css';
        link.id = 'dark-theme-stylesheet';
        link.disabled = true;
        document.head.appendChild(link);
        return link;
    }

    function applyTheme(theme) {
        if (!darkStyleSheet) {
            darkStyleSheet = document.getElementById('dark-theme-stylesheet') || createDarkStyleSheet();
        }
        const isDark = (theme === THEME_DARK);
        darkStyleSheet.disabled = !isDark;
        document.body.classList.toggle('dark-mode', isDark);
        localStorage.setItem(STORAGE_KEY, theme);
        currentTheme = theme;

        // Dispatch event for other scripts (e.g., settings page toggle)
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }

    function getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME_DARK : THEME_LIGHT;
    }

    function initTheme() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === THEME_LIGHT || saved === THEME_DARK) {
            applyTheme(saved);
        } else {
            applyTheme(getSystemTheme());
        }
    }

    function toggleTheme() {
        const newTheme = (currentTheme === THEME_LIGHT) ? THEME_DARK : THEME_LIGHT;
        applyTheme(newTheme);
    }

    // Expose globally
    window.themeManager = {
        toggle: toggleTheme,
        getCurrent: () => currentTheme,
        setTheme: applyTheme
    };

    // Listen for system preference changes (optional)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(STORAGE_KEY)) {
            applyTheme(e.matches ? THEME_DARK : THEME_LIGHT);
        }
    });

    initTheme();
})();