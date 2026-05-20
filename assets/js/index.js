/**
 * index.js – VendGrid Landing Page Only
 * Migrated from main.js – contains only functions used by index.html
 */
document.addEventListener('DOMContentLoaded', function () {
    initializeApp();
});

function initializeApp() {
    setupSmoothScrolling();
    setupNavbarScroll();
    setupAnimations();
    setupFormValidation();
    setupTooltips();
    setupCounters();
}

// ── Smooth scrolling ──────────────────────────────────────────────────────────
function setupSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (!targetId || targetId === '#') return;
            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                window.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
            }
        });
    });
}

// ── Navbar scroll effect ──────────────────────────────────────────────────────
function setupNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    window.addEventListener('scroll', function () {
        navbar.classList.toggle('scrolled', (window.pageYOffset || document.documentElement.scrollTop) > 100);
        navbar.style.transform = 'translateY(0)';
    });
}

// ── Intersection Observer animations ─────────────────────────────────────────
function setupAnimations() {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.fade-in, .slide-in-left, .slide-in-right').forEach(el => observer.observe(el));
}

// ── Form validation ───────────────────────────────────────────────────────────
function setupFormValidation() {
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', function (e) {
            if (!validateForm(this)) e.preventDefault();
        });
    });
}

function validateForm(form) {
    let valid = true;
    form.querySelectorAll('input[required], textarea[required], select[required]').forEach(input => {
        if (!input.value.trim()) {
            showFieldError(input, 'This field is required');
            valid = false;
        } else {
            clearFieldError(input);
            if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
                showFieldError(input, 'Please enter a valid email address');
                valid = false;
            }
        }
    });
    return valid;
}

function showFieldError(field, message) {
    clearFieldError(field);
    const div = document.createElement('div');
    div.className = 'field-error text-danger small mt-1';
    div.textContent = message;
    field.classList.add('is-invalid');
    field.parentNode.appendChild(div);
}

function clearFieldError(field) {
    field.classList.remove('is-invalid');
    field.parentNode.querySelector('.field-error')?.remove();
}

// ── Tooltips ──────────────────────────────────────────────────────────────────
function setupTooltips() {
    if (typeof bootstrap === 'undefined') return;
    [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
        .forEach(el => new bootstrap.Tooltip(el));
}

// ── Animated counters ─────────────────────────────────────────────────────────
function setupCounters() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { animateCounter(e.target); obs.unobserve(e.target); } });
    });
    document.querySelectorAll('.counter').forEach(c => obs.observe(c));
}

function animateCounter(el) {
    const target    = parseInt(el.getAttribute('data-target'));
    const duration  = parseInt(el.getAttribute('data-duration')) || 2000;
    const increment = target / (duration / 16);
    let current = 0;
    const timer = setInterval(() => {
        current += increment;
        el.textContent = Math.floor(current);
        if (current >= target) { el.textContent = target; clearInterval(timer); }
    }, 16);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function () {
        if (!inThrottle) {
            func.apply(this, arguments);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

function showLoading(element) {
    element.innerHTML = '<span class="loading"></span> Loading...';
    element.disabled = true;
}

function hideLoading(element, originalText) {
    element.innerHTML = originalText;
    element.disabled = false;
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('toast-container') || createToastContainer();
    const bgMap = { success: 'success', error: 'danger', warning: 'warning', info: 'info' };
    const bg    = bgMap[type] || 'info';
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${bg} border-0`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    const body = document.createElement('div');
    body.className = 'toast-body';
    body.textContent = message;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close btn-close-white me-2 m-auto';
    closeBtn.setAttribute('data-bs-dismiss', 'toast');
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex';
    wrapper.appendChild(body);
    wrapper.appendChild(closeBtn);
    toast.appendChild(wrapper);
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

function createToastContainer() {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container position-fixed top-0 end-0 p-3';
    c.style.zIndex = '9999';
    document.body.appendChild(c);
    return c;
}

function formatCurrency(amount, currency = 'KES') {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount);
}

function formatDate(date, options = {}) {
    return new Intl.DateTimeFormat('en-KE', {
        year: 'numeric', month: 'short', day: 'numeric',
        ...options
    }).format(new Date(date));
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Copied to clipboard!', 'success');
        return true;
    } catch {
        showNotification('Failed to copy to clipboard', 'error');
        return false;
    }
}

function getUrlParameter(name)       { return new URLSearchParams(window.location.search).get(name); }
function setUrlParameter(name, val)  { const u = new URL(window.location); u.searchParams.set(name, val); history.replaceState({}, '', u); }
function removeUrlParameter(name)    { const u = new URL(window.location); u.searchParams.delete(name); history.replaceState({}, '', u); }
function isInViewport(el)            { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight); }

window.VendGrid = {
    escapeHtml,
    showNotification,
    formatCurrency,
    formatDate,
    copyToClipboard,
    isInViewport,
    getUrlParameter,
    setUrlParameter,
    removeUrlParameter,
    debounce,
    throttle,
    showLoading,
    hideLoading
};