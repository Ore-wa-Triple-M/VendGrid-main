(function () {
    const STORAGE_KEY = 'vendgrid_sidebar_collapsed';
    let overlay = null;
    let resizeTimer;

    // ── Sidebar Header Injection ───────────────────────────
    function ensureSidebarHeader() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar || sidebar.querySelector('.sidebar-header')) return;

        const header = document.createElement('div');
        header.className = 'sidebar-header';

        const logo = document.createElement('a');
        logo.href = 'dashboard.html';
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
    }

    // ── Apply saved state (desktop only) ────────────────────
    function applyCollapsedState() {
        if (window.innerWidth > 768) {
            const isCollapsed = localStorage.getItem(STORAGE_KEY) === 'true';
            document.body.classList.toggle('sidebar-collapsed', isCollapsed);
        } else {
            document.body.classList.remove('sidebar-collapsed');
        }
    }

    // ── Desktop toggle ──────────────────────────────────────
    function toggleDesktop() {
        const body = document.body;
        const collapsed = body.classList.toggle('sidebar-collapsed');
        localStorage.setItem(STORAGE_KEY, collapsed);
        // Dispatch event for any other components that might need to react
        window.dispatchEvent(new CustomEvent('sidebarToggle', { detail: { collapsed } }));
    }

    // ── Mobile drawer ───────────────────────────────────────
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
        overlay?.classList.remove('active');
    }

    function bindMobileLinkClose() {
        document.querySelectorAll('.sidebar-item').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) closeMobileDrawer();
            });
        });
    }

    // ── Toggle handler (mobile vs desktop) ───────────────────
    function onToggleClick(e) {
        e.preventDefault();
        if (window.innerWidth <= 768) {
            openMobileDrawer();
        } else {
            toggleDesktop();
        }
    }

    // ── Resize handling (throttled) ─────────────────────────
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768) {
                closeMobileDrawer();
                // Restore desktop collapsed state
                const saved = localStorage.getItem(STORAGE_KEY) === 'true';
                document.body.classList.toggle('sidebar-collapsed', saved);
            } else {
                document.body.classList.remove('sidebar-collapsed');
                closeMobileDrawer();
            }
        }, 100);
    });

    // ── Initialisation ──────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        ensureSidebarHeader();    // inject header first
        applyCollapsedState();    // then set class – no flash
        bindMobileLinkClose();
    });
})();