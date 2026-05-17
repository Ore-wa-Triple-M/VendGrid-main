// Signup page logic
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('signupForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const role = document.getElementById('role').value;

        // Basic validation
        if (password.length < 8) {
            showNotification('Password must be at least 8 characters', 'error');
            return;
        }

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="loading"></span> Creating account...';
        btn.disabled = true;

        try {
            // 1. Create user in Supabase Auth
            const { data: authData, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        role: role
                    }
                }
            });

            if (signUpError) throw signUpError;

            if (authData.user) {
                // 2. Insert profile into profiles table (if not auto-created by trigger)
                // The profiles table should have a trigger to auto-create from auth.users,
                // but we'll do it manually to be safe.
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
                    console.warn('Profile insert warning:', profileError);
                    // Not fatal, profile might already exist from trigger
                }

                showNotification('Account created successfully! Please check your email to confirm your account (if email confirmation is enabled).', 'success');
                
                // Redirect to login after 2 seconds
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 2000);
            }
        } catch (err) {
            const msg = err.message.includes('already registered') 
                ? 'An account with this email already exists.' 
                : 'Signup failed: ' + err.message;
            showNotification(msg, 'error');
        }
    });
});

// Password toggle (same as login page)
function togglePassword() {
    const input = document.getElementById('password');
    const icon = document.getElementById('passwordToggleIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}