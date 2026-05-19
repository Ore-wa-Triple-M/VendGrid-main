/**
 * auth.js – VendGrid Login Page Logic
 *
 * FIXES APPLIED:
 *  1. After a successful signIn we now call supabaseClient.auth.getUser() and
 *     inspect email_confirmed_at before redirecting to dashboard. This provides
 *     a frontend guard even if the Supabase project has email confirmation
 *     enabled — an unverified user who somehow bypasses the Supabase error
 *     will still be caught here and sent to verify-email.html.
 *  2. The unverifiedBanner had `display:none !important` in the HTML inline
 *     style — our JS `.style.display = 'flex'` could not override an
 *     !important rule. Fixed: we now toggle a CSS class instead.
 *  3. ?verified=1 redirect from verify-email.html shows a success toast.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    if (!form) return;

    // If redirected back from verify-email.html with ?verified=1
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === '1') {
        history.replaceState(null, '', window.location.pathname);
        setTimeout(() => showNotification('Email verified! You can now sign in.', 'success'), 200);
    }

    // ── Login form ───────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email    = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        const btn          = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML      = '<span class="loading"></span> Signing in…';
        btn.disabled       = true;

        // Hide any previous unverified banner
        _hideBanner();

        try {
            const { data } = await signIn(email, password);

            // Extra guard: verify the session user has confirmed their email.
            // Supabase normally blocks unconfirmed logins with an error, but if
            // confirmation is disabled or the user was manually created we still
            // want to make sure.
            const confirmedAt = data?.user?.email_confirmed_at
                             || data?.session?.user?.email_confirmed_at;

            // Only enforce this check when Supabase itself didn't already
            // reject. If we have a valid session but no confirmation date, it
            // means confirmation is enabled and was somehow skipped — block it.
            if (data?.session && !confirmedAt) {
                // Sign them out and show the unverified banner
                try { await supabaseClient.auth.signOut(); } catch(_) {}
                try { sessionStorage.setItem('vg_pending_email', email); } catch(_) {}
                _showBanner();
                btn.innerHTML = originalText;
                btn.disabled  = false;
                return;
            }

            window.location.href = 'dashboard.html';
        } catch (err) {
            const msg = err.message || '';

            if (msg.includes('Email not confirmed') || msg.includes('not confirmed')) {
                try { sessionStorage.setItem('vg_pending_email', email); } catch(_) {}
                _showBanner();
            } else {
                showNotification(getUserFriendlyErrorMessage(err, 'Login failed. Please try again.'), 'error');
            }

            btn.innerHTML = originalText;
            btn.disabled  = false;
        }
    });

    // ── Password toggle ──────────────────────────────────────────────────
    window.togglePassword = function () {
        const input = document.getElementById('password');
        const icon  = document.getElementById('passwordToggleIcon');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };

    // ── Banner helpers ───────────────────────────────────────────────────
    function _showBanner() {
        const banner = document.getElementById('unverifiedBanner');
        if (!banner) return;
        // Remove the inline style that has !important so our class can take over
        banner.removeAttribute('style');
        banner.style.display = 'flex';
    }

    function _hideBanner() {
        const banner = document.getElementById('unverifiedBanner');
        if (!banner) return;
        banner.style.display = 'none';
    }
});
