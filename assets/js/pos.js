// =============================================================================
// POS PAGE LOGIC – with M-Pesa STK Push & Phone Input Modal & Card Logos
// =============================================================================

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let products     = [];
let cart         = [];
let categories   = [];
let taxRate      = 16;
let businessInfo = {
    name:    'VendGrid Store',
    address: '',
    phone:   '',
    email:   '',
    logoUrl: null,
};
let pendingPaymentSaleId = null;
let paymentCheckInterval = null;
let paymentPollTimeout = null;
let scanTimer = null;
const SCAN_PAUSE_MS = 300;

// Category color palette
const categoryColors = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
    '#ff9800', '#795548', '#607d8b', '#3f51b5', '#ff5722'
];

// Cache category border colors
let categoryColorMap = new Map();

// Card payment state
let selectedCardType = null;

// Bank logos mapping (Font Awesome icons + fallback)
const bankLogos = {
    visa:        { icon: 'fab fa-cc-visa', name: 'Visa', color: '#1a1f71' },
    mastercard:  { icon: 'fab fa-cc-mastercard', name: 'Mastercard', color: '#eb001b' },
    amex:        { icon: 'fab fa-cc-amex', name: 'American Express', color: '#2e77bc' },
    discover:    { icon: 'fab fa-cc-discover', name: 'Discover', color: '#ff6000' },
    equity:      { icon: 'fas fa-university', name: 'Equity Bank', color: '#006633' },
    kcb:         { icon: 'fas fa-building-columns', name: 'KCB Bank', color: '#003366' },
    cooperative: { icon: 'fas fa-handshake', name: 'Cooperative Bank', color: '#8b0000' },
    absa:        { icon: 'fas fa-chart-line', name: 'ABSA Bank', color: '#003d5c' },
    standard:    { icon: 'fas fa-shield', name: 'Standard Chartered', color: '#0a6e5e' },
    other:       { icon: 'fas fa-credit-card', name: 'Other Card', color: '#6c757d' }
};

// Helper to get current company ID
function getPOSCompanyId() {
    if (typeof getCurrentCompanyId === 'function') {
        const id = getCurrentCompanyId();
        if (id) return id;
    }
    if (currentProfile && currentProfile.company_id) {
        return currentProfile.company_id;
    }
    return null;
}

// ---------------------------------------------------------------------------
// PHONE INPUT MODAL – Clean, Numeric-Only Design
// ---------------------------------------------------------------------------
function showPhoneInputModal() {
    return new Promise((resolve) => {
        const modalId = 'mpesaPhoneModal';
        const existingModal = document.getElementById(modalId);
        if (existingModal) existingModal.remove();

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content" style="border-radius: 20px;">
                        <div class="modal-header border-0 pb-0">
                            <h5 class="modal-title">
                                <i class="fas fa-mobile-alt me-2 text-primary"></i>M-Pesa Payment
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body pt-0">
                            <div class="text-center mb-3">
                                <div class="bg-light rounded-circle d-inline-flex p-3 mb-2">
                                    <i class="fas fa-phone-alt fa-2x text-primary"></i>
                                </div>
                                <p class="text-muted small">Enter the M-Pesa registered phone number</p>
                            </div>
                            <div class="mb-3">
                                <label class="form-label fw-semibold">Phone Number</label>
                                <div class="input-group">
                                    <span class="input-group-text bg-light border-end-0">
                                        <i class="fas fa-phone text-muted"></i>
                                    </span>
                                    <input type="tel" 
                                           class="form-control form-control-lg border-start-0" 
                                           id="mpesaPhoneInput" 
                                           placeholder="0712345678"
                                           autocomplete="off"
                                           inputmode="numeric"
                                           pattern="[0-9+]*"
                                           style="font-size: 1.1rem;">
                                </div>
                                <div class="form-text" id="phoneHelpText">
                                    <small>Enter phone number as 0712345678 or +254712345678</small>
                                </div>
                                <div class="invalid-feedback d-none" id="phoneErrorMsg">
                                    Please enter a valid phone number (10 digits starting with 0 or 12 digits starting with 254)
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer border-0 pt-0">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="fas fa-times me-1"></i>Cancel
                            </button>
                            <button type="button" class="btn btn-primary" id="confirmMpesaBtn">
                                <i class="fas fa-check me-1"></i>Pay Now
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalElement = document.getElementById(modalId);
        const modal = new bootstrap.Modal(modalElement, {
            backdrop: 'static',
            keyboard: true
        });

        let resolved = false;

        const cleanup = () => {
            if (modalElement) {
                modal.hide();
                setTimeout(() => modalElement.remove(), 300);
            }
        };

        const resolveWith = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };

        const confirmBtn = document.getElementById('confirmMpesaBtn');
        const phoneInput = document.getElementById('mpesaPhoneInput');
        const phoneErrorMsg = document.getElementById('phoneErrorMsg');
        const phoneHelpText = document.getElementById('phoneHelpText');

        const enforceNumericOnly = (e) => {
            let value = e.target.value;
            let cleaned = value.replace(/[^0-9+]/g, '');
            if (cleaned.indexOf('+') > 0) {
                cleaned = cleaned.replace(/\+/g, '');
            }
            if (cleaned.startsWith('+')) {
                cleaned = '+' + cleaned.slice(1).replace(/\+/g, '');
            }
            e.target.value = cleaned;
        };

        const validatePhone = () => {
            const rawPhone = phoneInput ? phoneInput.value.trim() : '';
            const digits = rawPhone.replace(/\D/g, '');
            const isValid = (digits.length === 10 && digits.startsWith('0')) || 
                           (digits.length === 12 && digits.startsWith('254'));
            
            if (isValid) {
                phoneInput.classList.remove('is-invalid');
                phoneInput.classList.add('is-valid');
                phoneErrorMsg.classList.add('d-none');
                if (phoneHelpText) phoneHelpText.classList.remove('text-danger');
                return true;
            } else {
                phoneInput.classList.add('is-invalid');
                phoneInput.classList.remove('is-valid');
                phoneErrorMsg.classList.remove('d-none');
                if (phoneHelpText) phoneHelpText.classList.add('text-danger');
                return false;
            }
        };

        phoneInput.addEventListener('input', (e) => {
            enforceNumericOnly(e);
            validatePhone();
        });

        phoneInput.addEventListener('blur', validatePhone);

        const validateAndConfirm = () => {
            if (!validatePhone()) {
                showNotification('Please enter a valid phone number (10 digits starting with 0 or 12 digits starting with 254)', 'error');
                return;
            }
            const rawPhone = phoneInput.value.trim();
            resolveWith(rawPhone);
        };

        if (confirmBtn) confirmBtn.onclick = validateAndConfirm;

        modalElement.addEventListener('hidden.bs.modal', () => {
            if (!resolved) resolveWith(null);
        });

        modal.show();
        setTimeout(() => {
            if (phoneInput) {
                phoneInput.focus();
                phoneInput.select();
            }
        }, 150);
    });
}

