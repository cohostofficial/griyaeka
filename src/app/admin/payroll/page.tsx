'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { id } from 'date-fns/locale'

interface PayrollRow {
  user_id: string
  name: string
  total_days: number
  total_hours: number
  hourly_rate: number
  total_salary: number
}

interface Employee { id: string; name: string }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function PayrollPage() {
  const supabase = createClient()

  const [dateFrom, setDateFrom]   = useState(firstOfMonthStr)
  const [dateTo, setDateTo]       = useState(todayStr)
  const [payroll, setPayroll]     = useState<PayrollRow[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [generating, setGenerating] = useState(false)
  const [toast, setToast]         = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    supabase.from('users').select('id,name')
      .eq('role', 'employee').eq('is_active', true)
      .then(({ data }) => { if (data) setEmployees(data) })
  }, [supabase])

  function showToast(ok: boolean, msg: string) {
    setToast({ ok, msg })
    setTimeout(() => setToast(null), 4000)
  }

  async function generatePayroll() {
    if (!dateFrom || !dateTo) { showToast(false, 'Pilih tanggal dari dan sampai'); return }
    if (dateFrom > dateTo) { showToast(false, 'Tanggal "dari" tidak boleh lebih besar dari "sampai"'); return }

    setGenerating(true)
    const from = dateFrom + 'T00:00:00+07:00'
    const to   = dateTo   + 'T23:59:59+07:00'
    const rows: PayrollRow[] = []

    for (const emp of employees) {
      // Ambil absensi dalam range tanggal
      const { data: atts } = await supabase
        .from('attendances')
        .select('total_hours, check_in_time')
        .eq('user_id', emp.id)
        .gte('check_in_time', from)
        .lte('check_in_time', to)
        .not('total_hours', 'is', null)

      // Ambil tarif per jam terbaru
      const { data: rateData } = await supabase
        .from('salary_rates')
        .select('hourly_rate')
        .eq('user_id', emp.id)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()

      const hourlyRate  = rateData?.hourly_rate ?? 0
      const totalHours  = atts?.reduce((s, a) => s + (a.total_hours ?? 0), 0) ?? 0
      const totalDays   = atts?.length ?? 0
      const totalSalary = totalHours * hourlyRate

      rows.push({
        user_id: emp.id,
        name: emp.name,
        total_days: totalDays,
        total_hours: totalHours,
        hourly_rate: hourlyRate,
        total_salary: totalSalary,
      })
    }

    setPayroll(rows)
    setGenerating(false)
    showToast(true, `Penggajian berhasil dihitung untuk ${rows.length} karyawan`)
  }

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const rows = payroll.map(p => ({
      Nama: p.name,
      'Hari Kerja': p.total_days,
      'Total Jam': p.total_hours.toFixed(2),
      'Tarif/Jam (Rp)': p.hourly_rate.toLocaleString('id-ID'),
      'Total Gaji (Rp)': p.total_salary.toLocaleString('id-ID'),
    }))
    const wb = utils.book_new()
    utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Penggajian')
    writeFile(wb, `Penggajian_${dateFrom}_sd_${dateTo}.xlsx`)
  }

  const totalGaji    = payroll.reduce((s, p) => s + p.total_salary, 0)
  const periodLabel  = `${dateFrom} s/d ${dateTo}`

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Penggajian</h1>
        <p className="text-sm text-gray-500">Hitung gaji karyawan per rentang tanggal</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">Dari Tanggal</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">Sampai Tanggal</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={generatePayroll} disabled={generating}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {generating ? 'Menghitung...' : 'Hitung Gaji'}
          </button>
          {payroll.length > 0 && (
            <button onClick={exportExcel}
              className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700">
              Export Excel
            </button>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`rounded-2xl px-4 py-3 flex items-center justify-between text-sm font-medium ${
          toast.ok ? 'bg-green-50 border border-green-200 text-green-800'
                   : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-4 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {/* Summary total */}
      {payroll.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex justify-between items-center">
          <div>
            <p className="text-sm text-blue-700 font-medium">Total Penggajian</p>
            <p className="text-xs text-blue-400 mt-0.5">{periodLabel}</p>
          </div>
          <p className="text-xl font-bold text-blue-800">Rp {totalGaji.toLocaleString('id-ID')}</p>
        </div>
      )}

      {/* Tabel */}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payroll.map(p => (
                  <tr key={p.user_id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{p.total_days}</td>
                    <td className="px-6 py-3 text-right text-gray-600 font-mono">{p.total_hours.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right text-gray-600">
                      {p.hourly_rate > 0 ? `Rp ${p.hourly_rate.toLocaleString('id-ID')}` : '-'}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">
                      Rp {p.total_salary.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-6 py-3 text-sm font-semibold text-gray-700 text-right">Total</td>
                  <td className="px-6 py-3 text-right font-bold text-blue-700">
                    Rp {totalGaji.toLocaleString('id-ID')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {payroll.length === 0 && !generating && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">
            Pilih rentang tanggal lalu klik "Hitung Gaji"
          </p>
        </div>
      )}
    </div>
  )
}
