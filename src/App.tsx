import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, 
  Package, 
  ArrowLeftRight, 
  FileText, 
  BrainCircuit, 
  Plus, 
  Download, 
  AlertTriangle,
  LogOut,
  User,
  Search,
  Filter,
  ChevronRight,
  Menu,
  X,
  Loader2,
  Trash2,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ClipboardCheck,
  CalendarRange
} from 'lucide-react';
import { 
  auth, 
  db 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  serverTimestamp, 
  query, 
  orderBy,
  getDocs,
  where
} from 'firebase/firestore';
import { analyzeInventory } from './geminiService';
import ReactMarkdown from 'react-markdown';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
  AreaChart,
  Area,
  Legend
} from 'recharts';

// --- Types ---
interface Category { id: string; name: string; }
interface Department { id: string; name: string; }
interface Item { 
  id: string; 
  name: string; 
  categoryId: string; 
  unit: string; 
  minStock: number; 
  currentStock: number; 
  expiryDate?: string;
  price?: number;
  createdAt?: any;
}
interface Holiday {
  id: string;
  date: string;
  note?: string;
}
interface Transaction {
  id: string;
  itemId: string;
  type: 'IN' | 'OUT' | 'TRANSFER';
  fromDeptId?: string;
  toDeptId?: string;
  quantity: number;
  timestamp: any;
  note?: string;
}

interface AiAnalysis {
  summary: string;
  alerts: { type: 'danger' | 'warning' | 'info'; message: string; item?: string }[];
  recommendations: { action: string; priority: 'high' | 'medium' | 'low'; reason: string }[];
  anomalies: { description: string; severity: 'high' | 'medium' | 'low' }[];
  detailedAnalysis: string;
}

// --- Utils ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const formatDate = (dateStr: string | undefined) => {
  if (!dateStr) return '-';
  // Input is usually yyyy-mm-dd from <input type="date">
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  }
  // If it's already dd/mm/yyyy, return as is
  if (dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) return dateStr;
  return dateStr;
};

const normalizeDate = (dateVal: any) => {
  if (!dateVal) return '';
  if (typeof dateVal === 'number') {
    // Excel serial date
    const date = new Date((dateVal - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  const dateStr = String(dateVal).trim();
  // Handle dd/mm/yyyy
  const ddmm_yyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmm_yyyy) {
    const [_, d, m, y] = ddmm_yyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Handle yyyy-mm-dd
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
  return dateStr;
};

const getWorkingDays = (startDate: Date, endDate: Date, holidays: Holiday[]) => {
  let count = 0;
  const curDate = new Date(startDate.getTime());
  // Normalize to start of day
  curDate.setHours(0, 0, 0, 0);
  const end = new Date(endDate.getTime());
  end.setHours(0, 0, 0, 0);

  while (curDate <= end) {
    const dateStr = curDate.toISOString().split('T')[0];
    const isHoliday = holidays.some(h => h.date === dateStr);
    if (!isHoliday) {
      count++;
    }
    curDate.setDate(curDate.getDate() + 1);
  }
  return count;
};

const formatTimestamp = (timestamp: any) => {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  // Data States
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [globalSearch, setGlobalSearch] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // AI States
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Data Fetching ---
  useEffect(() => {
    if (!user) return;

    const unsubCats = onSnapshot(collection(db, "categories"), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Category)));
    }, (error) => handleFirestoreError(error, OperationType.GET, "categories"));

    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => {
      setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
    }, (error) => handleFirestoreError(error, OperationType.GET, "departments"));

    const unsubItems = onSnapshot(collection(db, "items"), (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as Item)));
    }, (error) => handleFirestoreError(error, OperationType.GET, "items"));

    const unsubTrans = onSnapshot(query(collection(db, "transactions"), orderBy("timestamp", "desc")), (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
    }, (error) => handleFirestoreError(error, OperationType.GET, "transactions"));

    const unsubHolidays = onSnapshot(collection(db, "holidays"), (snap) => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)));
    }, (error) => handleFirestoreError(error, OperationType.GET, "holidays"));

    return () => {
      unsubCats();
      unsubDepts();
      unsubItems();
      unsubTrans();
      unsubHolidays();
    };
  }, [user]);

  // --- AI Analysis ---
  const runAiAnalysis = async () => {
    setIsAnalyzing(true);
    const result = await analyzeInventory();
    setAiAnalysis(result);
    setIsAnalyzing(false);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
            <Package className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Kho Vật Tư CDHA</h1>
          <p className="text-slate-500 mb-8">Hệ thống quản lý vật tư y tế thông minh tích hợp AI dành cho khoa Chẩn đoán hình ảnh.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-100 active:scale-95"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Đăng nhập với Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:inset-0
      `}>
        <div className="h-full flex flex-col">
          <div className="p-6 flex items-center gap-3 border-bottom border-slate-100">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md">
              <Package className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-xl text-slate-900">CDHA Inventory</span>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-2">
            <NavItem 
              icon={<LayoutDashboard />} 
              label="Tổng quan" 
              active={activeTab === 'dashboard'} 
              onClick={() => {setActiveTab('dashboard'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<Package />} 
              label="Kho vật tư" 
              active={activeTab === 'inventory'} 
              onClick={() => {setActiveTab('inventory'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<ArrowLeftRight />} 
              label="Giao dịch" 
              active={activeTab === 'transactions'} 
              onClick={() => {setActiveTab('transactions'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<ClipboardCheck />} 
              label="Kiểm kê kho" 
              active={activeTab === 'audit'} 
              onClick={() => {setActiveTab('audit'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<CalendarRange />} 
              label="Dự trù vật tư" 
              active={activeTab === 'planning'} 
              onClick={() => {setActiveTab('planning'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<FileText />} 
              label="Báo cáo" 
              active={activeTab === 'reports'} 
              onClick={() => {setActiveTab('reports'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<Calendar />} 
              label="Ngày nghỉ" 
              active={activeTab === 'holidays'} 
              onClick={() => {setActiveTab('holidays'); setSidebarOpen(false);}} 
            />
            <NavItem 
              icon={<BrainCircuit />} 
              label="Trợ lý AI" 
              active={activeTab === 'assistant'} 
              onClick={() => {setActiveTab('assistant'); setSidebarOpen(false);}} 
            />
          </nav>

          <div className="p-4 border-t border-slate-100">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
              <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" alt="User" />
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
              <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-40">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-slate-500">
            <Menu className="w-6 h-6" />
          </button>
          <h2 className="text-lg font-semibold text-slate-900 capitalize">
            {activeTab === 'dashboard' ? 'Bảng điều khiển' : 
             activeTab === 'inventory' ? 'Quản lý kho' : 
             activeTab === 'transactions' ? 'Lịch sử giao dịch' : 
             activeTab === 'audit' ? 'Kiểm kê kho' :
             activeTab === 'planning' ? 'Dự trù vật tư' :
             activeTab === 'reports' ? 'Báo cáo thống kê' : 
             activeTab === 'holidays' ? 'Quản lý ngày nghỉ' : 'Trợ lý AI Gemini'}
          </h2>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block" ref={searchRef}>
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Tìm kiếm vật tư..." 
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  setShowSearchResults(true);
                }}
                onFocus={() => setShowSearchResults(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setActiveTab('inventory');
                    setShowSearchResults(false);
                  }
                }}
                className="pl-10 pr-10 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 w-64"
              />
              {globalSearch && (
                <button 
                  onClick={() => {
                    setGlobalSearch('');
                    setShowSearchResults(false);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {globalSearch && showSearchResults && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-slate-200 max-h-96 overflow-y-auto z-50">
                  <div className="p-2 text-xs font-medium text-slate-500 border-bottom border-slate-100 bg-slate-50">
                    Kết quả tìm kiếm ({items.filter(i => i.name.toLowerCase().includes(globalSearch.toLowerCase())).length})
                  </div>
                  {items
                    .filter(i => i.name.toLowerCase().includes(globalSearch.toLowerCase()))
                    .slice(0, 10)
                    .map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab('inventory');
                          setShowSearchResults(false);
                          // We keep the search term so the inventory is filtered
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between group"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-700 group-hover:text-blue-600">{item.name}</p>
                          <p className="text-xs text-slate-500">{categories.find(c => c.id === item.categoryId)?.name || 'Chưa phân loại'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-slate-700">{item.currentStock} {item.unit}</p>
                          <p className={`text-[10px] ${item.currentStock <= item.minStock ? 'text-red-500' : 'text-green-500'}`}>
                            {item.currentStock <= item.minStock ? 'Sắp hết' : 'Ổn định'}
                          </p>
                        </div>
                      </button>
                    ))}
                  {items.filter(i => i.name.toLowerCase().includes(globalSearch.toLowerCase())).length > 10 && (
                    <button 
                      onClick={() => {
                        setActiveTab('inventory');
                        setShowSearchResults(false);
                      }}
                      className="w-full py-2 text-center text-xs text-blue-600 font-medium hover:bg-blue-50"
                    >
                      Xem tất cả kết quả
                    </button>
                  )}
                  {items.filter(i => i.name.toLowerCase().includes(globalSearch.toLowerCase())).length === 0 && (
                    <div className="p-4 text-center text-sm text-slate-500 italic">
                      Không tìm thấy vật tư nào
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          {activeTab === 'dashboard' && (
            <Dashboard 
              items={items} 
              transactions={transactions} 
              categories={categories} 
              aiAnalysis={aiAnalysis}
              onRunAnalysis={runAiAnalysis}
              isAnalyzing={isAnalyzing}
              setActiveTab={setActiveTab}
              globalSearch={globalSearch}
            />
          )}
          {activeTab === 'inventory' && <Inventory items={items} categories={categories} globalSearch={globalSearch} />}
          {activeTab === 'transactions' && <Transactions transactions={transactions} items={items} departments={departments} categories={categories} globalSearch={globalSearch} />}
          {activeTab === 'audit' && <InventoryAudit items={items} categories={categories} globalSearch={globalSearch} />}
          {activeTab === 'planning' && <InventoryPlanning items={items} transactions={transactions} categories={categories} holidays={holidays} globalSearch={globalSearch} />}
          {activeTab === 'reports' && <Reports transactions={transactions} items={items} categories={categories} holidays={holidays} globalSearch={globalSearch} />}
          {activeTab === 'holidays' && <Holidays holidays={holidays} />}
          {activeTab === 'assistant' && (
            <AiAssistant 
              analysis={aiAnalysis} 
              isAnalyzing={isAnalyzing} 
              onAnalyze={runAiAnalysis} 
            />
          )}
        </div>
      </main>
    </div>
  );
}

// --- Sub-components ---

function NavItem({ icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all
        ${active ? 'bg-blue-50 text-blue-600 font-semibold shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}
      `}
    >
      {React.cloneElement(icon, { className: 'w-5 h-5' })}
      <span>{label}</span>
    </button>
  );
}

