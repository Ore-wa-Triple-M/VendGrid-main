/**
 * reports.js – Merged version
 * 
 * Combines:
 * - Supabase-based data loading (from first script)
 * - Export CSV, search/filter (from second script)
 * - Uses toast notifications (showNotification) instead of alerts
 */

let revenueChart, paymentChart;
let allSales = [];       // Store currently loaded sales for filtering/export

// ------------------------------------------------------------------
//  Core: Load reports from Supabase
// ------------------------------------------------------------------
async function loadReports() {
    const days = parseInt(document.getElementById('periodSelect').value);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: sales, error } = await supabaseClient
        .from('sales')
        .select('*')
        .gte('sale_date', startDate.toISOString());

    if (error) {
        showNotification(getUserFriendlyErrorMessage(error, 'Could not load sales data. Please check your connection.'), 'error');
        return;
    }

    allSales = sales || [];

    // Calculate KPIs
    const totalRevenue = allSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
    const totalTax = allSales.reduce((sum, s) => sum + parseFloat(s.tax_amount), 0);
    const avgOrder = allSales.length ? totalRevenue / allSales.length : 0;

    document.getElementById('totalRevenue').innerText = formatCurrency(totalRevenue);
    document.getElementById('totalSales').innerText = allSales.length;
    document.getElementById('avgOrder').innerText = formatCurrency(avgOrder);
    document.getElementById('totalTax').innerText = formatCurrency(totalTax);

    // Daily revenue chart
    const daily = {};
    allSales.forEach(s => {
        const date = s.sale_date.split('T')[0];
        daily[date] = (daily[date] || 0) + parseFloat(s.total_amount);
    });

    const labels = [];
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().split('T')[0];
        labels.push(ds.slice(5));          // "MM-DD"
        data.push(daily[ds] || 0);
    }

    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(document.getElementById('revenueChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Revenue',
                data,
                borderColor: '#667eea',
                fill: true,
                backgroundColor: 'rgba(102,126,234,0.1)'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    // Payment methods chart
    const methodCounts = { cash: 0, card: 0, mobile: 0 };
    allSales.forEach(s => {
        if (methodCounts[s.payment_method] !== undefined)
            methodCounts[s.payment_method]++;
    });

    if (paymentChart) paymentChart.destroy();
    paymentChart = new Chart(document.getElementById('paymentChart'), {
        type: 'doughnut',
        data: {
            labels: ['Cash', 'Card', 'Mobile'],
            datasets: [{
                data: [methodCounts.cash, methodCounts.card, methodCounts.mobile],
                backgroundColor: ['#28a745', '#17a2b8', '#ffc107']
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    // Render transaction table
    renderSalesTable(allSales);
}

// ------------------------------------------------------------------
//  Table rendering & filtering
// ------------------------------------------------------------------
function renderSalesTable(salesList) {
    const tbody = document.getElementById('salesTable');
    if (!salesList.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No sales found</td></tr>';
        return;
    }
    tbody.innerHTML = salesList.map(s => `
        <tr>
            <td>${escapeHtml(s.transaction_number)}</td>
            <td>${formatDate(s.sale_date)}</td>
            <td>${formatCurrency(s.total_amount)}</td>
            <td>${s.payment_method}</td>
            <td><span class="badge bg-success">${s.payment_status}</span></td>
            ${currentProfile?.role === 'admin' ? `
            <td class="text-nowrap">
                <button class="btn btn-sm btn-outline-danger" onclick="permanentlyDeleteSale(${s.id}, '${escapeHtml(s.transaction_number)}')">
                    <i class="fas fa-trash-alt"></i> Delete
                </button>
            </td>
            ` : ''}
        </tr>
    `).join('');
}

function filterSales() {
    const searchTerm = document.getElementById('salesSearch')?.value.toLowerCase() || '';
    const filtered = allSales.filter(s =>
        s.transaction_number.toLowerCase().includes(searchTerm) ||
        s.payment_method.toLowerCase().includes(searchTerm) ||
        s.payment_status.toLowerCase().includes(searchTerm)
    );
    renderSalesTable(filtered);
}

// ------------------------------------------------------------------
//  Export CSV (from second script)
// ------------------------------------------------------------------
async function exportSalesToExcel() {
    if (!allSales.length) {
        showNotification('No data to export', 'warning');
        return;
    }

    const salesSheet = {
        name: 'Sales Transactions',
        title: 'Sales Report',
        columns: [
            { label: 'Transaction #', key: 'transaction_number', align: 'left' },
            { label: 'Date', key: 'sale_date', transform: (v) => formatDate(v), align: 'center' },
            { label: 'Subtotal (KES)', key: 'subtotal', format: 'currency', align: 'right' },
            { label: 'Tax (KES)', key: 'tax_amount', format: 'currency', align: 'right' },
            { label: 'Discount (KES)', key: 'discount_amount', format: 'currency', align: 'right' },
            { label: 'Total (KES)', key: 'total_amount', format: 'currency', align: 'right' },
            { label: 'Payment Method', key: 'payment_method', align: 'center' },
            { label: 'Status', key: 'payment_status', align: 'center' }
        ],
        data: allSales
    };

    await exportToExcel('VendGrid_Sales', [salesSheet]);
    showNotification('Excel report exported', 'success');
}

// Update the button onclick in reports.html to call this function
window.exportSalesToExcel = exportSalesToExcel;
// ------------------------------------------------------------------
//  Helper: escape HTML to prevent injection
// ------------------------------------------------------------------
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ------------------------------------------------------------------
//  Event listeners & initialization
// ------------------------------------------------------------------
document.getElementById('periodSelect')?.addEventListener('change', loadReports);
document.getElementById('salesSearch')?.addEventListener('input', filterSales);

document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return;
    // Display user name
    const userNameSpan = document.getElementById('userName');
    if (userNameSpan) {
        userNameSpan.innerText = currentProfile?.first_name || currentUser?.email || 'User';
    }
    await loadReports();
});



async function permanentlyDeleteSale(saleId, transactionNumber) {
    const success = await permanentDeleteRecord('sales', saleId, transactionNumber);
    if (success) {
        await loadReports(); // refresh the current view
    }
}