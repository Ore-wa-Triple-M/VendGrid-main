/**
 * signup.js – VendGrid Signup Flow
 *
 * FIXES APPLIED:
 *  1. emailRedirectTo URL built from window.location.origin + basePath so it
 *     works on any subdirectory or custom domain without path mangling.
 *  2. After signUp, inspect user.email_confirmed_at – when Supabase has email
 *     confirmation DISABLED the user is auto-confirmed; we detect this and
 *     redirect to login instead of stranding the user on verify-email.html.
 *  3. Client-side email format validation before the API call.
 *  4. Clear error messages for already-registered emails.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('signupForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const firstName = document.getElementById('firstName').value.trim();
        const lastName  = document.getElementById('lastName').value.trim();
        const email     = document.getElementById('email').value.trim().toLowerCase();
        const password  = document.getElementById('password').value;
        const role      = document.getElementById('role').value;

        // ── Client-side validation ────────────────────────────────────────
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showNotification('Please enter a valid email address.', 'error');
            return;
        }
        if (password.length < 8) {
            showNotification('Password must be at least 8 characters.', 'error');
            return;
        }
        if (!firstName || !lastName) {
            showNotification('Please enter your first and last name.', 'error');
            return;
        }

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="loading"></span> Creating account…';
        btn.disabled  = true;

        try {
            // Build stable redirect URL from origin + current directory path
            const origin    = window.location.origin;
            const basePath  = window.location.pathname.replace(/\/[^/]*$/, '/');
            const verifyUrl = origin + basePath + 'verify-email.html';

            const { data: authData, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: verifyUrl,
                    data: {
                        first_name: firstName,
                        last_name:  lastName,
                        role:       role
                    }
                }
            });

            if (signUpError) throw signUpError;

            if (!authData || !authData.user) {
                throw new Error('Signup did not return a user. Please try again.');
            }

            const user = authData.user;

            // ── Upsert profile row (safety net if DB trigger is missing) ──
            const { error: profileError } = await supabaseClient
                .from('profiles')
                .upsert({
                    id:         user.id,
                    email:      email,
                    first_name: firstName,
                    last_name:  lastName,
                    role:       role,
                    is_active:  true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });

            if (profileError) {
                console.warn('Profile upsert warning (non-fatal):', profileError.message);
            }

            // Store email so verify-email.html can display it / offer resend.
            try { sessionStorage.setItem('vg_pending_email', email); } catch(_) {}

            // ── Route based on confirmation state ─────────────────────────
            // If email_confirmed_at is already set, the Supabase project has
            // "Enable email confirmations" turned OFF — user is auto-confirmed.
            // Skip the verify page and go straight to login.
            if (user.email_confirmed_at) {
                try { await supabaseClient.auth.signOut(); } catch(_) {}
                showNotification('Account created! Please sign in.', 'success');
                setTimeout(() => { window.location.href = 'login.html'; }, 1200);
            } else {
                // Confirmation is enabled — show the "check your inbox" page.
                window.location.href = 'verify-email.html';
            }

        } catch (err) {
            let msg = err.message || 'Unknown error';
            if (/already registered|already been registered|User already registered/i.test(msg)) {
                msg = 'An account with this email already exists.';
            } else if (/invalid.*email|email.*invalid/i.test(msg)) {
                msg = 'Please enter a valid email address.';
            } else {
                msg = 'Signup failed: ' + msg;
            }
            showNotification(msg, 'error');
            btn.innerHTML = originalText;
            btn.disabled  = false;
        }
    });
});

function togglePassword() {
    const input = document.getElementById('password');
    const icon  = document.getElementById('passwordToggleIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}
window.togglePassword = togglePassword;
