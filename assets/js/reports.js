/**
 * reports.js – VendGrid Sales Reports
 *
 * FIXES APPLIED:
 *
 *  1. DELETE / VOID — table not refreshing:
 *     Both permanentlyDeleteSale and voidSale called loadReports() which
 *     re-fetches from DB and calls renderSalesTable(). The actual root cause
 *     was that Supabase delete({count:'exact'}) returns count=null (not 0)
 *     when RLS silently blocks the operation, making the old guard
 *     (count === 0) a no-op. Fixed: use .select('id') after delete so we
 *     get back the actually-deleted rows — empty array means it was blocked.
 *
 *  2. VOID — same issue: update was returning no error but the status was not
 *     changing because the RLS policy may only allow admin updates. The query
 *     now chains .select('id') and throws if nothing was updated.
 *
 *  3. PRODUCT PERFORMANCE — wrong logic:
 *     Old code only queried sale_items, so products with ZERO sales were
 *     invisible. Fixed: we now fetch ALL products from the inventory table,
 *     compute per-product totals from sale_items, then left-join them.
 *     Result: products with 0 sales appear in the slow-movers list.
 *     Rankings: Top 3 best sellers, Top 5 least sellers (including zero-sales).
 *
 *  4. Single DOMContentLoaded — event delegation registered AFTER requireAuth()
 *     resolves so hasPermission() works correctly.
 *
 *  5. renderSalesTable fixed HTML: was '<td><td colspan…', now '<tr><td colspan…'
 */

'use strict';

let revenueChart = null;
let paymentChart = null;
let allSales     = [];

