// POS page logic
let products = [], cart = [], categories = [];

async function loadPOSData() {
    const { data: prodData } = await supabaseClient.from('products').select('*, categories(name)').eq('is_active', true);
    products = prodData || [];
    const { data: catData } = await supabaseClient.from('categories').select('*').eq('is_active', true);
    categories = catData || [];
    renderCategories();
    renderProducts();
}

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

function renderProducts() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const activeCat = document.querySelector('#categoryFilter button.active')?.dataset.cat;
    const filtered = products.filter(p => {
        const matchCat = activeCat === 'all' || p.category_id == activeCat;
        const matchSearch = p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search);
        return matchCat && matchSearch;
    });
    const grid = document.getElementById('productGrid');
    grid.innerHTML = filtered.map(p => `
        <div class="product-card ${p.stock_quantity <= 0 ? 'out-of-stock' : ''}" onclick="addToCart(${p.id})">
            <i class="fas fa-box fa-2x text-muted"></i>
            <div class="product-name">${p.name}</div>
            <div class="product-price">${formatCurrency(p.price)}</div>
            <small class="text-muted">Stock: ${p.stock_quantity}</small>
        </div>
    `).join('');
}

function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_quantity <= 0) return;
    const existing = cart.find(i => i.id === productId);
    if (existing) {
        const product = products.find(p => p.id === productId);
        if (existing.quantity >= product.stock_quantity) {
            showNotification('Not enough stock', 'warning');
            return;
        }
        existing.quantity++;
    }
    else cart.push({ id: product.id, name: product.name, price: parseFloat(product.price), quantity: 1 });
    renderCart();
}

function updateQuantity(id, delta) {
    const item = cart.find(i => i.id === id);
    if (item) {
        const product = products.find(p => p.id === id);
        const newQty = item.quantity + delta;
        if (delta > 0 && newQty > product.stock_quantity) {
            showNotification('Not enough stock', 'warning');
            return;
        }
        item.quantity = newQty;
        if (item.quantity <= 0) cart = cart.filter(i => i.id !== id);
        renderCart();
    }
}
function clearCart() { cart = []; renderCart(); }

function renderCart() {
    const container = document.getElementById('cartItems');
    if (!cart.length) {
        container.innerHTML = '<div class="text-center text-muted p-5"><i class="fas fa-shopping-basket fa-3x mb-3"></i><p>Cart is empty</p></div>';
        document.getElementById('subtotal').innerText = formatCurrency(0);
        document.getElementById('tax').innerText = formatCurrency(0);
        document.getElementById('total').innerText = formatCurrency(0);
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
    const tax = subtotal * 0.16;
    const total = subtotal + tax - discount;
    document.getElementById('subtotal').innerText = formatCurrency(subtotal);
    document.getElementById('tax').innerText = formatCurrency(tax);
    document.getElementById('total').innerText = formatCurrency(Math.max(0, total));
}

async function completeSale() {
    if (!cart.length) { showNotification('Cart is empty', 'error'); return; }
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    const method = document.getElementById('paymentMethod').value;
    const items = cart.map(i => ({ product_id: i.id, quantity: i.quantity }));

    const { data, error } = await supabaseClient.rpc('process_sale', {
        p_cashier_id: currentUser.id,
        p_items: items,
        p_discount: discount,
        p_payment_method: method
    });
    if (error) {
        showNotification('Sale failed: ' + error.message, 'error');
    } else {
        showNotification('Sale completed! Transaction: ' + data.transaction_number);
        clearCart();
        loadPOSData(); // refresh stock
    }
}

document.getElementById('searchInput')?.addEventListener('input', renderProducts);
document.getElementById('discount')?.addEventListener('input', updateTotals);

document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;
    document.getElementById('userName').innerText = currentProfile?.first_name || currentUser.email;
    await loadPOSData();
});




function generateReceipt() {
    if (!cart.length) {
        showNotification('Cart is empty', 'warning');
        return;
    }

    const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    const tax = subtotal * 0.16;
    const total = Math.max(0, subtotal + tax - discount);
    const method = document.getElementById('paymentMethod').value;
    const cashier = currentProfile?.first_name || currentUser?.email || 'Cashier';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

    const itemsHTML = cart.map(item => `
        <tr>
            <td>${item.name}</td>
            <td class="text-center">${item.quantity}</td>
            <td class="text-end">${formatCurrency(item.price)}</td>
            <td class="text-end">${formatCurrency(item.price * item.quantity)}</td>
        </tr>
    `).join('');

    document.getElementById('receiptContent').innerHTML = `
        <div class="text-center mb-3">
            <i class="fas fa-cash-register fa-2x text-primary mb-2"></i>
            <h5 class="fw-bold mb-0">VendGrid Store</h5>
            <small class="text-muted">Official Receipt</small>
        </div>

        <hr class="border-dashed">

        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Date:</small>
            <small>${dateStr} ${timeStr}</small>
        </div>
        <div class="d-flex justify-content-between mb-1">
            <small class="text-muted">Cashier:</small>
            <small>${cashier}</small>
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
            <small class="text-muted">VAT (16%)</small>
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

    new bootstrap.Modal(document.getElementById('receiptModal')).show();
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