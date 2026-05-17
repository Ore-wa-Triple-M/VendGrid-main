// Dashboard page logic
let salesChart;

async function loadDashboard() {
    if (!await requireAuth()) return;

    const userNameSpan = document.getElementById('userName');
    if (userNameSpan) userNameSpan.textContent = currentProfile?.first_name || currentUser.email;

    // Today's sales
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const todayEnd = today + 'T23:59:59';
    const { data: todaySales } = await supabaseClient
        .from('sales')
        .select('total_amount')
        .gte('sale_date', today + 'T00:00:00')
        .lte('sale_date', todayEnd);
    const todayTotal = todaySales?.reduce((s, i) => s + parseFloat(i.total_amount), 0) || 0;
    document.getElementById('todaySales').innerText = formatCurrency(todayTotal);
    document.getElementById('todayTransactions').innerText = todaySales?.length || 0;

    const { data: yesterdaySales } = await supabaseClient
        .from('sales')
        .select('total_amount')
        .gte('sale_date', yesterday)
        .lt('sale_date', today);
    const yesterdayTotal = yesterdaySales?.reduce((s, i) => s + parseFloat(i.total_amount), 0) || 0;
    const change = yesterdayTotal ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1) : 0;
    const changeSpan = document.getElementById('salesChange');
    changeSpan.innerHTML = `<i class="fas fa-arrow-${change >= 0 ? 'up' : 'down'}"></i> ${Math.abs(change)}%`;
    changeSpan.className = change >= 0 ? 'text-success' : 'text-danger';

    // Products & low stock
    const { count: productCount } = await supabaseClient.from('products').select('*', { count: 'exact', head: true });
    document.getElementById('totalProducts').innerText = productCount || 0;

    const { data: lowStock } = await supabaseClient
    .from('products')
    .select('id')
    .lte('stock_quantity', 5); // use a fixed default or fetch reorder_point per product
    document.getElementById('lowStockItems').innerText = lowStock?.length || 0;

    // Sales chart (last 7 days)
    const startDate = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    const { data: chartSales } = await supabaseClient
        .from('sales')
        .select('sale_date, total_amount')
        .gte('sale_date', startDate);

    const daily = {};
    chartSales?.forEach(s => {
        const date = s.sale_date.split('T')[0];
        daily[date] = (daily[date] || 0) + parseFloat(s.total_amount);
    });
    const labels = [], data = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i*86400000).toISOString().split('T')[0];
        labels.push(d.slice(5));
        data.push(daily[d] || 0);
    }
    if (salesChart) salesChart.destroy();
    salesChart = new Chart(document.getElementById('salesChart'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Revenue', data, borderColor: '#667eea', tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    // Recent transactions
    const { data: recent } = await supabaseClient
        .from('sales')
        .select('transaction_number, total_amount, payment_method, sale_date')
        .order('sale_date', { ascending: false })
        .limit(5);
    const tbody = document.getElementById('recentTransactions');
    if (!recent?.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No transactions</td></tr>';
    } else {
        tbody.innerHTML = recent.map(s => `
            <tr>
                <td>${s.transaction_number}</td>
                <td>${formatCurrency(s.total_amount)}</td>
                <td>${s.payment_method}</td>
                <td>${formatDate(s.sale_date)}</td>
            </tr>
        `).join('');
    }
}

document.addEventListener('DOMContentLoaded', loadDashboard);