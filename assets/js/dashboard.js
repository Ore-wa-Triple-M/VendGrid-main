/**
 * dashboard.js – VendGrid Dashboard
 *
 * CRITICAL FIX: The original dashboard.js file contained the POS boot
 * logic (role restriction for cashiers, loadPOSData(), toggleCashSection())
 * instead of dashboard-specific logic. This caused the dashboard to redirect
 * all non-cashier/manager/admin roles and to call undefined functions like
 * loadPOSData(). The dashboard was functionally broken for the correct file.
 *
 * This file is a clean dashboard implementation using the correct data
 * from the existing dashboard.html widgets: todaySales, salesChange,
 * todayTransactions, totalProducts, lowStockItems, salesChart,
 * recentTransactions.
 *
 * FIX 2: applySidebarAccess() called AFTER requireAuth() resolves.
 * FIX 3: inventory_clerk added to allowed roles (they can land on dashboard).
 */

'use strict';

let salesChart = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;

    // All authenticated roles can access the dashboard
    const nameEl = document.getElementById('userName');
    if (nameEl) {
        nameEl.textContent = currentProfile?.first_name || currentUser?.email || 'User';
    }

    // Apply sidebar access after profile is loaded
    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }

    await loadDashboard();
});

// ── Load all dashboard data ───────────────────────────────────────────────────
async function loadDashboard() {
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Run independent queries in parallel
    const [
        todaySalesRes,
        yesterdaySalesRes,
        productCountRes,
        lowStockRes,
        chartSalesRes,
        recentRes
    ] = await Promise.allSettled([
        supabaseClient
            .from('sales')
            .select('total_amount, payment_status')
            .gte('sale_date', today + 'T00:00:00')
            .lte('sale_date', today + 'T23:59:59'),

        supabaseClient
            .from('sales')
            .select('total_amount')
            .gte('sale_date', yesterday + 'T00:00:00')
            .lt('sale_date', today + 'T00:00:00'),

        supabaseClient
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true),

        supabaseClient
            .from('products')
            .select('id, stock_quantity, reorder_point')
            .eq('is_active', true),

        supabaseClient
            .from('sales')
            .select('sale_date, total_amount')
            .gte('sale_date', new Date(Date.now() - 7 * 86400000).toISOString()),

        supabaseClient
            .from('sales')
            .select('transaction_number, total_amount, payment_method, sale_date')
            .order('sale_date', { ascending: false })
            .limit(5)
    ]);

    // ── Today's Sales ──────────────────────────────────────────────────────────
    const todaySales  = todaySalesRes.value?.data || [];
    const todayTotal  = todaySales.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
    const txnCount    = todaySales.length;

    const todaySalesEl = document.getElementById('todaySales');
    if (todaySalesEl) todaySalesEl.innerText = formatCurrency(todayTotal);

    const todayTxnEl = document.getElementById('todayTransactions');
    if (todayTxnEl) todayTxnEl.innerText = txnCount;

    // % change vs yesterday
    const yesterdaySales = yesterdaySalesRes.value?.data || [];
    const yesterdayTotal = yesterdaySales.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
    const pct = yesterdayTotal > 0
        ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1)
        : (todayTotal > 0 ? 100 : 0);

    const changeSpan = document.getElementById('salesChange');
    if (changeSpan) {
        const dir = pct >= 0 ? 'up' : 'down';
        changeSpan.innerHTML   = `<i class="fas fa-arrow-${dir}"></i> ${Math.abs(pct)}%`;
        changeSpan.className   = pct >= 0 ? 'text-success' : 'text-danger';
    }

    // ── Products & Low Stock ───────────────────────────────────────────────────
    const totalProdEl = document.getElementById('totalProducts');
    if (totalProdEl) totalProdEl.innerText = productCountRes.value?.count ?? 0;

    const allProds   = lowStockRes.value?.data || [];
    const lowItems   = allProds.filter(p => p.stock_quantity <= (p.reorder_point ?? 5));
    const lowStockEl = document.getElementById('lowStockItems');
    if (lowStockEl) lowStockEl.innerText = lowItems.length;

    // ── 7-day Revenue Chart ────────────────────────────────────────────────────
    const chartSales = chartSalesRes.value?.data || [];
    const daily = {};
    chartSales.forEach(s => {
        const d = (s.sale_date || '').split('T')[0];
        daily[d] = (daily[d] || 0) + parseFloat(s.total_amount || 0);
    });

    const chartLabels = [], chartData = [];
    for (let i = 6; i >= 0; i--) {
        const d  = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
        chartLabels.push(d.slice(5));
        chartData.push(daily[d] || 0);
    }

    const chartEl = document.getElementById('salesChart');
    if (chartEl) {
        if (salesChart) salesChart.destroy();
        salesChart = new Chart(chartEl, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Revenue',
                    data:  chartData,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102,126,234,0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // ── Recent Transactions ────────────────────────────────────────────────────
    const recent = recentRes.value?.data || [];
    const tbody  = document.getElementById('recentTransactions');
    if (tbody) {
        if (!recent.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No transactions yet</td></tr>';
        } else {
            tbody.innerHTML = recent.map(s => `
                <tr>
                    <td>${escapeHtml(s.transaction_number)}</td>
                    <td>${formatCurrency(s.total_amount)}</td>
                    <td>${escapeHtml(s.payment_method)}</td>
                    <td>${formatDate(s.sale_date)}</td>
                </tr>
            `).join('');
        }
    }
}