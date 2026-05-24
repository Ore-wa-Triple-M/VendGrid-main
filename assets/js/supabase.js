// Supabase client and auth helpers
const SUPABASE_URL = 'https://zmhhtldkqnvgrbznjnii.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptaGh0bGRrcW52Z3Jiem5qbmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTIyMzEsImV4cCI6MjA5NDU4ODIzMX0.hq0owtahFysuxsZ5qG2ts-puf4c3vW5O4lnrGefMWcs';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser    = null;
let currentProfile = null;

// ── Profile cache ─────────────────────────────────────────────────────────────
// Stores the profile in sessionStorage so page-to-page navigation can apply
// sidebar permissions instantly from cache instead of waiting for two network
// round-trips on every navigation. The cache is invalidated on signOut and
// refreshed silently in the background after each page load.

const PROFILE_CACHE_KEY = 'vg_profile_cache';

function _saveProfileCache(profile) {
    try {
        sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } catch (e) {}
}

function _loadProfileCache() {
    try {
        const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function _clearProfileCache() {
    try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch (e) {}
}

// ── Fetch fresh profile from DB ───────────────────────────────────────────────
async function getCurrentProfile() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    return profile;
}

// ── Core auth gate ────────────────────────────────────────────────────────────
async function requireAuth() {
    // Step 1: getSession() is a local JWT read — fast, no network call.
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        globalThis.location.href = 'login.html';
        return false;
    }
    currentUser = session.user;

    // Step 2: Try the profile cache first.
    // If we have a cached profile for this user, use it immediately to apply
    // sidebar access and lift the gate — zero network wait, zero flicker.
    const cached = _loadProfileCache();
    if (cached && cached.id === currentUser.id) {
        currentProfile = cached;
        _applyAndLiftGate();

        // Refresh the cache silently in the background so role changes propagate
        // on the next navigation without blocking the current page render.
        getCurrentProfile().then(fresh => {
            if (fresh) {
                _saveProfileCache(fresh);
                // If the role changed, reapply sidebar access for the current page.
                if (fresh.role !== cached.role) {
                    currentProfile = fresh;
                    if (typeof applySidebarAccess === 'function') applySidebarAccess();
                }
            }
        }).catch(() => {});
    } else {
        // No cache (first page after login, or different user) — fetch and wait.
        currentProfile = await getCurrentProfile();
        if (currentProfile) _saveProfileCache(currentProfile);
        _applyAndLiftGate();
    }

    // Initialize idle timer
    if (typeof initIdleTimer === 'function') initIdleTimer();
    // Apply global branding (logo)
    if (typeof updateGlobalBranding === 'function') await updateGlobalBranding();
    // Expose role globally for permissions
    globalThis.getUserRole = () => currentProfile?.role;

    return true;
}

// Apply sidebar permissions and remove the CSS auth-loading gate in one shot.
function _applyAndLiftGate() {
    if (typeof applySidebarAccess === 'function') applySidebarAccess();
    document.body.classList.remove('auth-loading');
}

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

async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

async function signOut() {
    _clearProfileCache();
    await supabaseClient.auth.signOut();
    globalThis.location.href = 'login.html';
}