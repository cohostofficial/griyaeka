'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns'
import { id } from 'date-fns/locale'

interface PayrollRow {
  user_id: string
  name: string
  total_days: number
  total_hours: number
  hourly_rate: number
  total_salary: number
  status: 'draft' | 'finalized'
  id?: string
}

interface Employee { id: string; name: string }

export default function PayrollPage() {
  const supabase = createClient()
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [payroll, setPayroll] = useState<PayrollRow[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    supabase.from('users').select('id,name').eq('role', 'employee').eq('is_active', true)
      .then(({ data }) => { if (data) setEmployees(data) })
  }, [supabase])

  async function loadPayroll() {
    setLoading(true)
    const [year, month] = selectedMonth.split('-').map(Number)

    // Check existing payroll summary
    const { data: existing } = await supabase
      .from('payroll_summary')
      .select('*, users(name)')
      .eq('month', month)
      .eq('year', year)

    if (existing && existing.length > 0) {
      setPayroll(existing.map((p: any) => ({
        user_id: p.user_id,
        name: p.users.name,
        total_days: p.total_days,
        total_hours: p.total_hours,
        hourly_rate: p.hourly_rate,
        total_salary: p.total_salary,
        status: p.status,
        id: p.id,
      })))
    } else {
      setPayroll([])
    }
    setLoading(false)
  }

  async function generatePayroll() {
    setGenerating(true)
    const [year, month] = selectedMonth.split('-').map(Number)
    const from = startOfMonth(new Date(year, month - 1)).toISOString()
    const to = endOfMonth(new Date(year, month - 1)).toISOString()

    const rows: PayrollRow[] = []

    for (const emp of employees) {
      // Get attendances
      const { data: atts } = await supabase
        .from('attendances')
        .select('total_hours, check_in_time')
        .eq('user_id', emp.id)
        .gte('check_in_time', from)
        .lte('check_in_time', to)
        .not('total_hours', 'is', null)

      // Get latest salary rate
      const { data: rateData } = await supabase
        .from('salary_rates')
        .select('hourly_rate')
        .eq('user_id', emp.id)
        .lte('effective_from', selectedMonth + '-28')
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()

      const hourlyRate = rateData?.hourly_rate ?? 0
      const totalHours = atts?.reduce((s, a) => s + (a.total_hours ?? 0), 0) ?? 0
      const totalDays = atts?.length ?? 0
      const totalSalary = totalHours * hourlyRate

      rows.push({
        user_id: emp.id,
        name: emp.name,
        total_days: totalDays,
        total_hours: totalHours,
        hourly_rate: hourlyRate,
        total_salary: totalSalary,
        status: 'draft',
      })

      // Upsert into payroll_summary
      await supabase.from('payroll_summary').upsert({
        user_id: emp.id,
        month,
        year,
        total_days: totalDays,
        total_hours: totalHours,
        hourly_rate: hourlyRate,
        total_salary: totalSalary,
        status: 'draft',
        generated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,month,year' })
    }

    setPayroll(rows)
    setGenerating(false)
  }

  async function finalizePayroll() {
    const [year, month] = selectedMonth.split('-').map(Number)
    await supabase.from('payroll_summary')
      .update({ status: 'finalized' })
      .eq('month', month)
      .eq('year', year)
    loadPayroll()
  }

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const rows = payroll.map(p => ({
      'Nama': p.name,
      'Hari Kerja': p.total_days,
      'Total Jam': p.total_hours.toFixed(2),
      'Tarif/Jam (Rp)': p.hourly_rate.toLocaleString('id-ID'),
      'Total Gaji (Rp)': p.total_salary.toLocaleString('id-ID'),
      'Status': p.status === 'finalized' ? 'Final' : 'Draft',
    }))
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Penggajian')
    writeFile(wb, `Penggajian_${selectedMonth}.xlsx`)
  }

  const isFinalized = payroll.length > 0 && payroll.every(p => p.status === 'finalized')
  const totalGaji = payroll.reduce((s, p) => s + p.total_salary, 0)

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Penggajian</h1>
        <p className="text-sm text-gray-500">Hitung dan rekap gaji karyawan</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">Periode</label>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={loadPayroll} disabled={loading}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50">
            {loading ? 'Memuat...' : 'Tampilkan'}
          </button>
          <button onClick={generatePayroll} disabled={generating || isFinalized}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {generating ? 'Menghitung...' : 'Hitung Gaji'}
          </button>
          {payroll.length > 0 && !isFinalized && (
            <button onClick={finalizePayroll}
              className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700">
              Finalisasi
            </button>
          )}
          {payroll.length > 0 && (
            <button onClick={exportExcel}
              className="px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600">
              Export Excel
            </button>
          )}
        </div>
        {isFinalized && (
          <p className="mt-3 text-xs text-green-600 font-medium">Penggajian bulan ini sudah difinalisasi.</p>
        )}
      </div>

      {/* Summary */}
      {payroll.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex justify-between items-center">
          <div>
            <p className="text-sm text-blue-700 font-medium">Total Penggajian</p>
            <p className="text-xs text-blue-500">{format(new Date(selectedMonth + '-01'), 'MMMM yyyy', { locale: id })}</p>
          </div>
          <p className="text-xl font-bold text-blue-800">Rp {totalGaji.toLocaleString('id-ID')}</p>
        </div>
      )}

      {/* Table */}
      {payroll.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Nama</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-500 font-medium">Hari</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-500 font-medium">Total Jam</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-500 font-medium">Tarif/Jam</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-500 font-medium">Total Gaji</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payroll.map(p => (
                  <tr key={p.user_id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{p.total_days}</td>
                    <td className="px-6 py-3 text-right text-gray-600 font-mono">{p.total_hours.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right text-gray-600">Rp {p.hourly_rate.toLocaleString('id-ID')}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">Rp {p.total_salary.toLocaleString('id-ID')}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {p.status === 'finalized' ? 'Final' : 'Draft'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-6 py-3 text-sm font-semibold text-gray-700 text-right">Total</td>
                  <td className="px-6 py-3 text-right font-bold text-blue-700">Rp {totalGaji.toLocaleString('id-ID')}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {payroll.length === 0 && !loading && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">Pilih periode lalu klik "Hitung Gaji" untuk menghitung penggajian</p>
        </div>
      )}
    </div>
  )
}
