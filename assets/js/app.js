// Global utilities
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
 * Show a non-blocking confirmation toast with Confirm / Cancel actions.
 * Resolves true if the user clicks Confirm, false if they click Cancel or it times out.
 * @param {string} message - The confirmation prompt text.
 * @param {number} timeoutMs - Auto-dismiss timeout in ms (default 8000).
 * @returns {Promise<boolean>}
 */
function showConfirmationToast(message, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'vg-toast warning confirmation-toast';
        toast.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            <span>${message}</span>
            <div class="toast-actions">
                <button class="toast-btn toast-btn--confirm">Delete</button>
                <button class="toast-btn toast-btn--cancel">Cancel</button>
            </div>
        `;

        // Inject minimal inline styles so the buttons work without CSS changes.
        // If you already have .toast-actions / .toast-btn styles in your stylesheet,
        // remove the <style> block below and rely on those instead.
        if (!document.getElementById('confirmationToastStyles')) {
            const style = document.createElement('style');
            style.id = 'confirmationToastStyles';
            style.textContent = `
                .confirmation-toast { 
                    position: fixed;
    top: 70px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;

                }
                .toast-actions { display: flex; gap: 8px; margin-top: 4px; width: 100%; }
                .toast-btn {
                    padding: 4px 12px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.8rem;
                    font-weight: 600;
                }
                .toast-btn--confirm { background: #e53e3e; color: #fff; }
                .toast-btn--confirm:hover { background: #c53030; }
                .toast-btn--cancel  { background: rgba(255,255,255,0.2); color: inherit; }
                .toast-btn--cancel:hover  { background: rgba(255,255,255,0.35); }
            `;
            document.head.appendChild(style);
        }

        container.appendChild(toast);

        let settled = false;

        function dismiss(result) {
            if (settled) return;
            settled = true;
            clearTimeout(autoTimer);
            toast.style.animation = 'slideIn 0.35s ease reverse';
            setTimeout(() => toast.remove(), 250);
            resolve(result);
        }

        toast.querySelector('.toast-btn--confirm').addEventListener('click', () => dismiss(true));
        toast.querySelector('.toast-btn--cancel').addEventListener('click',  () => dismiss(false));

        // Auto-cancel after timeoutMs so the toast never hangs forever
        const autoTimer = setTimeout(() => dismiss(false), timeoutMs);
    });
}

/**
 * Convert technical errors into user-friendly messages.
 * @param {Error|string} error - The caught error object or message.
 * @param {string} fallback - Default message if no specific match.
 * @returns {string} Clean, human-readable error message.
 */
function getUserFriendlyErrorMessage(error, fallback = 'An unexpected error occurred. Please try again.') {
    if (!error) return fallback;
    const message = error.message || String(error);

    if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('network')) {
        return 'Network error. Please check your internet connection.';
    }
    if (message.includes('timeout') || message.includes('Timeout')) {
        return 'Request timed out. Please try again.';
    }
    if (message.includes('database') || message.includes('relation') || message.includes('column') || message.includes('permission')) {
        return 'Database error. Please contact support.';
    }
    if (message.includes('Invalid login credentials')) {
        return 'Invalid email or password.';
    }
    if (message.includes('Email not confirmed')) {
        return 'Please verify your email address before logging in.';
    }
    if (message.includes('User already registered')) {
        return 'An account with this email already exists.';
    }

    let clean = message.replace(/https?:\/\/[^\s]+/g, '')
                       .replace(/TypeError|ReferenceError|SyntaxError|Error:/g, '')
                       .trim();
    if (clean.length > 0 && clean.length < 100) return clean;
    return fallback;
}

/**
 * Universal permanent delete function (admin only)
 * @param {string} tableName - Supabase table name (e.g. 'profiles', 'products', 'sales')
 * @param {number|string} recordId - ID of the record to delete
 * @param {string} recordName - Optional human-readable name for confirmation message
 * @returns {Promise<boolean>} - True if deleted successfully, false otherwise
 */
async function permanentDeleteRecord(tableName, recordId, recordName = 'this record') {
    if (!currentProfile || currentProfile.role !== 'admin') {
        showNotification('Admin access required', 'error');
        return false;
    }

    // CHANGED: replaced blocking confirm() with a non-blocking confirmation toast
    const confirmed = await showConfirmationToast(
        `⚠️ Permanently delete "${recordName}"? This cannot be undone.`
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