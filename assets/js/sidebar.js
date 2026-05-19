/**
 * sidebar.js – VendGrid Sidebar Behaviour
 *
 * FIX 1: sidebar.js was calling applySidebarAccess() synchronously inside its
 *         own DOMContentLoaded handler — before any page script had called
 *         requireAuth() and populated currentProfile. This caused the race that
 *         hid ALL sidebar items for every user including admins.
 *
 * FIX:    The applySidebarAccess() call is now REMOVED from sidebar.js entirely.
 *         Each page script (dashboard.js, reports.js, settings.js, etc.) calls
 *         applySidebarAccess() AFTER their own requireAuth/requireAdmin resolves.
 *         permissions.js also has built-in retry logic so even late calls work.
 *
 * FIX 2: Overlay was being re-created on every mobile open (memory leak).
 *         Now created once and reused.
 *
 * FIX 3: Mobile link-close listener was being added multiple times on
 *         repeated calls because bindMobileLinkClose() was re-invoked.
 *         Now uses { once: false } but only registers the handler once by
 *         checking a data attribute.
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'vendgrid_sidebar_collapsed';
    let overlay   = null;
    let resizeTimer;

    // ── Inject sidebar header (logo + toggle button) ──────────────────────────
    function ensureSidebarHeader() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar || sidebar.querySelector('.sidebar-header')) return;

        const header    = document.createElement('div');
        header.className = 'sidebar-header';

        const logo  = document.createElement('a');
        logo.href      = 'dashboard.html';
        logo.className = 'sidebar-logo';
        logo.innerHTML = '<i class="fas fa-cash-register me-1"></i>VendGrid';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'sidebar-toggle';
        toggleBtn.setAttribute('aria-label', 'Toggle sidebar');
        toggleBtn.innerHTML = '<i class="fas fa-bars"></i>';
        toggleBtn.addEventListener('click', onToggleClick);

        header.appendChild(logo);
        header.appendChild(toggleBtn);
        sidebar.insertBefore(header, sidebar.firstChild);

        // Refresh logo if branding is already available
        if (typeof window.updateGlobalBranding === 'function') {
            window.updateGlobalBranding();
        }
    }

    // ── Apply saved collapsed state (desktop only) ────────────────────────────
    function applyCollapsedState() {
        if (window.innerWidth > 768) {
            const isCollapsed = localStorage.getItem(STORAGE_KEY) === 'true';
            document.body.classList.toggle('sidebar-collapsed', isCollapsed);
        } else {
            document.body.classList.remove('sidebar-collapsed');
        }
    }

    // ── Desktop collapse toggle ───────────────────────────────────────────────
    function toggleDesktop() {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem(STORAGE_KEY, collapsed);
        window.dispatchEvent(new CustomEvent('sidebarToggle', { detail: { collapsed } }));
    }

    // ── Mobile drawer ─────────────────────────────────────────────────────────
    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closeMobileDrawer);
    }

    function openMobileDrawer() {
        ensureOverlay();
        document.querySelector('.sidebar')?.classList.add('mobile-open');
        overlay.classList.add('active');
    }

    function closeMobileDrawer() {
        document.querySelector('.sidebar')?.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }

    // Close mobile drawer when a nav link is clicked.
    // Guards against double-registration with a data attribute.
    function bindMobileLinkClose() {
        document.querySelectorAll('.sidebar-item').forEach(link => {
            if (link.dataset.mobileCloseRegistered) return;
            link.dataset.mobileCloseRegistered = '1';
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) closeMobileDrawer();
            });
        });
    }

    // ── Toggle handler (desktop vs mobile) ───────────────────────────────────
    function onToggleClick(e) {
        e.preventDefault();
        if (window.innerWidth <= 768) {
            openMobileDrawer();
        } else {
            toggleDesktop();
        }
    }

    // ── Resize handling (throttled) ───────────────────────────────────────────
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768) {
                closeMobileDrawer();
                document.body.classList.toggle(
                    'sidebar-collapsed',
                    localStorage.getItem(STORAGE_KEY) === 'true'
                );
            } else {
                document.body.classList.remove('sidebar-collapsed');
                closeMobileDrawer();
            }
        }, 100);
    });

    // ── Initialisation ────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        ensureSidebarHeader();  // inject header first
        applyCollapsedState();  // restore collapse — no flash
        bindMobileLinkClose();

        // NOTE: applySidebarAccess() is intentionally NOT called here.
        // It must be called by each page's boot function AFTER requireAuth()
        // resolves and sets currentProfile. See permissions.js for retry logic.
    });
})();