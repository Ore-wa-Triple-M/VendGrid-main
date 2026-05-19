/**
 * inventory.js – VendGrid Inventory Module (merged & optimised)
 * 
 * Full RBAC integration: page access check + permission-based UI.
 */

'use strict';

// ============================================================
//  1. UTILITIES
// ============================================================

function showToast(message, type = 'success') {
    const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    const toast = document.createElement('div');
    toast.className = `vg-toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${icons[type] || icons.info}"></i><span>${message}</span>`;
    const container = document.getElementById('toastContainer');
    if (!container) {
        console.warn('toastContainer not found');
        return;
    }
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.4s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

// escapeHtml() provided globally by app.js

function fmt(amount) {
    return parseFloat(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showTableSpinner(tbodyId, cols) {
    const el = document.getElementById(tbodyId);
    if (el) el.innerHTML = `<tr><td colspan="${cols}" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`;
}

// ============================================================
//  2. STATE
// ============================================================

let allProducts        = [];
let allArchivedProducts = [];
let allCategories      = [];
let allSuppliers       = [];
let allPurchaseOrders  = [];
let allStockMovements  = [];

// ============================================================
//  3. PRODUCTS – CRUD with soft delete & restore
// ============================================================

async function loadProducts() {
    showTableSpinner('productsTable', 9);

    const [{ data: products, error: prodErr }, { data: categories }] = await Promise.all([
        supabaseClient
            .from('products')
            .select('*, categories(name)')
            .eq('is_active', true)
            .is('deleted_at', null),
        supabaseClient.from('categories').select('*').eq('is_active', true)
    ]);

    if (prodErr) {
        showToast(getUserFriendlyErrorMessage(prodErr, 'Could not load products. Please check your connection.'), 'error');
        return;
    }

    allProducts   = products   || [];
    allCategories = categories || [];

    _populateCategoryDropdowns();
    renderProductsTable();
    loadArchivedProducts();
}

async function loadArchivedProducts() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: archived, error } = await supabaseClient
        .from('products')
        .select('*, categories(name)')
        .eq('is_active', false)
        .gte('deleted_at', sevenDaysAgo.toISOString())
        .order('deleted_at', { ascending: false });

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Could not load archived products.'), 'error');
        return;
    }

    allArchivedProducts = archived || [];
    renderArchivedProductsTable();
}

async function permanentlyDeleteArchivedProduct(productId, productName) {
    if (!hasPermission('canPermanentlyDeleteProduct')) {
        showToast('You do not have permission to permanently delete products.', 'error');
        return;
    }
    const success = await permanentDeleteRecord('products', productId, productName);
    if (success) {
        await loadArchivedProducts();
        await loadProducts();
    }
}

function _populateCategoryDropdowns() {
    const options = '<option value="">— None —</option>' +
        allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    const filterEl = document.getElementById('categoryFilter');
    if (filterEl) {
        filterEl.innerHTML = '<option value="">All Categories</option>' +
            allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }

    const modalEl = document.getElementById('productCategory');
    if (modalEl) modalEl.innerHTML = options;
}

