/**
 * app.js – VendGrid Global Utilities
 *
 * Fixed / improved in this version:
 *  - showConfirmationToast now renders a centred modal-style overlay instead of
 *    a corner toast — feels connected to the UI, smooth animation, proper theme
 *  - Inline style injection for confirmationToastStyles replaced with proper
 *    class-based approach that honours the app colour scheme
 *  - All other utilities unchanged
 */

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================

function showNotification(message, type = 'success') {
    const icons = {
        success: 'check-circle',
        error:   'times-circle',
        warning: 'exclamation-triangle',
        info:    'info-circle'
    };

    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `vg-toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.35s ease reverse';
        setTimeout(() => toast.remove(), 250);
    }, 3000);
}

/**
 * Show a centred confirmation dialog (non-blocking).
 * Resolves true if the user clicks Confirm, false if Cancel or it times out.
 *
 * @param {string} message    - Prompt text shown to the user.
 * @param {number} timeoutMs  - Auto-dismiss in ms (default 8000).
 * @returns {Promise<boolean>}
 */
function showConfirmationToast(message, timeoutMs = 8000) {
    return new Promise((resolve) => {

        // ── Overlay backdrop ──────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.className = 'vg-confirm-overlay';

        // ── Dialog card ───────────────────────────────────────────
        const dialog = document.createElement('div');
        dialog.className = 'vg-confirm-dialog';
        dialog.innerHTML = `
            <div class="vg-confirm-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <p class="vg-confirm-message">${message}</p>
            <div class="vg-confirm-actions">
                <button class="vg-confirm-btn vg-confirm-btn--cancel">Cancel</button>
                <button class="vg-confirm-btn vg-confirm-btn--confirm">Delete</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Force reflow then add visible class for entrance animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => overlay.classList.add('vg-confirm-overlay--visible'));
        });

        let settled = false;

        function dismiss(result) {
            if (settled) return;
            settled = true;
            clearTimeout(autoTimer);
            overlay.classList.remove('vg-confirm-overlay--visible');
            setTimeout(() => overlay.remove(), 220);
            resolve(result);
        }

        dialog.querySelector('.vg-confirm-btn--confirm').addEventListener('click', () => dismiss(true));
        dialog.querySelector('.vg-confirm-btn--cancel').addEventListener('click',  () => dismiss(false));
        // Clicking the backdrop also cancels
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(false); });

        const autoTimer = setTimeout(() => dismiss(false), timeoutMs);
    });
}

// ============================================================
//  ERROR HELPERS
// ============================================================

function getUserFriendlyErrorMessage(error, fallback = 'An unexpected error occurred. Please try again.') {
    if (!error) return fallback;
    const message = error.message || String(error);

    if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('network'))
        return 'Network error. Please check your internet connection.';
    if (message.includes('timeout') || message.includes('Timeout'))
        return 'Request timed out. Please try again.';
    if (message.includes('database') || message.includes('relation') || message.includes('column') || message.includes('permission'))
        return 'Database error. Please contact support.';
    if (message.includes('Invalid login credentials'))
        return 'Invalid email or password.';
    if (message.includes('Email not confirmed'))
        return 'Please verify your email address before logging in.';
    if (message.includes('User already registered'))
        return 'An account with this email already exists.';

    const clean = message
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/TypeError|ReferenceError|SyntaxError|Error:/g, '')
        .trim();
    if (clean.length > 0 && clean.length < 100) return clean;
    return fallback;
}

// ============================================================
//  UNIVERSAL PERMANENT DELETE  (admin-only)
// ============================================================

async function permanentDeleteRecord(tableName, recordId, recordName = 'this record') {
    if (!currentProfile || currentProfile.role !== 'admin') {
        showNotification('Admin access required', 'error');
        return false;
    }

    const confirmed = await showConfirmationToast(
        `Permanently delete "${recordName}"? This cannot be undone.`
    );
    if (!confirmed) return false;

    try {
        const { error } = await supabaseClient
            .from(tableName)
            .delete()
            .eq('id', recordId);

        if (error) throw error;
        showNotification(`"${recordName}" has been permanently deleted.`, 'success');
        return true;
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Deletion failed. Please try again.'), 'error');
        return false;
    }
}

// ============================================================
//  SETTINGS / CURRENCY / DATE HELPERS
// ============================================================

async function fetchSettings() {
    const { data } = await supabaseClient.from('settings').select('*');
    const settings = {};
    data?.forEach(s => { settings[s.key] = s.value; });
    return settings;
}

function formatCurrency(amount, currency = 'KES') {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount || 0);
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-KE');
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

// ============================================================
//  IDLE SESSION TIMEOUT
// ============================================================

let idleTimer   = null;
let warningTimer = null;
const IDLE_TIMEOUT   = 15 * 60 * 1000;  // 15 minutes
const WARNING_BEFORE =  1 * 60 * 1000;  //  1 minute

function resetIdleTimer() {
    if (idleTimer)   clearTimeout(idleTimer);
    if (warningTimer) clearTimeout(warningTimer);
    idleTimer = setTimeout(() => showSessionWarning(), IDLE_TIMEOUT - WARNING_BEFORE);
}

function showSessionWarning() {
    showConfirmationToast('You will be logged out in 1 minute due to inactivity. Stay logged in?', 60000)
        .then(stay => {
            if (stay) resetIdleTimer();
            else      signOut();
        });
    warningTimer = setTimeout(() => signOut(), WARNING_BEFORE);
}

function initIdleTimer() {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(event => document.addEventListener(event, resetIdleTimer));
    resetIdleTimer();
}

// ============================================================
//  GLOBAL BRANDING (Logo)
// ============================================================

async function updateGlobalBranding() {
    try {
        const { data: logoSetting } = await supabaseClient
            .from('settings')
            .select('value')
            .eq('key', 'company_logo_url')
            .maybeSingle();

        const logoUrl = logoSetting?.value || null;

        document.querySelectorAll('.navbar-brand').forEach(el => {
            el.innerHTML = logoUrl
                ? `<img src="${logoUrl}" alt="Logo" style="height:35px;">`
                : `<i class="fas fa-cash-register me-2"></i>VendGrid`;
        });

        const sidebarLogo = document.querySelector('.sidebar-logo');
        if (sidebarLogo) {
            sidebarLogo.innerHTML = logoUrl
                ? `<img src="${logoUrl}" alt="Logo" style="height:32px;">`
                : `<i class="fas fa-cash-register me-1"></i>VendGrid`;
        }
    } catch (err) {
        console.warn('Failed to update branding:', err);
    }
}

window.updateGlobalBranding = updateGlobalBranding;
window.initIdleTimer        = initIdleTimer;