/**
 * reports.js – VendGrid Sales Reports
 *
 * ENHANCED: renderSalesTable now groups rows by transaction.
 *   • One parent summary row per transaction (txn-parent)
 *   • One sub-row per sale_item (txn-item)
 *   • A thin spacer row between each transaction group (txn-spacer)
 *   • All existing functionality (exports, KPIs, charts, void/delete,
 *     search, footer total) is fully preserved.
 */

'use strict';

let revenueChart = null;
let paymentChart = null;
let allSales     = [];

// ── Inject grouped-transaction styles once ────────────────────────────────────
(function injectGroupStyles() {
    if (document.getElementById('txn-group-styles')) return;
    const style = document.createElement('style');
    style.id = 'txn-group-styles';
    style.textContent = `
        /* ── Parent (summary) row ─────────────────────────────── */
        #salesTable tr.txn-parent {
            background-color: #f0f4ff;
            border-top: 2px solid #c7d2fe;
        }
        #salesTable tr.txn-parent td {
            font-weight: 600;
            vertical-align: middle;
            border-bottom: none;
        }
        #salesTable tr.txn-parent td:first-child {
            border-left: 4px solid #667eea;
            padding-left: 10px;
        }

        /* ── Item sub-rows ────────────────────────────────────── */
        #salesTable tr.txn-item td {
            background-color: #fafbff;
            font-size: 0.92em;
            color: #444;
            border-top: none;
            border-bottom: 1px dashed #e2e8f0;
            vertical-align: middle;
        }
        #salesTable tr.txn-item td:first-child {
            border-left: 4px solid #c7d2fe;
            padding-left: 10px;
        }
        #salesTable tr.txn-item .item-indent {
            color: #667eea;
            font-weight: 600;
            margin-right: 4px;
        }

        /* ── Spacer between transaction groups ────────────────── */
        #salesTable tr.txn-spacer td {
            padding: 4px 0;
            background: transparent;
            border: none;
        }

        /* ── Item count badge on parent row ───────────────────── */
        .txn-item-badge {
            display: inline-block;
            background: #667eea;
            color: #fff;
            font-size: 0.72em;
            font-weight: 600;
            border-radius: 10px;
            padding: 1px 7px;
            margin-left: 6px;
            vertical-align: middle;
        }

        /* ── Refunded parent row tint ─────────────────────────── */
        #salesTable tr.txn-parent.txn-refunded {
            background-color: #f5f5f5;
            border-top-color: #adb5bd;
        }
        #salesTable tr.txn-parent.txn-refunded td:first-child {
            border-left-color: #adb5bd;
        }
        #salesTable tr.txn-item.txn-refunded td {
            background-color: #fafafa;
            color: #888;
        }
        #salesTable tr.txn-item.txn-refunded td:first-child {
            border-left-color: #dee2e6;
        }
    `;
    document.head.appendChild(style);
})();

// ── Helper: enrich sale_items with product names (batch fetch) ────────────────
async function enrichSalesWithProductNames(sales) {
    const productIds = new Set();
    for (const sale of sales) {
        if (sale.sale_items) {
            for (const item of sale.sale_items) {
                if (item.product_id) productIds.add(item.product_id);
            }
        }
    }
    if (productIds.size === 0) return sales;

    const { data: products, error } = await supabaseClient
        .from('products')
        .select('id, name')
        .in('id', Array.from(productIds));

    if (error) {
        console.warn('Failed to fetch product names:', error);
        return sales;
    }

    const productMap = new Map();
    products.forEach(p => productMap.set(p.id, p.name));

    for (const sale of sales) {
        if (sale.sale_items) {
            for (const item of sale.sale_items) {
                item.product_name = productMap.get(item.product_id) || `Product ID: ${item.product_id}`;
            }
        }
    }
    return sales;
}

