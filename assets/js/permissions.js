/**
 * permissions.js – VendGrid Centralised Role-Based Access Control
 *
 * FIX 1: applySidebarAccess() is async-safe.
 * FIX 2: dashboard accessible to cashier & inventory_clerk.
 * FIX 3: Added canClearStockMovements and canPermanentlyDeleteCategory.
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

    // Stock Movements
    canClearStockMovements:     ['admin'],   // NEW

    // Categories
    canPermanentlyDeleteCategory: ['admin'], // NEW

    // Payment
    canProcessSale:             ['admin', 'manager', 'cashier'],
    canRefundPayment:           ['admin'],
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