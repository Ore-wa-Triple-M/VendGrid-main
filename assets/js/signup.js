/**
 * signup.js – VendGrid Signup Flow (FIXED)
 * 
 * Fix: Handles Supabase's behavior when email confirmation is enabled
 * (user object may be null but account is created)
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('signupForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();
        const email = document.getElementById('email').value.trim().toLowerCase();
        const password = document.getElementById('password').value;
        const role = document.getElementById('role').value;

        // Validation
        if (!firstName || !lastName) {
            showNotification('Please enter your full name.', 'error');
            return;
        }

        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
            showNotification('Please enter a valid email address.', 'error');
            return;
        }

        if (password.length < 8) {
            showNotification('Password must be at least 8 characters long.', 'error');
            return;
        }

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="loading"></span> Creating account...';
        btn.disabled = true;

        try {
            const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
            const verifyUrl = baseUrl + 'verify-email.html';

            const { data: authData, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: verifyUrl,
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        role: role
                    }
                }
            });

            if (signUpError) {
                // Handle specific errors
                if (signUpError.status === 429 || signUpError.message?.includes('rate limit')) {
                    throw new Error('TOO_MANY_ATTEMPTS');
                }
                if (signUpError.message?.includes('already registered')) {
                    throw new Error('EMAIL_EXISTS');
                }
                throw signUpError;
            }

            // IMPORTANT: With email confirmation ENABLED, authData.user may be null
            // but the account is still created! Check if we have ANY success indicator.
            const hasUser = !!authData?.user;
            const hasSession = !!authData?.session;
            const emailSent = !signUpError; // If no error, Supabase attempted to send email

            if (!hasUser && !hasSession) {
                // No user and no session – but email confirmation might still be pending
                // This is NORMAL when email confirmation is enabled.
                // We should NOT throw an error here.
                console.log('Email confirmation enabled – user created, awaiting verification');
            }

            // Try to create/update profile (if we have user ID)
            if (authData?.user?.id) {
                const { error: profileError } = await supabaseClient
                    .from('profiles')
                    .upsert({
                        id: authData.user.id,
                        email: email,
                        first_name: firstName,
                        last_name: lastName,
                        role: role,
                        is_active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'id' });

                if (profileError) {
                    console.warn('Profile upsert warning (non-fatal):', profileError.message);
                }
            }

            // Store email for verification page
            try { sessionStorage.setItem('vg_pending_email', email); } catch(e) {}

            // Check if user is already confirmed (email confirmation disabled)
            if (authData?.user?.email_confirmed_at) {
                try { await supabaseClient.auth.signOut(); } catch(e) {}
                showNotification('Account created successfully! Please sign in.', 'success');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1500);
            } else {
                // Email confirmation is enabled – show verification page
                showNotification('Verification email sent! Check your inbox.', 'success');
                setTimeout(() => {
                    window.location.href = 'verify-email.html';
                }, 1500);
            }

        } catch (err) {
            console.error('Signup error:', err);
            
            let userMessage = '';
            const errorCode = err.message || '';
            
            switch(errorCode) {
                case 'TOO_MANY_ATTEMPTS':
                    userMessage = 'Too many signup attempts. Please wait 5 minutes before trying again.';
                    break;
                case 'EMAIL_EXISTS':
                    userMessage = 'An account with this email already exists. Please login instead.';
                    setTimeout(() => {
                        if (confirm('Account already exists. Go to login page?')) {
                            window.location.href = 'login.html';
                        }
                    }, 100);
                    break;
                default:
                    if (err.message?.includes('confirmation email')) {
                        userMessage = 'Unable to send verification email. Please try again in a few minutes.';
                    } else {
                        userMessage = 'Unable to create account. Please try again later.';
                    }
            }
            
            showNotification(userMessage, 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
});

function togglePassword() {
    const input = document.getElementById('password');
    const icon = document.getElementById('passwordToggleIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}
globalThis.togglePassword = togglePassword;