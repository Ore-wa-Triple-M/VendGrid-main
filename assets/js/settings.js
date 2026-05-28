/**
 * settings.js – VendGrid Settings Page
 *
 * Company Settings:
 *   - Business Name, Email, Phone, Address → stored in companies table
 *   - Currency, VAT Rate → stored in companies table
 *   - Logo → stored in settings table
 * 
 * Personal Settings (theme) → localStorage only
 * 
 * All authenticated roles can VIEW this page.
 * Company settings editing requires admin role.
 */

'use strict';

let iti      = null;
let logoFile = null;

// Helper to get current company ID
function getSettingsCompanyId() {
    if (typeof getCurrentCompanyId === 'function') {
        const id = getCurrentCompanyId();
        if (id) return id;
    }
    if (currentProfile && currentProfile.company_id) {
        return currentProfile.company_id;
    }
    return null;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
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

  
    loadSettings();
});

// ── Load & display settings ───────────────────────────────────────────────────
async function loadSettings() {
    if (!await requireAuth()) return;

    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.innerText = currentProfile?.first_name || currentUser?.email || 'User';

    const companyId = getSettingsCompanyId();
    const isAdmin = hasPermission('canEditCompanySettings');

    // Lock company fields for non-admins
    _applyCompanyFieldLock(isAdmin);

    try {
        // Load company data from companies table (all fields)
        if (companyId) {
            const { data: company, error: companyError } = await supabaseClient
                .from('companies')
                .select('*')
                .eq('id', companyId)
                .single();

            if (!companyError && company) {
                const businessNameEl = document.getElementById('businessName');
                if (businessNameEl) businessNameEl.value = company.name || '';
                
                const businessEmailEl = document.getElementById('businessEmail');
                if (businessEmailEl) businessEmailEl.value = company.email || '';
                
                const businessPhoneEl = document.getElementById('businessPhone');
                if (businessPhoneEl && iti) {
                    iti.setNumber(company.phone || '');
                } else if (businessPhoneEl) {
                    businessPhoneEl.value = company.phone || '';
                }
                
                const businessAddressEl = document.getElementById('businessAddress');
                if (businessAddressEl) businessAddressEl.value = company.address || '';
                
                const currencyEl = document.getElementById('currency');
                if (currencyEl && company.currency) currencyEl.value = company.currency;
                
                const vatRateEl = document.getElementById('vatRate');
                if (vatRateEl && company.vat_rate) vatRateEl.value = company.vat_rate;
                
                // Display current company name in the lock note
                const companyNameDisplay = document.getElementById('currentCompanyName');
                if (companyNameDisplay) companyNameDisplay.innerText = company.name;
            }
        }

        // Load logo from settings table
        let settingsQuery = supabaseClient.from('settings').select('*');
        if (companyId) {
            settingsQuery = settingsQuery.eq('company_id', companyId);
        }
        
        const { data: settings, error } = await settingsQuery;

        if (error) throw error;

        const map = {};
        settings?.forEach(s => { map[s.key] = s.value; });

        const preview = document.getElementById('logoPreview');
        if (preview) {
            preview.innerHTML = map.company_logo_url
                ? `<img src="${map.company_logo_url}" style="max-width:100%; max-height:80px;">`
                : '';
        }

    } catch (err) {
        console.error('Load settings error:', err);
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to load settings'), 'error');
    }
}

// ── Disable / re-enable company fields based on role ─────────────────────────
function _applyCompanyFieldLock(isAdmin) {
    const companySection = document.getElementById('companySettingsSection');
    if (!companySection) return;

    const fields = companySection.querySelectorAll('input, textarea, select');
    const saveBtn = document.getElementById('saveCompanyBtn');
    const lockNote = document.getElementById('companyLockNote');

    if (isAdmin) {
        fields.forEach(f => { f.disabled = false; f.removeAttribute('title'); });
        if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('disabled'); }
        if (lockNote) lockNote.style.display = 'none';
    } else {
        fields.forEach(f => {
            f.disabled = true;
            f.title = 'Only admins can change company settings';
        });
        if (saveBtn) { saveBtn.disabled = true; }
        if (lockNote) lockNote.style.display = 'block';
    }
}

// ── Upload logo to Supabase Storage ──────────────────────────────────────────
async function uploadLogo() {
    if (!logoFile) return null;
    const ext = logoFile.name.split('.').pop();
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

// ── Save company settings (admin only) ───────────────────────────────────────
async function saveCompanySettings() {
    if (!hasPermission('canEditCompanySettings')) {
        showNotification('Only admins can change company settings.', 'error');
        return;
    }

    const companyId = getSettingsCompanyId();
    if (!companyId) {
        showNotification('Company not identified. Please refresh the page.', 'error');
        return;
    }

    const businessName = document.getElementById('businessName')?.value.trim();
    const businessEmail = document.getElementById('businessEmail')?.value.trim();
    const businessAddress = document.getElementById('businessAddress')?.value.trim() || null;
    const phone = iti ? iti.getNumber() : (document.getElementById('businessPhone')?.value || null);
    const currency = document.getElementById('currency')?.value || 'KES';
    const vatRate = parseFloat(document.getElementById('vatRate')?.value) || 16;

    // Update companies table with ALL fields
    const { error: companyError } = await supabaseClient
        .from('companies')
        .update({
            name: businessName,
            email: businessEmail,
            address: businessAddress,
            phone: phone,
            currency: currency,
            vat_rate: vatRate,
            updated_at: new Date().toISOString()
        })
        .eq('id', companyId);

    if (companyError) {
        console.error('Company update error:', companyError);
        showNotification(getUserFriendlyErrorMessage(companyError, 'Failed to update company info'), 'error');
        return;
    }

    // Update logo in settings table
    if (logoFile) {
        const logoUrl = await uploadLogo();
        if (logoUrl) {
            const { error: logoError } = await supabaseClient
                .from('settings')
                .upsert({
                    key: 'company_logo_url',
                    value: logoUrl,
                    company_id: companyId,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key,company_id' });
            
            if (logoError) {
                console.error('Logo save error:', logoError);
            }
            logoFile = null;
        }
    }

    // Refresh company cache
    if (typeof getCurrentCompany === 'function') {
        const { data: freshCompany } = await supabaseClient
            .from('companies')
            .select('*')
            .eq('id', companyId)
            .single();
        if (freshCompany && typeof _saveCompanyCache === 'function') {
            _saveCompanyCache(freshCompany);
        }
    }

    showNotification('Company settings saved.', 'success');
    if (typeof updateGlobalBranding === 'function') await updateGlobalBranding();
}

// ── Save personal / account settings (all roles) ─────────────────────────────
async function savePersonalSettings() {
    if (!hasPermission('canEditPersonalSettings')) {
        showNotification('You do not have permission to save settings.', 'error');
        return;
    }

    showNotification('Personal settings saved.', 'success');
}

// Keep backwards-compatible alias
async function saveSettings() {
    await saveCompanySettings();
}

globalThis.saveSettings         = saveSettings;
globalThis.saveCompanySettings  = saveCompanySettings;
globalThis.savePersonalSettings = savePersonalSettings;
globalThis.loadSettings         = loadSettings;