// ---------------------------------------------------------------------------
// CARD PAYMENT MODAL – Bank Logo Buttons
// ---------------------------------------------------------------------------
function showCardPaymentModal() {
    return new Promise((resolve) => {
        const modalId = 'cardPaymentModal';
        const existingModal = document.getElementById(modalId);
        if (existingModal) existingModal.remove();

        const bankButtonsHtml = Object.entries(bankLogos).map(([key, bank]) => `
            <div class="col-4 col-md-3 mb-3">
                <button type="button" 
                        class="card-bank-btn w-100 p-3 rounded-3 border-2 bg-white"
                        data-card-type="${key}"
                        style="border: 2px solid #dee2e6; transition: all 0.2s ease;">
                    <i class="${bank.icon} fa-2x" style="color: ${bank.color};"></i>
                    <div class="small mt-1 text-dark">${bank.name}</div>
                </button>
            </div>
        `).join('');

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content" style="border-radius: 20px;">
                        <div class="modal-header border-0 pb-0">
                            <h5 class="modal-title">
                                <i class="fas fa-credit-card me-2 text-primary"></i>Card Payment
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body pt-0">
                            <div class="text-center mb-3">
                                <div class="bg-light rounded-circle d-inline-flex p-3 mb-2">
                                    <i class="fas fa-credit-card fa-2x text-primary"></i>
                                </div>
                                <p class="text-muted small">Select your card type to continue</p>
                            </div>
                            
                            <label class="form-label fw-semibold mb-2">Select Card Type</label>
                            <div class="row g-2 mb-4" id="bankButtonsContainer">
                                ${bankButtonsHtml}
                            </div>
                            
                            <div id="cardDetailsSection" style="display: none;">
                                <hr class="my-3">
                                <label class="form-label fw-semibold">Card Details</label>
                                <div class="mb-2">
                                    <input type="text" class="form-control" id="cardNumber" 
                                           placeholder="Card Number" maxlength="19"
                                           inputmode="numeric" style="letter-spacing: 1px;">
                                </div>
                                <div class="row g-2">
                                    <div class="col-6">
                                        <input type="text" class="form-control" id="cardExpiry" 
                                               placeholder="MM/YY" maxlength="5">
                                    </div>
                                    <div class="col-6">
                                        <input type="password" class="form-control" id="cardCvv" 
                                               placeholder="CVV" maxlength="4" inputmode="numeric">
                                    </div>
                                </div>
                                <div class="form-text small text-muted mt-2">
                                    <i class="fas fa-lock me-1"></i> Your payment info is secure and encrypted
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer border-0 pt-0">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="fas fa-times me-1"></i>Cancel
                            </button>
                            <button type="button" class="btn btn-primary" id="confirmCardBtn" disabled>
                                <i class="fas fa-check me-1"></i>Pay Now
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalElement = document.getElementById(modalId);
        const modal = new bootstrap.Modal(modalElement, {
            backdrop: 'static',
            keyboard: true
        });

        let resolved = false;

        const cleanup = () => {
            if (modalElement) {
                modal.hide();
                setTimeout(() => modalElement.remove(), 300);
            }
        };

        const resolveWith = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };

        const bankBtns = document.querySelectorAll('.card-bank-btn');
        const confirmBtn = document.getElementById('confirmCardBtn');
        const cardDetailsSection = document.getElementById('cardDetailsSection');
        const cardNumberInput = document.getElementById('cardNumber');
        const cardExpiryInput = document.getElementById('cardExpiry');
        const cardCvvInput = document.getElementById('cardCvv');

        bankBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                bankBtns.forEach(b => {
                    b.style.borderColor = '#dee2e6';
                    b.style.backgroundColor = 'white';
                    b.style.transform = 'scale(1)';
                });
                btn.style.borderColor = '#007bff';
                btn.style.backgroundColor = '#e8f0fe';
                btn.style.transform = 'scale(1.02)';
                
                selectedCardType = btn.dataset.cardType;
                cardDetailsSection.style.display = 'block';
                confirmBtn.disabled = false;
            });
        });

        if (cardNumberInput) {
            cardNumberInput.addEventListener('input', (e) => {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length > 16) value = value.slice(0, 16);
                let formatted = '';
                for (let i = 0; i < value.length; i++) {
                    if (i > 0 && i % 4 === 0) formatted += ' ';
                    formatted += value[i];
                }
                e.target.value = formatted;
            });
        }

        if (cardExpiryInput) {
            cardExpiryInput.addEventListener('input', (e) => {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length > 4) value = value.slice(0, 4);
                if (value.length >= 2) {
                    e.target.value = value.slice(0, 2) + '/' + value.slice(2);
                } else {
                    e.target.value = value;
                }
            });
        }

        if (cardCvvInput) {
            cardCvvInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
            });
        }

        const validateAndConfirm = () => {
            if (!selectedCardType) {
                showNotification('Please select a card type', 'warning');
                return;
            }
            resolveWith({ cardType: selectedCardType, cardNumber: cardNumberInput?.value || null });
        };

        if (confirmBtn) confirmBtn.onclick = validateAndConfirm;

        modalElement.addEventListener('hidden.bs.modal', () => {
            if (!resolved) resolveWith(null);
        });

        modal.show();
    });
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
async function loadSettings() {
    const settings = await fetchSettings();
    taxRate = parseFloat(settings.vat_rate) || 16;
    const vatDisplay = document.getElementById('vatRateDisplay');
    if (vatDisplay) vatDisplay.innerText = taxRate;
    businessInfo.name    = settings.business_name    || 'VendGrid Store';
    businessInfo.address = settings.business_address || '';
    businessInfo.phone   = settings.business_phone   || '';
    businessInfo.email   = settings.business_email   || '';
    businessInfo.logoUrl = settings.company_logo_url || null;
}

