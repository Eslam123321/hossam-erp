/* ==========================================================================
   Hossam ERP - Data Layer & Firestore State Management
   ========================================================================== */

const STORAGE_KEY = 'HOSSAM_ERP_FIRESTORE_LIVE_V3';

// Completely purge any legacy mock/demo data and cached user session from browser storage
try {
  localStorage.removeItem('HOSSAM_ERP_FIRESTORE_LIVE_V2');
  localStorage.removeItem('HOSSAM_ERP_FIRESTORE_LIVE_V1');
  localStorage.removeItem('HOSSAM_ERP_DATABASE_V2');
  localStorage.removeItem('HOSSAM_ERP_DATABASE');
  const cachedV3 = localStorage.getItem(STORAGE_KEY);
  if (cachedV3) {
    const parsed = JSON.parse(cachedV3);
    if (parsed && parsed.currentUser) {
      parsed.currentUser = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
  }
} catch (e) {}

const defaultAdminUser = {
  id: 'admin_root',
  name: 'حسام (المدير العام)',
  email: 'admin@hossam-erp.com',
  username: 'admin',
  password: '01095412229',
  role: 'مدير النظام (أدمن)',
  phone: '01095412229',
  status: 'active',
  permissions: [
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
  ]
};

// 100% Clean initial database with admin account configured
const defaultDatabase = {
  currentUser: null,
  items: [],
  customers: [],
  reps: [],
  invoices: [],
  treasury: 0,
  treasuryLogs: [],
  notifications: [],
  users: [defaultAdminUser],
  settings: {
    systemName: 'Hossam ERP',
    businessName: '',
    ownerName: 'حسام',
    phone: '01095412229',
    address: '',
    currency: 'ج.م',
    receiptFooter: '',
    lowStockThreshold: 15
  },
  capital: 0
};

// Data Layer Manager interfacing with Local Cache and Firestore
class DBManager {
  static load() {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          ...defaultDatabase,
          ...parsed,
          currentUser: null, // Always require manual authentication on load/refresh
          capital: typeof parsed.capital === 'number' ? parsed.capital : 0,
          items: Array.isArray(parsed.items) ? parsed.items : [],
          customers: Array.isArray(parsed.customers) ? parsed.customers : [],
          reps: Array.isArray(parsed.reps) ? parsed.reps.map(r => ({
            ...r,
            assignedCustomerIds: Array.isArray(r.assignedCustomerIds) ? r.assignedCustomerIds : [],
            activeCustody: Array.isArray(r.activeCustody) ? r.activeCustody : []
          })) : [],
          invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
          treasury: typeof parsed.treasury === 'number' ? parsed.treasury : 0,
          treasuryLogs: Array.isArray(parsed.treasuryLogs) ? parsed.treasuryLogs : [],
          users: (Array.isArray(parsed.users) && parsed.users.length > 0) ? parsed.users : [defaultAdminUser],
          notifications: Array.isArray(parsed.notifications) ? parsed.notifications : []
        };
      }
    } catch (e) {
      console.warn('Could not read cached DB, starting completely empty:', e);
    }
    return JSON.parse(JSON.stringify(defaultDatabase));
  }

  static _saveTimer = null;

  static save(db) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      } catch (e) {
        console.error('Error saving cache:', e);
      }
    }, 80);
  }

  static reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('HOSSAM_ERP_DATABASE_V2');
    } catch (e) {}
    return JSON.parse(JSON.stringify(defaultDatabase));
  }
}

// Global active instance
window.ERP_DB = DBManager.load();
window.DBManager = DBManager;
