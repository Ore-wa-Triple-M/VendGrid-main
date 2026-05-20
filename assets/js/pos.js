// =============================================================================
// POS PAGE LOGIC – with M-Pesa STK Push integration & UI-based phone input
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

// ---------------------------------------------------------------------------
// UI HELPER – M-Pesa Phone Input Modal (replaces browser prompt)
// ---------------------------------------------------------------------------
/**
 * Shows a modal dialog to capture M-Pesa phone number.
 * @returns {Promise<string|null>} The validated phone number or null if cancelled.
 */
function showPhoneInputModal() {
    return new Promise((resolve) => {
        // Create modal container
        const modalId = 'mpesaPhoneModal';
        // Remove existing modal if any
        const existingModal = document.getElementById(modalId);
        if (existingModal) existingModal.remove();

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="fas fa-mobile-alt me-2"></i>M-Pesa Payment
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label for="mpesaPhoneInput" class="form-label">Phone Number</label>
                                <input type="tel" class="form-control" id="mpesaPhoneInput" 
                                       placeholder="e.g., 0712345678, 0112345678, 254712345678" autocomplete="off">
                                <div class="form-text">Enter the M-Pesa registered phone number.</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
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
            backdrop: 'static',  // prevent accidental close by backdrop click? We'll handle cancel via button/close.
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

        // Confirm button handler
        const confirmBtn = document.getElementById('confirmMpesaBtn');
        const phoneInput = document.getElementById('mpesaPhoneInput');

        const validateAndConfirm = () => {
            const rawPhone = phoneInput ? phoneInput.value.trim() : '';
            // Validation: must start with 07, 01, or 254
            if (!rawPhone.match(/^(07|01|254)/)) {
                showNotification('Please enter a valid phone number starting with 07, 01, or 254', 'error');
                return;
            }
            // Additional basic length check (optional but user-friendly)
            if (rawPhone.length < 9) {
                showNotification('Phone number too short', 'error');
                return;
            }
            resolveWith(rawPhone);
        };

        if (confirmBtn) confirmBtn.onclick = validateAndConfirm;

        // Cancel via close button, backdrop, or ESC
        modalElement.addEventListener('hidden.bs.modal', () => {
            if (!resolved) resolveWith(null);
        });

        // Show modal
        modal.show();
        // Auto-focus the input
        setTimeout(() => {
            if (phoneInput) phoneInput.focus();
        }, 150);
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
// DATA LOADING
// ---------------------------------------------------------------------------
async function loadPOSData() {
    await loadSettings();
    const { data: prodData } = await supabaseClient
        .from('products')
        .select('*, categories(name)')
        .eq('is_active', true);
    products = prodData || [];
    const { data: catData } = await supabaseClient
        .from('categories')
        .select('*')
        .eq('is_active', true);
    categories = catData || [];
    renderCategories();
    renderProducts(); // will show nothing initially because no category selected and search empty
}

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------
function renderCategories() {
    const container = document.getElementById('categoryFilter');
    if (!container) return;
    // Clear container and add category buttons, but no active button by default
    container.innerHTML = '<button class="btn btn-sm btn-outline-primary" data-cat="all">All</button>';
    categories.forEach(cat => {
        container.innerHTML += `<button class="btn btn-sm btn-outline-primary" data-cat="${cat.id}">${escapeHtml(cat.name)}</button>`;
    });
    // Remove active class from all initially
    document.querySelectorAll('#categoryFilter button').forEach(btn => btn.classList.remove('active'));
    
    document.querySelectorAll('#categoryFilter button').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#categoryFilter button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProducts();
        };
    });
}

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
function renderProducts() {
    const search    = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const activeCat = document.querySelector('#categoryFilter button.active')?.dataset.cat;
    
    // If no category selected and search is empty, show nothing
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
    
    grid.innerHTML = filtered.map(p => `
        <div class="product-card ${p.stock_quantity <= 0 ? 'out-of-stock' : ''}"
             onclick="addToCart(${p.id})">
            <i class="fas fa-box fa-2x text-muted"></i>
            <div class="product-name">${escapeHtml(p.name)}</div>
            ${p.description ? `<div class="product-desc small text-muted mt-1">${escapeHtml(p.description)}</div>` : ''}
            <div class="product-price">${formatCurrency(p.price)}</div>
            <small class="text-muted">Stock: ${p.stock_quantity}</small>
        </div>
    `).join('');
}

// ---------------------------------------------------------------------------
// CART
// ---------------------------------------------------------------------------
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_quantity <= 0) return;
    const existing = cart.find(i => i.id === productId);
    if (existing) {
        if (existing.quantity >= product.stock_quantity) {
            showNotification('Not enough stock', 'warning');
            return;
        }
        existing.quantity++;
    } else {
        cart.push({
            id:          product.id,
            name:        product.name,
            description: product.description || '',
            price:       parseFloat(product.price),
            quantity:    1,
        });
    }
    renderCart();
}