// ---------------------------------------------------------------------------
// DATA LOADING (with company isolation)
// ---------------------------------------------------------------------------
async function loadPOSData() {
    await loadSettings();
    
    const companyId = getPOSCompanyId();
    
    // Build product query with company filter
    let productQuery = supabaseClient
        .from('products')
        .select('*, categories(name, id)')
        .eq('is_active', true);
    
    let categoryQuery = supabaseClient
        .from('categories')
        .select('*')
        .eq('is_active', true);
    
    if (companyId) {
        productQuery = productQuery.eq('company_id', companyId);
        categoryQuery = categoryQuery.eq('company_id', companyId);
    } else if (currentProfile?.company_id) {
        productQuery = productQuery.eq('company_id', currentProfile.company_id);
        categoryQuery = categoryQuery.eq('company_id', currentProfile.company_id);
    }
    
    const { data: prodData } = await productQuery;
    products = prodData || [];
    
    const { data: catData } = await categoryQuery;
    categories = catData || [];
    
    buildCategoryColorMap();
    renderCategories();
    renderProducts();
}

// ---------------------------------------------------------------------------
// CATEGORY COLOR FUNCTIONS
// ---------------------------------------------------------------------------
function buildCategoryColorMap() {
    categoryColorMap.clear();
    categories.forEach((cat, index) => {
        const colorIndex = index % categoryColors.length;
        categoryColorMap.set(cat.id, categoryColors[colorIndex]);
    });
}