// ── Load reports ──────────────────────────────────────────────────────────────
async function loadReports() {
    const days      = parseInt(document.getElementById('periodSelect').value) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
        const { data: sales, error: salesError } = await supabaseClient
            .from('sales')
            .select(`
                *,
                cashier:profiles!cashier_id ( first_name, last_name, email )
            `)
            .gte('sale_date', startDate.toISOString())
            .order('sale_date', { ascending: false });

        if (salesError) throw salesError;

        for (const sale of (sales || [])) {
            const { data: items, error: itemsErr } = await supabaseClient
                .from('sale_items')
                .select('id, product_id, quantity, unit_price, total_price')
                .eq('sale_id', sale.id);
            if (!itemsErr && items) {
                sale.sale_items = items;
            } else {
                sale.sale_items = [];
            }
        }

        allSales = await enrichSalesWithProductNames(sales || []);

        const totalRevenue = allSales.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
        const totalTax     = allSales.reduce((s, r) => s + parseFloat(r.tax_amount    || 0), 0);
        const avgOrder     = allSales.length ? totalRevenue / allSales.length : 0;

        document.getElementById('totalRevenue').innerText = formatCurrency(totalRevenue);
        document.getElementById('totalSales').innerText   = allSales.length;
        document.getElementById('avgOrder').innerText     = formatCurrency(avgOrder);
        document.getElementById('totalTax').innerText     = formatCurrency(totalTax);

        // Revenue chart
        const daily = {};
        allSales.forEach(s => {
            const d = (s.sale_date || '').split('T')[0];
            daily[d] = (daily[d] || 0) + parseFloat(s.total_amount || 0);
        });
        const labels = [], data = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
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
                    borderColor: '#667eea',
                    fill: true,
                    backgroundColor: 'rgba(102,126,234,0.1)',
                    tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        // Payment method chart
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
        console.error('loadReports error:', err);
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to load reports'), 'error');
    }
}

