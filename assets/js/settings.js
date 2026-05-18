// Settings page (admin only)
let iti = null;

window.addEventListener('DOMContentLoaded', () => {
    const phoneEl = document.getElementById('businessPhone');
    if (phoneEl && window.intlTelInput) {
        iti = window.intlTelInput(phoneEl, {
            utilsScript: "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.10/build/js/utils.js",
            initialCountry: "KE",
            geoIpLookup: callback => {
                fetch("https://ipapi.co/json")
                    .then(res => res.json())
                    .then(data => callback(data.country_code))
                    .catch(() => callback("KE"));
            }
        });
    }
});

async function loadSettings() {
    if (!await requireAdmin()) return;
    document.getElementById('userName');
    const { data: settings } = await supabaseClient.from('settings').select('*');
    const map = {};
    settings?.forEach(s => { map[s.key] = s.value; });
    document.getElementById('businessName').value = map.business_name || '';
    document.getElementById('businessEmail').value = map.business_email || '';
    document.getElementById('businessAddress').value = map.business_address || '';
    document.getElementById('businessPhone').value = map.business_phone || '';
    document.getElementById('currency').value = map.currency || 'KES';
    document.getElementById('vatRate').value = map.vat_rate || '16';
}

async function saveSettings() {
    const settings = [
        { key: 'business_name', value: document.getElementById('businessName').value },
        { key: 'business_email', value: document.getElementById('businessEmail').value },
        { key: 'business_address', value: document.getElementById('businessAddress').value },
        { key: 'business_phone', value: document.getElementById('businessPhone').value },
        { key: 'currency', value: document.getElementById('currency').value },
        { key: 'vat_rate', value: document.getElementById('vatRate').value }
    ];
    for (const s of settings) {
        await supabaseClient.from('settings').upsert(s, { onConflict: 'key' });
    }
    showNotification('Settings saved');
}

document.addEventListener('DOMContentLoaded', loadSettings);