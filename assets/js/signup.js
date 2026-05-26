/**
 * signup.js – VendGrid Signup Flow with Inline Company Selection
 * 
 * Flow: User enters credentials → selects/creates company → completes signup
 * All on one page – no redirects until fully complete
 * All company fields are saved during creation
 */

'use strict';

// State
let signupUserData = null;
let selectedCompanyId = null;
let searchDebounceTimer = null;
let currentUserId = null;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('signupForm');
    if (!form) return;

    // Step 1: Create user account
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

            // Create the auth user
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
                if (signUpError.status === 429 || signUpError.message?.includes('rate limit')) {
                    throw new Error('TOO_MANY_ATTEMPTS');
                }
                if (signUpError.message?.includes('already registered')) {
                    throw new Error('EMAIL_EXISTS');
                }
                throw signUpError;
            }

            // Get user ID
            let userId = authData?.user?.id;
            
            if (!userId) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const { data: { user } } = await supabaseClient.auth.getUser();
                userId = user?.id;
            }

            if (!userId) {
                throw new Error('COULD_NOT_GET_USER_ID');
            }

            currentUserId = userId;

            // Store user data for completion
            signupUserData = {
                user_id: userId,
                email: email,
                first_name: firstName,
                last_name: lastName,
                role: role
            };

            // Switch to company selection step
            document.getElementById('step1Form').style.display = 'none';
            document.getElementById('step2Form').style.display = 'block';
            document.getElementById('formSubtitle').textContent = 'Select or create your company';
            document.getElementById('loginFooter').style.display = 'none';
            
            // Setup search listener
            setupCompanySearch();

        } catch (err) {
            console.error('Signup error:', err);
            
            let userMessage = '';
            const errorMsg = err.message || '';

            switch (errorMsg) {
                case 'TOO_MANY_ATTEMPTS':
                    userMessage = 'Too many signup attempts. Please wait 5 minutes.';
                    break;
                case 'EMAIL_EXISTS':
                    userMessage = 'An account with this email already exists. Please login instead.';
                    setTimeout(() => {
                        if (confirm('Account already exists. Go to login page?')) {
                            window.location.href = 'login.html';
                        }
                    }, 100);
                    break;
                case 'COULD_NOT_GET_USER_ID':
                    userMessage = 'Account created but verification needed. Please check your email.';
                    setTimeout(() => { window.location.href = 'verify-email.html'; }, 2000);
                    break;
                default:
                    if (errorMsg.includes('confirmation email')) {
                        userMessage = 'Unable to send verification email. Please try again.';
                    } else {
                        userMessage = errorMsg || 'Unable to create account. Please try again.';
                    }
            }

            showNotification(userMessage, 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // Setup company search and creation buttons
    document.getElementById('showNewCompanyBtn')?.addEventListener('click', showNewCompanyForm);
    document.getElementById('backToCompanySearchBtn')?.addEventListener('click', showCompanySearch);
    document.getElementById('createNewCompanyBtn')?.addEventListener('click', createNewCompany);
    document.getElementById('completeSignupBtn')?.addEventListener('click', completeSignup);
});

function setupCompanySearch() {
    const searchInput = document.getElementById('companySearch');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }
        
        searchDebounceTimer = setTimeout(() => searchCompanies(query), 300);
    });
}

async function searchCompanies(query) {
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary"></div> Searching...</div>';
    
    try {
        const { data, error } = await supabaseClient
            .from('companies')
            .select('id, name, email')
            .ilike('name', `%${query}%`)
            .limit(10);
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            resultsContainer.innerHTML = '<div class="text-muted text-center py-2">No companies found. Click "My company is not listed" to create one.</div>';
            return;
        }
        
        resultsContainer.innerHTML = data.map(company => `
            <div class="company-search-result p-2 rounded mb-1" data-company-id="${company.id}" data-company-name="${escapeHtml(company.name)}">
                <div class="fw-semibold">${escapeHtml(company.name)}</div>
                <div class="small text-muted">${escapeHtml(company.email || 'No email')}</div>
            </div>
        `).join('');
        
        // Add click handlers
        document.querySelectorAll('.company-search-result').forEach(el => {
            el.addEventListener('click', () => selectCompany(parseInt(el.dataset.companyId), el.dataset.companyName));
        });
        
    } catch (err) {
        console.error('Search error:', err);
        resultsContainer.innerHTML = '<div class="text-danger text-center py-2">Error searching. Please try again.</div>';
    }
}