// ── Render transaction table ──────────────────────────────────────────────────
//
//  Three rendering branches depending on item count:
//
//  BRANCH A – 0 items (no items recorded)
//    Single flat <tr> with all original columns, Item col shows placeholder.
//
//  BRANCH B – exactly 1 item
//    Single flat <tr> using the original layout exactly:
//    Txn# | Date | Cashier | MOP | Item name | Qty | UTP | Subtotal | Status | Actions
//    No grouping styles, no sub-rows — indistinguishable from the original table.
//
//  BRANCH C – 2+ items (grouped layout)
//    <tr class="txn-parent">  ← bold summary: Txn#/Date/Cashier/MOP/badge/—/—/Total/Status/Actions
//    <tr class="txn-item"> ×N ← one per item: —/—/—/—/↳Name/Qty/UTP/Subtotal/—/—
//    <tr class="txn-spacer">  ← 4 px gap between groups
//
//  Footer total is always summed from sale.total_amount (never per-item totals).
//
function renderSalesTable(salesList) {
    const tbody = document.getElementById('salesTable');
    if (!tbody) return;

    if (!salesList || !salesList.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">No sales found for this period</td></tr>';
        const footerSpan = document.getElementById('footerTotal');
        if (footerSpan) footerSpan.innerText = formatCurrency(0);
        return;
    }

    let rowsHtml  = '';
    let grandTotal = 0;

    for (const sale of salesList) {
        const items      = sale.sale_items || [];
        const isRefunded = sale.payment_status === 'refunded';
        const refundedClass = isRefunded ? ' txn-refunded' : '';

        const statusClass = sale.payment_status === 'completed' ? 'success'
                          : sale.payment_status === 'refunded'  ? 'secondary'
                          : 'warning';

        let cashierDisplay = '—';
        if (sale.cashier) {
            const name = `${sale.cashier.first_name || ''} ${sale.cashier.last_name || ''}`.trim();
            cashierDisplay = escapeHtml(name || sale.cashier.email || '—');
        }

        const txn     = escapeHtml(sale.transaction_number || '—');
        const mop     = escapeHtml(sale.payment_method ? sale.payment_method.toUpperCase() : '—');
        const saleId  = String(sale.id);
        const canVoid = sale.payment_status !== 'refunded';

        const saleTotal = parseFloat(sale.total_amount || 0);
        grandTotal += saleTotal;

        // Build action buttons (void + delete) — reused across branches
        let actionsHtml = '—';
        const hasVoid   = hasPermission('canVoidSale') && canVoid;
        const hasDelete = hasPermission('canPermanentlyDeleteSale');
        if (hasVoid || hasDelete) {
            actionsHtml = `<div class="d-flex gap-1">
                ${hasVoid ? `
                <button class="btn btn-sm btn-outline-warning"
                        data-action="void"
                        data-id="${saleId}"
                        data-label="${txn}"
                        title="Void this sale">
                    <i class="fas fa-undo-alt"></i>
                </button>` : ''}
                ${hasDelete ? `
                <button class="btn btn-sm btn-outline-danger"
                        data-action="delete"
                        data-id="${saleId}"
                        data-label="${txn}"
                        title="Permanently delete this sale">
                    <i class="fas fa-trash-alt"></i>
                </button>` : ''}
            </div>`;
        }

        // ── BRANCH A: no items ────────────────────────────────────────────────
        if (items.length === 0) {
            rowsHtml += `
                <tr>
                    <td>${txn}</td>
                    <td>${formatDate(sale.sale_date)}</td>
                    <td>${cashierDisplay}</td>
                    <td>${mop}</td>
                    <td colspan="3" class="text-muted fst-italic">(no items recorded)</td>
                    <td class="text-end">${formatCurrency(saleTotal)}</td>
                    <td><span class="badge bg-${statusClass}">${escapeHtml(sale.payment_status || '—')}</span></td>
                    <td class="text-nowrap">${actionsHtml}</td>
                </tr>`;
            continue;
        }

        // ── BRANCH B: exactly 1 item — original flat row, no grouping ────────
        if (items.length === 1) {
            const item      = items[0];
            const itemTotal = parseFloat(item.total_price || 0);
            rowsHtml += `
                <tr>
                    <td>${txn}</td>
                    <td>${formatDate(sale.sale_date)}</td>
                    <td>${cashierDisplay}</td>
                    <td>${mop}</td>
                    <td>${escapeHtml(item.product_name || 'Unknown')}</td>
                    <td class="text-center">${item.quantity || 0}</td>
                    <td class="text-end">${formatCurrency(item.unit_price || 0)}</td>
                    <td class="text-end">${formatCurrency(itemTotal)}</td>
                    <td><span class="badge bg-${statusClass}">${escapeHtml(sale.payment_status || '—')}</span></td>
                    <td class="text-nowrap">${actionsHtml}</td>
                </tr>`;
            continue;
        }

        // ── BRANCH C: 2+ items — grouped parent + sub-rows + spacer ──────────
        const countBadge = `<span class="txn-item-badge">${items.length} items</span>`;

        // Parent summary row
        rowsHtml += `
            <tr class="txn-parent${refundedClass}">
                <td>${txn}</td>
                <td>${formatDate(sale.sale_date)}</td>
                <td>${cashierDisplay}</td>
                <td>${mop}</td>
                <td>${countBadge}</td>
                <td></td>
                <td></td>
                <td class="text-end">${formatCurrency(saleTotal)}</td>
                <td><span class="badge bg-${statusClass}">${escapeHtml(sale.payment_status || '—')}</span></td>
                <td class="text-nowrap">${actionsHtml}</td>
            </tr>`;

        // One sub-row per item
        for (const item of items) {
            const itemTotal = parseFloat(item.total_price || 0);
            rowsHtml += `
                <tr class="txn-item${refundedClass}">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td><span class="item-indent">↳</span>${escapeHtml(item.product_name || 'Unknown')}</td>
                    <td class="text-center">${item.quantity || 0}</td>
                    <td class="text-end">${formatCurrency(item.unit_price || 0)}</td>
                    <td class="text-end">${formatCurrency(itemTotal)}</td>
                    <td>—</td>
                    <td>—</td>
                </tr>`;
        }

        // Thin spacer between grouped transactions
        rowsHtml += `<tr class="txn-spacer" aria-hidden="true"><td colspan="10"></td></tr>`;
    }

    tbody.innerHTML = rowsHtml;

    const footerSpan = document.getElementById('footerTotal');
    if (footerSpan) footerSpan.innerText = formatCurrency(grandTotal);
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
            : false) ||
        (s.sale_items || []).some(item => (item.product_name || '').toLowerCase().includes(q))
    );
    renderSalesTable(filtered);
}