function getCategoryBorderColor(categoryId) {
    return categoryColorMap.get(categoryId) || '#e9ecef';
}

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------
function renderCategories() {
    const container = document.getElementById('categoryFilter');
    if (!container) return;
    container.innerHTML = '<button class="btn btn-sm btn-outline-primary" data-cat="all">All</button>';
    categories.forEach(cat => {
        const borderColor = getCategoryBorderColor(cat.id);
        container.innerHTML += `
            <button class="btn btn-sm btn-outline-primary" data-cat="${cat.id}" 
                    style="border-left: 3px solid ${borderColor}; border-left-width: 3px; border-left-style: solid;">
                ${escapeHtml(cat.name)}
            </button>
        `;
    });
    document.querySelectorAll('#categoryFilter button').forEach(btn => btn.classList.remove('active'));
    
    document.querySelectorAll('#categoryFilter button').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#categoryFilter button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProducts();
            focusSearchInput();
        };
    });
}

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
function renderProducts() {
    const search    = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const activeCat = document.querySelector('#categoryFilter button.active')?.dataset.cat;
    
    if (!activeCat && !search) {
        const grid = document.getElementById('productGrid');
        if (grid) {
            grid.innerHTML = `<div class="col-12 text-center text-muted py-5">
                                <i class="fas fa-search fa-3x mb-3"></i>
                                <p>Select a category or type to search for products</p>
                              </div>`;
        }
        return;
    }
    
    let filtered = products;
    if (activeCat && activeCat !== 'all') {
        filtered = filtered.filter(p => p.category_id == activeCat);
    }
    if (search) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(search) ||
                                        (p.sku || '').toLowerCase().includes(search) ||
                                        (p.barcode || '').toLowerCase().includes(search));
    }
    
    const grid = document.getElementById('productGrid');
    if (!grid) return;
    
    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center text-muted py-5">
                            <i class="fas fa-box-open fa-3x mb-3"></i>
                            <p>No products found</p>
                          </div>`;
        return;
    }
    
    grid.innerHTML = filtered.map(p => {
        const category = categories.find(c => c.id === p.category_id);
        const borderColor = category ? getCategoryBorderColor(category.id) : '#e9ecef';
        const isOutOfStock = p.stock_quantity <= 0;
        
        return `
            <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}"
                 style="border-left: 4px solid ${borderColor}; border-left-style: solid;"
                 onclick="addToCart(${p.id})">
                <i class="fas fa-box fa-2x text-muted"></i>
                <div class="product-name">${escapeHtml(p.name)}</div>
                ${p.description ? `<div class="product-desc small text-muted mt-1">${escapeHtml(p.description)}</div>` : ''}
                <div class="product-price">${formatCurrency(p.price)}</div>
                <small class="text-muted">Stock: ${p.stock_quantity} ${p.uom || 'pcs'}</small>
                ${category ? `<small class="d-block text-muted" style="font-size: 0.7rem;">${escapeHtml(category.name)}</small>` : ''}
            </div>
        `;
    }).join('');
}

// ---------------------------------------------------------------------------
// CART
// ---------------------------------------------------------------------------
function addToCart(productId, quantity = 1) {
    const product = products.find(p => p.id === productId);
    if (!product) {
        showNotification('Product not found', 'error');
        return false;
    }
    
    if (product.stock_quantity <= 0) {
        showNotification('Out of stock', 'warning');
        return false;
    }
    
    const existing = cart.find(i => i.id === productId);
    let newQuantity = quantity;
    
    if (existing) {
        newQuantity = existing.quantity + quantity;
        if (newQuantity > product.stock_quantity) {
            showNotification(`Not enough stock. Available: ${product.stock_quantity}`, 'warning');
            return false;
        }
        existing.quantity = newQuantity;
    } else {
        if (quantity > product.stock_quantity) {
            showNotification(`Not enough stock. Available: ${product.stock_quantity}`, 'warning');
            return false;
        }
        cart.push({
            id:          product.id,
            name:        product.name,
            description: product.description || '',
            price:       parseFloat(product.price),
            quantity:    quantity,
            category_id: product.category_id,
            uom:         product.uom || 'pcs'
        });
    }
    
    renderCart();
    focusSearchInput();
    return true;
}

function updateQuantity(id, delta) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    const product = products.find(p => p.id === id);
    const newQty = item.quantity + delta;
    
    if (delta > 0 && newQty > product.stock_quantity) {
        showNotification(`Not enough stock. Available: ${product.stock_quantity}`, 'warning');
        return;
    }
    
    if (newQty <= 0) {
        cart = cart.filter(i => i.id !== id);
    } else {
        item.quantity = newQty;
    }
    
    renderCart();
}

function setQuantity(id, newQuantity) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    
    const product = products.find(p => p.id === id);
    let qty = parseInt(newQuantity);
    
    if (isNaN(qty) || qty <= 0) {
        cart = cart.filter(i => i.id !== id);
        renderCart();
        return;
    }
    
    if (qty > product.stock_quantity) {
        showNotification(`Not enough stock. Available: ${product.stock_quantity}`, 'warning');
        qty = product.stock_quantity;
    }
    
    item.quantity = qty;
    renderCart();
}

function removeCartItem(id) {
    cart = cart.filter(i => i.id !== id);
    renderCart();
}

function clearCart() {
    cart = [];
    renderCart();
    const tenderedField = document.getElementById('amountTendered');
    if (tenderedField) tenderedField.value = '0';
    const changeDisplay = document.getElementById('changeAmount');
    if (changeDisplay) changeDisplay.innerText = formatCurrency(0);
    if (paymentCheckInterval) {
        clearInterval(paymentCheckInterval);
        paymentCheckInterval = null;
        pendingPaymentSaleId = null;
    }
    if (paymentPollTimeout) {
        clearTimeout(paymentPollTimeout);
        paymentPollTimeout = null;
    }
    focusSearchInput();
}

function renderCart() {
    const container = document.getElementById('cartItems');
    if (!container) return;
    
    if (!cart.length) {
        container.innerHTML = `
            <div class="text-center text-muted p-5">
                <i class="fas fa-shopping-basket fa-3x mb-3"></i>
                <p>Cart is empty</p>
            </div>`;
        updateTotals();
        return;
    }
    
    const gridStyle = "display: grid; grid-template-columns: 3fr 1fr 1fr 1fr 80px; gap: 15px; align-items: center;";
    container.innerHTML = cart.map(item => {
        const itemTotal = item.price * item.quantity;
        const category = categories.find(c => c.id === item.category_id);
        const borderColor = category ? getCategoryBorderColor(category.id) : '#e9ecef';
        
        return `
            <div class="p-3 border-bottom" style="${gridStyle} border-left: 3px solid ${borderColor} !important;">
                <div class="d-flex flex-column justify-content-center">
                    <div class="fw-semibold text-dark">${escapeHtml(item.name)}</div>
                    ${item.description ? `<div class="small text-muted">${escapeHtml(item.description)}</div>` : ''}
                    ${category ? `<small class="text-muted" style="font-size: 0.7rem;">${escapeHtml(category.name)}</small>` : ''}
                </div>
                <div class="ps-3 border-start d-flex align-items-center h-100">
                    <span>${formatCurrency(item.price)}</span>
                </div>
                <div class="ps-3 border-start d-flex align-items-center h-100">
                    <div class="d-flex align-items-center gap-2">
                        <button class="btn btn-sm btn-outline-secondary" onclick="updateQuantity(${item.id}, -1)">
                            <i class="fas fa-minus"></i>
                        </button>
                        <input type="number" class="form-control form-control-sm text-center" 
                               style="width: 70px;" value="${item.quantity}" min="1"
                               onchange="setQuantity(${item.id}, this.value)">
                        <button class="btn btn-sm btn-outline-secondary" onclick="updateQuantity(${item.id}, 1)">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>
                <div class="ps-3 border-start fw-semibold d-flex align-items-center h-100">
                    <span>${formatCurrency(itemTotal)}</span>
                </div>
                <div class="ps-3 border-start d-flex align-items-center justify-content-center h-100">
                    <button class="btn btn-sm btn-outline-danger" onclick="removeCartItem(${item.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    updateTotals();
}

