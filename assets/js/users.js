// users.js — VendGrid User Management

async function loadUsers() {
    const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('created_at');

    const tbody = document.getElementById('usersTable');
    if (!profiles?.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No users found</td></tr>';
        return;
    }
    tbody.innerHTML = profiles.map(p => `
        <tr>
            <td>${p.first_name || ''} ${p.last_name || ''}</td>
            <td>${p.email}</td>
            <td><span class="badge bg-${p.role === 'admin' ? 'danger' : p.role === 'manager' ? 'warning' : 'primary'}">${p.role}</span></td>
            <td><span class="badge bg-${p.is_active ? 'success' : 'secondary'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
       <td class="text-nowrap">
    <button class="btn btn-sm btn-outline-primary" onclick="editUser('${p.id}')"><i class="fas fa-edit"></i></button>
    ${currentProfile?.role === 'admin' && p.id !== currentUser?.id ? `
    <button class="btn btn-sm btn-outline-danger" onclick="permanentlyDeleteUser('${p.id}', '${p.first_name || ''} ${p.last_name || ''}')">
        <i class="fas fa-trash-alt"></i> 
    </button>
    ` : ''}
</td>
    
            </tr>
    `).join('');
}


async function editUser(userId) {
    const { data: user } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (user) {
        document.getElementById('editUserId').value = user.id;
        document.getElementById('editFirstName').value = user.first_name || '';
        document.getElementById('editLastName').value = user.last_name || '';
        document.getElementById('editRole').value = user.role;
        document.getElementById('editStatus').value = user.is_active;
        new bootstrap.Modal(document.getElementById('userModal')).show();
    }
}

async function permanentlyDeleteUser(userId, userName) {
    const success = await permanentDeleteRecord('profiles', userId, userName);
    if (success) {
        await loadUsers();
    }
}

async function updateUser() {
    const userId = document.getElementById('editUserId').value;
    const updates = {
        first_name: document.getElementById('editFirstName').value,
        last_name: document.getElementById('editLastName').value,
        role: document.getElementById('editRole').value,
        is_active: document.getElementById('editStatus').value === 'true',
        updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', userId);

    if (error) {
        showNotification('Error: ' + error.message, 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
        showNotification('User updated', 'success');
        await loadUsers();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAdmin()) return;
    document.getElementById('userName').innerText = currentProfile?.first_name || currentUser.email;
    await loadUsers();
});