// ── Void sale (restores stock) ────────────────────────────────────────────────
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
        const { data: items, error: itemsErr } = await supabaseClient
            .from('sale_items')
            .select('product_id, quantity')
            .eq('sale_id', saleId);
        if (itemsErr) throw itemsErr;
        if (!items || items.length === 0) throw new Error('No items found for this sale');

        const { data: updatedRows, error: updateErr } = await supabaseClient
            .from('sales')
            .update({ payment_status: 'refunded' })
            .eq('id', saleId)
            .select('id');
        if (updateErr) {
            const detail = [updateErr.code, updateErr.hint, updateErr.details, updateErr.message]
                .filter(Boolean).join(' | ');
            throw new Error(`Failed to update sale status: ${detail}`);
        }
        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('Sale could not be voided. Check Row Level Security policy on the sales table.');
        }

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
                product_id:     item.product_id,
                movement_type:  'IN',
                quantity:       item.quantity,
                reference_type: 'SALE_VOID',
                reference_id:   saleId,
                notes:          `Stock restored from voided sale ${transactionNumber}`,
                created_by:     currentUser?.id,
                created_at:     new Date().toISOString()
            });
        }

        showNotification('Sale voided successfully. Stock has been restored.', 'success');
        await loadReports();
    } catch (err) {
        console.error('Void sale error:', err);
        showNotification(err.message || 'Failed to void sale. Check browser console for details.', 'error');
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
        const { data: deletedItems, error: itemsErr } = await supabaseClient
            .from('sale_items')
            .delete()
            .eq('sale_id', saleId)
            .select('sale_id');

        if (itemsErr) {
            const detail = [itemsErr.code, itemsErr.hint, itemsErr.details, itemsErr.message]
                .filter(Boolean).join(' | ');
            throw new Error(`Failed to delete sale items: ${detail}`);
        }

        const { count: remainingCount } = await supabaseClient
            .from('sale_items')
            .select('*', { count: 'exact', head: true })
            .eq('sale_id', saleId);

        if (remainingCount > 0) {
            throw new Error('Could not delete sale items. Check RLS policy on sale_items.');
        }

        const { data: deletedRows, error: saleErr } = await supabaseClient
            .from('sales')
            .delete()
            .eq('id', saleId)
            .select('id');

        if (saleErr) {
            const detail = [saleErr.code, saleErr.hint, saleErr.details, saleErr.message]
                .filter(Boolean).join(' | ');
            throw new Error(`Failed to delete sale: ${detail}`);
        }
        if (!deletedRows || deletedRows.length === 0) {
            throw new Error('Sale could not be deleted. Check RLS policy on sales.');
        }

        showNotification(`Sale "${transactionNumber}" permanently deleted.`, 'success');
        await loadReports();
    } catch (err) {
        console.error('Delete sale error:', err);
        showNotification(err.message || 'Deletion failed.', 'error');
    }
}

