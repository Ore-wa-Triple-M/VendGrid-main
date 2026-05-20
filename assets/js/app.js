/**
 * app.js – VendGrid Global Utilities
 *
 * Phase 3 additions: email/SMS receipt helpers.
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
//  ERROR HELPERS
// ============================================================

function getUserFriendlyErrorMessage(error, fallback = 'An unexpected error occurred. Please try again.') {
    if (!error) return fallback;
    const message = error.message || String(error);

    // Network errors
    if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('network'))
        return 'Network error. Please check your internet connection.';
    if (message.includes('timeout') || message.includes('Timeout'))
        return 'Request timed out. Please try again.';

    // Auth errors
    if (message.includes('Invalid login credentials'))
        return 'Invalid email or password.';
    if (message.includes('Email not confirmed'))
        return 'Please verify your email address before logging in.';
    if (message.includes('User already registered'))
        return 'An account with this email already exists.';

    // Custom application errors — pass through as-is so descriptive messages
    // like "Sale not found or you do not have permission to void it" reach the user.
    if (message.includes('No matching record found') || message.includes('not found or you do not have permission'))
        return message;

    // True Supabase / PostgREST DB errors — surface the code and hint if available
    // so developers can diagnose schema / RLS issues without digging in the console.
    // NOTE: we check error.code (Supabase sets this) rather than scanning message text
    // so we no longer accidentally swallow custom error messages that contain the word "permission".
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

    // Fallback: pass through short messages, use fallback for long/technical ones
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
        // Use .select('id') so Supabase returns the rows that were actually deleted.
        // {count:'exact'} returns null when RLS silently blocks the operation without
        // throwing an error, making count === 0 check unreliable.
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
//  EMAIL & SMS RECEIPTS (placeholder webhooks)
// ============================================================

async function sendReceiptEmail(email, receiptHtml, transactionNumber) {
    const { data: settings } = await supabaseClient
        .from('settings')
        .select('value')
        .eq('key', 'email_webhook_url')
        .maybeSingle();
    const webhookUrl = settings?.value || null;

    if (!webhookUrl) {
        showNotification('Email service not configured. Please contact administrator.', 'warning');
        return false;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: email,
                subject: `Receipt from VendGrid - ${transactionNumber}`,
                html: receiptHtml
            })
        });
        if (response.ok) {
            showNotification(`Receipt sent to ${email}`, 'success');
            return true;
        } else {
            throw new Error('Server responded with error');
        }
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to send email receipt'), 'error');
        return false;
    }
}

async function sendReceiptSMS(phone, shortSummary) {
    const { data: settings } = await supabaseClient
        .from('settings')
        .select('value')
        .eq('key', 'sms_webhook_url')
        .maybeSingle();
    const webhookUrl = settings?.value || null;

    if (!webhookUrl) {
        showNotification('SMS service not configured. Please contact administrator.', 'warning');
        return false;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: phone, message: shortSummary })
        });
        if (response.ok) {
            showNotification(`SMS sent to ${phone}`, 'success');
            return true;
        } else {
            throw new Error('Server responded with error');
        }
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to send SMS receipt'), 'error');
        return false;
    }
}

// ============================================================
//  PAYMENT HELPERS (Phase 4)
// ============================================================

/**
 * Check payment status for a pending sale (used by POS polling).
 */
async function checkPaymentStatus(saleId) {
    const { data, error } = await supabaseClient
        .from('sales')
        .select('payment_status, payment_reference')
        .eq('id', saleId)
        .single();
    if (error) throw error;
    return data;
}

/**
 * Initiate M-Pesa STK push (called from POS).
 */
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