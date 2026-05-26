// Supabase client and auth helpers
const SUPABASE_URL = 'https://zmhhtldkqnvgrbznjnii.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptaGh0bGRrcW52Z3Jiem5qbmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTIyMzEsImV4cCI6MjA5NDU4ODIzMX0.hq0owtahFysuxsZ5qG2ts-puf4c3vW5O4lnrGefMWcs';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser      = null;
let currentProfile   = null;
let currentCompany   = null;
let currentCompanyId = null;

// ── Cache helpers ─────────────────────────────────────────────────────────────

const PROFILE_CACHE_KEY = 'vg_profile_cache';
const COMPANY_CACHE_KEY = 'vg_company_cache';

function _saveProfileCache(profile) {
    try { sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)); } catch (e) {}
}
function _loadProfileCache() {
    try { const raw = sessionStorage.getItem(PROFILE_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function _clearProfileCache() {
    try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch (e) {}
}

function _saveCompanyCache(company) {
    try { sessionStorage.setItem(COMPANY_CACHE_KEY, JSON.stringify(company)); } catch (e) {}
}
function _loadCompanyCache() {
    try { const raw = sessionStorage.getItem(COMPANY_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function _clearCompanyCache() {
    try { sessionStorage.removeItem(COMPANY_CACHE_KEY); } catch (e) {}
}

// ── DB fetchers ───────────────────────────────────────────────────────────────

async function getCurrentProfile() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*, company:companies(*)')
        .eq('id', user.id)
        .single();
    return profile;
}

async function getCurrentCompany(companyId) {
    if (!companyId) return null;
    const { data: company } = await supabaseClient
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();
    return company;
}

// ── Core auth gate ────────────────────────────────────────────────────────────

async function requireAuth() {
    // getSession() reads the local JWT — no network round-trip.
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        globalThis.location.href = 'login.html';
        return false;
    }
    currentUser = session.user;

    // Try cache first — but ONLY if it has a role value.
    // A cached profile without a role silently breaks every hasPermission() call,
    // which was what was causing the admin to lose all permissions.
    const cached = _loadProfileCache();
    if (cached && cached.id === currentUser.id && cached.role) {
        currentProfile   = cached;
        currentCompanyId = currentProfile.company_id;

        // Company: try cache, fall back to fetch if needed
        const cachedCompany = _loadCompanyCache();
        if (cachedCompany && cachedCompany.id === currentCompanyId) {
            currentCompany = cachedCompany;
        } else if (currentCompanyId) {
            currentCompany = await getCurrentCompany(currentCompanyId);
            if (currentCompany) _saveCompanyCache(currentCompany);
        }

        // Lift the gate immediately using cached data — zero flicker
        _applyAndLiftGate();

        // Background refresh: keep cache current without blocking the page
        getCurrentProfile().then(fresh => {
            if (fresh && fresh.role) {
                _saveProfileCache(fresh);
                const roleChanged    = fresh.role       !== cached.role;
                const companyChanged = fresh.company_id !== cached.company_id;
                if (roleChanged || companyChanged) {
                    currentProfile   = fresh;
                    currentCompanyId = fresh.company_id;
                    if (typeof applySidebarAccess === 'function') applySidebarAccess();
                    getCurrentCompany(currentCompanyId).then(company => {
                        if (company) { currentCompany = company; _saveCompanyCache(company); }
                    });
                }
            }
        }).catch(() => {});

    } else {
        // No valid cache (first load after login, or cache had no role) — fetch fresh.
        _clearProfileCache();
        _clearCompanyCache();
        currentProfile = await getCurrentProfile();
        if (currentProfile && currentProfile.role) {
            _saveProfileCache(currentProfile);
            currentCompanyId = currentProfile.company_id;
            if (currentCompanyId) {
                currentCompany = await getCurrentCompany(currentCompanyId);
                if (currentCompany) _saveCompanyCache(currentCompany);
            }
        }
        _applyAndLiftGate();
    }

    if (typeof initIdleTimer === 'function') initIdleTimer();
    if (typeof updateGlobalBranding === 'function') await updateGlobalBranding();

    globalThis.getUserRole        = () => currentProfile?.role;
    globalThis.getCurrentCompany  = () => currentCompany;
    globalThis.getCurrentCompanyId = () => currentCompanyId;

    return true;
}

// Applies sidebar permission filtering and removes the CSS auth-loading gate
// in one synchronous step — so restricted items are never visible for even one frame.
function _applyAndLiftGate() {
    if (typeof applySidebarAccess === 'function') applySidebarAccess();
    document.body.classList.remove('auth-loading');
}

// ── Admin guard ───────────────────────────────────────────────────────────────

async function requireAdmin() {
    if (!await requireAuth()) return false;
    if (currentProfile?.role !== 'admin') {
        document.body.classList.remove('auth-loading');
        showNotification('Admin access required', 'error');
        setTimeout(() => globalThis.location.href = 'dashboard.html', 2000);
        return false;
    }
    return true;
}

// ── Sign in / out ─────────────────────────────────────────────────────────────

async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Clear stale cache so the fresh user's profile is fetched on the next page
    _clearProfileCache();
    _clearCompanyCache();
    return data;
}

async function signOut() {
    _clearProfileCache();
    _clearCompanyCache();
    await supabaseClient.auth.signOut();
    globalThis.location.href = 'login.html';
}

// ── Global exports ────────────────────────────────────────────────────────────

globalThis.getCurrentCompany   = () => currentCompany;
globalThis.getCurrentCompanyId = () => currentCompanyId;