

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    if (!form) return;

    // Check for verification success redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === '1') {
        history.replaceState(null, '', window.location.pathname);
        setTimeout(() => {
            showNotification('Email verified! You can now sign in.', 'success');
        }, 200);
    }

    // Login form handler
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="loading"></span> Signing in...';
        btn.disabled = true;

        // Hide any previous unverified banner
        const banner = document.getElementById('unverifiedBanner');
        if (banner) banner.style.display = 'none';

        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            // Check if email is confirmed
            const isConfirmed = data.user?.email_confirmed_at !== null;
            
            if (!isConfirmed) {
                // Store email for resend functionality
                try { sessionStorage.setItem('vg_pending_email', email); } catch(e) {}
                if (banner) banner.style.display = 'flex';
                await supabaseClient.auth.signOut();
                showNotification('Please verify your email address before signing in. Check your inbox for the verification link.', 'warning');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            // Success - redirect to dashboard
            window.location.href = 'dashboard.html';

        } catch (err) {
            console.error('Login error:', err);
            
            // User-friendly error messages
            let userMessage = '';
            const errorMsg = err.message?.toLowerCase() || '';
            
            if (errorMsg.includes('invalid login credentials')) {
                userMessage = 'Invalid email or password. Please try again.';
            } else if (errorMsg.includes('email not confirmed')) {
                userMessage = 'Please verify your email address before logging in. Check your inbox for the verification link.';
                try { sessionStorage.setItem('vg_pending_email', email); } catch(e) {}
                if (banner) banner.style.display = 'flex';
            } else if (errorMsg.includes('rate limit') || err.status === 429) {
                userMessage = 'Too many login attempts. Please wait a few minutes before trying again.';
            } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
                userMessage = 'Network error. Please check your internet connection.';
            } else {
                userMessage = 'Unable to sign in. Please try again later.';
            }
            
            showNotification(userMessage, 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // Password toggle
    window.togglePassword = function() {
        const input = document.getElementById('password');
        const icon = document.getElementById('passwordToggleIcon');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };
});