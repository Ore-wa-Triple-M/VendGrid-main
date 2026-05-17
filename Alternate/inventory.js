/**
 * inventory.js – VendGrid Inventory Module
 * 
 * Supports:
 * - Products table with search + category filter
 * - Add/Edit/Delete products
 * - Stock adjustments
 * - Suppliers CRUD
 * - Purchase Orders (create, receive, cancel)
 * - Stock movements history
 * 
 * All alerts replaced with toast notifications.
 */

// ============================================================
//  Global references & helper
// ============================================================
let allProducts = [];
let allCategories = [];
let allSuppliers = [];

// Helper: escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ============================================================
//  PRODUCTS
// ============================================================

// Load products & categories from Supabase
async function loadProducts() {
    const { data: products, error: prodErr } = await supabaseClient
        .from('products')
        .select('*, categories(name)')
        .eq('is_active', true);
    if (prodErr) {
        showNotification('Failed to load products: ' + prodErr.message, 'error');
        return;
    }
    allProducts = products || [];

    const { data: categories, error: catErr } = await supabaseClient
        .from('categories')
        .select('*')
        .eq('is_active', true);
    if (!catErr) allCategories = categories || [];

    // Populate category filter dropdown
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.innerHTML = '<option value="">All Categories</option>' +
            allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }

    // Populate product modal category dropdown
    const modalCategory = document.getElementById('productCategory');
    if (modalCategory) {
        modalCategory.innerHTML = '<option value="">— None —</option>' +
            allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }

    // Render the product table
    renderProductsTable();
}