function selectCompany(companyId, companyName) {
    selectedCompanyId = companyId;
    
    // Highlight selected
    document.querySelectorAll('.company-search-result').forEach(el => {
        el.classList.remove('selected');
    });
    
    const selectedEl = document.querySelector(`.company-search-result[data-company-id="${companyId}"]`);
    if (selectedEl) {
        selectedEl.classList.add('selected');
    }
    
    // Show completion button
    document.getElementById('selectedCompanyInfo').style.display = 'block';
    document.getElementById('selectedCompanyName').textContent = companyName;
}

function showNewCompanyForm() {
    document.getElementById('companySelectionSection').style.display = 'none';
    document.getElementById('newCompanySection').style.display = 'block';
}

function showCompanySearch() {
    document.getElementById('newCompanySection').style.display = 'none';
    document.getElementById('companySelectionSection').style.display = 'block';
}

async function createNewCompany() {
    const companyName = document.getElementById('newCompanyName').value.trim();
    const companyEmail = document.getElementById('newCompanyEmail').value.trim();
    
    if (!companyName) {
        showNotification('Business name is required.', 'warning');
        document.getElementById('newCompanyName').focus();
        return;
    }
    
    if (!companyEmail) {
        showNotification('Business email is required.', 'warning');
        document.getElementById('newCompanyEmail').focus();
        return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(companyEmail)) {
        showNotification('Please enter a valid email address.', 'warning');
        document.getElementById('newCompanyEmail').focus();
        return;
    }
    
    const createBtn = document.getElementById('createNewCompanyBtn');
    const originalText = createBtn.innerHTML;
    createBtn.disabled = true;
    createBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
    
    try {
        const companySlug = companyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') + '-' + Date.now();
        
        // Get all company fields (including optional ones)
        const phone = document.getElementById('newCompanyPhone').value.trim() || null;
        const address = document.getElementById('newCompanyAddress').value.trim() || null;
        const currency = document.getElementById('newCompanyCurrency')?.value || 'KES';
        const vatRate = parseFloat(document.getElementById('newCompanyVatRate')?.value) || 16;
        
        // Create company with ALL fields
        const { data: company, error: companyError } = await supabaseClient
            .from('companies')
            .insert({
                name: companyName,
                slug: companySlug,
                email: companyEmail,
                phone: phone,
                address: address,
                currency: currency,
                vat_rate: vatRate,
                is_active: true
            })
            .select()
            .single();
        
        if (companyError) {
            if (companyError.code === '23505') {
                showNotification('A company with this name already exists. Please search for it instead.', 'warning');
                showCompanySearch();
            } else {
                throw companyError;
            }
            return;
        }
        
        selectedCompanyId = company.id;
        
        // Show completion button
        document.getElementById('selectedCompanyInfo').style.display = 'block';
        document.getElementById('selectedCompanyName').textContent = company.name;
        document.getElementById('newCompanySection').style.display = 'none';
        document.getElementById('companySelectionSection').style.display = 'block';
        
        showNotification('Company created successfully!', 'success');
        
    } catch (err) {
        console.error('Company creation error:', err);
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to create company. Please try again.'), 'error');
    } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = originalText;
    }
}

async function completeSignup() {
    if (!selectedCompanyId || !signupUserData) {
        showNotification('Please select or create a company first.', 'warning');
        return;
    }
    
    // Show loading
    const completeBtn = document.getElementById('completeSignupBtn');
    const originalText = completeBtn.innerHTML;
    completeBtn.disabled = true;
    completeBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Completing...';
    
    try {
        // First, create the profile if it doesn't exist
        const profileData = {
            id: signupUserData.user_id,
            email: signupUserData.email,
            first_name: signupUserData.first_name,
            last_name: signupUserData.last_name,
            role: signupUserData.role,
            company_id: selectedCompanyId,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // Upsert profile (insert or update)
        const { error: profileError } = await supabaseClient
            .from('profiles')
            .upsert(profileData, { onConflict: 'id' });

        if (profileError) {
            console.error('Profile upsert error:', profileError);
            throw new Error('PROFILE_UPDATE_FAILED');
        }

        // Clear cache
        sessionStorage.removeItem('vg_profile_cache');
        sessionStorage.removeItem('vg_company_cache');
        sessionStorage.setItem('vg_pending_email', signupUserData.email);
        
        showNotification('Account created successfully! Redirecting to login...', 'success');
        
        // Sign out so user must log in
        await supabaseClient.auth.signOut();
        
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        
    } catch (err) {
        console.error('Completion error:', err);
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to complete signup. Please try again.'), 'error');
        completeBtn.disabled = false;
        completeBtn.innerHTML = originalText;
    }
}

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