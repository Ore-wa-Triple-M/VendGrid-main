/**
 * settings.js – VendGrid Settings Page (admin only)
 *
 * FIX 1: Had TWO DOMContentLoaded listeners (window.addEventListener at line 5
 *        AND document.addEventListener at line 112). The first one ran sync
 *        UI setup; the second called loadSettings() + applySidebarAccess().
 *        This caused duplicate bindings and an early applySidebarAccess() call
 *        before requireAdmin() had resolved.
 *
 * FIX:   Merged into a single DOMContentLoaded handler. UI setup (phone field,
 *        logo preview) runs synchronously; loadSettings() is called once and
 *        owns the requireAdmin() call which then calls applySidebarAccess()
 *        after the profile is loaded.
 *
 * FIX 2: loadSettings() had a dead statement: `document.getElementById('userName');`
 *        with no assignment or usage. Replaced with the actual userName update.
 *
 * FIX 3: saveSettings() read phone number directly from the input value instead
 *        of using the intl-tel-input instance, so the country code was lost.
 *        Now reads from iti.getNumber() when available.
 */

'use strict';

let iti      = null;
let logoFile = null;

// ── Single DOMContentLoaded handler ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // Phone input (intl-tel-input)
    const phoneEl = document.getElementById('businessPhone');
    if (phoneEl && globalThis.intlTelInput) {
        iti = globalThis.intlTelInput(phoneEl, {
            utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.10/build/js/utils.js',
            initialCountry: 'KE',
            geoIpLookup: cb => {
                fetch('https://ipapi.co/json')
                    .then(r => r.json())
                    .then(d => cb(d.country_code))
                    .catch(() => cb('KE'));
            }
        });
    }

    // Logo file preview
    const logoInput = document.getElementById('companyLogo');
    if (logoInput) {
        logoInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
                logoFile = file;
                const reader = new FileReader();
                reader.onload = ev => {
                    const preview = document.getElementById('logoPreview');
                    if (preview) {
                        preview.innerHTML = `<img src="${ev.target.result}" style="max-width:100%; max-height:80px;">`;
                    }
                };
                reader.readAsDataURL(file);
            } else {
                logoFile = null;
                const preview = document.getElementById('logoPreview');
                if (preview) preview.innerHTML = '';
            }
        });
    }

    // Boot: requireAdmin sets currentProfile, then we apply sidebar access
    loadSettings();
});

// ── Load & display settings ───────────────────────────────────────────────────
async function loadSettings() {
    if (!await requireAdmin()) return;

    // Update userName display (was a dead statement before)
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.innerText = currentProfile?.first_name || currentUser?.email || 'User';

    // Apply sidebar AFTER profile is guaranteed loaded
    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }

    try {
        const { data: settings, error } = await supabaseClient
            .from('settings')
            .select('*');

        if (error) throw error;

        const map = {};
        settings?.forEach(s => { map[s.key] = s.value; });

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };

        setVal('businessName',    map.business_name    || '');
        setVal('businessEmail',   map.business_email   || '');
        setVal('businessAddress', map.business_address || '');
        setVal('currency',        map.currency         || 'KES');
        setVal('vatRate',         map.vat_rate         || '16');

        // Phone — set via iti instance if available, else plain value
        const phone = map.business_phone || '';
        if (iti) {
            iti.setNumber(phone);
        } else {
            const phoneEl = document.getElementById('businessPhone');
            if (phoneEl) phoneEl.value = phone;
        }

        // Logo preview
        const preview = document.getElementById('logoPreview');
        if (preview) {
            preview.innerHTML = map.company_logo_url
                ? `<img src="${map.company_logo_url}" style="max-width:100%; max-height:80px;">`
                : '';
        }

    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to load settings'), 'error');
    }
}

// ── Upload logo to Supabase Storage ──────────────────────────────────────────
async function uploadLogo() {
    if (!logoFile) return null;
    const ext      = logoFile.name.split('.').pop();
    const fileName = `logo_${Date.now()}.${ext}`;

    const { error } = await supabaseClient.storage
        .from('company-assets')
        .upload(fileName, logoFile, { upsert: true });

    if (error) {
        showNotification('Logo upload failed: ' + error.message, 'error');
        return null;
    }

    const { data: { publicUrl } } = supabaseClient.storage
        .from('company-assets')
        .getPublicUrl(fileName);

    return publicUrl;
}

// ── Save settings ─────────────────────────────────────────────────────────────
async function saveSettings() {
    if (!hasPermission('canEditSettings')) {
        showNotification('Admin access required.', 'error');
        return;
    }

    // Read phone: prefer iti.getNumber() so country code is included
    const phone = iti
        ? iti.getNumber()
        : (document.getElementById('businessPhone')?.value || '');

    const settings = [
        { key: 'business_name',    value: document.getElementById('businessName')?.value    || '' },
        { key: 'business_email',   value: document.getElementById('businessEmail')?.value   || '' },
        { key: 'business_address', value: document.getElementById('businessAddress')?.value || '' },
        { key: 'business_phone',   value: phone },
        { key: 'currency',         value: document.getElementById('currency')?.value        || 'KES' },
        { key: 'vat_rate',         value: document.getElementById('vatRate')?.value         || '16'  }
    ];

    // Upload logo if a new file was selected
    if (logoFile) {
        const logoUrl = await uploadLogo();
        if (logoUrl) {
            settings.push({ key: 'company_logo_url', value: logoUrl });
            logoFile = null; // reset after successful upload
        }
    }

    try {
        for (const s of settings) {
            const { error } = await supabaseClient
                .from('settings')
                .upsert(s, { onConflict: 'key' });
            if (error) throw error;
        }

        showNotification('Settings saved successfully', 'success');

        if (typeof updateGlobalBranding === 'function') {
            await updateGlobalBranding();
        }
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to save settings'), 'error');
    }
}


  // Theme toggle buttons logic
        document.getElementById('lightModeBtn')?.addEventListener('click', () => globalThis.themeManager.setTheme('light'));
        document.getElementById('darkModeBtn')?.addEventListener('click', () => globalThis.themeManager.setTheme('dark'));
        // Update button active state when theme changes
        globalThis.addEventListener('themeChanged', (e) => {
            const isDark = e.detail.theme === 'dark';
            document.getElementById('lightModeBtn')?.classList.toggle('active', !isDark);
            document.getElementById('darkModeBtn')?.classList.toggle('active', isDark);
        });
        // Initial active state
        if (globalThis.themeManager) {
            const isDark = globalThis.themeManager.getCurrent() === 'dark';
            document.getElementById('lightModeBtn')?.classList.toggle('active', !isDark);
            document.getElementById('darkModeBtn')?.classList.toggle('active', isDark);
        }

globalThis.saveSettings  = saveSettings;
globalThis.loadSettings  = loadSettings;