function updateTotals() {
    const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount = parseFloat(document.getElementById('discount')?.value) || 0;
    const tax      = subtotal * (taxRate / 100);
    const total    = subtotal + tax - discount;
    const subtotalEl = document.getElementById('subtotal');
    const taxEl      = document.getElementById('tax');
    const totalEl    = document.getElementById('total');
    if (subtotalEl) subtotalEl.innerText = formatCurrency(subtotal);
    if (taxEl) taxEl.innerText = formatCurrency(tax);
    if (totalEl) totalEl.innerText = formatCurrency(Math.max(0, total));
    updateChange();
}

// ---------------------------------------------------------------------------
// CASH SECTION
// ---------------------------------------------------------------------------
function toggleCashSection() {
    const method  = document.getElementById('paymentMethod')?.value;
    const section = document.getElementById('cashChangeSection');
    if (!section) return;
    if (method === 'cash') {
        section.style.display = 'block';
        updateChange();
    } else {
        section.style.display = 'none';
        const tenderedField = document.getElementById('amountTendered');
        if (tenderedField) tenderedField.value = '0';
        const changeDisplay = document.getElementById('changeAmount');
        if (changeDisplay) changeDisplay.innerText = formatCurrency(0);
    }
}

function updateChange() {
    const totalText = document.getElementById('total')?.innerText || '0';
    const total = parseFloat(totalText.replace(/[^0-9.]+/g, '')) || 0;
    const tendered = parseFloat(document.getElementById('amountTendered')?.value) || 0;
    const change = Math.max(0, tendered - total);
    const changeDisplay = document.getElementById('changeAmount');
    if (changeDisplay) changeDisplay.innerText = formatCurrency(change);
}

// ---------------------------------------------------------------------------
// SEARCH FOCUS & BARCODE SCANNING
// ---------------------------------------------------------------------------
function focusSearchInput() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.focus();
    }
}

function processBarcodeInput(barcode) {
    if (!barcode || barcode.trim() === '') return false;
    
    const product = products.find(p => 
        p.barcode === barcode || 
        p.sku === barcode
    );
    
    if (product) {
        addToCart(product.id, 1);
        showNotification(`${product.name} added to cart`, 'success');
        return true;
    }
    return false;
}

function setupBarcodeScanner() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const barcode = searchInput.value.trim();
            if (barcode !== '') {
                const product = products.find(p => 
                    p.barcode === barcode || 
                    p.sku === barcode
                );
                
                if (product) {
                    addToCart(product.id, 1);
                    showNotification(`${product.name} added to cart`, 'success');
                    searchInput.value = '';
                } else if (barcode.length > 3) {
                    const partialMatch = products.find(p => 
                        p.name.toLowerCase().includes(barcode.toLowerCase())
                    );
                    if (partialMatch) {
                        showNotification(`Product not found by barcode/SKU. Did you mean "${partialMatch.name}"?`, 'warning');
                    } else {
                        showNotification(`Product with barcode/SKU "${barcode}" not found`, 'warning');
                    }
                }
                focusSearchInput();
            }
            e.preventDefault();
        }
    });
}

