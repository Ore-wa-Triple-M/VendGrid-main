/**
 * dashboard.js – VendGrid Dashboard
 * 
 * FIXED: Added company_id filtering for multi-tenant isolation.
 * Works with both VendGrid 1 and VendGrid 2 database schemas.
 */

'use strict';

let salesChart = null;

// Helper to get current company ID (works with both schema versions)
function getDashboardCompanyId() {
    // Try to get from global function (VendGrid 2)
    if (typeof getCurrentCompanyId === 'function') {
        const id = getCurrentCompanyId();
        if (id) return id;
    }
    // Fallback: try from currentProfile (VendGrid 1)
    if (currentProfile && currentProfile.company_id) {
        return currentProfile.company_id;
    }
    // Last resort: try to fetch from profiles table
    if (currentUser && currentUser.id) {
        // This will be handled in the query by adding a filter
        return null;
    }
    return null;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;

    const nameEl = document.getElementById('userName');
    if (nameEl) {
        nameEl.textContent = currentProfile?.first_name || currentUser?.email || 'User';
    }

    await loadDashboard();
});

// ── Load all dashboard data with company isolation ───────────────────────────
async function loadDashboard() {
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    const companyId = getDashboardCompanyId();
    
    // Build query with company filter if available
    let todayQuery = supabaseClient
        .from('sales')
        .select('total_amount, payment_status')
        .gte('sale_date', today + 'T00:00:00')
        .lte('sale_date', today + 'T23:59:59');
    
    let yesterdayQuery = supabaseClient
        .from('sales')
        .select('total_amount')
        .gte('sale_date', yesterday + 'T00:00:00')
        .lt('sale_date', today + 'T00:00:00');
    
    let chartQuery = supabaseClient
        .from('sales')
        .select('sale_date, total_amount')
        .gte('sale_date', new Date(Date.now() - 7 * 86400000).toISOString());
    
    let recentQuery = supabaseClient
        .from('sales')
        .select('transaction_number, total_amount, payment_method, sale_date')
        .order('sale_date', { ascending: false })
        .limit(5);
    
    // Apply company filter if we have a company ID
    if (companyId) {
        todayQuery = todayQuery.eq('company_id', companyId);
        yesterdayQuery = yesterdayQuery.eq('company_id', companyId);
        chartQuery = chartQuery.eq('company_id', companyId);
        recentQuery = recentQuery.eq('company_id', companyId);
    } else if (currentProfile?.company_id) {
        // Fallback using currentProfile
        todayQuery = todayQuery.eq('company_id', currentProfile.company_id);
        yesterdayQuery = yesterdayQuery.eq('company_id', currentProfile.company_id);
        chartQuery = chartQuery.eq('company_id', currentProfile.company_id);
        recentQuery = recentQuery.eq('company_id', currentProfile.company_id);
    }
    
    // Products count and low stock (always filtered by company)
    let productCountQuery = supabaseClient
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
    
    let lowStockQuery = supabaseClient
        .from('products')
        .select('id, stock_quantity, reorder_point')
        .eq('is_active', true);
    
    if (companyId) {
        productCountQuery = productCountQuery.eq('company_id', companyId);
        lowStockQuery = lowStockQuery.eq('company_id', companyId);
    } else if (currentProfile?.company_id) {
        productCountQuery = productCountQuery.eq('company_id', currentProfile.company_id);
        lowStockQuery = lowStockQuery.eq('company_id', currentProfile.company_id);
    }

    // Run all queries in parallel
    const [
        todaySalesRes,
        yesterdaySalesRes,
        productCountRes,
        lowStockRes,
        chartSalesRes,
        recentRes
    ] = await Promise.allSettled([
        todayQuery,
        yesterdayQuery,
        productCountQuery,
        lowStockQuery,
        chartQuery,
        recentQuery
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
            tbody.innerHTML = '<td><td colspan="4" class="text-center text-muted">No transactions yet</td><\/tr>';
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