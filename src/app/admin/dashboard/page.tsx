'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { id } from 'date-fns/locale'

interface Stats {
  totalEmployees: number
  presentToday: number
  lateToday: number
  absentToday: number
}

interface RecentAttendance {
  id: string
  check_in_time: string
  check_out_time: string | null
  total_hours: number | null
  status: string
  users: { name: string }
  locations: { name: string }
}

export default function AdminDashboard() {
  const supabase = createClient()
  const [stats, setStats] = useState<Stats>({ totalEmployees: 0, presentToday: 0, lateToday: 0, absentToday: 0 })
  const [recent, setRecent] = useState<RecentAttendance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]

      const { count: totalEmp } = await supabase
        .from('users').select('*', { count: 'exact', head: true })
        .eq('role', 'employee').eq('is_active', true)

      const { data: todayAtts } = await supabase
        .from('attendances')
        .select('status')
        .gte('check_in_time', today + 'T00:00:00')
        .lte('check_in_time', today + 'T23:59:59')

      const presentCount = todayAtts?.filter(a => a.status === 'present').length ?? 0
      const lateCount = todayAtts?.filter(a => a.status === 'late').length ?? 0
      const total = totalEmp ?? 0

      setStats({
        totalEmployees: total,
        presentToday: presentCount,
        lateToday: lateCount,
        absentToday: total - (presentCount + lateCount),
      })

      const { data: recentAtts } = await supabase
        .from('attendances')
        .select('*, users(name), locations(name)')
        .order('check_in_time', { ascending: false })
        .limit(10)
      if (recentAtts) setRecent(recentAtts as RecentAttendance[])
      setLoading(false)
    }
    load()
  }, [supabase])

  const statCards = [
    { label: 'Total Karyawan', value: stats.totalEmployees, color: 'bg-blue-50 text-blue-700', border: 'border-blue-100' },
    { label: 'Hadir Hari Ini', value: stats.presentToday, color: 'bg-green-50 text-green-700', border: 'border-green-100' },
    { label: 'Terlambat', value: stats.lateToday, color: 'bg-yellow-50 text-yellow-700', border: 'border-yellow-100' },
    { label: 'Tidak Hadir', value: stats.absentToday, color: 'bg-red-50 text-red-700', border: 'border-red-100' },
  ]

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, d MMMM yyyy', { locale: id })}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(s => (
          <div key={s.label} className={`bg-white rounded-2xl border ${s.border} p-4 shadow-sm`}>
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-3xl font-bold mt-2 ${s.color.split(' ')[1]}`}>
              {loading ? '...' : s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent attendances */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900 text-sm">Absensi Terbaru</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Memuat data...</div>
        ) : recent.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Belum ada data absensi</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Karyawan</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Tanggal</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Masuk</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Pulang</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Durasi</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recent.map(att => (
                  <tr key={att.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{att.users.name}</td>
                    <td className="px-6 py-3 text-gray-600">{format(new Date(att.check_in_time), 'd MMM yyyy', { locale: id })}</td>
                    <td className="px-6 py-3 text-gray-600">{format(new Date(att.check_in_time), 'HH:mm')}</td>
                    <td className="px-6 py-3 text-gray-600">{att.check_out_time ? format(new Date(att.check_out_time), 'HH:mm') : '-'}</td>
                    <td className="px-6 py-3 text-gray-600">{att.total_hours ? `${att.total_hours.toFixed(1)} jam` : '-'}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        att.status === 'present' ? 'bg-green-100 text-green-700' :
                        att.status === 'late' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {att.status === 'present' ? 'Hadir' : att.status === 'late' ? 'Terlambat' : 'Tdk Lengkap'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