function Dashboard({ 
  items, 
  transactions, 
  categories, 
  aiAnalysis, 
  onRunAnalysis, 
  isAnalyzing,
  setActiveTab,
  globalSearch
}: { 
  items: Item[], 
  transactions: Transaction[], 
  categories: Category[],
  aiAnalysis: AiAnalysis | null,
  onRunAnalysis: () => void,
  isAnalyzing: boolean,
  setActiveTab: (tab: string) => void,
  globalSearch: string
}) {
  const filteredItems = useMemo(() => {
    if (!globalSearch) return items;
    return items.filter(i => i.name.toLowerCase().includes(globalSearch.toLowerCase()));
  }, [items, globalSearch]);

  const lowStockItems = filteredItems.filter(i => i.currentStock <= i.minStock);
  const expiredItems = filteredItems.filter(i => i.expiryDate && new Date(i.expiryDate) < new Date());
  const safeItems = filteredItems.filter(i => i.currentStock > i.minStock && (!i.expiryDate || new Date(i.expiryDate) >= new Date()));

  // Total Inventory Value
  const totalValue = filteredItems.reduce((sum, item) => sum + (item.currentStock * (item.price || 0)), 0);

  // Health Score (0-100)
  const healthScore = filteredItems.length > 0 ? Math.round((safeItems.length / filteredItems.length) * 100) : 100;

  // Category Distribution Data
  const categoryData = Array.from(
    categories.reduce((acc, cat) => {
      const count = filteredItems.filter(i => i.categoryId === cat.id).length;
      const existing = acc.get(cat.name) || 0;
      acc.set(cat.name, existing + count);
      return acc;
    }, new Map<string, number>())
  )
    .map(([name, value]) => ({ name, value }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  // Stock Status Data
  const statusData = [
    { name: 'An toàn', value: safeItems.length, color: '#10b981' },
    { name: 'Sắp hết', value: lowStockItems.length, color: '#f59e0b' },
    { name: 'Hết hạn', value: expiredItems.length, color: '#ef4444' },
  ].filter(d => d.value > 0);

  // Transaction History (Last 7 days)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const transactionHistory = last7Days.map(date => {
    const dayTransactions = transactions.filter(t => {
      const tDate = t.timestamp?.toDate ? t.timestamp.toDate().toISOString().split('T')[0] : '';
      return tDate === date;
    });
    const nhập = dayTransactions.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.quantity, 0);
    const xuất = dayTransactions.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.quantity, 0);
    return {
      date: new Date(date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      nhập,
      xuất
    };
  });

  // Top Consumed Items
  const topConsumed = Array.from(
    transactions
      .filter(t => t.type === 'OUT')
      .reduce((acc, t) => {
        const item = filteredItems.find(i => i.id === t.itemId);
        if (!item && globalSearch) return acc; // Filter out if not in search results
        const existing = acc.get(t.itemId) || 0;
        acc.set(t.itemId, existing + t.quantity);
        return acc;
      }, new Map<string, number>())
  )
    .map(([itemId, total]) => {
      const item = items.find(i => i.id === itemId);
      return { name: item?.name || 'Vật tư đã xóa', total, unit: item?.unit || '' };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1
    }
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8 pb-8"
    >
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Tổng quan kho</h2>
          <p className="text-slate-500">Hệ thống quản lý vật tư y tế thông minh CDHA.</p>
          {globalSearch && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-2 text-blue-700">
                <Search className="w-4 h-4" />
                <span className="text-sm font-medium">Đang lọc theo: <strong>"{globalSearch}"</strong></span>
              </div>
              <button 
                onClick={() => setActiveTab('inventory')}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Xem chi tiết trong Kho vật tư
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
            <Calendar className="w-4 h-4" />
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <button 
            onClick={() => setActiveTab('assistant')}
            className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
          >
            <BrainCircuit className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Stats Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div variants={itemVariants}>
          <StatCard 
            label="Tổng vật tư" 
            value={filteredItems.length} 
            icon={<Package className="text-blue-600" />} 
            color="bg-blue-50"
            trend="+2.5%"
            isUp={true}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard 
            label="Sắp hết hàng" 
            value={lowStockItems.length} 
            icon={<AlertTriangle className="text-amber-600" />} 
            color="bg-amber-50"
            trend={lowStockItems.length > 5 ? "+12%" : "-5%"}
            isUp={lowStockItems.length > 5}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard 
            label="Giá trị kho" 
            value={totalValue.toLocaleString('vi-VN') + ' đ'} 
            icon={<FileText className="text-purple-600" />} 
            color="bg-purple-50"
            trend="+5.2%"
            isUp={true}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-full group hover:border-blue-200 transition-colors">
            <div className="flex justify-between items-start">
              <p className="text-sm font-medium text-slate-500">Chỉ số sức khỏe kho</p>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${healthScore > 80 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-end gap-2">
                <p className="text-3xl font-bold text-slate-900">{healthScore}%</p>
                <span className="text-xs text-slate-400 mb-1.5">An toàn</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full mt-3 overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${healthScore}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full rounded-full ${healthScore > 80 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* AI & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-2xl shadow-xl shadow-blue-200 text-white relative overflow-hidden h-full">
            <div className="relative z-10 h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                    <BrainCircuit className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Phân tích AI thông minh</h3>
                    <p className="text-blue-100 text-xs">Dự báo và tối ưu hóa tồn kho</p>
                  </div>
                </div>
                <button 
                  onClick={onRunAnalysis}
                  disabled={isAnalyzing}
                  className="px-6 py-2 bg-white text-blue-600 hover:bg-blue-50 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-black/10 disabled:opacity-50"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                  {aiAnalysis ? 'Cập nhật phân tích' : 'Chạy phân tích'}
                </button>
              </div>
              
              <div className="flex-1 bg-white/10 p-6 rounded-2xl backdrop-blur-sm border border-white/10 overflow-hidden relative">
                {aiAnalysis ? (
                  <div className="h-full flex flex-col justify-center">
                    <p className="text-lg font-medium text-blue-50 leading-relaxed italic">
                      "{aiAnalysis.summary}"
                    </p>
                    <div className="mt-4 flex gap-2">
                      {aiAnalysis.alerts.length > 0 && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-100 text-[10px] font-bold rounded-lg border border-red-500/30">
                          {aiAnalysis.alerts.length} Cảnh báo
                        </span>
                      )}
                      {aiAnalysis.recommendations.length > 0 && (
                        <span className="px-2 py-1 bg-emerald-500/20 text-emerald-100 text-[10px] font-bold rounded-lg border border-emerald-500/30">
                          {aiAnalysis.recommendations.length} Đề xuất
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                    <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center animate-pulse">
                      <BrainCircuit className="w-8 h-8 text-blue-200" />
                    </div>
                    <p className="text-blue-100 text-sm max-w-xs">Nhấn nút để AI phân tích dữ liệu kho và đưa ra các đề xuất tối ưu.</p>
                  </div>
                )}
                {aiAnalysis && (
                  <button 
                    onClick={() => setActiveTab('assistant')}
                    className="absolute bottom-4 right-4 text-xs font-bold text-white hover:underline flex items-center gap-1"
                  >
                    Xem chi tiết <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="absolute -right-20 -bottom-20 opacity-10 pointer-events-none">
              <BrainCircuit size={300} />
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants}>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Thao tác nhanh
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <QuickActionButton 
                icon={<Plus />} 
                label="Thêm vật tư" 
                color="blue" 
                onClick={() => setActiveTab('inventory')} 
              />
              <QuickActionButton 
                icon={<ArrowLeftRight />} 
                label="Giao dịch" 
                color="emerald" 
                onClick={() => setActiveTab('transactions')} 
              />
              <QuickActionButton 
                icon={<FileText />} 
                label="Báo cáo" 
                color="purple" 
                onClick={() => setActiveTab('reports')} 
              />
              <QuickActionButton 
                icon={<Download />} 
                label="Nhập Excel" 
                color="amber" 
                onClick={() => setActiveTab('inventory')} 
              />
              <QuickActionButton 
                icon={<BrainCircuit />} 
                label="Trợ lý AI" 
                color="pink" 
                onClick={() => setActiveTab('assistant')} 
              />
            </div>
            
            <div className="mt-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tiêu thụ nhiều nhất</h4>
                <TrendingDown className="w-3 h-3 text-red-500" />
              </div>
              <div className="space-y-3">
                {topConsumed.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm text-slate-700 truncate max-w-[120px]">{item.name}</span>
                    <span className="text-xs font-bold text-slate-900">{item.total} {item.unit}</span>
                  </div>
                ))}
                {topConsumed.length === 0 && <p className="text-xs text-slate-400 italic">Chưa có dữ liệu xuất kho.</p>}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Main Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={itemVariants} className="lg:col-span-2 min-w-0">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Lưu lượng giao dịch</h3>
                <p className="text-xs text-slate-500">Thống kê nhập/xuất trong 7 ngày gần nhất</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-slate-600">Nhập kho</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  <span className="text-slate-600">Xuất kho</span>
                </div>
              </div>
            </div>
            <div className="h-80 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={transactionHistory}>
                  <defs>
                    <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 12}} 
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 12}} 
                  />
                  <Tooltip 
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="nhập" 
                    stroke="#3b82f6" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorIn)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="xuất" 
                    stroke="#10b981" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorOut)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="min-w-0">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full min-w-0">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Tình trạng tồn kho</h3>
            <p className="text-xs text-slate-500 mb-6">Phân loại vật tư theo mức độ an toàn</p>
            <div className="flex-1 min-h-[250px] relative min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={90}
                    paddingAngle={8}
                    dataKey="value"
                    stroke="none"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-black text-slate-900">{items.length}</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vật tư</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 mt-6">
              {statusData.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: item.color}}></div>
                    <span className="text-sm font-medium text-slate-600">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Distribution Chart */}
        <motion.div variants={itemVariants} className="min-w-0">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Phân bổ theo nhóm</h3>
                <p className="text-xs text-slate-500">Số lượng loại vật tư trong mỗi nhóm</p>
              </div>
              <Filter className="w-4 h-4 text-slate-400" />
            </div>
            <div className="h-96 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData.slice(0, 5)} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 11}} 
                    width={120}
                  />
                  <Tooltip 
                    cursor={{fill: '#f8fafc'}}
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>

        {/* Alerts & Recent Transactions */}
        <motion.div variants={itemVariants}>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Cảnh báo & Gần đây</h3>
                <p className="text-xs text-slate-500">Các sự kiện cần chú ý trong kho</p>
              </div>
              <button 
                onClick={() => setActiveTab('transactions')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                Xem tất cả
              </button>
            </div>
            <div className="space-y-4">
              <AnimatePresence>
                {lowStockItems.slice(0, 3).map((item, idx) => (
                  <motion.div 
                    key={`alert-${item.id}`}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-amber-50 border border-amber-100 group hover:bg-amber-100 transition-colors cursor-pointer"
                    onClick={() => setActiveTab('inventory')}
                  >
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <AlertTriangle className="w-6 h-6 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">Tồn kho thấp: <span className="font-bold text-amber-700">{item.currentStock} {item.unit}</span> (Tối thiểu: {item.minStock})</p>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600" />
                  </motion.div>
                ))}
                {transactions.slice(0, 3).map((t, idx) => {
                  const item = items.find(i => i.id === t.itemId);
                  return (
                    <motion.div 
                      key={`trans-${t.id}`}
                      initial={{ x: -20, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: (lowStockItems.length + idx) * 0.1 }}
                      className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 group hover:bg-white hover:shadow-md transition-all cursor-pointer"
                      onClick={() => setActiveTab('transactions')}
                    >
                      <div className={`w-12 h-12 rounded-xl ${t.type === 'IN' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'} flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform`}>
                        {t.type === 'IN' ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-slate-900">{item?.name || 'Vật tư đã xóa'}</p>
                        <p className="text-xs text-slate-500">{t.type === 'IN' ? 'Nhập kho' : 'Xuất kho'}: <span className={`font-bold ${t.type === 'IN' ? 'text-blue-600' : 'text-emerald-600'}`}>{t.quantity} {item?.unit}</span></p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase">{new Date(t.timestamp?.toDate ? t.timestamp.toDate() : t.timestamp).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
                        <Clock className="w-3 h-3 text-slate-300 ml-auto mt-1" />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {lowStockItems.length === 0 && transactions.length === 0 && (
                <div className="text-center py-20">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-10 h-10 text-slate-200" />
                  </div>
                  <p className="text-slate-400 text-sm font-medium">Kho hàng đang ở trạng thái lý tưởng.</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function QuickActionButton({ icon, label, color, onClick }: { icon: any, label: string, color: string, onClick: () => void }) {
  const colors: any = {
    blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-100',
    purple: 'bg-purple-50 text-purple-600 hover:bg-purple-100 border-purple-100',
    amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border-amber-100',
    pink: 'bg-pink-50 text-pink-600 hover:bg-pink-100 border-pink-100',
  };

  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border transition-all active:scale-95 ${colors[color]}`}
    >
      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
        {React.cloneElement(icon, { className: 'w-5 h-5' })}
      </div>
      <span className="text-xs font-bold tracking-tight">{label}</span>
    </button>
  );
}

function StatCard({ label, value, icon, color, trend, isUp }: { label: string, value: string | number, icon: any, color: string, trend?: string, isUp?: boolean }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:border-blue-200 transition-colors">
      <div className="flex justify-between items-start mb-4">
        <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center transition-transform group-hover:scale-110`}>
          {icon}
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${isUp ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend}
          </div>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{label}</p>
        <p className="text-3xl font-bold text-slate-900 tracking-tight">{value.toLocaleString()}</p>
      </div>
      <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
        {React.cloneElement(icon, { size: 100 })}
      </div>
    </div>
  );
}

function Inventory({ items, categories, globalSearch }: { items: Item[], categories: Category[], globalSearch: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', categoryId: '', unit: '', minStock: '0', currentStock: '0', expiryDate: '', price: '0' });
  const [nameSuggestions, setNameSuggestions] = useState<Item[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (newItem.name.trim().length > 0 && showAdd) {
      const filtered = items.filter(i => {
        const matchesName = i.name.toLowerCase().includes(newItem.name.toLowerCase());
        const matchesCategory = newItem.categoryId ? i.categoryId === newItem.categoryId : true;
        return matchesName && matchesCategory;
      });
      setNameSuggestions(filtered.slice(0, 5));
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }, [newItem.name, newItem.categoryId, items, showAdd]);

  const handleSelectSuggestion = (item: Item) => {
    setNewItem({
      name: item.name,
      categoryId: item.categoryId,
      unit: item.unit,
      minStock: item.minStock.toString(),
      currentStock: item.currentStock.toString(),
      expiryDate: item.expiryDate || '',
      price: (item.price || 0).toString()
    });
    setShowSuggestions(false);
  };
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filtering & Sorting States
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategoryName, setFilterCategoryName] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // all, low, expired, safe
  const [sortKey, setSortKey] = useState<keyof Item>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const minStock = parseFloat(newItem.minStock) || 0;
      const currentStock = parseFloat(newItem.currentStock) || 0;
      const price = parseFloat(newItem.price) || 0;

      const itemRef = await addDoc(collection(db, "items"), {
        ...newItem,
        minStock,
        currentStock,
        price,
        createdAt: serverTimestamp()
      });

      // Create initial transaction if stock > 0
      if (currentStock > 0) {
        await addDoc(collection(db, "transactions"), {
          itemId: itemRef.id,
          type: 'IN',
          quantity: currentStock,
          timestamp: serverTimestamp(),
          note: 'Nhập kho ban đầu'
        });
      }

      setShowAdd(false);
      setNewItem({ name: '', categoryId: '', unit: '', minStock: '0', currentStock: '0', expiryDate: '', price: '0' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "items");
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        // Local cache for categories created in this batch
        const batchCategories = new Map<string, string>(); // name -> id
        categories.forEach(c => batchCategories.set(c.name.toLowerCase(), c.id));

        for (const row of data) {
          // Map category name to ID
          let categoryId = '';
          const categoryName = (row['Nhóm'] || row['Category'] || '').toString().trim();
          if (categoryName) {
            const normalizedName = categoryName.toLowerCase();
            if (batchCategories.has(normalizedName)) {
              categoryId = batchCategories.get(normalizedName)!;
            } else {
              // Create new category if not exists in DB or current batch
              try {
                const docRef = await addDoc(collection(db, "categories"), { name: categoryName });
                categoryId = docRef.id;
                batchCategories.set(normalizedName, categoryId);
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, "categories");
              }
            }
          }

          try {
            const initialStock = Number(row['Tồn hiện tại'] ?? row['Tồn kho'] ?? row['CurrentStock'] ?? 0);
            const itemRef = await addDoc(collection(db, "items"), {
              name: row['Tên vật tư'] || row['Name'] || 'Chưa đặt tên',
              categoryId: categoryId,
              unit: row['Đơn vị'] || row['Unit'] || 'Cái',
              minStock: Number(row['Tồn tối thiểu'] ?? row['MinStock'] ?? 0),
              currentStock: initialStock,
              expiryDate: normalizeDate(row['Hạn sử dụng'] || row['ExpiryDate']),
              price: Number(row['Đơn giá'] ?? row['Price'] ?? 0),
              createdAt: serverTimestamp()
            });

            // Create initial transaction if stock > 0
            if (initialStock > 0) {
              await addDoc(collection(db, "transactions"), {
                itemId: itemRef.id,
                type: 'IN',
                quantity: initialStock,
                timestamp: serverTimestamp(),
                note: 'Nhập kho ban đầu (Import)'
              });
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, "items");
          }
        }
        alert(`Đã nhập thành công ${data.length} vật tư.`);
      } catch (error) {
        console.error("Import Error:", error);
        alert("Có lỗi xảy ra khi nhập file Excel. Vui lòng kiểm tra lại định dạng file.");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSort = (key: keyof Item) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredAndSortedItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredAndSortedItems.map(i => i.id));
    }
  };

  const handleBulkDelete = async () => {
    try {
      for (const id of selectedIds) {
        try {
          await deleteDoc(doc(db, "items", id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `items/${id}`);
        }
      }
      setSelectedIds([]);
      setShowDeleteConfirm(false);
      alert(`Đã xóa thành công ${selectedIds.length} vật tư.`);
    } catch (error) {
      console.error("Delete Error:", error);
      alert("Có lỗi xảy ra khi xóa vật tư.");
    }
  };

  const uniqueCategories = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach(cat => {
      const normalizedName = cat.name.trim().toLowerCase();
      if (!map.has(normalizedName)) {
        map.set(normalizedName, cat);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const filteredAndSortedItems = useMemo(() => {
    return items
      .filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) && 
                             item.name.toLowerCase().includes(globalSearch.toLowerCase());
        
        let matchesCategory = true;
        if (filterCategoryName !== '') {
          const itemCat = categories.find(c => c.id === item.categoryId);
          // Normalize both for comparison to handle duplicates in DB
          matchesCategory = itemCat?.name.trim().toLowerCase() === filterCategoryName.trim().toLowerCase();
        }
        
        const isLow = item.currentStock <= item.minStock;
        const isExpired = item.expiryDate && new Date(item.expiryDate) < new Date();
        
        let matchesStatus = true;
        if (filterStatus === 'low') matchesStatus = isLow;
        if (filterStatus === 'expired') matchesStatus = !!isExpired;
        if (filterStatus === 'safe') matchesStatus = !isLow && !isExpired;
        
        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((a, b) => {
      // Priority Sorting: Expired > Nearing Expiry > Low Stock > Others
      const getPriority = (item: Item) => {
        const isExpired = item.expiryDate && new Date(item.expiryDate) < new Date();
        if (isExpired) return 0;
        
        const isNearingExpiry = item.expiryDate && 
          (new Date(item.expiryDate).getTime() - new Date().getTime()) < (30 * 24 * 60 * 60 * 1000) &&
          (new Date(item.expiryDate).getTime() - new Date().getTime()) > 0;
        if (isNearingExpiry) return 1;
        
        const isLow = item.currentStock <= item.minStock;
        if (isLow) return 2;
        
        return 3;
      };

      const priorityA = getPriority(a);
      const priorityB = getPriority(b);

      if (priorityA !== priorityB) return priorityA - priorityB;

      // Secondary sort based on user selection
      let valA = a[sortKey] || '';
      let valB = b[sortKey] || '';

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, searchTerm, globalSearch, filterCategoryName, filterStatus, sortKey, sortOrder, categories]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex flex-wrap gap-2 flex-1 w-full">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Tìm tên vật tư..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="low">Sắp hết hàng</option>
              <option value="expired">Đã hết hạn</option>
              <option value="safe">An toàn</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleImportExcel} 
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 rotate-180" />}
              Nhập Excel
            </button>
            <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-slate-50 transition-colors">
              <Download className="w-4 h-4" /> Xuất Excel
            </button>
            {selectedIds.length > 0 && (
              <button 
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Xóa ({selectedIds.length})
              </button>
            )}
            <button 
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
            >
              <Plus className="w-4 h-4" /> Thêm vật tư
            </button>
          </div>
        </div>

        {/* Category Buttons */}
        <div className="flex flex-wrap gap-2 pb-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setFilterCategoryName('')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap border flex items-center gap-2 ${
              filterCategoryName === '' 
                ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100' 
                : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            Tất cả nhóm
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${filterCategoryName === '' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
              {items.length}
            </span>
          </button>
          {uniqueCategories.map(cat => {
            const name = cat.name;
            const count = items.filter(i => {
              const itemCat = categories.find(c => c.id === i.categoryId);
              return itemCat?.name.trim().toLowerCase() === name.trim().toLowerCase();
            }).length;
            return (
              <button
                key={cat.id}
                onClick={() => setFilterCategoryName(name)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap border flex items-center gap-2 ${
                  filterCategoryName.trim().toLowerCase() === name.trim().toLowerCase()
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100' 
                    : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                {name}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${filterCategoryName.trim().toLowerCase() === name.trim().toLowerCase() ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 w-10">
                <input 
                  type="checkbox" 
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={filteredAndSortedItems.length > 0 && selectedIds.length === filteredAndSortedItems.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  Tên vật tư {sortKey === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                </div>
              </th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nhóm</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Đơn vị</th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('price')}
              >
                <div className="flex items-center gap-1">
                  Đơn giá {sortKey === 'price' && (sortOrder === 'asc' ? '↑' : '↓')}
                </div>
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('currentStock')}
              >
                <div className="flex items-center gap-1">
                  Tồn kho {sortKey === 'currentStock' && (sortOrder === 'asc' ? '↑' : '↓')}
                </div>
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('expiryDate')}
              >
                <div className="flex items-center gap-1">
                  Hạn dùng {sortKey === 'expiryDate' && (sortOrder === 'asc' ? '↑' : '↓')}
                </div>
              </th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAndSortedItems.map(item => {
              const category = categories.find(c => c.id === item.categoryId);
              const isLow = item.currentStock <= item.minStock;
              const now = new Date();
              const expiryDate = item.expiryDate ? new Date(item.expiryDate) : null;
              const isExpired = expiryDate && expiryDate < now;
              const isNearingExpiry = expiryDate && 
                (expiryDate.getTime() - now.getTime()) < (30 * 24 * 60 * 60 * 1000) &&
                (expiryDate.getTime() - now.getTime()) > 0;

              return (
                <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${isExpired ? 'bg-red-50/30' : isNearingExpiry ? 'bg-orange-50/30' : ''} ${selectedIds.includes(item.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox" 
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                    />
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      {item.name}
                      {isExpired && <span title="Đã hết hạn"><AlertTriangle className="w-4 h-4 text-red-600" /></span>}
                      {isNearingExpiry && <span title="Sắp hết hạn"><AlertTriangle className="w-4 h-4 text-orange-600" /></span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-500">{category?.name || 'N/A'}</td>
                  <td className="px-6 py-4 text-slate-500">{item.unit}</td>
                  <td className="px-6 py-4 text-slate-500">{(item.price || 0).toLocaleString('vi-VN')} đ</td>
                  <td className="px-6 py-4 font-bold text-slate-900">{item.currentStock}</td>
                  <td className={`px-6 py-4 font-medium ${isExpired ? 'text-red-600' : isNearingExpiry ? 'text-orange-600' : 'text-slate-500'}`}>
                    {formatDate(item.expiryDate)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                      isExpired ? 'bg-red-100 text-red-600' : 
                      isNearingExpiry ? 'bg-orange-100 text-orange-600' :
                      isLow ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      {isExpired ? 'Hết hạn' : isNearingExpiry ? 'Sắp hết hạn' : isLow ? 'Cần nhập' : 'An toàn'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredAndSortedItems.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            Không tìm thấy vật tư nào phù hợp với bộ lọc.
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Thêm vật tư mới</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X /></button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">Tên vật tư</label>
                <input 
                  required 
                  type="text" 
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" 
                  value={newItem.name} 
                  onChange={e => setNewItem({...newItem, name: e.target.value})}
                  onFocus={() => newItem.name.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                />
                {showSuggestions && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
                    {nameSuggestions.map(suggestion => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(suggestion)}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex flex-col border-b border-slate-50 last:border-0"
                      >
                        <span className="font-bold text-slate-900">{suggestion.name}</span>
                        <span className="text-[10px] text-slate-500">
                          {categories.find(c => c.id === suggestion.categoryId)?.name} • {suggestion.unit}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nhóm vật tư</label>
                <select required className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newItem.categoryId} onChange={e => setNewItem({...newItem, categoryId: e.target.value})}>
                  <option value="">Chọn nhóm...</option>
                  {uniqueCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Đơn vị</label>
                  <input required type="text" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Đơn giá (đ)</label>
                  <input required type="number" step="any" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tồn tối thiểu</label>
                  <input required type="number" step="any" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newItem.minStock} onChange={e => setNewItem({...newItem, minStock: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hạn sử dụng</label>
                  <input type="date" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newItem.expiryDate} onChange={e => setNewItem({...newItem, expiryDate: e.target.value})} />
                </div>
              </div>
              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100">Lưu vật tư</button>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Xác nhận xóa</h3>
            <p className="text-slate-500 mb-8">Bạn có chắc chắn muốn xóa {selectedIds.length} vật tư đã chọn? Hành động này không thể hoàn tác.</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
              >
                Hủy
              </button>
              <button 
                onClick={handleBulkDelete}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100"
              >
                Xóa ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Transactions({ transactions, items, departments, categories, globalSearch }: { transactions: Transaction[], items: Item[], departments: Department[], categories: Category[], globalSearch: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTrans, setNewTrans] = useState({ itemId: '', type: 'OUT' as any, quantity: '0', fromDeptId: '', toDeptId: '', note: '' });
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [itemSuggestions, setItemSuggestions] = useState<Item[]>([]);
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);

  const filteredTransactions = useMemo(() => {
    if (!globalSearch) return transactions;
    return transactions.filter(t => {
      const item = items.find(i => i.id === t.itemId);
      return item?.name.toLowerCase().includes(globalSearch.toLowerCase());
    });
  }, [transactions, items, globalSearch]);

  useEffect(() => {
    if (itemSearchTerm.trim().length > 0 && showAdd) {
      const filtered = items.filter(i => 
        i.name.toLowerCase().includes(itemSearchTerm.toLowerCase())
      );
      setItemSuggestions(filtered.slice(0, 5));
      setShowItemSuggestions(filtered.length > 0);
    } else {
      setShowItemSuggestions(false);
    }
  }, [itemSearchTerm, items, showAdd]);

  const handleSelectItem = (item: Item) => {
    setNewTrans({ ...newTrans, itemId: item.id });
    setItemSearchTerm(item.name);
    setShowItemSuggestions(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const item = items.find(i => i.id === newTrans.itemId);
    if (!item) return;

    const quantity = parseFloat(newTrans.quantity) || 0;
    let newStock = item.currentStock;
    if (newTrans.type === 'IN') newStock += quantity;
    if (newTrans.type === 'OUT') newStock -= quantity;

    try {
      await addDoc(collection(db, "transactions"), {
        ...newTrans,
        quantity,
        timestamp: serverTimestamp()
      });

      await updateDoc(doc(db, "items", item.id), {
        currentStock: newStock
      });

      setShowAdd(false);
      setNewTrans({ itemId: '', type: 'OUT', quantity: '0', fromDeptId: '', toDeptId: '', note: '' });
      setItemSearchTerm('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "transactions/items");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button 
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
        >
          <Plus className="w-4 h-4" /> Tạo giao dịch
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thời gian</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Vật tư</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Loại</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Số lượng</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thành tiền</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Phòng ban</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTransactions.map(t => {
              const item = items.find(i => i.id === t.itemId);
              const toDept = departments.find(d => d.id === t.toDeptId);
              return (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {formatTimestamp(t.timestamp)}
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-900">{item?.name || 'N/A'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                      t.type === 'IN' ? 'bg-emerald-100 text-emerald-600' : 
                      t.type === 'OUT' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                    }`}>
                      {t.type === 'IN' ? 'Nhập' : t.type === 'OUT' ? 'Xuất' : 'Chuyển'}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-bold text-slate-900">{t.quantity}</td>
                  <td className="px-6 py-4 text-slate-500">{(t.quantity * (item?.price || 0)).toLocaleString('vi-VN')} đ</td>
                  <td className="px-6 py-4 text-slate-500">{toDept?.name || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Ghi nhận giao dịch</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X /></button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Loại giao dịch</label>
                <div className="grid grid-cols-3 gap-2">
                  {['IN', 'OUT', 'TRANSFER'].map(type => (
                    <button 
                      key={type}
                      type="button"
                      onClick={() => setNewTrans({...newTrans, type: type as any})}
                      className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                        newTrans.type === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200'
                      }`}
                    >
                      {type === 'IN' ? 'NHẬP' : type === 'OUT' ? 'XUẤT' : 'CHUYỂN'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">Vật tư</label>
                <input 
                  required 
                  type="text" 
                  placeholder="Nhập tên vật tư để tìm kiếm..."
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" 
                  value={itemSearchTerm} 
                  onChange={e => {
                    setItemSearchTerm(e.target.value);
                    if (newTrans.itemId) setNewTrans({ ...newTrans, itemId: '' });
                  }}
                  onFocus={() => itemSearchTerm.length > 0 && setShowItemSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowItemSuggestions(false), 200)}
                />
                {showItemSuggestions && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
                    {itemSuggestions.map(suggestion => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSelectItem(suggestion)}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex flex-col border-b border-slate-50 last:border-0"
                      >
                        <span className="font-bold text-slate-900">{suggestion.name}</span>
                        <span className="text-[10px] text-slate-500">
                          {categories.find(c => c.id === suggestion.categoryId)?.name} • Tồn: {suggestion.currentStock} {suggestion.unit}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Hidden input to maintain required validation on itemId */}
                <input type="hidden" required value={newTrans.itemId} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Số lượng</label>
                  <input required type="number" step="any" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newTrans.quantity} onChange={e => setNewTrans({...newTrans, quantity: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Đến phòng</label>
                  <select className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" value={newTrans.toDeptId} onChange={e => setNewTrans({...newTrans, toDeptId: e.target.value})}>
                    <option value="">Chọn phòng...</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
                <textarea className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" rows={2} value={newTrans.note} onChange={e => setNewTrans({...newTrans, note: e.target.value})}></textarea>
              </div>
              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100">Xác nhận</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryAudit({ items, categories, globalSearch }: { items: Item[], categories: Category[], globalSearch: string }) {
  const [auditDate, setAuditDate] = useState(new Date().toISOString().split('T')[0]);
  const [auditData, setAuditData] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const uniqueCategories = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach(cat => {
      const normalizedName = cat.name.trim().toLowerCase();
      if (!map.has(normalizedName)) {
        map.set(normalizedName, cat);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const categoryIdMap = useMemo(() => {
    const idMap = new Map<string, string>();
    categories.forEach(cat => {
      const normalizedName = cat.name.trim().toLowerCase();
      const primaryCat = uniqueCategories.find(c => c.name.trim().toLowerCase() === normalizedName);
      if (primaryCat) {
        idMap.set(cat.id, primaryCat.id);
      }
    });
    return idMap;
  }, [categories, uniqueCategories]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
                           item.name.toLowerCase().includes(globalSearch.toLowerCase());
      const matchesCategory = filterCategory ? categoryIdMap.get(item.categoryId) === filterCategory : true;
      return matchesSearch && matchesCategory;
    });
  }, [items, searchTerm, globalSearch, filterCategory, categoryIdMap]);

  const handleActualChange = (itemId: string, value: string) => {
    setAuditData(prev => ({ ...prev, [itemId]: value }));
  };

  const handleSaveAudit = async () => {
    // Removed window.confirm as it's blocked in iframes
    setIsSaving(true);
    try {
      const auditTimestamp = new Date(auditDate + 'T12:00:00');
      
      for (const itemId of Object.keys(auditData)) {
        const item = items.find(i => i.id === itemId);
        if (!item) continue;
        
        const actualStr = auditData[itemId];
        const actual = actualStr === '' ? item.currentStock : parseFloat(actualStr);
        if (isNaN(actual)) continue;

        const current = item.currentStock;
        const diff = current - actual;
        
        if (Math.abs(diff) > 0.000001) {
          // Record transaction
          await addDoc(collection(db, "transactions"), {
            itemId,
            type: diff > 0 ? 'OUT' : 'IN',
            quantity: Math.abs(diff),
            timestamp: auditTimestamp,
            note: `Kiểm kê kho ngày ${auditDate} - ${diff > 0 ? 'Tiêu hao chênh lệch' : 'Điều chỉnh tăng'}`
          });
          
          // Update item stock
          await updateDoc(doc(db, "items", itemId), {
            currentStock: actual
          });
        }
      }
      
      setAuditData({});
      // Removed alert as it's blocked in iframes
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "audit");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-bold text-slate-500 uppercase mb-1">Ngày kiểm kê</label>
              <input 
                type="date" 
                value={auditDate}
                onChange={(e) => setAuditDate(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs font-bold text-slate-500 uppercase mb-1">Tìm kiếm</label>
              <input 
                type="text" 
                placeholder="Tên vật tư..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs font-bold text-slate-500 uppercase mb-1">Nhóm</label>
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Tất cả nhóm</option>
                {uniqueCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <button 
            onClick={handleSaveAudit}
            disabled={isSaving || Object.keys(auditData).length === 0}
            className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Lưu kết quả
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Vật tư</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nhóm</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Đơn vị</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Tồn hiện tại</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center w-32">Tồn thực tế</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Tiêu hao</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map(item => {
              const auditVal = auditData[item.id];
              const actual = auditVal === undefined || auditVal === '' ? item.currentStock : parseFloat(auditVal);
              const diff = item.currentStock - actual;
              const category = categories.find(c => c.id === item.categoryId);
              
              return (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{item.name}</td>
                  <td className="px-6 py-4 text-slate-500 text-sm">{category?.name}</td>
                  <td className="px-6 py-4 text-slate-500 text-sm">{item.unit}</td>
                  <td className="px-6 py-4 font-bold text-slate-900 text-center">{item.currentStock}</td>
                  <td className="px-6 py-4 text-center">
                    <input 
                      type="number" 
                      step="any"
                      value={auditData[item.id] ?? ''}
                      placeholder={item.currentStock.toString()}
                      onChange={(e) => handleActualChange(item.id, e.target.value)}
                      className="w-20 px-2 py-1 text-center border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                  </td>
                  <td className={`px-6 py-4 font-bold text-center ${diff > 0 ? 'text-orange-600' : diff < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryPlanning({ items, transactions, categories, holidays, globalSearch }: { items: Item[], transactions: Transaction[], categories: Category[], holidays: Holiday[], globalSearch: string }) {
  const [planningDate, setPlanningDate] = useState(new Date().toISOString().split('T')[0]);
  const [forecastUntilDate, setForecastUntilDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [actualStockData, setActualStockData] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, { depletionDate: string, needed: number, dailyUsage: number }>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [usageWindow, setUsageWindow] = useState(90);
  const [isCalculating, setIsCalculating] = useState(false);

  const uniqueCategories = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach(cat => {
      const normalizedName = cat.name.trim().toLowerCase();
      if (!map.has(normalizedName)) {
        map.set(normalizedName, cat);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const categoryIdMap = useMemo(() => {
    const idMap = new Map<string, string>();
    categories.forEach(cat => {
      const normalizedName = cat.name.trim().toLowerCase();
      const primaryCat = uniqueCategories.find(c => c.name.trim().toLowerCase() === normalizedName);
      if (primaryCat) {
        idMap.set(cat.id, primaryCat.id);
      }
    });
    return idMap;
  }, [categories, uniqueCategories]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
                           item.name.toLowerCase().includes(globalSearch.toLowerCase());
      const matchesCategory = filterCategory ? categoryIdMap.get(item.categoryId) === filterCategory : true;
      return matchesSearch && matchesCategory;
    });
  }, [items, searchTerm, globalSearch, filterCategory, categoryIdMap]);

  const handleCalculate = () => {
    setIsCalculating(true);
    // Simulate a bit of processing time for better UX
    setTimeout(() => {
      const newResults: Record<string, { depletionDate: string, needed: number, dailyUsage: number }> = {};
      const planningDateTime = new Date(planningDate + 'T00:00:00');
      const forecastUntilDateTime = new Date(forecastUntilDate + 'T23:59:59');
      
      // Calculate average daily usage for each item (last usageWindow days from planning date)
      const windowDaysAgo = new Date(planningDateTime.getTime() - (usageWindow * 24 * 60 * 60 * 1000));
      
      // Get working days in the last window
      const workingDaysInPast = getWorkingDays(windowDaysAgo, planningDateTime, holidays);
      const workingDaysInFuture = getWorkingDays(planningDateTime, forecastUntilDateTime, holidays);

      items.forEach(item => {
        const itemTrans = transactions.filter(t => 
          t.itemId === item.id && 
          t.type === 'OUT' && 
          t.timestamp?.toDate().getTime() >= windowDaysAgo.getTime() &&
          t.timestamp?.toDate().getTime() <= planningDateTime.getTime()
        );
        
        const totalOut = itemTrans.reduce((sum, t) => sum + t.quantity, 0);
        // Daily usage based on actual working days
        const dailyUsage = workingDaysInPast > 0 ? totalOut / workingDaysInPast : 0;
        
        const actualStockStr = actualStockData[item.id];
        const actualStock = actualStockStr !== undefined && actualStockStr !== '' ? parseFloat(actualStockStr) : item.currentStock;
        
        let depletionDateStr = 'N/A';
        if (dailyUsage > 0) {
          // Find the date when stock will be depleted by counting working days
          let stockLeft = actualStock;
          let daysCount = 0;
          const checkDate = new Date(planningDateTime.getTime());
          // Limit to 2 years to avoid infinite loop
          const maxDate = new Date(planningDateTime.getTime() + (730 * 24 * 60 * 60 * 1000));
          
          while (stockLeft > 0 && checkDate < maxDate) {
            checkDate.setDate(checkDate.getDate() + 1);
            const dateStr = checkDate.toISOString().split('T')[0];
            const isHoliday = holidays.some(h => h.date === dateStr);
            if (!isHoliday) {
              stockLeft -= dailyUsage;
            }
            daysCount++;
          }
          
          if (stockLeft <= 0) {
            depletionDateStr = checkDate.toLocaleDateString('vi-VN');
          } else {
            depletionDateStr = '> 2 năm';
          }
        }
        
        const totalNeededForPeriod = workingDaysInFuture * dailyUsage;
        const needed = Math.max(0, Math.ceil(totalNeededForPeriod - actualStock));
        
        newResults[item.id] = { depletionDate: depletionDateStr, needed, dailyUsage };
      });
      
      setResults(newResults);
      setIsCalculating(false);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-end">
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-500 uppercase mb-1">Ngày làm dự trù</label>
            <input 
              type="date" 
              value={planningDate}
              onChange={(e) => setPlanningDate(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-500 uppercase mb-1">Dự trù đến ngày</label>
            <input 
              type="date" 
              value={forecastUntilDate}
              onChange={(e) => setForecastUntilDate(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-500 uppercase mb-1">Dữ liệu tiêu hao</label>
            <select 
              value={usageWindow}
              onChange={(e) => setUsageWindow(parseInt(e.target.value))}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="30">30 ngày gần nhất</option>
              <option value="60">60 ngày gần nhất</option>
              <option value="90">90 ngày gần nhất</option>
              <option value="180">180 ngày gần nhất</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-500 uppercase mb-1">Tìm kiếm</label>
            <input 
              type="text" 
              placeholder="Tên vật tư..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-500 uppercase mb-1">Nhóm</label>
            <select 
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tất cả nhóm</option>
              {uniqueCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button 
            onClick={handleCalculate}
            disabled={isCalculating}
            className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
          >
            {isCalculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            Tính dự trù
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Vật tư</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Tồn PM</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center w-32">Tồn thực tế</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Tiêu hao/Ngày</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Ngày hết dự kiến</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Cần nhập thêm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map(item => {
              const result = results[item.id];
              return (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.unit}</div>
                  </td>
                  <td className="px-6 py-4 text-center font-semibold text-slate-600">{item.currentStock}</td>
                  <td className="px-6 py-4 text-center">
                    <input 
                      type="number" 
                      step="any"
                      value={actualStockData[item.id] ?? ''}
                      placeholder={item.currentStock.toString()}
                      onChange={(e) => {
                        setActualStockData(prev => ({ ...prev, [item.id]: e.target.value }));
                      }}
                      className="w-20 px-2 py-1 text-center border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                  </td>
                  <td className="px-6 py-4 text-center text-slate-600">
                    {result ? result.dailyUsage.toFixed(2) : '-'}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {result ? (
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        result.depletionDate === 'N/A' ? 'bg-slate-100 text-slate-500' :
                        'bg-blue-50 text-blue-600'
                      }`}>
                        {result.depletionDate}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {result && result.needed > 0 ? (
                      <span className="text-red-600 font-bold">+{result.needed}</span>
                    ) : result ? (
                      <span className="text-emerald-600 font-bold">Đủ dùng</span>
                    ) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Reports({ transactions, items, categories, holidays, globalSearch }: { transactions: Transaction[], items: Item[], categories: Category[], holidays: Holiday[], globalSearch: string }) {
  const [reportType, setReportType] = useState<'custom' | 'week' | 'month' | 'quarter' | 'year'>('month');
  
  const getLocalYYYYMMDD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const [startDate, setStartDate] = useState(getLocalYYYYMMDD(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [endDate, setEndDate] = useState(getLocalYYYYMMDD(new Date()));
  
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(new Date().getMonth());
  const [reportQuarter, setReportQuarter] = useState(Math.floor(new Date().getMonth() / 3));
  const [reportWeek, setReportWeek] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const day = Math.floor(diff / oneDay);
    return Math.floor(day / 7) + 1;
  });

  useEffect(() => {
    if (reportType === 'custom') return;

    let start = new Date();
    let end = new Date();

    if (reportType === 'week') {
      const firstDayOfYear = new Date(reportYear, 0, 1);
      const daysOffset = (reportWeek - 1) * 7;
      start = new Date(reportYear, 0, 1 + daysOffset);
      end = new Date(reportYear, 0, 1 + daysOffset + 6);
    } else if (reportType === 'month') {
      start = new Date(reportYear, reportMonth, 1);
      end = new Date(reportYear, reportMonth + 1, 0);
    } else if (reportType === 'quarter') {
      start = new Date(reportYear, reportQuarter * 3, 1);
      end = new Date(reportYear, (reportQuarter + 1) * 3, 0);
    } else if (reportType === 'year') {
      start = new Date(reportYear, 0, 1);
      end = new Date(reportYear, 11, 31);
    }

    setStartDate(getLocalYYYYMMDD(start));
    setEndDate(getLocalYYYYMMDD(end));
  }, [reportType, reportYear, reportMonth, reportQuarter, reportWeek]);

  const setPeriod = (type: 'week' | 'month' | 'quarter' | 'year') => {
    setReportType(type);
  };

  // Use local time for comparison
  const startDateTime = new Date(startDate + 'T00:00:00').getTime();
  const endDateTime = new Date(endDate + 'T23:59:59').getTime();

  // Calculate actual working days in range
  const workingDaysInRange = useMemo(() => {
    return Math.max(1, getWorkingDays(new Date(startDate + 'T00:00:00'), new Date(endDate + 'T00:00:00'), holidays));
  }, [startDate, endDate, holidays]);

  // Pre-group transactions by itemId for performance
  const transactionsByItem = useMemo(() => {
    const map: Record<string, Transaction[]> = {};
    transactions.forEach(t => {
      if (!t.itemId) return;
      if (!map[t.itemId]) map[t.itemId] = [];
      map[t.itemId].push(t);
    });
    return map;
  }, [transactions]);

  const daysInRange = Math.max(1, Math.ceil((endDateTime - startDateTime) / 86400000));

  const detailedReport = useMemo(() => {
    const filteredItems = globalSearch 
      ? items.filter(i => i.name.toLowerCase().includes(globalSearch.toLowerCase()))
      : items;

    return filteredItems.map(item => {
      const itemTrans = transactionsByItem[item.id] || [];
      
      const createdAtTs = item.createdAt?.toDate ? item.createdAt.toDate().getTime() : 
                          (item.createdAt ? new Date(item.createdAt).getTime() : 0);
      
      // If item was created after the end of the range, it shouldn't have balances in this period
      if (createdAtTs > endDateTime) {
        return {
          ...item,
          openingBalance: 0,
          closingBalance: 0,
          inQty: 0,
          outQty: 0,
          avgDailyUsage: 0
        };
      }

      // Filter transactions related to this item that happened AFTER startDateTime
      const transAfterStart = itemTrans.filter(t => {
        if (!t.timestamp) return false;
        const ts = t.timestamp.toDate ? t.timestamp.toDate().getTime() : new Date(t.timestamp).getTime();
        return ts >= startDateTime;
      });

      // Transactions within the selected range
      const transInRange = transAfterStart.filter(t => {
        const ts = t.timestamp.toDate ? t.timestamp.toDate().getTime() : new Date(t.timestamp).getTime();
        return ts < endDateTime;
      });

      const inQty = transInRange.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.quantity, 0);
      const outQty = transInRange.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.quantity, 0);

      // Transactions after the start date (to calculate opening balance)
      const inAfterStart = transAfterStart.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.quantity, 0);
      const outAfterStart = transAfterStart.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.quantity, 0);
      
      // Opening Balance = Current Stock - (All IN since Start) + (All OUT since Start)
      let openingBalance = item.currentStock - inAfterStart + outAfterStart;
      
      // If item was created AFTER startDateTime, its opening balance was 0
      if (createdAtTs > startDateTime) {
        openingBalance = 0;
      }

      const closingBalance = openingBalance + inQty - outQty;
      const avgDailyUsage = outQty / workingDaysInRange;

      return {
        ...item,
        openingBalance,
        closingBalance,
        inQty,
        outQty,
        avgDailyUsage
      };
    });
  }, [items, transactionsByItem, startDateTime, endDateTime, workingDaysInRange, globalSearch]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (!t.timestamp) return false;
      const ts = t.timestamp.toDate ? t.timestamp.toDate().getTime() : new Date(t.timestamp).getTime();
      return ts >= startDateTime && ts < endDateTime;
    });
  }, [transactions, startDateTime, endDateTime]);

  const totalIn = filteredTransactions.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.quantity, 0);
  const totalOut = filteredTransactions.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.quantity, 0);
  
  const categoryValueData = useMemo(() => {
    return categories.map(cat => {
      const catItems = items.filter(i => i.categoryId === cat.id);
      const value = catItems.reduce((sum, i) => sum + (i.currentStock * (i.price || 0)), 0);
      return { name: cat.name, value };
    }).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  }, [categories, items]);

  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyWithChanges, setShowOnlyWithChanges] = useState(false);

  const filteredDetailedReport = useMemo(() => {
    return detailedReport.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
      const hasChanges = item.inQty > 0 || item.outQty > 0;
      return matchesSearch && (!showOnlyWithChanges || hasChanges);
    });
  }, [detailedReport, searchTerm, showOnlyWithChanges]);

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Báo cáo & Thống kê</h2>
          <p className="text-slate-500">Phân tích chi tiết lưu lượng và giá trị kho hàng.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
              onClick={() => setPeriod('week')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${reportType === 'week' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Tuần
            </button>
            <button 
              onClick={() => setPeriod('month')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${reportType === 'month' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Tháng
            </button>
            <button 
              onClick={() => setPeriod('quarter')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${reportType === 'quarter' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Quý
            </button>
            <button 
              onClick={() => setPeriod('year')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${reportType === 'year' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Năm
            </button>
            <button 
              onClick={() => setReportType('custom')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${reportType === 'custom' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Tùy chọn
            </button>
          </div>
          
          {reportType !== 'custom' && (
            <div className="flex items-center gap-2">
              <select 
                value={reportYear}
                onChange={(e) => setReportYear(parseInt(e.target.value))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {[2023, 2024, 2025, 2026, 2027].map(y => (
                  <option key={y} value={y}>Năm {y}</option>
                ))}
              </select>

              {reportType === 'week' && (
                <select 
                  value={reportWeek}
                  onChange={(e) => setReportWeek(parseInt(e.target.value))}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {Array.from({ length: 53 }, (_, i) => i + 1).map(w => (
                    <option key={w} value={w}>Tuần {w}</option>
                  ))}
                </select>
              )}

              {reportType === 'month' && (
                <select 
                  value={reportMonth}
                  onChange={(e) => setReportMonth(parseInt(e.target.value))}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {Array.from({ length: 12 }, (_, i) => i).map(m => (
                    <option key={m} value={m}>Tháng {m + 1}</option>
                  ))}
                </select>
              )}

              {reportType === 'quarter' && (
                <select 
                  value={reportQuarter}
                  onChange={(e) => setReportQuarter(parseInt(e.target.value))}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {[0, 1, 2, 3].map(q => (
                    <option key={q} value={q}>Quý {q + 1}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          
          {reportType === 'custom' && (
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <span className="text-slate-400">→</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          <div className="flex gap-2">
            <button className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-all">
              <Download className="w-4 h-4" />
            </button>
            <button className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
              <FileText className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tổng nhập kho (kỳ)</p>
          <p className="text-2xl font-black text-blue-600">{totalIn.toLocaleString('vi-VN')}</p>
          <div className="mt-4 h-1 w-full bg-blue-50 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (totalIn / (totalIn + totalOut || 1)) * 100)}%` }}></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tổng xuất kho (kỳ)</p>
          <p className="text-2xl font-black text-emerald-600">{totalOut.toLocaleString('vi-VN')}</p>
          <div className="mt-4 h-1 w-full bg-emerald-50 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (totalOut / (totalIn + totalOut || 1)) * 100)}%` }}></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Giá trị tồn kho hiện tại</p>
          <p className="text-2xl font-black text-purple-600">
            {items.reduce((sum, i) => sum + (i.currentStock * (i.price || 0)), 0).toLocaleString('vi-VN')} đ
          </p>
          <div className="mt-4 h-1 w-full bg-purple-50 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 w-3/4"></div>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="font-bold text-slate-900">Chi tiết vật tư trong kỳ</h3>
            <span className="text-xs text-slate-500">Từ {formatDate(startDate)} đến {formatDate(endDate)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Tìm kiếm vật tư..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none w-full md:w-64"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input 
                type="checkbox"
                checked={showOnlyWithChanges}
                onChange={(e) => setShowOnlyWithChanges(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-medium text-slate-600">Chỉ hiện có biến động</span>
            </label>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">Vật tư</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 text-right">Tồn đầu</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 text-right">Nhập</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 text-right">Xuất</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 text-right">Tồn cuối</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 text-right">Sử dụng/ngày</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDetailedReport.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4">
                    <p className="text-sm font-bold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500">{categories.find(c => c.id === item.categoryId)?.name}</p>
                  </td>
                  <td className="p-4 text-right text-sm font-medium text-slate-600">{item.openingBalance} {item.unit}</td>
                  <td className="p-4 text-right text-sm font-bold text-blue-600">+{item.inQty}</td>
                  <td className="p-4 text-right text-sm font-bold text-emerald-600">-{item.outQty}</td>
                  <td className="p-4 text-right text-sm font-bold text-slate-900">{item.closingBalance} {item.unit}</td>
                  <td className="p-4 text-right text-sm font-medium text-slate-500">{item.avgDailyUsage.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
          <h3 className="text-lg font-bold text-slate-900 mb-8">Giá trị theo nhóm vật tư</h3>
          <div className="h-80 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryValueData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryValueData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'][index % 5]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => value.toLocaleString('vi-VN') + ' đ'}
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
          <h3 className="text-lg font-bold text-slate-900 mb-8">Biến động tồn kho</h3>
          <div className="h-80 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryValueData.slice(0, 5)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} />
                <Tooltip 
                  formatter={(value: number) => value.toLocaleString('vi-VN') + ' đ'}
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function Holidays({ holidays }: { holidays: Holiday[] }) {
  const [newHoliday, setNewHoliday] = useState({ 
    startDate: new Date().toISOString().split('T')[0], 
    endDate: new Date().toISOString().split('T')[0], 
    note: '' 
  });
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const start = new Date(newHoliday.startDate);
      const end = new Date(newHoliday.endDate);
      
      const daysToAdd = [];
      let current = new Date(start);
      
      // Safety check to prevent infinite loop or too many days
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 365) {
        // Limit to 1 year for safety
        return;
      }

      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        // Check if already exists in local state to avoid redundant adds
        if (!holidays.some(h => h.date === dateStr)) {
          daysToAdd.push({
            date: dateStr,
            note: newHoliday.note
          });
        }
        current.setDate(current.getDate() + 1);
      }

      if (daysToAdd.length > 0) {
        const promises = daysToAdd.map(day => addDoc(collection(db, "holidays"), day));
        await Promise.all(promises);
      }

      setNewHoliday({ 
        startDate: new Date().toISOString().split('T')[0], 
        endDate: new Date().toISOString().split('T')[0], 
        note: '' 
      });
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "holidays");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, "holidays", id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `holidays/${id}`);
    }
  };

  const sortedHolidays = [...holidays].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-2xl font-bold text-slate-900">Quản lý ngày nghỉ</h3>
          <p className="text-slate-500">Thiết lập các ngày nghỉ lễ, ngày không làm việc để tính toán tiêu hao chính xác.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Thêm ngày nghỉ
        </button>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-900">Thêm ngày nghỉ mới</h3>
              <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Từ ngày</label>
                  <input 
                    required 
                    type="date" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" 
                    value={newHoliday.startDate} 
                    onChange={e => setNewHoliday({...newHoliday, startDate: e.target.value, endDate: e.target.value > newHoliday.endDate ? e.target.value : newHoliday.endDate})} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Đến ngày</label>
                  <input 
                    required 
                    type="date" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" 
                    value={newHoliday.endDate} 
                    min={newHoliday.startDate}
                    onChange={e => setNewHoliday({...newHoliday, endDate: e.target.value})} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
                <input 
                  type="text" 
                  placeholder="Lễ Quốc khánh, Nghỉ Tết..."
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" 
                  value={newHoliday.note} 
                  onChange={e => setNewHoliday({...newHoliday, note: e.target.value})} 
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                >
                  Lưu
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ghi chú</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedHolidays.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-slate-400">
                  Chưa có ngày nghỉ nào được thiết lập.
                </td>
              </tr>
            ) : (
              sortedHolidays.map(holiday => (
                <tr key={holiday.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{formatDate(holiday.date)}</td>
                  <td className="px-6 py-4 text-slate-600">{holiday.note || '-'}</td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => handleDelete(holiday.id)}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiAssistant({ analysis, isAnalyzing, onAnalyze }: { analysis: AiAnalysis | null, isAnalyzing: boolean, onAnalyze: () => void }) {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-2xl text-white shadow-xl shadow-blue-100 relative overflow-hidden">
        <div className="relative z-10">
          <h3 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <BrainCircuit className="w-8 h-8" /> Trợ lý AI Gemini
          </h3>
          <p className="text-blue-100 mb-6 max-w-xl">
            Sử dụng trí tuệ nhân tạo để phân tích tồn kho, dự báo tiêu thụ và đưa ra các đề xuất tối ưu hóa vật tư cho khoa.
          </p>
          <button 
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="px-8 py-3 bg-white text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg"
          >
            {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5" />}
            {isAnalyzing ? 'Đang phân tích...' : 'Bắt đầu phân tích dữ liệu'}
          </button>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
      </div>

      {analysis && (
        <div className="space-y-6">
          {/* Summary Card */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 text-blue-600 mb-4">
              <BrainCircuit className="w-6 h-6" />
              <h4 className="font-bold text-lg">Tóm tắt từ Gemini</h4>
            </div>
            <p className="text-slate-700 text-lg leading-relaxed italic">
              "{analysis.summary}"
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Alerts Section */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" /> Cảnh báo quan trọng
              </h4>
              <div className="space-y-3">
                {analysis.alerts.map((alert, idx) => (
                  <div key={idx} className={`p-4 rounded-xl border flex gap-3 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-100 text-red-700' :
                    alert.type === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                    'bg-blue-50 border-blue-100 text-blue-700'
                  }`}>
                    <div className="mt-0.5">
                      {alert.type === 'danger' ? <X className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{alert.item || 'Cảnh báo hệ thống'}</p>
                      <p className="text-xs opacity-90">{alert.message}</p>
                    </div>
                  </div>
                ))}
                {analysis.alerts.length === 0 && (
                  <p className="text-sm text-slate-400 italic">Không có cảnh báo nào.</p>
                )}
              </div>
            </div>

            {/* Recommendations Section */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" /> Đề xuất tối ưu
              </h4>
              <div className="space-y-3">
                {analysis.recommendations.map((rec, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      rec.priority === 'high' ? 'bg-red-100 text-red-600' :
                      rec.priority === 'medium' ? 'bg-amber-100 text-amber-600' :
                      'bg-blue-100 text-blue-600'
                    }`}>
                      <span className="text-[10px] font-black uppercase">{rec.priority}</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{rec.action}</p>
                      <p className="text-xs text-slate-500">{rec.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Anomalies Section */}
          {analysis.anomalies.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Search className="w-5 h-5 text-purple-500" /> Phát hiện bất thường
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.anomalies.map((anomaly, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-between">
                    <p className="text-sm text-purple-900">{anomaly.description}</p>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                      anomaly.severity === 'high' ? 'bg-red-500 text-white' :
                      anomaly.severity === 'medium' ? 'bg-amber-500 text-white' :
                      'bg-blue-500 text-white'
                    }`}>
                      {anomaly.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Analysis Section */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm prose prose-slate max-w-none">
            <div className="flex items-center gap-2 text-slate-900 mb-6 pb-4 border-b border-slate-100">
              <FileText className="w-6 h-6" />
              <span className="font-bold text-lg">Phân tích chi tiết</span>
            </div>
            <ReactMarkdown>{analysis.detailedAnalysis}</ReactMarkdown>
          </div>
        </div>
      )}

      {!analysis && !isAnalyzing && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <AiFeatureCard 
            title="Dự báo tồn kho" 
            desc="Cảnh báo các vật tư sắp hết dựa trên tốc độ tiêu thụ thực tế." 
          />
          <AiFeatureCard 
            title="Phát hiện bất thường" 
            desc="Tìm ra các sai lệch trong việc sử dụng vật tư văn phòng phẩm và thuốc." 
          />
          <AiFeatureCard 
            title="Tối ưu hóa nhập hàng" 
            desc="Đề xuất số lượng nhập hàng tối ưu để tránh lãng phí hoặc thiếu hụt." 
          />
        </div>
      )}
    </div>
  );
}

function AiFeatureCard({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mb-4">
        <ChevronRight className="w-6 h-6" />
      </div>
      <h4 className="font-bold text-slate-900 mb-2">{title}</h4>
      <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}