function renderProductsTable() {
    const search     = (document.getElementById('productSearch')?.value || '').toLowerCase();
    const categoryId = document.getElementById('categoryFilter')?.value || '';

    const filtered = allProducts.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(search) ||
                            (p.sku || '').toLowerCase().includes(search) ||
                            (p.barcode || '').toLowerCase().includes(search);
        const matchCat = !categoryId || String(p.category_id) === categoryId;
        return matchSearch && matchCat;
    });

    const tbody = document.getElementById('productsTable');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const cat = allCategories.find(c => c.id === p.category_id);
        const lowStock = p.stock_quantity <= (p.reorder_point || 5);
        return `
            <tr>
                <td><code>${escapeHtml(p.sku)}</code></td>
                <td>${escapeHtml(p.barcode)}</td>
                <td><strong>${escapeHtml(p.name)}</strong>
                    ${p.description ? `<br><small class="text-muted">${escapeHtml(p.description)}</small>` : ''}
                </td>
                <td>${cat ? escapeHtml(cat.name) : '—'}</td>
                <td>${fmt(p.price)}</td>
                <td>${fmt(p.cost)}</td>
                <td>
                    <span class="${lowStock ? 'text-warning fw-bold' : ''}">${p.stock_quantity}</span>
                    ${lowStock ? '<span class="badge bg-warning text-dark ms-1">Low</span>' : ''}
                </td>
                <td><span class="badge bg-${p.is_active ? 'success' : 'secondary'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
                <td class="text-nowrap">
                    ${hasPermission('canEditProduct') ? `
                    <button class="icon-btn icon-btn-edit" title="Edit" onclick="INV.openProductModal(${p.id})"><i class="fas fa-edit"></i></button>
                    ` : ''}
                    ${hasPermission('canAdjustStock') ? `
                    <button class="icon-btn icon-btn-warn" title="Adjust Stock" onclick="INV.openAdjustModal(${p.id})"><i class="fas fa-warehouse"></i></button>
                    ` : ''}
                    ${hasPermission('canDeleteProduct') ? `
                    <button class="icon-btn icon-btn-delete" title="Delete" onclick="INV.deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function renderArchivedProductsTable() {
    const tbody = document.getElementById('archivedProductsTable');
    if (!tbody) return;

    if (!allArchivedProducts.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No deleted products found</td></tr>';
        return;
    }

    tbody.innerHTML = allArchivedProducts.map(p => {
        const cat = allCategories.find(c => c.id === p.category_id);
        const deletedDate = p.deleted_at ? new Date(p.deleted_at).toLocaleDateString('en-KE') : '—';
        return `
            <tr class="table-secondary">
                <td><code>${escapeHtml(p.sku)}</code></td>
                <td>${escapeHtml(p.barcode)}</td>
                <td><strong>${escapeHtml(p.name)}</strong>
                    ${p.description ? `<br><small class="text-muted">${escapeHtml(p.description)}</small>` : ''}
                </td>
                <td>${cat ? escapeHtml(cat.name) : '—'}</td>
                <td>${fmt(p.price)}</td>
                <td>${fmt(p.cost)}</td>
                <td>${deletedDate}</td>
                <td class="text-nowrap">
                    ${hasPermission('canRestoreProduct') ? `
                    <button class="icon-btn icon-btn-success" title="Restore" onclick="INV.restoreProduct(${p.id})">
                        <i class="fas fa-trash-restore"></i> 
                    </button>
                    ` : ''}
                    ${hasPermission('canPermanentlyDeleteProduct') ? `
                    <button class="icon-btn icon-btn-danger" title="Permanently Delete" onclick="INV.permanentlyDeleteArchivedProduct(${p.id}, '${escapeHtml(p.name)}')">
                        <i class="fas fa-skull-crossbones"></i> 
                    </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function openProductModal(id = null) {
    if (!hasPermission('canAddProduct') && !hasPermission('canEditProduct')) {
        showToast('You do not have permission to add or edit products.', 'error');
        return;
    }
    const fields = {
        productId: '', prodSku: '', prodBarcode: '', prodName: '',
        prodDesc: '', prodPrice: '', prodCost: '', prodStock: '0',
        prodReorder: '5', productCategory: '', prodActive: '1'
    };
    Object.entries(fields).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
    document.getElementById('productModalTitle').textContent = 'Add Product';

    if (id) {
        const p = allProducts.find(p => p.id === id);
        if (!p) return;
        document.getElementById('productId').value       = p.id;
        document.getElementById('prodSku').value         = p.sku || '';
        document.getElementById('prodBarcode').value     = p.barcode || '';
        document.getElementById('prodName').value        = p.name;
        document.getElementById('prodDesc').value        = p.description || '';
        document.getElementById('prodPrice').value       = p.price;
        document.getElementById('prodCost').value        = p.cost || 0;
        document.getElementById('prodStock').value       = p.stock_quantity || 0;
        document.getElementById('prodReorder').value     = p.reorder_point || 5;
        document.getElementById('productCategory').value = p.category_id || '';
        document.getElementById('prodActive').value      = p.is_active ? '1' : '0';
        document.getElementById('productModalTitle').textContent = 'Edit Product';
    }

    new bootstrap.Modal(document.getElementById('productModal')).show();
}

async function saveProduct() {
    const id = document.getElementById('productId').value;
    const name = document.getElementById('prodName').value.trim();

    if (!name) { showToast('Product name is required', 'warning'); return; }

    const data = {
        sku:            document.getElementById('prodSku').value.trim() || ('SKU-' + Date.now()),
        barcode:        document.getElementById('prodBarcode').value.trim() || null,
        name,
        description:    document.getElementById('prodDesc').value.trim() || null,
        price:          parseFloat(document.getElementById('prodPrice').value) || 0,
        cost:           parseFloat(document.getElementById('prodCost').value) || 0,
        stock_quantity: parseInt(document.getElementById('prodStock').value) || 0,
        reorder_point:  parseInt(document.getElementById('prodReorder').value) || 5,
        category_id:    document.getElementById('productCategory').value || null,
        is_active:      true,
        deleted_at:     null,
        updated_at:     new Date().toISOString()
    };

    const result = id
        ? await supabaseClient.from('products').update(data).eq('id', id)
        : await supabaseClient.from('products').insert({ ...data, created_at: new Date().toISOString() });

    if (result.error) {
        showToast(getUserFriendlyErrorMessage(result.error, 'Failed to save product. Please try again.'), 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
        showToast(id ? 'Product updated' : 'Product created', 'success');
        await loadProducts();
    }
}

// Soft delete – move to deleted-recently table
async function deleteProduct(id) {
    if (!hasPermission('canDeleteProduct')) {
        showToast('You do not have permission to delete products.', 'error');
        return;
    }
    const confirmed = await showConfirmationToast(
        ' Delete this product',
        10000,
        'Delete'
    );
    if (!confirmed) return;

    const { error } = await supabaseClient
        .from('products')
        .update({ 
            is_active: false, 
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Failed to delete product.'), 'error');
    } else {
        showToast('Product deleted successfully', 'success');
        await loadProducts();
        await loadArchivedProducts();
    }
}

// Restore product from deleted-recently table
async function restoreProduct(id) {
    if (!hasPermission('canRestoreProduct')) {
        showToast('You do not have permission to restore products.', 'error');
        return;
    }
    const confirmed = await showConfirmationToast('Restore this product to active inventory?', 8000, 'Restore');
    if (!confirmed) return;

    const { error } = await supabaseClient
        .from('products')
        .update({ 
            is_active: true, 
            deleted_at: null,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Failed to restore product.'), 'error');
    } else {
        showToast('Product restored successfully', 'success');
        await loadProducts();
        await loadArchivedProducts();
    }
}

// ============================================================
//  4. STOCK
// ============================================================

async function loadStock() {
    showTableSpinner('stockTable', 6);

    const { data: products, error } = await supabaseClient
        .from('products')
        .select('id, sku, name, stock_quantity, reorder_point')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Could not load stock levels. Please check your connection.'), 'error');
        return;
    }

    const tbody = document.getElementById('stockTable');
    if (!products?.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => {
        const reorder = p.reorder_point || 5;
        const isLow   = p.stock_quantity <= reorder;
        return `
            <tr class="${isLow ? 'table-warning' : ''}">
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td><code>${escapeHtml(p.sku)}</code></td>
                <td><strong>${p.stock_quantity}</strong></td>
                <td>${reorder}</td>
                <td>${isLow
                    ? '<span class="badge bg-warning text-dark">Low Stock</span>'
                    : '<span class="badge bg-success">OK</span>'}</td>
                <td>
                    ${hasPermission('canAdjustStock') ? `
                    <button class="icon-btn icon-btn-warn" title="Adjust Stock" onclick="INV.openAdjustModal(${p.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function openAdjustModal(productId = null) {
    if (!hasPermission('canAdjustStock')) {
        showToast('You do not have permission to adjust stock.', 'error');
        return;
    }
    const select = document.getElementById('adjProductSelect');
    select.innerHTML = '<option value="">— Select Product —</option>' +
        allProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (Stock: ${p.stock_quantity})</option>`).join('');

    if (productId) select.value = productId;

    document.getElementById('adjQty').value   = '';
    document.getElementById('adjNotes').value = '';

    new bootstrap.Modal(document.getElementById('adjustModal')).show();
}

async function adjustStock() {
    const productId = document.getElementById('adjProductSelect').value;
    const qty       = parseInt(document.getElementById('adjQty').value);
    const notes     = document.getElementById('adjNotes').value.trim();

    if (!productId) { showToast('Please select a product', 'warning'); return; }
    if (isNaN(qty) || qty === 0) { showToast('Enter a non-zero quantity change', 'warning'); return; }

    const product = allProducts.find(p => String(p.id) === String(productId));
    if (!product) { showToast('Product not found', 'error'); return; }

    const newStock = product.stock_quantity + qty;
    if (newStock < 0) {
        showToast(`Cannot reduce below zero. Current stock: ${product.stock_quantity}`, 'error');
        return;
    }

    const { error: updateErr } = await supabaseClient
        .from('products')
        .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
        .eq('id', productId);

    if (updateErr) {
        showToast(getUserFriendlyErrorMessage(updateErr, 'Failed to adjust stock. Please try again.'), 'error');
        return;
    }

    await supabaseClient.from('stock_movements').insert({
        product_id:    parseInt(productId),
        movement_type: 'ADJUSTMENT',
        quantity:      qty,
        notes:         notes || 'Manual adjustment',
        created_by:    currentUser?.id
    });

    bootstrap.Modal.getInstance(document.getElementById('adjustModal')).hide();
    showToast(`Stock updated: ${product.name} → ${newStock}`, 'success');

    await loadProducts();
    await loadStock();
}

// ============================================================
//  5. SUPPLIERS – with permission checks
// ============================================================

async function loadSuppliers() {
    showTableSpinner('suppliersTable', 6);

    const { data: suppliers, error } = await supabaseClient
        .from('suppliers').select('*').order('name');

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Could not load suppliers.'), 'error');
        return;
    }

    allSuppliers = suppliers || [];
    const tbody  = document.getElementById('suppliersTable');

    if (!allSuppliers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No suppliers yet</td></tr>';
        return;
    }

    tbody.innerHTML = allSuppliers.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>${escapeHtml(s.contact_person)}</td>
            <td>${escapeHtml(s.email)}</td>
            <td>${escapeHtml(s.phone)}</td>
            <td><span class="badge bg-${s.is_active ? 'success' : 'secondary'}">
                ${s.is_active ? 'Active' : 'Inactive'}</span></td>
            <td class="text-nowrap">
                ${hasPermission('canEditSupplier') ? `
                <button class="icon-btn icon-btn-edit" onclick="INV.openSupplierModal(${s.id})"><i class="fas fa-edit"></i></button>
                ` : ''}
                ${hasPermission('canDeleteSupplier') ? `
                <button class="icon-btn icon-btn-delete" onclick="INV.deleteSupplier(${s.id})"><i class="fas fa-trash"></i></button>
                ` : ''}
                ${hasPermission('canPermanentlyDeleteSupplier') ? `
                <button class="icon-btn icon-btn-danger" title="Permanently Delete" onclick="INV.permanentlyDeleteSupplier(${s.id}, '${escapeHtml(s.name)}')">
                    <i class="fas fa-skull-crossbones"></i>
                </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function permanentlyDeleteSupplier(supplierId, supplierName) {
    if (!hasPermission('canPermanentlyDeleteSupplier')) {
        showToast('You do not have permission to permanently delete suppliers.', 'error');
        return;
    }
    const success = await permanentDeleteRecord('suppliers', supplierId, supplierName);
    if (success) await loadSuppliers();
}

function openSupplierModal(id = null) {
    if (!hasPermission('canAddSupplier') && !hasPermission('canEditSupplier')) {
        showToast('You do not have permission to add or edit suppliers.', 'error');
        return;
    }
    ['supplierId','suppName','suppContact','suppEmail','suppPhone','suppAddress']
        .forEach(f => { const el = document.getElementById(f); if (el) el.value = ''; });
    document.getElementById('supplierModalTitle').textContent = 'Add Supplier';

    if (id) {
        const s = allSuppliers.find(s => s.id === id);
        if (!s) return;
        document.getElementById('supplierId').value  = s.id;
        document.getElementById('suppName').value    = s.name;
        document.getElementById('suppContact').value = s.contact_person || '';
        document.getElementById('suppEmail').value   = s.email || '';
        document.getElementById('suppPhone').value   = s.phone || '';
        document.getElementById('suppAddress').value = s.address || '';
        document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
    }

    new bootstrap.Modal(document.getElementById('supplierModal')).show();
}

async function saveSupplier() {
    const id   = document.getElementById('supplierId').value;
    const name = document.getElementById('suppName').value.trim();

    if (!name) { showToast('Supplier name is required', 'warning'); return; }

    const data = {
        name,
        contact_person: document.getElementById('suppContact').value.trim() || null,
        email:          document.getElementById('suppEmail').value.trim() || null,
        phone:          document.getElementById('suppPhone').value.trim() || null,
        address:        document.getElementById('suppAddress').value.trim() || null,
        is_active:      true,
        updated_at:     new Date().toISOString()
    };

    const result = id
        ? await supabaseClient.from('suppliers').update(data).eq('id', id)
        : await supabaseClient.from('suppliers').insert({ ...data, created_at: new Date().toISOString() });

    if (result.error) {
        showToast(getUserFriendlyErrorMessage(result.error, 'Failed to save supplier.'), 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('supplierModal')).hide();
        showToast(id ? 'Supplier updated' : 'Supplier created', 'success');
        await loadSuppliers();
    }
}

async function deleteSupplier(id) {
    if (!hasPermission('canDeleteSupplier')) {
        showToast('You do not have permission to delete suppliers.', 'error');
        return;
    }
    const confirmed = await showConfirmationToast('Delete this supplier? This action cannot be undone.', 8000, 'Delete');
    if (!confirmed) return;

    const { error } = await supabaseClient
        .from('suppliers').update({ is_active: false }).eq('id', id);

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Failed to delete supplier.'), 'error');
    } else {
        showToast('Supplier deleted', 'success');
        await loadSuppliers();
    }
}

// ============================================================
//  6. PURCHASE ORDERS – with permission checks
// ============================================================

async function loadPOs() {
    showTableSpinner('poTable', 7);

    if (!allSuppliers.length) await loadSuppliers();

    const { data: pos, error } = await supabaseClient
        .from('purchase_orders')
        .select('*')
        .order('order_date', { ascending: false });

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Could not load purchase orders.'), 'error');
        return;
    }

    allPurchaseOrders = pos || [];
    const tbody = document.getElementById('poTable');

    if (!allPurchaseOrders.length) {
        tbody.innerHTML = '<td><td colspan="7" class="text-center text-muted py-4">No purchase orders yet</td></tr>';
        return;
    }

    const statusClass = { PENDING: 'warning', APPROVED: 'primary', RECEIVED: 'success', CANCELLED: 'danger' };
    tbody.innerHTML = allPurchaseOrders.map(po => {
        const supplier = allSuppliers.find(s => s.id === po.supplier_id);
        return `
            <tr>
                <td><strong>${escapeHtml(po.po_number)}</strong></td>
                <td>${supplier ? escapeHtml(supplier.name) : '—'}</td>
                <td><span class="badge bg-${statusClass[po.status] || 'secondary'}">${po.status}</span></td>
                <td>${fmt(po.total_amount)}</td>
                <td>${po.order_date || '—'}</td>
                <td>${po.expected_delivery_date || '—'}</td>
                <td class="text-nowrap">
                    ${hasPermission('canMarkPOReceived') && po.status !== 'RECEIVED' && po.status !== 'CANCELLED' ? `
                    <button class="icon-btn icon-btn-success" title="Mark Received" onclick="INV.markPOReceived(${po.id})"><i class="fas fa-check"></i></button>
                    ` : ''}
                    ${hasPermission('canCancelPO') && po.status !== 'RECEIVED' && po.status !== 'CANCELLED' ? `
                    <button class="icon-btn icon-btn-delete" title="Cancel" onclick="INV.cancelPO(${po.id})"><i class="fas fa-times"></i></button>
                    ` : ''}
                    ${hasPermission('canPermanentlyDeletePO') ? `
                    <button class="icon-btn icon-btn-danger" title="Permanently Delete" onclick="INV.permanentlyDeletePO(${po.id}, '${escapeHtml(po.po_number)}')">
                        <i class="fas fa-skull-crossbones"></i>
                    </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

async function permanentlyDeletePO(poId, poNumber) {
    if (!hasPermission('canPermanentlyDeletePO')) {
        showToast('You do not have permission to permanently delete purchase orders.', 'error');
        return;
    }
    const success = await permanentDeleteRecord('purchase_orders', poId, poNumber);
    if (success) await loadPOs();
}

async function openPOModal() {
    if (!hasPermission('canCreatePO')) {
        showToast('You do not have permission to create purchase orders.', 'error');
        return;
    }
    if (!allSuppliers.length) await loadSuppliers();

    const supplierSelect = document.getElementById('poSupplier');
    supplierSelect.innerHTML = allSuppliers.length
        ? allSuppliers.filter(s => s.is_active).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')
        : '<option value="">No suppliers available — add one first</option>';

    document.getElementById('poNumber').value  = 'PO-' + Date.now();
    document.getElementById('poDate').value    = new Date().toISOString().split('T')[0];
    document.getElementById('poTotal').value   = '';
    document.getElementById('poDelivery').value = '';
    document.getElementById('poNotes').value   = '';

    new bootstrap.Modal(document.getElementById('poModal')).show();
}

async function savePO() {
    const poNumber   = document.getElementById('poNumber').value.trim();
    const supplierId = parseInt(document.getElementById('poSupplier').value);
    const total      = parseFloat(document.getElementById('poTotal').value) || 0;
    const orderDate  = document.getElementById('poDate').value;
    const delivery   = document.getElementById('poDelivery').value || null;
    const notes      = document.getElementById('poNotes').value.trim() || null;

    if (!poNumber || !supplierId || !orderDate) {
        showToast('PO Number, Supplier and Order Date are required', 'warning');
        return;
    }

    const { error } = await supabaseClient.from('purchase_orders').insert({
        po_number:              poNumber,
        supplier_id:            supplierId,
        total_amount:           total,
        order_date:             orderDate,
        expected_delivery_date: delivery,
        notes,
        status:     'PENDING',
        created_by: currentUser?.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Failed to create purchase order.'), 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('poModal')).hide();
        showToast('Purchase order created', 'success');
        await loadPOs();
    }
}

async function markPOReceived(id) {
    if (!hasPermission('canMarkPOReceived')) {
        showToast('You do not have permission to mark purchase orders as received.', 'error');
        return;
    }
    const confirmed = await showConfirmationToast('Mark this purchase order as received?', 8000, 'Mark Received');
    if (!confirmed) return;

    const { error } = await supabaseClient
        .from('purchase_orders')
        .update({ status: 'RECEIVED', received_date: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Failed to mark PO as received.'), 'error');
    } else {
        showToast('PO marked as received', 'success');
        await loadPOs();
    }
}

async function cancelPO(id) {
    if (!hasPermission('canCancelPO')) {
        showToast('You do not have permission to cancel purchase orders.', 'error');
        return;
    }
    const confirmed = await showConfirmationToast('Cancel this purchase order?', 8000, 'Cancel PO');
    if (!confirmed) return;

    const { error } = await supabaseClient
        .from('purchase_orders')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Failed to cancel purchase order.'), 'error');
    } else {
        showToast('Purchase order cancelled', 'success');
        await loadPOs();
    }
}

// ============================================================
//  7. STOCK MOVEMENTS
// ============================================================

async function loadMovements() {
    showTableSpinner('movementsTable', 6);

    const { data: movements, error } = await supabaseClient
        .from('stock_movements')
        .select('*, products(name)')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        showToast(getUserFriendlyErrorMessage(error, 'Could not load stock movements.'), 'error');
        return;
    }

    allStockMovements = movements || [];
    const tbody = document.getElementById('movementsTable');

    if (!allStockMovements.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No movements recorded</td></tr>';
        return;
    }

    const typeClass = { IN: 'success', OUT: 'danger', ADJUSTMENT: 'warning', TRANSFER: 'info' };
    tbody.innerHTML = allStockMovements.map(m => `
        <tr>
            <td>${m.products ? escapeHtml(m.products.name) : '#' + m.product_id}</td>
            <td><span class="badge bg-${typeClass[m.movement_type] || 'secondary'}">${m.movement_type}</span></td>
            <td class="${m.quantity > 0 ? 'text-success' : 'text-danger'} fw-bold">
                ${m.quantity > 0 ? '+' : ''}${m.quantity}
            </td>
            <td>${m.reference_type ? escapeHtml(m.reference_type) + ' #' + m.reference_id : '—'}</td>
            <td>${escapeHtml(m.notes)}</td>
            <td>${new Date(m.created_at).toLocaleString('en-KE')}</td>
        </tr>
    `).join('');
}

// ============================================================
//  8. TAB LISTENERS
// ============================================================

(function registerTabListeners() {
    const tabMap = {
        '#products-tab':  loadProducts,
        '#stock-tab':     loadStock,
        '#suppliers-tab': loadSuppliers,
        '#po-tab':        loadPOs,
        '#movements-tab': loadMovements
    };
    Object.entries(tabMap).forEach(([href, fn]) => {
        document.querySelector(`[href="${href}"]`)
            ?.addEventListener('shown.bs.tab', fn);
    });

    document.getElementById('productSearch')
        ?.addEventListener('input', renderProductsTable);
    document.getElementById('categoryFilter')
        ?.addEventListener('change', renderProductsTable);
})();

// ============================================================
//  9. BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;

    // Page-level access guard (after profile is loaded)
    if (!canAccessPage('inventory.html')) {
        showToast('Access denied.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }

    const userNameEl = document.getElementById('userName');
    if (userNameEl) {
        userNameEl.textContent = currentProfile?.first_name || currentUser?.email || 'User';
    }

    // Apply sidebar access AFTER profile is loaded
    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }

    await loadProducts();
});

// ============================================================
//  10. PUBLIC API
// ============================================================

window.INV = {
    openProductModal,
    saveProduct,
    deleteProduct,
    restoreProduct,
    filterProducts: renderProductsTable,
    permanentlyDeleteArchivedProduct,
    openAdjustModal,
    adjustStock,
    openSupplierModal,
    saveSupplier,
    deleteSupplier,
    permanentlyDeleteSupplier,
    openPOModal,
    savePO,
    markPOReceived,
    cancelPO,
    permanentlyDeletePO
};

// ============================================================
//  11. EXCEL EXPORT
// ============================================================

async function exportInventoryToExcel() {
    await Promise.all([loadProducts(), loadStock(), loadSuppliers(), loadPOs(), loadMovements()]);

    const productsSheet = {
        name: 'Products',
        title: 'Products Catalog',
        columns: [
            { label: 'SKU', key: 'sku', align: 'left' },
            { label: 'Barcode', key: 'barcode', align: 'left' },
            { label: 'Name', key: 'name', align: 'left' },
            { label: 'Category', key: 'category_id', transform: (id) => allCategories.find(c => c.id == id)?.name || '—', align: 'left' },
            { label: 'Price (KES)', key: 'price', format: 'currency', align: 'right' },
            { label: 'Cost (KES)', key: 'cost', format: 'currency', align: 'right' },
            { label: 'Stock', key: 'stock_quantity', align: 'right' },
            { label: 'Reorder Point', key: 'reorder_point', align: 'right' },
            { label: 'Status', key: 'is_active', transform: (v) => v ? 'Active' : 'Inactive', align: 'center' }
        ],
        data: allProducts
    };

    const stockSheet = {
        name: 'Stock Levels',
        title: 'Current Inventory Stock',
        columns: [
            { label: 'Product Name', key: 'name', align: 'left' },
            { label: 'SKU', key: 'sku', align: 'left' },
            { label: 'Stock Quantity', key: 'stock_quantity', align: 'right' },
            { label: 'Reorder Point', key: 'reorder_point', align: 'right' },
            { label: 'Status', key: 'stock_quantity', transform: (qty, row) => qty <= (row.reorder_point || 5) ? 'Low Stock' : 'OK', align: 'center' }
        ],
        data: allProducts
    };

    const suppliersSheet = {
        name: 'Suppliers',
        title: 'Supplier List',
        columns: [
            { label: 'Name', key: 'name', align: 'left' },
            { label: 'Contact Person', key: 'contact_person', align: 'left' },
            { label: 'Email', key: 'email', align: 'left' },
            { label: 'Phone', key: 'phone', align: 'left' },
            { label: 'Address', key: 'address', align: 'left' },
            { label: 'Status', key: 'is_active', transform: (v) => v ? 'Active' : 'Inactive', align: 'center' }
        ],
        data: allSuppliers
    };

    const poSheet = {
        name: 'Purchase Orders',
        title: 'Purchase Orders',
        columns: [
            { label: 'PO Number', key: 'po_number', align: 'left' },
            { label: 'Supplier', key: 'supplier_id', transform: (id) => allSuppliers.find(s => s.id == id)?.name || '—', align: 'left' },
            { label: 'Status', key: 'status', align: 'center' },
            { label: 'Total Amount (KES)', key: 'total_amount', format: 'currency', align: 'right' },
            { label: 'Order Date', key: 'order_date', align: 'center' },
            { label: 'Expected Delivery', key: 'expected_delivery_date', align: 'center' }
        ],
        data: allPurchaseOrders
    };

    const movementsSheet = {
        name: 'Stock Movements',
        title: 'Stock Movement History (last 100)',
        columns: [
            { label: 'Product', key: 'product_id', transform: (id) => allProducts.find(p => p.id == id)?.name || '#' + id, align: 'left' },
            { label: 'Type', key: 'movement_type', align: 'center' },
            { label: 'Quantity Change', key: 'quantity', align: 'right' },
            { label: 'Reference', key: 'reference_type', transform: (v, row) => v ? `${v}#${row.reference_id}` : '—', align: 'left' },
            { label: 'Notes', key: 'notes', align: 'left' },
            { label: 'Date', key: 'created_at', transform: (v) => new Date(v).toLocaleString(), align: 'center' }
        ],
        data: allStockMovements
    };

    if (typeof exportToExcel === 'function') {
        await exportToExcel('VendGrid_Inventory', [productsSheet, stockSheet, suppliersSheet, poSheet, movementsSheet]);
        showToast('Excel report generated successfully', 'success');
    } else {
        showToast('Export utility not loaded. Please refresh the page.', 'error');
    }
}

window.exportInventoryToExcel = exportInventoryToExcel;