// ---------------------------------------------------------------------------
// COMPLETE SALE - UPDATED WITH COMPANY ID
// ---------------------------------------------------------------------------
async function completeSale() {
    if (!cart.length) {
        showNotification('Cart is empty', 'error');
        return;
    }
    
    const method = document.getElementById('paymentMethod').value;
    const totalText = document.getElementById('total').innerText;
    const total = parseFloat(totalText.replace(/[^0-9.]+/g, '')) || 0;
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    
    // Prepare items array for RPC
    const items = cart.map(i => ({ 
        product_id: i.id, 
        quantity: i.quantity,
        price: i.price
    }));
    
    const companyId = getPOSCompanyId();
    if (!companyId) {
        showNotification('Company not found. Please log in again.', 'error');
        return;
    }

    // Mobile Payment (M-Pesa)
    if (method === 'mobile') {
        const phone = await showPhoneInputModal();
        if (!phone) return;

        // Create pending sale
        const { data: saleData, error: saleError } = await supabaseClient.rpc('process_sale_pending', {
            p_cashier_id: currentUser.id,
            p_items: items,
            p_discount: discount,
            p_payment_method: method,
            p_company_id: companyId
        });

        if (saleError) {
            showNotification('Sale creation failed: ' + getUserFriendlyErrorMessage(saleError), 'error');
            return;
        }

        const saleId = saleData.id;
        const transactionNumber = saleData.transaction_number;

        // Initiate M-Pesa payment
        const { data: mpesaRes, error: mpesaError } = await supabaseClient.functions.invoke('initiate-mpesa-payment', {
            body: {
                sale_id: saleId,
                phone_number: phone,
                amount: total,
                transaction_number: transactionNumber
            }
        });

        if (mpesaError || !mpesaRes || mpesaRes.error) {
            showNotification('Failed to initiate M-Pesa payment: ' + (mpesaRes?.error || mpesaError?.message), 'error');
            return;
        }

        showNotification('STK push sent. Please check your phone and enter PIN.', 'info');

        // Poll for payment confirmation
        if (paymentCheckInterval) clearInterval(paymentCheckInterval);
        if (paymentPollTimeout) clearTimeout(paymentPollTimeout);

        pendingPaymentSaleId = saleId;
        const pollStartTime = Date.now();
        const MAX_POLL_TIME = 60000;

        paymentCheckInterval = setInterval(async () => {
            const { data: saleCheck, error: checkError } = await supabaseClient
                .from('sales')
                .select('payment_status, payment_reference')
                .eq('id', saleId)
                .single();

            if (checkError) return;

            if (saleCheck.payment_status === 'completed') {
                clearInterval(paymentCheckInterval);
                clearTimeout(paymentPollTimeout);
                paymentCheckInterval = null;
                paymentPollTimeout = null;
                pendingPaymentSaleId = null;
                showNotification('Payment successful! Transaction: ' + transactionNumber, 'success');
                const receiptSnapshot = { items: cart.map(i => ({ ...i })), discount, tendered: 0 };
                generateReceipt(transactionNumber, receiptSnapshot, 0, saleCheck.payment_reference);
                clearCart();
                await loadPOSData();
                focusSearchInput();
            } else if (saleCheck.payment_status === 'failed') {
                clearInterval(paymentCheckInterval);
                clearTimeout(paymentPollTimeout);
                paymentCheckInterval = null;
                paymentPollTimeout = null;
                pendingPaymentSaleId = null;
                showNotification('Payment failed. Please try again.', 'error');
                focusSearchInput();
            } else if (Date.now() - pollStartTime >= MAX_POLL_TIME) {
                clearInterval(paymentCheckInterval);
                clearTimeout(paymentPollTimeout);
                paymentCheckInterval = null;
                paymentPollTimeout = null;
                pendingPaymentSaleId = null;
                showNotification('Payment confirmation timed out. Please check transaction status in reports.', 'warning');
                focusSearchInput();
            }
        }, 3000);

        paymentPollTimeout = setTimeout(() => {
            if (paymentCheckInterval) {
                clearInterval(paymentCheckInterval);
                paymentCheckInterval = null;
                paymentPollTimeout = null;
                pendingPaymentSaleId = null;
                showNotification('Payment confirmation timed out. Please check transaction status in reports.', 'warning');
                focusSearchInput();
            }
        }, MAX_POLL_TIME);

        return;
    }

    // Card Payment
    if (method === 'card') {
        const cardDetails = await showCardPaymentModal();
        if (!cardDetails) return;

        showNotification(`Processing ${cardDetails.cardType.toUpperCase()} card payment...`, 'info');
        
        setTimeout(async () => {
            const { data, error } = await supabaseClient.rpc('process_sale', {
                p_cashier_id: currentUser.id,
                p_items: items,
                p_discount: discount,
                p_payment_method: 'card',
                p_company_id: companyId
            });

            if (error) {
                showNotification('Sale failed: ' + getUserFriendlyErrorMessage(error), 'error');
                return;
            }

            showNotification(`Card payment successful! Transaction: ${data.transaction_number}`, 'success');
            const receiptSnapshot = { items: cart.map(i => ({ ...i })), discount, tendered: 0 };
            generateReceipt(data.transaction_number, receiptSnapshot, 0, `${cardDetails.cardType.toUpperCase()}-${Date.now()}`);
            clearCart();
            await loadPOSData();
            focusSearchInput();
        }, 1500);
        
        return;
    }

    // Cash Payment
    const tendered = parseFloat(document.getElementById('amountTendered')?.value) || 0;
    if (method === 'cash' && tendered < total) {
        showNotification(`Insufficient payment. Please enter at least ${formatCurrency(total)}.`, 'error');
        return;
    }

    // Process cash or other immediate payment methods
    const { data, error } = await supabaseClient.rpc('process_sale', {
        p_cashier_id: currentUser.id,
        p_items: items,
        p_discount: discount,
        p_payment_method: method,
        p_company_id: companyId
    });

    if (error) {
        showNotification('Sale failed: ' + getUserFriendlyErrorMessage(error), 'error');
        return;
    }

    showNotification('Sale completed! Transaction: ' + data.transaction_number);
    const receiptSnapshot = { items: cart.map(i => ({ ...i })), discount, tendered };
    generateReceipt(data.transaction_number, receiptSnapshot, tendered);
    clearCart();
    await loadPOSData();
    focusSearchInput();
}

