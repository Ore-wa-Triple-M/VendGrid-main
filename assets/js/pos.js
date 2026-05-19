// =============================================================================
// POS PAGE LOGIC — FINAL MERGED (Production-Ready)
// =============================================================================

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------


let products     = [];
let cart         = [];
let categories   = [];
let taxRate      = 16;        // Overwritten by loadSettings(); default is 16 %
let businessInfo = {
    name:    'VendGrid Store',
    address: '',
    phone:   '',
    email:   '',
    logoUrl: null,
};


// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
async function loadSettings() {
    const settings = await fetchSettings();   // defined in shared utility file
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
    renderProducts();
}

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------
function renderCategories() {
    const container = document.getElementById('categoryFilter');
    container.innerHTML = '<button class="btn btn-sm btn-outline-primary active" data-cat="all">All</button>';
    categories.forEach(cat => {
        container.innerHTML += `<button class="btn btn-sm btn-outline-primary" data-cat="${cat.id}">${cat.name}</button>`;
    });
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
    const search    = document.getElementById('searchInput').value.toLowerCase();
    const activeCat = document.querySelector('#categoryFilter button.active')?.dataset.cat;
    const filtered = products.filter(p => {
        const matchCat    = activeCat === 'all' || p.category_id == activeCat;
        const matchSearch = p.name.toLowerCase().includes(search) ||
                            (p.sku || '').toLowerCase().includes(search) ||
                            (p.barcode || '').toLowerCase().includes(search);
        return matchCat && matchSearch;
    });
    const grid = document.getElementById('productGrid');
    grid.innerHTML = filtered.map(p => `
        <div class="product-card ${p.stock_quantity <= 0 ? 'out-of-stock' : ''}"
             onclick="addToCart(${p.id})">
            <i class="fas fa-box fa-2x text-muted"></i>
            <div class="product-name">${p.name}</div>
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
            id:       product.id,
            name:     product.name,
            price:    parseFloat(product.price),
            quantity: 1,
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
}

function renderCart() {
    const container = document.getElementById('cartItems');
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
            <div class="cart-item-name">${item.name}</div>
            <div class="d-flex align-items-center gap-2">
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
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    const tax      = subtotal * (taxRate / 100);
    const total    = subtotal + tax - discount;
    document.getElementById('subtotal').innerText = formatCurrency(subtotal);
    document.getElementById('tax').innerText      = formatCurrency(tax);
    document.getElementById('total').innerText    = formatCurrency(Math.max(0, total));
    updateChange();
}

// ---------------------------------------------------------------------------
// CASH SECTION
// ---------------------------------------------------------------------------
function toggleCashSection() {
    const method  = document.getElementById('paymentMethod').value;
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
    const totalText     = document.getElementById('total')?.innerText || '0';
    const total         = parseFloat(totalText.replace(/[^0-9.-]+/g, '')) || 0;
    const tendered      = parseFloat(document.getElementById('amountTendered')?.value) || 0;
    const change        = Math.max(0, tendered - total);
    const changeDisplay = document.getElementById('changeAmount');
    if (changeDisplay) changeDisplay.innerText = formatCurrency(change);
}

// ---------------------------------------------------------------------------
// COMPLETE SALE
// ---------------------------------------------------------------------------
async function completeSale() {
    if (!cart.length) {
        showNotification('Cart is empty', 'error');
        return;
    }
    const method = document.getElementById('paymentMethod').value;
    const total  = parseFloat(document.getElementById('total').innerText.replace(/[^0-9.-]+/g, '')) || 0;
    if (method === 'cash') {
        const tendered = parseFloat(document.getElementById('amountTendered').value) || 0;
        if (tendered < total) {
            showNotification(`Insufficient payment. Please enter at least ${formatCurrency(total)}.`, 'error');
            return;
        }
    }
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    const items    = cart.map(i => ({ product_id: i.id, quantity: i.quantity }));
    const { data, error } = await supabaseClient.rpc('process_sale', {
        p_cashier_id:     currentUser.id,
        p_items:          items,
        p_discount:       discount,
        p_payment_method: method,
    });
    if (error) {
        showNotification('Sale failed: ' + error.message, 'error');
        return;
    }
    showNotification('Sale completed! Transaction: ' + data.transaction_number);
    const receiptSnapshot = {
        items:    cart.map(i => ({ ...i })),
        discount,
    };
    generateReceipt(data.transaction_number, receiptSnapshot);
    clearCart();
    await loadPOSData();
}

// ---------------------------------------------------------------------------
// RECEIPT GENERATION (with email/SMS buttons)
// ---------------------------------------------------------------------------
function generateReceipt(transactionNumber = null, snapshot = null) {
    const receiptItems    = (snapshot && snapshot.items.length) ? snapshot.items : cart;
    const receiptDiscount = snapshot ? snapshot.discount : (parseFloat(document.getElementById('discount').value) || 0);
    if (!receiptItems.length) {
        showNotification('Cart is empty', 'warning');
        return;
    }
    const subtotal = receiptItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount = receiptDiscount;
    const tax      = subtotal * (taxRate / 100);
    const total    = Math.max(0, subtotal + tax - discount);
    const method   = document.getElementById('paymentMethod').value;
    const cashier  = currentProfile?.first_name || currentUser?.email || 'Cashier';
    const now      = new Date();
    const dateStr  = now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr  = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
    const itemsHTML = receiptItems.map(item => `
        <tr>
            <td class="ps-0">${escapeHtml(item.name)}</td>
            <td class="text-center">${item.quantity}</td>
            <td class="text-end">${formatCurrency(item.price)}</td>
            <td class="text-end pe-0">${formatCurrency(item.price * item.quantity)}</td>
        </tr>
    `).join('');
    const businessName    = escapeHtml(businessInfo.name || 'VendGrid Store');
    const businessAddress = businessInfo.address ? `<div class="small text-muted">${escapeHtml(businessInfo.address)}</div>` : '';
    const businessPhone   = businessInfo.phone ? `<div class="small text-muted">Tel: ${escapeHtml(businessInfo.phone)}</div>` : '';
    const businessEmail   = businessInfo.email ? `<div class="small text-muted">Email: ${escapeHtml(businessInfo.email)}</div>` : '';
    const logoHtml = businessInfo.logoUrl 
        ? `<img src="${businessInfo.logoUrl}" style="max-height: 60px; margin-bottom: 10px;">`
        : `<i class="fas fa-cash-register fa-2x text-primary mb-2"></i>`;
    const txnRow = transactionNumber ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Transaction #:</small>
            <small>${transactionNumber}</small>
        </div>` : '';

    // Store receipt data globally for email/SMS functions
    window._lastReceiptHTML = `
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
        <hr class="border-dashed">
        <table class="table table-sm mb-0">
            <thead>
                <tr class="border-bottom">
                    <th class="ps-0">Item</th>
                    <th class="text-center">Qty</th>
                    <th class="text-end">Price</th>
                    <th class="text-end pe-0">Total</th>
                </tr>
            </thead>
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
        ${discount > 0 ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Discount</small>
            <small class="text-danger">- ${formatCurrency(discount)}</small>
        </div>` : ''}
        <hr class="border-dashed">
        <div class="d-flex justify-content-between fw-bold fs-5 mb-3">
            <span>Total</span>
            <span class="text-primary">${formatCurrency(total)}</span>
        </div>
     
        <div class="text-center">
            <small class="text-muted">Thank you for your purchase!</small>
        </div>
    `;

    document.getElementById('receiptContent').innerHTML = `
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

       

        <hr class="border-dashed">
        <table class="table table-sm mb-0">
            <thead>
                <tr class="border-bottom">
                    <th class="ps-0">Item</th>
                    <th class="text-center">Qty</th>
                    <th class="text-end">Price</th>
                    <th class="text-end pe-0">Total</th>
                </tr>
            </thead>
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
        ${discount > 0 ? `
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Discount</small>
            <small class="text-danger">- ${formatCurrency(discount)}</small>
        </div>` : ''}
        <hr class="border-dashed">
        <div class="d-flex justify-content-between fw-bold fs-5 mb-3">
            <span>Total</span>
            <span class="text-primary">${formatCurrency(total)}</span>
        </div>
        <div class="text-center">
            <small class="text-muted">Thank you for your purchase!</small>
        </div>
    `;

    // Store transaction number for email/SMS functions
    window._lastTransactionNumber = transactionNumber;
    new bootstrap.Modal(document.getElementById('receiptModal')).show();
}

// ---------------------------------------------------------------------------
// – Send email/SMS from modal
// ---------------------------------------------------------------------------
async function sendReceiptEmailFromModal(transactionNumber) {
    const email = document.getElementById('receiptEmail')?.value.trim();
    if (!email) {
        showNotification('Please enter an email address', 'warning');
        return;
    }
    // Use stored receipt HTML (without the email/SMS fields to avoid duplication)
    let receiptHtml = window._lastReceiptHTML;
    if (!receiptHtml) {
        receiptHtml = document.getElementById('receiptContent')?.innerHTML || '';
    }
    await window.sendReceiptEmail(email, receiptHtml, transactionNumber);
}

async function sendReceiptSMSFromModal(transactionNumber) {
    const phone = document.getElementById('receiptPhone')?.value.trim();
    if (!phone) {
        showNotification('Please enter a phone number', 'warning');
        return;
    }
    const total = document.getElementById('total')?.innerText || '';
    const shortSummary = `VendGrid receipt #${transactionNumber} | Total ${total}`;
    await window.sendReceiptSMS(phone, shortSummary);
}

function printReceipt() {
    const content = document.getElementById('receiptContent').innerHTML;
    const win = window.open('', '_blank', 'width=420,height=600');
    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Receipt - VendGrid</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
            <style>
                body { padding: 20px; font-size: 13px; }
                .border-dashed { border-style: dashed !important; }
                @media print { body { padding: 0; } }
            </style>
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

    // ROLE RESTRICTION
    const allowedRoles = ['admin', 'manager', 'cashier'];
    if (!allowedRoles.includes(currentProfile?.role)) {
        showNotification('Access denied. Only cashiers, managers and admins can use POS.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 2000);
        return;
    }

    document.getElementById('userName').innerText = currentProfile?.first_name || currentUser.email;
    await loadPOSData();
    toggleCashSection();
    
    // Apply sidebar access (hide inaccessible pages)
    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }
});

// Expose email/SMS functions globally (for inline onclick)
window.sendReceiptEmailFromModal = sendReceiptEmailFromModal;
window.sendReceiptSMSFromModal = sendReceiptSMSFromModal;