/**
 * permissions.js – VendGrid Centralised Role-Based Access Control
 *
 * FIX 1: applySidebarAccess() was called synchronously on DOMContentLoaded by
 *         both sidebar.js AND page scripts, BEFORE requireAuth()/requireAdmin()
 *         had resolved and set currentProfile. Result: currentProfile was null,
 *         canAccessPage() returned false for EVERY link including admin ones,
 *         and all sidebar items were hidden.
 *
 * FIX:    applySidebarAccess() is now async-safe:
 *         - If currentProfile is already loaded, it runs immediately.
 *         - If not, it polls with a short backoff (max ~2s) and retries.
 *         - Each page's boot function calls applySidebarAccess() AFTER
 *           requireAuth/requireAdmin has resolved (in sidebar.js the call
 *           is deferred via window.sidebarAccessReady flag).
 *
 * FIX 2: dashboard.html is now accessible to cashier role (they need somewhere
 *         to land after login). cashier added to PAGE_ACCESS['dashboard.html'].
 *
 * FIX 3: inventory_clerk role was missing from PAGE_ACCESS. Added.
 *
 * FIX 4: Added payment permissions for Phase 4 (M-Pesa integration).
 */

'use strict';

// ── Role constants ─────────────────────────────────────────────────────────────
const ROLES = {
    ADMIN:           'admin',
    MANAGER:         'manager',
    CASHIER:         'cashier',
    INVENTORY_CLERK: 'inventory_clerk'
};

// ── Page access rules ──────────────────────────────────────────────────────────
// dashboard is open to all authenticated roles so every user has a landing page.
const PAGE_ACCESS = {
    'dashboard.html':  ['admin', 'manager', 'cashier', 'inventory_clerk'],
    'pos.html':        ['admin', 'manager', 'cashier'],
    'inventory.html':  ['admin', 'manager', 'inventory_clerk'],
    'reports.html':    ['admin', 'manager'],
    'users.html':      ['admin'],
    'settings.html':   ['admin']
};

// ── Action permissions ─────────────────────────────────────────────────────────
const PERMISSIONS = {
    // Products
    canAddProduct:              ['admin', 'manager', 'inventory_clerk'],
    canEditProduct:             ['admin', 'manager', 'inventory_clerk'],
    canDeleteProduct:           ['admin', 'manager', 'inventory_clerk'],
    canPermanentlyDeleteProduct:['admin'],
    canRestoreProduct:          ['admin', 'manager', 'inventory_clerk'],
    canAdjustStock:             ['admin', 'manager', 'inventory_clerk'],

    // Suppliers
    canAddSupplier:             ['admin', 'manager', 'inventory_clerk'],
    canEditSupplier:            ['admin', 'manager', 'inventory_clerk'],
    canDeleteSupplier:          ['admin', 'manager', 'inventory_clerk'],
    canPermanentlyDeleteSupplier: ['admin'],

    // Purchase Orders
    canCreatePO:                ['admin', 'manager', 'inventory_clerk'],
    canEditPO:                  ['admin', 'manager', 'inventory_clerk'],
    canMarkPOReceived:          ['admin', 'manager', 'inventory_clerk'],
    canCancelPO:                ['admin', 'manager', 'inventory_clerk'],
    canPermanentlyDeletePO:     ['admin'],

    // Sales / Reports
    canVoidSale:                ['admin'],
    canPermanentlyDeleteSale:   ['admin'],
    canExportReports:           ['admin', 'manager'],

    // Users
    canViewUsers:               ['admin'],
    canEditUser:                ['admin'],
    canDeleteUser:              ['admin'],

    // Settings
    canEditSettings:            ['admin'],

    // ========== PHASE 4: Payment Permissions ==========
    // Process a sale (cash or mobile) – same as POS access
    canProcessSale:             ['admin', 'manager', 'cashier'],
    // Refund a payment (M-Pesa reverse transaction)
    canRefundPayment:           ['admin'],
    // View payment transactions (audit)
    canViewPaymentTransactions: ['admin', 'manager']
};

/**
 * Check if the current user has permission for a specific action.
 * Safe to call even when currentProfile is not yet loaded (returns false).
 */
function hasPermission(action) {
    if (!currentProfile || !currentProfile.role) return false;
    const allowedRoles = PERMISSIONS[action];
    if (!Array.isArray(allowedRoles)) return false;
    return allowedRoles.includes(currentProfile.role);
}

/**
 * Check if the current user can access a given page filename.
 */
function canAccessPage(page) {
    if (!currentProfile || !currentProfile.role) return false;
    const allowedRoles = PAGE_ACCESS[page];
    if (!Array.isArray(allowedRoles)) return true; // unknown pages are not restricted
    return allowedRoles.includes(currentProfile.role);
}

/**
 * Hide sidebar links for pages the user cannot access.
 */
function applySidebarAccess(attempt = 0) {
    // If profile not ready yet, retry up to ~2 s
    if (!currentProfile || !currentProfile.role) {
        if (attempt < 20) {
            setTimeout(() => applySidebarAccess(attempt + 1), 100);
        }
        return;
    }

    const links = document.querySelectorAll('.sidebar .sidebar-item[href]');
    links.forEach(link => {
        const href = link.getAttribute('href');
        const page = href ? href.split('?')[0] : '';
        if (page && PAGE_ACCESS[page] && !canAccessPage(page)) {
            link.style.display = 'none';
        } else {
            link.style.removeProperty('display');
        }
    });
}

// ── Global exports ─────────────────────────────────────────────────────────────
globalThis.ROLES           = ROLES;
globalThis.hasPermission   = hasPermission;
globalThis.canAccessPage   = canAccessPage;
globalThis.applySidebarAccess = applySidebarAccess;