// ---------------------------------------------------------------------------
// RECEIPT GENERATION
// ---------------------------------------------------------------------------
function generateReceipt(transactionNumber = null, snapshot = null, amountTendered = null, paymentRef = null) {
    const receiptItems = (snapshot && snapshot.items && snapshot.items.length) ? snapshot.items : cart;
    const receiptDiscount = snapshot ? (snapshot.discount || 0) : (parseFloat(document.getElementById('discount').value) || 0);
    const snapshotTendered = snapshot?.tendered ?? null;
    const tenderedAmount = snapshotTendered !== null ? snapshotTendered : (amountTendered !== null ? amountTendered : (parseFloat(document.getElementById('amountTendered')?.value) || 0));

    if (!receiptItems.length) {
        showNotification('Cart is empty', 'warning');
        return;
    }

    const method = document.getElementById('paymentMethod').value;
    const subtotal = receiptItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount = receiptDiscount;
    const tax = subtotal * (taxRate / 100);
    const total = Math.max(0, subtotal + tax - discount);
    const change = method === 'cash' ? Math.max(0, tenderedAmount - total) : 0;

    const cashier = currentProfile?.first_name || currentUser?.email || 'Cashier';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

    const itemsHTML = receiptItems.map(item => `
        <tr>
            <td class="ps-0">
                ${escapeHtml(item.name)}
                ${item.description ? `<br><small class="text-muted">${escapeHtml(item.description)}</small>` : ''}
            </td>
            <td class="text-center">${item.quantity} ${item.uom || 'pcs'}</td>
            <td class="text-end">${formatCurrency(item.price)}</td>
            <td class="text-end pe-0">${formatCurrency(item.price * item.quantity)}</td>
        </tr>
    `).join('');

    const businessName = escapeHtml(businessInfo.name || 'VendGrid Store');
    const businessAddress = businessInfo.address ? `<div class="small text-muted">${escapeHtml(businessInfo.address)}</div>` : '';
    const businessPhone = businessInfo.phone ? `<div class="small text-muted">Tel: ${escapeHtml(businessInfo.phone)}</div>` : '';
    const businessEmail = businessInfo.email ? `<div class="small text-muted">Email: ${escapeHtml(businessInfo.email)}</div>` : '';
    const logoHtml = businessInfo.logoUrl ? `<img src="${businessInfo.logoUrl}" style="max-height:60px; margin-bottom:10px;">` : `<i class="fas fa-cash-register fa-2x text-primary mb-2"></i>`;

    const txnRow = transactionNumber ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Transaction #:</small>
            <small>${escapeHtml(transactionNumber)}</small>
        </div>` : '';

    const cashRows = method === 'cash' ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Cash Paid</small>
            <small>${formatCurrency(tenderedAmount)}</small>
        </div>
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted fw-semibold">Change</small>
            <small class="fw-semibold text-success">${formatCurrency(change)}</small>
        </div>` : '';

    const paymentRefRow = (method !== 'cash' && paymentRef) ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">${method === 'mobile' ? 'M-Pesa Receipt No.' : 'Transaction ID'}:</small>
            <small>${escapeHtml(paymentRef)}</small>
        </div>` : '';

    const discountRow = discount > 0 ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Discount</small>
            <small class="text-danger">- ${formatCurrency(discount)}</small>
        </div>` : '';

    const receiptBody = `
        <div class="text-center mb-3">
            ${logoHtml}
            <h5 class="fw-bold mb-0">${businessName}</h5>
            ${businessAddress}
            ${businessPhone}
            ${businessEmail}
            <small class="text-muted">Official Receipt</small>
        </div>
        <hr class="border-dashed">
        ${txnRow}
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Date:</small>
            <small>${dateStr} ${timeStr}</small>
        </div>
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Cashier:</small>
            <small>${escapeHtml(cashier)}</small>
        </div>
        <div class="d-flex justify-content-between mb-3">
            <small class="text-muted">Payment:</small>
            <small class="text-capitalize">${method}</small>
        </div>
        ${paymentRefRow}
        <hr class="border-dashed">
        <table class="table table-sm mb-0">
            <thead><tr class="border-bottom"><th class="ps-0">Item</th><th class="text-center">Qty</th><th class="text-end">Price</th><th class="text-end pe-0">Total</th></tr></thead>
            <tbody>${itemsHTML}</tbody>
        </table>
        <hr class="border-dashed">
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Subtotal</small>
            <small>${formatCurrency(subtotal)}</small>
        </div>
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">VAT (${taxRate}%)</small>
            <small>${formatCurrency(tax)}</small>
        </div>
        ${discountRow}
        <hr class="border-dashed">
        <div class="d-flex justify-content-between fw-bold fs-5 mb-2">
            <span>Total</span>
            <span class="text-primary">${formatCurrency(total)}</span>
        </div>
        ${cashRows}
        <div class="text-center mt-3">
            <small class="text-muted">Thank you for your purchase!</small>
        </div>
    `;

    globalThis._lastReceiptHTML = receiptBody;
    globalThis._lastTransactionNumber = transactionNumber;

    const receiptContent = document.getElementById('receiptContent');
    if (receiptContent) receiptContent.innerHTML = receiptBody;
    const receiptModal = new bootstrap.Modal(document.getElementById('receiptModal'));
    receiptModal.show();
}