// Render product table (called after load or filter)
function renderProductsTable() {
    const search = document.getElementById('productSearch')?.value.toLowerCase() || '';
    const categoryId = document.getElementById('categoryFilter')?.value || '';
    const filtered = allProducts.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search);
        const matchCat = !categoryId || p.category_id == categoryId;
        return matchSearch && matchCat;
    });

    const tbody = document.getElementById('productsTable');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const cat = allCategories.find(c => c.id == p.category_id);
        return `
            <tr>
                <td><code>${escapeHtml(p.sku)}</code></td>
                <td>${escapeHtml(p.name)}</td>
                <td>${cat ? escapeHtml(cat.name) : '—'}</td>
                <td>${parseFloat(p.price).toFixed(2)}</td>
                <td>${parseFloat(p.cost).toFixed(2)}</td>
                <td><span class="badge bg-success">Active</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="INV.openProductModal(${p.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="INV.deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

// Filter products (called from search input & category dropdown)
function filterProducts() {
    renderProductsTable();
}

// Open product modal (add/edit)
function openProductModal(id = null) {
    // Reset form
    document.getElementById('productId').value = '';
    document.getElementById('prodSku').value = '';
    document.getElementById('prodName').value = '';
    document.getElementById('prodDesc').value = '';
    document.getElementById('prodPrice').value = '';
    document.getElementById('prodCost').value = '';
    document.getElementById('prodBarcode').value = '';
    document.getElementById('productCategory').value = '';
    document.getElementById('prodActive').value = '1';
    document.getElementById('productModalTitle').textContent = 'Add Product';

    if (id) {
        const product = allProducts.find(p => p.id === id);
        if (product) {
            document.getElementById('productId').value = product.id;
            document.getElementById('prodSku').value = product.sku || '';
            document.getElementById('prodName').value = product.name;
            document.getElementById('prodDesc').value = product.description || '';
            document.getElementById('prodPrice').value = product.price;
            document.getElementById('prodCost').value = product.cost || 0;
            document.getElementById('prodBarcode').value = product.barcode || '';
            document.getElementById('productCategory').value = product.category_id || '';
            document.getElementById('prodActive').value = product.is_active ? '1' : '0';
            document.getElementById('productModalTitle').textContent = 'Edit Product';
        }
    }
    new bootstrap.Modal(document.getElementById('productModal')).show();
}

// Save product (called from modal)
async function saveProduct() {
    const id = document.getElementById('productId').value;
    const data = {
        sku: document.getElementById('prodSku').value.trim(),
        name: document.getElementById('prodName').value.trim(),
        description: document.getElementById('prodDesc').value.trim(),
        price: parseFloat(document.getElementById('prodPrice').value) || 0,
        cost: parseFloat(document.getElementById('prodCost').value) || 0,
        barcode: document.getElementById('prodBarcode').value.trim() || null,
        category_id: document.getElementById('productCategory').value || null,
        is_active: parseInt(document.getElementById('prodActive').value) === 1,
        stock_quantity: 0   // default; stock is managed separately
    };
    if (!data.name) {
        showNotification('Product name is required', 'warning');
        return;
    }
    if (!data.sku) data.sku = 'SKU-' + Date.now();

    let result;
    if (id) {
        result = await supabaseClient.from('products').update(data).eq('id', id);
    } else {
        result = await supabaseClient.from('products').insert(data);
    }
    if (result.error) {
        showNotification('Error: ' + result.error.message, 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
        showNotification(id ? 'Product updated' : 'Product created', 'success');
        await loadProducts();
    }
}

// ── Shared custom confirm modal ───────────────────────────────
// Shows a Bootstrap modal and calls onConfirm() if user clicks OK.
// Pass optional title/message to reuse for different actions.
function showConfirmModal(onConfirm, title = 'Confirm', message = 'Are you sure?') {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    const modal = new bootstrap.Modal(document.getElementById('confirmModal'));
    modal.show();

    // Remove any previous listener to avoid stacking
    const okBtn = document.getElementById('confirmModalOk');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);

    newOkBtn.addEventListener('click', () => {
        modal.hide();
        onConfirm();
    });
}

// Delete product (soft delete — sets is_active = false)
async function deleteProduct(id) {
    showConfirmModal(async () => {
        const { error } = await supabaseClient
            .from('products')
            .update({ is_active: false })
            .eq('id', id);
        if (error) {
            showNotification('Delete failed: ' + error.message, 'error');
        } else {
            showNotification('Product deleted', 'success');
            await loadProducts();
        }
    }, 'Delete Product', 'Are you sure you want to delete this product? This cannot be undone.');
}

// ============================================================
//  STOCK
// ============================================================

// Load stock levels table
async function loadStock() {
    const { data: stock, error } = await supabaseClient
        .from('stock_movements')
        .select('*');
    if (error) {
        showNotification('Failed to load stock: ' + error.message, 'error');
        return;
    }
    const tbody = document.getElementById('stockTable');
    if (!stock?.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No stock records</td></tr>';
        return;
    }
    tbody.innerHTML = stock.map(s => {
        const isLow = s.reorder_point > 0 && s.quantity <= s.reorder_point;
        return `
            <tr class="${isLow ? 'table-warning' : ''}">
                <td>${s.product_id}</td>
                <td>${s.location_id}</td>
                <td><strong>${s.quantity}</strong></td>
                <td>${s.reorder_point}</td>
                <td>${isLow ? '<span class="badge bg-warning text-dark">Low Stock</span>' : '<span class="badge bg-success">OK</span>'}</td>
            </tr>
        `;
    }).join('');
}

function openAdjustModal() {
    new bootstrap.Modal(document.getElementById('adjustModal')).show();
}

async function adjustStock() {
    const productId = parseInt(document.getElementById('adjProductId').value);
    const locationId = parseInt(document.getElementById('adjLocationId').value);
    const quantity = parseInt(document.getElementById('adjQty').value);
    const reorderPoint = parseInt(document.getElementById('adjReorder').value) || 0;

    if (!productId || isNaN(quantity)) {
        showNotification('Product ID and quantity are required', 'warning');
        return;
    }

    // First, check if stock record exists; if not, create it
    const { data: existing, error: fetchErr } = await supabaseClient
        .from('stock_movements')
        .select('*')
        .eq('product_id', productId)
        .eq('location_id', locationId)
        .maybeSingle();

    if (fetchErr && fetchErr.code !== 'PGRST116') {
        showNotification('Error checking stock: ' + fetchErr.message, 'error');
        return;
    }

    let result;
    if (existing) {
        const newQty = existing.quantity + quantity;
        if (newQty < 0) {
            showNotification('Stock cannot become negative', 'error');
            return;
        }
        result = await supabaseClient
            .from('stock')
            .update({ quantity: newQty, reorder_point: reorderPoint })
            .eq('id', existing.id);
    } else {
        if (quantity < 0) {
            showNotification('Cannot deduct from non‑existent stock', 'error');
            return;
        }
        result = await supabaseClient
            .from('stock')
            .insert({ product_id: productId, location_id: locationId, quantity, reorder_point: reorderPoint });
    }

    if (result.error) {
        showNotification('Stock adjustment failed: ' + result.error.message, 'error');
    } else {
        // Record movement
        await supabaseClient.from('stock_movements').insert({
            product_id: productId,
            movement_type: 'ADJUSTMENT',
            quantity: quantity,
            notes: 'Manual adjustment',
            created_by: currentUser?.id,
            location_id: locationId
        });
        bootstrap.Modal.getInstance(document.getElementById('adjustModal')).hide();
        showNotification('Stock adjusted', 'success');
        await loadStock();
    }
}

// ============================================================
//  SUPPLIERS
// ============================================================

async function loadSuppliers() {
    const { data: suppliers, error } = await supabaseClient
        .from('suppliers')
        .select('*')
        .order('name');
    if (error) {
        showNotification('Failed to load suppliers: ' + error.message, 'error');
        return;
    }
    allSuppliers = suppliers || [];
    const tbody = document.getElementById('suppliersTable');
    if (!allSuppliers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No suppliers</td></tr>';
        return;
    }
    tbody.innerHTML = allSuppliers.map(s => `
        <tr>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.contact_person || '—')}</td>
            <td>${escapeHtml(s.email || '—')}</td>
            <td>${escapeHtml(s.phone || '—')}</td>
            <td><span class="badge bg-${s.is_active ? 'success' : 'secondary'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="INV.openSupplierModal(${s.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="INV.deleteSupplier(${s.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openSupplierModal(id = null) {
    // Reset form
    document.getElementById('supplierId').value = '';
    document.getElementById('suppName').value = '';
    document.getElementById('suppContact').value = '';
    document.getElementById('suppEmail').value = '';
    document.getElementById('suppPhone').value = '';
    document.getElementById('suppAddress').value = '';
    document.getElementById('supplierModalTitle').textContent = 'Add Supplier';

    if (id) {
        const supplier = allSuppliers.find(s => s.id === id);
        if (supplier) {
            document.getElementById('supplierId').value = supplier.id;
            document.getElementById('suppName').value = supplier.name;
            document.getElementById('suppContact').value = supplier.contact_person || '';
            document.getElementById('suppEmail').value = supplier.email || '';
            document.getElementById('suppPhone').value = supplier.phone || '';
            document.getElementById('suppAddress').value = supplier.address || '';
            document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
        }
    }
    new bootstrap.Modal(document.getElementById('supplierModal')).show();
}

async function saveSupplier() {
    const id = document.getElementById('supplierId').value;
    const data = {
        name: document.getElementById('suppName').value.trim(),
        contact_person: document.getElementById('suppContact').value.trim() || null,
        email: document.getElementById('suppEmail').value.trim() || null,
        phone: document.getElementById('suppPhone').value.trim() || null,
        address: document.getElementById('suppAddress').value.trim() || null,
        is_active: true
    };
    if (!data.name) {
        showNotification('Supplier name is required', 'warning');
        return;
    }

    let result;
    if (id) {
        result = await supabaseClient.from('suppliers').update(data).eq('id', id);
    } else {
        result = await supabaseClient.from('suppliers').insert(data);
    }
    if (result.error) {
        showNotification('Error: ' + result.error.message, 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('supplierModal')).hide();
        showNotification(id ? 'Supplier updated' : 'Supplier created', 'success');
        await loadSuppliers();
        // Also refresh PO supplier dropdowns if needed
        await loadSuppliersForPO();
    }
}

async function deleteSupplier(id) {
    showConfirmModal(async () => {
        const { error } = await supabaseClient
            .from('suppliers')
            .update({ is_active: false })
            .eq('id', id);
        if (error) {
            showNotification('Delete failed: ' + error.message, 'error');
        } else {
            showNotification('Supplier deleted', 'success');
            await loadSuppliers();
            await loadSuppliersForPO();
        }
    }, 'Delete Supplier', 'Are you sure you want to delete this supplier?');
}

// ============================================================
//  PURCHASE ORDERS
// ============================================================

async function loadPOs() {
    // Ensure suppliers are loaded for name display
    if (!allSuppliers.length) await loadSuppliersForPO();

    const { data: pos, error } = await supabaseClient
        .from('purchase_orders')
        .select('*')
        .order('order_date', { ascending: false });
    if (error) {
        showNotification('Failed to load POs: ' + error.message, 'error');
        return;
    }
    const tbody = document.getElementById('poTable');
    if (!pos?.length) {
        tbody.innerHTML = '<td><td colspan="6" class="text-center text-muted py-3">No purchase orders</td></tr>';
        return;
    }
    const statusClass = { PENDING: 'warning', APPROVED: 'primary', RECEIVED: 'success', CANCELLED: 'danger' };
    tbody.innerHTML = pos.map(po => {
        const supplier = allSuppliers.find(s => s.id === po.supplier_id);
        return `
            <tr>
                <td><strong>${escapeHtml(po.po_number)}</strong></td>
                <td>${supplier ? escapeHtml(supplier.name) : '#' + po.supplier_id}</td>
                <td><span class="badge bg-${statusClass[po.status] || 'secondary'}">${po.status}</span></td>
                <td>${parseFloat(po.total_amount).toFixed(2)}</td>
                <td>${po.order_date}</td>
                <td>
                    <button class="btn btn-sm btn-outline-success me-1" onclick="INV.markPOReceived(${po.id})" title="Mark Received"><i class="fas fa-check"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="INV.cancelPO(${po.id})" title="Cancel"><i class="fas fa-times"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

async function loadSuppliersForPO() {
    const { data: suppliers, error } = await supabaseClient
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true);
    if (!error) allSuppliers = suppliers || [];
}

async function openPOModal() {
    await loadSuppliersForPO();
    const supplierSelect = document.getElementById('poSupplier');
    if (supplierSelect) {
        supplierSelect.innerHTML = allSuppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    }
    document.getElementById('poNumber').value = 'PO-' + Date.now();
    document.getElementById('poDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('poTotal').value = '';
    document.getElementById('poDelivery').value = '';
    new bootstrap.Modal(document.getElementById('poModal')).show();
}

async function savePO() {
    const poNumber = document.getElementById('poNumber').value.trim();
    const supplierId = parseInt(document.getElementById('poSupplier').value);
    const totalAmount = parseFloat(document.getElementById('poTotal').value) || 0;
    const orderDate = document.getElementById('poDate').value;
    const expectedDelivery = document.getElementById('poDelivery').value || null;

    if (!poNumber || !supplierId || !orderDate) {
        showNotification('PO Number, Supplier and Order Date are required', 'warning');
        return;
    }

    const { error } = await supabaseClient
        .from('purchase_orders')
        .insert({
            po_number: poNumber,
            supplier_id: supplierId,
            total_amount: totalAmount,
            order_date: orderDate,
            expected_delivery_date: expectedDelivery,
            status: 'PENDING',
            created_by: currentUser?.id
        });
    if (error) {
        showNotification('Failed to create PO: ' + error.message, 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('poModal')).hide();
        showNotification('Purchase order created', 'success');
        await loadPOs();
    }
}

async function markPOReceived(id) {
    showConfirmModal(async () => {
        const { error } = await supabaseClient
            .from('purchase_orders')
            .update({ status: 'RECEIVED', received_date: new Date().toISOString().split('T')[0] })
            .eq('id', id);
        if (error) {
            showNotification('Error: ' + error.message, 'error');
        } else {
            showNotification('PO marked as received', 'success');
            await loadPOs();
        }
    }, 'Mark as Received', 'Mark this purchase order as received?');
}

async function cancelPO(id) {
    showConfirmModal(async () => {
        const { error } = await supabaseClient
            .from('purchase_orders')
            .update({ status: 'CANCELLED' })
            .eq('id', id);
        if (error) {
            showNotification('Error: ' + error.message, 'error');
        } else {
            showNotification('PO cancelled', 'success');
            await loadPOs();
        }
    }, 'Cancel Purchase Order', 'Are you sure you want to cancel this purchase order?');
}

// ============================================================
//  STOCK MOVEMENTS
// ============================================================

async function loadMovements() {
    const { data: movements, error } = await supabaseClient
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) {
        showNotification('Failed to load movements: ' + error.message, 'error');
        return;
    }
    const tbody = document.getElementById('movementsTable');
    if (!movements?.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No movements</td></tr>';
        return;
    }
    const typeClass = { IN: 'success', OUT: 'danger', ADJUSTMENT: 'warning', TRANSFER: 'info' };
    tbody.innerHTML = movements.map(m => `
        <tr>
            <td>${m.product_id}</td>
            <td><span class="badge bg-${typeClass[m.movement_type] || 'secondary'}">${m.movement_type}</span></td>
            <td>${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
            <td>${m.reference_type ? m.reference_type + '#' + m.reference_id : '—'}</td>
            <td>${m.notes || '—'}</td>
            <td>${new Date(m.created_at).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

// ============================================================
//  TAB INITIALIZATION & EVENT LISTENERS
// ============================================================

// Load data when a tab is shown
document.querySelector('[href="#products-tab"]')?.addEventListener('shown.bs.tab', loadProducts);
document.querySelector('[href="#stock-tab"]')?.addEventListener('shown.bs.tab', loadStock);
document.querySelector('[href="#suppliers-tab"]')?.addEventListener('shown.bs.tab', loadSuppliers);
document.querySelector('[href="#po-tab"]')?.addEventListener('shown.bs.tab', loadPOs);
document.querySelector('[href="#movements-tab"]')?.addEventListener('shown.bs.tab', loadMovements);

// Search & filter event listeners
document.getElementById('productSearch')?.addEventListener('input', filterProducts);
document.getElementById('categoryFilter')?.addEventListener('change', filterProducts);

// Initial load (default tab is products)
document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;
    // Display user name
    const userNameSpan = document.getElementById('userName');
    if (userNameSpan) {
        userNameSpan.innerText = currentProfile?.first_name || currentUser?.email || 'User';
    }
    await loadProducts();
});

// ============================================================
//  EXPOSE PUBLIC METHODS (for HTML onclick attributes)
// ============================================================
window.INV = {
    filterProducts,
    openProductModal,
    deleteProduct,
    openAdjustModal,
    adjustStock,
    openSupplierModal,
    saveSupplier,
    deleteSupplier,
    openPOModal,
    savePO,
    markPOReceived,
    cancelPO
};

// Also expose saveProduct globally because modal uses onclick="saveProduct()"
window.saveProduct = saveProduct;