// ── Excel export (unchanged) ──────────────────────────────────────────────────
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
            { label: 'Total (KES)',    key: 'total_amount',        format: 'currency', align: 'right' },
            { label: 'Tax (KES)',      key: 'tax_amount',          format: 'currency', align: 'right' },
            { label: 'Discount (KES)', key: 'discount_amount',     format: 'currency', align: 'right' },
            { label: 'Payment',        key: 'payment_method',      align: 'center'  },
            { label: 'Status',         key: 'payment_status',      align: 'center'  }
        ],
        data: allSales
    };

    const itemRows = [];
    for (const sale of allSales) {
        const items = sale.sale_items || [];
        for (const item of items) {
            itemRows.push({
                transaction_number: sale.transaction_number,
                sale_date:          sale.sale_date,
                product_id:         item.product_id,
                quantity:           item.quantity,
                unit_price:         item.unit_price,
                total_price:        item.total_price
            });
        }
    }

    const sheets = [salesSheet];
    if (itemRows.length) {
        sheets.push({
            name: 'Sale Items',
            title: 'Sale Items Detail',
            columns: [
                { label: 'Transaction #', key: 'transaction_number', align: 'left'    },
                { label: 'Date',          key: 'sale_date',          transform: v => formatDate(v), align: 'center' },
                { label: 'Product ID',    key: 'product_id',        align: 'left'    },
                { label: 'Qty',           key: 'quantity',           align: 'center'  },
                { label: 'Unit Price',    key: 'unit_price',         format: 'currency', align: 'right' },
                { label: 'Total Price',   key: 'total_price',        format: 'currency', align: 'right' }
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
globalThis.exportSalesToExcel = exportSalesToExcel;

// ── PDF export (unchanged) ────────────────────────────────────────────────────
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

    const cleanRows = allSales.map(s => {
        let cashierDisplay = '—';
        if (s.cashier) {
            const name = `${s.cashier.first_name || ''} ${s.cashier.last_name || ''}`.trim();
            cashierDisplay = escapeHtml(name || s.cashier.email || '—');
        }
        const itemCount   = Array.isArray(s.sale_items) ? s.sale_items.length : '—';
        const statusBg    = s.payment_status === 'completed' ? '#28a745'
                          : s.payment_status === 'refunded'  ? '#6c757d' : '#ffc107';
        const statusColor = s.payment_status === 'pending' ? '#000' : '#fff';
        return `<tr>
            <td>${escapeHtml(s.transaction_number || '—')}</td>
            <td>${formatDate(s.sale_date)}</td>
            <td>${cashierDisplay}</td>
            <td>${itemCount}</td>
            <td>${formatCurrency(s.total_amount)}</td>
            <td><span style="padding:2px 6px;border-radius:4px;background:${statusBg};color:${statusColor};font-size:12px">${escapeHtml(s.payment_status || '—')}</span></td>
        </tr>`;
    }).join('');

    const win = globalThis.open('', '_blank', 'width=1000,height=800');
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
                <tbody>${cleanRows}</tbody>
            </table>
        </div>
        <div class="text-muted mt-4" style="font-size:12px;">VendGrid POS System – Confidential</div>
        <script>window.print();setTimeout(()=>window.close(),1000);<\/script>
    </body></html>`);
    win.document.close();
}
globalThis.exportSalesToPDF = exportSalesToPDF;

// ── Product Performance ───────────────────────────────────────────────────────
async function loadProductPerformance(days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
        const { data: products, error: prodErr } = await supabaseClient
            .from('products')
            .select('id, name, sku, price, stock_quantity')
            .eq('is_active', true)
            .order('name', { ascending: true });

        if (prodErr) {
            console.warn('Product performance: failed to load products', prodErr);
            return;
        }
        if (!products || !products.length) {
            renderProductPerformance([], []);
            return;
        }

        const { data: saleItems, error: siErr } = await supabaseClient
            .from('sale_items')
            .select('product_id, quantity')
            .gte('created_at', startDate.toISOString());

        if (siErr) {
            console.warn('Product performance: sale_items error', siErr);
        }

        const soldMap = new Map();
        (saleItems || []).forEach(item => {
            const prev = soldMap.get(item.product_id) || 0;
            soldMap.set(item.product_id, prev + (item.quantity || 0));
        });

        const enriched = products.map(p => ({
            id:       p.id,
            name:     p.name || 'Unknown',
            sku:      p.sku || '—',
            price:    p.price || 0,
            stock:    p.stock_quantity || 0,
            totalQty: soldMap.get(p.id) || 0
        }));

        const sorted      = [...enriched].sort((a, b) => b.totalQty - a.totalQty);
        const topSellers  = sorted.filter(p => p.totalQty > 0).slice(0, 3);
        const leastSellers = [...enriched].sort((a, b) => a.totalQty - b.totalQty).slice(0, 5);

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
            <h6 class="fw-bold"> Top 5 Slow / Non-Selling Products</h6>
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

// ── Event wires ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;
    if (!canAccessPage('reports.html')) {
        showNotification('Access denied.', 'error');
        setTimeout(() => globalThis.location.href = 'dashboard.html', 1500);
        return;
    }

    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.innerText = currentProfile?.first_name || currentUser?.email || 'User';
    if (typeof applySidebarAccess === 'function') applySidebarAccess();

    document.getElementById('periodSelect')?.addEventListener('change', loadReports);
    document.getElementById('salesSearch')?.addEventListener('input', filterSales);

    // Delegated click handler – works for dynamically rendered rows
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