function updateQuantity(id, delta) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    const product = products.find(p => p.id === id);
    const newQty  = item.quantity + delta;
    if (delta > 0 && newQty > product.stock_quantity) {
        showNotification('Not enough stock', 'warning');
        return;
    }
    item.quantity = newQty;
    if (item.quantity <= 0) cart = cart.filter(i => i.id !== id);
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
    container.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-name">${escapeHtml(item.name)}</div>
            ${item.description ? `<div class="cart-item-desc small text-muted">${escapeHtml(item.description)}</div>` : ''}
            <div class="d-flex align-items-center gap-2 mt-1">
                <button class="quantity-btn" onclick="updateQuantity(${item.id}, -1)"><i class="fas fa-minus"></i></button>
                <span>${item.quantity}</span>
                <button class="quantity-btn" onclick="updateQuantity(${item.id}, 1)"><i class="fas fa-plus"></i></button>
            </div>
            <div class="cart-item-price">${formatCurrency(item.price * item.quantity)}</div>
        </div>
    `).join('');
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
// COMPLETE SALE (with M-PESA integration – no browser prompts)
// ---------------------------------------------------------------------------
async function completeSale() {
    if (!cart.length) {
        showNotification('Cart is empty', 'error');
        return;
    }
    const method = document.getElementById('paymentMethod').value;

    // Parse total
    const totalText = document.getElementById('total').innerText;
    const total = parseFloat(totalText.replace(/[^0-9.]+/g, '')) || 0;
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    const items = cart.map(i => ({ product_id: i.id, quantity: i.quantity }));

    // ------------------- M-PESA (Mobile) -------------------
    if (method === 'mobile') {
        // Show UI phone input modal instead of browser prompt
        const phone = await showPhoneInputModal();
        if (!phone) {
            // User cancelled
            return;
        }

        // Create pending sale (no inventory deduction)
        const { data: saleData, error: saleError } = await supabaseClient.rpc('process_sale_pending', {
            p_cashier_id: currentUser.id,
            p_items: items,
            p_discount: discount,
            p_payment_method: method
        });

        if (saleError) {
            showNotification('Sale creation failed: ' + saleError.message, 'error');
            return;
        }

        const saleId = saleData.id;
        const transactionNumber = saleData.transaction_number;

        // Initiate STK push
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

        // Poll for payment status
        pendingPaymentSaleId = saleId;
        paymentCheckInterval = setInterval(async () => {
            const { data: saleCheck, error: checkError } = await supabaseClient
                .from('sales')
                .select('payment_status, payment_reference')
                .eq('id', saleId)
                .single();

            if (checkError) return;

            if (saleCheck.payment_status === 'completed') {
                clearInterval(paymentCheckInterval);
                paymentCheckInterval = null;
                pendingPaymentSaleId = null;
                showNotification('Payment successful! Transaction: ' + transactionNumber, 'success');
                const receiptSnapshot = { items: cart.map(i => ({ ...i })), discount, tendered: 0 };
                generateReceipt(transactionNumber, receiptSnapshot, 0, saleCheck.payment_reference);
                clearCart();
                await loadPOSData();
            } else if (saleCheck.payment_status === 'failed') {
                clearInterval(paymentCheckInterval);
                paymentCheckInterval = null;
                pendingPaymentSaleId = null;
                showNotification('Payment failed. Please try again.', 'error');
            }
        }, 3000);

        return;
    }

    // ------------------- CASH -------------------
    const tendered = parseFloat(document.getElementById('amountTendered')?.value) || 0;
    if (method === 'cash' && tendered < total) {
        showNotification(`Insufficient payment. Please enter at least ${formatCurrency(total)}.`, 'error');
        return;
    }

    const { data, error } = await supabaseClient.rpc('process_sale', {
        p_cashier_id: currentUser.id,
        p_items: items,
        p_discount: discount,
        p_payment_method: method,
    });

    if (error) {
        showNotification('Sale failed: ' + error.message, 'error');
        return;
    }

    showNotification('Sale completed! Transaction: ' + data.transaction_number);
    const receiptSnapshot = { items: cart.map(i => ({ ...i })), discount, tendered };
    generateReceipt(data.transaction_number, receiptSnapshot, tendered);
    clearCart();
    await loadPOSData();
}

// ---------------------------------------------------------------------------
// RECEIPT GENERATION (with payment reference)
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
            <td class="text-center">${item.quantity}</td>
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
async function sendReceiptEmailFromModal(transactionNumber) {
    const email = document.getElementById('receiptEmail')?.value.trim();
    if (!email) {
        showNotification('Please enter an email address', 'warning');
        return;
    }
    const receiptHtml = globalThis._lastReceiptHTML || document.getElementById('receiptContent')?.innerHTML || '';
    await globalThis.sendReceiptEmail(email, receiptHtml, transactionNumber);
}

async function sendReceiptSMSFromModal(transactionNumber) {
    const phone = document.getElementById('receiptPhone')?.value.trim();
    if (!phone) {
        showNotification('Please enter a phone number', 'warning');
        return;
    }
    const total = document.getElementById('total')?.innerText || '';
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

    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }
});

// Expose functions globally
globalThis.sendReceiptEmailFromModal = sendReceiptEmailFromModal;
globalThis.sendReceiptSMSFromModal   = sendReceiptSMSFromModal;
globalThis.addToCart = addToCart;
globalThis.updateQuantity = updateQuantity;
globalThis.clearCart = clearCart;
globalThis.completeSale = completeSale;
globalThis.generateReceipt = generateReceipt;
globalThis.printReceipt = printReceipt;