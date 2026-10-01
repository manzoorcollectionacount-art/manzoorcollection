import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { collection, query, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { BarChart3, Printer } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, startOfWeek, parseISO, isWithinInterval, startOfDay, endOfDay, subDays, isValid } from 'date-fns';
import { safeFormat } from '../lib/utils';
import { printInvoice } from '../lib/print';

interface Sale {
  id: string;
  branchId: string;
  customerName?: string;
  customerId?: string;
  total: number;
  transactionType?: string; saleType?: string;
  returnedValue?: number;
  paymentMethod?: string;
  items: Array<{ id: string, name: string, qty: number, price: number, cost?: number, category?: string }>;
  createdAt: any;
  date?: number;
}

interface Purchase {
  id: string;
  branchId: string;
  vendorName?: string;
  vendorId?: string;
  total: number;
  items: Array<{ id: string, name: string, qty: number, price: number }>;
  createdAt: any;
  date?: number;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  advanceBalance?: number;
  branchId: string;
}

interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  advances: number;
  recentAdvance?: number;
  recentAdvanceDate?: number;
  month: string;
  date: number;
  branchId: string;
}

export function Reports() {
  const { user } = useAuth();
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);

  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [aggregation, setAggregation] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [selectedReportVendorName, setSelectedReportVendorName] = useState<string>('ALL');
  const [expandedAdvanceId, setExpandedAdvanceId] = useState<string | null>(null);
  const [advanceSearchTerm, setAdvanceSearchTerm] = useState('');
  const [reportType, setReportType] = useState<'sales' | 'daily_sales' | 'detailed_sales' | 'detailed_purchases' | 'items' | 'categories' | 'payments' | 'customers' | 'vendors' | 'vendor_items' | 'profitability' | 'advances'>('sales');

  const getDocTimestamp = (doc: any): number => {
    if (!doc) return 0;
    if (typeof doc.date === 'number' && doc.date > 0) return doc.date;
    if (typeof doc.date === 'string') {
      const p = new Date(doc.date).getTime();
      if (!isNaN(p) && p > 0) return p;
    }
    if (doc.createdAt) {
      if (typeof doc.createdAt.toMillis === 'function') return doc.createdAt.toMillis();
      if (typeof doc.createdAt.seconds === 'number') return doc.createdAt.seconds * 1000;
      if (typeof doc.createdAt === 'number') return doc.createdAt;
      if (typeof doc.createdAt === 'string') {
        const p = new Date(doc.createdAt).getTime();
        if (!isNaN(p) && p > 0) return p;
      }
    }
    return 0;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as any;
    if (tab && ['sales', 'daily_sales', 'detailed_sales', 'detailed_purchases', 'items', 'categories', 'payments', 'customers', 'vendors', 'vendor_items', 'profitability', 'advances'].includes(tab)) {
      setReportType(tab);
    }
  }, []);

  useEffect(() => {
    let qSales: any = collection(db, 'sales');
    let qPurchases: any = collection(db, 'purchases');
    let qInventory: any = collection(db, 'inventory');
    let qEmployees: any = collection(db, 'employees');
    let qPayroll: any = collection(db, 'payroll');
    let qLedger: any = collection(db, 'ledger');

    if (activeBranchId && activeBranchId !== 'all') {
      qSales = query(qSales, where('branchId', '==', activeBranchId));
      qPurchases = query(qPurchases, where('branchId', '==', activeBranchId));
      qInventory = query(qInventory, where('branchId', '==', activeBranchId));
      qEmployees = query(qEmployees, where('branchId', '==', activeBranchId));
      qPayroll = query(qPayroll, where('branchId', '==', activeBranchId));
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
    }

    const unsubSales = safeCollectionSnapshot(qSales, (snap) => setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Sale))));
    const unsubPurchases = safeCollectionSnapshot(qPurchases, (snap) => setPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Purchase))));
    const unsubInventory = safeCollectionSnapshot(qInventory, (snap) => setInventory(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as any))));
    const unsubEmployees = safeCollectionSnapshot(qEmployees, (snap) => setEmployees(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Employee))));
    const unsubPayroll = safeCollectionSnapshot(qPayroll, (snap) => setPayslips(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Payslip))));
    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => setLedger(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    
    return () => {
      unsubSales();
      unsubPurchases();
      unsubInventory();
      unsubEmployees();
      unsubPayroll();
      unsubLedger();
    };
  }, [user, activeBranchId]);

  const reportData = () => {
    const startStr = format(startDate || new Date(), 'yyyy-MM-dd');
    const endStr = format(endDate || new Date(), 'yyyy-MM-dd');
    const [sy, sm, sd] = startStr.split('-');
    const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
    start.setHours(0, 0, 0, 0);
    const [ey, em, ed] = endStr.split('-');
    const end = new Date(Number(ey), Number(em) - 1, Number(ed));
    end.setHours(23, 59, 59, 999);

    const filteredSales = sales.filter(s => {
      const sDate = getDocTimestamp(s);
      if (!sDate) return false;
      return sDate >= start.getTime() && sDate <= end.getTime();
    });

    const filteredPurchases = purchases.filter(p => {
      const pDate = getDocTimestamp(p);
      if (!pDate) return false;
      return pDate >= start.getTime() && pDate <= end.getTime();
    });

    const filteredPayslips = payslips.filter(p => {
      const pDate = getDocTimestamp(p);
      if (!pDate) return false;
      return pDate >= start.getTime() && pDate <= end.getTime();
    });

    const filteredLedger = ledger.filter(l => {
      const lDate = getDocTimestamp(l);
      if (!lDate) return false;
      return lDate >= start.getTime() && lDate <= end.getTime();
    });

    const totalRevenue = filteredSales.reduce((acc, sale) => {
      let r = sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : (sale.total || 0);
      return acc + r;
    }, 0);

    const trendMap = new Map<string, { display: string, total: number }>();
    const dailySalesMap = new Map<string, { display: string, inStore: number, online: number, total: number }>();
    const itemsMap = new Map<string, { 
      grossRevenue: number, 
      returnRevenue: number, 
      netRevenue: number, 
      grossQty: number, 
      returnQty: number, 
      netQty: number, 
      price?: number 
    }>();
    const profitMap = new Map<string, { revenue: number, cost: number, profit: number, qty: number }>();
    const branchMap = new Map<string, number>();
    const customerMap = new Map<string, { name: string, total: number, count: number }>();
    const vendorMap = new Map<string, { name: string, total: number, count: number }>();
    const vendorItemsMap = new Map<string, { vendorName: string, itemsMap: Map<string, { itemName: string, qty: number, total: number }>, totalQty: number, totalValue: number }>();
    const categoryMap = new Map<string, { revenue: number, qty: number }>();
    const paymentMap = new Map<string, { revenue: number, count: number }>();

    filteredSales.forEach(sale => {
      const sTime = getDocTimestamp(sale);
      const d = new Date(sTime || start.getTime());
      let sortKey = '', display = '';
      if (aggregation === 'daily') {
        sortKey = safeFormat(d, 'yyyy-MM-dd'); display = safeFormat(d, 'MMM dd');
      } else if (aggregation === 'weekly') {
        const sw = startOfWeek(d);
        sortKey = safeFormat(sw, 'yyyy-MM-dd'); display = `Wk ${safeFormat(sw, 'MMM dd')}`;
      } else if (aggregation === 'monthly') {
        sortKey = safeFormat(d, 'yyyy-MM'); display = safeFormat(d, 'MMM yyyy');
      } else {
        sortKey = safeFormat(d, 'yyyy'); display = safeFormat(d, 'yyyy');
      }

      const revenueOfThisSale = sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : (sale.total || 0);

      const existing = trendMap.get(sortKey) || { display, total: 0 };
      trendMap.set(sortKey, { display, total: existing.total + revenueOfThisSale });

      const existingDaily = dailySalesMap.get(sortKey) || { display, inStore: 0, online: 0, total: 0 };
      const inStoreAmt = sale.saleType !== 'Online' ? revenueOfThisSale : 0;
      const onlineAmt = sale.saleType === 'Online' ? revenueOfThisSale : 0;
      dailySalesMap.set(sortKey, {
         display,
         inStore: existingDaily.inStore + inStoreAmt,
         online: existingDaily.online + onlineAmt,
         total: existingDaily.total + revenueOfThisSale
      });
      const paymentMethod = sale.paymentMethod || 'Cash';
      const pm = paymentMap.get(paymentMethod) || { revenue: 0, count: 0 };
      paymentMap.set(paymentMethod, { revenue: pm.revenue + revenueOfThisSale, count: pm.count + 1 });

      const isReturn = sale.transactionType === 'Return';
      const items = sale.items || [];
      const returnItems = sale.returnItems || [];
      
      // Exact integer allocation for revenues to ensure tallying matches sale.total perfectly
      const itemsSubtotal = items.reduce((acc: number, i: any) => acc + (Number(i.qty || 0) * Number(i.price || 0)), 0);
      const returnsSubtotal = returnItems.reduce((acc: number, i: any) => acc + (Number(i.qty || 0) * Number(i.price || 0)), 0);
      const netSubtotal = itemsSubtotal - returnsSubtotal;
      
      let remainingTotal = Math.abs(sale.total || 0);
      let remainingNet = Math.abs(netSubtotal);

      const processItem = (item: any, isReturnItem: boolean) => {
        let qty = Number(item.qty || 0);
        let itemBaseValue = Math.abs(qty * Number(item.price || 0));
        let revenue = 0;
        
        if (remainingNet > 0) {
           revenue = Math.round((itemBaseValue / remainingNet) * remainingTotal);
           remainingTotal -= revenue;
           remainingNet -= itemBaseValue;
        } else if (netSubtotal === 0) {
           // Fallback if net subtotal is 0 but there's a total (edge case)
           revenue = Math.round(itemBaseValue);
        }
        
        let unitCost = item.cost;
        if (unitCost === undefined || 0) {
          const invItem = inventory.find(inv => inv.id === item.id || 0);
          unitCost = Number(invItem?.cost || 0);
        }
        let cost = Math.round(qty * unitCost);

        const i = itemsMap.get(item.name) || { 
          grossRevenue: 0, 
          returnRevenue: 0, 
          netRevenue: 0, 
          grossQty: 0, 
          returnQty: 0, 
          netQty: 0, 
          price: item.price || 0 
        };

        if (isReturn || isReturnItem) {
          i.returnRevenue += Math.abs(revenue);
          i.returnQty += Math.abs(qty);
          i.netRevenue -= Math.abs(revenue);
          i.netQty -= Math.abs(qty);
          
          qty = -Math.abs(qty);
          revenue = -Math.abs(revenue);
          cost = -Math.abs(cost);
        } else {
          i.grossRevenue += revenue;
          i.grossQty += qty;
          i.netRevenue += revenue;
          i.netQty += qty;
        }
        i.price = item.price || i.price;
        itemsMap.set(item.name, i);

        let category = 'Uncategorized';
        const invItem = inventory.find(inv => inv.id === item.id || 0);
        if (item.category) {
             category = item.category;
        } else if (invItem?.category) {
             category = invItem.category;
        }
        
        const cat = categoryMap.get(category) || { revenue: 0, qty: 0 };
        categoryMap.set(category, { revenue: cat.revenue + revenue, qty: cat.qty + qty });

        const p = profitMap.get(item.name) || { revenue: 0, cost: 0, profit: 0, qty: 0 };
        profitMap.set(item.name, {
          revenue: p.revenue + revenue,
          cost: p.cost + cost,
          profit: p.profit + (revenue - cost),
          qty: p.qty + qty
        });
      };

      items.forEach(item => processItem(item, false));
      returnItems.forEach(item => processItem(item, true));

      if (!activeBranchId) {
        const bName = branches.find(b => b.id === sale.branchId)?.name || 'Unknown';
        branchMap.set(bName, (branchMap.get(bName) || 0) + revenueOfThisSale);
      }

      const customerName = sale.customerName || 'Walk-in Customer';
      const c = customerMap.get(customerName) || { name: customerName, total: 0, count: 0 };
      customerMap.set(customerName, { name: customerName, total: c.total + revenueOfThisSale, count: c.count + 1 });
    });

    filteredPurchases.forEach(purchase => {
      const vendorName = purchase.vendorName || 'Unknown Vendor';
      const v = vendorMap.get(vendorName) || { name: vendorName, total: 0, count: 0 };
      vendorMap.set(vendorName, { name: vendorName, total: v.total + purchase.total, count: v.count + 1 });
      
      const vi = vendorItemsMap.get(vendorName) || { vendorName, itemsMap: new Map<string, { itemName: string, qty: number, total: number }>(), totalQty: 0, totalValue: 0 };
      
      if (purchase.items && Array.isArray(purchase.items)) {
        purchase.items.forEach(item => {
           const iName = item.name || 'Unknown Item';
           const iCost = (item.qty * item.price) || 0;
           const existingItem = vi.itemsMap.get(iName) || { itemName: iName, qty: 0, total: 0 };
           vi.itemsMap.set(iName, { 
             itemName: iName, 
             qty: existingItem.qty + item.qty, 
             total: existingItem.total + iCost 
           });
           vi.totalQty += item.qty;
        });
      }
      vi.totalValue += purchase.total;
      vendorItemsMap.set(vendorName, vi);
    });

    const dailySalesReport = Array.from(dailySalesMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([_, val]) => val);
    const trendChart = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, val]) => ({ period: val.display, sales: val.total }));

    const allItems = Array.from(itemsMap.entries())
      .map(([name, data]) => ({ 
        name, 
        revenue: data.netRevenue, 
        qty: data.netQty, 
        price: data.price,
        grossRevenue: data.grossRevenue,
        returnRevenue: data.returnRevenue,
        grossQty: data.grossQty,
        returnQty: data.returnQty
      }))
      .sort((a,b) => b.revenue - a.revenue);
    
    const topItems = allItems.slice(0, 5);

    const branchChart = activeBranchId ? [] : Array.from(branchMap.entries())
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a,b) => b.revenue - a.revenue);

    const customerReport = Array.from(customerMap.values()).sort((a, b) => b.total - a.total);
    const vendorReport = Array.from(vendorMap.values()).sort((a, b) => b.total - a.total);
    const allPurchasesVendors = Array.from(new Set(filteredPurchases.map(p => p.vendorName || 'Unknown Vendor'))).sort();
    const vendorDetailedReport = Array.from(vendorItemsMap.values()).map(v => ({
      vendorName: v.vendorName,
      totalQty: v.totalQty,
      totalValue: v.totalValue,
      items: Array.from(v.itemsMap.values()).sort((a,b) => b.qty - a.qty)
    })).sort((a,b) => b.totalValue - a.totalValue);

    const profitabilityReport = Array.from(profitMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.profit - a.profit);

    const categoriesReport = Array.from(categoryMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a,b) => b.revenue - a.revenue);

    const detailedSales = [...filteredSales].sort((a, b) => { const getVal = (v: any) => {
                 if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
                 if (v?.createdAt && typeof v.createdAt === 'string') return new Date(v.createdAt).getTime();
                 if (v?.createdAt && typeof v.createdAt === 'number') return v.createdAt;
                 if (v?.date && typeof v.date === 'string') return new Date(v.date).getTime();
                 if (v?.date && typeof v.date === 'number') return v.date;
                 return 0;
              };
              return getVal(b) - getVal(a); });
    const paymentsReport = Array.from(paymentMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a,b) => b.revenue - a.revenue);

    const advanceReport = employees.map(emp => {
      const empSlips = filteredPayslips.filter(s => s.employeeId === emp.id);
      const deducted = empSlips.reduce((sum, s) => sum + (s.advances || 0), 0);
      const slipGiven = empSlips.reduce((sum, s) => sum + (s.recentAdvance || 0), 0);
      
      const ledgerAdvances = filteredLedger.filter(l => 
        l.employeeId === emp.id && 
        l.reference === 'Advance' && 
        l.type === 'OUT' &&
        !(l.description && l.description.includes('with Salary'))
      );
      const ledgerGiven = ledgerAdvances.reduce((sum, l) => sum + (l.amount || 0), 0);
      
      const details: any[] = [];
      empSlips.forEach(s => {
        if (s.advances > 0) {
          details.push({
            date: s.date,
            type: 'Deduction',
            amount: s.advances,
            desc: `Payroll Deduction (${s.month})`
          });
        }
        if (s.recentAdvance && s.recentAdvance > 0) {
          details.push({
            date: s.recentAdvanceDate || s.date,
            type: 'Issue',
            amount: s.recentAdvance,
            desc: `Advance with Salary (${s.month})`
          });
        }
        details.push({
          date: s.date,
          type: 'Salary',
          amount: s.netPayable,
          desc: `Net Salary Paid (${s.month})`
        });
      });

      ledgerAdvances.forEach(l => {
        const lDate = l.date || (l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0);
        details.push({
          date: lDate,
          type: 'Issue',
          amount: l.amount,
          desc: l.description || 'Advance Issued'
        });
      });

      details.sort((a, b) => b.date - a.date);
      
      return {
        id: emp.id,
        name: emp.name,
        role: emp.role,
        currentBalance: emp.advanceBalance || 0,
        totalDeducted: deducted,
        totalGiven: slipGiven + ledgerGiven,
        details
      };
    }).sort((a, b) => b.currentBalance - a.currentBalance);

    const detailedPurchases = [...filteredPurchases].sort((a, b) => { 
      const getVal = (v: any) => {
         if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
         if (v?.createdAt && typeof v.createdAt === 'string') return new Date(v.createdAt).getTime();
         if (v?.createdAt && typeof v.createdAt === 'number') return v.createdAt;
         if (v?.date && typeof v.date === 'string') return new Date(v.date).getTime();
         if (v?.date && typeof v.date === 'number') return v.date;
         return 0;
      };
      return getVal(b) - getVal(a); 
    });

    return { 
      detailedSales,
      detailedPurchases,
      dailySalesReport,
      advanceReport,
      filteredCount: filteredSales.length, 
      totalRevenue, 
      trendChart, 
      topItems, 
      allItems,
      branchChart,
      customerReport,
      vendorReport,
      vendorDetailedReport,
      allPurchasesVendors,
      profitabilityReport,
      categoriesReport,
      paymentsReport
    };
  };

  const reports = reportData();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center card p-4 print:hidden">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
          <BarChart3 className="w-6 h-6 mr-3 text-sky-600" />
          Analytics & Reports
        </h2>
        <button onClick={() => printInvoice('report-print-content', 'Sales Report', 'a4')} className="flex items-center px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition shadow-sm">
          <Printer className="w-5 h-5 mr-2" /> Print
        </button>
      </div>

      <div className="card p-4 flex flex-wrap gap-4 items-end bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Branch</label>
          <select 
            value={activeBranchId || 'all'} 
            onChange={(e) => setActiveBranchId(e.target.value === 'all' ? null : e.target.value)} 
            className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400"
          >
            <option value="all">All Branches (Overall)</option>
            <option value="main">Main Branch (HQ)</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Group By</label>
          <select value={aggregation} onChange={(e: any) => setAggregation(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        {reportType === 'vendor_items' && (
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Select Vendor</label>
            <select value={selectedReportVendorName} onChange={(e: any) => setSelectedReportVendorName(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900">
              <option value="ALL">All Vendors</option>
              {reports.allPurchasesVendors.map((v, i) => (
                <option key={i} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}
        {reportType === 'advances' && (
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Search Employee</label>
            <input 
              type="text" 
              placeholder="Enter name..."
              value={advanceSearchTerm}
              onChange={(e) => setAdvanceSearchTerm(e.target.value)}
              className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 w-full md:w-64"
            />
          </div>
        )}

      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-700 print:hidden overflow-x-auto">
        {( ['sales', 'daily_sales', 'detailed_sales', 'detailed_purchases', 'items', 'categories', 'payments', 'customers', 'vendors', 'vendor_items', 'profitability', 'advances'] as const).map(type => (
          <button 
            key={type}
            onClick={() => setReportType(type)}
            className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
              reportType === type ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300'
            }`}
          >
            {type === 'sales' && 'Sales Overview'}
            {type === 'daily_sales' && 'Daily Sales Report'}
            {type === 'detailed_sales' && 'Detailed Sales (Bills)'}
            {type === 'detailed_purchases' && 'Detailed Purchases (Bills)'}
            {type === 'items' && 'Best Selling Items'}
            {type === 'categories' && 'Sales by Category'}
            {type === 'payments' && 'Sales by Payment Method'}
            {type === 'customers' && 'Customer Report'}
            {type === 'vendors' && 'Vendor Report'}
            {type === 'vendor_items' && 'Vendor Purchases (Detailed)'}
            {type === 'profitability' && 'Profitability by Item'}
            {type === 'advances' && 'Employee Advances'}
          </button>
        ))}
      </div>

      <div id="report-print-content" className="space-y-6 print:space-y-4 print:bg-white print:p-0 print:w-full print:static print:z-auto print:h-auto">
        <div className="hidden print:block text-center border-b border-slate-200 dark:border-slate-700 pb-4 mb-4">
          <h1 className="text-2xl font-bold font-serif uppercase tracking-widest text-slate-900 dark:text-slate-50">
             {!activeBranchId || activeBranchId === 'all'
               ? 'All Branches (Overall)'
               : (activeBranchId === 'main' ? 'Main Branch (HQ)' : (branches.find(b => b.id === activeBranchId)?.name || activeBranchId))}
          </h1>
          <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-1 uppercase tracking-widest">
            {reportType === 'sales' && 'Sales Report'}
            {reportType === 'daily_sales' && 'Daily Sales Report'}
            {reportType === 'detailed_sales' && 'Detailed Sales (Bills)'}
            {reportType === 'detailed_purchases' && 'Detailed Purchases (Bills)'}
            {reportType === 'items' && 'Best Selling Items Report'}
            {reportType === 'categories' && 'Sales by Category Report'}
            {reportType === 'payments' && 'Sales by Payment Method'}
            {reportType === 'customers' && 'Customer Sales Report'}
            {reportType === 'vendors' && 'Vendor Purchases Report'}
            {reportType === 'vendor_items' && 'Vendor Purchases (Detailed)'}
            {reportType === 'profitability' && 'Profitability Report'}
            {reportType === 'advances' && 'Employee Advance Report'}
            {' '}({startDate} to {endDate})
          </h2>
          <p className="text-xs text-slate-400 mt-2">Printed on {new Date().toLocaleString()}</p>
        </div>

        {reportType === 'sales' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6 mb-4 md:mb-6">
              <div className="card p-3 md:p-5">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Period Revenue</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-emerald-600">PKR {reports.totalRevenue.toLocaleString()}</div>
              </div>
              <div className="card p-3 md:p-5">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Transactions</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{reports.filteredCount}</div>
              </div>
              <div className="card p-3 md:p-5 col-span-2 md:col-span-1">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Avg Transaction</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-sky-600">PKR {reports.filteredCount ? Math.round(reports.totalRevenue / reports.filteredCount).toLocaleString() : 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 print:hidden">
              <div className="card p-5 flex flex-col min-h-[350px]">
                <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue Trend</div>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reports.trendChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                        itemStyle={{ color: '#38bdf8' }}
                      />
                      <Line type="monotone" dataKey="sales" stroke="#0284c7" strokeWidth={3} dot={{ r: 4, fill: '#0ea5e9' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card p-5 flex flex-col min-h-[350px]">
                <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Top Selling Items (Revenue)</div>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reports.topItems} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                      <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={80} />
                      <Tooltip 
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              {!activeBranchId && reports.branchChart.length > 0 && (
                <div className="card p-5 flex flex-col min-h-[350px] col-span-1 lg:col-span-2">
                  <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Branch Performance Snapshot</div>
                  <div className="flex-1 w-full">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={reports.branchChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                        <Tooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {reportType === 'daily_sales' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Daily Sales Breakdown</h3>
              <div className="text-xs text-slate-500 dark:text-slate-400">Includes In-Store and Online sales</div>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Date</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">In-Store Sales</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Online Sales</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.dailySalesReport.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">{row.display}</td>
                      <td className="py-3 px-4 text-right text-emerald-600">{(row.inStore || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-sky-600">{(row.online || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">{(row.total || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.dailySalesReport.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">No sales found for this period</td>
                    </tr>
                  )}
                  {reports.dailySalesReport.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td className="py-3 px-4 text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Totals</td>
                      <td className="py-3 px-4 text-right text-emerald-600">{reports.dailySalesReport.reduce((sum, r) => sum + r.inStore, 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-sky-600">{reports.dailySalesReport.reduce((sum, r) => sum + r.online, 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-slate-900 dark:text-slate-50">{reports.dailySalesReport.reduce((sum, r) => sum + r.total, 0).toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'detailed_sales' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Detailed Sales (Bills)</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Date & Time</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Inv #</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Type</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Customer</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Payment</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Items Qty</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.detailedSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {safeFormat(sale.date || 0, 'dd MMM yyyy, hh:mm a')}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">{String(sale.invoiceNo || sale.id.slice(0, 8)).toUpperCase()}</td>
                      <td className="py-3 px-4">
                        {sale.saleType === 'Online' ? (
                          <span className="px-2 py-1 rounded bg-sky-100 text-sky-700 text-xs border border-sky-200 font-medium">Online</span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200 text-xs border border-slate-200 dark:border-slate-700 font-medium">In-Store</span>
                        )}
                        {sale.transactionType === 'Return' && (
                          <span className="ml-2 px-2 py-1 rounded bg-rose-100 text-rose-700 text-xs border border-rose-200 font-medium">Return</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in Customer'}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-slate-950 text-[10px] uppercase font-bold tracking-wider rounded border border-slate-200 dark:border-slate-700">
                          {sale.paymentMethod || 'Cash'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 font-medium">
                        {(sale.items || []).reduce((sum, i) => sum + (i.qty || 0), 0)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">
                        PKR {((sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : sale.total || 0)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {reports.detailedSales.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">No sales found for this period</td>
                    </tr>
                  )}
                  {reports.detailedSales.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td colSpan={6} className="py-3 px-4 text-right text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Total Amount</td>
                      <td className="py-3 px-4 text-right text-emerald-600 text-base">
                        PKR {reports.detailedSales.reduce((sum, s) => sum + (s.transactionType === 'Return' ? -Math.abs(s.total || 0) : (s.total || 0)), 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'detailed_purchases' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Detailed Purchases (Bills)</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Date & Time</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Inv #</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Vendor</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Payment</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Items Qty</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.detailedPurchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {safeFormat(purchase.date || (purchase.createdAt?.seconds ? purchase.createdAt.seconds * 1000 : 0), 'dd MMM yyyy, hh:mm a')}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">{String(purchase.invoiceNo || purchase.id.slice(0, 8)).toUpperCase()}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{purchase.vendorName || 'Unknown Vendor'}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-slate-950 text-[10px] uppercase font-bold tracking-wider rounded border border-slate-200 dark:border-slate-700">
                          {purchase.paymentMethod || 'Cash'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 font-medium">
                        {(purchase.items || []).reduce((sum: number, i: any) => sum + (i.qty || 0), 0)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">
                        PKR {(purchase.total || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {reports.detailedPurchases.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">No purchases found for this period</td>
                    </tr>
                  )}
                  {reports.detailedPurchases.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td colSpan={5} className="py-3 px-4 text-right text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Total Purchase Amount</td>
                      <td className="py-3 px-4 text-right text-rose-600 text-base">
                        PKR {reports.detailedPurchases.reduce((sum, p) => sum + (p.total || 0), 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'items' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Best Selling Items Detailed Report</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium">Rank</th>
                    <th className="px-6 py-3 font-medium print:font-extrabold print:text-sm">Item Name</th>
                    <th className="px-6 py-3 font-medium text-right">Sale Price</th>
                    <th className="px-6 py-3 font-medium text-right">Gross Qty</th>
                    <th className="px-6 py-3 font-medium text-right text-rose-500">Return Qty</th>
                    <th className="px-6 py-3 font-medium text-right">Net Qty</th>
                    <th className="px-6 py-3 font-medium text-right">Gross Sales</th>
                    <th className="px-6 py-3 font-medium text-right text-rose-500">Returns</th>
                    <th className="px-6 py-3 font-medium text-right">Net Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.allItems.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400 font-mono">#{index + 1}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{(item.price || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.grossQty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-rose-500 font-mono">{item.returnQty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-800 dark:text-slate-100 font-bold font-mono">{item.qty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">PKR {item.grossRevenue.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-rose-500 font-mono">PKR {item.returnRevenue.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-bold text-emerald-600 font-mono">PKR {item.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.allItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No items sold in the selected period.</td>
                    </tr>
                  )}
                  {reports.allItems.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td colSpan={3} className="py-3 px-6 text-right text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Total</td>
                      <td className="py-3 px-6 text-right text-slate-700 dark:text-slate-200 text-sm font-mono">
                        {reports.allItems.reduce((sum, item) => sum + item.grossQty, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-rose-500 text-sm font-mono">
                        {reports.allItems.reduce((sum, item) => sum + item.returnQty, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-slate-800 dark:text-slate-100 text-base font-mono">
                        {reports.allItems.reduce((sum, item) => sum + item.qty, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-slate-700 dark:text-slate-200 text-sm font-mono">
                        PKR {reports.allItems.reduce((sum, item) => sum + item.grossRevenue, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-rose-500 text-sm font-mono">
                        PKR {reports.allItems.reduce((sum, item) => sum + item.returnRevenue, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-emerald-600 text-base font-mono">
                        PKR {reports.allItems.reduce((sum, item) => sum + item.revenue, 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reportType === 'categories' && (
          <div className="space-y-6">
            <div className="card p-5 flex flex-col min-h-[350px] print:hidden">
              <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue by Category</div>
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={reports.categoriesReport} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Sales by Category Report</h3>
              </div>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                      <th className="px-6 py-3 font-medium">Category Name</th>
                      <th className="px-6 py-3 font-medium text-right">Items Sold</th>
                      <th className="px-6 py-3 font-medium text-right">Revenue Generated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 print:divide-black/20">
                    {reports.categoriesReport.map((item, index) => (
                      <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                        <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.qty.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-emerald-600 font-mono">PKR {item.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                    {reports.categoriesReport.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No sales in selected period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {reportType === 'payments' && (
          <div className="space-y-6">
             <div className="card p-5 flex flex-col min-h-[350px] print:hidden">
              <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue by Payment Method</div>
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={reports.paymentsReport} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Sales by Payment Method</h3>
              </div>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                      <th className="px-6 py-3 font-medium">Payment Method</th>
                      <th className="px-6 py-3 font-medium text-right">Transactions</th>
                      <th className="px-6 py-3 font-medium text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 print:divide-black/20">
                    {reports.paymentsReport.map((item, index) => (
                      <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                        <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.count.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-emerald-600 font-mono">PKR {item.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                    {reports.paymentsReport.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No sales in selected period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {reportType === 'customers' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Customer Sales Report</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium">Customer Name</th>
                    <th className="px-6 py-3 font-medium text-right"># of Sales Orders</th>
                    <th className="px-6 py-3 font-medium text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.customerReport.map((customer, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{customer.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{customer.count.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-emerald-600 font-mono">PKR {customer.total.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.customerReport.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No sales recorded for any customers.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reportType === 'vendors' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Vendor Purchases Report</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium">Vendor Name</th>
                    <th className="px-6 py-3 font-medium text-right"># of Purchase Orders</th>
                    <th className="px-6 py-3 font-medium text-right">Total Purchase Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.vendorReport.map((vendor, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{vendor.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{vendor.count.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-rose-600 font-mono">PKR {vendor.total.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.vendorReport.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No purchases recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {reportType === 'vendor_items' && (
          <div className="space-y-6">
            {reports.vendorDetailedReport.filter(v => selectedReportVendorName === 'ALL' || v.vendorName === selectedReportVendorName).length === 0 ? (
              <div className="card p-8 text-center text-slate-500 dark:text-slate-400">
                No purchases recorded for this period.
              </div>
            ) : (
              reports.vendorDetailedReport.filter(v => selectedReportVendorName === 'ALL' || v.vendorName === selectedReportVendorName).map((vendor, vIndex) => (
                <div key={vIndex} className="card print:shadow-none print:border print:border-black print:mb-8 print:break-inside-avoid">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800/50 print:border-black print:border-b-2 flex justify-between items-center bg-slate-50 dark:bg-slate-800/20 print:bg-transparent">
                    <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100 print:text-black print:font-bold print:text-xl uppercase tracking-widest">{vendor.vendorName}</h3>
                    <div className="flex space-x-6 print:text-black">
                       <div><span className="text-xs text-slate-400 uppercase tracking-widest block print:text-black print:font-bold">Total Items</span><span className="font-mono font-bold text-slate-700 dark:text-slate-200 print:text-black print:text-lg">{vendor.totalQty.toLocaleString()}</span></div>
                       <div><span className="text-xs text-slate-400 uppercase tracking-widest block print:text-black print:font-bold">Total Value</span><span className="font-mono font-bold text-rose-600 print:text-black print:text-lg">PKR {vendor.totalValue.toLocaleString()}</span></div>
                    </div>
                  </div>
                  <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                          <th className="px-6 py-3 font-medium print:font-extrabold print:text-sm">Item Name</th>
                          <th className="px-6 py-3 font-medium text-right print:font-extrabold print:text-sm">Quantity Purchased</th>
                          <th className="px-6 py-3 font-medium text-right print:font-extrabold print:text-sm">Avg Rate</th>
                          <th className="px-6 py-3 font-medium text-right print:font-extrabold print:text-sm">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 print:divide-black/20">
                        {vendor.items.map((item, iIndex) => (
                          <tr key={iIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 print:hover:bg-transparent">
                            <td className="px-6 py-3 text-sm font-medium text-slate-900 dark:text-slate-50 print:text-black print:font-bold">{item.itemName}</td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600 dark:text-slate-300 font-mono print:text-black">{item.qty.toLocaleString()}</td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600 dark:text-slate-300 font-mono print:text-black">PKR {Math.round(item.total / (item.qty || 1)).toLocaleString()}</td>
                            <td className="px-6 py-3 text-sm text-right text-rose-600 font-mono print:text-black print:font-bold">PKR {item.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {reportType === 'profitability' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Profitability by Item</h3>
              <div className="text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                Total Profit: PKR {reports.profitabilityReport.reduce((acc, curr) => acc + curr.profit, 0).toLocaleString()}
              </div>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium print:font-extrabold print:text-sm">Item Name</th>
                    <th className="px-6 py-3 font-medium text-right">Qty Sold</th>
                    <th className="px-6 py-3 font-medium text-right">Revenue (PKR)</th>
                    <th className="px-6 py-3 font-medium text-right">Cost (PKR)</th>
                    <th className="px-6 py-3 font-medium text-right text-emerald-600">Profit (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.profitabilityReport.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.qty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-sky-600 font-mono">{item.revenue.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-rose-600 font-mono">{item.cost.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-bold text-emerald-600 font-mono">{item.profit.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.profitabilityReport.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No items sold.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'advances' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 uppercase tracking-widest text-xs">Employee Advance Balances & Activity</h3>
              <div className="text-sm font-medium text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100 font-mono">
                Total Outstanding: PKR {reports.advanceReport.reduce((acc, curr) => acc + curr.currentBalance, 0).toLocaleString()}
              </div>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-widest print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-bold">Employee Name</th>
                    <th className="px-6 py-3 font-bold text-right">Given (In Period)</th>
                    <th className="px-6 py-3 font-bold text-right">Deducted (In Period)</th>
                    <th className="px-6 py-3 font-bold text-right text-amber-600">Current Balance</th>
                    <th className="px-6 py-3 font-bold text-center print:hidden w-10">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                  {reports.advanceReport
                    .filter(row => !advanceSearchTerm || row.name.toLowerCase().includes(advanceSearchTerm.toLowerCase()))
                    .map((row, index) => (
                    <React.Fragment key={index}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{row.name}</span>
                            <span className="text-[10px] text-slate-400 uppercase tracking-widest">{row.role}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-mono text-emerald-600">PKR {row.totalGiven.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-mono text-rose-600">PKR {row.totalDeducted.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-bold text-amber-600 font-mono">PKR {row.currentBalance.toLocaleString()}</td>
                        <td className="px-6 py-4 text-center print:hidden">
                          <button 
                            onClick={() => setExpandedAdvanceId(expandedAdvanceId === row.id ? null : row.id)}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          >
                            <span className={`inline-block transform transition-transform duration-200 ${expandedAdvanceId === row.id ? 'rotate-90' : ''}`}>➔</span>
                          </button>
                        </td>
                      </tr>
                      {expandedAdvanceId === row.id && (
                        <tr className="bg-slate-50/50 dark:bg-slate-800/20 print:hidden">
                          <td colSpan={5} className="px-6 py-4 border-l-2 border-amber-500">
                            <div className="space-y-3">
                              <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Transaction History</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {row.details.length === 0 ? (
                                  <div className="text-xs text-slate-400 italic">No activity recorded for this period.</div>
                                ) : (
                                  row.details.map((detail: any, dIndex: number) => (
                                    <div key={dIndex} className="bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                                      <div className="flex justify-between items-start mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                                          detail.type === 'Issue' ? 'bg-emerald-100 text-emerald-700' : 
                                          detail.type === 'Salary' ? 'bg-blue-100 text-blue-700' :
                                          'bg-rose-100 text-rose-700'
                                        }`}>
                                          {detail.type}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          {new Date(detail.date).toLocaleDateString()}
                                        </span>
                                      </div>
                                      <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">
                                        PKR {detail.amount.toLocaleString()}
                                      </div>
                                      <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1 italic">
                                        {detail.desc}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Print details always */}
                      <tr className="hidden print:table-row">
                        <td colSpan={5} className="px-6 py-2 border-l-2 border-black/20">
                           <div className="text-[10px] font-bold uppercase tracking-widest mb-1 text-black/60">Detail:</div>
                           <div className="flex flex-wrap gap-x-6 gap-y-1">
                             {row.details.map((d: any, di: number) => (
                               <div key={di} className="text-[10px] text-black">
                                 <span className="font-bold">[{new Date(d.date).toLocaleDateString()}]</span> {d.type}: PKR {d.amount.toLocaleString()} ({d.desc})
                               </div>
                             ))}
                           </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                  {reports.advanceReport.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No employee data found.</td>
                    </tr>
                  )}
                  {reports.advanceReport.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold border-t-2 border-slate-200 dark:border-slate-700">
                      <td className="py-4 px-6 text-right text-slate-800 dark:text-slate-100 uppercase text-[10px] tracking-widest">Total Period Summary</td>
                      <td className="py-4 px-6 text-right text-emerald-600 text-sm font-mono">
                        PKR {reports.advanceReport.reduce((sum, row) => sum + row.totalGiven, 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right text-rose-600 text-sm font-mono">
                        PKR {reports.advanceReport.reduce((sum, row) => sum + row.totalDeducted, 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right text-amber-600 text-sm font-mono">
                        PKR {reports.advanceReport.reduce((sum, row) => sum + row.currentBalance, 0).toLocaleString()}
                      </td>
                      <td className="print:hidden"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
