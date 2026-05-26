/**
 * app.js – VendGrid Global Utilities
 *
 * Phase 3 additions: email/SMS receipt helpers (FIXED to use Supabase Edge Function)
 * Phase 4 additions: M-Pesa payment helpers.
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
 */
function showConfirmationToast(message, timeoutMs = 8000, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'vg-confirm-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'vg-confirm-dialog';
        dialog.innerHTML = `
            <div class="vg-confirm-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <p class="vg-confirm-message">${escapeHtml(message)}</p>
            <div class="vg-confirm-actions">
                <button class="vg-confirm-btn vg-confirm-btn--cancel">Cancel</button>
                <button class="vg-confirm-btn vg-confirm-btn--confirm">${escapeHtml(confirmLabel)}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

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
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(false); });

        const autoTimer = setTimeout(() => dismiss(false), timeoutMs);
    });
}

// ============================================================
//  MOBILE SIDEBAR FUNCTIONS
// ============================================================

/**
 * Open mobile sidebar drawer
 */
function openMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) {
        sidebar.classList.add('mobile-open');
        document.body.style.overflow = 'hidden';
    }
    if (overlay) {
        overlay.classList.add('active');
    }
}

/**
 * Close mobile sidebar drawer
 */
function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) {
        sidebar.classList.remove('mobile-open');
        document.body.style.overflow = '';
    }
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/**
 * Toggle mobile sidebar drawer
 */
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
        closeMobileSidebar();
    } else {
        openMobileSidebar();
    }
}

// Close sidebar when clicking on a sidebar link (mobile only)
function bindMobileSidebarLinks() {
    const sidebarLinks = document.querySelectorAll('.sidebar .sidebar-item');
    sidebarLinks.forEach(link => {
        link.removeEventListener('click', closeMobileSidebar);
        link.addEventListener('click', closeMobileSidebar);
    });
}

// Expose mobile sidebar functions globally
globalThis.openMobileSidebar = openMobileSidebar;
globalThis.closeMobileSidebar = closeMobileSidebar;
globalThis.toggleMobileSidebar = toggleMobileSidebar;

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

    if (message.includes('Invalid login credentials'))
        return 'Invalid email or password.';
    if (message.includes('Email not confirmed'))
        return 'Please verify your email address before logging in.';
    if (message.includes('User already registered'))
        return 'An account with this email already exists.';

    if (message.includes('No matching record found') || message.includes('not found or you do not have permission'))
        return message;

    const code = error.code || '';
    if (code === 'PGRST301' || code === '42501')
        return `Permission denied. Check Row Level Security policies. (code: ${code})`;
    if (code === '42P01')
        return `Table not found in database. Please contact support. (code: ${code})`;
    if (code === '42703')
        return `Schema mismatch – unknown column. Please contact support. (code: ${code})`;
    if (code === '23503')
        return `Cannot delete: this record is referenced by other data. (code: ${code})`;
    if (code === '23505')
        return `A record with this value already exists. (code: ${code})`;
    if (code && code.startsWith('PG') || code.startsWith('22') || code.startsWith('23') || code.startsWith('42'))
        return `Database error (${code}): ${error.hint || error.details || message}`.slice(0, 120);

    const clean = message
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/TypeError|ReferenceError|SyntaxError|Error:/g, '')
        .trim();
    if (clean.length > 0 && clean.length < 150) return clean;
    return fallback;
}

// ============================================================
//  UNIVERSAL PERMANENT DELETE
// ============================================================

async function permanentDeleteRecord(tableName, recordId, recordName = 'this record') {
    const confirmed = await showConfirmationToast(
        `Permanently delete "${recordName}"? This cannot be undone.`,
        8000,
        'Delete'
    );
    if (!confirmed) return false;

    try {
        const { data: deletedRows, error } = await supabaseClient
            .from(tableName)
            .delete()
            .eq('id', recordId)
            .select('id');

        if (error) throw error;
        if (!deletedRows || deletedRows.length === 0)
            throw new Error('No matching record found or permission denied');

        showNotification(`"${recordName}" has been permanently deleted.`, 'success');
        return true;
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Deletion failed. Please try again.'), 'error');
        return false;
    }
}

// ============================================================
//  SETTINGS / CURRENCY / DATE HELPERS (with company isolation)
// ============================================================

/**
 * Fetch settings for the current company
 * FIXED: Added company_id filter for multi-tenant isolation
 */
async function fetchSettings() {
    // Get current company ID
    let companyId = null;
    if (typeof getCurrentCompanyId === 'function') {
        companyId = getCurrentCompanyId();
    } else if (currentProfile && currentProfile.company_id) {
        companyId = currentProfile.company_id;
    }
    
    let query = supabaseClient.from('settings').select('*');
    
    // Apply company filter if available
    if (companyId) {
        query = query.eq('company_id', companyId);
    }
    
    const { data } = await query;
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
const IDLE_TIMEOUT   = 15 * 60 * 1000;
const WARNING_BEFORE =  1 * 60 * 1000;

function resetIdleTimer() {
    if (idleTimer)   clearTimeout(idleTimer);
    if (warningTimer) clearTimeout(warningTimer);
    idleTimer = setTimeout(() => showSessionWarning(), IDLE_TIMEOUT - WARNING_BEFORE);
}

function showSessionWarning() {
    showConfirmationToast('You will be logged out in 1 minute due to inactivity. Stay logged in?', 60000, 'Stay')
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

// ============================================================
//  EMAIL & SMS RECEIPTS (FIXED – uses Supabase Edge Function)
// ============================================================

/**
 * Send email receipt using Supabase Edge Function (reuses your SMTP settings)
 */
async function sendReceiptEmail(email, receiptHtml, transactionNumber) {
    if (!email || !receiptHtml) {
        showNotification('Missing email address or receipt content.', 'warning');
        return false;
    }

    try {
        const { data, error } = await supabaseClient.functions.invoke('send-email-receipt', {
            body: {
                to: email,
                subject: `Receipt from VendGrid - ${transactionNumber}`,
                html: receiptHtml,
                transactionNumber: transactionNumber
            }
        });

        if (error) throw error;
        
        if (data && data.success) {
            showNotification(`Receipt sent to ${email}`, 'success');
            return true;
        } else {
            throw new Error(data?.error || 'Failed to send email');
        }
    } catch (err) {
        console.error('Send email error:', err);
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to send email receipt. Please try again.'), 'error');
        return false;
    }
}

/**
 * Send SMS receipt using Supabase Edge Function
 */
async function sendReceiptSMS(phone, shortSummary) {
    if (!phone || !shortSummary) {
        showNotification('Missing phone number or message content.', 'warning');
        return false;
    }

    try {
        const { data, error } = await supabaseClient.functions.invoke('send-sms-receipt', {
            body: {
                to: phone,
                message: shortSummary
            }
        });

        if (error) throw error;
        
        if (data && data.success) {
            showNotification(`SMS sent to ${phone}`, 'success');
            return true;
        } else {
            throw new Error(data?.error || 'Failed to send SMS');
        }
    } catch (err) {
        console.error('Send SMS error:', err);
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to send SMS receipt. Please try again.'), 'error');
        return false;
    }
}

// ============================================================
//  PAYMENT HELPERS (Phase 4)
// ============================================================

async function checkPaymentStatus(saleId) {
    const { data, error } = await supabaseClient
        .from('sales')
        .select('payment_status, payment_reference')
        .eq('id', saleId)
        .single();
    if (error) throw error;
    return data;
}

async function initiateMpesaPayment(saleId, phoneNumber, amount, transactionNumber) {
    const { data, error } = await supabaseClient.functions.invoke('initiate-mpesa-payment', {
        body: { sale_id: saleId, phone_number: phoneNumber, amount, transaction_number: transactionNumber }
    });
    if (error) throw error;
    return data;
}

// Expose all global functions
globalThis.sendReceiptEmail = sendReceiptEmail;
globalThis.sendReceiptSMS = sendReceiptSMS;
globalThis.checkPaymentStatus = checkPaymentStatus;
globalThis.initiateMpesaPayment = initiateMpesaPayment;
globalThis.updateGlobalBranding = updateGlobalBranding;
globalThis.initIdleTimer        = initIdleTimer;
globalThis.permanentDeleteRecord = permanentDeleteRecord;