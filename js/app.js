/* ==========================================================================
   Hossam ERP - Main Application Controller
   Wholesale Cigarette Cartons in Egyptian Pounds (EGP)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

const App = {
  db: null,
  activePage: 'dashboard',
  currentCart: {
    customerId: '',
    items: [], // { id, name, price, cost, qty, total }
    discount: 0,
    paidAmount: 0,
    sellerType: 'الإدارة (الرئيسية)',
    sellerId: null,
    sellerName: 'حسام'
  },
  posActiveTab: 'main', // 'main' or 'reps'
  selectedCategory: 'all',
  activeRepForPOS: null,

  init() {
    this.db = window.ERP_DB;
    this.sanitizeRepsData();
    this.reconcilePastRepInvoicesStock();
    this.reconcileRepsStats();
    this.bindEvents();
    this.setupClock();
    this.startListeners();

    if (!this.db || !this.db.currentUser) {
      this.lockAppForLogin();
      this.openLoginModal(true);
    } else {
      this.unlockAppAfterLogin();
    }
  },

  lockAppForLogin() {
    document.body.classList.add('app-auth-locked');
    this.applyUserPermissionsUI();
    this.updateHeaderProfile();
    this.updateLiveSidebarStats();
  },

  unlockAppAfterLogin() {
    document.body.classList.remove('app-auth-locked');
    this.applyUserPermissionsUI();
    this.updateHeaderProfile();
    this.updateLiveSidebarStats();
    if (!this.canAccessPage(this.activePage)) {
      this.activePage = this.getFirstAllowedPage();
    }
    this.navigateTo(this.activePage || 'dashboard');
  },

  _uiRefreshTimer: null,
  requestUIRefresh() {
    if (this._uiRefreshTimer) cancelAnimationFrame(this._uiRefreshTimer);
    this._uiRefreshTimer = requestAnimationFrame(() => {
      this.updateLiveSidebarStats();
      this.renderCurrentActiveView();
    });
  },

  renderCurrentActiveView() {
    this.updateLiveSidebarStats();
    if (this.activePage === 'dashboard' && typeof this.renderDashboard === 'function') {
      this.renderDashboard();
    } else if (this.activePage === 'inventory' && typeof this.renderInventory === 'function') {
      this.renderInventory();
    } else if (this.activePage === 'pos' && typeof this.renderPOSCatalog === 'function') {
      this.renderPOSCatalog();
    } else if (this.activePage === 'customers' && typeof this.renderCustomers === 'function') {
      this.renderCustomers();
    } else if (this.activePage === 'reps' && typeof this.renderRepsCards === 'function') {
      this.renderRepsCards();
    } else if (this.activePage === 'reports' && typeof this.renderReports === 'function') {
      this.renderReports();
    } else if (this.activePage === 'settings' && typeof this.renderSettings === 'function') {
      this.renderSettings();
    } else if (this.activePage === 'notifications' && typeof this.renderNotifications === 'function') {
      this.renderNotifications();
    }
  },

  sanitizeRepsData() {
    if (!this.db || !Array.isArray(this.db.reps)) return;
    const validCustIds = new Set((this.db.customers || []).map(c => c.id));
    const validItemIds = new Set((this.db.items || []).map(i => i.id));

    this.db.reps.forEach(rep => {
      // 1. Sanitize assigned customer IDs
      if (!Array.isArray(rep.assignedCustomerIds)) {
        rep.assignedCustomerIds = [];
      } else {
        rep.assignedCustomerIds = rep.assignedCustomerIds.filter(id => validCustIds.has(id));
      }
      rep.assignedCustomersCount = rep.assignedCustomerIds.length;
      const assignedCustomers = (this.db.customers || []).filter(c => rep.assignedCustomerIds.includes(c.id));
      rep.assignedDebts = assignedCustomers.reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);

      // 2. Sanitize active custody: remove items deleted from inventory or with 0 cartons
      if (!Array.isArray(rep.activeCustody)) {
        rep.activeCustody = [];
      } else {
        rep.activeCustody = rep.activeCustody.filter(c => {
          const itemId = c.itemId || c.id;
          return validItemIds.has(itemId) && (Number(c.cartons) || 0) > 0;
        });
      }
    });
  },

  reconcilePastRepInvoicesStock() {
    if (!this.db || !Array.isArray(this.db.invoices) || !Array.isArray(this.db.items)) return;
    this.db.invoices.forEach(inv => {
      const isRep = inv.sellerType === 'مندوب' || (this.db.reps || []).some(r => r.name === inv.sellerName || r.id === inv.sellerId);
      if (isRep && !inv.warehouseStockDeducted && Array.isArray(inv.items)) {
        inv.items.forEach(it => {
          const whItem = this.db.items.find(i => i.id === it.id || i.name === it.name);
          if (whItem) {
            whItem.cartonsInStock = Math.max(0, (Number(whItem.cartonsInStock) || 0) - (Number(it.qty) || 0));
          }
        });
        inv.warehouseStockDeducted = true;
      }
    });
  },

  reconcileRepsStats() {
    if (!this.db || !Array.isArray(this.db.reps)) return;

    const invoices = Array.isArray(this.db.invoices) ? this.db.invoices : [];
    const treasuryLogs = Array.isArray(this.db.treasuryLogs) ? this.db.treasuryLogs : [];
    const customers = Array.isArray(this.db.customers) ? this.db.customers : [];

    this.db.reps.forEach(rep => {
      // 1. Total Sales dynamically calculated from actual invoices
      const repInvoices = invoices.filter(inv => 
        (inv.sellerType === 'مندوب' || (this.db.reps || []).some(r => r.name === inv.sellerName || r.id === inv.sellerId)) &&
        (inv.sellerName === rep.name || inv.sellerId === rep.id)
      );
      rep.totalSales = repInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);

      // 2. Total Supplied dynamically calculated from actual treasury logs
      const repSupplies = treasuryLogs.filter(log => 
        (log.type === 'توريد نقدية مندوب' || log.type === 'توريد نقدية') && 
        log.sourceName && log.sourceName.includes(rep.name)
      );
      rep.totalSupplied = repSupplies.reduce((sum, log) => sum + (Number(log.amount) || 0), 0);

      // 3. Assigned Debts dynamically calculated from actual assigned customers
      const assignedCustIds = Array.isArray(rep.assignedCustomerIds) ? rep.assignedCustomerIds : [];
      const assignedCusts = customers.filter(c => assignedCustIds.includes(c.id));
      rep.assignedDebts = assignedCusts.reduce((sum, c) => sum + (Number(c.currentDebt) || 0), 0);
      rep.assignedCustomersCount = assignedCusts.length;

      // 4. Current cash integrity:
      if (repInvoices.length === 0 && (Number(rep.currentCash) || 0) > 0) {
        rep.currentCash = 0;
      }
    });
  },

  reconcileAllStats() {
    this.sanitizeRepsData();
    this.reconcileRepsStats();
    this.requestUIRefresh();
  },

  // Realtime Listeners for Firestore Collections
  startListeners() {
    if (!window.FDB) return;

    // 1. Items Realtime Sync
    window.FDB.initRealtimeSync('items', (items) => {
      if (items && Array.isArray(items)) {
        this.db.items = items;
        this.syncDB();
        this.requestUIRefresh();
      }
    });

    // 2. Customers Realtime Sync
    window.FDB.initRealtimeSync('customers', (customers) => {
      if (customers && Array.isArray(customers)) {
        this.db.customers = customers;
        this.syncDB();
        this.requestUIRefresh();
      }
    });

    // 3. Invoices Realtime Sync
    window.FDB.initRealtimeSync('invoices', (invoices) => {
      if (invoices && Array.isArray(invoices)) {
        // Sort newest first
        this.db.invoices = invoices.sort((a, b) => new Date(b.date || b.localTimestamp || 0) - new Date(a.date || a.localTimestamp || 0));
        this.reconcilePastRepInvoicesStock();
        this.syncDB();
        this.requestUIRefresh();
      }
    });

    // 4. Treasury Logs Realtime Sync
    window.FDB.initRealtimeSync('treasury', (logs) => {
      if (logs && Array.isArray(logs)) {
        this.db.treasuryLogs = logs.sort((a, b) => new Date(b.date || b.localTimestamp || 0) - new Date(a.date || a.localTimestamp || 0));
        this.syncDB();
        this.requestUIRefresh();
      }
    });

    // 5. Reps Realtime Sync
    window.FDB.initRealtimeSync('reps', (reps) => {
      if (reps && Array.isArray(reps)) {
        this.db.reps = reps;
        this.sanitizeRepsData();
        this.reconcileRepsStats();
        this.syncDB();
        this.requestUIRefresh();
      }
    });

    // 6. Users Realtime Sync
    window.FDB.initRealtimeSync('users', (users) => {
      if (users && Array.isArray(users)) {
        this.db.users = users;
        this.syncDB();
        if (this.activePage === 'settings') this.renderSettings();
      }
    });

    // 7. Settings & Capital Realtime Sync
    window.FDB.initRealtimeSync('settings', (docs) => {
      if (docs && docs.length > 0) {
        const capitalDoc = docs.find(d => d.id === 'capital');
        if (capitalDoc && capitalDoc.capital !== undefined) {
          this.db.capital = Number(capitalDoc.capital) || 0;
        }
        if (capitalDoc && capitalDoc.treasury !== undefined) {
          this.db.treasury = Number(capitalDoc.treasury) || 0;
        }
        const configDoc = docs.find(d => d.id === 'config');
        if (configDoc) {
          this.db.settings = { ...this.db.settings, ...configDoc };
        }
        this.syncDB();
        this.requestUIRefresh();
      }
    });

    // 8. Notifications Realtime Sync
    window.FDB.initRealtimeSync('notifications', (notifs) => {
      if (notifs && Array.isArray(notifs)) {
        this.db.notifications = notifs.sort((a, b) => new Date(b.localTimestamp || 0) - new Date(a.localTimestamp || 0));
        this.syncDB();
        this.requestUIRefresh();
      }
    });
  },

  // User & Permission Management Helpers
  getCurrentUser() {
    if (!this.db || !this.db.currentUser) return null;
    let u = this.db.currentUser;
    const isHossam = u.id === 'user_1' || u.id === 'admin_root' || (u.name && u.name.includes('حسام')) || u.username === 'admin' || u.username === 'hossam';
    if (isHossam) {
      u.role = 'مدير النظام (أدمن)';
      if (!u.permissions || !u.permissions.includes('كافة الصلاحيات')) {
        u.permissions = [
          'كافة الصلاحيات',
          'الخزينة والمصروفات',
          'الأسعار وسياسة البيع',
          'المخزون وإدخال الشحنات',
          'إدارة المستخدمين والإعدادات',
          'التقارير والأرباح',
          'نقطة بيع المندوب',
          'مبيعات المخزن (كاشير)',
          'سندات قبض وتحصيل',
          'إدارة العملاء والديون',
          'إدارة المناديب والعهد'
        ];
      }
    }
    return u;
  },

  isCurrentUserAdmin() {
    const user = this.getCurrentUser();
    if (!user) return false;
    const uName = (user.name || '').toLowerCase();
    const uRole = (user.role || '').toLowerCase();
    const uLogin = (user.username || '').toLowerCase();

    // 1. Hossam - The Owner & Main Account (Always full admin privileges)
    if (user.id === 'user_1' || user.id === 'admin_root' || uName.includes('حسام') || uName.includes('hossam') || uLogin === 'admin' || uLogin === 'hossam' || uLogin === 'حسام') {
      return true;
    }
    // 2. Admin / Manager / Owner roles
    if (uRole.includes('مدير') || uRole.includes('أدمن') || uRole.includes('مالك') || uRole.includes('admin') || uRole.includes('manager')) {
      return true;
    }
    // 3. Full permissions array
    if (Array.isArray(user.permissions) && (user.permissions.includes('كافة الصلاحيات') || user.permissions.includes('*') || user.permissions.includes('all'))) {
      return true;
    }
    return false;
  },

  isCurrentUserRep() {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (this.isCurrentUserAdmin()) return false;
    return user.role === 'مندوب توزيع' || (this.db.reps || []).some(r => r.username === user.username || r.name === user.name);
  },

  getLinkedRep() {
    const user = this.getCurrentUser();
    if (!user) return null;
    return (this.db.reps || []).find(r => r.username === user.username || r.name === user.name || r.id === user.repId) || null;
  },

  hasPermission(permKeyOrLabel) {
    const user = this.getCurrentUser();
    if (!user || !user.permissions) return false;
    if (this.isCurrentUserAdmin()) return true;
    if (user.permissions.includes('كافة الصلاحيات') || user.permissions.includes('*')) return true;
    return user.permissions.some(p => p === permKeyOrLabel || p.toLowerCase() === permKeyOrLabel.toLowerCase());
  },

  canAccessPage(pageId) {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (this.isCurrentUserAdmin()) return true;
    switch (pageId) {
      case 'pos':
        return this.hasPermission('نقطة بيع المندوب') || this.hasPermission('مبيعات المخزن (كاشير)') || this.isCurrentUserRep();
      case 'customers':
        return this.hasPermission('سندات قبض عملائه') || this.hasPermission('إدارة العملاء والديون') || this.isCurrentUserRep();
      case 'dashboard':
        return this.hasPermission('لوحة التحكم والإحصائيات') || this.hasPermission('التقارير والأرباح');
      case 'inventory':
        return this.hasPermission('المخزون وإدخال الشحنات') || this.hasPermission('الأسعار وسياسة البيع');
      case 'reports':
        return this.hasPermission('التقارير والأرباح');
      case 'notifications':
        return this.hasPermission('مركز الإشعارات') || this.hasPermission('التقارير والأرباح');
      case 'settings':
        return this.hasPermission('إدارة المستخدمين والإعدادات');
      default:
        return false;
    }
  },

  getFirstAllowedPage() {
    const pages = ['pos', 'customers', 'dashboard', 'inventory', 'reports', 'settings'];
    for (const p of pages) {
      if (this.canAccessPage(p)) return p;
    }
    return 'pos';
  },

  applyUserPermissionsUI() {
    const user = this.getCurrentUser();
    if (!user) {
      this.activeRepForPOS = null;
      this.currentCart.sellerType = 'غير مسجل';
      this.currentCart.sellerId = null;
      this.currentCart.sellerName = 'تسجيل الدخول';

      const navIds = ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'notifications', 'settings'];
      navIds.forEach(id => {
        const el = document.getElementById('nav-' + id);
        if (el) el.style.display = 'none';
      });
      document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(btn => {
        if (btn.getAttribute('data-page')) btn.style.display = 'none';
      });
      return;
    }

    const isRep = this.isCurrentUserRep();
    const isAdmin = this.isCurrentUserAdmin();
    const rep = isRep ? this.getLinkedRep() : null;

    if (isAdmin) {
      this.activeRepForPOS = null;
      this.currentCart.sellerType = 'الإدارة (الرئيسية)';
      this.currentCart.sellerId = null;
      this.currentCart.sellerName = user.name || 'حسام (المدير العام)';
    } else if (isRep && rep) {
      this.activeRepForPOS = rep;
      this.currentCart.sellerType = 'مندوب';
      this.currentCart.sellerId = rep.id;
      this.currentCart.sellerName = rep.name;
    } else {
      this.activeRepForPOS = null;
      this.currentCart.sellerType = 'مستخدم';
      this.currentCart.sellerId = null;
      this.currentCart.sellerName = user.name || 'مستخدم';
    }

    // 1. Sidebar desktop navigation items
    const pageNavMap = {
      'dashboard': document.getElementById('nav-dashboard'),
      'pos': document.getElementById('nav-pos'),
      'inventory': document.getElementById('nav-inventory'),
      'customers': document.getElementById('nav-customers'),
      'reports': document.getElementById('nav-reports'),
      'notifications': document.getElementById('nav-notifications'),
      'settings': document.getElementById('nav-settings')
    };

    for (const [pageId, el] of Object.entries(pageNavMap)) {
      if (el) {
        el.style.display = this.canAccessPage(pageId) ? 'flex' : 'none';
      }
    }

    // 2. Mobile Bottom Navigation items
    document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(btn => {
      const page = btn.getAttribute('data-page');
      if (page) {
        btn.style.display = this.canAccessPage(page) ? 'flex' : 'none';
      }
    });

    // 3. POS Sub-Tabs: if rep, hide rep switcher
    const posTabSwitch = document.querySelector('.pos-tab-switch');
    const repTabBtn = document.getElementById('pos-tab-reps');
    if (isRep) {
      if (posTabSwitch) posTabSwitch.style.display = 'none';
      if (repTabBtn) repTabBtn.style.display = 'none';
      this.posActiveTab = 'main';
    } else {
      if (posTabSwitch) posTabSwitch.style.display = 'flex';
      if (repTabBtn) repTabBtn.style.display = 'inline-flex';
    }

    // 4. Header treasury pill
    const treasuryPill = document.querySelector('.quick-treasury-pill');
    if (treasuryPill) {
      if (isRep && rep) {
        treasuryPill.onclick = () => App.openRepSuppliesModal(rep.id);
        treasuryPill.title = 'النقدية المحصلة معك حالياً - انقر لعرض سجل توريداتك';
        treasuryPill.innerHTML = `<span>💵 نقدية معك:</span> <span id="header-treasury-val" style="color: var(--emerald-neon); font-weight: 800;">${this.formatMoney(rep.currentCash || 0)} ج.م</span>`;
      } else {
        treasuryPill.onclick = () => App.navigateTo('reports');
        treasuryPill.title = 'الخزينة الحالية';
        treasuryPill.innerHTML = `<span>🏦 الخزينة:</span> <span id="header-treasury-val">${this.formatMoney(this.db.treasury || 0)} ج.م</span>`;
      }
    }

    // 5. Sidebar footer stats labels
    const stat1Title = document.querySelector('.sidebar-footer-stats .quick-stat-box:nth-child(1) .quick-stat-title');
    const stat2Title = document.querySelector('.sidebar-footer-stats .quick-stat-box:nth-child(2) .quick-stat-title');
    if (isRep) {
      if (stat1Title) stat1Title.innerHTML = `<span>🚚</span> أصناف عهدتك:`;
      if (stat2Title) stat2Title.innerHTML = `<span>📦</span> قروصات بالسيارة:`;
    } else {
      if (stat1Title) stat1Title.innerHTML = `<span>📦</span> عدد الأصناف:`;
      if (stat2Title) stat2Title.innerHTML = `<span>🏭</span> كراتين المخزن:`;
    }

    // 6. Customer add buttons (only admin can add/allocate customers)
    const quickAddCustBtn = document.getElementById('btn-pos-quick-add-cust');
    if (quickAddCustBtn) quickAddCustBtn.style.display = isRep ? 'none' : 'inline-flex';
    const mainAddCustBtn = document.getElementById('btn-add-customer-main');
    if (mainAddCustBtn) mainAddCustBtn.style.display = isRep ? 'none' : 'inline-flex';

    this.updateLiveSidebarStats();
  },

  // Save changes to localStorage and refresh stats
  syncDB() {
    window.DBManager.save(this.db);
    this.updateLiveSidebarStats();
  },

  formatMoney(num) {
    if (isNaN(num) || num === null || num === undefined) return '0';
    return Number(num).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },

  showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  // Live sidebar counters: عدد الأصناف وإجمالي القروصات بالمخزن
  updateLiveSidebarStats() {
    const isRep = this.isCurrentUserRep();
    const rep = isRep ? this.getLinkedRep() : null;

    let totalItems = this.db.items.length;
    let totalCartons = this.db.items.reduce((sum, item) => sum + (Number(item.cartonsInStock) || 0), 0);

    if (isRep && rep) {
      const custody = rep.activeCustody || [];
      totalItems = custody.length;
      totalCartons = custody.reduce((sum, c) => sum + (Number(c.cartons) || 0), 0);
    }

    const elItems = document.getElementById('sidebar-total-items');
    const elCartons = document.getElementById('sidebar-total-cartons');
    if (elItems) elItems.textContent = totalItems;
    if (elCartons) elCartons.textContent = totalCartons.toLocaleString('en-US');

    // Update notifications badge in sidebar & header
    const unreadCount = this.db.notifications.filter(n => !n.read).length;
    const navBadge = document.getElementById('nav-notif-badge');
    const headerBadge = document.getElementById('header-notif-badge');
    if (navBadge) {
      navBadge.textContent = unreadCount;
      navBadge.style.display = unreadCount > 0 && !isRep ? 'inline-block' : 'none';
    }
    if (headerBadge) {
      headerBadge.style.display = unreadCount > 0 && !isRep ? 'block' : 'none';
    }

    // Header Treasury pill
    const headerTreasury = document.getElementById('header-treasury-val');
    if (headerTreasury) {
      if (isRep && rep) {
        headerTreasury.textContent = this.formatMoney(rep.currentCash || 0) + ' ج.م';
      } else {
        headerTreasury.textContent = this.formatMoney(this.db.treasury || 0) + ' ج.م';
      }
    }
  },

  updateDashboardStats() {
    this.updateLiveSidebarStats();
    if (this.activePage === 'dashboard') {
      this.renderDashboard();
    }
  },

  updateHeaderProfile() {
    const user = this.getCurrentUser();
    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const avatarEl = document.getElementById('header-user-avatar');
    const dropdownFullname = document.getElementById('dropdown-fullname-val');
    const dropdownUsername = document.getElementById('dropdown-username-val');

    if (!user) {
      if (nameEl) nameEl.textContent = 'تسجيل الدخول';
      if (roleEl) roleEl.textContent = 'غير متصل';
      if (avatarEl) avatarEl.textContent = '🔒';
      if (dropdownFullname) dropdownFullname.textContent = 'لم يتم تسجيل الدخول بعد';
      if (dropdownUsername) dropdownUsername.textContent = '---';
      return;
    }

    const isAdmin = this.isCurrentUserAdmin();
    const isRep = this.isCurrentUserRep();
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.role;
    if (avatarEl) avatarEl.textContent = user.name ? user.name.charAt(0) : 'ح';

    if (dropdownFullname) {
      const permsSummary = isAdmin ? ' (كافة الصلاحيات)' : (isRep ? ' (صلاحيات مقيدة)' : '');
      dropdownFullname.textContent = `${user.name} - ${user.role}${permsSummary}`;
    }
    if (dropdownUsername) dropdownUsername.textContent = user.username;
  },

  setupClock() {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleDateString('ar-EG-u-nu-latn', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      const clockEl = document.getElementById('header-date-clock');
      if (clockEl) clockEl.textContent = timeStr;
    };
    updateTime();
  },

  // Events registration
  bindEvents() {
    // Navigation links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = link.getAttribute('data-page');
        if (pageId) {
          this.navigateTo(pageId);
        }
      });
    });

    // Global Header Search
    const searchInput = document.getElementById('global-search-input');
    const searchDropdown = document.getElementById('global-search-results');
    if (searchInput && searchDropdown) {
      searchInput.addEventListener('input', (e) => {
        this.handleGlobalSearch(e.target.value.trim(), searchDropdown);
      });
      document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
          searchDropdown.classList.remove('show');
        }
      });
    }

    // Profile menu toggle
    const profileBtn = document.getElementById('header-profile-btn');
    const profileMenu = document.getElementById('header-profile-dropdown');
    if (profileBtn && profileMenu) {
      profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        profileMenu.classList.toggle('show');
      });
      document.addEventListener('click', () => profileMenu.classList.remove('show'));
    }

    // Notification button in header
    const notifBtn = document.getElementById('header-notif-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => {
        this.navigateTo('notifications');
      });
    }

    // Mobile menu toggle
    const mobileBtn = document.getElementById('mobile-toggle-btn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        this.toggleSidebar();
      });
    }
  },

  toggleSidebar(open) {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const shouldOpen = open !== undefined ? open : !sidebar?.classList.contains('open');
    if (sidebar) sidebar.classList.toggle('open', shouldOpen);
    if (overlay) overlay.classList.toggle('active', shouldOpen);
  },

  navigateTo(pageId) {
    if (!this.getCurrentUser()) {
      this.openLoginModal(true);
      return;
    }
    if (!this.canAccessPage(pageId)) {
      this.showToast('عفواً، ليس لديك صلاحية للوصول إلى هذا القسم', 'error');
      const fallback = this.getFirstAllowedPage();
      if (this.activePage !== fallback) {
        this.navigateTo(fallback);
      }
      return;
    }

    this.activePage = pageId;

    // Update active class on desktop sidebar nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.getAttribute('data-page') === pageId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update active class on mobile bottom nav bar items
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      if (item.getAttribute('data-page') === pageId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update page views
    document.querySelectorAll('.page-view').forEach(view => {
      if (view.id === `page-${pageId}`) {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });

    // Close mobile sidebar and overlay
    this.toggleSidebar(false);

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Render corresponding page logic
    this.renderCurrentPage();
  },

  renderCurrentPage() {
    switch (this.activePage) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'pos':
        this.renderPOS();
        break;
      case 'inventory':
        this.renderInventory();
        break;
      case 'customers':
        this.renderCustomers();
        break;
      case 'reports':
        this.renderReports();
        break;
      case 'notifications':
        this.renderNotifications();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  },

  // ==========================================
  // 1. DASHBOARD & ANALYTICS
  // ==========================================
  renderDashboard() {
    // 1. Daily Sales (Safe date matching)
    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const dailySales = (this.db.invoices || [])
      .filter(inv => {
        if (!inv.date) return false;
        if (typeof inv.date === 'string' && inv.date.startsWith(todayISO)) return true;
        const d = new Date(inv.date);
        return !isNaN(d) && d.toISOString().split('T')[0] === todayISO;
      })
      .reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);

    // 2. Monthly Sales
    const currentMonthPrefix = todayISO.substring(0, 7);
    const monthlySales = (this.db.invoices || [])
      .filter(inv => {
        if (!inv.date) return false;
        if (typeof inv.date === 'string' && inv.date.startsWith(currentMonthPrefix)) return true;
        const d = new Date(inv.date);
        return !isNaN(d) && d.toISOString().substring(0, 7) === currentMonthPrefix;
      })
      .reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);

    // 3. Net Profit (calculated on all invoices)
    const totalProfit = (this.db.invoices || []).reduce((sum, inv) => sum + (Number(inv.netProfit) || 0), 0);

    // 4. Low stock count
    const lowStockCount = (this.db.items || []).filter(item => (Number(item.cartonsInStock) || 0) <= (Number(item.reorderLevel) || 15)).length;

    // 5. Total Market Debt (ديون العملاء)
    const totalMarketDebt = (this.db.customers || []).reduce((sum, c) => sum + (Number(c.currentDebt) || 0), 0);

    // 6. Capital (رأس المال)
    const capital = Number(this.db.capital) || 0;

    // 7. Cash in Treasury (النقدية الحالية بالخزينة)
    const treasuryCash = Number(this.db.treasury) || 0;

    // 8. Total Liquidity (السيولة الشاملة = نقدية الخزينة + نقدية المناديب)
    const repsCash = (this.db.reps || []).reduce((sum, r) => sum + (Number(r.currentCash) || 0), 0);
    const totalLiquidity = treasuryCash + repsCash;

    // Set KPI values in DOM
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = this.formatMoney(val);
    };

    setVal('dash-daily-sales', dailySales);
    setVal('dash-monthly-sales', monthlySales);
    setVal('dash-net-profit', totalProfit);
    setVal('dash-market-debts', totalMarketDebt);
    setVal('dash-capital', capital);
    setVal('dash-liquidity', totalLiquidity);
    setVal('dash-treasury', treasuryCash);

    const netProfitEl = document.getElementById('dash-net-profit');
    if (netProfitEl) {
      netProfitEl.style.color = totalProfit >= 0 ? 'var(--emerald)' : 'var(--rose)';
    }

    const lowStockEl = document.getElementById('dash-low-stock');
    if (lowStockEl) lowStockEl.textContent = lowStockCount;

    // Render Recent Invoices in Dashboard
    const recentInvoicesTable = document.getElementById('dash-recent-invoices');
    if (recentInvoicesTable) {
      const recent = this.db.invoices.slice(0, 5);
      if (recent.length === 0) {
        recentInvoicesTable.innerHTML = `<tr><td colspan="7" class="text-center" style="text-align:center; padding: 20px; color: var(--text-muted);">لا توجد فواتير بعد</td></tr>`;
      } else {
        recentInvoicesTable.innerHTML = recent.map(inv => `
          <tr>
            <td><strong style="color: var(--gold);">${inv.id}</strong></td>
            <td>${inv.customerName}</td>
            <td>
              <span class="badge-status blue" style="font-weight: 700; font-size: 0.8rem; white-space: nowrap;">
                ${(inv.items || []).length} صنف (${(inv.items || []).reduce((s, it) => s + Number(it.qty || 0), 0)} قروصة)
              </span>
            </td>
            <td>${inv.sellerName}</td>
            <td><strong>${this.formatMoney(inv.grandTotal)} ج.م</strong></td>
            <td>
              <span class="badge-status ${inv.remainingAmount > 0 ? 'warning' : 'success'}">
                ${inv.remainingAmount > 0 ? `أجل (${this.formatMoney(inv.remainingAmount)})` : 'كاش مسدد'}
              </span>
            </td>
            <td class="table-actions-cell">
              <div class="table-actions-row">
                <button class="btn btn-secondary btn-sm" onclick="App.viewInvoiceModal('${inv.id}')" title="معاينة الفاتورة">
                  معاينة
                </button>
                <button class="btn btn-primary btn-sm" onclick="App.openEditInvoiceModal('${inv.id}')" title="تعديل الفاتورة">
                  ✏️ تعديل
                </button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteInvoice('${inv.id}')" title="حذف الفاتورة">
                  🗑️ حذف
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    // Render Stock alerts list in Dashboard
    const stockAlertsList = document.getElementById('dash-stock-alerts');
    if (stockAlertsList) {
      const urgentItems = this.db.items.filter(item => (Number(item.cartonsInStock) || 0) <= (Number(item.reorderLevel) || 15));
      if (urgentItems.length === 0) {
        stockAlertsList.innerHTML = `<p style="color: var(--emerald); text-align: center; padding: 20px;">جميع الأصناف متوفرة فوق حد الطلب الآمن ✓</p>`;
      } else {
        stockAlertsList.innerHTML = urgentItems.map(it => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-input); border-radius: var(--radius-md); margin-bottom: 8px; border: 1px solid var(--border-color);">
            <div>
              <div style="font-weight: 700;">${it.icon} ${it.name}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">حد الطلب: ${it.reorderLevel} قروصة</div>
            </div>
            <div>
              <span class="badge-status danger">متبقي: ${it.cartonsInStock} قروصة</span>
            </div>
          </div>
        `).join('');
      }
    }
  },

  // Modal: إضافة رأس مال / تغذية أو تسوية الخزينة
  openAddCapitalModal() {
    const modalHtml = `
      <div class="modal-header">
        <h3>💰 تغذية رأس المال والخزينة وتعديل الرصيد</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">نوع العملية</label>
          <select id="modal-capital-type" class="custom-select" onchange="App.onCapitalTypeChange(this.value)">
            <option value="both" selected>إيداع وتغذية لرأس المال والخزينة معاً (+)</option>
            <option value="adjust_treasury">تسوية وتحديد رصيد الخزينة المباشر (=)</option>
            <option value="adjust_capital">تسوية وتحديد رأس المال المستثمر (=)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" id="modal-capital-amount-label">المبلغ المراد إيداعه (بالجنيه المصري) *</label>
          <input type="number" id="modal-capital-amount" class="form-control" placeholder="اكتب المبلغ" min="0" step="100" autofocus>
          <div id="modal-capital-helper" style="font-size: 0.78rem; color: #94a3b8; margin-top: 6px;">
            الرصيد المسجل حالياً: الخزينة (${this.formatMoney(this.db.treasury || 0)} ج.م) | رأس المال (${this.formatMoney(this.db.capital || 0)} ج.م)
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">المودع / مسؤول العملية</label>
          <input type="text" id="modal-capital-source" class="form-control" value="${this.db.currentUser?.name || this.db.settings?.ownerName || 'حسام (المالك)'}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveAddCapital()">💾 تأكيد وتطبيق العملية</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  onCapitalTypeChange(val) {
    const label = document.getElementById('modal-capital-amount-label');
    const input = document.getElementById('modal-capital-amount');
    if (!label || !input) return;
    if (val === 'adjust_treasury') {
      label.textContent = 'تحديد رصيد الخزينة المباشر الجديد (ج.م) *';
      input.value = this.db.treasury || 0;
    } else if (val === 'adjust_capital') {
      label.textContent = 'تحديد رأس المال المستثمر الجديد (ج.م) *';
      input.value = this.db.capital || 0;
    } else {
      label.textContent = 'المبلغ المراد إيداعه وتغذيته (ج.م) *';
      input.value = '';
    }
  },

  saveAddCapital() {
    const opType = document.getElementById('modal-capital-type')?.value || 'both';
    const amount = Number(document.getElementById('modal-capital-amount')?.value);
    const source = document.getElementById('modal-capital-source')?.value || 'حسام (المالك)';

    if (isNaN(amount) || amount < 0) {
      this.showToast('يرجى كتابة مبلغ صحيح', 'error');
      return;
    }

    if (opType === 'adjust_treasury') {
      this.db.treasury = amount;
      this.addNotification({
        title: 'تسوية رصيد الخزينة',
        desc: `تم تعديل وتسوية رصيد الخزينة إلى ${this.formatMoney(amount)} ج.م بواسطة ${source}`,
        type: 'treasury'
      });
      this.showToast(`تم تعديل وتسوية رصيد الخزينة إلى ${this.formatMoney(amount)} ج.م بنجاح`);
    } else if (opType === 'adjust_capital') {
      this.db.capital = amount;
      this.addNotification({
        title: 'تسوية رأس المال',
        desc: `تم تعديل وتسوية رأس المال المستثمر إلى ${this.formatMoney(amount)} ج.م بواسطة ${source}`,
        type: 'treasury'
      });
      this.showToast(`تم تعديل رأس المال إلى ${this.formatMoney(amount)} ج.م بنجاح`);
    } else {
      if (amount <= 0) {
        this.showToast('يرجى كتابة مبلغ أكبر من الصفر للإيداع', 'error');
        return;
      }
      this.db.capital = (this.db.capital || 0) + amount;
      this.db.treasury = (this.db.treasury || 0) + amount;

      if (!this.db.treasuryLogs) this.db.treasuryLogs = [];
      const newLog = {
        id: `TR-${Date.now().toString().slice(-4)}`,
        date: new Date().toLocaleString('ar-EG-u-nu-latn'),
        type: 'تغذية رأس المال',
        sourceName: source,
        receivedBy: this.db.currentUser?.name || 'حسام (المدير العام)',
        amount: amount,
        notes: 'إيداع وتغذية رأس المال والخزينة'
      };
      this.db.treasuryLogs.unshift(newLog);
      if (window.FDB) {
        window.FDB.addDocument('treasury', newLog);
      }
      this.addNotification({
        title: 'إيداع وتغذية نقدية بالخزينة',
        desc: `تم إيداع مبلغ ${this.formatMoney(amount)} ج.م بواسطة ${source}`,
        type: 'treasury'
      });
      this.showToast(`تم إيداع ${this.formatMoney(amount)} ج.م بنجاح في رأس المال والخزينة`);
    }

    this.syncDB();
    if (window.FDB) {
      window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
    }
    this.closeModal();
    this.reconcileAllStats();
  },

  // ==========================================
  // 2. POINT OF SALE (POS)
  // ==========================================
  renderPOS() {
    // Setup tab buttons
    const mainTabBtn = document.getElementById('pos-tab-main');
    const repsTabBtn = document.getElementById('pos-tab-reps');
    const mainPosView = document.getElementById('pos-main-container');
    const repsPosView = document.getElementById('pos-reps-container');

    if (this.posActiveTab === 'main') {
      if (mainTabBtn) mainTabBtn.classList.add('active');
      if (repsTabBtn) repsTabBtn.classList.remove('active');
      if (mainPosView) mainPosView.style.display = 'grid';
      if (repsPosView) repsPosView.style.display = 'none';
      this.renderPOSCatalog();
      this.renderPOSCart();
    } else {
      if (mainTabBtn) mainTabBtn.classList.remove('active');
      if (repsTabBtn) repsTabBtn.classList.add('active');
      if (mainPosView) mainPosView.style.display = 'none';
      if (repsPosView) repsPosView.style.display = 'block';
      this.renderRepsCards();
    }
  },

  setPOSTab(tab) {
    this.posActiveTab = tab;
    this.renderPOS();
  },

  // Render product catalog cards in POS
  renderPOSCatalog() {
    const grid = document.getElementById('pos-products-grid');
    if (!grid) return;

    const searchVal = (document.getElementById('pos-search-input')?.value || '').toLowerCase();
    
    // Filter items (all one cigarette type)
    let filtered = this.db.items.filter(item => {
      return item.name.toLowerCase().includes(searchVal) || (item.barcode && item.barcode.includes(searchVal));
    });

    // If POS is in Rep dedicated mode
    let repNoticeHtml = '';
    if (this.activeRepForPOS) {
      const isRepUser = this.isCurrentUserRep();
      repNoticeHtml = `
        <div style="grid-column: 1 / -1; background: rgba(59, 130, 246, 0.15); border: 1px solid var(--blue); padding: 12px 18px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <div>
            <strong>⚡ نقطة بيع المندوب: ${this.activeRepForPOS.name}</strong> 
            <span style="font-size: 0.85rem; color: var(--text-secondary); margin-right: 8px;">(الخصم يتم من عهدة المندوب مباشرة)</span>
          </div>
          ${!isRepUser ? `<button class="btn btn-secondary btn-sm" onclick="App.exitRepPOS()">العودة لنقطة البيع الرئيسية</button>` : ''}
        </div>
      `;
    }

    if (filtered.length === 0) {
      grid.innerHTML = repNoticeHtml + `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">لا توجد أصناف مطابقة لبحثك</div>`;
      return;
    }

    grid.innerHTML = repNoticeHtml + filtered.map(item => {
      let stockAvailable = item.cartonsInStock;
      
      // If selling from rep custody
      if (this.activeRepForPOS) {
        const repCustodyItem = this.activeRepForPOS.activeCustody?.find(c => c.itemId === item.id);
        stockAvailable = repCustodyItem ? repCustodyItem.cartons : 0;
      }

      let stockBadgeClass = 'badge-in-stock';
      let stockText = `${stockAvailable} قروصة متوفرة`;
      if (stockAvailable <= 0) {
        stockBadgeClass = 'badge-out-stock';
        stockText = 'نفذ من المخزن';
      } else if (stockAvailable <= item.reorderLevel) {
        stockBadgeClass = 'badge-low-stock';
        stockText = `متبقي ${stockAvailable} قروصة (قرب ينفذ)`;
      }

      return `
        <div class="product-card" onclick="App.addToCart('${item.id}')">
          <span class="product-badge-stock ${stockBadgeClass}">${stockText}</span>
          <div class="product-icon-wrap">${item.icon || '📦'}</div>
          <div>
            <div class="product-name">${item.name}</div>
            <div class="product-barcode">باركود: ${item.barcode}</div>
          </div>
          <div class="product-footer-row">
            <div class="product-price-box">
              <span class="product-price-label">سعر القروصة</span>
              <span class="product-price-val">${this.formatMoney(item.sellingPrice)} <span style="font-size: 0.75rem;">ج.م</span></span>
            </div>
            <button class="btn-add-cart" title="إضافة للفاتورة">+</button>
          </div>
        </div>
      `;
    }).join('');
  },

  filterPOSCategory(cat, el) {
    this.selectedCategory = cat;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    this.renderPOSCatalog();
  },

  addToCart(itemId) {
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    let available = item.cartonsInStock;
    if (this.activeRepForPOS) {
      const repItem = this.activeRepForPOS.activeCustody?.find(c => c.itemId === item.id);
      available = repItem ? repItem.cartons : 0;
    }

    if (available <= 0) {
      this.showToast(`عفواً، الصنف ${item.name} غير متوفر حالياً`, 'error');
      return;
    }

    const existing = this.currentCart.items.find(i => i.id === itemId);
    if (existing) {
      if (existing.qty + 1 > available) {
        this.showToast(`الكمية المطلوبة تتجاوز الرصيد المتوفر (${available} قروصة)`, 'error');
        return;
      }
      existing.qty += 1;
      existing.total = existing.qty * existing.price;
    } else {
      this.currentCart.items.push({
        id: item.id,
        name: item.name,
        price: item.sellingPrice,
        cost: item.purchasePrice,
        qty: 1,
        discount: 0,
        total: item.sellingPrice
      });
    }

    this.renderPOSCart();
    this.showToast(`تمت إضافة ${item.name} للسلة`);
  },

  updateCartQty(itemId, delta) {
    const itemInCart = this.currentCart.items.find(i => i.id === itemId);
    if (!itemInCart) return;

    const origItem = this.db.items.find(i => i.id === itemId);
    let available = origItem ? origItem.cartonsInStock : 999;
    if (this.activeRepForPOS) {
      const repItem = this.activeRepForPOS.activeCustody?.find(c => c.itemId === itemId);
      available = repItem ? repItem.cartons : 0;
    }

    const newQty = itemInCart.qty + delta;
    if (newQty <= 0) {
      this.removeFromCart(itemId);
      return;
    }

    if (newQty > available) {
      this.showToast(`الكمية تتجاوز الرصيد المتاح بالمخزن (${available} قروصة)`, 'error');
      return;
    }

    itemInCart.qty = newQty;
    const disc = Number(itemInCart.discount) || 0;
    itemInCart.total = Math.max(0, (itemInCart.qty * itemInCart.price) - disc);

    const qtyInput = document.getElementById(`cart-qty-${itemId}`);
    if (qtyInput) qtyInput.value = newQty;

    const totalEl = document.getElementById(`cart-item-total-${itemId}`);
    if (totalEl) totalEl.textContent = this.formatMoney(itemInCart.total) + ' ج.م';

    const grossEl = document.getElementById(`cart-item-gross-${itemId}`);
    if (grossEl) {
      if (itemInCart.discount > 0) {
        grossEl.style.display = 'block';
        grossEl.textContent = this.formatMoney(itemInCart.qty * itemInCart.price) + ' ج.م';
      } else {
        grossEl.style.display = 'none';
      }
    }

    this.recalcPOSCartTotals();
  },

  updateCartItemPrice(itemId, priceVal) {
    const itemInCart = this.currentCart.items.find(i => i.id === itemId);
    if (!itemInCart) return;
    const p = Math.max(0, Number(priceVal) || 0);
    itemInCart.price = p;
    const disc = Number(itemInCart.discount) || 0;
    itemInCart.total = Math.max(0, (itemInCart.qty * p) - disc);

    const totalEl = document.getElementById(`cart-item-total-${itemId}`);
    if (totalEl) totalEl.textContent = this.formatMoney(itemInCart.total) + ' ج.م';

    const grossEl = document.getElementById(`cart-item-gross-${itemId}`);
    if (grossEl) {
      if (itemInCart.discount > 0) {
        grossEl.style.display = 'block';
        grossEl.textContent = this.formatMoney(itemInCart.qty * p) + ' ج.م';
      } else {
        grossEl.style.display = 'none';
      }
    }

    this.recalcPOSCartTotals();
  },

  updateCartItemQtyInput(itemId, qtyVal) {
    const itemInCart = this.currentCart.items.find(i => i.id === itemId);
    if (!itemInCart) return;
    const q = Math.max(1, Number(qtyVal) || 1);
    itemInCart.qty = q;
    const disc = Number(itemInCart.discount) || 0;
    itemInCart.total = Math.max(0, (q * itemInCart.price) - disc);

    const totalEl = document.getElementById(`cart-item-total-${itemId}`);
    if (totalEl) totalEl.textContent = this.formatMoney(itemInCart.total) + ' ج.م';

    const grossEl = document.getElementById(`cart-item-gross-${itemId}`);
    if (grossEl) {
      if (itemInCart.discount > 0) {
        grossEl.style.display = 'block';
        grossEl.textContent = this.formatMoney(q * itemInCart.price) + ' ج.م';
      } else {
        grossEl.style.display = 'none';
      }
    }

    this.recalcPOSCartTotals();
  },

  updateCartItemDiscount(itemId, discountVal) {
    const itemInCart = this.currentCart.items.find(i => i.id === itemId);
    if (!itemInCart) return;
    const disc = Math.max(0, Number(discountVal) || 0);
    itemInCart.discount = disc;
    itemInCart.total = Math.max(0, (itemInCart.qty * itemInCart.price) - disc);

    const totalEl = document.getElementById(`cart-item-total-${itemId}`);
    if (totalEl) {
      totalEl.textContent = this.formatMoney(itemInCart.total) + ' ج.م';
      totalEl.style.color = disc > 0 ? 'var(--emerald)' : 'inherit';
    }

    const grossEl = document.getElementById(`cart-item-gross-${itemId}`);
    if (grossEl) {
      if (disc > 0) {
        grossEl.style.display = 'block';
        grossEl.textContent = this.formatMoney(itemInCart.qty * itemInCart.price) + ' ج.م';
      } else {
        grossEl.style.display = 'none';
      }
    }

    const discInput = document.getElementById(`cart-disc-${itemId}`);
    if (discInput) {
      discInput.style.borderColor = disc > 0 ? 'var(--gold)' : 'var(--border-subtle)';
      discInput.style.color = disc > 0 ? 'var(--gold)' : 'var(--text-white)';
    }

    this.recalcPOSCartTotals();
  },

  removeFromCart(itemId) {
    this.currentCart.items = this.currentCart.items.filter(i => i.id !== itemId);
    this.renderPOSCart();
  },

  async clearCart() {
    if (this.currentCart.items.length === 0) return;

    const totalQty = this.currentCart.items.reduce((s, i) => s + (i.quantity || 0), 0);
    const subtotal = this.currentCart.items.reduce((s, i) => s + (i.total || 0), 0);

    const confirmed = await this.confirmDialog({
      title: 'إلغاء الفاتورة وتفريغ السلة',
      subtitle: 'إشعار تأكيد تفريغ محتويات سلة البيع',
      message: 'هل أنت متأكد من إلغاء الفاتورة وتفريغ جميع الأصناف المضافة؟',
      icon: '🛒',
      type: 'warning',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">عدد الأصناف:</span>
            <span class="value">${this.currentCart.items.length} أصناف (${totalQty} قروصة)</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">إجمالي القيمة:</span>
            <span class="value text-rose">${this.formatMoney(subtotal)} ج.م</span>
          </div>
        </div>
        <div class="confirm-notice-box">⚠️ سيتم حذف محتويات السلة الحالية والبدء بفاتورة جديدة فارغة.</div>
      `,
      confirmText: 'نعم، تفريغ السلة',
      cancelText: 'الاحتفاظ بالسلة'
    });

    if (!confirmed) return;

    this.currentCart.items = [];
    this.currentCart.discount = 0;
    this.currentCart.paidAmount = 0;
    this.currentCart.customerId = '';
    const paidEl = document.getElementById('cart-paid-input');
    if (paidEl) paidEl.value = '';
    const discEl = document.getElementById('cart-discount-input');
    if (discEl) discEl.value = 0;
    const custSelect = document.getElementById('cart-customer-select');
    if (custSelect) custSelect.value = '';
    this.renderPOSCart();
    this.showToast('تم إلغاء الفاتورة وتفريغ السلة');
  },

  setCartPaidFull() {
    const subtotal = this.currentCart.items.reduce((sum, i) => sum + i.total, 0);
    const invoiceDiscount = Number(document.getElementById('cart-discount-input')?.value) || 0;
    const grandTotal = Math.max(0, subtotal - invoiceDiscount);
    const paidInput = document.getElementById('cart-paid-input');
    if (paidInput) {
      paidInput.value = grandTotal;
      this.handleCartPaidChange();
    }
  },

  setCartPaidZero() {
    const paidInput = document.getElementById('cart-paid-input');
    if (paidInput) {
      paidInput.value = 0;
      this.handleCartPaidChange();
    }
  },

  renderPOSCart() {
    // Render Customer Select options
    const custSelect = document.getElementById('cart-customer-select');
    if (custSelect) {
      const prevVal = custSelect.value;
      const isRep = this.isCurrentUserRep();
      const currentRep = isRep ? (this.activeRepForPOS || this.getLinkedRep()) : this.activeRepForPOS;

      let customersList = this.db.customers || [];
      if (currentRep) {
        const assignedIds = Array.isArray(currentRep.assignedCustomerIds) ? currentRep.assignedCustomerIds : [];
        customersList = (this.db.customers || []).filter(c => assignedIds.includes(c.id));
      }

      if (currentRep && customersList.length === 0) {
        custSelect.innerHTML = `
          <option value="">لا يوجد عملاء مخصصين لك (بيع نقدي عام)</option>
        `;
        this.currentCart.customerId = '';
      } else {
        custSelect.innerHTML = `
          <option value="">${currentRep ? 'اختر العميل المخصص (أو عميل نقدي عام)...' : 'اختر العميل (أو عميل نقدي عام)...'}</option>
          ${customersList.map(c => `
            <option value="${c.id}" ${c.id === (this.currentCart.customerId || prevVal) ? 'selected' : ''}>
              ${c.name} (دين: ${this.formatMoney(c.currentDebt)} ج.م)
            </option>
          `).join('')}
        `;
        this.currentCart.customerId = custSelect.value;
      }
    }

    // Render items list in Cart
    const listEl = document.getElementById('cart-items-list');
    if (listEl) {
      if (this.currentCart.items.length === 0) {
        listEl.innerHTML = `<div class="empty-cart-msg">السلة فارغة، اختر الأصناف بالقروصة لإضافتها للفاتورة</div>`;
      } else {
        listEl.innerHTML = this.currentCart.items.map(it => `
          <div class="cart-item" style="padding: 10px 12px; gap: 8px;">
            <div class="cart-item-info" style="flex: 1;">
              <div class="cart-item-title" style="font-weight: 700;">${it.name}</div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                <span style="font-size: 0.76rem; color: var(--text-secondary);">السعر:</span>
                <input type="number" id="cart-price-${it.id}" min="0" value="${it.price}" 
                       oninput="App.updateCartItemPrice('${it.id}', this.value)" 
                       style="width: 76px; height: 26px; padding: 2px 6px; font-size: 0.85rem; font-weight: 800; background: rgba(15, 23, 42, 0.9); border: 1px solid var(--border-subtle); color: var(--emerald-neon); border-radius: 4px; text-align: center;" 
                       title="اكتب سعر البيع يدوياً">
                <span style="font-size: 0.72rem; color: var(--text-muted);">ج.م</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;">
                <span style="font-size: 0.75rem; color: var(--gold); font-weight: 600;">خصم الصنف:</span>
                <input type="number" id="cart-disc-${it.id}" min="0" value="${it.discount || 0}" 
                       oninput="App.updateCartItemDiscount('${it.id}', this.value)" 
                       style="width: 70px; height: 26px; padding: 2px 6px; font-size: 0.8rem; background: rgba(15, 23, 42, 0.8); border: 1px solid ${it.discount > 0 ? 'var(--gold)' : 'var(--border-subtle)'}; color: ${it.discount > 0 ? 'var(--gold)' : 'var(--text-white)'}; border-radius: 4px; text-align: center;" 
                       placeholder="0" title="خصم بالجنيه على هذا الصنف">
                <span style="font-size: 0.72rem; color: var(--text-muted);">ج.م</span>
              </div>
            </div>
            <div class="cart-item-controls" style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <button type="button" class="cart-qty-btn" onclick="App.updateCartQty('${it.id}', -1)">-</button>
                <input type="number" id="cart-qty-${it.id}" min="1" value="${it.qty}" 
                       oninput="App.updateCartItemQtyInput('${it.id}', this.value)" 
                       style="width: 44px; height: 28px; padding: 2px; font-size: 0.9rem; font-weight: 800; background: rgba(15, 23, 42, 0.9); border: 1px solid var(--border-subtle); color: var(--text-white); border-radius: 4px; text-align: center;" 
                       title="اكتب الكمية يدوياً">
                <button type="button" class="cart-qty-btn" onclick="App.updateCartQty('${it.id}', 1)">+</button>
                <button type="button" class="cart-item-del" onclick="App.removeFromCart('${it.id}')" title="حذف">&times;</button>
              </div>
              <div>
                <div id="cart-item-gross-${it.id}" style="font-size: 0.75rem; text-decoration: line-through; color: var(--text-muted); text-align: left; display: ${it.discount > 0 ? 'block' : 'none'};">
                  ${this.formatMoney(it.qty * it.price)} ج.م
                </div>
                <span id="cart-item-total-${it.id}" class="cart-item-total" style="font-weight: 800; font-size: 0.95rem; color: ${it.discount > 0 ? 'var(--emerald)' : 'inherit'};">
                  ${this.formatMoney(it.total)} ج.م
                </span>
              </div>
            </div>
          </div>
        `).join('');
      }
    }

    this.recalcPOSCartTotals();
  },

  recalcPOSCartTotals() {
    // Calculations
    const grossTotal = this.currentCart.items.reduce((sum, i) => sum + (i.qty * i.price), 0);
    const totalItemDiscounts = this.currentCart.items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0);
    const subtotal = this.currentCart.items.reduce((sum, i) => sum + i.total, 0);

    const discountInput = document.getElementById('cart-discount-input');
    const invoiceDiscount = discountInput ? (Number(discountInput.value) || 0) : 0;
    this.currentCart.discount = invoiceDiscount;

    const grandTotal = Math.max(0, subtotal - invoiceDiscount);

    // Paid amount logic
    const paidInput = document.getElementById('cart-paid-input');
    const hasCustomer = !!this.currentCart.customerId;

    let paid;
    if (paidInput && paidInput.value !== '') {
      paid = Number(paidInput.value);
    } else {
      // If customer is selected, default to 0 paid (credit / آجل) so remaining = grandTotal
      // If no customer (walk-in cash customer), default to full cash
      paid = hasCustomer ? 0 : grandTotal;
    }
    if (isNaN(paid)) paid = hasCustomer ? 0 : grandTotal;
    this.currentCart.paidAmount = paid;

    const remaining = Math.max(0, grandTotal - paid);

    // Set DOM texts
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = this.formatMoney(val) + ' ج.م';
    };

    setVal('cart-subtotal-val', grossTotal);

    const itemDiscRow = document.getElementById('cart-items-discount-row');
    const itemDiscVal = document.getElementById('cart-items-discount-val');
    if (itemDiscRow && itemDiscVal) {
      if (totalItemDiscounts > 0) {
        itemDiscRow.style.display = 'flex';
        itemDiscVal.textContent = `- ${this.formatMoney(totalItemDiscounts)} ج.م`;
      } else {
        itemDiscRow.style.display = 'none';
      }
    }

    setVal('cart-grandtotal-val', grandTotal);
    setVal('cart-remaining-val', remaining);

    const remRow = document.getElementById('cart-remaining-row');
    if (remRow) {
      remRow.style.color = remaining > 0 ? 'var(--rose)' : 'var(--emerald)';
    }

    // Customer Debt Impact: dynamically show old debt and new debt after this invoice
    const prevDebtRow = document.getElementById('cart-customer-debt-prev-row');
    const newDebtRow = document.getElementById('cart-customer-debt-new-row');
    const prevDebtVal = document.getElementById('cart-customer-debt-prev-val');
    const newDebtVal = document.getElementById('cart-customer-debt-new-val');

    if (hasCustomer) {
      const customer = (this.db.customers || []).find(c => c.id === this.currentCart.customerId);
      if (customer) {
        const prevDebt = Number(customer.currentDebt) || 0;
        const newDebt = prevDebt + remaining;
        if (prevDebtRow && prevDebtVal) {
          prevDebtRow.style.display = 'flex';
          prevDebtVal.textContent = this.formatMoney(prevDebt) + ' ج.م';
        }
        if (newDebtRow && newDebtVal) {
          newDebtRow.style.display = 'flex';
          newDebtVal.textContent = this.formatMoney(newDebt) + ' ج.م';
          newDebtVal.style.color = newDebt > 0 ? 'var(--rose)' : 'var(--emerald)';
        }
      } else {
        if (prevDebtRow) prevDebtRow.style.display = 'none';
        if (newDebtRow) newDebtRow.style.display = 'none';
      }
    } else {
      if (prevDebtRow) prevDebtRow.style.display = 'none';
      if (newDebtRow) newDebtRow.style.display = 'none';
    }
  },

  handleCartDiscountChange() {
    this.recalcPOSCartTotals();
  },

  handleCartPaidChange() {
    this.recalcPOSCartTotals();
  },

  handleCartCustomerChange() {
    const custSelect = document.getElementById('cart-customer-select');
    this.currentCart.customerId = custSelect ? custSelect.value : '';
    this.recalcPOSCartTotals();
  },

  // Modal: إضافة عميل سريع من الفاتورة
  openQuickAddCustomerModal() {
    if (this.isCurrentUserRep()) {
      this.showToast('إضافة العملاء وتخصيصهم متاح فقط لحساب الإدارة الرئيسية', 'error');
      return;
    }
    const modalHtml = `
      <div class="modal-header">
        <h3>👤 إضافة عميل جديد سريعاً</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">اسم العميل / المحل *</label>
          <input type="text" id="quick-cust-name" class="form-control" placeholder="مثال: كشك البركة (أبو علي)">
        </div>
        <div class="form-group">
          <label class="form-label">رقم الموبايل *</label>
          <input type="text" id="quick-cust-phone" class="form-control" placeholder="01xxxxxxxxx">
        </div>
        <div class="form-group">
          <label class="form-label">العنوان / المنطقة</label>
          <input type="text" id="quick-cust-area" class="form-control" placeholder="مثال: شبرا الخيمة">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveQuickCustomer()">حفظ العميل واختياره</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  saveQuickCustomer() {
    const name = document.getElementById('quick-cust-name').value.trim();
    const phone = document.getElementById('quick-cust-phone').value.trim();
    const area = document.getElementById('quick-cust-area').value.trim() || 'القاهرة';

    if (!name || !phone) {
      this.showToast('يرجى كتابة اسم العميل ورقم الموبايل', 'error');
      return;
    }

    const activeRep = this.activeRepForPOS || null;
    const newCust = {
      id: `cust_${Date.now()}`,
      name,
      phone,
      area,
      assignedRepId: activeRep ? activeRep.id : null,
      assignedRepName: activeRep ? activeRep.name : 'الإدارة المركزية',
      totalPurchases: 0,
      totalPaid: 0,
      currentDebt: 0,
      status: 'active'
    };

    if (activeRep) {
      if (!activeRep.assignedCustomerIds) activeRep.assignedCustomerIds = [];
      if (!activeRep.assignedCustomerIds.includes(newCust.id)) {
        activeRep.assignedCustomerIds.push(newCust.id);
        activeRep.assignedCustomersCount = activeRep.assignedCustomerIds.length;
      }
    }

    this.db.customers.push(newCust);
    this.currentCart.customerId = newCust.id;
    this.syncDB();
    if (window.FDB) {
      window.FDB.addDocument('customers', newCust);
      if (activeRep) window.FDB.updateDocument('reps', activeRep.id, activeRep);
    }
    this.closeModal();
    this.showToast(`تم تسجيل العميل ${name} واختياره للفاتورة`);
    this.renderPOSCart();
  },

  // ==========================================
  // INVOICE RECEIPT GENERATION & EXPORT
  // ==========================================
  // زر "فتح الفاتورة" وتوليد المعاينة الحية
  openInvoicePreviewModal() {
    if (this.currentCart.items.length === 0) {
      this.showToast('لا توجد أصناف في السلة لفتح الفاتورة', 'error');
      return;
    }

    const grossTotal = this.currentCart.items.reduce((sum, i) => sum + (i.qty * i.price), 0);
    const totalItemDiscounts = this.currentCart.items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0);
    const subtotal = this.currentCart.items.reduce((sum, i) => sum + i.total, 0);
    const discount = this.currentCart.discount || 0;
    const grandTotal = Math.max(0, subtotal - discount);

    const customer = this.db.customers.find(c => c.id === this.currentCart.customerId);
    const paidInput = document.getElementById('cart-paid-input');
    let paid;
    if (paidInput && paidInput.value !== '') {
      paid = Number(paidInput.value);
    } else if (this.currentCart.paidAmount !== undefined && this.currentCart.paidAmount !== null) {
      paid = Number(this.currentCart.paidAmount);
    } else {
      paid = customer ? 0 : grandTotal;
    }
    if (isNaN(paid)) paid = customer ? 0 : grandTotal;

    const remaining = Math.max(0, grandTotal - paid);
    const totalItemsCount = this.currentCart.items.length;
    const totalCartons = this.currentCart.items.reduce((sum, it) => sum + Number(it.qty || 0), 0);

    const custName = customer ? customer.name : 'عميل نقدي عام';
    const custPhone = customer ? customer.phone : '---';
    const invoiceNo = `INV-${Date.now().toString().slice(-4)}`;
    const nowStr = new Date().toLocaleString('ar-EG-u-nu-latn');
    const seller = this.activeRepForPOS ? this.activeRepForPOS.name : (this.db.currentUser?.name || 'حسام');

    const modalHtml = `
      <div class="modal-header">
        <h3>🧾 معاينة الفاتورة الإلكترونية</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="background: #f1f5f9; padding: 20px;">
        
        <!-- Thermal Receipt Box for Image Conversion -->
        <div id="thermal-receipt-capture" class="receipt-wrapper">
          <div class="receipt-header">
            <div class="receipt-title">${this.db.settings.businessName}</div>
            <div class="receipt-subtitle">سجل تجاري وبطاقة ضريبية - جملة السجاير بالقروصة</div>
            <div class="receipt-subtitle">${this.db.settings.address} - هاتف: ${this.db.settings.phone}</div>
            <div class="receipt-meta">
              <span>رقم الفاتورة: <strong>${invoiceNo}</strong></span>
              <span>التاريخ: ${nowStr}</span>
            </div>
            <div class="receipt-meta">
              <span>العميل: <strong>${custName}</strong></span>
              <span>الهاتف: ${custPhone}</span>
            </div>
            <div class="receipt-meta">
              <span>المسؤول / البائع: <strong>${seller}</strong></span>
            </div>
          </div>

          <table class="receipt-table">
            <thead>
              <tr>
                <th style="text-align: right;">الصنف (قروصة)</th>
                <th style="text-align: center;">الكمية</th>
                <th style="text-align: center;">السعر</th>
                <th style="text-align: center;">خصم الصنف</th>
                <th style="text-align: left;">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              ${this.currentCart.items.map(it => `
                <tr>
                  <td>${it.name}</td>
                  <td style="text-align: center; font-weight: bold;">${it.qty}</td>
                  <td style="text-align: center;">${it.price}</td>
                  <td style="text-align: center; color: ${it.discount > 0 ? '#dc2626' : '#94a3b8'}; font-weight: ${it.discount > 0 ? 'bold' : 'normal'};">
                    ${it.discount > 0 ? `- ${this.formatMoney(it.discount)}` : '0'}
                  </td>
                  <td style="text-align: left; font-weight: bold;">${this.formatMoney(it.total)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="background: #f1f5f9; font-weight: bold; border-top: 2px solid #cbd5e1;">
                <td style="text-align: right; color: #1e3a8a;">إجمالي الأصناف: ${totalItemsCount} صنف</td>
                <td style="text-align: center; color: #1e3a8a; font-weight: 800;">${totalCartons} قروصة</td>
                <td colspan="3" style="text-align: left; color: #64748b; font-size: 0.8rem;">إجمالي كمية القروصات</td>
              </tr>
            </tfoot>
          </table>

          <div class="receipt-totals">
            <div class="receipt-total-row" style="background: #eff6ff; padding: 6px 10px; border-radius: 6px; font-weight: bold; color: #1e3a8a; margin-bottom: 6px; border: 1px solid #bfdbfe;">
              <span>إجمالي عدد الأصناف والكمية:</span>
              <span style="font-weight: 800;">${totalItemsCount} صنف (${totalCartons} قروصة)</span>
            </div>
            <div class="receipt-total-row">
              <span>المجموع الفرعي (قبل الخصم):</span>
              <span>${this.formatMoney(grossTotal)} ج.م</span>
            </div>
            ${totalItemDiscounts > 0 ? `
              <div class="receipt-total-row" style="color: #dc2626;">
                <span>إجمالي خصم الأصناف:</span>
                <span>- ${this.formatMoney(totalItemDiscounts)} ج.م</span>
              </div>
            ` : ''}
            ${discount > 0 ? `
              <div class="receipt-total-row" style="color: #dc2626;">
                <span>خصم الفاتورة العام:</span>
                <span>- ${this.formatMoney(discount)} ج.م</span>
              </div>
            ` : ''}
            <div class="receipt-total-row grand">
              <span>صافي إجمالي الفاتورة:</span>
              <span>${this.formatMoney(grandTotal)} ج.م</span>
            </div>
            <div class="receipt-total-row" style="color: #059669; font-weight: bold;">
              <span>المبلغ المدفوع (كاش):</span>
              <span>${this.formatMoney(paid)} ج.م</span>
            </div>
            ${remaining > 0 ? `
              <div class="receipt-total-row" style="color: #dc2626; font-weight: bold;">
                <span>المتبقي في الذمة (أجل):</span>
                <span>${this.formatMoney(remaining)} ج.م</span>
              </div>
            ` : ''}
            ${customer ? `
              <div class="receipt-total-row" style="border-top: 1px dashed #cbd5e1; margin-top: 6px; padding-top: 6px; color: #475569; font-weight: bold;">
                <span>رصيد الدين السابق:</span>
                <span>${this.formatMoney(customer.currentDebt || 0)} ج.م</span>
              </div>
              <div class="receipt-total-row" style="color: #dc2626; font-weight: 900; font-size: 1.05rem;">
                <span>إجمالي الدين الكلي بعد الفاتورة:</span>
                <span>${this.formatMoney((customer.currentDebt || 0) + remaining)} ج.م</span>
              </div>
            ` : ''}
          </div>

          <div class="receipt-footer">
            <div>${this.db.settings.receiptFooter}</div>
            <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">تم الإصدار عبر نظام Hossam ERP المتكامل</div>
          </div>
        </div>

      </div>
      <div class="modal-footer" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="App.downloadReceiptAsImage('${invoiceNo}')" style="display: inline-flex; align-items: center; gap: 6px;">
            <span>📥</span> تنزيل الفاتورة كصورة
          </button>
          <button class="btn" onclick="App.shareCurrentPOSInvoiceWhatsApp('${invoiceNo}')" style="background-color: #25D366; color: #ffffff; border: none; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(37,211,102,0.3); padding: 8px 14px; border-radius: 6px; cursor: pointer;">
            ${this.getWhatsAppIconSvg(18)}
            <span>إرسال صورة الفاتورة عبر واتساب</span>
          </button>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
          <button class="btn btn-blue" onclick="App.confirmSaveInvoice('${invoiceNo}')">
            💾 تأكيد وحفظ الفاتورة
          </button>
        </div>
      </div>
    `;

    this.openModal(modalHtml);
  },

  // أيقونة واتساب الرسمية بصيغة SVG عالية النقاء
  getWhatsAppIconSvg(size = 20) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#ffffff" style="vertical-align: middle; margin-left: 6px; display: inline-block;"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.669-.699c.969.54 1.761.812 2.791.812 3.179 0 5.766-2.587 5.767-5.767.001-3.187-2.58-5.767-5.767-5.767zm3.385 8.156c-.145.407-.747.747-1.034.795-.275.045-.634.079-1.026-.046-.241-.077-.552-.19-.949-.364-1.688-.737-2.784-2.457-2.869-2.57-.085-.114-.687-.914-.687-1.743 0-.829.434-1.236.589-1.405.155-.169.339-.212.452-.212.113 0 .226.002.325.006.104.004.244-.039.382.292.145.349.497 1.214.54 1.302.043.088.072.19.014.305-.058.115-.088.188-.175.291-.087.103-.183.23-.261.309-.088.089-.18.185-.078.36.103.175.457.755.981 1.222.675.602 1.244.788 1.42.875.176.088.279.074.382-.044.103-.118.441-.515.559-.692.118-.177.236-.147.397-.088.161.059 1.022.482 1.198.571.176.089.294.133.338.207.044.074.044.43-.101.837zM12 2C6.477 2 2 6.477 2 12c0 1.891.526 3.662 1.442 5.177L2 22l4.981-1.409A9.957 9.957 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.2c-1.625 0-3.14-.492-4.409-1.332l-.316-.21-2.964.839.803-2.935-.231-.334A8.168 8.168 0 0 1 3.8 12c0-4.521 3.679-8.2 8.2-8.2 4.522 0 8.2 3.679 8.2 8.2 0 4.522-3.678 8.2-8.2 8.2z"/></svg>`;
  },

  // رسم أي فاتورة على HTML5 Canvas عالي الدقة (للطباعة أو المشاركة كصورة)
  renderInvoiceToCanvas(invInput) {
    let inv = invInput;
    if (typeof invInput === 'string') {
      inv = (this.db.invoices || []).find(i => i.id === invInput);
      if (!inv) {
        // Fallback to active cart
        const customer = this.db.customers.find(c => c.id === this.currentCart.customerId);
        const subtotal = this.currentCart.items.reduce((sum, i) => sum + i.total, 0);
        const discount = this.currentCart.discount || 0;
        const grandTotal = Math.max(0, subtotal - discount);
        const paid = this.currentCart.paidAmount !== undefined ? this.currentCart.paidAmount : grandTotal;
        inv = {
          id: invInput,
          date: new Date().toLocaleDateString('ar-EG-u-nu-latn'),
          customerName: customer ? customer.name : 'عميل نقدي عام',
          customerPhone: customer ? customer.phone : '',
          sellerName: this.activeRepForPOS ? this.activeRepForPOS.name : (this.db.currentUser?.name || 'حسام'),
          items: this.currentCart.items,
          subTotal: subtotal,
          discount: discount,
          grandTotal: grandTotal,
          paidAmount: paid,
          remainingAmount: Math.max(0, grandTotal - paid)
        };
      }
    }

    const items = inv.items || [];
    const totalItemsCount = items.length;
    const totalCartons = items.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    const grossTotal = items.reduce((sum, i) => sum + (Number(i.qty) * Number(i.price)), 0);
    const totalItemDiscounts = items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const width = 500;
    const height = Math.max(570, 530 + (items.length * 32));

    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, width - 16, height - 16);

    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';

    // Header
    ctx.font = 'bold 20px Cairo, sans-serif';
    ctx.fillText(this.db.settings.businessName || 'مؤسسة حسام لتجارة وتوزيع السجاير بالجملة', width / 2, 45);

    ctx.font = '12px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('سجل تجاري وبطاقة ضريبية - جملة سجاير بالقروصة', width / 2, 70);
    ctx.fillText(`${this.db.settings.address || 'العنوان الرئيسي'} - هاتف: ${this.db.settings.phone || '01012345678'}`, width / 2, 90);

    // Dashed line
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(25, 105);
    ctx.lineTo(width - 25, 105);
    ctx.stroke();
    ctx.setLineDash([]);

    // Invoice Meta
    ctx.direction = 'rtl';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'right';

    ctx.fillText(`رقم الفاتورة: #${inv.id}`, width - 25, 130);
    ctx.fillText(`التاريخ: ${inv.date}`, width - 25, 150);
    ctx.fillText(`العميل: ${inv.customerName || 'عميل نقدي عام'}`, width - 25, 170);
    ctx.fillText(`البائع: ${inv.sellerName || (this.db.currentUser?.name || 'حسام')}`, width - 25, 190);

    // Table Header
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(25, 205, width - 50, 28);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(25, 205, width - 50, 28);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillText('الصنف (قروصة)', width - 35, 224);

    ctx.textAlign = 'center';
    ctx.fillText('الكمية', width - 200, 224);
    ctx.fillText('السعر', width - 270, 224);
    ctx.fillText('خصم الصنف', width - 355, 224);

    ctx.textAlign = 'left';
    ctx.fillText('الإجمالي', 35, 224);

    // Table Rows
    let currentY = 250;
    ctx.font = '12px Cairo, sans-serif';
    items.forEach((item) => {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1e293b';
      const itemName = item.name.length > 20 ? item.name.substring(0, 18) + '..' : item.name;
      ctx.fillText(itemName, width - 35, currentY);

      ctx.textAlign = 'center';
      ctx.fillText(`${item.qty}`, width - 200, currentY);
      ctx.fillText(`${item.price}`, width - 270, currentY);

      const itDisc = Number(item.discount) || 0;
      if (itDisc > 0) {
        ctx.fillStyle = '#dc2626';
        ctx.fillText(`- ${itDisc}`, width - 355, currentY);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('0', width - 355, currentY);
      }

      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'left';
      ctx.fillText(`${this.formatMoney(item.total || ((item.qty * item.price) - itDisc))} ج.م`, 35, currentY);

      currentY += 28;
    });

    // Summary row of items count on canvas
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(25, currentY, width - 50, 26);
    ctx.strokeStyle = '#bfdbfe';
    ctx.strokeRect(25, currentY, width - 50, 26);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`إجمالي الأصناف: ${totalItemsCount} صنف`, width - 35, currentY + 18);
    ctx.textAlign = 'left';
    ctx.fillText(`إجمالي الكمية: ${totalCartons} قروصة`, 35, currentY + 18);
    currentY += 36;

    // Dashed line before totals
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(25, currentY);
    ctx.lineTo(width - 25, currentY);
    ctx.stroke();
    ctx.setLineDash([]);
    currentY += 22;

    // Totals Box
    ctx.textAlign = 'right';
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillStyle = '#334155';

    ctx.fillText('المجموع الفرعي (قبل الخصم):', width - 35, currentY);
    ctx.textAlign = 'left';
    ctx.fillText(`${this.formatMoney(grossTotal)} ج.م`, 35, currentY);
    currentY += 22;

    if (totalItemDiscounts > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#dc2626';
      ctx.fillText('إجمالي خصم الأصناف:', width - 35, currentY);
      ctx.textAlign = 'left';
      ctx.fillText(`- ${this.formatMoney(totalItemDiscounts)} ج.م`, 35, currentY);
      currentY += 22;
    }

    if (inv.discount && inv.discount > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#dc2626';
      ctx.fillText('خصم الفاتورة العام:', width - 35, currentY);
      ctx.textAlign = 'left';
      ctx.fillText(`- ${this.formatMoney(inv.discount)} ج.م`, 35, currentY);
      currentY += 22;
    }

    // Grand Total
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px Cairo, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('صافي إجمالي الفاتورة:', width - 35, currentY);
    ctx.textAlign = 'left';
    ctx.fillText(`${this.formatMoney(inv.grandTotal)} ج.م`, 35, currentY);
    currentY += 24;

    // Paid & Remaining
    ctx.font = 'bold 13px Cairo, sans-serif';
    ctx.fillStyle = '#059669';
    ctx.textAlign = 'right';
    ctx.fillText('المبلغ المدفوع (كاش):', width - 35, currentY);
    ctx.textAlign = 'left';
    ctx.fillText(`${this.formatMoney(inv.paidAmount !== undefined ? inv.paidAmount : inv.grandTotal)} ج.م`, 35, currentY);
    currentY += 22;

    const rem = inv.remainingAmount || 0;
    if (rem > 0) {
      ctx.fillStyle = '#dc2626';
      ctx.textAlign = 'right';
      ctx.fillText('المتبقي في الذمة (أجل):', width - 35, currentY);
      ctx.textAlign = 'left';
      ctx.fillText(`${this.formatMoney(rem)} ج.م`, 35, currentY);
      currentY += 22;
    } else {
      ctx.fillStyle = '#059669';
      ctx.textAlign = 'right';
      ctx.fillText('حالة السداد:', width - 35, currentY);
      ctx.textAlign = 'left';
      ctx.fillText('مدفوع بالكامل كاش ✓', 35, currentY);
      currentY += 22;
    }

    const targetCust = inv.customerId ? (this.db.customers || []).find(c => c.id === inv.customerId) : null;
    if (targetCust) {
      const prevDebt = Number(targetCust.currentDebt) || 0;
      const totalCustomerDebt = (inv.customerId && (this.db.invoices || []).some(i => i.id === inv.id))
        ? prevDebt
        : prevDebt + rem;
      
      ctx.font = '12px Cairo, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'right';
      ctx.fillText('إجمالي دين العميل المستحق:', width - 35, currentY);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#dc2626';
      ctx.font = 'bold 13px Cairo, sans-serif';
      ctx.fillText(`${this.formatMoney(totalCustomerDebt)} ج.م`, 35, currentY);
      currentY += 22;
    }

    // Footer
    currentY += 10;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(25, currentY);
    ctx.lineTo(width - 25, currentY);
    ctx.stroke();
    currentY += 22;

    ctx.font = '11px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText(this.db.settings.receiptFooter || 'شكراً لتعاملكم معنا', width / 2, currentY);
    ctx.fillText('نظام Hossam ERP لتجارة السجاير بالجملة', width / 2, currentY + 18);

    return canvas;
  },

  // تنزيل الفاتورة كملف صورة عالي الجودة PNG
  downloadReceiptAsImage(invInput) {
    try {
      let inv = invInput;
      if (typeof invInput === 'string') {
        inv = (this.db.invoices || []).find(i => i.id === invInput);
      }
      const invId = (inv && inv.id) ? inv.id : (typeof invInput === 'string' ? invInput : 'INV-001');
      const canvas = this.renderInvoiceToCanvas(invInput);
      if (!canvas) {
        this.showToast('تعذر توليد صورة الفاتورة', 'error');
        return;
      }

      const link = document.createElement('a');
      link.download = `فاتورة_${invId}.png`;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      this.showToast(`تم تنزيل الفاتورة #${invId} كصورة عالية الدقة بنجاح`);
    } catch (e) {
      console.error('Error downloading invoice image:', e);
      this.showToast('حدث خطأ أثناء تنزيل صورة الفاتورة', 'error');
    }
  },

  downloadSavedInvoiceImage(invoiceId) {
    this.downloadReceiptAsImage(invoiceId);
  },

  // إرسال صورة الفاتورة عبر واتساب من نقطة البيع الحالية
  shareCurrentPOSInvoiceWhatsApp(invoiceNo) {
    const customer = this.db.customers.find(c => c.id === this.currentCart.customerId);
    const custName = customer ? customer.name : 'عميل نقدي عام';
    const custPhone = customer ? customer.phone : '';
    const seller = this.activeRepForPOS ? this.activeRepForPOS.name : (this.db.currentUser?.name || 'حسام');
    const grossTotal = this.currentCart.items.reduce((sum, i) => sum + (i.qty * i.price), 0);
    const totalItemDiscounts = this.currentCart.items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0);
    const subtotal = this.currentCart.items.reduce((sum, i) => sum + i.total, 0);
    const discount = this.currentCart.discount || 0;
    const grandTotal = Math.max(0, subtotal - discount);
    const paid = this.currentCart.paidAmount !== undefined ? this.currentCart.paidAmount : grandTotal;
    const remaining = Math.max(0, grandTotal - paid);

    const invObj = {
      id: invoiceNo,
      date: new Date().toLocaleDateString('ar-EG-u-nu-latn'),
      customerName: custName,
      customerPhone: custPhone,
      sellerName: seller,
      items: this.currentCart.items,
      grossTotal: grossTotal,
      totalItemDiscounts: totalItemDiscounts,
      subTotal: subtotal,
      discount: discount,
      grandTotal: grandTotal,
      paidAmount: paid,
      remainingAmount: remaining
    };

    this.executeWhatsAppInvoiceShare(invObj);
  },

  // إرسال صورة الفاتورة لفاتورة محفوظة مسبقاً
  shareSavedInvoiceWhatsApp(invoiceId) {
    const inv = (this.db.invoices || []).find(i => i.id === invoiceId);
    if (!inv) {
      this.showToast('لم يتم العثور على بيانات الفاتورة', 'error');
      return;
    }

    this.executeWhatsAppInvoiceShare(inv);
  },

  // تنفيذ إرسال صورة الفاتورة عبر واتساب كصورة حقيقية (وليس كلام)
  async executeWhatsAppInvoiceShare(inv) {
    if (!inv) return;
    this.showToast('جاري تجهيز صورة الفاتورة للمشاركة عبر واتساب... ⏳', 'info');

    // 1. توليد صورة الفاتورة عالية الدقة من الكانفاس
    const canvas = this.renderInvoiceToCanvas(inv);
    if (!canvas) {
      this.showToast('تعذر توليد صورة الفاتورة', 'error');
      return;
    }

    let cleanPhone = inv.customerPhone ? String(inv.customerPhone).replace(/[^0-9]/g, '') : '';
    if (cleanPhone.startsWith('01')) {
      cleanPhone = '2' + cleanPhone; // كود مصر
    }
    const fileName = `فاتورة_${inv.id}.png`;

    // 2. تحويل الكانفاس إلى Blob لاستخدامه كملف صورة
    canvas.toBlob(async (blob) => {
      if (!blob) {
        this.showToast('حدث خطأ أثناء معالجة ملف الصورة', 'error');
        return;
      }

      const file = new File([blob], fileName, { type: 'image/png' });

      // الطريقة الأولى: إذا كان المتصفح يدعم مشاركة الملفات مباشرة عبر Web Share API (الهواتف الذكية والتطبيقات)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `فاتورة #${inv.id}`,
            text: `فاتورة #${inv.id}`
          });
          this.showToast('تم فتح واتساب لاختيار جهة الاتصال ومشاركة صورة الفاتورة 📸');
          return;
        } catch (err) {
          if (err.name === 'AbortError') {
            return; // المستخدم أغلق قائمة المشاركة
          }
          console.warn('Web Share API error, fallback to clipboard and web share:', err);
        }
      }

      // الطريقة الثانية: متصفح الكمبيوتر / واتساب ويب
      // أ. نسخ الصورة مباشرة إلى حافظة النظام (Clipboard) لتلصق بـ Ctrl+V
      let copiedToClipboard = false;
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          copiedToClipboard = true;
        }
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }

      // ب. تنزيل ملف الصورة تلقائياً على الجهاز
      try {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
      } catch (e) {
        console.warn('Direct download error:', e);
      }

      // ج. فتح واتساب العام (قائمة المحادثات لاختيار أي رقم بحرية)
      window.open('https://web.whatsapp.com/', '_blank');

      // د. إظهار نافذة إرشادية أنيقة
      this.showWhatsAppImageGuideModal(inv, copiedToClipboard, cleanPhone);

    }, 'image/png');
  },

  showWhatsAppImageGuideModal(inv, copiedToClipboard, cleanPhone) {
    const invId = inv.id;
    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #25D366;">${this.getWhatsAppIconSvg(22)}</span> 
          <span>إرسال صورة الفاتورة #${invId} عبر واتساب</span>
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="text-align: center; padding: 22px 18px; gap: 14px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(37, 211, 102, 0.15); border: 2px solid #25D366; display: flex; align-items: center; justify-content: center; margin: 0 auto; color: #25D366; font-size: 1.8rem;">
          📸
        </div>
        <h3 style="color: var(--text-white); font-weight: 800; margin: 0; font-size: 1.15rem;">
          ${copiedToClipboard ? 'تم نسخ صورة الفاتورة تلقائياً وتنزيلها!' : 'تم تجهيز صورة الفاتورة بنجاح!'}
        </h3>
        <p style="color: var(--text-secondary); font-size: 0.92rem; line-height: 1.6; margin: 0;">
          تم فتح واتساب لاختيار أي شخص أو رقم ترغب بإرسال الفاتورة إليه.<br>
          ${copiedToClipboard 
            ? '👉 بعد فتح أي محادثة في واتساب، اضغط <strong style="color: #25D366; background: rgba(255,255,255,0.08); padding: 2px 7px; border-radius: 4px; font-family: monospace;">Ctrl + V</strong> (أو كليك يمين ثم لصق) لإرسال الصورة مباشرة كصورة عالية الدقة!' 
            : '👉 اسحب ملف الصورة المنزّل داخل أي محادثة في واتساب لإرسالها كصورة!'}
        </p>

        <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 440px; margin: 8px auto 0;">
          <button class="btn" onclick="window.open('https://web.whatsapp.com/', '_blank'); App.closeModal();" style="background: #25D366; color: #fff; font-weight: 800; padding: 10px 16px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; border: none; cursor: pointer; font-size: 0.95rem;">
            ${this.getWhatsAppIconSvg(20)}
            <span>فتح واتساب واختيار المحادثة من الشات 💬</span>
          </button>
          ${cleanPhone ? `
            <button class="btn btn-secondary btn-sm" onclick="window.open('https://wa.me/${cleanPhone}', '_blank'); App.closeModal();" style="font-size: 0.82rem; padding: 6px 12px; color: var(--text-secondary);">
              أو فتح محادثة الرقم المسجل بالفاتورة (${inv.customerPhone}) مباشرة
            </button>
          ` : ''}
        </div>

        <div style="display: flex; justify-content: center; margin-top: 6px;">
          <button class="btn btn-primary" onclick="App.closeModal()" style="min-width: 130px; font-weight: 700;">
            فهمت ذلك ✓
          </button>
        </div>
      </div>
    `;
    this.openModal(modalHtml, '520px');
  },

  // إرسال الفاتورة عبر واتساب مباشرة (توافق قديم)
  shareInvoiceWhatsApp(phone, custName, invoiceNo, grandTotal, paid, remaining) {
    this.shareCurrentPOSInvoiceWhatsApp(invoiceNo);
  },

  // حفظ الفاتورة رسمياً وتحديث المخزن والعميل والخزينة
  confirmSaveInvoice(invoiceNo) {
    if (this.currentCart.items.length === 0) return;

    const grossTotal = this.currentCart.items.reduce((sum, i) => sum + (i.qty * i.price), 0);
    const totalItemDiscounts = this.currentCart.items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0);
    const subtotal = this.currentCart.items.reduce((sum, i) => sum + i.total, 0);
    const totalCost = this.currentCart.items.reduce((sum, i) => sum + (i.cost * i.qty), 0);
    const discount = this.currentCart.discount || 0;
    const grandTotal = Math.max(0, subtotal - discount);

    const customer = this.db.customers.find(c => c.id === this.currentCart.customerId);

    const paidInput = document.getElementById('cart-paid-input');
    let paid;
    if (paidInput && paidInput.value !== '') {
      paid = Number(paidInput.value);
    } else if (this.currentCart.paidAmount !== undefined && this.currentCart.paidAmount !== null) {
      paid = Number(this.currentCart.paidAmount);
    } else {
      paid = customer ? 0 : grandTotal;
    }
    if (isNaN(paid)) paid = customer ? 0 : grandTotal;

    const remaining = Math.max(0, grandTotal - paid);
    const netProfit = grandTotal - totalCost;

    const custName = customer ? customer.name : 'عميل نقدي عام';
    const custPhone = customer ? customer.phone : '---';
    const sellerType = this.activeRepForPOS ? 'مندوب' : 'الإدارة (الرئيسية)';
    const sellerName = this.activeRepForPOS ? this.activeRepForPOS.name : (this.db.currentUser?.name || 'حسام');

    // 1. Deduct Stock Cartons (Always deduct from main warehouse inventory for all sales)
    this.currentCart.items.forEach(cartItem => {
      const warehouseItem = this.db.items.find(i => i.id === cartItem.id);
      if (warehouseItem) {
        warehouseItem.cartonsInStock = Math.max(0, warehouseItem.cartonsInStock - cartItem.qty);
      }
    });

    if (this.activeRepForPOS) {
      // Deduct from rep's custody
      this.currentCart.items.forEach(cartItem => {
        const repCustodyItem = this.activeRepForPOS.activeCustody?.find(c => c.itemId === cartItem.id);
        if (repCustodyItem) {
          repCustodyItem.cartons = Math.max(0, repCustodyItem.cartons - cartItem.qty);
        }
      });
      // Add paid cash to rep's cash in hand
      this.activeRepForPOS.currentCash = (this.activeRepForPOS.currentCash || 0) + paid;
      this.activeRepForPOS.totalSales = (this.activeRepForPOS.totalSales || 0) + grandTotal;
      if (remaining > 0) {
        this.activeRepForPOS.assignedDebts = (this.activeRepForPOS.assignedDebts || 0) + remaining;
      }
    } else {
      // Add paid cash directly to Main Treasury
      this.db.treasury = (this.db.treasury || 0) + paid;
      if (paid > 0) {
        this.db.treasuryLogs.unshift({
          id: `TR-${Date.now().toString().slice(-4)}`,
          date: new Date().toLocaleString('ar-EG-u-nu-latn'),
          type: 'مبيعات نقدية (فاتورة)',
          sourceName: `${custName} (فاتورة #${invoiceNo})`,
          receivedBy: sellerName,
          amount: paid,
          notes: `تحصيل نقدي من الفاتورة رقم ${invoiceNo}`
        });
      }
      // If customer has an assigned rep, update the assigned debts for that rep
      if (customer && customer.assignedRepId && remaining > 0) {
        const assignedRep = this.db.reps.find(r => r.id === customer.assignedRepId);
        if (assignedRep) {
          assignedRep.assignedDebts = (assignedRep.assignedDebts || 0) + remaining;
        }
      }
    }

    // 2. Update Customer's record if customer exists
    if (customer) {
      customer.totalPurchases = (customer.totalPurchases || 0) + grandTotal;
      customer.totalPaid = (customer.totalPaid || 0) + paid;
      customer.currentDebt = (customer.currentDebt || 0) + remaining;
    }

    // 3. Save to Invoices Log
    const newInvoice = {
      id: invoiceNo,
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      customerId: customer ? customer.id : null,
      customerName: custName,
      customerPhone: custPhone,
      sellerType: sellerType,
      sellerName: sellerName,
      items: JSON.parse(JSON.stringify(this.currentCart.items)),
      grossTotal: grossTotal,
      totalItemDiscounts: totalItemDiscounts,
      subTotal: subtotal,
      discount: discount,
      grandTotal: grandTotal,
      paidAmount: paid,
      remainingAmount: remaining,
      netProfit: netProfit,
      warehouseStockDeducted: true,
      paymentStatus: remaining > 0 ? (paid > 0 ? 'جزئي (أجل)' : 'أجل بالكامل') : 'مدفوع بالكامل'
    };
    this.db.invoices.unshift(newInvoice);

    // 4. Create Notification
    this.addNotification({
      title: `فاتورة جديدة #${invoiceNo}`,
      desc: `تم إصدار فاتورة بقيمة ${this.formatMoney(grandTotal)} ج.م للعميل ${custName} (مدفوع: ${this.formatMoney(paid)} - متبقي دين: ${this.formatMoney(remaining)})`,
      type: 'invoice'
    });

    // Reset Cart
    this.currentCart.items = [];
    this.currentCart.discount = 0;
    this.currentCart.paidAmount = 0;
    this.currentCart.customerId = '';

    const paidEl = document.getElementById('cart-paid-input');
    if (paidEl) paidEl.value = '';
    const discEl = document.getElementById('cart-discount-input');
    if (discEl) discEl.value = 0;
    const custSelect = document.getElementById('cart-customer-select');
    if (custSelect) custSelect.value = '';

    this.syncDB();
    if (window.FDB) {
      window.FDB.addDocument('invoices', newInvoice);
      if (customer) window.FDB.updateDocument('customers', customer.id, customer);

      // Always update warehouse items in Firestore
      newInvoice.items.forEach(cartItem => {
        const warehouseItem = this.db.items.find(i => i.id === cartItem.id);
        if (warehouseItem) window.FDB.updateDocument('items', warehouseItem.id, warehouseItem);
      });

      if (this.activeRepForPOS) {
        window.FDB.updateDocument('reps', this.activeRepForPOS.id, this.activeRepForPOS);
      } else {
        if (paid > 0 && this.db.treasuryLogs && this.db.treasuryLogs[0]) {
          window.FDB.addDocument('treasury', this.db.treasuryLogs[0]);
        }
        window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
      }
    }
    this.closeModal();
    this.showToast(`تم حفظ الفاتورة #${invoiceNo} بنجاح وتحديث حساب العميل والمخزون`);
    this.reconcileAllStats();
    this.renderPOS();
  },

  // ==========================================
  // REPS MANAGEMENT & REPS POS
  // ==========================================
  renderRepsCards() {
    const grid = document.getElementById('reps-cards-grid');
    if (!grid) return;

    if (!this.db.reps || this.db.reps.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">لا يوجد مناديب مسجلين، يمكنك إضافة حساب مندوب من صفحة الإعدادات</div>`;
      return;
    }

    grid.innerHTML = this.db.reps.map(rep => {
      // Ensure assignedCustomerIds contains only existing customers and starts empty if none assigned
      if (!Array.isArray(rep.assignedCustomerIds)) {
        rep.assignedCustomerIds = [];
      } else {
        rep.assignedCustomerIds = rep.assignedCustomerIds.filter(id => (this.db.customers || []).some(c => c.id === id));
      }
      const assignedCustomers = (this.db.customers || []).filter(c => rep.assignedCustomerIds.includes(c.id));
      const assignedCustomersCount = assignedCustomers.length;
      rep.assignedCustomersCount = assignedCustomersCount;
      const assignedDebts = assignedCustomers.reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);
      rep.assignedDebts = assignedDebts;

      // Total cartons and types in custody
      const totalCustodyCartons = (rep.activeCustody || []).reduce((sum, c) => sum + (Number(c.cartons) || 0), 0);
      const custodyTypesCount = (rep.activeCustody || []).length;

      return `
        <div class="rep-card-fintech" style="background: #0a0e17; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); position: relative;">
          
          <!-- Header: Status, Name, Code & Avatar -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              ${rep.status !== 'inactive' 
                ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 4px 12px; font-size: 0.78rem; font-weight: 700;">نشط</span>` 
                : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 4px 12px; font-size: 0.78rem; font-weight: 700;">معطل</span>`}
            </div>
            
            <div style="display: flex; align-items: center; gap: 12px; text-align: left;">
              <div>
                <div style="font-size: 1.2rem; font-weight: 800; color: #ffffff; line-height: 1.3;">${rep.name}</div>
                <div style="font-size: 0.8rem; color: #94a3b8; direction: ltr; text-align: right;">
                  ${rep.code || (rep.phone ? rep.phone.slice(-4) : '1111')} • ${rep.role || 'مدير مساعد'}
                </div>
              </div>
              <div style="width: 46px; height: 46px; border-radius: 12px; background: #3b82f6; color: #ffffff; font-size: 1.45rem; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);">
                ${rep.name.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>

          <!-- Box 1: العهدة المتاحة والعملاء المخصصين -->
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 12px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: center;">
            <div>
              <div style="font-size: 0.78rem; color: #94a3b8; font-weight: 600; margin-bottom: 4px;">العهدة المتاحة للمندوب</div>
              <div style="color: #f59e0b; font-weight: 800; font-size: 1.05rem;">
                ${custodyTypesCount} أصناف (${totalCustodyCartons} قروصة)
              </div>
            </div>
            <div>
              <div style="font-size: 0.78rem; color: #94a3b8; font-weight: 600; margin-bottom: 4px;">العملاء المخصصين</div>
              <div style="color: #10b981; font-weight: 800; font-size: 1.05rem;">
                ${assignedCustomersCount} عملاء
              </div>
            </div>
          </div>

          <!-- Box 2: Financial Stats List -->
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; font-size: 0.86rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #94a3b8;">إجمالي مبيعات المندوب:</span>
              <strong style="color: #f59e0b; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem;">${this.formatMoney(rep.totalSales || 0)} ج.م</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #94a3b8; display: flex; align-items: center; gap: 6px;">⚖️ نقدية حالية مع المندوب:</span>
              <strong style="color: #10b981; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem;">${this.formatMoney(rep.currentCash || 0)} ج.م</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #94a3b8; display: flex; align-items: center; gap: 6px;">📥 إجمالي ما ورّده للخزينة:</span>
              <strong style="color: #38bdf8; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem;">${this.formatMoney(rep.totalSupplied || 0)} ج.م</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #94a3b8; display: flex; align-items: center; gap: 6px;">👥 ديون العملاء المخصصين له:</span>
              <strong style="color: #c084fc; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem;">${this.formatMoney(assignedDebts)} ج.م</strong>
            </div>
          </div>

          <!-- Action Buttons -->
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
            <!-- Row 1: سجل توريداته + تحصيل -->
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="App.openRepSuppliesModal('${rep.id}')" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; background: #1e293b; color: #f1f5f9; border: 1px solid rgba(255,255,255,0.08); padding: 8px; border-radius: 8px;">
                <span>📋</span> سجل توريداته
              </button>
              <button class="btn btn-success btn-sm" onclick="App.openRepSupplyCashModal('${rep.id}')" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 800; background: #059669; color: #ffffff; border: none; padding: 8px; border-radius: 8px;">
                <span>💵</span> تحصيل (${this.formatMoney(rep.currentCash || 0)} ج)
              </button>
            </div>

            <!-- Row 2: دخول نقطة بيعه -->
            <button class="btn" onclick="App.enterRepPOS('${rep.id}')" style="width: 100%; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #0f172a; font-weight: 900; font-size: 1rem; border: none; padding: 11px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35);">
              <span>🛒</span> دخول نقطة بيعه
            </button>

            <!-- Row 3: تخصيص الصلاحيات والعهد -->
            <button class="btn" onclick="App.openManageRepPermissionsAndCustodyModal('${rep.id}')" style="width: 100%; border: 1px solid rgba(245, 158, 11, 0.4); color: #f59e0b; background: rgba(15, 23, 42, 0.9); font-weight: 800; font-size: 0.92rem; padding: 10px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span>⠭</span> تخصيص الصلاحيات والعهد
            </button>

            <!-- Row 4: تعديل البيانات + إيقاف -->
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="App.openEditRepModal('${rep.id}')" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; background: #1e293b; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); padding: 8px; border-radius: 8px;">
                <span>✏️</span> تعديل البيانات
              </button>
              <button class="btn btn-danger btn-sm" onclick="App.toggleRepStatus('${rep.id}')" style="width: 90px; display: flex; align-items: center; justify-content: center; gap: 4px; font-weight: 700; background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 8px; border-radius: 8px;">
                <span>⛔</span> ${rep.status === 'inactive' ? 'تنشيط' : 'إيقاف'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  enterRepPOS(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    this.activeRepForPOS = rep;
    this.posActiveTab = 'main';
    this.currentCart.sellerType = 'مندوب';
    this.currentCart.sellerId = rep.id;
    this.currentCart.sellerName = rep.name;
    this.currentCart.items = [];

    this.renderPOS();
    this.showToast(`تم الدخول إلى نقطة بيع المندوب ${rep.name}`);
  },

  exitRepPOS() {
    if (this.isCurrentUserRep()) return;
    this.activeRepForPOS = null;
    this.currentCart.sellerType = 'الإدارة (الرئيسية)';
    this.currentCart.sellerId = null;
    this.currentCart.sellerName = this.db.currentUser?.name || 'حسام';
    this.currentCart.items = [];
    this.renderPOS();
    this.showToast('تمت العودة لنقطة البيع الرئيسية للمخزن');
  },

  // Modal: تحصيل وتوريد فوري لنقدية المندوب
  openRepSupplyCashModal(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    const currentCash = Number(rep.currentCash) || 0;
    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px;">
          <span>💵</span> تحصيل وتوريد نقدية المندوب: ${rep.name}
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 18px; border-radius: 12px; margin-bottom: 16px; text-align: center;">
          <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px;">النقدية المحصلة مع المندوب حالياً:</div>
          <div style="font-size: 2rem; font-weight: 900; color: #10b981; font-family: 'JetBrains Mono', monospace;">
            ${this.formatMoney(currentCash)} ج.م
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 14px;">
          <label class="form-label" style="font-weight: 700; font-size: 0.95rem;">المبلغ المطلوب توريده وإيداعه بالخزينة (ج.م) *</label>
          <input type="number" id="rep-supply-amount" class="form-control" value="${currentCash}" max="${currentCash}" style="font-size: 1.25rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; text-align: center; color: #38bdf8;">
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label">ملاحظات التوريد</label>
          <input type="text" id="rep-supply-notes" class="form-control" placeholder="توريد نقدية تحصيلات المندوب" value="توريد نقدية مبيعات المندوب">
        </div>

        <div style="display: flex; gap: 10px;">
          <button class="btn btn-success" style="flex: 2; padding: 12px; font-weight: 800; font-size: 1rem; display: flex; align-items: center; justify-content: center; gap: 8px;" onclick="App.saveRepSupply('${rep.id}')">
            <span>✓</span> تأكيد استلام النقدية وتصفير عهدة المندوب
          </button>
          <button class="btn btn-secondary" style="flex: 1;" onclick="App.openRepSuppliesModal('${rep.id}')">
            📋 سجل التوريدات
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  // Modal: سجل توريدات المندوب وإمكانية توريد دفعة للخزينة
  openRepSuppliesModal(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    // Filter supplies for this rep
    const supplies = this.db.treasuryLogs.filter(log => log.sourceName.includes(rep.name));

    const modalHtml = `
      <div class="modal-header">
        <h3>🏦 توريدات المندوب: ${rep.name}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background: var(--bg-input); padding: 14px; border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">نقدية حالية مع المندوب لم تورّد:</div>
            <div style="font-size: 1.3rem; font-weight: 800; color: var(--emerald);">${this.formatMoney(rep.currentCash)} ج.م</div>
          </div>
          <div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">إجمالي المورّد سابقاً:</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--gold);">${this.formatMoney(rep.totalSupplied)} ج.م</div>
          </div>
        </div>

        <div style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-bottom: 14px;">
          <h4 style="margin-bottom: 10px;">تسجيل توريد جديد للخزينة الرئيسية:</h4>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">المبلغ المورّد (ج.م)</label>
              <input type="number" id="rep-supply-amount" class="form-control" value="${rep.currentCash}" max="${rep.currentCash}">
            </div>
            <div class="form-group">
              <label class="form-label">ملاحظات التوريد</label>
              <input type="text" id="rep-supply-notes" class="form-control" placeholder="توريد تحصيلات خط التوزيع">
            </div>
          </div>
          <button class="btn btn-success" style="margin-top: 10px; width: 100%;" onclick="App.saveRepSupply('${rep.id}')">
            ✓ تأكيد استلام النقدية وإيداعها بالخزينة
          </button>
        </div>

        <h4>سجل عمليات التوريد السابقة:</h4>
        <div style="max-height: 200px; overflow-y: auto;">
          ${supplies.length === 0 ? '<p style="color: var(--text-muted); font-size: 0.85rem;">لا توجد عمليات توريد سابقة</p>' : `
            <table class="modern-table" style="font-size: 0.8rem;">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>المستلم</th>
                  <th>البيان</th>
                </tr>
              </thead>
              <tbody>
                ${supplies.map(s => `
                  <tr>
                    <td>${s.date}</td>
                    <td><strong style="color: var(--gold);">${this.formatMoney(s.amount)} ج.م</strong></td>
                    <td>${s.receivedBy}</td>
                    <td>${s.notes}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async saveRepSupply(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    const amount = Number(document.getElementById('rep-supply-amount').value);
    const notes = document.getElementById('rep-supply-notes').value || 'توريد نقدية للمخزن';

    if (!amount || amount <= 0) {
      this.showToast('يرجى تحديد مبلغ توريد صحيح', 'error');
      return;
    }

    if (amount > rep.currentCash) {
      const confirmed = await this.confirmDialog({
        title: 'تأكيد تجاوز النقدية المتوفرة',
        subtitle: 'المبلغ المدخل أكبر من نقدية المندوب المسجلة',
        message: `المبلغ المطلوب توريده (${this.formatMoney(amount)} ج.م) أكبر من النقدية المسجلة حالياً مع المندوب (${this.formatMoney(rep.currentCash)} ج.م).`,
        icon: '⚠️',
        type: 'warning',
        detailsHtml: `
          <div class="confirm-info-grid">
            <div class="confirm-info-item">
              <span class="label">اسم المندوب:</span>
              <span class="value">${rep.name}</span>
            </div>
            <div class="confirm-info-item">
              <span class="label">نقدية المندوب الحالية:</span>
              <span class="value text-warning">${this.formatMoney(rep.currentCash)} ج.م</span>
            </div>
          </div>
          <div class="confirm-warning-note">⚠️ هل ترغب في المتابعة وتوريد المبلغ بالكامل وإيداعه بالخزينة؟</div>
        `,
        confirmText: 'نعم، متابعة التوريد',
        cancelText: 'إلغاء'
      });
      if (!confirmed) return;
    }

    // Update Rep figures
    rep.currentCash = Math.max(0, rep.currentCash - amount);
    rep.totalSupplied = (rep.totalSupplied || 0) + amount;

    // Update Main Treasury
    this.db.treasury = (Number(this.db.treasury) || 0) + amount;

    // Add to Treasury logs
    this.db.treasuryLogs.unshift({
      id: `TR-${Date.now().toString().slice(-4)}`,
      date: new Date().toLocaleString('ar-EG-u-nu-latn'),
      type: 'توريد نقدية مندوب',
      sourceName: `${rep.name} (مندوب)`,
      receivedBy: this.db.currentUser?.name || 'حسام',
      amount: amount,
      notes: notes
    });

    // Add Notification
    this.addNotification({
      title: 'توريد نقدية من مندوب',
      desc: `قام المندوب ${rep.name} بتوريد مبلغ ${this.formatMoney(amount)} ج.م إلى الخزينة الرئيسية`,
      type: 'treasury'
    });

    this.syncDB();
    if (window.FDB) {
      if (this.db.treasuryLogs && this.db.treasuryLogs[0]) {
        window.FDB.addDocument('treasury', this.db.treasuryLogs[0]);
      }
      window.FDB.updateDocument('reps', rep.id, rep);
      window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
    }
    this.closeModal();
    this.showToast(`تم توريد ${this.formatMoney(amount)} ج.م بنجاح إلى الخزينة وتصفير عهدة المندوب`);
    this.renderRepsCards();
    this.renderDashboard();
    this.renderReports();
    this.renderCurrentPage();
    this.updateLiveSidebarStats();
  },

  // Modal: تخصيص الصلاحيات والعهد للمندوب (قروصات المخزن ⮂ عهدة المندوب + تخصيص العملاء)
  openManageRepPermissionsAndCustodyModal(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    if (!rep.activeCustody) rep.activeCustody = [];
    if (!Array.isArray(rep.assignedCustomerIds)) {
      rep.assignedCustomerIds = [];
    } else {
      rep.assignedCustomerIds = rep.assignedCustomerIds.filter(id => (this.db.customers || []).some(c => c.id === id));
    }
    rep.assignedCustomersCount = rep.assignedCustomerIds.length;

    const totalCustodyCartons = rep.activeCustody.reduce((sum, c) => sum + (Number(c.cartons) || 0), 0);
    const custodyTypesCount = rep.activeCustody.length;

    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px; font-size: 1.15rem;">
          <span>⠭</span> تخصيص الصلاحيات والعهد للمندوب: ${rep.name}
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 14px; max-height: 80vh; overflow-y: auto;">
        
        <!-- Tab Switcher -->
        <div style="display: flex; gap: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
          <button type="button" id="tab-btn-custody" class="btn btn-primary btn-sm" onclick="App.switchRepModalTab('custody')">
            📦 تخصيص عهدة الأصناف (القروصات)
          </button>
          <button type="button" id="tab-btn-customers" class="btn btn-secondary btn-sm" onclick="App.switchRepModalTab('customers')">
            👥 تخصيص العملاء للمندوب (<span id="modal-assigned-count">${rep.assignedCustomerIds.length}</span>)
          </button>
        </div>

        <!-- PANE 1: CUSTODY ALLOCATION -->
        <div id="rep-modal-pane-custody" style="display: block;">
          <div style="background: rgba(15, 23, 42, 0.6); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border-subtle); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="font-size: 0.88rem; font-weight: 700; color: var(--text-white);">تحديد رصيد العهدة لكل صنف (المخزن ⮂ المندوب)</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary);">يمكنك كتابة عدد القروصات المخصصة للمندوب مباشرة، ويتم خصم أو استرجاع الرصيد للمخزن تلقائياً</div>
            </div>
            <div style="display: flex; gap: 8px;">
              <span class="badge-status blue" id="rep-modal-total-types" style="font-weight: 700;">${custodyTypesCount} أصناف بالعهدة</span>
              <span class="badge-status success" id="rep-modal-total-cartons" style="font-weight: 700;">${totalCustodyCartons} قروصة إجمالي</span>
            </div>
          </div>

          <div class="table-responsive" style="max-height: 380px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: 8px;">
            <table class="modern-table" style="font-size: 0.85rem; margin-bottom: 0;">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>سعر البيع</th>
                  <th style="color: #38bdf8; text-align: center;">الموجود بالمخزن</th>
                  <th style="color: #f59e0b; text-align: center;">العهدة المخصصة</th>
                  <th style="text-align: center; min-width: 170px;">تعديل العهدة (قروصة)</th>
                </tr>
              </thead>
              <tbody id="rep-custody-table-body">
                ${this.db.items.map(item => {
                  const cItem = rep.activeCustody.find(c => c.itemId === item.id);
                  const currentCustody = cItem ? Number(cItem.cartons) || 0 : 0;
                  const maxAvailable = item.cartonsInStock + currentCustody;

                  return `
                    <tr>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span style="font-size: 1.25rem;">${item.icon || '📦'}</span>
                          <strong>${item.name}</strong>
                        </div>
                      </td>
                      <td><strong>${this.formatMoney(item.sellingPrice)} ج.م</strong></td>
                      <td style="text-align: center;">
                        <span id="stock-cell-${item.id}" style="color: #38bdf8; font-weight: 800; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">${item.cartonsInStock}</span>
                        <span style="font-size: 0.72rem; color: var(--text-muted);"> قروصة</span>
                      </td>
                      <td style="text-align: center;">
                        <span id="custody-cell-${item.id}" style="color: #f59e0b; font-weight: 800; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">${currentCustody}</span>
                        <span style="font-size: 0.72rem; color: var(--text-muted);"> قروصة</span>
                      </td>
                      <td style="text-align: center;">
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                          <button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-weight: 800;" onclick="App.adjustRepCustody('${rep.id}', '${item.id}', -1)" title="استرجاع قروصة للمخزن">-</button>
                          <input type="number" id="rep-input-${item.id}" value="${currentCustody}" min="0" max="${maxAvailable}" 
                                 class="form-control" style="width: 68px; height: 30px; text-align: center; font-weight: 800; font-family: 'JetBrains Mono', monospace; padding: 2px;"
                                 onchange="App.setRepCustodyDirect('${rep.id}', '${item.id}', this.value)" title="اكتب عدد القروصات المخصصة للمندوب">
                          <button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-weight: 800;" onclick="App.adjustRepCustody('${rep.id}', '${item.id}', 1)" title="تسليم قروصة">+</button>
                          <button type="button" class="btn btn-primary btn-sm" style="padding: 2px 7px; font-size: 0.75rem;" onclick="App.adjustRepCustody('${rep.id}', '${item.id}', 5)" title="تسليم 5 قروصات">+5</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- PANE 2: CUSTOMERS ALLOCATION -->
        <div id="rep-modal-pane-customers" style="display: none; flex-direction: column; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
              <input type="text" id="rep-cust-search-input" class="form-control" placeholder="🔍 ابحث عن عميل بالاسم أو المنطقة أو الهاتف..." oninput="App.filterRepCustomersModal('${rep.id}')">
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.toggleAllCustomersForRep('${rep.id}', true)">
              ✓ تحديد الكل
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.toggleAllCustomersForRep('${rep.id}', false)">
              ✕ إلغاء التحديد
            </button>
          </div>

          <div id="rep-customers-list-container" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 2px;">
            <!-- Populated by renderRepCustomersModalList -->
          </div>
        </div>

      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
        <button class="btn btn-primary" onclick="App.closeModal(); App.showToast('تم حفظ وتطبيق تخصيص الصلاحيات والعهد بنجاح');">
          💾 تم الانتهاء والتطبيق
        </button>
      </div>
    `;

    this.openModal(modalHtml, '720px');
    this.renderRepCustomersModalList(rep.id);
  },

  openManageRepCustodyModal(repId) {
    this.openManageRepPermissionsAndCustodyModal(repId);
  },

  switchRepModalTab(tab) {
    const paneCustody = document.getElementById('rep-modal-pane-custody');
    const paneCustomers = document.getElementById('rep-modal-pane-customers');
    const btnCustody = document.getElementById('tab-btn-custody');
    const btnCustomers = document.getElementById('tab-btn-customers');

    if (tab === 'custody') {
      if (paneCustody) paneCustody.style.display = 'block';
      if (paneCustomers) paneCustomers.style.display = 'none';
      if (btnCustody) { btnCustody.className = 'btn btn-primary btn-sm'; }
      if (btnCustomers) { btnCustomers.className = 'btn btn-secondary btn-sm'; }
    } else {
      if (paneCustody) paneCustody.style.display = 'none';
      if (paneCustomers) paneCustomers.style.display = 'flex';
      if (btnCustody) { btnCustody.className = 'btn btn-secondary btn-sm'; }
      if (btnCustomers) { btnCustomers.className = 'btn btn-primary btn-sm'; }
    }
  },

  setRepCustodyDirect(repId, itemId, newTargetQty) {
    const rep = this.db.reps.find(r => r.id === repId);
    const item = this.db.items.find(i => i.id === itemId);
    if (!rep || !item) return;

    if (!rep.activeCustody) rep.activeCustody = [];
    let cItem = rep.activeCustody.find(c => c.itemId === itemId);
    const currentCustody = cItem ? Number(cItem.cartons) || 0 : 0;
    const target = Math.max(0, Number(newTargetQty) || 0);

    const delta = target - currentCustody;
    if (delta === 0) return;

    if (target > item.cartonsInStock) {
      this.showToast(`عفواً، الكمية المحددة للعهدة (${target} قروصة) أكبر من المتوفر بالمخزن (${item.cartonsInStock} قروصة)`, 'error');
      const inputEl = document.getElementById(`rep-input-${itemId}`);
      if (inputEl) inputEl.value = currentCustody;
      return;
    }

    if (cItem) {
      if (target <= 0) {
        rep.activeCustody = rep.activeCustody.filter(c => c.itemId !== itemId);
      } else {
        cItem.cartons = target;
      }
    } else if (target > 0) {
      rep.activeCustody.push({
        itemId: item.id,
        itemName: item.name,
        cartons: target,
        price: item.sellingPrice
      });
    }

    this.syncDB();
    if (window.FDB) {
      window.FDB.updateDocument('reps', rep.id, rep);
    }

    cItem = rep.activeCustody.find(c => c.itemId === itemId);
    const updatedCustody = cItem ? cItem.cartons : 0;

    const stockCell = document.getElementById(`stock-cell-${itemId}`);
    const custodyCell = document.getElementById(`custody-cell-${itemId}`);
    const inputEl = document.getElementById(`rep-input-${itemId}`);

    if (stockCell) stockCell.textContent = item.cartonsInStock;
    if (custodyCell) custodyCell.textContent = updatedCustody;
    if (inputEl) {
      inputEl.value = updatedCustody;
      inputEl.max = item.cartonsInStock;
    }

    const totalCartons = (rep.activeCustody || []).reduce((s, c) => s + (c.cartons || 0), 0);
    const totalTypes = (rep.activeCustody || []).length;
    const totalCartonsBadge = document.getElementById('rep-modal-total-cartons');
    const totalTypesBadge = document.getElementById('rep-modal-total-types');
    if (totalCartonsBadge) totalCartonsBadge.textContent = `${totalCartons} قروصة إجمالي`;
    if (totalTypesBadge) totalTypesBadge.textContent = `${totalTypes} أصناف بالعهدة`;

    this.showToast(`تم تحديث عهدة ${item.name} إلى ${updatedCustody} قروصة للمندوب`);
    this.renderRepsCards();
  },

  adjustRepCustody(repId, itemId, step) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;
    const cItem = (rep.activeCustody || []).find(c => c.itemId === itemId);
    const current = cItem ? Number(cItem.cartons) || 0 : 0;
    this.setRepCustodyDirect(repId, itemId, current + step);
  },

  renderRepCustomersModalList(repId, filterQuery = '') {
    const rep = this.db.reps.find(r => r.id === repId);
    const container = document.getElementById('rep-customers-list-container');
    if (!rep || !container) return;

    if (!Array.isArray(rep.assignedCustomerIds)) rep.assignedCustomerIds = [];
    rep.assignedCustomerIds = rep.assignedCustomerIds.filter(id => (this.db.customers || []).some(c => c.id === id));

    const q = (filterQuery || '').toLowerCase().trim();
    const customers = (this.db.customers || []).filter(c => {
      return !q || c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)) || (c.area && c.area.toLowerCase().includes(q));
    });

    if (customers.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 25px; color: var(--text-muted);">لا يوجد عملاء مطابقين للبحث</div>`;
      return;
    }

    container.innerHTML = customers.map(c => {
      const isAssigned = (rep.assignedCustomerIds || []).includes(c.id);
      const otherRepName = (!isAssigned && c.assignedRepId && c.assignedRepId !== rep.id) ? c.assignedRepName : null;
      return `
        <div id="cust-row-${c.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(15, 23, 42, 0.7); border: 1px solid ${isAssigned ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}; border-radius: 8px; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <input type="checkbox" id="chk-cust-${c.id}" ${isAssigned ? 'checked' : ''} onchange="App.toggleRepCustomerAssign('${rep.id}', '${c.id}', this.checked)" style="width: 18px; height: 18px; cursor: pointer;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: var(--text-white); font-size: 0.92rem;">${c.name}</strong>
                ${otherRepName ? `<span style="font-size: 0.7rem; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 4px; padding: 1px 6px;">مخصص لـ: ${otherRepName}</span>` : ''}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary);">📍 ${c.area || 'بدون منطقة'} | 📞 ${c.phone || 'بدون هاتف'}</div>
            </div>
          </div>
          <div style="text-align: left;">
            <div style="font-size: 0.72rem; color: var(--text-muted);">الدين الحالي:</div>
            <strong style="color: ${c.currentDebt > 0 ? '#ef4444' : '#10b981'}; font-size: 0.9rem; font-family: 'JetBrains Mono', monospace;">${this.formatMoney(c.currentDebt || 0)} ج.م</strong>
          </div>
        </div>
      `;
    }).join('');
  },

  filterRepCustomersModal(repId) {
    const query = document.getElementById('rep-cust-search-input')?.value || '';
    this.renderRepCustomersModalList(repId, query);
  },

  toggleRepCustomerAssign(repId, custId, isChecked) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;
    if (!Array.isArray(rep.assignedCustomerIds)) rep.assignedCustomerIds = [];

    const cust = this.db.customers.find(c => c.id === custId);

    if (isChecked) {
      // Unlink from other reps if previously assigned
      this.db.reps.forEach(otherRep => {
        if (otherRep.id !== repId && Array.isArray(otherRep.assignedCustomerIds) && otherRep.assignedCustomerIds.includes(custId)) {
          otherRep.assignedCustomerIds = otherRep.assignedCustomerIds.filter(id => id !== custId);
          otherRep.assignedCustomersCount = otherRep.assignedCustomerIds.length;
          const otherCusts = (this.db.customers || []).filter(c => otherRep.assignedCustomerIds.includes(c.id));
          otherRep.assignedDebts = otherCusts.reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);
          if (window.FDB) window.FDB.updateDocument('reps', otherRep.id, otherRep);
        }
      });
      if (!rep.assignedCustomerIds.includes(custId)) rep.assignedCustomerIds.push(custId);
      if (cust) {
        cust.assignedRepId = rep.id;
        cust.assignedRepName = rep.name;
      }
    } else {
      rep.assignedCustomerIds = rep.assignedCustomerIds.filter(id => id !== custId);
      if (cust && cust.assignedRepId === repId) {
        cust.assignedRepId = null;
        cust.assignedRepName = 'الإدارة المركزية';
      }
    }

    rep.assignedCustomersCount = rep.assignedCustomerIds.length;
    const assignedCustomers = (this.db.customers || []).filter(c => rep.assignedCustomerIds.includes(c.id));
    rep.assignedDebts = assignedCustomers.reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);

    this.syncDB();

    if (window.FDB) {
      window.FDB.updateDocument('reps', rep.id, rep);
      if (cust) window.FDB.updateDocument('customers', cust.id, cust);
    }

    const row = document.getElementById(`cust-row-${custId}`);
    if (row) {
      row.style.borderColor = isChecked ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)';
    }

    const badge = document.getElementById('modal-assigned-count');
    if (badge) badge.textContent = rep.assignedCustomersCount;

    this.renderRepsCards();
    if (document.getElementById('customers-grid')) {
      this.renderCustomers();
    }
  },

  toggleAllCustomersForRep(repId, assignAll) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    if (assignAll) {
      this.db.reps.forEach(otherRep => {
        if (otherRep.id !== repId && Array.isArray(otherRep.assignedCustomerIds)) {
          otherRep.assignedCustomerIds = [];
          otherRep.assignedCustomersCount = 0;
          otherRep.assignedDebts = 0;
          if (window.FDB) window.FDB.updateDocument('reps', otherRep.id, otherRep);
        }
      });
      rep.assignedCustomerIds = (this.db.customers || []).map(c => c.id);
      (this.db.customers || []).forEach(c => {
        c.assignedRepId = rep.id;
        c.assignedRepName = rep.name;
        if (window.FDB) window.FDB.updateDocument('customers', c.id, c);
      });
    } else {
      rep.assignedCustomerIds = [];
      (this.db.customers || []).forEach(c => {
        if (c.assignedRepId === repId) {
          c.assignedRepId = null;
          c.assignedRepName = 'الإدارة المركزية';
          if (window.FDB) window.FDB.updateDocument('customers', c.id, c);
        }
      });
    }

    rep.assignedCustomersCount = rep.assignedCustomerIds.length;
    const assignedCustomers = (this.db.customers || []).filter(c => rep.assignedCustomerIds.includes(c.id));
    rep.assignedDebts = assignedCustomers.reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);

    this.syncDB();
    if (window.FDB) {
      window.FDB.updateDocument('reps', rep.id, rep);
    }
    this.renderRepCustomersModalList(repId);
    const badge = document.getElementById('modal-assigned-count');
    if (badge) badge.textContent = rep.assignedCustomersCount;
    this.renderRepsCards();
    if (document.getElementById('customers-grid')) {
      this.renderCustomers();
    }
    this.showToast(assignAll ? 'تم تخصيص جميع العملاء للمندوب' : 'تم إلغاء تخصيص العملاء للمندوب');
  },

  openEditRepModal(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px;">
          <span>✏️</span> تعديل بيانات المندوب: ${rep.name}
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 14px;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">اسم المندوب *</label>
            <input type="text" id="edit-rep-name" class="form-control" value="${rep.name}">
          </div>
          <div class="form-group">
            <label class="form-label">كود المندوب *</label>
            <input type="text" id="edit-rep-code" class="form-control" value="${rep.code || (rep.phone ? rep.phone.slice(-4) : '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">المسمى الوظيفي / الرتبة</label>
            <input type="text" id="edit-rep-role" class="form-control" value="${rep.role || 'مندوب توزيع'}">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="text" id="edit-rep-phone" class="form-control" value="${rep.phone || ''}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">خط السير / منطقة التوزيع</label>
          <input type="text" id="edit-rep-zone" class="form-control" value="${rep.routeZone || ''}" placeholder="مثال: خط شبرا ووسط البلد">
        </div>

        <div class="form-group" style="background: rgba(15, 23, 42, 0.6); padding: 12px; border-radius: 8px; border: 1px solid var(--border-subtle);">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-weight: 700; color: #f1f5f9;">⚖️ النقدية الحالية المسجلة مع المندوب (ج.م)</span>
            <span style="font-size: 0.76rem; color: #94a3b8;">تعديل يدوي أو تصفير</span>
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="number" id="edit-rep-cash" class="form-control" value="${rep.currentCash || 0}" style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: #10b981; font-size: 1.1rem;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('edit-rep-cash').value = 0" style="white-space: nowrap; color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); padding: 6px 12px; font-weight: 700;" title="تصفير نقدية المندوب إلى 0">
              تصفير (0 ج.م)
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-danger btn-sm" onclick="App.deleteRep('${rep.id}')" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: 700; padding: 6px 14px; border-radius: 6px;">
          🗑️ حذف المندوب
        </button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
          <button class="btn btn-primary" onclick="App.saveEditRep('${rep.id}')">💾 حفظ التعديلات</button>
        </div>
      </div>
    `;

    this.openModal(modalHtml, '540px');
  },

  saveEditRep(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    const name = document.getElementById('edit-rep-name')?.value.trim();
    if (!name) {
      this.showToast('يرجى كتابة اسم المندوب', 'error');
      return;
    }

    rep.name = name;
    rep.code = document.getElementById('edit-rep-code')?.value.trim() || '';
    rep.role = document.getElementById('edit-rep-role')?.value.trim() || 'مندوب توزيع';
    rep.phone = document.getElementById('edit-rep-phone')?.value.trim() || '';
    rep.routeZone = document.getElementById('edit-rep-zone')?.value.trim() || '';

    const cashInput = document.getElementById('edit-rep-cash');
    if (cashInput) {
      rep.currentCash = Math.max(0, Number(cashInput.value) || 0);
    }

    this.syncDB();
    if (window.FDB) {
      window.FDB.updateDocument('reps', rep.id, rep);
    }
    this.closeModal();
    this.showToast(`تم حفظ بيانات المندوب ${rep.name} بنجاح`);
    this.renderRepsCards();
    this.updateDashboardStats();
    this.updateLiveSidebarStats();
  },

  async deleteRep(repId) {
    const rep = (this.db.reps || []).find(r => r.id === repId);
    if (!rep) return;

    const hasCustody = Array.isArray(rep.activeCustody) && rep.activeCustody.some(c => (Number(c.cartons) || 0) > 0);
    const hasCash = (Number(rep.currentCash) || 0) > 0;

    let warningText = '';
    if (hasCustody) {
      warningText += ' سيتم استرجاع أصناف العهدة الحالية تلقائياً إلى رصيد المخزن الرئيسي.';
    }
    if (hasCash) {
      warningText += ` علماً بأن المندوب مسجل معه نقدية بقيمة ${this.formatMoney(rep.currentCash)} ج.م.`;
    }

    const confirmed = await this.confirmDialog({
      title: 'حذف المندوب',
      subtitle: 'إشعار تأكيد حذف المندوب من النظام وقاعدة البيانات السحابية',
      message: `هل أنت متأكد من حذف حساب المندوب "${rep.name}" نهائياً؟`,
      icon: '🚗',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">اسم المندوب:</span>
            <span class="value">${rep.name}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">كود الدخول:</span>
            <span class="value" style="font-family: monospace;">${rep.code || '—'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">النقدية الحالية:</span>
            <span class="value text-warning">${this.formatMoney(rep.currentCash || 0)} ج.م</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">إجمالي المبيعات:</span>
            <span class="value text-emerald">${this.formatMoney(rep.totalSales || 0)} ج.م</span>
          </div>
        </div>
        ${warningText ? `<div class="confirm-warning-note">⚠️ تحذير:${warningText}</div>` : ''}
      `,
      confirmText: 'نعم، حذف المندوب',
      cancelText: 'إلغاء'
    });

    if (!confirmed) return;

    // 1. Return active custody to warehouse
    if (Array.isArray(rep.activeCustody)) {
      rep.activeCustody.forEach(custItem => {
        const qty = Number(custItem.cartons) || 0;
        if (qty > 0) {
          const whItem = (this.db.items || []).find(i => i.id === (custItem.itemId || custItem.id));
          if (whItem) {
            whItem.cartonsInStock = (Number(whItem.cartonsInStock) || 0) + qty;
            if (window.FDB) window.FDB.updateDocument('items', whItem.id, whItem);
          }
        }
      });
    }

    // 2. Remove from local list
    this.db.reps = (this.db.reps || []).filter(r => r.id !== repId);

    // 3. Remove linked user if found
    if (Array.isArray(this.db.users)) {
      const linkedUser = this.db.users.find(u => (rep.code && u.username === rep.code) || u.name === rep.name);
      if (linkedUser && linkedUser.username !== 'admin') {
        this.db.users = this.db.users.filter(u => u.id !== linkedUser.id);
        if (window.FDB) window.FDB.deleteDocument('users', linkedUser.id);
      }
    }

    // 4. Sync & delete from Firestore
    this.syncDB();
    if (window.FDB) {
      window.FDB.deleteDocument('reps', repId);
    }

    this.closeModal();
    this.showToast(`تم حذف المندوب ${rep.name} بنجاح`);
    this.renderRepsCards();
    this.updateLiveSidebarStats();
    this.updateDashboardStats();
  },

  toggleRepStatus(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep) return;

    rep.status = rep.status === 'inactive' ? 'active' : 'inactive';
    this.syncDB();
    if (window.FDB) {
      window.FDB.updateDocument('reps', rep.id, rep);
    }
    this.showToast(`تم ${rep.status === 'active' ? 'تنشيط' : 'إيقاف'} حساب المندوب ${rep.name}`);
    this.renderRepsCards();
  },

  openRepSupplyCashModal(repId) {
    this.openRepSuppliesModal(repId);
  },

  assignCustodyToRep(repId) {
    const rep = this.db.reps.find(r => r.id === repId);
    const itemId = document.getElementById('custody-item-select')?.value;
    const qty = Number(document.getElementById('custody-cartons-qty')?.value);

    if (!qty || qty <= 0) {
      this.showToast('يرجى كتابة عدد قروصات صحيح', 'error');
      return;
    }

    const warehouseItem = this.db.items.find(i => i.id === itemId);
    if (!warehouseItem) return;

    if (qty > warehouseItem.cartonsInStock) {
      this.showToast(`عفواً، الرصيد المتاح بالمخزن الرئيسي (${warehouseItem.cartonsInStock} قروصة) أقل من الكمية المطلوبة`, 'error');
      return;
    }

    warehouseItem.cartonsInStock -= qty;

    if (!rep.activeCustody) rep.activeCustody = [];
    const existing = rep.activeCustody.find(c => c.itemId === itemId);
    if (existing) {
      existing.cartons += qty;
    } else {
      rep.activeCustody.push({
        itemId: warehouseItem.id,
        itemName: warehouseItem.name,
        cartons: qty,
        price: warehouseItem.sellingPrice
      });
    }

    this.syncDB();
    this.showToast(`تم تسليم ${qty} قروصة ${warehouseItem.name} للمندوب ${rep.name}`);
    this.openManageRepPermissionsAndCustodyModal(repId);
  },

  returnCustodyFromRep(repId, index) {
    const rep = this.db.reps.find(r => r.id === repId);
    if (!rep || !rep.activeCustody || !rep.activeCustody[index]) return;

    const itemCustody = rep.activeCustody[index];
    const warehouseItem = this.db.items.find(i => i.id === itemCustody.itemId);
    if (warehouseItem) {
      warehouseItem.cartonsInStock += itemCustody.cartons;
    }

    rep.activeCustody.splice(index, 1);
    this.syncDB();
    this.showToast(`تم استرجاع عهدة ${itemCustody.itemName} إلى المخزن الرئيسي`);
    this.openManageRepPermissionsAndCustodyModal(repId);
  },

  // ==========================================
  // 3. INVENTORY & PRICE ADJUSTMENTS
  // ==========================================
  renderInventory() {
    const searchVal = (document.getElementById('inventory-search-input')?.value || '').toLowerCase();
    const filterStatus = document.getElementById('inventory-filter-status')?.value || 'all';

    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;

    let items = this.db.items.filter(item => {
      const matchSearch = item.name.toLowerCase().includes(searchVal) || (item.barcode && item.barcode.includes(searchVal));
      
      let matchStatus = true;
      if (filterStatus === 'available') matchStatus = item.cartonsInStock > item.reorderLevel;
      if (filterStatus === 'low') matchStatus = item.cartonsInStock <= item.reorderLevel && item.cartonsInStock > 0;
      if (filterStatus === 'out') matchStatus = item.cartonsInStock <= 0;

      return matchSearch && matchStatus;
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">لا توجد أصناف مطابقة</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(item => {
      let statusBadge = '';
      if (item.cartonsInStock <= 0) {
        statusBadge = '<span class="badge-status danger">نفذ من المخزن</span>';
      } else if (item.cartonsInStock <= item.reorderLevel) {
        statusBadge = `<span class="badge-status warning">قرب ينفذ (${item.cartonsInStock})</span>`;
      } else {
        statusBadge = `<span class="badge-status success">متوفر (${item.cartonsInStock})</span>`;
      }

      const profitPerCarton = (item.sellingPrice || 0) - (item.purchasePrice || 0);

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.4rem;">${item.icon || '📦'}</span>
              <div>
                <strong style="font-size: 0.95rem;">${item.name}</strong>
              </div>
            </div>
          </td>
          <td><code>${item.barcode}</code></td>
          <td><strong style="color: var(--gold); font-size: 1.05rem;">${item.cartonsInStock}</strong> قروصة</td>
          <td>${this.formatMoney(item.purchasePrice)} ج.م</td>
          <td><strong style="color: var(--emerald);">${this.formatMoney(item.sellingPrice)} ج.م</strong></td>
          <td>${statusBadge}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" onclick="App.openRestockPriceModal('${item.id}')">تعديل</button>
              <button class="btn btn-danger btn-sm" onclick="App.deleteItem('${item.id}')">حذف</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  // Modal: إضافة صنف جديد
  openAddItemModal() {
    const modalHtml = `
      <div class="modal-header">
        <h3>📦 إضافة صنف سجاير جديد للمخزن</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">اسم الصنف (بالقروصة) *</label>
            <input type="text" id="item-name" class="form-control" placeholder="مثال: كليوباترا بوكس أبيض">
          </div>
          <div class="form-group">
            <label class="form-label">الباركود *</label>
            <input type="text" id="item-barcode" class="form-control" placeholder="مثال: 622100xxxx" value="622${Date.now().toString().slice(-6)}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">الرصيد الافتتاحي بالمخزن (قروصة) *</label>
            <input type="number" id="item-cartons" class="form-control" placeholder="0" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">حد الطلب الآمن (تنبيه النواقص)</label>
            <input type="number" id="item-reorder" class="form-control" value="15" min="1">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">سعر الشراء للقروصة (ج.م) *</label>
            <input type="number" id="item-buy-price" class="form-control" placeholder="0.00" step="1">
          </div>
          <div class="form-group">
            <label class="form-label">سعر البيع بالجملة للقروصة (ج.م) *</label>
            <input type="number" id="item-sell-price" class="form-control" placeholder="0.00" step="1">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveNewItem()">حفظ الصنف وإدراجه بالمخزن</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  saveNewItem() {
    const name = document.getElementById('item-name').value.trim();
    const barcode = document.getElementById('item-barcode').value.trim();
    const icon = '📦';
    const cartonsInStock = Number(document.getElementById('item-cartons').value) || 0;
    const reorderLevel = Number(document.getElementById('item-reorder').value) || 15;
    const purchasePrice = Number(document.getElementById('item-buy-price').value) || 0;
    const sellingPrice = Number(document.getElementById('item-sell-price').value) || 0;

    if (!name || !barcode) {
      this.showToast('يرجى ملء اسم الصنف وكود الباركود', 'error');
      return;
    }

    if (sellingPrice <= 0) {
      this.showToast('يرجى تحديد سعر بيع صحيح للقروصة', 'error');
      return;
    }

    const newItem = {
      id: `item_${Date.now()}`,
      name,
      barcode,
      icon,
      cartonsInStock,
      reorderLevel,
      purchasePrice,
      sellingPrice
    };

    this.db.items.push(newItem);
    this.syncDB();
    if (window.FDB) window.FDB.addDocument('items', newItem);

    // Add Notification & sync to Firestore
    this.addNotification({
      title: 'إضافة صنف جديد للمخزن',
      desc: `تمت إضافة الصنف "${name}" برصيد ${cartonsInStock} قروصة وسعر بيع ${this.formatMoney(sellingPrice)} ج.م`,
      type: 'stock'
    });

    this.closeModal();
    this.showToast(`تمت إضافة الصنف ${name} بنجاح`);
    this.renderInventory();
  },

  // Modal: تعديل صنف
  openEditItemModal(itemId) {
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    const modalHtml = `
      <div class="modal-header">
        <h3>✏️ تعديل بيانات الصنف: ${item.name}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">اسم الصنف</label>
            <input type="text" id="edit-item-name" class="form-control" value="${item.name}">
          </div>
          <div class="form-group">
            <label class="form-label">الباركود</label>
            <input type="text" id="edit-item-barcode" class="form-control" value="${item.barcode}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">المخزون الحالي بالمخزن (قروصة)</label>
            <input type="number" id="edit-item-cartons" class="form-control" value="${item.cartonsInStock}">
          </div>
          <div class="form-group">
            <label class="form-label">حد الطلب (تنبيه النقص)</label>
            <input type="number" id="edit-item-reorder" class="form-control" value="${item.reorderLevel}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">سعر الشراء للقروصة (ج.م)</label>
            <input type="number" id="edit-item-buy" class="form-control" value="${item.purchasePrice}">
          </div>
          <div class="form-group">
            <label class="form-label">سعر البيع للقروصة (ج.م)</label>
            <input type="number" id="edit-item-sell" class="form-control" value="${item.sellingPrice}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveEditItem('${item.id}')">حفظ التعديلات</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  saveEditItem(itemId) {
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    item.name = document.getElementById('edit-item-name').value.trim();
    item.barcode = document.getElementById('edit-item-barcode').value.trim();
    item.cartonsInStock = Number(document.getElementById('edit-item-cartons').value) || 0;
    item.reorderLevel = Number(document.getElementById('edit-item-reorder').value) || 15;
    item.purchasePrice = Number(document.getElementById('edit-item-buy').value) || 0;
    item.sellingPrice = Number(document.getElementById('edit-item-sell').value) || 0;

    this.syncDB();
    if (window.FDB) window.FDB.updateDocument('items', itemId, item);
    this.closeModal();
    this.showToast(`تم تحديث بيانات ${item.name} بنجاح`);
    this.renderInventory();
  },

  async deleteItem(itemId) {
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    const confirmed = await this.confirmDialog({
      title: 'حذف صنف من المخزن',
      subtitle: 'إشعار تأكيد حذف الصنف نهائياً من قاعدة البيانات',
      message: `هل أنت متأكد من حذف الصنف "${item.name}" نهائياً؟`,
      icon: '🗑️',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">اسم الصنف:</span>
            <span class="value">${item.name}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">كود الباركود:</span>
            <span class="value" style="font-family: monospace;">${item.barcode || '—'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">الرصيد بالمخزن:</span>
            <span class="value text-warning">${item.cartonsInStock} قروصة</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">سعر البيع:</span>
            <span class="value text-emerald">${this.formatMoney(item.sellingPrice)} ج.م</span>
          </div>
        </div>
        <div class="confirm-warning-note">⚠️ تحذير: سيتم مسح بيانات الصنف من المخزن ولن يعود متاحاً في نقطة البيع.</div>
      `,
      confirmText: 'نعم، حذف الصنف',
      cancelText: 'إلغاء'
    });

    if (!confirmed) return;

    this.db.items = this.db.items.filter(i => i.id !== itemId);

    // Purge deleted item from all representatives' active custody
    (this.db.reps || []).forEach(rep => {
      if (Array.isArray(rep.activeCustody)) {
        const prevLen = rep.activeCustody.length;
        rep.activeCustody = rep.activeCustody.filter(c => (c.itemId || c.id) !== itemId);
        if (rep.activeCustody.length !== prevLen && window.FDB) {
          window.FDB.updateDocument('reps', rep.id, rep);
        }
      }
    });

    this.syncDB();
    if (window.FDB) window.FDB.deleteDocument('items', itemId);

    this.addNotification({
      title: 'حذف صنف من المخزن',
      desc: `تم حذف الصنف "${item.name}" نهائياً من قاعدة بيانات المخزن`,
      type: 'warning'
    });

    this.showToast(`تم حذف الصنف ${item.name}`);
    this.renderInventory();
  },

  // Modal: توريد صنف وتحديث السعر (متوسط التكلفة الموزون)
  openRestockPriceModal(selectedItemId = null) {
    if (!this.db.items || this.db.items.length === 0) {
      this.showToast('لا توجد أصناف مسجلة بالمخزن، يرجى إضافة صنف أولاً', 'error');
      return;
    }

    let activeItem = this.db.items.find(i => i.id === selectedItemId);
    if (!activeItem) activeItem = this.db.items[0];

    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px; font-size: 1.15rem;">
          <span>📦</span> توريد صنف وتحديث السعر (متوسط التكلفة الموزون)
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 14px; max-height: 80vh; overflow-y: auto;">
        <div class="form-group" style="margin-bottom: 2px;">
          <label class="form-label" style="font-weight: 700; color: var(--text-primary);">اختر الصنف</label>
          <select id="restock-item-select" class="custom-select" onchange="App.onRestockItemSelect(this.value)">
            ${this.db.items.map(i => `<option value="${i.id}" ${i.id === activeItem.id ? 'selected' : ''}>${i.name}</option>`).join('')}
          </select>
        </div>

        <!-- 3 Current Stats Cards -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: rgba(15, 23, 42, 0.6); padding: 14px 10px; border-radius: 8px; border: 1px solid var(--border-subtle);">
          <div style="text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 4px;">الكمية الحالية</div>
            <div id="restock-cur-qty" style="color: #10b981; font-weight: 900; font-size: 1.45rem; font-family: 'JetBrains Mono', monospace;">${activeItem.cartonsInStock}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">قروصة</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 4px;">سعر الشراء الحالي</div>
            <div id="restock-cur-buy" style="color: #f59e0b; font-weight: 900; font-size: 1.45rem; font-family: 'JetBrains Mono', monospace;">${activeItem.purchasePrice}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">ج.م</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 4px;">سعر البيع الحالي</div>
            <div id="restock-cur-sell" style="color: #38bdf8; font-weight: 900; font-size: 1.45rem; font-family: 'JetBrains Mono', monospace;">${activeItem.sellingPrice}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">ج.م</div>
          </div>
        </div>

        <!-- Section Divider -->
        <div style="display: flex; align-items: center; justify-content: center; margin: 4px 0 0; gap: 8px;">
          <span style="height: 1px; flex: 1; background: var(--border-subtle);"></span>
          <span style="color: #f59e0b; font-weight: 700; font-size: 0.88rem;">📦 بيانات الوارد الجديد وتعديل المخزون</span>
          <span style="height: 1px; flex: 1; background: var(--border-subtle);"></span>
        </div>

        <!-- Available Qty Input (Editable in case of previous mistake) -->
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
            <span>الكمية المتاحة (قروصة)</span>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(الرصيد الحالي بالمخزن - عدّله هنا إذا سُجل خطأ)</span>
          </label>
          <input type="number" id="restock-available-qty" class="form-control" value="${activeItem.cartonsInStock}" min="0" oninput="App.recalcRestockModal()">
        </div>

        <!-- New Inward Inputs -->
        <div class="form-group">
          <label class="form-label">الكمية الواردة الجديدة (قروصة)</label>
          <input type="number" id="restock-new-qty" class="form-control" value="0" min="0" oninput="App.recalcRestockModal()" placeholder="0">
        </div>

        <div class="form-group">
          <label class="form-label">سعر شراء الدفعة الجديدة (ج.م)</label>
          <input type="number" id="restock-new-buy" class="form-control" value="${activeItem.purchasePrice}" min="0" oninput="App.recalcRestockModal()">
        </div>

        <div class="form-group">
          <label class="form-label">سعر البيع الجديد للجمهور (ج.م)</label>
          <input type="number" id="restock-new-sell" class="form-control" value="${activeItem.sellingPrice}" min="0" oninput="App.recalcRestockModal()">
        </div>

        <div class="form-group">
          <label class="form-label">حد إعادة الطلب الحرج (قروصة)</label>
          <input type="number" id="restock-new-reorder" class="form-control" value="${activeItem.reorderLevel || 5}" min="1">
        </div>

        <!-- Calculated Summary Box (4 blocks) -->
        <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 12px 6px; display: grid; grid-template-columns: repeat(4, 1fr); text-align: center; gap: 6px;">
          <div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 4px;">الكمية بعد الوارد</div>
            <div id="restock-res-qty" style="color: #10b981; font-weight: 800; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">${activeItem.cartonsInStock}</div>
          </div>
          <div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 4px;">متوسط التكلفة (WAC)</div>
            <div id="restock-res-wac" style="color: #f59e0b; font-weight: 800; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">${activeItem.purchasePrice}</div>
          </div>
          <div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 4px;">هامش الربح المتوقع</div>
            <div id="restock-res-margin" style="color: #38bdf8; font-weight: 800; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">-</div>
          </div>
          <div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 4px;">خصم الخزينة</div>
            <div id="restock-res-treasury" style="color: #ef4444; font-weight: 800; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">0 ج.م</div>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn" onclick="App.saveRestockModal()" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #0f172a; font-weight: 800; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.3);">
          ✅ حفظ وتطبيق التوريد وتحديث الخزينة
        </button>
      </div>
    `;

    this.openModal(modalHtml, '520px');
    this.recalcRestockModal();
  },

  openQuickPriceUpdateModal() {
    this.openRestockPriceModal();
  },

  onRestockItemSelect(itemId) {
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    const curQtyEl = document.getElementById('restock-cur-qty');
    const curBuyEl = document.getElementById('restock-cur-buy');
    const curSellEl = document.getElementById('restock-cur-sell');
    const availableQtyEl = document.getElementById('restock-available-qty');
    const newQtyEl = document.getElementById('restock-new-qty');
    const newBuyEl = document.getElementById('restock-new-buy');
    const newSellEl = document.getElementById('restock-new-sell');
    const newReorderEl = document.getElementById('restock-new-reorder');

    if (curQtyEl) curQtyEl.textContent = item.cartonsInStock;
    if (curBuyEl) curBuyEl.textContent = item.purchasePrice;
    if (curSellEl) curSellEl.textContent = item.sellingPrice;
    if (availableQtyEl) availableQtyEl.value = item.cartonsInStock;
    if (newQtyEl) newQtyEl.value = 0;
    if (newBuyEl) newBuyEl.value = item.purchasePrice;
    if (newSellEl) newSellEl.value = item.sellingPrice;
    if (newReorderEl) newReorderEl.value = item.reorderLevel || 5;

    this.recalcRestockModal();
  },

  recalcRestockModal() {
    const itemId = document.getElementById('restock-item-select')?.value;
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    const availableInput = document.getElementById('restock-available-qty');
    const currentQty = availableInput !== null ? Math.max(0, Number(availableInput.value) || 0) : (Number(item.cartonsInStock) || 0);
    const currentBuy = Number(item.purchasePrice) || 0;
    const newQty = Math.max(0, Number(document.getElementById('restock-new-qty')?.value) || 0);
    const newBuy = Math.max(0, Number(document.getElementById('restock-new-buy')?.value) || 0);
    const newSell = Math.max(0, Number(document.getElementById('restock-new-sell')?.value) || 0);

    // Update the top stat card to reflect any manual adjustment in available quantity
    const curQtyEl = document.getElementById('restock-cur-qty');
    if (curQtyEl) curQtyEl.textContent = currentQty;

    const totalQty = currentQty + newQty;
    let wac = currentBuy;
    if (newQty > 0) {
      const currentTotalVal = currentQty * currentBuy;
      const newTotalVal = newQty * newBuy;
      wac = totalQty > 0 ? (currentTotalVal + newTotalVal) / totalQty : newBuy;
    } else if (newBuy > 0) {
      wac = newBuy;
    }
    wac = Math.round(wac * 100) / 100;

    const profitPerCarton = Math.round((newSell - wac) * 100) / 100;
    const marginPercent = wac > 0 ? Math.round((profitPerCarton / wac) * 1000) / 10 : 0;
    const treasuryDeduction = newQty * newBuy;

    const resQty = document.getElementById('restock-res-qty');
    const resWac = document.getElementById('restock-res-wac');
    const resMargin = document.getElementById('restock-res-margin');
    const resTreasury = document.getElementById('restock-res-treasury');

    if (resQty) resQty.textContent = `${totalQty}`;
    if (resWac) resWac.textContent = `${wac}`;
    if (resMargin) resMargin.textContent = `${profitPerCarton >= 0 ? '+' : ''}${profitPerCarton} (${marginPercent}%)`;
    if (resTreasury) {
      resTreasury.textContent = `${this.formatMoney(treasuryDeduction)} ج.م`;
      resTreasury.style.color = treasuryDeduction > 0 ? '#ef4444' : 'var(--text-secondary)';
    }
  },

  saveRestockModal() {
    const itemId = document.getElementById('restock-item-select')?.value;
    const item = this.db.items.find(i => i.id === itemId);
    if (!item) return;

    const availableInput = document.getElementById('restock-available-qty');
    const currentQty = availableInput !== null ? Math.max(0, Number(availableInput.value) || 0) : (Number(item.cartonsInStock) || 0);
    const currentBuy = Number(item.purchasePrice) || 0;
    const newQty = Math.max(0, Number(document.getElementById('restock-new-qty')?.value) || 0);
    const newBuy = Math.max(0, Number(document.getElementById('restock-new-buy')?.value) || 0);
    const newSell = Math.max(0, Number(document.getElementById('restock-new-sell')?.value) || 0);
    const newReorder = Math.max(1, Number(document.getElementById('restock-new-reorder')?.value) || (item.reorderLevel || 5));

    const totalQty = currentQty + newQty;
    let wac = currentBuy;
    if (newQty > 0) {
      wac = totalQty > 0 ? ((currentQty * currentBuy) + (newQty * newBuy)) / totalQty : newBuy;
    } else if (newBuy > 0) {
      wac = newBuy;
    }
    wac = Math.round(wac * 100) / 100;

    const oldStock = item.cartonsInStock;
    item.cartonsInStock = totalQty;
    item.purchasePrice = wac;
    item.sellingPrice = newSell;
    item.reorderLevel = newReorder;

    const treasuryDeduction = newQty * newBuy;
    if (treasuryDeduction > 0) {
      if (typeof this.db.treasury === 'object' && this.db.treasury !== null) {
        this.db.treasury.balance = Math.max(0, (this.db.treasury.balance || 0) - treasuryDeduction);
      } else {
        this.db.treasury = Math.max(0, (Number(this.db.treasury) || 0) - treasuryDeduction);
      }

      if (!this.db.treasuryLogs) this.db.treasuryLogs = [];
      const newTreasuryLog = {
        id: `tlog_${Date.now()}`,
        type: 'expense',
        amount: treasuryDeduction,
        category: 'توريد بضاعة',
        sourceName: `توريد صنف: ${item.name}`,
        desc: `توريد ${newQty} قروصة من ${item.name} بتكلفة ${newBuy} ج.م`,
        date: new Date().toISOString().replace('T', ' ').substring(0, 16),
        user: this.db.currentUser ? this.db.currentUser.name : 'حسام (الإدارة)'
      };
      this.db.treasuryLogs.unshift(newTreasuryLog);

      if (window.FDB) {
        window.FDB.addDocument('treasury', newTreasuryLog);
        window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
      }

      if (this.db.treasuryMovements) {
        this.db.treasuryMovements.unshift(newTreasuryLog);
      }
    }

    let notifDesc = '';
    if (newQty > 0 && currentQty !== oldStock) {
      notifDesc = `تم تعديل الرصيد السابق من ${oldStock} إلى ${currentQty} قروصة وتوريد ${newQty} قروصة جديدة (الإجمالي: ${totalQty}) وتحديث سعر البيع إلى ${newSell} ج.م والتكلفة الموزونة ${wac} ج.م.`;
    } else if (newQty > 0) {
      notifDesc = `تم توريد ${newQty} قروصة وتحديث سعر البيع إلى ${newSell} ج.م والتكلفة الموزونة ${wac} ج.م وخصم ${treasuryDeduction} ج.م من الخزينة.`;
    } else if (currentQty !== oldStock) {
      notifDesc = `تم تعديل الكمية المتاحة للصنف ${item.name} من ${oldStock} إلى ${totalQty} قروصة وتحديث الأسعار.`;
    } else {
      notifDesc = `تم تحديث سعر بيع ${item.name} إلى ${newSell} ج.م وسعر الشراء إلى ${wac} ج.م.`;
    }

    this.addNotification({
      id: `notif_${Date.now()}`,
      type: 'treasury',
      title: `📦 تحديث صنف وتوريد: ${item.name}`,
      desc: notifDesc,
      time: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      read: false
    });

    this.syncDB();
    if (window.FDB) window.FDB.updateDocument('items', item.id, item);
    this.closeModal();
    this.showToast(`تم حفظ وتطبيق التعديلات على صنف ${item.name} بنجاح`);
    this.renderInventory();
    if (this.currentPage === 'pos') this.renderPOSCatalog();
  },

  // ==========================================
  // 4. CUSTOMER ACCOUNTS & DEBTS
  // ==========================================
  renderCustomers() {
    const searchVal = (document.getElementById('customer-search-input')?.value || '').toLowerCase();
    const grid = document.getElementById('customers-grid');
    if (!grid) return;

    const isRep = this.isCurrentUserRep();
    const currentRep = isRep ? (this.activeRepForPOS || this.getLinkedRep()) : null;

    let baseCustomers = this.db.customers || [];
    if (isRep) {
      const assignedIds = (currentRep && Array.isArray(currentRep.assignedCustomerIds)) ? currentRep.assignedCustomerIds : [];
      baseCustomers = baseCustomers.filter(c => assignedIds.includes(c.id));
    }

    let filtered = baseCustomers.filter(c => {
      return c.name.toLowerCase().includes(searchVal) || (c.phone && c.phone.includes(searchVal)) || (c.area && c.area.toLowerCase().includes(searchVal));
    });

    if (filtered.length === 0) {
      if (isRep && (!currentRep || !Array.isArray(currentRep.assignedCustomerIds) || currentRep.assignedCustomerIds.length === 0)) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted); background: rgba(15, 23, 42, 0.4); border-radius: 12px; border: 1px dashed var(--border-subtle);">
            <div style="font-size: 2.2rem; margin-bottom: 10px;">👥</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-white); margin-bottom: 6px;">لا يوجد عملاء مخصصين لحسابك حالياً</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">يقوم مدير النظام (حساب الإدارة) بتخصيص خط سير العملاء لك من لوحة التحكم</div>
          </div>
        `;
      } else {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">لا يوجد عملاء مطابقين للبحث</div>`;
      }
      return;
    }

    grid.innerHTML = filtered.map(c => {
      const debtColor = c.currentDebt > 0 ? 'rose' : 'emerald';

      return `
        <div class="customer-card">
          <div>
            <div class="customer-card-header">
              <div>
                <div class="customer-name">${c.name}</div>
                <div style="font-size: 0.78rem; color: var(--text-secondary);">📍 ${c.area || 'بدون منطقة'}</div>
              </div>
              <div class="customer-phone">📞 ${c.phone}</div>
            </div>

            <div class="customer-stats-box">
              <div class="cstat-item">
                <span class="cstat-label">إجمالي المشتريات</span>
                <span class="cstat-val">${this.formatMoney(c.totalPurchases)}</span>
              </div>
              <div class="cstat-item">
                <span class="cstat-label">المبلغ المدفوع</span>
                <span class="cstat-val emerald">${this.formatMoney(c.totalPaid)}</span>
              </div>
              <div class="cstat-item">
                <span class="cstat-label">المتبقي الحالي</span>
                <span class="cstat-val ${debtColor}">${this.formatMoney(c.currentDebt)}</span>
              </div>
            </div>
          </div>

          <div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px;">
              المندوب: <strong>${c.assignedRepName || 'الإدارة المركزية'}</strong>
            </div>

            <div class="customer-card-actions">
              <button class="btn btn-success btn-sm" onclick="App.openPaymentReceiptModal('${c.id}')">
                💵 سند قبض
              </button>
              <button class="btn btn-blue btn-sm" onclick="App.openCustomerStatementModal('${c.id}')">
                📄 كشف حساب
              </button>
              ${!isRep ? `
                <button class="btn btn-secondary btn-sm" onclick="App.openEditCustomerModal('${c.id}')">
                  تعديل
                </button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteCustomer('${c.id}')">
                  حذف
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // Modal: إضافة عميل
  openAddCustomerModal() {
    if (this.isCurrentUserRep()) {
      this.showToast('إضافة وتخصيص العملاء متاح فقط لحساب الإدارة الرئيسية', 'error');
      return;
    }
    const modalHtml = `
      <div class="modal-header">
        <h3>👤 إضافة عميل جديد</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">اسم العميل / المحل / الكشك *</label>
            <input type="text" id="new-cust-name" class="form-control" placeholder="مثال: سوبر ماركت الأهرام">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الموبايل *</label>
            <input type="text" id="new-cust-phone" class="form-control" placeholder="01xxxxxxxxx">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">العنوان / المنطقة</label>
          <input type="text" id="new-cust-area" class="form-control" placeholder="مثال: شبرا - شارع الترعة">
        </div>

        <div class="form-group">
          <label class="form-label">رصيد دين افتتاحي سابق (إن وجد)</label>
          <input type="number" id="new-cust-debt" class="form-control" placeholder="0" min="0">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveNewCustomer()">حفظ العميل</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  saveNewCustomer() {
    const name = document.getElementById('new-cust-name').value.trim();
    const phone = document.getElementById('new-cust-phone').value.trim();
    const area = document.getElementById('new-cust-area').value.trim() || 'بدون عنوان';
    const debt = Number(document.getElementById('new-cust-debt').value) || 0;

    if (!name || !phone) {
      this.showToast('يرجى ملء اسم العميل ورقم الموبايل', 'error');
      return;
    }

    const newCust = {
      id: `cust_${Date.now()}`,
      name,
      phone,
      area,
      assignedRepId: null,
      assignedRepName: 'الإدارة المركزية',
      totalPurchases: debt,
      totalPaid: 0,
      currentDebt: debt,
      status: 'active'
    };

    this.db.customers.push(newCust);
    this.syncDB();
    if (window.FDB) window.FDB.addDocument('customers', newCust);
    this.closeModal();
    this.showToast(`تمت إضافة العميل ${name} بنجاح`);
    this.renderCustomers();
  },

  // Modal: سند قبض (تحصيل نقدية من العميل)
  openPaymentReceiptModal(custId) {
    const customer = this.db.customers.find(c => c.id === custId);
    if (!customer) return;

    const receiptNo = `TR-${Date.now().toString().slice(-4)}`;

    const isRep = this.isCurrentUserRep();
    const currentRep = this.activeRepForPOS || (isRep ? this.getLinkedRep() : null);

    const modalHtml = `
      <div class="modal-header">
        <h3>💵 سند قبض نقدي للعميل: ${customer.name}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 14px;">
          <div style="font-size: 0.85rem; color: var(--text-secondary);">المتبقي الحالي في ذمة العميل (الدين المستحق):</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: var(--rose);">${this.formatMoney(customer.currentDebt)} ج.م</div>
        </div>

        <div class="form-group">
          <label class="form-label">المبلغ المقبوض نقداً (ج.م) *</label>
          <input type="number" id="receipt-amount" class="form-control" value="${customer.currentDebt > 0 ? customer.currentDebt : ''}" placeholder="0.00" min="1">
        </div>

        <div class="form-group">
          <label class="form-label">بيان السند وملاحظات</label>
          <input type="text" id="receipt-notes" class="form-control" value="سداد دفعة نقدية من الحساب الآجل">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-success" onclick="App.savePaymentReceipt('${customer.id}', '${receiptNo}')">
          ✓ حفظ سند القبض وتحديث ${currentRep ? 'عهدة المندوب' : 'الخزينة'}
        </button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  savePaymentReceipt(custId, receiptNo) {
    const customer = this.db.customers.find(c => c.id === custId);
    if (!customer) return;

    const amount = Number(document.getElementById('receipt-amount')?.value);
    const notes = document.getElementById('receipt-notes')?.value || 'سند قبض';

    if (!amount || amount <= 0) {
      this.showToast('يرجى تحديد مبلغ سند قبض صحيح', 'error');
      return;
    }

    // Auto-detect receiving entity from active logged-in account (rep or administration)
    const isRep = this.isCurrentUserRep();
    const currentRep = this.activeRepForPOS || (isRep ? this.getLinkedRep() : null);

    const previousDebt = customer.currentDebt || 0;
    // 1. Update Customer Debts
    customer.totalPaid = (customer.totalPaid || 0) + amount;
    customer.currentDebt = Math.max(0, previousDebt - amount);
    const remainingDebt = customer.currentDebt;

    // 2. Deposit Cash & Log Receipt
    if (!this.db.treasuryLogs) this.db.treasuryLogs = [];

    let receiverName = '';
    let logType = '';

    if (currentRep) {
      receiverName = `المندوب (${currentRep.name})`;
      logType = 'سند قبض عميل (مع مندوب)';
      currentRep.currentCash = (currentRep.currentCash || 0) + amount;
      currentRep.assignedDebts = Math.max(0, (currentRep.assignedDebts || 0) - amount);
    } else {
      receiverName = this.getCurrentUser()?.name || 'حسام (المدير العام)';
      logType = 'سند قبض عميل';
      this.db.treasury = (this.db.treasury || 0) + amount;
    }

    // Also reduce assigned debts for assigned rep if payment was accepted at management
    if (customer.assignedRepId && (!currentRep || currentRep.id !== customer.assignedRepId)) {
      const assignedRep = this.db.reps.find(r => r.id === customer.assignedRepId);
      if (assignedRep) {
        assignedRep.assignedDebts = Math.max(0, (assignedRep.assignedDebts || 0) - amount);
      }
    }

    const logEntry = {
      id: receiptNo,
      date: new Date().toLocaleString('ar-EG-u-nu-latn'),
      type: logType,
      sourceName: customer.name,
      customerId: customer.id,
      customerPhone: customer.phone || '',
      receivedBy: receiverName,
      amount: amount,
      previousDebt: previousDebt,
      remainingDebt: remainingDebt,
      notes: notes
    };

    this.db.treasuryLogs.unshift(logEntry);

    // 3. Notification
    this.addNotification({
      title: `سند قبض مسدد #${receiptNo}`,
      desc: `تم تحصيل ${this.formatMoney(amount)} ج.م من العميل ${customer.name} - المتبقي: ${this.formatMoney(remainingDebt)} ج.م`,
      type: 'payment'
    });

    this.syncDB();
    if (window.FDB) {
      window.FDB.addDocument('treasury', logEntry);
      if (customer) window.FDB.updateDocument('customers', customer.id, customer);
      if (currentRep) window.FDB.updateDocument('reps', currentRep.id, currentRep);
    }
    this.closeModal();
    this.showToast(`تم تسجيل سند قبض بقيمة ${this.formatMoney(amount)} ج.م وتخفيض الدين بنجاح`);
    this.renderCurrentPage();
    this.viewReceiptModal(receiptNo);
  },

  // Modal: كشف حساب العميل
  openCustomerStatementModal(custId) {
    const customer = this.db.customers.find(c => c.id === custId);
    if (!customer) return;

    // Customer Invoices
    const invoices = this.db.invoices.filter(i => i.customerId === customer.id);
    // Customer Receipts
    const receipts = this.db.treasuryLogs.filter(t => t.sourceName.includes(customer.name));

    const modalHtml = `
      <div class="modal-header">
        <h3>📄 كشف حساب تفصيلي: ${customer.name}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px;">
          <div class="quick-stat-box">
            <span class="quick-stat-title">المشتريات</span>
            <span class="quick-stat-value">${this.formatMoney(customer.totalPurchases)} ج.م</span>
          </div>
          <div class="quick-stat-box">
            <span class="quick-stat-title">المدفوعات</span>
            <span class="quick-stat-value" style="color: var(--emerald);">${this.formatMoney(customer.totalPaid)} ج.م</span>
          </div>
          <div class="quick-stat-box">
            <span class="quick-stat-title">الدين الحالي</span>
            <span class="quick-stat-value" style="color: var(--rose);">${this.formatMoney(customer.currentDebt)} ج.م</span>
          </div>
        </div>

        <h4 style="margin-bottom: 8px;">سجل الفواتير الصادرة للعميل:</h4>
        <div style="max-height: 180px; overflow-y: auto; margin-bottom: 16px;">
          ${invoices.length === 0 ? '<p style="color: var(--text-muted); font-size: 0.85rem;">لا توجد فواتير مسجلة</p>' : `
            <table class="modern-table" style="font-size: 0.8rem;">
              <thead>
                <tr>
                  <th>رقم الفاتورة</th>
                  <th>التاريخ</th>
                  <th>الإجمالي</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${invoices.map(inv => `
                  <tr>
                    <td><strong style="color: var(--gold);">${inv.id}</strong></td>
                    <td>${inv.date}</td>
                    <td>${this.formatMoney(inv.grandTotal)}</td>
                    <td>${this.formatMoney(inv.paidAmount)}</td>
                    <td style="color: ${inv.remainingAmount > 0 ? 'var(--rose)' : 'inherit'};">${this.formatMoney(inv.remainingAmount)}</td>
                    <td class="table-actions-cell">
                      <div class="table-actions-row">
                        <button class="btn btn-secondary btn-sm" onclick="App.viewInvoiceModal('${inv.id}')" title="معاينة الفاتورة">معاينة</button>
                        <button class="btn btn-primary btn-sm" onclick="App.openEditInvoiceModal('${inv.id}')" title="تعديل الفاتورة">✏️ تعديل</button>
                        <button class="btn btn-danger btn-sm" onclick="App.deleteInvoice('${inv.id}')" title="حذف الفاتورة">🗑️ حذف</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <h4 style="margin-bottom: 8px;">سندات القبض المسددة:</h4>
        <div style="max-height: 140px; overflow-y: auto;">
          ${receipts.length === 0 ? '<p style="color: var(--text-muted); font-size: 0.85rem;">لا توجد سندات قبض مسجلة</p>' : `
            <table class="modern-table" style="font-size: 0.8rem;">
              <thead>
                <tr>
                  <th>رقم السند</th>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>البيان</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${receipts.map(r => `
                  <tr>
                    <td><code>${r.id}</code></td>
                    <td>${r.date}</td>
                    <td><strong style="color: var(--emerald);">${this.formatMoney(r.amount)} ج.م</strong></td>
                    <td>${r.notes}</td>
                    <td>
                      <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        <button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.72rem;" onclick="App.viewReceiptModal('${r.id}')" title="معاينة السند">معاينة</button>
                        <button class="btn btn-success btn-sm" style="padding: 2px 6px; font-size: 0.72rem; background: #25D366; border-color: #25D366; color: #fff;" onclick="App.shareReceiptWhatsApp('${r.id}')" title="إرسال صورة السند عبر واتساب">💬 واتساب</button>
                        <button class="btn btn-primary btn-sm" style="padding: 2px 6px; font-size: 0.72rem;" onclick="App.openEditReceiptModal('${r.id}')" title="تعديل السند">✏️ تعديل</button>
                        <button class="btn btn-danger btn-sm" style="padding: 2px 6px; font-size: 0.72rem;" onclick="App.deleteReceipt('${r.id}')" title="حذف السند">🗑️ حذف</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  openEditCustomerModal(custId) {
    const customer = this.db.customers.find(c => c.id === custId);
    if (!customer) return;

    const modalHtml = `
      <div class="modal-header">
        <h3>✏️ تعديل بيانات العميل: ${customer.name}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">الاسم</label>
            <input type="text" id="edit-cust-name" class="form-control" value="${customer.name}">
          </div>
          <div class="form-group">
            <label class="form-label">الموبايل</label>
            <input type="text" id="edit-cust-phone" class="form-control" value="${customer.phone}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">المنطقة</label>
          <input type="text" id="edit-cust-area" class="form-control" value="${customer.area || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">تعديل رصيد الدين الحالي (ج.م)</label>
          <input type="number" id="edit-cust-debt" class="form-control" value="${customer.currentDebt}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveEditCustomer('${customer.id}')">حفظ التعديلات</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  saveEditCustomer(custId) {
    const customer = this.db.customers.find(c => c.id === custId);
    if (!customer) return;

    customer.name = document.getElementById('edit-cust-name').value.trim();
    customer.phone = document.getElementById('edit-cust-phone').value.trim();
    customer.area = document.getElementById('edit-cust-area').value.trim();
    customer.currentDebt = Number(document.getElementById('edit-cust-debt').value) || 0;

    this.syncDB();
    if (window.FDB) window.FDB.updateDocument('customers', custId, customer);
    this.closeModal();
    this.showToast(`تم تحديث بيانات العميل ${customer.name}`);
    this.renderCustomers();
  },

  async deleteCustomer(custId) {
    const customer = this.db.customers.find(c => c.id === custId);
    if (!customer) return;

    const confirmed = await this.confirmDialog({
      title: 'حذف حساب العميل',
      subtitle: 'إشعار تأكيد حذف العميل وسجلاته',
      message: `هل تريد بالتأكيد حذف حساب العميل "${customer.name}"؟`,
      icon: '👤',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">اسم العميل:</span>
            <span class="value">${customer.name}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">رقم الهاتف:</span>
            <span class="value">${customer.phone || '—'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">المنطقة:</span>
            <span class="value">${customer.area || '—'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">الديون المسجلة:</span>
            <span class="value ${Number(customer.currentDebt) > 0 ? 'text-rose' : 'text-emerald'}">${this.formatMoney(customer.currentDebt || 0)} ج.م</span>
          </div>
        </div>
        <div class="confirm-warning-note">⚠️ تحذير: سيتم حذف العميل نهائياً من قائمة العملاء.</div>
      `,
      confirmText: 'نعم، حذف العميل',
      cancelText: 'إلغاء'
    });

    if (!confirmed) return;

    this.db.customers = this.db.customers.filter(c => c.id !== custId);
    (this.db.reps || []).forEach(r => {
      if (Array.isArray(r.assignedCustomerIds) && r.assignedCustomerIds.includes(custId)) {
        r.assignedCustomerIds = r.assignedCustomerIds.filter(id => id !== custId);
        r.assignedCustomersCount = r.assignedCustomerIds.length;
        const remainingCusts = (this.db.customers || []).filter(c => r.assignedCustomerIds.includes(c.id));
        r.assignedDebts = remainingCusts.reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);
        if (window.FDB) window.FDB.updateDocument('reps', r.id, r);
      }
    });
    this.syncDB();
    if (window.FDB) window.FDB.deleteDocument('customers', custId);
    this.showToast(`تم حذف العميل ${customer.name}`);
    this.renderCustomers();
    if (typeof this.renderRepsCards === 'function') this.renderRepsCards();
  },

  // ==========================================
  // 5. INVOICES LOG & FINANCIAL REPORTS
  // ==========================================
  renderReports() {
    // 1. الديون (مجموع المستحقات بالسوق)
    const totalMarketDebts = this.db.customers.reduce((sum, c) => sum + (Number(c.currentDebt) || 0), 0);

    // 2. معايا بضاعة بكام (مخزن) - تقييم المخزن بسعر الشراء
    const stockValuePurchase = this.db.items.reduce((sum, i) => sum + ((Number(i.cartonsInStock) || 0) * (Number(i.purchasePrice) || 0)), 0);

    // 3. السيولة النقدية الشاملة (الخزينة + النقدية مع المناديب)
    const repsCash = this.db.reps.reduce((sum, r) => sum + (Number(r.currentCash) || 0), 0);
    const treasuryCash = this.db.treasury || 0;
    const totalLiquidity = treasuryCash + repsCash;

    // 4. النقدية الحالية بالخزينة
    // treasuryCash

    // 5. إجمالي التوريدات والإيداعات النقدية للخزينة (الوارد الفعلي)
    const totalTreasurySupplies = (this.db.treasuryLogs || [])
      .filter(t => t.type !== 'expense' && (Number(t.amount) || 0) > 0)
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // 6. إجمالي توريدات المناديب
    const totalRepsSupplied = (this.db.reps || []).reduce((sum, r) => sum + (Number(r.totalSupplied) || 0), 0);

    // 7. إجمالي إيرادات المبيعات
    const totalSalesRevenue = (this.db.invoices || []).reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);

    // 8. صافي أرباح الفواتير
    const totalInvoicesProfit = (this.db.invoices || []).reduce((sum, inv) => sum + (Number(inv.netProfit) || 0), 0);

    // Set KPI cards
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = this.formatMoney(val);
    };

    setVal('rep-kpi-debts', totalMarketDebts);
    setVal('rep-kpi-stock-val', stockValuePurchase);
    setVal('rep-kpi-liquidity', totalLiquidity);
    setVal('rep-kpi-treasury', treasuryCash);
    setVal('rep-kpi-treasury-supplies', totalTreasurySupplies);
    setVal('rep-kpi-reps-supplies', totalRepsSupplied);
    setVal('rep-kpi-sales-revenue', totalSalesRevenue);
    setVal('rep-kpi-net-profit', totalInvoicesProfit);

    // Render Tables (Sales invoices & Treasury receipts)
    this.setReportsTab(this.activeReportsTab || 'invoices');
    this.filterReportsData();
  },

  activeReportsTab: 'invoices',

  setReportsTab(tab) {
    this.activeReportsTab = tab;
    const btnInv = document.getElementById('reports-tab-invoices');
    const btnRec = document.getElementById('reports-tab-receipts');
    const btnBoth = document.getElementById('reports-tab-both');
    const panelInv = document.getElementById('reports-invoices-panel');
    const panelRec = document.getElementById('reports-receipts-panel');

    if (btnInv) btnInv.classList.toggle('active', tab === 'invoices');
    if (btnRec) btnRec.classList.toggle('active', tab === 'receipts');
    if (btnBoth) btnBoth.classList.toggle('active', tab === 'both');

    if (panelInv) panelInv.style.display = (tab === 'invoices' || tab === 'both') ? 'block' : 'none';
    if (panelRec) panelRec.style.display = (tab === 'receipts' || tab === 'both') ? 'block' : 'none';
  },

  filterReportsData() {
    const searchVal = (document.getElementById('reports-search-input')?.value || '').toLowerCase();
    const period = document.getElementById('reports-period-filter')?.value || 'all';

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthPrefix = todayStr.substring(0, 7);

    // Filter invoices
    let filteredInvoices = (this.db.invoices || []).filter(inv => {
      const matchSearch = inv.id.toLowerCase().includes(searchVal) || 
                          (inv.customerName && inv.customerName.toLowerCase().includes(searchVal)) ||
                          (inv.sellerName && inv.sellerName.toLowerCase().includes(searchVal));
      
      let matchDate = true;
      if (period === 'today') {
        matchDate = inv.date && inv.date.startsWith(todayStr);
      } else if (period === 'month') {
        matchDate = inv.date && inv.date.startsWith(monthPrefix);
      }
      return matchSearch && matchDate;
    });

    const invTbody = document.getElementById('reports-invoices-tbody');
    if (invTbody) {
      if (filteredInvoices.length === 0) {
        invTbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 25px; color: var(--text-muted);">لا توجد فواتير مطابقة</td></tr>`;
      } else {
        invTbody.innerHTML = filteredInvoices.map(inv => `
          <tr>
            <td><strong style="color: var(--gold);">${inv.id}</strong></td>
            <td>${inv.date}</td>
            <td>${inv.customerName}</td>
            <td>
              <span class="badge-status blue" style="font-weight: 700; white-space: nowrap; font-size: 0.8rem;">
                ${(inv.items || []).length} صنف (${(inv.items || []).reduce((s, it) => s + Number(it.qty || 0), 0)} قروصة)
              </span>
            </td>
            <td>${inv.sellerName}</td>
            <td><strong>${this.formatMoney(inv.grandTotal)} ج.م</strong></td>
            <td>${this.formatMoney(inv.paidAmount)} ج.م</td>
            <td style="color: ${inv.remainingAmount > 0 ? 'var(--rose)' : 'inherit'};">${this.formatMoney(inv.remainingAmount)} ج.م</td>
            <td><strong style="color: var(--emerald);">${this.formatMoney(inv.netProfit)} ج.م</strong></td>
            <td class="table-actions-cell">
              <div class="table-actions-row">
                <button class="btn btn-secondary btn-sm" onclick="App.viewInvoiceModal('${inv.id}')" title="معاينة الفاتورة">معاينة</button>
                <button class="btn btn-primary btn-sm" onclick="App.openEditInvoiceModal('${inv.id}')" title="تعديل الفاتورة">✏️ تعديل</button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteInvoice('${inv.id}')" title="حذف الفاتورة">🗑️ حذف</button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    // Filter Treasury Logs & Receipts
    const trTbody = document.getElementById('reports-treasury-tbody');
    if (trTbody) {
      let filteredLogs = (this.db.treasuryLogs || []).filter(log => {
        const matchSearch = log.id.toLowerCase().includes(searchVal) || 
                            (log.sourceName && log.sourceName.toLowerCase().includes(searchVal)) || 
                            (log.type && log.type.toLowerCase().includes(searchVal)) ||
                            (log.notes && log.notes.toLowerCase().includes(searchVal)) ||
                            (log.receivedBy && log.receivedBy.toLowerCase().includes(searchVal));
        let matchDate = true;
        if (period === 'today') {
          matchDate = log.date && log.date.startsWith(todayStr);
        } else if (period === 'month') {
          matchDate = log.date && log.date.startsWith(monthPrefix);
        }
        return matchSearch && matchDate;
      });

      // Update Badges
      const invBadge = document.getElementById('reports-invoices-badge');
      if (invBadge) invBadge.textContent = filteredInvoices.length;
      const recBadge = document.getElementById('reports-receipts-badge');
      if (recBadge) recBadge.textContent = filteredLogs.length;

      if (filteredLogs.length === 0) {
        trTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-muted);">لا توجد سندات قبض أو حركات توريد مسجلة</td></tr>`;
      } else {
        trTbody.innerHTML = filteredLogs.map(log => `
          <tr>
            <td><strong style="color: var(--gold); font-family: monospace;">${log.id}</strong></td>
            <td>${log.date}</td>
            <td><span class="badge-status ${log.type.includes('سند') ? 'success' : (log.type.includes('توريد') ? 'blue' : 'warning')}">${log.type}</span></td>
            <td><strong>${log.sourceName}</strong></td>
            <td>${log.receivedBy || 'الإدارة'}</td>
            <td><strong style="color: var(--emerald); font-size: 0.95rem;">${this.formatMoney(log.amount)} ج.م</strong></td>
            <td>${log.notes || '---'}</td>
            <td class="table-actions-cell">
              <div class="table-actions-row">
                <button class="btn btn-secondary btn-sm" onclick="App.viewReceiptModal('${log.id}')" title="معاينة سند القبض">معاينة</button>
                <button class="btn btn-success btn-sm" onclick="App.shareReceiptWhatsApp('${log.id}')" title="إرسال صورة السند عبر واتساب" style="background: #25D366; border-color: #25D366; padding: 4px 8px;">💬 واتساب</button>
                <button class="btn btn-primary btn-sm" onclick="App.openEditReceiptModal('${log.id}')" title="تعديل سند القبض">✏️ تعديل</button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteReceipt('${log.id}')" title="حذف سند القبض">🗑️ حذف</button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }
  },

  // Modal: عرض فاتورة مسجلة مسبقاً
  viewInvoiceModal(invoiceId) {
    const inv = this.db.invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    const items = inv.items || [];
    const totalItemsCount = items.length;
    const totalCartons = items.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    const grossTotal = items.reduce((sum, it) => sum + (Number(it.qty) * Number(it.price)), 0);
    const totalItemDiscounts = items.reduce((sum, it) => sum + (Number(it.discount) || 0), 0);

    const modalHtml = `
      <div class="modal-header">
        <h3>🧾 تفاصيل الفاتورة #${inv.id}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="background: #f1f5f9; padding: 20px;">
        <div id="view-invoice-capture" class="receipt-wrapper">
          <div class="receipt-header">
            <div class="receipt-title">${this.db.settings.businessName}</div>
            <div class="receipt-subtitle">${this.db.settings.address} - هاتف: ${this.db.settings.phone}</div>
            <div class="receipt-meta">
              <span>رقم الفاتورة: <strong>${inv.id}</strong></span>
              <span>التاريخ: ${inv.date}</span>
            </div>
            <div class="receipt-meta">
              <span>العميل: <strong>${inv.customerName}</strong></span>
              <span>البائع: <strong>${inv.sellerName}</strong></span>
            </div>
          </div>

          <table class="receipt-table">
            <thead>
              <tr>
                <th style="text-align: right;">الصنف (قروصة)</th>
                <th style="text-align: center;">الكمية</th>
                <th style="text-align: center;">السعر</th>
                <th style="text-align: center;">خصم الصنف</th>
                <th style="text-align: left;">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(it => `
                <tr>
                  <td>${it.name}</td>
                  <td style="text-align: center; font-weight: bold;">${it.qty}</td>
                  <td style="text-align: center;">${it.price}</td>
                  <td style="text-align: center; color: ${it.discount > 0 ? '#dc2626' : '#94a3b8'}; font-weight: ${it.discount > 0 ? 'bold' : 'normal'};">
                    ${it.discount > 0 ? `- ${this.formatMoney(it.discount)}` : '0'}
                  </td>
                  <td style="text-align: left; font-weight: bold;">${this.formatMoney(it.total)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="background: #f1f5f9; font-weight: bold; border-top: 2px solid #cbd5e1;">
                <td style="text-align: right; color: #1e3a8a;">إجمالي الأصناف: ${totalItemsCount} صنف</td>
                <td style="text-align: center; color: #1e3a8a; font-weight: 800;">${totalCartons} قروصة</td>
                <td colspan="3" style="text-align: left; color: #64748b; font-size: 0.8rem;">إجمالي كمية القروصات</td>
              </tr>
            </tfoot>
          </table>

          <div class="receipt-totals">
            <div class="receipt-total-row" style="background: #eff6ff; padding: 6px 10px; border-radius: 6px; font-weight: bold; color: #1e3a8a; margin-bottom: 6px; border: 1px solid #bfdbfe;">
              <span>إجمالي عدد الأصناف والكمية:</span>
              <span style="font-weight: 800;">${totalItemsCount} صنف (${totalCartons} قروصة)</span>
            </div>
            <div class="receipt-total-row">
              <span>المجموع الفرعي (قبل الخصم):</span>
              <span>${this.formatMoney(grossTotal)} ج.م</span>
            </div>
            ${totalItemDiscounts > 0 ? `
              <div class="receipt-total-row" style="color: #dc2626;">
                <span>إجمالي خصم الأصناف:</span>
                <span>- ${this.formatMoney(totalItemDiscounts)} ج.م</span>
              </div>
            ` : ''}
            ${inv.discount > 0 ? `
              <div class="receipt-total-row" style="color: #dc2626;">
                <span>خصم الفاتورة العام:</span>
                <span>- ${this.formatMoney(inv.discount)} ج.م</span>
              </div>
            ` : ''}
            <div class="receipt-total-row grand">
              <span>صافي الفاتورة:</span>
              <span>${this.formatMoney(inv.grandTotal)} ج.م</span>
            </div>
            <div class="receipt-total-row" style="color: #059669; font-weight: bold;">
              <span>المدفوع:</span>
              <span>${this.formatMoney(inv.paidAmount)} ج.م</span>
            </div>
            ${inv.remainingAmount > 0 ? `
              <div class="receipt-total-row" style="color: #dc2626; font-weight: bold;">
                <span>المتبقي (أجل):</span>
                <span>${this.formatMoney(inv.remainingAmount)} ج.م</span>
              </div>
            ` : ''}
          </div>

          <div class="receipt-footer">
            <div>${this.db.settings.receiptFooter}</div>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="App.openEditInvoiceModal('${inv.id}')">
            <span>✏️</span> تعديل الفاتورة
          </button>
          <button class="btn btn-danger" onclick="App.deleteInvoice('${inv.id}')">
            <span>🗑️</span> حذف الفاتورة
          </button>
          <button class="btn" onclick="App.shareSavedInvoiceWhatsApp('${inv.id}')" style="background-color: #25D366; color: #ffffff; border: none; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(37,211,102,0.3); padding: 8px 14px; border-radius: 6px; cursor: pointer;">
            ${this.getWhatsAppIconSvg(18)}
            <span>إرسال صورة الفاتورة عبر واتساب</span>
          </button>
          <button class="btn btn-primary" onclick="App.downloadSavedInvoiceImage('${inv.id}')" style="display: inline-flex; align-items: center; gap: 6px;">
            <span>📥</span> تنزيل الفاتورة كصورة
          </button>
        </div>
        <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  // ==========================================
  // INVOICE EDITING & DELETION
  // ==========================================
  openEditInvoiceModal(invoiceId) {
    const inv = this.db.invoices.find(i => i.id === invoiceId);
    if (!inv) {
      this.showToast('لم يتم العثور على الفاتورة', 'error');
      return;
    }

    // Clone invoice data for local editing
    this.editingInvoice = JSON.parse(JSON.stringify(inv));
    if (!this.editingInvoice.items) this.editingInvoice.items = [];

    const grossTotal = this.editingInvoice.items.reduce((s, it) => s + (Number(it.qty || 0) * Number(it.price || 0)), 0);
    const totalItemDiscounts = this.editingInvoice.items.reduce((s, it) => s + (Number(it.discount) || 0), 0);
    const subtotal = Math.max(0, grossTotal - totalItemDiscounts);

    const customersOptions = (this.db.customers || []).map(c => 
      `<option value="${c.id}" ${c.id === inv.customerId || c.name === inv.customerName ? 'selected' : ''}>${c.name} (${c.phone || 'بدون هاتف'})</option>`
    ).join('');

    const repsOptions = (this.db.reps || []).map(r => 
      `<option value="${r.name}" ${r.name === inv.sellerName ? 'selected' : ''}>مندوب: ${r.name}</option>`
    ).join('');

    const availableItemsOptions = (this.db.items || []).map(item => 
      `<option value="${item.id}" data-price="${item.sellingPrice}" data-cost="${item.purchasePrice}" data-name="${item.name}">${item.name} - سعر البيع: ${item.sellingPrice} ج.م</option>`
    ).join('');

    const modalHtml = `
      <div class="modal-header">
        <h3><span>✏️</span> تعديل الفاتورة #${inv.id}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 16px; max-height: 75vh; overflow-y: auto;">
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">العميل *</label>
            <select id="edit-inv-customer" class="custom-select" onchange="App.onEditInvoiceCustomerChange(this.value)">
              <option value="">عميل نقدي عام</option>
              ${customersOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">تاريخ وتوقيت الفاتورة *</label>
            <input type="text" id="edit-inv-date" class="form-control" value="${inv.date}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">البائع / المسؤول *</label>
            <input type="text" id="edit-inv-seller" class="form-control" value="${inv.sellerName || (this.db.currentUser ? this.db.currentUser.name : 'حسام (الإدارة)')}" readonly style="background: rgba(15, 23, 42, 0.6); cursor: not-allowed; opacity: 0.95; color: var(--text-white); font-weight: 700; border: 1px solid var(--border-subtle);" title="البائع المسجل في الحساب (غير قابل للتعديل)">
          </div>
          <div class="form-group">
            <label class="form-label">رقم هاتف العميل</label>
            <input type="text" id="edit-inv-phone" class="form-control" value="${inv.customerPhone || ''}" placeholder="01xxxxxxxxx">
          </div>
        </div>

        <div style="border-top: 1px solid var(--border-subtle); padding-top: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <label class="form-label" style="font-size: 0.95rem; font-weight: 800; color: var(--text-white); margin-bottom: 0;">
                📦 أصناف الفاتورة والكميات:
              </label>
              <span id="edit-inv-items-badge" class="badge-status blue" style="font-size: 0.8rem; font-weight: 700;">
                ${this.editingInvoice.items.length} صنف (${this.editingInvoice.items.reduce((s, it) => s + Number(it.qty || 0), 0)} قروصة)
              </span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <select id="edit-inv-add-select" class="custom-select" style="font-size: 0.8rem; padding: 4px 10px; max-width: 250px;">
                ${availableItemsOptions}
              </select>
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.addEditInvoiceItem()" style="white-space: nowrap; font-size: 0.8rem;">
                ➕ إضافة صنف
              </button>
            </div>
          </div>

          <div class="table-responsive" style="max-height: 220px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
            <table class="modern-table" style="font-size: 0.84rem; margin-bottom: 0;">
              <thead>
                <tr>
                  <th style="min-width: 150px;">الصنف</th>
                  <th style="width: 90px;">الكمية (قروصة)</th>
                  <th style="width: 100px;">السعر (ج.م)</th>
                  <th style="width: 105px; color: #f59e0b;">خصم الصنف (ج.م)</th>
                  <th style="width: 100px;">الإجمالي</th>
                  <th style="width: 45px;">حذف</th>
                </tr>
              </thead>
              <tbody id="edit-invoice-items-tbody">
                <!-- populated by renderEditInvoiceItems() -->
              </tbody>
            </table>
          </div>
        </div>

        <div style="background: rgba(10, 14, 22, 0.6); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <div class="form-row" style="margin-bottom: 10px;">
            <div class="form-group">
              <label class="form-label">إجمالي الأصناف قبل الخصم</label>
              <div id="edit-inv-gross" style="font-size: 1.05rem; font-weight: 800; color: var(--text-white); font-family: 'JetBrains Mono', monospace; padding-top: 4px;">
                ${this.formatMoney(grossTotal)} ج.م
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" style="color: #f59e0b;">إجمالي خصم الأصناف</label>
              <div id="edit-inv-items-discount" style="font-size: 1.05rem; font-weight: 800; color: #f59e0b; font-family: 'JetBrains Mono', monospace; padding-top: 4px;">
                - ${this.formatMoney(totalItemDiscounts)} ج.م
              </div>
            </div>
          </div>

          <div class="form-row" style="margin-bottom: 10px;">
            <div class="form-group">
              <label class="form-label">صافي الأصناف (بعد خصم الأصناف)</label>
              <div id="edit-inv-subtotal" style="font-size: 1.05rem; font-weight: 800; color: var(--text-white); font-family: 'JetBrains Mono', monospace; padding-top: 4px;">
                ${this.formatMoney(subtotal)} ج.م
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" style="color: var(--rose-neon);">خصم الفاتورة العام (ج.م)</label>
              <input type="number" id="edit-inv-discount" class="form-control" value="${inv.discount || 0}" min="0" oninput="App.recalcEditInvoiceTotals()">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" style="color: var(--teal-neon); font-weight: 800;">صافي الفاتورة النهائي</label>
              <div id="edit-inv-grandtotal" style="font-size: 1.25rem; font-weight: 900; color: var(--teal-neon); font-family: 'JetBrains Mono', monospace;">
                ${this.formatMoney(inv.grandTotal)} ج.م
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">المبلغ المدفوع كاش (ج.م)</label>
              <input type="number" id="edit-inv-paid" class="form-control" value="${inv.paidAmount !== undefined ? inv.paidAmount : inv.grandTotal}" min="0" oninput="App.recalcEditInvoiceTotals()">
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border-subtle);">
            <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-secondary);">المتبقي في الذمة (أجل):</span>
            <span id="edit-inv-remaining" style="font-size: 1.1rem; font-weight: 900; color: ${inv.remainingAmount > 0 ? 'var(--rose-neon)' : 'var(--emerald-neon)'}; font-family: 'JetBrains Mono', monospace;">
              ${this.formatMoney(inv.remainingAmount || 0)} ج.م
            </span>
          </div>
        </div>

      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveEditInvoice('${inv.id}')">💾 حفظ تعديلات الفاتورة</button>
      </div>
    `;

    this.openModal(modalHtml, '750px');
    this.renderEditInvoiceItems();
  },

  renderEditInvoiceItems() {
    const tbody = document.getElementById('edit-invoice-items-tbody');
    if (!tbody || !this.editingInvoice) return;

    if (this.editingInvoice.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 15px;">لا توجد أصناف في الفاتورة</td></tr>`;
      return;
    }

    tbody.innerHTML = this.editingInvoice.items.map((item, idx) => {
      const lineTotal = Math.max(0, (Number(item.qty || 0) * Number(item.price || 0)) - (Number(item.discount) || 0));
      return `
      <tr>
        <td style="font-weight: 700;">${item.name}</td>
        <td>
          <input type="number" class="form-control" style="padding: 4px 8px; height: 32px; font-size: 0.85rem;" value="${item.qty}" min="1" oninput="App.onEditInvoiceItemChange(${idx}, 'qty', this.value)">
        </td>
        <td>
          <input type="number" class="form-control" style="padding: 4px 8px; height: 32px; font-size: 0.85rem;" value="${item.price}" min="0" oninput="App.onEditInvoiceItemChange(${idx}, 'price', this.value)">
        </td>
        <td>
          <input type="number" class="form-control" style="padding: 4px 8px; height: 32px; font-size: 0.85rem; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4);" value="${item.discount || 0}" min="0" oninput="App.onEditInvoiceItemChange(${idx}, 'discount', this.value)" placeholder="0">
        </td>
        <td id="edit-item-row-total-${idx}" style="font-weight: 700; font-family: 'JetBrains Mono', monospace;">
          ${this.formatMoney(lineTotal)}
        </td>
        <td>
          <button type="button" class="btn btn-danger btn-sm" style="padding: 2px 8px;" onclick="App.removeEditInvoiceItem(${idx})">✕</button>
        </td>
      </tr>
    `;
    }).join('');

    this.recalcEditInvoiceTotals();
  },

  onEditInvoiceItemChange(index, field, val) {
    if (!this.editingInvoice || !this.editingInvoice.items[index]) return;
    const num = Number(val) || 0;
    if (field === 'qty') this.editingInvoice.items[index].qty = Math.max(1, num);
    if (field === 'price') this.editingInvoice.items[index].price = Math.max(0, num);
    if (field === 'discount') this.editingInvoice.items[index].discount = Math.max(0, num);
    const item = this.editingInvoice.items[index];
    item.total = Math.max(0, (Number(item.qty || 0) * Number(item.price || 0)) - (Number(item.discount) || 0));

    const rowTotalEl = document.getElementById(`edit-item-row-total-${index}`);
    if (rowTotalEl) {
      rowTotalEl.textContent = this.formatMoney(item.total);
    }
    this.recalcEditInvoiceTotals();
  },

  addEditInvoiceItem() {
    const select = document.getElementById('edit-inv-add-select');
    if (!select) return;
    const selectedOpt = select.options[select.selectedIndex];
    if (!selectedOpt) return;

    const itemId = select.value;
    const itemName = selectedOpt.getAttribute('data-name');
    const price = Number(selectedOpt.getAttribute('data-price')) || 0;
    const cost = Number(selectedOpt.getAttribute('data-cost')) || price;

    // If item already in invoice, increment qty
    const existing = this.editingInvoice.items.find(i => i.id === itemId || i.name === itemName);
    if (existing) {
      existing.qty += 1;
      existing.total = Math.max(0, (existing.qty * existing.price) - (Number(existing.discount) || 0));
    } else {
      this.editingInvoice.items.push({
        id: itemId,
        name: itemName,
        qty: 1,
        price: price,
        cost: cost,
        discount: 0,
        total: price
      });
    }

    this.renderEditInvoiceItems();
  },

  removeEditInvoiceItem(index) {
    if (!this.editingInvoice || !this.editingInvoice.items) return;
    this.editingInvoice.items.splice(index, 1);
    this.renderEditInvoiceItems();
  },

  onEditInvoiceCustomerChange(custId) {
    const phoneInput = document.getElementById('edit-inv-phone');
    if (!phoneInput) return;
    if (!custId) {
      phoneInput.value = '';
      return;
    }
    const customer = (this.db.customers || []).find(c => c.id === custId);
    if (customer && customer.phone) {
      phoneInput.value = customer.phone;
    }
  },

  recalcEditInvoiceTotals() {
    if (!this.editingInvoice) return;
    const grossTotal = (this.editingInvoice.items || []).reduce((sum, i) => sum + (Number(i.qty || 0) * Number(i.price || 0)), 0);
    const totalItemDiscounts = (this.editingInvoice.items || []).reduce((sum, i) => sum + (Number(i.discount) || 0), 0);
    const subtotal = Math.max(0, grossTotal - totalItemDiscounts);
    const discountInput = document.getElementById('edit-inv-discount');
    const invoiceDiscount = discountInput ? Math.max(0, Number(discountInput.value) || 0) : (this.editingInvoice.discount || 0);

    const grandTotal = Math.max(0, subtotal - invoiceDiscount);

    const paidInput = document.getElementById('edit-inv-paid');
    let paid = paidInput ? Math.max(0, Number(paidInput.value) || 0) : (this.editingInvoice.paidAmount !== undefined ? this.editingInvoice.paidAmount : grandTotal);
    const remaining = Math.max(0, grandTotal - paid);

    const grossEl = document.getElementById('edit-inv-gross');
    const itemDiscEl = document.getElementById('edit-inv-items-discount');
    const subEl = document.getElementById('edit-inv-subtotal');
    const grandEl = document.getElementById('edit-inv-grandtotal');
    const remEl = document.getElementById('edit-inv-remaining');

    if (grossEl) grossEl.textContent = `${this.formatMoney(grossTotal)} ج.م`;
    if (itemDiscEl) itemDiscEl.textContent = `- ${this.formatMoney(totalItemDiscounts)} ج.م`;
    if (subEl) subEl.textContent = `${this.formatMoney(subtotal)} ج.م`;
    if (grandEl) grandEl.textContent = `${this.formatMoney(grandTotal)} ج.م`;
    if (remEl) {
      remEl.textContent = `${this.formatMoney(remaining)} ج.م`;
      remEl.style.color = remaining > 0 ? 'var(--rose-neon)' : 'var(--emerald-neon)';
    }

    const itemsBadge = document.getElementById('edit-inv-items-badge');
    if (itemsBadge) {
      const cnt = (this.editingInvoice.items || []).length;
      const cartons = (this.editingInvoice.items || []).reduce((s, it) => s + Number(it.qty || 0), 0);
      itemsBadge.textContent = `${cnt} صنف (${cartons} قروصة)`;
    }
  },

  saveEditInvoice(invoiceId) {
    const inv = this.db.invoices.find(i => i.id === invoiceId);
    if (!inv || !this.editingInvoice) return;

    if (!this.editingInvoice.items || this.editingInvoice.items.length === 0) {
      this.showToast('لا يمكن حفظ فاتورة بدون أصناف', 'error');
      return;
    }

    const customerSelect = document.getElementById('edit-inv-customer');
    const newCustId = customerSelect ? customerSelect.value : inv.customerId;
    const newCust = (this.db.customers || []).find(c => c.id === newCustId);
    const newCustName = newCust ? newCust.name : (customerSelect?.options[customerSelect.selectedIndex]?.text || inv.customerName);
    const newPhone = document.getElementById('edit-inv-phone')?.value.trim() || inv.customerPhone;
    const newDate = document.getElementById('edit-inv-date')?.value.trim() || inv.date;
    const newSellerName = document.getElementById('edit-inv-seller')?.value.trim() || inv.sellerName;
    const newSellerType = newSellerName.includes('مندوب') || (this.db.reps || []).some(r => r.name === newSellerName) ? 'مندوب' : 'الإدارة (الرئيسية)';

    const grossTotal = this.editingInvoice.items.reduce((sum, i) => sum + (Number(i.qty || 0) * Number(i.price || 0)), 0);
    const totalItemDiscounts = this.editingInvoice.items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0);
    const subtotal = Math.max(0, grossTotal - totalItemDiscounts);
    const discount = Math.max(0, Number(document.getElementById('edit-inv-discount')?.value) || 0);
    const grandTotal = Math.max(0, subtotal - discount);
    const paid = Math.max(0, Number(document.getElementById('edit-inv-paid')?.value) || 0);
    const remaining = Math.max(0, grandTotal - paid);
    const totalCost = this.editingInvoice.items.reduce((sum, i) => sum + ((Number(i.cost) || Number(i.price)) * Number(i.qty)), 0);
    const netProfit = grandTotal - totalCost;

    // 1. REVERSE OLD INVOICE IMPACT
    // Always restore old items to warehouse stock
    inv.items.forEach(it => {
      const whItem = (this.db.items || []).find(i => i.id === it.id || i.name === it.name);
      if (whItem) {
        whItem.cartonsInStock = (Number(whItem.cartonsInStock) || 0) + Number(it.qty);
        if (window.FDB) window.FDB.updateDocument('items', whItem.id, whItem);
      }
    });

    if (inv.sellerType === 'مندوب') {
      const oldRep = (this.db.reps || []).find(r => r.name === inv.sellerName);
      if (oldRep && oldRep.activeCustody) {
        inv.items.forEach(it => {
          const cItem = oldRep.activeCustody.find(c => c.itemId === it.id || c.itemName === it.name);
          if (cItem) cItem.cartons = (Number(cItem.cartons) || 0) + Number(it.qty);
        });
        oldRep.currentCash = Math.max(0, (oldRep.currentCash || 0) - inv.paidAmount);
        oldRep.totalSales = Math.max(0, (oldRep.totalSales || 0) - inv.grandTotal);
        if (inv.remainingAmount > 0) {
          oldRep.assignedDebts = Math.max(0, (oldRep.assignedDebts || 0) - inv.remainingAmount);
        }
        if (window.FDB) window.FDB.updateDocument('reps', oldRep.id, oldRep);
      }
    } else {
      this.db.treasury = Math.max(0, (this.db.treasury || 0) - inv.paidAmount);
    }

    // B. Revert old customer impact
    if (inv.customerId) {
      const oldCust = (this.db.customers || []).find(c => c.id === inv.customerId);
      if (oldCust) {
        oldCust.totalPurchases = Math.max(0, (oldCust.totalPurchases || 0) - inv.grandTotal);
        oldCust.totalPaid = Math.max(0, (oldCust.totalPaid || 0) - inv.paidAmount);
        oldCust.currentDebt = Math.max(0, (oldCust.currentDebt || 0) - inv.remainingAmount);
        if (window.FDB) window.FDB.updateDocument('customers', oldCust.id, oldCust);
      }
    }

    // 2. APPLY NEW INVOICE IMPACT
    // Always deduct new items from warehouse stock
    this.editingInvoice.items.forEach(it => {
      const whItem = (this.db.items || []).find(i => i.id === it.id || i.name === it.name);
      if (whItem) {
        whItem.cartonsInStock = Math.max(0, (Number(whItem.cartonsInStock) || 0) - Number(it.qty));
        if (window.FDB) window.FDB.updateDocument('items', whItem.id, whItem);
      }
    });

    if (newSellerType === 'مندوب') {
      const newRep = (this.db.reps || []).find(r => r.name === newSellerName);
      if (newRep) {
        if (!newRep.activeCustody) newRep.activeCustody = [];
        this.editingInvoice.items.forEach(it => {
          let cItem = newRep.activeCustody.find(c => c.itemId === it.id || c.itemName === it.name);
          if (cItem) {
            cItem.cartons = Math.max(0, (Number(cItem.cartons) || 0) - Number(it.qty));
          }
        });
        newRep.currentCash = (newRep.currentCash || 0) + paid;
        newRep.totalSales = (newRep.totalSales || 0) + grandTotal;
        if (remaining > 0) {
          newRep.assignedDebts = (newRep.assignedDebts || 0) + remaining;
        }
        if (window.FDB) window.FDB.updateDocument('reps', newRep.id, newRep);
      }
    } else {
      this.db.treasury = (this.db.treasury || 0) + paid;
      if (paid > 0) {
        this.db.treasuryLogs.unshift({
          id: `TR-${Date.now().toString().slice(-4)}`,
          date: new Date().toLocaleString('ar-EG-u-nu-latn'),
          type: 'تعديل فاتورة مبيعات',
          sourceName: `${newCustName} (فاتورة #${inv.id})`,
          receivedBy: newSellerName,
          amount: paid,
          notes: `تحصيل نقدي بعد تعديل الفاتورة #${inv.id}`
        });
      }
    }

    // B. Apply new customer impact
    if (newCustId && newCust) {
      newCust.totalPurchases = (newCust.totalPurchases || 0) + grandTotal;
      newCust.totalPaid = (newCust.totalPaid || 0) + paid;
      newCust.currentDebt = (newCust.currentDebt || 0) + remaining;
      if (window.FDB) window.FDB.updateDocument('customers', newCust.id, newCust);
    }

    // 3. Update Invoice Object
    inv.date = newDate;
    inv.customerId = newCustId || null;
    inv.customerName = newCustName;
    inv.customerPhone = newPhone;
    inv.sellerType = newSellerType;
    inv.sellerName = newSellerName;
    inv.items = JSON.parse(JSON.stringify(this.editingInvoice.items));
    inv.grossTotal = grossTotal;
    inv.totalItemDiscounts = totalItemDiscounts;
    inv.subTotal = subtotal;
    inv.discount = discount;
    inv.grandTotal = grandTotal;
    inv.paidAmount = paid;
    inv.remainingAmount = remaining;
    inv.netProfit = netProfit;
    inv.warehouseStockDeducted = true;
    inv.paymentStatus = remaining > 0 ? (paid > 0 ? 'جزئي (أجل)' : 'أجل بالكامل') : 'مدفوع بالكامل';

    this.syncDB();
    if (window.FDB) {
      window.FDB.updateDocument('invoices', inv.id, inv);
      window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
    }
    this.closeModal();
    this.showToast(`تم حفظ وتحديث الفاتورة #${inv.id} بنجاح`);
    this.reconcileAllStats();
    this.renderCurrentPage();
  },

  async deleteInvoice(invoiceId) {
    if (!invoiceId) return;
    const cleanId = String(invoiceId).trim().replace(/^#/, '');
    const inv = (this.db.invoices || []).find(i => 
      String(i.id).trim() === cleanId || 
      String(i.id).trim().replace(/^#/, '') === cleanId
    );

    if (!inv) {
      this.showToast('لم يتم العثور على الفاتورة المراد حذفها', 'error');
      return;
    }

    const itemsCount = (inv.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const confirmed = await this.confirmDialog({
      title: `حذف الفاتورة #${inv.id}`,
      subtitle: 'إشعار تأكيد حذف الفاتورة وتسوية حساباتها',
      message: `هل أنت متأكد من حذف الفاتورة رقم #${inv.id} الخاصة بالعميل (${inv.customerName || 'عميل نقدي'})؟`,
      icon: '🧾',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">إجمالي الفاتورة:</span>
            <span class="value text-emerald">${this.formatMoney(inv.grandTotal || inv.total || 0)} ج.م</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">المسدد نقداً للخزينة:</span>
            <span class="value text-warning">${this.formatMoney(inv.paidAmount || 0)} ج.م</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">المتبقي (آجل / دين):</span>
            <span class="value text-rose">${this.formatMoney(inv.remainingAmount || 0)} ج.م</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">إجمالي الكميات:</span>
            <span class="value">${itemsCount} قروصة</span>
          </div>
        </div>
        <div class="confirm-warning-note">⚠️ إجراء أمان: سيتم تلقائياً استرجاع كميات الأصناف للمخزون وخصم المسدد من الخزينة وتسوية مديونية العميل.</div>
      `,
      confirmText: 'نعم، حذف وتسوية الفاتورة',
      cancelText: 'إلغاء'
    });

    if (!confirmed) {
      return;
    }

    const items = Array.isArray(inv.items) ? inv.items : [];
    const paidAmount = Number(inv.paidAmount) || 0;
    const remainingAmount = Number(inv.remainingAmount) || 0;
    const grandTotal = Number(inv.grandTotal) || 0;
    const isRep = inv.sellerType === 'مندوب' || (this.db.reps || []).some(r => r.name === inv.sellerName || r.id === inv.sellerId);

    // 1. Restore Stock (Always restore to main warehouse inventory)
    items.forEach(item => {
      const whItem = (this.db.items || []).find(i => i.id === item.id || i.name === item.name);
      if (whItem) {
        whItem.cartonsInStock = (Number(whItem.cartonsInStock) || 0) + (Number(item.qty) || 0);
        if (window.FDB) window.FDB.updateDocument('items', whItem.id, whItem);
      }
    });

    if (isRep) {
      const rep = (this.db.reps || []).find(r => r.name === inv.sellerName || r.id === inv.sellerId);
      if (rep) {
        if (!rep.activeCustody) rep.activeCustody = [];
        items.forEach(item => {
          const custItem = rep.activeCustody.find(c => c.itemId === item.id || c.itemName === item.name);
          if (custItem) {
            custItem.cartons = (Number(custItem.cartons) || 0) + (Number(item.qty) || 0);
          } else {
            rep.activeCustody.push({
              itemId: item.id,
              itemName: item.name,
              cartons: Number(item.qty) || 0,
              price: item.price || 0
            });
          }
        });
        if (paidAmount > 0) {
          rep.currentCash = Math.max(0, (Number(rep.currentCash) || 0) - paidAmount);
        }
        if (remainingAmount > 0) {
          rep.assignedDebts = Math.max(0, (Number(rep.assignedDebts) || 0) - remainingAmount);
        }
        rep.totalSales = Math.max(0, (Number(rep.totalSales) || 0) - grandTotal);
        if (window.FDB) window.FDB.updateDocument('reps', rep.id, rep);
      }
    } else {
      // Deduct paid amount from Main Treasury
      if (paidAmount > 0) {
        this.db.treasury = Math.max(0, (Number(this.db.treasury) || 0) - paidAmount);
        if (!this.db.treasuryLogs) this.db.treasuryLogs = [];
        this.db.treasuryLogs.unshift({
          id: `TR-${Date.now().toString().slice(-4)}`,
          date: new Date().toLocaleString('ar-EG-u-nu-latn'),
          type: 'إلغاء فاتورة مبيعات',
          sourceName: `${inv.customerName || 'عميل'} (إلغاء #${inv.id})`,
          receivedBy: this.db.currentUser?.name || 'حسام',
          amount: -paidAmount,
          notes: `إلغاء واسترجاع الفاتورة رقم #${inv.id}`
        });
      }
    }

    // 2. Adjust Customer balances if customer exists
    let customer = null;
    if (inv.customerId) {
      customer = (this.db.customers || []).find(c => c.id === inv.customerId);
    }
    if (!customer && inv.customerName && inv.customerName !== 'عميل نقدي عام') {
      customer = (this.db.customers || []).find(c => c.name === inv.customerName);
    }
    if (customer) {
      customer.totalPurchases = Math.max(0, (Number(customer.totalPurchases) || 0) - grandTotal);
      customer.totalPaid = Math.max(0, (Number(customer.totalPaid) || 0) - paidAmount);
      customer.currentDebt = Math.max(0, (Number(customer.currentDebt) || 0) - remainingAmount);
    }

    // 3. Remove Invoice from Database
    this.db.invoices = (this.db.invoices || []).filter(i => 
      String(i.id).trim() !== String(inv.id).trim() && 
      String(i.id).trim().replace(/^#/, '') !== cleanId
    );

    // 4. Add Notification
    this.addNotification({
      title: `حذف الفاتورة #${inv.id}`,
      desc: `تم حذف الفاتورة رقم #${inv.id} بقيمة ${this.formatMoney(grandTotal)} ج.م واسترجاع الكميات للمخزون`,
      type: 'alert'
    });

    this.syncDB();
    if (window.FDB) {
      window.FDB.deleteDocument('invoices', inv.id);
      if (customer) window.FDB.updateDocument('customers', customer.id, customer);
      items.forEach(item => {
        const dbItem = this.db.items.find(i => i.id === item.id);
        if (dbItem) window.FDB.updateDocument('items', dbItem.id, dbItem);
      });
      window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
    }
    this.closeModal();
    this.showToast(`تم حذف الفاتورة #${inv.id} واسترجاع المخزون بنجاح`);
    this.reconcileAllStats();
    this.renderCurrentPage();
  },

  // ==========================================
  // TREASURY RECEIPTS MANAGEMENT (PREVIEW, EDIT, DELETE, ADD, PRINT)
  // ==========================================
  numberToArabicWords(num) {
    const units = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

    num = Math.floor(Math.abs(Number(num) || 0));
    if (num === 0) return 'صفر';

    const convertGroup = (n) => {
      let str = '';
      const h = Math.floor(n / 100);
      const rem = n % 100;
      if (h > 0) str += hundreds[h];
      if (rem > 0) {
        if (str) str += ' و ';
        if (rem < 20) {
          str += units[rem];
        } else {
          const u = rem % 10;
          const t = Math.floor(rem / 10);
          if (u > 0) str += units[u] + ' و ';
          str += tens[t];
        }
      }
      return str;
    };

    if (num < 1000) return convertGroup(num);
    if (num < 1000000) {
      const th = Math.floor(num / 1000);
      const rem = num % 1000;
      let thStr = '';
      if (th === 1) thStr = 'ألف';
      else if (th === 2) thStr = 'ألفان';
      else if (th >= 3 && th <= 10) thStr = convertGroup(th) + ' آلاف';
      else thStr = convertGroup(th) + ' ألف';

      if (rem > 0) return thStr + ' و ' + convertGroup(rem);
      return thStr;
    }
    const mil = Math.floor(num / 1000000);
    const remMil = num % 1000000;
    let milStr = mil === 1 ? 'مليون' : (mil === 2 ? 'مليونان' : convertGroup(mil) + ' ملايين');
    if (remMil > 0) return milStr + ' و ' + this.numberToArabicWords(remMil);
    return milStr;
  },

  getReceiptDebtInfo(log) {
    if (!log) return null;

    let customer = null;
    if (log.customerId) {
      customer = (this.db.customers || []).find(c => c.id === log.customerId);
    }
    if (!customer && log.sourceName) {
      const cleanSource = log.sourceName.split('(')[0].trim();
      customer = (this.db.customers || []).find(c => 
        c.name === log.sourceName || 
        c.name.includes(cleanSource) || 
        log.sourceName.includes(c.name)
      );
    }

    const hasStoredDebt = (log.remainingDebt !== undefined && log.remainingDebt !== null);
    const isCustomerReceipt = (log.type && (log.type.includes('عميل') || log.type.includes('سند')));

    if (!customer && !hasStoredDebt && !isCustomerReceipt) {
      return null;
    }

    let remainingDebt = 0;
    if (hasStoredDebt) {
      remainingDebt = Number(log.remainingDebt);
    } else if (customer) {
      remainingDebt = Number(customer.currentDebt || 0);
    }

    let previousDebt = 0;
    if (log.previousDebt !== undefined && log.previousDebt !== null) {
      previousDebt = Number(log.previousDebt);
    } else {
      previousDebt = remainingDebt + Number(log.amount || 0);
    }

    return {
      customer,
      previousDebt,
      remainingDebt
    };
  },

  getReceiptCustomerPhone(log) {
    let phone = '';
    let customer = null;

    if (log.customerPhone) {
      phone = log.customerPhone;
    }

    if (!phone && log.customerId) {
      customer = (this.db.customers || []).find(c => c.id === log.customerId);
      if (customer && customer.phone) phone = customer.phone;
    }

    if (!phone && log.sourceName) {
      const cleanSource = log.sourceName.split('(')[0].trim();
      customer = (this.db.customers || []).find(c => 
        c.name === log.sourceName || 
        c.name.includes(cleanSource) || 
        log.sourceName.includes(c.name)
      );
      if (customer && customer.phone) phone = customer.phone;
    }

    if (!phone) {
      const rep = (this.db.reps || []).find(r => log.sourceName && log.sourceName.includes(r.name));
      if (rep && rep.phone) phone = rep.phone;
    }

    return { phone, customer };
  },

  viewReceiptModal(receiptId) {
    const log = (this.db.treasuryLogs || []).find(l => l.id === receiptId);
    if (!log) {
      this.showToast('لم يتم العثور على سند القبض', 'error');
      return;
    }

    const arabicWords = this.numberToArabicWords(log.amount);
    const debtInfo = this.getReceiptDebtInfo(log);

    const modalHtml = `
      <div class="modal-header">
        <h3>🏦 تفاصيل سند القبض #${log.id}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="background: #f8fafc; padding: 25px;">
        <div id="view-receipt-capture" class="receipt-wrapper" style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 2px solid #0f172a; border-radius: 8px; padding: 24px; color: #0f172a; font-family: 'Cairo', sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 15px;">
            <div style="font-size: 1.25rem; font-weight: 900; color: #0f172a;">${this.db.settings.businessName}</div>
            <div style="font-size: 0.85rem; color: #475569; margin-top: 3px;">سجل تجاري وبطاقة ضريبية - تجارة وتوزيع بالجملة</div>
            <div style="font-size: 0.8rem; color: #64748b;">${this.db.settings.address} - هاتف: ${this.db.settings.phone}</div>
          </div>

          <!-- Title Badge -->
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="display: inline-block; background: #0f172a; color: #ffffff; padding: 6px 24px; border-radius: 20px; font-weight: 800; font-size: 1.05rem; letter-spacing: 0.5px;">
              سند قبض نقدية / توريد خزينة
            </div>
          </div>

          <!-- Details Grid -->
          <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 0.88rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px;">
            <div><strong>رقم السند:</strong> <span style="font-family: monospace; font-size: 1rem; color: #0284c7; font-weight: bold;">#${log.id}</span></div>
            <div><strong>التاريخ:</strong> <span>${log.date}</span></div>
          </div>

          <div style="margin-bottom: 12px; font-size: 0.92rem; line-height: 1.8;">
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <span style="font-weight: bold; min-width: 130px; color: #334155;">استلمنا من السيد /</span>
              <span style="flex: 1; border-bottom: 1px dotted #94a3b8; font-weight: 800; font-size: 1rem; color: #0f172a;">${log.sourceName}</span>
            </div>
            <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 6px;">
              <span style="font-weight: bold; min-width: 130px; color: #334155;">المستلم / المسؤول:</span>
              <span style="flex: 1; border-bottom: 1px dotted #94a3b8; font-weight: 700; color: #0f172a;">${log.receivedBy || 'الإدارة (الرئيسية)'}</span>
            </div>
            <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 6px;">
              <span style="font-weight: bold; min-width: 130px; color: #334155;">نوع السند / الحركة:</span>
              <span style="flex: 1; border-bottom: 1px dotted #94a3b8; font-weight: 700; color: #059669;">${log.type}</span>
            </div>
          </div>

          <!-- Amount Box -->
          <div style="background: #f0fdf4; border: 2px dashed #059669; border-radius: 8px; padding: 12px 16px; margin: 16px 0 10px 0; text-align: center;">
            <div style="font-size: 0.82rem; color: #166534; font-weight: bold; margin-bottom: 2px;">المبلغ المسدد نقداً</div>
            <div style="font-size: 1.6rem; font-weight: 900; color: #15803d; font-family: 'JetBrains Mono', monospace;">
              ${this.formatMoney(log.amount)} ج.م
            </div>
            <div style="font-size: 0.85rem; color: #374151; font-weight: bold; margin-top: 4px;">
              فقط ${arabicWords} جنيه مصري لا غير
            </div>
          </div>

          ${debtInfo ? `
          <!-- Debt Summary Box -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0 16px 0;">
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; text-align: center;">
              <div style="font-size: 0.78rem; color: #64748b; font-weight: bold;">الدين السابق قبل السداد</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: #475569; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
                ${this.formatMoney(debtInfo.previousDebt)} ج.م
              </div>
            </div>
            <div style="background: rgba(239, 68, 68, 0.08); border: 1.5px solid #ef4444; border-radius: 8px; padding: 10px 12px; text-align: center;">
              <div style="font-size: 0.82rem; color: #b91c1c; font-weight: 800;">المتبقي من الدين بعد السداد</div>
              <div style="font-size: 1.3rem; font-weight: 900; color: #dc2626; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
                ${this.formatMoney(debtInfo.remainingDebt)} ج.م
              </div>
            </div>
          </div>
          ` : ''}

          <!-- Notes -->
          <div style="margin-bottom: 20px; font-size: 0.9rem;">
            <span style="font-weight: bold; color: #334155;">وذلك عن (البيان):</span>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-top: 4px; color: #1e293b; font-weight: 600;">
              ${log.notes || 'تحصيل نقدي مقبوض بالخزينة'}
            </div>
          </div>

          <!-- Signatures -->
          <div style="display: flex; justify-content: space-between; margin-top: 25px; padding-top: 15px; border-top: 1px solid #cbd5e1; text-align: center; font-size: 0.85rem;">
            <div>
              <div style="font-weight: bold; color: #475569; margin-bottom: 30px;">توقيع / ختم المستلم</div>
              <div style="border-top: 1px dotted #94a3b8; width: 140px; margin: 0 auto; color: #64748b;">${log.receivedBy || 'الخزينة العامة'}</div>
            </div>
            <div>
              <div style="font-weight: bold; color: #475569; margin-bottom: 30px;">توقيع المودع / المسدد</div>
              <div style="border-top: 1px dotted #94a3b8; width: 140px; margin: 0 auto; color: #64748b;">${log.sourceName ? log.sourceName.split('(')[0].trim() : 'المسدد'}</div>
            </div>
          </div>

          <div style="text-align: center; font-size: 0.72rem; color: #94a3b8; margin-top: 18px;">
            تم الإصدار بواسطة نظام Hossam ERP المتكامل
          </div>
        </div>
      </div>

      <div class="modal-footer" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-success" onclick="App.shareReceiptWhatsApp('${log.id}')" style="background: #25D366; border-color: #25D366; color: #fff; font-weight: bold; display: flex; align-items: center; gap: 6px;">
            ${this.getWhatsAppIconSvg(18)}
            <span>إرسال صورة السند عبر واتساب</span>
          </button>
          <button class="btn btn-blue" onclick="App.downloadReceiptVoucherImage('${log.id}')">
            <span>📥</span> تنزيل السند كصورة
          </button>
          <button class="btn btn-secondary" onclick="App.printReceiptVoucher('${log.id}')">
            <span>🖨️</span> طباعة
          </button>
          <button class="btn btn-primary" onclick="App.openEditReceiptModal('${log.id}')">
            <span>✏️</span> تعديل السند
          </button>
          <button class="btn btn-danger" onclick="App.deleteReceipt('${log.id}')">
            <span>🗑️</span> حذف السند
          </button>
        </div>
        <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
      </div>
    `;

    this.openModal(modalHtml, '650px');
  },

  openEditReceiptModal(receiptId) {
    const log = (this.db.treasuryLogs || []).find(l => l.id === receiptId);
    if (!log) {
      this.showToast('لم يتم العثور على سند القبض', 'error');
      return;
    }

    const modalHtml = `
      <div class="modal-header">
        <h3><span>✏️</span> تعديل سند القبض #${log.id}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 16px;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">رقم السند (غير قابل للتعديل)</label>
            <input type="text" class="form-control" value="${log.id}" disabled style="background: rgba(255,255,255,0.05); color: var(--gold); font-weight: bold; font-family: monospace;">
          </div>
          <div class="form-group">
            <label class="form-label">تاريخ ووقت السند *</label>
            <input type="text" id="edit-receipt-date" class="form-control" value="${log.date}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">نوع التوريد / السند *</label>
            <select id="edit-receipt-type" class="custom-select">
              <option value="سند قبض عميل" ${log.type === 'سند قبض عميل' ? 'selected' : ''}>سند قبض عميل</option>
              <option value="توريد نقدية مندوب" ${log.type === 'توريد نقدية مندوب' ? 'selected' : ''}>توريد نقدية مندوب</option>
              <option value="تغذية رأس المال" ${log.type === 'تغذية رأس المال' ? 'selected' : ''}>تغذية رأس المال</option>
              <option value="مبيعات نقدية (فاتورة)" ${log.type === 'مبيعات نقدية (فاتورة)' ? 'selected' : ''}>مبيعات نقدية (فاتورة)</option>
              <option value="أخرى" ${log.type === 'أخرى' ? 'selected' : ''}>أخرى / إيداع متنوع</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">المبلغ المودع (ج.م) *</label>
            <input type="number" id="edit-receipt-amount" class="form-control" value="${log.amount}" min="1" style="color: var(--emerald); font-weight: bold; font-size: 1.1rem;">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">المصدر / العميل / المودع *</label>
            <input type="text" id="edit-receipt-source" class="form-control" value="${log.sourceName}" placeholder="اسم العميل أو المندوب">
          </div>
          <div class="form-group">
            <label class="form-label">المستلم / المسؤول *</label>
            <input type="text" id="edit-receipt-receiver" class="form-control" value="${log.receivedBy || (this.db.currentUser ? this.db.currentUser.name : 'حسام')}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">البيان والملاحظات</label>
          <textarea id="edit-receipt-notes" class="form-control" rows="3">${log.notes || ''}</textarea>
        </div>

        <div style="background: rgba(14, 165, 233, 0.1); border: 1px solid var(--blue-neon); padding: 12px; border-radius: var(--radius-md); font-size: 0.85rem; color: var(--cyan);">
          ℹ️ <strong>تنبيه مالي:</strong> عند تعديل المبلغ، سيقوم النظام تلقائياً بتحديث رصيد الخزينة وتعديل حساب العميل أو المندوب المعني بفارق المبلغ.
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveEditReceipt('${log.id}')">💾 حفظ تعديلات السند</button>
      </div>
    `;

    this.openModal(modalHtml, '600px');
  },

  saveEditReceipt(receiptId) {
    const log = (this.db.treasuryLogs || []).find(l => l.id === receiptId);
    if (!log) return;

    const newDate = document.getElementById('edit-receipt-date')?.value.trim() || log.date;
    const newType = document.getElementById('edit-receipt-type')?.value || log.type;
    const newAmount = Number(document.getElementById('edit-receipt-amount')?.value) || 0;
    const newSource = document.getElementById('edit-receipt-source')?.value.trim() || log.sourceName;
    const newReceiver = document.getElementById('edit-receipt-receiver')?.value.trim() || log.receivedBy;
    const newNotes = document.getElementById('edit-receipt-notes')?.value.trim() || log.notes;

    if (newAmount <= 0) {
      this.showToast('يرجى إدخال مبلغ صحيح أكبر من الصفر', 'error');
      return;
    }

    const diff = newAmount - log.amount;

    // 1. Adjust Treasury Balance
    this.db.treasury = Math.max(0, (this.db.treasury || 0) + diff);

    // 2. Adjust Customer (if was/is customer receipt)
    const cust = (this.db.customers || []).find(c => log.sourceName.includes(c.name) || newSource.includes(c.name));
    if (cust) {
      cust.totalPaid = Math.max(0, (cust.totalPaid || 0) + diff);
      cust.currentDebt = Math.max(0, (cust.currentDebt || 0) - diff);
    }

    // 3. Adjust Rep (if was/is rep supply)
    const rep = (this.db.reps || []).find(r => log.sourceName.includes(r.name) || newSource.includes(r.name));
    if (rep) {
      rep.totalSupplied = Math.max(0, (rep.totalSupplied || 0) + diff);
      rep.currentCash = Math.max(0, (rep.currentCash || 0) - diff);
    }

    // 4. Update Log
    log.date = newDate;
    log.type = newType;
    log.amount = newAmount;
    log.sourceName = newSource;
    log.receivedBy = newReceiver;
    log.notes = newNotes;

    this.syncDB();
    this.closeModal();
    this.showToast(`تم تعديل سند القبض #${log.id} وتحديث الأرصدة بنجاح`);
    this.renderCurrentPage();
  },

  async deleteReceipt(receiptId) {
    const log = (this.db.treasuryLogs || []).find(l => l.id === receiptId);
    if (!log) return;

    const confirmed = await this.confirmDialog({
      title: `حذف سند القبض #${log.id}`,
      subtitle: 'إشعار تأكيد حذف سند القبض وتسوية الخزينة',
      message: `هل أنت متأكد من حذف سند القبض رقم #${log.id} بقيمة ${this.formatMoney(log.amount)} ج.م؟`,
      icon: '📄',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">قيمة السند:</span>
            <span class="value text-rose">${this.formatMoney(log.amount)} ج.م</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">الجهة / المصدر:</span>
            <span class="value">${log.sourceName || 'غير محدد'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">مستلم المبلغ:</span>
            <span class="value">${log.receivedBy || 'حسام'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">تاريخ السند:</span>
            <span class="value">${log.date || '—'}</span>
          </div>
        </div>
        <div class="confirm-warning-note">⚠️ سيتم تلقائياً خصم هذا المبلغ من الخزينة وإعادة قيد المبلغ كمديونية على حساب العميل أو المندوب.</div>
      `,
      confirmText: 'نعم، حذف السند والتسوية',
      cancelText: 'إلغاء'
    });

    if (!confirmed) {
      return;
    }

    // 1. Revert Treasury
    this.db.treasury = Math.max(0, (this.db.treasury || 0) - log.amount);

    // 2. Revert Customer (re-add debt)
    const cust = (this.db.customers || []).find(c => log.sourceName.includes(c.name));
    if (cust) {
      cust.totalPaid = Math.max(0, (cust.totalPaid || 0) - log.amount);
      cust.currentDebt = (cust.currentDebt || 0) + log.amount;
    }

    // 3. Revert Rep (restore cash)
    const rep = (this.db.reps || []).find(r => log.sourceName.includes(r.name));
    if (rep) {
      rep.totalSupplied = Math.max(0, (rep.totalSupplied || 0) - log.amount);
      rep.currentCash = (rep.currentCash || 0) + log.amount;
    }

    // 4. Remove log
    this.db.treasuryLogs = this.db.treasuryLogs.filter(l => l.id !== receiptId);

    // 5. Add Notification
    this.addNotification({
      title: `حذف سند قبض #${log.id}`,
      desc: `تم حذف سند القبض رقم #${log.id} بقيمة ${this.formatMoney(log.amount)} ج.م وتسوية الحسابات`,
      type: 'alert'
    });

    this.syncDB();
    if (window.FDB) {
      window.FDB.deleteDocument('treasury', log.id);
      if (cust) window.FDB.updateDocument('customers', cust.id, cust);
      if (rep) window.FDB.updateDocument('reps', rep.id, rep);
      window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
    }
    this.closeModal();
    this.showToast(`تم حذف سند القبض #${log.id} وتسوية الأرصدة بنجاح`);
    this.renderCurrentPage();
  },

  openNewTreasuryReceiptModal() {
    const receiptNo = `TR-${Date.now().toString().slice(-4)}`;
    const customersOptions = (this.db.customers || []).map(c => 
      `<option value="cust_${c.id}">${c.name} (دين حالي: ${this.formatMoney(c.currentDebt)} ج.م)</option>`
    ).join('');

    const repsOptions = (this.db.reps || []).map(r => 
      `<option value="rep_${r.id}">مندوب: ${r.name} (نقدية حالية: ${this.formatMoney(r.currentCash)} ج.م)</option>`
    ).join('');

    const modalHtml = `
      <div class="modal-header">
        <h3><span>➕</span> تسجيل سند قبض نقدية جديد</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 16px;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">رقم السند</label>
            <input type="text" class="form-control" value="${receiptNo}" disabled style="background: rgba(255,255,255,0.05); color: var(--gold); font-weight: bold; font-family: monospace;">
          </div>
          <div class="form-group">
            <label class="form-label">نوع التوريد *</label>
            <select id="new-rec-type" class="custom-select" onchange="App.onNewReceiptTypeChange(this.value)">
              <option value="سند قبض عميل">سند قبض عميل</option>
              <option value="توريد نقدية مندوب">توريد نقدية مندوب</option>
              <option value="تغذية رأس المال">تغذية رأس المال (إيداع حر)</option>
              <option value="أخرى">أخرى / متنوع</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" id="new-rec-source-select-wrap">
            <label class="form-label">العميل / المصدر *</label>
            <select id="new-rec-source-select" class="custom-select">
              <option value="">-- اختر العميل --</option>
              ${customersOptions}
            </select>
          </div>
          <div class="form-group" id="new-rec-source-text-wrap" style="display: none;">
            <label class="form-label">اسم المصدر / المودع *</label>
            <input type="text" id="new-rec-source-text" class="form-control" placeholder="اسم الجهة أو الشخص">
          </div>
          <div class="form-group">
            <label class="form-label">المبلغ المودع (ج.م) *</label>
            <input type="number" id="new-rec-amount" class="form-control" placeholder="0.00" min="1" style="color: var(--emerald); font-weight: bold; font-size: 1.1rem;">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">المستلم / أمين الخزينة *</label>
            <input type="text" id="new-rec-receiver" class="form-control" value="${this.db.currentUser ? this.db.currentUser.name : 'حسام'}">
          </div>
          <div class="form-group">
            <label class="form-label">إيداع في الخزينة</label>
            <input type="text" class="form-control" value="الخزينة الرئيسية" disabled style="background: rgba(255,255,255,0.05);">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">البيان والملاحظات</label>
          <input type="text" id="new-rec-notes" class="form-control" placeholder="دفعة نقدية من الحساب / توريد">
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-emerald" onclick="App.saveNewTreasuryReceipt('${receiptNo}')">✓ حفظ وإيداع السند بالخزينة</button>
      </div>
    `;

    this.openModal(modalHtml, '620px');
  },

  onNewReceiptTypeChange(val) {
    const selectWrap = document.getElementById('new-rec-source-select-wrap');
    const selectEl = document.getElementById('new-rec-source-select');
    const textWrap = document.getElementById('new-rec-source-text-wrap');

    if (val === 'سند قبض عميل') {
      if (selectWrap) selectWrap.style.display = 'block';
      if (textWrap) textWrap.style.display = 'none';
      if (selectEl) {
        selectEl.innerHTML = '<option value="">-- اختر العميل --</option>' + (this.db.customers || []).map(c => 
          `<option value="cust_${c.id}">${c.name} (دين: ${this.formatMoney(c.currentDebt)})</option>`
        ).join('');
      }
    } else if (val === 'توريد نقدية مندوب') {
      if (selectWrap) selectWrap.style.display = 'block';
      if (textWrap) textWrap.style.display = 'none';
      if (selectEl) {
        selectEl.innerHTML = '<option value="">-- اختر المندوب --</option>' + (this.db.reps || []).map(r => 
          `<option value="rep_${r.id}">مندوب: ${r.name} (عهدة نقدية: ${this.formatMoney(r.currentCash)})</option>`
        ).join('');
      }
    } else {
      if (selectWrap) selectWrap.style.display = 'none';
      if (textWrap) textWrap.style.display = 'block';
    }
  },

  saveNewTreasuryReceipt(receiptNo) {
    const type = document.getElementById('new-rec-type')?.value;
    const amount = Number(document.getElementById('new-rec-amount')?.value) || 0;
    const receiver = document.getElementById('new-rec-receiver')?.value.trim() || (this.db.currentUser ? this.db.currentUser.name : 'حسام');
    const notes = document.getElementById('new-rec-notes')?.value.trim() || 'سند قبض بالخزينة';

    if (amount <= 0) {
      this.showToast('يرجى تحديد مبلغ إيداع صحيح', 'error');
      return;
    }

    let sourceName = '';
    let customerId = null;
    let customerPhone = '';
    let previousDebt = 0;
    let remainingDebt = 0;

    if (type === 'سند قبض عميل' || type === 'توريد نقدية مندوب') {
      const select = document.getElementById('new-rec-source-select');
      const val = select?.value;
      if (!val) {
        this.showToast('يرجى اختيار العميل أو المندوب', 'error');
        return;
      }
      if (val.startsWith('cust_')) {
        const custId = val.replace('cust_', '');
        const cust = (this.db.customers || []).find(c => c.id === custId);
        if (cust) {
          sourceName = cust.name;
          customerId = cust.id;
          customerPhone = cust.phone || '';
          previousDebt = cust.currentDebt || 0;
          cust.totalPaid = (cust.totalPaid || 0) + amount;
          cust.currentDebt = Math.max(0, previousDebt - amount);
          remainingDebt = cust.currentDebt;
        }
      } else if (val.startsWith('rep_')) {
        const repId = val.replace('rep_', '');
        const rep = (this.db.reps || []).find(r => r.id === repId);
        if (rep) {
          sourceName = `${rep.name} (مندوب)`;
          rep.currentCash = Math.max(0, (rep.currentCash || 0) - amount);
          rep.totalSupplied = (rep.totalSupplied || 0) + amount;
        }
      }
    } else {
      sourceName = document.getElementById('new-rec-source-text')?.value.trim() || (type === 'تغذية رأس المال' ? `${this.db.settings.ownerName} (المالك)` : 'إيداع متنوع');
    }

    // 1. Add to Treasury
    this.db.treasury = (this.db.treasury || 0) + amount;

    // 2. Add to Treasury Logs
    const logItem = {
      id: receiptNo,
      date: new Date().toLocaleString('ar-EG-u-nu-latn'),
      type: type,
      sourceName: sourceName,
      receivedBy: receiver,
      amount: amount,
      notes: notes
    };
    if (customerId) {
      logItem.customerId = customerId;
      logItem.customerPhone = customerPhone;
      logItem.previousDebt = previousDebt;
      logItem.remainingDebt = remainingDebt;
    }
    this.db.treasuryLogs.unshift(logItem);

    // 3. Add Notification
    this.addNotification({
      title: `سند قبض جديد #${receiptNo}`,
      desc: `تم تسجيل سند قبض وتوريد خزينة بقيمة ${this.formatMoney(amount)} ج.م من ${sourceName}` + (customerId ? ` - المتبقي: ${this.formatMoney(remainingDebt)} ج.م` : ''),
      type: 'payment'
    });

    this.syncDB();
    if (window.FDB) {
      window.FDB.addDocument('treasury', logItem);
      window.FDB.setDocument('settings', 'capital', { capital: this.db.capital, treasury: this.db.treasury });
      if (customerId) {
        const cust = (this.db.customers || []).find(c => c.id === customerId);
        if (cust) window.FDB.updateDocument('customers', cust.id, cust);
      }
      const select = document.getElementById('new-rec-source-select');
      const val = select?.value;
      if (val && val.startsWith('rep_')) {
        const repId = val.replace('rep_', '');
        const rep = (this.db.reps || []).find(r => r.id === repId);
        if (rep) window.FDB.updateDocument('reps', rep.id, rep);
      }
    }
    this.closeModal();
    this.showToast(`تم تسجيل سند القبض #${receiptNo} بنجاح وإيداع ${this.formatMoney(amount)} ج.م بالخزينة`);
    this.renderReports();
    this.renderCurrentPage();
    this.updateLiveSidebarStats();
    this.viewReceiptModal(receiptNo);
  },

  renderReceiptToCanvas(receiptId) {
    const log = (this.db.treasuryLogs || []).find(l => l.id === receiptId);
    if (!log) return null;

    const debtInfo = this.getReceiptDebtInfo(log);
    const hasDebt = !!debtInfo;

    const arabicWords = this.numberToArabicWords(log.amount);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const width = 580;
    const height = hasDebt ? 600 : 520;

    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Double Border
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, width - 24, height - 24);
    ctx.lineWidth = 1;
    ctx.strokeRect(18, 18, width - 36, height - 36);

    // Header
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px Cairo, sans-serif';
    ctx.fillText(this.db.settings.businessName || 'مؤسسة حسام لتجارة وتوزيع السجاير بالجملة', width / 2, 55);

    ctx.font = '12px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('سجل تجاري وبطاقة ضريبية - تجارة وتوزيع بالجملة', width / 2, 78);
    ctx.fillText(`${this.db.settings.address || 'العنوان الرئيسي'} - هاتف: ${this.db.settings.phone || '01012345678'}`, width / 2, 98);

    // Title badge
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(width / 2 - 130, 115, 260, 34, [17]);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Cairo, sans-serif';
    ctx.fillText('سند قبض نقدية / توريد خزينة', width / 2, 138);

    // Receipt Meta
    let currentY = 180;
    ctx.font = 'bold 13px Cairo, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'right';
    ctx.fillText(`رقم السند: #${log.id}`, width - 35, currentY);
    ctx.textAlign = 'left';
    ctx.fillText(`التاريخ: ${log.date}`, 35, currentY);

    // Separator
    currentY += 15;
    ctx.strokeStyle = '#cbd5e1';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(35, currentY);
    ctx.lineTo(width - 35, currentY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Info rows
    currentY += 30;
    ctx.textAlign = 'right';
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('استلمنا من السيد / الجهة:', width - 35, currentY);
    ctx.font = 'bold 14px Cairo, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(log.sourceName || '', width - 175, currentY);

    currentY += 28;
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('المستلم / المسؤول:', width - 35, currentY);
    ctx.font = 'bold 14px Cairo, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(log.receivedBy || 'الإدارة', width - 150, currentY);

    currentY += 28;
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('نوع الحركة / السند:', width - 35, currentY);
    ctx.font = 'bold 14px Cairo, sans-serif';
    ctx.fillStyle = '#059669';
    ctx.fillText(log.type, width - 150, currentY);

    // Amount Box
    currentY += 22;
    ctx.fillStyle = '#f0fdf4';
    ctx.fillRect(35, currentY, width - 70, 58);
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(35, currentY, width - 70, 58);

    ctx.fillStyle = '#15803d';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.formatMoney(log.amount)} ج.م`, width / 2, currentY + 28);

    ctx.fillStyle = '#166534';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillText(`فقط ${arabicWords} جنيه مصري لا غير`, width / 2, currentY + 48);

    // Debt Info Box (Previous & Remaining Debt)
    if (hasDebt) {
      currentY += 68;
      const boxW = (width - 80) / 2;

      // Previous Debt
      const prevX = 35;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(prevX, currentY, boxW, 52);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(prevX, currentY, boxW, 52);

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 11px Cairo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('الدين السابق قبل السداد', prevX + boxW / 2, currentY + 19);

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.fillText(`${this.formatMoney(debtInfo.previousDebt)} ج.م`, prevX + boxW / 2, currentY + 39);

      // Remaining Debt (Prominent Red)
      const remX = 35 + boxW + 10;
      ctx.fillStyle = '#fef2f2';
      ctx.fillRect(remX, currentY, boxW, 52);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(remX, currentY, boxW, 52);

      ctx.fillStyle = '#b91c1c';
      ctx.font = 'bold 12px Cairo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('المتبقي من الدين بعد السداد', remX + boxW / 2, currentY + 19);

      ctx.fillStyle = '#dc2626';
      ctx.font = 'bold 16px "JetBrains Mono", monospace';
      ctx.fillText(`${this.formatMoney(debtInfo.remainingDebt)} ج.م`, remX + boxW / 2, currentY + 40);

      currentY += 60;
    } else {
      currentY += 72;
    }

    // Notes
    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillText('وذلك عن (البيان):', width - 35, currentY);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Cairo, sans-serif';
    ctx.fillText(log.notes || 'تحصيل نقدي مقبوض بالخزينة', width - 140, currentY);

    // Signatures
    currentY += 45;
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(35, currentY);
    ctx.lineTo(width - 35, currentY);
    ctx.stroke();

    currentY += 20;
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    ctx.fillText('توقيع / ختم المستلم', width - 120, currentY);
    ctx.fillText('توقيع المودع / المسدد', 120, currentY);

    currentY += 25;
    ctx.font = '11px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(log.receivedBy || 'الخزينة العامة', width - 120, currentY);
    ctx.fillText(log.sourceName ? log.sourceName.split('(')[0].trim() : 'المسدد', 120, currentY);

    return canvas;
  },

  downloadReceiptVoucherImage(receiptId) {
    const canvas = this.renderReceiptToCanvas(receiptId);
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `سند_قبض_${receiptId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    this.showToast(`تم تنزيل سند القبض #${receiptId} كصورة بنجاح`);
  },

  printReceiptVoucher(receiptId) {
    const canvas = this.renderReceiptToCanvas(receiptId);
    if (!canvas) return;
    const imgData = canvas.toDataURL('image/png');
    const printWin = window.open('', '_blank');
    if (!printWin) {
      this.showToast('يرجى السماح بالنوافذ المنبثقة للطباعة', 'warning');
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>طباعة سند قبض #${receiptId}</title>
        <style>
          @page { size: auto; margin: 10mm; }
          body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        <img src="${imgData}" onload="window.print();window.close();">
      </body>
      </html>
    `);
    printWin.document.close();
  },

  shareReceiptWhatsApp(receiptId) {
    const log = (this.db.treasuryLogs || []).find(l => l.id === receiptId);
    if (!log) {
      this.showToast('لم يتم العثور على سند القبض', 'error');
      return;
    }

    this.showToast('جاري تجهيز صورة سند القبض للمشاركة عبر واتساب... ⏳', 'info');

    const debtInfo = this.getReceiptDebtInfo(log);
    const phoneInfo = this.getReceiptCustomerPhone(log);
    const rawPhone = phoneInfo.phone || '';
    let cleanPhone = rawPhone ? String(rawPhone).replace(/[^0-9]/g, '') : '';
    if (cleanPhone.startsWith('01')) {
      cleanPhone = '2' + cleanPhone;
    }

    const canvas = this.renderReceiptToCanvas(receiptId);
    if (!canvas) {
      this.showToast('تعذر توليد صورة سند القبض', 'error');
      return;
    }

    const fileName = `سند_قبض_${log.id}.png`;

    canvas.toBlob(async (blob) => {
      if (!blob) {
        this.showToast('حدث خطأ أثناء معالجة ملف الصورة', 'error');
        return;
      }

      const file = new File([blob], fileName, { type: 'image/png' });

      // 1. مشاركة الملف مباشرة إذا كان المتصفح يدعم Web Share API
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `سند قبض #${log.id}`,
            text: `سند قبض #${log.id} - ${log.sourceName}`
          });
          this.showToast('تم فتح واتساب لمشاركة صورة سند القبض 📸');
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('Web Share API error:', err);
        }
      }

      // 2. كمبيوتر / واتساب ويب:
      // أ. نسخ الصورة مباشرة إلى الحافظة (Clipboard) لتلصق بـ Ctrl+V فوراً في المحادثة
      let copiedToClipboard = false;
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          copiedToClipboard = true;
        }
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }

      // ب. تنزيل ملف الصورة تلقائياً على الجهاز
      try {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
      } catch (e) {
        console.warn('Direct download error:', e);
      }

      // ج. فتح محادثة العميل أو واتساب ويب
      if (cleanPhone) {
        window.open(`https://wa.me/${cleanPhone}`, '_blank');
      } else {
        window.open('https://web.whatsapp.com/', '_blank');
      }

      // د. إظهار نافذة إرشادية وتأكيد
      this.showWhatsAppReceiptGuideModal(log, debtInfo, copiedToClipboard, cleanPhone, rawPhone);

    }, 'image/png');
  },

  showWhatsAppReceiptGuideModal(log, debtInfo, copiedToClipboard, cleanPhone, rawPhone) {
    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #25D366;">${this.getWhatsAppIconSvg(22)}</span> 
          <span>إرسال صورة سند القبض #${log.id} عبر واتساب</span>
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="text-align: center; padding: 22px 18px; gap: 14px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(37, 211, 102, 0.15); border: 2px solid #25D366; display: flex; align-items: center; justify-content: center; margin: 0 auto; color: #25D366; font-size: 1.8rem;">
          📸
        </div>
        <h3 style="color: var(--text-white); font-weight: 800; margin: 0; font-size: 1.15rem;">
          ${copiedToClipboard ? 'تم نسخ صورة السند تلقائياً وتنزيلها!' : 'تم تجهيز وتنزيل صورة سند القبض بنجاح!'}
        </h3>
        <p style="color: var(--text-secondary); font-size: 0.92rem; line-height: 1.6; margin: 0;">
          ${copiedToClipboard 
            ? '👉 بعد فتح محادثة العميل في واتساب، اضغط <strong style="color: #25D366; background: rgba(255,255,255,0.08); padding: 2px 7px; border-radius: 4px; font-family: monospace;">Ctrl + V</strong> (أو كليك يمين ثم لصق) لإرسال صورة السند مباشرة كصورة عالية الدقة!' 
            : '👉 اسحب ملف صورة السند المنزّل داخل المحادثة في واتساب لإرسالها مباشرة كصورة!'}
        </p>

        <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 16px; margin: 4px auto; width: 100%; max-width: 440px; text-align: right; font-size: 0.88rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-muted);">العميل / المسدد:</span>
            <strong style="color: var(--text-primary);">${log.sourceName}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-muted);">المبلغ المسدد:</span>
            <strong style="color: var(--emerald);">${this.formatMoney(log.amount)} ج.م</strong>
          </div>
          ${debtInfo ? `
          <div style="display: flex; justify-content: space-between; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px; margin-top: 6px;">
            <span style="color: #f87171; font-weight: bold;">المتبقي من الدين:</span>
            <strong style="color: #f87171; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;">${this.formatMoney(debtInfo.remainingDebt)} ج.م</strong>
          </div>
          ` : ''}
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 440px; margin: 6px auto 0;">
          ${cleanPhone ? `
            <button class="btn" onclick="window.open('https://wa.me/${cleanPhone}', '_blank'); App.closeModal();" style="background: #25D366; color: #fff; font-weight: 800; padding: 10px 16px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; border: none; cursor: pointer; font-size: 0.95rem;">
              ${this.getWhatsAppIconSvg(20)}
              <span>فتح محادثة العميل (${rawPhone}) على واتساب مباشرة 💬</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="window.open('https://web.whatsapp.com/', '_blank'); App.closeModal();" style="font-size: 0.82rem; padding: 6px 12px; color: var(--text-secondary);">
              أو فتح واتساب ويب العام (web.whatsapp.com)
            </button>
          ` : `
            <button class="btn" onclick="window.open('https://web.whatsapp.com/', '_blank'); App.closeModal();" style="background: #25D366; color: #fff; font-weight: 800; padding: 10px 16px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; border: none; cursor: pointer; font-size: 0.95rem;">
              ${this.getWhatsAppIconSvg(20)}
              <span>فتح واتساب واختيار المحادثة 💬</span>
            </button>
          `}
        </div>

        <div style="display: flex; justify-content: center; margin-top: 6px;">
          <button class="btn btn-primary" onclick="App.closeModal()" style="min-width: 130px; font-weight: 700;">
            فهمت ذلك ✓
          </button>
        </div>
      </div>
    `;

    this.openModal(modalHtml, '500px');
  },

  // ==========================================
  // 6. NOTIFICATION CENTER
  // ==========================================
  renderNotifications() {
    const list = document.getElementById('notifications-full-list');
    if (!list) return;

    if (this.db.notifications.length === 0) {
      list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">لا توجد إشعارات حالياً</div>`;
      return;
    }

    list.innerHTML = this.db.notifications.map(n => {
      let icon = '🔔';
      let iconBg = 'var(--blue-gradient)';
      if (n.type === 'invoice') { icon = '🧾'; iconBg = 'var(--gold-gradient)'; }
      if (n.type === 'payment') { icon = '💵'; iconBg = 'var(--emerald-gradient)'; }
      if (n.type === 'alert') { icon = '⚠️'; iconBg = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'; }
      if (n.type === 'treasury') { icon = '🏦'; iconBg = 'var(--gold-gradient)'; }

      return `
        <div class="notif-card ${!n.read ? 'unread' : ''}">
          <div class="notif-icon-box" style="background: ${iconBg}; color: #fff;">
            ${icon}
          </div>
          <div class="notif-content">
            <div class="notif-title">${n.title}</div>
            <div class="notif-desc">${n.desc}</div>
            <div class="notif-time">${n.time}</div>
          </div>
          <div class="notif-actions" style="display: flex; gap: 8px; align-items: center; flex-shrink: 0; flex-wrap: wrap;">
            ${!n.read ? `
              <button class="btn btn-secondary btn-sm" onclick="App.markNotifRead('${n.id}')" title="تعليم كمقروء" style="padding: 5px 10px; font-size: 0.78rem;">
                ✓ مقروء
              </button>
            ` : ''}
            <button class="btn btn-primary btn-sm" onclick="App.printSingleNotification('${n.id}')" title="طباعة الإشعار كصورة مثل الفاتورة" style="padding: 5px 10px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;">
              <span>🖨️</span> طباعة
            </button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteNotification('${n.id}')" title="حذف هذا الإشعار" style="padding: 5px 10px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;">
              <span>🗑️</span> حذف
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  // توليد سند إشعار رسمي عالي الدقة كصورة تشبه الفاتورة
  renderSingleNotificationCanvas(notif) {
    const width = 540;
    const padding = 24;
    const contentWidth = width - (padding * 2);

    // Calculate description height
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '13px Cairo, sans-serif';

    const words = (notif.desc || '').split(' ');
    let testLine = '';
    let lineCount = 0;
    for (let n = 0; n < words.length; n++) {
      const line = testLine ? testLine + ' ' + words[n] : words[n];
      if (tempCtx.measureText(line).width > (contentWidth - 28) && n > 0) {
        lineCount++;
        testLine = words[n];
      } else {
        testLine = line;
      }
    }
    if (testLine) lineCount++;
    const descHeight = Math.max(lineCount * 22, 24);

    const height = 490 + descHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill white thermal paper
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Top decorative bar
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#00f5a0');
    gradient.addColorStop(0.5, '#00b4d8');
    gradient.addColorStop(1, '#6366f1');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, 6);

    ctx.direction = 'rtl';
    ctx.textAlign = 'center';

    // Header: Business Name
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px Cairo, sans-serif';
    ctx.fillText(this.db.settings.businessName || 'مؤسسة حسام لتوزيع السجاير بالجملة', width / 2, 38);

    // Subtitle Contact
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Cairo, sans-serif';
    ctx.fillText(`${this.db.settings.address || 'العنوان الرئيسي'} | هاتف: ${this.db.settings.phone || '01012345678'}`, width / 2, 58);

    // Dashed line
    ctx.strokeStyle = '#cbd5e1';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding, 74);
    ctx.lineTo(width - padding, 74);
    ctx.stroke();
    ctx.setLineDash([]);

    // Document Title Banner
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px Cairo, sans-serif';
    ctx.fillText('🔔 سند إشعار نظام رسمي / تبليغ إداري', width / 2, 102);

    // Format display ID & types
    const rawId = String(notif.id || '');
    const displayId = rawId.startsWith('notif_') ? `#N-${rawId.replace('notif_', '').slice(-6)}` : `#${rawId}`;
    
    const typeLabels = {
      'invoice': 'فاتورة مبيعات',
      'payment': 'سند تحصيل وقبض',
      'receipt': 'سند صرف نقدية',
      'expense': 'مصروفات تشغيلية',
      'stock': 'حركة مخزون',
      'alert': 'تنبيه إداري',
      'info': 'إشعار نظام',
      'warning': 'تحذير هام'
    };
    const typeLabel = typeLabels[notif.type] || notif.type || 'إشعار عام';
    const repName = notif.rep || (this.db.currentUser ? this.db.currentUser.name : 'حسام (الإدارة)');

    // Metadata Table Box (Two Column Grid with dividers)
    const boxY = 118;
    const boxH = 86;
    const midX = width / 2;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(padding, boxY, contentWidth, boxH);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding, boxY, contentWidth, boxH);

    // Vertical Divider
    ctx.beginPath();
    ctx.moveTo(midX, boxY);
    ctx.lineTo(midX, boxY + boxH);
    ctx.stroke();

    // Horizontal Divider
    ctx.beginPath();
    ctx.moveTo(padding, boxY + (boxH / 2));
    ctx.lineTo(width - padding, boxY + (boxH / 2));
    ctx.stroke();

    // Safe layout coordinates
    const colRightStartX = width - padding - 12;
    const colRightValX = colRightStartX - 76;
    const colLeftStartX = midX - 12;
    const colLeftValX = colLeftStartX - 54;

    const row1Y = boxY + 27;
    const row2Y = boxY + 68;

    ctx.textAlign = 'right';

    // Row 1 - Right: رقم الإشعار
    ctx.font = '12px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('رقم الإشعار:', colRightStartX, row1Y);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillText(displayId, colRightValX, row1Y);

    // Row 1 - Left: التوقيت
    ctx.font = '12px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('التوقيت:', colLeftStartX, row1Y);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillText(notif.time || 'الآن', colLeftValX, row1Y);

    // Row 2 - Right: نوع الحركة
    ctx.font = '12px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('نوع الحركة:', colRightStartX, row2Y);
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillText(typeLabel, colRightValX, row2Y);

    // Row 2 - Left: المسؤول
    ctx.font = '12px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('المسؤول:', colLeftStartX, row2Y);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.fillText(repName, colLeftValX, row2Y);

    // Section title
    let curY = boxY + boxH + 24;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Cairo, sans-serif';
    ctx.fillText('بيان وتفاصيل الإشعار:', width - padding, curY);

    // Notification Card Box
    curY += 12;
    const cardH = 52 + descHeight;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(padding, curY, contentWidth, cardH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(padding, curY, contentWidth, cardH);

    // Color bar
    ctx.fillStyle = '#00b4d8';
    ctx.fillRect(width - padding - 4, curY, 4, cardH);

    // Notification Title
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px Cairo, sans-serif';
    ctx.fillText(notif.title || 'إشعار', width - padding - 16, curY + 28);

    // Notification Description
    ctx.fillStyle = '#334155';
    ctx.font = '13px Cairo, sans-serif';
    this.wrapCanvasText(ctx, notif.desc || '', width - padding - 16, curY + 54, contentWidth - 32, 22);

    curY += cardH + 24;

    // Official Verification Badge
    ctx.fillStyle = '#ecfdf5';
    ctx.fillRect(padding + 20, curY, contentWidth - 40, 32);
    ctx.strokeStyle = '#10b981';
    ctx.strokeRect(padding + 20, curY, contentWidth - 40, 32);

    ctx.fillStyle = '#059669';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✓ معتمد رسمياً من نظام Hossam ERP لإدارة المخزون والمبيعات', width / 2, curY + 21);

    // Barcode lines
    curY += 52;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    const barcodeStartX = padding + 40;
    const barcodeWidth = contentWidth - 80;
    for (let x = barcodeStartX; x < barcodeStartX + barcodeWidth; x += 4) {
      if ((x * 13) % 7 > 2) {
        ctx.beginPath();
        ctx.moveTo(x, curY);
        ctx.lineTo(x, curY + 28);
        ctx.stroke();
      }
    }

    curY += 40;
    ctx.font = '11px Cairo, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(this.db.settings.receiptFooter || 'شكراً لتعاملكم معنا', width / 2, curY);
    ctx.fillText('نظام إدارة وتوزيع السجاير بالجملة', width / 2, curY + 16);

    return canvas;
  },

  // طباعة ومعاينة إشعار محدد كصورة رسمية مثل الفاتورة
  printSingleNotification(notifId) {
    const notif = (this.db.notifications || []).find(n => n.id === notifId);
    if (!notif) {
      this.showToast('لم يتم العثور على بيانات الإشعار', 'error');
      return;
    }

    const canvas = this.renderSingleNotificationCanvas(notif);
    const dataUrl = canvas.toDataURL('image/png');

    const modalHtml = `
      <div class="modal-header">
        <h3 style="display: flex; align-items: center; gap: 8px;">
          <span>🖨️</span> معاينة وطباعة الإشعار #${notif.id}
        </h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 16px; max-height: 75vh; overflow-y: auto; text-align: center;">
        <div style="box-shadow: 0 8px 30px rgba(0,0,0,0.5); border-radius: 8px; display: inline-block; overflow: hidden; border: 1px solid var(--border-subtle);">
          <img src="${dataUrl}" alt="إشعار #${notif.id}" style="max-width: 100%; height: auto; display: block;">
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="App.downloadSingleNotificationImage('${notif.id}')" style="display: inline-flex; align-items: center; gap: 6px;">
            <span>📥</span> تنزيل الإشعار كصورة
          </button>
          <button class="btn" onclick="App.shareSingleNotificationWhatsApp('${notif.id}')" style="background-color: #25D366; color: #ffffff; border: none; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(37,211,102,0.3); padding: 8px 14px; border-radius: 6px; cursor: pointer;">
            ${this.getWhatsAppIconSvg(18)}
            <span>إرسال عبر واتساب</span>
          </button>
          <button class="btn btn-secondary" onclick="App.printSingleNotificationDirect('${notif.id}')" style="display: inline-flex; align-items: center; gap: 6px;">
            <span>🖨️</span> طباعة فورية
          </button>
        </div>
        <button class="btn btn-secondary" onclick="App.closeModal()">إغلاق</button>
      </div>
    `;

    this.openModal(modalHtml, '580px');
  },

  downloadSingleNotificationImage(notifId) {
    const notif = (this.db.notifications || []).find(n => n.id === notifId);
    if (!notif) return;
    const canvas = this.renderSingleNotificationCanvas(notif);
    const link = document.createElement('a');
    link.download = `إشعار_${notif.id}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast(`تم تنزيل صورة الإشعار #${notif.id} بنجاح`);
  },

  shareSingleNotificationWhatsApp(notifId) {
    const notif = (this.db.notifications || []).find(n => n.id === notifId);
    if (!notif) return;
    const canvas = this.renderSingleNotificationCanvas(notif);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `إشعار_${notif.id}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `إشعار #${notif.id}`,
            text: `${notif.title}`
          });
          this.showToast('تمت مشاركة صورة الإشعار بنجاح عبر واتساب');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      // Copy to clipboard & download & open WhatsApp
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }
      } catch (e) {}

      const link = document.createElement('a');
      link.download = `إشعار_${notif.id}.png`;
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.open('https://web.whatsapp.com/', '_blank');
      this.showToast('تم نسخ وتنزيل صورة الإشعار وفتح واتساب لإرسالها (Ctrl + V)');
    }, 'image/png');
  },

  printSingleNotificationDirect(notifId) {
    const notif = (this.db.notifications || []).find(n => n.id === notifId);
    if (!notif) return;
    const canvas = this.renderSingleNotificationCanvas(notif);
    const dataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
          <title>طباعة إشعار #${notif.id}</title>
          <style>
            body { margin: 0; padding: 20px; text-align: center; font-family: sans-serif; }
            img { max-width: 540px; width: 100%; height: auto; }
            @media print {
              body { padding: 0; }
              img { width: 100%; }
            }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" onload="window.print();window.close();">
        </body>
        </html>
      `);
      printWindow.document.close();
    }
  },

  addNotification(notif) {
    const newN = {
      id: `notif_${Date.now()}`,
      title: notif.title,
      desc: notif.desc,
      time: 'الآن',
      type: notif.type || 'info',
      read: false
    };
    this.db.notifications.unshift(newN);
    this.syncDB();
    if (window.FDB) window.FDB.addDocument('notifications', newN);
    if (this.activePage === 'notifications') this.renderNotifications();
    this.updateDashboardStats();
  },

  deleteNotification(id) {
    const notif = (this.db.notifications || []).find(n => n.id === id);
    if (!notif) return;
    this.db.notifications = this.db.notifications.filter(n => n.id !== id);
    this.syncDB();
    if (window.FDB) window.FDB.deleteDocument('notifications', id);
    this.showToast('تم حذف الإشعار بنجاح');
    this.renderNotifications();
    this.updateDashboardStats();
  },

  markNotifRead(id) {
    const n = this.db.notifications.find(item => item.id === id);
    if (n) {
      n.read = true;
      this.syncDB();
      if (window.FDB) window.FDB.updateDocument('notifications', id, { read: true });
      this.renderNotifications();
      this.updateDashboardStats();
    }
  },

  markAllNotifsRead() {
    this.db.notifications.forEach(n => {
      n.read = true;
      if (window.FDB) window.FDB.updateDocument('notifications', n.id, { read: true });
    });
    this.syncDB();
    this.showToast('تم تعليم كافة الإشعارات كمقروءة');
    this.renderNotifications();
    this.updateDashboardStats();
  },

  async clearAllNotifs() {
    if (!this.db.notifications || this.db.notifications.length === 0) {
      this.showToast('لا توجد إشعارات لمسحها', 'info');
      return;
    }

    const unreadCount = this.db.notifications.filter(n => !n.read).length;
    const confirmed = await this.confirmDialog({
      title: 'مسح جميع الإشعارات',
      subtitle: 'إشعار تأكيد تفريغ صندوق التنبيهات والإشعارات',
      message: 'هل أنت متأكد من مسح جميع الإشعارات نهائياً؟',
      icon: '🔔',
      type: 'warning',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">إجمالي الإشعارات:</span>
            <span class="value">${this.db.notifications.length} إشعار</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">غير المقروءة:</span>
            <span class="value text-warning">${unreadCount} إشعار</span>
          </div>
        </div>
        <div class="confirm-notice-box">⚠️ سيتم حذف سجل الإشعارات كاملاً ولن تتمكن من استرجاعه.</div>
      `,
      confirmText: 'نعم، مسح الكل',
      cancelText: 'إلغاء'
    });

    if (!confirmed) return;

    const oldNotifs = [...this.db.notifications];
    this.db.notifications = [];
    this.syncDB();
    if (window.FDB) {
      oldNotifs.forEach(n => window.FDB.deleteDocument('notifications', n.id));
    }
    this.showToast('تم مسح جميع الإشعارات');
    this.renderNotifications();
    this.updateDashboardStats();
  },

  // Helper to wrap text on canvas
  wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = (text || '').split(' ');
    let line = '';
    let curY = y;
    const lines = [];

    for (let n = 0; n < words.length; n++) {
      const testLine = line ? line + ' ' + words[n] : words[n];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        lines.push({ text: line, y: curY });
        line = words[n];
        curY += lineHeight;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push({ text: line, y: curY });

    lines.forEach(l => {
      ctx.fillText(l.text, x, l.y);
    });

    return lines.length;
  },

  // توليد وطباعة الإشعارات بصيغة صورة PNG عالية الدقة
  printNotificationsAsImage() {
    const notifs = this.db.notifications || [];
    if (notifs.length === 0) {
      this.showToast('لا توجد إشعارات مسجلة لطباعتها', 'warning');
      return;
    }

    const width = 850;
    const padding = 35;
    const contentWidth = width - (padding * 2);

    // Calculate height dynamically
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '13px Cairo, sans-serif';

    const getLinesCount = (text, maxWidth) => {
      const words = (text || '').split(' ');
      let line = '';
      let count = 0;
      for (let n = 0; n < words.length; n++) {
        const testLine = line ? line + ' ' + words[n] : words[n];
        const metrics = tempCtx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          count++;
          line = words[n];
        } else {
          line = testLine;
        }
      }
      if (line) count++;
      return Math.max(count, 1);
    };

    const cardHeights = notifs.map(n => {
      const lines = getLinesCount(n.desc || '', contentWidth - 40);
      return 60 + (lines * 22);
    });

    const headerHeight = 220;
    const footerHeight = 90;
    const totalCardsHeight = cardHeights.reduce((a, b) => a + b + 14, 0);
    const height = headerHeight + totalCardsHeight + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill white paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Top decorative bar
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#00f5a0');
    gradient.addColorStop(0.5, '#00b4d8');
    gradient.addColorStop(1, '#6366f1');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, 8);

    // Header Content
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';

    // Business Name
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px Cairo, sans-serif';
    ctx.fillText(this.db.settings.businessName || 'مؤسسة حسام لتجارة وتوزيع السجاير بالجملة', width - padding, 48);

    // Business Contact
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillText(`${this.db.settings.address || 'العنوان الرئيسي'} | هاتف: ${this.db.settings.phone || '01012345678'}`, width - padding, 74);

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, 92);
    ctx.lineTo(width - padding, 92);
    ctx.stroke();

    // Report Title & Badge
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px Cairo, sans-serif';
    ctx.fillText('🔔 تقرير مركز الإشعارات وتنبيهات النظام', width - padding, 126);

    // Meta Box
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(padding, 142, contentWidth, 54);
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(padding, 142, contentWidth, 54);

    ctx.fillStyle = '#334155';
    ctx.font = '12px Cairo, sans-serif';
    const nowStr = new Date().toLocaleDateString('ar-EG-u-nu-latn', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const unreadCount = notifs.filter(n => !n.read).length;
    const metaLine1 = `تاريخ التقرير: ${nowStr}    |    المسؤول: ${this.db.currentUser ? this.db.currentUser.name : 'المدير العام'}`;
    const metaLine2 = `إجمالي الإشعارات: ${notifs.length}    |    غير مقروء: ${unreadCount}    |    مقروء: ${notifs.length - unreadCount}`;
    ctx.fillText(metaLine1, width - padding - 16, 164);
    ctx.fillText(metaLine2, width - padding - 16, 184);

    // Cards list
    let currentY = headerHeight;

    notifs.forEach((n, idx) => {
      const cardH = cardHeights[idx];
      const cardY = currentY;

      // Card Background
      ctx.fillStyle = n.read ? '#ffffff' : '#f0fdf4';
      ctx.fillRect(padding, cardY, contentWidth, cardH);

      // Card Border
      ctx.strokeStyle = n.read ? '#e2e8f0' : '#86efac';
      ctx.lineWidth = n.read ? 1 : 1.5;
      ctx.strokeRect(padding, cardY, contentWidth, cardH);

      // Type Color Strip on right
      let stripColor = '#0284c7';
      let typeLabel = 'إشعار نظام';
      if (n.type === 'invoice') { stripColor = '#d97706'; typeLabel = '🧾 فاتورة مبيعات'; }
      else if (n.type === 'payment') { stripColor = '#10b981'; typeLabel = '💵 سند قبض'; }
      else if (n.type === 'alert') { stripColor = '#ef4444'; typeLabel = '⚠️ تنبيه مخزون'; }
      else if (n.type === 'treasury') { stripColor = '#8b5cf6'; typeLabel = '🏦 حركة خزينة'; }

      ctx.fillStyle = stripColor;
      ctx.fillRect(width - padding - 6, cardY, 6, cardH);

      // Card Title & Type
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 14px Cairo, sans-serif';
      ctx.fillText(n.title, width - padding - 20, cardY + 24);

      // Type Tag (Left side of title)
      ctx.font = '11px Cairo, sans-serif';
      ctx.fillStyle = stripColor;
      ctx.fillText(`[${typeLabel}]`, width - padding - 240, cardY + 24);

      // Status Tag (Far left)
      ctx.textAlign = 'left';
      ctx.font = '11px Cairo, sans-serif';
      if (!n.read) {
        ctx.fillStyle = '#15803d';
        ctx.fillText('● جديد', padding + 16, cardY + 24);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('مقروء', padding + 16, cardY + 24);
      }

      // Time
      ctx.fillStyle = '#64748b';
      ctx.fillText(n.time || '', padding + 70, cardY + 24);

      // Card Description (Wrapped text)
      ctx.textAlign = 'right';
      ctx.fillStyle = '#334155';
      ctx.font = '13px Cairo, sans-serif';
      this.wrapCanvasText(ctx, n.desc || '', width - padding - 20, cardY + 48, contentWidth - 40, 22);

      currentY += cardH + 14;
    });

    // Footer
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - footerHeight + 15);
    ctx.lineTo(width - padding, height - footerHeight + 15);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Cairo, sans-serif';
    ctx.fillText(this.db.settings.receiptFooter || 'شكراً لتعاملكم معنا', width / 2, height - footerHeight + 40);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Cairo, sans-serif';
    ctx.fillText('تم التوليد بواسطة Hossam ERP - نظام إدارة وتوزيع السجاير بالجملة', width / 2, height - footerHeight + 60);

    // Convert Canvas to PNG
    const dataUrl = canvas.toDataURL('image/png');

    // Automatically download image
    this.downloadCanvasImage(dataUrl, 'تقرير_الاشعارات');

    // Open Interactive Preview Modal with Print & Re-download options
    const modalHtml = `
      <div class="modal-header">
        <h3><span>🖼️</span> معاينة طباعة الإشعارات بصيغة صورة</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 14px; align-items: center; text-align: center;">
        <div style="font-size: 0.88rem; color: var(--text-secondary);">
          ✅ تم توليد وتنزيل صورة تقرير الإشعارات بنجاح. يمكنك معاينتها أو طباعتها مباشرة عبر الطابعة:
        </div>
        <div style="max-height: 55vh; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px; background: rgba(0,0,0,0.6); width: 100%;">
          <img src="${dataUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: 4px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);" alt="تقرير الإشعارات">
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-blue" onclick="App.downloadCanvasImage('${dataUrl}', 'تقرير_الاشعارات')">
            <span>📥</span> إعادة تنزيل الصورة
          </button>
          <button class="btn btn-primary" onclick="App.printImageDirectly('${dataUrl}')">
            <span>🖨️</span> أمر طباعة فورية
          </button>
        </div>
      </div>
    `;

    this.openModal(modalHtml, '750px');
  },

  downloadCanvasImage(dataUrl, filenamePrefix = 'صورة') {
    const dateStr = new Date().toISOString().split('T')[0];
    const link = document.createElement('a');
    link.download = `${filenamePrefix}_${dateStr}.png`;
    link.href = dataUrl;
    link.click();
    this.showToast('تم تنزيل الصورة بنجاح');
  },

  printImageDirectly(dataUrl) {
    const printWin = window.open('', '_blank');
    if (!printWin) {
      this.showToast('يرجى السماح بالنوافذ المنبثقة للطباعة', 'warning');
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>طباعة الإشعارات - Hossam ERP</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: flex-start; background: #fff; }
          img { max-width: 100%; height: auto; display: block; }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" onload="setTimeout(() => { window.print(); }, 200);" />
      </body>
      </html>
    `);
    printWin.document.close();
  },

  // ==========================================
  // 7. SETTINGS & USER/REP MANAGEMENT
  // ==========================================
  renderSettings() {
    // Populate General Settings fields
    const s = this.db.settings;
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('settings-business-name', s.businessName);
    setVal('settings-phone', s.phone);
    setVal('settings-address', s.address);
    setVal('settings-footer-text', s.receiptFooter);

    // Users & Reps Table
    const tbody = document.getElementById('settings-users-tbody');
    if (tbody) {
      if (!this.db.users || this.db.users.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
              <div style="font-size: 2rem; margin-bottom: 8px;">👥</div>
              <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-white); margin-bottom: 4px;">لا يوجد موظفين أو مستخدمين مسجلين</div>
              <div style="font-size: 0.85rem; color: var(--text-secondary);">النظام جاهز تماماً، يمكنك الضغط على زر "+ إضافة حساب مستخدم جديد" بالأعلى لإضافة حسابك والموظفين الجدد وستحفظ مباشرة في قاعدة البيانات.</div>
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = this.db.users.map(u => `
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--text-white); font-size: 0.95rem;">${u.name}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                اسم الدخول: <span style="color: var(--teal-neon); font-family: monospace; font-weight: 600;">${u.username}</span>
                ${u.email ? `<span style="margin-right: 8px; color: var(--cyan); font-size: 0.74rem;">✉️ ${u.email}</span>` : ''}
                ${u.password ? `<span style="margin-right: 8px; color: var(--text-dim); font-size: 0.72rem;">🔑 كلمة السر: ••••••••</span>` : `<span style="margin-right: 8px; color: var(--rose-neon); font-size: 0.72rem;">⚠️ بدون كلمة سر</span>`}
              </div>
            </td>
            <td><span class="badge-status ${u.role && u.role.includes('مدير') ? 'warning' : 'success'}">${u.role || 'مستخدم'}</span></td>
            <td style="font-family: monospace; direction: ltr; text-align: right;">${u.phone || '---'}</td>
            <td>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; max-width: 340px;">
                ${(u.permissions || []).map(p => `<span style="font-size: 0.7rem; background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle); padding: 2px 7px; border-radius: 4px; color: var(--text-secondary);">${p}</span>`).join('')}
              </div>
            </td>
            <td>
              <span class="badge-status ${u.status === 'active' ? 'success' : 'danger'}">
                ${u.status === 'active' ? 'نشط' : 'معطل'}
              </span>
            </td>
            <td>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button class="btn btn-primary btn-sm" onclick="App.openEditUserModal('${u.id}')" title="تعديل بيانات الحساب وكلمة السر والصلاحيات">
                  <span>✏️</span> تعديل
                </button>
                <button class="btn btn-secondary btn-sm" onclick="App.toggleUserStatus('${u.id}')">
                  ${u.status === 'active' ? 'إيقاف' : 'تفعيل'}
                </button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteUser('${u.id}')">حذف</button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }
  },

  saveGeneralSettings() {
    this.db.settings.businessName = document.getElementById('settings-business-name').value.trim();
    this.db.settings.phone = document.getElementById('settings-phone').value.trim();
    this.db.settings.address = document.getElementById('settings-address').value.trim();
    this.db.settings.receiptFooter = document.getElementById('settings-footer-text').value.trim();

    this.syncDB();
    if (window.FDB) window.FDB.setDocument('settings', 'config', this.db.settings);
    this.showToast('تم حفظ الإعدادات العامة بنجاح');
  },

  getAvailablePermissions() {
    return [
      { id: 'all', label: 'كافة الصلاحيات', desc: 'الوصول الكامل والشامل لجميع أقسام ووظائف النظام' },
      { id: 'pos_rep', label: 'نقطة بيع المندوب', desc: 'إصدار فواتير وسداد مباشر وآجل من عهدة سيارة التوزيع' },
      { id: 'pos_store', label: 'مبيعات المخزن (كاشير)', desc: 'إصدار فواتير نقدية وآجلة من المخزن الرئيسي' },
      { id: 'receipts', label: 'سندات قبض وتحصيل', desc: 'تسجيل وتحصيل نقدية وإصدار إيصالات استلام' },
      { id: 'treasury', label: 'الخزينة والمصروفات', desc: 'عرض رصيد الخزينة، تسجيل المصروفات والتوريد' },
      { id: 'inventory', label: 'المخزون وإدخال الشحنات', desc: 'استلام شحنات كراتين السجاير وتحديث الأرصدة' },
      { id: 'pricing', label: 'الأسعار وسياسة البيع', desc: 'تعديل أسعار شراء وبيع القروصات وحدود الطلب' },
      { id: 'customers', label: 'إدارة العملاء والديون', desc: 'إضافة عملاء، ضبط سقف الائتمان، كشف الحسابات' },
      { id: 'reps', label: 'إدارة المناديب والعهد', desc: 'صرف وتسوية عهد المناديب ومتابعة المبيعات' },
      { id: 'users_settings', label: 'إدارة المستخدمين والإعدادات', desc: 'إدارة الحسابات، الصلاحيات، وإعدادات المؤسسة' },
      { id: 'reports', label: 'التقارير والأرباح', desc: 'الاطلاع على تقارير الأرباح والمبيعات وكشف الأداء' },
      { id: 'rep_custody_only', label: 'عهدته فقط', desc: 'تقييد حركة البيع بالأصناف المسلمة في عهدته' },
      { id: 'rep_customers_only', label: 'سندات قبض عملائه', desc: 'حصر التحصيل على عملاء خط سيره فقط' }
    ];
  },

  openAddUserModal() {
    const modalHtml = `
      <div class="modal-header">
        <h3>👤 إنشاء حساب مندوب / مستخدم جديد</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">الاسم الكامل *</label>
            <input type="text" id="new-user-fullname" class="form-control" placeholder="مثال: يوسف حسن">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="text" id="new-user-phone" class="form-control" placeholder="01xxxxxxxxx">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">اسم المستخدم للدخول *</label>
            <input type="text" id="new-user-username" class="form-control" placeholder="youssef_rep">
          </div>
          <div class="form-group">
            <label class="form-label">كلمة المرور *</label>
            <div class="password-input-group">
              <input type="password" id="new-user-password" class="form-control" placeholder="أدخل كلمة المرور">
              <button type="button" class="password-toggle-btn" onclick="App.togglePasswordVisibility('new-user-password', this)">
                👁️ إظهار
              </button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">نوع الحساب / الدور *</label>
          <select id="new-user-role" class="custom-select">
            <option value="مندوب توزيع">مندوب توزيع (نقطة بيع + عهدة)</option>
            <option value="كاشير بالمخزن">كاشير بالمخزن</option>
            <option value="مدير فرعي">مدير فرعي (صلاحيات إشرافية)</option>
            <option value="مدير النظام (أدمن)">مدير النظام (أدمن)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">خط التوزيع / المنطقة (في حالة المندوب)</label>
          <input type="text" id="new-user-route" class="form-control" placeholder="مثال: خط الهرم وفيصل">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveNewUser()">إنشاء وتفعيل الحساب</button>
      </div>
    `;
    this.openModal(modalHtml);
  },

  saveNewUser() {
    const fullName = document.getElementById('new-user-fullname').value.trim();
    const phone = document.getElementById('new-user-phone').value.trim();
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value.trim() || '123';
    const role = document.getElementById('new-user-role').value;
    const route = document.getElementById('new-user-route').value.trim() || 'خط توزيع عام';

    if (!fullName || !username) {
      this.showToast('يرجى كتابة الاسم واسم المستخدم', 'error');
      return;
    }

    const duplicate = this.db.users.find(item => item.username.toLowerCase() === username.toLowerCase());
    if (duplicate) {
      this.showToast('اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر', 'error');
      return;
    }

    const defaultPerms = role.includes('مندوب') 
      ? ['نقطة بيع المندوب', 'عهدته فقط', 'سندات قبض عملائه'] 
      : role.includes('مدير')
        ? ['كافة الصلاحيات', 'الخزينة والمصروفات', 'الأسعار وسياسة البيع', 'المخزون وإدخال الشحنات', 'إدارة المستخدمين والإعدادات']
        : ['مبيعات المخزن (كاشير)', 'سندات قبض وتحصيل'];

    const newUser = {
      id: `user_${Date.now()}`,
      name: fullName,
      username: username,
      password: password,
      role: role,
      phone: phone,
      status: 'active',
      permissions: defaultPerms
    };

    this.db.users.push(newUser);

    // If role is rep, create a corresponding rep record
    if (role.includes('مندوب')) {
      const newRep = {
        id: `rep_${Date.now()}`,
        name: fullName,
        username: username,
        phone: phone,
        routeZone: route,
        activeCustody: [],
        assignedCustomerIds: [],
        assignedCustomersCount: 0,
        totalSales: 0,
        currentCash: 0,
        totalSupplied: 0,
        assignedDebts: 0,
        status: 'active'
      };
      this.db.reps.push(newRep);
    }

    this.syncDB();
    if (window.FDB) {
      window.FDB.addDocument('users', newUser);
      if (typeof newRep !== 'undefined') {
        window.FDB.addDocument('reps', newRep);
      }
    }
    this.closeModal();
    this.showToast(`تم إنشاء حساب ${fullName} بنجاح`);
    this.renderSettings();
  },

  openEditUserModal(userId) {
    const u = this.db.users.find(item => item.id === userId);
    if (!u) {
      this.showToast('لم يتم العثور على الحساب', 'error');
      return;
    }

    const availablePerms = this.getAvailablePermissions();
    const userPerms = Array.isArray(u.permissions) ? u.permissions : [];

    // Include any custom permissions user might have that are not in default list
    const customPerms = userPerms.filter(p => !availablePerms.some(ap => ap.label === p));
    const allPermsList = [
      ...availablePerms,
      ...customPerms.map(cp => ({ id: `custom_${cp}`, label: cp, desc: 'صلاحية إضافية' }))
    ];

    const permsHtml = allPermsList.map(p => {
      const isChecked = userPerms.includes(p.label);
      return `
        <label class="perm-card">
          <input type="checkbox" class="perm-checkbox user-perm-checkbox" value="${p.label}" ${isChecked ? 'checked' : ''} onchange="App.onUserPermChange(this)">
          <div class="perm-info">
            <span class="perm-title">${p.label}</span>
            <span class="perm-desc">${p.desc}</span>
          </div>
        </label>
      `;
    }).join('');

    const modalHtml = `
      <div class="modal-header">
        <h3><span>✏️</span> تعديل بيانات وصلاحيات الحساب: ${u.name}</h3>
        <button class="modal-close-btn" onclick="App.closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="gap: 16px;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">الاسم الكامل *</label>
            <input type="text" id="edit-user-fullname" class="form-control" value="${u.name || ''}" placeholder="اسم المستخدم أو المندوب">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="text" id="edit-user-phone" class="form-control" value="${u.phone || ''}" placeholder="01xxxxxxxxx">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">اسم الدخول (اسم المستخدم للنظام) *</label>
            <input type="text" id="edit-user-username" class="form-control" value="${u.username || ''}" placeholder="username">
          </div>
          <div class="form-group">
            <label class="form-label">كلمة السر *</label>
            <div class="password-input-group">
              <input type="password" id="edit-user-password" class="form-control" value="${u.password || ''}" placeholder="أدخل كلمة المرور">
              <button type="button" class="password-toggle-btn" onclick="App.togglePasswordVisibility('edit-user-password', this)">
                👁️ إظهار
              </button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">الدور الوظيفي / نوع الحساب</label>
          <select id="edit-user-role" class="custom-select">
            <option value="مدير النظام (أدمن)" ${u.role && u.role.includes('مدير') ? 'selected' : ''}>مدير النظام (أدمن - تحكم كامل)</option>
            <option value="مندوب توزيع" ${u.role && u.role.includes('مندوب') ? 'selected' : ''}>مندوب توزيع (نقطة بيع متنقلة + عهدة)</option>
            <option value="كاشير بالمخزن" ${u.role && u.role.includes('كاشير') ? 'selected' : ''}>كاشير بالمخزن (مبيعات الجملة)</option>
            <option value="مدير فرعي" ${u.role && u.role.includes('فرعي') ? 'selected' : ''}>مدير فرعي (صلاحيات إشرافية ومخزن)</option>
            <option value="محاسب" ${u.role && u.role.includes('محاسب') ? 'selected' : ''}>محاسب (خزينة وسندات وتقارير)</option>
          </select>
        </div>

        <div class="form-group" style="margin-top: 4px;">
          <div class="perm-toolbar">
            <label class="form-label" style="margin-bottom: 0;">🔐 الصلاحيات الممنوحة لهذا الحساب:</label>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 4px 10px;" onclick="App.toggleAllUserPermissions(true)">
                تحديد الكل
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 4px 10px;" onclick="App.toggleAllUserPermissions(false)">
                إلغاء التحديد
              </button>
            </div>
          </div>
          <div id="modal-permissions-grid" class="permissions-grid">
            ${permsHtml}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="App.saveEditUser('${u.id}')">💾 حفظ التعديلات</button>
      </div>
    `;

    this.openModal(modalHtml, '680px');
  },

  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.textContent = '🙈 إخفاء';
    } else {
      input.type = 'password';
      if (btn) btn.textContent = '👁️ إظهار';
    }
  },

  toggleAllUserPermissions(select) {
    const checkboxes = document.querySelectorAll('.user-perm-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = select;
    });
  },

  onUserPermChange(checkbox) {
    if (checkbox.value === 'كافة الصلاحيات' && checkbox.checked) {
      const allCbs = document.querySelectorAll('.user-perm-checkbox');
      allCbs.forEach(cb => {
        if (cb !== checkbox) cb.checked = true;
      });
    }
  },

  saveEditUser(userId) {
    const u = this.db.users.find(item => item.id === userId);
    if (!u) {
      this.showToast('لم يتم العثور على الحساب', 'error');
      return;
    }

    const fullName = document.getElementById('edit-user-fullname').value.trim();
    const username = document.getElementById('edit-user-username').value.trim();
    const password = document.getElementById('edit-user-password').value.trim();
    const phone = document.getElementById('edit-user-phone').value.trim();
    const role = document.getElementById('edit-user-role').value;

    if (!fullName) {
      this.showToast('يرجى كتابة الاسم الكامل للحساب', 'error');
      return;
    }
    if (!username) {
      this.showToast('يرجى كتابة اسم الدخول للحساب', 'error');
      return;
    }
    if (!password) {
      this.showToast('يرجى كتابة كلمة المرور للحساب', 'error');
      return;
    }

    // Check username uniqueness
    const duplicate = this.db.users.find(item => item.id !== userId && item.username.toLowerCase() === username.toLowerCase());
    if (duplicate) {
      this.showToast('اسم الدخول مستخدم بالفعل لحساب آخر، يرجى اختيار اسم دخول آخر', 'error');
      return;
    }

    // Collect selected permissions
    const checkedCheckboxes = document.querySelectorAll('.user-perm-checkbox:checked');
    const permissions = Array.from(checkedCheckboxes).map(cb => cb.value);

    const oldUsername = u.username;
    const oldName = u.name;

    const allAdminPermissions = [
      'كافة الصلاحيات',
      'الخزينة والمصروفات',
      'الأسعار وسياسة البيع',
      'المخزون وإدخال الشحنات',
      'إدارة المستخدمين والإعدادات',
      'التقارير والأرباح',
      'نقطة بيع المندوب',
      'مبيعات المخزن (كاشير)',
      'سندات قبض وتحصيل',
      'إدارة العملاء والديون',
      'إدارة المناديب والعهد'
    ];

    const isHossamUser = userId === 'user_1' || (fullName && fullName.includes('حسام')) || username === 'admin' || username === 'hossam';

    // Update user object
    u.name = fullName;
    u.username = username;
    u.password = password;
    u.phone = phone;
    if (isHossamUser) {
      u.role = 'مدير النظام (أدمن)';
      u.permissions = allAdminPermissions;
    } else {
      u.role = role;
      u.permissions = permissions.length > 0 ? permissions : ['صلاحيات أساسية'];
    }

    // Update corresponding rep if exists
    if (this.db.reps && Array.isArray(this.db.reps)) {
      const rep = this.db.reps.find(r => r.username === oldUsername || r.name === oldName);
      if (rep) {
        rep.name = fullName;
        rep.username = username;
        rep.phone = phone;
      }
    }

    // Update active currentUser session if editing the current user
    if (this.db.currentUser && (this.db.currentUser.id === userId || this.db.currentUser.username === oldUsername)) {
      this.db.currentUser.name = u.name;
      this.db.currentUser.username = u.username;
      this.db.currentUser.role = u.role;
      this.db.currentUser.phone = u.phone;
      this.db.currentUser.permissions = u.permissions;
      this.updateHeaderProfile();
      this.applyUserPermissionsUI();
    }

    this.syncDB();
    if (window.FDB) {
      window.FDB.updateDocument('users', userId, u);
      // If user changed password and is currently authenticated or matches admin email
      if (password) {
        window.FDB.updateAuthPassword(password);
      }
    }
    this.closeModal();
    this.showToast(`تم حفظ وتحديث بيانات حساب "${fullName}" بنجاح`);
    this.renderSettings();
  },

  toggleUserStatus(userId) {
    const u = this.db.users.find(item => item.id === userId);
    if (!u) return;
    if (u.id === 'user_1' || u.username === 'admin' || (u.name && u.name.includes('حسام'))) {
      this.showToast('لا يمكن تعطيل الحساب الرئيسي للمالك (حساب حسام)', 'error');
      return;
    }
    u.status = u.status === 'active' ? 'inactive' : 'active';
    this.syncDB();
    if (window.FDB) window.FDB.updateDocument('users', userId, u);
    this.showToast(`تم تغيير حالة حساب ${u.name} إلى ${u.status === 'active' ? 'نشط' : 'معطل'}`);
    this.renderSettings();
  },

  async deleteUser(userId) {
    const u = this.db.users.find(item => item.id === userId);
    if (!u) return;
    if (u.id === 'user_1' || u.username === 'admin' || (u.name && u.name.includes('حسام'))) {
      this.showToast('لا يمكن حذف الحساب الرئيسي للمالك (حساب حسام)', 'error');
      return;
    }

    const confirmed = await this.confirmDialog({
      title: 'حذف حساب المستخدم',
      subtitle: 'إشعار تأكيد إزالة المستخدم وصلاحياته',
      message: `هل أنت متأكد من حذف حساب المستخدم "${u.name}"؟`,
      icon: '👤',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">اسم الموظف / الحساب:</span>
            <span class="value">${u.name}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">اسم الدخول:</span>
            <span class="value" style="font-family: monospace;">@${u.username}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">الدور الوظيفي:</span>
            <span class="value text-cyan">${u.role || 'مستخدم'}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">الحالة:</span>
            <span class="value">${u.status === 'active' ? '🟢 نشط' : '🔴 معطل'}</span>
          </div>
        </div>
        <div class="confirm-warning-note">⚠️ تحذير: سيتم إلغاء صلاحيات هذا المستخدم وقفل إمكانية دخوله للنظام.</div>
      `,
      confirmText: 'نعم، حذف الحساب',
      cancelText: 'إلغاء'
    });

    if (!confirmed) return;

    this.db.users = this.db.users.filter(item => item.id !== userId);
    this.syncDB();
    if (window.FDB) window.FDB.deleteDocument('users', userId);
    this.showToast(`تم حذف حساب ${u.name}`);
    this.renderSettings();
  },

  // ==========================================
  // AUTH: LOGOUT & LOGIN
  // ==========================================
  logout() {
    const dropdown = document.getElementById('header-profile-dropdown');
    if (dropdown) dropdown.classList.remove('show');
    this.openLogoutConfirmModal();
  },

  openLogoutConfirmModal() {
    const currentUser = this.getCurrentUser();
    const isHossam = currentUser.id === 'user_1' || (currentUser.name && currentUser.name.includes('حسام')) || currentUser.username === 'admin' || currentUser.username === 'hossam';
    const isRep = this.isCurrentUserRep();
    const rep = isRep ? this.getLinkedRep() : null;
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeFormatted = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    const avatarInitial = (currentUser.name || 'ح').trim().charAt(0);
    const roleBadge = isHossam ? '👑 مدير النظام (أدمن - تحكم كامل)' : (isRep ? `💼 مندوب مبيعات (${rep?.name || currentUser.name})` : (currentUser.role || 'مستخدم'));
    const posLocation = isRep ? `🚗 نقطة توزيع المندوب: ${rep?.name || 'سيارة التوزيع'}` : '🏢 المخزن الرئيسي (نقطة البيع)';

    const html = `
      <div class="confirm-dialog-header">
        <div class="confirm-dialog-icon-ring pulse-glow">
          <span class="confirm-icon">🚪</span>
        </div>
        <div class="confirm-dialog-headings">
          <h3 class="confirm-dialog-title">تأكيد تسجيل الخروج</h3>
          <p class="confirm-dialog-subtitle">إشعار أمان وإنهاء جلسة العمل الحالية</p>
        </div>
        <button class="confirm-dialog-close-btn" onclick="App.closeConfirmModal()" title="إغلاق">✕</button>
      </div>

      <div class="confirm-dialog-body">
        <!-- Account Details Card -->
        <div class="confirm-user-card">
          <div class="confirm-user-avatar ${isHossam ? 'hossam' : ''}">
            <span>${avatarInitial}</span>
          </div>
          <div class="confirm-user-meta">
            <div class="confirm-user-name">${currentUser.name || 'المستخدم'}</div>
            <div class="confirm-user-tags">
              <span class="confirm-tag user-tag">@${currentUser.username || 'admin'}</span>
              <span class="confirm-tag role-tag ${isHossam ? 'hossam' : ''}">${roleBadge}</span>
            </div>
          </div>
          <div class="confirm-session-status">
            <span class="status-dot-pulse"></span>
            <span class="status-label">جلسة نشطة</span>
          </div>
        </div>

        <!-- Session & POS info -->
        <div class="confirm-info-grid">
          <div class="confirm-info-item">
            <span class="label">🏢 نقطة العمل الحالية:</span>
            <span class="value">${posLocation}</span>
          </div>
          <div class="confirm-info-item">
            <span class="label">🕒 وقت وتاريخ الإشعار:</span>
            <span class="value">${timeFormatted} - ${dateFormatted}</span>
          </div>
        </div>

        <!-- Security & Notification Details -->
        <div class="confirm-details-callout">
          <div class="callout-title">
            <span>🛡️</span> تفاصيل وملاحظات تسجيل الخروج:
          </div>
          <ul class="callout-list">
            <li>
              <strong>إنهاء الجلسة بأمان:</strong>
              <span>سيتم قفل الوصول للنظام فوراً وحماية البيانات المحاسبية والمخزون.</span>
            </li>
            <li>
              <strong>سلامة البيانات:</strong>
              <span>جميع الفواتير وحركات الخزينة وسندات القبض محفوظة بأمان في قاعدة البيانات.</span>
            </li>
            <li>
              <strong>العودة للنظام:</strong>
              <span>ستحتاج لإدخال اسم المستخدم وكلمة المرور للدخول مجدداً، أو يمكنك التبديل المباشر.</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="confirm-dialog-footer">
        <button class="btn-confirm-action danger" onclick="App.executeLogout()">
          <span>🚪</span> نعم، تسجيل الخروج
        </button>
        <button class="btn-confirm-action switch" onclick="App.closeConfirmModal(); App.openLoginModal();">
          <span>🔄</span> تبديل الحساب مباشرة
        </button>
        <button class="btn-confirm-action cancel" onclick="App.closeConfirmModal()">
          <span>✕</span> البقاء في الحساب
        </button>
      </div>
    `;

    this.showCustomConfirm(html);
  },

  executeLogout() {
    this.closeConfirmModal();
    if (window.FDB) window.FDB.logout();
    this.db.currentUser = null;
    this.syncDB();
    this.showToast('تم تسجيل الخروج بنجاح 👋');
    this.lockAppForLogin();
    setTimeout(() => {
      this.openLoginModal(true);
    }, 200);
  },

  openLoginModal(isMandatory = false) {
    const isLocked = isMandatory || !this.getCurrentUser();
    const modalHtml = `
      <div class="login-card-modal">
        ${!isLocked ? `
          <button type="button" class="login-modal-close-btn" onclick="App.closeModal()" title="إغلاق">✕</button>
        ` : ''}
        <div class="login-modal-brand">
          <div class="login-brand-icon">H</div>
          <h2 class="login-brand-title">Hossam ERP <span class="brand-badge">جملة</span></h2>
          <p class="login-brand-sub">نظام إدارة وتوزيع مخزون السجاير بالقروصة</p>
        </div>

        <div class="login-status-pill">
          <span class="status-dot-pulse"></span>
          <span>يرجى إدخال بيانات حسابك لتسجيل الدخول</span>
        </div>

        <form class="login-form-body" onsubmit="event.preventDefault(); App.submitLogin();">
          <div class="form-group">
            <label class="form-label" for="login-input-username">اسم المستخدم أو البريد الإلكتروني *</label>
            <div class="input-with-icon">
              <span class="field-icon">👤</span>
              <input type="text" id="login-input-username" class="form-control" placeholder="أدخل اسم المستخدم أو البريد" autocomplete="username" required>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="login-input-password">كلمة المرور *</label>
            <div class="input-with-icon password-input-wrap">
              <span class="field-icon">🔑</span>
              <input type="password" id="login-input-password" class="form-control" placeholder="أدخل كلمة المرور" autocomplete="current-password" required>
              <button type="button" class="password-toggle-btn" onclick="App.togglePasswordVisibility('login-input-password', this)">
                👁️ إظهار
              </button>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-login-submit" id="btn-login-submit">
            <span>🔐</span> دخول للنظام
          </button>
        </form>
      </div>
    `;

    this.openModal(modalHtml, '440px', isLocked);
    setTimeout(() => {
      const userInp = document.getElementById('login-input-username');
      if (userInp) userInp.focus();
    }, 150);
  },

  async submitLogin() {
    const username = (document.getElementById('login-input-username')?.value || '').trim();
    const password = (document.getElementById('login-input-password')?.value || '').trim();
    const submitBtn = document.getElementById('btn-login-submit');

    if (!username || !password) {
      this.showToast('يرجى إدخال اسم المستخدم وكلمة المرور', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>⏳</span> جاري التحقق من الحساب عبر Firebase...`;
    }

    try {
      // 1. Direct Authentication via Firebase Auth
      if (window.FDB) {
        const fbRes = await window.FDB.login(username, password);
        if (fbRes.success && fbRes.user) {
          const authEmail = (fbRes.user.email || '').toLowerCase();
          let userObj = (this.db.users || []).find(u => 
            (u.email && u.email.toLowerCase() === authEmail) || 
            (u.username && u.username.toLowerCase() === username.toLowerCase()) ||
            u.id === fbRes.user.uid
          );

          const isRootAdmin = authEmail.includes('admin') || username.toLowerCase() === 'admin';

          if (!userObj) {
            userObj = {
              id: fbRes.user.uid,
              name: isRootAdmin ? 'حسام (المدير العام)' : (fbRes.user.displayName || username),
              username: username,
              email: fbRes.user.email,
              role: isRootAdmin ? 'مدير النظام (أدمن)' : 'مستخدم',
              status: 'active',
              permissions: isRootAdmin ? ['كافة الصلاحيات'] : []
            };
            if (window.FDB.setDocument) {
              window.FDB.setDocument('users', userObj.id, userObj).catch(() => {});
            }
          }

          if (userObj.status && userObj.status !== 'active') {
            this.showToast('هذا الحساب معطل، يرجى مراجعة إدارة النظام', 'error');
            return;
          }

          this.loginAsUser(userObj);
          return;
        }
      }

      // 2. Validate against Firestore synced users
      const cleanUsername = username.toLowerCase();
      const foundUser = (this.db.users || []).find(u => {
        const uLogin = (u.username || '').toLowerCase();
        const uFullName = (u.name || '').toLowerCase();
        const uEmail = (u.email || '').toLowerCase();
        const isLoginMatch = (uLogin === cleanUsername || uFullName === cleanUsername || uEmail === cleanUsername);
        const isPassMatch = (u.password === password);
        return isLoginMatch && isPassMatch;
      });

      if (foundUser) {
        if (foundUser.status !== 'active') {
          this.showToast('هذا الحساب معطل، يرجى مراجعة إدارة النظام', 'error');
          return;
        }
        this.loginAsUser(foundUser);
        return;
      }

      this.showToast('بيانات الدخول غير صحيحة، يرجى التحقق من اسم المستخدم وكلمة المرور', 'error');
    } catch (err) {
      console.error('Login error:', err);
      this.showToast('حدث خطأ أثناء محاولة تسجيل الدخول', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>🔐</span> دخول للنظام`;
      }
    }
  },

  loginAsUser(user) {
    const isHossamOrAdmin = user.id === 'user_1' || 
                            user.id === 'admin_root' ||
                            (user.name && user.name.includes('حسام')) || 
                            user.username === 'admin' || 
                            user.username === 'hossam' ||
                            (user.role && (user.role.includes('مدير') || user.role.includes('أدمن')));

    const allAdminPermissions = [
      'كافة الصلاحيات',
      'الخزينة والمصروفات',
      'الأسعار وسياسة البيع',
      'المخزون وإدخال الشحنات',
      'إدارة المستخدمين والإعدادات',
      'التقارير والأرباح',
      'نقطة بيع المندوب',
      'مبيعات المخزن (كاشير)',
      'سندات قبض وتحصيل',
      'إدارة العملاء والديون',
      'إدارة المناديب والعهد'
    ];

    if (isHossamOrAdmin) {
      user.role = 'مدير النظام (أدمن)';
      user.status = 'active';
      user.permissions = allAdminPermissions;
      this.activeRepForPOS = null;
      this.posActiveTab = 'main';
      this.currentCart.sellerType = 'الإدارة (الرئيسية)';
      this.currentCart.sellerId = null;
      this.currentCart.sellerName = user.name || 'حسام (المدير العام)';
      this.currentCart.items = [];
    }

    this.db.currentUser = user;

    // Sync in this.db.users list
    const idx = (this.db.users || []).findIndex(u => u.id === user.id || u.username === user.username);
    if (idx !== -1) {
      this.db.users[idx] = { ...this.db.users[idx], ...user };
    }

    this._isMandatoryModal = false;
    this.closeModal();
    this.unlockAppAfterLogin();
    this.showToast(`أهلاً بك، تم تسجيل الدخول بنجاح كـ ${user.name}`);
  },

  // Backup: Download JSON
  downloadBackupJSON() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.db, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `Hossam_ERP_Backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchor.click();
    this.showToast('تم تصدير النسخة الاحتياطية بنجاح');
  },

  // Restore JSON
  restoreBackupJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed.items && parsed.customers && parsed.reps) {
          this.db = parsed;
          this.syncDB();
          this.showToast('تمت استعادة النسخة الاحتياطية بنجاح!');
          location.reload();
        } else {
          this.showToast('ملف النسخة الاحتياطية غير متوافق', 'error');
        }
      } catch (err) {
        this.showToast('حدث خطأ في قراءة ملف النسخة الاحتياطية', 'error');
      }
    };
    reader.readAsText(file);
  },

  // Reset entire database to factory defaults
  async resetToDefaults() {
    const confirmed = await this.confirmDialog({
      title: 'استعادة ضبط المصنع',
      subtitle: 'إشعار أمان حرج للغاية لإعادة ضبط النظام',
      message: 'هل أنت متأكد من استعادة بيانات المصنع الافتراضية؟',
      icon: '⚠️',
      type: 'danger',
      detailsHtml: `
        <div class="confirm-warning-note" style="font-size: 0.9rem; padding: 14px;">
          ⚠️ <strong>تحذير خطير ومباشر:</strong>
          سيتم مسح جميع الفواتير الجديدة، حركات الخزينة، الأصناف المضافة والعملاء المسجلين، والعودة إلى البيانات الافتراضية الأولى للمصنع. هذا الإجراء لا يمكن الرجوع عنه!
        </div>
      `,
      confirmText: 'نعم، استعادة ضبط المصنع',
      cancelText: 'إلغاء وتراجع'
    });

    if (!confirmed) return;

    this.db = window.DBManager.reset();
    this.showToast('تمت استعادة البيانات الافتراضية بنجاح');
    setTimeout(() => location.reload(), 300);
  },

  // ==========================================
  // GLOBAL SEARCH (HEADER)
  // ==========================================
  handleGlobalSearch(query, dropdown) {
    if (!query || query.length < 2) {
      dropdown.classList.remove('show');
      return;
    }

    const q = query.toLowerCase();

    // 1. Search Invoices
    const invoices = this.db.invoices.filter(i => i.id.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q)).slice(0, 4);
    // 2. Search Customers
    const customers = this.db.customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))).slice(0, 4);
    // 3. Search Items
    const items = this.db.items.filter(i => i.name.toLowerCase().includes(q) || (i.barcode && i.barcode.includes(q))).slice(0, 4);

    if (invoices.length === 0 && customers.length === 0 && items.length === 0) {
      dropdown.innerHTML = `<div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">لا توجد نتائج مطابقة لـ "${query}"</div>`;
      dropdown.classList.add('show');
      return;
    }

    let html = '';

    if (invoices.length > 0) {
      html += `<div style="padding: 8px 14px; font-size: 0.75rem; font-weight: 700; color: var(--gold); background: var(--bg-input);">🧾 فواتير المبيعات</div>`;
      invoices.forEach(inv => {
        html += `
          <div class="search-result-item" onclick="App.viewInvoiceModal('${inv.id}')">
            <div>
              <strong style="color: var(--gold);">${inv.id}</strong> - ${inv.customerName}
              <div style="font-size: 0.75rem; color: var(--text-muted);">${inv.date}</div>
            </div>
            <span style="font-weight: 700;">${this.formatMoney(inv.grandTotal)} ج.م</span>
          </div>
        `;
      });
    }

    if (customers.length > 0) {
      html += `<div style="padding: 8px 14px; font-size: 0.75rem; font-weight: 700; color: var(--emerald); background: var(--bg-input);">👤 العملاء</div>`;
      customers.forEach(cust => {
        html += `
          <div class="search-result-item" onclick="App.navigateTo('customers')">
            <div>
              <strong>${cust.name}</strong> (📞 ${cust.phone})
            </div>
            <span style="color: var(--rose); font-size: 0.8rem;">دين: ${this.formatMoney(cust.currentDebt)} ج.م</span>
          </div>
        `;
      });
    }

    if (items.length > 0) {
      html += `<div style="padding: 8px 14px; font-size: 0.75rem; font-weight: 700; color: var(--blue); background: var(--bg-input);">📦 المخزون والأصناف</div>`;
      items.forEach(it => {
        html += `
          <div class="search-result-item" onclick="App.navigateTo('inventory')">
            <div>
              <strong>${it.icon || '📦'} ${it.name}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">باركود: ${it.barcode}</div>
            </div>
            <span style="color: var(--gold); font-weight: 700;">${it.cartonsInStock} قروصة</span>
          </div>
        `;
      });
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('show');
  },

  // ==========================================
  // MODAL UTILITIES
  // ==========================================
  _isMandatoryModal: false,

  openModal(contentHtml, customMaxWidth = '580px', isMandatory = false) {
    this._isMandatoryModal = !!isMandatory;
    let overlay = document.getElementById('global-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'global-modal-overlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `<div id="global-modal-container" class="modal-content"></div>`;
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && !this._isMandatoryModal) App.closeModal();
      });
    }

    const container = document.getElementById('global-modal-container');
    if (container) {
      container.style.maxWidth = customMaxWidth || '580px';
      container.innerHTML = contentHtml;
    }
    if (this._isMandatoryModal) {
      overlay.classList.add('mandatory-auth');
    } else {
      overlay.classList.remove('mandatory-auth');
    }
    overlay.classList.add('show');
  },

  closeModal() {
    if (this._isMandatoryModal && (!this.db || !this.db.currentUser)) {
      return; // Cannot dismiss mandatory modal before authenticating
    }
    this._isMandatoryModal = false;
    const overlay = document.getElementById('global-modal-overlay');
    if (overlay) {
      overlay.classList.remove('show');
      overlay.classList.remove('mandatory-auth');
    }
    const container = document.getElementById('global-modal-container');
    if (container) container.style.maxWidth = '580px';
  },

  // ==========================================
  // ELEGANT CUSTOM CONFIRM & ALERT MODAL
  // ==========================================
  showCustomConfirm(contentHtml, typeClass = '') {
    let overlay = document.getElementById('custom-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-confirm-overlay';
      overlay.className = 'confirm-dialog-overlay';
      overlay.innerHTML = `<div id="custom-confirm-container" class="confirm-dialog-card ${typeClass}"></div>`;
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) App.closeConfirmModal();
      });
    }

    const container = document.getElementById('custom-confirm-container');
    if (container) {
      container.className = `confirm-dialog-card ${typeClass}`;
      container.innerHTML = contentHtml;
    }
    overlay.classList.add('show');

    // Handle escape key
    if (this._confirmKeyHandler) {
      window.removeEventListener('keydown', this._confirmKeyHandler);
    }
    this._confirmKeyHandler = (e) => {
      if (e.key === 'Escape') {
        App.closeConfirmModal();
      }
    };
    window.addEventListener('keydown', this._confirmKeyHandler);
  },

  closeConfirmModal() {
    const overlay = document.getElementById('custom-confirm-overlay');
    if (overlay) overlay.classList.remove('show');
    if (this._confirmKeyHandler) {
      window.removeEventListener('keydown', this._confirmKeyHandler);
      this._confirmKeyHandler = null;
    }
    if (this._confirmActiveReject) {
      this._confirmActiveReject(false);
      this._confirmActiveReject = null;
    }
  },

  confirmDialog(options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'تأكيد العملية',
        subtitle = 'يرجى مراجعة تفاصيل العملية قبل المتابعة',
        message = '',
        detailsHtml = '',
        icon = '⚠️',
        type = 'danger', // 'danger', 'warning', 'info', 'success'
        confirmText = 'نعم، تأكيد ومتابعة',
        cancelText = 'إلغاء وتراجع'
      } = options;

      const typeClass = `type-${type}`;
      const html = `
        <div class="confirm-dialog-header">
          <div class="confirm-dialog-icon-ring ${type}">
            <span class="confirm-icon">${icon}</span>
          </div>
          <div class="confirm-dialog-headings">
            <h3 class="confirm-dialog-title">${title}</h3>
            <p class="confirm-dialog-subtitle">${subtitle}</p>
          </div>
          <button class="confirm-dialog-close-btn" id="confirm-dlg-close-btn" title="إغلاق">✕</button>
        </div>

        <div class="confirm-dialog-body">
          ${message ? `<div class="confirm-main-message">${message}</div>` : ''}
          ${detailsHtml ? `<div class="confirm-details-wrapper">${detailsHtml}</div>` : ''}
        </div>

        <div class="confirm-dialog-footer">
          <button class="btn-confirm-action ${type}" id="confirm-dlg-btn-ok">
            <span>✓</span> ${confirmText}
          </button>
          <button class="btn-confirm-action cancel" id="confirm-dlg-btn-cancel">
            <span>✕</span> ${cancelText}
          </button>
        </div>
      `;

      this.showCustomConfirm(html, typeClass);

      const finish = (result) => {
        this._confirmActiveReject = null;
        this.closeConfirmModal();
        resolve(result);
      };

      this._confirmActiveReject = () => {
        resolve(false);
      };

      const btnOk = document.getElementById('confirm-dlg-btn-ok');
      const btnCancel = document.getElementById('confirm-dlg-btn-cancel');
      const btnClose = document.getElementById('confirm-dlg-close-btn');

      if (btnOk) btnOk.onclick = () => finish(true);
      if (btnCancel) btnCancel.onclick = () => finish(false);
      if (btnClose) btnClose.onclick = () => finish(false);
    });
  }
};

// Expose App globally
window.App = App;
