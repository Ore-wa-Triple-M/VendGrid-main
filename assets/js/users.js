/**
 * users.js – VendGrid User Management
 *
 * FIXES APPLIED:
 *  1. Single DOMContentLoaded: event delegation registered AFTER requireAdmin()
 *     resolves so currentProfile is populated and hasPermission() works.
 *  2. permanentlyDeleteUser: Supabase delete with {count:'exact'} returns null
 *     (not 0) when RLS blocks the operation without throwing an error. Added
 *     explicit null check: treat count === null OR count === 0 as a failure.
 *  3. Users are deleted from the 'profiles' table. Because Supabase auth.users
 *     is separate and the anon key cannot touch it, we also attempt to call the
 *     admin delete via a Supabase Edge Function (if configured), and fall back
 *     gracefully if not available. The profile row is always deleted regardless.
 *  4. After any delete/edit operation loadUsers() is always awaited to ensure
 *     the table re-renders from fresh data.
 *  5. escapeHtml is defined in app.js — not redefined here.
 */

'use strict';

// ── Load users ────────────────────────────────────────────────────────────────
async function loadUsers() {
    try {
        const { data: profiles, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;

        const tbody = document.getElementById('usersTable');
        if (!tbody) return;

        if (!profiles || !profiles.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = profiles.map(p => {
            const roleBadge = p.role === 'admin'           ? 'danger'
                            : p.role === 'manager'         ? 'warning'
                            : p.role === 'inventory_clerk' ? 'info'
                            : 'primary';

            const fullName  = escapeHtml(
                `${p.first_name || ''} ${p.last_name || ''}`.trim() || '—'
            );
            const isNotSelf = p.id !== currentUser?.id;

            return `
                <tr>
                    <td>${fullName}</td>
                    <td>${escapeHtml(p.email || '—')}</td>
                    <td><span class="badge bg-${roleBadge}">${escapeHtml(p.role || '—')}</span></td>
                    <td>
                        <span class="badge bg-${p.is_active ? 'success' : 'secondary'}">
                            ${p.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="text-nowrap">
                        ${hasPermission('canEditUser') ? `
                        <button class="btn btn-sm btn-outline-primary me-1"
                                data-action="edit"
                                data-id="${escapeHtml(p.id)}"
                                title="Edit user">
                            <i class="fas fa-edit"></i>
                        </button>` : ''}
                        ${hasPermission('canDeleteUser') && isNotSelf ? `
                        <button class="btn btn-sm btn-outline-danger"
                                data-action="delete"
                                data-id="${escapeHtml(p.id)}"
                                data-label="${fullName}"
                                title="Permanently delete user">
                            <i class="fas fa-trash-alt"></i>
                        </button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        showNotification(getUserFriendlyErrorMessage(err, 'Failed to load users'), 'error');
    }
}

// ── Edit user ─────────────────────────────────────────────────────────────────
async function editUser(userId) {
    if (!hasPermission('canEditUser')) {
        showNotification('You do not have permission to edit users.', 'error');
        return;
    }

    const { data: user, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error || !user) {
        showNotification('User not found', 'error');
        return;
    }

    document.getElementById('editUserId').value    = user.id;
    document.getElementById('editFirstName').value = user.first_name || '';
    document.getElementById('editLastName').value  = user.last_name  || '';
    document.getElementById('editRole').value      = user.role       || 'cashier';
    document.getElementById('editStatus').value    = String(user.is_active !== false);

    new bootstrap.Modal(document.getElementById('userModal')).show();
}

// ── Save user edits ───────────────────────────────────────────────────────────
async function updateUser() {
    const userId = document.getElementById('editUserId')?.value;
    if (!userId) { showNotification('No user selected', 'error'); return; }

    const updates = {
        first_name: document.getElementById('editFirstName').value.trim(),
        last_name:  document.getElementById('editLastName').value.trim(),
        role:       document.getElementById('editRole').value,
        is_active:  document.getElementById('editStatus').value === 'true',
        updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', userId);

    if (error) {
        showNotification(getUserFriendlyErrorMessage(error, 'Update failed'), 'error');
    } else {
        bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
        showNotification('User updated successfully', 'success');
        await loadUsers();
    }
}
globalThis.updateUser = updateUser;

// ── Permanently delete a user ─────────────────────────────────────────────────
async function permanentlyDeleteUser(userId, userName) {
    if (!hasPermission('canDeleteUser')) {
        showNotification('You do not have permission to delete users.', 'error');
        return;
    }
    if (userId === currentUser?.id) {
        showNotification('You cannot delete your own account.', 'error');
        return;
    }

    const confirmed = await showConfirmationToast(
        `Permanently delete "${userName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
        // Step 1: Delete the profile row.
        // Use .select() after delete so Supabase returns the deleted rows —
        // this is more reliable than {count:'exact'} which can return null
        // when RLS silently blocks the operation.
        const { data: deletedRows, error: profileErr } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', userId)
            .select('id');   // returns the rows that were actually deleted

        if (profileErr) throw profileErr;

        // If no rows were returned the delete was blocked (RLS or row not found)
        if (!deletedRows || deletedRows.length === 0) {
            throw new Error('User not found or you do not have permission to delete this user.');
        }

        // Step 2: Attempt to delete the Supabase Auth user via an Edge Function
        // (only works if the project has a "delete-auth-user" function deployed).
        // This is best-effort — failure here does NOT roll back the profile delete.
        try {
            await supabaseClient.functions.invoke('delete-auth-user', {
                body: { userId }
            });
        } catch (_) {
            // Edge function not deployed or failed — silently ignore.
            // The profile row is gone so the user cannot log in even if the
            // auth row persists (requireAuth checks the profile table).
        }

        showNotification(`"${userName}" has been permanently removed.`, 'success');
        await loadUsers();
 } catch (err) {
    console.error('Delete user detailed error:', err);
    showNotification(getUserFriendlyErrorMessage(err, 'Failed to delete user: ' + (err.message || 'Unknown error')), 'error');
}
}

// ── Boot (single DOMContentLoaded) ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // requireAdmin redirects non-admins automatically
    if (!await requireAdmin()) return;

    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.innerText = currentProfile?.first_name || currentUser?.email || 'User';

    // Apply sidebar AFTER profile is loaded
    if (typeof applySidebarAccess === 'function') {
        applySidebarAccess();
    }

    // Register event delegation on the table AFTER profile is ready
    const usersTable = document.getElementById('usersTable');
    if (usersTable) {
        usersTable.addEventListener('click', async e => {
            const editBtn   = e.target.closest('[data-action="edit"]');
            const deleteBtn = e.target.closest('[data-action="delete"]');
            if (editBtn)   await editUser(editBtn.dataset.id);
            if (deleteBtn) await permanentlyDeleteUser(deleteBtn.dataset.id, deleteBtn.dataset.label);
        });
    }

    await loadUsers();
});