// ---------------------------------------------------------------------------
// EMAIL / SMS FROM MODAL
// ---------------------------------------------------------------------------

async function sendReceiptEmailFromModal() {
    let transactionNumber = globalThis._lastTransactionNumber;
    
    if (!transactionNumber) {
        const receiptContent = document.getElementById('receiptContent');
        if (receiptContent) {
            const txnMatch = receiptContent.innerHTML.match(/Transaction #:\s*<small>([^<]+)<\/small>/);
            if (txnMatch) transactionNumber = txnMatch[1];
        }
    }
    
    if (!transactionNumber) {
        showNotification('No transaction number found. Please complete a sale first.', 'error');
        return;
    }
    
    const email = document.getElementById('receiptEmail')?.value.trim();
    if (!email) {
        showNotification('Please enter an email address', 'warning');
        return;
    }
    
    const receiptHtml = globalThis._lastReceiptHTML || document.getElementById('receiptContent')?.innerHTML || '';
    
    if (!receiptHtml) {
        showNotification('No receipt content found. Please generate receipt first.', 'error');
        return;
    }
    
    await globalThis.sendReceiptEmail(email, receiptHtml, transactionNumber);
}

async function sendReceiptSMSFromModal() {
    let transactionNumber = globalThis._lastTransactionNumber;
    
    if (!transactionNumber) {
        const receiptContent = document.getElementById('receiptContent');
        if (receiptContent) {
            const txnMatch = receiptContent.innerHTML.match(/Transaction #:\s*<small>([^<]+)<\/small>/);
            if (txnMatch) transactionNumber = txnMatch[1];
        }
    }
    
    if (!transactionNumber) {
        showNotification('No transaction number found. Please complete a sale first.', 'error');
        return;
    }
    
    const phone = document.getElementById('receiptPhone')?.value.trim();
    if (!phone) {
        showNotification('Please enter a phone number', 'warning');
        return;
    }
    
    const totalElement = document.getElementById('total');
    const total = totalElement?.innerText || 'KES 0.00';
    
    const shortSummary = `VendGrid receipt #${transactionNumber} | Total ${total}`;
    await globalThis.sendReceiptSMS(phone, shortSummary);
}

function printReceipt() {
    const content = document.getElementById('receiptContent').innerHTML;
    const win = globalThis.open('', '_blank', 'width=420,height=600');
    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Receipt - VendGrid</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
            <style>body { padding: 20px; font-size: 13px; } .border-dashed { border-style: dashed !important; } @media print { body { padding: 0; } }</style>
        </head>
        <body onload="window.print(); window.close();">
            ${content}
        </body>
        </html>
    `);
    win.document.close();
}

// ---------------------------------------------------------------------------
// EVENT LISTENERS
// ---------------------------------------------------------------------------
document.getElementById('searchInput')?.addEventListener('input', renderProducts);
document.getElementById('discount')?.addEventListener('input', updateTotals);
document.getElementById('paymentMethod')?.addEventListener('change', toggleCashSection);
document.getElementById('amountTendered')?.addEventListener('input', updateChange);

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;

    const allowedRoles = ['admin', 'manager', 'cashier'];
    if (!allowedRoles.includes(currentProfile?.role)) {
        showNotification('Access denied. Only cashiers, managers and admins can use POS.', 'error');
        setTimeout(() => globalThis.location.href = 'dashboard.html', 2000);
        return;
    }

    const userNameSpan = document.getElementById('userName');
    if (userNameSpan) userNameSpan.innerText = currentProfile?.first_name || currentUser.email;
    await loadPOSData();
    toggleCashSection();

    setTimeout(() => {
        focusSearchInput();
    }, 500);

    setupBarcodeScanner();
});

// Expose functions globally
globalThis.sendReceiptEmailFromModal = sendReceiptEmailFromModal;
globalThis.sendReceiptSMSFromModal   = sendReceiptSMSFromModal;
globalThis.addToCart = addToCart;
globalThis.updateQuantity = updateQuantity;
globalThis.setQuantity = setQuantity;
globalThis.removeCartItem = removeCartItem;
globalThis.clearCart = clearCart;
globalThis.completeSale = completeSale;
globalThis.generateReceipt = generateReceipt;
globalThis.printReceipt = printReceipt;
globalThis.focusSearchInput = focusSearchInput;