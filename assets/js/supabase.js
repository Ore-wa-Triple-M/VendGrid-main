// Supabase client and auth helpers
const SUPABASE_URL = 'https://zmhhtldkqnvgrbznjnii.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptaGh0bGRrcW52Z3Jiem5qbmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTIyMzEsImV4cCI6MjA5NDU4ODIzMX0.hq0owtahFysuxsZ5qG2ts-puf4c3vW5O4lnrGefMWcs';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;

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

async function requireAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        globalThis.location.href = 'login.html';
        return false;
    }
    currentUser = session.user;
    currentProfile = await getCurrentProfile();
    
    // Initialize idle timer after successful login
    if (typeof initIdleTimer === 'function') {
        initIdleTimer();
    }
    // Apply global branding (logo)
    if (typeof updateGlobalBranding === 'function') {
        await updateGlobalBranding();
    }
    // Expose role globally for permissions
    globalThis.getUserRole = () => currentProfile?.role;
    
    return true;
}

async function requireAdmin() {
    if (!await requireAuth()) return false;
    if (currentProfile?.role !== 'admin') {
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
    await supabaseClient.auth.signOut();
    globalThis.location.href = 'login.html';
}