// ── Load reports ──────────────────────────────────────────────────────────────
async function loadReports() {
    const days      = parseInt(document.getElementById('periodSelect').value) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
        // Try rich join first; fall back to plain select if FK names differ
        const { data: richData, error: richError } = await supabaseClient
            .from('sales')
            .select(`
                *,
                cashier:profiles!cashier_id ( first_name, last_name, email ),
                sale_items (
                    id, quantity, unit_price, subtotal, discount_amount,
                    product:products ( name, sku )
                )
            `)
            .gte('sale_date', startDate.toISOString())
            .order('sale_date', { ascending: false });

        let sales;
        if (richError) {
            console.warn('Rich join failed, using plain select:', richError.message);
            const { data: plainData, error: plainError } = await supabaseClient
                .from('sales')
                .select('*')
                .gte('sale_date', startDate.toISOString())
                .order('sale_date', { ascending: false });
            if (plainError) throw plainError;
            sales = plainData || [];
        } else {
            sales = richData || [];
        }

        allSales = sales;

        // KPI cards
        const totalRevenue = allSales.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
        const totalTax     = allSales.reduce((s, r) => s + parseFloat(r.tax_amount    || 0), 0);
        const avgOrder     = allSales.length ? totalRevenue / allSales.length : 0;

        document.getElementById('totalRevenue').innerText = formatCurrency(totalRevenue);
        document.getElementById('totalSales').innerText   = allSales.length;
        document.getElementById('avgOrder').innerText     = formatCurrency(avgOrder);
        document.getElementById('totalTax').innerText     = formatCurrency(totalTax);

        // Revenue trend chart
        const daily = {};
        allSales.forEach(s => {
            const d = (s.sale_date || '').split('T')[0];
            daily[d] = (daily[d] || 0) + parseFloat(s.total_amount || 0);
        });
        const labels = [], data = [];
        for (let i = days - 1; i >= 0; i--) {
            const d  = new Date();
            d.setDate(d.getDate() - i);
            const ds = d.toISOString().split('T')[0];
            labels.push(ds.slice(5));
            data.push(daily[ds] || 0);
        }
        if (revenueChart) revenueChart.destroy();
        revenueChart = new Chart(document.getElementById('revenueChart'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Revenue', data,
                    borderColor: '#667eea', fill: true,
                    backgroundColor: 'rgba(102,126,234,0.1)', tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        // Payment methods chart
        const mc = {};
        allSales.forEach(s => {
            const m = (s.payment_method || 'other').toLowerCase();
            mc[m] = (mc[m] || 0) + 1;
        });
        if (paymentChart) paymentChart.destroy();
        paymentChart = new Chart(document.getElementById('paymentChart'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(mc).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
                datasets: [{
                    data: Object.values(mc),
                    backgroundColor: ['#28a745', '#17a2b8', '#ffc107', '#6f42c1', '#fd7e14']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        renderSalesTable(allSales);
        await loadProductPerformance(days);

    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to load reports'), 'error');
    }
}

// ── Render transaction table ──────────────────────────────────────────────────
function renderSalesTable(salesList) {
    const tbody = document.getElementById('salesTable');
    if (!tbody) return;

    if (!salesList || !salesList.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No sales found for this period</td></tr>';
        return;
    }

    tbody.innerHTML = salesList.map(s => {
        const statusClass = s.payment_status === 'completed' ? 'success'
                          : s.payment_status === 'refunded'  ? 'secondary'
                          : 'warning';

        let cashierDisplay = '—';
        if (s.cashier) {
            const name = `${s.cashier.first_name || ''} ${s.cashier.last_name || ''}`.trim();
            cashierDisplay = escapeHtml(name || s.cashier.email || '—');
        }

        const itemCount = Array.isArray(s.sale_items) ? s.sale_items.length : '—';
        const txn       = escapeHtml(s.transaction_number || '—');
        const saleId    = String(s.id);
        const canVoid   = s.payment_status !== 'refunded';

        return `
            <tr>
                <td>${txn}</td>
                <td>${formatDate(s.sale_date)}</td>
                <td>${cashierDisplay}</td>
                <td>${itemCount}</td>
                <td>${formatCurrency(s.total_amount)}</td>
                <td><span class="badge bg-${statusClass}">${escapeHtml(s.payment_status || '—')}</span></td>
                <td class="text-nowrap">
                    ${hasPermission('canVoidSale') && canVoid ? `
                    <button class="btn btn-sm btn-outline-warning me-1"
                            data-action="void"
                            data-id="${saleId}"
                            data-label="${txn}"
                            title="Void this sale">
                        <i class="fas fa-undo-alt"></i> Void
                    </button>` : ''}
                    ${hasPermission('canPermanentlyDeleteSale') ? `
                    <button class="btn btn-sm btn-outline-danger"
                            data-action="delete"
                            data-id="${saleId}"
                            data-label="${txn}"
                            title="Permanently delete this sale">
                        <i class="fas fa-trash-alt"></i>
                    </button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// ── Search filter ─────────────────────────────────────────────────────────────
function filterSales() {
    const q = (document.getElementById('salesSearch')?.value || '').toLowerCase();
    const filtered = allSales.filter(s =>
        (s.transaction_number || '').toLowerCase().includes(q) ||
        (s.payment_method     || '').toLowerCase().includes(q) ||
        (s.payment_status     || '').toLowerCase().includes(q) ||
        (s.cashier
            ? `${s.cashier.first_name || ''} ${s.cashier.last_name || ''}`.toLowerCase().includes(q)
            : false)
    );
    renderSalesTable(filtered);
}

// ── Void sale ─────────────────────────────────────────────────────────────────
async function voidSale(saleId, transactionNumber) {
    if (!hasPermission('canVoidSale')) {
        showNotification('You do not have permission to void sales.', 'error');
        return;
    }

    const confirmed = await showConfirmationToast(
        `Void sale "${transactionNumber}"? Stock will be restored and the sale marked as refunded.`,
        10000,
        'Void'
    );
    if (!confirmed) return;

    try {
        // Fetch sale items to restore stock
        const { data: items, error: itemsErr } = await supabaseClient
            .from('sale_items')
            .select('product_id, quantity')
            .eq('sale_id', saleId);
        if (itemsErr) throw itemsErr;
        if (!items || items.length === 0) throw new Error('No items found for this sale');

        // Update sale status — use .select('id') to verify the row was updated
        const { data: updatedRows, error: updateErr } = await supabaseClient
            .from('sales')
            .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
            .eq('id', saleId)
            .select('id');

        if (updateErr) throw updateErr;
        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('Sale not found or you do not have permission to void it.');
        }

        // Restore stock for each item
        for (const item of items) {
            const { data: product, error: prodErr } = await supabaseClient
                .from('products')
                .select('stock_quantity')
                .eq('id', item.product_id)
                .single();
            if (prodErr) throw prodErr;

            const newStock = (product.stock_quantity || 0) + item.quantity;
            const { error: stockErr } = await supabaseClient
                .from('products')
                .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
                .eq('id', item.product_id);
            if (stockErr) throw stockErr;

            await supabaseClient.from('stock_movements').insert({
                product_id:    item.product_id,
                movement_type: 'RESTORE',
                quantity:      item.quantity,
                reference_type:'SALE_VOID',
                reference_id:  saleId,
                notes:         `Stock restored from voided sale ${transactionNumber}`,
                created_by:    currentUser?.id,
                created_at:    new Date().toISOString()
            });
        }

        showNotification('Sale voided successfully', 'success');
        await loadReports();
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to void sale'), 'error');
    }
}

// ── Permanent delete sale ─────────────────────────────────────────────────────
async function permanentlyDeleteSale(saleId, transactionNumber) {
    if (!hasPermission('canPermanentlyDeleteSale')) {
        showNotification('You do not have permission to permanently delete sales.', 'error');
        return;
    }

    const confirmed = await showConfirmationToast(
        `Permanently delete sale "${transactionNumber}"? This cannot be undone.`,
        8000,
        'Delete'
    );
    if (!confirmed) return;

    try {
        // Delete child rows first (sale_items) to satisfy FK constraints
        const { error: itemsErr } = await supabaseClient
            .from('sale_items')
            .delete()
            .eq('sale_id', saleId);
        if (itemsErr) throw itemsErr;

        // Delete the parent sale — use .select('id') to verify it was deleted
        const { data: deletedRows, error: saleErr } = await supabaseClient
            .from('sales')
            .delete()
            .eq('id', saleId)
            .select('id');

        if (saleErr) throw saleErr;

        // Empty array means RLS blocked or row didn't exist
        if (!deletedRows || deletedRows.length === 0) {
            throw new Error('Sale not found or you do not have permission to delete it.');
        }

        showNotification(`Sale "${transactionNumber}" permanently deleted.`, 'success');
        await loadReports();
    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Deletion failed. Please try again.'), 'error');
    }
}

// ── Export to Excel ───────────────────────────────────────────────────────────
async function exportSalesToExcel() {
    if (!allSales.length) {
        showNotification('No data to export', 'warning');
        return;
    }

    const salesSheet = {
        name: 'Sales Transactions',
        title: 'Sales Report',
        columns: [
            { label: 'Transaction #',  key: 'transaction_number', align: 'left'    },
            { label: 'Date',           key: 'sale_date',           transform: v => formatDate(v), align: 'center' },
            { label: 'Cashier',        key: 'cashier',             transform: v => v ? `${v.first_name || ''} ${v.last_name || ''}`.trim() || v.email || '—' : '—', align: 'left' },
            { label: 'Items',          key: 'sale_items',          transform: v => Array.isArray(v) ? v.length : '—', align: 'center' },
            { label: 'Subtotal (KES)', key: 'subtotal',            format: 'currency', align: 'right' },
            { label: 'Tax (KES)',      key: 'tax_amount',          format: 'currency', align: 'right' },
            { label: 'Discount (KES)', key: 'discount_amount',     format: 'currency', align: 'right' },
            { label: 'Total (KES)',    key: 'total_amount',        format: 'currency', align: 'right' },
            { label: 'Payment',        key: 'payment_method',      align: 'center'  },
            { label: 'Status',         key: 'payment_status',      align: 'center'  }
        ],
        data: allSales
    };

    const itemRows = [];
    allSales.forEach(s => {
        (s.sale_items || []).forEach(item => {
            itemRows.push({
                transaction_number: s.transaction_number,
                sale_date:          s.sale_date,
                product_name:       item.product?.name || '—',
                sku:                item.product?.sku  || '—',
                quantity:           item.quantity,
                unit_price:         item.unit_price,
                subtotal:           item.subtotal,
                discount:           item.discount_amount || 0
            });
        });
    });

    const sheets = [salesSheet];
    if (itemRows.length) {
        sheets.push({
            name: 'Sale Items',
            title: 'Sale Items Detail',
            columns: [
                { label: 'Transaction #', key: 'transaction_number', align: 'left'    },
                { label: 'Date',          key: 'sale_date',          transform: v => formatDate(v), align: 'center' },
                { label: 'Product',       key: 'product_name',       align: 'left'    },
                { label: 'SKU',           key: 'sku',                align: 'left'    },
                { label: 'Qty',           key: 'quantity',           align: 'center'  },
                { label: 'Unit Price',    key: 'unit_price',         format: 'currency', align: 'right' },
                { label: 'Discount',      key: 'discount',           format: 'currency', align: 'right' },
                { label: 'Subtotal',      key: 'subtotal',           format: 'currency', align: 'right' }
            ],
            data: itemRows
        });
    }

    if (typeof exportToExcel === 'function') {
        await exportToExcel('VendGrid_Sales', sheets);
        showNotification('Excel report exported', 'success');
    } else {
        showNotification('Export utility not loaded. Please refresh the page.', 'error');
    }
}
window.exportSalesToExcel = exportSalesToExcel;

// ── Product Performance ───────────────────────────────────────────────────────
// FIX: Fetch ALL products from inventory, then aggregate sales on top.
// This ensures products with ZERO sales appear in the slow-movers table.
// Rankings: Top 3 best sellers | Top 5 least sellers (incl. zero-sales)
async function loadProductPerformance(days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
        // 1. Fetch all products from inventory
        const { data: allProducts, error: prodErr } = await supabaseClient
            .from('products')
            .select('id, name, sku, price, stock_quantity')
            .eq('is_deleted', false)   // exclude soft-deleted items if column exists
            .order('name', { ascending: true });

        // If is_deleted column doesn't exist, fall back to fetching all
        let products = allProducts;
        if (prodErr) {
            const { data: fallbackProds, error: fallbackErr } = await supabaseClient
                .from('products')
                .select('id, name, sku, price, stock_quantity')
                .order('name', { ascending: true });
            if (fallbackErr) {
                console.warn('Product performance: failed to load products', fallbackErr);
                return;
            }
            products = fallbackProds || [];
        } else {
            products = allProducts || [];
        }

        if (!products.length) {
            renderProductPerformance([], []);
            return;
        }

        // 2. Fetch sale items for the period to aggregate per-product quantities
        const { data: saleItems, error: siErr } = await supabaseClient
            .from('sale_items')
            .select('product_id, quantity')
            .gte('created_at', startDate.toISOString());

        if (siErr) {
            console.warn('Product performance: sale_items error', siErr);
        }

        // 3. Build a map of productId → total qty sold
        const soldMap = new Map();
        (saleItems || []).forEach(item => {
            const prev = soldMap.get(item.product_id) || 0;
            soldMap.set(item.product_id, prev + (item.quantity || 0));
        });

        // 4. Merge: every product gets a totalQty (default 0 if never sold)
        const enriched = products.map(p => ({
            id:       p.id,
            name:     p.name  || 'Unknown',
            sku:      p.sku   || '—',
            price:    p.price || 0,
            stock:    p.stock_quantity || 0,
            totalQty: soldMap.get(p.id) || 0
        }));

        // 5. Sort descending by sales qty
        const sorted = [...enriched].sort((a, b) => b.totalQty - a.totalQty);

        // Top 3 best sellers (must have at least 1 sale)
        const topSellers  = sorted.filter(p => p.totalQty > 0).slice(0, 3);

        // Top 5 least sellers — sorted ascending, so lowest first.
        // Products with 0 sales are included (they sort to the top of ascending).
        const leastSellers = [...enriched]
            .sort((a, b) => a.totalQty - b.totalQty)
            .slice(0, 5);

        renderProductPerformance(topSellers, leastSellers);
    } catch (err) {
        console.warn('Product performance error:', err);
    }
}

function renderProductPerformance(top, slow) {
    const container = document.getElementById('productPerformanceContainer');
    if (!container) return;

    const rowHtml = (items, showStock) => items.map(p => `
        <tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.sku)}</td>
            <td>${p.totalQty}</td>
            <td>${formatCurrency(p.price)}</td>
            ${showStock ? `<td>${p.stock}</td>` : ''}
        </tr>
    `).join('');

    const topHtml = top.length ? `
        <div class="mb-4">
            <h6 class="fw-bold">🏆 Top 3 Best Selling Products</h6>
            <div class="table-responsive">
                <table class="table table-sm table-hover">
                    <thead><tr><th>Name</th><th>SKU</th><th>Qty Sold</th><th>Price</th></tr></thead>
                    <tbody>${rowHtml(top, false)}</tbody>
                </table>
            </div>
        </div>` : '<div class="alert alert-info">No sales data in this period.</div>';

    const slowHtml = slow.length ? `
        <div>
            <h6 class="fw-bold">🐢 Top 5 Slow / Non-Selling Products</h6>
            <p class="text-muted small mb-2">Includes products with zero sales in the selected period.</p>
            <div class="table-responsive">
                <table class="table table-sm table-hover">
                    <thead><tr><th>Name</th><th>SKU</th><th>Qty Sold</th><th>Price</th><th>In Stock</th></tr></thead>
                    <tbody>${rowHtml(slow, true)}</tbody>
                </table>
            </div>
        </div>` : '';

    container.innerHTML = `
        <div class="card shadow-sm mt-4">
            <div class="card-header bg-light">
                <h5 class="mb-0"><i class="fas fa-chart-line me-2"></i>Product Performance</h5>
            </div>
            <div class="card-body">${topHtml}${slowHtml}</div>
        </div>`;
}

// ── PDF export ────────────────────────────────────────────────────────────────
function exportSalesToPDF() {
    const periodSelect = document.getElementById('periodSelect');
    const periodText   = periodSelect.options[periodSelect.selectedIndex]?.text || 'Selected period';
    const revenue      = document.getElementById('totalRevenue')?.innerText  || '—';
    const salesCount   = document.getElementById('totalSales')?.innerText    || '—';
    const avgOrder     = document.getElementById('avgOrder')?.innerText      || '—';
    const tax          = document.getElementById('totalTax')?.innerText      || '—';

    let chartImageHtml = '';
    const chartCanvas  = document.getElementById('revenueChart');
    if (chartCanvas) {
        try { chartImageHtml = `<div class="text-center mb-4"><img src="${chartCanvas.toDataURL()}" style="max-width:100%;height:auto;"></div>`; }
        catch(e) { console.warn('Chart capture failed', e); }
    }

    const salesTableHtml = document.getElementById('salesTable')?.innerHTML || '';

    const win = window.open('', '_blank', 'width=1000,height=800');
    win.document.write(`<!DOCTYPE html><html>
    <head>
        <title>Sales Report - VendGrid</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
            body{padding:20px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif}
            .print-header{text-align:center;margin-bottom:30px}
            .kpi-card{border:1px solid #dee2e6;border-radius:8px;padding:15px;margin-bottom:15px;background:#f8f9fa}
            @media print{body{padding:0;margin:0}.no-print{display:none}.kpi-card{background:white;border:1px solid #ccc}}
        </style>
    </head>
    <body>
        <div class="print-header">
            <h2>VendGrid Sales Report</h2>
            <p>Period: ${escapeHtml(periodText)} | Generated: ${new Date().toLocaleString()}</p>
        </div>
        <div class="row mb-4">
            <div class="col-md-3"><div class="kpi-card"><h6>Total Revenue</h6><h3>${revenue}</h3></div></div>
            <div class="col-md-3"><div class="kpi-card"><h6>Total Sales</h6><h3>${salesCount}</h3></div></div>
            <div class="col-md-3"><div class="kpi-card"><h6>Average Order</h6><h3>${avgOrder}</h3></div></div>
            <div class="col-md-3"><div class="kpi-card"><h6>Total Tax</h6><h3>${tax}</h3></div></div>
        </div>
        ${chartImageHtml}
        <h5>Transaction History</h5>
        <div class="table-responsive">
            <table class="table table-bordered">
                <thead><tr><th>Transaction #</th><th>Date</th><th>Cashier</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>${salesTableHtml}</tbody>
            </table>
        </div>
        <div class="text-muted mt-4" style="font-size:12px;">VendGrid POS System – Confidential</div>
        <script>window.print();setTimeout(()=>window.close(),1000);<\/script>
    </body></html>`);
    win.document.close();
}
window.exportSalesToPDF = exportSalesToPDF;

// ── Event wires ───────────────────────────────────────────────────────────────
document.getElementById('periodSelect')?.addEventListener('change', loadReports);
document.getElementById('salesSearch')?.addEventListener('input', filterSales);

// ── Boot (single DOMContentLoaded) ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;

    // Redirect if not allowed on this page
    if (!canAccessPage('reports.html')) {
        showNotification('Access denied.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }

    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.innerText = currentProfile?.first_name || currentUser?.email || 'User';

    // Apply sidebar AFTER profile is loaded
    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }

    // Table event delegation — registered after auth so hasPermission() works
    const salesTable = document.getElementById('salesTable');
    if (salesTable) {
        salesTable.addEventListener('click', async e => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'void')   await voidSale(btn.dataset.id, btn.dataset.label);
            if (btn.dataset.action === 'delete') await permanentlyDeleteSale(btn.dataset.id, btn.dataset.label);
        });
    }

    await loadReports();
});
